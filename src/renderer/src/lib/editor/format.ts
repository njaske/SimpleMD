// Pure Markdown text transforms behind the format bar and the editor shortcuts. Each one
// takes the document text plus the main selection and returns the edits to make, so the
// rules can be unit-tested without CodeMirror (commands.ts wraps them as commands). This
// module holds the line and block commands and the dispatcher; inline marks, fences and
// links live beside it.
import type { FormatCommand } from './types'
import { fenceLines, fences, toggleCodeBlock } from './fences'
import { toggleInline } from './inline'
import { insertLink } from './links'
import {
  editFromLines,
  isBlank,
  lineEnd,
  lineIndexAt,
  range,
  select,
  toDoc,
  touchedLines,
  type Doc,
  type FormatEdit,
  type FormatOptions,
  type TextRange,
  type TextState
} from './text'

export { applyEdit, mapPos } from './text'
export type { FormatEdit, FormatOptions, TextChange, TextRange, TextState } from './text'
export { isUrl, pasteUrlOverSelection } from './links'
export { toggleCodeBlock } from './fences'
export { toggleInline } from './inline'

// ---- line anatomy ---------------------------------------------------------------------

const QUOTE_RE = /^(?:[ \t]{0,3}>[ \t]?)+/
const LIST_RE = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+|$)(\[[ xX]\](?:[ \t]+|$))?/
const HEADING_RE = /^[ \t]{0,3}(#{1,6})(?:[ \t]+|$)/

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


/** Lines a block command applies to: never code, and blank lines only count when nothing
 *  else is touched. */
function contentLines(doc: Doc, sel: TextRange): number[] {
  const [first, last] = touchedLines(doc, sel)
  const code = fenceLines(fences(doc.lines), doc.lines.length)
  const all = range(first, last).filter((i) => !code.has(i))
  const filled = all.filter((i) => !isBlank(doc.lines[i]))
  return filled.length ? filled : all
}

// ---- headings and quotes ----------------------------------------------------------------

function withHeading(line: string, level: number): string {
  const p = parseLine(line)
  if (level === 0) return p.heading ? p.quote + p.body : line
  return p.quote + '#'.repeat(level) + ' ' + p.body
}

/** Make the touched lines headings of `level` (0 = paragraph). Applying the level a line
 *  already has turns it back into a paragraph; other levels and list markers are replaced. */
export function setHeading(state: TextState, level: 0 | 1 | 2 | 3): FormatEdit | null {
  const doc = toDoc(state.text)
  const targets = new Set(contentLines(doc, state.selection))
  if (!targets.size) return null
  const already = [...targets].every((i) => parseLine(doc.lines[i]).heading === level)
  const target = level > 0 && already ? 0 : level
  const next = doc.lines.map((line, i) => (targets.has(i) ? withHeading(line, target) : line))
  return editFromLines(doc, next, state.selection)
}

const QUOTED_RE = /^[ \t]{0,3}>/

/** Quote the touched lines, or unquote them when they're all quoted already. A fenced
 *  block is quoted whole or not at all, so a cursor inside code changes nothing. */
export function toggleQuote(state: TextState): FormatEdit | null {
  const doc = toDoc(state.text)
  const [first, last] = touchedLines(doc, state.selection)
  const partial = fences(doc.lines).filter((f) => f.open < first || (f.close ?? doc.lines.length) > last)
  const skip = fenceLines(partial, doc.lines.length)
  const lines = range(first, last).filter((i) => !skip.has(i))
  if (!lines.length) return null
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
  const code = fenceLines(fences(lines), lines.length)
  let stack: readonly Level[] = []
  return lines.map((line, i) => {
    if (i < start || i > end || code.has(i)) return line
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
export function toggleList(state: TextState, kind: ListKind): FormatEdit | null {
  const doc = toDoc(state.text)
  const targets = contentLines(doc, state.selection)
  if (!targets.length) return null
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
 *  parent's level, then renumber. Lines in fenced code are never items, only carried
 *  along with the item above. Null when no touched line is a list item. */
export function indentList(state: TextState, dir: 1 | -1): FormatEdit | null {
  const doc = toDoc(state.text)
  const [first, last] = touchedLines(doc, state.selection)
  const code = fenceLines(fences(doc.lines), doc.lines.length)
  const isItem = (i: number): boolean => !code.has(i) && parseLine(doc.lines[i]).marker !== ''
  if (!range(first, last).some(isItem)) return null
  const next = [...doc.lines]
  let delta = 0
  for (const i of range(first, last)) {
    if (isBlank(next[i])) continue
    if (isItem(i)) {
      const item = indentedItem(next, i, dir)
      next[i] = item.line
      delta = item.delta
    } else if (delta !== 0) {
      next[i] = shiftLine(next[i], delta)
    }
  }
  return editFromLines(doc, renumber(next, first, last), state.selection)
}

/** Move a continuation line by `delta` columns, keeping everything after its indent. */
function shiftLine(line: string, delta: number): string {
  const quote = QUOTE_RE.exec(line)?.[0] ?? ''
  const indent = /^[ \t]*/.exec(line.slice(quote.length))?.[0] ?? ''
  return quote + ' '.repeat(Math.max(0, width(indent) + delta)) + line.slice(quote.length + indent.length)
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

/** Insert pasted block text as its own paragraph, cursor at its end. With `fresh` (a
 *  table, whose last row would swallow the next line) the cursor goes to a new paragraph
 *  below it instead. */
export function insertBlockText(state: TextState, block: string, fresh = false): FormatEdit {
  const text = fresh ? block + '\n\n' : block
  return insertBlock(state, text, (start) => [start + text.length, start + text.length])
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
