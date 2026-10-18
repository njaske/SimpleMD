import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import type { QuickOpenItem } from '@/state/viewmodel'
import type { CommandGroup, CommandId } from '@/lib/commands'
import { GROUP_ORDER, paletteOrder } from '@/lib/commands'
import { fuzzyFilter } from '@/lib/logic/fuzzy'
import { useFocusReturn } from '@/lib/a11y'
import { BookmarkFill, CommandIcon, FileTextIcon, FolderIcon, SearchIcon, SparkIcon } from '@/lib/icons'

// Quick Open and the command palette in one: plain text searches files, a leading
// ">" searches commands. Arrow keys + Enter, Esc closes, hover selects.

export interface PaletteCommand {
  id: CommandId
  label: string
  group: CommandGroup
  keywords: string
  /** Formatted shortcut, if any. */
  shortcut: string | null
}

export interface PaletteFolder {
  path: string
  name: string
  parent: string
}

export interface CommandPaletteProps {
  query: string
  onQuery: (query: string) => void
  /** List recent folders instead of files/commands. */
  foldersMode: boolean
  folders: readonly PaletteFolder[]
  onOpenFolder: (path: string) => void
  files: readonly QuickOpenItem[]
  commands: readonly PaletteCommand[]
  recentCommands: readonly CommandId[]
  onOpenFile: (id: string) => void
  onRunCommand: (id: CommandId) => void
  onClose: () => void
}

type Row =
  | { kind: 'group'; key: string; label: string }
  | { kind: 'file'; key: string; item: QuickOpenItem; name: number[]; folder: number[] }
  | { kind: 'command'; key: string; cmd: PaletteCommand; label: number[]; showGroup: boolean }
  | { kind: 'folder'; key: string; folder: PaletteFolder; name: number[] }

const FILE_LIMIT = 60

function Highlight({ text, positions }: { text: string; positions: readonly number[] }) {
  if (!positions.length) return <>{text}</>
  const set = new Set(positions)
  const out: ReactNode[] = []
  let run = ''
  let marked = false
  const flush = (i: number): void => {
    if (!run) return
    out.push(marked ? <mark key={i}>{run}</mark> : run)
    run = ''
  }
  for (let i = 0; i < text.length; i++) {
    const m = set.has(i)
    if (m !== marked) {
      flush(i)
      marked = m
    }
    run += text[i]
  }
  flush(text.length)
  return <>{out}</>
}

function fileRows(query: string, files: readonly QuickOpenItem[]): Row[] {
  const results = fuzzyFilter(query, files, (f) => `${f.name} ${f.folder}`, FILE_LIMIT)
  return results.map(({ item, match }) => {
    const cut = item.name.length + 1
    return {
      kind: 'file' as const,
      key: item.id,
      item,
      name: match.positions.filter((i) => i < item.name.length),
      folder: match.positions.filter((i) => i >= cut).map((i) => i - cut)
    }
  })
}

function folderRows(query: string, folders: readonly PaletteFolder[]): Row[] {
  return fuzzyFilter(query.trim(), folders, (f) => f.name, 20).map(({ item, match }) => ({
    kind: 'folder' as const,
    key: item.path,
    folder: item,
    name: match.positions
  }))
}

function commandRows(query: string, commands: readonly PaletteCommand[], recent: readonly CommandId[]): Row[] {
  if (query.trim()) {
    return fuzzyFilter(query.trim(), commands, (c) => `${c.label} ${c.keywords}`, 80).map(({ item, match }) => ({
      kind: 'command' as const,
      key: item.id,
      cmd: item,
      label: match.positions.filter((i) => i < item.label.length),
      showGroup: true
    }))
  }
  // Empty query: recently used first, then every command by group.
  const ordered = paletteOrder(commands, recent)
  const used = ordered.slice(0, recent.filter((id) => commands.some((c) => c.id === id)).length)
  const rows: Row[] = []
  if (used.length) {
    rows.push({ kind: 'group', key: 'g-recent', label: 'Recently used' })
    used.forEach((c) => rows.push({ kind: 'command', key: `r-${c.id}`, cmd: c, label: [], showGroup: true }))
  }
  for (const group of GROUP_ORDER) {
    const inGroup = commands.filter((c) => c.group === group)
    if (!inGroup.length) continue
    rows.push({ kind: 'group', key: `g-${group}`, label: group })
    inGroup.forEach((c) => rows.push({ kind: 'command', key: c.id, cmd: c, label: [], showGroup: false }))
  }
  return rows
}

