import { afterEach, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { LocalFileSystemExplorerSource } from "../src/explorer-source"

const dirs: string[] = []

afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true })))

test("the filesystem Explorer shows real directories and hides only Git metadata", async () => {
  const dir = mkdtempSync(join(tmpdir(), "editor-explorer-source-test-"))
  dirs.push(dir)
  mkdirSync(join(dir, ".git"))
  mkdirSync(join(dir, "empty"))
  mkdirSync(join(dir, "ignored"))
  writeFileSync(join(dir, ".gitignore"), "ignored/\n")
  writeFileSync(join(dir, "z.txt"), "")
  writeFileSync(join(dir, "A.txt"), "")

  const source = new LocalFileSystemExplorerSource(dir)
  const children = await source.children(source.root.id, new AbortController().signal)

  expect(children.map(({ id, kind }) => [id, kind])).toEqual([
    ["empty", "directory"],
    ["ignored", "directory"],
    [".gitignore", "file"],
    ["A.txt", "file"],
    ["z.txt", "file"],
  ])
})

test("nested Explorer children keep workspace-relative stable IDs", async () => {
  const dir = mkdtempSync(join(tmpdir(), "editor-explorer-source-test-"))
  dirs.push(dir)
  mkdirSync(join(dir, "src", "components"), { recursive: true })
  writeFileSync(join(dir, "src", "index.ts"), "")

  const source = new LocalFileSystemExplorerSource(dir)
  const children = await source.children("src", new AbortController().signal)

  expect(children).toEqual([
    {
      id: "src/components",
      parentId: "src",
      name: "components",
      kind: "directory",
      absolutePath: join(dir, "src", "components"),
    },
    { id: "src/index.ts", parentId: "src", name: "index.ts", kind: "file", absolutePath: join(dir, "src", "index.ts") },
  ])
})
