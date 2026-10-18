// YAML front matter (`---` … `---` at the very top) for the editor's Markdown parser.
// Without it the closing `---` turns the lines above into a bold setext heading. The
// rules match the reader's (lib/markdown/frontMatter.ts): the block must close and its
// lines must look like YAML, otherwise the first `---` is an ordinary thematic break.
import { foldNodeProp } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'
import { Tag, tags as t } from '@lezer/highlight'
import type { BlockContext, Element, Line, MarkdownConfig } from '@lezer/markdown'

/** The block's text (muted) and its top-level keys, for editorHighlight. */
export const frontmatterTags = { content: Tag.define(), key: Tag.define(t.propertyName) }

const OPEN = /^---[ \t]*$/
const CLOSE = /^(?:---|\.\.\.)[ \t]*$/
const KEY = /^([^\s#:-][^:]*?|-[^\s:][^:]*?)[ \t]*:(?:[ \t]|$)/
const LIST_ITEM = /^[ \t]*-(?:[ \t]|$)/
const MAX_LINES = 400

const skippable = (text: string): boolean => !text.trim() || /^[ \t]*#/.test(text)
const yamlLine = (text: string): boolean => skippable(text) || KEY.test(text) || /^[ \t]+\S/.test(text) || LIST_ITEM.test(text)

/** Elements for one consumed line inside the block: its key, if it has one. */
function keyOf(cx: BlockContext, start: number, text: string): Element[] {
  const key = KEY.exec(text)
  return key ? [cx.elt('FrontmatterKey', start, start + key[1].length)] : []
}

interface ConsumedLine {
  readonly start: number
  readonly text: string
}

/** Runs of adjacent non-blank lines: each one is a paragraph. */
function paragraphs(lines: readonly ConsumedLine[]): ConsumedLine[][] {
  return lines.reduce<ConsumedLine[][]>((runs, l) => {
    if (!l.text.trim()) return [...runs, []]
    const last = runs[runs.length - 1] ?? []
    return [...runs.slice(0, -1), [...last, l]]
  }, [[]]).filter((run) => run.length > 0)
}

/** Not front matter after all: the `---` is a thematic break, the lines after it paragraphs. */
function fallBack(cx: BlockContext, open: number, lines: readonly ConsumedLine[]): void {
  cx.addElement(cx.elt('HorizontalRule', 0, open))
  for (const run of paragraphs(lines)) {
    const from = run[0].start
    const content = run.map((l) => l.text).join('\n')
    cx.addElement(cx.elt('Paragraph', from, from + content.length, cx.parser.parseInline(content, from)))
  }
}

function parseFrontmatter(cx: BlockContext, line: Line): boolean {
  if (cx.lineStart !== 0 || cx.parentType().name !== 'Document' || !OPEN.test(line.text)) return false
  const open = line.text.length
  const children: Element[] = [cx.elt('FrontmatterMark', 0, open)]
  const lines: ConsumedLine[] = []
  let sawKey = false
  // Only the next line can be peeked, so walk forward while it still looks like YAML.
  while (lines.length < MAX_LINES) {
    const next = cx.peekLine()
    if (CLOSE.test(next) && cx.nextLine()) {
      const end = cx.lineStart + line.text.length
      children.push(cx.elt('FrontmatterMark', cx.lineStart, end))
      cx.nextLine()
      cx.addElement(cx.elt('Frontmatter', 0, end, children))
      return true
    }
    // The first real line must be a key, as in the reader; two rules aren't front matter.
    const fits = yamlLine(next) && (sawKey || skippable(next) || KEY.test(next))
    if (!fits) break
    if (!cx.nextLine()) {
      fallBack(cx, open, lines)
      return true
    }
    sawKey = sawKey || KEY.test(line.text)
    lines.push({ start: cx.lineStart, text: line.text })
    children.push(...keyOf(cx, cx.lineStart, line.text))
  }
  // A block parser must move past what it read: the `---` and any lines after it.
  cx.nextLine()
  fallBack(cx, open, lines)
  return true
}

/** Fold the block down to its opening line. */
function foldFrontmatter(node: SyntaxNode): { from: number; to: number } | null {
  const open = node.firstChild
  const close = node.lastChild
  return open && close && close.from - 1 > open.to ? { from: open.to, to: close.from - 1 } : null
}

export const frontmatter: MarkdownConfig = {
  defineNodes: [
    { name: 'Frontmatter', block: true, style: frontmatterTags.content },
    { name: 'FrontmatterMark', style: t.processingInstruction },
    { name: 'FrontmatterKey', style: frontmatterTags.key }
  ],
  parseBlock: [{ name: 'Frontmatter', parse: parseFrontmatter, before: 'HorizontalRule' }],
  props: [foldNodeProp.add({ Frontmatter: foldFrontmatter })]
}
