import { memo } from 'react'
import type { Activity, ResolvedTheme } from '@shared/types'
import type { NamedFileRef } from '@/state/viewmodel'
import type { SearchResult } from '@/lib/document'
import { AppMark, ContrastIcon, GearIcon, KeyboardIcon, PlusIcon, SearchIcon } from '@/lib/icons'
import FileTree, { type FileTreeProps } from './FileTree'
import SearchPanel from './SearchPanel'
import PinnedPanel from './PinnedPanel'
import Segmented from './Segmented'

export interface SidebarProps {
  activity: Activity
  overlay: boolean
  workspaceName: string
  resolvedTheme: ResolvedTheme
  hint: (shortcut: string) => string
  onActivity: (a: Activity) => void
  onNewDocument: () => void
  onQuickOpen: () => void
  onSettings: () => void
  onToggleTheme: () => void
  onShortcuts: () => void
  tree: FileTreeProps
  searchQuery: string
  searchResult: SearchResult
  onSearchInput: (value: string) => void
  onGotoMatch: (id: string, line: number, col: number, len: number) => void
  pinned: NamedFileRef[]
  recent: NamedFileRef[]
  onUnpin: (id: string) => void
  onForgetRecent: (id: string) => void
  onClearRecents: () => void
}

const PANELS: { value: Activity; label: string }[] = [
  { value: 'files', label: 'Files' },
  { value: 'search', label: 'Search' },
  { value: 'pinned', label: 'Pinned' }
]

function Sidebar(p: SidebarProps) {
  const themeLabel = p.resolvedTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'
  return (
    <aside className={'smd-sidebar' + (p.overlay ? ' smd-sidebar--overlay' : '')} aria-label="Sidebar">
      <div className="smd-side-head smd-drag">
        <div className="smd-brand">
          <AppMark size={18} />
          <span className="smd-brand-name">SimpleMD</span>
        </div>
        <button
          type="button"
          className="smd-iconbtn"
          onClick={p.onNewDocument}
          aria-label="New document"
          title={`New document (${p.hint('Mod+N')})`}
        >
          <PlusIcon size={17} />
        </button>
        <button
          type="button"
          className="smd-iconbtn"
          onClick={p.onQuickOpen}
          aria-label="Quick open"
          title={`Quick open (${p.hint('Mod+P')})`}
        >
          <SearchIcon size={16} />
        </button>
      </div>
      <div className="smd-side-switch">
        <Segmented label="Sidebar panel" block value={p.activity} onChange={p.onActivity} options={PANELS} />
      </div>

      <div className="smd-side-body">
        {p.activity === 'files' && <FileTree {...p.tree} />}
        {p.activity === 'search' && (
          <SearchPanel
            query={p.searchQuery}
            result={p.searchResult}
            onInput={p.onSearchInput}
            onOpenGroup={p.tree.onOpenFile}
            onGotoMatch={p.onGotoMatch}
          />
        )}
        {p.activity === 'pinned' && (
          <PinnedPanel
            pinned={p.pinned}
            recent={p.recent}
            onOpen={p.tree.onOpenFile}
            onUnpin={p.onUnpin}
            onForgetRecent={p.onForgetRecent}
            onClearRecents={p.onClearRecents}
          />
        )}
      </div>

      <div className="smd-side-foot">
        <button
          type="button"
          className="smd-iconbtn"
          onClick={p.onSettings}
          aria-label="Settings"
          title={`Settings (${p.hint('Mod+,')})`}
        >
          <GearIcon size={16} />
        </button>
        <button
          type="button"
          className="smd-iconbtn"
          onClick={p.onToggleTheme}
          aria-label={themeLabel}
          title={`${themeLabel} (${p.hint('Mod+Shift+D')})`}
        >
          <ContrastIcon size={16} />
        </button>
        <button
          type="button"
          className="smd-iconbtn"
          onClick={p.onShortcuts}
          aria-label="Keyboard shortcuts"
          title={`Keyboard shortcuts (${p.hint('Mod+/')})`}
        >
          <KeyboardIcon size={17} />
        </button>
        <span className="smd-side-foot-meta" title={p.workspaceName}>
          {p.workspaceName}
        </span>
      </div>
    </aside>
  )
}

// Props are stable between keystrokes, so typing in the editor skips the sidebar.
export default memo(Sidebar)
