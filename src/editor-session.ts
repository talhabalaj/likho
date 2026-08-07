import {
  BoxRenderable,
  LineNumberRenderable,
  SyntaxStyle,
  TextareaRenderable,
  TextRenderable,
  createCliRenderer,
  type CliRenderer,
  type KeyEvent,
  type Renderable,
} from "@opentui/core"
import { registerDefaultKeys, registerMetadataFields, registerModBindings } from "@opentui/keymap/addons"
import { registerManagedTextareaLayer } from "@opentui/keymap/addons/opentui"
import { createOpenTuiKeymap } from "@opentui/keymap/opentui"
import type { Keymap } from "@opentui/keymap"
import { basename } from "node:path"
import type { CliSignal, EditorSessionResult } from "./cli"
import { openDocument } from "./document"
import { builtins } from "./plugins/builtins"
import {
  DisposableStore,
  PluginHost,
  type BuiltinPlugin,
  type CommandContributions,
  type EditorPluginContext,
} from "./plugins/host"

const DARK_PLUS_STYLES = {
  default: { fg: "#d4d4d4" },
  none: { fg: "#d4d4d4" },
  attribute: { fg: "#9cdcfe" },
  boolean: { fg: "#569cd6" },
  comment: { fg: "#6a9955" },
  constant: { fg: "#9cdcfe" },
  "constant.builtin": { fg: "#569cd6" },
  constructor: { fg: "#4ec9b0" },
  function: { fg: "#dcdcaa" },
  keyword: { fg: "#569cd6" },
  "keyword.conditional": { fg: "#c586c0" },
  "keyword.exception": { fg: "#c586c0" },
  "keyword.repeat": { fg: "#c586c0" },
  "keyword.return": { fg: "#c586c0" },
  label: { fg: "#c8c8c8" },
  module: { fg: "#4ec9b0" },
  number: { fg: "#b5cea8" },
  operator: { fg: "#d4d4d4" },
  property: { fg: "#9cdcfe" },
  punctuation: { fg: "#d4d4d4" },
  string: { fg: "#ce9178" },
  "string.escape": { fg: "#d7ba7d" },
  "string.regexp": { fg: "#d16969" },
  type: { fg: "#4ec9b0" },
  "type.builtin": { fg: "#4ec9b0" },
  variable: { fg: "#9cdcfe" },
  "variable.builtin": { fg: "#4fc1ff" },
  "markup.bold": { fg: "#d4d4d4", bold: true },
  "markup.heading": { fg: "#569cd6", bold: true },
  "markup.italic": { fg: "#d4d4d4", italic: true },
  "markup.link": { fg: "#4fc1ff", underline: true },
  "markup.quote": { fg: "#6a9955" },
  "markup.raw": { fg: "#ce9178" },
} as const

export interface EditorSessionDependencies {
  createRenderer(): Promise<CliRenderer>
  plugins?: readonly BuiltinPlugin<EditorPluginContext>[]
}

function signalResult(reason: unknown): EditorSessionResult {
  if (
    typeof reason === "object" &&
    reason !== null &&
    "signal" in reason &&
    (reason.signal === "SIGHUP" || reason.signal === "SIGINT" || reason.signal === "SIGTERM")
  ) {
    return { kind: "signal", signal: reason.signal as CliSignal }
  }
  return { kind: "signal", signal: "SIGTERM" }
}

function resolveStyleId(style: SyntaxStyle, group: string): number | null {
  let name = group
  while (true) {
    const id = style.resolveStyleId(name)
    if (id !== null) return id
    const separator = name.lastIndexOf(".")
    if (separator === -1) return style.resolveStyleId("default")
    name = name.slice(0, separator)
  }
}

function createCommands(
  keymap: Keymap<Renderable, KeyEvent>,
  editor: TextareaRenderable,
): CommandContributions {
  const commandIds = new Set<string>()

  return {
    platform: keymap.getHostMetadata().platform,
    registerCommand(command) {
      if (commandIds.has(command.id)) throw new Error(`Duplicate command ID "${command.id}"`)
      commandIds.add(command.id)
      const unregister = keymap.registerLayer({
        commands: [{ name: command.id, title: command.title, run: command.run }],
      })
      return {
        dispose() {
          unregister()
          commandIds.delete(command.id)
        },
      }
    },
    registerBindings(bindings) {
      const unregister = keymap.registerLayer({
        target: editor,
        targetMode: "focus",
        priority: 100,
        bindings: bindings.map(({ key, command }) => ({ key, cmd: command })),
      })
      return { dispose: unregister }
    },
  }
}

