// "What changed" tracking: which lines of a document are new or edited since the user
// last saw it. Lines are compared with the `diff` package after normalizing line endings
// and trailing whitespace, so a CRLF round-trip or an editor trimming spaces is no change.
// This runs on the UI thread every time an agent writes the file, so big inputs are first
// split at lines that occur once on each side (patience diff) and the precise diff only
// ever sees small gaps; a gap too different to diff cheaply is marked line by line.
import { diffArrays } from 'diff'
import type { LineRange } from '@/lib/ranges'

/** Up to this many line edits a gap gets a minimal diff. Beyond it Myers' algorithm costs
 *  milliseconds per hundred edits, and a rewrite that big gains nothing from precision. */
const MAX_PRECISE_EDITS = 300
/** Gaps longer than this (lines on both sides together) are split at unique lines first. */
const SPLIT_ABOVE_LINES = 600
/** Splitting recurses into gaps; deeper than this only happens on contrived input. */
const MAX_SPLIT_DEPTH = 8
/** Wall-clock budget for all precise diffing of one call; after it, gaps are approximated. */
const DIFF_BUDGET_MS = 40

/** Lines with endings and trailing whitespace dropped. A final line ending doesn't add an
 *  empty last line, so "a\n" and "a" compare equal; "" is one empty line. */
function normalizedLines(text: string): string[] {
  const lines = text.split(/\r\n|\r|\n/).map((line) => line.trimEnd())
  return lines.length > 1 && lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines
}

/** A stretch of `before` (a) and `after` (b) still to compare, as half-open indexes. */
interface Span {
  aFrom: number
  aTo: number
  bFrom: number
  bTo: number
}

interface Hunk {
  /** Lines removed from `before` at this point (0 for a pure insertion). */
  removed: number
  /** Index in `after` where the hunk starts. */
  at: number
  /** Lines added to `after` (0 for a pure deletion). */
  added: number
}

/** The span without the lines it shares at the start and at the end (never overlapping).
 *  Cheap, and it keeps huge mostly-equal documents fast. */
function trimSpan(a: readonly string[], b: readonly string[], s: Span): Span {
  let { aFrom, bFrom, aTo, bTo } = s
  while (aFrom < aTo && bFrom < bTo && a[aFrom] === b[bFrom]) {
    aFrom++
    bFrom++
  }
  while (aTo > aFrom && bTo > bFrom && a[aTo - 1] === b[bTo - 1]) {
    aTo--
    bTo--
  }
  return { aFrom, aTo, bFrom, bTo }
}

/** Minimal hunks from the `diff` package, or null when the gap needs more than
 *  MAX_PRECISE_EDITS edits or the time budget runs out. */
function preciseHunks(a: readonly string[], b: readonly string[], s: Span, deadline: number): Hunk[] | null {
  const timeout = deadline - Date.now()
  if (timeout <= 0) return null
  const changes = diffArrays(a.slice(s.aFrom, s.aTo), b.slice(s.bFrom, s.bTo), {
    maxEditLength: MAX_PRECISE_EDITS,
    timeout
  })
  if (!changes) return null
  const hunks: Hunk[] = []
  let at = s.bFrom
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

/** For a gap too different to diff: every line of `after` whose text isn't anywhere in the
 *  old gap counts as changed. Exact for rewrites and scattered edits; when nothing new
 *  remains (only removals or moves), the spot is marked as a deletion. */
function approximateHunks(a: readonly string[], b: readonly string[], s: Span): Hunk[] {
  const old = new Set(a.slice(s.aFrom, s.aTo))
  const hunks: Hunk[] = []
  let open: Hunk | null = null
  for (let j = s.bFrom; j < s.bTo; j++) {
    if (!old.has(b[j])) {
      const current: Hunk = open ?? { removed: 0, at: j, added: 0 }
      open = { ...current, added: current.added + 1 }
      continue
    }
    if (open) hunks.push(open)
    open = null
  }
  const all = open ? [...hunks, open] : hunks
  return all.length > 0 ? all : [{ removed: s.aTo - s.aFrom, at: s.bFrom, added: 0 }]
}

/** Lines of the new gap whose text is nowhere in the old one: a lower bound on the edits. */
function newLineCount(a: readonly string[], b: readonly string[], s: Span): number {
  const old = new Set(a.slice(s.aFrom, s.aTo))
  let count = 0
  for (let j = s.bFrom; j < s.bTo; j++) if (!old.has(b[j])) count++
  return count
}

/** Each line's index in `lines[from..to)` when it occurs exactly once there, else -1. */
function uniqueIndexes(lines: readonly string[], from: number, to: number): Map<string, number> {
  const seen = new Map<string, number>()
  for (let i = from; i < to; i++) seen.set(lines[i], seen.has(lines[i]) ? -1 : i)
  return seen
}

/** Lines that occur exactly once in both sides of the span, as [aIndex, bIndex] pairs in
 *  order on both sides: the longest increasing run of such pairs (patience sorting). */
function uniqueAnchors(a: readonly string[], b: readonly string[], s: Span): Array<[number, number]> {
  const inA = uniqueIndexes(a, s.aFrom, s.aTo)
  const inB = uniqueIndexes(b, s.bFrom, s.bTo)
  const pairs: Array<[number, number]> = []
  for (let j = s.bFrom; j < s.bTo; j++) {
    const i = inA.get(b[j]) ?? -1
    if (i >= 0 && inB.get(b[j]) === j) pairs.push([i, j])
  }
  // Pairs are in b order; keep the longest subsequence that is also in a order.
  const tops: number[] = []
  const back = new Array<number>(pairs.length)
  pairs.forEach(([i], k) => {
    let lo = 0
    let hi = tops.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (pairs[tops[mid]][0] < i) lo = mid + 1
      else hi = mid
    }
    back[k] = lo > 0 ? tops[lo - 1] : -1
    tops[lo] = k
  })
  const anchors: Array<[number, number]> = []
  for (let k = tops.length ? tops[tops.length - 1] : -1; k >= 0; k = back[k]) anchors.push(pairs[k])
  return anchors.reverse()
}

