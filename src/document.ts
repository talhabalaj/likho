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

// ponytail: OpenTUI currently exports at most 1 MiB; remove this guard when it supports chunked reads.
export const MAX_FILE_BYTES = 900_000

export interface DocumentSnapshot {
  readonly path: string
  readonly text: string
  readonly version: number
  readonly dirty: boolean
}

export interface EditorDocument {
  readonly snapshot: DocumentSnapshot
  replaceText(text: string): void
  save(): void
  onDidChange(
    listener: (snapshot: DocumentSnapshot) => void,
    onError?: (error: unknown) => void,
  ): { dispose(): void }
}

function readDocument(path: string): string | null {
  if (!existsSync(path)) return null
  const stat = statSync(path)
  if (!stat.isFile()) throw new Error(`Not a file: ${path}`)
  if (stat.size > MAX_FILE_BYTES) throw new Error(`Files over ${MAX_FILE_BYTES.toLocaleString()} bytes are not supported yet`)
  return readFileSync(path, "utf8")
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

export function openDocument(path: string): EditorDocument {
  // Preserve a user-facing symlink while atomically replacing the file it resolves to.
  const storagePath = existsSync(path) ? realpathSync(path) : path
  let savedText = readDocument(storagePath)
  let text = savedText ?? ""
  let version = 1
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
    get snapshot() {
      return { path, text, version, dirty: text !== (savedText ?? "") }
    },
    replaceText(nextText) {
      if (nextText === text) return
      text = nextText
      version++
      emit(this.snapshot)
    },
    save() {
      if (Buffer.byteLength(text) > MAX_FILE_BYTES) {
        throw new Error(`Save blocked: buffer exceeds ${MAX_FILE_BYTES.toLocaleString()} bytes`)
      }
      if (readDocument(storagePath) !== savedText) throw new Error("Save blocked: file changed on disk")
      replaceDocument(storagePath, text, savedText)
      savedText = text
      emit(this.snapshot)
    },
    onDidChange(listener, onError = () => {}) {
      listeners.set(listener, onError)
      return { dispose: () => listeners.delete(listener) }
    },
  }
}
