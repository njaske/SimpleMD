// Derived, presentational view-model shapes the App computes and passes to
// the dumb components. Kept free of behavior — handlers are passed separately
// as id-based callbacks.

export interface FileItem {
  id: string
  name: string
  active: boolean
  pinned: boolean
  /** Appeared on disk since the folder was opened (e.g. written by an agent), not opened yet. */
  isNew: boolean
  /** An instruction file coding agents read (AGENTS.md, CLAUDE.md, ...). */
  isAgent: boolean
}

export interface FolderItem {
  id: string
  name: string
  expanded: boolean
  files: FileItem[]
  /** Inside the open workspace (new file/folder, rename and trash are allowed). */
  inWorkspace: boolean
  /** The workspace root itself (can't be renamed or trashed from the tree). */
  isRoot: boolean
}

export interface TreeModel {
  /** Agent instruction files, shown as a small group above the folders. */
  agentFiles: FileItem[]
  folders: FolderItem[]
}

export interface TabItem {
  id: string
  name: string
  /** Shown on the tab: the name without its Markdown extension (kept in the tooltip). */
  label: string
  active: boolean
  pinned: boolean
  dirty: boolean
  /** A new document that has never been saved. */
  untitled: boolean
  /** Full path for the tooltip; empty for untitled documents. */
  path: string
}

export interface OutlineItem {
  key: number
  slug: string
  text: string
  level: number
}

export interface NamedFileRef {
  id: string
  name: string
  folder: string
}

/** One file in Quick Open. */
export interface QuickOpenItem {
  id: string
  name: string
  /** Muted folder path shown after the name. */
  folder: string
  pinned: boolean
  isAgent: boolean
  open: boolean
}
