import { readdir } from "node:fs/promises"
import { basename, isAbsolute, relative, resolve } from "node:path"

export type ExplorerNodeId = string

export interface ExplorerNode {
  readonly id: ExplorerNodeId
  readonly parentId?: ExplorerNodeId
  readonly name: string
  readonly kind: "directory" | "file"
  readonly absolutePath: string
  readonly symbolicLink?: boolean
}

export interface ExplorerSource {
  readonly root: ExplorerNode
  children(directoryId: ExplorerNodeId, signal: AbortSignal): Promise<readonly ExplorerNode[]>
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new DOMException("The operation was aborted", "AbortError")
}

function compareNodes(left: ExplorerNode, right: ExplorerNode): number {
  if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0
}

export class LocalFileSystemExplorerSource implements ExplorerSource {
  readonly root: ExplorerNode
  private readonly workspaceRoot: string

  constructor(workspaceRoot: string) {
    this.workspaceRoot = resolve(workspaceRoot)
    this.root = { id: ".", name: basename(this.workspaceRoot), kind: "directory", absolutePath: this.workspaceRoot }
  }

  async children(directoryId: ExplorerNodeId, signal: AbortSignal): Promise<readonly ExplorerNode[]> {
    throwIfAborted(signal)
    const directoryPath = this.resolveId(directoryId)
    const entries = await readdir(directoryPath, { withFileTypes: true })
    throwIfAborted(signal)

    return entries
      .filter(({ name }) => name !== ".git")
      .map((entry): ExplorerNode => {
        const id = directoryId === "." ? entry.name : `${directoryId}/${entry.name}`
        return {
          id,
          parentId: directoryId,
          name: entry.name,
          kind: entry.isDirectory() ? "directory" : "file",
          absolutePath: resolve(directoryPath, entry.name),
          ...(entry.isSymbolicLink() ? { symbolicLink: true } : {}),
        }
      })
      .sort(compareNodes)
  }

  private resolveId(id: ExplorerNodeId): string {
    if (id === ".") return this.workspaceRoot
    if (!id || isAbsolute(id)) throw new Error(`Invalid Explorer node ID "${id}"`)
    const path = resolve(this.workspaceRoot, ...id.split("/"))
    const fromRoot = relative(this.workspaceRoot, path)
    if (
      !fromRoot ||
      fromRoot === ".." ||
      fromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
      isAbsolute(fromRoot)
    ) {
      throw new Error(`Invalid Explorer node ID "${id}"`)
    }
    return path
  }
}
