// Pure document-model helpers for the App shell: paths, tabs and the immutable
// state transitions behind open/close/rename/save-as and folder reconciliation.
// Only type imports, so node:test loads this file directly.
import type { FolderScan, MdFileInfo, MdFolderInfo } from '@shared/types'
import type { AppState, ClosedTab } from './types'

// ---- paths -------------------------------------------------------------------

export const UNTITLED_PREFIX = 'untitled:'
export const MAX_RECENTS = 8
export const MAX_CLOSED = 20

export function isUntitled(id: string | null | undefined): boolean {
  return !!id && id.startsWith(UNTITLED_PREFIX)
}

export function untitledId(n: number): string {
  return `${UNTITLED_PREFIX}${n}`
}

/** Last path segment of a file/dir path (handles / and \). */
export function baseName(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] || p
}

/** Parent directory of a path. */
export function dirOf(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  if (i > 0) return p.slice(0, i)
  // "/notes" lives in "/"; a bare name has no parent to show.
  return i === 0 ? p.slice(0, 1) : p
}

export function joinPath(dir: string, name: string): string {
  const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/'
  return dir.endsWith(sep) ? dir + name : dir + sep + name
}

function normPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '')
}

/** True when `p` is `dir` itself or inside it. */
export function isWithin(p: string, dir: string): boolean {
  return p === dir || normPath(p).startsWith(normPath(dir) + '/')
}

/** `p` with its `from` prefix swapped for `to` (renamed folders); null when outside. */
export function rebase(p: string, from: string, to: string): string | null {
  if (p === from) return to
  return isWithin(p, from) ? to + p.slice(from.length) : null
}

/** Length of a file name's stem, so a rename field selects "notes" in "notes.md". */
export function stemLength(name: string): number {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? dot : name.length
}

/** A folder path for display: "workspace/sub/dir" inside the workspace, else the path. */
export function displayDir(dir: string, root: string | null, rootName: string): string {
  if (root && isWithin(dir, root)) {
    const rest = dir.slice(root.length).replace(/^[\\/]+/, '')
    return rest ? `${rootName}/${rest.replace(/\\/g, '/')}` : rootName
  }
  return dir.replace(/\\/g, '/')
}

/** A name that isn't taken yet: "Untitled.md", "Untitled 2.md", ... */
export function uniqueName(base: string, ext: string, taken: Iterable<string>): string {
  const lower = new Set([...taken].map((t) => t.toLowerCase()))
  let n = 1
  let name = `${base}${ext}`
  while (lower.has(name.toLowerCase())) name = `${base} ${++n}${ext}`
  return name
}

// ---- small immutable helpers ------------------------------------------------------

export function without<T>(rec: Record<string, T>, ...keys: string[]): Record<string, T> {
  if (!keys.some((k) => k in rec)) return rec
  const next = { ...rec }
  for (const k of keys) delete next[k]
  return next
}

export function isDirtyIn(contents: Record<string, string>, saved: Record<string, string>, id: string): boolean {
  const c = contents[id]
  const s = saved[id]
  return c !== undefined && s !== undefined && c !== s
}

export function unsavedIds(contents: Record<string, string>, saved: Record<string, string>): string[] {
  return Object.keys(contents).filter((id) => isDirtyIn(contents, saved, id))
}

export function pushRecents(ids: readonly string[], prev: readonly string[]): string[] {
  const merged = [...ids.filter((id) => !isUntitled(id)), ...prev]
  return merged.filter((v, i) => merged.indexOf(v) === i).slice(0, MAX_RECENTS)
}

// ---- tabs -----------------------------------------------------------------------

/** The tab to activate when `closing` tabs go away (right neighbour first). */
export function neighbourAfterClose(
  openTabs: readonly string[],
  activeId: string | null,
  closing: ReadonlySet<string>
): string | null {
  if (!activeId || !closing.has(activeId)) return activeId
  const idx = openTabs.indexOf(activeId)
  const after = openTabs.slice(idx + 1).find((t) => !closing.has(t))
  const before = [...openTabs.slice(0, Math.max(0, idx))].reverse().find((t) => !closing.has(t))
  return after ?? before ?? null
}

export interface TabsResult {
  openTabs: string[]
  activeId: string | null
  closed: ClosedTab[]
}

