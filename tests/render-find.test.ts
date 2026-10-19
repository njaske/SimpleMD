import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { setupRenderEnv } from './render-env.ts'

setupRenderEnv()
const { findOffsets, indexText, firstAccepted } = await import('../src/renderer/src/lib/reader/find.ts')
const { markChanges, unmarkChanges } = await import('../src/renderer/src/lib/reader/changes.ts')
const { enhanceImages, loadBlocked, isLoadImagesControl, exportableSrc } = await import(
  '../src/renderer/src/lib/reader/images.ts'
)

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

describe('first match below the viewport', () => {
  it('binary-searches the first accepted item', () => {
    const tops = [-300, -10, 0, 5, 400]
    assert.equal(firstAccepted(tops, (t) => t >= 0), 2)
    assert.equal(firstAccepted(tops, (t) => t >= -1000), 0)
    assert.equal(firstAccepted(tops, (t) => t > 1000), -1)
    assert.equal(firstAccepted([], () => true), -1)
  })

  it('keeps block breaks between nested blocks and none at the end', () => {
    const index = indexText(article('<ul><li>one<ul><li>two</li></ul></li></ul><table><tr><td>a</td><td>b</td></tr></table>'))
    assert.equal(index.text, 'one\ntwo\na\nb')
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

  it('never loads placeholders the document forged, and exports keep only web links', () => {
    // Arrange: a sanitized document can carry our class names and data-* attributes
    const el = article(
      '<div class="smd-imgblocked" data-src="file:///C:/secret.png">a</div>' +
        '<span class="smd-imgchip smd-imgblocked" data-src="javascript:alert(1)">b</span>'
    )
    // Act
    loadBlocked(el)
    // Assert
    assert.equal(el.querySelectorAll('img').length, 0)
    const [card, chip] = Array.from(el.querySelectorAll('.smd-imgblocked'))
    assert.equal(exportableSrc(card), null)
    assert.equal(exportableSrc(chip), null)
  })

  it('pins protocol-relative images to https', () => {
    const tpl = document.createElement('template')
    tpl.innerHTML = '<p><img src="//cdn.example/a.png" alt="A"></p>'
    enhanceImages(tpl.content, ctx(false))
    assert.equal(tpl.content.querySelector('img')?.getAttribute('src'), 'https://cdn.example/a.png')
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

  it('turns a local image that cannot be read into a "not found" card', async () => {
    // Arrange
    const tpl = document.createElement('template')
    tpl.innerHTML = '<p><img src="./shots/pic.png" alt="Screenshot"></p><p>Inline <img src="icon.png" alt="icon"> here</p>'
    let reads = 0
    const missing = { ...ctx(false), docPath: '/notes/a.md', readImage: async () => (reads++ ? Promise.reject(new Error('denied')) : null) }
    // Act
    enhanceImages(tpl.content, missing)
    const el = article('')
    document.body.appendChild(el)
    el.appendChild(tpl.content)
    const pending = el.querySelectorAll('.smd-imgph.is-missing').length
    await new Promise((resolve) => setTimeout(resolve, 0))
    // Assert
    assert.equal(pending, 0, 'still loading at first')
    const card = el.querySelector('figure .smd-imgph.is-missing')
    assert.equal(card?.querySelector('strong')?.textContent, 'Image not found')
    assert.equal(card?.querySelector('.smd-imgph-name')?.textContent, 'pic.png')
    assert.ok(el.querySelector('.smd-imgchip.is-missing'), 'the inline chip too (read rejected)')
    assert.equal(el.querySelector('figcaption')?.textContent, 'Screenshot')
  })

  it('explains at once why an untitled document shows no local images', () => {
    const tpl = document.createElement('template')
    tpl.innerHTML = '<p><img src="pic.png" alt=""></p>'
    enhanceImages(tpl.content, ctx(false))
    const card = tpl.content.querySelector('.smd-imgph.is-missing')
    assert.equal(card?.querySelector('strong')?.textContent, 'Image not shown')
    assert.match(card?.getAttribute('title') ?? '', /Save the document/)
  })
})
