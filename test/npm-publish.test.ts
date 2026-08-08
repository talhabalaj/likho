import { expect, test } from "bun:test"
import {
  publicationOrder,
  validatePackages,
} from "../scripts/publish-npm-release"
import { nativePackageName, targets } from "../scripts/build-release"

test("publishes native packages before the wrapper", () => {
  const packages = [
    { directory: "wrapper", name: "likho", version: "1.2.3" },
    { directory: "linux", name: "likho-linux-x64", version: "1.2.3" },
    { directory: "darwin", name: "likho-darwin-arm64", version: "1.2.3" },
  ]

  expect(publicationOrder(packages).map((item) => item.name)).toEqual([
    "likho-darwin-arm64",
    "likho-linux-x64",
    "likho",
  ])
})

test("refuses to publish an incomplete or mixed-version release", () => {
  const complete = [
    { directory: "wrapper", name: "likho", version: "1.2.3" },
    ...targets.map((target) => ({
      directory: target.name,
      name: nativePackageName(target),
      version: "1.2.3",
    })),
  ]

  expect(() => validatePackages(complete)).not.toThrow()
  expect(() => validatePackages(complete.slice(1))).toThrow(
    "Expected release packages",
  )
  expect(() =>
    validatePackages(
      complete.map((item, index) =>
        index === 0 ? { ...item, version: "2.0.0" } : item,
      ),
    ),
  ).toThrow("same version")
})
