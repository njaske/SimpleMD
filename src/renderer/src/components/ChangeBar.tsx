import type { Platform } from '@shared/types'
import { formatShortcut } from '@/lib/logic/platform'

// "What changed" bar floating at the top of the reader pane. Presentational: the
// App owns the change ranges and decides when to show it.

export interface ChangeBarProps {
  count: number
  platform: Platform
  onNext: () => void
  onDismiss: () => void
}

export default function ChangeBar({ count, platform, onNext, onDismiss }: ChangeBarProps) {
  return (
    <div
      className="smd-changebar"
      role="status"
      aria-live="polite"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          onDismiss()
        }
      }}
    >
      <span className="smd-changebar-dot" aria-hidden="true" />
      <span className="smd-changebar-count">
        {count} {count === 1 ? 'change' : 'changes'}
      </span>
      <button
        type="button"
        className="smd-btn smd-btn--ghost smd-btn--sm"
        onClick={onNext}
        title={`Next change (${formatShortcut('Alt+N', platform)})`}
      >
        Next <span className="smd-kbd">{formatShortcut('Alt+N', platform)}</span>
      </button>
      <button type="button" className="smd-btn smd-btn--ghost smd-btn--sm" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  )
}
