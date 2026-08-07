import { resolve } from "node:path"
import { runEditorSession, type EditorSessionResult } from "./editor-session"

export type CliSignal = "SIGHUP" | "SIGINT" | "SIGTERM"

export type CliResult = Readonly<{
  exitCode: 0 | 1 | 2 | 129 | 130 | 143
  stdout?: string
  stderr?: string
}>

export type EditFile = (
  request: Readonly<{ filePath: string; workspaceRoot: string; signal: AbortSignal }>,
) => Promise<EditorSessionResult>

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
  if (argv.length !== 1 || !argv[0]) {
    return { exitCode: 2, stderr: "Usage: likho <file>\n" }
  }

  try {
    const workspaceRoot = resolve(options.cwd ?? process.cwd())
    const result = await (options.editFile ?? runEditorSession)({
      filePath: resolve(workspaceRoot, argv[0]),
      workspaceRoot,
      signal: options.signal,
    })
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
