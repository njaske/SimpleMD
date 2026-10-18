// Pure Markdown text transforms behind the format bar and the editor shortcuts. Each one
// takes the document text plus the main selection and returns the edits to make, so the
// rules can be unit-tested without CodeMirror (commands.ts wraps them as commands).
// Self-contained on purpose: node's test runner can't follow extensionless imports.
import type { FormatCommand } from './types'

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

interface Doc {
  readonly text: string
  readonly lines: readonly string[]
  readonly starts: readonly number[]
}

function toDoc(text: string): Doc {
  const lines = text.split('\n')
  const starts: number[] = []
  let pos = 0
  for (const line of lines) {
    starts.push(pos)
    pos += line.length + 1
  }
  return { text, lines, starts }
}

function lineIndexAt(doc: Doc, pos: number): number {
  let lo = 0
  let hi = doc.starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (doc.starts[mid] <= pos) lo = mid
    else hi = mid - 1
  }
  return lo
}

const lineEnd = (doc: Doc, i: number): number => doc.starts[i] + doc.lines[i].length
const isBlank = (line: string): boolean => line.trim() === ''

/** First and last line the selection touches. A selection that ends at the very start of
 *  a line doesn't include that line (the usual "select whole lines" gesture). */
function touchedLines(doc: Doc, sel: TextRange): readonly [number, number] {
  const first = lineIndexAt(doc, sel.from)
  let last = lineIndexAt(doc, sel.to)
  if (last > first && doc.starts[last] === sel.to) last--
  return [first, last]
}

