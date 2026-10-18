import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseHtml, setupRenderEnv } from './render-env.ts'

setupRenderEnv()
const { renderMarkdown } = await import('../src/renderer/src/lib/markdown.ts')
const { sanitizeHtml } = await import('../src/renderer/src/lib/markdown/sanitize.ts')

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

  it('keeps what documents legitimately need: details, svg icons, footnote ids', () => {
    const doc = render('> [!faq]- Q\n> A\n\nText[^1]\n\n[^1]: Note')
    assert.equal(doc.querySelectorAll('details summary svg path').length > 0, true)
    assert.ok(doc.querySelector('#footnote-1'))
  })
})
