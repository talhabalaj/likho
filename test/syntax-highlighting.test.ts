import { expect, test } from "bun:test"
import type { TreeSitterClient } from "@opentui/core"
import { EventEmitter } from "node:events"
import type { EditorDocument } from "../src/document"
import { DisposableStore, type EditorPluginContext } from "../src/plugins/host"
import { createSyntaxHighlighting } from "../src/plugins/syntax-highlighting"

test("syntax disposal waits for initialization before removing the buffer and destroying the client", async () => {
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
    snapshot: { path: "/tmp/example.ts", text: "const value = 1", version: 1, dirty: false },
    replaceText() {},
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
    syntax: {
      bufferId: 7,
      clear() {},
      add() {},
      resolveStyleId: () => 1,
    },
    report() {},
    subscriptions,
  } as unknown as Readonly<EditorPluginContext & { subscriptions: DisposableStore }>

  await plugin.activate(context)
  const disposal = subscriptions.dispose()
  await Bun.sleep(0)
  expect(events).toEqual(["create"])

  finishInitialization(true)
  await disposal

  expect(events).toEqual(["create", "remove", "destroy"])
})
