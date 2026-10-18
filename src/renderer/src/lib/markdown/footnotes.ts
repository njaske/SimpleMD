import markedFootnote, { type Footnote, type FootnoteRef, type Footnotes } from 'marked-footnote'
import type { MarkedExtension, Token } from 'marked'

// GFM footnotes via marked-footnote. References render as superscript links to
// `#footnote-<label>` and definitions collect into a quiet "Footnotes" section at the
// end with back-links; the reader scrolls to both in-document.

export const FOOTNOTE_PREFIX = 'footnote-'

export function footnoteExtension(): MarkedExtension {
  return markedFootnote({
    prefixId: FOOTNOTE_PREFIX,
    description: 'Footnotes',
    sectionClass: 'smd-footnotes',
    headingClass: 'smd-footnotes-title',
    backRefLabel: 'Back to reference {0}'
  })
}

/** The collected "Footnotes" section token. Its raw is the section title, not source
 *  text, so the source mapper must skip it. */
export function isFootnotesSection(token: Token): boolean {
  return token.type === 'footnotes'
}

/** How one chunk of a progressive render numbers its footnotes, so the chunks read as
 *  one document: one numbering, unique back-link ids, one section at the very end. */
export interface ChunkFootnotes {
  /** Every referenced label, in order of first reference in the whole document. */
  order: readonly string[]
  /** References to each label in earlier chunks. */
  before: Readonly<Record<string, number>>
  /** Only the last chunk renders the Footnotes section. */
  section: boolean
}

type Walk = (tokens: Token[], visit: (token: Token) => void) => void

/** A section listing every note of the document, with a back-link per reference
 *  (the earlier ones point into chunks rendered before this one). */
function fullSection(token: Footnotes, plan: ChunkFootnotes, numbers: ReadonlyMap<string, number>): Footnotes {
  const items: Footnote[] = []
  for (const label of plan.order) {
    const item = token.rawItems.find((raw) => raw.label === label)
    if (!item) continue
    const total = (plan.before[label] ?? 0) + item.refs.length
    const id = String(numbers.get(label) ?? items.length + 1)
    const refs = Array.from({ length: total }, (_, index): FootnoteRef => ({ type: 'footnoteRef', raw: '', index, id, label }))
    items.push({ ...item, refs })
  }
  return { ...token, items }
}

/** Renumber one chunk's footnotes to the document's order and keep (or drop) its
 *  section. Returns the top-level tokens to render. */
export function alignFootnotes(tokens: Token[], plan: ChunkFootnotes, walk: Walk): Token[] {
  const numbers = new Map(plan.order.map((label, i) => [label, i + 1]))
  // Freshly lexed tokens, owned by this render: adjusted in place like walkTokens does.
  walk(tokens, (token) => {
    if (token.type !== 'footnoteRef') return
    const ref = token as unknown as FootnoteRef
    ref.id = String(numbers.get(ref.label) ?? ref.id)
    ref.index += plan.before[ref.label] ?? 0
  })
  const section = tokens.find(isFootnotesSection) as unknown as Footnotes | undefined
  const body = tokens.filter((token) => !isFootnotesSection(token))
  if (!plan.section || !section) return body
  return [...body, fullSection(section, plan, numbers) as unknown as Token]
}
