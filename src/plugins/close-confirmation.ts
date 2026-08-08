import { BoxRenderable, TextRenderable, type CliRenderer, type Renderable, type TextareaRenderable } from "@opentui/core"
import { basename } from "node:path"
import type { BuiltinPlugin, EditorPluginContext } from "./host"

const CHOICES = ["Save", "Don't Save", "Cancel"] as const

export interface CloseConfirmationDependencies {
  readonly renderer: CliRenderer
  readonly root: BoxRenderable
  readonly editor: TextareaRenderable
}

export function createCloseConfirmation({
  renderer,
  root,
  editor,
}: CloseConfirmationDependencies): BuiltinPlugin<EditorPluginContext> {
  return {
    id: "builtin.close-confirmation",
    activate(context) {
      let selectedIndex = 0
      let previousFocus: Renderable | null = null

      const overlay = new BoxRenderable(renderer, {
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        zIndex: 200,
        visible: false,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#181818",
        onMouseDown(event) {
          event.stopPropagation()
          hide()
        },
      })
      overlay.focusable = true

      const panel = new BoxRenderable(renderer, {
        width: "70%",
        maxWidth: 64,
        minWidth: 36,
        height: 9,
        flexDirection: "column",
        border: true,
        borderColor: "#454545",
        backgroundColor: "#252526",
        padding: 1,
        onMouseDown(event) {
          event.stopPropagation()
        },
      })
      const title = new TextRenderable(renderer, { width: "100%", height: 1, fg: "#ffffff", truncate: true })
      const detail = new TextRenderable(renderer, {
        width: "100%",
        height: 2,
        fg: "#cccccc",
        wrapMode: "word",
      })
      const buttonRow = new BoxRenderable(renderer, {
        width: "100%",
        height: 1,
        flexDirection: "row",
        justifyContent: "center",
        gap: 2,
      })
      const buttons = CHOICES.map((choice, index) => {
        const text = new TextRenderable(renderer, { height: 1, fg: "#cccccc" })
        const button = new BoxRenderable(renderer, {
          height: 1,
          onMouseDown(event) {
            event.stopPropagation()
            selectedIndex = index
            render()
            choose()
          },
        })
        button.add(text)
        buttonRow.add(button)
        return { button, text }
      })
      const hint = new TextRenderable(renderer, {
        width: "100%",
        height: 1,
        fg: "#858585",
        content: "←→ choose   Enter confirm   Esc cancel",
      })
      panel.add(title)
      panel.add(detail)
      panel.add(buttonRow)
      panel.add(hint)
      overlay.add(panel)
      root.add(overlay)

      const render = () => {
        const fileName = basename(context.document.snapshot.path)
        title.content = `Do you want to save the changes to ${fileName}?`
        detail.content = "Your changes will be lost if you don't save them."
        buttons.forEach(({ button, text }, index) => {
          text.content = index === selectedIndex ? `[ ${CHOICES[index]} ]` : `  ${CHOICES[index]}  `
          text.fg = index === selectedIndex ? "#ffffff" : "#cccccc"
          button.backgroundColor = index === selectedIndex ? "#094771" : "#252526"
        })
      }
      const hide = () => {
        if (!overlay.visible) return
        overlay.visible = false
        const restore = previousFocus
        previousFocus = null
        const focusTarget = restore ?? editor
        focusTarget.focus()
      }
      const choose = () => {
        if (!overlay.visible) return
        if (selectedIndex === 0) {
          context.actions.save()
          if (!context.document.snapshot.dirty) {
            overlay.visible = false
            context.actions.requestClose()
          } else {
            hide()
          }
          return
        }
        if (selectedIndex === 1) {
          overlay.visible = false
          context.actions.discardAndClose()
          return
        }
        hide()
      }
      const show = () => {
        if (overlay.visible) return
        previousFocus = renderer.currentFocusedRenderable
        selectedIndex = 0
        render()
        overlay.visible = true
        overlay.focus()
      }

      context.subscriptions.add(
        context.commands.captureKeyInputWhile(
          () => overlay.visible,
          ["left", "shift+tab", "right", "tab", "return", "enter", "escape"],
        ),
      )
      context.subscriptions.add(
        context.commands.registerCommand({
          id: "window.close",
          title: "Close Editor",
          run: () => {
            if (!context.actions.requestClose()) show()
          },
        }),
      )
      const internalCommands = [
        { id: "closeConfirmation.previous", run: () => ((selectedIndex = (selectedIndex + 2) % 3), render()) },
        { id: "closeConfirmation.next", run: () => ((selectedIndex = (selectedIndex + 1) % 3), render()) },
        { id: "closeConfirmation.accept", run: choose },
        { id: "closeConfirmation.cancel", run: hide },
      ] as const
      for (const command of internalCommands) {
        context.subscriptions.add(
          context.commands.registerCommand({ ...command, title: command.id, palette: false }),
        )
      }
      context.subscriptions.add(
        context.commands.registerBindings(
          [
            { key: "left", command: "closeConfirmation.previous" },
            { key: "shift+tab", command: "closeConfirmation.previous" },
            { key: "right", command: "closeConfirmation.next" },
            { key: "tab", command: "closeConfirmation.next" },
            { key: "return", command: "closeConfirmation.accept" },
            { key: "enter", command: "closeConfirmation.accept" },
            { key: "escape", command: "closeConfirmation.cancel" },
          ],
          { scope: { target: overlay, mode: "focus", priority: 2_000 } },
        ),
      )
      context.subscriptions.add(() => {
        overlay.visible = false
        root.remove(overlay)
        overlay.destroyRecursively()
      })
    },
  }
}
