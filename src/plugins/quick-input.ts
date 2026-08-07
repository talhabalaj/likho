import {
  BoxRenderable,
  InputRenderable,
  StyledText,
  TextRenderable,
  fg,
  type CliRenderer,
  type TextChunk,
  type TextareaRenderable,
} from "@opentui/core"
import { createFuzzyMatcher, type FuzzyMatcher, type MatchRange } from "../fuzzy-matcher"
import { QuickInput, type QuickInputItem, type QuickInputProvider, type QuickInputSnapshot } from "../quick-input"
import { discoverWorkspaceFiles, type WorkspaceFile } from "../workspace-files"
import type { BuiltinPlugin, CommandContributions, EditorPluginContext } from "./host"

const VISIBLE_RESULTS = 10

export interface QuickInputPluginDependencies {
  readonly renderer: CliRenderer
  readonly root: BoxRenderable
  readonly editor: TextareaRenderable
  readonly workspaceRoot: string
}

interface CommandChoice {
  readonly id: string
  readonly title: string
  readonly detail: string
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function commandProvider(commands: CommandContributions): QuickInputProvider {
  let choices: readonly CommandChoice[] = []
  let matcher: FuzzyMatcher<CommandChoice> | undefined
  return {
    prepare() {
      choices = commands
        .listCommands()
        .map(({ id, title, keybinding }) => ({ id, title, detail: keybinding ?? id }))
        .sort((left, right) => compareText(left.title, right.title) || compareText(left.id, right.id))
      matcher = createFuzzyMatcher(choices, [
        { name: "title", weight: 0.75 },
        { name: "id", weight: 0.25 },
      ])
    },
    search(query) {
      return (matcher?.search(query, 100) ?? []).map(({ item, matches }) => ({
        id: item.id,
        label: item.title,
        description: item.detail,
        matches: matches.map((match) => ({ ...match, field: match.field === "title" ? "label" : "description" })),
        closeBeforeAccept: true,
        accept: () => commands.executeCommand(item.id),
      }))
    },
  }
}

function fileProvider(
  workspaceRoot: string,
  requestOpenFile: EditorPluginContext["actions"]["requestOpenFile"],
): QuickInputProvider {
  let files: readonly WorkspaceFile[] = []
  let matcher: FuzzyMatcher<WorkspaceFile> | undefined
  return {
    async prepare(signal) {
      files = await discoverWorkspaceFiles(workspaceRoot, signal)
      matcher = createFuzzyMatcher(files, [
        { name: "baseName", weight: 0.7 },
        { name: "relativePath", weight: 0.3 },
      ])
    },
    search(query) {
      return (matcher?.search(query, 100) ?? []).map(({ item, matches }) => ({
        id: item.id,
        label: item.baseName,
        description: item.relativePath === item.baseName ? undefined : item.relativePath,
        matches: matches.map((match) => ({
          ...match,
          field: match.field === "baseName" ? "label" : "description",
        })),
        accept: () => requestOpenFile(item.absolutePath),
      }))
    },
  }
}

function appendHighlighted(
  chunks: TextChunk[],
  text: string,
  ranges: readonly MatchRange[],
  normalColor: string,
): void {
  let offset = 0
  for (const range of ranges) {
    if (range.end <= offset) continue
    const start = Math.max(offset, range.start)
    if (start > offset) chunks.push(fg(normalColor)(text.slice(offset, start)))
    chunks.push(fg("#ffffff")(text.slice(start, range.end)))
    offset = Math.max(offset, range.end)
  }
  if (offset < text.length) chunks.push(fg(normalColor)(text.slice(offset)))
}

function styledItem(item: QuickInputItem, selected: boolean): StyledText {
  const matches = item.matches ?? []
  const chunks: TextChunk[] = []
  appendHighlighted(
    chunks,
    item.label,
    matches.filter(({ field }) => field === "label").sort((left, right) => left.start - right.start),
    selected ? "#ffffff" : "#cccccc",
  )
  if (item.description) {
    chunks.push(fg(selected ? "#d7d7d7" : "#858585")("  "))
    appendHighlighted(
      chunks,
      item.description,
      matches.filter(({ field }) => field === "description").sort((left, right) => left.start - right.start),
      selected ? "#d7d7d7" : "#858585",
    )
  }
  return new StyledText(chunks)
}

export function createQuickInput({
  renderer,
  root,
  editor,
  workspaceRoot,
}: QuickInputPluginDependencies): BuiltinPlugin<EditorPluginContext> {
  return {
    id: "builtin.quick-input",
    activate(context) {
      const quickInput = new QuickInput({
        files: fileProvider(workspaceRoot, context.actions.requestOpenFile),
        commands: commandProvider(context.commands),
      })
      let syncingInput = false
      let disposing = false
      let visibleIndices = Array.from<number | undefined>({ length: VISIBLE_RESULTS })

      const overlay = new BoxRenderable(renderer, {
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        zIndex: 100,
        visible: false,
        onMouseDown(event) {
          event.stopPropagation()
          quickInput.close()
        },
        onMouseScroll(event) {
          event.stopPropagation()
          if (event.scroll?.direction === "up") quickInput.move(-3)
          if (event.scroll?.direction === "down") quickInput.move(3)
        },
      })
      const panel = new BoxRenderable(renderer, {
        position: "absolute",
        top: 1,
        left: "15%",
        width: "70%",
        height: 16,
        zIndex: 101,
        flexDirection: "column",
        backgroundColor: "#252526",
        border: true,
        borderColor: "#454545",
        padding: 1,
        onMouseDown(event) {
          event.stopPropagation()
        },
        onMouseScroll(event) {
          event.stopPropagation()
          if (event.scroll?.direction === "up") quickInput.move(-3)
          if (event.scroll?.direction === "down") quickInput.move(3)
        },
      })
      const input = new InputRenderable(renderer, {
        id: "quick-input",
        width: "100%",
        value: "",
        flexShrink: 0,
        placeholder: "Search files by name",
        backgroundColor: "#3c3c3c",
        focusedBackgroundColor: "#3c3c3c",
        textColor: "#ffffff",
        focusedTextColor: "#ffffff",
        cursorColor: "#ffffff",
        onContentChange: () => {
          if (!syncingInput) void quickInput.setValue(input.value)
        },
        onSubmit: () => {
          void quickInput.accept()
        },
        onKeyDown: (key) => {
          const movements: Readonly<Record<string, number>> = {
            up: -1,
            down: 1,
            pageup: -VISIBLE_RESULTS,
            pagedown: VISIBLE_RESULTS,
          }
          if (key.name === "escape") {
            key.preventDefault()
            key.stopPropagation()
            quickInput.close()
          } else if (key.name in movements) {
            key.preventDefault()
            key.stopPropagation()
            quickInput.move(movements[key.name]!)
          }
        },
      })
      const rows = Array.from({ length: VISIBLE_RESULTS }, (_, rowIndex) => {
        const text = new TextRenderable(renderer, {
          width: "100%",
          height: 1,
          flexShrink: 0,
          truncate: true,
          fg: "#cccccc",
        })
        const row = new BoxRenderable(renderer, {
          width: "100%",
          height: 1,
          flexShrink: 0,
          backgroundColor: "#252526",
          onMouseDown(event) {
            event.stopPropagation()
            const itemIndex = visibleIndices[rowIndex]
            if (itemIndex === undefined) return
            quickInput.select(itemIndex)
            void quickInput.accept(itemIndex)
          },
        })
        row.add(text)
        panel.add(row)
        return { row, text }
      })
      const footer = new TextRenderable(renderer, {
        width: "100%",
        height: 1,
        flexShrink: 0,
        fg: "#858585",
        truncate: true,
      })
      panel.add(input, 0)
      panel.add(footer)
      overlay.add(panel)
      root.add(overlay)

      const render = (snapshot: QuickInputSnapshot) => {
        context.actions.cancelOpenFileRequest()
        overlay.visible = snapshot.open
        if (!snapshot.open) {
          if (!disposing) editor.focus()
          return
        }
        syncingInput = true
        if (input.value !== snapshot.value) input.value = snapshot.value
        input.placeholder = snapshot.mode === "commands" ? "Type a command" : "Search files by name"
        syncingInput = false
        const start = Math.max(0, Math.min(snapshot.selectedIndex, snapshot.items.length - VISIBLE_RESULTS))
        visibleIndices = visibleIndices.map((_, index) => {
          const itemIndex = start + index
          return itemIndex < snapshot.items.length ? itemIndex : undefined
        })
        rows.forEach(({ row, text }, index) => {
          const itemIndex = visibleIndices[index]
          const item = itemIndex === undefined ? undefined : snapshot.items[itemIndex]
          row.visible = item !== undefined
          if (!item) return
          const selected = itemIndex === snapshot.selectedIndex
          row.backgroundColor = selected ? "#094771" : "#252526"
          text.content = styledItem(item, selected)
        })
        footer.content = snapshot.error
          ? ` ${snapshot.error}`
          : snapshot.loading
            ? " Loading…"
            : ` ${snapshot.items.length} result${snapshot.items.length === 1 ? "" : "s"}   ↑↓ navigate   Enter open   Esc close`
        input.focus()
      }

      context.subscriptions.add(quickInput.onDidChange(render))
      const open = (mode: "files" | "commands") => {
        void quickInput.open(mode)
      }
      context.subscriptions.add(
        context.commands.registerCommand({ id: "workbench.action.quickOpen", title: "Go to File…", run: () => open("files") }),
      )
      context.subscriptions.add(
        context.commands.registerCommand({
          id: "workbench.action.showCommands",
          title: "Show All Commands",
          run: () => open("commands"),
        }),
      )
      context.subscriptions.add(
        context.commands.registerBindings(
          [
            { key: "mod+p", command: "workbench.action.quickOpen" },
            { key: "mod+shift+p", command: "workbench.action.showCommands" },
          ],
          { scope: "global" },
        ),
      )
      const internalCommands = [
        { id: "quickInput.close", run: () => quickInput.close() },
        { id: "quickInput.previous", run: () => quickInput.move(-1) },
        { id: "quickInput.next", run: () => quickInput.move(1) },
        { id: "quickInput.previousPage", run: () => quickInput.move(-VISIBLE_RESULTS) },
        { id: "quickInput.nextPage", run: () => quickInput.move(VISIBLE_RESULTS) },
        {
          id: "quickInput.accept",
          run: () => {
            void quickInput.accept()
          },
        },
      ] as const
      for (const command of internalCommands) {
        context.subscriptions.add(
          context.commands.registerCommand({ ...command, title: command.id, palette: false }),
        )
      }
      context.subscriptions.add(
        context.commands.registerBindings(
          [
            { key: "escape", command: "quickInput.close" },
            { key: "up", command: "quickInput.previous" },
            { key: "down", command: "quickInput.next" },
            { key: "pageup", command: "quickInput.previousPage" },
            { key: "pagedown", command: "quickInput.nextPage" },
            { key: "return", command: "quickInput.accept" },
            { key: "enter", command: "quickInput.accept" },
          ],
          { scope: { target: input, mode: "focus", priority: 1_000 } },
        ),
      )
      context.subscriptions.add(() => {
        disposing = true
        quickInput.dispose()
        overlay.visible = false
        root.remove(overlay)
        overlay.destroyRecursively()
      })
    },
  }
}
