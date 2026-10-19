import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { setupRenderEnv } from './render-env.ts'

// Mermaid diagrams without Mermaid: a fake API records what it was asked to parse and
// draw, so the repair retry, "Block remote images" and the draw scheduling can be
// checked exactly.

const window = setupRenderEnv()
Object.assign(globalThis, { getComputedStyle: window.getComputedStyle.bind(window) })

const { pickSource, drawDiagram, mermaidConfig, FIX_DIAGRAM } = await import('../src/renderer/src/lib/reader/mermaid.ts')
const { holdRemoteImages, scrubDiagram, HELD_IMAGE } = await import('../src/renderer/src/lib/reader/diagramImages.ts')
const { DiagramScheduler } = await import('../src/renderer/src/lib/reader/diagrams.ts')
const { ArticlePainter } = await import('../src/renderer/src/lib/reader/painter.ts')
const { isLoadImagesControl } = await import('../src/renderer/src/lib/reader/images.ts')
type MermaidLike = import('../src/renderer/src/lib/reader/mermaid.ts').MermaidLike

interface Fake extends MermaidLike {
  parsed: string[]
  rendered: string[]
  configs: unknown[]
}

/** A Mermaid stand-in: `valid` decides what parses; `svg` is what it draws. */
function fakeMermaid(valid: (src: string) => boolean = () => true, svg = '<svg viewBox="0 0 200 100"></svg>'): Fake {
  const fake: Fake = {
    parsed: [],
    rendered: [],
    configs: [],
    initialize: (config) => {
      fake.configs.push(config)
    },
    parse: async (text) => {
      fake.parsed.push(text)
      return valid(text) ? { diagramType: 'flowchart' } : false
    },
    render: async (_id, text) => {
      fake.rendered.push(text)
      return { svg }
    }
  }
  return fake
}

const LIGHT = { theme: 'light' as const, blockRemote: false }
const BLOCKING = { theme: 'light' as const, blockRemote: true }
/** Queued diagrams that are drawn in idle time (ordinary documents). */
const IN_BACKGROUND = { ...LIGHT, background: true }

function job(source: string): { container: HTMLElement; source: string } {
  const container = document.createElement('div')
  container.className = 'smd-mermaid'
  document.body.appendChild(container)
  return { container, source }
}

