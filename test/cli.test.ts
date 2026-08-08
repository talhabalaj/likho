import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import manifest from "../package.json" with { type: "json" }
import { runCli } from "../src/cli"
import type { EditorSessionRequest } from "../src/editor-session"

test("prints the package version without opening an editor", async () => {
  let opened = false

  const result = await runCli(["--version"], {
    signal: new AbortController().signal,
    editFile: async () => {
      opened = true
      return { kind: "closed" }
    },
  })

  expect(result).toEqual({ exitCode: 0, stdout: `${manifest.version}\n` })
  expect(opened).toBe(false)
})

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
    stderr: "Usage: likho <file-or-folder>\n",
  })
  expect(opened).toBe(false)
})

test("opens the resolved file and returns success after the editor closes", async () => {
  const controller = new AbortController()
  let request: EditorSessionRequest | undefined

  const result = await runCli(["notes/today.md"], {
    signal: controller.signal,
    editFile: async (received) => {
      request = received
      return { kind: "closed" }
    },
  })

  expect(request).toEqual({
    kind: "file",
    filePath: resolve("notes/today.md"),
    signal: controller.signal,
  })
  expect(result).toEqual({ exitCode: 0 })
})

test("opening a folder starts a workspace session without inventing a file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "editor-cli-test-"))
  const folder = join(dir, "project")
  mkdirSync(folder)
  let request: EditorSessionRequest | undefined

  try {
    const result = await runCli([folder], {
      signal: new AbortController().signal,
      editFile: async (received) => {
        request = received
        return { kind: "closed" }
      },
    })

    expect(request).toEqual({ kind: "folder", workspaceRoot: folder, signal: expect.any(AbortSignal) })
    expect(result).toEqual({ exitCode: 0 })
  } finally {
    rmSync(dir, { recursive: true })
  }
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
    editFile: async () => ({ kind: "aborted", reason: { kind: "signal", signal: "SIGTERM" } }),
  })

  expect(result).toEqual({ exitCode: 143 })
})

test("non-process cancellation is not mislabeled as SIGTERM", async () => {
  const result = await runCli(["note.txt"], {
    signal: new AbortController().signal,
    editFile: async () => ({ kind: "aborted", reason: undefined }),
  })

  expect(result).toEqual({ exitCode: 1, stderr: "Editor cancelled\n" })
})
