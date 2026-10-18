import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseHtml, setupRenderEnv } from './render-env.ts'

setupRenderEnv()
const { renderMarkdown } = await import('../src/renderer/src/lib/markdown.ts')
const repairs = await import('../src/renderer/src/lib/markdown/repairs.ts')
const { repairMarkdown, normalizeDiagramSource, scanFences, FIX_FENCE, FIX_TABLE, FIX_MATH } = repairs

describe('forgiving rendering', () => {
  it('closes a code fence left open at the end, keeping its prefix', () => {
    // Arrange
    const lines = ['Text', '', '> ```js', '> const x = 1']
    // Act
    const out = repairMarkdown(lines)
    // Assert
    assert.deepEqual(out.lines, [...lines, '> ```'])
    assert.deepEqual(out.map, [0, 1, 2, 3, 3])
    assert.deepEqual(out.fixes, [FIX_FENCE])
  })

  it('adds the missing divider row under a table header', () => {
    const out = repairMarkdown(['| a | b |', '| 1 | 2 |', '| 3 | 4 |'])
    assert.deepEqual(out.lines, ['| a | b |', '| --- | --- |', '| 1 | 2 |', '| 3 | 4 |'])
    assert.deepEqual(out.map, [0, 0, 1, 2])
    assert.deepEqual(out.fixes, [FIX_TABLE])
    const doc = parseHtml(renderMarkdown('| a | b |\n| 1 | 2 |').html)
    assert.equal(doc.querySelectorAll('table th').length, 2)
  })

  it('leaves valid tables, single pipe lines and tables in code alone', () => {
    const valid = ['| a | b |', '| - | - |', '| 1 | 2 |']
    assert.deepEqual(repairMarkdown(valid).fixes, [])
    assert.deepEqual(repairMarkdown(['| just one line |']).fixes, [])
    assert.deepEqual(repairMarkdown(['```', '| a | b |', '| 1 | 2 |', '```']).fixes, [])
    assert.deepEqual(repairMarkdown(['| a | b |', '| 1 | 2 | 3 |']).fixes, [])
  })

  it('rejoins a $$ block split by blank lines', () => {
    const out = repairMarkdown(['$$', '', 'x = \\frac{1}{2}', '', '$$'])
    assert.deepEqual(out.lines, ['$$', 'x = \\frac{1}{2}', '$$'])
    assert.deepEqual(out.map, [0, 2, 4])
    assert.deepEqual(out.fixes, [FIX_MATH])
  })

  it('does not join $$ lines when the pairing is ambiguous or the body is prose', () => {
    assert.deepEqual(repairMarkdown(['$$', '', 'x', '', '$$', '$$']).fixes, [])
    const prose = ['$$', '', 'This is an ordinary sentence that someone wrote between dollar lines.', '', '$$']
    assert.deepEqual(repairMarkdown(prose).fixes, [])
  })

  it('reports fixes through renderMarkdown without changing the source', () => {
    const md = 'Look:\n\n| a | b |\n| 1 | 2 |\n\n```\nopen'
    const result = renderMarkdown(md)
    assert.deepEqual(result.fixes, [FIX_TABLE, FIX_FENCE])
    assert.equal(md, 'Look:\n\n| a | b |\n| 1 | 2 |\n\n```\nopen')
  })

  it('reports nothing for clean documents', () => {
    assert.deepEqual(renderMarkdown('# Fine\n\nAll good.').fixes, [])
  })
})

describe('scanFences', () => {
  it('tracks nested fence lengths and tildes', () => {
    const { inside, open } = scanFences(['````', '```', 'still code', '````', 'text', '~~~', 'x'])
    assert.deepEqual(inside, [true, true, true, true, false, true, true])
    assert.deepEqual(open, { prefix: '', marker: '~~~' })
  })
})

describe('normalizeDiagramSource', () => {
  it('straightens quotes, dashes, arrows and odd spaces', () => {
    const src = 'A[\u201CStart (here)\u201D] \u2014> B[\u2018x\u2019]\nB <\u2013 C\u00A0end\u200B\u2026'
    assert.equal(normalizeDiagramSource(src), 'A["Start (here)"] --> B[\'x\']\nB <-- C end...')
  })
})
