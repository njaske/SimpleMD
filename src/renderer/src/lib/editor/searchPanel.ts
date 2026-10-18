// The editor's find and replace panel, in place of CodeMirror's default: a compact
// two-row bar that stays two rows in a narrow Split pane. The find field carries the
// match count and the Match case / Whole word / Regex toggles; Previous, Next, Select all
// and Close are icon buttons. Keys and commands are CodeMirror's own.
import type { EditorState } from '@codemirror/state'
import { runScopeHandlers, type EditorView, type Panel, type ViewUpdate } from '@codemirror/view'
import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  replaceAll,
  replaceNext,
  SearchQuery,
  selectMatches,
  setSearchQuery
} from '@codemirror/search'
import type { Platform } from '@shared/types'
import { formatShortcut } from '@/lib/logic/platform'
import { strokeIcon, type IconName } from './domIcons'

/** Counting stops here, so a huge document never stalls typing in the panel. */
export const MAX_COUNT = 1000

/** "3 of 12", "12 matches", "No results"; empty while there is nothing to find. */
export function matchSummary(state: EditorState, query: SearchQuery): string {
  if (!query.search) return ''
  if (!query.valid) return 'Invalid pattern'
  const { from, to } = state.selection.main
  const cursor = query.getCursor(state)
  let total = 0
  let current = 0
  for (let next = cursor.next(); !next.done && total < MAX_COUNT; next = cursor.next()) {
    total++
    if (next.value.from === from && next.value.to === to) current = total
  }
  if (total === 0) return 'No results'
  const count = total >= MAX_COUNT ? `${MAX_COUNT}+` : String(total)
  if (current) return `${current} of ${count}`
  return total === 1 ? '1 match' : `${count} matches`
}

type Attrs = Record<string, string>

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, attrs: Attrs = {}, children: readonly (Node | string)[] = []): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.className = className
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value))
  node.append(...children)
  return node
}

function iconButton(name: string, icon: IconName, label: string, run: () => void): HTMLButtonElement {
  const button = el('button', `smd-search__icon smd-search__icon--${name}`, { type: 'button', name, 'aria-label': label, title: label }, [strokeIcon(icon, 16)])
  button.addEventListener('click', run)
  return button
}

function toggle(name: string, label: string, glyph: string): HTMLButtonElement {
  const button = el('button', `smd-search__toggle smd-search__toggle--${name}`, { type: 'button', name, 'aria-label': label, title: label, 'aria-pressed': 'false' }, [glyph])
  button.addEventListener('click', () => button.setAttribute('aria-pressed', String(button.getAttribute('aria-pressed') !== 'true')))
  return button
}

function textField(name: string, label: string): HTMLInputElement {
  return el('input', 'smd-search__input', { type: 'text', name, placeholder: label, 'aria-label': label, autocomplete: 'off', spellcheck: 'false' })
}

const pressed = (button: HTMLButtonElement): boolean => button.getAttribute('aria-pressed') === 'true'

function currentPlatform(): Platform {
  return typeof window !== 'undefined' && window.api ? window.api.platform : 'win32'
}

class SearchPanel implements Panel {
  readonly dom: HTMLElement
  readonly top = true
  private readonly view: EditorView
  private query: SearchQuery
  private readonly search = textField('search', 'Find')
  private readonly replace = textField('replace', 'Replace')
  private readonly matchCase = toggle('case', 'Match case', 'Aa')
  private readonly wholeWord = toggle('word', 'Whole word', 'ab')
  private readonly regexp = toggle('re', 'Regular expression', '.*')
  private readonly count = el('span', 'smd-search__count', { 'aria-live': 'polite' })

  constructor(view: EditorView) {
    this.view = view
    this.query = getSearchQuery(view.state)
    this.search.setAttribute('main-field', 'true')
    this.dom = el('div', 'smd-search', { role: 'search', 'aria-label': 'Find in document' }, [this.findRow(), ...(view.state.readOnly ? [] : [this.replaceRow()])])
    this.dom.addEventListener('keydown', (e) => this.keydown(e))
    for (const field of [this.search, this.replace]) field.addEventListener('input', () => this.commit())
    for (const button of [this.matchCase, this.wholeWord, this.regexp]) button.addEventListener('click', () => this.commit())
    this.show(this.query)
  }

