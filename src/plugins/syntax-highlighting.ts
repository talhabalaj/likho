import {
  destroyTreeSitterClient,
  getTreeSitterClient,
  pathToFiletype,
  type HighlightResponse,
  type TreeSitterClient,
} from "@opentui/core"
import type { BuiltinPlugin, CapturedDocumentRevision, EditorPluginContext } from "./host"

// ponytail: OpenTUI content events lack edit deltas; raise this after switching resets to updateBuffer().
export const MAX_HIGHLIGHT_BYTES = 200_000
const HIGHLIGHT_DEBOUNCE_MS = 75
export const SYNTAX_VIEWPORT_OVERSCAN_LINES = 10

export interface DisplayHighlight {
  line: number
  start: number
  end: number
  group: string
}

interface StyledDisplayHighlight extends DisplayHighlight {
  styleId: number
  priority: number
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

export interface SyntaxHighlightingDependencies {
  getClient(): TreeSitterClient
  destroyClient(): Promise<void>
}

export function createSyntaxHighlighting(
  dependencies: SyntaxHighlightingDependencies = {
    getClient: getTreeSitterClient,
    destroyClient: destroyTreeSitterClient,
  },
): BuiltinPlugin<EditorPluginContext> {
  return {
    id: "builtin.syntax-highlighting",
    activate(context) {
      if (context.signal.aborted) return
      let submitted: CapturedDocumentRevision | undefined
      if (context.actions.hasOpenDocument()) {
        try {
          submitted = context.actions.captureText()
        } catch (error) {
          context.report(`Syntax highlighting disabled: ${error instanceof Error ? error.message : String(error)}`)
          return
        }
      }
      let disposed = false
      let disabled = false
      let timer: ReturnType<typeof setTimeout> | undefined
      let client: TreeSitterClient | undefined
      let initialization: Promise<boolean> | undefined
      let clientPath: string | undefined
      let activePath = context.document.snapshot.path
      let scheduledVersion = submitted?.version ?? context.document.snapshot.version
      let generation = 0
      let transition = Promise.resolve()
      let highlightsByLine: ReadonlyMap<number, readonly StyledDisplayHighlight[]> | undefined

      const clearHighlights = () => {
        highlightsByLine = undefined
        context.syntax.clear()
      }
      const paintVisibleHighlights = () => {
        if (!highlightsByLine) return
        const visible = context.syntax.getVisibleLineRange()
        const start = Math.max(0, visible.start - SYNTAX_VIEWPORT_OVERSCAN_LINES)
        const end = Math.max(start, visible.end + SYNTAX_VIEWPORT_OVERSCAN_LINES)
        context.syntax.clear()
        for (let line = start; line < end; line++) {
          for (const highlight of highlightsByLine.get(line) ?? []) {
            context.syntax.add(highlight)
          }
        }
      }

      const onHighlights = (bufferId: number, version: number, responses: HighlightResponse[]) => {
        const current = context.document.snapshot
        if (
          !submitted ||
          disposed ||
          disabled ||
          bufferId !== context.syntax.bufferId ||
          clientPath !== current.path ||
          version !== current.version ||
          version !== submitted.version
        ) {
          return
        }
        const nextHighlights = new Map<number, StyledDisplayHighlight[]>()
        for (const highlight of toDisplayHighlights(submitted.text, responses)) {
          const styleId = context.syntax.resolveStyleId(highlight.group)
          if (styleId === null || highlight.start === highlight.end) continue
          const styled = { ...highlight, styleId, priority: highlightPriority(highlight.group) }
          const lineHighlights = nextHighlights.get(highlight.line)
          if (lineHighlights) lineHighlights.push(styled)
          else nextHighlights.set(highlight.line, [styled])
        }
        highlightsByLine = nextHighlights
        paintVisibleHighlights()
      }

      const stopClient = async () => {
        const current = client
        if (!current) return
        current.off("highlights:response", onHighlights)
        client = undefined
        initialization = undefined
        clientPath = undefined
        await dependencies.destroyClient()
      }
      const startClient = (captured: CapturedDocumentRevision, path: string, clearExisting = true) => {
        const filetype = pathToFiletype(path)
        disabled = false
        if (clearExisting) clearHighlights()
        if (!filetype || Buffer.byteLength(captured.text) > MAX_HIGHLIGHT_BYTES) return
        const nextClient = dependencies.getClient()
        client = nextClient
        clientPath = path
        submitted = captured
        scheduledVersion = captured.version
        nextClient.on("highlights:response", onHighlights)
        initialization = nextClient
          .createBuffer(
            context.syntax.bufferId,
            captured.text,
            filetype === "json" ? "javascript" : filetype,
            captured.version,
          )
          .then(
            (created) => {
              if (!created && !disposed && client === nextClient && !context.signal.aborted) {
                context.report("Syntax highlighting unavailable")
              }
              return created
            },
            (error) => {
              if (!disposed && client === nextClient && !context.signal.aborted) {
                context.report(`Syntax highlighting failed: ${error instanceof Error ? error.message : String(error)}`)
              }
              return false
            },
          )
      }
      const restartForPath = (path: string) => {
        const requestedGeneration = ++generation
        if (timer) clearTimeout(timer)
        timer = undefined
        clearHighlights()
        transition = transition
          .then(async () => {
            await stopClient()
            if (
              disposed ||
              context.signal.aborted ||
              requestedGeneration !== generation ||
              context.document.snapshot.path !== path
            ) {
              return
            }
            let captured: CapturedDocumentRevision
            try {
              captured = context.actions.captureText()
            } catch (error) {
              context.report(`Syntax highlighting disabled: ${error instanceof Error ? error.message : String(error)}`)
              return
            }
            startClient(captured, path, false)
          })
          .catch((error) => {
            if (!disposed && !context.signal.aborted) {
              context.report(`Syntax highlighting failed: ${error instanceof Error ? error.message : String(error)}`)
            }
          })
      }
      const disable = (message?: string) => {
        if (disabled || disposed) return
        disabled = true
        if (timer) clearTimeout(timer)
        timer = undefined
        clearHighlights()
        if (message) context.report(message)
      }
      if (submitted) startClient(submitted, activePath, false)
      context.subscriptions.add(async () => {
        disposed = true
        generation++
        if (timer) clearTimeout(timer)
        await transition
        await stopClient()
      })
      context.subscriptions.add(
        context.syntax.onVisibleLineRangeChange(() => {
          try {
            paintVisibleHighlights()
          } catch (error) {
            context.report(`Syntax highlighting failed: ${error instanceof Error ? error.message : String(error)}`)
          }
        }),
      )
      context.subscriptions.add(
        context.document.onDidChange(
          (snapshot) => {
            if (snapshot.path !== activePath) {
              activePath = snapshot.path
              scheduledVersion = snapshot.version
              restartForPath(snapshot.path)
              return
            }
            if (disabled || snapshot.version === scheduledVersion) return
            scheduledVersion = snapshot.version
            if (timer) clearTimeout(timer)
            timer = setTimeout(() => {
              timer = undefined
              let captured: CapturedDocumentRevision
              try {
                captured = context.actions.captureText()
              } catch (error) {
                disable(`Syntax highlighting disabled: ${error instanceof Error ? error.message : String(error)}`)
                return
              }
              if (Buffer.byteLength(captured.text) > MAX_HIGHLIGHT_BYTES) {
                disable(`Syntax highlighting disabled above ${MAX_HIGHLIGHT_BYTES.toLocaleString()} bytes`)
                return
              }
              const currentClient = client
              const currentInitialization = initialization
              if (!currentClient || !currentInitialization || clientPath !== snapshot.path) return
              submitted = captured
              void currentInitialization.then((created) => {
                if (!created || disposed || disabled || context.signal.aborted || client !== currentClient) return
                void currentClient.resetBuffer(context.syntax.bufferId, captured.version, captured.text).catch(() => {
                  if (disposed || context.signal.aborted || client !== currentClient) return
                  clearHighlights()
                  context.report("Syntax highlighting unavailable")
                })
              })
            }, HIGHLIGHT_DEBOUNCE_MS)
          },
          (error) =>
            context.report(`Syntax highlighting failed: ${error instanceof Error ? error.message : String(error)}`),
        ),
      )
    },
  }
}

export const syntaxHighlighting = createSyntaxHighlighting()
