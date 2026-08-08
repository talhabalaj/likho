import {
  BoxRenderable,
  CliRenderEvents,
  ScrollBoxRenderable,
  TextRenderable,
  registerCorePlugin,
  type CliRenderer,
  type TextareaRenderable,
} from "@opentui/core"
import { isAbsolute, relative, sep } from "node:path"
import { ExplorerTree, type ExplorerAction, type ExplorerEffect, type ExplorerSnapshot } from "../explorer-tree"
import { LocalFileSystemExplorerSource, type ExplorerSource } from "../explorer-source"
import type { EditorSlotRegistry, PrimarySidebarSlot } from "./editor-slots"
import type { BuiltinPlugin, EditorPluginContext } from "./host"

const DEFAULT_WIDTH = 28
const MIN_WIDTH = 20
const MIN_TERMINAL_WIDTH = 60

export interface FileExplorerPluginDependencies {
  readonly renderer: CliRenderer
  readonly editor: TextareaRenderable
  readonly slots: EditorSlotRegistry
  readonly sidebarSlot: PrimarySidebarSlot
  readonly workspaceRoot: string
  readonly source?: ExplorerSource
  readonly focusOnActivate?: boolean
}

function nodeIdForPath(workspaceRoot: string, path: string): string | undefined {
  const fromRoot = relative(workspaceRoot, path)
  if (!fromRoot || fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) return undefined
  return fromRoot.split(sep).join("/")
}

function rowText(row: ExplorerSnapshot["rows"][number]): string {
  const indentation = "  ".repeat(row.depth)
  const disclosure = row.kind === "directory" ? (row.expanded ? "⌄ " : "› ") : "  "
  const state = row.loading ? " …" : row.error ? " !" : ""
  return `${indentation}${disclosure}${row.name}${state}`
}

