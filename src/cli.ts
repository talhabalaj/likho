import { resolve } from "node:path"
import { runEditorSession } from "./editor-session"

export type CliSignal = "SIGHUP" | "SIGINT" | "SIGTERM"

export type EditorSessionResult = { kind: "closed" } | { kind: "signal"; signal: CliSignal }

export type CliResult = Readonly<{
  exitCode: 0 | 1 | 2 | 129 | 130 | 143
  stdout?: string
  stderr?: string
}>

export type EditFile = (request: Readonly<{ filePath: string; signal: AbortSignal }>) => Promise<EditorSessionResult>

const SIGNAL_EXIT_CODES: Record<CliSignal, 129 | 130 | 143> = {
  SIGHUP: 129,
  SIGINT: 130,
  SIGTERM: 143,
}

export async function runCli(
  argv: readonly string[],
  options: Readonly<{ signal: AbortSignal; editFile?: EditFile }>,
): Promise<CliResult> {
  if (argv.length !== 1 || !argv[0]) {
    return { exitCode: 2, stderr: "Usage: likho <file>\n" }
  }

  try {
    const result = await (options.editFile ?? runEditorSession)({ filePath: resolve(argv[0]), signal: options.signal })
    return { exitCode: result.kind === "closed" ? 0 : SIGNAL_EXIT_CODES[result.signal] }
  } catch (error) {
    return {
      exitCode: 1,
      stderr: `${error instanceof Error ? error.message : String(error)}\n`,
    }
  }
}
