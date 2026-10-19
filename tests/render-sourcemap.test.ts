import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseHtml, setupRenderEnv } from './render-env.ts'

setupRenderEnv()
const { renderMarkdown, planProgressive, isLargeDocument, headingLines } = await import(
  '../src/renderer/src/lib/markdown.ts'
)
const { splitForProgressive, collectRefDefs } = await import('../src/renderer/src/lib/markdown/progressive.ts')
const { lineAtOffset, offsetOfLine } = await import('../src/renderer/src/lib/reader/anchors.ts')

/** [tag, data-line, data-line-end] of every top-level block. */
function blocks(md: string): Array<[string, number, number]> {
  const doc = parseHtml(renderMarkdown(md).html)
  return Array.from(doc.children, (el) => [
    el.tagName.toLowerCase(),
    Number(el.getAttribute('data-line')),
    Number(el.getAttribute('data-line-end'))
  ])
}

describe('source line mapping', () => {
  it('tags each top-level block with its 0-based start and exclusive end line', () => {
    // Arrange
    const md = '# Title\n\nFirst paragraph\nstill first.\n\n- a\n- b\n\n```js\ncode\n```\n\n| a | b |\n| - | - |\n| 1 | 2 |'
    // Act
    const out = blocks(md)
    // Assert
    assert.deepEqual(out, [
      ['h1', 0, 1],
      ['p', 2, 4],
      ['ul', 5, 7],
      ['pre', 8, 11],
      ['table', 12, 15]
    ])
  })

  it('stays exact after front matter, footnote definitions, reference links and HTML blocks', () => {
    const md = [
      '---', 'title: T', '---', '', // 0-3
      'Intro[^1] with [a link][x].', '', // 4-5
      '[^1]: The note.', '', // 6-7
      '[x]: https://example.com', '', // 8-9
      '<div class="box">', 'raw html', '</div>', '', // 10-13
      '## After' // 14
    ].join('\n')
    const out = blocks(md)
    assert.deepEqual(out.slice(0, 4), [
      ['div', 0, 3],
      ['p', 4, 5],
      ['div', 10, 13],
      ['h2', 14, 15]
    ])
    assert.equal(out[4][0], 'section') // the collected footnotes carry no line
  })

  it('maps lines through display repairs (an inserted table divider)', () => {
    const md = 'Intro\n\n| a | b |\n| 1 | 2 |\n\nAfter'
    assert.deepEqual(blocks(md), [
      ['p', 0, 1],
      ['table', 2, 4],
      ['p', 5, 6]
    ])
  })

  it('offsets every line for a progressive chunk', () => {
    const doc = parseHtml(renderMarkdown('# A\n\ntext', { lineOffset: 100, frontMatter: false, chunk: true }).html)
    assert.deepEqual(Array.from(doc.children, (el) => el.getAttribute('data-line')), ['100', '102'])
  })

  it('tags list items, nested ones included, and blocks inside callouts keep their lines', () => {
    const md = '- one\n- two\n  - nested\n\n> [!NOTE]\n> First\n>\n> Second'
    const doc = parseHtml(renderMarkdown(md).html)
    assert.deepEqual(Array.from(doc.querySelectorAll('li'), (li) => li.getAttribute('data-line')), ['0', '1', '2'])
    assert.deepEqual(blocks(md).map((b) => b.slice(1)), [[0, 3], [4, 8]])
  })
})

