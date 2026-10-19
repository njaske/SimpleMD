import { memo, useCallback, useRef, useState, type KeyboardEvent } from 'react'
import { useOutsidePress } from '@/lib/a11y'

// Slim, optional status line: where you are and whether it's saved on the left;
// chips (display fixes, changes) and reading stats on the right.

export interface StatusBarProps {
  folder: string
  file: string
  /** null when there is no document. */
  saveState: 'saved' | 'unsaved' | 'new' | null
  words: number
  minutes: number
  /** "Fixed for display" repairs in the current document (chip hidden when empty). */
  fixes?: readonly string[]
  /** Remote images held back in this document (chip hidden at 0). */
  blockedImages?: number
  onLoadImages?: () => void
  /** Changes marked since the file reloaded from disk (chip hidden at 0). */
  changes?: number
  /** Where the chip's click goes ("Next change", or "Show changes" from Edit). */
  changesHint?: string
  onChanges?: () => void
}

const SAVE_LABEL = { saved: 'Saved', unsaved: 'Unsaved', new: 'Not saved yet' } as const
const FIXES_ID = 'smd-fixes-list'

function fixesLabel(n: number): string {
  return `Fixed ${n} ${n === 1 ? 'issue' : 'issues'} for display`
}

/** The chip and its list of repairs (the file itself is never changed). The list is a
 *  plain disclosure under the chip; Esc or a press outside folds it. */
function FixesChip({ fixes }: { fixes: readonly string[] }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useOutsidePress(box, close)
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || !open) return
    e.stopPropagation()
    setOpen(false)
  }
  return (
    <div ref={box} className="smd-fixes" onKeyDown={onKeyDown}>
      <button
        type="button"
        className="smd-chip smd-chip--accent"
        aria-expanded={open}
        aria-controls={FIXES_ID}
        title={fixes.join('\n')}
        onClick={() => setOpen((v) => !v)}
      >
        {fixesLabel(fixes.length)}
      </button>
      {open && (
        // A disclosure, not a dialog: focus stays on the chip, which toggles it.
        <div id={FIXES_ID} className="smd-fixes-pop smd-pop" role="region" aria-label="Fixed for display">
          <p className="smd-fixes-lead">Shown with these small repairs. The file itself is unchanged.</p>
          <ul>
            {fixes.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function StatusBar({
  folder,
  file,
  saveState,
  words,
  minutes,
  fixes = [],
  blockedImages = 0,
  onLoadImages,
  changes = 0,
  changesHint,
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
        {fixes.length > 0 && <FixesChip fixes={fixes} />}
        {blockedImages > 0 && (
          <button
            type="button"
            className="smd-chip"
            onClick={onLoadImages}
            title="Load this document's remote images once"
          >
            {blockedImages} remote {blockedImages === 1 ? 'image' : 'images'} blocked · Load
          </button>
        )}
        {changes > 0 && (
          <button type="button" className="smd-chip smd-chip--changed" onClick={onChanges} title={changesHint}>
            <span className="smd-chip-dot" aria-hidden="true" />
            {changes} {changes === 1 ? 'change' : 'changes'}
          </button>
        )}
        {saveState && (
          <span className="smd-status-stats">
            {words.toLocaleString()} {words === 1 ? 'word' : 'words'} · {minutes} min read
          </span>
        )}
      </div>
    </footer>
  )
}

export default memo(StatusBar)
