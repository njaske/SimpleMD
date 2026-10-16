import type { SearchResult } from '@/lib/document'
import { FileIcon, SearchIcon } from '@/lib/icons'

interface Props {
  query: string
  result: SearchResult
  onInput: (value: string) => void
  onOpenGroup: (fileId: string) => void
  onGotoMatch: (fileId: string, line: number, col: number, len: number) => void
}

export default function SearchPanel({
  query,
  result,
  onInput,
  onOpenGroup,
  onGotoMatch
}: Props) {
  const hasQuery = query.trim().length > 0
  const summary =
    result.total +
    (result.total === 1 ? ' result in ' : ' results in ') +
    result.fileCount +
    (result.fileCount === 1 ? ' file' : ' files')

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ padding: '12px 12px 8px', flex: 'none' }}>
        <div className="smd-search-box">
          <SearchIcon size={15} sw={1.7} style={{ flex: 'none', color: 'var(--fg-faint)' }} />
          <input
            id="smd-search-input"
            type="search"
            value={query}
            onChange={(e) => onInput(e.target.value)}
            placeholder="Search all documents"
            aria-label="Search all documents"
            spellCheck={false}
          />
        </div>
        {hasQuery && (
          <div style={{ fontSize: 11.5, color: 'var(--fg-faint)', padding: '9px 2px 2px' }}>
            {summary}
          </div>
        )}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 6px 16px' }}>
        {result.groups.map((g) => (
          <div key={g.fileId} style={{ margin: '6px 0 2px' }}>
            <button
              className="smd-hovbg"
              onClick={() => onOpenGroup(g.fileId)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                padding: '6px 8px',
                borderRadius: 6,
                textAlign: 'left'
              }}
            >
              <FileIcon size={13} sw={1.5} style={{ flex: 'none', color: 'var(--fg-muted)' }} />
              <span
                style={{
                  flex: 1,
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: 'var(--fg)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
              >
                {g.fileName}
              </span>
              <span style={{ fontSize: 11, color: 'var(--fg-faint)' }}>{g.count}</span>
            </button>
            {g.matches.map((m) => (
              <button
                key={m.key}
                className="smd-hovbg"
                onClick={() => onGotoMatch(g.fileId, m.line, m.col, m.len)}
                style={{
                  width: '100%',
                  display: 'block',
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  padding: '4px 8px 4px 27px',
                  borderRadius: 6,
                  textAlign: 'left',
                  fontSize: 12,
                  lineHeight: 1.45,
                  color: 'var(--fg-muted)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
              >
                <span>{m.pre}</span>
                <span
                  style={{
                    background: 'var(--accent-soft)',
                    color: 'var(--fg)',
                    borderRadius: 3,
                    padding: '0 1px'
                  }}
                >
                  {m.mid}
                </span>
                <span>{m.post}</span>
              </button>
            ))}
          </div>
        ))}
        {hasQuery && result.groups.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--fg-faint)', fontSize: 12.5, padding: '30px 16px' }}>
            No matches found.
          </div>
        )}
        {!hasQuery && (
          <div style={{ textAlign: 'center', color: 'var(--fg-faint)', fontSize: 12.5, padding: '30px 16px' }}>
            Search across every open document.
          </div>
        )}
      </div>
    </div>
  )
}