export async function runEditorSession(
  request: Readonly<{ filePath: string; signal: AbortSignal }>,
  dependencies: EditorSessionDependencies = {
    createRenderer: () => createCliRenderer({ exitOnCtrlC: false }),
  },
): Promise<EditorSessionResult> {
  const document = openDocument(request.filePath)
  if (request.signal.aborted) return signalResult(request.signal.reason)

  const renderer = await dependencies.createRenderer()
  const resources = new DisposableStore()
  let pluginHost: PluginHost<EditorPluginContext> | undefined
  let ready = false
  let closing = false
  try {
    const syntaxStyle = SyntaxStyle.fromStyles(DARK_PLUS_STYLES)
    resources.add(() => syntaxStyle.destroy())
    let message = ""
    let quitArmedText: string | null = null
    let finish!: (result: EditorSessionResult) => void
    const finished = new Promise<EditorSessionResult>((resolve) => {
      finish = (result) => {
        if (closing) return
        closing = true
        ready = false
        resolve(result)
      }
    })

    const root = new BoxRenderable(renderer, {
      width: "100%",
      height: "100%",
      flexDirection: "column",
      backgroundColor: "#1e1e1e",
    })
    const titleBar = new BoxRenderable(renderer, { width: "100%", height: 1, backgroundColor: "#181818" })
    const title = new TextRenderable(renderer, { height: 1, fg: "#cccccc" })
    const statusBar = new BoxRenderable(renderer, { width: "100%", height: 1, backgroundColor: "#007acc" })
    const status = new TextRenderable(renderer, { height: 1, fg: "#ffffff" })
    titleBar.add(title)
    statusBar.add(status)

    let editor!: TextareaRenderable
    let editorWithLines!: LineNumberRenderable
    // ponytail: OpenTUI sizes from visible lines; the unreachable entry supplies the document's real maximum.
    const lineNumberWidthHint = new Map<number, number>()
    const updateChrome = () => {
      if (!ready) return
      const cursor = editor.logicalCursor
      const snapshot = document.snapshot
      const shortcutPrefix = process.platform === "darwin" ? "⌘" : "Ctrl+"
      title.content = ` ${basename(snapshot.path)}${snapshot.dirty ? " •" : ""} — editor`
      status.content =
        message || ` Ln ${cursor.row + 1}, Col ${cursor.col + 1}   UTF-8   ${shortcutPrefix}S Save   Ctrl+Q Quit`
    }

    editor = new TextareaRenderable(renderer, {
      initialValue: document.snapshot.text,
      width: "100%",
      height: "100%",
      wrapMode: "none",
      textColor: "#d4d4d4",
      backgroundColor: "#1e1e1e",
      selectionBg: "#264f78",
      cursorColor: "#aeafad",
      syntaxStyle,
      tabIndicator: "→",
      tabIndicatorColor: "#404040",
      onContentChange: () => {
        if (!ready) return
        document.replaceText(editor.plainText)
        quitArmedText = null
        message = ""
        lineNumberWidthHint.set(-1, editor.lineCount)
        editorWithLines.setLineNumbers(lineNumberWidthHint)
        updateChrome()
      },
      onCursorChange: updateChrome,
    })

    lineNumberWidthHint.set(-1, editor.lineCount)
    editorWithLines = new LineNumberRenderable(renderer, {
      target: editor,
      lineNumbers: lineNumberWidthHint,
      width: "100%",
      height: "100%",
      minWidth: 3,
      paddingRight: 1,
      fg: "#858585",
      bg: "#1e1e1e",
      onMouseScroll: (event) => {
        if (event.target === editor) return
        event.stopPropagation()
        editor.processMouseEvent(event)
      },
    })
    const editorPanel = new BoxRenderable(renderer, { flexGrow: 1 })
    editorPanel.add(editorWithLines)
    root.add(titleBar)
    root.add(editorPanel)
    root.add(statusBar)

    const keymap = createOpenTuiKeymap(renderer)
    resources.add(registerDefaultKeys(keymap))
    resources.add(registerModBindings(keymap))
    resources.add(registerMetadataFields(keymap))
    resources.add(registerManagedTextareaLayer(keymap, renderer, {}))
    const commands = createCommands(keymap, editor)

    const report = (nextMessage: string) => {
      message = ` ${nextMessage}`
      updateChrome()
    }
    const save = () => {
      try {
        document.replaceText(editor.plainText)
        document.save()
        quitArmedText = null
        report(`Saved ${basename(document.snapshot.path)}`)
      } catch (error) {
        report(error instanceof Error ? error.message : String(error))
      }
    }
    const copy = (cut: boolean) => {
      const selected = editor.getSelectedText()
      const line = editor.plainText.split("\n")[editor.logicalCursor.row] ?? ""
      if (!renderer.copyToClipboardOSC52(selected || `${line}\n`)) {
        report("Clipboard unavailable; nothing was cut")
      } else if (cut) {
        selected ? editor.deleteSelection() : editor.deleteLine()
        report("Cut to clipboard")
      } else {
        report("Copied to clipboard")
      }
    }
    const requestClose = () => {
      document.replaceText(editor.plainText)
      const snapshot = document.snapshot
      if (snapshot.dirty && quitArmedText !== snapshot.text) {
        quitArmedText = snapshot.text
        report("Unsaved changes — repeat close to discard")
        return
      }
      finish({ kind: "closed" })
    }

    pluginHost = new PluginHost<EditorPluginContext>(
      {
        document,
        commands,
        actions: {
          save,
          copy: () => copy(false),
          cut: () => copy(true),
          insertTab: () => editor.insertText("\t"),
          requestClose,
        },
        syntax: {
          bufferId: editor.editBuffer.id,
          clear: () => editor.clearAllHighlights(),
          add: ({ line, ...highlight }) => editor.addHighlight(line, highlight),
          resolveStyleId: (group) => resolveStyleId(syntaxStyle, group),
        },
        report,
      },
      ({ pluginId, phase, error }) => {
        report(`${pluginId} ${phase} failed: ${error instanceof Error ? error.message : String(error)}`)
      },
    )

    const onAbort = () => finish(signalResult(request.signal.reason))
    request.signal.addEventListener("abort", onAbort, { once: true })
    resources.add(() => request.signal.removeEventListener("abort", onAbort))

    await pluginHost.activate(dependencies.plugins ?? builtins)
    renderer.root.add(root)
    ready = true
    editor.focus()
    updateChrome()
    if (request.signal.aborted) onAbort()
    return await finished
  } finally {
    closing = true
    ready = false
    await pluginHost?.dispose()
    await resources.dispose()
    renderer.destroy()
  }
}