describe('task checkboxes', () => {
  it('carry the source line of their item, also when nested, numbered or in a callout', () => {
    // Arrange
    const md = [
      '- [ ] first', // 0
      '- [x] second', // 1
      '  - [ ] nested', // 2
      '', // 3
      '1. [ ] numbered', // 4
      '', // 5
      '```', '- [ ] not a task', '```', '', // 6-9
      '> [!TIP]', '> - [x] in a callout' // 10-11
    ].join('\n')
    // Act
    const boxes = Array.from(parseHtml(renderMarkdown(md).html).querySelectorAll('input'))
    // Assert
    assert.deepEqual(boxes.map((b) => b.getAttribute('data-task-line')), ['0', '1', '2', '4', '11'])
    assert.deepEqual(boxes.map((b) => b.hasAttribute('checked')), [false, true, false, false, true])
    assert.ok(boxes.every((b) => !b.hasAttribute('disabled') && b.classList.contains('smd-task')))
  })

  it('maps nested tasks under an unchecked parent (bullets, stars, numbers, callouts)', () => {
    const lines = (md: string): Array<string | null> =>
      Array.from(parseHtml(renderMarkdown(md).html).querySelectorAll('input'), (b) => b.getAttribute('data-task-line'))
    const items = (md: string): Array<string | null> =>
      Array.from(parseHtml(renderMarkdown(md).html).querySelectorAll('li'), (li) => li.getAttribute('data-line'))
    assert.deepEqual(lines('- [ ] a\n  - [ ] b\n- [ ] c'), ['0', '1', '2'])
    assert.deepEqual(items('- [ ] a\n  - [ ] b\n- [ ] c'), ['0', '1', '2'])
    assert.deepEqual(lines('* [ ] a\n  * [ ] b\n    * [ ] c'), ['0', '1', '2'])
    assert.deepEqual(lines('1. [ ] c\n   1. [ ] d\n2. [ ] e'), ['0', '1', '2'])
    assert.deepEqual(lines('> [!TODO]\n> - [ ] p\n>   - [ ] q'), ['1', '2'])
    assert.deepEqual(lines('- [ ] p\n\n  Body text.\n\n  - [ ] r'), ['0', '4'])
  })

  it('works in loose lists too', () => {
    const boxes = parseHtml(renderMarkdown('- [ ] a\n\n- [x] b').html).querySelectorAll('input')
    assert.deepEqual(Array.from(boxes, (b) => b.getAttribute('data-task-line')), ['0', '2'])
  })
})

describe('heading lines', () => {
  it('lists ATX headings outside fences, matching the outline scan', () => {
    assert.deepEqual(headingLines('# A\n```\n# no\n```\ntext\n## B\nSetext\n---'), [0, 5])
  })
})

describe('anchors', () => {
  const anchors = [
    { top: 100, height: 50, start: 2, end: 4 },
    { top: 200, height: 100, start: 6, end: 10 }
  ]

  it('interpolates inside blocks and across the gaps between them', () => {
    assert.equal(lineAtOffset(anchors, 0), 0)
    assert.equal(lineAtOffset(anchors, 50), 1)
    assert.equal(lineAtOffset(anchors, 125), 3)
    assert.equal(lineAtOffset(anchors, 175), 5)
    assert.equal(lineAtOffset(anchors, 250), 8)
    assert.equal(lineAtOffset(anchors, 999), 10)
    assert.equal(lineAtOffset([], 10), null)
  })

  it('maps lines back to offsets (the inverse)', () => {
    for (const y of [0, 50, 125, 175, 250]) {
      const line = lineAtOffset(anchors, y) ?? -1
      assert.ok(Math.abs((offsetOfLine(anchors, line) ?? -1) - y) < 1e-9, `round trip at ${y}`)
    }
    assert.equal(offsetOfLine(anchors, 50), 300)
  })

  it('maps line 0 to the very top when the document starts with a block on line 0', () => {
    // Arrange: the article's top padding puts the first block 36px down.
    const fromTop = [
      { top: 36, height: 64, start: 0, end: 4 },
      { top: 140, height: 40, start: 5, end: 7 }
    ]

    // Act + Assert: line 0 is scroll 0 (not the block's top), and the mapping
    // stays continuous and invertible across the padded block.
    assert.equal(offsetOfLine(fromTop, 0), 0)
    assert.equal(lineAtOffset(fromTop, 0), 0)
    assert.equal(offsetOfLine(fromTop, 2), 50)
    assert.equal(offsetOfLine(fromTop, 5), 140)
    for (const y of [0, 20, 60, 120, 150]) {
      const line = lineAtOffset(fromTop, y) ?? -1
      assert.ok(Math.abs((offsetOfLine(fromTop, line) ?? -1) - y) < 1e-9, `round trip at ${y}`)
    }
  })
})

