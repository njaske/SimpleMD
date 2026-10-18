import './support/aliases.ts'
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { Window } from 'happy-dom'

// Smart paste parses HTML with DOMPurify, which binds to `window` when first imported.
const win = new Window()
Object.assign(globalThis, {
  window: win,
  document: win.document,
  Node: win.Node,
  Element: win.Element,
  HTMLElement: win.HTMLElement,
  DOMParser: win.DOMParser
})

type Paste = typeof import('../src/renderer/src/lib/editor/paste.ts')
type Setup = typeof import('../src/renderer/src/lib/editor/setup.ts')
type Front = typeof import('../src/renderer/src/lib/editor/frontmatter.ts')
type State = typeof import('@codemirror/state')
type Md = typeof import('@codemirror/lang-markdown')
type Lang = typeof import('@codemirror/language')
type Commands = typeof import('@codemirror/commands')
let paste: Paste
let setup: Setup
let front: Front
let cmState: State
let md: Md
let lang: Lang
let commands: Commands

before(async () => {
  paste = await import('../src/renderer/src/lib/editor/paste.ts')
  setup = await import('../src/renderer/src/lib/editor/setup.ts')
  front = await import('../src/renderer/src/lib/editor/frontmatter.ts')
  cmState = await import('@codemirror/state')
  md = await import('@codemirror/lang-markdown')
  lang = await import('@codemirror/language')
  commands = await import('@codemirror/commands')
})

after(() => win.close())

/** A Markdown state with `|` marking the cursor (or `[` and `]` a selection). */
function state(source: string) {
  const anchor = source.includes('[') ? source.indexOf('[') : source.indexOf('|')
  const doc = source.replace(/[[\]|]/g, '')
  const head = source.includes(']') ? source.indexOf(']') - 1 : anchor
  return cmState.EditorState.create({
    doc,
    selection: { anchor, head },
    extensions: [front.markdownWithFrontmatter({ base: md.markdownLanguage })]
  })
}

const clip = (text: string, html = '') => ({ getData: (f: string) => (f === 'text/plain' ? text : f === 'text/html' ? html : '') })

describe('planPaste', () => {
  it('wraps the selection in a link when a URL is pasted over it', () => {
    const plan = paste.planPaste(state('see [the docs] now'), clip('https://a.dev'))
    assert.equal(plan?.kind, 'link')
  })

  it('puts a table pasted mid-line on its own lines below the paragraph', () => {
    // Arrange
    const s = state('Some te|xt here')
    // Act
    const plan = paste.planPaste(s, clip('a\tb\n1\t2\n'))
    // Assert
    assert.equal(plan?.kind, 'block')
    assert.ok(plan?.kind === 'block' && plan.edit.changes[0].insert.startsWith('\n\n| a'))
  })

  it('pastes converted rich text inline inside a paragraph', () => {
    const plan = paste.planPaste(state('Say |now'), clip('hello', '<b>hello</b>'))
    assert.deepEqual(plan, { kind: 'inline', text: '**hello**' })
  })

  it('leaves plain text to CodeMirror', () => {
    assert.equal(paste.planPaste(state('a|'), clip('just words')), null)
  })

  it('leaves pastes inside a fenced code block exactly as copied', () => {
    const plan = paste.planPaste(state('```js\nconst a = |\n```'), clip('a\tb\n1\t2', '<b>x</b>'))
    assert.equal(plan, null)
  })
})

