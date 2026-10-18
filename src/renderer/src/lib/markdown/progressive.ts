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