describe('progressive rendering plan', () => {
  it('splits only at blank lines outside fences and math, keeping every line', () => {
    // Arrange: ~1.5 MB of sections, each with a fence and a display formula
    const section = (i: number): string =>
      `## Section ${i}\n\n${'Words and more words. '.repeat(40)}\n\n\`\`\`\nline one\n\nline after a blank\n\`\`\`\n\n$$\nx = ${i}\n$$\n\n- a\n\n- b\n`
    const md = Array.from({ length: 1500 }, (_, i) => section(i)).join('\n')
    // Act
    const chunks = splitForProgressive(md)
    // Assert
    assert.ok(isLargeDocument(md))
    assert.ok(chunks.length > 10)
    assert.equal(chunks.map((c) => c.src).join('\n'), md)
    for (const chunk of chunks) {
      const fences = (chunk.src.match(/^```/gm) ?? []).length
      const math = (chunk.src.match(/^\$\$$/gm) ?? []).length
      assert.equal(fences % 2, 0)
      assert.equal(math % 2, 0)
      assert.ok(!/^- b/.test(chunk.src), 'a chunk never starts inside a list')
    }
    const lines = md.split('\n')
    for (const chunk of chunks) assert.equal(lines[chunk.lineOffset], chunk.src.split('\n')[0])
  })

  it('shares reference definitions and keeps front matter to the first chunk', () => {
    const md = '---\ntitle: x\n---\n\n' + 'Para [ref].\n\n'.repeat(120_000) + '[ref]: https://example.com'
    const plan = planProgressive(md)
    assert.equal(collectRefDefs(md), '[ref]: https://example.com')
    assert.equal(plan[0].options.frontMatter, true)
    assert.ok(plan.slice(1).every((c) => c.options.frontMatter === false && c.options.appendix === '[ref]: https://example.com'))
    const html = renderMarkdown(plan[1].src, plan[1].options).html
    assert.match(html, /href="https:\/\/example.com"/)
  })

  it('numbers footnotes across chunks and renders one Footnotes section at the end', () => {
    // Arrange: references in the first and a later chunk, definitions at the very end
    const filler = 'Filler paragraph with enough words to fill a chunk. '.repeat(8) + '\n\n'
    const md = [
      'Opening claim.[^big] A second note.[^two] Code `[^big]` stays code.',
      filler.repeat(2600),
      'Later reference to the same note.[^big]',
      filler.repeat(300),
      '[^big]: The big note,\n    continued on an indented line.',
      '[^two]: The second note.'
    ].join('\n\n')
    // Act
    const plan = planProgressive(md)
    const html = plan.map((chunk) => renderMarkdown(chunk.src, chunk.options).html).join('')
    const doc = parseHtml(html)
    // Assert
    assert.ok(isLargeDocument(md) && plan.length > 3)
    assert.deepEqual(Array.from(doc.querySelectorAll('code'), (c) => c.textContent), ['[^big]'])
    assert.doesNotMatch(doc.textContent?.replace('[^big]', '') ?? '', /\[\^/, 'every reference resolves')
    const refs = Array.from(doc.querySelectorAll('a[data-footnote-ref]'))
    assert.deepEqual(refs.map((a) => a.textContent), ['1', '2', '1'])
    assert.deepEqual(refs.map((a) => a.id), ['footnote-ref-big', 'footnote-ref-two', 'footnote-ref-big-2'])
    const sections = doc.querySelectorAll('section.smd-footnotes')
    assert.equal(sections.length, 1)
    assert.equal(doc.querySelectorAll('#footnote-label').length, 1)
    assert.ok(html.trimEnd().endsWith('</section>'), 'the section comes last')
    const items = Array.from(sections[0].querySelectorAll('li'))
    assert.deepEqual(items.map((li) => li.id), ['footnote-big', 'footnote-two'])
    assert.match(items[0].textContent ?? '', /continued on an indented line/)
    const back = Array.from(items[0].querySelectorAll('a[data-footnote-backref]'), (a) => a.getAttribute('href'))
    assert.deepEqual(back, ['#footnote-ref-big', '#footnote-ref-big-2'])
  })
})
