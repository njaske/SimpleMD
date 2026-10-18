// The text model behind the Markdown transforms: selections, changes and position mapping,
// plus line and word helpers. Pure and DOM-free, so the transforms test without CodeMirror.

export interface TextRange {
  readonly from: number
  readonly to: number
}

export interface TextState {
  readonly text: string
  readonly selection: TextRange
}

/** One replacement in original-document coordinates (CodeMirror's change shape). */
export interface TextChange {
  readonly from: number
  readonly to: number
  readonly insert: string
}

/** Changes to apply plus the selection afterwards, in new-document coordinates. */
export interface FormatEdit {
  readonly changes: readonly TextChange[]
  readonly selection: { readonly anchor: number; readonly head: number }
}

export interface FormatOptions {
  /** Current clipboard text, so link/image can pick up a copied URL. */
  readonly clipboard?: string
}

// ---- documents, lines and position mapping ----------------------------------------

export interface Doc {
  readonly text: string
  readonly lines: readonly string[]
  readonly starts: readonly number[]
}

export function toDoc(text: string): Doc {
  const lines = text.split('\n')
  const starts: number[] = []
  let pos = 0
  for (const line of lines) {
    starts.push(pos)
    pos += line.length + 1
  }
  return { text, lines, starts }
}

export function lineIndexAt(doc: Doc, pos: number): number {
  let lo = 0
  let hi = doc.starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (doc.starts[mid] <= pos) lo = mid
    else hi = mid - 1
  }
  return lo
}

export const lineEnd = (doc: Doc, i: number): number => doc.starts[i] + doc.lines[i].length
export const isBlank = (line: string): boolean => line.trim() === ''

/** First and last line the selection touches. A selection that ends at the very start of
 *  a line doesn't include that line (the usual "select whole lines" gesture). */
export function touchedLines(doc: Doc, sel: TextRange): readonly [number, number] {
  const first = lineIndexAt(doc, sel.from)
  let last = lineIndexAt(doc, sel.to)
  if (last > first && doc.starts[last] === sel.to) last--
  return [first, last]
}

export function range(first: number, last: number): number[] {
  return Array.from({ length: last - first + 1 }, (_, k) => first + k)
}

/** Map a position through sorted, non-overlapping changes. `assoc` < 0 keeps it before
 *  text inserted at that spot, > 0 moves it after (CodeMirror's convention). */
export function mapPos(changes: readonly TextChange[], pos: number, assoc: -1 | 1): number {
  let delta = 0
  for (const c of changes) {
    if (pos < c.from) break
    const size = c.insert.length - (c.to - c.from)
    // Entirely before pos (a replacement ending exactly at pos counts as before).
    if (c.to < pos || (c.to === pos && c.from < pos)) {
      delta += size
      continue
    }
    if (c.from === c.to) {
      if (assoc < 0) break
      delta += size
      continue
    }
    // A replacement covering pos: land on whichever side `assoc` asks for.
    return c.from + delta + (assoc < 0 ? 0 : c.insert.length)
  }
  return pos + delta
}

export function sortChanges(changes: readonly TextChange[]): TextChange[] {
  return changes
    .filter((c) => c.from !== c.to || c.insert !== '')
    .slice()
    .sort((a, b) => a.from - b.from)
}

/** Keep the selection on the same text: a cursor follows insertions, a range keeps its
 *  content (start moves past text inserted at it, end stays before it). */
export function keepSelection(changes: readonly TextChange[], sel: TextRange): FormatEdit {
  const sorted = sortChanges(changes)
  const empty = sel.from === sel.to
  return {
    changes: sorted,
    selection: { anchor: mapPos(sorted, sel.from, 1), head: mapPos(sorted, sel.to, empty ? 1 : -1) }
  }
}

export function select(changes: readonly TextChange[], anchor: number, head = anchor): FormatEdit {
  return { changes: sortChanges(changes), selection: { anchor, head } }
}

/** Smallest change turning `old` into `next` (a line at `from`). The shared tail never
 *  starts with whitespace, so "1. foo" -> "- foo" replaces the whole marker "1. ". */
export function lineChange(from: number, old: string, next: string): TextChange | null {
  if (old === next) return null
  let tail = 0
  const max = Math.min(old.length, next.length)
  while (tail < max && old[old.length - 1 - tail] === next[next.length - 1 - tail]) tail++
  while (tail > 0 && /\s/.test(old[old.length - tail])) tail--
  let head = 0
  while (head < max - tail && old[head] === next[head]) head++
  return { from: from + head, to: from + old.length - tail, insert: next.slice(head, next.length - tail) }
}

/** Edit for a same-length rewrite of the document's lines. */
export function editFromLines(doc: Doc, next: readonly string[], sel: TextRange): FormatEdit {
  const changes: TextChange[] = []
  next.forEach((line, i) => {
    const change = line === doc.lines[i] ? null : lineChange(doc.starts[i], doc.lines[i], line)
    if (change) changes.push(change)
  })
  return keepSelection(changes, sel)
}

/** The line around `pos`, as [start, end). */
export function lineAround(text: string, pos: number): readonly [number, number] {
  const start = pos === 0 ? 0 : text.lastIndexOf('\n', pos - 1) + 1
  const end = text.indexOf('\n', pos)
  return [start, end < 0 ? text.length : end]
}

export const ALNUM = /[\p{L}\p{N}]/u

const WORD_CHAR = /[\p{L}\p{N}\p{M}'’]/u

/** Letters, plus an underscore between letters ("snake_case" is one word). */
function isWordChar(text: string, i: number): boolean {
  if (WORD_CHAR.test(text[i] ?? '')) return true
  return text[i] === '_' && ALNUM.test(text[i - 1] ?? '') && ALNUM.test(text[i + 1] ?? '')
}

/** The word touching `pos`, if any (underscores at its edges are markers, not letters). */
export function wordAt(text: string, pos: number): TextRange | null {
  let from = pos
  let to = pos
  while (from > 0 && isWordChar(text, from - 1)) from--
  while (to < text.length && isWordChar(text, to)) to++
  return from < to ? { from, to } : null
}

/** Apply an edit to plain text (tests and previews). */
export function applyEdit(text: string, edit: FormatEdit): string {
  return [...edit.changes].reverse().reduce((t, c) => t.slice(0, c.from) + c.insert + t.slice(c.to), text)
}
