import type { MouseEvent as ReactMouseEvent } from 'react'
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

export default function FileTree({
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
              <div
                key={file.id}
                className={'smd-row' + (file.active ? ' is-active' : '')}
                role="button"
                tabIndex={0}
                aria-label={`Open ${file.name}`}
                aria-current={file.active ? 'true' : undefined}
                onClick={() => onOpenFile(file.id)}
                onKeyDown={activateOnKey(() => onOpenFile(file.id))}
                onContextMenu={(e) => onFileContext(file.id, e)}
                title={file.id}
              >
                <FileIcon
                  size={14}
                  sw={1.5}
                  style={{ flex: 'none', color: file.active ? 'var(--accent)' : 'var(--fg-faint)' }}
                />
                <span
                  style={{
                    flex: 1,
                    fontSize: 12.5,
                    color: file.active ? 'var(--fg)' : 'var(--fg-muted)',
                    fontWeight: file.active ? 600 : 400,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {file.name}
                </span>
                {file.pinned && (
                  <BookmarkFill size={12} style={{ flex: 'none', color: 'var(--accent)' }} />
                )}
                <button
                  className="smd-rowact"
                  aria-label={file.pinned ? `Unpin ${file.name}` : `Pin ${file.name}`}
                  title={file.pinned ? 'Unpin' : 'Pin'}
                  onClick={(e) => {
                    e.stopPropagation()
                    onPinFile(file.id)
                  }}
                >
                  <BookmarkIcon size={13} />
                </button>
              </div>
            ))}
        </div>
      ))}
    </div>
  )
}
