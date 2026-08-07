# Likho roadmap

Likho's direction is a dependable terminal editor that grows in useful layers. The roadmap is ordered
to protect startup time, predictable shortcuts, and file safety as the feature set expands. It is not
a promise of dates, and priorities may move when real usage exposes a better order.

## Foundation — available now

- [x] Open or create one UTF-8 text file
- [x] Edit, select, undo, redo, copy, cut, and save
- [x] VS Code-style cross-platform keybindings
- [x] Line numbers and mouse-wheel scrolling
- [x] Tree-sitter syntax highlighting with Unicode-aware terminal columns
- [x] Dirty-state and cursor-position UI
- [x] External-change protection and unsaved-close confirmation
- [x] Signal-aware startup and teardown
- [x] Lifecycle-managed built-in plugin boundary
- [x] Unit, integration, renderer, and packaging tests
- [x] npm distribution through a Bun executable entry point

## 0.1 — trustworthy distribution

The next release line should make installing and trusting Likho boring.

- [ ] Add CI for tests, type-checking, packaging, and clean working-tree builds
- [ ] Define and test the supported operating-system and terminal matrix
- [ ] Add `--help` and `--version`
- [ ] Publish signed standalone binaries through GitHub Releases
- [ ] Automate npm and binary releases from version tags
- [ ] Add an explicit open-source license
- [ ] Add a short terminal demo and issue templates
- [ ] Make saves atomic while retaining external-change detection
- [ ] Add recovery coverage for interrupted writes and cleanup failures
- [ ] Record startup, memory, and large-buffer baselines to catch regressions

## 0.2 — everyday editing

This milestone should remove the reasons a user has to leave the editor for routine text work.

- [ ] Find, next/previous match, and replace
- [ ] Go to line and a searchable command palette
- [ ] Indent/outdent selections and configure tab width
- [ ] Improve word, paragraph, and selection navigation
- [ ] Preserve and expose line-ending and final-newline choices
- [ ] Show clearer save, conflict, and syntax-highlighting diagnostics
- [ ] Move highlighting to incremental edit updates
- [ ] Replace today's file-size guards with measured large-file behavior
- [ ] Add configurable themes without introducing a settings UI prematurely

## 0.3 — files and workspaces

- [ ] Multiple open buffers with a quick switcher
- [ ] Tabs and split views with explicit focus commands
- [ ] File picker and lightweight project explorer
- [ ] Recent files and optional session restoration
- [ ] File watching with a deliberate reload/diff/keep decision on conflicts
- [ ] Workspace search that streams results and remains cancellable
- [ ] Per-project configuration with documented precedence

## 0.4 — language-aware editing

Language tooling should arrive through standard protocols and remain optional.

- [ ] Language Server Protocol client with cancellable requests
- [ ] Diagnostics and jump-to-diagnostic navigation
- [ ] Go to definition, references, hover, and document symbols
- [ ] Completion with predictable keyboard ownership
- [ ] Document and selection formatting
- [ ] Syntax-tree-aware selection and structural navigation where available
- [ ] Keep startup independent of language servers and degrade cleanly when they fail

## 0.5 — extensibility

The current plugin host is for trusted built-ins. Loading third-party code is gated on a design that
can enforce its promises rather than merely documenting them.

- [ ] Stabilize command, keybinding, document-event, and UI contribution contracts
- [ ] Add command discovery and keybinding-conflict diagnostics
- [ ] Define a versioned, serializable extension protocol
- [ ] Choose an isolated runtime boundary such as a supervised child process or WASM
- [ ] Mediate filesystem, network, process, and clipboard access through explicit capabilities
- [ ] Specify cancellation, resource limits, crash containment, and compatibility policy
- [ ] Build extension development and debugging tools only after the host contract is proven

## 1.0 quality gates

Likho reaches 1.0 when the core editing path is dependable enough that feature growth no longer puts
user files at risk.

- [ ] No known data-loss bugs in supported workflows
- [ ] Automated coverage for supported operating systems and representative terminals
- [ ] Documented recovery behavior for crashes, signals, conflicts, and partial writes
- [ ] Stable CLI, configuration, and document semantics
- [ ] Performance budgets for startup, interaction latency, memory, and large files
- [ ] Accessible documentation for installation, shortcuts, limits, troubleshooting, and upgrades

## Deliberately not goals yet

- Full VS Code compatibility
- An integrated terminal, debugger, source-control UI, or remote-development stack
- Running untrusted plugins in the editor process
- A generic service container or framework before a concrete feature needs it

Those ideas can be revisited after the editing, workspace, and isolation foundations are proven.
