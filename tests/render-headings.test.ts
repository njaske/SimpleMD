import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseHtml, setupRenderEnv } from './render-env.ts'

setupRenderEnv()
const { renderMarkdown } = await import('../src/renderer/src/lib/markdown.ts')
const { activeHeading, assignHeadingIds, headingSlugs } = await import('../src/renderer/src/lib/reader/headings.ts')

function rendered(md: string): HTMLElement {
  const root = parseHtml(`<article>${renderMarkdown(md).html}</article>`).querySelector('article') as HTMLElement
  assignHeadingIds(root, headingSlugs(md))
  return root
}

describe('heading ids', () => {
  it('match the outline by source line in a file with Windows line endings', () => {
    // Arrange
    const md = '# Intro\r\n\r\nText.\r\n\r\n## Setup\r\n\r\nMore.\r\n\r\n## Setup\r\n'
    // Act
    const root = rendered(md)
    // Assert
    const headings = Array.from(root.querySelectorAll('h1, h2'))
    assert.deepEqual(headings.map((h) => h.id), ['intro', 'setup', 'setup-1'])
    assert.ok(headings.every((h) => h.hasAttribute('data-outline')))
    assert.notEqual(activeHeading(root, root), null, 'the scroll spy sees the outline headings')
  })

  it('stay unique across thousands of identical headings outside the outline', () => {
    // Arrange: setext headings are not in the outline, so they take the fallback path
    const md = Array.from({ length: 3000 }, () => 'Tool output\n-----------\n\nok\n').join('\n')
    // Act
    const started = performance.now()
    const root = rendered(md)
    const elapsed = performance.now() - started
    // Assert
    const ids = Array.from(root.querySelectorAll('h2'), (h) => h.id)
    assert.equal(new Set(ids).size, 3000)
    assert.deepEqual(ids.slice(0, 3), ['tool-output', 'tool-output-1', 'tool-output-2'])
    assert.equal(ids[2999], 'tool-output-2999')
    assert.ok(elapsed < 5000, `took ${Math.round(elapsed)} ms`)
  })
})
