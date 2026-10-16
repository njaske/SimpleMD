interface Props {
  statusLeft: string
  dirty: boolean
  words: number
  minutes: number
  lines: number
  modeLabel: string
}

export default function StatusBar({
  statusLeft,
  dirty,
  words,
  minutes,
  lines,
  modeLabel
}: Props) {
  return (
    <div
      className="smd-status"
      style={{
        height: 26,
        flex: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 14px',
        background: 'var(--bg-elev)',
        borderTop: '1px solid var(--border)',
        fontSize: 11.5,
        color: 'var(--fg-muted)',
        userSelect: 'none'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <span
            style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)', flex: 'none' }}
          />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {statusLeft}
          </span>
        </span>
        {dirty && <span style={{ color: 'var(--accent)', flex: 'none' }}>Unsaved</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, flex: 'none' }}>
        <span>{words} words</span>
        <span>{minutes} min read</span>
        <span>{lines} lines</span>
        <span style={{ color: 'var(--fg-faint)' }}>{modeLabel}</span>
        <span style={{ color: 'var(--fg-faint)' }}>Markdown · UTF-8</span>
      </div>
    </div>
  )
}
