import { format, getFileInfo } from "prettier"
import type { BuiltinPlugin, EditorPluginContext } from "./host"

export const MAX_FORMAT_BYTES = 200_000

export const formatting: BuiltinPlugin<EditorPluginContext> = {
  id: "builtin.formatting",
  activate(context) {
    context.subscriptions.add(
      context.commands.registerCommand({
        id: "editor.formatDocument",
        title: "Format Document",
        async run() {
          if (context.signal.aborted) return
          const snapshot = context.document.snapshot
          if (Buffer.byteLength(snapshot.text) > MAX_FORMAT_BYTES) {
            context.report(`Formatting disabled above ${MAX_FORMAT_BYTES.toLocaleString()} bytes`)
            return
          }

          try {
            const { inferredParser } = await getFileInfo(snapshot.path, { ignorePath: [] })
            if (context.signal.aborted) return
            if (!inferredParser) {
              context.report("No formatter available for this file")
              return
            }

            const formatted = await format(snapshot.text, { filepath: snapshot.path })
            if (context.signal.aborted) return
            if (formatted === snapshot.text) {
              context.report("Document is already formatted")
            } else if (context.actions.applyText(snapshot.version, formatted)) {
              context.report("Formatted document")
            } else {
              context.report("Formatting cancelled because the document changed")
            }
          } catch (error) {
            if (context.signal.aborted) return
            const detail = (error instanceof Error ? error.message : String(error)).split("\n", 1)[0]
            context.report(`Formatting failed: ${detail}`)
          }
        },
      }),
    )
  },
}
