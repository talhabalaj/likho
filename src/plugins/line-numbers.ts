import { LineNumberRenderable, registerCorePlugin, type CliRenderer, type TextareaRenderable } from "@opentui/core"
import type { BuiltinPlugin, EditorPluginContext } from "./host"
import type { EditorSlotRegistry } from "./editor-slots"

export interface LineNumberPluginDependencies {
  readonly renderer: CliRenderer
  readonly editor: TextareaRenderable
  readonly slots: EditorSlotRegistry
}

export function createLineNumbers({
  renderer,
  editor,
  slots,
}: LineNumberPluginDependencies): BuiltinPlugin<EditorPluginContext> {
  return {
    id: "builtin.line-numbers",
    activate(context) {
      let frame: LineNumberRenderable | undefined
      // OpenTUI sizes the gutter from visible lines; this unreachable entry supplies the real maximum.
      const lineNumbers = new Map<number, number>([[-1, editor.lineCount]])
      const unregister = registerCorePlugin(slots, {
        id: "builtin.line-numbers",
        slots: {
          "editor-frame": {
            render: () => {
              frame = new LineNumberRenderable(renderer, {
                target: editor,
                lineNumbers,
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
              return frame
            },
            onDispose: () => {
              frame?.clearTarget()
              frame?.destroyRecursively()
              frame = undefined
            },
          },
        },
      })
      context.subscriptions.add({ dispose: unregister })
      context.subscriptions.add(
        context.document.onDidChange(
          () => {
            lineNumbers.set(-1, editor.lineCount)
            frame?.setLineNumbers(lineNumbers)
          },
          (error) => context.report(`Line numbers failed: ${error instanceof Error ? error.message : String(error)}`),
        ),
      )
    },
  }
}
