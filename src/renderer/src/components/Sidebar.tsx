import type { MouseEvent as ReactMouseEvent } from 'react'
import type { Activity } from '@shared/types'
import type { FolderItem, NamedFileRef } from '@/state/viewmodel'
import type { SearchResult } from '@/lib/document'
import { FilePlusIcon, FolderPlusIcon } from '@/lib/icons'
import FileTree from './FileTree'
import SearchPanel from './SearchPanel'
import PinnedPanel from './PinnedPanel'

interface Props {
  activity: Activity
  hasFolder: boolean
  onOpenFolder: () => void
  onOpenFiles: () => void
  folders: FolderItem[]
  onToggleFolder: (id: string) => void
  onOpenFile: (id: string) => void
  onOpenAll: (id: string) => void
  onPinFile: (id: string) => void
  onFileContext: (id: string, e: ReactMouseEvent) => void
  onFolderContext: (id: string, e: ReactMouseEvent) => void
  searchQuery: string
  searchResult: SearchResult
  onSearchInput: (value: string) => void
  onOpenGroup: (id: string) => void
  onGotoMatch: (id: string, line: number, col: number, len: number) => void
  pinned: NamedFileRef[]
  recent: NamedFileRef[]
  onUnpin: (id: string) => void
}

const TITLES: Record<Activity, string> = {
  files: 'Explorer',
  search: 'Search',
  pinned: 'Pinned & Recent'
}

export default function Sidebar(props: Props) {
  const { activity } = props
  return (
    <div
      className="smd-sidebar"
      style={{
        width: 256,
        flex: 'none',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-elev)',
        borderRight: '1px solid var(--border)',
        minHeight: 0
      }}
    >
      <div
        style={{
          height: 40,
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 8px 0 14px',
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
          {TITLES[activity]}
        </span>
        {activity === 'files' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button
              className="smd-sqbtn"
              onClick={props.onOpenFiles}
              aria-label="Open files"
              title="Open file(s)"
              style={{ width: 28, height: 26 }}
            >
              <FilePlusIcon size={15} />
            </button>
            <button
              className="smd-ghostbtn smd-ghostbtn--sm"
              onClick={props.onOpenFolder}
              aria-label="Open a folder"
              title="Open a folder"
            >
              <FolderPlusIcon size={14} />
              Open
            </button>
          </div>
        )}
      </div>

      {activity === 'files' && (
        <FileTree
          folders={props.folders}
          hasFolder={props.hasFolder}
          onToggleFolder={props.onToggleFolder}
          onOpenFile={props.onOpenFile}
          onOpenAll={props.onOpenAll}
          onPinFile={props.onPinFile}
          onOpenFolder={props.onOpenFolder}
          onOpenFiles={props.onOpenFiles}
          onFileContext={props.onFileContext}
          onFolderContext={props.onFolderContext}
        />
      )}
      {activity === 'search' && (
        <SearchPanel
          query={props.searchQuery}
          result={props.searchResult}
          onInput={props.onSearchInput}
          onOpenGroup={props.onOpenGroup}
          onGotoMatch={props.onGotoMatch}
        />
      )}
      {activity === 'pinned' && (
        <PinnedPanel
          pinned={props.pinned}
          recent={props.recent}
          onOpen={props.onOpenFile}
          onUnpin={props.onUnpin}
        />
      )}
    </div>
  )
}
