import { mkdir } from "node:fs/promises"
import { join } from "node:path"

const targets = [
  ["darwin-arm64", "bun-darwin-arm64"],
  ["darwin-x64", "bun-darwin-x64-baseline"],
  ["linux-arm64", "bun-linux-arm64"],
  ["linux-x64", "bun-linux-x64-baseline"],
  ["linux-arm64-musl", "bun-linux-arm64-musl"],
  ["linux-x64-musl", "bun-linux-x64-musl"],
  ["windows-arm64", "bun-windows-arm64"],
  ["windows-x64", "bun-windows-x64-baseline"],
] as const

const outputDirectory = join(process.cwd(), "dist", "release")
await mkdir(outputDirectory, { recursive: true })

for (const [name, target] of targets) {
  const extension = name.startsWith("windows-") ? ".exe" : ""
  const output = join(outputDirectory, `likho-${name}${extension}`)
  console.log(`Building ${name}`)
  const child = Bun.spawn(
    ["bun", "build", "--compile", "--minify", `--target=${target}`, "src/index.ts", "--outfile", output],
    { cwd: process.cwd(), stdin: "inherit", stdout: "inherit", stderr: "inherit" },
  )
  const exitCode = await child.exited
  if (exitCode !== 0) throw new Error(`Failed to build ${name}`)
}
