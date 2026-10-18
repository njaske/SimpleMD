import { useEffect, useRef } from 'react'

// One quiet message at a time, bottom-center, with an optional action. Hovering
// or focusing it holds the timer so an action button can't vanish under the pointer.
// Screen readers hear it through ToastAnnouncer: a live region has to exist before
// its text arrives to be announced reliably.

export interface ToastAction {
  label: string
  run: () => void
}

export interface ToastState {
  id: number
  message: string
  action?: ToastAction
}

interface Props {
  toast: ToastState
  onDismiss: (id: number) => void
}

/** Long enough to read: a reading pace per character, within sensible bounds. An
 *  action gets extra time so it can be reached. */
const MIN_MS = 4000
const MIN_WITH_ACTION_MS = 6500
const MAX_MS = 12000
const MS_PER_CHAR = 65

export function toastDuration(message: string, hasAction: boolean): number {
  const floor = hasAction ? MIN_WITH_ACTION_MS : MIN_MS
  return Math.min(MAX_MS, Math.max(floor, message.length * MS_PER_CHAR))
}

export default function Toast({ toast, onDismiss }: Props) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const delay = toastDuration(toast.message, !!toast.action)

  const start = (): void => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => onDismiss(toast.id), delay)
  }
  const hold = (): void => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }

  useEffect(() => {
    start()
    return hold
    // Restart only for a new toast.
  }, [toast.id])

  return (
    <div className="smd-toast-wrap">
      {/* Announced through ToastAnnouncer, which is always mounted. */}
      <div
        key={toast.id}
        className="smd-toast"
        onPointerEnter={hold}
        onPointerLeave={start}
        onFocus={hold}
        onBlur={start}
      >
        <span className="smd-toast-msg">{toast.message}</span>
        {toast.action && (
          <button
            type="button"
            className="smd-toast-action"
            onClick={() => {
              onDismiss(toast.id)
              toast.action?.run()
            }}
          >
            {toast.action.label}
          </button>
        )}
      </div>
    </div>
  )
}

/** Always-mounted polite live region that speaks each toast. Keyed by id, so the
 *  same message twice is still announced. */
export function ToastAnnouncer({ toast }: { toast: ToastState | null }) {
  return (
    <div className="smd-sr-only" role="status" aria-live="polite" aria-atomic="true">
      {toast && <span key={toast.id}>{toast.message}</span>}
    </div>
  )
}
