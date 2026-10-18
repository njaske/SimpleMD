import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { parseHtml, setupRenderEnv } from './render-env.ts'

setupRenderEnv()
const markdown = await import('../src/renderer/src/lib/markdown.ts')
const { renderSource } = await import('../src/renderer/src/lib/markdown/pipeline.ts')
const { needsKatex } = await import('../src/renderer/src/lib/markdown/math.ts')

const raw = String.raw

// happy-dom parses MathML as plain HTML, so the sanitizer can't keep it here: these
// tests read the renderer's output before sanitizing (sanitizing is tested on its own).
function render(md: string): string {
  return renderSource(md, { lineOffset: 0, frontMatter: true, appendix: '' }).html
}

function decode(text: string): string {
  return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
}

/** TeX sources of every formula in the output (from KaTeX's MathML annotation). */
function formulas(html: string): string[] {
  const re = /<annotation encoding="application\/x-tex">([\s\S]*?)<\/annotation>/g
  return Array.from(html.matchAll(re), (m) => decode(m[1]))
}

function displayCount(html: string): number {
  return (html.match(/class="katex-display"/g) ?? []).length
}

describe('math delimiters', () => {
  before(async () => {
    await markdown.prepareMarkdown('$x$')
  })

  it('renders inline \\( \\) math', () => {
    // Arrange
    const md = raw`The ratio \(h\) and \( x^2 + 1 \) matter.`
    // Act
    const html = render(md)
    // Assert
    assert.deepEqual(formulas(html), ['h', 'x^2 + 1'])
    assert.equal(displayCount(html), 0)
  })

  it('renders \\[ \\] display math on its own lines, even with list-like lines inside', () => {
    const md = raw`Before:
\[
a = b
- c
\]
After.`
    const html = render(md)
    assert.equal(displayCount(html), 1)
    assert.match(formulas(html)[0], /a = b\n- c/)
    assert.doesNotMatch(html, /<ul/)
  })

  it('renders inline \\[ \\] inside a sentence only when it looks like a formula', () => {
    const html = render(raw`Use \[ x^2 \] here, but array\[0\] stays text.`)
    assert.deepEqual(formulas(html), ['x^2'])
    assert.match(html, /array\[0\] stays text/)
  })

  it('renders math in list items and blockquotes', () => {
    const md = raw`- item with \(a\)
- formula:

  \[ b + c \]

> quoted \(d\)`
    assert.deepEqual(formulas(render(md)), ['a', 'b + c', 'd'])
  })

  it('keeps the existing $ rules: inline, display, and prose dollar amounts', () => {
    const html = render('Energy $E=mc^2$; costs $5 for $10.\n\n$$\n\\int x\\,dx\n$$')
    assert.deepEqual(formulas(html), ['E=mc^2', '\\int x\\,dx'])
    assert.match(html, /costs \$5 for \$10\./)
  })

  it('renders ```math fences as display math', () => {
    const html = render('```math\nE = mc^2\n```')
    assert.deepEqual(formulas(html), ['E = mc^2'])
    assert.equal(displayCount(html), 1)
    assert.doesNotMatch(html, /<pre/)
  })

  it('leaves an escaped \\\\( literal', () => {
    const html = render(raw`Literal \\(x\\) here.`)
    assert.deepEqual(formulas(html), [])
    assert.match(html, /Literal \\\(x\\\) here\./)
  })

  it('never renders math inside code spans or code blocks', () => {
    const md = 'Inline `\\(x\\) $y$` and\n\n```\n\\[ z \\]\n$$w$$\n```'
    const html = render(md)
    assert.deepEqual(formulas(html), [])
    const code = Array.from(parseHtml(html).querySelectorAll('code'), (c) => c.textContent)
    assert.deepEqual(code, ['\\(x\\) $y$', '\\[ z \\]\n$$w$$\n'])
  })
})

describe('dollar math next to code', () => {
  it('never pairs a $ in prose with one inside a code span', () => {
    const html = render('The variable $PATH is set by `export PATH=$HOME/bin:$PATH`, so run it first.')
    assert.deepEqual(formulas(html), [])
    assert.equal(parseHtml(html).querySelector('code')?.textContent, 'export PATH=$HOME/bin:$PATH')
  })

  it('still renders math beside a code span', () => {
    const html = render('Set $x = 2$ with `let x = 2` and $$y$$ too.')
    assert.deepEqual(formulas(html), ['x = 2', 'y'])
  })
})

describe('sanitized math output', () => {
  it('keeps the KaTeX markup through the sanitizer', async () => {
    await markdown.prepareMarkdown('$x$')
    const body = parseHtml(markdown.renderMarkdown(raw`ratio \(h\)`).html)
    assert.equal(body.querySelectorAll('.katex .katex-html').length, 1)
  })
})

describe('needsKatex', () => {
  it('detects every math syntax and nothing else', () => {
    assert.equal(needsKatex('plain words'), false)
    assert.equal(needsKatex('cost $5'), true)
    assert.equal(needsKatex(raw`ratio \(h\)`), true)
    assert.equal(needsKatex(raw`\[ x \]`), true)
    assert.equal(needsKatex('```math\nx\n```'), true)
    assert.equal(needsKatex('> ~~~math\n> x'), true)
  })
})
