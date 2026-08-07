import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openDocument } from "../src/document"

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
  const versions: number[] = []
  const subscription = document.onDidChange((snapshot) => versions.push(snapshot.version))

  document.replaceText("one")
  document.replaceText("one")
  subscription.dispose()
  document.replaceText("two")

  expect(versions).toEqual([2])
})
