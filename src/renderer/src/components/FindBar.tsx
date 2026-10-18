// Find-in-document bar for the reader (Ctrl/Cmd+F while reading). Floats at the
// top-right of the reader pane: Enter / Shift+Enter step through matches, Esc closes
// (and clears the highlights).
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { FindResult, ReaderController } from '@/lib/reader/ReaderController'
import '@/styles/reader-ui.css'

export interface FindBarProps {
  reader: ReaderController
  /** Text to start with (e.g. the current selection). */
  initialQuery?: string
  onClose: () => void
}

const NONE: FindResult = { index: 0, total: 0 }

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

/** Put focus back where it was before the bar opened (usually the reader), so arrow
 *  and Page keys keep scrolling after Esc. Only when focus was in the bar: a click
 *  elsewhere that closed it keeps its own focus. */
function restoreFocus(before: Element | null, bar: HTMLElement | null, reader: ReaderController): void {
  const active = document.activeElement
  if (active && active !== document.body && !bar?.contains(active)) return
  const target = before instanceof HTMLElement && before.isConnected && before !== document.body
    ? before
    : reader.getArticle()?.closest<HTMLElement>('.smd-reader')
  target?.focus({ preventScroll: true })
}

function status(query: string, result: FindResult): string {
  if (!query) return ''
  if (!result.total) return 'No results'
  return `${result.index} of ${result.total}`
}

export default function FindBar({ reader, initialQuery = '', onClose }: FindBarProps) {
  const [query, setQuery] = useState(initialQuery)
  const [result, setResult] = useState<FindResult>(NONE)
  const input = useRef<HTMLInputElement>(null)
  const bar = useRef<HTMLDivElement>(null)
  // A search-as-you-type still waiting for typing to pause (huge documents only).
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Before focusing the input, remember what had focus.
  useEffect(() => {
    const before = document.activeElement
    const node = bar.current
    return () => restoreFocus(before, node, reader)
  }, [reader])

  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])

  const cancelPending = (): void => {
    if (pending.current) clearTimeout(pending.current)
    pending.current = null
  }

  // Search as you type; the reader keeps the first match at or below the viewport.
  useEffect(() => {
    const delay = query ? reader.findDelay() : 0
    if (!delay) {
      setResult(reader.find(query))
      return
    }
    pending.current = setTimeout(() => {
      pending.current = null
      setResult(reader.find(query))
    }, delay)
    return cancelPending
  }, [reader, query])

  // The document can repaint under the bar (live reload); keep the count honest, and
  // clear the highlights when the bar goes away.
  useEffect(() => {
    const unsubscribe = reader.onFindResult(setResult)
    return () => {
      unsubscribe()
      reader.clearFind()
    }
  }, [reader])

  const step = (backwards: boolean): void => {
    // A search still waiting runs now (find() searches when the query is new), so
    // Enter right after typing lands on the first match instead of skipping it.
    const searchFirst = pending.current !== null
    cancelPending()
    if (query) setResult(reader.find(query, searchFirst ? {} : { backwards }))
    input.current?.focus()
  }

  // On the whole bar, so Esc and Enter also work while a button has focus.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const mod = e.ctrlKey || e.metaKey
    const onButton = e.target instanceof HTMLButtonElement
    if ((e.key === 'Enter' && !onButton) || e.key === 'F3') {
      e.preventDefault()
      step(e.shiftKey)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
    } else if (mod && e.key.toLowerCase() === 'f') {
      // Find again while open: just re-select the query.
      e.preventDefault()
      input.current?.focus()
      input.current?.select()
    } else if (mod && e.key.toLowerCase() === 'g') {
      e.preventDefault()
      step(e.shiftKey)
    }
  }

  const label = status(query, result)
  const empty = !!query && !result.total

  return (
    <div ref={bar} className="smd-findbar smd-pop" role="search" aria-label="Find in document" onKeyDown={onKeyDown}>
      <div className={'smd-findbar-field' + (empty ? ' is-empty' : '')}>
        <svg className="smd-findbar-glass" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
          strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" />
          <path d="m20 20-4.4-4.4" />
        </svg>
        <input
          ref={input}
          className="smd-findbar-input"
          type="text"
          value={query}
          placeholder="Find in document"
          aria-label="Find in document"
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="smd-findbar-count" aria-live="polite">
          {label}
        </span>
      </div>
      <div className="smd-findbar-actions">
        <button type="button" className="smd-iconbtn smd-iconbtn--sm smd-findbar-btn" aria-label="Previous match"
          title="Previous match (Shift+Enter)" disabled={!result.total} onClick={() => step(true)}>
          <Icon d="m6 15 6-6 6 6" />
        </button>
        <button type="button" className="smd-iconbtn smd-iconbtn--sm smd-findbar-btn" aria-label="Next match"
          title="Next match (Enter)" disabled={!result.total} onClick={() => step(false)}>
          <Icon d="m6 9 6 6 6-6" />
        </button>
        <span className="smd-findbar-sep" aria-hidden="true" />
        <button type="button" className="smd-iconbtn smd-iconbtn--sm smd-findbar-btn" aria-label="Close find"
          title="Close (Esc)" onClick={onClose}>
          <Icon d="M7 7l10 10M17 7 7 17" />
        </button>
      </div>
    </div>
  )
}
