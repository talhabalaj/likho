import { expect, test } from "bun:test"
import type { TextareaRenderable, TextRenderable } from "@opentui/core"
import type { EditorDocument } from "../src/document"
import { createChrome } from "../src/plugins/chrome"
import { DisposableStore, type EditorPluginContext } from "../src/plugins/host"

test("reported status messages return to the normal editor status", async () => {
  const document: EditorDocument = {
    persistedText: "",
    snapshot: { path: "/tmp/note.txt", version: 1, dirty: false },
    markChanged() {},
    validateText() {},
    open() {},
    save() {},
    onDidChange() {
      return { dispose() {} }
    },
  }
  const editor = { logicalCursor: { row: 2, col: 4 }, onCursorChange: undefined } as unknown as TextareaRenderable
  const titleState = { content: "" }
  const statusState = { content: "" }
  const chrome = createChrome({
    editor,
    title: titleState as unknown as TextRenderable,
    status: statusState as unknown as TextRenderable,
    messageDurationMs: 5,
  })
  const subscriptions = new DisposableStore()
  const context = {
    document,
    commands: { platform: "macos" },
    subscriptions,
    report() {},
  } as unknown as Readonly<EditorPluginContext & { subscriptions: DisposableStore }>

  await chrome.plugin.activate(context)
  chrome.report("Something happened")
  expect(statusState.content).toBe(" Something happened")

  await Bun.sleep(10)
  expect(statusState.content).toContain("Ln 3, Col 5")
  expect(statusState.content).toContain("⌘S Save")

  await subscriptions.dispose()
})
