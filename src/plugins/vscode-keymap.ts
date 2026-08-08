import type { BuiltinPlugin, EditorPluginContext } from "./host"

export const vscodeKeymap: BuiltinPlugin<EditorPluginContext> = {
  id: "builtin.vscode-keymap",
  activate(context) {
    const bindings = [
      { key: "home", command: "input.visual.line.home" },
      { key: "end", command: "input.visual.line.end" },
      { key: "shift+home", command: "input.select.visual.line.home" },
      { key: "shift+end", command: "input.select.visual.line.end" },
      { key: "mod+z", command: "input.undo" },
      { key: "mod+shift+z", command: "input.redo" },
      { key: "mod+shift+k", command: "input.delete.line" },
      { key: "mod+a", command: "input.select.all" },
      { key: "mod+s", command: "file.save" },
      { key: "mod+c", command: "editor.copy" },
      { key: "mod+x", command: "editor.cut" },
      { key: "shift+meta+f", command: "editor.formatDocument" },
      { key: "tab", command: "editor.insertTab" },
      ...(context.commands.platform === "macos"
        ? [
            { key: "super+up", command: "input.buffer.home" },
            { key: "super+down", command: "input.buffer.end" },
          ]
        : [
            { key: "ctrl+home", command: "input.buffer.home" },
            { key: "ctrl+end", command: "input.buffer.end" },
            { key: "ctrl+y", command: "input.redo" },
          ]),
    ]

    context.subscriptions.add(context.commands.registerBindings(bindings))
    context.subscriptions.add(
      context.commands.registerBindings(
        [
          { key: "mod+w", command: "window.close" },
          { key: "ctrl+q", command: "window.close" },
        ],
        { scope: "global" },
      ),
    )
  },
}
