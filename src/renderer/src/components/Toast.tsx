import { useEffect, useRef } from 'react'

// One quiet message at a time, bottom-center, with an optional action. Hovering
// or focusing it holds the timer so an action button can't vanish under the pointer.

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

const TOAST_MS = 3200
const TOAST_WITH_ACTION_MS = 6500

export default function Toast({ toast, onDismiss }: Props) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const delay = toast.action ? TOAST_WITH_ACTION_MS : TOAST_MS

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
      <div
        key={toast.id}
        className="smd-toast"
        role="status"
        aria-live="polite"
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
