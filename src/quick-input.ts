import type { MatchRange } from "./fuzzy-matcher"

export type QuickInputMode = "files" | "commands"

export interface QuickInputItem {
  readonly id: string
  readonly label: string
  readonly description?: string
  readonly matches?: readonly MatchRange[]
  readonly closeBeforeAccept?: boolean
  accept(): boolean | void | Promise<boolean | void>
}

export interface QuickInputProvider {
  prepare(signal: AbortSignal): void | Promise<void>
  search(query: string): readonly QuickInputItem[]
}

export interface QuickInputSnapshot {
  readonly open: boolean
  readonly mode: QuickInputMode
  readonly value: string
  readonly loading: boolean
  readonly error?: string
  readonly items: readonly QuickInputItem[]
  readonly selectedIndex: number
}

export class QuickInput {
  private state: QuickInputSnapshot = {
    open: false,
    mode: "files",
    value: "",
    loading: false,
    items: [],
    selectedIndex: 0,
  }
  private listeners = new Set<(snapshot: QuickInputSnapshot) => void>()
  private generation = 0
  private controller?: AbortController
  private prepared = new Set<QuickInputMode>()
  private preparing = new Map<QuickInputMode, Promise<void>>()

  constructor(private readonly providers: Readonly<Record<QuickInputMode, QuickInputProvider>>) {}

  get snapshot(): QuickInputSnapshot {
    return this.state
  }

  onDidChange(listener: (snapshot: QuickInputSnapshot) => void): { dispose(): void } {
    this.listeners.add(listener)
    return { dispose: () => this.listeners.delete(listener) }
  }

  async open(mode: QuickInputMode): Promise<void> {
    this.controller?.abort()
    this.controller = new AbortController()
    this.prepared = new Set()
    this.preparing = new Map()
    const generation = ++this.generation
    this.state = {
      open: true,
      mode,
      value: mode === "commands" ? ">" : "",
      loading: true,
      items: [],
      selectedIndex: 0,
    }
    this.emit()
    await this.prepare(mode, generation, this.controller.signal)
  }

  async setValue(value: string): Promise<void> {
    if (!this.state.open || !this.controller) return
    const mode: QuickInputMode = value.startsWith(">") ? "commands" : "files"
    this.state = {
      ...this.state,
      mode,
      value,
      loading: !this.prepared.has(mode),
      error: undefined,
      items: this.prepared.has(mode) ? this.state.items : [],
      selectedIndex: 0,
    }
    if (this.prepared.has(mode)) this.refresh()
    else this.emit()
    await this.prepare(mode, this.generation, this.controller.signal)
  }

  move(delta: number): void {
    if (!this.state.open || this.state.items.length === 0) return
    const selectedIndex = Math.max(0, Math.min(this.state.items.length - 1, this.state.selectedIndex + delta))
    if (selectedIndex === this.state.selectedIndex) return
    this.state = { ...this.state, selectedIndex }
    this.emit()
  }

  select(index: number): void {
    if (!this.state.open || index < 0 || index >= this.state.items.length) return
    if (index === this.state.selectedIndex) return
    this.state = { ...this.state, selectedIndex: index }
    this.emit()
  }

  async accept(index = this.state.selectedIndex): Promise<boolean> {
    const item = this.state.items[index]
    if (!this.state.open || !item) return false
    if (item.closeBeforeAccept) this.close()
    try {
      const accepted = (await item.accept()) !== false
      if (accepted && this.state.open) this.close()
      return accepted
    } catch (error) {
      if (!this.state.open) return false
      this.state = { ...this.state, error: error instanceof Error ? error.message : String(error) }
      this.emit()
      return false
    }
  }

  close(): void {
    if (!this.state.open) return
    this.controller?.abort()
    this.controller = undefined
    this.generation++
    this.state = { ...this.state, open: false, loading: false, error: undefined, items: [], selectedIndex: 0 }
    this.emit()
  }

  dispose(): void {
    this.close()
    this.listeners.clear()
  }

  private async prepare(mode: QuickInputMode, generation: number, signal: AbortSignal): Promise<void> {
    if (this.prepared.has(mode)) return
    let pending = this.preparing.get(mode)
    if (!pending) {
      pending = Promise.resolve(this.providers[mode].prepare(signal))
      this.preparing.set(mode, pending)
    }
    try {
      await pending
      if (signal.aborted || generation !== this.generation || !this.state.open) return
      this.prepared.add(mode)
      this.preparing.delete(mode)
      if (this.state.mode === mode) this.refresh()
    } catch (error) {
      if (signal.aborted || generation !== this.generation || !this.state.open) return
      this.preparing.delete(mode)
      this.state = {
        ...this.state,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
        items: [],
        selectedIndex: 0,
      }
      this.emit()
    }
  }

  private refresh(): void {
    const query = this.state.mode === "commands" ? this.state.value.slice(1).trimStart() : this.state.value
    const selectedId = this.state.items[this.state.selectedIndex]?.id
    const items = this.providers[this.state.mode].search(query).slice(0, 100)
    const preservedIndex = selectedId ? items.findIndex(({ id }) => id === selectedId) : -1
    this.state = {
      ...this.state,
      loading: false,
      error: undefined,
      items,
      selectedIndex: preservedIndex >= 0 ? preservedIndex : 0,
    }
    this.emit()
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.state)
  }
}
