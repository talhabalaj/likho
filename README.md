# Likho

Likho is a small, focused terminal text editor built with [Bun](https://bun.sh/) and
[OpenTUI](https://github.com/anomalyco/opentui). It opens quickly, uses familiar VS Code-style
shortcuts, highlights source code with Tree-sitter, and treats saving your work as the feature that
must never be clever.

> Likho is early software. Today it is intentionally a single-file editor, not an IDE.

## Try it

Bun is required.

```sh
bunx likho@latest README.md
```

You can also launch it through npm when Bun is installed:

```sh
npx likho@latest README.md
```

To install the command globally:

```sh
bun add --global likho
likho README.md
```

Passing a path that does not exist opens an empty buffer and creates the file when you save it.

## What works today

- Single-file editing in a full-screen terminal UI
- Line-number gutter, mouse-wheel scrolling, selection, undo, and redo
- Tree-sitter syntax highlighting selected from the file extension
- Prettier formatting selected from the file extension
- Unicode-aware highlight columns and visible tab characters
- Dirty-state, cursor-position, encoding, and shortcut indicators
- OSC 52 clipboard copy and cut when supported by the terminal
- Safe saves that refuse to overwrite a file changed by another process
- A second-close confirmation before discarding unsaved changes
- Graceful `SIGHUP`, `SIGINT`, and `SIGTERM` shutdown
- Built-in commands, keybindings, and highlighting behind a small lifecycle-managed plugin host

## Keybindings

`Mod` means <kbd>Command</kbd> on macOS and <kbd>Ctrl</kbd> on Linux and Windows.

| Action | Shortcut |
| --- | --- |
| Save | `Mod+S` |
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

If the document is dirty, the first close warns you and the second close discards the changes.

## Current limits

- Bun is the supported runtime; the npm package does not run under Node.js alone.
- One file is open per process. There are no tabs, splits, explorer, project model, or settings UI yet.
- Files larger than 900,000 bytes are rejected while OpenTUI's buffer export is limited.
- Syntax highlighting is disabled above 200,000 bytes until edits can be sent incrementally.
- Formatting is disabled above 200,000 bytes to keep the input loop responsive.
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

The normal build writes the Bun entry point to `dist/index.js`. To make a standalone executable for
your current platform:

```sh
bun build --compile src/index.ts --outfile dist/likho
./dist/likho README.md
```

## Project layout

```text
src/index.ts                  process signals and exit status
src/cli.ts                    argument validation and CLI results
src/document.ts               document state and safe-save rules
src/editor-session.ts         OpenTUI session and capability adapters
src/plugins/                  built-in commands, chrome, gutter, formatting, highlighting, and host
test/                         document, CLI, session, packaging, and lifecycle tests
docs/                         design and technology research
```

The editor core owns document safety and terminal lifecycle. Built-ins receive narrow capabilities
for commands, keybindings, syntax decorations, and status messages; OpenTUI-only UI built-ins are
composed with explicit render dependencies. No built-in receives filesystem access through the host.
This keeps today's implementation small while preserving a credible seam for future isolation.

## Status

Likho is pre-1.0 and its interfaces may change. Bug reports and focused contributions are welcome at
[github.com/talhabalaj/likho](https://github.com/talhabalaj/likho).
