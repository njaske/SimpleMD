import { Marked, type Token, type Tokens, type TokensList } from 'marked'
import { calloutExtension } from './callouts'
import { alignFootnotes, footnoteExtension, type ChunkFootnotes } from './footnotes'
import { extractFrontMatter, renderFrontMatter } from './frontMatter'
import { mathExtensions, renderMathFence } from './math'
import { repairMarkdown } from './repairs'
import { assignSpans, tokenSpans, withLineAttrs, type LineMapper } from './sourceMap'

// Markdown source -> unsanitized HTML with source line attributes. The steps:
// front matter -> display repairs -> lex (+ footnote walk) -> line spans -> render
// each top-level block on its own so its first element can carry data-line.

/** Marks a task checkbox until its list item renderer knows the source line. */
const TASK_PLACEHOLDER = 'data-smd-task=""'

// Attribute names the renderer owns. Raw HTML in a document can't forge them (a fake
// data-task-line would make an author-written checkbox toggle a line). Only a name
// followed by `=` is rewritten: without a value the attribute is harmless, and prose
// inside an HTML block ("set the data-line attribute") keeps its words.
const OWN_ATTRS = /\bdata-(task-line|smd-task|line-end|line)(?=\s*=)/gi

function createMarked(): Marked {
  return new Marked({ gfm: true, breaks: false })
    .use(footnoteExtension())
    .use({ extensions: [calloutExtension, ...mathExtensions] })
    .use({
      renderer: {
        code(token: Tokens.Code) {
          return (token.lang || '').trim().toLowerCase() === 'math' ? renderMathFence(token.text) : false
        },
        checkbox({ checked }: Tokens.Checkbox) {
          return `<input type="checkbox" ${TASK_PLACEHOLDER}${checked ? ' checked=""' : ''}> `
        },
        listitem(item: Tokens.ListItem) {
          const span = tokenSpans.get(item)
          let inner = this.parser.parse(item.tokens)
          // Nested items rendered first and already claimed their placeholders, so the
          // first one left in this item is its own checkbox.
          if (item.task && span) inner = inner.replace(TASK_PLACEHOLDER, `data-task-line="${span.start}"`)
          const lines = span ? ` data-line="${span.start}" data-line-end="${span.end}"` : ''
          const cls = item.task ? ' class="smd-task-item"' : ''
          return `<li${cls}${lines}>${inner}</li>\n`
        },
        html(token: Tokens.HTML | Tokens.Tag) {
          return token.text.replace(OWN_ATTRS, 'data-x-$1')
        }
      }
    })
}

let marked: Marked | null = null

function getMarked(): Marked {
  if (!marked) marked = createMarked()
  return marked
}

function lex(src: string): TokensList {
  const md = getMarked()
  try {
    const tokens = md.lexer(src)
    // marked.parse() would run this; marked-footnote moves its section to the end here.
    const walk = md.defaults.walkTokens
    if (walk) md.walkTokens(tokens, walk)
    return tokens
  } catch (err) {
    // A throw mid-lex can leave extension state (footnotes) half-built: start fresh.
    marked = null
    throw err
  }
}

function walkTokens(tokens: Token[], visit: (token: Token) => void): void {
  getMarked().walkTokens(tokens, visit)
}

function renderBlocks(tokens: readonly Token[]): string {
  const md = getMarked()
  let html = ''
  for (const token of tokens) {
    const out = md.parser([token])
    if (!out) continue
    const span = tokenSpans.get(token)
    html += span ? withLineAttrs(out, span) : out
  }
  // Checkboxes the mapper couldn't place stay disabled (see sanitize.ts).
  return html.split(TASK_PLACEHOLDER).join('')
}

export interface SourceOptions {
  /** Added to every source line (progressive chunks after the first). */
  lineOffset: number
  /** Recognise leading front matter (only the first chunk of a document can have it). */
  frontMatter: boolean
  /** Extra Markdown parsed after the text but not mapped (shared reference links and
   *  footnote definitions). */
  appendix: string
  /** Progressive chunks: footnote numbering of the whole document. */
  footnotes?: ChunkFootnotes | null
}

export interface SourceResult {
  html: string
  fixes: string[]
}

/** Render Markdown to (unsanitized) HTML. May throw on pathological input. */
export function renderSource(md: string, opts: SourceOptions): SourceResult {
  const lines = md.replace(/\r\n?/g, '\n').split('\n')
  const fm = opts.frontMatter ? extractFrontMatter(lines) : null
  // Blank the front matter out instead of removing it, so line numbers stay put.
  const body = fm ? lines.map((line, i) => (i < fm.endLine ? '' : line)) : lines
  const repaired = repairMarkdown(body)
  const src = repaired.lines.join('\n') + (opts.appendix ? '\n\n' + opts.appendix + '\n' : '')
  const lastLine = repaired.map.length - 1
  const toOriginal: LineMapper = (line) => repaired.map[Math.max(0, Math.min(line, lastLine))] + opts.lineOffset
  const lexed = lex(src)
  const tokens = opts.footnotes ? alignFootnotes(lexed, opts.footnotes, walkTokens) : lexed
  assignSpans(tokens, src, toOriginal)
  const card = fm ? renderFrontMatter(fm, opts.lineOffset) : ''
  return { html: card + renderBlocks(tokens), fixes: repaired.fixes }
}
