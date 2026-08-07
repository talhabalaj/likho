import { expect, test } from "bun:test"
import { QuickInput, type QuickInputItem, type QuickInputProvider } from "../src/quick-input"

function provider(...items: QuickInputItem[]): QuickInputProvider {
  return {
    async prepare() {},
    search(query) {
      return items.filter(({ label }) => label.includes(query))
    },
  }
}

test("Quick Open switches to commands only for a leading greater-than sign", async () => {
  const quickInput = new QuickInput({
    files: provider({ id: "file", label: "abc>file.ts", accept: () => true }),
    commands: provider({ id: "command", label: "Save", accept: () => true }),
  })

  await quickInput.open("files")
  expect(quickInput.snapshot.mode).toBe("files")
  expect(quickInput.snapshot.items.map(({ id }) => id)).toEqual(["file"])

  await quickInput.setValue(">")
  expect(quickInput.snapshot).toMatchObject({ open: true, mode: "commands", value: ">" })
  expect(quickInput.snapshot.items.map(({ id }) => id)).toEqual(["command"])

  await quickInput.setValue("")
  expect(quickInput.snapshot.mode).toBe("files")

  await quickInput.setValue("abc>")
  expect(quickInput.snapshot.mode).toBe("files")
  expect(quickInput.snapshot.items.map(({ id }) => id)).toEqual(["file"])
})

test("command acceptance closes before dispatch while rejected file acceptance stays open", async () => {
  let commandSawOpen = true
  const quickInput = new QuickInput({
    files: provider({ id: "file", label: "note.ts", accept: () => false }),
    commands: provider({
      id: "command",
      label: "Save",
      closeBeforeAccept: true,
      accept: () => {
        commandSawOpen = quickInput.snapshot.open
        return true
      },
    }),
  })

  await quickInput.open("files")
  expect(await quickInput.accept()).toBe(false)
  expect(quickInput.snapshot.open).toBe(true)

  await quickInput.open("commands")
  expect(await quickInput.accept()).toBe(true)
  expect(commandSawOpen).toBe(false)
  expect(quickInput.snapshot.open).toBe(false)
})

test("closing or reopening ignores stale provider preparation", async () => {
  let finishFiles!: () => void
  const fileReady = new Promise<void>((resolve) => {
    finishFiles = resolve
  })
  const files: QuickInputProvider = {
    prepare: () => fileReady,
    search: () => [{ id: "late-file", label: "late.ts", accept: () => true }],
  }
  const quickInput = new QuickInput({ files, commands: provider({ id: "command", label: "Save", accept: () => true }) })

  const firstOpen = quickInput.open("files")
  await quickInput.open("commands")
  finishFiles()
  await firstOpen

  expect(quickInput.snapshot.mode).toBe("commands")
  expect(quickInput.snapshot.items.map(({ id }) => id)).toEqual(["command"])
})
