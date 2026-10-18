// The command registry: one source of truth for the command palette, the global
// keyboard handler and the Shortcuts sheet. Specs are static data; the App binds
// a handler (and optionally an enabled predicate) to each id at runtime, and a
// command without a handler simply doesn't exist yet (no dead palette rows).
// Type-only imports keep this module loadable by node:test.
import type { Platform } from '@shared/types'
import type { KeyLike, Shortcut } from '@/lib/logic/platform'

export type CommandGroup = 'Documents' | 'Tabs' | 'View' | 'Reading' | 'Files' | 'Export' | 'Help'

export type CommandId =
  | 'newDocument'
  | 'openFile'
  | 'openFolder'
  | 'openRecentFolder'
  | 'pasteFromAi'
  | 'save'
  | 'saveAs'
  | 'saveAll'
  | 'closeTab'
  | 'closeOtherTabs'
  | 'closeAllTabs'
  | 'reopenClosedTab'
  | 'nextTab'
  | 'previousTab'
  | 'quickOpen'
  | 'commandPalette'
  | 'findInDocument'
  | 'searchAllFiles'
  | 'viewRead'
  | 'viewSplit'
  | 'viewEdit'
  | 'toggleReadEdit'
  | 'toggleSidebar'
  | 'toggleOutline'
  | 'toggleStatusBar'
  | 'focusMode'
  | 'toggleTheme'
  | 'themeLight'
  | 'themeDark'
  | 'themeSepia'
  | 'themeSystem'
  | 'textBigger'
  | 'textSmaller'
  | 'textReset'
  | 'toggleSyncScroll'
  | 'toggleRemoteImages'
  | 'nextChange'
  | 'dismissChanges'
  | 'followEnd'
  | 'reloadFromDisk'
  | 'rename'
  | 'duplicate'
  | 'newFileInFolder'
  | 'newFolder'
  | 'revealInFolder'
  | 'copyPath'
  | 'moveToTrash'
  | 'exportPdf'
  | 'exportHtml'
  | 'copyRichText'
  | 'print'
  | 'settings'
  | 'shortcuts'

/** Who gets a shortcut while the Markdown editor has focus (spec 3.1 conflict rule). */
export type EditorRule = 'app' | 'editor'

export interface CommandSpec {
  id: CommandId
  label: string
  group: CommandGroup
  /** First one is shown in the palette and the Shortcuts sheet. */
  shortcuts?: readonly Shortcut[]
  /** Extra words the palette matches on. */
  keywords?: string
  /** Default 'app'. 'editor': the editor's own binding wins while it has focus. */
  inEditor?: EditorRule
  /** Only these of the shortcuts belong to the editor while it has focus (Mod+K is
   *  "insert link" there, while Mod+Shift+P still opens the palette). */
  editorOwns?: readonly Shortcut[]
  /** Hidden from the palette (still a shortcut), e.g. opening the palette itself. */
  hideInPalette?: boolean
  /** A focused text field keeps this shortcut too (Mod+Shift+V pastes plain text there). */
  textFieldWins?: boolean
}

