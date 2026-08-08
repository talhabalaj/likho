import {
  BoxRenderable,
  CliRenderEvents,
  SyntaxStyle,
  SlotRenderable,
  TextareaRenderable,
  TextRenderable,
  createCliRenderer,
  createCoreSlotRegistry,
  type CliRenderer,
} from "@opentui/core"
import { registerDefaultKeys, registerMetadataFields, registerModBindings } from "@opentui/keymap/addons"
import { registerManagedTextareaLayer } from "@opentui/keymap/addons/opentui"
import { createOpenTuiKeymap } from "@opentui/keymap/opentui"
import { randomUUID } from "node:crypto"
import { basename, dirname, join } from "node:path"
import { openDocument } from "./document"
import { createBuiltins } from "./plugins/builtins"
import { createChrome, STATUS_MESSAGE_DURATION_MS, type ChromePlugin } from "./plugins/chrome"
import type { EditorSlotName } from "./plugins/editor-slots"
import {
  DisposableStore,
  PluginHost,
  type BuiltinPlugin,
  type EditorPluginContext,
} from "./plugins/host"
import { createOpenTuiCommands } from "./plugins/opentui-commands"

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

interface EditorSessionDependencies {
  createRenderer(): Promise<CliRenderer>
  now?(): number
  plugins?: readonly BuiltinPlugin<EditorPluginContext>[]
}

export type EditorSessionResult = { kind: "closed" } | { kind: "aborted"; reason: unknown }
export type EditorSessionRequest = Readonly<
  | { kind: "file"; filePath: string; workspaceRoot?: never; signal: AbortSignal }
  | { kind: "folder"; workspaceRoot: string; filePath?: string; signal: AbortSignal }
>

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

