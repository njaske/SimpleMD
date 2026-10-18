import type { RecoveryEntry } from '@shared/types'
import { FileTextIcon } from '@/lib/icons'
import Dialog from './Dialog'

// Shown on launch when the last session ended with unsaved text. Restoring reopens
// every buffer as an unsaved tab; discarding forgets them.

export interface RecoveryPromptProps {
  entries: readonly RecoveryEntry[]
  onRestore: () => void
  onDiscard: () => void
}

const MAX_LISTED = 6

function when(savedAt: number): string {
  const date = new Date(savedAt)
  const sameDay = date.toDateString() === new Date().toDateString()
  return sameDay
    ? date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function RecoveryPrompt({ entries, onRestore, onDiscard }: RecoveryPromptProps) {
  const n = entries.length
  const title = n === 1 ? 'Recovered 1 unsaved document' : `Recovered ${n} unsaved documents`
  return (
    <Dialog
      title={title}
      onClose={onRestore}
      dismissOnScrim={false}
      actions={
        <>
          <button type="button" className="smd-btn" onClick={onDiscard}>
            Discard
          </button>
          <button type="button" className="smd-btn smd-btn--primary" onClick={onRestore} data-autofocus>
            Restore
          </button>
        </>
      }
    >
      <p>
        SimpleMD closed before {n === 1 ? 'this document was' : 'these documents were'} saved. Restore to pick up where
        you left off.
      </p>
      <ul className="smd-dialog-list">
        {entries.slice(0, MAX_LISTED).map((e) => (
          <li key={e.id}>
            <FileTextIcon size={14} />
            <span>{e.title || 'Untitled'}</span>
            <span>{when(e.savedAt)}</span>
          </li>
        ))}
        {n > MAX_LISTED && <li>and {n - MAX_LISTED} more</li>}
      </ul>
    </Dialog>
  )
}
