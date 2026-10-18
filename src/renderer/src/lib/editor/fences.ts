// Fenced code blocks: finding them (block commands leave code alone) and the code-block
// toggle.
import { isBlank, keepSelection, lineEnd, range, select, toDoc, touchedLines, type Doc, type FormatEdit, type TextChange, type TextRange, type TextState } from './text'

const FENCE_RE = /^[ \t]{0,3}(`{3,}|~{3,})/

export interface Fence {
  readonly open: number
  readonly close: number | null
}

/** Fenced code blocks by line index; an unclosed fence runs to the end (close null). */
export function fences(lines: readonly string[]): Fence[] {
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

/** Line indexes of the given fenced code blocks, fence lines included. */
export function fenceLines(found: readonly Fence[], count: number): ReadonlySet<number> {
  return new Set(found.flatMap((f) => range(f.open, f.close ?? count - 1)))
}
