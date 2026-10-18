// The editor's find and replace panel, in place of CodeMirror's default: a compact
// two-row bar that stays two rows in a narrow Split pane. The find field carries the
// match count and the Match case / Whole word / Regex toggles; Previous, Next, Select all
// and Close are icon buttons. Keys and commands are CodeMirror's own.
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
import { MatchCounter, type Summary } from './matchCount'

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

/** A text button that turns into its icon in a narrow pane (the name stays the same). */
function replaceButton(name: string, label: string, icon: IconName, run: () => void): HTMLButtonElement {
  const button = el('button', 'smd-search__btn', { type: 'button', name, 'aria-label': label, title: label }, [
    el('span', 'smd-search__long', {}, [label]),
    el('span', 'smd-search__short', {}, [strokeIcon(icon, 16)])
  ])
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

const key = (s: string): string => formatShortcut(s, currentPlatform())

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
  private readonly countLong = el('span', 'smd-search__count-long')
  private readonly countShort = el('span', 'smd-search__count-short', { 'aria-hidden': 'true' })
  private readonly count = el('span', 'smd-search__count', {}, [this.countLong, this.countShort])
  // Screen readers hear the count after the user's own panel actions, not on every caret move.
  private readonly announcer = el('span', 'smd-sr-only', { 'aria-live': 'polite' })
  private readonly field = el('div', 'smd-search__field', {}, [this.search, this.count, el('span', 'smd-search__toggles', {}, [this.matchCase, this.wholeWord, this.regexp])])
  private readonly replaceButtons: readonly HTMLButtonElement[]
  private readonly counter = new MatchCounter(() => this.render())
  private announce = false

  constructor(view: EditorView) {
    this.view = view
    this.query = getSearchQuery(view.state)
    this.search.setAttribute('main-field', 'true')
    this.replaceButtons = [
      replaceButton('replace', 'Replace', 'replace', () => replaceNext(view)),
      replaceButton('replaceAll', 'Replace all', 'replaceAll', () => replaceAll(view))
    ]
    const rows = [this.findRow(), ...(view.state.readOnly ? [] : [this.replaceRow()])]
    this.dom = el('div', 'smd-search', { role: 'search', 'aria-label': 'Find in document' }, [...rows, this.announcer])
    this.dom.addEventListener('keydown', (e) => this.keydown(e))
    for (const field of [this.search, this.replace]) field.addEventListener('input', () => this.commit())
    for (const button of [this.matchCase, this.wholeWord, this.regexp]) button.addEventListener('click', () => this.commit())
    this.fill(this.query)
    this.counter.queryChanged(view.state, this.query)
    this.render()
  }

  private findRow(): HTMLElement {
    return el('div', 'smd-search__row', {}, [
      this.field,
      el('div', 'smd-search__actions', {}, [
        iconButton('prev', 'chevronUp', `Previous match (${key('Shift+Enter')})`, () => this.step(findPrevious)),
        iconButton('next', 'chevronDown', `Next match (${key('Enter')})`, () => this.step(findNext)),
        iconButton('select', 'selectAll', `Select all matches (${key('Alt+Enter')})`, () => selectMatches(this.view)),
        iconButton('close', 'close', `Close (${key('Escape')})`, () => closeSearchPanel(this.view))
      ])
    ])
  }

  private replaceRow(): HTMLElement {
    return el('div', 'smd-search__row', {}, [
      el('div', 'smd-search__field', {}, [this.replace]),
      el('div', 'smd-search__actions smd-search__actions--replace', {}, [...this.replaceButtons])
    ])
  }

  /** Previous or Next from the panel: worth telling a screen reader where it landed. */
  private step(command: (view: EditorView) => boolean): void {
    this.announce = true
    command(this.view)
  }

  private commit(): void {
    const query = new SearchQuery({
      search: this.search.value,
      replace: this.replace.value,
      caseSensitive: pressed(this.matchCase),
      wholeWord: pressed(this.wholeWord),
      regexp: pressed(this.regexp)
    })
    this.describeReplace(query)
    if (query.eq(this.query)) return
    const searchChanged = !this.sameSearch(query)
    this.query = query
    if (searchChanged) {
      this.announce = true
      this.counter.queryChanged(this.view.state, query)
    }
    this.view.dispatch({ effects: setSearchQuery.of(query) })
  }

  /** Only the replacement text changed: the matches are the same, so keep the count. */
  private sameSearch(query: SearchQuery): boolean {
    const old = this.query
    return old.search === query.search && old.caseSensitive === query.caseSensitive && old.wholeWord === query.wholeWord && old.regexp === query.regexp
  }

  private keydown(e: KeyboardEvent): void {
    if (runScopeHandlers(this.view, e, 'search-panel')) {
      e.preventDefault()
    } else if (e.key === 'Enter' && e.target === this.search) {
      e.preventDefault()
      if (e.altKey) selectMatches(this.view)
      else this.step(e.shiftKey ? findPrevious : findNext)
    } else if (e.key === 'Enter' && e.target === this.replace) {
      e.preventDefault()
      ;(e.altKey && (e.ctrlKey || e.metaKey) ? replaceAll : replaceNext)(this.view)
    }
  }

  private fill(query: SearchQuery): void {
    this.search.value = query.search
    this.replace.value = query.replace
    this.matchCase.setAttribute('aria-pressed', String(query.caseSensitive))
    this.wholeWord.setAttribute('aria-pressed', String(query.wholeWord))
    this.regexp.setAttribute('aria-pressed', String(query.regexp))
    this.describeReplace(query)
  }

  /** With an empty Replace field the buttons delete; their tooltips say so. */
  private describeReplace(query: SearchQuery): void {
    const deletes = query.replace === ''
    const [one, all] = this.replaceButtons
    one.title = deletes ? 'Delete the current match (Replace is empty)' : `Replace (${key('Enter')} in Replace)`
    all.title = deletes ? 'Delete every match (Replace is empty)' : `Replace all (${key('Mod+Alt+Enter')} in Replace)`
  }

  private render(): void {
    const summary = this.counter.summary(this.view.state, this.query)
    this.showCount(summary)
    if (this.announce && summary.kind !== 'pending') {
      this.announce = false
      this.announcer.textContent = summary.text
    }
  }

  private showCount(summary: Summary): void {
    if (this.countLong.textContent !== summary.text) this.countLong.textContent = summary.text
    if (this.countShort.textContent !== summary.short) this.countShort.textContent = summary.short
    this.count.title = summary.text
    this.count.classList.toggle('is-empty', summary.kind === 'empty')
    this.count.classList.toggle('is-none', summary.kind === 'none' || summary.kind === 'invalid')
    this.field.classList.toggle('is-invalid', summary.kind === 'invalid')
    if (summary.kind === 'invalid') this.search.setAttribute('aria-invalid', 'true')
    else this.search.removeAttribute('aria-invalid')
  }

  update(update: ViewUpdate): void {
    const queries = update.transactions.flatMap((tr) => tr.effects.filter((e) => e.is(setSearchQuery)))
    const latest = queries.length ? getSearchQuery(update.state) : null
    if (latest && !latest.eq(this.query)) {
      // Set from outside (Mod+F with a selection, Mod+D, …): show it in the fields.
      this.query = latest
      this.fill(latest)
      this.counter.queryChanged(update.state, latest)
    } else if (update.docChanged) {
      this.counter.docChanged(update.changes, update.state, this.query)
    }
    if (latest || update.docChanged || update.selectionSet) this.render()
  }

  mount(): void {
    this.search.select()
  }

  destroy(): void {
    this.counter.destroy()
  }
}

export function createSearchPanel(view: EditorView): Panel {
  return new SearchPanel(view)
}
