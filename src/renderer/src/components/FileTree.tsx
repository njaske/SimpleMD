import { memo, type MouseEvent as ReactMouseEvent } from 'react'
import type { FolderItem } from '@/state/viewmodel'
import {
  BookmarkFill,
  BookmarkIcon,
  ChevronRight,
  FileIcon,
  FilePlusIcon,
  FolderIcon,
  OpenAllIcon
} from '@/lib/icons'
import { activateOnKey } from '@/lib/a11y'

interface Props {
  folders: FolderItem[]
  hasFolder: boolean
  onToggleFolder: (id: string) => void
  onOpenFile: (id: string) => void
  onOpenAll: (id: string) => void
  onPinFile: (id: string) => void
  onOpenFolder: () => void
  onOpenFiles: () => void
  onFileContext: (id: string, e: ReactMouseEvent) => void
  onFolderContext: (id: string, e: ReactMouseEvent) => void
}

interface RowProps {
  id: string
  name: string
  active: boolean
  pinned: boolean
  onOpenFile: (id: string) => void
  onPinFile: (id: string) => void
  onFileContext: (id: string, e: ReactMouseEvent) => void
}

// One row per file, memoized on primitives so switching the active document
// re-renders only the two rows whose state changed, not thousands.
const FileRow = memo(function FileRow({ id, name, active, pinned, onOpenFile, onPinFile, onFileContext }: RowProps) {
  return (
    <div
      className={'smd-row' + (active ? ' is-active' : '')}
      role="button"
      tabIndex={0}
      aria-label={`Open ${name}`}
      aria-current={active ? 'true' : undefined}
      onClick={() => onOpenFile(id)}
      onKeyDown={activateOnKey(() => onOpenFile(id))}
      onContextMenu={(e) => onFileContext(id, e)}
      title={id}
    >
      <FileIcon size={14} sw={1.5} style={{ flex: 'none', color: active ? 'var(--accent)' : 'var(--fg-faint)' }} />
      <span
        style={{
          flex: 1,
          fontSize: 12.5,
          color: active ? 'var(--fg)' : 'var(--fg-muted)',
          fontWeight: active ? 600 : 400,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}
      >
        {name}
      </span>
      {pinned && <BookmarkFill size={12} style={{ flex: 'none', color: 'var(--accent)' }} />}
      <button
        className="smd-rowact"
        aria-label={pinned ? `Unpin ${name}` : `Pin ${name}`}
        title={pinned ? 'Unpin' : 'Pin'}
        onClick={(e) => {
          e.stopPropagation()
          onPinFile(id)
        }}
      >
        <BookmarkIcon size={13} />
      </button>
    </div>
  )
})

function FileTree({
  folders,
  hasFolder,
  onToggleFolder,
  onOpenFile,
  onOpenAll,
  onPinFile,
  onOpenFolder,
  onOpenFiles,
  onFileContext,
  onFolderContext
}: Props) {
  if (!hasFolder) {
    return (
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
            padding: '40px 22px',
            textAlign: 'center',
            color: 'var(--fg-faint)'
          }}
        >
          <FolderIcon size={28} style={{ color: 'var(--fg-faint)' }} />
          <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>
            Open a folder (every Markdown file inside opens at once), or open individual files.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="smd-ghostbtn smd-ghostbtn--sm" onClick={onOpenFolder}>
              <FolderIcon size={14} />
              Folder
            </button>
            <button className="smd-ghostbtn smd-ghostbtn--sm" onClick={onOpenFiles}>
              <FilePlusIcon size={14} />
              Files
            </button>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--fg-faint)' }}>…or drag &amp; drop them here</div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0', position: 'relative' }}>
      {folders.map((folder) => (
        <div key={folder.id}>
          <div
            className="smd-folder"
            role="button"
            tabIndex={0}
            aria-expanded={folder.expanded}
            aria-label={`${folder.name} folder`}
            onClick={() => onToggleFolder(folder.id)}
            onKeyDown={activateOnKey(() => onToggleFolder(folder.id))}
            onContextMenu={(e) => onFolderContext(folder.id, e)}
            title={folder.id}
          >
            <ChevronRight
              size={13}
              style={{
                flex: 'none',
                transition: 'transform .15s',
                transform: `rotate(${folder.expanded ? 90 : 0}deg)`
              }}
            />
            <span
              style={{
                flex: 1,
                fontSize: 12.5,
                fontWeight: 600,
                letterSpacing: '.01em',
                color: 'var(--fg)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
            >
              {folder.name}
            </span>
            <button
              className="smd-fact"
              aria-label={`Open all files in ${folder.name}`}
              title="Open all files in this folder"
              onClick={(e) => {
                e.stopPropagation()
                onOpenAll(folder.id)
              }}
            >
              <OpenAllIcon size={15} />
            </button>
          </div>
          {folder.expanded &&
            folder.files.map((file) => (
              <FileRow
                key={file.id}
                id={file.id}
                name={file.name}
                active={file.active}
                pinned={file.pinned}
                onOpenFile={onOpenFile}
                onPinFile={onPinFile}
                onFileContext={onFileContext}
              />
            ))}
        </div>
      ))}
    </div>
  )
}

export default memo(FileTree)
