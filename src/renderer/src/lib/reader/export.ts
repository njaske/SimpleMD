// Export and copy of the rendered document.
import type { ResolvedTheme } from '@shared/types'
import { escapeHtml } from '@/lib/markdown'
import { exportableSrc } from './images'
import { clipboardStyles, DEFAULT_METRICS, PALETTES, standaloneCss, type ReadingMetrics } from './exportStyles'

export interface StandaloneOptions {
  title: string
  theme: ResolvedTheme
}

// Nothing executable or fetching survives an export, whatever the article holds.
const STRIP = 'script, iframe, object, embed, link, meta, base, form, button, .smd-code-tools, .smd-copy'
const APP_CLASSES = ['smd-changed', 'smd-changed-out', 'smd-flash', 'smd-fade']
const APP_ATTRS = ['data-line', 'data-line-end', 'data-task-line', 'data-outline', 'tabindex', 'role']
const CSP =
  "default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'"

function stripUnsafe(root: HTMLElement): void {
  root.querySelectorAll(STRIP).forEach((el) => el.remove())
  // <style> only survives inside diagrams (mermaid's own SVG styles).
  root.querySelectorAll('style').forEach((el) => {
    if (!el.closest('svg')) el.remove()
  })
  root.querySelectorAll('*').forEach((el) => {
    for (const name of el.getAttributeNames()) {
      const value = el.getAttribute(name) || ''
      if (/^on/i.test(name) || (/^(href|src|xlink:href)$/i.test(name) && /^\s*(javascript|vbscript):/i.test(value))) {
        el.removeAttribute(name)
      }
    }
  })
}

function link(href: string, text: string): HTMLAnchorElement {
  const a = document.createElement('a')
  a.href = href
  a.textContent = text
  return a
}

/** Blocked or not-yet-loaded images become links (web URLs only) or their alt text. */
function settleImages(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('.smd-imgblocked').forEach((card) => {
    const src = exportableSrc(card)
    const figure = card.closest('figure')
    const alt = card.classList.contains('smd-imgchip') ? card.textContent || '' : figure?.querySelector('figcaption')?.textContent || ''
    const replacement = src ? link(src, alt || src) : textSpan(alt)
    if (figure && !card.classList.contains('smd-imgchip')) figure.replaceWith(replacement)
    else card.replaceWith(replacement)
  })
  root.querySelectorAll<HTMLElement>('.smd-imgph').forEach((ph) => ph.replaceWith(textSpan(ph.textContent || '')))
}

function textSpan(text: string): HTMLSpanElement {
  const span = document.createElement('span')
  span.textContent = text
  return span
}

/** KaTeX keeps a MathML copy of every formula; exports keep just that (no fonts or CSS). */
function mathToMathml(root: HTMLElement): void {
  root.querySelectorAll('.katex-display, .katex').forEach((el) => {
    // The clone is detached, so "still in the tree" is a contains() check.
    if (!root.contains(el) || (el.classList.contains('katex') && el.parentElement?.classList.contains('katex-display'))) return
    const math = el.querySelector('math')
    if (math) el.replaceWith(math.cloneNode(true))
  })
}

function cleanAppMarkup(root: HTMLElement): void {
  root.querySelectorAll('*').forEach((el) => {
    el.classList.remove(...APP_CLASSES)
    if (el.getAttribute('class') === '') el.removeAttribute('class')
    APP_ATTRS.forEach((name) => el.removeAttribute(name))
  })
  root.querySelectorAll('input').forEach((input) => input.setAttribute('disabled', ''))
  root.querySelectorAll('details').forEach((d) => d.setAttribute('open', ''))
}

/** A detached copy of the article without app chrome, scripts or app attributes. */
function exportClone(article: HTMLElement): HTMLElement {
  const clone = article.cloneNode(true) as HTMLElement
  settleImages(clone)
  // After settleImages: whatever it made goes through the same filter.
  stripUnsafe(clone)
  mathToMathml(clone)
  cleanAppMarkup(clone)
  return clone
}

/** The reader's current typography, so an export reads like the app. */
function readingMetrics(article: HTMLElement): ReadingMetrics {
  if (!article.isConnected || typeof getComputedStyle !== 'function') return DEFAULT_METRICS
  const style = getComputedStyle(article)
  return {
    font: style.fontFamily || DEFAULT_METRICS.font,
    size: style.fontSize || DEFAULT_METRICS.size,
    leading: style.lineHeight && style.lineHeight !== 'normal' ? style.lineHeight : DEFAULT_METRICS.leading,
    width: style.maxWidth && style.maxWidth !== 'none' ? style.maxWidth : DEFAULT_METRICS.width
  }
}

