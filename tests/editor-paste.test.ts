import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { Window } from 'happy-dom'

// DOMPurify binds to `window` when it is first imported, so install a DOM before loading
// the module under test.
const win = new Window()
Object.assign(globalThis, { window: win, document: win.document, DOMParser: win.DOMParser })

type SmartPaste = typeof import('../src/renderer/src/lib/editor/smartPaste.ts')
let paste: SmartPaste

before(async () => {
  paste = await import('../src/renderer/src/lib/editor/smartPaste.ts')
})

describe('htmlToMarkdown', () => {
  it('converts headings, emphasis, links and lists', () => {
    const md = paste.htmlToMarkdown(
      '<h2>Plan</h2><p>Some <strong>bold</strong>, <em>italic</em> and <a href="https://a.dev">a link</a>.</p><ul><li>one</li><li>two</li></ul><ol><li>first</li><li>second</li></ol>'
    )
    assert.equal(md, '## Plan\n\nSome **bold**, *italic* and [a link](https://a.dev).\n\n- one\n- two\n\n1. first\n2. second')
  })

  it('indents nested lists under their item and honours a start number', () => {
    const md = paste.htmlToMarkdown('<ol start="3"><li>three<ul><li>child</li></ul></li><li>four</li></ol>')
    assert.equal(md, '3. three\n   - child\n4. four')
  })

  it('returns null for HTML that carries no formatting', () => {
    assert.equal(paste.htmlToMarkdown('<p>just <span>words</span></p>'), null)
    assert.equal(paste.htmlToMarkdown('<meta charset="utf-8"><div>plain</div>'), null)
  })

  it('converts strikethrough', () => {
    assert.equal(paste.htmlToMarkdown('<p><del>gone</del> and <s>old</s></p>'), '~~gone~~ and ~~old~~')
  })

  it('keeps task list checkboxes', () => {
    const md = paste.htmlToMarkdown('<ul><li><input type="checkbox" checked> done</li><li><input type="checkbox"> todo</li></ul>')
    assert.equal(md, '- [x] done\n- [ ] todo')
  })

  it('fences code blocks with the language from the class', () => {
    const md = paste.htmlToMarkdown('<pre><code class="hljs language-python">def f():\n    return 1\n</code></pre>')
    assert.equal(md, '```python\ndef f():\n    return 1\n```')
  })

  it('keeps line breaks from highlighted markup and finds GitHub languages', () => {
    const md = paste.htmlToMarkdown(
      '<div class="highlight highlight-source-js"><pre><span class="pl-k">const</span> a = 1<br><span>let</span> b = 2</pre></div>'
    )
    assert.equal(md, '```js\nconst a = 1\nlet b = 2\n```')
  })

  it('picks a longer fence when the code contains backtick fences', () => {
    const md = paste.htmlToMarkdown('<pre><code>```\nx\n```</code></pre>')
    assert.equal(md, '````\n```\nx\n```\n````')
  })

  it('converts tables with a header row and alignment', () => {
    const md = paste.htmlToMarkdown(
      '<table><thead><tr><th>Name</th><th align="right">Qty</th></tr></thead><tbody><tr><td>Apple | red</td><td>3</td></tr><tr><td>Pear</td></tr></tbody></table>'
    )
    assert.equal(md, '| Name | Qty |\n| --- | ---: |\n| Apple \\| red | 3 |\n| Pear |  |')
  })

  it('uses the first row as the header when there is no thead', () => {
    const md = paste.htmlToMarkdown('<table><tr><td>a</td><td>b</td></tr><tr><td><p>c</p><p>d</p></td><td>e</td></tr></table>')
    assert.equal(md, '| a | b |\n| --- | --- |\n| c d | e |')
  })

  it('strips scripts, styles and event handlers before converting', () => {
    const md = paste.htmlToMarkdown('<style>p{}</style><script>alert(1)</script><p><b onclick="x()">safe</b><img src="x" onerror="alert(1)"></p>')
    assert.equal(md, '**safe**![](x)')
  })

  it('drops javascript: links and inline data images', () => {
    const md = paste.htmlToMarkdown('<p><a href="javascript:alert(1)">click</a> <img alt="pic" src="data:image/png;base64,AAAA"></p>')
    assert.equal(md, 'click pic')
  })

  it('reads Google Docs styled spans and ignores its bold wrapper', () => {
    const md = paste.htmlToMarkdown(
      '<b style="font-weight:normal;" id="docs-internal-guid-1"><p><span style="font-weight:700">Bold</span> and <span style="font-style:italic">slanted</span> <span style="text-decoration:line-through">old</span></p></b>'
    )
    assert.equal(md, '**Bold** and *slanted* ~~old~~')
  })

  it('turns KaTeX back into TeX', () => {
    const inline = '<span class="katex"><span class="katex-mathml"><math><semantics><mrow><mi>x</mi></mrow><annotation encoding="application/x-tex">x_1^2</annotation></semantics></math></span><span class="katex-html">x</span></span>'
    const display = `<span class="katex-display">${inline}</span>`
    assert.equal(paste.htmlToMarkdown(`<p>Let ${inline} be</p>`), 'Let $x_1^2$ be')
    assert.equal(paste.htmlToMarkdown(`<p>Sum:</p>${display}`), 'Sum:\n\n$$\nx_1^2\n$$')
  })

  it('keeps remote images and escapes spaces in their URLs', () => {
    assert.equal(paste.htmlToMarkdown('<img alt="a [b]" src="https://a.dev/my pic (1).png">'), '![a b](https://a.dev/my%20pic%20%281%29.png)')
  })

  it('keeps relative and anchor links with titles', () => {
    assert.equal(paste.htmlToMarkdown('<a href="#intro" title="Go">Intro</a>'), '[Intro](#intro "Go")')
    assert.equal(paste.htmlToMarkdown('<a href="docs/a.md">A</a>'), '[A](docs/a.md)')
  })
})

