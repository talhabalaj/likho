#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto"
import { createReadStream, createWriteStream, realpathSync } from "node:fs"
import { chmod, mkdir, readFile, rename, rm } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { fileURLToPath } from "node:url"
import { createGunzip } from "node:zlib"
import { spawnSync } from "node:child_process"

const DEFAULT_RELEASE_BASE_URL = "https://github.com/talhabalaj/likho/releases/download"

export function releaseAsset(platform = process.platform, arch = process.arch, report = process.report) {
  if (arch !== "arm64" && arch !== "x64") {
    throw new Error(`Unsupported architecture: ${arch}`)
  }

  if (platform === "darwin") return `likho-darwin-${arch}`
  if (platform === "win32") return `likho-windows-${arch}.exe`
  if (platform === "linux") {
    const glibc = report?.getReport?.()?.header?.glibcVersionRuntime
    return `likho-linux-${arch}${glibc ? "" : "-musl"}`
  }

  throw new Error(`Unsupported platform: ${platform}`)
}

function cacheRoot() {
  if (process.env.LIKHO_CACHE_DIR) return resolve(process.env.LIKHO_CACHE_DIR)
  if (process.platform === "win32") {
    return join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "likho")
  }
  return join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "likho")
}

async function packageVersion() {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"))
  return manifest.version
}

async function download(url, destination) {
  const response = await fetch(url)
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status}) for ${url}`)
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination))
}

async function sha256(path) {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest("hex")
}

function expectedChecksum(checksums, asset) {
  for (const line of checksums.split(/\r?\n/)) {
    const match = line.match(/^([a-f\d]{64})\s+\*?(.+)$/i)
    if (match?.[2] === `${asset}.gz`) return match[1].toLowerCase()
  }
  throw new Error(`No checksum published for ${asset}.gz`)
}

export async function installReleaseBinary({ version, asset, destination, releaseBaseUrl }) {
  const releaseUrl = `${releaseBaseUrl}/v${version}`
  const token = `${process.pid}-${randomBytes(6).toString("hex")}`
  const compressed = `${destination}.${token}.gz`
  const unpacked = `${destination}.${token}`

  await mkdir(dirname(destination), { recursive: true })
  try {
    const checksumResponse = await fetch(`${releaseUrl}/SHA256SUMS`)
    if (!checksumResponse.ok) throw new Error(`Checksum download failed (${checksumResponse.status})`)
    const checksums = await checksumResponse.text()
    await download(`${releaseUrl}/${asset}.gz`, compressed)
    const expected = expectedChecksum(checksums, asset)
    const actual = await sha256(compressed)
    if (actual !== expected) throw new Error(`Checksum mismatch for ${asset}.gz`)

    await pipeline(createReadStream(compressed), createGunzip(), createWriteStream(unpacked, { mode: 0o755 }))
    if (process.platform !== "win32") await chmod(unpacked, 0o755)
    await rename(unpacked, destination).catch(async (error) => {
      if (error?.code !== "EEXIST") throw error
    })
  } finally {
    await Promise.all([
      rm(compressed, { force: true }),
      rm(unpacked, { force: true }),
    ])
  }
}

export async function launchLikho(argv = process.argv.slice(2)) {
  const version = await packageVersion()
  const asset = releaseAsset()
  const destination = join(cacheRoot(), version, asset)

  try {
    await chmod(destination, 0o755)
  } catch (error) {
    if (error?.code !== "ENOENT") throw error
    const releaseBaseUrl = process.env.LIKHO_RELEASE_BASE_URL || DEFAULT_RELEASE_BASE_URL
    process.stderr.write(`Downloading Likho ${version} for ${process.platform}-${process.arch}…\n`)
    await installReleaseBinary({ version, asset, destination, releaseBaseUrl })
  }

  const result = spawnSync(destination, argv, { stdio: "inherit" })
  if (result.error) throw result.error
  if (result.status !== null) return result.status
  return result.signal === "SIGINT" ? 130 : result.signal === "SIGTERM" ? 143 : 1
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined
const modulePath = fileURLToPath(import.meta.url)
const invokedAsMain = (() => {
  if (!invokedPath) return false
  try {
    return realpathSync(invokedPath) === realpathSync(modulePath)
  } catch {
    return invokedPath === modulePath
  }
})()

if (invokedAsMain) {
  try {
    process.exitCode = await launchLikho()
  } catch (error) {
    process.stderr.write(`likho: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
