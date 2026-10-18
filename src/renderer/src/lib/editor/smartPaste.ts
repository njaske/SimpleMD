// Smart paste: rich clipboard content becomes Markdown. HTML (from a browser, Docs, a chat
// app) is sanitized with DOMPurify and converted with turndown plus GFM rules; spreadsheet
// cells (tab-separated rows) become a table. Plain text is left alone (callers paste it
// as is). Pure apart from the DOM parser, so it runs under happy-dom in tests.
import DOMPurify from 'dompurify'
import TurndownService from 'turndown'

export interface PasteConversion {
  readonly markdown: string
  /** Block content (a table) that should sit on its own lines. */
  readonly block: boolean
}

/** What to insert for a paste, or null to paste the plain text unchanged. */
export function convertPaste(html: string, text: string): PasteConversion | null {
  const table = tsvToTable(text)
  if (table) return { markdown: table, block: true }
  if (!html.trim()) return null
  const markdown = htmlToMarkdown(html)
  if (!markdown || markdown === text.trim()) return null
  return { markdown, block: false }
}

// ---- spreadsheet cells -----------------------------------------------------------------

/** Split tab-separated text into rows of cells, honouring Excel-style quoted cells. */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let i = 0
  const src = text.replace(/\r\n?/g, '\n').replace(/\n$/, '')
  while (i <= src.length) {
    const ch = src[i]
    if (cell === '' && ch === '"' && src.indexOf('"', i + 1) > 0) {
      // Quoted cell: runs to the next lone quote; "" is a literal quote.
      let j = i + 1
      let value = ''
      while (j < src.length && !(src[j] === '"' && src[j + 1] !== '"')) {
        value += src[j]
        j += src[j] === '"' ? 2 : 1
      }
      const next = src[j + 1]
      if (next === undefined || next === '\t' || next === '\n') {
        cell = value
        i = j + 1
        continue
      }
    }
    if (ch === '\t' || ch === '\n' || ch === undefined) {
      row = [...row, cell]
      cell = ''
      if (ch !== '\t') {
        rows.push(row)
        row = []
      }
    } else {
      cell += ch
    }
    i++
  }
  return rows
}

const MAX_PAD = 40

function tableCell(value: string): string {
  return value.trim().replace(/\|/g, '\\|').replace(/\n/g, '<br>')
}

function tableLine(cells: readonly string[], widths: readonly number[]): string {
  return '| ' + cells.map((c, k) => c.padEnd(widths[k])).join(' | ') + ' |'
}

/** Rows of tab-separated cells (at least 2 rows x 2 columns, all the same width) as a
 *  Markdown table with the first row as the header; null for anything else. */
export function tsvToTable(text: string): string | null {
  if (!text.includes('\t')) return null
  const rows = parseTsv(text).map((r) => r.map(tableCell))
  if (rows.length < 2) return null
  const cols = rows[0].length
  if (cols < 2 || rows.some((r) => r.length !== cols)) return null
  // Every row starting with a tab is indented code, not a sheet.
  if (rows.every((r) => r[0] === '')) return null
  const widths = rows[0].map((_, k) => Math.min(MAX_PAD, Math.max(3, ...rows.map((r) => r[k].length))))
  const lines = [tableLine(rows[0], widths), tableLine(widths.map((w) => '-'.repeat(w)), widths), ...rows.slice(1).map((r) => tableLine(r, widths))]
  return lines.join('\n')
}

// ---- HTML ----------------------------------------------------------------------------------

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

function sanitize(html: string): DocumentFragment {
  // DOMParser documents are inert: nothing runs and nothing loads while we read them.
  const doc = new DOMParser().parseFromString(html, 'text/html')
  restoreMath(doc)
  doc.querySelectorAll(FORBID_TAGS.join(',')).forEach((el) => el.remove())
  // The wrapper keeps the paste's own first element intact in every DOM implementation
  // (happy-dom unwraps a fragment's leading element); turndown treats it as a plain block.
  return DOMPurify.sanitize(`<div>${doc.body.innerHTML}</div>`, { FORBID_TAGS, RETURN_DOM_FRAGMENT: true })
}

/** Text of a code element, keeping line breaks from <br> and per-line blocks. */
function codeText(node: Node): string {
  if (node.nodeType === 3) return node.textContent ?? ''
  if (node.nodeName === 'BR') return '\n'
  const inner = Array.from(node.childNodes).map(codeText).join('')
  const lineBlock = /^(DIV|P|LI|TR)$/.test(node.nodeName) && !inner.endsWith('\n')
  return lineBlock ? inner + '\n' : inner
}