export const COMMANDS: readonly CommandSpec[] = [
  {
    id: 'newDocument',
    label: 'New document',
    group: 'Documents',
    shortcuts: ['Mod+N'],
    keywords: 'create untitled blank'
  },
  { id: 'openFile', label: 'Open file…', group: 'Documents', shortcuts: ['Mod+O'] },
  { id: 'openFolder', label: 'Open folder…', group: 'Documents', shortcuts: ['Mod+Shift+O'], keywords: 'workspace' },
  { id: 'openRecentFolder', label: 'Open recent folder…', group: 'Documents', keywords: 'workspace history' },
  {
    id: 'pasteFromAi',
    label: 'Paste from AI as a new document',
    group: 'Documents',
    shortcuts: ['Mod+Shift+V'],
    keywords: 'chatgpt claude clipboard answer',
    inEditor: 'editor',
    textFieldWins: true
  },
  { id: 'save', label: 'Save', group: 'Documents', shortcuts: ['Mod+S'] },
  { id: 'saveAs', label: 'Save as…', group: 'Documents', shortcuts: ['Mod+Shift+S'] },
  { id: 'saveAll', label: 'Save all', group: 'Documents', shortcuts: ['Mod+Alt+S'] },
  { id: 'reloadFromDisk', label: 'Reload from disk', group: 'Documents', keywords: 'revert discard refresh' },

  { id: 'closeTab', label: 'Close tab', group: 'Tabs', shortcuts: ['Mod+W'] },
  { id: 'closeOtherTabs', label: 'Close other tabs', group: 'Tabs' },
  { id: 'closeAllTabs', label: 'Close all tabs', group: 'Tabs' },
  { id: 'reopenClosedTab', label: 'Reopen closed tab', group: 'Tabs', shortcuts: ['Mod+Shift+T'] },
  { id: 'nextTab', label: 'Next tab', group: 'Tabs', shortcuts: ['Ctrl+Tab', 'Mod+Alt+ArrowRight'] },
  { id: 'previousTab', label: 'Previous tab', group: 'Tabs', shortcuts: ['Ctrl+Shift+Tab', 'Mod+Alt+ArrowLeft'] },

  { id: 'quickOpen', label: 'Quick open', group: 'View', shortcuts: ['Mod+P'], keywords: 'go to file find file' },
  {
    id: 'commandPalette',
    label: 'Command palette',
    group: 'View',
    shortcuts: ['Mod+K', 'Mod+Shift+P'],
    editorOwns: ['Mod+K'],
    hideInPalette: true
  },
  { id: 'findInDocument', label: 'Find in document', group: 'View', shortcuts: ['Mod+F'], inEditor: 'editor' },
  { id: 'searchAllFiles', label: 'Search all files', group: 'View', shortcuts: ['Mod+Shift+F'] },
  { id: 'viewRead', label: 'Read', group: 'View', shortcuts: ['Mod+1'], keywords: 'reading mode preview' },
  { id: 'viewSplit', label: 'Split view', group: 'View', shortcuts: ['Mod+2'], keywords: 'side by side' },
  { id: 'viewEdit', label: 'Edit', group: 'View', shortcuts: ['Mod+3'], keywords: 'source editor' },
  { id: 'toggleReadEdit', label: 'Toggle Read and Edit', group: 'View', shortcuts: ['Mod+E'] },
  { id: 'toggleSidebar', label: 'Toggle sidebar', group: 'View', shortcuts: ['Mod+B'], inEditor: 'editor' },
  {
    id: 'toggleOutline',
    label: 'Toggle outline',
    group: 'View',
    shortcuts: ['Mod+\\'],
    keywords: 'on this page headings'
  },
  { id: 'toggleStatusBar', label: 'Toggle status bar', group: 'View' },
  { id: 'focusMode', label: 'Focus mode', group: 'View', shortcuts: ['Mod+.'], keywords: 'zen distraction free' },

  {
    id: 'toggleTheme',
    label: 'Toggle light and dark',
    group: 'Reading',
    shortcuts: ['Mod+Shift+D'],
    keywords: 'theme'
  },
  { id: 'themeLight', label: 'Theme: Light', group: 'Reading', keywords: 'paper' },
  { id: 'themeDark', label: 'Theme: Dark', group: 'Reading', keywords: 'ink night' },
  { id: 'themeSepia', label: 'Theme: Sepia', group: 'Reading', keywords: 'warm' },
  { id: 'themeSystem', label: 'Theme: System', group: 'Reading', keywords: 'auto os' },
  { id: 'textBigger', label: 'Bigger text', group: 'Reading', shortcuts: ['Mod+='], keywords: 'zoom in font size' },
  { id: 'textSmaller', label: 'Smaller text', group: 'Reading', shortcuts: ['Mod+-'], keywords: 'zoom out font size' },
  { id: 'textReset', label: 'Reset text size', group: 'Reading', shortcuts: ['Mod+0'] },
  { id: 'toggleSyncScroll', label: 'Toggle synced scrolling', group: 'Reading', keywords: 'split scroll' },
  { id: 'toggleRemoteImages', label: 'Block remote images', group: 'Reading', keywords: 'privacy load images' },
  { id: 'nextChange', label: 'Next change', group: 'Reading', shortcuts: ['Alt+N'], keywords: 'what changed diff' },
  { id: 'dismissChanges', label: 'Dismiss changes', group: 'Reading', keywords: 'what changed clear' },
  { id: 'followEnd', label: 'Follow end of file', group: 'Reading', keywords: 'tail agent live' },

  { id: 'rename', label: 'Rename…', group: 'Files', shortcuts: ['F2'] },
  { id: 'duplicate', label: 'Duplicate', group: 'Files', keywords: 'copy' },
  { id: 'newFileInFolder', label: 'New file in folder', group: 'Files' },
  { id: 'newFolder', label: 'New folder', group: 'Files' },
  { id: 'revealInFolder', label: 'Reveal in folder', group: 'Files', keywords: 'explorer finder files show' },
  { id: 'copyPath', label: 'Copy path', group: 'Files' },
  { id: 'moveToTrash', label: 'Move to Trash', group: 'Files', keywords: 'delete remove recycle bin' },

  { id: 'exportPdf', label: 'Export PDF…', group: 'Export', shortcuts: ['Mod+Shift+E'] },
  { id: 'exportHtml', label: 'Export HTML…', group: 'Export', keywords: 'web page standalone' },
  { id: 'copyRichText', label: 'Copy as rich text', group: 'Export', keywords: 'html docs word email' },
  { id: 'print', label: 'Print…', group: 'Export' },

  { id: 'settings', label: 'Settings', group: 'Help', shortcuts: ['Mod+,'], keywords: 'preferences options' },
  {
    id: 'shortcuts',
    label: 'Keyboard shortcuts',
    group: 'Help',
    shortcuts: ['Mod+/'],
    keywords: 'keys help cheat sheet'
  }
]