/** Close `ids`, remembering real files so Reopen closed tab can bring them back. */
export function closeTabs(s: Pick<AppState, 'openTabs' | 'activeId' | 'closed'>, ids: readonly string[]): TabsResult {
  const closing = new Set(ids)
  const remembered: ClosedTab[] = s.openTabs
    .map((id, index) => ({ id, index }))
    .filter((t) => closing.has(t.id) && !isUntitled(t.id))
    .reverse()
  return {
    openTabs: s.openTabs.filter((t) => !closing.has(t)),
    activeId: neighbourAfterClose(s.openTabs, s.activeId, closing),
    closed: [...remembered, ...s.closed].slice(0, MAX_CLOSED)
  }
}

/** Tabs to the right of `id`. */
export function tabsRightOf(openTabs: readonly string[], id: string): string[] {
  const i = openTabs.indexOf(id)
  return i < 0 ? [] : openTabs.slice(i + 1)
}

/** The tab `delta` steps from the active one (wraps). */
export function cycleTab(openTabs: readonly string[], activeId: string | null, delta: number): string | null {
  if (!openTabs.length) return null
  const i = activeId ? openTabs.indexOf(activeId) : -1
  const n = openTabs.length
  return openTabs[((((i < 0 ? 0 : i) + delta) % n) + n) % n]
}

/** Insert `id` at `index` (clamped) unless it is already open. */
export function insertTab(openTabs: readonly string[], id: string, index: number): string[] {
  if (openTabs.includes(id)) return [...openTabs]
  const at = Math.max(0, Math.min(index, openTabs.length))
  return [...openTabs.slice(0, at), id, ...openTabs.slice(at)]
}

// ---- moving a document to a new id (rename, save as) --------------------------------

export type DocSlice = Pick<
  AppState,
  | 'openTabs'
  | 'activeId'
  | 'contents'
  | 'saved'
  | 'pinned'
  | 'recents'
  | 'looseFiles'
  | 'externalChanges'
  | 'expanded'
  | 'closed'
  | 'newPaths'
>

function remapKeys<T>(rec: Record<string, T>, map: (k: string) => string | null): Record<string, T> {
  let changed = false
  const out: Record<string, T> = {}
  for (const [k, v] of Object.entries(rec)) {
    const next = map(k)
    if (next !== null && next !== k) changed = true
    out[next ?? k] = v
  }
  return changed ? out : rec
}

/** Every reference to `from` (a file, or a folder and everything in it) now points at `to`.
 *  Contents and unsaved edits travel with the path. */
export function remapPaths(s: DocSlice, from: string, to: string): DocSlice {
  const map = (p: string): string | null => rebase(p, from, to)
  const one = (p: string): string => map(p) ?? p
  return {
    openTabs: s.openTabs.map(one),
    activeId: s.activeId ? one(s.activeId) : null,
    contents: remapKeys(s.contents, map),
    saved: remapKeys(s.saved, map),
    pinned: s.pinned.map(one),
    recents: s.recents.map(one),
    looseFiles: s.looseFiles.map((f) => {
      const path = map(f.path)
      if (!path) return f
      return { id: path, path, name: baseName(path), dir: dirOf(path) }
    }),
    externalChanges: remapKeys(s.externalChanges, map),
    expanded: remapKeys(s.expanded, map),
    closed: s.closed.map((c) => ({ ...c, id: one(c.id) })),
    newPaths: remapKeys(s.newPaths, map)
  }
}

/** Save as onto the document's own file is a plain save: nothing else moves. */
function savedInPlace(s: DocSlice, path: string, content: string): DocSlice {
  return {
    ...s,
    contents: { ...s.contents, [path]: content },
    saved: { ...s.saved, [path]: content },
    externalChanges: without(s.externalChanges, path),
    recents: pushRecents([path], s.recents)
  }
}

/** The old file's buffer after its text was saved elsewhere: an untitled one goes away,
 *  a real file falls back to its last saved text (it wasn't written). */
function leftBehind(rec: Record<string, string>, saved: Record<string, string>, fromId: string): Record<string, string> {
  if (isUntitled(fromId)) return without(rec, fromId)
  return saved[fromId] === undefined ? rec : { ...rec, [fromId]: saved[fromId] }
}

/** An untitled tab became the file at `path` (Save as): same tab position, text kept and
 *  now saved. A real file saved under a new name keeps its old file's last saved text.
 *  When `path` is already open in another tab, that tab takes over. */
