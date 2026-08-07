import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { randomUUID } from "node:crypto"
import { basename, dirname, join } from "node:path"

// OpenTUI 0.5.1 currently exports at most 1 MiB. Keep this safely below that ceiling
// until an official release passes the large-buffer compatibility tests.
export const MAX_FILE_BYTES = 900_000
export const MAX_FILE_LINES = 100_000

export interface DocumentSnapshot {
  readonly path: string
  readonly version: number
  readonly dirty: boolean
}

export interface EditorDocumentView {
  readonly snapshot: DocumentSnapshot
  onDidChange(
    listener: (snapshot: DocumentSnapshot) => void,
    onError?: (error: unknown) => void,
  ): { dispose(): void }
}

export interface EditorDocument extends EditorDocumentView {
  readonly initialText: string
  markChanged(): void
  validateText(text: string): void
  open(path: string, replaceText: (text: string) => void): void
  save(text: string): void
}

function countLines(text: string): number {
  let lines = 1
  for (let index = 0; index < text.length; index++) {
    if (text.charCodeAt(index) === 10) lines++
  }
  return lines
}

function assertSupportedText(text: string, action: "open" | "save"): void {
  const bytes = Buffer.byteLength(text)
  if (bytes > MAX_FILE_BYTES) {
    if (action === "open") throw new Error(`Files over ${MAX_FILE_BYTES.toLocaleString()} bytes are not supported yet`)
    throw new Error(`Save blocked: buffer exceeds ${MAX_FILE_BYTES.toLocaleString()} bytes`)
  }

  const lines = countLines(text)
  if (lines > MAX_FILE_LINES) {
    if (action === "open") throw new Error(`Files over ${MAX_FILE_LINES.toLocaleString()} lines are not supported yet`)
    throw new Error(`Save blocked: buffer exceeds ${MAX_FILE_LINES.toLocaleString()} lines`)
  }
}

function readDocument(path: string): string | null {
  if (!existsSync(path)) return null
  const stat = statSync(path)
  if (!stat.isFile()) throw new Error(`Not a file: ${path}`)
  if (stat.size > MAX_FILE_BYTES) throw new Error(`Files over ${MAX_FILE_BYTES.toLocaleString()} bytes are not supported yet`)
  const text = readFileSync(path, "utf8")
  assertSupportedText(text, "open")
  return text
}

function replaceDocument(path: string, text: string, expectedText: string | null): void {
  const directory = dirname(path)
  const temporaryPath = join(directory, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`)
  const mode = existsSync(path) ? statSync(path).mode & 0o777 : undefined
  let descriptor: number | undefined
  let directoryDescriptor: number | undefined

  try {
    descriptor = openSync(temporaryPath, "wx", mode)
    writeFileSync(descriptor, text, "utf8")
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = undefined
    if (mode !== undefined) chmodSync(temporaryPath, mode)
    // Best-effort compare immediately before replacement; portable filesystems offer no atomic text CAS.
    if (readDocument(path) !== expectedText) throw new Error("Save blocked: file changed on disk")
    renameSync(temporaryPath, path)
    if (process.platform !== "win32") {
      directoryDescriptor = openSync(directory, "r")
      fsyncSync(directoryDescriptor)
      closeSync(directoryDescriptor)
      directoryDescriptor = undefined
    }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
    if (directoryDescriptor !== undefined) closeSync(directoryDescriptor)
    rmSync(temporaryPath, { force: true })
  }
}

export function openDocument(initialPath: string): EditorDocument {
  // Preserve a user-facing symlink while atomically replacing the file it resolves to.
  let path = initialPath
  let storagePath = existsSync(path) ? realpathSync(path) : path
  let savedText = readDocument(storagePath)
  let version = 1
  let dirty = false
  const listeners = new Map<(snapshot: DocumentSnapshot) => void, (error: unknown) => void>()
  const emit = (snapshot: DocumentSnapshot) => {
    for (const [listener, onError] of listeners) {
      try {
        listener(snapshot)
      } catch (error) {
        try {
          onError(error)
        } catch {}
      }
    }
  }

  return {
    get initialText() {
      return savedText ?? ""
    },
    get snapshot() {
      return { path, version, dirty }
    },
    markChanged() {
      version++
      dirty = true
      emit(this.snapshot)
    },
    validateText(text) {
      assertSupportedText(text, "save")
    },
    open(nextPath, replaceText) {
      if (nextPath === path) return
      const nextStoragePath = existsSync(nextPath) ? realpathSync(nextPath) : nextPath
      const nextSavedText = readDocument(nextStoragePath)
      if (nextSavedText === null) throw new Error(`File not found: ${nextPath}`)
      replaceText(nextSavedText)
      path = nextPath
      storagePath = nextStoragePath
      savedText = nextSavedText
      version++
      dirty = false
      emit(this.snapshot)
    },
    save(text) {
      assertSupportedText(text, "save")
      if (readDocument(storagePath) !== savedText) throw new Error("Save blocked: file changed on disk")
      replaceDocument(storagePath, text, savedText)
      savedText = text
      dirty = false
      emit(this.snapshot)
    },
    onDidChange(listener, onError = () => {}) {
      listeners.set(listener, onError)
      return { dispose: () => listeners.delete(listener) }
    },
  }
}
