// The find panel's match count, kept off the typing path. Matches are listed once per
// query and document (capped), and moving the cursor only looks itself up in that list.
// Edits shift the list along and recount after a pause; big documents count in short
// slices so holding a key down never waits on a scan.
import type { ChangeDesc, EditorState } from '@codemirror/state'
import type { SearchQuery } from '@codemirror/search'

/** Counting stops here, so a huge document never stalls typing in the panel. */
export const MAX_COUNT = 1000
/** Documents up to this many characters are counted at once (a few milliseconds). */
export const SYNC_LIMIT = 100_000
/** Quiet time after an edit (or a query change in a big document) before recounting. */
export const RECOUNT_MS = 120
const SLICE_MS = 8

interface Match {
  readonly from: number
  readonly to: number
}

export interface MatchList {
  /** In document order, at most MAX_COUNT. */
  readonly matches: readonly Match[]
  readonly capped: boolean
}

export type SummaryKind = 'empty' | 'invalid' | 'pending' | 'none' | 'some'

export interface Summary {
  readonly kind: SummaryKind
  /** "3 of 21", "21 matches", "No results"… */
  readonly text: string
  /** The same for a narrow pane: "3/21", "21", "0"… */
  readonly short: string
}

const EMPTY: Summary = { kind: 'empty', text: '', short: '' }
const INVALID: Summary = { kind: 'invalid', text: 'Invalid pattern', short: 'Invalid' }
const PENDING: Summary = { kind: 'pending', text: 'Counting…', short: '…' }
const NONE: Summary = { kind: 'none', text: 'No results', short: '0' }

type Cursor = Iterator<Match>

/** Pull matches from `cursor` onto `found` until done, capped, or `deadline` passes. */
function pull(cursor: Cursor, found: Match[], deadline = Infinity): boolean {
  for (let n = 0; found.length < MAX_COUNT; n++) {
    // Checking the clock every few matches keeps the check itself cheap.
    if (n % 64 === 63 && performance.now() > deadline) return false
    const next = cursor.next()
    if (next.done) return true
    found.push({ from: next.value.from, to: next.value.to })
  }
  return true
}

export function listMatches(state: EditorState, query: SearchQuery): MatchList {
  const found: Match[] = []
  pull(query.getCursor(state), found)
  return { matches: found, capped: found.length >= MAX_COUNT }
}

/** Index of the match exactly covering [from, to], or -1 (binary search by start). */
export function matchIndex(list: MatchList, from: number, to: number): number {
  let lo = 0
  let hi = list.matches.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const m = list.matches[mid]
    if (m.from < from) lo = mid + 1
    else if (m.from > from) hi = mid - 1
    else return m.to === to ? mid : -1
  }
  return -1
}

export function summarize(list: MatchList, selection: { from: number; to: number }): Summary {
  const total = list.matches.length
  if (total === 0) return NONE
  const count = list.capped ? `${MAX_COUNT}+` : String(total)
  const current = matchIndex(list, selection.from, selection.to) + 1
  if (current) return { kind: 'some', text: `${current} of ${count}`, short: `${current}/${count}` }
  return { kind: 'some', text: total === 1 ? '1 match' : `${count} matches`, short: count }
}

/** "3 of 12", "12 matches", "No results"; empty while there is nothing to find. */
export function matchSummary(state: EditorState, query: SearchQuery): string {
  if (!query.search) return ''
  if (!query.valid) return INVALID.text
  return summarize(listMatches(state, query), state.selection.main).text
}

/** Keeps the match list for one panel. `onChange` runs when a count lands later. */
export class MatchCounter {
  private list: MatchList | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private generation = 0
  private readonly onChange: () => void

  constructor(onChange: () => void) {
    this.onChange = onChange
  }

  summary(state: EditorState, query: SearchQuery): Summary {
    if (!query.search) return EMPTY
    if (!query.valid) return INVALID
    return this.list ? summarize(this.list, state.selection.main) : PENDING
  }

  /** A new query: small documents count now, big ones after a pause, in slices. */
  queryChanged(state: EditorState, query: SearchQuery): void {
    this.cancel()
    this.list = null
    if (!query.search || !query.valid) return
    if (state.doc.length <= SYNC_LIMIT) this.list = listMatches(state, query)
    else this.schedule(state, query)
  }

  /** An edit: shift the old list along so the count stays close, then recount. */
  docChanged(changes: ChangeDesc, state: EditorState, query: SearchQuery): void {
    this.cancel()
    if (!query.search || !query.valid) return
    if (this.list) {
      const matches = this.list.matches
        .map((m) => ({ from: changes.mapPos(m.from, 1), to: changes.mapPos(m.to, -1) }))
        .filter((m) => m.to > m.from)
      this.list = { matches, capped: this.list.capped }
    }
    this.schedule(state, query)
  }

  destroy(): void {
    this.cancel()
  }

  private cancel(): void {
    this.generation++
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }

  private schedule(state: EditorState, query: SearchQuery): void {
    const generation = this.generation
    this.timer = setTimeout(() => this.count(generation, query.getCursor(state), []), RECOUNT_MS)
  }

  private count(generation: number, cursor: Cursor, found: Match[]): void {
    if (generation !== this.generation) return
    if (!pull(cursor, found, performance.now() + SLICE_MS)) {
      this.timer = setTimeout(() => this.count(generation, cursor, found), 0)
      return
    }
    this.timer = null
    this.list = { matches: found, capped: found.length >= MAX_COUNT }
    this.onChange()
  }
}