export function adoptSavedAs(s: DocSlice, fromId: string, path: string, content: string, loose: boolean): DocSlice {
  if (path === fromId) return savedInPlace(s, path, content)
  const openTabs = s.openTabs.includes(path)
    ? s.openTabs.filter((t) => t !== fromId)
    : s.openTabs.map((t) => (t === fromId ? path : t))
  const contents = { ...leftBehind(s.contents, s.saved, fromId), [path]: content }
  const saved = { ...(isUntitled(fromId) ? without(s.saved, fromId) : s.saved), [path]: content }
  const looseFiles =
    loose && !s.looseFiles.some((f) => f.path === path)
      ? [...s.looseFiles, { id: path, path, name: baseName(path), dir: dirOf(path) }]
      : s.looseFiles
  return {
    ...s,
    openTabs,
    activeId: s.activeId === fromId ? path : s.activeId,
    contents,
    saved,
    looseFiles,
    externalChanges: without(s.externalChanges, path),
    recents: pushRecents([path], s.recents)
  }
}

/** Forget a document entirely (deleted, removed from the sidebar, discarded untitled). */
export function dropDoc(s: DocSlice, id: string): DocSlice {
  const tabs = closeTabs({ openTabs: s.openTabs, activeId: s.activeId, closed: s.closed }, [id])
  return {
    ...s,
    openTabs: tabs.openTabs,
    activeId: tabs.activeId,
    closed: s.closed.filter((c) => c.id !== id),
    contents: without(s.contents, id),
    saved: without(s.saved, id),
    externalChanges: without(s.externalChanges, id),
    newPaths: without(s.newPaths, id),
    pinned: s.pinned.filter((p) => p !== id),
    recents: s.recents.filter((r) => r !== id),
    looseFiles: s.looseFiles.filter((f) => f.path !== id)
  }
}

// ---- workspace tree -------------------------------------------------------------------

/** `file` added to its folder group (creating the group), until the next scan replaces the tree. */
export function insertTreeFile(tree: readonly MdFolderInfo[], file: MdFileInfo, folderName: string): MdFolderInfo[] {
  const has = tree.some((f) => f.id === file.dir)
  if (!has) return [...tree, { id: file.dir, name: folderName, path: file.dir, files: [file] }]
  return tree.map((f) =>
    f.id !== file.dir || f.files.some((x) => x.path === file.path)
      ? f
      : { ...f, files: [...f.files, file].sort((a, b) => a.name.localeCompare(b.name)) }
  )
}

export interface ReconcileResult {
  tree: MdFolderInfo[]
  contents: Record<string, string>
  saved: Record<string, string>
  externalChanges: Record<string, boolean>
  openTabs: string[]
  activeId: string | null
  /** Paths whose text changed on disk while they were clean (reloaded). */
  reloaded: string[]
  removed: number
  added: string[]
}

export interface MergedDocs {
  contents: Record<string, string>
  saved: Record<string, string>
  externalChanges: Record<string, boolean>
  /** Paths whose text changed on disk while they were clean (reloaded). */
  reloaded: string[]
  /** Paths whose unsaved edits were kept although the disk text differs. */
  conflicts: string[]
}

/** Disk text from a scan folded into the buffers: clean files take the disk text,
 *  dirty ones keep their edits (flagged as a conflict when the disk diverged). */
export function mergeScanDocs(
  s: Pick<AppState, 'contents' | 'saved' | 'externalChanges'>,
  scan: Pick<FolderScan, 'contents'>
): MergedDocs {
  const contents = { ...s.contents }
  const saved = { ...s.saved }
  const externalChanges = { ...s.externalChanges }
  const reloaded: string[] = []
  const conflicts: string[] = []
  for (const [id, diskText] of Object.entries(scan.contents)) {
    if (isDirtyIn(contents, saved, id)) {
      if (diskText !== saved[id]) {
        externalChanges[id] = true
        conflicts.push(id)
      }
      continue
    }
    if (contents[id] !== undefined && contents[id] !== diskText) reloaded.push(id)
    contents[id] = diskText
    saved[id] = diskText
    delete externalChanges[id]
  }
  return { contents, saved, externalChanges, reloaded, conflicts }
}

/** Tabs that must survive replacing the tab strip (opening a folder): untitled
 *  documents and anything with unsaved edits, so no edit ever disappears from view. */
