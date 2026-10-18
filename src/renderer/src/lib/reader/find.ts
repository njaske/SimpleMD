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
// block tools, diagram SVG internals. Checked per element (tag and class lookups, no
// selector matching per text node), which keeps indexing a multi-MB article quick.
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'BUTTON', 'TEMPLATE'])
const SKIP_CLASSES = ['katex-mathml', 'smd-code-tools', 'smd-mermaid']
const BLOCK_TAGS = new Set([
  'P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TD', 'TH', 'PRE', 'DT', 'DD', 'FIGCAPTION', 'SUMMARY',
  'BLOCKQUOTE', 'DIV', 'TABLE', 'TR', 'UL', 'OL', 'SECTION', 'DETAILS', 'FIGURE'
])

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

function isSkipped(el: Element): boolean {
  return SKIP_TAGS.has(el.tagName) || SKIP_CLASSES.some((name) => el.classList.contains(name))
}

/** Flatten the article's readable text for searching. */
export function indexText(root: HTMLElement): TextIndex {
  const segments: Segment[] = []
  const parts: string[] = []
  let length = 0
  // A block boundary was crossed since the last text: the next text starts a new line.
  let pendingBreak = false
  const visit = (parent: Node): void => {
    for (let node = parent.firstChild; node; node = node.nextSibling) {
      if (node.nodeType === 3) {
        const t = node as Text
        if (!t.data) continue
        if (pendingBreak && length) {
          parts.push('\n')
          length++
        }
        pendingBreak = false
        const lower = t.data.toLowerCase()
        // Rare characters change length when lower-cased; keep offsets aligned.
        segments.push({ node: t, start: length })
        parts.push(lower.length === t.data.length ? lower : t.data)
        length += t.data.length
      } else if (node.nodeType === 1 && !isSkipped(node as Element)) {
        const block = BLOCK_TAGS.has((node as Element).tagName)
        if (block) pendingBreak = true
        visit(node)
        if (block) pendingBreak = true
      }
    }
  }
  visit(root)
  return { text: parts.join(''), segments }
}

/** Index of the first item `accepts` takes, for items where acceptance only switches
 *  from false to true once (ranges in document order vs. "at or below the viewport").
 *  A binary search, so a find in a huge document measures a handful of ranges. */
export function firstAccepted<T>(items: readonly T[], accepts: (item: T) => boolean): number {
  let lo = 0
  let hi = items.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (accepts(items[mid])) hi = mid
    else lo = mid + 1
  }
  return lo < items.length ? lo : -1
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
  // The article's text index, rebuilt only after its text changed (a repaint, images
  // loading in): typing a query re-searches the same text many times.
  private index: { root: HTMLElement; value: TextIndex; observer: MutationObserver | null } | null = null

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
    const index = this.textIndex(root)
    this.ranges = index.segments.length
      ? findOffsets(index.text, needle).map((start) => toRange(index, start, needle.length))
      : []
    const first = firstAccepted(this.ranges, isAtOrBelow)
    this.current = this.ranges.length ? Math.max(0, first) : -1
    this.paint()
  }

  /** Re-run the same query after a repaint, keeping the position when possible. */
  refresh(root: HTMLElement): void {
    // The repaint just happened: the observer hasn't reported it yet.
    this.invalidate()
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

  /** Forget the cached text index (the article was replaced or rewritten). */
  invalidate(): void {
    this.index?.observer?.disconnect()
    this.index = null
  }

  clear(): void {
    this.query = ''
    this.ranges = []
    this.current = -1
    this.invalidate()
    if (highlightsSupported()) {
      CSS.highlights.delete(HIGHLIGHT_ALL)
      CSS.highlights.delete(HIGHLIGHT_CURRENT)
    }
  }

  private textIndex(root: HTMLElement): TextIndex {
    if (this.index?.root === root) return this.index.value
    this.invalidate()
    const value = indexText(root)
    const observer = typeof MutationObserver === 'function' ? new MutationObserver(() => this.invalidate()) : null
    observer?.observe(root, { childList: true, subtree: true, characterData: true })
    // Without an observer there's no way to know the text is still current: don't cache.
    if (observer) this.index = { root, value, observer }
    return value
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
