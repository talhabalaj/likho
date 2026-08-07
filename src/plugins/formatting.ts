import { format, getFileInfo } from "prettier"
import type { BuiltinPlugin, EditorPluginContext } from "./host"

export interface FormattingDependencies {
  getFileInfo: typeof getFileInfo
  format: typeof format
}

export function createFormatting(
  dependencies: FormattingDependencies = { getFileInfo, format },
): BuiltinPlugin<EditorPluginContext> {
  return {
    id: "builtin.formatting",
    activate(context) {
      context.subscriptions.add(
        context.commands.registerCommand({
          id: "editor.formatDocument",
          title: "Format Document",
          async run() {
            if (context.signal.aborted) return

            try {
              const captured = context.actions.captureText()
              const path = context.document.snapshot.path
              context.report("Formatting…")
              const { inferredParser } = await dependencies.getFileInfo(path, { ignorePath: [] })
              if (context.signal.aborted) return
              if (!inferredParser) {
                context.report("No formatter available for this file")
                return
              }

              const formatted = await dependencies.format(captured.text, { filepath: path })
              if (context.signal.aborted) return
              if (formatted === captured.text) {
                context.report("Document is already formatted")
              } else if (context.actions.applyText(captured.version, formatted)) {
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
}

export const formatting = createFormatting()
