import type { TokenizerAndRendererExtension, Tokens } from 'marked'
import type katexType from 'katex'
import { escapeHtml } from './escape'

// LaTeX math via KaTeX with our own delimiter rules, tokenized before the inline
// pass so formula characters (_ * \) survive. We roll our own instead of using a
// library's rules because those either mis-nest inline math that's followed by
// punctuation ("$x=1$;") or wrongly treat prose dollar amounts ("$5 for $10") as math.
//  - display  $$...$$  (a block of its own, or inline within a paragraph),
//  - inline   $...$     where the opening $ isn't followed by whitespace, the closing
//    $ isn't preceded by whitespace, and isn't followed by a digit,
//  - ChatGPT/Claude style  \(...\)  inline and  \[...\]  display,
//  - ```math fences (display; see the code renderer in pipeline.ts).
// None of these can fire inside code: code spans and blocks are consumed whole by
// the lexer before it ever reaches their contents, and escaped \\( stays literal.
//
// KaTeX (JS + stylesheet + fonts) is loaded on demand: callers await prepareMarkdown()
// before parsing a document that may contain math.

let katex: typeof katexType | null = null
let katexLoading: Promise<void> | null = null
let katexSettled = false

export function loadKatex(): Promise<void> {
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

export function isKatexSettled(): boolean {
  return katexSettled
}

/** True once KaTeX is usable; part of the parse cache key (math renders as source before). */
export function isKatexReady(): boolean {
  return katex !== null
}

/** Cheap pre-parse check: could this document contain math in any supported syntax? */
export function needsKatex(md: string): boolean {
  return (
    md.includes('$') ||
    md.includes('\\(') ||
    md.includes('\\[') ||
    /^[ \t>]*(?:`{3,}|~{3,})[ \t]*math\b/im.test(md)
  )
}

/** KaTeX HTML for `tex`; the escaped `source` (with its delimiters) when KaTeX is missing. */
export function renderMath(tex: string, displayMode: boolean, source: string): string {
  if (!katex) return escapeHtml(source)
  try {
    // strict 'ignore': unicode text in formulas is fine and must not log warnings.
    return katex.renderToString(tex, {
      displayMode,
      throwOnError: false,
      strict: 'ignore',
      output: 'htmlAndMathml'
    })
  } catch {
    return escapeHtml(source)
  }
}

interface MathToken extends Tokens.Generic {
  text: string
  display: boolean
}

function mathToken(type: string, raw: string, text: string, display: boolean): MathToken {
  return { type, raw, text: text.trim(), display }
}

function renderMathToken(token: Tokens.Generic): string {
  const t = token as MathToken
  return renderMath(t.text, t.display, t.raw)
}

// A blank line ends any math (KaTeX can't use one and it bounds runaway matches).
const NO_BLANK = '(?!\\n[ \\t]*\\n)'

/** `$$…$$` or `\[…\]` filling whole lines: a display block of its own. Recognising it
 *  at block level keeps lines like "- x" or "= y" inside the formula from turning
 *  into lists or setext headings. */
const BLOCK_DOLLAR = new RegExp(`^ {0,3}\\$\\$((?:(?!\\$\\$)${NO_BLANK}[\\s\\S])+?)\\$\\$[ \\t]*(?:\\n|$)`)
const BLOCK_BRACKET = new RegExp(`^ {0,3}\\\\\\[((?:(?!\\\\\\])${NO_BLANK}[\\s\\S])+?)\\\\\\][ \\t]*(?:\\n|$)`)
const BLOCK_CANDIDATE = /\n {0,3}(?:\$\$|\\\[)/g

function matchBlock(src: string): RegExpExecArray | null {
  return BLOCK_DOLLAR.exec(src) ?? BLOCK_BRACKET.exec(src)
}

const blockMath: TokenizerAndRendererExtension = {
  name: 'blockMath',
  level: 'block',
  // Lets a formula directly under a paragraph line start its own block. Only the
  // current paragraph is searched (up to the next blank line), and only positions
  // where the block rule really matches, so other paragraphs are never split.
  start(src: string) {
    const stop = src.search(/\n[ \t]*\n/)
    const region = stop < 0 ? src : src.slice(0, stop)
    BLOCK_CANDIDATE.lastIndex = 0
    for (let m = BLOCK_CANDIDATE.exec(region); m; m = BLOCK_CANDIDATE.exec(region)) {
      const at = m.index + 1
      if (matchBlock(src.slice(at))) return at
    }
    return undefined
  },
  tokenizer(src: string) {
    const m = matchBlock(src)
    if (!m) return undefined
    return mathToken('blockMath', m[0], m[1], true)
  },
  renderer(token) {
    return '<div class="smd-math">' + renderMathToken(token) + '</div>\n'
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
    return mathToken('displayMath', m[0], m[1], true)
  },
  renderer: renderMathToken
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
    return mathToken('inlineMath', m[0], m[1], false)
  },
  renderer: renderMathToken
}

const PAREN = new RegExp(`^\\\\\\(((?:${NO_BLANK}[\\s\\S])+?)\\\\\\)`)
const BRACKET = new RegExp(`^\\\\\\[((?:${NO_BLANK}[\\s\\S])+?)\\\\\\]`)

/** Inline `\[…\]` inside a sentence is also how Markdown escapes brackets
 *  ("array\[0\]"), so only treat it as math when it looks like a formula. */
function looksLikeFormula(text: string): boolean {
  return /^\s|\s$/.test(text) || /[\\^_={}+<>]/.test(text)
}

function backslashStart(src: string, open: string): number | undefined {
  const i = src.indexOf('\\' + open)
  return i < 0 ? undefined : i
}

const parenMath: TokenizerAndRendererExtension = {
  name: 'parenMath',
  level: 'inline',
  start: (src: string) => backslashStart(src, '('),
  tokenizer(src: string) {
    const m = PAREN.exec(src)
    if (!m || m[1].includes('`')) return undefined
    return mathToken('parenMath', m[0], m[1], false)
  },
  renderer: renderMathToken
}

const bracketMath: TokenizerAndRendererExtension = {
  name: 'bracketMath',
  level: 'inline',
  start: (src: string) => backslashStart(src, '['),
  tokenizer(src: string) {
    const m = BRACKET.exec(src)
    if (!m || m[1].includes('`') || !looksLikeFormula(m[1])) return undefined
    return mathToken('bracketMath', m[0], m[1], true)
  },
  renderer: renderMathToken
}

export const mathExtensions: TokenizerAndRendererExtension[] = [
  blockMath,
  displayMath,
  inlineMath,
  parenMath,
  bracketMath
]

/** A ```math fence body as display math. */
export function renderMathFence(text: string): string {
  // Without KaTeX the formula reads best as the code block it was written as.
  if (!katex) return '<pre><code class="language-math">' + escapeHtml(text) + '</code></pre>\n'
  return '<div class="smd-math">' + renderMath(text.trim(), true, text) + '</div>\n'
}
