import type { KeyboardEvent } from 'react'
import type { ReadingFont, ThemeName } from '@shared/types'
import {
  FONT_LABELS,
  LINE_HEIGHTS,
  READING_FONTS,
  TEXT_SIZE,
  THEME_LABELS,
  THEME_ORDER,
  WIDTHS,
  nearest
} from '@/app/appearance'
import { MinusIcon, PlusIcon } from '@/lib/icons'
import Segmented from './Segmented'

// Reading controls shared by the Aa popover and Settings → Reading.

const FONTS: ReadingFont[] = ['Serif', 'Sans', 'Mono', 'Hyperlegible']

/** Arrow keys move and select inside a roving-focus radiogroup. */
export function radioKeys(e: KeyboardEvent<HTMLDivElement>, index: number, count: number, pick: (i: number) => void): void {
  const delta =
    e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
  if (!delta) return
  e.preventDefault()
  const next = (index + delta + count) % count
  pick(next)
  e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus()
}

export function ThemePicker({ value, onChange }: { value: ThemeName; onChange: (t: ThemeName) => void }) {
  const index = THEME_ORDER.indexOf(value)
  return (
    <div
      className="smd-theme-row"
      role="radiogroup"
      aria-label="Theme"
      onKeyDown={(e) => radioKeys(e, index, THEME_ORDER.length, (i) => onChange(THEME_ORDER[i]))}
    >
      {THEME_ORDER.map((t) => (
        <button
          key={t}
          type="button"
          role="radio"
          aria-checked={t === value}
          tabIndex={t === value ? 0 : -1}
          className="smd-theme-opt"
          onClick={() => onChange(t)}
        >
          <span className={`smd-theme-swatch smd-theme-swatch--${t}`} aria-hidden="true">
            Aa
          </span>
          {THEME_LABELS[t]}
        </button>
      ))}
    </div>
  )
}

export function FontPicker({ value, onChange }: { value: ReadingFont; onChange: (f: ReadingFont) => void }) {
  const index = FONTS.indexOf(value)
  return (
    <div
      className="smd-font-row"
      role="radiogroup"
      aria-label="Font"
      onKeyDown={(e) => radioKeys(e, index, FONTS.length, (i) => onChange(FONTS[i]))}
    >
      {FONTS.map((f) => (
        <button
          key={f}
          type="button"
          role="radio"
          aria-checked={f === value}
          tabIndex={f === value ? 0 : -1}
          className="smd-font-opt"
          onClick={() => onChange(f)}
          title={f === 'Hyperlegible' ? 'Atkinson Hyperlegible, designed for low vision readers' : undefined}
        >
          <span className="smd-font-sample" style={{ fontFamily: READING_FONTS[f] }} aria-hidden="true">
            Aa
          </span>
          <span style={{ fontFamily: READING_FONTS[f] }}>{FONT_LABELS[f]}</span>
        </button>
      ))}
    </div>
  )
}

export function SizeStepper({ value, onChange }: { value: number; onChange: (px: number) => void }) {
  return (
    <div className="smd-stepper">
      <button
        type="button"
        className="smd-btn smd-btn--sm"
        onClick={() => onChange(value - 1)}
        disabled={value <= TEXT_SIZE.min}
        aria-label="Smaller text"
      >
        <MinusIcon size={14} />
      </button>
      <output aria-live="polite" aria-label="Text size">
        {value}px
      </output>
      <button
        type="button"
        className="smd-btn smd-btn--sm"
        onClick={() => onChange(value + 1)}
        disabled={value >= TEXT_SIZE.max}
        aria-label="Bigger text"
      >
        <PlusIcon size={14} />
      </button>
    </div>
  )
}

export function LineHeightPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <Segmented
      label="Line height"
      block
      value={nearest(LINE_HEIGHTS, value).value}
      onChange={onChange}
      options={LINE_HEIGHTS.map((o) => ({ value: o.value, label: o.label }))}
    />
  )
}

export function WidthPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <Segmented
      label="Page width"
      block
      value={nearest(WIDTHS, value).value}
      onChange={onChange}
      options={WIDTHS.map((o) => ({ value: o.value, label: o.label }))}
    />
  )
}
