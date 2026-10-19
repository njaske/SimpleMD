import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseHtml, setupRenderEnv } from './render-env.ts'

setupRenderEnv()
const { renderMarkdown } = await import('../src/renderer/src/lib/markdown.ts')
const { extractFrontMatter } = await import('../src/renderer/src/lib/markdown/frontMatter.ts')
const { calloutKind } = await import('../src/renderer/src/lib/markdown/callouts.ts')
const { tidyTables, NOWRAP_CLASS } = await import('../src/renderer/src/lib/reader/tables.ts')

function body(md: string): HTMLElement {
  return parseHtml(renderMarkdown(md).html)
}

describe('callouts', () => {
  it('renders the five GitHub alerts with icon, default title and hue', () => {
    // Arrange
    const types = ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION']
    const md = types.map((t) => `> [!${t}]\n> Body of ${t}.`).join('\n\n')
    // Act
    const callouts = Array.from(body(md).querySelectorAll('.smd-callout'))
    // Assert
    assert.deepEqual(callouts.map((c) => c.getAttribute('data-hue')), ['note', 'tip', 'important', 'warning', 'caution'])
    assert.deepEqual(callouts.map((c) => c.querySelector('.smd-callout-label')?.textContent), [
      'Note', 'Tip', 'Important', 'Warning', 'Caution'
    ])
    assert.ok(callouts.every((c) => c.querySelector('svg.smd-callout-icon')))
    assert.equal(callouts[0].querySelector('.smd-callout-body p')?.textContent, 'Body of NOTE.')
  })

  it('supports Obsidian custom titles with inline Markdown', () => {
    const c = body('> [!info] Read *this* first\n> Details.').querySelector('.smd-callout')
    assert.equal(c?.getAttribute('data-callout'), 'info')
    assert.equal(c?.querySelector('.smd-callout-label em')?.textContent, 'this')
  })

  it('renders foldable callouts as details, collapsed with - and open with +', () => {
    const doc = body('> [!faq]- Closed one\n> Hidden body\n\n> [!tip]+ Open one\n> Shown body')
    const [closed, open] = Array.from(doc.querySelectorAll('details.smd-callout'))
    assert.equal(closed.hasAttribute('open'), false)
    assert.equal(open.hasAttribute('open'), true)
    assert.equal(closed.querySelector('summary .smd-callout-label')?.textContent, 'Closed one')
    assert.ok(closed.querySelector('summary .smd-callout-chevron'))
  })

  it('falls back to the note style for unknown types', () => {
    const c = body('> [!sparkles]\n> Text').querySelector('.smd-callout')
    assert.equal(c?.getAttribute('data-hue'), 'note')
    assert.equal(c?.querySelector('.smd-callout-label')?.textContent, 'Sparkles')
    assert.equal(calloutKind('BUG').hue, 'caution')
  })

  it('lexes the body as Markdown, including lists, code and reference links', () => {
    const md = '> [!NOTE]\n> - one\n> - two\n>\n> See [docs][d].\n\n[d]: https://example.com/docs'
    const c = body(md).querySelector('.smd-callout')
    assert.equal(c?.querySelectorAll('li').length, 2)
    assert.equal(c?.querySelector('a')?.getAttribute('href'), 'https://example.com/docs')
  })

  it('leaves ordinary blockquotes alone', () => {
    const doc = body('> Just a quote [!NOTE] in the middle.')
    assert.equal(doc.querySelectorAll('.smd-callout').length, 0)
    assert.equal(doc.querySelectorAll('blockquote').length, 1)
  })
})

