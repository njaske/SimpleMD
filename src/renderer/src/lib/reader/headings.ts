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
  /** Next suffix to try per base slug, so a run of identical headings stays linear. */
  next: Map<string, number>
}

/** Outline slugs of `md`, computed once per render. */
export function headingSlugs(md: string): HeadingSlugs {
  // Line numbers follow the renderer, which reads CRLF and lone CR as line breaks
  // (Windows files); a trailing CR would also make every ATX heading fail to match.
  const text = md.includes('\r') ? md.replace(/\r\n?/g, '\n') : md
  const outline = computeOutline(text)
  const byLine = new Map<number, string>()
  headingLines(text).forEach((line, i) => {
    if (outline[i]) byLine.set(line, outline[i].slug)
  })
  return { byLine, used: new Set(outline.map((entry) => entry.slug)), next: new Map() }
}

/** A unique id for `base`. `used` only ever grows, so resuming from the last suffix
 *  tried gives the same ids as counting up from 1 each time. */
function uniqueId(base: string, slugs: HeadingSlugs): string {
  let k = slugs.next.get(base) ?? 1
  let id = base
  while (slugs.used.has(id)) id = `${base}-${k++}`
  slugs.next.set(base, k)
  slugs.used.add(id)
  return id
}

/** Give the top-level headings under `root` the outline's slugs, matched by source line;
 *  other headings (setext, nested in callouts) get a unique slug of their text. */
export function assignHeadingIds(root: ParentNode, slugs: HeadingSlugs): void {
  root.querySelectorAll<HTMLElement>(HEADINGS).forEach((h) => {
    if (h.id || h.closest('.smd-footnotes')) return
    const at = blockLines(h)
    const slug = at ? slugs.byLine.get(at.start) : undefined
    if (slug) {
      h.id = slug
      h.dataset.outline = ''
      return
    }
    h.id = uniqueId(slugify(h.textContent || '') || 'section', slugs)
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
