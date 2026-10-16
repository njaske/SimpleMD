import type { ReadingFont } from '@shared/types'

export const ACCENT_OPTIONS = ['#c0392b', '#d97706', '#2b6cb0', '#2f855a', '#7c3aed']
const FONT_OPTIONS: ReadingFont[] = ['Sans', 'Serif', 'Mono']

interface Props {
  accent: string
  readingFont: ReadingFont
  readingWidth: number
  onAccent: (value: string) => void
  onFont: (value: ReadingFont) => void
  onWidth: (value: number) => void
}

export default function Preferences({
  accent,
  readingFont,
  readingWidth,
  onAccent,
  onFont,
  onWidth
}: Props) {
  return (
    <div
      className="smd-pop"
      role="group"
      aria-label="Reading preferences"
      style={{
        position: 'absolute',
        top: 38,
        right: 0,
        zIndex: 30,
        width: 244,
        background: 'var(--bg)',
        border: '1px solid var(--border-strong)',
        borderRadius: 10,
        boxShadow: '0 12px 34px rgba(0,0,0,.18)',
        padding: '12px 14px'
      }}
    >
      <div
        style={{
          fontSize: 10.5,
          fontWeight: 600,
          letterSpacing: '.08em',
          textTransform: 'uppercase',
          color: 'var(--fg-faint)',
          paddingBottom: 8
        }}
      >
        Reading
      </div>

      <div className="smd-pref-row">
        <span className="smd-pref-label">Accent</span>
        <div style={{ display: 'flex', gap: 8 }}>
          {ACCENT_OPTIONS.map((c) => (
            <button
              key={c}
              className={'smd-swatch' + (accent.toLowerCase() === c.toLowerCase() ? ' is-active' : '')}
              style={{ background: c }}
              onClick={() => onAccent(c)}
              title={c}
              aria-label={`Accent ${c}`}
            />
          ))}
        </div>
      </div>

      <div className="smd-pref-row">
        <span className="smd-pref-label">Font</span>
        <div style={{ display: 'flex', gap: 6 }}>
          {FONT_OPTIONS.map((f) => (
            <button
              key={f}
              className={'smd-chip' + (readingFont === f ? ' is-active' : '')}
              onClick={() => onFont(f)}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="smd-pref-row">
        <span className="smd-pref-label">Width</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            className="smd-range"
            type="range"
            min={600}
            max={900}
            step={10}
            value={readingWidth}
            aria-label="Reading width"
            aria-valuetext={`${readingWidth} pixels`}
            onChange={(e) => onWidth(Number(e.target.value))}
          />
          <span style={{ fontSize: 11.5, color: 'var(--fg-faint)', width: 38, textAlign: 'right' }}>
            {readingWidth}
          </span>
        </div>
      </div>
    </div>
  )
}
