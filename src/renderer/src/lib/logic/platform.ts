// CONTRACT STUB (lane L implements). Platform words and keyboard shortcut handling.
import type { Platform } from '@shared/types'

/** "Reveal in File Explorer" (win32), "Show in Finder" (darwin), "Show in Files" (linux). */
export function revealLabel(platform: Platform): string {
  return platform === 'darwin' ? 'Show in Finder' : platform === 'linux' ? 'Show in Files' : 'Reveal in File Explorer'
}

/** "Recycle Bin" on Windows, "Trash" elsewhere. */
export function trashName(platform: Platform): string {
  return platform === 'win32' ? 'Recycle Bin' : 'Trash'
}

/** A shortcut written portably, e.g. "Mod+Shift+S", "Alt+ArrowUp", "F2", "Mod+\\", "Mod+/".
 *  "Mod" is Cmd on macOS and Ctrl elsewhere. Keys are separated by "+" ("Mod+=" for plus-ish
 *  keys; the literal plus key is written "Plus"). */
export type Shortcut = string

/** Human label: Windows/Linux "Ctrl+Shift+S"; macOS symbols in Apple order "⇧⌘S"
 *  (⌃ Control, ⌥ Option, ⇧ Shift, ⌘ Command), arrows as ↑↓←→, Enter ↩, Escape "Esc",
 *  Backspace ⌫, Tab ⇥, single letters upper-cased. */
export function formatShortcut(shortcut: Shortcut, platform: Platform): string {
  const mod = platform === 'darwin' ? 'Cmd' : 'Ctrl'
  return shortcut.replace(/Mod/g, mod)
}

/** The parts of a keyboard event the matcher needs (so tests can pass plain objects). */
export interface KeyLike {
  key: string
  code?: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
}

/** True when `e` is exactly `shortcut` on `platform`: Mod is metaKey on macOS and ctrlKey
 *  elsewhere, every modifier must match exactly (no extra modifiers), letters compare
 *  case-insensitively, and symbol keys also match by `code` (e.g. "Mod+\\" matches
 *  code "Backslash", "Mod+=" matches "Equal" and the numpad "+", "Mod+-" matches "Minus"
 *  and numpad "-", "Mod+/" matches "Slash") so non-US layouts and Shift variants work. */
export function matchesShortcut(e: KeyLike, shortcut: Shortcut, platform: Platform): boolean {
  const parts = shortcut.split('+')
  const key = parts[parts.length - 1].toLowerCase()
  const wantMod = parts.includes('Mod')
  const mod = platform === 'darwin' ? e.metaKey : e.ctrlKey
  return (
    mod === wantMod &&
    e.shiftKey === parts.includes('Shift') &&
    e.altKey === parts.includes('Alt') &&
    e.key.toLowerCase() === key
  )
}
