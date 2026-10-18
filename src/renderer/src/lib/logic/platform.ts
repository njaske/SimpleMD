// Platform words and keyboard shortcut handling.
import type { Platform } from '@shared/types'

/** "Reveal in File Explorer" (win32), "Show in Finder" (darwin), "Show in Files" (linux). */
export function revealLabel(platform: Platform): string {
  return platform === 'darwin' ? 'Show in Finder' : platform === 'linux' ? 'Show in Files' : 'Reveal in File Explorer'
}

/** "Recycle Bin" on Windows, "Trash" elsewhere. */
export function trashName(platform: Platform): string {
  return platform === 'win32' ? 'Recycle Bin' : 'Trash'
}

/** "File Explorer" (win32), "Finder" (darwin), "Files" (linux), for sentences like
 *  "Couldn't open File Explorer". */
export function fileManagerName(platform: Platform): string {
  return platform === 'darwin' ? 'Finder' : platform === 'linux' ? 'Files' : 'File Explorer'
}

/** A shortcut written portably, e.g. "Mod+Shift+S", "Alt+ArrowUp", "F2", "Mod+\\", "Mod+/".
 *  "Mod" is Cmd on macOS and Ctrl elsewhere. Keys are separated by "+" ("Mod+=" for plus-ish
 *  keys; the literal plus key is written "Plus"). */
export type Shortcut = string

/** A shortcut broken into the physical modifiers it needs on one platform plus its key.
 *  `key` is canonical: a lower-case letter or symbol ("s", "\\", "="), or a key name as
 *  KeyboardEvent.key spells it ("ArrowUp", "Enter", "F2", " " for Space). */
export interface ParsedShortcut {
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean
  key: string
}

type Modifier = 'mod' | 'ctrl' | 'alt' | 'shift' | 'meta'

// Lookups are Maps so names like "constructor" can't hit Object.prototype.
const MODIFIER_ALIASES = new Map<string, Modifier>(Object.entries({
  mod: 'mod',
  cmdorctrl: 'mod',
  commandorcontrol: 'mod',
  ctrl: 'ctrl',
  control: 'ctrl',
  alt: 'alt',
  option: 'alt',
  opt: 'alt',
  shift: 'shift',
  cmd: 'meta',
  command: 'meta',
  meta: 'meta',
  super: 'meta',
  win: 'meta'
} as const))

/** Key names (lower-cased) → the KeyboardEvent.key value they stand for. */
const NAMED_KEYS = new Map(Object.entries({
  arrowup: 'ArrowUp',
  up: 'ArrowUp',
  arrowdown: 'ArrowDown',
  down: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  left: 'ArrowLeft',
  arrowright: 'ArrowRight',
  right: 'ArrowRight',
  enter: 'Enter',
  return: 'Enter',
  escape: 'Escape',
  esc: 'Escape',
  backspace: 'Backspace',
  delete: 'Delete',
  del: 'Delete',
  tab: 'Tab',
  space: ' ',
  spacebar: ' ',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  insert: 'Insert',
  plus: '+'
}))

/** Parse `shortcut` for `platform`, or null when it isn't a well-formed shortcut. */
export function parseShortcut(shortcut: Shortcut, platform: Platform): ParsedShortcut | null {
  const raw = shortcut.trim()
  if (!raw) return null
  const tokens = splitShortcut(raw)
  const keyToken = tokens[tokens.length - 1]
  if (!keyToken) return null
  const mods = tokens.slice(0, -1).map((t) => MODIFIER_ALIASES.get(t.toLowerCase()))
  if (mods.includes(undefined)) return null
  const has = (m: Modifier): boolean => mods.includes(m)
  const mac = platform === 'darwin'
  return {
    ctrl: has('ctrl') || (!mac && has('mod')),
    alt: has('alt'),
    shift: has('shift'),
    meta: has('meta') || (mac && has('mod')),
    key: canonicalKey(keyToken)
  }
}

