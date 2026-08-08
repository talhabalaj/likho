import type { BuiltinPlugin, EditorPluginContext } from "./host"
import type { ChromePlugin } from "./chrome"
import { createCloseConfirmation, type CloseConfirmationDependencies } from "./close-confirmation"
import { editCommands } from "./edit-commands"
import { fileCommands } from "./file-commands"
import { formatting } from "./formatting"
import { createFileExplorer, type FileExplorerPluginDependencies } from "./file-explorer"
import { createLineNumbers, type LineNumberPluginDependencies } from "./line-numbers"
import { createQuickInput, type QuickInputPluginDependencies } from "./quick-input"
import { syntaxHighlighting } from "./syntax-highlighting"
import { vscodeKeymap } from "./vscode-keymap"

export function createBuiltins({
  chrome,
  closeConfirmation,
  fileExplorer,
  lineNumbers,
  quickInput,
}: Readonly<{
  chrome: ChromePlugin["plugin"]
  closeConfirmation: CloseConfirmationDependencies
  fileExplorer?: FileExplorerPluginDependencies
  lineNumbers: LineNumberPluginDependencies
  quickInput: QuickInputPluginDependencies
}>): readonly BuiltinPlugin<EditorPluginContext>[] {
  return [
    chrome,
    fileCommands,
    createCloseConfirmation(closeConfirmation),
    editCommands,
    formatting,
    createLineNumbers(lineNumbers),
    syntaxHighlighting,
    ...(fileExplorer ? [createFileExplorer(fileExplorer)] : []),
    createQuickInput(quickInput),
    vscodeKeymap,
  ]
}
