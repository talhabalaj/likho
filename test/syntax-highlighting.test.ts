import { expect, test } from "bun:test"
import type { TreeSitterClient } from "@opentui/core"
import { EventEmitter } from "node:events"
import type { EditorDocument } from "../src/document"
import { DisposableStore, type EditorPluginContext } from "../src/plugins/host"
import {
  createSyntaxHighlighting,
  MAX_HIGHLIGHT_BYTES,
  SYNTAX_VIEWPORT_OVERSCAN_LINES,
} from "../src/plugins/syntax-highlighting"

test("syntax disposal destroys the client without scheduling a buffer-removal timeout", async () => {
  const events: string[] = []
  let finishInitialization!: (created: boolean) => void
  const initialization = new Promise<boolean>((resolve) => {
    finishInitialization = resolve
  })
  const client = Object.assign(new EventEmitter(), {
    createBuffer() {
      events.push("create")
      return initialization
    },
    async removeBuffer() {
      events.push("remove")
    },
    async resetBuffer() {},
  }) as unknown as TreeSitterClient
  const document: EditorDocument = {
    persistedText: "const value = 1",
    snapshot: { path: "/tmp/example.ts", version: 1, dirty: false },
    markChanged() {},
    validateText() {},
    open() {},
    save() {},
    onDidChange() {
      return { dispose() {} }
    },
  }
  const subscriptions = new DisposableStore()
  const plugin = createSyntaxHighlighting({
    getClient: () => client,
    destroyClient: async () => {
      events.push("destroy")
    },
  })
  const context = {
    signal: new AbortController().signal,
    document,
    actions: {
      hasOpenDocument: () => true,
      captureText: () => ({ text: document.persistedText, version: document.snapshot.version }),
    },
    syntax: {
      bufferId: 7,
      getVisibleLineRange: () => ({ start: 0, end: 20 }),
      onVisibleLineRangeChange: () => ({ dispose() {} }),
      clear() {},
      add() {},
      resolveStyleId: () => 1,
    },
    report() {},
    subscriptions,
  } as unknown as Readonly<EditorPluginContext & { subscriptions: DisposableStore }>

  await plugin.activate(context)
  await subscriptions.dispose()
  expect(events).toEqual(["create", "destroy"])

  finishInitialization(false)
  await Bun.sleep(0)
})

test("syntax captures once after a burst of document changes", async () => {
  let version = 1
  let text = "const value = 1"
  let listener: ((snapshot: EditorDocument["snapshot"]) => void) | undefined
  let captures = 0
  const resets: Array<{ version: number; text: string }> = []
  const client = Object.assign(new EventEmitter(), {
    async createBuffer() {
      return true
    },
    async removeBuffer() {},
    async resetBuffer(_id: number, nextVersion: number, nextText: string) {
      resets.push({ version: nextVersion, text: nextText })
    },
  }) as unknown as TreeSitterClient
  const document: EditorDocument = {
    persistedText: text,
    get snapshot() {
      return { path: "/tmp/example.ts", version, dirty: version > 1 }
    },
    markChanged() {},
    validateText() {},
    open() {},
    save() {},
    onDidChange(next) {
      listener = next
      return { dispose: () => (listener = undefined) }
    },
  }
  const subscriptions = new DisposableStore()
  const plugin = createSyntaxHighlighting({ getClient: () => client, destroyClient: async () => {} })
  const context = {
    signal: new AbortController().signal,
    document,
    actions: {
      hasOpenDocument: () => true,
      captureText() {
        captures++
        return { text, version }
      },
    },
    syntax: {
      bufferId: 8,
      getVisibleLineRange: () => ({ start: 0, end: 20 }),
      onVisibleLineRangeChange: () => ({ dispose() {} }),
      clear() {},
      add() {},
      resolveStyleId: () => 1,
    },
    report() {},
    subscriptions,
  } as unknown as Readonly<EditorPluginContext & { subscriptions: DisposableStore }>

  await plugin.activate(context)
  text = "const value = 2"
  for (version = 2; version <= 4; version++) listener?.(document.snapshot)
  version = 4
  await Bun.sleep(100)

  expect(captures).toBe(2)
  expect(resets).toEqual([{ version: 4, text: "const value = 2" }])
  await subscriptions.dispose()
})

