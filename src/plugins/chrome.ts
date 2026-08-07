import type { TextareaRenderable, TextRenderable } from "@opentui/core"
import { basename } from "node:path"
import type { BuiltinPlugin, EditorPluginContext } from "./host"

export interface ChromePluginDependencies {
  readonly editor: TextareaRenderable
  readonly title: TextRenderable
  readonly status: TextRenderable
}

export interface ChromePlugin {
  readonly plugin: BuiltinPlugin<EditorPluginContext>
  report(message: string): void
  clearMessage(): void
}

export function createChrome({ editor, title, status }: ChromePluginDependencies): ChromePlugin {
  let message = ""
  let update: (() => void) | undefined

  const refresh = () => update?.()
  return {
    plugin: {
      id: "builtin.chrome",
      activate(context) {
        update = () => {
          const cursor = editor.logicalCursor
          const snapshot = context.document.snapshot
          const shortcutPrefix = context.commands.platform === "macos" ? "⌘" : "Ctrl+"
          title.content = ` ${basename(snapshot.path)}${snapshot.dirty ? " •" : ""} — editor`
          status.content =
            message ||
            ` Ln ${cursor.row + 1}, Col ${cursor.col + 1}   UTF-8   ${shortcutPrefix}S Save   Ctrl+Q Quit`
        }

        const previousCursorHandler = editor.onCursorChange
        editor.onCursorChange = update
        context.subscriptions.add(() => {
          if (editor.onCursorChange === update) editor.onCursorChange = previousCursorHandler
          update = undefined
        })
        context.subscriptions.add(
          context.document.onDidChange(
            refresh,
            (error) => context.report(`Chrome failed: ${error instanceof Error ? error.message : String(error)}`),
          ),
        )
        refresh()
      },
    },
    report(nextMessage) {
      message = ` ${nextMessage}`
      refresh()
    },
    clearMessage() {
      if (!message) return
      message = ""
      refresh()
    },
  }
}
