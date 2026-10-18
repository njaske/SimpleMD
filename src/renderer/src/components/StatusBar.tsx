import { memo } from 'react'

// Slim, optional status line: where you are and whether it's saved on the left;
// chips (display fixes, changes) and reading stats on the right.

export interface StatusBarProps {
  folder: string
  file: string
  /** null when there is no document. */
  saveState: 'saved' | 'unsaved' | 'new' | null
  words: number
  minutes: number
  /** Number of "fixed for display" repairs in the current document (chip hidden at 0). */
  fixes?: number
  onFixes?: () => void
  /** Number of changes highlighted since the last look (chip hidden at 0). */
  changes?: number
  onChanges?: () => void
}

const SAVE_LABEL = { saved: 'Saved', unsaved: 'Unsaved', new: 'Not saved yet' } as const

function StatusBar({
  folder,
  file,
  saveState,
  words,
  minutes,
  fixes = 0,
  onFixes,
  changes = 0,
  onChanges
}: StatusBarProps) {
  return (
    <footer className="smd-status" aria-label="Status">
      <div className="smd-status-path">
        {folder && <span>{folder}</span>}
        {folder && file && (
          <span className="smd-status-sep" aria-hidden="true">
            ›
          </span>
        )}
        {file && <span className="smd-status-file">{file}</span>}
      </div>
      {saveState && (
        <span className={'smd-status-state' + (saveState === 'saved' ? '' : ' smd-status-state--unsaved')}>
          {saveState !== 'saved' && <span className="smd-chip-dot" aria-hidden="true" />}
          {SAVE_LABEL[saveState]}
        </span>
      )}
      <div className="smd-status-right">
        {fixes > 0 && (
          <button
            type="button"
            className="smd-chip smd-chip--accent"
            onClick={onFixes}
            title="Shown with small display fixes; the file is unchanged"
          >
            Fixed for display · {fixes}
          </button>
        )}
        {changes > 0 && (
          <button type="button" className="smd-chip smd-chip--changed" onClick={onChanges}>
            <span className="smd-chip-dot" aria-hidden="true" />
            {changes} {changes === 1 ? 'change' : 'changes'}
          </button>
        )}
        {saveState && (
          <span>
            {words.toLocaleString()} {words === 1 ? 'word' : 'words'} · {minutes} min read
          </span>
        )}
      </div>
    </footer>
  )
}

export default memo(StatusBar)
