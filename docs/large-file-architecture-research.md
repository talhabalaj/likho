# Large-file architecture research

Checked 2026-08-08 against Likho and its installed `@opentui/core@0.5.1`.
Sources are limited to the checked-out code and official OpenTUI and Tree-sitter
documentation/source.

## Verdict

Do not build another viewport virtualization layer. OpenTUI's editable view
already keeps the whole document in a native edit buffer and renders through a
bounded `EditorView` viewport. Likho's 900,000-byte limit is instead protecting
an unrelated JavaScript export limit: `EditBuffer.getText()` and its range
variants allocate at most 1 MiB. Likho previously called `editor.plainText` on
every content change, save, and close, so simply raising `MAX_FILE_BYTES` could
truncate the JavaScript snapshot and then save that truncation. The hot-path
calls have now been removed, but the export ceiling still gates larger files.

The selected safe path is:

1. Stop exporting the full buffer on every edit; use `onContentChange` only to
   mark the document dirty.
2. Retain the 900,000-byte ceiling, add a 100,000-line ceiling, and wait for an
   official OpenTUI release with exact large-buffer export. Public range reads
   are not a safe chunking workaround in 0.5.1.
3. After that release passes exactness and performance gates, raise the first
   supported target to 10 MB while retaining the line ceiling.
4. Leave the 200,000-byte highlighting ceiling in place initially. Raise it
   only after Likho has a real edit-delta source and can call
   `TreeSitterClient.updateBuffer()` while reconciling partial highlight
   responses. OpenTUI 0.5.1's content-change event has no delta payload.

This removes per-keystroke copies now without accepting a package patch or
fork. The document limit remains until an official dependency release makes a
larger exact round trip possible. A clean incremental highlighter is not
currently available from the public Textarea events alone.

## These are three different problems

| Concern | What it controls | OpenTUI 0.5.1 state | Likho action |
| --- | --- | --- | --- |
| Document storage/export | How much text can be edited and saved without loss | Native `EditBuffer` accepts the full initial string, but its public JS full-text and range getters cap each result at 1 MiB | Stop per-keystroke full exports; retain the safety limit until official exact getters ship |
| Viewport rendering | How much of the document is drawn to the terminal | Already implemented by `EditorView`; scrolling changes viewport offsets and rendering calls `drawEditorView()` | Keep it; benchmark it instead of replacing it |
| Syntax analysis | How much work parsing/highlight queries do after an edit | `updateBuffer()` supports Tree-sitter edits, but requires exact edit coordinates plus the full new content | Feed real deltas when available; do not parse only the visible text |

Viewport virtualization does not remove the need for a correct full document
model, and incremental parsing does not remove the need to save the complete
buffer.

## Why the current limits exist

Likho rejects files over 900,000 bytes or 100,000 lines and also blocks a save
that crosses either threshold in [`src/document.ts`](../src/document.ts). The
byte ceiling stays below OpenTUI's export limit; the line ceiling protects the
much steeper memory cost of very high line counts. The editor now treats a
content-change event as metadata only and reads `editor.plainText` only for an
explicit save, copy, cut, format, or a debounced syntax submission in
[`src/editor-session.ts`](../src/editor-session.ts). Document snapshots no
longer retain a second complete string. Syntax highlighting captures once after
an edit burst and reparses it via `resetBuffer()` in
[`src/plugins/syntax-highlighting.ts`](../src/plugins/syntax-highlighting.ts).

