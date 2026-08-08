import { existsSync, statSync } from "node:fs"
import { resolve } from "node:path"
import manifest from "../package.json" with { type: "json" }
import { runEditorSession, type EditorSessionRequest, type EditorSessionResult } from "./editor-session"

export type CliSignal = "SIGHUP" | "SIGINT" | "SIGTERM"

export type CliResult = Readonly<{
  exitCode: 0 | 1 | 2 | 129 | 130 | 143
  stdout?: string
  stderr?: string
}>

export type EditFile = (request: EditorSessionRequest) => Promise<EditorSessionResult>

const SIGNAL_EXIT_CODES: Record<CliSignal, 129 | 130 | 143> = {
  SIGHUP: 129,
  SIGINT: 130,
  SIGTERM: 143,
}

function abortedSignal(reason: unknown): CliSignal | undefined {
  if (typeof reason !== "object" || reason === null || !("signal" in reason)) return undefined
  return reason.signal === "SIGHUP" || reason.signal === "SIGINT" || reason.signal === "SIGTERM"
    ? reason.signal
    : undefined
}

export async function runCli(
  argv: readonly string[],
  options: Readonly<{ signal: AbortSignal; cwd?: string; editFile?: EditFile }>,
): Promise<CliResult> {
  if (argv.length === 1 && (argv[0] === "--version" || argv[0] === "-v")) {
    return { exitCode: 0, stdout: `${manifest.version}\n` }
  }

  if (argv.length !== 1 || !argv[0]) {
    return { exitCode: 2, stderr: "Usage: likho <file-or-folder>\n" }
  }

  try {
    const cwd = resolve(options.cwd ?? process.cwd())
    const target = resolve(cwd, argv[0])
    const request: EditorSessionRequest =
      existsSync(target) && statSync(target).isDirectory()
        ? { kind: "folder", workspaceRoot: target, signal: options.signal }
        : { kind: "file", filePath: target, signal: options.signal }
    const result = await (options.editFile ?? runEditorSession)(request)
    if (result.kind === "closed") return { exitCode: 0 }
    const signal = abortedSignal(result.reason)
    return signal ? { exitCode: SIGNAL_EXIT_CODES[signal] } : { exitCode: 1, stderr: "Editor cancelled\n" }
  } catch (error) {
    return {
      exitCode: 1,
      stderr: `${error instanceof Error ? error.message : String(error)}\n`,
    }
  }
}