export default function CommandPalette(p: CommandPaletteProps) {
  const ref = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const listId = useId()
  const isCommands = !p.foldersMode && p.query.startsWith('>')
  const text = isCommands ? p.query.slice(1) : p.query
  const [selected, setSelected] = useState(0)
  useFocusReturn(ref)

  const rows = useMemo(
    () =>
      p.foldersMode
        ? folderRows(text, p.folders)
        : isCommands
          ? commandRows(text, p.commands, p.recentCommands)
          : fileRows(text, p.files),
    [p.foldersMode, isCommands, text, p.commands, p.recentCommands, p.files, p.folders]
  )
  const selectable = rows.map((r, i) => (r.kind === 'group' ? -1 : i)).filter((i) => i >= 0)
  const current = selectable[Math.min(selected, selectable.length - 1)] ?? -1

  useEffect(() => setSelected(0), [p.query])
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [current])

  const choose = (row: Row | undefined): void => {
    if (!row || row.kind === 'group') return
    p.onClose()
    if (row.kind === 'file') p.onOpenFile(row.item.id)
    else if (row.kind === 'folder') p.onOpenFolder(row.folder.path)
    else p.onRunCommand(row.cmd.id)
  }

  const onKeyDown = (e: KeyboardEvent): void => {
    const n = selectable.length
    const moves: Record<string, () => void> = {
      ArrowDown: () => setSelected((i) => (n ? (Math.min(i, n - 1) + 1) % n : 0)),
      ArrowUp: () => setSelected((i) => (n ? (Math.min(i, n - 1) - 1 + n) % n : 0)),
      PageDown: () => setSelected((i) => Math.min(n - 1, i + 8)),
      PageUp: () => setSelected((i) => Math.max(0, i - 8)),
      Enter: () => choose(rows[current]),
      Escape: p.onClose,
      Tab: () => undefined
    }
    const run = moves[e.key]
    if (!run) return
    e.preventDefault()
    e.stopPropagation()
    run()
  }

  const mode = p.foldersMode ? 'Folders' : isCommands ? 'Commands' : 'Files'
  const placeholder = p.foldersMode
    ? 'Open a recent folder'
    : isCommands
      ? 'Type a command'
      : 'Search files by name, or type > for commands'
  return (
    <div className="smd-overlay" onKeyDown={onKeyDown}>
      <div className="smd-scrim smd-scrim--light" onClick={p.onClose} />
      <div className="smd-palette-wrap" onClick={p.onClose}>
        <div
          ref={ref}
          className="smd-palette"
          role="dialog"
          aria-modal="true"
          aria-label={p.foldersMode ? 'Open recent folder' : isCommands ? 'Commands' : 'Quick open'}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="smd-palette-field">
            {isCommands ? (
              <CommandIcon size={17} />
            ) : p.foldersMode ? (
              <FolderIcon size={17} />
            ) : (
              <SearchIcon size={17} />
            )}
            <input
              className="smd-palette-input"
              data-autofocus
              value={p.query}
              placeholder={placeholder}
              onChange={(e) => p.onQuery(e.target.value)}
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={current >= 0 ? `${listId}-${current}` : undefined}
              spellCheck={false}
              autoComplete="off"
            />
            <span className="smd-chip smd-palette-mode">{mode}</span>
          </div>
          <ul ref={listRef} id={listId} className="smd-palette-list" role="listbox" aria-label={mode}>
            {rows.map((row, i) =>
              row.kind === 'group' ? (
                <li key={row.key} className="smd-palette-group" role="presentation">
                  {row.label}
                </li>
              ) : (
                <li
                  key={row.key}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === current}
                  className="smd-palette-item"
                  onMouseMove={() => {
                    const k = selectable.indexOf(i)
                    if (k !== selected) setSelected(k)
                  }}
                  onClick={() => choose(row)}
                >
                  {row.kind === 'file' ? (
                    <FileRowContent row={row} />
                  ) : row.kind === 'folder' ? (
                    <FolderRowContent row={row} />
                  ) : (
                    <CommandRowContent row={row} />
                  )}
                </li>
              )
            )}
          </ul>
          {selectable.length === 0 && (
            <div className="smd-palette-empty">
              {p.foldersMode
                ? 'No recent folders match.'
                : isCommands
                  ? 'No commands match.'
                  : p.files.length
                    ? 'No files match.'
                    : 'Open a folder or a file to search it here.'}
            </div>
          )}
          <div className="smd-palette-foot" aria-hidden="true">
            <span>
              <span className="smd-kbd">↑</span>
              <span className="smd-kbd">↓</span> move
            </span>
            <span>
              <span className="smd-kbd">↵</span> {isCommands ? 'run' : 'open'}
            </span>
            {!isCommands && !p.foldersMode && (
              <span>
                <span className="smd-kbd">&gt;</span> commands
              </span>
            )}
            <span style={{ marginLeft: 'auto' }}>
              <span className="smd-kbd">Esc</span> close
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

function FileRowContent({ row }: { row: Extract<Row, { kind: 'file' }> }) {
  const { item } = row
  return (
    <>
      {item.isAgent ? <SparkIcon size={16} style={{ color: 'var(--important)' }} /> : <FileTextIcon size={16} />}
      <span className="smd-palette-label">
        <Highlight text={item.name} positions={row.name} />
      </span>
      <span className="smd-palette-detail">
        <Highlight text={item.folder} positions={row.folder} />
      </span>
      <span className="smd-palette-meta">
        {item.pinned && <BookmarkFill size={12} style={{ color: 'var(--accent-fg)' }} />}
        {item.open && <span className="smd-chip">Open</span>}
      </span>
    </>
  )
}

function FolderRowContent({ row }: { row: Extract<Row, { kind: 'folder' }> }) {
  return (
    <>
      <FolderIcon size={16} />
      <span className="smd-palette-label">
        <Highlight text={row.folder.name} positions={row.name} />
      </span>
      <span className="smd-palette-detail">{row.folder.parent}</span>
    </>
  )
}

function CommandRowContent({ row }: { row: Extract<Row, { kind: 'command' }> }) {
  const { cmd } = row
  return (
    <>
      <span className="smd-palette-label" style={{ maxWidth: 'none', flex: 1 }}>
        <Highlight text={cmd.label} positions={row.label} />
      </span>
      <span className="smd-palette-meta">
        {row.showGroup && (
          <span className="smd-palette-detail" style={{ flex: 'none' }}>
            {cmd.group}
          </span>
        )}
        {cmd.shortcut && <span className="smd-kbd">{cmd.shortcut}</span>}
      </span>
    </>
  )
}
