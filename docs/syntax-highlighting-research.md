# Syntax-highlighting research

Checked 2026-08-08 for the current OpenTUI editor.

## Verdict

The newest plausible standalone module I found is
[`ts-syntax-highlighter@0.2.13`](https://github.com/stacksjs/ts-syntax-highlighter/releases/tag/v0.2.13),
published 2026-08-06. It is zero-dependency, about 398 KB unpacked, supports 48
languages, and returns tokens with line and character offsets that can be mapped
to OpenTUI highlights.

It is not yet the safest dependency for this editor. It has two GitHub stars,
no forks, a pre-1.0 API, and seven releases landed within roughly ten hours on
2026-08-05/06. It is also a generic regex/TextMate-style tokenizer, not an
OpenTUI integration and not VS Code's actual TextMate engine.

For the first implementation, use the highlighting machinery already shipped
inside `@opentui/core@0.5.1`. Add another module only when broader language or
exact VS Code theme compatibility is required.

## What is already installed

OpenTUI's [`CodeRenderable`](https://opentui.com/docs/components/code/) uses
Tree-sitter, and its public
[`TreeSitterClient`](https://opentui.com/docs/reference/tree-sitter/) supports
one-shot highlighting plus parser registration. The installed 0.5.1 build also
exposes the pieces required for editable text:

- `TextareaRenderable.syntaxStyle`
- `TextareaRenderable.addHighlight()` and `clearAllHighlights()`
- `TreeSitterClient.highlightOnce()`
- `TreeSitterClient.createBuffer()` / `updateBuffer()` for later incremental use

OpenTUI does not currently connect those pieces into a syntax-highlighting
`TextareaRenderable` automatically; `CodeRenderable` is read-only. A small
adapter is still required.

The installed package bundles JavaScript/TypeScript, Markdown, and Zig parser
assets. A local runtime probe highlighted TypeScript successfully and returned
`No parser available for filetype python` for Python, matching the documented
need to [register extra Tree-sitter grammars](https://opentui.com/docs/reference/tree-sitter/#add-parsers-globally).

Do not independently upgrade `web-tree-sitter`: OpenTUI 0.5.1 declares exactly
`web-tree-sitter@0.25.10` as its peer, and that version is already resolved in
this project.

## Candidates

| Candidate | Current release | Fit for an editable OpenTUI buffer | Decision |
| --- | --- | --- | --- |
| OpenTUI built-in Tree-sitter | [`@opentui/core@0.5.1`](https://github.com/anomalyco/opentui/releases/tag/v0.5.1), 2026-08-04 | Native highlight ranges and styles; already installed; worker-backed; limited bundled languages | **Use first** |
| `ts-syntax-highlighter` | [`0.2.13`](https://github.com/stacksjs/ts-syntax-highlighter/releases/tag/v0.2.13), 2026-08-06 | Convenient line/offset tokens, 48 languages, zero dependencies; needs an OpenTUI adapter; extremely young | Newest candidate; keep experimental |
| Shiki | [`4.4.2`](https://github.com/shikijs/shiki/releases/tag/v4.4.2), 2026-08-05 | Uses the same TextMate grammars/themes as VS Code and exposes `codeToTokens`; not an editor and normally re-tokenizes supplied code | Use only for exact VS Code color fidelity |
| `highlight.js`, `lowlight`, `cli-highlight`, `@speed-highlight/core` | Older/current static highlighters | Primarily HTML/HAST/ANSI output; no OpenTUI editing integration or incremental buffer protocol | Skip |

No maintained package was found that directly bridges an editable OpenTUI
`TextareaRenderable` to a syntax engine. npm package search and GitHub code
search found generic highlighters and read-only OpenTUI code renderers only.

## Why not Shiki by default

[Shiki](https://shiki.style/guide/) is the strongest choice when "same as VS
Code" means the same TextMate grammar and theme ecosystem. It can return token
data through [`codeToTokens`](https://shiki.style/guide/install), and its
fine-grained bundle can load only selected languages and `dark-plus`.

It is designed primarily for code presentation, not arbitrary edits. Its own
[performance guidance](https://shiki.style/guide/best-performance) says the
highlighter is expensive to initialize, recommends reusing it, and suggests a
worker because tokenization can be CPU-intensive. Its stream package is for
append-only streams, not inserting and deleting anywhere in a document.

## Recommended implementation boundary

1. Detect the file type with OpenTUI's `pathToFiletype()`.
2. Create one `SyntaxStyle` using VS Code Dark+ colors.
3. Debounce `highlightOnce(text, filetype)` after content changes, clear old
   highlights, and add the returned per-line ranges to the textarea.
4. Disable highlighting above a measured file-size ceiling; the current editor
   already caps files at 900 KB.
5. Add one focused test that proves keywords, strings, and comments map to the
   expected style IDs.

This first version reparses the buffer. Move to `createBuffer()` / `updateBuffer()`
only after profiling shows that it matters; OpenTUI's content-change event does
not supply Tree-sitter edit deltas, so incremental integration would require
careful byte/row delta calculation.

If broader language coverage becomes the immediate priority, spike and pin
`ts-syntax-highlighter@0.2.13` behind the same tiny adapter. If exact VS Code
TextMate rendering becomes the priority, replace the tokenizer side with a
fine-grained Shiki build without changing the textarea-facing adapter.

## Primary sources

- [OpenTUI Code component](https://opentui.com/docs/components/code/)
- [OpenTUI Tree-sitter reference](https://opentui.com/docs/reference/tree-sitter/)
- [OpenTUI Textarea component](https://opentui.com/docs/components/textarea/)
- [`ts-syntax-highlighter` repository](https://github.com/stacksjs/ts-syntax-highlighter)
- [Shiki introduction](https://shiki.style/guide/)
- [Shiki token API](https://shiki.style/guide/install)
- [Shiki bundle guidance](https://shiki.style/guide/bundles)
