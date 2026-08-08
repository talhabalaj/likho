import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises"
import { join } from "node:path"

type SourceManifest = Readonly<{
  name: string
  version: string
  description?: string
  repository?: unknown
  engines?: unknown
  publishConfig?: unknown
}>

export type ReleaseTarget = Readonly<{
  name: string
  bunTarget: string
  os: "darwin" | "linux" | "win32"
  cpu: "arm64" | "x64"
  libc?: "musl"
}>

export const targets: readonly ReleaseTarget[] = [
  {
    name: "darwin-arm64",
    bunTarget: "bun-darwin-arm64",
    os: "darwin",
    cpu: "arm64",
  },
  {
    name: "darwin-x64",
    bunTarget: "bun-darwin-x64-baseline",
    os: "darwin",
    cpu: "x64",
  },
  {
    name: "linux-arm64",
    bunTarget: "bun-linux-arm64",
    os: "linux",
    cpu: "arm64",
  },
  {
    name: "linux-x64",
    bunTarget: "bun-linux-x64-baseline",
    os: "linux",
    cpu: "x64",
  },
  {
    name: "linux-arm64-musl",
    bunTarget: "bun-linux-arm64-musl",
    os: "linux",
    cpu: "arm64",
    libc: "musl",
  },
  {
    name: "linux-x64-musl",
    bunTarget: "bun-linux-x64-musl",
    os: "linux",
    cpu: "x64",
    libc: "musl",
  },
  {
    name: "windows-arm64",
    bunTarget: "bun-windows-arm64",
    os: "win32",
    cpu: "arm64",
  },
  {
    name: "windows-x64",
    bunTarget: "bun-windows-x64-baseline",
    os: "win32",
    cpu: "x64",
  },
]

export function nativePackageName(target: ReleaseTarget): string {
  return `likho-${target.name}`
}

export function nativePackageManifest(
  source: SourceManifest,
  target: ReleaseTarget,
) {
  return {
    name: nativePackageName(target),
    version: source.version,
    description: `Likho native binary for ${target.name}`,
    repository: source.repository,
    os: [target.os],
    cpu: [target.cpu],
    ...(target.libc ? { libc: [target.libc] } : {}),
    preferUnplugged: true,
    publishConfig: source.publishConfig ?? { access: "public" },
  }
}

export function wrapperPackageManifest(source: SourceManifest) {
  return {
    name: source.name,
    version: source.version,
    description: source.description,
    repository: source.repository,
    bin: { likho: "./bin/likho.exe" },
    scripts: { postinstall: "node ./postinstall.mjs" },
    os: ["darwin", "linux", "win32"],
    cpu: ["arm64", "x64"],
    optionalDependencies: Object.fromEntries(
      targets.map((target) => [nativePackageName(target), source.version]),
    ),
    engines: source.engines,
    publishConfig: source.publishConfig ?? { access: "public" },
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

export async function buildRelease(): Promise<void> {
  const root = process.cwd()
  const releaseDirectory = join(root, "dist", "release")
  const npmDirectory = join(root, "dist", "npm")
  const source = JSON.parse(
    await readFile(join(root, "package.json"), "utf8"),
  ) as SourceManifest

  await Promise.all([
    rm(releaseDirectory, { recursive: true, force: true }),
    rm(npmDirectory, { recursive: true, force: true }),
  ])
  await Promise.all([
    mkdir(releaseDirectory, { recursive: true }),
    mkdir(npmDirectory, { recursive: true }),
  ])

  for (const target of targets) {
    const releaseExtension = target.os === "win32" ? ".exe" : ""
    const releaseBinary = join(
      releaseDirectory,
      `likho-${target.name}${releaseExtension}`,
    )
    console.log(`Building ${target.name}`)
    const child = Bun.spawn(
      [
        "bun",
        "build",
        "--compile",
        "--minify",
        `--target=${target.bunTarget}`,
        "src/index.ts",
        "--outfile",
        releaseBinary,
      ],
      { cwd: root, stdin: "inherit", stdout: "inherit", stderr: "inherit" },
    )
    const exitCode = await child.exited
    if (exitCode !== 0) throw new Error(`Failed to build ${target.name}`)

    const packageDirectory = join(npmDirectory, nativePackageName(target))
    const packageBinary = join(
      packageDirectory,
      "bin",
      target.os === "win32" ? "likho.exe" : "likho",
    )
    await mkdir(join(packageDirectory, "bin"), { recursive: true })
    await copyFile(releaseBinary, packageBinary)
    if (target.os !== "win32") await chmod(packageBinary, 0o755)
    await writeJson(
      join(packageDirectory, "package.json"),
      nativePackageManifest(source, target),
    )
  }

  const wrapperDirectory = join(npmDirectory, source.name)
  await mkdir(join(wrapperDirectory, "bin"), { recursive: true })
  await Promise.all([
    copyFile(
      join(root, "npm", "postinstall.mjs"),
      join(wrapperDirectory, "postinstall.mjs"),
    ),
    copyFile(
      join(root, "npm", "bin", "likho.exe"),
      join(wrapperDirectory, "bin", "likho.exe"),
    ),
    copyFile(join(root, "README.md"), join(wrapperDirectory, "README.md")),
    writeJson(
      join(wrapperDirectory, "package.json"),
      wrapperPackageManifest(source),
    ),
  ])
  await chmod(join(wrapperDirectory, "bin", "likho.exe"), 0o755)
}

if (import.meta.main) await buildRelease()
