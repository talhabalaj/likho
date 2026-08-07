# Plugin architecture research

Research date: 2026-08-08. Sources are limited to official documentation, repositories, and package metadata. The design is for the current Bun/TypeScript/OpenTUI editor in `src/index.ts`; no application code was changed.

## Recommendation

Use a **trusted, in-process built-in plugin host** with one plugin entry point, a host-owned lifecycle, namespaced commands, and narrow editor capabilities. Implement its command/keybinding and UI seams with the OpenTUI modules that already exist:

- [`@opentui/core@0.5.1` plugin slots](https://opentui.com/docs/plugins/slots/) for named UI regions and lifecycle-aware renderable contributions. This version is already installed.
- [`@opentui/keymap@0.5.1`](https://opentui.com/docs/keymap/overview/) for commands, platform-aware bindings, focus/context layers, precedence, chords, discovery, and cleanup. It is the matching official OpenTUI package, but is not installed in this repository yet.

Do not build an extension marketplace, manifest resolver, dependency injection container, child-process host, or WASM runtime now. Built-ins are compiled with the application and trusted. Add external plugins only after the in-process interface has survived several real built-ins; external code requires a separate security and compatibility design, not merely `import()`.

Keep a small kernel. The edit buffer, safe load/save rules, dirty-state truth, render loop, plugin host, and shutdown are invariants, not optional plugins. Commands such as Save and Close can be contributed by built-ins, but their handlers must call the kernel's safe document operations rather than reimplement file writes.

## What exists in the current editor

The current `src/index.ts` is a useful prototype but one closure owns almost everything:

- document I/O and overwrite protection;
- OpenTUI renderer, textarea, line-number wrapper, title, and status bar;
- raw key dispatch for save/copy/cut/tab/close;
- Tree-sitter client, debounce, decoration application, and cleanup;
- dirty state, quit confirmation, signals, and renderer shutdown.

The first architecture seam should therefore be between the **editor kernel** and **built-in features**, not between dozens of one-class modules. The highest-leverage migrations are command/keybinding dispatch, syntax highlighting, and UI contributions. Splitting pure helpers into interfaces would add files without adding replaceable behavior.

## Primary-source findings

### OpenTUI: use its current primitives instead of inventing registries

OpenTUI 0.5.1 already ships a generic `SlotRegistry`, a core `CorePlugin` adapter, `SlotRenderable`, deterministic ordering, setup/disposal hooks, duplicate-ID rejection, error events, and renderer-scoped cleanup. Slots support `append`, `replace`, and `single_winner`; the host owns layout and type contracts while plugins receive only the host context and slot data. Core slot renderers are synchronous and return `BaseRenderable` nodes. See the official [plugin-slot model](https://opentui.com/docs/plugins/slots/) and [core slot API](https://opentui.com/docs/plugins/core/).

Concrete implication: use slots for places such as `editor-frame`, `status-left`, `status-right`, `sidebar`, and `panel`. Do not use the slot registry as a general event bus or command system. A line-number built-in can own the single `editor-frame` winner that wraps the textarea; competing wrappers should not be composed implicitly.

OpenTUI also documents Bun runtime support for loading plugin modules from disk, including standalone executables. That support resolves external modules against the host's OpenTUI runtime instances; it is a module-loading mechanism, **not a permission sandbox**. See [core runtime-loaded plugins](https://opentui.com/docs/plugins/core/#runtime-loaded-external-plugins).

The official `@opentui/keymap` host adapter already understands OpenTUI focus, renderable ancestry, key press/release streams, renderable destruction, renderer destruction, and runtime platform metadata. Its host metadata identifies macOS/Windows/Linux, selects `super` as the primary modifier on macOS and `ctrl` on Windows/Linux, and records whether the terminal can actually deliver enhanced modifiers. See [keymap hosts](https://opentui.com/docs/keymap/hosts/).

The keymap engine registers commands and bindings in focus-aware layers. Higher priority wins, then newer layers; registration returns a disposer. It supports sequences, runtime conditions, command queries for a command palette, and explicit `not-found`, `inactive`, `disabled`, `rejected`, and `error` results. See the official [core keymap contract](https://opentui.com/docs/keymap/core/). This directly replaces the current bottom-of-file `if/else` key handler and the hand-written macOS modifier check.

### VS Code: the strongest lifecycle and integration model

VS Code separates static contribution metadata, activation events, and runtime registrations. Commands have stable IDs: the manifest makes a command discoverable, while `registerCommand` binds its handler. [Extension anatomy](https://code.visualstudio.com/api/get-started/extension-anatomy), [contribution points](https://code.visualstudio.com/api/references/contribution-points), and the [command guide](https://code.visualstudio.com/api/extension-guides/command) describe this split.

Extensions activate once on declared events; unconditional `*` startup activation is discouraged. Registrations and event subscriptions return `Disposable` objects, and `ExtensionContext.subscriptions` is disposed when the extension deactivates. The typed event interface returns a disposable that unsubscribes the listener. See [activation events](https://code.visualstudio.com/api/references/activation-events) and the official [`Disposable`, `Event`, and `ExtensionContext` reference](https://code.visualstudio.com/api/references/vscode-api).

VS Code runs extensions in an Extension Host rather than allowing direct workbench DOM access. This protects UI responsiveness and keeps the editor UI behind a supported interface, but the Node extension host still has the user's OS permissions. Workspace Trust reduces accidental workspace-triggered execution; it cannot make a malicious installed extension safe. See [Extension Host](https://code.visualstudio.com/api/advanced-topics/extension-host), [Extension Capabilities](https://code.visualstudio.com/api/extension-capabilities/overview), and [Workspace Trust](https://code.visualstudio.com/docs/editing/workspaces/workspace-trust).

Its manifest carries a SemVer package version, an `engines.vscode` compatibility range, runtime location preferences, dependency IDs, and workspace capabilities. See [Extension Manifest](https://code.visualstudio.com/api/references/extension-manifest). For this editor, copy the lifecycle and stable command IDs now; defer manifests and API ranges until third-party packages exist.

### Zed: a useful model for constrained external extensions

Zed extensions are repositories with an `extension.toml` containing identity, version, and schema version. Supported contribution types are deliberately narrow: languages, themes, debuggers, snippets, icon themes, and MCP servers. Procedural extensions are Rust compiled to WebAssembly against a host-defined interface. See [Developing Extensions](https://zed.dev/docs/extensions/developing-extensions) and the current [`zed_extension_api::Extension` trait](https://docs.rs/zed_extension_api/latest/zed_extension_api/trait.Extension.html).

Zed now enforces user-configurable capabilities for process execution, downloads, and npm installation; denied operations return errors, and grants can be narrowed by executable/arguments, host/path, or package. See [Extension Capabilities](https://zed.dev/docs/extensions/capabilities).

Concrete implication: if this editor later loads untrusted plugins, expose host-mediated operations such as process execution and downloads. Do not hand plugins Bun/Node globals and call a manifest permission list a sandbox. WASM or a child process is a separate phase because it requires a serializable interface, resource limits, cancellation, and host-mediated I/O.

### Neovim: productive trusted scripting, weak isolation

Neovim treats files in the correct runtime directories as plugins; there is no required manifest or registration step. Startup sources `plugin/**/*.vim` and `plugin/**/*.lua`, while optional packages can be activated with `:packadd`. Official guidance says eager plugin files should stay small and defer expensive `require()` calls until a command or mapping is used. See [Lua plugin development](https://neovim.io/doc/user/lua-plugin/), [startup plugin loading](https://neovim.io/doc/user/starting/), and [packages](https://neovim.io/doc/user/pack/).

Its stable extension vocabulary is excellent: user commands, keymaps, autocommands, buffer-local scope, descriptions, and explicit deletion. See the [Lua guide](https://neovim.io/doc/user/lua-guide/). Remote plugins run as RPC coprocesses and use a generated manifest so language hosts start only when their declared command/event is first needed. See [remote plugins](https://neovim.io/doc/user/remote_plugin/).

Concrete implication: copy the command/event/keymap vocabulary and cheap registration. Do not copy global runtime-path sourcing or unrestricted in-process scripts if the goal includes safely installing third-party code.

### Eclipse Theia: two extension tiers, but too much machinery for this app

Theia distinguishes compile-time Theia extensions, which have broad access through dependency injection, from runtime VS Code extensions/plugins, which run in dedicated processes against a restricted interface. Theia itself is assembled from compile-time extensions. See [Extensions and Plugins](https://theia-ide.org/docs/extensions/), [Architecture Overview](https://theia-ide.org/docs/architecture/), and [Services and Contributions](https://theia-ide.org/docs/services_and_contributions/).

This cleanly demonstrates a useful distinction: trusted product modules and installable runtime extensions need not have the same power. It does **not** justify adding Inversify or a global DI container here. A composition root plus constructor/context injection is enough for one TUI process.

### Helix: not a production plugin contract to copy

Helix's official plugin discussion remains a design exploration rather than a stable extension interface; its WebAssembly proposal is marked not planned, and the broader discussion records several competing Scheme/Rust/WASM directions. See the official [plugin-system discussion](https://github.com/helix-editor/helix/discussions/3806) and [WebAssembly plugin discussion](https://github.com/helix-editor/helix/discussions/10225). Helix is useful evidence that adding a plugin runtime too early can consume years of design effort; it does not provide a current contract for this TypeScript editor to adopt.

## Four viable architecture shapes

| Shape | How it works | Strengths | Costs | Fit now |
| --- | --- | --- | --- | --- |
| **A. Trusted built-ins behind one activation interface** | Statically import a list of feature plugins. The host provides narrow document/command/UI capabilities and owns cleanup. OpenTUI keymap and slots are hidden implementation. | Small, testable, fast, supports reload in tests, preserves a future process seam. | No security isolation; the interface must be kept conservative. | **Recommended.** |
| **B. Manifest-first contribution system** | JSON/TOML declares commands, keybindings, activation events, UI slots, version, and dependencies; runtime code activates lazily. | Discoverable without execution; compatible with package distribution; VS Code-like. | Schema, validator, resolver, dependency graph, migrations, diagnostics, and lazy-loading edge cases. | Add only when external packages or measurable startup cost exist. |
| **C. Neovim-style in-process scripts** | Discover TS/JS files in a directory and dynamically import them with the host object. | Minimal author friction and full power. | Trusted arbitrary code, API coupling, difficult unload, dependency/version conflicts, one plugin can block/crash input. | Acceptable only as an explicitly unsafe developer mode. |
| **D. Isolated child-process or WASM extensions** | Host and plugin exchange serializable commands/events through RPC or WIT; permissions gate filesystem/network/process access. | Crash containment, enforceable capabilities, language/runtime flexibility. | Largest interface and operational cost; latency, cancellation, backpressure, serialization, process supervision, debugging, and compatibility. | Third-party ecosystem phase, not built-in architecture. |

## Four code-level designs considered

The ecosystem choices above still leave several ways to organize trusted built-ins inside this TypeScript process. These are the realistic code boundaries for this repository.

### 1. Common setup functions

```ts
type Builtin = (context: Readonly<PluginContext>) => void | Disposable

const builtins: readonly Builtin[] = [fileCommands, syntaxHighlighting, statusBar]
for (const setup of builtins) setup(context)
```

This is the smallest valid plugin architecture: a feature is a function called by one composition root. It has excellent locality and almost no framework code. It becomes awkward as soon as startup errors need a plugin identity, asynchronous activation needs rollback, or the editor must dispose features in reverse order. Adding those needs naturally turns the common caller into Design 2.

### 2. Identified activation modules

```ts
interface BuiltinPlugin {
  readonly id: `builtin.${string}`
  activate(context: Readonly<PluginContext>): void | Promise<void>
}
```

This adds only the identity required for diagnostics and lifecycle ownership. Registrations still happen through narrow capabilities on the context, so commands, keybindings, events, and UI slots keep their own purpose-built APIs. It provides the deepest useful seam for the least machinery and is the recommendation below.

### 3. Declarative descriptor plus activation

```ts
interface BuiltinDescriptor {
  readonly id: `builtin.${string}`
  readonly contributes: {
    readonly commands?: readonly CommandDeclaration[]
    readonly keybindings?: readonly KeybindingDeclaration[]
    readonly slots?: readonly SlotDeclaration[]
  }
  activate(context: Readonly<PluginContext>): void | Promise<void>
}
```

This makes contributions inspectable before executing code, which helps a marketplace, compatibility checks, command discovery, and lazy activation. For compiled built-ins it duplicates facts between the descriptor and registrations, requires schema validation, and creates two sources of lifecycle truth. The current command registry can already power a palette after activation, so the descriptor has no present job.

### 4. Generic service container or event/reducer bus

```ts
interface Plugin {
  register(services: ServiceRegistry, events: EventBus): void
}
```

This is superficially the most flexible: plugins can publish services, replace implementations, and react to generic messages. It is also the shallowest interface. Callers must know service keys and payload conventions, dependency errors move to runtime, event ownership becomes hard to trace, and editor invariants can be bypassed. A reducer variant additionally forces OpenTUI objects, Tree-sitter resources, and filesystem effects through a state-machine abstraction that this imperative TUI does not need.

| Code design | Ceremony | Lifecycle/error ownership | Locality | External-plugin path | Decision |
| --- | ---: | --- | --- | --- | --- |
| common setup functions | lowest | weak without adding a host | excellent | poor | valid first rung, but just short of current needs |
| identified activation modules | low | strong | good | preserves a future adapter seam | **use now** |
| descriptor + activation | medium/high | strong | split between metadata and code | good | defer until pre-execution discovery is required |
| generic services/events | high and unbounded | diffuse | poor | technically flexible, hard to stabilize | reject |

The recommendation is intentionally not “maximum flexibility.” The plugin context is an anti-corruption boundary: it exposes the few editor operations built-ins actually share, while concrete OpenTUI objects and file-safety rules remain local to their owning modules.

## Design A — minimal interface, maximum leverage

### Interface

The external seam for built-in authors has one entry point: `activate`. `id` is identity, not another operation.

```ts
interface BuiltinPlugin {
  readonly id: `builtin.${string}`
  activate(context: Readonly<PluginContext>): void | Promise<void>
}

interface PluginContext {
  readonly document: EditorDocument
  readonly commands: CommandContributions
  readonly ui: UiContributions
  readonly subscriptions: DisposableStore
}

interface Disposable {
  dispose(): void
}
```

The three capability facets are intentionally behavioral:

- `document`: current text/path/version/dirty state, safe save/edit operations, and typed document/cursor events;
- `commands`: register a namespaced command plus optional OpenTUI keymap bindings/conditions, execute/query commands, and get a disposable registration;
- `ui`: publish decorations/messages and contribute only to host-defined OpenTUI slots;
- `subscriptions`: host-owned collection for timers, event listeners, Tree-sitter resources, command layers, and UI contributions.

`subscriptions` is lifecycle bookkeeping rather than a feature capability. Registration helpers should add their returned disposable automatically; the explicit store remains for resources such as timers and Tree-sitter clients.

Do not expose `CliRenderer`, `TextareaRenderable`, mutable application state, Node `fs`, `Bun.spawn`, or another plugin instance through this interface. Trusted UI adapters inside `ui` may use renderables, but that is a separate, explicitly OpenTUI-coupled seam.

### Invariants

1. Plugin IDs and command IDs are globally unique. Built-ins use `builtin.*`; commands use domain names such as `file.save` and `editor.copy`.
2. The host activates each plugin at most once per editor session.
3. Every registration/resource is owned by exactly one plugin and disposed exactly once in reverse activation order.
4. A plugin cannot directly import another plugin. Integration is through command IDs, typed events, or document/UI capabilities.
5. The kernel alone owns document version, dirty truth, conflict-safe saving, the active textarea, and terminal shutdown.
6. UI slots have host-defined types and ordering. Structural slots such as `editor-frame` use `single_winner`; additive status/panel slots use deterministic order.
7. Core OpenTUI slot render callbacks remain synchronous. Expensive work runs asynchronously, is cancellable, and applies results only if the document version still matches.

### Startup and shutdown order

1. Parse arguments and load the document through the safe document module.
2. Create the OpenTUI renderer, textarea, keymap host, core slot registry, and per-session context implementation.
3. Activate the explicit built-in list in order. A short list is clearer than dependency sorting.
4. Mount slot renderables, focus the editor, and begin accepting input.
5. On close: stop accepting commands, dispose plugin stores in reverse order, then destroy the renderer and restore the terminal.

Tree-sitter highlighting is therefore disposed before its textarea/renderer. OpenTUI's [lifecycle guide](https://opentui.com/docs/core-concepts/lifecycle/) confirms that `renderer.destroy()` restores terminal state and destroys the renderable tree; plugin-owned resources must be cleaned before that final teardown.

### Error modes

- Duplicate plugin or command ID: reject activation and report the exact ID.
- Activation throws/rejects: dispose everything already collected for that plugin, mark it failed, continue starting independent built-ins, and surface one status/log error.
- Command handler throws: return a structured error and keep the input loop alive. OpenTUI keymap already reports command errors diagnostically.
- Event listener throws: report it against the owning plugin; do not abort delivery to other listeners.
- Slow synchronous handler: log elapsed time in development; move filesystem, LSP, formatters, and parsing off the keypress path.
- Async stale result: compare the captured document version before applying edits/decorations; discard on mismatch.
- Disposal throws: record it and continue disposing remaining plugins.

### Usage example

```ts
export const fileCommands: BuiltinPlugin = {
  id: "builtin.file-commands",
  activate(ctx) {
    const primary = ctx.commands.primaryModifier // "super" on macOS, "ctrl" elsewhere

    ctx.subscriptions.add(
      ctx.commands.register({
        id: "file.save",
        title: "Save",
        bindings: [`${primary}+s`],
        run: () => ctx.document.save(),
      }),
    )
  },
}
```

The built-in knows neither the renderer's key event shape nor how safe saving works. The commands adapter translates this registration into an `@opentui/keymap` layer; the document module preserves the existing external-change protection.

### Implementation hidden behind the seam

- `PluginHost`: creates a child context and disposable store per plugin, activates sequentially, catches failures, and disposes in reverse.
- `OpenTuiCommandAdapter`: maps commands/bindings to `@opentui/keymap`, uses host platform metadata, and exposes command queries for the future palette.
- `OpenTuiUiAdapter`: maps named UI contributions to `createCoreSlotRegistry`, `registerCorePlugin`, and `SlotRenderable`; maps decorations to textarea highlights.
- `EditorDocument`: owns current text/version/dirty state, safe filesystem persistence, and typed change events.
- Composition root: builds concrete modules and lists built-ins. No plugin performs global discovery.

### Dependency direction and adapters

```text
main/composition root
  -> editor kernel
  -> plugin host + BuiltinPlugin interface
       <- built-in feature plugins
       -> OpenTUI command/UI adapters
            -> @opentui/keymap and @opentui/core
       -> safe document implementation
            -> node:fs
```

Built-ins depend inward on the plugin interface, not outward on `src/index.ts`. The kernel depends on no built-in. The composition root is the only place that knows the concrete list.

Do not create ports for `node:fs`, clocks, or OpenTUI merely to satisfy a diagram. The current filesystem behavior is already testable with temporary directories, and OpenTUI supplies a testing renderer. Add a port only when a second real adapter exists. A future RPC/WASM host would be a second adapter at the plugin seam and would justify serializable capability types.

### SOLID, applied without ceremony

- **Single responsibility:** the kernel protects editor invariants; the host owns plugin lifetime; each built-in owns one feature.
- **Open/closed:** a built-in is added to the composition list rather than adding branches to the global key handler.
- **Liskov substitution:** any plugin obeying activation/lifecycle invariants can be enabled, disabled, or tested through the same seam.
- **Interface segregation:** plugins receive document, command, and UI capabilities, not the whole application/renderer.
- **Dependency inversion:** feature code depends on the plugin interface; concrete OpenTUI and filesystem behavior stay behind adapters/modules.

### Trade-offs

This interface is deep because one activation call grants commands, keymaps, events, decorations, UI slots, error ownership, and deterministic cleanup without exposing their machinery. Its main cost is that built-ins remain trusted in-process code. It also deliberately does not promise arbitrary UI replacement or raw operating-system access.

The interface should grow only from two demonstrated built-ins needing the same capability. Avoid one interface per feature and avoid a generic `getService<T>(string)` escape hatch; both move implementation knowledge back into callers.

## Mapping current features into the design

| Current concern | Destination |
| --- | --- |
| argument parsing, load limits, safe overwrite checks, dirty/version truth | kernel `EditorDocument` |
| renderer, textarea, focus, terminal restoration | OpenTUI kernel adapter |
| save/copy/cut/close command handlers | `builtin.file-commands` / `builtin.edit-commands` |
| macOS versus other default keys | `builtin.vscode-keymap` backed by OpenTUI host metadata |
| title/status content | additive UI slot built-in |
| line-number wrapper and gutter scrolling | single-winner `editor-frame` UI built-in, once the structural slot exists |
| Tree-sitter client, debounce, highlighting, cleanup | `builtin.syntax-highlighting` using document versions and a decoration owner |
| SIGTERM/SIGHUP and final renderer destruction | kernel/plugin host shutdown |

Migrate one feature at a time; do not rewrite the editor around an empty plugin framework. The first executable slice should install `@opentui/keymap`, introduce the host/context, and move only Save/Close bindings. That proves command registration, macOS mapping, errors, and cleanup before syntax/UI are moved.

## Main CLI and session architecture

The CLI is the composition root and process policy owner; it is never a plugin. Keep two deep function Modules instead of exposing a mutable application object or a public start/stop sequence.

### External Interfaces

```ts
type CliSignal = "SIGHUP" | "SIGINT" | "SIGTERM"

type CliResult = Readonly<{
  exitCode: 0 | 1 | 2 | 129 | 130 | 143
  stdout?: string
  stderr?: string
}>

type EditFile = (request: Readonly<{
  filePath: string
  signal: AbortSignal
}>) => Promise<
  | { kind: "closed" }
  | { kind: "signal"; signal: CliSignal }
>

export function runCli(
  argv: readonly string[],
  options: Readonly<{ signal: AbortSignal; editFile?: EditFile }>,
): Promise<CliResult>

export function runEditorSession(request: Readonly<{
  filePath: string
  signal: AbortSignal
}>): Promise<
  | { kind: "closed" }
  | { kind: "signal"; signal: CliSignal }
>
```

`runCli` is the CLI Seam. It hides argument parsing, path resolution, session invocation, error normalization, and exit-code mapping. Its optional `editFile` function is the whole test Seam; production uses `runEditorSession`, while CLI tests use one fake function.

`runEditorSession` is the editing-lifetime Seam. Its implementation owns the monotonic state machine `new -> starting -> running -> closing -> closed`, the document, OpenTUI objects, plugin host, close confirmation, subscriptions, and one completion promise. It does not return a public session with `start`, `stop`, `mount`, or renderer getters because those would push ordering knowledge into callers.

The renderer factory is an internal Seam: production uses `createCliRenderer`, session tests use OpenTUI's existing `createTestRenderer`. Do not invent a renderer Interface around OpenTUI. Both Adapters already return `CliRenderer`.

### Process Adapter

`src/index.ts` should contain only the shebang and operating-system integration:

```ts
const controller = new AbortController()
const listeners: Array<() => void> = []
for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"] as const) {
  const abort = () => {
    for (const dispose of listeners.splice(0)) dispose()
    controller.abort({ kind: "signal", signal })
  }
  process.once(signal, abort)
  listeners.push(() => process.off(signal, abort))
}

try {
  const result = await runCli(process.argv.slice(2), { signal: controller.signal })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  process.exitCode = result.exitCode
} finally {
  for (const dispose of listeners) dispose()
}
```

The real implementation should keep the top-level error formatter around this block. No library Module calls `process.exit()`: setting `exitCode` leaves time for terminal restoration and plugin disposal. The first signal removes all graceful handlers before aborting, so a second signal falls back to normal operating-system behavior.

Raw-mode `Ctrl+C` remains an editor keybinding for Copy because OpenTUI is created with `exitOnCtrlC: false`. An actual externally delivered `SIGINT` still follows the process cancellation path. `Cmd+W` may be consumed by the terminal, so the VS Code keymap built-in must retain a terminal-deliverable Close command such as `Ctrl+Q`.

### Session startup and teardown

```text
parse argv
  -> open and validate document
  -> create renderer and base textarea
  -> create command/keymap/UI adapters and plugin host
  -> activate explicit built-ins
  -> mount, focus, accept input
  -> await confirmed close or AbortSignal
  -> stop accepting commands
  -> cancel async work and dispose built-ins in reverse
  -> detach listeners and destroy renderer last
```

Opening the document before entering terminal raw mode means invalid paths and oversized files fail without requiring terminal recovery. Every later startup step registers its cleanup immediately, so partial startup and normal shutdown use the same `finally` path.

Session invariants:

1. The first close reason wins; shutdown is idempotent.
2. User Close applies the dirty repeat-to-discard rule. A process signal bypasses the interactive prompt but still runs cleanup.
3. Document version and dirty truth have one owner. Plugins can request edits/save/close only through capabilities.
4. No command starts after closing begins.
5. Async syntax and formatting results apply only to the document version they captured.
6. All disposers are attempted even if one fails; the renderer is destroyed last.
7. Save conflicts remain recoverable editor messages, not process failures.

Exit policy stays local to `runCli`: normal close/help is `0`, fatal startup/runtime failure is `1`, usage is `2`, and graceful `SIGHUP`/`SIGINT`/`SIGTERM` map to `129`/`130`/`143`.

### Concrete Module layout

```text
src/
  index.ts                         process Adapter only, about 20 lines
  cli.ts                           runCli, grammar, diagnostics, exit mapping
  document.ts                      text/version/dirty/conflict-safe save Module
  editor-session.ts                OpenTUI composition and lifetime Module
  plugins/
    host.ts                        Plugin Interface, context, activation/disposal
    builtins.ts                    explicit ordered built-in list
    file-commands.ts               Save and Close
    edit-commands.ts               Copy, Cut, Tab and editor actions
    vscode-keymap.ts               platform-aware VS Code bindings
    syntax-highlighting.ts         Tree-sitter and decoration ownership
    formatting.ts                  formatter command/provider when implemented
    chrome.ts                      title/status and structural UI slots
```

Do not create `controllers/`, `services/`, `repositories/`, `factories/`, or an `adapters/` hierarchy. `editor-session.ts` may directly construct OpenTUI because there is one production frontend. `document.ts` may directly use `node:fs` because temporary directories provide local substitution; a filesystem Interface with one production Adapter would be hypothetical.

The file list is a destination, not a one-commit scaffold. Create each built-in file only when that feature moves out of `editor-session.ts`. Until then, ordinary private functions are better than empty wrappers.

### Alternative main-code designs considered

| Design | Depth and Locality | Cost | Decision |
| --- | --- | --- | --- |
| keep the current single `main()` closure | no new machinery, but process, document, UI, feature, and teardown changes collide in one place | poor test Seam and increasingly fragile cleanup | retire incrementally |
| one session file with private `installFeature()` functions | good common-caller Locality and nearly no framework | does not provide the explicitly requested built-in plugin Interface or independent lifecycle/error ownership | useful migration technique, not final shape |
| `runCli` + `runEditorSession` + identified built-ins | small Interfaces hide argv, terminal, document, plugin, and cleanup behavior | a small host and disciplined context must be maintained | **selected** |
| generic `Application`/`Workbench` with document-store and frontend ports | supports multi-file, batch/headless, RPC, and multiple frontends | many speculative Interfaces, synchronization, serialization, and Adapter tests | add only when a second frontend or caller exists |

This placement follows SOLID without turning each letter into a class: CLI policy, document safety, session lifetime, and each feature have one owner; new built-ins extend the explicit list; feature code sees segregated capabilities; and dependencies point toward the plugin Interface. The high-leverage Modules are functions where functions suffice.

### Verification surface

- `runCli`: table tests with a fake `EditFile`; verify usage, resolved path, errors, and exit mapping without starting a terminal.
- `runEditorSession`: OpenTUI `createTestRenderer`, mock keys/mouse, a temporary real file, and an `AbortController`; verify save, dirty close, signals, and teardown.
- `document.ts`: real temporary directories; preserve Unicode, size-limit, and external-change tests without a filesystem mock.
- plugin host: two tiny built-ins; verify duplicate IDs, failed-activation rollback, activation order, and reverse disposal.
- one built executable/PTY smoke test: confirm terminal restoration after close and signal.

## External plugins: explicit later gate

Before enabling a user plugin directory, require all of the following:

1. at least three built-ins have used the same stable interface without reaching for raw internals;
2. a manifest defines unique ID, package version, host interface range, entry point, activation triggers, and requested capabilities;
3. command/event payloads are serializable and versioned;
4. the runtime has timeouts/cancellation, crash reporting, memory/process limits, and deterministic unload;
5. filesystem, network, subprocess, and environment access are host-mediated;
6. compatibility and dependency errors are shown before executing plugin code.

Until then, “plugin” means a statically imported built-in module. That delivers modularity and SOLID dependency direction without pretending trusted Bun code is isolated.

## Primary sources

- OpenTUI: [Plugin slots](https://opentui.com/docs/plugins/slots/), [Core slots](https://opentui.com/docs/plugins/core/), [Keymap overview](https://opentui.com/docs/keymap/overview/), [Keymap core](https://opentui.com/docs/keymap/core/), [Keymap hosts](https://opentui.com/docs/keymap/hosts/), [Lifecycle](https://opentui.com/docs/core-concepts/lifecycle/), [v0.5.1 source](https://github.com/anomalyco/opentui/tree/v0.5.1)
- VS Code: [Extension anatomy](https://code.visualstudio.com/api/get-started/extension-anatomy), [Extension Host](https://code.visualstudio.com/api/advanced-topics/extension-host), [Contribution points](https://code.visualstudio.com/api/references/contribution-points), [Activation events](https://code.visualstudio.com/api/references/activation-events), [Commands](https://code.visualstudio.com/api/extension-guides/command), [API reference](https://code.visualstudio.com/api/references/vscode-api), [Manifest](https://code.visualstudio.com/api/references/extension-manifest), [Workspace Trust](https://code.visualstudio.com/docs/editing/workspaces/workspace-trust)
- Zed: [Developing extensions](https://zed.dev/docs/extensions/developing-extensions), [Capabilities](https://zed.dev/docs/extensions/capabilities), [Extension trait](https://docs.rs/zed_extension_api/latest/zed_extension_api/trait.Extension.html), [extension API README](https://github.com/zed-industries/zed/blob/main/crates/extension_api/README.md)
- Neovim: [Lua plugin guide](https://neovim.io/doc/user/lua-plugin/), [Lua API guide](https://neovim.io/doc/user/lua-guide/), [startup](https://neovim.io/doc/user/starting/), [packages](https://neovim.io/doc/user/pack/), [remote plugins](https://neovim.io/doc/user/remote_plugin/)
- Eclipse Theia: [Extensions and Plugins](https://theia-ide.org/docs/extensions/), [Architecture](https://theia-ide.org/docs/architecture/), [Services and Contributions](https://theia-ide.org/docs/services_and_contributions/)
- Helix: [plugin discussion](https://github.com/helix-editor/helix/discussions/3806), [WASM discussion](https://github.com/helix-editor/helix/discussions/10225)
