import type { BuiltinPlugin, EditorPluginContext } from "./host"

export const editCommands: BuiltinPlugin<EditorPluginContext> = {
  id: "builtin.edit-commands",
  activate(context) {
    context.subscriptions.add(
      context.commands.registerCommand({ id: "editor.copy", title: "Copy", run: context.actions.copy }),
    )
    context.subscriptions.add(
      context.commands.registerCommand({ id: "editor.cut", title: "Cut", run: context.actions.cut }),
    )
    context.subscriptions.add(
      context.commands.registerCommand({ id: "editor.insertTab", title: "Insert Tab", run: context.actions.insertTab }),
    )
  },
}
