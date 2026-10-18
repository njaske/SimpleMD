import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { before, describe, it } from 'node:test'
import { Window } from 'happy-dom'

// The paste modules import their siblings without extensions (Vite style); node needs
// the ".ts".
registerHooks({
  resolve(specifier, context, next) {
    const extensionless = /^\.\.?\//.test(specifier) && !/\.\w+$/.test(specifier)
    return next(extensionless && context.parentURL?.endsWith('.ts') ? `${specifier}.ts` : specifier, context)
  }
})

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
    assert.deepEqual(result, { markdown: '| a   | b   |\n| --- | --- |\n| c   | d   |', block: true, fresh: true })
  })

  it('converts rich HTML', () => {
    assert.deepEqual(paste.convertPaste('<p><strong>hi</strong></p>', 'hi'), { markdown: '**hi**', block: false, fresh: false })
  })

  it('leaves plain text and formatting-free HTML alone', () => {
    assert.equal(paste.convertPaste('', 'just text'), null)
    assert.equal(paste.convertPaste('<p>just text</p>', 'just text'), null)
  })

  it('leaves the paste alone when the conversion equals the plain text', () => {
    assert.equal(paste.convertPaste('<code>x</code>', '`x`'), null)
  })
})

describe('clipboard sources that only look rich', () => {
  const sheetsCell =
    '<google-sheets-html-origin><style type="text/css"><!--td {border: 1px solid #cccccc;}--></style><table cellspacing="0" cellpadding="0" dir="ltr" border="1" data-sheets-root="1"><colgroup><col width="100"/></colgroup><tbody><tr style="height:21px;"><td style="text-align:right;" data-sheets-value="{&quot;1&quot;:3,&quot;3&quot;:42.5}">42.5</td></tr></tbody></table></google-sheets-html-origin>'
  const excelCell =
    '<html xmlns:o="urn:schemas-microsoft-com:office:office"><head><meta name=ProgId content=Excel.Sheet><style>td {mso-number-format:General;}</style></head><body link="#0563C1"><table border=0 cellpadding=0 cellspacing=0 width=64><col width=64><tr height=20><!--StartFragment--><td height=20 class=xl65 align=right width=64>42.5</td><!--EndFragment--></tr></table></body></html>'

  it('pastes one spreadsheet cell as plain text', () => {
    assert.equal(paste.convertPaste(sheetsCell, '42.5'), null)
    assert.equal(paste.convertPaste(excelCell, '42.5\r\n'), null)
  })

  it('pastes a single row or a single column as plain text', () => {
    assert.equal(paste.convertPaste('<table><tr><td>a</td><td>b</td></tr></table>', 'a\tb'), null)
    assert.equal(paste.convertPaste('<table><tr><td>a</td></tr><tr><td>b</td></tr><tr><td>c</td></tr></table>', 'a\nb\nc'), null)
  })

  it('keeps formatting inside a lone cell without making a table', () => {
    const result = paste.convertPaste('<table><tr><td><a href="https://a.dev">site</a></td></tr></table>', 'site')
    assert.deepEqual(result, { markdown: '[site](https://a.dev)', block: false, fresh: false })
  })

  const vscode =
    `<meta charset='utf-8'><div style="color: #abb2bf;background-color: #282c34;font-family: 'Fira Code', Consolas, monospace;font-weight: normal;font-size: 14px;line-height: 19px;white-space: pre;">` +
    '<div><span style="color: #7f848e;font-style: italic;">// add two numbers</span></div>' +
    '<div><span style="color: #c678dd;">function</span><span style="color: #abb2bf;"> </span><span style="color: #61afef;">add</span><span style="color: #abb2bf;">(</span><span style="color: #e06c75;font-style: italic;">a</span><span style="color: #abb2bf;">, </span><span style="color: #e06c75;font-style: italic;">b</span><span style="color: #abb2bf;">) {</span></div>' +
    '<div><span style="color: #abb2bf;">    </span><span style="color: #c678dd;">return</span><span style="color: #abb2bf;"> a </span><span style="color: #56b6c2;">*</span><span style="color: #abb2bf;"> b_c</span></div>' +
    '<div><span style="color: #abb2bf;">}</span></div></div>'

  it('pastes code copied from VS Code as the plain text, italic tokens and all', () => {
    const text = '// add two numbers\nfunction add(a, b) {\n    return a * b_c\n}'
    assert.equal(paste.htmlToMarkdown(vscode), null)
    assert.equal(paste.convertPaste(vscode, text), null)
  })

  it('still converts Google Docs, whose spans are white-space:pre-wrap', () => {
    const md = paste.htmlToMarkdown(
      '<b style="font-weight:normal;" id="docs-internal-guid-2"><p dir="ltr"><span style="font-weight:700;white-space:pre;white-space:pre-wrap;">Bold</span><span style="white-space:pre-wrap;"> text</span></p></b>'
    )
    assert.equal(md, '**Bold** text')
  })
})

describe('blank lines in pasted code', () => {
  it('keeps consecutive blank lines inside a fenced block', () => {
    const md = paste.htmlToMarkdown('<pre><code class="language-python">import os\n\n\ndef f():\n    pass\n</code></pre>')
    assert.equal(md, '```python\nimport os\n\n\ndef f():\n    pass\n```')
  })

  it('collapses blank-line runs only outside fences', () => {
    assert.equal(paste.collapseBlankLines('a\n\n\n\nb\n\n```\nx\n\n\ny\n```\n\n\nc'), 'a\n\nb\n\n```\nx\n\n\ny\n```\n\nc')
  })
})

describe('pasted HTML tables', () => {
  const table = '<table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table>'

  it('marks a converted table as a block with a fresh paragraph after it', () => {
    assert.deepEqual(paste.convertPaste(table, 'a b\n1 2'), { markdown: '| a | b |\n| --- | --- |\n| 1 | 2 |', block: true, fresh: true })
  })

  it('keeps a table-led paste on its own lines but ends it where the prose ends', () => {
    const result = paste.convertPaste(`${table}<p>After</p>`, 'a b 1 2 After')
    assert.deepEqual(result, { markdown: '| a | b |\n| --- | --- |\n| 1 | 2 |\n\nAfter', block: true, fresh: false })
  })

  it('lets prose around a table flow as normal', () => {
    const result = paste.convertPaste(`<p>Intro</p>${table}<p>After</p>`, 'Intro a b 1 2 After')
    assert.equal(result?.block, false)
  })
})
