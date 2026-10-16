// Derived, presentational view-model shapes the App computes and passes to
// the dumb components. Kept free of behavior — handlers are passed separately
// as id-based callbacks.

export interface FileItem {
  id: string
  name: string
  active: boolean
  pinned: boolean
}

export interface FolderItem {
  id: string
  name: string
  expanded: boolean
  files: FileItem[]
}

export interface TabItem {
  id: string
  name: string
  active: boolean
  pinned: boolean
  dirty: boolean
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
