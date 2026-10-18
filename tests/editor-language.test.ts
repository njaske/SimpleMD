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
    extensions: [md.markdown({ base: md.markdownLanguage, extensions: front.frontmatter })]
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
  const names = (source: string): string[] => {
    const s = state(source)
    const tree = lang.ensureSyntaxTree(s, s.doc.length, 5000)
    assert.ok(tree)
    const found: string[] = []
    tree.iterate({ enter: (n) => void found.push(n.name) })
    return found
  }

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
