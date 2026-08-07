import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { toDisplayHighlights } from "../src/plugins/syntax-highlighting"

test("builds an executable that launches with Bun", () => {
  const projectRoot = join(import.meta.dir, "..")
  const build = Bun.spawnSync(["bun", "run", "build"], { cwd: projectRoot })

  expect(build.exitCode).toBe(0)
  expect(readFileSync(join(projectRoot, "dist/index.js"), "utf8").split("\n", 1)[0]).toBe("#!/usr/bin/env bun")
})

test("the executable reports invalid usage without entering the terminal UI", () => {
  const projectRoot = join(import.meta.dir, "..")
  const result = Bun.spawnSync(["bun", "run", "src/index.ts"], { cwd: projectRoot })

  expect(result.exitCode).toBe(2)
  expect(result.stderr.toString()).toBe("Usage: likho <file>\n")
})

test("maps Tree-sitter source columns to terminal display columns", () => {
  expect(
    toDisplayHighlights("\t漢 const", [
      {
        line: 0,
        highlights: [
          { startCol: 1, endCol: 2, group: "variable" },
          { startCol: 3, endCol: 8, group: "keyword" },
        ],
        droppedHighlights: [],
      },
    ]),
  ).toEqual([
    { line: 0, start: 1, end: 3, group: "variable" },
    { line: 0, start: 4, end: 9, group: "keyword" },
  ])
})