test("syntax disables once when a document crosses the highlighting limit", async () => {
  let version = 1
  let text = "const value = 1"
  let listener: ((snapshot: EditorDocument["snapshot"]) => void) | undefined
  let captures = 0
  let clears = 0
  let removals = 0
  let destroys = 0
  const reports: string[] = []
  const client = Object.assign(new EventEmitter(), {
    async createBuffer() {
      return true
    },
    async removeBuffer() {
      removals++
    },
    async resetBuffer() {},
  }) as unknown as TreeSitterClient
  const document: EditorDocument = {
    persistedText: text,
    get snapshot() {
      return { path: "/tmp/example.ts", version, dirty: version > 1 }
    },
    markChanged() {},
    validateText() {},
    open() {},
    save() {},
    onDidChange(next) {
      listener = next
      return { dispose: () => (listener = undefined) }
    },
  }
  const subscriptions = new DisposableStore()
  const plugin = createSyntaxHighlighting({
    getClient: () => client,
    destroyClient: async () => {
      destroys++
    },
  })
  const context = {
    signal: new AbortController().signal,
    document,
    actions: {
      hasOpenDocument: () => true,
      captureText() {
        captures++
        return { text, version }
      },
    },
    syntax: {
      bufferId: 9,
      getVisibleLineRange: () => ({ start: 0, end: 20 }),
      onVisibleLineRangeChange: () => ({ dispose() {} }),
      clear: () => clears++,
      add() {},
      resolveStyleId: () => 1,
    },
    report: (message: string) => reports.push(message),
    subscriptions,
  } as unknown as Readonly<EditorPluginContext & { subscriptions: DisposableStore }>

  await plugin.activate(context)
  text = "x".repeat(MAX_HIGHLIGHT_BYTES + 1)
  version = 2
  listener?.(document.snapshot)
  await Bun.sleep(100)
  version = 3
  listener?.(document.snapshot)
  await Bun.sleep(100)

  expect(captures).toBe(2)
  expect(clears).toBe(1)
  expect(removals).toBe(0)
  expect(reports).toEqual([`Syntax highlighting disabled above ${MAX_HIGHLIGHT_BYTES.toLocaleString()} bytes`])

  await subscriptions.dispose()
  expect(removals).toBe(0)
  expect(destroys).toBe(1)
})

