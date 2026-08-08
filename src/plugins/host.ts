import type { EditorDocumentView } from "../document"

export interface Disposable {
  dispose(): void | Promise<void>
}

type DisposableInput = Disposable | (() => void | Promise<void>)

export class DisposableStore implements Disposable {
  private disposables: Array<() => void | Promise<void>> = []
  private disposed = false

  add<T extends DisposableInput>(disposable: T): T {
    if (this.disposed) throw new Error("Cannot add to a disposed store")
    this.disposables.push(typeof disposable === "function" ? disposable : () => disposable.dispose())
    return disposable
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    let firstError: unknown
    for (const dispose of this.disposables.reverse()) {
      try {
        await dispose()
      } catch (error) {
        firstError ??= error
      }
    }
    this.disposables = []
    if (firstError) throw firstError
  }
}

export interface BuiltinPlugin<TContext extends object> {
  readonly id: `builtin.${string}`
  activate(context: Readonly<TContext & { subscriptions: DisposableStore }>): void | Promise<void>
}

export interface PluginFailure {
  readonly pluginId: string
  readonly phase: "activate" | "dispose"
  readonly error: unknown
}

export interface CommandContributions {
  readonly platform: "macos" | "windows" | "linux" | "unknown"
  registerCommand(
    command: Readonly<{ id: string; title: string; palette?: boolean; run(): void | Promise<void> }>,
  ): Disposable
  registerBindings(
    bindings: readonly Readonly<{ key: string; command: string }>[],
    options?: Readonly<{
      scope?: "editor" | "global" | Readonly<{ target: object; mode?: "focus" | "focus-within"; priority?: number }>
    }>,
  ): Disposable
  captureKeyInputWhile(active: () => boolean, allowedKeys: readonly string[]): Disposable
  listCommands(): readonly Readonly<{ id: string; title: string; keybinding?: string }>[]
  executeCommand(id: string): boolean
}

export interface EditorActions {
  hasOpenDocument(): boolean
  captureText(): CapturedDocumentRevision
  save(): void
  copy(): void
  cut(): void
  insertTab(): void
  applyText(expectedVersion: number, text: string): boolean
  cancelOpenFileRequest(): void
  requestOpenFile(path: string): boolean
  requestClose(): boolean
  discardAndClose(): void
}

export interface CapturedDocumentRevision {
  readonly text: string
  readonly version: number
}

export interface SyntaxTarget {
  readonly bufferId: number
  getVisibleLineRange(): Readonly<{ start: number; end: number }>
  onVisibleLineRangeChange(
    listener: (range: Readonly<{ start: number; end: number }>) => void,
  ): Disposable
  clear(): void
  add(decoration: Readonly<{ line: number; start: number; end: number; styleId: number; priority: number }>): void
  resolveStyleId(group: string): number | null
}

export interface EditorPluginContext {
  readonly signal: AbortSignal
  readonly document: EditorDocumentView
  readonly commands: CommandContributions
  readonly actions: EditorActions
  readonly syntax: SyntaxTarget
  report(message: string): void
}

export class PluginHost<TContext extends object> implements Disposable {
  private active: Array<{ plugin: BuiltinPlugin<TContext>; subscriptions: DisposableStore }> = []
  private disposed = false

  constructor(
    private readonly context: TContext,
    private readonly onFailure: (failure: PluginFailure) => void = () => {},
  ) {}

  private report(failure: PluginFailure): void {
    try {
      this.onFailure(failure)
    } catch {}
  }

  async activate(plugins: readonly BuiltinPlugin<TContext>[], signal?: AbortSignal): Promise<void> {
    if (this.disposed) throw new Error("Plugin host is disposed")

    const ids = new Set(this.active.map(({ plugin }) => plugin.id))
    for (const plugin of plugins) {
      if (ids.has(plugin.id)) throw new Error(`Duplicate plugin ID "${plugin.id}"`)
      ids.add(plugin.id)
    }

    for (const plugin of plugins) {
      if (signal?.aborted) break
      const subscriptions = new DisposableStore()
      try {
        await plugin.activate({ ...this.context, subscriptions })
        if (signal?.aborted) {
          try {
            await subscriptions.dispose()
          } catch (disposeError) {
            this.report({ pluginId: plugin.id, phase: "dispose", error: disposeError })
          }
          break
        }
        this.active.push({ plugin, subscriptions })
      } catch (error) {
        try {
          await subscriptions.dispose()
        } catch (disposeError) {
          this.report({ pluginId: plugin.id, phase: "dispose", error: disposeError })
        }
        this.report({ pluginId: plugin.id, phase: "activate", error })
      }
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    for (const { plugin, subscriptions } of this.active.reverse()) {
      try {
        await subscriptions.dispose()
      } catch (error) {
        this.report({ pluginId: plugin.id, phase: "dispose", error })
      }
    }
    this.active = []
  }
}
