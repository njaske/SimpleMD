import type { LineRange } from '@/lib/ranges'
import { blockLines } from './anchors'

// "What changed" marks: the blocks (or, inside top-level lists, the items) whose
// source lines intersect the changed ranges get `smd-changed`, a left bar + wash.

export const CHANGED = 'smd-changed'
const LEAVING = 'smd-changed-out'
const FADE_MS = 400

function intersects(lines: { start: number; end: number }, ranges: readonly LineRange[]): boolean {
  // A pure deletion arrives as a one-line range; treat empty ranges the same way.
  return ranges.some((r) => lines.start < Math.max(r.to, r.from + 1) && r.from < lines.end)
}

/** The elements to mark: top-level blocks, but the individual items of a list. */
function candidates(article: HTMLElement): Element[] {
  const out: Element[] = []
  for (const block of Array.from(article.children)) {
    if (!blockLines(block)) continue
    const items = /^(UL|OL)$/.test(block.tagName)
      ? Array.from(block.children).filter((li) => li.tagName === 'LI' && blockLines(li))
      : []
    if (items.length) out.push(...items)
    else out.push(block)
  }
  return out
}

/** Mark the blocks covering `ranges`; returns how many were marked. */
export function markChanges(article: HTMLElement, ranges: readonly LineRange[]): number {
  let count = 0
  for (const el of candidates(article)) {
    const lines = blockLines(el)
    const hit = !!lines && intersects(lines, ranges)
    el.classList.toggle(CHANGED, hit)
    el.classList.remove(LEAVING)
    if (hit) count++
  }
  return count
}

/** Remove the marks, fading them out unless `instant`. */
export function unmarkChanges(article: HTMLElement, instant = false): void {
  const marked = Array.from(article.querySelectorAll('.' + CHANGED))
  if (instant) {
    marked.forEach((el) => el.classList.remove(CHANGED, LEAVING))
    return
  }
  marked.forEach((el) => el.classList.add(LEAVING))
  setTimeout(() => {
    marked.forEach((el) => {
      if (el.classList.contains(LEAVING)) el.classList.remove(CHANGED, LEAVING)
    })
  }, FADE_MS)
}

/** The first marked element whose top is below `y` (scroll content px), wrapping to
 *  the first one. */
export function nextChange(article: HTMLElement, scroller: HTMLElement, y: number): HTMLElement | null {
  const marked = Array.from(article.querySelectorAll<HTMLElement>('.' + CHANGED + ':not(.' + LEAVING + ')'))
  if (!marked.length) return null
  const base = scroller.getBoundingClientRect().top - scroller.scrollTop
  return marked.find((el) => el.getBoundingClientRect().top - base > y + 1) ?? marked[0]
}
