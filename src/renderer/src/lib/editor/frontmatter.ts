// YAML front matter (`---` … `---` at the very top) for the editor's Markdown parser.
// Without it the closing `---` turns the lines above into a bold setext heading. Whether
// the top is front matter is decided once per parse from the raw text, with the reader's
// own rules (lib/markdown/frontMatter.ts), so the editor and the reader always agree.
// When it isn't, nothing is consumed and the lines parse as ordinary Markdown.
import { foldNodeProp, Language, LanguageSupport } from '@codemirror/language'
import { markdown } from '@codemirror/lang-markdown'
import { Parser, type Input, type PartialParse, type SyntaxNode, type Tree, type TreeFragment } from '@lezer/common'
import { Tag, tags as t } from '@lezer/highlight'
import type { BlockContext, Line, MarkdownConfig } from '@lezer/markdown'
import { extractFrontMatter } from '@/lib/markdown/frontMatter'

/** The block's text (muted) and its top-level keys, for editorHighlight. */
export const frontmatterTags = { content: Tag.define(), key: Tag.define(t.propertyName) }

const OPEN = /^---[ \t]*$/
const CLOSE = /^(?:---|\.\.\.)[ \t]*$/
const KEY = /^([^\s#:-][^:]*?|-[^\s:][^:]*?)[ \t]*:(?:[ \t]|$)/
/** The reader looks this far for the closing fence; so do we. */
/** A first line cut off mid-read that could still turn out to be the opening fence. */
const MAY_OPEN = /^(?:-{0,3}|---[ \t]*)$/
const MAX_LINES = 400
const MAX_CHARS = 64 * 1024
const CHUNK = 4096

/** The first lines of `input` the reader would look at for front matter. Stops at the
 *  first line when it can't open a block, so most documents cost one small read. */
export function leadingLines(input: Input): string[] {
  let text = ''
  let whole: string[] = []
  for (let pos = 0; pos < input.length && text.length < MAX_CHARS; ) {
    const chunk = input.read(pos, Math.min(input.length, pos + CHUNK))
    pos += chunk.length
    text += chunk
    // Only complete lines count: a cut-off "---x" must not read as a fence.
    const lines = text.split('\n')
    whole = pos >= input.length ? lines : lines.slice(0, -1)
    if (whole.length ? !OPEN.test(whole[0]) : !MAY_OPEN.test(lines[0])) return []
    if (whole.length > MAX_LINES || whole.slice(1).some((l) => CLOSE.test(l))) break
  }
  return whole
}

/** Lines [0, n) of the document are front matter; null when there is none. */
export function frontmatterLines(input: Input): number | null {
  const lines = leadingLines(input)
  return lines.length ? (extractFrontMatter(lines)?.endLine ?? null) : null
}

// The current parse's answer, set around each step of it (see FrontmatterParse). A plain
// variable is enough: parsing is synchronous, and nested parses restore what they found.
let activeLines: number | null = null

function parseFrontmatter(cx: BlockContext, line: Line): boolean {
  const total = activeLines
  if (total === null || cx.lineStart !== 0 || cx.parentType().name !== 'Document') return false
  const children = [cx.elt('FrontmatterMark', 0, line.text.length)]
  for (let i = 1; i < total && cx.nextLine(); i++) {
    if (i === total - 1) {
      children.push(cx.elt('FrontmatterMark', cx.lineStart, cx.lineStart + line.text.length))
      break
    }
    const key = KEY.exec(line.text)
    if (key) children.push(cx.elt('FrontmatterKey', cx.lineStart, cx.lineStart + key[1].length))
  }
  const end = cx.lineStart + line.text.length
  cx.nextLine()
  cx.addElement(cx.elt('Frontmatter', 0, end, children))
  return true
}

/** Fold the block down to its opening line. */
function foldFrontmatter(node: SyntaxNode): { from: number; to: number } | null {
  const open = node.firstChild
  const close = node.lastChild
  return open && close && close.from - 1 > open.to ? { from: open.to, to: close.from - 1 } : null
}

export const frontmatterSyntax: MarkdownConfig = {
  defineNodes: [
    { name: 'Frontmatter', block: true, style: frontmatterTags.content },
    { name: 'FrontmatterMark', style: t.processingInstruction },
    { name: 'FrontmatterKey', style: frontmatterTags.key }
  ],
  parseBlock: [{ name: 'Frontmatter', parse: parseFrontmatter, before: 'HorizontalRule' }],
  props: [foldNodeProp.add({ Frontmatter: foldFrontmatter })]
}

const hasFrontmatter = (tree: Tree): boolean => tree.topNode.firstChild?.name === 'Frontmatter'

/** Runs the inner parse with its front-matter answer in place. */
class FrontmatterParse implements PartialParse {
  private readonly inner: PartialParse
  private readonly lines: number | null

  constructor(inner: PartialParse, lines: number | null) {
    this.inner = inner
    this.lines = lines
  }

  advance(): Tree | null {
    const outer = activeLines
    activeLines = this.lines
    try {
      return this.inner.advance()
    } finally {
      activeLines = outer
    }
  }

  get parsedPos(): number {
    return this.inner.parsedPos
  }

  get stoppedAt(): number | null {
    return this.inner.stoppedAt
  }

  stopAt(pos: number): void {
    this.inner.stopAt(pos)
  }
}

/** The Markdown parser plus the front-matter decision. When that decision flips (the
 *  closing `---` was just typed, or removed), the old tree's nodes near the top were read
 *  under the other answer, so the parse starts afresh instead of reusing them. */
class FrontmatterParser extends Parser {
  private readonly inner: Parser

  constructor(inner: Parser) {
    super()
    this.inner = inner
  }

  createParse(input: Input, fragments: readonly TreeFragment[], ranges: readonly { from: number; to: number }[]): PartialParse {
    const lines = ranges[0]?.from === 0 ? frontmatterLines(input) : null
    const isFront = lines !== null
    const reuse = fragments.every((f) => hasFrontmatter(f.tree) === isFront) ? fragments : []
    return new FrontmatterParse(this.inner.createParse(input, reuse, ranges), lines)
  }
}

type MarkdownOptions = NonNullable<Parameters<typeof markdown>[0]>

/** lang-markdown's support with front matter added (same language data, keymap and
 *  commands; only the parser is wrapped). */
export function markdownWithFrontmatter(options: MarkdownOptions): LanguageSupport {
  const extensions = options.extensions ? [options.extensions, frontmatterSyntax] : [frontmatterSyntax]
  const base = markdown({ ...options, extensions })
  const language = new Language(base.language.data, new FrontmatterParser(base.language.parser), [], 'markdown')
  return new LanguageSupport(language, base.support)
}
