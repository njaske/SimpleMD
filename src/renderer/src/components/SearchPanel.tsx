import { memo } from 'react'
import type { SearchResult } from '@/lib/document'
import { FileTextIcon, SearchIcon } from '@/lib/icons'

interface Props {
  query: string
  result: SearchResult
  onInput: (value: string) => void
  onOpenGroup: (fileId: string) => void
  onGotoMatch: (fileId: string, line: number, col: number, len: number) => void
}

export const SEARCH_INPUT_ID = 'smd-search-input'

function SearchPanel({ query, result, onInput, onOpenGroup, onGotoMatch }: Props) {
  const hasQuery = query.trim().length > 0
  const summary = `${result.total} ${result.total === 1 ? 'result' : 'results'} in ${result.fileCount} ${result.fileCount === 1 ? 'file' : 'files'}`

  return (
    <div className="smd-side-body">
      <div className="smd-search-head">
        <div className="smd-search-box">
          <SearchIcon size={15} />
          <input
            id={SEARCH_INPUT_ID}
            type="search"
            value={query}
            onChange={(e) => onInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && query) {
                e.preventDefault()
                e.stopPropagation()
                onInput('')
              }
            }}
            placeholder="Search all documents"
            aria-label="Search all documents"
            spellCheck={false}
          />
        </div>
        {hasQuery && (
          <div className="smd-search-summary" role="status">
            {summary}
          </div>
        )}
      </div>
      <div className="smd-scroll">
        {result.groups.map((g) => (
          <div key={g.fileId}>
            <button type="button" className="smd-result-file" onClick={() => onOpenGroup(g.fileId)} title={g.fileId}>
              <FileTextIcon size={14} className="smd-row-icon" />
              <span className="smd-row-name">{g.fileName}</span>
              <span className="smd-folder-count">{g.count}</span>
            </button>
            {g.matches.map((m) => (
              <button
                type="button"
                key={m.key}
                className="smd-result"
                onClick={() => onGotoMatch(g.fileId, m.line, m.col, m.len)}
                aria-label={`Line ${m.line + 1}: ${m.pre}${m.mid}${m.post}`}
              >
                {m.pre}
                <mark>{m.mid}</mark>
                {m.post}
              </button>
            ))}
          </div>
        ))}
        {hasQuery && result.groups.length === 0 && (
          <div className="smd-panel-note">No matches for “{query.trim()}”.</div>
        )}
        {!hasQuery && <div className="smd-panel-note">Search the text of every document in the sidebar.</div>}
      </div>
    </div>
  )
}

export default memo(SearchPanel)
