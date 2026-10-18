import type { ReactNode } from 'react'
import type { NamedFileRef } from '@/state/viewmodel'
import { AppMark, ClipboardIcon, FileTextIcon, FilePlusIcon, FolderIcon, FolderOpenIcon } from '@/lib/icons'

// The calm first screen when no document is open: four ways in, recent work,
// and two hints. Recent folders open through the main process allow-list.

export interface RecentFolder {
  path: string
  name: string
  parent: string
}

export interface WelcomeProps {
  hint: (shortcut: string) => string
  recentFiles: NamedFileRef[]
  recentFolders: RecentFolder[]
  onNewDocument: () => void
  onOpenFile: () => void
  onOpenFolder: () => void
  onPasteFromAi: () => void
  onOpenRecentFile: (id: string) => void
  onOpenRecentFolder: (path: string) => void
  onClearRecents: () => void
}

const MAX_FILES = 6
const MAX_FOLDERS = 4

function Action({
  icon,
  label,
  detail,
  shortcut,
  onClick
}: {
  icon: ReactNode
  label: string
  detail: string
  shortcut: string
  onClick: () => void
}) {
  return (
    <button type="button" className="smd-action" onClick={onClick}>
      <span className="smd-action-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="smd-action-label">{label}</span>
      <span className="smd-action-hint">{detail}</span>
      <span className="smd-kbd" aria-label={`Shortcut ${shortcut}`}>
        {shortcut}
      </span>
    </button>
  )
}

function RecentList(p: WelcomeProps) {
  const files = p.recentFiles.slice(0, MAX_FILES)
  const folders = p.recentFolders.slice(0, MAX_FOLDERS)
  if (!files.length && !folders.length) return null
  return (
    <section className="smd-recent" aria-labelledby="smd-recent-title">
      <div className="smd-recent-head">
        <h2 id="smd-recent-title">Recent</h2>
        {files.length > 0 && (
          <button type="button" className="smd-link" onClick={p.onClearRecents}>
            Clear recent files
          </button>
        )}
      </div>
      <ul className="smd-recent-list">
        {folders.map((f) => (
          <li key={f.path}>
            <button
              type="button"
              className="smd-recent-item"
              onClick={() => p.onOpenRecentFolder(f.path)}
              title={f.path}
            >
              <FolderIcon size={16} />
              <span className="smd-recent-name">{f.name}</span>
              <span className="smd-recent-dir">{f.parent}</span>
            </button>
          </li>
        ))}
        {files.map((f) => (
          <li key={f.id}>
            <button type="button" className="smd-recent-item" onClick={() => p.onOpenRecentFile(f.id)} title={f.id}>
              <FileTextIcon size={16} />
              <span className="smd-recent-name">{f.name}</span>
              <span className="smd-recent-dir">{f.folder}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default function Welcome(p: WelcomeProps) {
  return (
    <div className="smd-welcome smd-fade">
      <div className="smd-welcome-col">
        <header className="smd-welcome-head">
          <AppMark size={40} style={{ color: 'var(--fg)' }} />
          <div>
            <h1 className="smd-welcome-title">SimpleMD</h1>
            <p className="smd-welcome-tag">A calm place to read what your AI writes.</p>
          </div>
        </header>

        <div className="smd-actions-grid">
          <Action
            icon={<FilePlusIcon size={18} />}
            label="New document"
            detail="Start from a blank page"
            shortcut={p.hint('Mod+N')}
            onClick={p.onNewDocument}
          />
          <Action
            icon={<FileTextIcon size={18} />}
            label="Open file"
            detail="Read a Markdown file"
            shortcut={p.hint('Mod+O')}
            onClick={p.onOpenFile}
          />
          <Action
            icon={<FolderOpenIcon size={18} />}
            label="Open folder"
            detail="Every note in a folder"
            shortcut={p.hint('Mod+Shift+O')}
            onClick={p.onOpenFolder}
          />
          <Action
            icon={<ClipboardIcon size={18} />}
            label="Paste from AI"
            detail="Read a copied answer"
            shortcut={p.hint('Mod+Shift+V')}
            onClick={p.onPasteFromAi}
          />
        </div>

        <RecentList {...p} />

        <footer className="smd-welcome-foot">
          <span>Drop Markdown files or a folder anywhere</span>
          <span>
            Press <span className="smd-kbd">{p.hint('Mod+K')}</span> for all commands
          </span>
        </footer>
      </div>
    </div>
  )
}
