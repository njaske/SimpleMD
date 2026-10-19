// Source line <-> scroll offset for the reader. Every top-level block of the article
// carries data-line / data-line-end; between and inside blocks we interpolate, so a
// fractional line maps to a smooth position (and back) for synced scrolling.

export interface Anchor {
  /** Offset of the block's top within the scroll content, px. */
  top: number
  height: number
  /** Source lines [start, end). */
  start: number
  end: number
}

function lastIndexWhere(anchors: readonly Anchor[], pred: (a: Anchor) => boolean): number {
  // Binary search: anchors are in document order, so both tops and lines increase.
  let lo = -1
  let hi = anchors.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (pred(anchors[mid])) lo = mid
    else hi = mid - 1
  }
  return lo
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * Math.min(1, Math.max(0, t))
}

/** When the document starts on line 0, its first block also owns the article's top
 *  padding, so "line 0" means "scrolled to the very top" in both directions. */
function padFirst(anchors: readonly Anchor[]): readonly Anchor[] {
  const first = anchors[0]
  if (!first || first.start !== 0 || first.top <= 0) return anchors
  return [{ ...first, top: 0, height: first.top + first.height }, ...anchors.slice(1)]
}

/** The (fractional) source line at scroll offset `y`, or null without anchors. */
export function lineAtOffset(measured: readonly Anchor[], y: number): number | null {
  const anchors = padFirst(measured)
  if (!anchors.length) return null
  const i = lastIndexWhere(anchors, (a) => a.top <= y)
  if (i < 0) {
    const first = anchors[0]
    return lerp(0, first.start, first.top > 0 ? y / first.top : 1)
  }
  const a = anchors[i]
  const bottom = a.top + a.height
  if (y < bottom) return lerp(a.start, a.end, (y - a.top) / Math.max(1, a.height))
  const next = anchors[i + 1]
  if (!next) return a.end
  return lerp(a.end, next.start, (y - bottom) / Math.max(1, next.top - bottom))
}

/** The scroll offset that puts source line `line` at the top, or null without anchors. */
export function offsetOfLine(measured: readonly Anchor[], line: number): number | null {
  const anchors = padFirst(measured)
  if (!anchors.length) return null
  const i = lastIndexWhere(anchors, (a) => a.start <= line)
  if (i < 0) {
    const first = anchors[0]
    return lerp(0, first.top, first.start > 0 ? line / first.start : 1)
  }
  const a = anchors[i]
  if (line < a.end) return lerp(a.top, a.top + a.height, (line - a.start) / Math.max(1, a.end - a.start))
  const bottom = a.top + a.height
  const next = anchors[i + 1]
  if (!next) return bottom
  return lerp(bottom, next.top, (line - a.end) / Math.max(1, next.start - a.end))
}

/** The line attributes of a rendered block, or null when it has none. */
export function blockLines(el: Element): { start: number; end: number } | null {
  // Digits only: a bare, value-less data-line from raw HTML would read as line 0.
  const raw = el.getAttribute('data-line')
  if (!raw || !/^\d+$/.test(raw)) return null
  const start = Number(raw)
  const end = Number(el.getAttribute('data-line-end'))
  return { start, end: Number.isFinite(end) && end > start ? end : start + 1 }
}

/** Measure the anchors of `article`'s top-level blocks inside the `scroller`. */
export function measureAnchors(article: HTMLElement, scroller: HTMLElement): Anchor[] {
  const base = scroller.getBoundingClientRect().top - scroller.scrollTop
  const anchors: Anchor[] = []
  let lastStart = -1
  for (const child of Array.from(article.children)) {
    const lines = blockLines(child)
    // Out-of-order blocks (none expected) would break the binary search; skip them.
    if (!lines || lines.start < lastStart) continue
    const rect = child.getBoundingClientRect()
    if (!rect.height && !rect.width) continue
    anchors.push({ top: rect.top - base, height: rect.height, start: lines.start, end: lines.end })
    lastStart = lines.start
  }
  return anchors
}
