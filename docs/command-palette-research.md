# Quick Open and Command Palette fuzzy-search research

Research date: 2026-08-08. Versions and maintenance dates were checked against the projects' official releases and npm registry metadata.

## Recommendation

Use **Fuse.js 7.5.0**, embedded in the editor, behind a small `FuzzyMatcher` interface. Build the panel with OpenTUI 0.5.1 primitives and use two quick-access providers:

- `mod+p` opens the file provider with an empty query.
- `mod+shift+p` opens the same panel in command mode with a leading `>`.
- Typing `>` as the first character after opening `mod+p` immediately switches to the command provider. Deleting it switches back to files.

This matches VS Code's documented Quick Open/Command Palette model: `cmd+p` searches files, `shift+cmd+p` opens commands, and a leading `>` changes the shared input to command mode. VS Code also documents fuzzy matching for both files and commands. [VS Code user interface](https://code.visualstudio.com/docs/editing/userinterface) · [VS Code getting started](https://code.visualstudio.com/docs/editing/getting-started) · [default keybindings](https://code.visualstudio.com/docs/reference/default-keybindings)

Fuse.js is the best default because its current 7.5.0 release was published on 2026-07-13, it is written in TypeScript, has zero runtime dependencies, ships ESM/CJS and typed exports, and returns both normalized scores and character ranges with `includeScore` and `includeMatches`. Its index is built once and reused for each keystroke; result limits can be applied at query time. [Fuse.js 7.5.0 release](https://github.com/krisk/Fuse/releases/tag/v7.5.0) · [Fuse.js options and scoring](https://www.fusejs.io/fuzzy-search.html) · [Fuse.js performance](https://www.fusejs.io/performance.html) · [package exports](https://www.npmjs.com/package/fuse.js/v/7.5.0)

Suggested file matcher configuration:

```ts
new Fuse(files, {
  keys: [
    { name: "baseName", weight: 0.7 },
    { name: "relativePath", weight: 0.3 },
  ],
  includeMatches: true,
  includeScore: true,
  ignoreLocation: true,
  threshold: 0.4,
})
```

Use `search(query, { limit: 100 })`. Tune weights and threshold with repository-path fixtures rather than treating these initial values as API. Commands should use separate keys such as `title`, `category`, and `id`; the two providers should not share one mixed index.

Keep Fuse types behind the adapter: Fuse scores use `0` as best and `1` as worst, while its match ranges are inclusive `[start, end]` pairs. Convert them to a project-owned rank convention and half-open `[start, endExclusive]` ranges once at the boundary so the renderer never depends on Fuse semantics. [Fuse.js scoring](https://www.fusejs.io/fuzzy-search.html) · [Fuse.js match highlighting](https://www.fusejs.io/articles/using-fuse-with-react.html)

## Why not invoke `fzf`?

The official `fzf` is excellent as a standalone finder. Version 0.74.2 was released on 2026-08-01. It has a path-specific scoring scheme, an optimal v2 algorithm, a built-in file walker, incremental interactive search, NUL-safe I/O, mouse controls, and explicit cancellation keys. [fzf 0.74.2 release](https://github.com/junegunn/fzf/releases/tag/v0.74.2) · [tagged README](https://github.com/junegunn/fzf/blob/v0.74.2/README.md) · [tagged manual](https://github.com/junegunn/fzf/blob/v0.74.2/man/man1/fzf.1)

It is the wrong integration boundary for an in-process OpenTUI panel:

- Interactive `fzf` owns terminal input and rendering. Its default is full-screen; `--height` still draws below the current cursor, and `--popup` requires tmux 3.3+ or Zellij 0.44+. The editor would have to suspend and restore OpenTUI or let two renderers race.
- It adds an OS binary prerequisite or requires shipping and updating binaries for every supported architecture. The current OpenTUI package already ships platform-native artifacts, so another binary matrix would increase distribution and release work.
- Non-interactive `fzf --filter=query` avoids the competing UI, but would require a process invocation per query. Its output is ranked strings, not the stable score-and-match-range data the OpenTUI view needs for its own highlighting.
- Cancellation of a spawned process is possible with Bun's `AbortSignal`, but terminal handoff, environment-derived `FZF_DEFAULT_OPTS`, and renderer restoration remain extra failure modes. [Bun subprocess cancellation](https://bun.com/docs/runtime/child-process)

Do not confuse the official Go executable with the unrelated npm package named `fzf`; npm `fzf` is `fzf-for-js`, whose current 0.5.2 package metadata was last modified in 2023. It is not a maintained JavaScript build of the official finder. [npm `fzf`](https://www.npmjs.com/package/fzf)

Keep an external-finder adapter possible later, for users who explicitly choose a suspend-editor/full-screen workflow. It should not implement the default command panel.

## Embedded alternatives

| Option | Current evidence | Useful properties | Decision |
| --- | --- | --- | --- |
| Fuse.js | 7.5.0, released 2026-07-13 | TypeScript, zero dependencies, reusable index, weighted object keys, score and match ranges, typed ESM/CJS package | **Use now**; most current maintained package and sufficient for commands and paths |
| fuzzysort | 3.1.0; package and repository last changed 2024-10-14 | Specifically advertises file-name/path search, exposes `score` and exact `indexes`, supports prepared targets and result limits; project claims under 1 ms for 13,000 files | Strong scoring benchmark candidate, but materially less current than Fuse.js [official repository](https://github.com/farzher/fuzzysort) |
| `@nozbe/microfuzz` | 1.0.0; npm changed 2024-06, repository last changed 2025-05 | Zero dependencies, returns highlight ranges and score, pre-processes a list once; designed for command palettes and labels | Good small fallback, but its own documentation says fuzzysort is better for file paths and its release is older [official repository](https://github.com/Nozbe/microfuzz) |
| uFuzzy | repository active through 2025-10; no npm package | No index/startup cost, precise ranges, customizable sort; project reports 5 ms over 162,000 phrases | Fast, but source-only distribution, regex/charset configuration, and lack of a single score make it more integration work [official repository](https://github.com/leeoniya/uFuzzy) |

The editor's 900 KB limit applies to an opened document's contents, not Quick Open: the fuzzy index stores relative path strings and never reads file bodies. For ordinary repositories, Fuse search on each input event should stay synchronous and immediate. If measured query time later exceeds one frame on very large workspaces, Fuse 7.5 also provides an official worker build; add it only after profiling. [Fuse.js performance guidance](https://www.fusejs.io/performance.html)

## OpenTUI integration

OpenTUI 0.5.1 already supplies the correct UI pieces, but not a fuzzy matcher. `InputRenderable` is a single-line input with `input`, `change`, and `enter` events. `SelectRenderable` supports replaceable options, selection movement, scrolling, and item-selected events. The keymap package has a searchable command catalog, focus-scoped layers, command dispatch, and platform-aware `mod` aliases. [OpenTUI input source](https://github.com/anomalyco/opentui/blob/v0.5.1/packages/core/src/renderables/Input.ts) · [OpenTUI select source](https://github.com/anomalyco/opentui/blob/v0.5.1/packages/core/src/renderables/Select.ts) · [OpenTUI keymap](https://github.com/anomalyco/opentui/blob/v0.5.1/packages/keymap/README.md)

Use those parts as follows:

1. A built-in `quick-input` plugin contributes `workbench.action.quickOpen` and `workbench.action.showCommands`, bound to `mod+p` and `mod+shift+p`.
2. A `QuickInputController` owns the overlay, query, active provider, selected index, and focus restoration. Opening it installs a higher-priority focus-scoped layer for `escape`, `up`, `down`, `enter`, and paging; closing it removes the layer and returns focus to the editor.
3. The query parser recognizes only a leading `>` as the command prefix. The command provider receives the remaining text. Backspacing over `>` returns to the file provider.
4. The file and command providers return a common result shape: `{ id, label, description, rank, matches, accept() }`. The view does not know how files are discovered or commands are executed.
5. `SelectRenderable` can provide the first working list, but its options are plain `name`/`description` strings and cannot style arbitrary matched characters. For VS Code-like match highlighting, compose a small fixed window of `TextRenderable` rows from Fuse match ranges, while retaining the same controller/provider contracts. Do not put fuzzy scoring into the renderable.

Command discovery should extend the existing narrow command facade with catalog/list and dispatch operations instead of reaching into the keymap object. File acceptance should call a workspace/document service; it should not mutate the current document directly from the picker. That separation keeps the built-in feature replaceable and makes the future tab model responsible for dirty-file policy.

## File discovery, cancellation, and incremental behavior

Use a hybrid file source:

1. In a Git worktree, spawn `git ls-files -z --cached --others --exclude-standard`. It includes tracked plus untracked files, applies standard ignore rules, and emits paths verbatim with NUL delimiters. [git-ls-files](https://git-scm.com/docs/git-ls-files)
2. If Git is absent or the directory is not a worktree, fall back to Bun's native async `Glob("**/*").scan({ cwd, onlyFiles: true, dot: true, followSymlinks: false })`, filtering `.git`, `node_modules`, build output, and configured exclusions. Bun documents async scanning and makes `onlyFiles` the default. [Bun Glob](https://bun.com/docs/runtime/glob)

Create one `AbortController` per palette opening and connect it to the editor session signal. Pass the signal to the Git subprocess; while consuming a Bun glob, stop at each iteration when aborted. Also keep a monotonically increasing request generation so results from an older scan/open cannot update a reopened panel.

Build each provider's Fuse index once after discovery and search it directly on every input event—no debounce for the expected corpus. Empty file queries should use a deterministic recent-file/lexical ordering; empty command queries should show registered commands. Cap rendered results, preserve selection by stable result ID across updates, and discard all state on close. This gives immediate incremental search without a subprocess, TTY handoff, or stale-result race.

## Acceptance tests for the implementation plan

- `mod+p` opens file mode; `mod+shift+p` opens command mode with `>` visible.
- Typing `>` first in file mode switches providers; deleting it switches back.
- `mod` resolves to Command on macOS and Control on Windows/Linux through the existing keymap metadata.
- Every keystroke updates ranked results; match ranges highlight the right Unicode string positions.
- Arrow keys, mouse selection/scroll, Enter, Escape, resize, and focus restoration work without editing the document underneath.
- Enter dispatches a palette command through the command service; file acceptance goes through the workspace/document service and obeys dirty-file policy.
- Closing the palette or editor aborts discovery, ignores stale scan results, and leaves no subprocess or focused hidden control.
- Git-ignored paths stay absent in a worktree; non-Git directories still work; filenames containing spaces, newlines, and non-ASCII characters round-trip safely.
- Search fixtures lock down basename preference, directory matching, stable ties, command-title matching, and the 100-result limit.
