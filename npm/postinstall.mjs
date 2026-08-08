#!/usr/bin/env node

import childProcess from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const directory = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

function detectMusl() {
  if (os.platform() !== "linux") return false

  try {
    if (fs.existsSync("/etc/alpine-release")) return true
  } catch {
    // Continue to the ldd probe when filesystem access is restricted.
  }

  try {
    const report = process.report?.getReport?.()
    if (report?.header?.glibcVersionRuntime) return false
  } catch {
    // Continue to the ldd probe when runtime reports are unavailable.
  }

  try {
    const result = childProcess.spawnSync("ldd", ["--version"], {
      encoding: "utf8",
    })
    return `${result.stdout || ""}${result.stderr || ""}`
      .toLowerCase()
      .includes("musl")
  } catch {
    return false
  }
}

export function packageNames({
  platform = os.platform(),
  arch = os.arch(),
  musl = platform === "linux" && detectMusl(),
} = {}) {
  if (arch !== "arm64" && arch !== "x64") {
    throw new Error(`Unsupported architecture: ${arch}`)
  }

  const platformName = platform === "win32" ? "windows" : platform
  if (
    platformName !== "darwin" &&
    platformName !== "linux" &&
    platformName !== "windows"
  ) {
    throw new Error(`Unsupported platform: ${platform}`)
  }

  const base = `likho-${platformName}-${arch}`
  if (platformName !== "linux") return [base]
  return musl ? [`${base}-musl`, base] : [base, `${base}-musl`]
}

function sourceBinary(platform = os.platform()) {
  return platform === "win32" ? "likho.exe" : "likho"
}

export function copyBinary(source, target) {
  if (!fs.existsSync(source)) throw new Error(`Binary not found at ${source}`)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  if (fs.existsSync(target)) fs.unlinkSync(target)
  try {
    fs.linkSync(source, target)
  } catch {
    fs.copyFileSync(source, target)
  }
  fs.chmodSync(target, 0o755)
}

function resolveBinary(name, platform = os.platform()) {
  const packageJsonPath = require.resolve(`${name}/package.json`)
  const binaryPath = path.join(
    path.dirname(packageJsonPath),
    "bin",
    sourceBinary(platform),
  )
  if (!fs.existsSync(binaryPath))
    throw new Error(`Binary not found at ${binaryPath}`)
  return binaryPath
}

function installPackage(name, version, target, platform = os.platform()) {
  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "likho-install-"),
  )
  try {
    const result = childProcess.spawnSync(
      "npm",
      [
        "install",
        "--ignore-scripts",
        "--no-save",
        "--loglevel=error",
        "--prefix",
        temporaryDirectory,
        `${name}@${version}`,
      ],
      { stdio: "inherit", windowsHide: true },
    )
    if (result.status !== 0) return false
    copyBinary(
      path.join(
        temporaryDirectory,
        "node_modules",
        name,
        "bin",
        sourceBinary(platform),
      ),
      target,
    )
    return true
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true })
  }
}

function verifyBinary(target) {
  const result = childProcess.spawnSync(target, ["--version"], {
    stdio: "ignore",
    windowsHide: true,
  })
  return result.status === 0
}

export function install({ platform = os.platform(), arch = os.arch() } = {}) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(directory, "package.json"), "utf8"),
  )
  const target = path.join(directory, "bin", "likho.exe")
  const names = packageNames({ platform, arch })

  for (const name of names) {
    const version = manifest.optionalDependencies?.[name]
    if (!version) continue

    try {
      copyBinary(resolveBinary(name, platform), target)
      if (verifyBinary(target)) return
    } catch {
      if (
        installPackage(name, version, target, platform) &&
        verifyBinary(target)
      )
        return
    }
  }

  throw new Error(
    `Your package manager did not install the correct Likho binary. Try manually installing ${names
      .map((name) => JSON.stringify(name))
      .join(" or ")}.`,
  )
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined
const modulePath = fileURLToPath(import.meta.url)
if (invokedPath === modulePath) {
  try {
    install()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