export function tabsToCarry(s: Pick<AppState, 'openTabs' | 'contents' | 'saved'>): string[] {
  return s.openTabs.filter((t) => isUntitled(t) || isDirtyIn(s.contents, s.saved, t))
}

/** Fold a fresh scan into the open documents without ever clobbering unsaved edits:
 *  clean files reload, dirty ones that diverged on disk get flagged as conflicts, and
 *  vanished clean files close. */
export function reconcileScan(
  s: Pick<AppState, 'tree' | 'contents' | 'saved' | 'externalChanges' | 'openTabs' | 'activeId' | 'looseFiles'>,
  scan: FolderScan
): ReconcileResult {
  const { contents, saved, externalChanges, reloaded } = mergeScanDocs(s, scan)

  // Workspace files that vanished from disk go away (unless edited or loose).
  const looseSet = new Set(s.looseFiles.map((f) => f.path))
  let removed = 0
  for (const file of s.tree.flatMap((f) => f.files)) {
    const p = file.path
    if (scan.contents[p] !== undefined || looseSet.has(p)) continue
    if (isDirtyIn(contents, saved, p)) {
      externalChanges[p] = true
      continue
    }
    delete contents[p]
    delete saved[p]
    delete externalChanges[p]
    removed++
  }
  const keep = (p: string): boolean => contents[p] !== undefined || looseSet.has(p) || isUntitled(p)
  const openTabs = removed > 0 ? s.openTabs.filter(keep) : s.openTabs
  const activeId = s.activeId && !keep(s.activeId) ? (openTabs[0] ?? null) : s.activeId

  const before = new Set(s.tree.flatMap((f) => f.files.map((x) => x.path)))
  const added = scan.tree.flatMap((f) => f.files.map((x) => x.path)).filter((p) => !before.has(p))
  return { tree: scan.tree, contents, saved, externalChanges, openTabs, activeId, reloaded, removed, added }
}

/** One-line summary of a reconcile for a toast, or null when nothing visible happened. */
export function reconcileNote(r: Pick<ReconcileResult, 'reloaded' | 'removed'>): string | null {
  const n = r.reloaded.length
  if (n > 0) return `Reloaded ${n} file${n === 1 ? '' : 's'} changed on disk`
  if (r.removed > 0) return `${r.removed} file${r.removed === 1 ? ' was' : 's were'} removed on disk`
  return null
}

/** Tabs a freshly opened folder starts with: enough to begin reading without
 *  flooding the strip (the rest are one click away in the tree or "Open all"). */
export const MAX_AUTO_OPEN = 4
const LEAD_FILE = /^(readme|index)\.(md|markdown)$/i

/** The files a newly opened folder shows as tabs: its README (or index) first,
 *  then the rest in tree order, capped at `max`. */
export function autoOpenFiles(allFiles: readonly string[], max = MAX_AUTO_OPEN): string[] {
  const lead = allFiles.find((p) => LEAD_FILE.test(baseName(p)))
  const ordered = lead ? [lead, ...allFiles.filter((p) => p !== lead)] : allFiles
  return ordered.slice(0, max)
}

/** Folders expanded after opening a workspace: all of them when there are few. */
export function initialExpanded(tree: readonly MdFolderInfo[]): Record<string, boolean> {
  return Object.fromEntries(tree.map((folder, i) => [folder.id, tree.length <= 6 ? true : i < 3]))
}

/** The tree after renaming `from` to `to` (a file or a folder), until the next scan. */
export function remapTree(tree: readonly MdFolderInfo[], from: string, to: string): MdFolderInfo[] {
  const map = (p: string): string => rebase(p, from, to) ?? p
  return tree.map((folder) => {
    const id = map(folder.id)
    const renamedFolder = id !== folder.id
    const files = folder.files.map((f) => {
      const path = map(f.path)
      return path === f.path ? f : { id: path, path, name: baseName(path), dir: dirOf(path) }
    })
    const name = renamedFolder && folder.name.split(/\s+\/\s+/).length === 1 ? baseName(id) : folder.name
    return renamedFolder || files.some((f, i) => f !== folder.files[i])
      ? { ...folder, id, path: id, name, files }
      : folder
  })
}

/** Names already used by known files in `dir` (for unique new names). */
export function namesIn(dir: string, paths: Iterable<string>): string[] {
  return [...paths].filter((p) => dirOf(p) === dir).map(baseName)
}