/** Editor-only bindings (lane E), listed in the Shortcuts sheet next to the commands. */
export const EDITOR_SHORTCUTS: readonly { label: string; shortcut: Shortcut }[] = [
  { label: 'Bold', shortcut: 'Mod+B' },
  { label: 'Italic', shortcut: 'Mod+I' },
  { label: 'Link', shortcut: 'Mod+K' },
  { label: 'Inline code', shortcut: 'Mod+Shift+C' },
  { label: 'Strikethrough', shortcut: 'Mod+Shift+X' },
  { label: 'Heading 1', shortcut: 'Mod+Alt+1' },
  { label: 'Heading 2', shortcut: 'Mod+Alt+2' },
  { label: 'Heading 3', shortcut: 'Mod+Alt+3' },
  { label: 'Quote', shortcut: 'Mod+Shift+.' },
  { label: 'Bulleted list', shortcut: 'Mod+Shift+8' },
  { label: 'Numbered list', shortcut: 'Mod+Shift+7' },
  { label: 'Task list', shortcut: 'Mod+Shift+9' },
  { label: 'Paste as plain text', shortcut: 'Mod+Shift+V' }
]

export const GROUP_ORDER: readonly CommandGroup[] = ['Documents', 'Tabs', 'View', 'Reading', 'Files', 'Export', 'Help']

const BY_ID = new Map(COMMANDS.map((c) => [c.id, c]))

export function commandSpec(id: CommandId): CommandSpec {
  const spec = BY_ID.get(id)
  if (!spec) throw new Error(`Unknown command ${id}`)
  return spec
}

/** Where the keyboard focus is when a key is pressed. */
export interface KeyContext {
  /** The Markdown editor (CodeMirror) has focus. */
  inEditor: boolean
  /** A text field (search box, rename input, palette) has focus. */
  inTextField: boolean
}

/** Whether the app (rather than the focused editor or text field) handles `spec`. */
export function appHandles(spec: CommandSpec, ctx: KeyContext): boolean {
  if (ctx.inEditor && spec.inEditor === 'editor') return false
  // Bare keys (F2, Alt+N) belong to the text field being typed in.
  if (ctx.inTextField && !ctx.inEditor) {
    if (spec.textFieldWins) return false
    const sc = spec.shortcuts ?? []
    return sc.some((s) => s.includes('Mod+') || s.startsWith('Ctrl+'))
  }
  return true
}

export type ShortcutMatcher = (e: KeyLike, shortcut: Shortcut, platform: Platform) => boolean

/** The physical letter/digit behind a key event, so Option (macOS) and Shift
 *  variants ("ß" for ⌥S, "*" for Shift+8) still match letter shortcuts. */
export function keyFromCode(e: KeyLike): KeyLike | null {
  const code = e.code ?? ''
  const m = /^(?:Key([A-Z])|Digit([0-9]))$/.exec(code)
  if (!m) return null
  const key = (m[1] ?? m[2]).toLowerCase()
  return key === e.key.toLowerCase() ? null : { ...e, key }
}

/** A literal Ctrl shortcut ("Ctrl+Tab") means the Control key on every platform. */
function matchesLiteralCtrl(e: KeyLike, shortcut: Shortcut): boolean {
  const parts = shortcut.split('+')
  const key = parts[parts.length - 1].toLowerCase()
  return (
    e.ctrlKey &&
    !e.metaKey &&
    e.altKey === parts.includes('Alt') &&
    e.shiftKey === parts.includes('Shift') &&
    e.key.toLowerCase() === key
  )
}

export function matchesKey(e: KeyLike, shortcut: Shortcut, platform: Platform, match: ShortcutMatcher): boolean {
  if (shortcut.startsWith('Ctrl+')) return matchesLiteralCtrl(e, shortcut)
  if (match(e, shortcut, platform)) return true
  const physical = keyFromCode(e)
  return !!physical && match(physical, shortcut, platform)
}

/** The command a key press triggers, or null. `available` says which ids have a
 *  handler and are enabled right now. */
export function commandForKey(
  e: KeyLike,
  ctx: KeyContext,
  platform: Platform,
  available: (id: CommandId) => boolean,
  match: ShortcutMatcher,
  specs: readonly CommandSpec[] = COMMANDS
): CommandSpec | null {
  for (const spec of specs) {
    if (!spec.shortcuts || !available(spec.id) || !appHandles(spec, ctx)) continue
    const keys =
      ctx.inEditor && spec.editorOwns ? spec.shortcuts.filter((s) => !spec.editorOwns?.includes(s)) : spec.shortcuts
    if (keys.some((s) => matchesKey(e, s, platform, match))) return spec
  }
  return null
}

/** Palette order for an empty query: recently used first (most recent first), then
 *  the rest in registry order. */
export function paletteOrder<T extends { id: CommandId }>(items: readonly T[], recent: readonly CommandId[]): T[] {
  const rank = new Map(recent.map((id, i) => [id, i]))
  const used = items.filter((c) => rank.has(c.id)).sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0))
  return [...used, ...items.filter((c) => !rank.has(c.id))]
}

/** `recent` with `id` moved to the front, capped. */
export function rememberCommand(recent: readonly CommandId[], id: CommandId, max = 8): CommandId[] {
  return [id, ...recent.filter((r) => r !== id)].slice(0, max)
}
