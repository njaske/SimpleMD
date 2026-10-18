// CONTRACT STUB (lane R implements). Export and copy of the rendered document.
import type { ResolvedTheme } from '@shared/types'

export interface StandaloneOptions {
  title: string
  theme: ResolvedTheme
}

/** A complete, self-contained HTML file for the rendered `article`: one file that opens
 *  anywhere offline. Inline CSS (reader typography, code, tables, callouts, footnotes),
 *  math as MathML (no KaTeX CSS/fonts needed), Mermaid as inline SVG, local images
 *  already inlined as data: URLs, no scripts, no app chrome (copy buttons, change marks,
 *  find highlights removed), a strict CSP meta tag, and `title` escaped. */
export function buildStandaloneHtml(article: HTMLElement, opts: StandaloneOptions): string {
  const title = opts.title.replace(/[<>&"]/g, '')
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${article.innerHTML}</body></html>`
}

/** Rich-text clipboard payload for pasting into Docs, Word or email: HTML with inline
 *  styles that survive pasting (no classes needed), and a plain-text fallback. */
export function articleClipboardPayload(article: HTMLElement): { html: string; text: string } {
  return { html: article.innerHTML, text: article.innerText }
}
