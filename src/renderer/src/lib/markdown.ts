import { marked, type Tokens, type TokenizerAndRendererExtension } from 'marked'
import DOMPurify from 'dompurify'
import katex from 'katex'
import 'katex/dist/katex.min.css'

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
function renderMath(tex: string, displayMode: boolean): string {
  try {
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

/** Parse Markdown to sanitized HTML. Sanitizing protects against malicious
 *  content in files the user opens from disk. */
export function parseMarkdown(md: string): string {
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