/** Diff the gaps between anchors (equal lines, so they are never part of a hunk). */
function splitAtAnchors(
  a: readonly string[],
  b: readonly string[],
  s: Span,
  anchors: ReadonlyArray<[number, number]>,
  deadline: number,
  depth: number
): Hunk[] {
  // Gap k runs from just after anchor k - 1 (or the span start) up to anchor k (or the end).
  const after: Array<[number, number]> = [[s.aFrom - 1, s.bFrom - 1], ...anchors]
  const ends: Array<[number, number]> = [...anchors, [s.aTo, s.bTo]]
  return ends.flatMap(([aTo, bTo], k) => {
    const gap = { aFrom: after[k][0] + 1, aTo, bFrom: after[k][1] + 1, bTo }
    return diffSpan(a, b, gap, deadline, depth + 1)
  })
}

/** Hunks for one span: split big ones at unique lines, diff small ones precisely, and
 *  approximate whatever is left. */
function diffSpan(a: readonly string[], b: readonly string[], span: Span, deadline: number, depth: number): Hunk[] {
  const s = trimSpan(a, b, span)
  const aLength = s.aTo - s.aFrom
  const bLength = s.bTo - s.bFrom
  if (aLength === 0 && bLength === 0) return []
  if (aLength === 0 || bLength === 0) return [{ removed: aLength, at: s.bFrom, added: bLength }]
  if (aLength + bLength > SPLIT_ABOVE_LINES) {
    const anchors = depth < MAX_SPLIT_DEPTH ? uniqueAnchors(a, b, s) : []
    if (anchors.length > 0) return splitAtAnchors(a, b, s, anchors, deadline, depth)
    // A big gap with no anchors is usually a rewrite: skip a precise diff that can't succeed.
    if (newLineCount(a, b, s) > MAX_PRECISE_EDITS) return approximateHunks(a, b, s)
  }
  return preciseHunks(a, b, s, deadline) ?? approximateHunks(a, b, s)
}

/** A hunk as the lines of `after` to highlight. A pure deletion marks the line that now
 *  follows the removed text, clamped to the last line. */
function hunkRange(h: Hunk, afterLength: number): LineRange {
  if (h.added > 0) return { from: h.at, to: h.at + h.added }
  const line = Math.max(0, Math.min(h.at, afterLength - 1))
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
  const span = { aFrom: 0, aTo: a.length, bFrom: 0, bTo: b.length }
  const hunks = diffSpan(a, b, span, Date.now() + DIFF_BUDGET_MS, 0)
  return mergeRanges(hunks.map((h) => hunkRange(h, b.length)))
}

/** Total number of lines covered by `ranges`. */
export function countChangedLines(ranges: readonly LineRange[]): number {
  return ranges.reduce((n, r) => n + Math.max(0, r.to - r.from), 0)
}
