// Clipboard HTML to Markdown: sanitized with DOMPurify, then converted with turndown and
// the GFM rules beside it. Sources that only look rich (one spreadsheet cell, code copied
// from an editor like VS Code) are recognised and left as plain text.
import DOMPurify from 'dompurify'
import TurndownService from 'turndown'
import { fenceLines, fences } from './fences'
import { addGfmRules, styleOf } from './turndownRules'

// Markup that means "this was formatted"; plain paragraphs and spans paste as text.
const RICH_SELECTOR = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'table', 'blockquote', 'pre', 'code', 'strong',
  'b:not([style*="font-weight:normal"]):not([style*="font-weight: normal"])', 'em', 'i', 'del', 's',
  'strike', 'a[href]', 'img', 'hr', 'input[type="checkbox"]', 'code[data-smd-tex]',
  'span[style*="font-weight:700"]', 'span[style*="font-weight: 700"]', 'span[style*="font-weight:bold"]',
  'span[style*="font-style:italic"]', 'span[style*="font-style: italic"]', 'span[style*="line-through"]'
].join(',')

const FORBID_TAGS = ['style', 'script', 'meta', 'link', 'title', 'template', 'iframe', 'object', 'embed', 'form', 'button', 'select', 'textarea', 'svg', 'math']

/** KaTeX (ChatGPT, Claude, many docs sites) and MathML keep the source TeX in an
 *  annotation; turn rendered math back into $…$ before sanitizing drops the MathML. */
function restoreMath(doc: Document): void {
  doc.querySelectorAll('.katex-display, .katex, math').forEach((el) => {
    if (!el.isConnected) return
    const tex = el.querySelector('annotation[encoding="application/x-tex"]')?.textContent?.trim()
    if (!tex) return
    const target = el.closest('.katex-display') ?? el.closest('.katex') ?? el
    const block = target.classList.contains('katex-display') || el.getAttribute('display') === 'block'
    const code = doc.createElement('code')
    code.setAttribute('data-smd-tex', block ? 'block' : 'inline')
    code.textContent = tex
    target.replaceWith(code)
  })
}

/** Sheets and Excel put a <table> on the clipboard even for one cell, one row or one
 *  column. Those aren't tables to the user: keep their cells as lines of text instead. */
function flattenTrivialTables(doc: Document): void {
  doc.querySelectorAll('table').forEach((table) => {
    const rows = Array.from(table.querySelectorAll('tr'))
    const cols = Math.max(0, ...rows.map((r) => r.children.length))
    if (rows.length >= 2 && cols >= 2) return
    const lines = rows.map((row) => {
      const line = doc.createElement('div')
      Array.from(row.children).forEach((cell, k) => {
        if (k > 0) line.append(' ')
        line.append(...Array.from(cell.childNodes))
      })
      return line
    })
    table.replaceWith(...lines)
  })
}

function sanitize(html: string): DocumentFragment {
  // DOMParser documents are inert: nothing runs and nothing loads while we read them.
  const doc = new DOMParser().parseFromString(html, 'text/html')
  restoreMath(doc)
  flattenTrivialTables(doc)
  doc.querySelectorAll(FORBID_TAGS.join(',')).forEach((el) => el.remove())
  // The wrapper keeps the paste's own first element intact in every DOM implementation
  // (happy-dom unwraps a fragment's leading element); turndown treats it as a plain block.
  return DOMPurify.sanitize(`<div>${doc.body.innerHTML}</div>`, { FORBID_TAGS, RETURN_DOM_FRAGMENT: true })
}

const PRE_STYLE = /white-space:pre(?:-wrap)?(?:;|!|$)/
const CODE_LAYOUT = /^(DIV|SPAN|BR)$/

/** Code editors (VS Code and friends) copy a white-space:pre block of per-line divs and
 *  coloured spans. Its italic or bold tokens aren't prose formatting, and its indentation
 *  only survives as the plain text. Google Docs styles spans, not blocks, so it's not hit. */
function isEditorCode(root: DocumentFragment): boolean {
  return Array.from(root.querySelectorAll('div[style]')).some(
    (el) => PRE_STYLE.test(styleOf(el)) && Array.from(el.querySelectorAll('*')).every((d) => CODE_LAYOUT.test(d.nodeName))
  )
}

/** At most one blank line between blocks, except inside fenced code, where blank lines
 *  are the code's own (PEP 8 spacing, diffs). */
export function collapseBlankLines(markdown: string): string {
  const lines = markdown.split('\n')
  const code = fenceLines(fences(lines), lines.length)
  const extra = (i: number): boolean => lines[i] === '' && i > 0 && lines[i - 1] === '' && !code.has(i) && !code.has(i - 1)
  return lines.filter((_, i) => !extra(i)).join('\n')
}

let service: TurndownService | null = null

function turndownService(): TurndownService {
  if (service) return service
  const created = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    strongDelimiter: '**',
    linkStyle: 'inlined'
  })
  addGfmRules(created)
  service = created
  return created
}

/** Markdown for clipboard HTML, or null when it carries no formatting worth keeping. */
export function htmlToMarkdown(html: string): string | null {
  const fragment = sanitize(html)
  if (!fragment.querySelector(RICH_SELECTOR) || isEditorCode(fragment)) return null
  const markdown = collapseBlankLines(turndownService().turndown(fragment)).trim()
  return markdown || null
}
