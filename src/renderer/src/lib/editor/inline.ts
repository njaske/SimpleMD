// Inline marks: bold, italic, strikethrough and inline code toggled on a selection, on the
// word at the cursor, or off a whole marked phrase the cursor or selection sits in.
import { toggleCodeBlock } from './fences'
import {
  ALNUM,
  lineAround,
  lineEnd,
  mapPos,
  range,
  select,
  keepSelection,
  sortChanges,
  toDoc,
  touchedLines,
  wordAt,
  type Doc,
  type FormatEdit,
  type TextChange,
  type TextRange,
  type TextState
} from './text'

export type InlineCommand = 'bold' | 'italic' | 'strikethrough' | 'code'

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

interface Run {
  readonly ch: string
  readonly from: number
  readonly len: number
}

interface Span {
  readonly open: Run
  readonly close: Run
}

const DELIMS = '*_~`'
const SPACE = /\s/


function runEnd(text: string, i: number, to: number): number {
  let j = i
  while (j < to && text[j] === text[i]) j++
  return j
}

/** The backtick run of exactly `len` that closes a code span, searching from `from`. */
function closingTicks(text: string, from: number, to: number, len: number): Run | null {
  for (let i = text.indexOf('`', from); i >= 0 && i < to; i = text.indexOf('`', i)) {
    const j = runEnd(text, i, to)
    if (j - i === len) return { ch: '`', from: i, len }
    i = j
  }
  return null
}

/** Delimiter pairs on one line, a simplified CommonMark pass: code spans are literal, and
 *  an emphasis run that can close pairs with the nearest opener of the same character. */
function spansOnLine(text: string, from: number, to: number): Span[] {
  const spans: Span[] = []
  let openers: readonly Run[] = []
  for (let i = from; i < to; ) {
    const ch = text[i]
    if (!DELIMS.includes(ch) || text[i - 1] === '\\') {
      i++
      continue
    }
    const j = runEnd(text, i, to)
    const run: Run = { ch, from: i, len: j - i }
    if (ch === '`') {
      const close = closingTicks(text, j, to, run.len)
      if (close) spans.push({ open: run, close })
      i = close ? close.from + close.len : j
      continue
    }
    const before = text[i - 1] ?? ' '
    const after = text[j] ?? ' '
    const canOpen = !SPACE.test(after) && (ch !== '_' || !ALNUM.test(before))
    const canClose = !SPACE.test(before) && (ch !== '_' || !ALNUM.test(after))
    const k = canClose ? openers.map((o) => o.ch).lastIndexOf(ch) : -1
    if (k >= 0) {
      spans.push({ open: openers[k], close: run })
      openers = openers.slice(0, k)
    } else if (canOpen) openers = [...openers, run]
    i = j
  }
  return spans
}

interface Enclosing {
  readonly span: Span
  readonly strip: number
}

const contentOf = (span: Span): TextRange => ({ from: span.open.from + span.open.len, to: span.close.from })

/** The innermost span on the line that carries the mark and whose content holds `seg`
 *  (with `edges`, the markers count too, so a cursor right outside them is in the span). */
function enclosingSpan(text: string, seg: TextRange, spec: MarkSpec, edges = false): Enclosing | null {
  const [start, end] = lineAround(text, seg.from)
  if (seg.to > end) return null
  const pairLen = (s: Span): number => Math.min(s.open.len, s.close.len)
  const holds = (s: Span): boolean =>
    edges ? s.open.from <= seg.from && seg.to <= s.close.from + s.close.len : contentOf(s).from <= seg.from && seg.to <= contentOf(s).to
  const inner = spansOnLine(text, start, end)
    .filter((s) => spec.chars.includes(s.open.ch) && spec.present(pairLen(s)))
    .filter(holds)
    .reduce<Span | null>((best, s) => (!best || s.open.from > best.open.from ? s : best), null)
  return inner ? { span: inner, strip: spec.strip(pairLen(inner)) } : null
}

/** Take the mark off `seg` inside an enclosing span: unwrap the span when `seg` covers its
 *  content, otherwise close it before `seg` and reopen it after (outside any spaces). */
function spanChanges(text: string, { span, strip }: Enclosing, seg: TextRange): TextChange[] {
  const { from, to } = contentOf(span)
  const marker = span.open.ch.repeat(strip)
  let left = seg.from
  while (left > from && SPACE.test(text[left - 1])) left--
  let right = seg.to
  while (right < to && SPACE.test(text[right])) right++
  return [
    left > from ? { from: left, to: left, insert: marker } : { from: from - strip, to: from, insert: '' },
    right < to ? { from: right, to: right, insert: marker } : { from: to, to: to + strip, insert: '' }
  ]
}

type SegState = WrapState | (Enclosing & { readonly side: 'span' })

function segState(text: string, seg: TextRange, spec: MarkSpec): SegState {
  const wrap = wrapState(text, seg, spec)
  if (wrap.side !== 'none') return wrap
  const enclosing = enclosingSpan(text, seg, spec)
  return enclosing ? { ...enclosing, side: 'span' } : wrap
}

function unmarkChanges(text: string, seg: TextRange, state: SegState): TextChange[] {
  return state.side === 'span' ? spanChanges(text, state, seg) : unwrapChanges(seg, state)
}

