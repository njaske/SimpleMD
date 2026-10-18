import { memo, useState } from 'react'
import type { KeyboardEvent, MouseEvent as ReactMouseEvent } from 'react'
import type { FileItem, FolderItem, TreeModel } from '@/state/viewmodel'
import type { RenameState } from '@/app/types'
import {
  BookmarkFill,
  BookmarkIcon,
  ChevronRight,
  FileTextIcon,
  FolderIcon,
  OpenAllIcon,
  SparkIcon
} from '@/lib/icons'
import InlineRename from './InlineRename'

type ContextHandler = (id: string, e: ReactMouseEvent | KeyboardEvent, keyboard: boolean) => void

export interface FileTreeProps {
  tree: TreeModel
  hasFolder: boolean
  /** The session has been restored; until then the empty state stays hidden. */
  ready: boolean
  renaming: RenameState | null
  validateName: (path: string, name: string, isFolder: boolean) => string | null
  onRenameCommit: (path: string, name: string, isFolder: boolean) => void
  onRenameCancel: () => void
  onToggleFolder: (id: string) => void
  onOpenFile: (id: string) => void
  onOpenAll: (id: string) => void
  onPinFile: (id: string) => void
  onOpenFolder: () => void
  onFileContext: ContextHandler
  onFolderContext: ContextHandler
}

const ERROR_ID = 'smd-rename-error'

function RenameRow({
  initial,
  path,
  isFolder,
  validate,
  onCommit,
  onCancel
}: {
  initial: string
  path: string
  isFolder: boolean
  validate: FileTreeProps['validateName']
  onCommit: FileTreeProps['onRenameCommit']
  onCancel: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  return (
    <>
      <div className={(isFolder ? 'smd-folder' : 'smd-row') + ' smd-row--rename'}>
        {isFolder ? (
          <FolderIcon size={14} className="smd-row-icon" />
        ) : (
          <FileTextIcon size={15} className="smd-row-icon" />
        )}
        <InlineRename
          initial={initial}
          label={isFolder ? 'Folder name' : 'File name'}
          errorId={ERROR_ID}
          validate={(name) => validate(path, name, isFolder)}
          onError={setError}
          onCommit={(name) => onCommit(path, name, isFolder)}
          onCancel={onCancel}
        />
      </div>
      {error && (
        <div id={ERROR_ID} className="smd-rename-error" role="alert">
          {error}
        </div>
      )}
    </>
  )
}

interface RowProps {
  file: FileItem
  /** This row is the tree's tab stop (roving focus). */
  tabbable: boolean
  depthClass?: string
  onOpenFile: (id: string) => void
  onPinFile: (id: string) => void
  onFileContext: ContextHandler
}

// One row per file, memoized on its item so switching documents re-renders only
// the rows whose state changed, not thousands.
const FileRow = memo(function FileRow({ file, tabbable, depthClass, onOpenFile, onPinFile, onFileContext }: RowProps) {
  const dot = file.name.lastIndexOf('.')
  const stem = dot > 0 ? file.name.slice(0, dot) : file.name
  const ext = dot > 0 ? file.name.slice(dot) : ''
  return (
    <div
      className={'smd-row' + (file.active ? ' is-active' : '') + (depthClass ? ` ${depthClass}` : '')}
      role="treeitem"
      tabIndex={tabbable ? 0 : -1}
      data-path={file.id}
      aria-selected={file.active}
      aria-label={`${file.name}${file.isNew ? ', new' : ''}${file.pinned ? ', pinned' : ''}`}
      title={file.id}
      onClick={() => onOpenFile(file.id)}
      onContextMenu={(e) => {
        e.preventDefault()
        onFileContext(file.id, e, false)
      }}
    >
      {file.isAgent ? (
        <SparkIcon size={15} className="smd-row-icon smd-row-icon--agent" />
      ) : (
        <FileTextIcon size={15} className="smd-row-icon" />
      )}
      <span className="smd-row-name">
        {stem}
        <span className="smd-row-ext">{ext}</span>
      </span>
      {file.isNew && (
        <span className="smd-new-chip" title="New since you opened the folder" aria-hidden="true">
          New
        </span>
      )}
      {file.pinned && <BookmarkFill size={11} className="smd-row-pin" />}
      <button
        type="button"
        tabIndex={-1}
        className="smd-iconbtn smd-iconbtn--sm"
        aria-label={file.pinned ? `Unpin ${file.name}` : `Pin ${file.name}`}
        title={file.pinned ? 'Unpin' : 'Pin'}
        onClick={(e) => {
          e.stopPropagation()
          onPinFile(file.id)
        }}
      >
        {file.pinned ? <BookmarkFill size={13} /> : <BookmarkIcon size={14} />}
      </button>
    </div>
  )
})

function FolderName({ name }: { name: string }) {
  const parts = name.split(/\s+\/\s+/)
  const last = parts.pop()
  return (
    <span className="smd-folder-name">
      {parts.map((p) => (
        <span key={p} className="smd-crumb">
          {p} /{' '}
        </span>
      ))}
      {last}
    </span>
  )
}

/** Arrow-key navigation over the visible tree items (WAI-ARIA tree pattern). */
function onTreeKey(e: KeyboardEvent<HTMLDivElement>, p: FileTreeProps): void {
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="treeitem"]'))
  const el = document.activeElement as HTMLElement | null
  const i = el ? items.indexOf(el) : -1
  const path = el?.dataset.path
  const folder = el?.dataset.folder
  const focus = (n: number): void => items[Math.max(0, Math.min(items.length - 1, n))]?.focus()
  const actions: Record<string, () => void> = {
    ArrowDown: () => focus(i + 1),
    ArrowUp: () => focus(i - 1),
    Home: () => focus(0),
    End: () => focus(items.length - 1),
    ArrowRight: () => {
      if (folder && el?.getAttribute('aria-expanded') === 'false') p.onToggleFolder(folder)
      else focus(i + 1)
    },
    ArrowLeft: () => {
      if (folder && el?.getAttribute('aria-expanded') === 'true') p.onToggleFolder(folder)
      else if (path) {
        const parent = items
          .slice(0, i)
          .reverse()
          .find((x) => x.dataset.folder)
        parent?.focus()
      }
    },
    Enter: () => {
      if (path) p.onOpenFile(path)
      else if (folder) p.onToggleFolder(folder)
    },
    ' ': () => {
      if (path) p.onOpenFile(path)
      else if (folder) p.onToggleFolder(folder)
    }
  }
  const isMenuKey = e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)
  if (isMenuKey && (path || folder)) {
    e.preventDefault()
    if (path) p.onFileContext(path, e, true)
    else if (folder) p.onFolderContext(folder, e, true)
    return
  }
  const run = actions[e.key]
  if (!run || (e.target as HTMLElement).tagName === 'INPUT') return
  e.preventDefault()
  run()
}

