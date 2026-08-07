#!/usr/bin/env bun

import { runCli, type CliSignal } from "./cli"
import { runEditorSession } from "./editor-session"

async function main(): Promise<void> {
  const controller = new AbortController()
  const listeners: Array<() => void> = []

  for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"] as const satisfies readonly CliSignal[]) {
    const abort = () => {
      for (const dispose of listeners.splice(0)) dispose()
      controller.abort({ kind: "signal", signal })
    }
    process.once(signal, abort)
    listeners.push(() => process.off(signal, abort))
  }

  try {
    const result = await runCli(process.argv.slice(2), {
      signal: controller.signal,
      editFile: runEditorSession,
    })
    if (result.stdout) process.stdout.write(result.stdout)
    if (result.stderr) process.stderr.write(result.stderr)
    process.exitCode = result.exitCode
  } finally {
    for (const dispose of listeners) dispose()
  }
}

if (import.meta.main) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
