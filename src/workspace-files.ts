import { basename, resolve } from "node:path"

export interface WorkspaceFile {
  readonly id: string
  readonly baseName: string
  readonly relativePath: string
  readonly absolutePath: string
}

const FALLBACK_EXCLUDES = new Set([".git", "node_modules", "dist", "build", ".next", "coverage"])

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new DOMException("The operation was aborted", "AbortError")
}

function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function toWorkspaceFiles(root: string, paths: readonly string[]): readonly WorkspaceFile[] {
  return [...paths].sort(comparePaths).map((relativePath) => ({
    id: relativePath,
    baseName: basename(relativePath),
    relativePath,
    absolutePath: resolve(root, relativePath),
  }))
}

async function discoverWithGit(root: string, signal: AbortSignal): Promise<readonly string[] | undefined> {
  try {
    const process = Bun.spawn(["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
      cwd: root,
      stdout: "pipe",
      stderr: "ignore",
      signal,
    })
    const output = new Response(process.stdout).arrayBuffer()
    const [bytes, exitCode] = await Promise.all([output, process.exited])
    throwIfAborted(signal)
    if (exitCode !== 0) return undefined
    return new TextDecoder().decode(bytes).split("\0").filter(Boolean)
  } catch (error) {
    throwIfAborted(signal)
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    return undefined
  }
}

async function discoverWithGlob(root: string, signal: AbortSignal): Promise<readonly string[]> {
  const paths: string[] = []
  const glob = new Bun.Glob("**/*")
  for await (const relativePath of glob.scan({ cwd: root, onlyFiles: true, dot: true, followSymlinks: false })) {
    throwIfAborted(signal)
    if (relativePath.split(/[\\/]/).some((part) => FALLBACK_EXCLUDES.has(part))) continue
    paths.push(relativePath)
  }
  return paths
}

export async function discoverWorkspaceFiles(
  root: string,
  signal: AbortSignal,
): Promise<readonly WorkspaceFile[]> {
  throwIfAborted(signal)
  const gitPaths = await discoverWithGit(root, signal)
  const paths = gitPaths ?? (await discoverWithGlob(root, signal))
  throwIfAborted(signal)
  return toWorkspaceFiles(root, paths)
}
