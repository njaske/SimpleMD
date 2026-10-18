import { useId, useRef } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { trapTab, useFocusReturn } from '@/lib/a11y'

// Modal primitive: scrim, focus trap, Esc to close, focus restored on close.
// Plain dialogs pass a title and actions; custom sheets (Settings) pass `bare`
// and render their own surface as children.

export interface DialogProps {
  title?: string
  /** Accessible name when there is no visible title. */
  label?: string
  children?: ReactNode
  actions?: ReactNode
  onClose: () => void
  /** Clicking the scrim closes the dialog (default true). */
  dismissOnScrim?: boolean
  /** Render children as the whole surface (no default card). */
  bare?: boolean
  role?: 'dialog' | 'alertdialog'
}

export default function Dialog({
  title,
  label,
  children,
  actions,
  onClose,
  dismissOnScrim = true,
  bare = false,
  role = 'dialog'
}: DialogProps) {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useFocusReturn(ref)

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
      return
    }
    trapTab(e, ref.current)
  }

  return (
    <div className="smd-overlay" onKeyDown={onKeyDown}>
      <div className="smd-scrim" onClick={dismissOnScrim ? onClose : undefined} />
      <div className="smd-dialog-wrap" onClick={dismissOnScrim ? onClose : undefined}>
        <div
          ref={ref}
          role={role}
          aria-modal="true"
          aria-labelledby={title ? titleId : undefined}
          aria-label={title ? undefined : label}
          tabIndex={-1}
          className={bare ? undefined : 'smd-dialog'}
          style={bare ? { outline: 'none', display: 'contents' } : { outline: 'none' }}
          onClick={(e) => e.stopPropagation()}
        >
          {title && (
            <h2 id={titleId} className="smd-dialog-title">
              {title}
            </h2>
          )}
          {bare ? children : <div className="smd-dialog-body">{children}</div>}
          {actions && <div className="smd-dialog-actions">{actions}</div>}
        </div>
      </div>
    </div>
  )
}
