import { useState } from 'react'
import { FileTextIcon } from '@/lib/icons'
import Dialog from './Dialog'
import InlineRename from './InlineRename'

// The App's small modal prompts, all built on Dialog.

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger,
  safeDefault = false,
  onConfirm,
  onCancel
}: {
  title: string
  message: string
  confirmLabel: string
  danger?: boolean
  /** Focus Cancel instead of the confirm button. */
  safeDefault?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Dialog
      title={title}
      role="alertdialog"
      onClose={onCancel}
      actions={
        <>
          <button type="button" className="smd-btn" onClick={onCancel} data-autofocus={safeDefault || undefined}>
            Cancel
          </button>
          <button
            type="button"
            className={'smd-btn ' + (danger ? 'smd-btn--danger' : 'smd-btn--primary')}
            onClick={onConfirm}
            data-autofocus={!safeDefault || undefined}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <p>{message}</p>
    </Dialog>
  )
}

/** "Save changes to …?" for closing tabs (one or several). */
export function UnsavedDialog({
  names,
  onSave,
  onDiscard,
  onCancel
}: {
  names: string[]
  onSave: () => void
  onDiscard: () => void
  onCancel: () => void
}) {
  const one = names.length === 1
  const title = one ? `Save changes to “${names[0]}”?` : `Save changes to ${names.length} documents?`
  return (
    <Dialog
      title={title}
      role="alertdialog"
      onClose={onCancel}
      actions={
        <>
          <button type="button" className="smd-btn" onClick={onDiscard}>
            Don’t save
          </button>
          <span className="smd-spacer" />
          <button type="button" className="smd-btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="smd-btn smd-btn--primary" onClick={onSave} data-autofocus>
            {one ? 'Save' : 'Save all'}
          </button>
        </>
      }
    >
      <p>Your changes will be lost if you don’t save them.</p>
      {!one && <FileList names={names} />}
    </Dialog>
  )
}

const MAX_LISTED = 8

function FileList({ names }: { names: string[] }) {
  return (
    <ul className="smd-dialog-list">
      {names.slice(0, MAX_LISTED).map((n, i) => (
        <li key={`${n}-${i}`}>
          <FileTextIcon size={14} />
          <span>{n}</span>
        </li>
      ))}
      {names.length > MAX_LISTED && <li>and {names.length - MAX_LISTED} more</li>}
    </ul>
  )
}

/** The window is closing with unsaved edits. */
export function CloseWindowDialog({
  names,
  onSave,
  onDiscard,
  onCancel
}: {
  names: string[]
  onSave: () => void
  onDiscard: () => void
  onCancel: () => void
}) {
  const n = names.length
  return (
    <Dialog
      title="Save changes before closing?"
      role="alertdialog"
      onClose={onCancel}
      dismissOnScrim={false}
      actions={
        <>
          <button type="button" className="smd-btn" onClick={onDiscard}>
            Don’t save
          </button>
          <span className="smd-spacer" />
          <button type="button" className="smd-btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="smd-btn smd-btn--primary" onClick={onSave} data-autofocus>
            Save all and close
          </button>
        </>
      }
    >
      <p>{n === 1 ? '1 document has' : `${n} documents have`} unsaved changes.</p>
      <FileList names={names} />
    </Dialog>
  )
}

/** A name field in a dialog: rename when the tree row isn't visible, or a new folder. */
export function NameDialog({
  title,
  label,
  initial,
  confirmLabel,
  isNew = false,
  validate,
  onSubmit,
  onCancel
}: {
  title: string
  label: string
  initial: string
  confirmLabel: string
  /** A new item: the suggested name can be accepted as is. */
  isNew?: boolean
  validate: (name: string) => string | null
  onSubmit: (name: string) => void
  onCancel: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [value, setValue] = useState(initial)
  const submit = (): void => {
    const name = value.trim()
    const problem = validate(name)
    if (problem) {
      setError(problem)
      return
    }
    onSubmit(name)
  }
  return (
    <Dialog
      title={title}
      onClose={onCancel}
      actions={
        <>
          <button type="button" className="smd-btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="smd-btn smd-btn--primary"
            onClick={submit}
            disabled={!value.trim() || !!error || (!isNew && value.trim() === initial)}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <InlineRename
        initial={initial}
        className="smd-input"
        label={label}
        errorId="smd-name-error"
        commitOnBlur={false}
        allowUnchanged={isNew}
        validate={validate}
        onError={(m) => setError(m)}
        onCommit={(name) => onSubmit(name)}
        onCancel={onCancel}
        onValue={setValue}
      />
      <div id="smd-name-error" className="smd-field-error" role="alert">
        {error ?? ''}
      </div>
    </Dialog>
  )
}
