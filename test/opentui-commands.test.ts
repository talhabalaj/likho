import { expect, test } from "bun:test"
import { InputRenderable, TextareaRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { registerDefaultKeys, registerMetadataFields, registerModBindings } from "@opentui/keymap/addons"
import { createOpenTuiKeymap } from "@opentui/keymap/opentui"
import { createOpenTuiCommands } from "../src/plugins/opentui-commands"

test("the command facade lists and executes contributed commands", async () => {
  const setup = await createTestRenderer({ width: 80, height: 24, otherModifiersMode: true })
  const editor = new TextareaRenderable(setup.renderer, { width: "100%", height: "100%" })
  setup.renderer.root.add(editor)
  const keymap = createOpenTuiKeymap(setup.renderer)
  const disposeKeys = registerDefaultKeys(keymap)
  const disposeMetadata = registerMetadataFields(keymap)
  let runs = 0

  try {
    const commands = createOpenTuiCommands(keymap, editor)
    const registration = commands.registerCommand({
      id: "workbench.test",
      title: "Test Command",
      run: () => {
        runs++
      },
    })

    expect(commands.listCommands()).toEqual([{ id: "workbench.test", title: "Test Command" }])
    expect(commands.executeCommand("workbench.test")).toBe(true)
    expect(commands.executeCommand("missing.command")).toBe(false)
    expect(runs).toBe(1)

    registration.dispose()
    expect(commands.listCommands()).toEqual([])
  } finally {
    disposeMetadata()
    disposeKeys()
    setup.renderer.destroy()
  }
})

test("global command bindings work while a palette input is focused", async () => {
  const setup = await createTestRenderer({ width: 80, height: 24, otherModifiersMode: true })
  const editor = new TextareaRenderable(setup.renderer, { width: "100%", height: "100%" })
  const input = new InputRenderable(setup.renderer, { width: "100%" })
  setup.renderer.root.add(editor)
  setup.renderer.root.add(input)
  const keymap = createOpenTuiKeymap(setup.renderer)
  const disposeKeys = registerDefaultKeys(keymap)
  const disposeMod = registerModBindings(keymap)
  let runs = 0

  try {
    const commands = createOpenTuiCommands(keymap, editor)
    commands.registerCommand({
      id: "workbench.test",
      title: "Test Command",
      run: () => {
        runs++
      },
    })
    commands.registerBindings([{ key: "mod+p", command: "workbench.test" }], { scope: "global" })
    input.focus()

    expect(commands.listCommands()[0]?.keybinding).toBe(process.platform === "darwin" ? "⌘P" : "Ctrl+P")
    setup.mockInput.pressKey("p", process.platform === "darwin" ? { super: true } : { ctrl: true })
    expect(runs).toBe(1)
  } finally {
    disposeMod()
    disposeKeys()
    setup.renderer.destroy()
  }
})
