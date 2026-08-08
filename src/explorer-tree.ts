import type { ExplorerNode, ExplorerNodeId, ExplorerSource } from "./explorer-source"

export interface ExplorerRow extends ExplorerNode {
  readonly depth: number
  readonly expanded: boolean
  readonly selected: boolean
  readonly active: boolean
  readonly loading: boolean
  readonly error?: string
}

export interface ExplorerSnapshot {
  readonly rows: readonly ExplorerRow[]
  readonly selectedId?: ExplorerNodeId
  readonly loading: boolean
  readonly error?: string
}

export type ExplorerAction =
  | { readonly type: "initialize" }
  | { readonly type: "refresh" }
  | { readonly type: "move"; readonly delta: number }
  | { readonly type: "select"; readonly id: ExplorerNodeId }
  | { readonly type: "left" }
  | { readonly type: "right" }
  | { readonly type: "activate" }
  | { readonly type: "reveal"; readonly id?: ExplorerNodeId }

export type ExplorerEffect = { readonly type: "open-file"; readonly path: string }

export class ExplorerTree {
  private state: ExplorerSnapshot = { rows: [], loading: false }
  private readonly nodes = new Map<ExplorerNodeId, ExplorerNode>()
  private readonly children = new Map<ExplorerNodeId, readonly ExplorerNodeId[]>()
  private readonly expanded = new Set<ExplorerNodeId>()
  private readonly loading = new Set<ExplorerNodeId>()
  private readonly errors = new Map<ExplorerNodeId, string>()
  private readonly loads = new Map<ExplorerNodeId, { controller: AbortController; generation: number }>()
  private readonly listeners = new Set<(snapshot: ExplorerSnapshot) => void>()
  private selectedId?: ExplorerNodeId
  private activeId?: ExplorerNodeId
  private generation = 0
  private disposed = false

  constructor(private readonly source: ExplorerSource) {
    this.nodes.set(source.root.id, source.root)
    this.expanded.add(source.root.id)
  }

  get snapshot(): ExplorerSnapshot {
    return this.state
  }

  subscribe(listener: (snapshot: ExplorerSnapshot) => void): { dispose(): void } {
    if (this.disposed) return { dispose() {} }
    this.listeners.add(listener)
    return { dispose: () => this.listeners.delete(listener) }
  }

  async dispatch(action: ExplorerAction): Promise<ExplorerEffect | undefined> {
    if (this.disposed) return
    if (action.type === "initialize") {
      await this.loadChildren(this.source.root.id)
      return
    }

    if (action.type === "refresh") {
      await this.refresh()
      return
    }

    if (action.type === "move") {
      const rows = this.visibleRows()
      if (rows.length === 0) return
      const current = Math.max(
        0,
        rows.findIndex(({ id }) => id === this.selectedId),
      )
      const next = Math.max(0, Math.min(rows.length - 1, current + action.delta))
      this.selectedId = rows[next]?.id
      this.publish()
      return
    }

    if (action.type === "select") {
      if (this.visibleRows().some(({ id }) => id === action.id)) {
        this.selectedId = action.id
        this.publish()
      }
      return
    }

    if (action.type === "reveal") {
      await this.reveal(action.id)
      return
    }

    const selected = this.selectedId ? this.nodes.get(this.selectedId) : undefined
    if (!selected) return

    if (action.type === "activate") {
      if (selected.kind === "file") return { type: "open-file", path: selected.absolutePath }
      if (this.expanded.has(selected.id)) this.collapse(selected.id)
      else await this.expand(selected.id)
      return
    }

    if (action.type === "left") {
      if (selected.kind === "directory" && this.expanded.has(selected.id)) {
        this.collapse(selected.id)
        return
      }
      if (selected.parentId && selected.parentId !== this.source.root.id) {
        this.selectedId = selected.parentId
        this.publish()
      }
      return
    }

    if (action.type !== "right" || selected.kind !== "directory") return
    if (!this.expanded.has(selected.id)) {
      await this.expand(selected.id)
    } else {
      const firstChild = this.children.get(selected.id)?.[0]
      if (!firstChild) return
      this.selectedId = firstChild
      this.publish()
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const id of [...this.loads.keys()]) this.cancelLoad(id)
    this.listeners.clear()
  }

  private async expand(id: ExplorerNodeId): Promise<void> {
    this.expanded.add(id)
    this.publish()
    if (!this.children.has(id)) await this.loadChildren(id)
  }

  private async reveal(id: ExplorerNodeId | undefined): Promise<void> {
    this.activeId = undefined
    if (!id) {
      this.publish()
      return
    }
    if (!this.children.has(this.source.root.id)) await this.loadChildren(this.source.root.id)

    const parts = id.split("/")
    for (let index = 0; index < parts.length - 1; index++) {
      const directoryId = parts.slice(0, index + 1).join("/")
      const node = this.nodes.get(directoryId)
      if (!node || node.kind !== "directory") {
        this.publish()
        return
      }
      this.expanded.add(directoryId)
      this.publish()
      if (!this.children.has(directoryId)) await this.loadChildren(directoryId)
    }

    if (this.nodes.has(id)) {
      this.activeId = id
      this.selectedId = id
    }
    this.publish()
  }