  private findRow(): HTMLElement {
    const key = (s: string): string => formatShortcut(s, currentPlatform())
    const view = this.view
    const toggles = el('span', 'smd-search__toggles', {}, [this.matchCase, this.wholeWord, this.regexp])
    return el('div', 'smd-search__row', {}, [
      el('div', 'smd-search__field', {}, [this.search, this.count, toggles]),
      el('div', 'smd-search__actions', {}, [
        iconButton('prev', 'chevronUp', `Previous match (${key('Shift+Enter')})`, () => findPrevious(view)),
        iconButton('next', 'chevronDown', `Next match (${key('Enter')})`, () => findNext(view)),
        iconButton('select', 'selectAll', 'Select all matches', () => selectMatches(view)),
        iconButton('close', 'close', `Close (${key('Escape')})`, () => closeSearchPanel(view))
      ])
    ])
  }

  private replaceRow(): HTMLElement {
    const textButton = (name: string, label: string, short: string, run: () => void): HTMLButtonElement => {
      const button = el('button', 'smd-search__btn', { type: 'button', name, 'aria-label': label, title: label }, [
        el('span', 'smd-search__long', {}, [label]),
        el('span', 'smd-search__short', { 'aria-hidden': 'true' }, [short])
      ])
      button.addEventListener('click', run)
      return button
    }
    return el('div', 'smd-search__row', {}, [
      el('div', 'smd-search__field', {}, [this.replace]),
      el('div', 'smd-search__actions smd-search__actions--replace', {}, [
        textButton('replace', 'Replace', 'Replace', () => replaceNext(this.view)),
        textButton('replaceAll', 'Replace all', 'All', () => replaceAll(this.view))
      ])
    ])
  }

  private commit(): void {
    const query = new SearchQuery({
      search: this.search.value,
      replace: this.replace.value,
      caseSensitive: pressed(this.matchCase),
      wholeWord: pressed(this.wholeWord),
      regexp: pressed(this.regexp)
    })
    if (query.eq(this.query)) return
    this.query = query
    this.view.dispatch({ effects: setSearchQuery.of(query) })
  }

  private keydown(e: KeyboardEvent): void {
    if (runScopeHandlers(this.view, e, 'search-panel')) {
      e.preventDefault()
    } else if (e.key === 'Enter' && e.target === this.search) {
      e.preventDefault()
      ;(e.shiftKey ? findPrevious : findNext)(this.view)
    } else if (e.key === 'Enter' && e.target === this.replace) {
      e.preventDefault()
      replaceNext(this.view)
    }
  }

  private show(query: SearchQuery): void {
    this.search.value = query.search
    this.replace.value = query.replace
    this.matchCase.setAttribute('aria-pressed', String(query.caseSensitive))
    this.wholeWord.setAttribute('aria-pressed', String(query.wholeWord))
    this.regexp.setAttribute('aria-pressed', String(query.regexp))
    this.refreshCount()
  }

  private refreshCount(): void {
    const text = matchSummary(this.view.state, this.query)
    if (this.count.textContent !== text) this.count.textContent = text
    this.count.classList.toggle('is-none', text === 'No results' || text === 'Invalid pattern')
  }

  update(update: ViewUpdate): void {
    const queries = update.transactions.flatMap((tr) => tr.effects.filter((e) => e.is(setSearchQuery)))
    const latest = queries.length ? getSearchQuery(update.state) : null
    if (latest && !latest.eq(this.query)) {
      // Set from outside (Mod+F with a selection, Mod+D, …): show it in the fields.
      this.query = latest
      this.show(latest)
    } else if (latest || update.docChanged || update.selectionSet) {
      this.refreshCount()
    }
  }

  mount(): void {
    this.search.select()
  }
}

export function createSearchPanel(view: EditorView): Panel {
  return new SearchPanel(view)
}
