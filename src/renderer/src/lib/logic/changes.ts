// CONTRACT STUB (lane L implements, using the `diff` package). "What changed" tracking:
// which lines of a document are new or edited since the user last saw it.
import type { LineRange } from '@/lib/ranges'

/** Line ranges of `after` that were added or changed compared with `before`, merged and
 *  sorted. A pure deletion is reported as a one-line range at the line that now follows
 *  the removed text (clamped to the last line), so the spot is still visible. Identical
 *  texts give []. Trailing-whitespace-only and line-ending-only (CRLF vs LF) differences
 *  are ignored. */
export function changedLineRanges(before: string, after: string): LineRange[] {
  if (before === after) return []
  return []
}

/** Total number of lines covered by `ranges`. */
export function countChangedLines(ranges: readonly LineRange[]): number {
  return ranges.reduce((n, r) => n + Math.max(0, r.to - r.from), 0)
}
