import Fuse, { type FuseOptionKey } from "fuse.js"

export interface MatchRange {
  readonly field: string
  readonly start: number
  readonly end: number
}

export interface FuzzyMatch<T> {
  readonly item: T
  readonly matches: readonly MatchRange[]
}

export interface FuzzyMatcher<T> {
  search(query: string, limit?: number): readonly FuzzyMatch<T>[]
}

export function createFuzzyMatcher<T extends object>(
  items: readonly T[],
  keys: readonly Readonly<{ name: keyof T & string; weight: number }>[],
): FuzzyMatcher<T> {
  const fuse = new Fuse(items, {
    keys: keys.map(({ name, weight }) => ({ name, weight })) as FuseOptionKey<T>[],
    includeMatches: true,
    ignoreLocation: true,
    threshold: 0.4,
  })

  return {
    search(query, limit = 100) {
      if (!query) return items.slice(0, limit).map((item) => ({ item, matches: [] }))
      return fuse.search(query, { limit }).map((result) => ({
        item: result.item,
        matches: (result.matches ?? []).flatMap((match) =>
          match.key
            ? match.indices.map(([start, inclusiveEnd]) => ({
                field: match.key!,
                start,
                end: inclusiveEnd + 1,
              }))
            : [],
        ),
      }))
    },
  }
}
