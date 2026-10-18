import type { KeyboardEvent, MouseEvent as ReactMouseEvent } from 'react'
import type { Platform, ViewMode } from '@shared/types'
import type { TabItem } from '@/state/viewmodel'
import { DotsIcon, OutlineIcon, SidebarIcon } from '@/lib/icons'
import Segmented from './Segmented'
import Tabs from './Tabs'
import WindowControls from './WindowControls'

// The one 44px bar: tabs on the left, document actions on the right, window
// controls at the far right on Windows/Linux. Empty space drags the window.

export interface TopBarProps {
  platform: Platform
  tabs: TabItem[]
  hasDocument: boolean
  sidebarVisible: boolean
  viewMode: ViewMode
  outlineOpen: boolean
  /** The outline can show at this window width. */
  outlineAvailable: boolean
  readingOpen: boolean
  docMenuOpen: boolean
  isMaximized: boolean
  /** Formatted shortcut for a command id, for tooltips ("Ctrl+B"). */
  hint: (shortcut: string) => string
  onShowSidebar: () => void
  onSelectTab: (id: string) => void
  onCloseTab: (id: string) => void
  onTabContext: (id: string, e: ReactMouseEvent | KeyboardEvent, keyboard: boolean) => void
  onNewDocument: () => void
  onSetView: (mode: ViewMode) => void
  onToggleOutline: () => void
  onToggleReading: (anchor: HTMLElement) => void
  onDocMenu: (anchor: HTMLElement, keyboard: boolean) => void
}

const MODES: { mode: ViewMode; label: string; shortcut: string }[] = [
  { mode: 'read', label: 'Read', shortcut: 'Mod+1' },
  { mode: 'split', label: 'Split', shortcut: 'Mod+2' },
  { mode: 'edit', label: 'Edit', shortcut: 'Mod+3' }
]

export default function TopBar(p: TopBarProps) {
  const isMac = p.platform === 'darwin'
  return (
    <header className="smd-topbar smd-drag">
      {!p.sidebarVisible && (
        <div className="smd-topbar-lead">
          <button
            type="button"
            className="smd-iconbtn"
            onClick={p.onShowSidebar}
            aria-label="Show sidebar"
            title={`Show sidebar (${p.hint('Mod+B')})`}
          >
            <SidebarIcon size={17} />
          </button>
        </div>
      )}
      <Tabs
        tabs={p.tabs}
        onSelect={p.onSelectTab}
        onClose={p.onCloseTab}
        onContext={p.onTabContext}
        onNew={p.onNewDocument}
        newLabel={`New document (${p.hint('Mod+N')})`}
      />
      {p.hasDocument && (
        <div className="smd-topbar-actions">
          <Segmented
            label="View"
            value={p.viewMode}
            onChange={p.onSetView}
            options={MODES.map((m) => ({ value: m.mode, label: m.label, title: `${m.label} (${p.hint(m.shortcut)})` }))}
          />
          <button
            type="button"
            className="smd-iconbtn smd-iconbtn--text"
            aria-label="Reading settings"
            aria-haspopup="dialog"
            aria-expanded={p.readingOpen}
            title="Reading settings"
            onClick={(e) => p.onToggleReading(e.currentTarget)}
          >
            <span className="smd-aa" aria-hidden="true">
              Aa
            </span>
          </button>
          {p.outlineAvailable && (
            <button
              type="button"
              className="smd-iconbtn"
              aria-label="On this page"
              aria-pressed={p.outlineOpen}
              title={`On this page (${p.hint('Mod+\\')})`}
              onClick={p.onToggleOutline}
            >
              <OutlineIcon size={17} />
            </button>
          )}
          <button
            type="button"
            className="smd-iconbtn"
            aria-label="Document actions"
            data-menu-anchor
            aria-haspopup="menu"
            aria-expanded={p.docMenuOpen}
            title="Document actions"
            onClick={(e) => p.onDocMenu(e.currentTarget, e.detail === 0)}
          >
            <DotsIcon size={17} />
          </button>
        </div>
      )}
      {!isMac && <WindowControls isMaximized={p.isMaximized} />}
    </header>
  )
}
