import { useLayoutEffect, useRef, useState } from 'react'
import type { ReadingFont, ThemeName } from '@shared/types'
import { trapTab, useFocusReturn, useOutsidePress } from '@/lib/a11y'
import { FontPicker, LineHeightPicker, SizeStepper, ThemePicker, WidthPicker } from './ReadingControls'

// The "Aa" popover: everything about how the page reads, one click from the text.

export interface ReadingValues {
  theme: ThemeName
  readingFont: ReadingFont
  readingSize: number
  lineHeight: number
  readingWidth: number
}

export interface ReadingPopoverProps extends ReadingValues {
  anchor: HTMLElement | null
  onTheme: (t: ThemeName) => void
  onFont: (f: ReadingFont) => void
  onSize: (px: number) => void
  onLineHeight: (v: number) => void
  onWidth: (px: number) => void
  onMore: () => void
  onClose: () => void
}

const GAP = 6
const MARGIN = 8

export default function ReadingPopover(p: ReadingPopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  const anchorRef = useRef<HTMLElement | null>(p.anchor)
  anchorRef.current = p.anchor
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  useFocusReturn(ref)
  useOutsidePress(ref, p.onClose, anchorRef)

  useLayoutEffect(() => {
    const place = (): void => {
      const r = p.anchor?.getBoundingClientRect()
      if (!r) return
      setPos({ top: r.bottom + GAP, right: Math.max(MARGIN, window.innerWidth - r.right) })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [p.anchor])

  return (
    <div
      ref={ref}
      className="smd-popover"
      role="dialog"
      aria-label="Reading settings"
      style={pos ? { top: pos.top, right: pos.right } : { opacity: 0 }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          p.onClose()
          return
        }
        trapTab(e, ref.current)
      }}
    >
      <div className="smd-pop-section">
        <div className="smd-pop-label">Theme</div>
        <ThemePicker value={p.theme} onChange={p.onTheme} />
      </div>
      <div className="smd-pop-section">
        <div className="smd-pop-label">Font</div>
        <FontPicker value={p.readingFont} onChange={p.onFont} />
      </div>
      <div className="smd-pop-section">
        <div className="smd-pop-label">Text size</div>
        <SizeStepper value={p.readingSize} onChange={p.onSize} />
      </div>
      <div className="smd-pop-section">
        <div className="smd-pop-label">Line height</div>
        <LineHeightPicker value={p.lineHeight} onChange={p.onLineHeight} />
      </div>
      <div className="smd-pop-section">
        <div className="smd-pop-label">Page width</div>
        <WidthPicker value={p.readingWidth} onChange={p.onWidth} />
      </div>
      <div className="smd-pop-foot">
        <button type="button" className="smd-link" onClick={p.onMore}>
          More reading settings
        </button>
      </div>
    </div>
  )
}
