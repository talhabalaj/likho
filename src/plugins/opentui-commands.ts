import type { Keymap } from "@opentui/keymap"
import type { KeyEvent, Renderable, TextareaRenderable } from "@opentui/core"
import type { CommandContributions } from "./host"

export function createOpenTuiCommands(
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
