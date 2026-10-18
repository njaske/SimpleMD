import './support/aliases.ts'
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { Window } from 'happy-dom'

// CodeMirror needs a DOM: install happy-dom's before loading anything that builds a view.
const win = new Window()
Object.assign(globalThis, {
  window: win,
  document: win.document,
  Node: win.Node,
  Element: win.Element,
  HTMLElement: win.HTMLElement,
  MutationObserver: win.MutationObserver,
  getComputedStyle: win.getComputedStyle.bind(win),
  requestAnimationFrame: win.requestAnimationFrame.bind(win),
  cancelAnimationFrame: win.cancelAnimationFrame.bind(win)
})

type Handle = typeof import('../src/renderer/src/lib/editor/handle.ts')
type Panel = typeof import('../src/renderer/src/lib/editor/searchPanel.ts')
type Count = typeof import('../src/renderer/src/lib/editor/matchCount.ts')
type View = typeof import('@codemirror/view')
type State = typeof import('@codemirror/state')
type Search = typeof import('@codemirror/search')
let handles: Handle
let panel: Panel
let counts: Count
let cmView: View
let cmState: State
let cmSearch: Search

before(async () => {
  handles = await import('../src/renderer/src/lib/editor/handle.ts')
  panel = await import('../src/renderer/src/lib/editor/searchPanel.ts')
  counts = await import('../src/renderer/src/lib/editor/matchCount.ts')
  cmView = await import('@codemirror/view')
  cmState = await import('@codemirror/state')
  cmSearch = await import('@codemirror/search')
})

after(() => win.close())

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function editor(doc: string, anchor = 0, head = anchor) {
  const parent = win.document.createElement('div')
  win.document.body.appendChild(parent)
  return new cmView.EditorView({
    parent: parent as unknown as HTMLElement,
    state: cmState.EditorState.create({
      doc,
      selection: { anchor, head },
      extensions: [cmSearch.search({ top: true, createPanel: panel.createSearchPanel }), cmView.keymap.of(cmSearch.searchKeymap), cmState.EditorState.allowMultipleSelections.of(true)]
    })
  })
}

const scroll = (view: import('@codemirror/view').EditorView): boolean => view.scrollDOM.dispatchEvent(new win.Event('scroll') as unknown as Event)

