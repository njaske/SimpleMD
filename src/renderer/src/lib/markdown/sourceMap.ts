import type { Token, Tokens } from 'marked'
import { isCalloutToken } from './callouts'
import { isFootnotesSection } from './footnotes'

// Source line mapping: which lines of the original file each rendered block came
// from. marked keeps every token's `raw` source slice, and container content
// (blockquote text, list item text, callout bodies) keeps one line per source line
// even after its `>` / indentation prefixes are stripped, so line numbers can be
// recovered exactly by locating each raw slice inside its parent's content.

/** 0-based source lines of a block; `end` is exclusive. */
export interface LineSpan {
  start: number
  end: number
}

/** Spans of the tokens rendered right now, read by the list item renderer. Weak, so
 *  tokens (and their spans) are collected with the token tree. */
export const tokenSpans = new WeakMap<Token, LineSpan>()

/** Maps a line of the text being parsed back to a line of the original file. */
export type LineMapper = (line: number) => number

/** Offsets of the line starts of `text`, for fast offset -> line lookups. */
function lineStarts(text: string): number[] {
  const starts = [0]
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) starts.push(i + 1)
  return starts
}

function lineAt(starts: readonly number[], offset: number): number {
  let lo = 0
  let hi = starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid] <= offset) lo = mid
    else hi = mid - 1
  }
  return lo
}

interface Located {
  at: number
  next: number
}

/** Where `raw` sits in `content` at or after `cursor`. marked occasionally rewrites a
 *  raw slice (merged paragraphs gain a newline), so fall back to its first line. */
function locate(content: string, raw: string, cursor: number): Located | null {
  if (!raw) return null
  const exact = content.indexOf(raw, cursor)
  if (exact >= 0) return { at: exact, next: exact + raw.length }
  const first = raw.split('\n').find((line) => line.trim())
  if (!first) return null
  const at = content.indexOf(first, cursor)
  return at >= 0 ? { at, next: at + first.length } : null
}

/** Lines of the first and last non-blank characters of content[at, at+len). */
function spanOf(content: string, starts: readonly number[], at: number, len: number): LineSpan | null {
  let a = at
  let b = Math.min(content.length, at + len) - 1
  while (a <= b && /\s/.test(content[a])) a++
  while (b >= a && /\s/.test(content[b])) b--
  if (a > b) return null
  return { start: lineAt(starts, a), end: lineAt(starts, b) + 1 }
}

interface Frame {
  content: string
  /** Line of `content`'s first line within the text being parsed. */
  base: number
  toOriginal: LineMapper
}

function mapSpan(span: LineSpan, frame: Frame): LineSpan {
  const start = frame.toOriginal(frame.base + span.start)
  const end = frame.toOriginal(frame.base + span.end - 1) + 1
  return { start, end: Math.max(end, start + 1) }
}

/** Record the original-file span of every block token (recursively into lists,
 *  blockquotes and callouts). */
export function assignSpans(tokens: readonly Token[], content: string, toOriginal: LineMapper): void {
  walk(tokens, { content, base: 0, toOriginal })
}

function walk(tokens: readonly Token[], frame: Frame): void {
  const starts = lineStarts(frame.content)
  let cursor = 0
  for (const token of tokens) {
    // A task's checkbox token keeps its "[ ] " raw, but item.text no longer has it: looking
    // for it would land on a nested task's box and skip everything before that.
    if (isFootnotesSection(token) || token.type === 'space' || token.type === 'checkbox') continue
    const found = locate(frame.content, token.raw, cursor)
    if (!found) continue
    cursor = found.next
    const local = spanOf(frame.content, starts, found.at, token.raw.length)
    if (!local) continue
    tokenSpans.set(token, mapSpan(local, frame))
    if (token.type === 'list') walkItems((token as Tokens.List).items, frame, found.at, starts)
    else descend(token, { ...frame, base: frame.base + local.start })
  }
}

/** Container content starts on the container's first line. */
function descend(token: Token, frame: Frame): void {
  if (token.type === 'blockquote') {
    const bq = token as Tokens.Blockquote
    walk(bq.tokens, { ...frame, content: bq.text })
  } else if (isCalloutToken(token)) {
    // The body starts on the line after the `> [!type]` line.
    walk(token.tokens, { ...frame, content: token.bodyText, base: frame.base + 1 })
  }
}

/** List items are slices of the content the list itself sits in. */
function walkItems(items: readonly Tokens.ListItem[], frame: Frame, listAt: number, starts: readonly number[]): void {
  let cursor = listAt
  for (const item of items) {
    const found = locate(frame.content, item.raw, cursor)
    if (!found) continue
    cursor = found.next
    const local = spanOf(frame.content, starts, found.at, item.raw.length)
    if (!local) continue
    tokenSpans.set(item, mapSpan(local, frame))
    walk(item.tokens, { ...frame, content: item.text, base: frame.base + local.start })
  }
}

/** Add data-line / data-line-end to the first element of a rendered block. */
export function withLineAttrs(html: string, span: LineSpan): string {
  return html.replace(/^(\s*<[a-zA-Z][a-zA-Z0-9-]*)/, `$1 data-line="${span.start}" data-line-end="${span.end}"`)
}

/** 0-based lines of the ATX headings the outline lists, in order. Mirrors the scan in
 *  lib/document.ts computeOutline so the two can be zipped. */
export function headingLines(md: string): number[] {
  const lines = (md || '').split('\n')
  const out: number[] = []
  let inFence = false
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) {
      inFence = !inFence
      continue
    }
    if (!inFence && /^(#{1,6})\s+(.*)$/.test(lines[i])) out.push(i)
  }
  return out
}
