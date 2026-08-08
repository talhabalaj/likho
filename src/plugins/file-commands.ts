import type { BuiltinPlugin, EditorPluginContext } from "./host"

export const fileCommands: BuiltinPlugin<EditorPluginContext> = {
  id: "builtin.file-commands",
  activate(context) {
    context.subscriptions.add(
      context.commands.registerCommand({ id: "file.save", title: "Save", run: context.actions.save }),
    )
  },
}
