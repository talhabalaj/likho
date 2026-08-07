import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs"

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
  onDidChange(listener: (snapshot: DocumentSnapshot) => void): { dispose(): void }
}

function readDocument(path: string): string | null {
  if (!existsSync(path)) return null
  const stat = statSync(path)
  if (!stat.isFile()) throw new Error(`Not a file: ${path}`)
  if (stat.size > MAX_FILE_BYTES) throw new Error(`Files over ${MAX_FILE_BYTES.toLocaleString()} bytes are not supported yet`)
  return readFileSync(path, "utf8")
}

export function openDocument(path: string): EditorDocument {
  let savedText = readDocument(path)
  let text = savedText ?? ""
  let version = 1
  const listeners = new Set<(snapshot: DocumentSnapshot) => void>()

  return {
    get snapshot() {
      return { path, text, version, dirty: text !== (savedText ?? "") }
    },
    replaceText(nextText) {
      if (nextText === text) return
      text = nextText
      version++
      const snapshot = this.snapshot
      for (const listener of listeners) listener(snapshot)
    },
    save() {
      if (Buffer.byteLength(text) > MAX_FILE_BYTES) {
        throw new Error(`Save blocked: buffer exceeds ${MAX_FILE_BYTES.toLocaleString()} bytes`)
      }
      if (readDocument(path) !== savedText) throw new Error("Save blocked: file changed on disk")
      writeFileSync(path, text, "utf8")
      savedText = text
    },
    onDidChange(listener) {
      listeners.add(listener)
      return { dispose: () => listeners.delete(listener) }
    },
  }
}