const LANG_RE = /(?:^|\s)(?:language|lang)-([\w+#.-]+)/

function codeLanguage(pre: HTMLElement, code: Element | null): string {
  const own = LANG_RE.exec(code?.className ?? '')?.[1] ?? LANG_RE.exec(pre.className)?.[1]
  if (own) return own
  const gh = pre.closest('[class*="highlight-source-"]')?.className ?? ''
  return /highlight-source-([\w+#.-]+)/.exec(gh)?.[1] ?? ''
}

function fenceFor(body: string): string {
  const longest = Math.max(0, ...(body.match(/`{3,}/g) ?? []).map((r) => r.length))
  return '`'.repeat(Math.max(3, longest + 1))
}

// Web, mail, in-document and relative links; any other scheme (javascript:, file:) is dropped.
const SAFE_HREF = /^(?:https?:|mailto:|#|\/|\.{1,2}\/|(?![a-z][a-z0-9+.-]*:))/i

/** Spaces and parentheses would end a Markdown link destination early. */
const escapeUrl = (url: string): string =>
  url.replace(/[()\s]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'))

const styleOf = (node: HTMLElement): string => (node.getAttribute('style') ?? '').toLowerCase().replace(/\s+/g, '')

const wrap = (content: string, mark: string): string => (content.trim() ? mark + content + mark : content)

function cellText(content: string): string {
  return content.replace(/\n+/g, ' ').trim().replace(/\|/g, '\\|')
}

function alignment(cell: Element | null): string {
  const align = (cell?.getAttribute('align') ?? /text-align:\s*(\w+)/i.exec(cell?.getAttribute('style') ?? '')?.[1] ?? '').toLowerCase()
  if (align === 'center') return ':---:'
  if (align === 'right') return '---:'
  if (align === 'left') return ':---'
  return '---'
}

function tableWidth(table: Element | null): number {
  const rows = table ? Array.from(table.querySelectorAll('tr')) : []
  return Math.max(1, ...rows.map((r) => r.children.length))
}

function addGfmRules(service: TurndownService): void {
  service.remove(['colgroup', 'col', 'noscript'])
  // Google Docs wraps a whole paste in <b style="font-weight:normal">; it isn't bold.
  service.addRule('docsWrapper', {
    filter: (node) => node.nodeName === 'B' && /font-weight:(normal|400)/.test(styleOf(node)),
    replacement: (content) => content
  })
  service.addRule('styledSpan', {
    filter: (node) => node.nodeName === 'SPAN' && /font-weight:(700|bold)|font-style:italic|line-through/.test(styleOf(node)),
    replacement: (content, node) => {
      const style = styleOf(node)
      const bold = /font-weight:(700|bold)/.test(style) ? wrap(content, '**') : content
      const italic = style.includes('font-style:italic') ? wrap(bold, '*') : bold
      return style.includes('line-through') ? wrap(italic, '~~') : italic
    }
  })
  // "- item" / "1. item" (turndown pads markers to 4 columns); nested content is indented
  // to the item's text so it stays inside the item.
  service.addRule('listItem', {
    filter: 'li',
    replacement: (content, node) => {
      const parent = node.parentElement
      const index = parent ? Array.from(parent.children).indexOf(node) : 0
      const start = Number(parent?.getAttribute('start') ?? 1) || 1
      const prefix = parent?.nodeName === 'OL' ? `${start + index}. ` : '- '
      const body = content.replace(/^\n+/, '').replace(/\n+$/, '\n').replace(/\n(?=.)/g, '\n' + ' '.repeat(prefix.length))
      return prefix + body + (node.nextSibling && !body.endsWith('\n') ? '\n' : '')
    }
  })
  service.addRule('strikethrough', {
    filter: (node) => /^(DEL|S|STRIKE)$/.test(node.nodeName),
    replacement: (content) => wrap(content, '~~')
  })
  service.addRule('taskBox', {
    filter: (node) => node.nodeName === 'INPUT' && node.getAttribute('type') === 'checkbox',
    replacement: (_content, node) => {
      const box = node.hasAttribute('checked') ? '[x]' : '[ ]'
      return /^\s/.test(node.nextSibling?.textContent ?? '') ? box : box + ' '
    }
  })
  service.addRule('math', {
    filter: (node) => node.nodeName === 'CODE' && node.hasAttribute('data-smd-tex'),
    replacement: (_content, node) => {
      const tex = node.textContent ?? ''
      return node.getAttribute('data-smd-tex') === 'block' ? `\n\n$$\n${tex}\n$$\n\n` : `$${tex}$`
    }
  })
  service.addRule('fencedCode', {
    filter: 'pre',
    replacement: (_content, node) => {
      const code = node.querySelector('code')
      const body = codeText(code ?? node).replace(/\n+$/, '')
      const fence = fenceFor(body)
      return `\n\n${fence}${codeLanguage(node, code)}\n${body}\n${fence}\n\n`
    }
  })
  service.addRule('link', {
    filter: (node) => node.nodeName === 'A' && node.hasAttribute('href'),
    replacement: (content, node) => {
      const href = node.getAttribute('href') ?? ''
      if (!SAFE_HREF.test(href) || !content.trim()) return content
      const title = node.getAttribute('title')
      return `[${content}](${escapeUrl(href)}${title ? ` "${title.replace(/"/g, '\\"')}"` : ''})`
    }
  })
  service.addRule('image', {
    filter: 'img',
    replacement: (_content, node) => {
      const src = node.getAttribute('src') ?? ''
      const alt = (node.getAttribute('alt') ?? '').replace(/[[\]]/g, '')
      // Inline data/blob/file images would bloat the document or point nowhere.
      if (!src || /^(data|blob|file):/i.test(src)) return alt
      return `![${alt}](${escapeUrl(src)})`
    }
  })
  service.addRule('tableSection', { filter: ['thead', 'tbody', 'tfoot'], replacement: (content) => content })
  service.addRule('tableCell', { filter: ['th', 'td'], replacement: (content) => `| ${cellText(content)} ` })
  service.addRule('tableRow', {
    filter: 'tr',
    replacement: (content, node) => {
      const table = node.closest('table')
      const cols = tableWidth(table)
      const row = content + '|  '.repeat(Math.max(0, cols - node.children.length)) + '|'
      if (table?.querySelector('tr') !== node) return '\n' + row
      const cells = Array.from(node.children)
      const sep = Array.from({ length: cols }, (_, k) => alignment(cells[k] ?? null))
      return `\n${row}\n| ${sep.join(' | ')} |`
    }
  })
  service.addRule('table', { filter: 'table', replacement: (content) => `\n\n${content.trim()}\n\n` })
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
  if (!fragment.querySelector(RICH_SELECTOR)) return null
  const markdown = turndownService()
    .turndown(fragment)
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return markdown || null
}
