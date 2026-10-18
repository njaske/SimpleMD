// "What changed" tracking: which lines of a document are new or edited since the user
// last saw it. Lines are compared with the `diff` package after normalizing line endings
// and trailing whitespace, so a CRLF round-trip or an editor trimming spaces is no change.
import { diffArrays } from 'diff'
import type { LineRange } from '@/lib/ranges'

/** Give up on a precise diff after this long and mark the whole edited middle instead
 *  (only wildly different multi-megabyte texts get near it). */
const DIFF_TIMEOUT_MS = 150

/** Lines with endings and trailing whitespace dropped. A final line ending doesn't add an
 *  empty last line, so "a\n" and "a" compare equal; "" is one empty line. */
function normalizedLines(text: string): string[] {
  const lines = text.split(/\r\n|\r|\n/).map((line) => line.trimEnd())
  return lines.length > 1 && lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines
}

/** Lines shared at the start and at the end (never overlapping), so the diff only sees
 *  the edited middle. Cheap, and it keeps huge mostly-equal documents fast. */
function commonEnds(a: readonly string[], b: readonly string[]): { head: number; tail: number } {
  const max = Math.min(a.length, b.length)
  let head = 0
  while (head < max && a[head] === b[head]) head++
  let tail = 0
  while (tail < max - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++
  return { head, tail }
}

interface Hunk {
  /** Lines removed from `before` at this point (0 for a pure insertion). */
  removed: number
  /** Index in `after` where the hunk starts. */
  at: number
  /** Lines added to `after` (0 for a pure deletion). */
  added: number
}

/** Edited stretches of the middle part, with indexes relative to it. */
function middleHunks(a: string[], b: string[]): Hunk[] {
  if (a.length === 0 || b.length === 0) return [{ removed: a.length, at: 0, added: b.length }]
  const changes = diffArrays(a, b, { timeout: DIFF_TIMEOUT_MS })
  if (!changes) return [{ removed: a.length, at: 0, added: b.length }]
  const hunks: Hunk[] = []
  let at = 0
  let open: Hunk | null = null
  for (const change of changes) {
    if (!change.added && !change.removed) {
      if (open) hunks.push(open)
      open = null
      at += change.count
      continue
    }
    const current: Hunk = open ?? { removed: 0, at, added: 0 }
    open = change.added
      ? { ...current, added: current.added + change.count }
      : { ...current, removed: current.removed + change.count }
    if (change.added) at += change.count
  }
  return open ? [...hunks, open] : hunks
}

/** A hunk as the lines of `after` to highlight. A pure deletion marks the line that now
 *  follows the removed text, clamped to the last line. */
function hunkRange(h: Hunk, offset: number, afterLength: number): LineRange {
  const from = offset + h.at
  if (h.added > 0) return { from, to: from + h.added }
  const line = Math.max(0, Math.min(from, afterLength - 1))
  return { from: line, to: line + 1 }
}

/** Sorted ranges with overlapping or touching neighbours merged. */
export function mergeRanges(ranges: readonly LineRange[]): LineRange[] {
  const sorted = ranges.filter((r) => r.to > r.from).sort((a, b) => a.from - b.from || a.to - b.to)
  const out: LineRange[] = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    // Replace rather than mutate: the inputs' objects are never touched.
    if (last && r.from <= last.to) out[out.length - 1] = { from: last.from, to: Math.max(last.to, r.to) }
    else out.push({ from: r.from, to: r.to })
  }
  return out
}

/** Line ranges of `after` that were added or changed compared with `before`, merged and
 *  sorted. A pure deletion is reported as a one-line range at the line that now follows
 *  the removed text (clamped to the last line), so the spot is still visible. Identical
 *  texts give []. Trailing-whitespace-only and line-ending-only (CRLF vs LF) differences
 *  are ignored. */
export function changedLineRanges(before: string, after: string): LineRange[] {
  if (before === after) return []
  const a = normalizedLines(before)
  const b = normalizedLines(after)
  const { head, tail } = commonEnds(a, b)
  if (head === a.length && head === b.length) return []
  const hunks = middleHunks(a.slice(head, a.length - tail), b.slice(head, b.length - tail))
  return mergeRanges(hunks.map((h) => hunkRange(h, head, b.length)))
}

/** Total number of lines covered by `ranges`. */
export function countChangedLines(ranges: readonly LineRange[]): number {
  return ranges.reduce((n, r) => n + Math.max(0, r.to - r.from), 0)
}
