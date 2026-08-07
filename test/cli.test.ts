import { expect, test } from "bun:test"
import { resolve } from "node:path"
import { runCli } from "../src/cli"

test("invalid arguments return usage without opening an editor", async () => {
  let opened = false

  const result = await runCli([], {
    signal: new AbortController().signal,
    editFile: async () => {
      opened = true
      return { kind: "closed" }
    },
  })

  expect(result).toEqual({
    exitCode: 2,
    stderr: "Usage: likho <file>\n",
  })
  expect(opened).toBe(false)
})

test("opens the resolved file and returns success after the editor closes", async () => {
  const controller = new AbortController()
  let request: { filePath: string; signal: AbortSignal } | undefined

  const result = await runCli(["notes/today.md"], {
    signal: controller.signal,
    editFile: async (received) => {
      request = received
      return { kind: "closed" }
    },
  })

  expect(request).toEqual({
    filePath: resolve("notes/today.md"),
    signal: controller.signal,
  })
  expect(result).toEqual({ exitCode: 0 })
})

test("session startup failures become one-line CLI errors", async () => {
  const result = await runCli(["missing.txt"], {
    signal: new AbortController().signal,
    editFile: async () => {
      throw new Error("Not a file: missing.txt")
    },
  })

  expect(result).toEqual({
    exitCode: 1,
    stderr: "Not a file: missing.txt\n",
  })
})

test("graceful signal shutdown uses the conventional exit code", async () => {
  const result = await runCli(["note.txt"], {
    signal: new AbortController().signal,
    editFile: async () => ({ kind: "signal", signal: "SIGTERM" }),
  })

  expect(result).toEqual({ exitCode: 143 })
})