function escapeAttrText(text: string): string {
  return escapeHtml(text).replace(/"/g, '&quot;')
}

/** A complete, self-contained HTML file for the rendered `article`: one file that opens
 *  anywhere offline. Inline CSS (reader typography, code, tables, callouts, footnotes),
 *  math as MathML (no KaTeX CSS/fonts needed), Mermaid as inline SVG, local images
 *  already inlined as data: URLs, no scripts, no app chrome (copy buttons, change marks,
 *  find highlights removed), a strict CSP meta tag, and `title` escaped. */
export function buildStandaloneHtml(article: HTMLElement, opts: StandaloneOptions): string {
  const css = standaloneCss(opts.theme, readingMetrics(article))
  const body = exportClone(article).innerHTML
  return (
    '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
    `<meta http-equiv="Content-Security-Policy" content="${escapeAttrText(CSP)}">\n` +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    '<meta name="generator" content="SimpleMD">\n' +
    `<title>${escapeHtml(opts.title)}</title>\n<style>${css}</style>\n</head>\n` +
    `<body>\n<main class="smd-article">\n${body}\n</main>\n</body>\n</html>\n`
  )
}

// ---- rich clipboard -----------------------------------------------------------------

function inlineCallout(el: HTMLElement, styles: Record<string, string>): void {
  const hue = el.getAttribute('data-hue')
  const p = PALETTES.light
  const color = hue === 'tip' || hue === 'important' || hue === 'warning' || hue === 'caution' ? p[hue] : hue === 'neutral' ? p.border : p.note
  el.setAttribute('style', `${styles.callout};border-left-color:${color}`)
  el.querySelectorAll('.smd-callout-icon, .smd-callout-chevron').forEach((icon) => icon.remove())
  const title = el.querySelector<HTMLElement>('.smd-callout-title')
  if (title) title.setAttribute('style', `${styles.calloutTitle};color:${color}`)
}

function inlineStyles(root: HTMLElement, styles: Record<string, string>): void {
  root.querySelectorAll<HTMLElement>('*').forEach((el) => {
    if (el.closest('svg, math')) return
    const tag = el.tagName.toLowerCase()
    const own = tag === 'code' && el.parentElement?.tagName === 'PRE' ? '' : styles[tag]
    if (own) el.setAttribute('style', own)
  })
  root.querySelectorAll<HTMLElement>('.smd-callout').forEach((el) => inlineCallout(el, styles))
  root.querySelectorAll<HTMLElement>('.smd-footnotes').forEach((el) => el.setAttribute('style', styles.footnotes))
  root.querySelectorAll('[class]').forEach((el) => {
    if (!el.closest('svg, math')) el.removeAttribute('class')
  })
}

const BLOCK_TAGS = new Set([
  'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'PRE', 'BLOCKQUOTE', 'TABLE', 'TR',
  'FIGURE', 'FIGCAPTION', 'SECTION', 'DETAILS', 'SUMMARY', 'DL', 'DT', 'DD', 'HR'
])

function mathText(el: Element): string {
  const tex = el.querySelector('annotation[encoding="application/x-tex"]')?.textContent?.trim() ?? el.textContent ?? ''
  const display = el.closest('.katex-display') !== null || el.querySelector('math[display="block"]') !== null
  return display ? `$$${tex}$$` : `$${tex}$`
}

function listPrefix(li: Element): string {
  const box = li.querySelector(':scope > input[type=checkbox], :scope > p > input[type=checkbox]') as HTMLInputElement | null
  const task = box ? (box.checked || box.hasAttribute('checked') ? '[x] ' : '[ ] ') : ''
  const parent = li.parentElement
  if (parent?.tagName === 'OL') {
    const start = Number(parent.getAttribute('start') || 1)
    return `${start + Array.from(parent.children).indexOf(li)}. ${task}`
  }
  return '- ' + task
}

/** Plain text of the article: blocks on their own lines, formulas as TeX. */
function plainText(node: Node): string {
  if (node.nodeType === 3) return (node.textContent || '').replace(/\s+/g, ' ')
  if (!(node instanceof Element)) return ''
  if (node.matches('.katex-display, .katex')) return mathText(node)
  if (node.matches(STRIP + ', svg, .katex-mathml')) return ''
  if (node.tagName === 'BR') return '\n'
  if (node.tagName === 'PRE') return '\n' + (node.textContent || '').replace(/\n$/, '') + '\n'
  if (node.tagName === 'IMG') return node.getAttribute('alt') || ''
  if (node.tagName === 'HR') return '\n---\n'
  const sep = node.tagName === 'TR' ? '\t' : ''
  const inner = Array.from(node.childNodes).map(plainText).join(sep)
  if (node.tagName === 'LI') return '\n' + listPrefix(node) + inner.trim()
  return BLOCK_TAGS.has(node.tagName) ? '\n' + inner + '\n' : inner
}

function tidyText(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, '').replace(/^ +(?=\S)/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Rich-text clipboard payload for pasting into Docs, Word or email: HTML with inline
 *  styles that survive pasting (no classes needed), and a plain-text fallback. */
export function articleClipboardPayload(article: HTMLElement): { html: string; text: string } {
  const metrics = readingMetrics(article)
  // Pasted text wants the content, not the file's metadata card.
  const content = article.cloneNode(true) as HTMLElement
  content.querySelectorAll('.smd-frontmatter').forEach((card) => card.remove())
  const text = tidyText(plainText(content))
  const clone = exportClone(content)
  const styles = clipboardStyles(metrics)
  inlineStyles(clone, styles)
  return { html: `<div style="${escapeAttrText(styles.root)}">${clone.innerHTML}</div>`, text }
}
