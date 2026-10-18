import { useLayoutEffect, useRef, useState } from 'react'
import { stemLength } from '@/app/model'

// The name field used for renames in the tree (and inside the rename dialog): the
// stem is selected, the message updates as you type, Enter commits, Esc cancels.

interface Props {
  initial: string
  /** Why the name can't be used, or null when it's fine. */
  validate: (name: string) => string | null
  onCommit: (name: string) => void
  onCancel: () => void
  /** Commit on blur (tree rows); dialogs leave blur alone. */
  commitOnBlur?: boolean
  className?: string
  label: string
  /** id of the element that shows the message, for aria-describedby. */
  errorId: string
  onError?: (message: string | null) => void
  onValue?: (value: string) => void
  /** Enter with the initial text commits too (new items with a suggested name). */
  allowUnchanged?: boolean
}

export default function InlineRename({
  initial,
  validate,
  onCommit,
  onCancel,
  commitOnBlur = true,
  className = 'smd-rename-input',
  label,
  errorId,
  onError,
  onValue,
  allowUnchanged = false
}: Props) {
  const ref = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(initial)
  const done = useRef(false)
  const unchanged = (name: string): boolean => name === initial && !allowUnchanged
  const error = unchanged(value) ? null : validate(value)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    el.setSelectionRange(0, stemLength(initial))
  }, [initial])

  const finish = (commit: boolean): void => {
    if (done.current) return
    const name = value.trim()
    if (commit && name && !unchanged(name) && !validate(name)) {
      done.current = true
      onCommit(name)
      return
    }
    if (commit && !unchanged(name) && validate(name)) return // keep editing; the message says why
    done.current = true
    onCancel()
  }

  return (
    <input
      ref={ref}
      className={className}
      value={value}
      spellCheck={false}
      aria-label={label}
      aria-invalid={!!error}
      aria-describedby={error ? errorId : undefined}
      onChange={(e) => {
        setValue(e.target.value)
        onValue?.(e.target.value)
        onError?.(unchanged(e.target.value) ? null : validate(e.target.value))
      }}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          e.stopPropagation()
          finish(true)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          finish(false)
        }
      }}
      onBlur={() => {
        if (!commitOnBlur) return
        // An invalid name on blur is dropped rather than leaving a stuck field.
        const name = value.trim()
        if (name === initial || validate(name)) {
          done.current = true
          onCancel()
        } else finish(true)
      }}
    />
  )
}
