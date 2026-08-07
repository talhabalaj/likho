import { expect, test } from "bun:test"
import { join } from "node:path"

test.skipIf(process.platform !== "darwin")(
  "the executable restores terminal mode after an interactive close",
  async () => {
    const projectRoot = join(import.meta.dir, "..")
    const expectScript = String.raw`
      set timeout 5
      spawn -noecho sh -c {before="$(stty -g)"; bun run src/index.ts "$EDITOR_TEST_FILE"; editor_status=$?; after="$(stty -g)"; if [ "$before" = "$after" ]; then printf "\n__TTY_RESTORED__\n"; else printf "\n__TTY_CHANGED__\n"; fi; exit "$editor_status"}
      expect {
        -re {README.md} {
          set close_started [clock milliseconds]
          send -- "\021"
        }
        timeout { exit 124 }
      }
      expect {
        -re {__TTY_RESTORED__} {
          set close_ms [expr {[clock milliseconds] - $close_started}]
          puts "\n__CLOSE_MS__=$close_ms\n"
          if {$close_ms > 1000} { exit 126 }
        }
        -re {__TTY_CHANGED__} { exit 125 }
        timeout { exit 124 }
      }
      expect eof
      set result [wait]
      exit [lindex $result 3]
    `
    const child = Bun.spawn(["expect", "-c", expectScript], {
      cwd: projectRoot,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        EDITOR_TEST_FILE: join(projectRoot, "README.md"),
        TERM: "xterm-256color",
      },
    })
    const stdout = new Response(child.stdout).text()
    const stderr = new Response(child.stderr).text()

    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<number>((resolve) => {
      timer = setTimeout(() => {
        child.kill()
        resolve(-1)
      }, 5_000)
    })
    const exitCode = await Promise.race([child.exited, timeout])
    if (timer) clearTimeout(timer)
    const output = await stdout
    const errors = await stderr

    expect(exitCode, errors).toBe(0)
    expect(output).toContain("__TTY_RESTORED__")
    expect(output).not.toContain("__TTY_CHANGED__")
  },
  10_000,
)