async function waitFor(check: () => boolean, ms = 5000): Promise<void> {
  const until = Date.now() + ms
  while (!check()) {
    if (Date.now() > until) throw new Error('timed out')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe('diagram source repair', () => {
  it('draws the source as written when it parses', async () => {
    const fake = fakeMermaid()
    assert.deepEqual(await pickSource(fake, 'flowchart LR\n A --> B'), { source: 'flowchart LR\n A --> B', fixed: false })
  })

  it('retries once with straightened quotes and dashes and reports the repair', async () => {
    // Arrange: only the plain-quote version parses
    const fake = fakeMermaid((src) => !/[“”—]/.test(src))
    // Act
    const picked = await pickSource(fake, 'flowchart LR\n A[“Start”] —> B')
    // Assert
    assert.equal(fake.parsed.length, 2)
    assert.deepEqual(picked, { source: 'flowchart LR\n A["Start"] --> B', fixed: true })
  })

  it('gives up when neither version parses', async () => {
    const fake = fakeMermaid(() => false)
    assert.equal(await pickSource(fake, 'flowchart LR\n A[“x”] -> '), null)
  })

  it('shows the source with a note when the diagram cannot be drawn', async () => {
    const fake = fakeMermaid(() => false)
    const target = job('not a diagram')
    const result = await drawDiagram(fake, target, LIGHT, () => false)
    assert.deepEqual(result, { fixed: false, held: 0 })
    assert.ok(target.container.classList.contains('smd-mermaid-error'))
    assert.equal(target.container.querySelector('code')?.textContent, 'not a diagram')
  })
})

describe('remote images in diagrams', () => {
  it('swaps image-shape URLs for a local placeholder and drops remote <img> and url()', () => {
    // Arrange
    const source = [
      'flowchart LR',
      '  A@{ img: "https://x.example/track.png", label: "Logo", h: 60 } --> B',
      '  C@{ img: //cdn.example/t2.png } --> D["<img src=\'https://x.example/t3.png\'/> label"]',
      '  style B fill:url(https://x.example/bg.png)',
      '  E@{ img: "data:image/png;base64,AAAA" }'
    ].join('\n')
    // Act
    const { source: held, held: count } = holdRemoteImages(source)
    // Assert
    assert.equal(count, 4)
    assert.doesNotMatch(held, /x\.example|cdn\.example/)
    assert.equal(held.split(HELD_IMAGE).length - 1, 2, 'both image shapes keep a placeholder')
    assert.match(held, /label: "Logo", h: 60/)
    assert.match(held, /img: "data:image\/png;base64,AAAA"/, 'inline images stay')
    assert.match(held, / label"\]/)
  })

  it('leaves a diagram without remote images untouched', () => {
    const source = 'flowchart LR\n  A["https is just text here"] --> B'
    assert.deepEqual(holdRemoteImages(source), { source, held: 0 })
  })

  it('scrubs anything that would still fetch out of a drawn diagram', () => {
    // Arrange
    const tpl = document.createElement('template')
    tpl.innerHTML =
      '<svg><image href="https://x.example/i.png"></image><image href="data:image/png;base64,AA"></image>' +
      '<use href="#node"></use><g style="fill:url(//x.example/s.png)"></g></svg>'
    // Added by hand: happy-dom's parser mishandles <style> inside <svg>.
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style')
    style.textContent = '.a{fill:url(https://x.example/a.png)}.b{fill:url(#grad)}'
    tpl.content.firstChild?.appendChild(style)
    // Act
    const removed = scrubDiagram(tpl.content)
    // Assert
    const html = (tpl.content.firstChild as Element).outerHTML
    assert.equal(removed, 1)
    assert.doesNotMatch(html, /x\.example/)
    assert.match(html, /url\(#grad\)/)
    assert.match(html, /data:image\/png/)
    assert.match(html, /<use href="#node">/)
  })

  it('never hands Mermaid a remote image while blocking, and forbids image tags in labels', async () => {
    // Arrange
    const fake = fakeMermaid(() => true, '<svg viewBox="0 0 10 10"><image href="https://x.example/late.png"></image></svg>')
    const target = job('flowchart LR\n  A@{ img: "https://x.example/track.png" } --> B')
    // Act
    const result = await drawDiagram(fake, target, BLOCKING, () => false)
    // Assert
    assert.equal(result.held, 1)
    assert.ok(fake.parsed.every((src) => !src.includes('x.example')))
    assert.ok(fake.rendered.every((src) => !src.includes('x.example')))
    assert.equal(target.container.querySelector('image'), null, 'the drawn SVG was scrubbed')
    const config = fake.configs.at(-1) as { dompurifyConfig?: { FORBID_TAGS?: string[] } }
    assert.ok(config.dompurifyConfig?.FORBID_TAGS?.includes('img'))
  })

  it('draws an image shape whose picture cannot load with a placeholder instead of failing', async () => {
    // Arrange: like Mermaid, rendering throws when an image shape's picture won't decode
    const fake = fakeMermaid()
    const render = fake.render
    fake.render = async (id, text) => {
      if (text.includes('x.example')) throw new Error('The source image cannot be decoded.')
      return render(id, text)
    }
    const target = job('flowchart LR\n  A@{ img: "https://x.example/gone.png" } --> B')
    // Act
    const result = await drawDiagram(fake, target, LIGHT, () => false)
    // Assert
    assert.equal(result.held, 0, 'nothing to load later: it was allowed and failed')
    assert.ok(target.container.querySelector('svg'))
    assert.equal(fake.rendered.length, 1, 'only the retry got through')
    assert.ok(fake.rendered[0].includes(HELD_IMAGE))
  })

  it('configures fonts, theme and readable spacing', () => {
    const config = mermaidConfig({ theme: 'sepia', blockRemote: false }, 'Inter')
    assert.equal(config.theme, 'base')
    assert.equal(config.securityLevel, 'strict')
    assert.equal(config.themeVariables?.fontSize, '14px')
    assert.equal(config.dompurifyConfig, undefined)
    assert.equal(mermaidConfig({ theme: 'dark', blockRemote: false }, 'Inter').theme, 'dark')
  })
})

describe('diagram scheduling', () => {
  function frag(...sources: string[]): HTMLElement {
    const host = document.createElement('div')
    // Escaped like the renderer's output (happy-dom mangles a raw "-->" in text).
    const code = (src: string): string => src.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    host.innerHTML = sources.map((src) => `<pre data-line="0"><code class="language-mermaid">${code(src)}</code></pre>`).join('')
    document.body.appendChild(host)
    return host
  }

  it('waits while held and draws everything once released', async () => {
    // Arrange
    const fake = fakeMermaid()
    let drawn = 0
    const scheduler = new DiagramScheduler({ scroller: () => null, onDrawn: () => drawn++ }, async () => fake)
    scheduler.hold()
    const host = frag('flowchart LR\n A --> B', 'flowchart LR\n C --> D')
    // Act
    scheduler.extract(host, IN_BACKGROUND)
    await new Promise((resolve) => setTimeout(resolve, 50))
    const whileHeld = drawn
    scheduler.release()
    await waitFor(() => drawn === 2)
    // Assert
    assert.equal(whileHeld, 0)
    assert.equal(host.querySelectorAll('.smd-mermaid > svg').length, 2)
    assert.equal(host.querySelector('.smd-mermaid')?.getAttribute('data-line'), '0', 'containers keep the source line')
    assert.equal(scheduler.isBusy(), false)
  })

  it('skips diagrams that left the article before their turn', async () => {
    const fake = fakeMermaid()
    let drawn = 0
    const scheduler = new DiagramScheduler({ scroller: () => null, onDrawn: () => drawn++ }, async () => fake)
    scheduler.hold()
    const host = frag('flowchart LR\n A --> B')
    scheduler.extract(host, IN_BACKGROUND)
    host.remove()
    scheduler.release()
    await new Promise((resolve) => setTimeout(resolve, 80))
    assert.equal(drawn, 0)
    assert.deepEqual(fake.rendered, [])
  })

  it('offers "Load images" under a diagram that held some back, then redraws it with them', async () => {
    // Arrange
    const fake = fakeMermaid()
    let drawn = 0
    const scheduler = new DiagramScheduler({ scroller: () => null, onDrawn: () => drawn++ }, async () => fake)
    const host = frag('flowchart LR\n  A@{ img: "https://x.example/logo.png" } --> B')
    // Act
    const held = scheduler.extract(host, { ...BLOCKING, background: true })
    scheduler.release()
    await waitFor(() => drawn === 1)
    const button = host.querySelector('.smd-mermaid-held button')
    scheduler.loadHeld()
    await waitFor(() => drawn === 2)
    // Assert
    assert.equal(held, 1)
    assert.ok(button && isLoadImagesControl(button))
    assert.match(fake.rendered[1], /https:\/\/x\.example\/logo\.png/)
    assert.equal(host.querySelector('.smd-mermaid-held'), null)
  })

  it('keeps the diagrams of a large document for when they are needed, then draws them all on request', async () => {
    // Arrange
    const fake = fakeMermaid()
    let drawn = 0
    const scheduler = new DiagramScheduler({ scroller: () => null, onDrawn: () => drawn++ }, async () => fake)
    const host = frag('flowchart LR\n A --> B', 'flowchart LR\n C --> D')
    // Act
    scheduler.extract(host, { ...LIGHT, background: false })
    scheduler.release()
    await new Promise((resolve) => setTimeout(resolve, 80))
    const lazily = drawn
    const pending = host.querySelector('.smd-mermaid.is-pending > pre.smd-mermaid-src')
    await scheduler.drawAll()
    // Assert
    assert.equal(lazily, 0)
    assert.ok(pending?.hasAttribute('hidden'), 'the source waits inside, hidden')
    assert.equal(drawn, 2)
    assert.equal(host.querySelectorAll('.smd-mermaid > svg').length, 2)
    assert.equal(host.querySelector('.is-pending'), null)
    await scheduler.drawAll() // nothing left: resolves at once
  })

  it('shows the source when Mermaid itself cannot load', async () => {
    let drawn = 0
    const scheduler = new DiagramScheduler({ scroller: () => null, onDrawn: () => drawn++ }, async () => null)
    const host = frag('flowchart LR\n A --> B')
    scheduler.extract(host, IN_BACKGROUND)
    scheduler.release()
    await waitFor(() => drawn === 1)
    assert.match(host.querySelector('.smd-mermaid-note')?.textContent ?? '', /couldn't load/)
  })

  it('reports the quote repair for diagrams on screen only', async () => {
    // Arrange
    const fake = fakeMermaid((src) => !src.includes('“'))
    let drawn = 0
    const el = document.createElement('div')
    document.body.appendChild(el)
    const painter = new ArticlePainter(
      { readImage: async () => null, scroller: () => el, onChunks: () => undefined, onDiagram: () => undefined },
      new DiagramScheduler({ scroller: () => el, onDrawn: () => drawn++ }, async () => fake)
    )
    const req = { id: '/a.md', path: '/a.md', theme: 'light' as const, blockRemote: false, fresh: true }
    // Act
    painter.paint(el, { ...req, md: '```mermaid\nflowchart LR\n A[“x”] --> B\n```' })
    await waitFor(() => drawn === 1)
    const fixes = painter.fixes()
    painter.paint(el, { ...req, md: 'No diagram any more.', fresh: false })
    // Assert
    assert.deepEqual(fixes, [FIX_DIAGRAM])
    assert.deepEqual(painter.fixes(), [])
  })
})
