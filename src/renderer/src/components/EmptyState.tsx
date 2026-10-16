import { FilePlusIcon, FolderIcon } from '@/lib/icons'

interface Props {
  onOpenFolder: () => void
  onOpenFiles: () => void
}

export default function EmptyState({ onOpenFolder, onOpenFiles }: Props) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 20,
        color: 'var(--fg-faint)'
      }}
    >
      <div
        style={{
          width: 54,
          height: 54,
          border: '2px solid var(--border-strong)',
          borderRadius: 11,
          position: 'relative'
        }}
      >
        <div
          style={{
            position: 'absolute',
            right: 8,
            bottom: 8,
            width: 16,
            height: 16,
            background: 'var(--accent)',
            borderRadius: 3
          }}
        />
      </div>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 21, fontWeight: 600, color: 'var(--fg-muted)', letterSpacing: '.01em' }}>
          SimpleMD
        </div>
        <div style={{ fontSize: 13.5, marginTop: 7, color: 'var(--fg-faint)' }}>
          Open a folder (every Markdown file inside opens at once), or open individual files.
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <button className="smd-bigbtn" onClick={onOpenFolder}>
          <FolderIcon size={16} />
          Open a folder
        </button>
        <button className="smd-bigbtn" onClick={onOpenFiles}>
          <FilePlusIcon size={16} />
          Open files
        </button>
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--fg-faint)' }}>…or drag &amp; drop them anywhere</div>
    </div>
  )
}
