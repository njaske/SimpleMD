// "What changed", counted and stepped through the way people see it. The reader marks
// blocks; an agent appending a section marks a dozen paragraphs in a row, which is one
// change, not twelve. So a run of adjacent marked blocks is one change here, and Next
// moves from run to run, wrapping, and always shows where it landed.
import { blockLines } from '@/lib/reader/anchors'

const CHANGED = 'smd-changed'
const LEAVING = 'smd-changed-out'
/** Added for a moment to the change Next landed on (a brief, brighter wash). */
export const LANDED = 'smd-change-landed'
const LANDED_MS = 1100
/** Room left above a revealed change, so the line before it gives context. */
const MARGIN = 48
/** Scroll positions this close count as the same place. */
const SLACK = 2

/** The blocks the reader can mark, in order: top-level blocks, or a list's items. */
function candidates(article: Element): Element[] {
  return Array.from(article.children).flatMap((block) => {
    if (!blockLines(block)) return []
    const items = /^(UL|OL)$/.test(block.tagName)
      ? Array.from(block.children).filter((li) => li.tagName === 'LI' && blockLines(li))
      : []
    return items.length ? items : [block]
  })
}

const isMarked = (el: Element): boolean => el.classList.contains(CHANGED) && !el.classList.contains(LEAVING)

/** Runs of adjacent marked blocks, in document order: one entry per visible change. */
export function changeGroups(article: Element): Element[][] {
  const groups: Element[][] = []
  let run: Element[] | null = null
  for (const el of candidates(article)) {
    if (!isMarked(el)) {
      run = null
      continue
    }
    if (!run) {
      run = []
      groups.push(run)
    }
    run.push(el)
  }
  return groups
}

function topIn(scroller: HTMLElement, el: Element): number {
  return el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
}

function smoothFor(scroller: HTMLElement): ScrollBehavior {
  const reduce =
    !!scroller.closest('.smd-reduce-motion') ||
    (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  return reduce ? 'auto' : 'smooth'
}

/** Where the reader stops for a change starting at `top`. */
function stopFor(scroller: HTMLElement, top: number): number {
  const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
  return Math.min(max, Math.max(0, top - MARGIN))
}

/** Steps through the changes of the painted document. */
export class ChangeCursor {
  private index = -1
  /** The scroll positions the last step went from and to. */
  private from = 0
  private to: number | null = null
  private landed: Element[] = []
  private landedTimer: ReturnType<typeof setTimeout> | null = null

  /** New marks (another reload, another document): start again from the reading spot. */
  reset(): void {
    this.index = -1
    this.to = null
  }

  /** Scroll to the next change and flash it. False when nothing is marked. */
  next(article: Element, scroller: HTMLElement): boolean {
    const groups = changeGroups(article)
    if (!groups.length) return false
    const tops = groups.map((g) => topIn(scroller, g[0]))
    const i = this.pick(scroller, tops)
    const stop = stopFor(scroller, tops[i])
    this.index = i
    this.from = scroller.scrollTop
    this.to = stop
    if (Math.abs(stop - scroller.scrollTop) > SLACK) scroller.scrollTo({ top: stop, behavior: smoothFor(scroller) })
    this.flash(groups[i])
    return true
  }

  /** Right after a step (the reader is on its way there, or still there) the next one
   *  follows it. Otherwise: the first change below the reading spot that scrolling can
   *  actually bring up, else the first one; changes already in view at the bottom of
   *  the document come round on the following press. */
  private pick(scroller: HTMLElement, tops: readonly number[]): number {
    const y = scroller.scrollTop
    if (this.to !== null && this.index >= 0 && this.index < tops.length) {
      const lo = Math.min(this.from, this.to) - SLACK
      const hi = Math.max(this.from, this.to) + SLACK
      if (y >= lo && y <= hi) return (this.index + 1) % tops.length
    }
    const below = tops.findIndex((t) => t > y + MARGIN + SLACK && Math.abs(stopFor(scroller, t) - y) > SLACK)
    return below >= 0 ? below : 0
  }

  private flash(group: Element[]): void {
    this.clearFlash()
    for (const el of group) {
      // Restart the animation when the same change is flashed twice in a row.
      void (el as HTMLElement).offsetWidth
      el.classList.add(LANDED)
    }
    this.landed = group
    this.landedTimer = setTimeout(() => this.clearFlash(), LANDED_MS)
  }

  private clearFlash(): void {
    if (this.landedTimer) clearTimeout(this.landedTimer)
    this.landedTimer = null
    this.landed.forEach((el) => el.classList.remove(LANDED))
    this.landed = []
  }

  dispose(): void {
    this.clearFlash()
    this.reset()
  }
}
