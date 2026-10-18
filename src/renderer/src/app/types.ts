// The App shell's state shape, shared by the controller modules in this folder.
import type { Activity, MdFileInfo, MdFolderInfo, ReadingFont, RecoveryEntry, ThemeName, ViewMode } from '@shared/types'
import type { EditorJump } from '@/components/CodeEditor'
import type { ContextMenuState } from '@/components/ContextMenu'
import type { ToastState } from '@/components/Toast'
import type { CommandId } from '@/lib/commands'

export type SettingsSection = 'appearance' | 'reading' | 'editor' | 'shortcuts' | 'about'
/** Quick Open / command palette. A query starting with ">" searches commands. */
export interface PaletteState {
  query: string
  /** Pick from recent folders instead of files/commands. */
  folders?: boolean
}

/** A tab that was closed and can come back with Reopen closed tab. */
export interface ClosedTab {
  id: string
  index: number
}

export type DialogState =
  | {
      kind: 'confirm'
      title: string
      message: string
      confirmLabel: string
      danger?: boolean
      onConfirm: () => void | Promise<void>
    }
  /** "Save changes to …?" before closing these tabs. */
  | { kind: 'unsaved'; ids: string[] }
  /** The window is closing with unsaved edits. */
  | { kind: 'closeWindow' }
  /** Name entry for a rename (when the tree row isn't visible) or a new folder. */
  | { kind: 'rename'; path: string; isFolder: boolean }
  | { kind: 'newFolder'; parent: string }

export interface RenameState {
  path: string
  isFolder: boolean
}

export interface AppState {
  // Settings (persisted)
  theme: ThemeName
  accent: string
  readingFont: ReadingFont
  readingWidth: number
  readingSize: number
  lineHeight: number
  uiScale: number
  reduceMotion: boolean
  syncScroll: boolean
  blockRemoteImages: boolean
  showStatusBar: boolean
  activity: Activity
  sidebarOpen: boolean
  outlineOpen: boolean
  viewMode: ViewMode
  pinned: string[]
  recents: string[]
  openTabs: string[]
  activeId: string | null
  looseFiles: MdFileInfo[]
  /** Written by the main process; read back after each folder open. */
  recentFolders: string[]

  // Documents
  contents: Record<string, string>
  saved: Record<string, string>
  tree: MdFolderInfo[]
  root: string | null
  rootName: string
  expanded: Record<string, boolean>
  externalChanges: Record<string, boolean>
  /** Files an agent (or anything) added since the last rescan, until opened. */
  newPaths: Record<string, true>
  /** Folders created this session that have no Markdown file yet. */
  emptyFolders: string[]
  closed: ClosedTab[]
  untitledSeq: number

  // Window and transient UI
  ready: boolean
  systemDark: boolean
  /** Window narrower than the outline breakpoint. */
  narrow: boolean
  /** Window narrow enough that the sidebar overlays the document. */
  compact: boolean
  /** The overlay sidebar is showing (compact windows only). */
  sidebarPeek: boolean
  isMaximized: boolean
  focusMode: boolean
  searchQuery: string
  editorJump: EditorJump | null
  activeSlug: string | null
  dragOver: boolean
  menu: ContextMenuState | null
  dialog: DialogState | null
  toast: ToastState | null
  palette: PaletteState | null
  settings: SettingsSection | null
  readingOpen: boolean
  renaming: RenameState | null
  recovery: RecoveryEntry[] | null
  recentCommands: CommandId[]
}
