import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { setupRenderEnv } from './render-env.ts'

// ReaderController end to end under happy-dom: what the App sees through the
// callbacks (render info, task clicks, links, find results, scroll feedback) and
// how painting is scheduled. happy-dom has no layout, so every top-level block of
// the article is given a 100px row and the reader a 500px viewport.

const window = setupRenderEnv()
Object.assign(globalThis, {
  HTMLInputElement: window.HTMLInputElement,
  MutationObserver: window.MutationObserver,
  CSS: { escape: (s: string) => s.replace(/[^\w-]/g, (c) => '\\' + c) },
  Event: window.Event,
  MouseEvent: window.MouseEvent,
  requestAnimationFrame: (cb: () => void) => setTimeout(cb, 0),
  cancelAnimationFrame: (h: ReturnType<typeof setTimeout>) => clearTimeout(h)
})

const { ReaderController } = await import('../src/renderer/src/lib/reader/ReaderController.ts')
type RenderInfo = import('../src/renderer/src/lib/reader/ReaderController.ts').RenderInfo
type ReaderView = import('../src/renderer/src/lib/reader/ReaderController.ts').ReaderView
const { FIX_FENCE } = await import('../src/renderer/src/lib/markdown/repairs.ts')
const { prepareMarkdown } = await import('../src/renderer/src/lib/markdown.ts')
// Load highlight.js up front: the first document with code would otherwise wait for it.
await prepareMarkdown('```js\nx\n```')

const ROW = 100
const VIEW = 500

interface Box {
  top: number
  bottom: number
  height: number
  left: number
  right: number
  width: number
  x: number
  y: number
}

function box(top: number, height: number): Box {
  return { top, bottom: top + height, height, left: 0, right: 800, width: 800, x: 0, y: top }
}

/** The top-level block of the article holding `node`, or null. */
function blockOf(node: Node | null): Element | null {
  for (let n: Node | null = node; n; n = n.parentNode) {
    const parent = n.parentNode
    if (n instanceof window.Element && parent instanceof window.Element && parent.classList.contains('smd-article')) return n
  }
  return null
}

let scroller: HTMLElement | null = null

function rowOf(el: Element): number {
  const block = blockOf(el)
  const article = block?.parentElement
  return block && article ? Array.from(article.children).indexOf(block) : -1
}

// Lay blocks out in rows; anything inside a block shares its row.
window.HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement): DOMRect {
  if (this === scroller) return box(0, VIEW) as DOMRect
  const row = rowOf(this)
  if (row < 0) return box(0, 0) as DOMRect
  return box(row * ROW - (scroller?.scrollTop ?? 0), ROW) as DOMRect
}
window.Range.prototype.getBoundingClientRect = function (this: Range): DOMRect {
  const holder = this.startContainer.parentElement
  return (holder ? holder.getBoundingClientRect() : box(0, 0)) as DOMRect
}

/** A 500px reader whose content height follows its rows. */
function makeScroller(): HTMLElement {
  const el = document.createElement('div')
  el.className = 'smd-reader'
  document.body.appendChild(el)
  let top = 0
  const height = (): number => Math.max(VIEW, (el.querySelector('.smd-article')?.children.length ?? 0) * ROW)
  Object.defineProperty(el, 'clientHeight', { get: () => VIEW })
  Object.defineProperty(el, 'clientWidth', { get: () => 800 })
  Object.defineProperty(el, 'scrollHeight', { get: height })
  Object.defineProperty(el, 'scrollTop', {
    // Like a browser: content that got shorter pulls the position up with it.
    get: () => {
      top = Math.max(0, Math.min(top, height() - VIEW))
      return top
    },
    set: (v: number) => {
      top = Math.max(0, Math.min(v, height() - VIEW))
    }
  })
  el.scrollTo = ((opts: ScrollToOptions) => {
    el.scrollTop = opts.top ?? 0
  }) as typeof el.scrollTo
  scroller = el
  return el
}

interface Harness {
  reader: InstanceType<typeof ReaderController>
  el: HTMLElement
  infos: RenderInfo[]
  tasks: Array<[number, boolean]>
  links: string[]
  onInfo: (info: RenderInfo) => void
}

function harness(): Harness {
  const h: Harness = {
    infos: [],
    tasks: [],
    links: [],
    onInfo: () => undefined,
    el: makeScroller(),
    reader: new ReaderController({
      readImage: async () => null,
      onLink: (href) => h.links.push(href),
      onToggleTask: (line, checked) => h.tasks.push([line, checked]),
      onRenderInfo: (info) => {
        h.infos.push(info)
        h.onInfo(info)
      }
    })
  }
  h.reader.attach(h.el)
  return h
}