describe('footnotes', () => {
  it('links references to a Footnotes section with back-links', () => {
    // Arrange
    const md = 'A claim.[^1] Another.[^note]\n\n[^1]: First source.\n[^note]: Second source.'
    // Act
    const doc = body(md)
    // Assert
    const refs = Array.from(doc.querySelectorAll('a[data-footnote-ref]'))
    assert.deepEqual(refs.map((a) => a.getAttribute('href')), ['#footnote-1', '#footnote-note'])
    const section = doc.querySelector('section.smd-footnotes')
    assert.equal(section?.querySelector('.smd-footnotes-title')?.textContent, 'Footnotes')
    assert.equal(section?.querySelectorAll('li').length, 2)
    assert.equal(doc.querySelector('#footnote-1 a[data-footnote-backref]')?.getAttribute('href'), '#footnote-ref-1')
  })

  it('starts fresh for every document', () => {
    renderMarkdown('One.[^a]\n\n[^a]: Note a.')
    const doc = body('Two.[^b]\n\n[^b]: Note b.')
    assert.deepEqual(Array.from(doc.querySelectorAll('.smd-footnotes li'), (li) => li.id), ['footnote-b'])
  })

  it('renders nothing extra for a document without footnotes', () => {
    const html = renderMarkdown('No notes here, just the word Footnotes.').html
    assert.doesNotMatch(html, /smd-footnotes/)
  })
})

describe('front matter', () => {
  it('shows leading YAML as a properties card instead of a heading', () => {
    // Arrange
    const md = '---\ntitle: "Hello: world"\ntags: [a, "b, c"]\nauthors:\n  - Ann\n  - Bo\ndraft: false\n---\n\n# Body'
    // Act
    const doc = body(md)
    // Assert
    const rows = Array.from(doc.querySelectorAll('.smd-fm-row'), (row) => [
      row.querySelector('dt')?.textContent,
      Array.from(row.querySelectorAll('.smd-fm-chip'), (c) => c.textContent).join('|') || row.querySelector('dd')?.textContent
    ])
    assert.deepEqual(rows, [['title', 'Hello: world'], ['tags', 'a|b, c'], ['authors', 'Ann|Bo'], ['draft', 'false']])
    assert.equal(doc.querySelectorAll('h1').length, 1)
    assert.equal(doc.querySelectorAll('h2, hr').length, 0)
  })

  it('keeps long values whole in the title attribute', () => {
    const long = 'x'.repeat(400)
    const dd = body(`---\nnote: ${long}\n---\n`).querySelector('.smd-fm-value')
    assert.equal(dd?.getAttribute('title'), long)
    assert.ok((dd?.textContent ?? '').length < 300)
  })

  it('parses block scalars and ignores comments', () => {
    const fm = extractFrontMatter(['---', '# comment', 'summary: |', '  line one', '  line two', '---', 'text'])
    assert.deepEqual(fm, { entries: [{ key: 'summary', value: 'line one\nline two' }], endLine: 6 })
  })

  it('ignores a document that merely starts with a horizontal rule', () => {
    assert.equal(extractFrontMatter(['---', 'Just some prose here.', '---']), null)
    assert.equal(extractFrontMatter(['---', 'title: never closed']), null)
    assert.equal(extractFrontMatter(['text', '---']), null)
  })

  it('escapes values', () => {
    const doc = body('---\ntitle: <img src=x onerror=alert(1)>\n---\n')
    assert.equal(doc.querySelectorAll('img').length, 0)
    assert.equal(doc.querySelector('.smd-fm-value')?.textContent, '<img src=x onerror=alert(1)>')
  })
})

describe('tables', () => {
  it('keeps short row labels and hyphenated words on one line, but lets prose wrap', () => {
    // Arrange
    const md = [
      '| Strategy | How it works | Notes |',
      '|---|---|---|',
      '| Write-through | Writes go to the cache and the store at the same time, so reads stay fresh. | read-your-writes |',
      '| A rather long first column label that should wrap | x | two words |'
    ].join('\n')
    const doc = body(md)
    // Act
    tidyTables(doc)
    // Assert
    const rows = Array.from(doc.querySelectorAll('tr'), (tr) => Array.from(tr.children, (c) => c.classList.contains(NOWRAP_CLASS)))
    assert.deepEqual(rows, [
      [true, false, false],
      [true, false, true],
      [false, false, false]
    ])
  })
})
