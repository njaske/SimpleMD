// CONTRACT STUB (lane L implements). Fuzzy matching for Quick Open and the command palette.

export interface FuzzyMatch {
  /** Higher is better. Only comparable between matches of the same query. */
  score: number
  /** Indexes into the matched text of each query character, for highlighting. */
  positions: number[]
}

/** Case-insensitive subsequence match of `query` in `text`, or null when it doesn't match.
 *  Rewards consecutive characters, word starts (after space, -, _, /, \, ., or a
 *  lower→upper case change) and an early first match. An empty query matches with score 0. */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  if (!query) return { score: 0, positions: [] }
  const i = text.toLowerCase().indexOf(query.toLowerCase())
  if (i < 0) return null
  return { score: 1, positions: Array.from({ length: query.length }, (_, k) => i + k) }
}

export interface FuzzyResult<T> {
  item: T
  match: FuzzyMatch
}

/** Match every item's `key(item)` and return the matches best-first (stable for ties),
 *  at most `limit` of them. An empty query returns the first `limit` items in order. */
export function fuzzyFilter<T>(
  query: string,
  items: readonly T[],
  key: (item: T) => string,
  limit = 50
): FuzzyResult<T>[] {
  const out: FuzzyResult<T>[] = []
  for (const item of items) {
    const match = fuzzyMatch(query, key(item))
    if (match) out.push({ item, match })
    if (out.length >= limit) break
  }
  return out
}