function range(first: number, last: number): number[] {
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

function sortChanges(changes: readonly TextChange[]): TextChange[] {
  return changes
    .filter((c) => c.from !== c.to || c.insert !== '')
    .slice()
    .sort((a, b) => a.from - b.from)
}

/** Keep the selection on the same text: a cursor follows insertions, a range keeps its
 *  content (start moves past text inserted at it, end stays before it). */
function keepSelection(changes: readonly TextChange[], sel: TextRange): FormatEdit {
  const sorted = sortChanges(changes)
  const empty = sel.from === sel.to
  return {
    changes: sorted,
    selection: { anchor: mapPos(sorted, sel.from, 1), head: mapPos(sorted, sel.to, empty ? 1 : -1) }
  }
}

function select(changes: readonly TextChange[], anchor: number, head = anchor): FormatEdit {
  return { changes: sortChanges(changes), selection: { anchor, head } }
}

/** Smallest change turning `old` into `next` (a line at `from`). The shared tail never
 *  starts with whitespace, so "1. foo" -> "- foo" replaces the whole marker "1. ". */
function lineChange(from: number, old: string, next: string): TextChange | null {
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
function editFromLines(doc: Doc, next: readonly string[], sel: TextRange): FormatEdit {
  const changes: TextChange[] = []
  next.forEach((line, i) => {
    const change = line === doc.lines[i] ? null : lineChange(doc.starts[i], doc.lines[i], line)
    if (change) changes.push(change)
  })
  return keepSelection(changes, sel)
}

// ---- line anatomy ---------------------------------------------------------------------

const QUOTE_RE = /^(?:[ \t]{0,3}>[ \t]?)+/
const LIST_RE = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+|$)(\[[ xX]\](?:[ \t]+|$))?/
const HEADING_RE = /^[ \t]{0,3}(#{1,6})(?:[ \t]+|$)/
const FENCE_RE = /^[ \t]{0,3}(`{3,}|~{3,})/

interface LineParts {
  readonly quote: string
  /** Leading whitespace of a list item, or of a plain line. */
  readonly indent: string
  readonly marker: string
  readonly gap: string
  readonly box: string
  readonly heading: number
  /** The text after every prefix. */
  readonly body: string
}

function parseLine(line: string): LineParts {
  const quote = QUOTE_RE.exec(line)?.[0] ?? ''
  const rest = line.slice(quote.length)
  const list = LIST_RE.exec(rest)
  if (list) {
    const [all, indent, marker, gap, box = ''] = list
    return { quote, indent, marker, gap, box, heading: 0, body: rest.slice(all.length) }
  }
  const heading = HEADING_RE.exec(rest)
  if (heading) return { quote, indent: '', marker: '', gap: '', box: '', heading: heading[1].length, body: rest.slice(heading[0].length) }
  const indent = /^[ \t]*/.exec(rest)?.[0] ?? ''
  return { quote, indent, marker: '', gap: '', box: '', heading: 0, body: rest.slice(indent.length) }
}

type ListKind = 'bulletList' | 'numberedList' | 'taskList'

function listKind(p: LineParts): ListKind | null {
  if (!p.marker) return null
  if (p.box) return 'taskList'
  return /\d/.test(p.marker) ? 'numberedList' : 'bulletList'
}

const width = (ws: string): number => ws.replace(/\t/g, '    ').length

/** Lines a block command applies to: blank lines only count when nothing else is touched. */
function contentLines(doc: Doc, sel: TextRange): number[] {
  const [first, last] = touchedLines(doc, sel)
  const all = range(first, last)
  const filled = all.filter((i) => !isBlank(doc.lines[i]))
  return filled.length ? filled : all
}

// ---- inline marks ---------------------------------------------------------------------

type InlineCommand = 'bold' | 'italic' | 'strikethrough' | 'code'

interface MarkSpec {
  readonly chars: readonly string[]
  readonly insert: string
  /** Does a run of `n` marker characters on both sides carry this mark? */
  readonly present: (n: number) => boolean
  /** How many marker characters to strip from each side. */
  readonly strip: (n: number) => number
}

// Runs decide bold vs italic: "*x*" italic, "**x**" bold, "***x***" both.
const MARKS: Record<InlineCommand, MarkSpec> = {
  bold: { chars: ['*', '_'], insert: '**', present: (n) => n >= 2, strip: () => 2 },
  italic: { chars: ['*', '_'], insert: '*', present: (n) => n % 2 === 1, strip: () => 1 },
  strikethrough: { chars: ['~'], insert: '~~', present: (n) => n >= 1, strip: (n) => Math.min(n, 2) },
  code: { chars: ['`'], insert: '`', present: (n) => n >= 1, strip: (n) => n }
}

function runAt(text: string, pos: number, step: 1 | -1, ch: string, limit: number): number {
  let n = 0
  let i = step > 0 ? pos : pos - 1
  while (n < limit && text[i] === ch) {
    n++
    i += step
  }
  return n
}

interface WrapState {
  readonly side: 'inner' | 'outer' | 'none'
  readonly strip: number
}

const ALNUM = /[\p{L}\p{N}]/u

/** Underscores inside a word ("snake_case") are not emphasis. */
function flanked(text: string, before: number, after: number, ch: string): boolean {
  return ch !== '_' || (!ALNUM.test(text[before - 1] ?? '') && !ALNUM.test(text[after] ?? ''))
}

/** Is `seg` already wrapped in the mark, by markers inside it or right around it? */
function wrapState(text: string, seg: TextRange, spec: MarkSpec): WrapState {
  const len = seg.to - seg.from
  for (const ch of spec.chars) {
    const left = runAt(text, seg.from, 1, ch, len)
    const right = runAt(text, seg.to, -1, ch, len)
    const n = Math.min(left, right)
    if (left + right < len && spec.present(n) && flanked(text, seg.from, seg.to, ch)) {
      return { side: 'inner', strip: spec.strip(n) }
    }
  }
  for (const ch of spec.chars) {
    const left = runAt(text, seg.from, -1, ch, 8)
    const right = runAt(text, seg.to, 1, ch, 8)
    const n = Math.min(left, right)
    if (spec.present(n) && flanked(text, seg.from - left, seg.to + right, ch)) {
      return { side: 'outer', strip: spec.strip(n) }
    }
  }
  return { side: 'none', strip: 0 }
}

function unwrapChanges(seg: TextRange, state: WrapState): TextChange[] {
  const k = state.strip
  return state.side === 'inner'
    ? [{ from: seg.from, to: seg.from + k, insert: '' }, { from: seg.to - k, to: seg.to, insert: '' }]
    : [{ from: seg.from - k, to: seg.from, insert: '' }, { from: seg.to, to: seg.to + k, insert: '' }]
}

function wrapChanges(text: string, seg: TextRange, spec: MarkSpec): TextChange[] {
  if (spec.chars[0] !== '`') {
    return [{ from: seg.from, to: seg.from, insert: spec.insert }, { from: seg.to, to: seg.to, insert: spec.insert }]
  }
  // Inline code that itself contains backticks needs a longer fence (and padding).
  const inner = text.slice(seg.from, seg.to)
  const longest = Math.max(0, ...(inner.match(/`+/g) ?? []).map((r) => r.length))
  const fence = '`'.repeat(longest + 1)
  const pad = longest > 0 && (inner.startsWith('`') || inner.endsWith('`')) ? ' ' : ''
  return [{ from: seg.from, to: seg.from, insert: fence + pad }, { from: seg.to, to: seg.to, insert: pad + fence }]
}

const BLOCK_PREFIX_RE = /^(?:[ \t]{0,3}>[ \t]?)*[ \t]*(?:#{1,6}[ \t]+|(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)?/

/** The part of line `i` inside the selection, minus block prefixes and outer spaces. */
function inlineSegment(doc: Doc, i: number, sel: TextRange): TextRange | null {
  const start = doc.starts[i]
  let from = Math.max(sel.from, start)
  let to = Math.min(sel.to, lineEnd(doc, i))
  if (from === start) from += BLOCK_PREFIX_RE.exec(doc.lines[i])?.[0].length ?? 0
  while (from < to && /\s/.test(doc.text[from])) from++
  while (to > from && /\s/.test(doc.text[to - 1])) to--
  return from < to ? { from, to } : null
}

const WORD_CHAR = /[\p{L}\p{N}\p{M}'’]/u

/** The word touching `pos`, if any (underscores count as markers, not letters). */
function wordAt(text: string, pos: number): TextRange | null {
  let from = pos
  let to = pos
  while (from > 0 && WORD_CHAR.test(text[from - 1])) from--
  while (to < text.length && WORD_CHAR.test(text[to])) to++
  return from < to ? { from, to } : null
}

function toggleSegments(text: string, segments: readonly TextRange[], spec: MarkSpec): TextChange[] {
  const states = segments.map((seg) => wrapState(text, seg, spec))
  if (states.every((s) => s.side !== 'none')) return segments.flatMap((seg, k) => unwrapChanges(seg, states[k]))
  return segments.flatMap((seg, k) => (states[k].side === 'none' ? wrapChanges(text, seg, spec) : []))
}

function toggleInlineAtCursor(text: string, pos: number, spec: MarkSpec): FormatEdit {
  // "**|**": an empty pair the user just made; take it away again.
  for (const ch of spec.chars) {
    const n = Math.min(runAt(text, pos, -1, ch, 8), runAt(text, pos, 1, ch, 8))
    if (n > 0 && spec.present(n)) {
      const k = spec.strip(n)
      return select([{ from: pos - k, to: pos + k, insert: '' }], pos - k)
    }
  }
  const word = wordAt(text, pos)
  if (!word) return select([{ from: pos, to: pos, insert: spec.insert + spec.insert }], pos + spec.insert.length)
  const changes = sortChanges(toggleSegments(text, [word], spec))
  return select(changes, mapPos(changes, pos, pos === word.to ? -1 : 1))
}

/** Toggle bold/italic/strikethrough/inline code on the selection (per line when it spans
 *  lines), or on the word at the cursor. Inline code over several lines becomes a block. */
export function toggleInline(state: TextState, cmd: InlineCommand): FormatEdit | null {
  const { text, selection: sel } = state
  const spec = MARKS[cmd]
  if (sel.from === sel.to) return toggleInlineAtCursor(text, sel.from, spec)
  const doc = toDoc(text)
  const [first, last] = touchedLines(doc, sel)
  if (cmd === 'code' && last > first) return toggleCodeBlock(state)
  const segments = range(first, last)
    .map((i) => inlineSegment(doc, i, sel))
    .filter((s): s is TextRange => s !== null)
  if (!segments.length) return null
  const changes = sortChanges(toggleSegments(text, segments, spec))
  if (first === last) return keepSelection(changes, sel)
  // Across lines, keep the markers selected so the same shortcut toggles them back off.
  return select(changes, mapPos(changes, sel.from, -1), mapPos(changes, sel.to, 1))
}

// ---- headings and quotes ----------------------------------------------------------------

function withHeading(line: string, level: number): string {
  const p = parseLine(line)
  if (level === 0) return p.heading ? p.quote + p.body : line
  return p.quote + '#'.repeat(level) + ' ' + p.body
}

/** Make the touched lines headings of `level` (0 = paragraph). Applying the level a line
 *  already has turns it back into a paragraph; other levels and list markers are replaced. */
export function setHeading(state: TextState, level: 0 | 1 | 2 | 3): FormatEdit {
  const doc = toDoc(state.text)
  const targets = new Set(contentLines(doc, state.selection))
  const already = [...targets].every((i) => parseLine(doc.lines[i]).heading === level)
  const target = level > 0 && already ? 0 : level
  const next = doc.lines.map((line, i) => (targets.has(i) ? withHeading(line, target) : line))
  return editFromLines(doc, next, state.selection)
}

const QUOTED_RE = /^[ \t]{0,3}>/

/** Quote the touched lines, or unquote them when they're all quoted already. */
export function toggleQuote(state: TextState): FormatEdit {
  const doc = toDoc(state.text)
  const [first, last] = touchedLines(doc, state.selection)
  const lines = range(first, last)
  const filled = lines.filter((i) => !isBlank(doc.lines[i]))
  const unquote = filled.length > 0 && filled.every((i) => QUOTED_RE.test(doc.lines[i]))
  const multi = lines.length > 1
  const quoteLine = (line: string): string => {
    if (unquote) return line.replace(/^([ \t]{0,3})>[ \t]?/, '$1')
    if (QUOTED_RE.test(line)) return line
    return multi && isBlank(line) ? '>' : '> ' + line
  }
  const touched = new Set(lines)
  const next = doc.lines.map((line, i) => (touched.has(i) ? quoteLine(line) : line))
  return editFromLines(doc, next, state.selection)
}

// ---- lists ----------------------------------------------------------------------------

function stripList(line: string): string {
  const p = parseLine(line)
  return p.marker ? p.quote + p.body : line
}

/** Numbered items keep their number (renumber fixes runs); bullets keep their character. */
function listMarker(p: LineParts, kind: ListKind): string {
  const numbered = /\d/.test(p.marker)
  if (kind === 'numberedList') return numbered ? p.marker : '1.'
  return p.marker && !numbered ? p.marker : '-'
}

function toListItem(line: string, kind: ListKind): string {
  const p = parseLine(line)
  const box = kind === 'taskList' ? (p.box ? p.box.trimEnd() + ' ' : '[ ] ') : ''
  return p.quote + p.indent + listMarker(p, kind) + ' ' + box + p.body
}

function isListish(line: string): boolean {
  const p = parseLine(line)
  return p.marker !== '' || (!isBlank(line) && p.indent !== '')
}

/** The run of list lines around [first, last], crossing single blank lines (loose lists). */
function listBlock(lines: readonly string[], first: number, last: number): readonly [number, number] {
  const ok = (i: number, step: 1 | -1): boolean =>
    i >= 0 && i < lines.length && (isListish(lines[i]) || (isBlank(lines[i]) && isListish(lines[i + step] ?? '')))
  let start = first
  let end = last
  while (ok(start - 1, -1)) start--
  while (ok(end + 1, 1)) end++
  return [start, end]
}

interface Level {
  readonly indent: number
  readonly next: number | null
}

/** Renumber ordered items in the list around [first, last]: the first item of each run
 *  keeps its number, the rest count up from it, nested levels independently. */
function renumber(lines: readonly string[], first: number, last: number): string[] {
  const [start, end] = listBlock(lines, first, last)
  let stack: readonly Level[] = []
  return lines.map((line, i) => {
    if (i < start || i > end) return line
    const p = parseLine(line)
    if (!p.marker) return line
    const indent = width(p.indent)
    stack = stack.filter((level) => level.indent <= indent)
    const top = stack[stack.length - 1]
    const same = top !== undefined && top.indent === indent
    const base = same ? stack.slice(0, -1) : stack
    if (!/\d/.test(p.marker)) {
      stack = [...base, { indent, next: null }]
      return line
    }
    const n = same && top.next !== null ? top.next : parseInt(p.marker, 10)
    stack = [...base, { indent, next: n + 1 }]
    const marker = String(n) + p.marker.slice(-1)
    return marker === p.marker ? line : p.quote + p.indent + marker + p.gap + p.box + p.body
  })
}

/** Turn the touched lines into a bulleted, numbered or task list, switching kinds in
 *  place; when they already are that kind, remove the list markers. Renumbers. */
export function toggleList(state: TextState, kind: ListKind): FormatEdit {
  const doc = toDoc(state.text)
  const targets = contentLines(doc, state.selection)
  const set = new Set(targets)
  const remove = targets.every((i) => listKind(parseLine(doc.lines[i])) === kind)
  const converted = doc.lines.map((line, i) => (set.has(i) ? (remove ? stripList(line) : toListItem(line, kind)) : line))
  const next = renumber(converted, targets[0], targets[targets.length - 1])
  return editFromLines(doc, next, state.selection)
}

/** Nearest item above `i` (same quote) whose indent satisfies `test`, stopping at a
 *  shallower item when looking for a sibling. */
function itemAbove(lines: readonly string[], i: number, test: (indent: number) => boolean, stopBelow: number): LineParts | null {
  for (let k = i - 1; k >= 0; k--) {
    if (isBlank(lines[k])) continue
    const p = parseLine(lines[k])
    if (!p.marker) {
      if (p.indent === '') return null
      continue
    }
    const w = width(p.indent)
    if (test(w)) return p
    if (w < stopBelow) return null
  }
  return null
}

function indentedItem(lines: readonly string[], i: number, dir: 1 | -1): { line: string; delta: number } {
  const p = parseLine(lines[i])
  const current = width(p.indent)
  let target = current
  if (dir > 0) {
    const sibling = itemAbove(lines, i, (w) => w === current, current)
    target = sibling ? width(sibling.indent) + sibling.marker.length + Math.max(1, sibling.gap.length) : current + p.marker.length + 1
  } else if (current > 0) {
    const parent = itemAbove(lines, i, (w) => w < current, -1)
    target = parent ? width(parent.indent) : 0
  }
  // A numbered item that becomes the first child starts its own count.
  const firstChild = dir > 0 && /\d/.test(p.marker) && !itemAbove(lines, i, (w) => w === target, target)
  const marker = firstChild ? '1' + p.marker.slice(-1) : p.marker
  return { line: p.quote + ' '.repeat(target) + marker + p.gap + p.box + p.body, delta: target - current }
}

/** Tab / Shift+Tab on list items: nest under the previous sibling or move out to the
 *  parent's level, then renumber. Null when no touched line is a list item. */
export function indentList(state: TextState, dir: 1 | -1): FormatEdit | null {
  const doc = toDoc(state.text)
  const [first, last] = touchedLines(doc, state.selection)
  if (!range(first, last).some((i) => parseLine(doc.lines[i]).marker)) return null
  const next = [...doc.lines]
  let delta = 0
  for (const i of range(first, last)) {
    if (isBlank(next[i])) continue
    const p = parseLine(next[i])
    if (p.marker) {
      const item = indentedItem(next, i, dir)
      next[i] = item.line
      delta = item.delta
    } else if (delta !== 0) {
      next[i] = p.quote + ' '.repeat(Math.max(0, width(p.indent) + delta)) + p.body
    }
  }
  return editFromLines(doc, renumber(next, first, last), state.selection)
}

// ---- blocks ---------------------------------------------------------------------------

/** Insert `block` as its own paragraph: on the cursor line when it's blank, otherwise
 *  after the paragraph (or table, or list) the cursor is in, so that stays whole. Blank
 *  lines go around it; `pick` chooses the selection from the block's start. */
function insertBlock(state: TextState, block: string, pick: (start: number) => readonly [number, number]): FormatEdit {
  const doc = toDoc(state.text)
  const i = lineIndexAt(doc, state.selection.to)
  if (isBlank(doc.lines[i])) {
    const before = i === 0 || isBlank(doc.lines[i - 1]) ? '' : '\n'
    const after = i + 1 >= doc.lines.length || isBlank(doc.lines[i + 1]) ? '' : '\n'
    const start = doc.starts[i] + before.length
    const [anchor, head] = pick(start)
    return select([{ from: doc.starts[i], to: lineEnd(doc, i), insert: before + block + after }], anchor, head)
  }
  let last = i
  while (last + 1 < doc.lines.length && !isBlank(doc.lines[last + 1])) last++
  const end = lineEnd(doc, last)
  const [anchor, head] = pick(end + 2)
  return select([{ from: end, to: end, insert: '\n\n' + block }], anchor, head)
}

/** Insert pasted block text (e.g. a table) as its own paragraph; cursor after it. */
export function insertBlockText(state: TextState, block: string): FormatEdit {
  return insertBlock(state, block, (start) => [start + block.length, start + block.length])
}

const TABLE_TEMPLATE = [
  '| Column 1 | Column 2 | Column 3 |',
  '| -------- | -------- | -------- |',
  '|          |          |          |',
  '|          |          |          |'
].join('\n')

/** A 3-column, 2-row table with the first header cell selected for typing. */
export function insertTable(state: TextState): FormatEdit {
  return insertBlock(state, TABLE_TEMPLATE, (start) => [start + 2, start + 10])
}

/** A thematic break on its own line, cursor on the fresh line below it. */
export function insertDivider(state: TextState): FormatEdit {
  return insertBlock(state, '---\n', (start) => [start + 4, start + 4])
}

interface Fence {
  readonly open: number
  readonly close: number | null
}

/** Fenced code blocks by line index; an unclosed fence runs to the end (close null). */
function fences(lines: readonly string[]): Fence[] {
  const found: Fence[] = []
  let openLine = -1
  let openFence = ''
  for (let i = 0; i < lines.length; i++) {
    const m = FENCE_RE.exec(lines[i])
    if (openLine < 0) {
      if (m) [openLine, openFence] = [i, m[1]]
      continue
    }
    if (m && m[1][0] === openFence[0] && m[1].length >= openFence.length && isBlank(lines[i].slice(m[0].length))) {
      found.push({ open: openLine, close: i })
      openLine = -1
    }
  }
  return openLine < 0 ? found : [...found, { open: openLine, close: null }]
}

function unwrapFence(doc: Doc, f: Fence, sel: TextRange): FormatEdit {
  const openTo = f.open + 1 < doc.lines.length ? doc.starts[f.open + 1] : lineEnd(doc, f.open)
  const changes: TextChange[] = [{ from: doc.starts[f.open], to: openTo, insert: '' }]
  if (f.close !== null) changes.push({ from: lineEnd(doc, f.close - 1), to: lineEnd(doc, f.close), insert: '' })
  if (f.close === f.open + 1) return select([{ from: doc.starts[f.open], to: lineEnd(doc, f.close), insert: '' }], doc.starts[f.open])
  return keepSelection(changes, sel)
}

/** Wrap the touched lines in a fenced code block, insert an empty one on a blank line,
 *  or remove the fences when the selection is already inside a fenced block. */
export function toggleCodeBlock(state: TextState): FormatEdit {
  const { selection: sel } = state
  const doc = toDoc(state.text)
  const [first, last] = touchedLines(doc, sel)
  const inside = fences(doc.lines).find((f) => f.open <= first && (f.close === null || last <= f.close))
  if (inside) return unwrapFence(doc, inside, sel)
  if (first === last && isBlank(doc.lines[first])) {
    const start = doc.starts[first]
    return select([{ from: start, to: lineEnd(doc, first), insert: '```\n\n```' }], start + 4)
  }
  const body = doc.lines.slice(first, last + 1).join('\n')
  const longest = Math.max(0, ...(body.match(/^[ \t]*`{3,}/gm) ?? []).map((r) => r.trim().length))
  const fence = '`'.repeat(Math.max(3, longest + 1))
  return keepSelection(
    [
      { from: doc.starts[first], to: doc.starts[first], insert: fence + '\n' },
      { from: lineEnd(doc, last), to: lineEnd(doc, last), insert: '\n' + fence }
    ],
    sel
  )
}

// ---- links and images -------------------------------------------------------------------

const URL_RE = /^(?:https?:\/\/|mailto:|www\.)[^\s<>]+$/i
const LINK_RE = /^\[([^\]\n]*)\]\([^)\n]*\)$/

/** True for a single http(s)/mailto/www URL with no spaces. */
export function isUrl(text: string): boolean {
  return URL_RE.test(text.trim())
}

const normalizeUrl = (url: string): string => (/^www\./i.test(url) ? 'https://' + url : url)

/** Insert a link (or image with `image`) around the selection or word at the cursor.
 *  A selected URL becomes the target with the cursor in the brackets; a copied URL is
 *  used as the target; otherwise the "url" placeholder is selected. Toggles a whole link
 *  back to its text. */
export function insertLink(state: TextState, options: FormatOptions = {}, image = false): FormatEdit {
  const { text, selection } = state
  const sel = selection.from === selection.to && !image ? (wordAt(text, selection.from) ?? selection) : selection
  const selected = text.slice(sel.from, sel.to)
  const unlink = image ? null : LINK_RE.exec(selected)
  if (unlink) return select([{ from: sel.from, to: sel.to, insert: unlink[1] }], sel.from, sel.from + unlink[1].length)
  const open = image ? '![' : '['
  const at = (insert: string): TextChange[] => [{ from: sel.from, to: sel.to, insert }]
  if (selected && isUrl(selected)) {
    return select(at(`${open}](${normalizeUrl(selected.trim())})`), sel.from + open.length)
  }
  const clip = options.clipboard?.trim() ?? ''
  if (clip && isUrl(clip)) {
    const insert = `${open}${selected}](${normalizeUrl(clip)})`
    return select(at(insert), selected ? sel.from + insert.length : sel.from + open.length)
  }
  const urlStart = sel.from + open.length + selected.length + 2
  return select(at(`${open}${selected}](url)`), urlStart, urlStart + 3)
}

/** Pasting a URL over selected plain text makes it a link: "[text](url)". Null when the
 *  paste isn't a lone URL or the selection is empty, multi-line or a URL itself. */
export function pasteUrlOverSelection(state: TextState, pasted: string): FormatEdit | null {
  const { from, to } = state.selection
  const selected = state.text.slice(from, to)
  if (from === to || selected.includes('\n') || !isUrl(pasted) || isUrl(selected)) return null
  const insert = `[${selected}](${normalizeUrl(pasted.trim())})`
  return select([{ from, to, insert }], from + insert.length)
}

// ---- dispatch -----------------------------------------------------------------------------

/** Apply `cmd` to `state`. Null when there's nothing sensible to do. */
export function applyFormat(cmd: FormatCommand, state: TextState, options: FormatOptions = {}): FormatEdit | null {
  switch (cmd) {
    case 'bold':
    case 'italic':
    case 'strikethrough':
    case 'code':
      return toggleInline(state, cmd)
    case 'heading1':
      return setHeading(state, 1)
    case 'heading2':
      return setHeading(state, 2)
    case 'heading3':
      return setHeading(state, 3)
    case 'paragraph':
      return setHeading(state, 0)
    case 'quote':
      return toggleQuote(state)
    case 'bulletList':
    case 'numberedList':
    case 'taskList':
      return toggleList(state, cmd)
    case 'codeBlock':
      return toggleCodeBlock(state)
    case 'table':
      return insertTable(state)
    case 'divider':
      return insertDivider(state)
    case 'link':
      return insertLink(state, options)
    case 'image':
      return insertLink(state, options, true)
  }
}

/** Apply an edit to plain text (tests and previews). */
export function applyEdit(text: string, edit: FormatEdit): string {
  return [...edit.changes].reverse().reduce((t, c) => t.slice(0, c.from) + c.insert + t.slice(c.to), text)
}
