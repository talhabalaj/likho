import { afterEach, expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openDocument } from "../src/document"
import { runEditorSession } from "../src/editor-session"

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })))

test("switching to a file deleted after discovery preserves the active document", () => {
  const dir = mkdtempSync(join(tmpdir(), "editor-document-open-test-"))
  dirs.push(dir)
  const activePath = join(dir, "active.txt")
  const stalePath = join(dir, "stale.txt")
  writeFileSync(activePath, "active")
  writeFileSync(stalePath, "stale")
  const document = openDocument(activePath)
  let renderedText = "active"

  unlinkSync(stalePath)

  expect(() => document.open(stalePath, (text) => (renderedText = text))).toThrow("File not found")
  expect(document.snapshot.path).toBe(activePath)
  expect(renderedText).toBe("active")
})

test("Quick Open keeps its input and footer visible when the terminal becomes short", async () => {
  const dir = mkdtempSync(join(tmpdir(), "editor-quick-open-resize-test-"))
  dirs.push(dir)
  for (let index = 0; index < 15; index++) {
    writeFileSync(join(dir, `${String(index).padStart(2, "0")}.txt`), `content ${index}`)
  }
  const setup = await createTestRenderer({ width: 80, height: 24, otherModifiersMode: true })
  const controller = new AbortController()
  const session = runEditorSession(
    { filePath: join(dir, "00.txt"), workspaceRoot: dir, signal: controller.signal },
    { createRenderer: async () => setup.renderer },
  )

  try {
    await setup.waitForFrame((frame) => frame.includes("00.txt"))
    setup.mockInput.pressKey("p", process.platform === "darwin" ? { super: true } : { ctrl: true })
    await Bun.sleep(50)
    await setup.waitForFrame((frame) => frame.includes("15 results"))

    setup.resize(80, 8)

    const frame = await setup.waitForFrame(
      (candidate) => candidate.includes("Search files by name") && candidate.includes("15 results"),
    )
    expect(frame.split("\n")).toHaveLength(9)
  } finally {
    controller.abort({ kind: "signal", signal: "SIGTERM" })
    await session
  }
})

test("a stale Quick Open result reports the error and keeps the current file active", async () => {
  const dir = mkdtempSync(join(tmpdir(), "editor-quick-open-stale-test-"))
  dirs.push(dir)
  const activePath = join(dir, "00.txt")
  const stalePath = join(dir, "01.txt")
  writeFileSync(activePath, "active content")
  writeFileSync(stalePath, "stale content")
  const setup = await createTestRenderer({ width: 80, height: 24, otherModifiersMode: true })
  const controller = new AbortController()
  const session = runEditorSession(
    { filePath: activePath, workspaceRoot: dir, signal: controller.signal },
    { createRenderer: async () => setup.renderer },
  )

  try {
    await setup.waitForFrame((frame) => frame.includes("active content"))
    setup.mockInput.pressKey("p", process.platform === "darwin" ? { super: true } : { ctrl: true })
    await Bun.sleep(50)
    await setup.waitForFrame((frame) => frame.includes("01.txt") && frame.includes("2 results"))
    unlinkSync(stalePath)

    setup.mockInput.pressArrow("down")
    setup.mockInput.pressEnter()

    await setup.waitForFrame((frame) => frame.includes("File not found") && frame.includes("00.txt"))
    setup.mockInput.pressEscape()
    await Bun.sleep(50)
    await setup.waitForFrame((frame) => frame.includes("00.txt") && frame.includes("active content"))
  } finally {
    controller.abort({ kind: "signal", signal: "SIGTERM" })
    await session
  }
})
