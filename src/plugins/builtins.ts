import type { BuiltinPlugin, EditorPluginContext } from "./host"
import type { ChromePlugin } from "./chrome"
import { editCommands } from "./edit-commands"
import { fileCommands } from "./file-commands"
import { formatting } from "./formatting"
import { createLineNumbers, type LineNumberPluginDependencies } from "./line-numbers"
import { syntaxHighlighting } from "./syntax-highlighting"
import { vscodeKeymap } from "./vscode-keymap"

export function createBuiltins({
  chrome,
  lineNumbers,
}: Readonly<{
  chrome: ChromePlugin["plugin"]
  lineNumbers: LineNumberPluginDependencies
}>): readonly BuiltinPlugin<EditorPluginContext>[] {
  return [
    chrome,
    fileCommands,
    editCommands,
    formatting,
    createLineNumbers(lineNumbers),
    syntaxHighlighting,
    vscodeKeymap,
  ]
}
