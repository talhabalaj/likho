import { afterEach, expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runEditorSession } from "../src/editor-session"

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true })))

test("a signal closes the session and destroys the renderer", async () => {
  const dir = mkdtempSync(join(tmpdir(), "editor-session-test-"))
  dirs.push(dir)
  const setup = await createTestRenderer({ width: 80, height: 24, otherModifiersMode: true })
  const controller = new AbortController()
  const session = runEditorSession(
    { filePath: join(dir, "note.txt"), signal: controller.signal },
    { createRenderer: async () => setup.renderer },
  )

  await setup.waitForFrame((frame) => frame.includes("note.txt"))
  controller.abort({ kind: "signal", signal: "SIGTERM" })

  expect(await session).toEqual({ kind: "signal", signal: "SIGTERM" })
  expect(setup.renderer.isDestroyed).toBe(true)
})

test("VS Code keybindings save through the document kernel and close the editor", async () => {
  const dir = mkdtempSync(join(tmpdir(), "editor-session-test-"))
  dirs.push(dir)
  const path = join(dir, "note.txt")
  const setup = await createTestRenderer({ width: 80, height: 24, otherModifiersMode: true })
  const session = runEditorSession(
    { filePath: path, signal: new AbortController().signal },
    { createRenderer: async () => setup.renderer },
  )

  await setup.waitForFrame((frame) => frame.includes("note.txt"))
  await setup.mockInput.typeText("hello")
  setup.mockInput.pressKey("s", process.platform === "darwin" ? { super: true } : { ctrl: true })
  await setup.waitForFrame((frame) => frame.includes("Saved note.txt"))
  setup.mockInput.pressKey("q", { ctrl: true })

  expect(await session).toEqual({ kind: "closed" })
  expect(readFileSync(path, "utf8")).toBe("hello")
})

test("a dirty document requires the close command twice before discarding", async () => {
  const dir = mkdtempSync(join(tmpdir(), "editor-session-test-"))
  dirs.push(dir)
  const path = join(dir, "note.txt")
  const setup = await createTestRenderer({ width: 80, height: 24, otherModifiersMode: true })
  const session = runEditorSession(
    { filePath: path, signal: new AbortController().signal },
    { createRenderer: async () => setup.renderer },
  )

  await setup.waitForFrame((frame) => frame.includes("note.txt"))
  await setup.mockInput.typeText("draft")
  setup.mockInput.pressKey("q", { ctrl: true })
  await setup.waitForFrame((frame) => frame.includes("Unsaved changes"))

  expect(setup.renderer.isDestroyed).toBe(false)
  setup.mockInput.pressKey("q", { ctrl: true })
  expect(await session).toEqual({ kind: "closed" })
  expect(existsSync(path)).toBe(false)
})

test("the gutter renders line numbers beyond 99", async () => {
  const dir = mkdtempSync(join(tmpdir(), "editor-session-test-"))
  dirs.push(dir)
  const path = join(dir, "long.txt")
  writeFileSync(path, Array.from({ length: 105 }, (_, index) => `line ${index + 1}`).join("\n"))
  const setup = await createTestRenderer({ width: 80, height: 10, otherModifiersMode: true })
  const session = runEditorSession(
    { filePath: path, signal: new AbortController().signal },
    { createRenderer: async () => setup.renderer },
  )

  await setup.waitForFrame((frame) => frame.includes("long.txt"))
  if (process.platform === "darwin") {
    setup.mockInput.pressArrow("down", { super: true })
  } else {
    setup.mockInput.pressKey("end", { ctrl: true })
  }
  await setup.waitForFrame((frame) => frame.includes("105 line 105"))

  setup.mockInput.pressKey("q", { ctrl: true })
  expect(await session).toEqual({ kind: "closed" })
})

test("mouse wheel scrolling over the gutter scrolls the editor", async () => {
  const dir = mkdtempSync(join(tmpdir(), "editor-session-test-"))
  dirs.push(dir)
  const path = join(dir, "long.txt")
  writeFileSync(path, Array.from({ length: 40 }, (_, index) => `line ${index + 1}`).join("\n"))
  const setup = await createTestRenderer({ width: 80, height: 10, otherModifiersMode: true })
  const session = runEditorSession(
    { filePath: path, signal: new AbortController().signal },
    { createRenderer: async () => setup.renderer },
  )

  await setup.waitForFrame((frame) => frame.includes(" 1 line 1"))
  await setup.mockMouse.scroll(1, 4, "down")
  await setup.waitForFrame((frame) => !frame.includes(" 1 line 1") && frame.includes("line 9"))

  setup.mockInput.pressKey("q", { ctrl: true })
  expect(await session).toEqual({ kind: "closed" })
})