/** "+" separates keys; a trailing "++" (or a lone "+") spells the plus key, like "Plus". */
function splitShortcut(raw: string): string[] {
  if (raw === '+') return ['Plus']
  if (raw.endsWith('++')) return [...raw.slice(0, -2).split('+'), 'Plus']
  return raw.split('+')
}

function canonicalKey(token: string): string {
  const named = NAMED_KEYS.get(token.toLowerCase())
  if (named) return named
  if (/^f([1-9]|1\d|2[0-4])$/i.test(token)) return token.toUpperCase()
  return token.length === 1 ? token.toLowerCase() : token
}

const MAC_KEY_LABELS = new Map(Object.entries({
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Enter: '↩',
  Escape: 'Esc',
  Backspace: '⌫',
  Delete: '⌦',
  Tab: '⇥',
  ' ': 'Space',
  Home: '↖',
  End: '↘',
  PageUp: '⇞',
  PageDown: '⇟',
  '+': '+'
}))

const PC_KEY_LABELS = new Map(Object.entries({
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Enter: 'Enter',
  Escape: 'Esc',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Tab: 'Tab',
  ' ': 'Space',
  Home: 'Home',
  End: 'End',
  PageUp: 'Page Up',
  PageDown: 'Page Down',
  Insert: 'Insert',
  '+': 'Plus'
}))

function keyLabel(key: string, platform: Platform): string {
  const labels = platform === 'darwin' ? MAC_KEY_LABELS : PC_KEY_LABELS
  return labels.get(key) ?? (key.length === 1 ? key.toUpperCase() : key)
}

/** The pieces of a shortcut label, one per key, for rendering each in its own chip:
 *  macOS ["⇧", "⌘", "S"], elsewhere ["Ctrl", "Shift", "S"]. Unparseable input comes back
 *  as a single piece. */
export function shortcutParts(shortcut: Shortcut, platform: Platform): string[] {
  const s = parseShortcut(shortcut, platform)
  if (!s) return [shortcut]
  const key = keyLabel(s.key, platform)
  if (platform === 'darwin') {
    // Apple's order: Control, Option, Shift, Command.
    return [s.ctrl && '⌃', s.alt && '⌥', s.shift && '⇧', s.meta && '⌘', key].filter(isText)
  }
  const meta = platform === 'win32' ? 'Win' : 'Super'
  return [s.ctrl && 'Ctrl', s.alt && 'Alt', s.shift && 'Shift', s.meta && meta, key].filter(isText)
}

function isText(part: string | false): part is string {
  return typeof part === 'string'
}

/** Human label: Windows/Linux "Ctrl+Shift+S"; macOS symbols in Apple order "⇧⌘S"
 *  (⌃ Control, ⌥ Option, ⇧ Shift, ⌘ Command), arrows as ↑↓←→, Enter ↩, Escape "Esc",
 *  Backspace ⌫, Tab ⇥, single letters upper-cased. */