test("syntax waits for the first active document and then follows filetype changes", async () => {
  let path = "/tmp/.likho-no-file"
  let text = ""
  let version = 1
  let hasOpenDocument = false
  let captures = 0
  let listener: ((snapshot: EditorDocument["snapshot"]) => void) | undefined
  const creates: Array<{ filetype: string; text: string; version: number }> = []
  let destroys = 0
  const clients = Array.from({ length: 2 }, () =>
    Object.assign(new EventEmitter(), {
      async createBuffer(_id: number, nextText: string, filetype: string, nextVersion: number) {
        creates.push({ filetype, text: nextText, version: nextVersion })
        return true
      },
      async resetBuffer() {},
    }),
  ) as unknown as TreeSitterClient[]
  const document: EditorDocument = {
    get persistedText() {
      return text
    },
    get snapshot() {
      return { path, version, dirty: false }
    },
    markChanged() {},
    validateText() {},
    open() {},
    save() {},
    onDidChange(next) {
      listener = next
      return { dispose: () => (listener = undefined) }
    },
  }
  const subscriptions = new DisposableStore()
  const plugin = createSyntaxHighlighting({
    getClient: () => clients.shift()!,
    destroyClient: async () => {
      destroys++
    },
  })
  const context = {
    signal: new AbortController().signal,
    document,
    actions: {
      hasOpenDocument: () => hasOpenDocument,
      captureText: () => {
        captures++
        return { text, version }
      },
    },
    syntax: {
      bufferId: 10,
      getVisibleLineRange: () => ({ start: 0, end: 20 }),
      onVisibleLineRangeChange: () => ({ dispose() {} }),
      clear() {},
      add() {},
      resolveStyleId: () => 1,
    },
    report() {},
    subscriptions,
  } as unknown as Readonly<EditorPluginContext & { subscriptions: DisposableStore }>

  await plugin.activate(context)
  expect(captures).toBe(0)
  hasOpenDocument = true
  path = "/tmp/example.ts"
  text = "const value = 1"
  version = 2
  listener?.(document.snapshot)
  await Bun.sleep(0)
  path = "/tmp/readme.md"
  text = "# Heading"
  version = 3
  listener?.(document.snapshot)
  await Bun.sleep(0)

  expect(creates).toEqual([
    { filetype: "typescript", text: "const value = 1", version: 2 },
    { filetype: "markdown", text: "# Heading", version: 3 },
  ])
  expect(captures).toBe(2)
  expect(destroys).toBe(1)

  await subscriptions.dispose()
  expect(destroys).toBe(2)
})

test("syntax retains the full parse while painting only the viewport and overscan", async () => {
  const text = Array.from({ length: 80 }, (_, line) => `const value${line} = ${line}`).join("\n")
  let viewport = { start: 50, end: 60 }
  let viewportListener: ((range: Readonly<{ start: number; end: number }>) => void) | undefined
  let clears = 0
  const painted: number[] = []
  const client = Object.assign(new EventEmitter(), {
    async createBuffer() {
      return true
    },
    async resetBuffer() {},
  }) as unknown as TreeSitterClient
  const document: EditorDocument = {
    persistedText: text,
    snapshot: { path: "/tmp/example.ts", version: 1, dirty: false },
    markChanged() {},
    validateText() {},
    open() {},
    save() {},
    onDidChange() {
      return { dispose() {} }
    },
  }
  const subscriptions = new DisposableStore()
  const plugin = createSyntaxHighlighting({ getClient: () => client, destroyClient: async () => {} })
  const context = {
    signal: new AbortController().signal,
    document,
    actions: { hasOpenDocument: () => true, captureText: () => ({ text, version: 1 }) },
    syntax: {
      bufferId: 11,
      getVisibleLineRange: () => viewport,
      onVisibleLineRangeChange(listener: typeof viewportListener) {
        viewportListener = listener
        return { dispose: () => (viewportListener = undefined) }
      },
      clear: () => clears++,
      add: ({ line }: { line: number }) => painted.push(line),
      resolveStyleId: () => 1,
    },
    report() {},
    subscriptions,
  } as unknown as Readonly<EditorPluginContext & { subscriptions: DisposableStore }>
  const response = [0, 39, 40, 50, 69, 70].map((line) => ({
    line,
    highlights: [{ startCol: 0, endCol: 5, group: "keyword" }],
    droppedHighlights: [],
  }))

  await plugin.activate(context)
  client.emit("highlights:response", 11, 1, response)

  expect(SYNTAX_VIEWPORT_OVERSCAN_LINES).toBe(10)
  expect(clears).toBe(1)
  expect(painted).toEqual([40, 50, 69])

  viewport = { start: 0, end: 5 }
  viewportListener?.(viewport)
  expect(clears).toBe(2)
  expect(painted).toEqual([40, 50, 69, 0])

  viewport = { start: 68, end: 72 }
  viewportListener?.(viewport)
  expect(clears).toBe(3)
  expect(painted).toEqual([40, 50, 69, 0, 69, 70])

  await subscriptions.dispose()
  expect(viewportListener).toBeUndefined()
})
