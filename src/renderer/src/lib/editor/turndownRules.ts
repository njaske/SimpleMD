// GFM and clipboard-source rules for turndown: strikethrough, task boxes, tables, fenced
// code with its language, math restored from KaTeX, safe links and images, and the
// styled spans Google Docs uses instead of <b>/<i>.
import type TurndownService from 'turndown'

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

export const styleOf = (node: Element): string => (node.getAttribute('style') ?? '').toLowerCase().replace(/\s+/g, '')

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

function addTextRules(service: TurndownService): void {
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
  service.addRule('strikethrough', {
    filter: (node) => /^(DEL|S|STRIKE)$/.test(node.nodeName),
    replacement: (content) => wrap(content, '~~')
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
}

function addBlockRules(service: TurndownService): void {
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
}

function addTableRules(service: TurndownService): void {
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

export function addGfmRules(service: TurndownService): void {
  addTextRules(service)
  addBlockRules(service)
  addTableRules(service)
}
