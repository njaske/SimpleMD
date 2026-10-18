// Builds the presentational view models (tree, tabs, quick open, search input) from
// App state. Pure; predicates that live in other lanes' modules are passed in.
import type { MdFileInfo, MdFolderInfo } from '@shared/types'
import type { SearchableFile } from '@/lib/document'
import type { FileItem, FolderItem, QuickOpenItem, TabItem, TreeModel } from '@/state/viewmodel'
import type { AppState } from './types'
import { baseName, displayDir, isDirtyIn, isUntitled, isWithin } from './model'

export interface FileMeta {
  name: string
  folderName: string
  dir: string
}

type IndexInput = Pick<AppState, 'tree' | 'looseFiles'>

/** Every known file (workspace and loose) by path. */
export function buildIndex({ tree, looseFiles }: IndexInput): Map<string, FileMeta> {
  const map = new Map<string, FileMeta>()
  for (const folder of tree) {
    for (const f of folder.files) map.set(f.path, { name: f.name, folderName: folder.name, dir: f.dir })
  }
  for (const lf of looseFiles) {
    if (!map.has(lf.path)) map.set(lf.path, { name: lf.name, folderName: baseName(lf.dir), dir: lf.dir })
  }
  return map
}

type TreeInput = Pick<
  AppState,
  'tree' | 'looseFiles' | 'expanded' | 'pinned' | 'activeId' | 'newPaths' | 'root' | 'emptyFolders'
>

export function folderLabel(dir: string, root: string | null): string {
  if (!root || !isWithin(dir, root) || dir === root) return baseName(dir)
  return dir
    .slice(root.length)
    .replace(/^[\\/]+/, '')
    .split(/[\\/]/)
    .join('  /  ')
}

/** The sidebar tree: workspace folders, loose-file groups by directory, plus an
 *  "Agent instructions" group pulled from both. */
export function buildTree(s: TreeInput, isAgent: (name: string) => boolean): TreeModel {
  const pinnedSet = new Set(s.pinned)
  const item = (f: MdFileInfo): FileItem => ({
    id: f.path,
    name: f.name,
    active: f.path === s.activeId,
    pinned: pinnedSet.has(f.path),
    isNew: !!s.newPaths[f.path],
    isAgent: isAgent(f.name)
  })
  const groups = new Map<string, FolderItem>()
  const order: string[] = []
  const addGroup = (id: string, name: string): FolderItem => {
    const inWorkspace = !!s.root && isWithin(id, s.root)
    const group: FolderItem = {
      id,
      name,
      expanded: s.expanded[id] ?? true,
      files: [],
      inWorkspace,
      isRoot: id === s.root
    }
    groups.set(id, group)
    order.push(id)
    return group
  }
  for (const folder of s.tree) addGroup(folder.id, folder.name).files.push(...folder.files.map(item))
  for (const dir of s.emptyFolders) if (!groups.has(dir)) addGroup(dir, folderLabel(dir, s.root))
  for (const lf of s.looseFiles) {
    const group = groups.get(lf.dir) ?? addGroup(lf.dir, baseName(lf.dir))
    if (!group.files.some((f) => f.id === lf.path)) group.files.push(item(lf))
  }
  const folders = order.map((id) => groups.get(id) as FolderItem)
  const agentFiles = folders.flatMap((f) => f.files.filter((x) => x.isAgent))
  return { agentFiles, folders }
}

type TabsInput = Pick<AppState, 'openTabs' | 'activeId' | 'pinned' | 'contents' | 'saved'>

const MD_EXT = /\.(md|markdown|mdown|mkd|mdx)$/i

/** A tab's label: "notes" for "notes.md", so narrow tabs keep the part that differs. */
export function tabLabel(name: string): string {
  const stem = name.replace(MD_EXT, '')
  return stem || name
}

export function buildTabs(s: TabsInput, nameOf: (id: string) => string): TabItem[] {
  return s.openTabs.map((id) => {
    const name = nameOf(id)
    return {
      id,
      name,
      label: tabLabel(name),
      active: id === s.activeId,
      pinned: s.pinned.includes(id),
      dirty: isDirtyIn(s.contents, s.saved, id),
      untitled: isUntitled(id),
      path: isUntitled(id) ? '' : id
    }
  })
}

type QuickInput = Pick<AppState, 'recents' | 'pinned' | 'openTabs' | 'root' | 'rootName'>

/** Quick Open candidates: every known file plus recent files, open and pinned first. */
export function buildQuickOpen(
  s: QuickInput,
  index: ReadonlyMap<string, FileMeta>,
  isAgent: (name: string) => boolean
): QuickOpenItem[] {
  const pinned = new Set(s.pinned)
  const open = new Set(s.openTabs)
  const paths = [...new Set([...s.openTabs.filter((t) => !isUntitled(t)), ...s.recents, ...index.keys()])]
  const items = paths.map((id) => {
    const meta = index.get(id)
    const name = meta?.name ?? baseName(id)
    const dir = meta?.dir ?? id.slice(0, Math.max(0, id.length - name.length - 1))
    return {
      id,
      name,
      folder: displayDir(dir, s.root, s.rootName),
      pinned: pinned.has(id),
      isAgent: isAgent(name),
      open: open.has(id)
    }
  })
  return items
}

/** Every searchable document (workspace + loose) with its current text. */
export function searchableFiles(
  tree: readonly MdFolderInfo[],
  looseFiles: readonly MdFileInfo[],
  contents: Record<string, string>
): SearchableFile[] {
  const seen = new Set<string>()
  const files: SearchableFile[] = []
  for (const folder of tree) {
    for (const f of folder.files) {
      seen.add(f.path)
      files.push({ id: f.path, name: f.name, folderName: folder.name, content: contents[f.path] ?? '' })
    }
  }
  for (const lf of looseFiles) {
    if (!seen.has(lf.path))
      files.push({ id: lf.path, name: lf.name, folderName: baseName(lf.dir), content: contents[lf.path] ?? '' })
  }
  return files
}
