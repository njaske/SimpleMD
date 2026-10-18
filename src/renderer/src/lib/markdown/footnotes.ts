import markedFootnote from 'marked-footnote'
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
