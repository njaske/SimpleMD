import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseHtml, setupRenderEnv } from './render-env.ts'

setupRenderEnv()
const { renderMarkdown } = await import('../src/renderer/src/lib/markdown.ts')
const { sanitizeHtml } = await import('../src/renderer/src/lib/markdown/sanitize.ts')
const { labelTaskBoxes } = await import('../src/renderer/src/lib/reader/tasks.ts')

function render(md: string): HTMLElement {
  return parseHtml(renderMarkdown(md).html)
}

describe('sanitizer', () => {
  it('removes scripts, styles, frames, embeds and event handlers', () => {
    // Arrange
    const md = [
      '<script>alert(1)</script>',
      '<style>body { display: none }</style>',
      '<iframe src="https://evil.example"></iframe>',
      '<object data="x"></object><embed src="x">',
      '<img src="x.png" onerror="alert(1)">',
      '<p onclick="alert(1)">click</p>'
    ].join('\n\n')
    // Act
    const doc = render(md)
    // Assert
    assert.equal(doc.querySelectorAll('script, style, iframe, object, embed').length, 0)
    assert.equal(doc.querySelectorAll('[onerror], [onclick]').length, 0)
  })

  it('removes forms and every form control except task checkboxes', () => {
    const doc = render(
      '<form action="https://evil.example"><input type="password"><input type="text"><textarea></textarea>' +
        '<select><option>a</option></select><button>Send</button><label>l</label></form>'
    )
    assert.equal(doc.querySelectorAll('form, input, textarea, select, button, label').length, 0)
  })

  it('blocks javascript: and data: links', () => {
    const doc = render('[a](javascript:alert(1)) <a href="JaVaScRiPt:alert(1)">b</a> <a href="data:text/html,x">c</a>')
    for (const a of Array.from(doc.querySelectorAll('a'))) {
      assert.doesNotMatch(a.getAttribute('href') ?? '', /^(javascript|data):/i)
    }
  })

  it('keeps task checkboxes enabled with their line and strips other attributes', () => {
    const html = sanitizeHtml('<input type="checkbox" data-task-line="7" name="x" onclick="y()" checked>')
    const box = parseHtml(html).querySelector('input')
    assert.equal(box?.getAttribute('data-task-line'), '7')
    assert.equal(box?.hasAttribute('checked'), true)
    assert.equal(box?.hasAttribute('disabled'), false)
    assert.deepEqual(box?.getAttributeNames().sort(), ['checked', 'class', 'data-task-line', 'type'])
  })

  it('disables checkboxes the renderer did not tag, and documents cannot forge the tag', () => {
    const doc = render('<input type="checkbox"> <input type="checkbox" data-task-line="0">\n\n- [ ] real task')
    const boxes = Array.from(doc.querySelectorAll('input'))
    assert.equal(boxes.length, 3)
    assert.deepEqual(boxes.map((b) => b.hasAttribute('disabled')), [true, true, false])
    assert.equal(boxes[2].getAttribute('data-task-line'), '2')
  })

  it('drops inline styles that escape the column or load resources', () => {
    const doc = render(
      '<div style="position:fixed;top:0">a</div><div style="background:url(https://x)">b</div><span style="color:red">c</span>'
    )
    const styles = Array.from(doc.querySelectorAll('div, span'), (el) => el.getAttribute('style'))
    assert.deepEqual(styles, [null, null, 'color:red'])
  })

  it('drops styles that hide a fetch behind a CSS escape or an image function', () => {
    // Arrange: u\72l( is url( once CSS unescapes it
    const md = [
      '<div style="background:u\\72l(https://t.example/a.png)">a</div>',
      '<div style="background:image-set(\'https://t.example/b.png\' 1x)">b</div>',
      '<div style="background:-webkit-image-set(\'https://t.example/c.png\' 1x)">c</div>',
      '<div style="background:cross-fade(url(x), \'https://t.example/d.png\')">d</div>',
      '<svg><rect fill="u\\72l(https://t.example/e.svg#p)" width="4" height="4"/></svg>',
      '<span style="color:#a00;font-weight:600">kept</span>'
    ].join('\n\n')
    // Act
    const html = renderMarkdown(md).html
    // Assert
    assert.doesNotMatch(html, /t\.example/)
    assert.equal(parseHtml(html).querySelector('span')?.getAttribute('style'), 'color:#a00;font-weight:600')
  })

  it('keeps prose about the line attributes inside HTML blocks', () => {
    const doc = render('<div>\nSet the data-line attribute, or data-task-line.\n</div>\n\n<details><summary>About data-task-line</summary>x</details>')
    assert.equal(doc.querySelector('div')?.textContent?.trim(), 'Set the data-line attribute, or data-task-line.')
    assert.equal(doc.querySelector('summary')?.textContent, 'About data-task-line')
  })

  it('still rewrites forged line attributes in raw HTML', () => {
    const doc = render('<div>\n<p data-line="40" data-line-end = "41">x</p>\n</div>')
    const p = doc.querySelector('p')
    assert.equal(p?.hasAttribute('data-line'), false)
    assert.equal(p?.hasAttribute('data-line-end'), false)
    assert.equal(doc.querySelector('div')?.getAttribute('data-line'), '0')
  })

  it('drops every remote fetch outside <img>: SVG image/feImage, mglyph, background, external SVG refs', () => {
    // Arrange
    const md = [
      '<svg><image href="https://t.example/a.png"/><image xlink:href="https://t.example/b.png"/></svg>',
      '<svg><filter id="f"><feImage href="https://t.example/c.png"/></filter></svg>',
      '<math><mglyph src="https://t.example/d.png"></mglyph></math>',
      '<table background="https://t.example/e.png"><tr><td background="https://t.example/f.png">x</td></tr></table>',
      '<svg><rect fill="url(https://t.example/g.svg#p)" width="4" height="4"/><rect fill="url(#ok)" width="4" height="4"/></svg>',
      '<svg><linearGradient id="g2" href="https://t.example/h.svg#x"></linearGradient><a href="https://ok.example">ok</a></svg>'
    ].join('\n\n')
    // Act
    const html = renderMarkdown(md).html
    const doc = parseHtml(html)
    // Assert
    assert.doesNotMatch(html, /t\.example/)
    assert.equal(doc.querySelectorAll('image, feImage, feimage, mglyph, [background]').length, 0)
    assert.equal(doc.querySelectorAll('rect')[1]?.getAttribute('fill'), 'url(#ok)')
    assert.match(html, /href="https:\/\/ok\.example"/)
  })

  it('keeps what documents legitimately need: details, svg icons, footnote ids', () => {
    const doc = render('> [!faq]- Q\n> A\n\nText[^1]\n\n[^1]: Note')
    assert.equal(doc.querySelectorAll('details summary svg path').length > 0, true)
    assert.ok(doc.querySelector('#footnote-1'))
  })
})

describe('task checkbox names', () => {
  it('labels each box with its own item text, not its nested items', () => {
    // Arrange
    const tpl = document.createElement('template')
    tpl.innerHTML = renderMarkdown('- [ ] Ship the **beta**\n  - [x] Write notes\n- [ ] ' + 'long '.repeat(40)).html
    // Act
    labelTaskBoxes(tpl.content)
    // Assert
    const labels = Array.from(tpl.content.querySelectorAll('input'), (b) => b.getAttribute('aria-label') ?? '')
    assert.equal(labels[0], 'Ship the beta')
    assert.equal(labels[1], 'Write notes')
    assert.equal(labels[2].length, 120)
    assert.ok(labels[2].endsWith('…'))
  })
})
