import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseHtml, setupRenderEnv } from './render-env.ts'

setupRenderEnv()
const { renderMarkdown } = await import('../src/renderer/src/lib/markdown.ts')
const { buildStandaloneHtml, articleClipboardPayload } = await import('../src/renderer/src/lib/reader/export.ts')
const { decorateCodeBlocks } = await import('../src/renderer/src/lib/reader/codeBlocks.ts')

// What KaTeX emits for \(x^2\) (htmlAndMathml), trimmed to its structure.
const KATEX =
  '<span class="katex"><span class="katex-mathml"><math><semantics><mrow><msup><mi>x</mi><mn>2</mn></msup></mrow>' +
  '<annotation encoding="application/x-tex">x^2</annotation></semantics></math></span>' +
  '<span class="katex-html" aria-hidden="true"><span class="mord">x</span></span></span>'

/** A reader article as the controller builds it, plus app chrome to strip. */
function article(): HTMLElement {
  const md = '# Report\n\nSee <b>this</b>.\n\n```js\nconst a = 1\n```\n\n- [x] done\n\n> [!WARNING]\n> Careful.'
  const el = document.createElement('div')
  el.className = 'smd-article'
  el.innerHTML = renderMarkdown(md).html
  decorateCodeBlocks(el)
  el.querySelector('p')?.insertAdjacentHTML('beforeend', ' Math ' + KATEX)
  el.querySelector('h1')?.classList.add('smd-changed')
  el.insertAdjacentHTML(
    'beforeend',
    '<figure class="smd-img is-blocked"><div class="smd-imgblocked" data-src="https://img.example/a.png">' +
      '<button type="button" class="smd-imgblocked-load">Load images</button></div><figcaption>Chart</figcaption></figure>'
  )
  return el
}

describe('buildStandaloneHtml', () => {
  it('produces one self-contained document with a strict CSP and no scripts', () => {
    // Act
    const html = buildStandaloneHtml(article(), { title: 'A <b>"report"</b> & more', theme: 'dark' })
    // Assert
    assert.match(html, /^<!doctype html>/)
    assert.match(html, /<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https:;/)
    assert.match(html, /<title>A &lt;b&gt;"report"&lt;\/b&gt; &amp; more<\/title>/)
    assert.doesNotMatch(html, /<script|<button|<link /i)
    assert.match(html, /<style>/)
    assert.match(html, /background:#1c1b19/)
  })

  it('removes app chrome and keeps the content', () => {
    const doc = parseHtml(buildStandaloneHtml(article(), { title: 'R', theme: 'light' }))
    const main = doc.ownerDocument.querySelector('main.smd-article')
    assert.ok(main)
    assert.equal(main.querySelectorAll('[data-line], [data-task-line], .smd-changed, .smd-code-tools').length, 0)
    assert.equal(main.querySelector('h1')?.textContent, 'Report')
    assert.equal(main.querySelector('pre code')?.textContent, 'const a = 1\n')
    assert.equal(main.querySelector('input')?.hasAttribute('disabled'), true)
    assert.equal(main.querySelector('.smd-callout-label')?.textContent, 'Warning')
  })

  it('keeps math as MathML only and turns blocked images into links', () => {
    const html = buildStandaloneHtml(article(), { title: 'R', theme: 'sepia' })
    assert.doesNotMatch(html, /katex-html/)
    assert.match(html, /<math><semantics>/)
    assert.match(html, /<a href="https:\/\/img.example\/a.png">Chart<\/a>/)
  })
})

describe('articleClipboardPayload', () => {
  it('inlines styles instead of classes and keeps math as MathML', () => {
    const { html } = articleClipboardPayload(article())
    const doc = parseHtml(html)
    assert.equal(doc.querySelectorAll('[class]:not(math *)').length, 0)
    assert.match(doc.querySelector('h1')?.getAttribute('style') ?? '', /font-size:26px/)
    assert.match(doc.querySelector('pre')?.getAttribute('style') ?? '', /font-family/)
    assert.ok(doc.querySelector('math annotation'))
    assert.doesNotMatch(html, /<script|<button/)
  })

  it('has a readable plain-text fallback with TeX, lists and code', () => {
    const { text } = articleClipboardPayload(article())
    assert.match(text, /^Report\n\nSee this\. Math \$x\^2\$/)
    assert.match(text, /const a = 1/)
    assert.match(text, /- \[x\] done/)
    assert.match(text, /Warning\n+Careful\./)
    assert.doesNotMatch(text, /Copy|Load images|JavaScript/)
  })
})
