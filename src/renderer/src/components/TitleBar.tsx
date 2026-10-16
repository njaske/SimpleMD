import { CloseIcon, MaximizeIcon, MinimizeIcon, RestoreIcon } from '@/lib/icons'

interface Props {
  titleName: string
  dirty: boolean
  isMaximized: boolean
  onMinimize: () => void
  onMaximize: () => void
  onClose: () => void
}

export default function TitleBar({
  titleName,
  dirty,
  isMaximized,
  onMinimize,
  onMaximize,
  onClose
}: Props) {
  return (
    <div
      className="smd-titlebar"
      style={{
        height: 40,
        flex: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: 'var(--bg-elev)',
        borderBottom: '1px solid var(--border)',
        userSelect: 'none'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingLeft: 14 }}>
        <div
          style={{
            width: 16,
            height: 16,
            border: '1.6px solid var(--fg)',
            borderRadius: 3,
            position: 'relative',
            flex: 'none'
          }}
        >
          <div
            style={{
              position: 'absolute',
              right: 2,
              bottom: 2,
              width: 6,
              height: 6,
              background: 'var(--accent)',
              borderRadius: 1
            }}
          />
        </div>
        <span style={{ fontWeight: 600, letterSpacing: '.01em', fontSize: 13 }}>SimpleMD</span>
        <span style={{ color: 'var(--fg-faint)', fontSize: 12.5 }}>
          — {titleName}
          {dirty ? ' •' : ''}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'stretch', height: '100%' }}>
        <button className="smd-winbtn" onClick={onMinimize} aria-label="Minimize" title="Minimize">
          <MinimizeIcon size={13} />
        </button>
        <button
          className="smd-winbtn"
          onClick={onMaximize}
          aria-label={isMaximized ? 'Restore' : 'Maximize'}
          title={isMaximized ? 'Restore' : 'Maximize'}
        >
          {isMaximized ? <RestoreIcon size={13} /> : <MaximizeIcon size={12} />}
        </button>
        <button className="smd-winbtn smd-closebtn" onClick={onClose} aria-label="Close" title="Close">
          <CloseIcon size={13} />
        </button>
      </div>
    </div>
  )
}