function FolderBlock({ folder, p, tabStop }: { folder: FolderItem; p: FileTreeProps; tabStop: string | null }) {
  const renamingFolder = p.renaming?.isFolder && p.renaming.path === folder.id
  return (
    <div role="none">
      {renamingFolder ? (
        <RenameRow
          initial={folder.name.split(/\s+\/\s+/).pop() ?? folder.name}
          path={folder.id}
          isFolder
          validate={p.validateName}
          onCommit={p.onRenameCommit}
          onCancel={p.onRenameCancel}
        />
      ) : (
        <div
          className="smd-folder"
          role="treeitem"
          tabIndex={tabStop === folder.id ? 0 : -1}
          data-folder={folder.id}
          aria-expanded={folder.expanded}
          aria-label={`${folder.name} folder, ${folder.files.length} files`}
          title={folder.id}
          onClick={() => p.onToggleFolder(folder.id)}
          onContextMenu={(e) => {
            e.preventDefault()
            p.onFolderContext(folder.id, e, false)
          }}
        >
          <ChevronRight size={13} className="smd-folder-chev" />
          <FolderName name={folder.name} />
          <span className="smd-folder-count">{folder.files.length || ''}</span>
          <button
            type="button"
            tabIndex={-1}
            className="smd-iconbtn smd-iconbtn--sm"
            aria-label={`Open all files in ${folder.name}`}
            title="Open all files"
            onClick={(e) => {
              e.stopPropagation()
              p.onOpenAll(folder.id)
            }}
          >
            <OpenAllIcon size={14} />
          </button>
        </div>
      )}
      {folder.expanded && (
        <div role="group">
          {folder.files.map((file) =>
            p.renaming && !p.renaming.isFolder && p.renaming.path === file.id ? (
              <RenameRow
                key={file.id}
                initial={file.name}
                path={file.id}
                isFolder={false}
                validate={p.validateName}
                onCommit={p.onRenameCommit}
                onCancel={p.onRenameCancel}
              />
            ) : (
              <FileRow
                key={file.id}
                file={file}
                tabbable={tabStop === file.id}
                onOpenFile={p.onOpenFile}
                onPinFile={p.onPinFile}
                onFileContext={p.onFileContext}
              />
            )
          )}
          {folder.files.length === 0 && <div className="smd-tree-empty-folder">No Markdown files yet</div>}
        </div>
      )}
    </div>
  )
}

/** Quiet on purpose: the Welcome screen carries the big actions. */
function EmptyTree({ onOpenFolder }: Pick<FileTreeProps, 'onOpenFolder'>) {
  return (
    <div className="smd-side-empty">
      <p>Open a folder to see all of its Markdown files here.</p>
      <button type="button" className="smd-btn smd-btn--ghost smd-btn--sm smd-side-empty-action" onClick={onOpenFolder}>
        <FolderIcon size={15} /> Open folder…
      </button>
    </div>
  )
}

/** Roving focus: the active file (when its folder is open), else the first folder. */
function tabStopOf({ folders }: TreeModel): string | null {
  for (const f of folders) {
    if (f.expanded && f.files.some((x) => x.active)) return f.files.find((x) => x.active)?.id ?? null
  }
  return folders[0]?.id ?? null
}

function FileTree(p: FileTreeProps) {
  if (!p.hasFolder) return p.ready ? <EmptyTree onOpenFolder={p.onOpenFolder} /> : null
  const { agentFiles, folders } = p.tree
  const tabStop = tabStopOf(p.tree)

  return (
    <div className="smd-scroll smd-tree" role="tree" aria-label="Files" onKeyDown={(e) => onTreeKey(e, p)}>
      {agentFiles.length > 0 && (
        <div className="smd-agent-group" role="group" aria-label="Agent instructions">
          <div className="smd-section-label" aria-hidden="true">
            Agent instructions
          </div>
          {agentFiles.map((file) => (
            <FileRow
              key={`agent:${file.id}`}
              file={file}
              tabbable={false}
              onOpenFile={p.onOpenFile}
              onPinFile={p.onPinFile}
              onFileContext={p.onFileContext}
            />
          ))}
        </div>
      )}
      {agentFiles.length > 0 && folders.length > 0 && (
        <div className="smd-section-label" aria-hidden="true">
          Files
        </div>
      )}
      {folders.map((folder) => (
        <FolderBlock key={folder.id} folder={folder} p={p} tabStop={tabStop} />
      ))}
    </div>
  )
}

export default memo(FileTree)
