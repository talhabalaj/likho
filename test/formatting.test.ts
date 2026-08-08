import { expect, test } from "bun:test"
import type { EditorDocument } from "../src/document"
import { createFormatting, type FormattingDependencies } from "../src/plugins/formatting"
import {
  DisposableStore,
  type CommandContributions,
  type EditorPluginContext,
} from "../src/plugins/host"

test("formatting captures large supported documents only when commanded", async () => {
  const source = `const value=1;\n${" ".repeat(200_000)}`
  let command: Readonly<{ run(): void | Promise<void> }> | undefined
  let captured = 0
  let formattedInput = ""
  let applied: Readonly<{ version: number; text: string }> | undefined
  const reports: string[] = []
  const document: EditorDocument = {
    persistedText: source,
    snapshot: { path: "/tmp/example.ts", version: 7, dirty: true },
    markChanged() {},
    validateText() {},
    open() {},
    save() {},
    onDidChange() {
      return { dispose() {} }
    },
  }
  const commands: CommandContributions = {
    platform: "linux",
    registerCommand(next) {
      command = next
      return { dispose() {} }
    },
    registerBindings() {
      return { dispose() {} }
    },
    captureKeyInputWhile() {
      return { dispose() {} }
    },
    listCommands() {
      return []
    },
    executeCommand() {
      return false
    },
  }
  const dependencies = {
    getFileInfo: async () => ({ ignored: false, inferredParser: "typescript" }),
    format: async (text: string) => {
      formattedInput = text
      return "const value = 1;\n"
    },
  } as FormattingDependencies
  const subscriptions = new DisposableStore()
  const context = {
    signal: new AbortController().signal,
    document,
    commands,
    actions: {
      captureText() {
        captured++
        return { text: source, version: 7 }
      },
      applyText(version: number, text: string) {
        applied = { version, text }
        return true
      },
    },
    report: (message: string) => reports.push(message),
    subscriptions,
  } as unknown as Readonly<EditorPluginContext & { subscriptions: DisposableStore }>

  await createFormatting(dependencies).activate(context)
  expect(captured).toBe(0)

  await command?.run()

  expect(captured).toBe(1)
  expect(formattedInput).toBe(source)
  expect(applied).toEqual({ version: 7, text: "const value = 1;\n" })
  expect(reports).toEqual(["Formatting…", "Formatted document"])
  await subscriptions.dispose()
})
