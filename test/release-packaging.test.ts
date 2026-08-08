import { expect, test } from "bun:test"
import manifest from "../package.json" with { type: "json" }
import {
  nativePackageManifest,
  nativePackageName,
  targets,
  wrapperPackageManifest,
} from "../scripts/build-release"

test("generates one optional native dependency for every release target", () => {
  const wrapper = wrapperPackageManifest(manifest)

  expect(wrapper.bin).toEqual({ likho: "./bin/likho.exe" })
  expect(wrapper.scripts).toEqual({ postinstall: "node ./postinstall.mjs" })
  expect(wrapper.optionalDependencies).toEqual(
    Object.fromEntries(
      targets.map((target) => [nativePackageName(target), manifest.version]),
    ),
  )
})

test("native package metadata lets npm filter by operating system, CPU, and musl", () => {
  const glibc = targets.find((target) => target.name === "linux-x64")!
  const musl = targets.find((target) => target.name === "linux-x64-musl")!
  const windows = targets.find((target) => target.name === "windows-arm64")!

  expect(nativePackageManifest(manifest, glibc)).not.toHaveProperty("libc")
  expect(nativePackageManifest(manifest, musl)).toMatchObject({
    name: "likho-linux-x64-musl",
    os: ["linux"],
    cpu: ["x64"],
    libc: ["musl"],
  })
  expect(nativePackageManifest(manifest, windows)).toMatchObject({
    name: "likho-windows-arm64",
    os: ["win32"],
    cpu: ["arm64"],
  })
})
