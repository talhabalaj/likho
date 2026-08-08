# Likho

Likho is a small, focused terminal text editor built with [Bun](https://bun.sh/) and
[OpenTUI](https://github.com/anomalyco/opentui). It opens quickly, uses familiar VS Code-style
shortcuts and Quick Open, highlights source code with Tree-sitter, and treats saving your work as
the feature that must never be clever.

> Likho is early software. Today it keeps one active file at a time, not a tabbed IDE workspace.

## Try it

Run Likho through npm. npm installs the standalone binary for your operating system and CPU:

```sh
npx likho@latest README.md
```

To install the command globally:

```sh
npm install --global likho
likho README.md
```

You need Node.js 18 or newer to install through npm, but you do not need Bun: the installed editor
is a self-contained executable. npm selects one optional native package for macOS, glibc or musl
Linux, or Windows on ARM64 and x64. The same executables remain available from GitHub Releases.

Passing a path that does not exist opens an empty buffer and creates the file when you save it.
Passing a folder opens workspace mode with the Explorer focused; passing a file keeps the UI
file-only.

```sh
likho .
```

## What works today

- Single-file editing in a full-screen terminal UI
- Line-number gutter, mouse-wheel scrolling, selection, undo, and redo
- Workspace Quick Open with fuzzy file matching and a searchable command palette
- Lazy filesystem Explorer for folder launches, with keyboard and mouse navigation
- Tree-sitter syntax highlighting selected from the file extension
- Prettier formatting selected from the file extension
- Unicode-aware highlight columns and visible tab characters
- Dirty-state, cursor-position, encoding, and shortcut indicators
- OSC 52 clipboard copy and cut when supported by the terminal
- Safe saves that refuse to overwrite a file changed by another process
- Save / Don't Save / Cancel confirmation before closing an unsaved document
- Graceful `SIGHUP`, `SIGINT`, and `SIGTERM` shutdown
- Built-in commands, keybindings, and highlighting behind a small lifecycle-managed plugin host

## Keybindings

`Mod` means <kbd>Command</kbd> on macOS and <kbd>Ctrl</kbd> on Linux and Windows.

| Action | Shortcut |
| --- | --- |
| Save | `Mod+S` |
| Quick Open | `Mod+P` |
| Command palette | `Mod+Shift+P`, or type `>` at the start of Quick Open |
| Show Explorer / toggle focus | `Mod+Shift+E` |
| Toggle Explorer visibility | `Mod+B` |
| Close | `Mod+W` or `Ctrl+Q` |
| Copy | `Mod+C` |
| Cut | `Mod+X` |
| Select all | `Mod+A` |
| Undo | `Mod+Z` |
| Redo | `Mod+Shift+Z`; `Ctrl+Y` also works outside macOS |
| Delete line | `Mod+Shift+K` |
| Format document | `Shift+Option+F` on macOS, `Shift+Alt+F` elsewhere |
| Start/end of visual line | `Home` / `End` |
| Select to start/end of visual line | `Shift+Home` / `Shift+End` |
| Start/end of document | `Command+Up/Down` on macOS, `Ctrl+Home/End` elsewhere |
| Insert a tab | `Tab` |

If the document is dirty, closing opens a Save / Don't Save / Cancel dialog.
Opening another file uses the same two-step confirmation and keeps the picker open until confirmed.
In the Explorer, arrows move and expand/collapse rows, `Enter` opens or toggles the selected row,
and `Escape` returns focus to the editor. Clicking a file opens it, clicking a folder toggles it, and
the mouse wheel scrolls the tree.

## Current limits

- A platform package is roughly 27–48 MB compressed; its installed executable currently occupies
  roughly 77–134 MB, depending on the target.
- One file is active at a time. There are no tabs, splits, multi-root workspaces, or settings UI yet.
- The Explorer appears only for folder launches and does not yet watch, create, rename, or delete files.
- Files larger than 900,000 bytes or 100,000 lines are rejected while OpenTUI's buffer export is limited.
- Syntax highlighting parses the whole document but paints only the viewport plus 10 overscan lines; it is disabled above 200,000 bytes until edits can be sent incrementally.
- Formatting is explicit and available for supported files, but may pause the UI on larger documents.
- Clipboard support depends on the terminal accepting OSC 52.
- The plugin host currently organizes trusted built-ins. It does not load third-party code.

See [ROADMAP.md](ROADMAP.md) for the planned path beyond these constraints.

## Development

```sh
bun install
bun run start -- README.md
```

Before sending a change:

```sh
bun test
bun run typecheck
bun run build
```

The normal build writes the Bun entry point to `dist/index.js`. To make the minified standalone
executable used by releases for your current platform:

```sh
bun build --compile --minify src/index.ts --outfile dist/likho
./dist/likho README.md
```

`bun run release:build` cross-compiles every supported executable into `dist/release` and generates
the npm wrapper plus its eight platform packages in `dist/npm`. The release workflow publishes the
native packages first and `likho` last, so users never receive a wrapper whose exact-version binary
is missing. See [docs/RELEASING.md](docs/RELEASING.md) for the tag flow and one-time npm bootstrap.

If a package manager disables install scripts, run `node postinstall.mjs` inside its installed
`likho` directory or reinstall without `--ignore-scripts`.

## Project layout

```text
src/index.ts                  process signals and exit status
src/cli.ts                    argument validation and CLI results
src/document.ts               document state and safe-save rules
src/editor-session.ts         OpenTUI session and capability adapters
src/explorer-source.ts        lazy local-filesystem Explorer adapter
src/explorer-tree.ts          headless Explorer state and navigation
src/quick-input.ts            Quick Open state, cancellation, selection, and acceptance
src/workspace-files.ts        Git-aware workspace file discovery with a Bun fallback
src/plugins/                  built-in commands, palette UI, chrome, gutter, formatting, and highlighting
npm/                          generated-package installer and ignored-script fallback
test/                         document, CLI, session, packaging, and lifecycle tests
docs/                         design and technology research
```

The editor core owns document safety and terminal lifecycle. Built-ins receive narrow capabilities
for commands, keybindings, syntax decorations, and status messages; OpenTUI-only UI built-ins are
composed with explicit render dependencies. The Explorer plugin receives a narrow `ExplorerSource`
adapter and still opens files only through the editor action boundary. This keeps today's
implementation small while preserving a credible seam for future isolation.

## Status

Likho is pre-1.0 and its interfaces may change. Bug reports and focused contributions are welcome at
[github.com/talhabalaj/likho](https://github.com/talhabalaj/likho).
