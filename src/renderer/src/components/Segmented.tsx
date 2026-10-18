import { useRef } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'

// A segmented control (radio group): one tab stop, arrow keys move and select.

export interface SegmentOption<T extends string | number> {
  value: T
  label: ReactNode
  title?: string
  /** Accessible name when `label` isn't plain text. */
  ariaLabel?: string
}

interface Props<T extends string | number> {
  options: readonly SegmentOption<T>[]
  value: T
  onChange: (value: T) => void
  label: string
  /** Stretch to the container width. */
  block?: boolean
}

export default function Segmented<T extends string | number>({ options, value, onChange, label, block }: Props<T>) {
  const ref = useRef<HTMLDivElement>(null)
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value)
  )

  const onKeyDown = (e: KeyboardEvent): void => {
    const delta =
      e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!delta) return
    e.preventDefault()
    const next = (index + delta + options.length) % options.length
    onChange(options[next].value)
    ref.current?.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus()
  }

  return (
    <div
      ref={ref}
      className={'smd-seg-group' + (block ? ' smd-seg-group--block' : '')}
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
    >
      {options.map((o, i) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={i === index}
          aria-label={o.ariaLabel}
          tabIndex={i === index ? 0 : -1}
          className="smd-seg"
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