const READ: ReaderView = { mode: 'read', theme: 'light', blockRemoteImages: false }
const SPLIT: ReaderView = { ...READ, mode: 'split' }

function doc(md: string, id = '/notes/a.md'): { id: string; path: string; md: string } {
  return { id, path: id, md }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(check: () => boolean, ms = 15_000): Promise<void> {
  const until = Date.now() + ms
  while (!check()) {
    if (Date.now() > until) throw new Error('timed out')
    await sleep(10)
  }
}

function paragraphs(n: number, from = 0): string {
  return Array.from({ length: n }, (_, i) => `Paragraph ${from + i}.`).join('\n\n')
}

/** Just over 1 MB, so it renders progressively, in few (large) blocks. */
function largeDoc(tail = ''): string {
  const block = (i: number): string => `Block ${i} ` + 'lorem ipsum dolor sit amet '.repeat(40)
  return Array.from({ length: 1000 }, (_, i) => block(i)).join('\n\n') + tail
}

describe('ReaderController painting', () => {
  it('paints at once in Read view and reports the display fixes', () => {
    // Arrange
    const h = harness()
    // Act
    h.reader.update(doc('# Title\n\n```js\nconst open = true'), READ)
    // Assert
    assert.equal(h.el.querySelector('h1')?.textContent, 'Title')
    assert.equal(h.infos.length, 1)
    assert.deepEqual(h.infos[0].fixes, [FIX_FENCE])
    assert.equal(h.infos[0].painted, true)
    assert.equal(h.infos[0].complete, true)
    assert.equal(h.infos[0].id, '/notes/a.md')
  })

  it('skips the paint when nothing changed', () => {
    const h = harness()
    h.reader.update(doc('Hello'), READ)
    const article = h.reader.getArticle()
    h.reader.update(doc('Hello'), READ)
    assert.equal(h.infos.length, 1)
    assert.equal(h.reader.getArticle(), article)
  })

  it('lets the split preview trail typing, then reports the new paint', async () => {
    // Arrange
    const h = harness()
    h.reader.update(doc('One'), SPLIT)
    // Act
    h.reader.update(doc('One two'), SPLIT)
    // Assert: still the old text until the debounce fires
    assert.equal(h.reader.getArticle()?.textContent?.trim(), 'One')
    assert.equal(h.infos.length, 1)
    await waitFor(() => h.infos.length === 2)
    assert.equal(h.reader.getArticle()?.textContent?.trim(), 'One two')
    assert.equal(h.infos[1].painted, true)
  })

  it('reports an empty reader when the document closes', () => {
    const h = harness()
    h.reader.update(doc('Text'), READ)
    h.reader.update({ id: null, path: null, md: '' }, READ)
    assert.equal(h.reader.getArticle(), null)
    assert.deepEqual(h.infos.at(-1), { fixes: [], blockedImages: 0, id: null, painted: true, complete: true })
  })

  it('counts blocked remote images and reports 0 once they load', () => {
    // Arrange
    const h = harness()
    h.reader.update(doc('![Chart](https://x.example/a.png)\n\nBadge ![ci](https://x.example/b.svg)'), {
      ...READ,
      blockRemoteImages: true
    })
    assert.equal(h.infos[0].blockedImages, 2)
    // Act: the user clicks "Load images" on the card
    const button = h.el.querySelector<HTMLElement>('.smd-imgblocked-load')
    button?.click()
    // Assert
    assert.equal(h.el.querySelectorAll('img').length, 2)
    const last = h.infos.at(-1)
    assert.equal(last?.blockedImages, 0)
    assert.equal(last?.painted, false)
  })

  it('counts the remote images a diagram would load while they are blocked', () => {
    const h = harness()
    const md = '```mermaid\nflowchart LR\n  A@{ img: "https://x.example/t.png", label: "Logo" } --> B\n```'
    h.reader.update(doc(md), { ...READ, blockRemoteImages: true })
    assert.equal(h.infos[0].blockedImages, 1)
    assert.ok(h.el.querySelector('.smd-mermaid'))
  })

  it('puts the reading font on the reader without repainting', () => {
    const h = harness()
    h.reader.update(doc('# Hi'), { ...READ, readingFont: 'Serif' })
    const article = h.reader.getArticle()
    h.reader.update(doc('# Hi'), { ...READ, readingFont: 'Sans' })
    assert.equal(h.el.getAttribute('data-read-font'), 'sans')
    assert.equal(h.reader.getArticle(), article)
    assert.equal(h.infos.length, 1)
  })
})

describe('ReaderController clicks', () => {
  it('reports task clicks with the source line and the new state', () => {
    // Arrange
    const h = harness()
    h.reader.update(doc('Intro\n\n- [ ] first\n- [x] second'), READ)
    const boxes = Array.from(h.el.querySelectorAll<HTMLInputElement>('input.smd-task'))
    // Act
    boxes[0].click()
    boxes[1].click()
    // Assert
    assert.deepEqual(h.tasks, [
      [2, true],
      [3, false]
    ])
  })

  it('ignores task boxes without a source line', () => {
    const h = harness()
    h.reader.update(doc('<ul><li><input type="checkbox"> raw html</li></ul>'), READ)
    const box = h.el.querySelector<HTMLInputElement>('input[type=checkbox]')
    assert.ok(box?.disabled)
    box?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    assert.deepEqual(h.tasks, [])
  })

  it('hands web links to the App and scrolls to in-document anchors itself', () => {
    // Arrange
    const h = harness()
    h.reader.update(doc(`[web](https://example.com) [down](#target)\n\n${paragraphs(12)}\n\n## Target`), READ)
    const [web, down] = Array.from(h.el.querySelectorAll('a'))
    // Act
    web.click()
    down.click()
    // Assert
    assert.deepEqual(h.links, ['https://example.com'])
    assert.ok(h.el.scrollTop > 0, 'scrolled to the heading')
  })
})

describe('ReaderController scrolling', () => {
  it('maps lines to scroll offsets without echoing its own scrolls', () => {
    // Arrange
    const h = harness()
    h.reader.update(doc(paragraphs(20)), READ)
    let echoes = 0
    h.reader.onScroll(() => echoes++)
    // Act: a programmatic scroll, then the user scrolling
    h.reader.scrollToLine(8) // paragraph 4 starts on line 8
    h.el.dispatchEvent(new window.Event('scroll'))
    const programmatic = { top: h.el.scrollTop, echoes }
    h.el.scrollTop = 650
    h.el.dispatchEvent(new window.Event('scroll'))
    // Assert
    assert.deepEqual(programmatic, { top: 400, echoes: 0 })
    assert.equal(echoes, 1)
    assert.equal(h.reader.getTopLine(), 12.5, 'half way through paragraph 6 (lines 12-13)')
  })

  it('brings the line being read back after a repaint that renders progressively', async () => {
    // Arrange: deep inside a large document
    const h = harness()
    h.reader.update(doc(largeDoc()), READ)
    await waitFor(() => h.infos.at(-1)?.complete === true)
    h.reader.scrollToLine(1500)
    assert.equal(h.el.scrollTop, 750 * ROW)
    // Act: a theme switch repaints it from scratch, chunk by chunk
    h.reader.update(doc(largeDoc()), { ...READ, theme: 'dark' })
    const during = h.el.scrollTop
    await waitFor(() => h.infos.at(-1)?.complete === true)
    // Assert
    assert.ok(during < 750 * ROW, 'the first chunk alone is shorter')
    assert.equal(h.el.scrollTop, 750 * ROW)
  })

  it('knows when it is near the end and follows it', () => {
    const h = harness()
    h.reader.update(doc(paragraphs(30)), READ)
    assert.equal(h.reader.isNearEnd(), false)
    h.reader.scrollToEnd()
    assert.equal(h.el.scrollTop, 30 * ROW - VIEW)
    assert.equal(h.reader.isNearEnd(), true)
  })
})

describe('ReaderController changes', () => {
  it('marks the new text when called from onRenderInfo after a reload', () => {
    // Arrange
    const h = harness()
    h.reader.update(doc(paragraphs(5)), READ)
    let marked = -1
    h.onInfo = () => {
      marked = h.reader.showChanges([{ from: 10, to: 11 }])
    }
    // Act: the file grows by one paragraph (line 10)
    h.reader.update(doc(paragraphs(6)), READ)
    // Assert
    assert.equal(marked, 1)
    const changed = h.el.querySelectorAll('.smd-changed')
    assert.equal(changed.length, 1)
    assert.equal(changed[0].textContent, 'Paragraph 5.')
    assert.equal(h.reader.revealNextChange(), true)
  })

  it('paints a debounced split repaint first, so the marks land on the new text', () => {
    const h = harness()
    h.reader.update(doc(paragraphs(3)), SPLIT)
    h.reader.update(doc(paragraphs(4)), SPLIT)
    const count = h.reader.showChanges([{ from: 6, to: 7 }])
    assert.equal(count, 1)
    assert.equal(h.el.querySelector('.smd-changed')?.textContent, 'Paragraph 3.')
  })

  it('drops the marks on clearChanges and on switching documents', () => {
    const h = harness()
    h.reader.update(doc(paragraphs(3)), READ)
    h.reader.showChanges([{ from: 0, to: 1 }])
    h.reader.update(doc(paragraphs(3), '/notes/b.md'), READ)
    assert.equal(h.el.querySelectorAll('.smd-changed').length, 0)
    assert.equal(h.reader.revealNextChange(), false)
  })
})

describe('ReaderController find', () => {
  it('searches on a new query and steps through matches on the same one', () => {
    // Arrange
    const h = harness()
    h.reader.update(doc('Alpha beta.\n\nBeta gamma.\n\nGamma beta.'), READ)
    // Act + Assert
    assert.deepEqual(h.reader.find('beta'), { index: 1, total: 3 })
    assert.deepEqual(h.reader.find('beta'), { index: 2, total: 3 })
    assert.deepEqual(h.reader.find('beta', { backwards: true }), { index: 1, total: 3 })
    assert.deepEqual(h.reader.find('beta', { backwards: true }), { index: 3, total: 3 })
    assert.deepEqual(h.reader.find('gamma'), { index: 1, total: 2 })
    assert.deepEqual(h.reader.find(''), { index: 0, total: 0 })
  })

  it('tells an open find bar when a repaint changed the matches', () => {
    const h = harness()
    h.reader.update(doc('one fish'), READ)
    h.reader.find('fish')
    const results: Array<{ index: number; total: number }> = []
    h.reader.onFindResult((r) => results.push(r))
    h.reader.update(doc('one fish, two fish'), READ)
    assert.deepEqual(results, [{ index: 1, total: 2 }])
  })
})

describe('ReaderController with a large document', () => {
  it('reports the first part at once, then the complete document', async () => {
    // Arrange
    const h = harness()
    const md = largeDoc()
    // Act
    h.reader.update(doc(md), READ)
    // Assert
    assert.equal(h.infos.length, 1)
    assert.equal(h.infos[0].painted, true)
    assert.equal(h.infos[0].complete, false)
    const firstRows = h.reader.getArticle()?.children.length ?? 0
    assert.ok(firstRows > 0 && firstRows < 1000)
    assert.equal(h.reader.isNearEnd(), false, 'the end is not on screen yet')
    await waitFor(() => h.infos.at(-1)?.complete === true)
    assert.equal(h.reader.getArticle()?.children.length, 1000)
    assert.equal(h.infos.at(-1)?.painted, true)
  })

  it('follows the end through a progressive paint when asked from onRenderInfo', async () => {
    const h = harness()
    h.reader.update(doc(largeDoc()), READ)
    await waitFor(() => h.infos.at(-1)?.complete === true)
    h.reader.scrollToEnd()
    // The file grows; the App asks to follow the end once the paint is on screen.
    h.onInfo = (info) => {
      if (info.painted && !info.complete) h.reader.scrollToEnd()
    }
    h.reader.update(doc(largeDoc('\n\nThe newest line.')), READ)
    assert.equal(h.reader.isNearEnd(), true)
    await waitFor(() => h.infos.at(-1)?.complete === true)
    assert.equal(h.el.scrollTop, h.el.scrollHeight - VIEW)
    assert.match(h.reader.getArticle()?.lastElementChild?.textContent ?? '', /The newest line/)
  })

  it('keeps the DOM of the unchanged start when the same file grows', async () => {
    // Arrange
    const h = harness()
    h.reader.update(doc(largeDoc()), READ)
    await waitFor(() => h.infos.at(-1)?.complete === true)
    const article = h.reader.getArticle()
    const first = article?.firstElementChild
    // Act
    h.reader.update(doc(largeDoc('\n\nAppended paragraph.')), READ)
    // Assert: same article and nodes, new text at the end, complete at once
    assert.equal(h.reader.getArticle(), article)
    assert.equal(article?.firstElementChild, first)
    assert.equal(h.infos.at(-1)?.complete, true)
    assert.equal(article?.lastElementChild?.textContent, 'Appended paragraph.')
    assert.equal(article?.children.length, 1001)
  })

  it('renders the rest at once when an export needs the whole article', async () => {
    // Arrange
    const h = harness()
    h.reader.update(doc(largeDoc()), READ)
    assert.equal(h.infos.at(-1)?.complete, false)
    // Act
    await h.reader.prepareForExport()
    // Assert
    assert.equal(h.reader.getArticle()?.children.length, 1000)
    assert.equal(h.infos.at(-1)?.complete, true)
    assert.equal(h.reader.isNearEnd(), false)
  })

  it('marks changes in chunks that land after showChanges was called', async () => {
    const h = harness()
    h.reader.update(doc(largeDoc()), READ)
    const lastLine = 999 * 2
    assert.equal(h.reader.showChanges([{ from: lastLine, to: lastLine + 1 }]), 0)
    await waitFor(() => h.infos.at(-1)?.complete === true)
    assert.equal(h.el.querySelectorAll('.smd-changed').length, 1)
  })
})
