import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { setupRenderEnv } from './render-env.ts'

setupRenderEnv()
const { planProgressive, renderMarkdown, sameChunk } = await import('../src/renderer/src/lib/markdown.ts')
const { planDocument, splitForProgressive, collectRefDefs, planFootnotes } = await import(
  '../src/renderer/src/lib/markdown/progressive.ts'
)
const { headingSlugs, reserveIds } = await import('../src/renderer/src/lib/reader/headings.ts')

/** ~2 MB in the shape of an agent log: many short lines, headings, code and lists. */
function agentLog(seed: string): string {
  const step = (i: number): string =>
    [
      `## Step ${i}`,
      '',
      `Ran the ${seed} task and checked [the output][out] carefully.`,
      '',
      '```bash',
      `npm test -- --grep "case ${i}"`,
      '```',
      '',
      ...Array.from({ length: 12 }, (_, j) => `- line ${j}: updated \`src/file-${j}.ts\` and moved on`),
      ''
    ].join('\n')
  return Array.from({ length: 3000 }, (_, i) => step(i)).join('\n') + '\n[out]: https://example.com/out\n'
}

describe('progressive plan', () => {
  it('plans in one scan exactly what the separate passes find', () => {
    const md = agentLog('alpha') + '\n\nA note.[^n]\n\n[^n]: The note.\n'
    const plan = planDocument(md)
    assert.deepEqual(plan.chunks, splitForProgressive(md))
    assert.equal(plan.refDefs, collectRefDefs(md))
    assert.deepEqual(plan.footnotes, planFootnotes(md, plan.chunks))
  })

  it('plans the same text only once', () => {
    const md = agentLog('beta')
    assert.equal(planProgressive(md), planProgressive(md))
  })

  it('recognises the chunks a grown file still shares with its previous version', () => {
    // Arrange
    const before = planProgressive(agentLog('gamma'))
    const after = planProgressive(agentLog('gamma') + '\nOne more line.\n')
    // Act
    let same = 0
    while (same < before.length && sameChunk(before[same], after[same])) same++
    // Assert: only the last chunk differs
    assert.equal(same, before.length - 1)
    assert.equal(after.length, before.length)
  })

  it('plans a 2 MB document and renders its first chunk within 100 ms', async () => {
    // Arrange: warm up the parser. The other test files run alongside and can starve
    // this one for seconds, so it tries fresh documents for a while and keeps the best
    // run: code that is really too slow never gets under the bar.
    renderMarkdown('# warm\n\n```js\nx\n```\n\n- a\n- b')
    const base = agentLog('timing')
    assert.ok(base.length > 2_000_000)
    const timings: number[] = []
    const until = Date.now() + 15_000
    while (Date.now() < until && !(Math.min(...timings) < 100)) {
      const md = `# Run ${timings.length}\n\n` + base
      // Act
      const started = performance.now()
      const plan = planProgressive(md)
      headingSlugs(md)
      renderMarkdown(plan[0].src, plan[0].options)
      timings.push(performance.now() - started)
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    // Assert
    assert.ok(Math.min(...timings) < 100, `plan + first chunk took ${timings.map((t) => t.toFixed(0)).join(', ')} ms`)
  })
})

describe('heading ids across repaints', () => {
  it('reserves the ids kept from the last paint', () => {
    const slugs = headingSlugs('# Intro\n\nText')
    const kept = document.createElement('div')
    kept.innerHTML = '<h1 id="intro" data-outline="">Intro</h1><h3 id="setext-1">Setext</h3>'
    assert.equal(reserveIds(slugs, kept), true)
    assert.ok(slugs.used.has('setext-1'))
  })

  it('refuses when a kept heading took an id the new outline needs', () => {
    // Arrange: a non-outline heading got "usage"; the new text adds a "# Usage" heading
    const slugs = headingSlugs('# Intro\n\n# Usage')
    const kept = document.createElement('div')
    kept.innerHTML = '<h1 id="intro" data-outline="">Intro</h1><h2 id="usage">Usage</h2>'
    // Act + Assert
    assert.equal(reserveIds(slugs, kept), false)
  })
})
