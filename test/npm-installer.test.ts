import { afterEach, expect, test } from "bun:test"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { copyBinary, packageNames } from "../npm/postinstall.mjs"

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true })
})

test("selects the native npm package for each supported platform", () => {
  expect(packageNames({ platform: "darwin", arch: "arm64" })).toEqual([
    "likho-darwin-arm64",
  ])
  expect(packageNames({ platform: "win32", arch: "x64" })).toEqual([
    "likho-windows-x64",
  ])
  expect(packageNames({ platform: "linux", arch: "x64", musl: false })).toEqual(
    ["likho-linux-x64", "likho-linux-x64-musl"],
  )
  expect(
    packageNames({ platform: "linux", arch: "arm64", musl: true }),
  ).toEqual(["likho-linux-arm64-musl", "likho-linux-arm64"])
  expect(() => packageNames({ platform: "freebsd", arch: "x64" })).toThrow(
    "Unsupported platform",
  )
  expect(() => packageNames({ platform: "darwin", arch: "ia32" })).toThrow(
    "Unsupported architecture",
  )
})

test("copies a native package binary into the wrapper", () => {
  const directory = mkdtempSync(join(tmpdir(), "likho-installer-test-"))
  directories.push(directory)
  const source = join(directory, "native", "likho")
  const target = join(directory, "wrapper", "bin", "likho.exe")

  mkdirSync(join(directory, "native"))
  writeFileSync(source, "native-binary", { mode: 0o755 })
  copyBinary(source, target)

  expect(existsSync(target)).toBe(true)
  expect(readFileSync(target, "utf8")).toBe("native-binary")
})
