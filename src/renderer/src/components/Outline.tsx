import type { OutlineItem } from '@/state/viewmodel'

interface Props {
  outline: OutlineItem[]
  onJump: (slug: string) => void
}

export default function Outline({ outline, onJump }: Props) {
  return (
    <div
      className="smd-outline"
      style={{
        width: 240,
        flex: 'none',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-elev)',
        borderLeft: '1px solid var(--border)',
        minHeight: 0
      }}
    >
      <div
        style={{
          height: 40,
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          padding: '0 14px',
          borderBottom: '1px solid var(--border)'
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '.09em',
            textTransform: 'uppercase',
            color: 'var(--fg-muted)'
          }}
        >
          Outline
        </span>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 8px 30px' }}>
        {outline.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--fg-faint)', padding: '8px 10px' }}>
            No headings in this document.
          </div>
        ) : (
          outline.map((o) => (
            <button
              key={o.key}
              className="smd-olitem"
              onClick={() => onJump(o.slug)}
              style={{
                padding: `5px 8px 5px ${8 + (o.level - 1) * 15}px`,
                fontSize: o.level <= 1 ? 13 : o.level === 2 ? 12.5 : 12,
                fontWeight: o.level <= 2 ? 600 : 400,
                color: o.level === 1 ? 'var(--fg)' : 'var(--fg-muted)'
              }}
            >
              {o.text}
            </button>
          ))
        )}
      </div>
    </div>
  )
}
