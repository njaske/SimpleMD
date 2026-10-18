// Find in document: matches are DOM Ranges painted with the CSS Custom Highlight API
// (::highlight(smd-find) / ::highlight(smd-find-current)), so the article DOM is never
// rewritten and re-renders stay cheap. Without the API the current match is selected.

export interface FindResult {
  /** 1-based index of the current match, 0 when there is none. */
  index: number
  total: number
}

const HIGHLIGHT_ALL = 'smd-find'
const HIGHLIGHT_CURRENT = 'smd-find-current'
/** Keeps a one-letter query in a huge document responsive. */
const MAX_MATCHES = 5000

// Text that isn't part of the reading flow: MathML duplicates of formulas, the code
// block tools, diagram SVG internals.
const SKIP = '.katex-mathml, .smd-code-tools, .smd-mermaid, script, style, button'
const BLOCKS = 'p, li, h1, h2, h3, h4, h5, h6, td, th, pre, dt, dd, figcaption, summary, blockquote, div'

interface Segment {
  node: Text
  /** Offset of the node's first character in the flattened text. */
  start: number
}

export interface TextIndex {
  /** Lower-cased text of the article; blocks are separated by "\n". */
  text: string
  segments: Segment[]
}

/** Flatten the article's readable text for searching. */
export function indexText(root: HTMLElement): TextIndex {
  const segments: Segment[] = []
  let text = ''
  let lastBlock: Element | null = null
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const t = node as Text
    const parent = t.parentElement
    if (!parent || !t.data || parent.closest(SKIP)) continue
    const block = parent.closest(BLOCKS)
    if (block !== lastBlock && text) text += '\n'
    lastBlock = block
    const lower = t.data.toLowerCase()
    // Rare characters change length when lower-cased; keep offsets aligned.
    segments.push({ node: t, start: text.length })
    text += lower.length === t.data.length ? lower : t.data
  }
  return { text, segments }
}

/** Start offsets of every (non-overlapping) occurrence of `needle` in `haystack`. */
export function findOffsets(haystack: string, needle: string, limit = MAX_MATCHES): number[] {
  const out: number[] = []
  if (!needle) return out
  for (let i = haystack.indexOf(needle); i >= 0 && out.length < limit; i = haystack.indexOf(needle, i + needle.length)) {
    out.push(i)
  }
  return out
}

function segmentAt(segments: readonly Segment[], offset: number): Segment {
  let lo = 0
  let hi = segments.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (segments[mid].start <= offset) lo = mid
    else hi = mid - 1
  }
  return segments[lo]
}

function toRange(index: TextIndex, start: number, length: number): Range {
  const a = segmentAt(index.segments, start)
  const b = segmentAt(index.segments, start + length - 1)
  const range = document.createRange()
  range.setStart(a.node, start - a.start)
  range.setEnd(b.node, Math.min(b.node.data.length, start + length - b.start))
  return range
}

function highlightsSupported(): boolean {
  return typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight === 'function'
}

/** One find session over the current article. */
export class FindState {
  query = ''
  private ranges: Range[] = []
  private current = -1

  get result(): FindResult {
    return { index: this.current + 1, total: this.ranges.length }
  }

  get currentRange(): Range | null {
    return this.ranges[this.current] ?? null
  }

  /** Recompute matches of `query` in `root`. The current match becomes the first one
   *  `isAtOrBelow` accepts (the caller passes "not above the viewport"), else the first. */
  search(root: HTMLElement, query: string, isAtOrBelow: (range: Range) => boolean): void {
    this.query = query
    const needle = query.toLowerCase()
    const index = indexText(root)
    this.ranges = index.segments.length
      ? findOffsets(index.text, needle).map((start) => toRange(index, start, needle.length))
      : []
    const first = this.ranges.findIndex(isAtOrBelow)
    this.current = this.ranges.length ? Math.max(0, first) : -1
    this.paint()
  }

  /** Re-run the same query after a repaint, keeping the position when possible. */
  refresh(root: HTMLElement): void {
    const keep = this.current
    const query = this.query
    this.search(root, query, () => true)
    if (this.ranges.length) this.current = Math.min(Math.max(0, keep), this.ranges.length - 1)
    this.paint()
  }

  step(backwards: boolean): void {
    const n = this.ranges.length
    if (!n) return
    this.current = (this.current + (backwards ? -1 : 1) + n) % n
    this.paint()
  }

  clear(): void {
    this.query = ''
    this.ranges = []
    this.current = -1
    if (highlightsSupported()) {
      CSS.highlights.delete(HIGHLIGHT_ALL)
      CSS.highlights.delete(HIGHLIGHT_CURRENT)
    }
  }

  private paint(): void {
    const current = this.currentRange
    if (highlightsSupported()) {
      CSS.highlights.set(HIGHLIGHT_ALL, new Highlight(...this.ranges))
      if (current) CSS.highlights.set(HIGHLIGHT_CURRENT, new Highlight(current))
      else CSS.highlights.delete(HIGHLIGHT_CURRENT)
      return
    }
    // Fallback: show the current match as the selection.
    const selection = window.getSelection()
    selection?.removeAllRanges()
    if (current) selection?.addRange(current)
  }
}
