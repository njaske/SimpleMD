import { marked, type Tokens, type TokenizerAndRendererExtension } from 'marked'
import DOMPurify from 'dompurify'
import type katexType from 'katex'
import { mayContainCode, mayContainMath } from '@/lib/document'
import { TextCache } from '@/lib/lru'
import { isHighlighterSettled, loadHighlighter } from '@/lib/highlight'

marked.use({ gfm: true, breaks: false })

// LaTeX math via KaTeX with our own (pandoc-style) delimiter rules, tokenized
// before the inline pass so formula characters (_ * \) survive. We roll our own
// instead of using a library's rules because those either mis-nest inline math
// that's followed by punctuation ("$x=1$;" — closing $ not followed by space) or
// wrongly treat prose dollar amounts ("$5 for $10") as math. Our rules do both:
//  - display  $$...$$  (also inline within a paragraph),
//  - inline   $...$     where the opening $ isn't followed by whitespace, the
//    closing $ isn't preceded by whitespace, and isn't followed by a digit —
//    so "$5 for $10" is left alone but "$x=1$;" closes at the right $.
//
// KaTeX (JS + stylesheet + fonts) is loaded on demand: callers await
// prepareMarkdown() before parsing a document that may contain math.
let katex: typeof katexType | null = null
let katexLoading: Promise<void> | null = null
let katexSettled = false

function loadKatex(): Promise<void> {
  if (!katexLoading) {
    // The stylesheet loads independently, so a CSS chunk failure can't disable math.
    const css = import('katex/dist/katex.min.css').catch(() => undefined)
    katexLoading = Promise.all([import('katex'), css])
      .then(([m]) => {
        katex = m.default
      })
      .catch(() => {
        // chunk failed to load; math falls back to its escaped source text
      })
      .finally(() => {
        katexSettled = true
      })
  }
  return katexLoading
}

/** Load whatever optional renderers (KaTeX, highlight.js) this document needs.
 *  Returns null when everything needed is already available, so the common path
 *  stays synchronous. */
export function prepareMarkdown(md: string): Promise<void> | null {
  if (md.length > MAX_PARSE_CHARS) return null
  const loads: Promise<void>[] = []
  if (mayContainMath(md) && !katexSettled) loads.push(loadKatex())
  if (mayContainCode(md) && !isHighlighterSettled()) loads.push(loadHighlighter())
  return loads.length ? Promise.all(loads).then(() => undefined) : null
}

function renderMath(tex: string, displayMode: boolean): string {
  try {
    if (!katex) throw new Error('KaTeX not loaded')
    return katex.renderToString(tex, { displayMode, throwOnError: false, output: 'htmlAndMathml' })
  } catch {
    const d = displayMode ? '$$' : '$'
    return escapeHtml(d + tex + d)
  }
}

const displayMath: TokenizerAndRendererExtension = {
  name: 'displayMath',
  level: 'inline',
  start(src: string) {
    // Report the next single `$`, not the next `$$`: searching for `$$` scans to
    // the end of the document on every inline `$` and goes quadratic.
    const i = src.indexOf('$')
    return i < 0 ? undefined : i
  },
  tokenizer(src: string) {
    const m = /^\$\$([\s\S]+?)\$\$/.exec(src)
    if (!m) return undefined
    return { type: 'displayMath', raw: m[0], text: m[1].trim() }
  },
  renderer(token) {
    return renderMath((token as Tokens.Generic & { text: string }).text, true)
  }
}

const inlineMath: TokenizerAndRendererExtension = {
  name: 'inlineMath',
  level: 'inline',
  start(src: string) {
    const i = src.indexOf('$')
    return i < 0 ? undefined : i
  },
  tokenizer(src: string) {
    const m = /^\$(?![$\s])((?:\\\$|[^$])+?)(?<!\s)\$(?!\d)/.exec(src)
    if (!m) return undefined
    return { type: 'inlineMath', raw: m[0], text: m[1] }
  },
  renderer(token) {
    return renderMath((token as Tokens.Generic & { text: string }).text, false)
  }
}

marked.use({ extensions: [displayMath, inlineMath] })

export function escapeHtml(input: string): string {
  return (input || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// Inline styles that would let a document escape its own column: cover the app
// with a fake prompt (fixed/sticky, z-index, inset) or fetch remote resources
// (url(), @import). KaTeX itself relies on relative/absolute positioning, top,
// left and sizes, so those stay allowed.
const UNSAFE_STYLE = /position\s*:\s*(fixed|sticky)|z-index|inset|url\s*\(|@import|expression\s*\(|behavior/i

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  // GFM task lists emit <input type="checkbox" disabled>; any other input
  // (password fields, text boxes) is a phishing surface in a read-only view.
  if (node.tagName === 'INPUT') {
    if (node.getAttribute('type') !== 'checkbox') {
      node.remove()
      return
    }
    node.setAttribute('disabled', '')
  }
  const style = node.getAttribute('style')
  if (style && UNSAFE_STYLE.test(style)) node.removeAttribute('style')
})

/** Documents larger than this are shown as escaped source rather than parsed,
 *  so a hostile or accidental huge file cannot freeze the renderer. */
const MAX_PARSE_CHARS = 1_000_000

// Re-parsing is the dominant cost of switching back to a document, so keep the
// sanitized HTML of a few recently viewed ones (bounded by size).
const parseCache = new TextCache(6, 6_000_000)

/** Parse Markdown to sanitized HTML. Sanitizing protects against malicious
 *  content in files the user opens from disk. */
export function parseMarkdown(md: string): string {
  const cached = parseCache.get(md)
  if (cached !== undefined) return cached
  const html = parseUncached(md)
  // Don't memoize output produced before KaTeX arrived (math shown as source).
  if (!mayContainMath(md) || katex) parseCache.set(md, html)
  return html
}

function parseUncached(md: string): string {
  let html: string
  const source = md ?? ''
  if (source.length > MAX_PARSE_CHARS) {
    html = '<pre>' + escapeHtml(source) + '</pre>'
  } else {
    try {
      html = marked.parse(source, { async: false }) as string
    } catch {
      html = '<pre>' + escapeHtml(source) + '</pre>'
    }
  }
  // Forbid <style> (would restyle the whole reader), form/interactive elements
  // (phishing surface) and media elements; see the hook above for <input>.
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ['target', 'rel'],
    FORBID_TAGS: [
      'style', 'form', 'button', 'textarea', 'select', 'option', 'fieldset', 'label',
      'video', 'audio', 'source', 'track'
    ]
  })
}
