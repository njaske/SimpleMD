import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { Window } from 'happy-dom'
import './support/aliases.ts'
import { fakeHost } from './support/fakeHost.ts'
import type * as NavModule from '../src/renderer/src/app/changeNav.ts'
import type * as BridgeModule from '../src/renderer/src/app/readerBridge.ts'
import type { LineRange } from '../src/renderer/src/lib/ranges.ts'

// "What changed" counted and stepped through as people see it: a run of adjacent
// marked blocks is one change, and Next goes from run to run.
const win = new Window()
Object.assign(globalThis, { window: win, document: win.document })

let nav: typeof NavModule
let bridgeMod: typeof BridgeModule
before(async () => {
  nav = await import('../src/renderer/src/app/changeNav.ts')
  bridgeMod = await import('../src/renderer/src/app/readerBridge.ts')
})

/** An article of blocks; `spec` per block: '+' marked, '-' not, '~' fading out,
 *  and a nested string for a list of items. */
function article(spec: Array<string | string[]>): HTMLElement {
  const root = win.document.createElement('article') as unknown as HTMLElement
  let line = 0
  const block = (tag: string, mark: string): HTMLElement => {
    const el = win.document.createElement(tag) as unknown as HTMLElement
    el.setAttribute('data-line', String(line))
    el.setAttribute('data-line-end', String(line + 1))
    line += 2
    if (mark !== '-') el.classList.add('smd-changed')
    if (mark === '~') el.classList.add('smd-changed-out')
    return el
  }
  for (const s of spec) {
    if (typeof s === 'string') {
      root.appendChild(block('p', s))
      continue
    }
    const list = block('ul', '-')
    s.forEach((m) => list.appendChild(block('li', m)))
    root.appendChild(list)
  }
  return root
}

/** A scroller of `height` px showing `view` px, with each group's first block at `tops`. */
function scroller(height: number, view: number, scrollTop = 0) {
  const el = win.document.createElement('div') as unknown as HTMLElement
  const moves: number[] = []
  Object.defineProperties(el, {
    scrollHeight: { value: height },
    clientHeight: { value: view },
    scrollTop: { value: scrollTop, writable: true }
  })
  el.getBoundingClientRect = () => ({ top: 0 }) as DOMRect
  el.scrollTo = ((opts: ScrollToOptions) => {
    moves.push(opts.top ?? 0)
    el.scrollTop = opts.top ?? 0
  }) as typeof el.scrollTo
  return { el, moves }
}

/** Place the article's blocks: block i at `tops[i]` in scroll content px. */
function place(root: HTMLElement, box: HTMLElement, tops: number[]): void {
  const blocks = [...root.children].flatMap((b) => (b.tagName === 'UL' ? [...b.children] : [b]))
  blocks.forEach((b, i) => {
    ;(b as HTMLElement).getBoundingClientRect = () => ({ top: tops[i] - box.scrollTop }) as DOMRect
  })
}

describe('changeGroups', () => {
  it('counts a run of adjacent marked blocks as one change', () => {
    const groups = nav.changeGroups(article(['+', '+', '+', '-', '+']))

    assert.deepEqual(
      groups.map((g) => g.length),
      [3, 1]
    )
  })

  it('joins list items with the blocks around them and ignores fading marks', () => {
    const groups = nav.changeGroups(article(['+', ['+', '+'], '-', ['-', '~'], '+']))

    assert.deepEqual(
      groups.map((g) => g.length),
      [3, 1]
    )
  })

  it('finds nothing in an unmarked article', () => {
    assert.deepEqual(nav.changeGroups(article(['-', '-'])), [])
  })
})

describe('ChangeCursor.next', () => {
  it('goes to the first change below the reading spot, then steps on and wraps', () => {
    // Arrange: changes at 300 and 1200 in a 3000px document, reading from the top.
    const root = article(['-', '+', '-', '+', '-'])
    const { el, moves } = scroller(3000, 600)
    place(root, el, [0, 300, 700, 1200, 2000])
    const cursor = new nav.ChangeCursor()

    // Act
    cursor.next(root, el)
    cursor.next(root, el)
    cursor.next(root, el)

    // Assert: each stop leaves a little room above the change.
    assert.deepEqual(moves, [252, 1152, 252])
  })

  it('still does something after following the end: the change at the bottom flashes', () => {
    // Arrange: the reader is at the very end, where the only change already shows.
    const root = article(['-', '-', '+'])
    const { el, moves } = scroller(2000, 600, 1400)
    place(root, el, [0, 900, 1800])
    const cursor = new nav.ChangeCursor()

    // Act
    const found = cursor.next(root, el)

    // Assert: nowhere to scroll, but the change is pointed out.
    assert.equal(found, true)
    assert.deepEqual(moves, [])
    assert.ok(root.children[2].classList.contains(nav.LANDED))
    cursor.dispose()
    assert.equal(root.children[2].classList.contains(nav.LANDED), false)
  })

  it('from the end, goes back up to an earlier change instead of standing still', () => {
    const root = article(['-', '+', '-', '+'])
    const { el, moves } = scroller(2400, 600, 1800)
    place(root, el, [0, 500, 1200, 1900])
    const cursor = new nav.ChangeCursor()

    cursor.next(root, el)
    cursor.next(root, el)

    assert.deepEqual(moves, [452, 1800])
  })

  it('starts again from the reading spot once the user has scrolled away', () => {
    const root = article(['+', '-', '+', '-', '+'])
    const { el, moves } = scroller(4000, 600)
    place(root, el, [0, 500, 1000, 1500, 2000])
    const cursor = new nav.ChangeCursor()
    cursor.next(root, el)

    el.scrollTop = 1600
    cursor.next(root, el)

    assert.deepEqual(moves.at(-1), 1952)
  })

  it('reports false when nothing is marked', () => {
    const root = article(['-'])
    const { el } = scroller(1000, 600)

    assert.equal(new nav.ChangeCursor().next(root, el), false)
  })
})

describe('the bridge counts changes as runs', () => {
  it('shows one change for an agent appending several paragraphs', async () => {
    // Arrange: the reader marks every block the ranges touch.
    const root = article(['-', '-', '-', '-', '-'])
    const fake = await fakeHost({ activeId: '/a.md', viewMode: 'read', contents: { '/a.md': 'a\n' } })
    Object.assign(fake.host, {
      reader: {
        isNearEnd: () => false,
        scrollToEnd: () => undefined,
        clearChanges: () => undefined,
        getArticle: () => root,
        showChanges: (ranges: LineRange[]) => {
          const hit = [...root.children].filter((b) => {
            const at = Number(b.getAttribute('data-line'))
            return ranges.some((r) => at >= r.from && at < r.to)
          })
          hit.forEach((b) => b.classList.add('smd-changed'))
          return hit.length
        }
      }
    })
    const bridge = new bridgeMod.ReaderBridge(fake.host, async () => () => [{ from: 4, to: 10 }])

    // Act
    bridge.beforeReload([{ id: '/a.md', before: 'a\n', after: 'a\nb\n' }])()
    await new Promise((r) => setTimeout(r, 0))

    // Assert: three paragraphs marked, one change.
    assert.equal(root.querySelectorAll('.smd-changed').length, 3)
    assert.equal(fake.state().changes['/a.md'], 1)
  })
})
