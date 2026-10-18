import type { ChunkFootnotes } from './footnotes'
import { scanFences } from './repairs'

// Large documents (over 1 MB) render progressively: the first chunk at once, the rest
// in idle time. Chunks end at "safe" blank lines: outside code fences and display
// math, and followed by an unindented line that can't continue a list, so splitting
// there renders the same as parsing the whole file at once.

export interface SourceChunk {
  src: string
  /** Line of the original document where this chunk starts. */
  lineOffset: number
}

/** Documents above this size render in chunks. */
export const PROGRESSIVE_CHARS = 1_000_000
// Small enough that parsing, sanitizing and inserting one chunk stays well under
// 100 ms on a modest machine.
const FIRST_CHUNK_CHARS = 24_000
const CHUNK_CHARS = 40_000
/** Past this, any blank line outside a fence will do. */
const HARD_CHUNK_CHARS = CHUNK_CHARS * 4

const MATH_FENCE = /^[ \t]*(?:\$\$|\\\[|\\\])[ \t]*$/
const CONTINUES_BLOCK = /^(?:[ \t]|[-*+][ \t]|\d{1,9}[.)][ \t]|\$\$|\\\]|$)/

function mathMask(lines: readonly string[], fenced: readonly boolean[]): boolean[] {
  const mask = new Array<boolean>(lines.length).fill(false)
  let open = false
  for (let i = 0; i < lines.length; i++) {
    if (fenced[i]) continue
    if (MATH_FENCE.test(lines[i])) open = !open
    mask[i] = open
  }
  return mask
}

function nextContentLine(lines: readonly string[], from: number): string | undefined {
  for (let j = from; j < lines.length; j++) if (lines[j].trim()) return lines[j]
  return undefined
}

/** Split `md` into chunks that parse independently. */
export function splitForProgressive(md: string): SourceChunk[] {
  const lines = md.replace(/\r\n?/g, '\n').split('\n')
  const fenced = scanFences(lines).inside
  const inMath = mathMask(lines, fenced)
  const chunks: SourceChunk[] = []
  let start = 0
  let size = 0
  for (let i = 0; i < lines.length; i++) {
    size += lines[i].length + 1
    const target = chunks.length ? CHUNK_CHARS : FIRST_CHUNK_CHARS
    if (size < target || lines[i].trim() || fenced[i] || inMath[i]) continue
    const next = nextContentLine(lines, i + 1)
    if (next === undefined) break
    if (CONTINUES_BLOCK.test(next) && size < HARD_CHUNK_CHARS) continue
    chunks.push({ src: lines.slice(start, i + 1).join('\n'), lineOffset: start })
    start = i + 1
    size = 0
  }
  if (start < lines.length) chunks.push({ src: lines.slice(start).join('\n'), lineOffset: start })
  return chunks
}

const REF_DEF = /^ {0,3}\[(?!\^)[^\]\n]+\]:[ \t]*\S/

/** Reference link definitions of the whole document, appended to every chunk so
 *  `[text][ref]` links resolve wherever the definition lives. */
export function collectRefDefs(md: string): string {
  const lines = md.replace(/\r\n?/g, '\n').split('\n')
  const fenced = scanFences(lines).inside
  return lines.filter((line, i) => !fenced[i] && REF_DEF.test(line)).join('\n')
}

// ---- footnotes across chunks ---------------------------------------------------------
// A reference and its definition can land in different chunks, so every chunk gets all
// definitions (in its appendix) and the document's numbering; only the last chunk
// renders the Footnotes section.

const FOOTNOTE_DEF = /^\[\^([^\]\n]+)\]:/
const FOOTNOTE_REF = /\[\^([^\]\n]+)\]/g
const CODE_SPAN = /(`+)[^`]*?\1/g
/** marked-footnote continues a definition with lines indented by four spaces. */
const DEF_CONTINUATION = /^ {4,}\S/

export interface FootnotePlan {
  /** Every footnote definition, with its continuation lines. */
  defs: string
  /** Per chunk, in order. */
  chunks: ChunkFootnotes[]
}

interface Definitions {
  text: string
  labels: Set<string>
}

/** The definition starting at `start` plus its indented continuation (blank lines
 *  only count when more indented text follows). Returns the line after it. */
function definitionEnd(lines: readonly string[], start: number): number {
  let end = start + 1
  for (let j = end; j < lines.length; j++) {
    if (DEF_CONTINUATION.test(lines[j])) end = j + 1
    else if (lines[j].trim()) break
  }
  return end
}

function collectDefinitions(lines: readonly string[], fenced: readonly boolean[]): Definitions {
  const blocks: string[] = []
  const labels = new Set<string>()
  for (let i = 0; i < lines.length; i++) {
    const m = fenced[i] ? null : FOOTNOTE_DEF.exec(lines[i])
    if (!m) continue
    const end = definitionEnd(lines, i)
    labels.add(m[1])
    blocks.push(lines.slice(i, end).join('\n'))
    i = end - 1
  }
  return { text: blocks.join('\n\n'), labels }
}

/** Labels referenced on one line, in order (not inside code spans, not the label of a
 *  definition starting the line). */
function refsOnLine(line: string): string[] {
  const text = line.replace(FOOTNOTE_DEF, '').replace(CODE_SPAN, '')
  return Array.from(text.matchAll(FOOTNOTE_REF), (m) => m[1])
}

function countRefs(lines: readonly string[], fenced: readonly boolean[], from: number, to: number, defined: Set<string>): string[] {
  const refs: string[] = []
  for (let i = from; i < to; i++) {
    if (!fenced[i]) refs.push(...refsOnLine(lines[i]).filter((label) => defined.has(label)))
  }
  return refs
}

function tally(counts: Readonly<Record<string, number>>, refs: readonly string[]): Record<string, number> {
  const next = { ...counts }
  for (const label of refs) next[label] = (next[label] ?? 0) + 1
  return next
}

/** Footnote numbering for `chunks` of `md`, or null when it has no footnotes. */
export function planFootnotes(md: string, chunks: readonly SourceChunk[]): FootnotePlan | null {
  const lines = md.replace(/\r\n?/g, '\n').split('\n')
  const fenced = scanFences(lines).inside
  const defs = collectDefinitions(lines, fenced)
  if (!defs.labels.size) return null
  const perChunk = chunks.map((chunk, c) =>
    countRefs(lines, fenced, chunk.lineOffset, chunks[c + 1]?.lineOffset ?? lines.length, defs.labels)
  )
  const order = Array.from(new Set(perChunk.flat()))
  let before: Record<string, number> = {}
  const plans = perChunk.map((refs, c): ChunkFootnotes => {
    const plan = { order, before, section: c === chunks.length - 1 }
    before = tally(before, refs)
    return plan
  })
  return { defs: defs.text, chunks: plans }
}