export function formatShortcut(shortcut: Shortcut, platform: Platform): string {
  return shortcutParts(shortcut, platform).join(platform === 'darwin' ? '' : '+')
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

/** Symbol keys that can also match by physical key (`KeyboardEvent.code`). Characters in
 *  one group are interchangeable ("Mod+=" also answers to "+"). */
const SYMBOL_GROUPS: ReadonlyArray<{ chars: string[]; codes: string[] }> = [
  { chars: ['=', '+'], codes: ['Equal', 'NumpadAdd'] },
  { chars: ['-'], codes: ['Minus', 'NumpadSubtract'] },
  { chars: ['/'], codes: ['Slash', 'NumpadDivide'] },
  { chars: ['\\'], codes: ['Backslash'] },
  { chars: ['.'], codes: ['Period'] },
  { chars: [','], codes: ['Comma'] },
  { chars: [';'], codes: ['Semicolon'] },
  { chars: ["'"], codes: ['Quote'] },
  { chars: ['['], codes: ['BracketLeft'] },
  { chars: [']'], codes: ['BracketRight'] },
  { chars: ['`'], codes: ['Backquote'] },
  ...'0123456789'.split('').map((d) => ({ chars: [d], codes: [`Digit${d}`] }))
]

const GROUP_OF_CHAR = new Map(SYMBOL_GROUPS.flatMap((g) => g.chars.map((c) => [c, g] as const)))

/** Legacy KeyboardEvent.key spellings (old Edge/IE) → the standard ones. */
const KEY_ALIASES = new Map(Object.entries({
  Esc: 'Escape',
  Up: 'ArrowUp',
  Down: 'ArrowDown',
  Left: 'ArrowLeft',
  Right: 'ArrowRight',
  Spacebar: ' ',
  Del: 'Delete'
}))

/** True when `e` is exactly `shortcut` on `platform`: Mod is metaKey on macOS and ctrlKey
 *  elsewhere, every modifier must match exactly (no extra modifiers), letters compare
 *  case-insensitively, and symbol keys also match by `code` (e.g. "Mod+\\" matches
 *  code "Backslash", "Mod+=" matches "Equal" and the numpad "+", "Mod+-" matches "Minus"
 *  and numpad "-", "Mod+/" matches "Slash") so non-US layouts and Shift variants work.
 *  Letters and digits also match by code (KeyS, Digit1) when the layout types something
 *  else there (Cyrillic, AZERTY, Option on macOS). One allowance: a symbol the layout can
 *  only type with Shift (US "+", German "/") matches its shortcut with Shift held. */
export function matchesShortcut(e: KeyLike, shortcut: Shortcut, platform: Platform): boolean {
  const s = parseShortcut(shortcut, platform)
  if (!s) return false
  if (e.ctrlKey !== s.ctrl || e.metaKey !== s.meta || e.altKey !== s.alt) return false
  const key = KEY_ALIASES.get(e.key) ?? e.key
  if (/^[a-z]$/.test(s.key)) return e.shiftKey === s.shift && matchesLetter(e, key, s.key, platform)
  const group = GROUP_OF_CHAR.get(s.key)
  if (group) return matchesSymbol(e, key, s, group, platform)
  return e.shiftKey === s.shift && key.toLowerCase() === s.key.toLowerCase()
}

/** AltGr (reported as Ctrl+Alt on Windows and Linux) types characters like "ś" or "²";
 *  that's text, so it must not fall back to a physical-key shortcut match. */
function isAltGrText(e: KeyLike, key: string, platform: Platform): boolean {
  return platform !== 'darwin' && e.ctrlKey && e.altKey && [...key].length === 1
}

function matchesLetter(e: KeyLike, key: string, letter: string, platform: Platform): boolean {
  if (/^[a-z]$/i.test(key)) return key.toLowerCase() === letter
  if (isAltGrText(e, key, platform)) return false
  return e.code === `Key${letter.toUpperCase()}`
}

function matchesSymbol(
  e: KeyLike,
  key: string,
  s: ParsedShortcut,
  group: { chars: string[]; codes: string[] },
  platform: Platform
): boolean {
  // The layout produced the very character: Shift must match, unless the layout needed
  // Shift to type it and the shortcut didn't ask for Shift.
  if (group.chars.includes(key)) return e.shiftKey || !s.shift
  if (e.shiftKey !== s.shift || !e.code || !group.codes.includes(e.code)) return false
  if (isAltGrText(e, key, platform)) return false
  // Physical-key match, unless an unshifted key typed a different bindable symbol on this
  // layout (German Ctrl+"-" sits on the US "/" key and must stay "Mod+-"). With Shift the
  // key names the shortcut ("Mod+Shift+7" where Shift+7 types "/"); if that overlaps
  // another shortcut, the caller's priority (editor first) settles it.
  return s.shift || !GROUP_OF_CHAR.has(key)
}