In OpenTUI 0.5.1, `plainText` delegates directly to `EditBuffer.getText()`, and
the content event explicitly has no payload. The getter hard-codes a
`1024 * 1024` output buffer; both range getters have the same ceiling.
[`EditBuffer` source](https://github.com/anomalyco/opentui/blob/v0.5.1/packages/core/src/edit-buffer.ts#L122-L131),
[`getTextRange` source](https://github.com/anomalyco/opentui/blob/v0.5.1/packages/core/src/edit-buffer.ts#L253-L282),
[`EditBufferRenderable` event and getter](https://github.com/anomalyco/opentui/blob/v0.5.1/packages/core/src/renderables/EditBufferRenderable.ts#L41-L43)

A local probe against the installed package set 1,200,000 ASCII characters in
an `EditBuffer`; both `getText()` and a single full `getTextRange()` returned
exactly 1,048,576 characters. The native buffer held the rest. This is an export
truncation, not a 1 MiB storage or viewport capacity.

### Why public range chunking is not a workaround

A second local probe showed that `getTextRange()` is not reliable as a chunked
export interface in 0.5.1. Reads near the start of the buffer work, but range
reads become capped or empty when the requested display offset reaches roughly
65,535, even when the native buffer contains more text. Walking smaller ranges,
bisecting an exactly-full range, or stopping on the first empty range would
therefore either truncate a valid document or loop without a trustworthy end
condition.

Likho must not infer completeness from this API. It retains the 900,000-byte
ceiling until OpenTUI publishes an exact full export, exact chunked export, or
streaming writer with an authoritative size/end condition. Likho also does not
reach into private FFI handles, patch the installed package, or maintain a fork.

Dirty tracking should become metadata, not repeated text comparison: set dirty
on a content event, clear it only after a successful save, and retain the disk
version/hash needed for the existing external-change check. Constructing one
full JavaScript string at open and save is acceptable for the selected 10 MB
target only after an official exact export passes correctness and performance
gates; streaming file I/O becomes worthwhile if those allocations show up in
measurements.

## Viewport virtualization already exists

`TextareaRenderable` inherits `EditBufferRenderable`, which creates one
`EditBuffer` and one `EditorView`. Mouse scrolling changes `offsetX`/`offsetY`,
clamps vertical movement against the total virtual-line count, and resize only
changes the viewport dimensions. Rendering passes that view to
`drawEditorView()` rather than constructing a renderable per document line.
[`EditorView` API](https://github.com/anomalyco/opentui/blob/v0.5.1/packages/core/src/editor-view.ts#L12-L17),
[`scroll/resize implementation`](https://github.com/anomalyco/opentui/blob/v0.5.1/packages/core/src/renderables/EditBufferRenderable.ts#L389-L419),
[`viewport rendering`](https://github.com/anomalyco/opentui/blob/v0.5.1/packages/core/src/renderables/EditBufferRenderable.ts#L889-L905)

Replacing the textarea content with only visible lines would duplicate this
render optimization while breaking document-wide cursor offsets, selection,
undo/redo, search, save, and edits that cross a window boundary. It would amount
to writing a new editor model. There is no reason to do that before benchmarks
show the native buffer itself is the bottleneck.

Highlights may be stored for the whole buffer, but terminal drawing is still
viewport bounded. If highlight storage later becomes large, retain only a
bounded line cache around the viewport; that is decoration virtualization, not
document virtualization. OpenTUI does not currently expose a public scroll
change callback, so implement this only after measurement justifies the extra
tracking.

## Incremental Tree-sitter: useful, but not a viewport substitute

Tree-sitter's official incremental procedure is to describe each change with
old/new byte indexes and old/new row-column points, edit the old tree, then parse
again with that old tree. Tree-sitter can also read from a rope or piece table
through an input callback, but OpenTUI's client does not expose that path; it
passes complete JavaScript strings to its worker.
[`Tree-sitter editing`](https://tree-sitter.github.io/tree-sitter/using-parsers/3-advanced-parsing.html#editing),
[`Tree-sitter custom input`](https://tree-sitter.github.io/tree-sitter/using-parsers/2-basic-parsing.html#providing-the-code)

OpenTUI exposes the required six-field `Edit` shape and
`TreeSitterClient.updateBuffer(id, edits, newContent, version)`. The client
queues the edit and still sends the complete `newContent` to the worker. The
worker calls `tree.edit(edit)`, reparses with the previous tree, computes changed
ranges, and limits highlight queries to affected nodes/ranges.
[`Edit` type](https://github.com/anomalyco/opentui/blob/v0.5.1/packages/core/src/lib/tree-sitter/types.ts#L109-L116),
[`updateBuffer` implementation](https://github.com/anomalyco/opentui/blob/v0.5.1/packages/core/src/lib/tree-sitter/client.ts#L575-L612),
[`incremental worker path`](https://github.com/anomalyco/opentui/blob/v0.5.1/packages/core/src/lib/tree-sitter/parser.worker.ts#L507-L602)

This reduces parsing and query work; it does not eliminate the full worker
content string or structured-clone transfer.

Likho cannot just replace `resetBuffer()` with `updateBuffer()` today:

- `onContentChange` returns `{}` rather than inserted/deleted text and positions,
  so it cannot build a trustworthy Tree-sitter edit.
- Likho currently clears every highlight before applying a response.
  `updateBuffer()` responses cover changed query results rather than the whole
  document, so that would erase all unchanged highlighting.
- The response contains highlighted lines, not the worker's complete changed
  ranges. A line that changed from highlighted to plain may have no replacement
  capture. Correct reconciliation needs an invalidated line/range payload or a
  conservative invalidation range maintained by Likho.

Parsing only the visible slice is not a correct shortcut. A viewport can begin
inside a multiline string, comment, template, or Markdown fence whose opening
token is off-screen. The correct architecture is a whole-document incremental
tree with viewport-bounded decoration application.

## Staged recommendation

### 1. Remove full exports from the edit hot path

- Make native `EditBuffer` content authoritative while a session is open.
- Mark dirty on content changes instead of calling `plainText`.
- Capture the complete buffer only for explicit save, copy, cut, and format
  actions, plus one syntax submission after a debounced edit burst.
- Preserve the external-file-change guard and use a temp-file-plus-rename save
  path.
- Retain the 900,000-byte ceiling and reject documents over 100,000 lines at
  both open and save boundaries.

This stage is implemented. No custom rope, piece table, or viewport component
was needed.

### 2. Gate an official dependency upgrade

Pin the first official OpenTUI release that provides an exact full/range export
or streaming interface beyond 1 MiB and correct behavior at large offsets.
Before raising Likho's limit, round-trip ASCII, multibyte Unicode, combining
characters, tabs, long lines, no trailing newline, and edits on both sides of
the old 1 MiB boundary. Raise the supported byte target to 10 MB only if those
tests pass and documents at or below 100,000 lines stay responsive.

### 3. Measure the existing viewport

Record open time, first paint, one-character insert, page/goto navigation,
undo, and save at 1 MB and 10 MB. Also record memory, because the initial
file exists at least as a Node/Bun string, encoded bytes held by OpenTUI, and
native buffer state. Keep syntax highlighting disabled during this storage and
render baseline.

If navigation and editing remain responsive, OpenTUI's existing viewport holds.
If they do not, profile before deciding whether the bottleneck is buffer edits,
line measurement, highlight storage, or JS/native copies.

### 4. Add a real edit-delta boundary

Prefer an upstream OpenTUI content event carrying the inserted/deleted range
and text. Until the public event supplies trustworthy deltas and invalidation
ranges, retain full debounced `resetBuffer()` submissions below the 200 KB
highlighting ceiling. Do not reverse-engineer deltas from empty events, replace
Textarea input handling, or maintain a private fork for this milestone.

Once deltas exist:

- update a shadow document/piece table with the same edit;
- derive Tree-sitter byte and point coordinates from the pre/post text;
- call `updateBuffer()` with monotonically increasing versions;
- keep highlights per line/reference and replace only invalidated ranges;
- periodically compare incremental output with a full reset in tests;
- retain the 200 KB fallback until Unicode, multiline syntax, rapid queued edits,
  undo/redo, and paste all pass.

### 5. Virtualize decorations only if measured

Implemented: Likho retains the complete whole-document highlight response but
applies native decorations only for the current viewport plus 10 logical lines
of overscan on each side. Renderer frame events detect viewport and resize
changes, so cached decorations are repainted after keyboard navigation, goto,
mouse scrolling, or resize. This reduces native decoration and render work; it
does not reduce whole-document parse/query work and remains independent of file
storage and saving.

### 6. Replace the editor model only at a proven ceiling

If the native edit buffer fails the product's required file sizes even with
syntax disabled and full exports removed, then adopt an application-owned rope
or piece table and a custom editable viewport. That is a framework-level choice,
not the next fix for the current constants.

## Decision summary

- **900 KB:** retained until an official exact large-buffer export passes
  round-trip and performance gates; raising the constant alone is unsafe.
- **100,000 lines:** enforced independently of byte size to avoid pathological
  native-buffer memory growth.
- **200 KB highlighting:** keep for now; incremental parsing needs trustworthy
  edit deltas and partial-highlight reconciliation.
- **Viewport virtualization:** already present for editable rendering; do not
  rebuild it.
- **OpenTUI fork:** explicitly rejected; wait for official export and delta APIs.

## Primary sources

- [OpenTUI 0.5.1 release](https://github.com/anomalyco/opentui/releases/tag/v0.5.1)
- [OpenTUI `EditBuffer`](https://github.com/anomalyco/opentui/blob/v0.5.1/packages/core/src/edit-buffer.ts)
- [OpenTUI `EditorView`](https://github.com/anomalyco/opentui/blob/v0.5.1/packages/core/src/editor-view.ts)
- [OpenTUI editable renderable](https://github.com/anomalyco/opentui/blob/v0.5.1/packages/core/src/renderables/EditBufferRenderable.ts)
- [OpenTUI Tree-sitter client](https://github.com/anomalyco/opentui/blob/v0.5.1/packages/core/src/lib/tree-sitter/client.ts)
- [OpenTUI Tree-sitter worker](https://github.com/anomalyco/opentui/blob/v0.5.1/packages/core/src/lib/tree-sitter/parser.worker.ts)
- [Tree-sitter basic parsing](https://tree-sitter.github.io/tree-sitter/using-parsers/2-basic-parsing.html)
- [Tree-sitter advanced parsing](https://tree-sitter.github.io/tree-sitter/using-parsers/3-advanced-parsing.html)