export async function runEditorSession(
  request: EditorSessionRequest,
  dependencies: EditorSessionDependencies = {
    createRenderer: () => createCliRenderer({ exitOnCtrlC: false }),
  },
): Promise<EditorSessionResult> {
  const workspaceRoot = request.kind === "folder" ? request.workspaceRoot : dirname(request.filePath)
  let hasOpenDocument = request.filePath !== undefined
  const document = openDocument(request.filePath ?? join(workspaceRoot, `.likho-no-file-${randomUUID()}`))
  if (request.signal.aborted) return { kind: "aborted", reason: request.signal.reason }

  const renderer = await dependencies.createRenderer()
  const lifetime = new AbortController()
  const resources = new DisposableStore()
  let pluginHost: PluginHost<EditorPluginContext> | undefined
  let ready = false
  let closing = false
  try {
    const syntaxStyle = SyntaxStyle.fromStyles(DARK_PLUS_STYLES)
    resources.add(() => syntaxStyle.destroy())
    let openArmed: Readonly<{ path: string; version: number; expiresAt: number }> | undefined
    let finish!: (result: EditorSessionResult) => void
    const finished = new Promise<EditorSessionResult>((resolve) => {
      finish = (result) => {
        if (closing) return
        closing = true
        ready = false
        lifetime.abort(result)
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

    let chrome!: ChromePlugin
    let changePending = false
    let replacingDocument = false
    let suppressDocumentChange = false
    const flushDocumentChange = () => {
      if (!changePending) return
      changePending = false
      if (closing) return
      document.markChanged()
      openArmed = undefined
      if (ready) chrome.clearMessage()
    }
    const queueDocumentChange = () => {
      if (closing || changePending) return
      changePending = true
      queueMicrotask(flushDocumentChange)
    }

    const editor = new TextareaRenderable(renderer, {
      initialValue: document.persistedText,
      placeholder: hasOpenDocument ? undefined : "Open a file from Explorer",
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
        if (suppressDocumentChange) {
          suppressDocumentChange = false
          return
        }
        if (!ready || replacingDocument) return
        queueDocumentChange()
      },
    })
    editor.focusable = hasOpenDocument
    chrome = createChrome({
      editor,
      title,
      status,
      documentTitle: (path) => (hasOpenDocument ? basename(path) : "No file open"),
    })

    const uiSlots = createCoreSlotRegistry<EditorSlotName, object, object>(renderer, {})
    const primarySidebar = new SlotRenderable(renderer, {
      registry: uiSlots,
      name: "primary-sidebar",
      mode: "single_winner",
      width: 0,
      height: "100%",
      flexShrink: 0,
      visible: false,
    })
    primarySidebar.focusable = true
    const editorFrame = new SlotRenderable(renderer, {
      registry: uiSlots,
      name: "editor-frame",
      mode: "single_winner",
      fallback: editor,
      flexGrow: 1,
      minWidth: 0,
      height: "100%",
    })
    const editorPanel = new BoxRenderable(renderer, { width: "100%", flexGrow: 1, flexDirection: "row" })
    editorPanel.add(primarySidebar)
    editorPanel.add(editorFrame)
    root.add(titleBar)
    root.add(editorPanel)
    root.add(statusBar)

    const keymap = createOpenTuiKeymap(renderer)
    resources.add(registerDefaultKeys(keymap))
    resources.add(registerModBindings(keymap))
    resources.add(registerMetadataFields(keymap))
    resources.add(registerManagedTextareaLayer(keymap, renderer, {}))
    const commands = createOpenTuiCommands(keymap, editor)

    const report = (nextMessage: string) => {
      chrome.report(nextMessage)
    }
    const captureText = () => {
      if (closing || lifetime.signal.aborted) throw new Error("Editor is closing")
      if (!hasOpenDocument) throw new Error("No file open")
      flushDocumentChange()
      const text = editor.plainText
      document.validateText(text)
      return { text, version: document.snapshot.version }
    }
    const save = () => {
      if (closing) return
      if (!hasOpenDocument) {
        report("No file open")
        return
      }
      try {
        const captured = captureText()
        document.save(captured.text)
        openArmed = undefined
      } catch (error) {
        report(error instanceof Error ? error.message : String(error))
      }
    }
    const copy = (cut: boolean) => {
      if (closing) return
      if (!hasOpenDocument) {
        report("No file open")
        return
      }
      try {
        const captured = captureText()
        const selected = editor.getSelectedText()
        const line = captured.text.split("\n")[editor.logicalCursor.row] ?? ""
        if (!renderer.copyToClipboardOSC52(selected || `${line}\n`)) {
          report("Clipboard unavailable; nothing was cut")
        } else if (cut) {
          selected ? editor.deleteSelection() : editor.deleteLine()
        }
      } catch (error) {
        report(error instanceof Error ? error.message : String(error))
      }
    }
    const requestClose = () => {
      if (closing) return true
      flushDocumentChange()
      if (document.snapshot.dirty) return false
      finish({ kind: "closed" })
      return true
    }
    const discardAndClose = () => finish({ kind: "closed" })
    const requestOpenFile = (path: string) => {
      if (closing) return false
      flushDocumentChange()
      const snapshot = document.snapshot
      if (path === snapshot.path) return true
      const now = dependencies.now?.() ?? Date.now()
      const confirmationIsCurrent =
        openArmed?.path === path && openArmed.version === snapshot.version && now < openArmed.expiresAt
      if (snapshot.dirty && !confirmationIsCurrent) {
        openArmed = { path, version: snapshot.version, expiresAt: now + STATUS_MESSAGE_DURATION_MS }
        report("Unsaved changes — press Enter again to discard")
        return false
      }
      const previouslyOpen = hasOpenDocument
      try {
        replacingDocument = true
        hasOpenDocument = true
        document.open(path, (text) => {
          editor.focusable = true
          editor.placeholder = null
          suppressDocumentChange = true
          editor.setText(text)
          editor.setCursor(0, 0)
          queueMicrotask(() => {
            suppressDocumentChange = false
          })
        })
        openArmed = undefined
        return true
      } catch (error) {
        hasOpenDocument = previouslyOpen
        editor.focusable = hasOpenDocument
        if (!hasOpenDocument) editor.placeholder = "Open a file from Explorer"
        report(error instanceof Error ? error.message : String(error))
        return false
      } finally {
        replacingDocument = false
      }
    }
    const getVisibleLineRange = () => {
      const viewport = editor.editorView.getViewport()
      const start = Math.max(0, Math.floor(viewport.offsetY))
      return { start, end: Math.max(start, Math.ceil(viewport.offsetY + viewport.height)) }
    }

    pluginHost = new PluginHost<EditorPluginContext>(
      {
        signal: lifetime.signal,
        document,
        commands,
        actions: {
          hasOpenDocument: () => hasOpenDocument,
          captureText,
          save,
          copy: () => copy(false),
          cut: () => copy(true),
          insertTab: () => {
            if (!closing && hasOpenDocument) editor.insertText("\t")
          },
          applyText: (expectedVersion, text) => {
            if (!hasOpenDocument || closing || lifetime.signal.aborted || document.snapshot.version !== expectedVersion)
              return false
            document.validateText(text)
            editor.replaceText(text)
            queueDocumentChange()
            flushDocumentChange()
            return true
          },
          cancelOpenFileRequest: () => {
            openArmed = undefined
          },
          requestOpenFile,
          requestClose,
          discardAndClose,
        },
        syntax: {
          bufferId: editor.editBuffer.id,
          getVisibleLineRange,
          onVisibleLineRangeChange(listener) {
            let previous = getVisibleLineRange()
            const onFrame = () => {
              const next = getVisibleLineRange()
              if (next.start === previous.start && next.end === previous.end) return
              previous = next
              listener(next)
            }
            renderer.on(CliRenderEvents.FRAME, onFrame)
            return {
              dispose() {
                renderer.off(CliRenderEvents.FRAME, onFrame)
              },
            }
          },
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

    const onAbort = () => finish({ kind: "aborted", reason: request.signal.reason })
    request.signal.addEventListener("abort", onAbort, { once: true })
    resources.add(() => request.signal.removeEventListener("abort", onAbort))
    if (request.signal.aborted) onAbort()

    const plugins =
      dependencies.plugins ??
      createBuiltins({
        chrome: chrome.plugin,
        closeConfirmation: { renderer, root, editor },
        lineNumbers: { renderer, editor, slots: uiSlots },
        fileExplorer: request.kind === "folder"
          ? {
              renderer,
              editor,
              slots: uiSlots,
              sidebarSlot: primarySidebar,
              workspaceRoot,
              focusOnActivate: request.filePath === undefined,
            }
          : undefined,
        quickInput: { renderer, root, editor, workspaceRoot },
      })
    await pluginHost.activate(plugins, lifetime.signal)
    if (closing || lifetime.signal.aborted) return await finished
    renderer.root.add(root)
    ready = true
    if (hasOpenDocument) editor.focus()
    if (request.signal.aborted) onAbort()
    return await finished
  } finally {
    closing = true
    ready = false
    if (!lifetime.signal.aborted) lifetime.abort({ kind: "disposed" })
    let cleanupError: unknown
    try {
      await pluginHost?.dispose()
    } catch (error) {
      cleanupError = error
    }
    try {
      await resources.dispose()
    } catch (error) {
      cleanupError ??= error
    }
    try {
      renderer.destroy()
    } catch (error) {
      cleanupError ??= error
    }
    if (cleanupError) throw cleanupError
  }
}
