import { afterEach, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { discoverWorkspaceFiles } from "../src/workspace-files"

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true })))

test("workspace discovery uses Git ignore rules and preserves unusual file names", async () => {
  const dir = mkdtempSync(join(tmpdir(), "editor-workspace-test-"))
  dirs.push(dir)
  mkdirSync(join(dir, "src"))
  writeFileSync(join(dir, ".gitignore"), "ignored.ts\n")
  writeFileSync(join(dir, "ignored.ts"), "")
  writeFileSync(join(dir, "src", "café.ts"), "")
  writeFileSync(join(dir, "line\nbreak.ts"), "")
  expect(Bun.spawnSync(["git", "init", "--quiet"], { cwd: dir }).exitCode).toBe(0)

  const files = await discoverWorkspaceFiles(dir, new AbortController().signal)

  expect(files.map(({ relativePath }) => relativePath)).toEqual([".gitignore", "line\nbreak.ts", "src/café.ts"])
})

test("workspace discovery falls back outside Git and filters dependency and build output", async () => {
  const dir = mkdtempSync(join(tmpdir(), "editor-workspace-test-"))
  dirs.push(dir)
  mkdirSync(join(dir, "src"))
  mkdirSync(join(dir, "node_modules"))
  mkdirSync(join(dir, "dist"))
  writeFileSync(join(dir, ".env.example"), "")
  writeFileSync(join(dir, "src", "index.ts"), "")
  writeFileSync(join(dir, "node_modules", "package.js"), "")
  writeFileSync(join(dir, "dist", "index.js"), "")

  const files = await discoverWorkspaceFiles(dir, new AbortController().signal)

  expect(files.map(({ relativePath }) => relativePath)).toEqual([".env.example", "src/index.ts"])
})
