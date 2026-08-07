import type { BuiltinPlugin, EditorPluginContext } from "./host"
import { editCommands } from "./edit-commands"
import { fileCommands } from "./file-commands"
import { syntaxHighlighting } from "./syntax-highlighting"
import { vscodeKeymap } from "./vscode-keymap"

export const builtins: readonly BuiltinPlugin<EditorPluginContext>[] = [
  fileCommands,
  editCommands,
  syntaxHighlighting,
  vscodeKeymap,
]
