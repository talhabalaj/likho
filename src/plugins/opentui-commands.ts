import type { ActiveBinding, Keymap } from "@opentui/keymap"
import type { KeyEvent, Renderable, TextareaRenderable } from "@opentui/core"
import type { CommandContributions } from "./host"

function formatBindings(
  bindings: readonly ActiveBinding<Renderable, KeyEvent>[] | undefined,
  platform: CommandContributions["platform"],
): string | undefined {
  if (!bindings?.length) return undefined
  const formatted = bindings.map(({ sequence }) =>
    sequence
      .map(({ stroke }) => {
        const key = stroke.name === "return" ? "Enter" : stroke.name.length === 1 ? stroke.name.toUpperCase() : stroke.name
        if (platform === "macos") {
          return `${stroke.ctrl ? "⌃" : ""}${stroke.shift ? "⇧" : ""}${stroke.meta ? "⌥" : ""}${stroke.super ? "⌘" : ""}${key}`
        }
        return [
          stroke.ctrl ? "Ctrl" : undefined,
          stroke.shift ? "Shift" : undefined,
          stroke.meta ? "Alt" : undefined,
          stroke.super ? "Super" : undefined,
          key,
        ]
          .filter(Boolean)
          .join("+")
      })
      .join(" "),
  )
  return [...new Set(formatted)].join(", ")
}

export function createOpenTuiCommands(
  keymap: Keymap<Renderable, KeyEvent>,
  editor: TextareaRenderable,
): CommandContributions {
  const commands = new Map<string, Readonly<{ id: string; title: string; palette: boolean }>>()
  const platform = keymap.getHostMetadata().platform

  return {
    platform,
    registerCommand(command) {
      if (commands.has(command.id)) throw new Error(`Duplicate command ID "${command.id}"`)
      commands.set(command.id, { id: command.id, title: command.title, palette: command.palette !== false })
      const unregister = keymap.registerLayer({
        commands: [{ name: command.id, title: command.title, run: command.run }],
      })
      return {
        dispose() {
          unregister()
          commands.delete(command.id)
        },
      }
    },
    registerBindings(bindings, options = {}) {
      const global = options.scope === "global"
      const focused = typeof options.scope === "object" ? options.scope : undefined
      const unregister = keymap.registerLayer({
        ...(global
          ? {}
          : focused
            ? { target: focused.target as Renderable, targetMode: focused.mode ?? ("focus" as const) }
            : { target: editor, targetMode: "focus" as const }),
        priority: focused?.priority ?? 100,
        bindings: bindings.map(({ key, command }) => ({ key, cmd: command })),
      })
      return { dispose: unregister }
    },
    captureKeyInputWhile(active, allowedKeys) {
      const matchers = allowedKeys.map((key) => keymap.createKeyMatcher(key))
      const unregister = keymap.intercept(
        "key",
        ({ event, consume }) => {
          if (!active() || matchers.some((matches) => matches(event))) return
          consume({ preventDefault: true, stopPropagation: true })
        },
        { priority: 10_000 },
      )
      return { dispose: unregister }
    },
    listCommands() {
      const contributed = [...commands.values()].filter(({ palette }) => palette)
      const bindings = keymap.getCommandBindings({
        commands: contributed.map(({ id }) => id),
        visibility: "registered",
      })
      return contributed.map((command) => {
        const keybinding = formatBindings(bindings.get(command.id), platform)
        const { palette: _, ...descriptor } = command
        return keybinding ? { ...descriptor, keybinding } : descriptor
      })
    },
    executeCommand(id) {
      return keymap.runCommand(id, { target: editor }).ok
    },
  }
}
