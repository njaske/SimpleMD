import type { Activity } from '@shared/types'
import { BookmarkIcon, FileIcon, MoonIcon, SearchIcon, SunIcon } from '@/lib/icons'

interface Props {
  activity: Activity
  sidebarOpen: boolean
  isDark: boolean
  onFiles: () => void
  onSearch: () => void
  onPinned: () => void
  onToggleTheme: () => void
}

export default function ActivityBar({
  activity,
  sidebarOpen,
  isDark,
  onFiles,
  onSearch,
  onPinned,
  onToggleTheme
}: Props) {
  const on = (name: Activity): boolean => activity === name && sidebarOpen
  const color = (name: Activity): string => (on(name) ? 'var(--fg)' : 'var(--fg-faint)')

  return (
    <div
      className="smd-activity"
      role="toolbar"
      aria-label="Activity bar"
      aria-orientation="vertical"
      style={{
        width: 50,
        flex: 'none',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '8px 0',
        background: 'var(--bg-elev)',
        borderRight: '1px solid var(--border)',
        gap: 4
      }}
    >
      <button
        className="smd-actbtn"
        onClick={onFiles}
        aria-label="Files"
        aria-pressed={on('files')}
        title="Files"
        style={{ color: color('files') }}
      >
        {on('files') && <div className="smd-actind" />}
        <FileIcon size={19} />
      </button>
      <button
        className="smd-actbtn"
        onClick={onSearch}
        aria-label="Search"
        aria-pressed={on('search')}
        title="Search"
        style={{ color: color('search') }}
      >
        {on('search') && <div className="smd-actind" />}
        <SearchIcon size={19} />
      </button>
      <button
        className="smd-actbtn"
        onClick={onPinned}
        aria-label="Pinned and recent"
        aria-pressed={on('pinned')}
        title="Pinned & Recent"
        style={{ color: color('pinned') }}
      >
        {on('pinned') && <div className="smd-actind" />}
        <BookmarkIcon size={19} />
      </button>
      <div style={{ flex: 1 }} />
      <button
        className="smd-actbtn smd-hovfg"
        onClick={onToggleTheme}
        aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
        title="Toggle theme"
        style={{ color: 'var(--fg-faint)' }}
      >
        {isDark ? <SunIcon size={18} /> : <MoonIcon size={18} />}
      </button>
    </div>
  )
}
