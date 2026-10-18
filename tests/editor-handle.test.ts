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
type View = typeof import('@codemirror/view')
type State = typeof import('@codemirror/state')
type Search = typeof import('@codemirror/search')
let handles: Handle
let panel: Panel
let cmView: View
let cmState: State
let cmSearch: Search

before(async () => {
  handles = await import('../src/renderer/src/lib/editor/handle.ts')
  panel = await import('../src/renderer/src/lib/editor/searchPanel.ts')
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
      extensions: [cmSearch.search({ top: true, createPanel: panel.createSearchPanel }), cmView.keymap.of(cmSearch.searchKeymap)]
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
    assert.equal(view.dom.querySelector('.smd-search__count')?.textContent, '1 of 2')
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
    return { view, get, type, count: () => get('.smd-search__count').textContent }
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
})

describe('matchSummary', () => {
  it('stays quiet without a query and caps huge counts', () => {
    const state = cmState.EditorState.create({ doc: 'a'.repeat(panel.MAX_COUNT + 5) })
    assert.equal(panel.matchSummary(state, new cmSearch.SearchQuery({ search: '' })), '')
    assert.equal(panel.matchSummary(state, new cmSearch.SearchQuery({ search: 'a' })), `${panel.MAX_COUNT}+ matches`)
  })
})