describe('editor handle', () => {
  it('treats scroll events right after its own scroll as an echo, not the user', async () => {
    // Arrange
    const view = editor(Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n'))
    const { handle, destroy } = handles.createEditorHandle(view)
    let heard = 0
    handle.onScroll(() => heard++)
    // Act
    handle.scrollToLine(20)
    scroll(view)
    const duringQuiet = heard
    await wait(170)
    scroll(view)
    // Assert
    assert.equal(duringQuiet, 0)
    assert.equal(heard, 1)
    destroy()
    view.destroy()
  })

  it('stops telling listeners once they unsubscribe or the handle is destroyed', () => {
    const view = editor('a\nb')
    const { handle, destroy } = handles.createEditorHandle(view)
    let heard = 0
    const off = handle.onScroll(() => heard++)
    scroll(view)
    off()
    scroll(view)
    handle.onScroll(() => heard++)
    destroy()
    scroll(view)
    assert.equal(heard, 1)
    view.destroy()
  })

  it('ignores scroll targets that are not numbers', () => {
    const view = editor('a\nb')
    const { handle, destroy } = handles.createEditorHandle(view)
    let heard = 0
    handle.onScroll(() => heard++)
    handle.scrollToLine(Number.NaN)
    scroll(view)
    assert.equal(heard, 1)
    destroy()
    view.destroy()
  })

  it('reports the top line of an empty or unscrolled document as 0', () => {
    const empty = editor('')
    const text = editor('one\ntwo')
    assert.equal(handles.createEditorHandle(empty).handle.getTopLine(), 0)
    assert.equal(handles.createEditorHandle(text).handle.getTopLine(), 0)
    empty.destroy()
    text.destroy()
  })

  it('inserts text as one undoable edit at the selection', () => {
    const view = editor('hello world', 6, 11)
    handles.createEditorHandle(view).handle.insertText('there')
    assert.equal(view.state.doc.toString(), 'hello there')
    view.destroy()
  })

  it('opens the find panel prefilled with the selected word', () => {
    // Arrange
    const view = editor('find the cache, then the cache again', 9, 14)
    const { handle } = handles.createEditorHandle(view)
    // Act
    handle.openSearch()
    // Assert
    const input = view.dom.querySelector<HTMLInputElement>('.smd-search [name=search]')
    assert.ok(input)
    assert.equal(input.value, 'cache')
    assert.equal(cmSearch.searchPanelOpen(view.state), true)
    assert.equal(view.dom.querySelector('.smd-search__count-long')?.textContent, '1 of 2')
    view.destroy()
  })
})

describe('find panel', () => {
  function openPanel(doc: string) {
    const view = editor(doc)
    cmSearch.openSearchPanel(view)
    const dom = view.dom.querySelector('.smd-search')
    assert.ok(dom)
    const get = <T extends Element>(selector: string): T => {
      const found = dom.querySelector<T>(selector)
      assert.ok(found, selector)
      return found
    }
    const type = (value: string): void => {
      const input = get<HTMLInputElement>('[name=search]')
      input.value = value
      input.dispatchEvent(new win.Event('input') as unknown as Event)
    }
    return { view, get, type, count: () => get('.smd-search__count-long').textContent, short: () => get('.smd-search__count-short').textContent }
  }

  it('counts matches as you type and follows Next', () => {
    const { view, get, type, count } = openPanel('Cache cache CACHE')
    type('cache')
    assert.equal(count(), '3 matches')
    get<HTMLButtonElement>('[name=next]').click()
    assert.equal(count(), '1 of 3')
    view.destroy()
  })

  it('narrows with Match case and reports no results plainly', () => {
    const { view, get, type, count } = openPanel('Cache cache CACHE')
    type('cache')
    const matchCase = get<HTMLButtonElement>('[name=case]')
    matchCase.click()
    assert.equal(matchCase.getAttribute('aria-pressed'), 'true')
    assert.equal(count(), '1 match')
    type('nothing')
    assert.equal(count(), 'No results')
    assert.ok(get('.smd-search__count').classList.contains('is-none'))
    view.destroy()
  })

  it('flags a broken regular expression', () => {
    const { view, get, type, count } = openPanel('a(b')
    get<HTMLButtonElement>('[name=re]').click()
    type('a(b')
    assert.equal(count(), 'Invalid pattern')
    view.destroy()
  })

  it('replaces every match', () => {
    const { view, get, type } = openPanel('cat cat dog')
    type('cat')
    const replace = get<HTMLInputElement>('[name=replace]')
    replace.value = 'cow'
    replace.dispatchEvent(new win.Event('input') as unknown as Event)
    get<HTMLButtonElement>('[name=replaceAll]').click()
    assert.equal(view.state.doc.toString(), 'cow cow dog')
    view.destroy()
  })

  it('closes from its close button', () => {
    const { view, get } = openPanel('text')
    get<HTMLButtonElement>('[name=close]').click()
    assert.equal(cmSearch.searchPanelOpen(view.state), false)
    view.destroy()
  })

  it('gives every control a name a screen reader can say', () => {
    const { view } = openPanel('text')
    const unnamed = Array.from(view.dom.querySelectorAll('.smd-search button, .smd-search input')).filter((el) => !el.getAttribute('aria-label'))
    assert.deepEqual(unnamed, [])
    view.destroy()
  })

  /** Counts the search cursors the panel creates (each one is a scan of the document). */
  function spyOnScans(): { calls(): number; restore(): void } {
    const proto = cmSearch.SearchQuery.prototype
    const original = proto.getCursor
    let calls = 0
    proto.getCursor = function (this: import('@codemirror/search').SearchQuery, ...args: Parameters<typeof original>) {
      calls++
      return original.apply(this, args)
    }
    return { calls: () => calls, restore: () => void (proto.getCursor = original) }
  }

  it('moves through matches without scanning the document again', () => {
    // Arrange
    const { view, type, count } = openPanel('cache one cache two cache')
    type('cache')
    const scans = spyOnScans()
    try {
      // Act: selection-only updates, as arrow keys and clicks make.
      view.dispatch({ selection: { anchor: 10, head: 15 } })
      view.dispatch({ selection: { anchor: 3 } })
      view.dispatch({ selection: { anchor: 20, head: 25 } })
      // Assert
      assert.equal(scans.calls(), 0)
      assert.equal(count(), '3 of 3')
    } finally {
      scans.restore()
      view.destroy()
    }
  })

  it('recounts after a pause in typing, not on every keystroke', async () => {
    const { view, type, count } = openPanel('cat dog')
    type('cat')
    const scans = spyOnScans()
    try {
      for (const ch of ' cat') view.dispatch({ changes: { from: view.state.doc.length, insert: ch } })
      assert.equal(scans.calls(), 0)
      await wait(counts.RECOUNT_MS + 40)
      assert.equal(scans.calls(), 1)
      assert.equal(count(), '2 matches')
    } finally {
      scans.restore()
      view.destroy()
    }
  })

  it('counts a big document in the background', async () => {
    const { view, type, count } = openPanel('needle '.repeat(Math.ceil(counts.SYNC_LIMIT / 7) + 10))
    type('needle')
    assert.equal(count(), 'Counting…')
    await wait(counts.RECOUNT_MS + 200)
    assert.equal(count(), `${counts.MAX_COUNT}+ matches`)
    view.destroy()
  })

  it('tells a screen reader the count after panel actions only', () => {
    const { view, get, type } = openPanel('cache cache')
    const live = get('[aria-live]')
    assert.equal(get('.smd-search__count').getAttribute('aria-live'), null)
    type('cache')
    assert.equal(live.textContent, '2 matches')
    view.dispatch({ selection: { anchor: 0, head: 5 } })
    assert.equal(live.textContent, '2 matches', 'moving the caret stays quiet')
    get<HTMLButtonElement>('[name=next]').click()
    assert.equal(live.textContent, '2 of 2')
    view.destroy()
  })

  it('marks a broken pattern on the field and the input, not by colour alone', () => {
    const { view, get, type, short } = openPanel('a(b')
    get<HTMLButtonElement>('[name=re]').click()
    type('a(b')
    assert.ok(get('.smd-search__field').classList.contains('is-invalid'))
    assert.equal(get('[name=search]').getAttribute('aria-invalid'), 'true')
    assert.equal(short(), 'Invalid')
    type('a')
    assert.equal(get('[name=search]').getAttribute('aria-invalid'), null)
    view.destroy()
  })

  it('says Replace all deletes while the Replace field is empty', () => {
    const { view, get, type } = openPanel('cat cat')
    type('cat')
    assert.match(get('[name=replaceAll]').getAttribute('title') ?? '', /Delete every match/)
    const replace = get<HTMLInputElement>('[name=replace]')
    replace.value = 'dog'
    replace.dispatchEvent(new win.Event('input') as unknown as Event)
    assert.match(get('[name=replaceAll]').getAttribute('title') ?? '', /^Replace all/)
    view.destroy()
  })

  it('selects every match with Alt+Enter in the find field', () => {
    const { view, get, type } = openPanel('cat dog cat')
    type('cat')
    get('[name=search]').dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', altKey: true, bubbles: true }) as unknown as Event)
    assert.equal(view.state.selection.ranges.length, 2)
    view.destroy()
  })
})

describe('matchSummary', () => {
  it('stays quiet without a query and caps huge counts', () => {
    const state = cmState.EditorState.create({ doc: 'a'.repeat(counts.MAX_COUNT + 5) })
    assert.equal(counts.matchSummary(state, new cmSearch.SearchQuery({ search: '' })), '')
    assert.equal(counts.matchSummary(state, new cmSearch.SearchQuery({ search: 'a' })), `${counts.MAX_COUNT}+ matches`)
  })

  it('finds the current match by its exact range', () => {
    const list = { matches: [{ from: 0, to: 3 }, { from: 10, to: 13 }, { from: 20, to: 23 }], capped: false }
    assert.equal(counts.matchIndex(list, 10, 13), 1)
    assert.equal(counts.matchIndex(list, 10, 12), -1)
    assert.equal(counts.matchIndex(list, 5, 8), -1)
    assert.deepEqual(counts.summarize(list, { from: 20, to: 23 }), { kind: 'some', text: '3 of 3', short: '3/3' })
    assert.deepEqual(counts.summarize(list, { from: 4, to: 4 }), { kind: 'some', text: '3 matches', short: '3' })
  })
})
