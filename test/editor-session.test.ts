import { afterEach, expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runEditorSession } from "../src/editor-session"
import type { BuiltinPlugin, EditorPluginContext } from "../src/plugins/host"

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

  expect(await session).toEqual({ kind: "aborted", reason: { kind: "signal", signal: "SIGTERM" } })
  expect(setup.renderer.isDestroyed).toBe(true)
})

test("user close aborts the plugin lifetime after dirty-close confirmation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "editor-session-test-"))
  dirs.push(dir)
  const setup = await createTestRenderer({ width: 80, height: 24, otherModifiersMode: true })
  let pluginSignal: AbortSignal | undefined
  let markActivated!: () => void
  const activated = new Promise<void>((resolve) => {
    markActivated = resolve
  })
  const closeProbe: BuiltinPlugin<EditorPluginContext> = {
    id: "builtin.close-probe",
    activate(context) {
      pluginSignal = context.signal
      context.subscriptions.add(
        context.commands.registerCommand({
          id: "window.close",
          title: "Close Editor",
          run: context.actions.requestClose,
        }),
      )
      context.subscriptions.add(context.commands.registerBindings([{ key: "ctrl+q", command: "window.close" }]))
      markActivated()
    },
  }
  const session = runEditorSession(
    { filePath: join(dir, "note.txt"), signal: new AbortController().signal },
    { createRenderer: async () => setup.renderer, plugins: [closeProbe] },
  )

  await activated
  await Bun.sleep(10)
  await setup.mockInput.typeText("draft")
  setup.mockInput.pressKey("q", { ctrl: true })
  await Bun.sleep(10)
  expect(pluginSignal?.aborted).toBe(false)

  setup.mockInput.pressKey("q", { ctrl: true })
  expect(await session).toEqual({ kind: "closed" })
  expect(pluginSignal?.aborted).toBe(true)
})