  private async refresh(): Promise<void> {
    const selectedId = this.selectedId
    const expanded = new Set(this.expanded)
    for (const id of [...this.loads.keys()]) this.cancelLoad(id)
    this.nodes.clear()
    this.nodes.set(this.source.root.id, this.source.root)
    this.children.clear()
    this.errors.clear()
    this.expanded.clear()
    this.expanded.add(this.source.root.id)
    this.selectedId = undefined

    await this.loadChildren(this.source.root.id)
    await this.reloadExpandedChildren(this.source.root.id, expanded)
    this.selectedId = selectedId
    this.publish()
  }

  private async reloadExpandedChildren(parentId: ExplorerNodeId, expanded: ReadonlySet<ExplorerNodeId>): Promise<void> {
    for (const id of this.children.get(parentId) ?? []) {
      const node = this.nodes.get(id)
      if (!node || node.kind !== "directory" || !expanded.has(id)) continue
      this.expanded.add(id)
      await this.loadChildren(id)
      await this.reloadExpandedChildren(id, expanded)
    }
  }

  private collapse(id: ExplorerNodeId): void {
    this.expanded.delete(id)
    this.cancelLoad(id)
    const selected = this.selectedId
    if (selected && selected !== id && selected.startsWith(`${id}/`)) this.selectedId = id
    this.publish()
  }

  private async loadChildren(directoryId: ExplorerNodeId): Promise<void> {
    this.cancelLoad(directoryId)
    const controller = new AbortController()
    const generation = ++this.generation
    this.loads.set(directoryId, { controller, generation })
    this.loading.add(directoryId)
    this.errors.delete(directoryId)
    this.publish()
    try {
      const children = await this.source.children(directoryId, controller.signal)
      if (controller.signal.aborted || this.loads.get(directoryId)?.generation !== generation) return
      if (directoryId !== this.source.root.id && !this.expanded.has(directoryId)) return
      for (const child of children) this.nodes.set(child.id, child)
      this.children.set(
        directoryId,
        children.map(({ id }) => id),
      )
      if (!this.selectedId) this.selectedId = children[0]?.id
    } catch (error) {
      if (!controller.signal.aborted && this.loads.get(directoryId)?.generation === generation) {
        this.errors.set(directoryId, error instanceof Error ? error.message : String(error))
      }
    } finally {
      if (this.loads.get(directoryId)?.generation === generation) {
        this.loads.delete(directoryId)
        this.loading.delete(directoryId)
        this.publish()
      }
    }
  }

  private cancelLoad(id: ExplorerNodeId): void {
    const pending = this.loads.get(id)
    if (!pending) return
    pending.controller.abort()
    this.loads.delete(id)
    this.loading.delete(id)
  }

  private visibleRows(): ExplorerRow[] {
    const rows: ExplorerRow[] = []
    const appendChildren = (parentId: ExplorerNodeId, depth: number) => {
      for (const id of this.children.get(parentId) ?? []) {
        const node = this.nodes.get(id)
        if (!node) continue
        rows.push({
          ...node,
          depth,
          expanded: node.kind === "directory" && this.expanded.has(id),
          selected: id === this.selectedId,
          active: id === this.activeId,
          loading: this.loading.has(id),
          ...(this.errors.has(id) ? { error: this.errors.get(id) } : {}),
        })
        if (node.kind === "directory" && this.expanded.has(id)) appendChildren(id, depth + 1)
      }
    }
    appendChildren(this.source.root.id, 0)
    return rows
  }

  private publish(): void {
    if (this.disposed) return
    let rows = this.visibleRows()
    if (this.selectedId && !rows.some(({ id }) => id === this.selectedId)) {
      let candidate: ExplorerNodeId | undefined = this.selectedId
      while (candidate && !rows.some(({ id }) => id === candidate)) {
        const knownParent: ExplorerNodeId | undefined = this.nodes.get(candidate)?.parentId
        const separator = candidate.lastIndexOf("/")
        candidate = knownParent ?? (separator >= 0 ? candidate.slice(0, separator) : undefined)
        if (candidate === this.source.root.id) candidate = undefined
      }
      this.selectedId = candidate ?? rows[0]?.id
      rows = this.visibleRows()
    }
    this.state = {
      rows,
      ...(this.selectedId ? { selectedId: this.selectedId } : {}),
      loading: this.loading.size > 0,
      ...(this.errors.has(this.source.root.id) ? { error: this.errors.get(this.source.root.id) } : {}),
    }
    for (const listener of this.listeners) listener(this.state)
  }
}
