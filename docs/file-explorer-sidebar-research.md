# File Explorer sidebar research

Research date: 2026-08-09. Sources are official project documentation, repositories, and package metadata.

## Recommendation

Do not add a tree-view dependency or switch frameworks. Build a project-owned, headless explorer controller, feed it from a lazy local-filesystem Adapter, and render it with OpenTUI 0.5.1 primitives.

The official OpenTUI component catalog has `SelectRenderable` and `ScrollBoxRenderable`, but no tree widget. A current npm search and the active OpenTUI component library `tuiparts` also expose no dedicated tree/file-explorer control. This is a good place for application code rather than another dependency. [OpenTUI renderables](https://opentui.com/docs/core-concepts/renderables/) · [OpenTUI 0.5.1 package](https://www.npmjs.com/package/@opentui/core/v/0.5.1) · [`tuiparts`](https://github.com/tuiparts/tuiparts)

Use custom rows inside `ScrollBoxRenderable`. OpenTUI's scroll box provides vertical scrolling, scrollbars, mouse-wheel handling, child reveal, acceleration, and viewport culling; custom rows preserve control over indentation, disclosure arrows, file icons, selection, active-file state, Git decorations, truncation, and mouse targets. [OpenTUI ScrollBox](https://opentui.com/docs/components/scrollbox/) · [renderable and mouse model](https://opentui.com/docs/core-concepts/renderables/)

Keep the feature as a built-in plugin. The host should expose narrow workspace/document/command capabilities; the plugin should not own filesystem traversal or mutate the active document directly.

Treat folder launch as the workspace boundary. `likho path/to/file` remains a file-only editor with no Explorer contribution; `likho path/to/folder` starts a workspace session with the Explorer visible and focused. This matches VS Code's distinction between opening an individual file and opening a folder, and avoids inventing a project around every file's parent directory.

## Options considered

| Option                                             | Strength                                                                                                                                                                    | Limitation                                                                                                                                                                                                                                                                                                           | Decision                                                                  |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `SelectRenderable`                                 | Selection, keyboard movement, paging, scrolling, and resize behavior are already implemented. [OpenTUI Select](https://opentui.com/docs/components/select/)                 | Its public item shape is a plain name/description/value. Encoding a tree into strings makes disclosure controls, per-segment styling, multiple decorations, and precise mouse targets awkward.                                                                                                                       | Suitable for a throwaway spike, not the final explorer.                   |
| `ScrollBoxRenderable` plus custom rows             | Native scrolling and mouse behavior with complete row rendering control. Viewport culling is available. [OpenTUI ScrollBox](https://opentui.com/docs/components/scrollbox/) | The editor must own selection, flattening, keyboard semantics, and tests. Culling skips offscreen rendering but does not remove child objects.                                                                                                                                                                       | **Use this**, with a small controller independent of OpenTUI.             |
| [`tuiparts`](https://github.com/tuiparts/tuiparts) | Reusable OpenTUI-oriented controls may be useful elsewhere.                                                                                                                 | Its published component list includes controls such as Accordion, Collapsible, Tabs, Input, and Textarea, but no tree/file explorer. Adapting Accordion or Collapsible per directory would still leave navigation, virtualization, and workspace indexing to us.                                                     | Do not add it for this feature.                                           |
| Switch TUI frameworks                              | Another framework could supply a tree widget.                                                                                                                               | It would replace the working editor, command/keymap, Tree-sitter, mouse, and lifecycle integration to avoid implementing one comparatively small view. OpenTUI already exposes the primitives required here and remains the repository's pinned renderer. [OpenTUI repository](https://github.com/anomalyco/opentui) | Reconsider only if broader editor gates fail, not because of the sidebar. |

## Architecture options

Three code shapes were evaluated:

| Design                                                                                                  | Benefit                                                                                                   | Cost                                                                                                                                  | Decision                                                      |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| One built-in plugin containing discovery, state, and OpenTUI rows                                       | Smallest first diff and one public factory.                                                               | Filesystem behavior, navigation semantics, and rendering become one large unit; tests need OpenTUI for logic that should be headless. | Reject as the final shape.                                    |
| Contribution registry for tree providers, decorations, filters, node commands, watchers, and multi-root | Many future extensions can register independently.                                                        | Introduces vocabulary and lifecycle machinery for features not yet accepted into the roadmap.                                         | Defer until two real implementations need an extension point. |
| **Lazy `ExplorerSource` + headless `ExplorerTree` + OpenTUI plugin Adapter**                            | Two narrow Seams, deterministic unit tests, exact filesystem semantics, and no generic service container. | A few more types than the one-plugin design.                                                                                          | **Choose this.**                                              |

The chosen design has a deep Module boundary: callers dispatch explorer actions and observe snapshots; the Module hides lazy loading, expansion, selection repair, flattening, cancellation, and scroll-window state.

## Recommended architecture

### Keep Explorer and Quick Open discovery separate

Quick Open and Explorer answer different questions. Quick Open should keep its existing Git/Bun file discovery. The Explorer should lazily enumerate the actual filesystem so it can show empty directories and ignored files. VS Code likewise hides `.git` and configured `files.exclude` matches by default, while applying `.gitignore` only when `explorer.excludeGitIgnore` is enabled. [VS Code user interface](https://code.visualstudio.com/docs/editing/userinterface)

Share workspace-root resolution, normalized relative-path IDs, and exclusion utilities where they truly match; do not force both features through one cache. The first release can hard-code only the safe `.git` exclusion in the filesystem Adapter and introduce `files.exclude` as configuration later.

Use two narrow Interfaces:

```ts
type ExplorerNodeId = string;

interface ExplorerNode {
  readonly id: ExplorerNodeId;
  readonly parentId?: ExplorerNodeId;
  readonly name: string;
  readonly kind: "directory" | "file";
  readonly absolutePath: string;
}

interface ExplorerSource {
  readonly root: ExplorerNode;
  children(
    directoryId: ExplorerNodeId,
    signal: AbortSignal,
  ): Promise<readonly ExplorerNode[]>;
}

interface ExplorerTree {
  readonly snapshot: ExplorerSnapshot;
  subscribe(listener: (snapshot: ExplorerSnapshot) => void): Disposable;
  dispatch(action: ExplorerAction): ExplorerEffect | undefined;
}
```

`LocalFileSystemExplorerSource` uses `node:fs/promises.readdir({ withFileTypes: true })`, reads only an expanded directory, does not follow symlinks as directories in the first release, and sorts directories first with deterministic lexical ordering. Tests substitute an in-memory source; this is a specific local substitution Seam, not a generic dependency container.

`ExplorerTree` owns the cache of loaded children, expansion set, selected stable ID, flat visible-row projection, active-file reveal, loading/error rows, and cancellation generations. A file activation returns an `open-file` effect; the plugin executes it through `context.actions.requestOpenFile`, so dirty-file confirmation stays in editor core.

The dependency direction is:

```text
Local filesystem -> ExplorerSource -> ExplorerTree -> OpenTUI plugin
                                              |
                                              +-> requestOpenFile(path)

Git/Bun discovery -> Quick Open (unchanged)
```

### Plugin and layout boundary

Add `builtin.file-explorer` beside the existing built-ins. The editor session adds a `primary-sidebar` OpenTUI slot before the existing `editor-frame` slot in a horizontal workbench row; the plugin contributes the concrete pane to that slot. It registers `workbench.view.explorer` on `mod+shift+e`, matching VS Code's documented Explorer shortcut, plus `workbench.action.toggleSidebarVisibility` on `mod+b`. File opens cross only the existing document action. VS Code's Tree View API models items through `getChildren` and `getTreeItem`; its lazy child-provider shape supports this design even though this is not a VS Code extension. [VS Code user interface](https://code.visualstudio.com/docs/editing/userinterface) · [VS Code Tree View API](https://code.visualstudio.com/api/extension-guides/tree-view)

The CLI classifies an existing directory as a workspace request and every other path as a file request, preserving creation of new files. The editor session composes the Explorer plugin only for workspace requests. A folder session starts with no active document; opening a tree file crosses the same document-safety action used by Quick Open.

The root layout becomes a horizontal workbench: sidebar plus existing editor. Start at 28 columns, clamp to a practical minimum and at most about 35% of the terminal, and recalculate on renderer resize. When the terminal is too narrow, hide the sidebar rather than shrinking the editor to unusability. Remember the last explicit visibility and width for the session; draggable resizing can follow later.

## Interaction contract

- `mod+shift+e` shows and focuses Explorer; when Explorer already owns focus, invoking it again returns focus to the editor without destroying tree state.
- `Up`/`Down` move one visible row. `PageUp`/`PageDown`, `Home`, and `End` move within the flattened visible list.
- `Right` expands a collapsed directory, then moves to its first child. `Left` collapses an expanded directory, then moves to its parent.
- `Enter` toggles a directory or opens a file through `requestOpenFile`. `Escape` returns focus to the editor. Typing must never leak into the editor while the tree owns focus.
- Mouse click opens a file or toggles a directory; wheel scrolls without changing selection. Opening a file follows the same dirty-document policy as Quick Open.
- The active document receives a distinct decoration. Revealing it expands ancestors and scrolls its row into view without stealing focus unless the user invoked Explorer focus.
- A refresh preserves expanded and selected stable IDs when they still exist, falls back to the nearest surviving ancestor when they do not, and ignores stale scan generations after cancellation.
- Do not implement tabs' preview-versus-pinned semantics yet. Until a tab model exists, single-file opening semantics remain authoritative.

Register explorer-only keys as a focus-scoped keymap layer. Global commands such as Quick Open and Command Palette must continue to work while the sidebar is focused. OpenTUI's keymap architecture already supports commands, scoped layers, conditions, and platform-aware `mod`; reuse that command facade instead of adding raw global key listeners. [OpenTUI keymap](https://github.com/anomalyco/opentui/blob/v0.5.1/packages/keymap/README.md)

## Large-workspace behavior

Do not recursively enumerate the workspace. Load only the root and expanded directories, flatten only loaded expanded branches, and let `ScrollBoxRenderable` cull offscreen render calls. For the first release, use one custom row per currently visible tree node; this is much simpler and preserves native scroll extent and scrollbar behavior.

Run a scale spike before claiming full virtualization. OpenTUI 0.5.1 exposes `scrollTop` but no public scroll-change event on `ScrollBoxRenderable`; a viewport-sized row pool therefore needs extra synchronization and spacer bookkeeping. If a synthetic 100,000-node expanded tree misses the agreed memory or interaction budget, add a `VirtualTreeViewport` OpenTUI Adapter without changing `ExplorerTree` or `ExplorerSource`.

Additional constraints:

- Never read file contents for the tree; names, relative paths, node kind, and optional decorations are enough.
- Abort a directory read when the session closes, the workspace changes, or the directory collapses; ignore stale generations.
- Coalesce future filesystem-watch events before rebuilding affected parents. Do not rescan on each keystroke, focus change, or render frame.
- Preserve selection by node ID, not list index. Keep expansion in a `Set<ExplorerNodeId>`.
- Cache sorted child IDs. Use directories-first, case-aware deterministic ordering; make sorting policy replaceable without coupling it to rows.
- Measure root loading, expand latency, and scroll-frame time against the largest intended repository before adding icons, Git status, or watchers.

## Phased implementation plan

1. **Filesystem source:** implement `LocalFileSystemExplorerSource` and in-memory tests for stable IDs, empty directories, `.git` exclusion, symlinks, permission errors, cancellation, and deterministic directories-first sorting. Leave Quick Open behavior unchanged.
2. **Headless tree Module:** test loading, expand/collapse, parent/child movement, refresh reconciliation, error rows, stale generations, selection repair, and active-file reveal. No OpenTUI objects in this module.
3. **Layout and plugin Adapter:** add the horizontal workbench and `primary-sidebar` slot, custom ScrollBox rows, focus-scoped keymap, `mod+shift+e`, `mod+b`, mouse click/wheel, resize behavior, and open-file delegation. Verify that editor input is blocked while Explorer owns focus and restored on Escape.
4. **Repository-scale gate:** test a synthetic deep tree and a real large repository. Set budgets for root load, expand latency, row-object count, and scroll responsiveness. Add a virtual viewport only if measurements fail.
5. **Parity refinements:** add file watching, configurable `files.exclude`/`explorer.excludeGitIgnore`, create/rename/delete, context menus, drag/drop, Git decorations, compact folders, multi-root workspaces, and persistence behind concrete new requirements.

## Acceptance criteria for the first release

- Opening a file has no Explorer; opening a folder shows and focuses it without inventing an active file.
- Explorer shows real files and empty directories lazily while Quick Open retains its current Git/Bun search policy.
- `mod+shift+e`, focus return, arrows, paging, expand/collapse, Enter, direct mouse open/toggle, wheel scrolling, and terminal resize work without editing the document underneath.
- Opening a file preserves the existing dirty-file confirmation and failure behavior.
- Selection and expansion survive a refresh by stable path ID; stale directory reads cannot update newer state.
- Collapsed directories are not enumerated, and offscreen visible rows are culled by OpenTUI. The scale gate determines whether a pooled viewport is necessary.
- Narrow terminals hide the sidebar cleanly; reopening it restores state.
- Plugin disposal removes rows, key layers, subscriptions, and pending work without slowing terminal shutdown.

This approach keeps the new code small in dependency terms but explicit in product semantics: the filesystem Adapter owns directory truth; `ExplorerTree` owns tree behavior; OpenTUI renders and scrolls; the editor host owns commands and document safety.