function wrapChanges(text: string, seg: TextRange, spec: MarkSpec): TextChange[] {
  if (!isCode(spec)) {
    return [{ from: seg.from, to: seg.from, insert: spec.insert }, { from: seg.to, to: seg.to, insert: spec.insert }]
  }
  // Inline code that itself contains backticks needs a longer fence (and padding).
  const inner = text.slice(seg.from, seg.to)
  const longest = Math.max(0, ...(inner.match(/`+/g) ?? []).map((r) => r.length))
  const fence = '`'.repeat(longest + 1)
  const pad = longest > 0 && (inner.startsWith('`') || inner.endsWith('`')) ? ' ' : ''
  return [{ from: seg.from, to: seg.from, insert: fence + pad }, { from: seg.to, to: seg.to, insert: pad + fence }]
}

/** Mark `seg`, merging with phrases of the same mark it overlaps ("**hel‹lo** wo›rld"
 *  becomes "**hello wo**rld") instead of nesting markers inside them. */
function markChanges(text: string, seg: TextRange, spec: MarkSpec): TextChange[] {
  const [start, end] = lineAround(text, seg.from)
  const overlaps = (s: Span): boolean => s.open.from < seg.to && seg.from < s.close.from + s.close.len
  const spans =
    isCode(spec) || seg.to > end
      ? []
      : spansOnLine(text, start, end).filter((s) => spec.chars.includes(s.open.ch) && spec.present(Math.min(s.open.len, s.close.len)) && overlaps(s))
  if (!spans.length) return wrapChanges(text, seg, spec)
  const strip = (s: Span): number => spec.strip(Math.min(s.open.len, s.close.len))
  const from = Math.min(seg.from, ...spans.map((s) => s.open.from))
  const to = Math.max(seg.to, ...spans.map((s) => s.close.from + s.close.len))
  const unmarked = spans.flatMap((s) => {
    const { from: inFrom, to: inTo } = contentOf(s)
    return [{ from: inFrom - strip(s), to: inFrom, insert: '' }, { from: inTo, to: inTo + strip(s), insert: '' }]
  })
  return [{ from, to: from, insert: spec.insert }, ...unmarked, { from: to, to, insert: spec.insert }]
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

/** Unmark every segment when all of them carry the mark, otherwise mark the rest. */
function toggleSegments(text: string, segments: readonly TextRange[], spec: MarkSpec): TextChange[] {
  const states = segments.map((seg) => segState(text, seg, spec))
  if (states.every((s) => s.side !== 'none')) return segments.flatMap((seg, k) => unmarkChanges(text, seg, states[k]))
  return segments.flatMap((seg, k) => (states[k].side === 'none' ? markChanges(text, seg, spec) : []))
}

const isCode = (spec: MarkSpec): boolean => spec.chars[0] === '`'

/** `seg` grown to cover every code span it reaches into: code is literal, so other marks
 *  go around a whole span ("**`code`**"), never inside it. */
function outsideCode(text: string, seg: TextRange): TextRange {
  const [start, end] = lineAround(text, seg.from)
  if (seg.to > end) return seg
  const inside = (pos: number, s: Span): boolean => s.open.from < pos && pos < s.close.from + s.close.len
  const reached = spansOnLine(text, start, end).filter((s) => s.open.ch === '`' && (inside(seg.from, s) || inside(seg.to, s)))
  if (!reached.length) return seg
  return {
    from: Math.min(seg.from, ...reached.map((s) => s.open.from)),
    to: Math.max(seg.to, ...reached.map((s) => s.close.from + s.close.len))
  }
}

function toggleInlineAtCursor(text: string, pos: number, spec: MarkSpec): FormatEdit {
  // In a code span, bold/italic/strikethrough toggle on the whole span.
  const code = isCode(spec) ? null : outsideCode(text, { from: pos, to: pos })
  if (code && code.from < code.to) {
    const changes = sortChanges(toggleSegments(text, [code], spec))
    return select(changes, mapPos(changes, pos, 1))
  }
  // "**|**": an empty pair the user just made; take it away again.
  for (const ch of spec.chars) {
    const n = Math.min(runAt(text, pos, -1, ch, 8), runAt(text, pos, 1, ch, 8))
    if (n > 0 && spec.present(n)) {
      const k = spec.strip(n)
      return select([{ from: pos - k, to: pos + k, insert: '' }], pos - k)
    }
  }
  // Anywhere in (or right against) a marked phrase, the shortcut takes its mark off.
  const enclosing = enclosingSpan(text, { from: pos, to: pos }, spec, true)
  if (enclosing) {
    const changes = sortChanges(spanChanges(text, enclosing, contentOf(enclosing.span)))
    return select(changes, mapPos(changes, pos, 1))
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
    .map((s) => (isCode(spec) ? s : outsideCode(text, s)))
  if (!segments.length) return null
  const changes = sortChanges(toggleSegments(text, segments, spec))
  if (first === last) return keepSelection(changes, sel)
  // Across lines, keep the markers selected so the same shortcut toggles them back off.
  return select(changes, mapPos(changes, sel.from, -1), mapPos(changes, sel.to, 1))
}
