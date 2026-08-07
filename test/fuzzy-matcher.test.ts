import { expect, test } from "bun:test"
import { createFuzzyMatcher } from "../src/fuzzy-matcher"

interface FileChoice {
  readonly id: string
  readonly baseName: string
  readonly relativePath: string
}

const choices: readonly FileChoice[] = [
  { id: "path", baseName: "readme.md", relativePath: "index/readme.md" },
  { id: "base", baseName: "index.ts", relativePath: "src/index.ts" },
  { id: "unicode", baseName: "café.ts", relativePath: "src/café.ts" },
]

test("fuzzy matching prefers a basename hit and exposes half-open highlight ranges", () => {
  const matcher = createFuzzyMatcher(choices, [
    { name: "baseName", weight: 0.7 },
    { name: "relativePath", weight: 0.3 },
  ])

  const results = matcher.search("index")

  expect(results.map(({ item }) => item.id)).toEqual(["base", "path"])
  expect(results[0]?.matches).toContainEqual({ field: "baseName", start: 0, end: 5 })
  expect(results[0]?.rank).toBeGreaterThanOrEqual(0)
  expect(results[0]?.rank).toBeLessThanOrEqual(1)
})

test("fuzzy matching preserves Unicode labels and enforces the result limit", () => {
  const matcher = createFuzzyMatcher(choices, [{ name: "baseName", weight: 1 }])

  const results = matcher.search("café", 1)
  expect(results).toHaveLength(1)
  expect(results[0]?.item).toBe(choices[2])
  expect(results[0]?.matches).toEqual([{ field: "baseName", start: 0, end: 4 }])
  expect(matcher.search("", 2).map(({ item }) => item.id)).toEqual(["path", "base"])
})
