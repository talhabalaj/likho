import {
  destroyTreeSitterClient,
  getTreeSitterClient,
  pathToFiletype,
  type HighlightResponse,
  type TreeSitterClient,
} from "@opentui/core"
import type { BuiltinPlugin, EditorPluginContext } from "./host"

// ponytail: OpenTUI content events lack edit deltas; raise this after switching resets to updateBuffer().
export const MAX_HIGHLIGHT_BYTES = 200_000
const HIGHLIGHT_DEBOUNCE_MS = 75

export interface DisplayHighlight {
  line: number
  start: number
  end: number
  group: string
}

function displayWidth(text: string): number {
  return Bun.stringWidth(text.replaceAll("\t", " "))
}

export function toDisplayHighlights(text: string, responses: HighlightResponse[]): DisplayHighlight[] {
  const lines = text.split("\n")
  return responses.flatMap(({ line, highlights }) => {
    const source = lines[line]
    if (source === undefined) return []
    return highlights.map(({ startCol, endCol, group }) => ({
      line,
      start: displayWidth(source.slice(0, startCol)),
      end: displayWidth(source.slice(0, endCol)),
      group,
    }))
  })
}

function highlightPriority(group: string): number {
  if (group === "string" || group === "comment" || group === "markup.raw") return 10
  return Math.min(255, 20 + group.split(".").length)
}

export const syntaxHighlighting: BuiltinPlugin<EditorPluginContext> = {
  id: "builtin.syntax-highlighting",
  async activate(context) {
    const initial = context.document.snapshot
    const filetype = pathToFiletype(initial.path)
    if (!filetype || Buffer.byteLength(initial.text) > MAX_HIGHLIGHT_BYTES) return

    const client: TreeSitterClient = getTreeSitterClient()
    let bufferCreated = false
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const onHighlights = (bufferId: number, version: number, responses: HighlightResponse[]) => {
      const current = context.document.snapshot
      if (disposed || bufferId !== context.syntax.bufferId || version !== current.version) return
      context.syntax.clear()
      for (const highlight of toDisplayHighlights(current.text, responses)) {
        const styleId = context.syntax.resolveStyleId(highlight.group)
        if (styleId === null || highlight.start === highlight.end) continue
        context.syntax.add({ ...highlight, styleId, priority: highlightPriority(highlight.group) })
      }
    }

    client.on("highlights:response", onHighlights)
    context.subscriptions.add(async () => {
      disposed = true
      if (timer) clearTimeout(timer)
      client.off("highlights:response", onHighlights)
      if (bufferCreated) await client.removeBuffer(context.syntax.bufferId)
      await destroyTreeSitterClient()
    })

    bufferCreated = await client.createBuffer(
      context.syntax.bufferId,
      initial.text,
      filetype === "json" ? "javascript" : filetype,
      initial.version,
    )
    if (!bufferCreated) throw new Error("Syntax highlighting unavailable")

    context.subscriptions.add(
      context.document.onDidChange((snapshot) => {
        if (timer) clearTimeout(timer)
        if (Buffer.byteLength(snapshot.text) > MAX_HIGHLIGHT_BYTES) {
          context.syntax.clear()
          return
        }
        timer = setTimeout(() => {
          timer = undefined
          void client.resetBuffer(context.syntax.bufferId, snapshot.version, snapshot.text).catch(() => {
            if (disposed) return
            context.syntax.clear()
            context.report("Syntax highlighting unavailable")
          })
        }, HIGHLIGHT_DEBOUNCE_MS)
      }),
    )
  },
}