test("a signal can stop a session while plugin activation is pending", async () => {
  const dir = mkdtempSync(join(tmpdir(), "editor-session-test-"))
  dirs.push(dir)
  const setup = await createTestRenderer({ width: 80, height: 24, otherModifiersMode: true })
  const controller = new AbortController()
  let markStarted!: () => void
  const started = new Promise<void>((resolve) => {
    markStarted = resolve
  })
  const pending: BuiltinPlugin<EditorPluginContext> = {
    id: "builtin.pending",
    activate(context) {
      markStarted()
      return new Promise<void>((resolve) => context.signal.addEventListener("abort", () => resolve(), { once: true }))
    },
  }
  const session = runEditorSession(
    { filePath: join(dir, "note.txt"), signal: controller.signal },
    { createRenderer: async () => setup.renderer, plugins: [pending] },
  )

  await started
  controller.abort({ kind: "signal", signal: "SIGTERM" })
  const result = await Promise.race([
    session,
    Bun.sleep(100).then(() => ({ kind: "timeout" }) as const),
  ])

  expect(result).toEqual({ kind: "aborted", reason: { kind: "signal", signal: "SIGTERM" } })
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

test("saving never overwrites a file changed by another process", async () => {
  const dir = mkdtempSync(join(tmpdir(), "editor-session-test-"))
  dirs.push(dir)
  const path = join(dir, "note.txt")
  writeFileSync(path, "original")
  const setup = await createTestRenderer({ width: 80, height: 24, otherModifiersMode: true })
  const session = runEditorSession(
    { filePath: path, signal: new AbortController().signal },
    { createRenderer: async () => setup.renderer },
  )

  await setup.waitForFrame((frame) => frame.includes("note.txt"))
  await setup.mockInput.typeText("mine")
  writeFileSync(path, "external")
  setup.mockInput.pressKey("s", process.platform === "darwin" ? { super: true } : { ctrl: true })
  await setup.waitForFrame((frame) => frame.includes("Save blocked: file changed on disk"))

  setup.mockInput.pressKey("q", { ctrl: true })
  await setup.waitForFrame((frame) => frame.includes("Unsaved changes"))
  setup.mockInput.pressKey("q", { ctrl: true })
  expect(await session).toEqual({ kind: "closed" })
  expect(readFileSync(path, "utf8")).toBe("external")
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

test("the Tree-sitter built-in applies Dark+ syntax colors", async () => {
  const dir = mkdtempSync(join(tmpdir(), "editor-session-test-"))
  dirs.push(dir)
  const path = join(dir, "sample.ts")
  writeFileSync(path, "const answer = 42\n")
  const setup = await createTestRenderer({ width: 80, height: 10, otherModifiersMode: true })
  const controller = new AbortController()
  const session = runEditorSession(
    { filePath: path, signal: controller.signal },
    { createRenderer: async () => setup.renderer },
  )

  try {
    let keywordColor: [number, number, number, number] | undefined
    for (let attempt = 0; attempt < 40 && !keywordColor; attempt++) {
      await Bun.sleep(50)
      await setup.flush()
      const keyword = setup
        .captureSpans()
        .lines.flatMap((line) => line.spans)
        .find((span) => span.text === "const")
      keywordColor = keyword?.fg.toInts()
    }
    expect(keywordColor).toEqual([86, 156, 214, 255])
  } finally {
    controller.abort({ kind: "signal", signal: "SIGTERM" })
    await session
  }
})

test("Shift+Option/Alt+F formats the current document through a built-in", async () => {
  const dir = mkdtempSync(join(tmpdir(), "editor-session-test-"))
  dirs.push(dir)
  const path = join(dir, "format.ts")
  writeFileSync(path, "const value={answer:42}")
  const setup = await createTestRenderer({ width: 80, height: 10, otherModifiersMode: true })
  const controller = new AbortController()
  const session = runEditorSession(
    { filePath: path, signal: controller.signal },
    { createRenderer: async () => setup.renderer },
  )

  try {
    let started = false
    for (let attempt = 0; attempt < 40 && !started; attempt++) {
      await Bun.sleep(50)
      await setup.flush()
      started = setup.captureCharFrame().includes("const value={answer:42}")
    }
    expect(started).toBe(true)
    setup.mockInput.pressKey("f", { meta: true, shift: true })

    let formatted = false
    for (let attempt = 0; attempt < 40 && !formatted; attempt++) {
      await Bun.sleep(50)
      await setup.flush()
      formatted = setup.captureCharFrame().includes("const value = { answer: 42 };")
    }
    expect(formatted).toBe(true)
  } finally {
    controller.abort({ kind: "signal", signal: "SIGTERM" })
    await session
  }
})

test("formatter failures are shown in the editor instead of escaping the command", async () => {
  const dir = mkdtempSync(join(tmpdir(), "editor-session-test-"))
  dirs.push(dir)
  const path = join(dir, "invalid.ts")
  writeFileSync(path, "const =")
  const setup = await createTestRenderer({ width: 80, height: 10, otherModifiersMode: true })
  const controller = new AbortController()
  const session = runEditorSession(
    { filePath: path, signal: controller.signal },
    { createRenderer: async () => setup.renderer },
  )

  try {
    let started = false
    for (let attempt = 0; attempt < 40 && !started; attempt++) {
      await Bun.sleep(50)
      await setup.flush()
      started = setup.captureCharFrame().includes("invalid.ts")
    }
    expect(started).toBe(true)
    setup.mockInput.pressKey("f", { meta: true, shift: true })
    let reported = false
    for (let attempt = 0; attempt < 40 && !reported; attempt++) {
      await Bun.sleep(50)
      await setup.flush()
      reported = setup.captureCharFrame().includes("Formatting failed:")
    }
    expect(reported).toBe(true)
  } finally {
    controller.abort({ kind: "signal", signal: "SIGTERM" })
    await session
  }
})
