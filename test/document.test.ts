import { afterEach, expect, test } from "bun:test"
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { MAX_FILE_BYTES, openDocument } from "../src/document"

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true })))

test("a new document becomes clean after saving its current text", () => {
  const dir = mkdtempSync(join(tmpdir(), "editor-document-test-"))
  dirs.push(dir)
  const path = join(dir, "note.txt")
  const document = openDocument(path)

  expect(document.snapshot).toEqual({ path, text: "", version: 1, dirty: false })

  document.replaceText("hello 👋\n")
  expect(document.snapshot).toEqual({ path, text: "hello 👋\n", version: 2, dirty: true })

  document.save()
  expect(document.snapshot).toEqual({ path, text: "hello 👋\n", version: 2, dirty: false })
  expect(readFileSync(path, "utf8")).toBe("hello 👋\n")
})

test("saving refuses to overwrite an external change and remains dirty", () => {
  const dir = mkdtempSync(join(tmpdir(), "editor-document-test-"))
  dirs.push(dir)
  const path = join(dir, "note.txt")
  writeFileSync(path, "original\n")
  const document = openDocument(path)

  document.replaceText("my edit\n")
  writeFileSync(path, "external edit\n")

  expect(() => document.save()).toThrow("file changed on disk")
  expect(document.snapshot.dirty).toBe(true)
  expect(readFileSync(path, "utf8")).toBe("external edit\n")
})

test("document changes publish the new versioned snapshot", () => {
  const dir = mkdtempSync(join(tmpdir(), "editor-document-test-"))
  dirs.push(dir)
  const document = openDocument(join(dir, "note.txt"))
  const snapshots: Array<{ version: number; dirty: boolean }> = []
  const subscription = document.onDidChange(({ version, dirty }) => snapshots.push({ version, dirty }))

  document.replaceText("one")
  document.replaceText("one")
  document.save()
  subscription.dispose()
  document.replaceText("two")

  expect(snapshots).toEqual([
    { version: 2, dirty: true },
    { version: 2, dirty: false },
  ])
})

test("one broken document listener does not block the others", () => {
  const dir = mkdtempSync(join(tmpdir(), "editor-document-test-"))
  dirs.push(dir)
  const document = openDocument(join(dir, "note.txt"))
  const errors: string[] = []
  let delivered = false
  document.onDidChange(
    () => {
      throw new Error("listener failed")
    },
    (error) => errors.push(error instanceof Error ? error.message : String(error)),
  )
  document.onDidChange(() => {
    delivered = true
  })

  document.replaceText("changed")

  expect(errors).toEqual(["listener failed"])
  expect(delivered).toBe(true)
})

test("saving atomically replaces an existing file without changing its permissions", () => {
  const dir = mkdtempSync(join(tmpdir(), "editor-document-test-"))
  dirs.push(dir)
  const path = join(dir, "note.txt")
  writeFileSync(path, "original\n")
  chmodSync(path, 0o640)
  const previousInode = statSync(path).ino
  const document = openDocument(path)

  document.replaceText("replacement\n")
  document.save()

  expect(readFileSync(path, "utf8")).toBe("replacement\n")
  expect(statSync(path).mode & 0o777).toBe(0o640)
  expect(statSync(path).ino).not.toBe(previousInode)
  expect(readdirSync(dir)).toEqual(["note.txt"])
})

test("saving through a symlink atomically replaces its target without replacing the link", () => {
  const dir = mkdtempSync(join(tmpdir(), "editor-document-test-"))
  dirs.push(dir)
  const target = join(dir, "target.txt")
  const path = join(dir, "note.txt")
  writeFileSync(target, "original\n")
  symlinkSync("target.txt", path)
  const document = openDocument(path)

  document.replaceText("replacement\n")
  document.save()

  expect(lstatSync(path).isSymbolicLink()).toBe(true)
  expect(readFileSync(target, "utf8")).toBe("replacement\n")
})

test("opening an oversized file is rejected before loading it", () => {
  const dir = mkdtempSync(join(tmpdir(), "editor-document-test-"))
  dirs.push(dir)
  const path = join(dir, "large.txt")
  writeFileSync(path, Buffer.alloc(MAX_FILE_BYTES + 1, 120))

  expect(() => openDocument(path)).toThrow(`Files over ${MAX_FILE_BYTES.toLocaleString()} bytes`)
})
