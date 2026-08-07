import { afterEach, expect, test } from "bun:test"
import {
  chmodSync,
  existsSync,
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
import { MAX_FILE_BYTES, MAX_FILE_LINES, openDocument, type DocumentSnapshot } from "../src/document"

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true })))

test("a new document becomes clean after saving its current text", () => {
  const dir = mkdtempSync(join(tmpdir(), "editor-document-test-"))
  dirs.push(dir)
  const path = join(dir, "note.txt")
  const document = openDocument(path)

  expect(document.initialText).toBe("")
  expect(document.snapshot).toEqual({ path, version: 1, dirty: false })

  document.markChanged()
  expect(document.snapshot).toEqual({ path, version: 2, dirty: true })

  document.save("hello 👋\n")
  expect(document.snapshot).toEqual({ path, version: 2, dirty: false })
  expect(readFileSync(path, "utf8")).toBe("hello 👋\n")
})

test("saving refuses to overwrite an external change and remains dirty", () => {
  const dir = mkdtempSync(join(tmpdir(), "editor-document-test-"))
  dirs.push(dir)
  const path = join(dir, "note.txt")
  writeFileSync(path, "original\n")
  const document = openDocument(path)

  document.markChanged()
  writeFileSync(path, "external edit\n")

  expect(() => document.save("my edit\n")).toThrow("file changed on disk")
  expect(document.snapshot.dirty).toBe(true)
  expect(readFileSync(path, "utf8")).toBe("external edit\n")
})

test("document changes publish the new versioned snapshot", () => {
  const dir = mkdtempSync(join(tmpdir(), "editor-document-test-"))
  dirs.push(dir)
  const document = openDocument(join(dir, "note.txt"))
  const snapshots: Array<{ version: number; dirty: boolean }> = []
  const subscription = document.onDidChange(({ version, dirty }) => snapshots.push({ version, dirty }))

  document.markChanged()
  document.markChanged()
  document.save("one")
  subscription.dispose()
  document.markChanged()

  expect(snapshots).toEqual([
    { version: 2, dirty: true },
    { version: 3, dirty: true },
    { version: 3, dirty: false },
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

  document.markChanged()

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

  document.markChanged()
  document.save("replacement\n")

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

  document.markChanged()
  document.save("replacement\n")

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

test("opening a file with too many lines is rejected before entering the editor", () => {
  const dir = mkdtempSync(join(tmpdir(), "editor-document-test-"))
  dirs.push(dir)
  const path = join(dir, "many-lines.txt")
  writeFileSync(path, "\n".repeat(MAX_FILE_LINES))

  expect(() => openDocument(path)).toThrow(`Files over ${MAX_FILE_LINES.toLocaleString()} lines`)
})

test("saving refuses buffers beyond the byte or line limits", () => {
  const dir = mkdtempSync(join(tmpdir(), "editor-document-test-"))
  dirs.push(dir)
  const path = join(dir, "note.txt")
  const document = openDocument(path)
  document.markChanged()

  expect(() => document.save("x".repeat(MAX_FILE_BYTES + 1))).toThrow(
    `buffer exceeds ${MAX_FILE_BYTES.toLocaleString()} bytes`,
  )
  expect(() => document.save("\n".repeat(MAX_FILE_LINES))).toThrow(
    `buffer exceeds ${MAX_FILE_LINES.toLocaleString()} lines`,
  )
  expect(existsSync(path)).toBe(false)
  expect(document.snapshot.dirty).toBe(true)
})

test("opening another file replaces the active document and preserves subscriptions", () => {
  const dir = mkdtempSync(join(tmpdir(), "editor-document-test-"))
  dirs.push(dir)
  const firstPath = join(dir, "first.txt")
  const secondPath = join(dir, "second.txt")
  writeFileSync(firstPath, "first")
  writeFileSync(secondPath, "second")
  const document = openDocument(firstPath)
  const snapshots: DocumentSnapshot[] = []
  document.onDidChange((snapshot) => snapshots.push(snapshot))
  document.markChanged()
  let replacement = ""

  document.open(secondPath, (text) => {
    replacement = text
  })

  expect(replacement).toBe("second")
  expect(document.snapshot).toEqual({ path: secondPath, version: 3, dirty: false })
  expect(snapshots.at(-1)).toEqual(document.snapshot)
  document.markChanged()
  document.save("updated")
  expect(readFileSync(secondPath, "utf8")).toBe("updated")
  expect(readFileSync(firstPath, "utf8")).toBe("first")
})

test("a failed open leaves the active document untouched", () => {
  const dir = mkdtempSync(join(tmpdir(), "editor-document-test-"))
  dirs.push(dir)
  const firstPath = join(dir, "first.txt")
  const oversizedPath = join(dir, "large.txt")
  writeFileSync(firstPath, "first")
  writeFileSync(oversizedPath, Buffer.alloc(MAX_FILE_BYTES + 1, 120))
  const document = openDocument(firstPath)
  let replaced = false

  expect(() => document.open(oversizedPath, () => (replaced = true))).toThrow("not supported")
  expect(replaced).toBe(false)
  expect(document.snapshot).toEqual({ path: firstPath, version: 1, dirty: false })
})
