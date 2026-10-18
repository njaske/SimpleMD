import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { setupRenderEnv } from './render-env.ts'

setupRenderEnv()
const { findOffsets, indexText } = await import('../src/renderer/src/lib/reader/find.ts')
const { markChanges, unmarkChanges } = await import('../src/renderer/src/lib/reader/changes.ts')
const { enhanceImages, loadBlocked, isLoadImagesControl } = await import('../src/renderer/src/lib/reader/images.ts')

function article(html: string): HTMLElement {
  const el = document.createElement('div')
  el.innerHTML = html
  return el
}

describe('find helpers', () => {
  it('finds non-overlapping matches up to a limit', () => {
    assert.deepEqual(findOffsets('aaaa', 'aa'), [0, 2])
    assert.deepEqual(findOffsets('abc', ''), [])
    assert.deepEqual(findOffsets('x x x x', 'x', 2), [0, 2])
  })

  it('indexes readable text across inline markup, skipping MathML and code tools', () => {
    // Arrange
    const el = article(
      '<p>Hello <b>Wor</b>ld</p><p>Next</p><span class="katex-mathml">hidden</span>' +
        '<div class="smd-code-tools"><button>Copy</button></div>'
    )
    // Act
    const index = indexText(el)
    // Assert
    assert.equal(index.text, 'hello world\nnext')
    assert.deepEqual(findOffsets(index.text, 'world'), [6])
    assert.deepEqual(findOffsets(index.text, 'ldnext'), [])
  })
})

describe('change marks', () => {
  it('marks the blocks and list items that intersect the ranges', () => {
    const el = article(
      '<p data-line="0" data-line-end="2">a</p>' +
        '<ul data-line="3" data-line-end="6"><li data-line="3" data-line-end="4">x</li><li data-line="4" data-line-end="6">y</li></ul>' +
        '<p data-line="7" data-line-end="8">b</p>'
    )
    const count = markChanges(el, [{ from: 1, to: 2 }, { from: 5, to: 5 }])
    assert.equal(count, 2)
    assert.deepEqual(Array.from(el.querySelectorAll('.smd-changed'), (e) => e.textContent), ['a', 'y'])
    unmarkChanges(el, true)
    assert.equal(el.querySelectorAll('.smd-changed').length, 0)
  })
})

describe('images', () => {
  const ctx = (blockRemote: boolean) => ({
    docPath: null,
    blockRemote,
    readImage: async () => null,
    isStale: () => false
  })

  it('holds back remote images behind a placeholder and loads them on request', () => {
    // Arrange
    const tpl = document.createElement('template')
    tpl.innerHTML = '<p><img src="https://x.example/a.png" alt="Chart"></p><p>Badge <img src="https://x.example/b.svg" alt="ci"></p>'
    // Act
    const blocked = enhanceImages(tpl.content, ctx(true))
    const el = article('')
    el.appendChild(tpl.content)
    // Assert
    assert.equal(blocked, 2)
    assert.equal(el.querySelectorAll('img').length, 0)
    const button = el.querySelector('.smd-imgblocked-load')
    assert.ok(button && isLoadImagesControl(button))
    assert.equal(el.querySelector('.smd-imgchip')?.textContent, 'ci')
    loadBlocked(el)
    assert.deepEqual(Array.from(el.querySelectorAll('img'), (img) => img.getAttribute('src')), [
      'https://x.example/a.png',
      'https://x.example/b.svg'
    ])
  })

  it('ignores look-alike controls written by the document', () => {
    const fake = article('<span class="smd-imgchip smd-imgblocked">x</span>').firstElementChild
    assert.ok(fake)
    assert.equal(isLoadImagesControl(fake), false)
  })

  it('shows remote images directly when not blocked, with alt text as caption', () => {
    const tpl = document.createElement('template')
    tpl.innerHTML = '<p><img src="https://x.example/a.png" alt="Chart"></p>'
    assert.equal(enhanceImages(tpl.content, ctx(false)), 0)
    assert.equal(tpl.content.querySelector('figure img')?.getAttribute('src'), 'https://x.example/a.png')
    assert.equal(tpl.content.querySelector('figcaption')?.textContent, 'Chart')
  })
})
