// Editor shortcuts, written portably ("Mod" = Cmd on macOS, Ctrl elsewhere) so the keymap
// and the format bar's tooltips share one source of truth.
import type { FormatCommand } from './types'

export const FORMAT_SHORTCUTS: ReadonlyArray<readonly [FormatCommand, string]> = [
  ['bold', 'Mod+B'],
  ['italic', 'Mod+I'],
  ['link', 'Mod+K'],
  ['code', 'Mod+Shift+C'],
  ['strikethrough', 'Mod+Shift+X'],
  ['heading1', 'Mod+Alt+1'],
  ['heading2', 'Mod+Alt+2'],
  ['heading3', 'Mod+Alt+3'],
  ['paragraph', 'Mod+Alt+0'],
  ['quote', 'Mod+Shift+.'],
  ['bulletList', 'Mod+Shift+8'],
  ['numberedList', 'Mod+Shift+7'],
  ['taskList', 'Mod+Shift+9']
]

/** Mod+Shift+V inside the editor pastes the clipboard as plain text. */
export const PASTE_PLAIN_SHORTCUT = 'Mod+Shift+V'

export function shortcutFor(cmd: FormatCommand): string | null {
  return FORMAT_SHORTCUTS.find(([c]) => c === cmd)?.[1] ?? null
}

/** The aria-keyshortcuts form: "Mod+Shift+C" -> "Control+Shift+C" ("Meta+..." on macOS). */
export function ariaShortcut(shortcut: string, platform: string): string {
  return shortcut.replace(/\bMod\b/g, platform === 'darwin' ? 'Meta' : 'Control')
}

/** "Mod+Shift+C" -> "Mod-Shift-c" (CodeMirror key names; letters lower-cased). */
export function toCodeMirrorKey(shortcut: string): string {
  return shortcut
    .split('+')
    .map((part, i, all) => (i === all.length - 1 && /^[A-Z]$/.test(part) ? part.toLowerCase() : part))
    .join('-')
}
