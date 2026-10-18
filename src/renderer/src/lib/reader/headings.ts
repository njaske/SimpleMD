import { computeOutline, slugify } from '@/lib/document'
import { headingLines } from '@/lib/markdown'
import { blockLines } from './anchors'

// Heading ids (the outline's slugs, so outline clicks and #links land) and the
// scroll spy that tells the outline which section is being read.

const HEADINGS = 'h1, h2, h3, h4, h5, h6'

export interface HeadingSlugs {
  /** Outline slug by the 0-based source line of its heading. */
  byLine: Map<number, string>
  /** Ids already taken (every outline slug is reserved up front). */
  used: Set<string>
}

/** Outline slugs of `md`, computed once per render. */
export function headingSlugs(md: string): HeadingSlugs {
  const outline = computeOutline(md)
  const byLine = new Map<number, string>()
  headingLines(md).forEach((line, i) => {
    if (outline[i]) byLine.set(line, outline[i].slug)
  })
  return { byLine, used: new Set(outline.map((entry) => entry.slug)) }
}

/** Give the top-level headings under `root` the outline's slugs, matched by source line;
 *  other headings (setext, nested in callouts) get a unique slug of their text. */
export function assignHeadingIds(root: ParentNode, slugs: HeadingSlugs): void {
  const { byLine: slugByLine, used } = slugs
  root.querySelectorAll<HTMLElement>(HEADINGS).forEach((h) => {
    if (h.id || h.closest('.smd-footnotes')) return
    const at = blockLines(h)
    const slug = at ? slugByLine.get(at.start) : undefined
    if (slug) {
      h.id = slug
      h.dataset.outline = ''
      return
    }
    const base = slugify(h.textContent || '') || 'section'
    let id = base
    for (let k = 1; used.has(id); k++) id = `${base}-${k}`
    used.add(id)
    h.id = id
  })
}

/** The outline slug of the section at the top of the reader, or null above the first. */
export function activeHeading(article: HTMLElement, scroller: HTMLElement): string | null {
  const headings = Array.from(article.querySelectorAll<HTMLElement>(':scope > [data-outline]'))
  if (!headings.length) return null
  const atEnd = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 4
  if (atEnd && scroller.scrollTop > 0) return headings[headings.length - 1].id
  // A heading counts once it has crossed the upper part of the viewport.
  const line = scroller.getBoundingClientRect().top + Math.min(120, scroller.clientHeight * 0.3)
  let current: string | null = null
  for (const h of headings) {
    if (h.getBoundingClientRect().top > line) break
    current = h.id
  }
  return current
}