describe('tsvToTable', () => {
  it('turns spreadsheet rows into a padded Markdown table', () => {
    assert.equal(paste.tsvToTable('Name\tQty\nApple\t3\nPear\t12\n'), '| Name  | Qty |\n| ----- | --- |\n| Apple | 3   |\n| Pear  | 12  |')
  })

  it('handles quoted cells with tabs, newlines and quotes', () => {
    assert.deepEqual(paste.parseTsv('"a\tb"\t"say ""hi"""\n"two\nlines"\tx'), [
      ['a\tb', 'say "hi"'],
      ['two\nlines', 'x']
    ])
    assert.equal(paste.tsvToTable('h1\th2\n"two\nlines"\tx|y'), '| h1           | h2   |\n| ------------ | ---- |\n| two<br>lines | x\\|y |')
  })

  it('keeps empty cells and CRLF line endings', () => {
    assert.equal(paste.tsvToTable('a\tb\r\n\tc\r\n'), '| a   | b   |\n| --- | --- |\n|     | c   |')
  })

  it('rejects single rows, ragged rows, one column and tab-indented code', () => {
    assert.equal(paste.tsvToTable('a\tb'), null)
    assert.equal(paste.tsvToTable('a\tb\nc'), null)
    assert.equal(paste.tsvToTable('plain\ntext'), null)
    assert.equal(paste.tsvToTable('\tif x {\n\t\treturn\n'), null)
    assert.equal(paste.tsvToTable('\tx := 1\n\ty := 2'), null)
  })
})

describe('convertPaste', () => {
  it('prefers a table for tab-separated text even when HTML is present', () => {
    const result = paste.convertPaste('<table><tr><td>a</td></tr></table>', 'a\tb\nc\td')
    assert.deepEqual(result, { markdown: '| a   | b   |\n| --- | --- |\n| c   | d   |', block: true })
  })

  it('converts rich HTML', () => {
    assert.deepEqual(paste.convertPaste('<p><strong>hi</strong></p>', 'hi'), { markdown: '**hi**', block: false })
  })

  it('leaves plain text and formatting-free HTML alone', () => {
    assert.equal(paste.convertPaste('', 'just text'), null)
    assert.equal(paste.convertPaste('<p>just text</p>', 'just text'), null)
  })

  it('leaves the paste alone when the conversion equals the plain text', () => {
    assert.equal(paste.convertPaste('<code>x</code>', '`x`'), null)
  })
})
