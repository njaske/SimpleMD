import { useEffect, useRef } from 'react'
import { CloseIcon } from '@/lib/icons'

// One quiet message at a time, bottom-center. A plain message times out (hovering or
// focusing holds the timer); one with an action stays until it is used, dismissed or
// replaced, so it can be reached at any pace (F6 jumps to the action). Screen readers
// hear it through ToastAnnouncer: a live region has to exist before its text arrives
// to be announced reliably.

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

/** Long enough to read: a reading pace per character, within sensible bounds. */
const MIN_MS = 4000
const MAX_MS = 12000
const MS_PER_CHAR = 65
/** Moves keyboard focus to a toast's action button. */
export const TOAST_ACTION_KEY = 'F6'

/** How long a toast stays up; null for one with an action (it waits for the user). */
export function toastDuration(message: string, hasAction: boolean): number | null {
  if (hasAction) return null
  return Math.min(MAX_MS, Math.max(MIN_MS, message.length * MS_PER_CHAR))
}

export default function Toast({ toast, onDismiss }: Props) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const actionRef = useRef<HTMLButtonElement>(null)
  const delay = toastDuration(toast.message, !!toast.action)

  const start = (): void => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = delay === null ? null : setTimeout(() => onDismiss(toast.id), delay)
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

  // F6 reaches the action from anywhere, without tabbing through the whole window.
  useEffect(() => {
    if (!toast.action) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== TOAST_ACTION_KEY || e.ctrlKey || e.metaKey || e.altKey) return
      e.preventDefault()
      actionRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toast.id, toast.action])

  return (
    <div className="smd-toast-wrap">
      {/* Announced through ToastAnnouncer, which is always mounted. */}
      <div
        key={toast.id}
        className={'smd-toast' + (toast.action ? ' smd-toast--action' : '')}
        onPointerEnter={hold}
        onPointerLeave={start}
        onFocus={hold}
        onBlur={start}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return
          e.stopPropagation()
          onDismiss(toast.id)
        }}
      >
        <span className="smd-toast-msg">{toast.message}</span>
        {toast.action && (
          <>
            <button
              ref={actionRef}
              type="button"
              className="smd-toast-action"
              aria-keyshortcuts={TOAST_ACTION_KEY}
              onClick={() => {
                onDismiss(toast.id)
                toast.action?.run()
              }}
            >
              {toast.action.label}
            </button>
            <button
              type="button"
              className="smd-toast-close"
              aria-label="Dismiss"
              title="Dismiss"
              onClick={() => onDismiss(toast.id)}
            >
              <CloseIcon size={14} sw={1.8} />
            </button>
          </>
        )}
      </div>
    </div>
  )
}

/** Always-mounted polite live region that speaks each toast. Keyed by id, so the
 *  same message twice is still announced. */
export function ToastAnnouncer({ toast }: { toast: ToastState | null }) {
  const hint = toast?.action ? ` Press ${TOAST_ACTION_KEY} for ${toast.action.label.replace(/…$/, '')}.` : ''
  return (
    <div className="smd-sr-only" role="status" aria-live="polite" aria-atomic="true">
      {toast && <span key={toast.id}>{toast.message + hint}</span>}
    </div>
  )
}
