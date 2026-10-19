import type { Platform } from '@shared/types'
import { formatShortcut } from '@/lib/logic/platform'

// "What changed" strip along the top of the reader pane, in the flow so it never sits
// on the text. Presentational: the App owns the change ranges and decides when to show it.

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
      <span className="smd-changebar-text">
        <span className="smd-changebar-count">
          {count} {count === 1 ? 'change' : 'changes'}
        </span>
        <span className="smd-changebar-since"> since you last looked</span>
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