describe('front matter', () => {
  type EditorState = import('@codemirror/state').EditorState
  const namesIn = (s: EditorState): string[] => {
    const tree = lang.ensureSyntaxTree(s, s.doc.length, 5000)
    assert.ok(tree)
    const found: string[] = []
    tree.iterate({ enter: (n) => void found.push(n.name) })
    return found
  }
  const names = (source: string): string[] => namesIn(state(source))
  /** Type `text` at `pos` one character at a time, parsing after each (as the editor does). */
  const typeAt = (s: EditorState, pos: number, text: string): EditorState =>
    Array.from(text).reduce((acc, ch, i) => {
      const next = acc.update({ changes: { from: pos + i, insert: ch } }).state
      lang.ensureSyntaxTree(next, next.doc.length, 5000)
      return next
    }, s)

  it('reads leading YAML as front matter, not a setext heading', () => {
    const found = names('---\ntitle: Notes\ntags: [a, b]\n---\n\n# Body')
    assert.ok(found.includes('Frontmatter'))
    assert.equal(found.filter((n) => n === 'FrontmatterKey').length, 2)
    assert.ok(!found.includes('SetextHeading2'))
    assert.ok(found.includes('ATXHeading1'))
  })

  it('keeps a rule followed by prose a thematic break and paragraph', () => {
    const found = names('---\nJust a paragraph here.\n')
    assert.ok(!found.includes('Frontmatter'))
    assert.ok(found.includes('HorizontalRule'))
    assert.ok(found.includes('Paragraph'))
  })

  it('does not swallow the document when the block never closes', () => {
    const found = names('---\ntitle: draft\n\n**bold** text')
    assert.ok(!found.includes('Frontmatter'))
    assert.ok(found.includes('HorizontalRule'))
    assert.ok(found.includes('StrongEmphasis'))
  })

  it('keeps a heading after a lone rule a heading', () => {
    // Arrange / Act
    const found = names('---\n\n# Title after a rule\n\ntext')
    // Assert
    assert.ok(!found.includes('Frontmatter'))
    assert.ok(found.includes('HorizontalRule'))
    assert.ok(found.includes('ATXHeading1'))
  })

  it('leaves the lines under an unclosed block as ordinary Markdown', () => {
    const found = names('---\ntitle: x\n\n# Body\n\n    code\n')
    assert.ok(!found.includes('Frontmatter'))
    assert.ok(found.includes('ATXHeading1'))
    assert.ok(found.includes('CodeBlock'))
  })

  it('allows YAML comments inside the block, as the reader does', () => {
    const found = names('---\n# a note\ntitle: x\n---\ntext')
    assert.ok(found.includes('Frontmatter'))
    assert.ok(!found.includes('ATXHeading1'))
  })

  it('restyles the document as the closing fence is typed, and back when it goes', () => {
    // Arrange: front matter typed top-down, not closed yet. Long enough that the parser
    // would happily reuse the old top-of-document nodes if it were allowed to.
    const keys = Array.from({ length: 30 }, (_, i) => `key${i}: value ${i}`).join('\n')
    const draft = state(`---\n${keys}\n\n# Body\n\nMore **text**`)
    assert.ok(!namesIn(draft).includes('Frontmatter'))
    const at = draft.doc.line(32).from
    // Act
    const closed = typeAt(draft, at, '---')
    // Assert: the block is front matter and the heading below it is still a heading.
    const found = namesIn(closed)
    assert.ok(found.includes('Frontmatter'))
    assert.ok(found.includes('ATXHeading1'))
    assert.ok(found.includes('StrongEmphasis'))
    assert.ok(!found.includes('SetextHeading2'))
    // Act: delete the fence again.
    const reopened = closed.update({ changes: { from: at, to: at + 3 } }).state
    const after = namesIn(reopened)
    assert.ok(!after.includes('Frontmatter'))
    assert.ok(after.includes('HorizontalRule'))
    assert.ok(after.includes('ATXHeading1'))
  })

  it('keeps front matter through edits further down', () => {
    const s = state('---\ntitle: x\n---\n\n# Body\n')
    const edited = typeAt(s, s.doc.length, 'more words')
    const found = namesIn(edited)
    assert.equal(found.filter((n) => n === 'Frontmatter').length, 1)
    assert.ok(found.includes('ATXHeading1'))
  })

  it('reads only the first line of a document that cannot open a block', () => {
    const reads: number[] = []
    const text = 'x'.repeat(50_000)
    const input = { length: text.length, lineChunks: false, chunk: (p: number) => text.slice(p), read: (from: number, to: number) => (reads.push(to - from), text.slice(from, to)) }
    assert.equal(front.frontmatterLines(input), null)
    assert.equal(reads.length, 1)
  })

  it('only counts at the very start of the document', () => {
    const found = names('Intro\n\n---\ntitle: x\n---\n')
    assert.ok(!found.includes('Frontmatter'))
  })

  it('folds down to its opening line', () => {
    const s = state('---\ntitle: Notes\nauthor: me\n---\ntext')
    lang.ensureSyntaxTree(s, s.doc.length, 5000)
    assert.deepEqual(lang.foldable(s, 0, 3), { from: 3, to: 27 })
  })
})

describe('editor key bindings', () => {
  it('drops the defaults the app owns or Markdown has no use for', () => {
    const runs = new Set(setup.appDefaultKeymap.map((b) => b.run))
    assert.equal(runs.has(commands.toggleComment), false)
    assert.equal(runs.has(commands.toggleBlockComment), false)
    assert.equal(runs.has(commands.selectParentSyntax), false)
    assert.equal(runs.has(commands.cursorLineBoundaryBackward) || runs.has(commands.cursorCharLeft), true)
  })
})