export function createFileExplorer({
  renderer,
  editor,
  slots,
  sidebarSlot,
  workspaceRoot,
  source = new LocalFileSystemExplorerSource(workspaceRoot),
  focusOnActivate = false,
}: FileExplorerPluginDependencies): BuiltinPlugin<EditorPluginContext> {
  return {
    id: "builtin.file-explorer",
    activate(context) {
      const tree = new ExplorerTree(source)
      context.subscriptions.add(tree)
      let pane: BoxRenderable | undefined
      let scrollBox: ScrollBoxRenderable | undefined
      let rowRenderables: Array<{ id: string; row: BoxRenderable; text: TextRenderable }> = []
      let userVisible = true
      let previousSelection: string | undefined
      let previousError: string | undefined
      let initialized: Promise<void> = Promise.resolve()
      let actionQueue: Promise<void> = Promise.resolve()

      const clearRows = () => {
        if (!scrollBox) return
        for (const { row } of rowRenderables) {
          scrollBox.remove(row)
          row.destroyRecursively()
        }
        rowRenderables = []
      }

      const run = (action: ExplorerAction): Promise<void> => {
        actionQueue = actionQueue
          .then(async () => {
            await initialized
            const effect: ExplorerEffect | undefined = await tree.dispatch(action)
            if (effect?.type === "open-file") context.actions.requestOpenFile(effect.path)
          })
          .catch((error) => context.report(`Explorer failed: ${error instanceof Error ? error.message : String(error)}`))
        return actionQueue
      }

      const render = (snapshot: ExplorerSnapshot) => {
        if (!scrollBox || !pane) return
        const canReuseRows =
          rowRenderables.length === snapshot.rows.length &&
          rowRenderables.every(({ id }, index) => id === snapshot.rows[index]?.id)
        if (!canReuseRows) {
          clearRows()
          for (const explorerRow of snapshot.rows) {
            const text = new TextRenderable(renderer, {
              width: "100%",
              height: 1,
              flexShrink: 0,
              truncate: true,
            })
            const row = new BoxRenderable(renderer, {
              id: `explorer-row:${explorerRow.id}`,
              width: "100%",
              height: 1,
              flexShrink: 0,
              onMouseDown(event) {
                event.stopPropagation()
                scrollBox?.focus()
                void run({ type: "select", id: explorerRow.id }).then(() => run({ type: "activate" }))
              },
            })
            row.add(text)
            scrollBox.add(row)
            rowRenderables.push({ id: explorerRow.id, row, text })
          }
        }
        snapshot.rows.forEach((explorerRow, index) => {
          const view = rowRenderables[index]
          if (!view) return
          view.text.content = rowText(explorerRow)
          view.text.fg =
            explorerRow.active || explorerRow.selected ? "#ffffff" : explorerRow.error ? "#f48771" : "#cccccc"
          view.row.backgroundColor = explorerRow.selected ? "#094771" : explorerRow.active ? "#37373d" : "#252526"
        })

        if (snapshot.selectedId) {
          const selectedRowId = `explorer-row:${snapshot.selectedId}`
          queueMicrotask(() => scrollBox?.scrollChildIntoView(selectedRowId))
        }
        if (snapshot.selectedId !== previousSelection) {
          previousSelection = snapshot.selectedId
          context.actions.cancelOpenFileRequest()
        }
        if (snapshot.error && snapshot.error !== previousError) context.report(`Explorer: ${snapshot.error}`)
        previousError = snapshot.error
      }

      const unregister = registerCorePlugin(slots, {
        id: "builtin.file-explorer",
        slots: {
          "primary-sidebar": {
            render: () => {
              pane = new BoxRenderable(renderer, {
                width: "100%",
                height: "100%",
                flexDirection: "column",
                backgroundColor: "#252526",
              })
              pane.add(
                new TextRenderable(renderer, {
                  width: "100%",
                  height: 1,
                  flexShrink: 0,
                  content: " EXPLORER",
                  fg: "#bbbbbb",
                }),
              )
              pane.add(
                new TextRenderable(renderer, {
                  width: "100%",
                  height: 1,
                  flexShrink: 0,
                  truncate: true,
                  content: ` ⌄ ${source.root.name.toUpperCase()}`,
                  fg: "#cccccc",
                }),
              )
              scrollBox = new ScrollBoxRenderable(renderer, {
                id: "file-explorer-tree",
                width: "100%",
                flexGrow: 1,
                backgroundColor: "#252526",
                viewportCulling: true,
                scrollX: false,
                scrollY: true,
              })
              pane.add(scrollBox)
              render(tree.snapshot)
              return pane
            },
            onDispose: () => {
              clearRows()
              pane?.destroyRecursively()
              pane = undefined
              scrollBox = undefined
            },
          },
        },
      })
      context.subscriptions.add({ dispose: unregister })

      if (!scrollBox) throw new Error("Explorer sidebar slot did not mount")

      const visibleWidth = () => Math.max(MIN_WIDTH, Math.min(DEFAULT_WIDTH, Math.floor(renderer.width * 0.35)))
      const focusEditorOrWorkbench = () => (editor.focusable ? editor : sidebarSlot).focus()
      const applyVisibility = () => {
        const visible = userVisible && renderer.width >= MIN_TERMINAL_WIDTH
        sidebarSlot.visible = visible
        sidebarSlot.width = visible ? visibleWidth() : 0
        if (!visible && scrollBox?.focused) focusEditorOrWorkbench()
      }
      const showOrToggleFocus = () => {
        if (sidebarSlot.visible && scrollBox?.focused) {
          focusEditorOrWorkbench()
          return
        }
        userVisible = true
        applyVisibility()
        if (sidebarSlot.visible) scrollBox?.focus()
        else context.report("Explorer hidden: terminal is too narrow")
      }
      const toggleVisibility = () => {
        userVisible = !userVisible
        applyVisibility()
        if (sidebarSlot.visible) scrollBox?.focus()
      }
      applyVisibility()

      context.subscriptions.add(tree.subscribe(render))
      context.subscriptions.add(
        context.commands.registerCommand({
          id: "workbench.view.explorer",
          title: "Show Explorer / Toggle Focus",
          run: showOrToggleFocus,
        }),
      )
      context.subscriptions.add(
        context.commands.registerCommand({
          id: "workbench.action.toggleSidebarVisibility",
          title: "Toggle Primary Side Bar Visibility",
          run: toggleVisibility,
        }),
      )
      context.subscriptions.add(
        context.commands.registerCommand({
          id: "workbench.files.action.refreshFilesExplorer",
          title: "Refresh Explorer",
          run: () => run({ type: "refresh" }),
        }),
      )
      context.subscriptions.add(
        context.commands.registerBindings(
          [
            { key: "mod+shift+e", command: "workbench.view.explorer" },
            { key: "mod+b", command: "workbench.action.toggleSidebarVisibility" },
          ],
          { scope: "global" },
        ),
      )

      const internalCommands = [
        { id: "fileExplorer.previous", run: () => run({ type: "move", delta: -1 }) },
        { id: "fileExplorer.next", run: () => run({ type: "move", delta: 1 }) },
        {
          id: "fileExplorer.previousPage",
          run: () => run({ type: "move", delta: -Math.max(1, scrollBox?.viewport.height ?? 1) }),
        },
        {
          id: "fileExplorer.nextPage",
          run: () => run({ type: "move", delta: Math.max(1, scrollBox?.viewport.height ?? 1) }),
        },
        { id: "fileExplorer.home", run: () => run({ type: "move", delta: -tree.snapshot.rows.length }) },
        { id: "fileExplorer.end", run: () => run({ type: "move", delta: tree.snapshot.rows.length }) },
        { id: "fileExplorer.left", run: () => run({ type: "left" }) },
        { id: "fileExplorer.right", run: () => run({ type: "right" }) },
        { id: "fileExplorer.activate", run: () => run({ type: "activate" }) },
        { id: "fileExplorer.focusEditor", run: focusEditorOrWorkbench },
      ] as const
      for (const command of internalCommands) {
        context.subscriptions.add(context.commands.registerCommand({ ...command, title: command.id, palette: false }))
      }
      context.subscriptions.add(
        context.commands.registerBindings(
          [
            { key: "up", command: "fileExplorer.previous" },
            { key: "down", command: "fileExplorer.next" },
            { key: "pageup", command: "fileExplorer.previousPage" },
            { key: "pagedown", command: "fileExplorer.nextPage" },
            { key: "home", command: "fileExplorer.home" },
            { key: "end", command: "fileExplorer.end" },
            { key: "left", command: "fileExplorer.left" },
            { key: "right", command: "fileExplorer.right" },
            { key: "return", command: "fileExplorer.activate" },
            { key: "enter", command: "fileExplorer.activate" },
            { key: "escape", command: "fileExplorer.focusEditor" },
          ],
          { scope: { target: scrollBox, mode: "focus", priority: 1_000 } },
        ),
      )

      let documentPath = context.document.snapshot.path
      const revealDocument = () => run({ type: "reveal", id: nodeIdForPath(workspaceRoot, documentPath) })
      context.subscriptions.add(
        context.document.onDidChange(
          (snapshot) => {
            if (snapshot.path === documentPath) return
            documentPath = snapshot.path
            void revealDocument()
          },
          (error) => context.report(`Explorer failed: ${error instanceof Error ? error.message : String(error)}`),
        ),
      )
      const onResize = () => applyVisibility()
      renderer.on(CliRenderEvents.RESIZE, onResize)
      context.subscriptions.add(() => {
        renderer.off(CliRenderEvents.RESIZE, onResize)
      })
      context.subscriptions.add(() => {
        if (scrollBox?.focused) focusEditorOrWorkbench()
        sidebarSlot.visible = false
        sidebarSlot.width = 0
      })

      initialized = (async () => {
        await tree.dispatch({ type: "initialize" })
        await tree.dispatch({ type: "reveal", id: nodeIdForPath(workspaceRoot, documentPath) })
        if (focusOnActivate && sidebarSlot.visible) scrollBox?.focus()
      })()
    },
  }
}
