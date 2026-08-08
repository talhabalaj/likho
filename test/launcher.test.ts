import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { gzipSync } from "node:zlib"
import { createHash } from "node:crypto"
import { releaseAsset } from "../bin/likho.js"

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

test("the launcher selects a standalone artifact for every supported target", () => {
  const glibc = { getReport: () => ({ header: { glibcVersionRuntime: "2.39" } }) }
  const musl = { getReport: () => ({ header: {} }) }

  expect(releaseAsset("darwin", "arm64")).toBe("likho-darwin-arm64")
  expect(releaseAsset("darwin", "x64")).toBe("likho-darwin-x64")
  expect(releaseAsset("linux", "x64", glibc)).toBe("likho-linux-x64")
  expect(releaseAsset("linux", "arm64", musl)).toBe("likho-linux-arm64-musl")
  expect(releaseAsset("win32", "x64")).toBe("likho-windows-x64.exe")
  expect(() => releaseAsset("freebsd", "x64")).toThrow("Unsupported platform")
  expect(() => releaseAsset("darwin", "ia32")).toThrow("Unsupported architecture")
})

test("the npm launcher downloads, verifies, caches, and executes the native binary", async () => {
  if (process.platform === "win32") return

  const directory = mkdtempSync(join(tmpdir(), "likho-launcher-test-"))
  directories.push(directory)
  const cache = join(directory, "cache")
  const linkedLauncher = join(directory, "likho.js")
  symlinkSync(resolve("bin/likho.js"), linkedLauncher)
  const asset = releaseAsset()
  const executable = Buffer.from("#!/bin/sh\nprintf 'standalone:%s\\n' \"$1\"\n")
  const compressed = gzipSync(executable)
  const checksum = createHash("sha256").update(compressed).digest("hex")
  let downloads = 0
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      downloads++
      const path = new URL(request.url).pathname
      if (path.endsWith("/SHA256SUMS")) return new Response(`${checksum}  ${asset}.gz\n`)
      if (path.endsWith(`/${asset}.gz`)) return new Response(compressed)
      return new Response("missing", { status: 404 })
    },
  })

  try {
    const env = {
      ...process.env,
      LIKHO_CACHE_DIR: cache,
      LIKHO_RELEASE_BASE_URL: `http://127.0.0.1:${server.port}`,
    }
    const first = Bun.spawn(["node", linkedLauncher, "first"], { cwd: process.cwd(), env, stderr: "pipe", stdout: "pipe" })
    expect(await first.exited).toBe(0)
    expect(await new Response(first.stdout).text()).toBe("standalone:first\n")
    expect(downloads).toBe(2)

    server.stop(true)
    const second = Bun.spawn(["node", "bin/likho.js", "second"], { cwd: process.cwd(), env, stderr: "pipe", stdout: "pipe" })
    expect(await second.exited).toBe(0)
    expect(await new Response(second.stdout).text()).toBe("standalone:second\n")
    expect(downloads).toBe(2)
  } finally {
    server.stop(true)
  }
})
