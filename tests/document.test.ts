import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  computeOutline,
  computeStats,
  mayContainCode,
  mayContainMath,
  searchAll
} from '../src/renderer/src/lib/document.ts'
import { TextCache } from '../src/renderer/src/lib/lru.ts'

describe('searchAll', () => {
  const files = [
    { id: '1', name: 'one.md', folderName: 'f', content: 'Hello World\nsecond line' },
    { id: '2', name: 'two.md', folderName: 'f', content: 'nothing here' },
    { id: '3', name: 'three.md', folderName: 'f', content: 'world again\nWORLD' }
  ]

  it('finds case-insensitive matches per line and skips files without any', () => {
    const r = searchAll('world', files)
    assert.equal(r.fileCount, 2)
    assert.equal(r.total, 3)
    assert.deepEqual(r.groups.map((g) => g.fileId), ['1', '3'])
    assert.equal(r.groups[0].matches[0].mid, 'World')
    assert.equal(r.groups[0].matches[0].col, 6)
  })

  it('returns nothing for an empty or unmatched query', () => {
    assert.equal(searchAll('  ', files).total, 0)
    assert.equal(searchAll('zzz', files).fileCount, 0)
  })
})

describe('computeOutline / computeStats', () => {
  it('extracts headings outside code fences with unique slugs', () => {
    const md = '# Title\n```\n# not a heading\n```\n## Title\n'
    const out = computeOutline(md)
    assert.deepEqual(out.map((o) => o.slug), ['title', 'title-1'])
  })

  it('returns the same answer for repeated calls on the same text', () => {
    const md = '# A\n\nsome words here'
    assert.equal(computeOutline(md), computeOutline(md))
    assert.equal(computeStats(md), computeStats(md))
    assert.equal(computeStats(md).headings, 1)
    assert.notEqual(computeStats(md + ' more').words, computeStats(md).words)
  })
})

describe('lazy library gates', () => {
  it('detects math only when a dollar sign is present', () => {
    assert.equal(mayContainMath('plain text'), false)
    assert.equal(mayContainMath('energy $E=mc^2$'), true)
  })

  it('detects fenced code with a language', () => {
    assert.equal(mayContainCode('```js\nx\n```'), true)
    assert.equal(mayContainCode('text\n  ~~~python\nx\n~~~'), true)
    assert.equal(mayContainCode('```\nbare\n```'), false)
    assert.equal(mayContainCode('no code, just `inline`'), false)
  })

  it('detects tagged fences inside blockquotes, list items and raw HTML', () => {
    assert.equal(mayContainCode('> ```js\n> x\n> ```'), true)
    assert.equal(mayContainCode('- ```js\n  x\n  ```'), true)
    assert.equal(mayContainCode('1. ```bash\n   ls\n   ```'), true)
    assert.equal(mayContainCode('<pre><code class="language-js">x</code></pre>'), true)
  })
})

describe('TextCache', () => {
  it('evicts the least recently used entry beyond the entry limit', () => {
    const c = new TextCache(2, 1000)
    c.set('a', '1')
    c.set('b', '2')
    assert.equal(c.get('a'), '1') // refresh a
    c.set('c', '3')
    assert.equal(c.get('b'), undefined)
    assert.equal(c.get('a'), '1')
    assert.equal(c.get('c'), '3')
  })

  it('respects the character budget and ignores oversized entries', () => {
    const c = new TextCache(10, 10)
    c.set('k1', 'aaaa') // cost 6
    c.set('k2', 'bbbb') // cost 6 -> evicts k1
    assert.equal(c.get('k1'), undefined)
    assert.equal(c.get('k2'), 'bbbb')
    c.set('big', 'x'.repeat(50))
    assert.equal(c.get('big'), undefined)
    assert.equal(c.size, 1)
  })

  it('replaces an existing key without double counting', () => {
    const c = new TextCache(5, 20)
    c.set('k', 'aaaa')
    c.set('k', 'bbbb')
    c.set('j', 'cccc')
    assert.equal(c.get('k'), 'bbbb')
    assert.equal(c.get('j'), 'cccc')
  })
})
