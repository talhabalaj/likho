import { readdir, readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { nativePackageName, targets } from "./build-release"

export type ReleasePackage = Readonly<{
  directory: string
  name: string
  version: string
}>

async function packageAt(directory: string): Promise<ReleasePackage> {
  const manifest = JSON.parse(
    await readFile(resolve(directory, "package.json"), "utf8"),
  ) as {
    name?: unknown
    version?: unknown
  }
  if (
    typeof manifest.name !== "string" ||
    typeof manifest.version !== "string"
  ) {
    throw new Error(`Invalid package manifest in ${directory}`)
  }
  return { directory, name: manifest.name, version: manifest.version }
}

export function validatePackages(packages: readonly ReleasePackage[]): void {
  const expected = ["likho", ...targets.map(nativePackageName)].sort()
  const actual = packages.map((item) => item.name).sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected release packages ${expected.join(", ")}; received ${actual.join(", ")}`,
    )
  }

  const versions = new Set(packages.map((item) => item.version))
  if (versions.size !== 1)
    throw new Error("Release packages do not all have the same version")
}

export function publicationOrder(
  packages: readonly ReleasePackage[],
): ReleasePackage[] {
  return [...packages].sort((left, right) => {
    if (left.name === "likho") return 1
    if (right.name === "likho") return -1
    return left.name.localeCompare(right.name)
  })
}

async function run(
  command: readonly string[],
  stdio: "ignore" | "inherit",
): Promise<number> {
  const child = Bun.spawn([...command], {
    cwd: process.cwd(),
    stdin: stdio,
    stdout: stdio,
    stderr: stdio,
  })
  return child.exited
}

export async function publish(directory = "dist/npm"): Promise<void> {
  const root = resolve(directory)
  const entries = await readdir(root, { withFileTypes: true })
  const packages = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => packageAt(resolve(root, entry.name))),
  )
  validatePackages(packages)

  for (const item of publicationOrder(packages)) {
    const specifier = `${item.name}@${item.version}`
    if ((await run(["npm", "view", specifier, "version"], "ignore")) === 0) {
      console.log(`Skipping ${specifier}; already published`)
      continue
    }

    console.log(`Publishing ${specifier}`)
    const exitCode = await run(
      ["npm", "publish", item.directory, "--access", "public"],
      "inherit",
    )
    if (exitCode !== 0) throw new Error(`Failed to publish ${specifier}`)
  }
}

if (import.meta.main) await publish(process.argv[2])
