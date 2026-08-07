import type { BuiltinPlugin, EditorPluginContext } from "./host"
import type { ChromePlugin } from "./chrome"
import { editCommands } from "./edit-commands"
import { fileCommands } from "./file-commands"
import { formatting } from "./formatting"
import { createLineNumbers, type LineNumberPluginDependencies } from "./line-numbers"
import { createQuickInput, type QuickInputPluginDependencies } from "./quick-input"
import { syntaxHighlighting } from "./syntax-highlighting"
import { vscodeKeymap } from "./vscode-keymap"

export function createBuiltins({
  chrome,
  lineNumbers,
  quickInput,
}: Readonly<{
  chrome: ChromePlugin["plugin"]
  lineNumbers: LineNumberPluginDependencies
  quickInput: QuickInputPluginDependencies
}>): readonly BuiltinPlugin<EditorPluginContext>[] {
  return [
    chrome,
    fileCommands,
    editCommands,
    formatting,
    createLineNumbers(lineNumbers),
    syntaxHighlighting,
    createQuickInput(quickInput),
    vscodeKeymap,
  ]
}
