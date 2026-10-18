import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  fileManagerName,
  formatShortcut,
  matchesShortcut,
  parseShortcut,
  revealLabel,
  shortcutParts,
  trashName,
  type KeyLike
} from '../src/renderer/src/lib/logic/platform.ts'

/** A keyboard event with no modifiers unless given. */
function key(k: string, code?: string, mods: Partial<KeyLike> = {}): KeyLike {
  return { key: k, code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods }
}
const ctrl = { ctrlKey: true }
const meta = { metaKey: true }

describe('platform words', () => {
  it('names the file manager reveal action per platform', () => {
    assert.equal(revealLabel('win32'), 'Reveal in File Explorer')
    assert.equal(revealLabel('darwin'), 'Show in Finder')
    assert.equal(revealLabel('linux'), 'Show in Files')
  })

  it('names the trash per platform', () => {
    assert.equal(trashName('win32'), 'Recycle Bin')
    assert.equal(trashName('darwin'), 'Trash')
    assert.equal(trashName('linux'), 'Trash')
  })

  it('names the file manager per platform', () => {
    assert.equal(fileManagerName('win32'), 'File Explorer')
    assert.equal(fileManagerName('darwin'), 'Finder')
    assert.equal(fileManagerName('linux'), 'Files')
  })
})

describe('parseShortcut', () => {
  it('maps Mod to Ctrl on Windows/Linux and to Cmd on macOS', () => {
    assert.deepEqual(parseShortcut('Mod+S', 'win32'), { ctrl: true, alt: false, shift: false, meta: false, key: 's' })
    assert.deepEqual(parseShortcut('Mod+S', 'darwin'), { ctrl: false, alt: false, shift: false, meta: true, key: 's' })
  })

  it('accepts modifier aliases in any case', () => {
    // Act
    const s = parseShortcut('control+OPTION+shift+cmd+K', 'darwin')

    // Assert
    assert.deepEqual(s, { ctrl: true, alt: true, shift: true, meta: true, key: 'k' })
  })

  it('normalizes key names', () => {
    assert.equal(parseShortcut('Alt+Up', 'win32')?.key, 'ArrowUp')
    assert.equal(parseShortcut('Esc', 'win32')?.key, 'Escape')
    assert.equal(parseShortcut('Return', 'win32')?.key, 'Enter')
    assert.equal(parseShortcut('Mod+Space', 'win32')?.key, ' ')
    assert.equal(parseShortcut('f12', 'win32')?.key, 'F12')
  })

  it('reads the plus key written as Plus, "++" or a lone "+"', () => {
    assert.equal(parseShortcut('Mod+Plus', 'win32')?.key, '+')
    assert.equal(parseShortcut('Mod++', 'win32')?.key, '+')
    assert.equal(parseShortcut('+', 'win32')?.key, '+')
  })

  it('rejects empty and malformed shortcuts', () => {
    assert.equal(parseShortcut('', 'win32'), null)
    assert.equal(parseShortcut('Mod+', 'win32'), null)
    assert.equal(parseShortcut('Hyper+K', 'win32'), null)
    assert.equal(parseShortcut('constructor+K', 'win32'), null)
  })
})

describe('formatShortcut on Windows and Linux', () => {
  it('spells modifiers out, joined with +', () => {
    assert.equal(formatShortcut('Mod+Shift+S', 'win32'), 'Ctrl+Shift+S')
    assert.equal(formatShortcut('Mod+Alt+S', 'linux'), 'Ctrl+Alt+S')
  })

  it('orders modifiers Ctrl, Alt, Shift, Win', () => {
    assert.equal(formatShortcut('Shift+Alt+Mod+Meta+X', 'win32'), 'Ctrl+Alt+Shift+Win+X')
    assert.equal(formatShortcut('Meta+X', 'linux'), 'Super+X')
  })

  it('upper-cases letters and keeps symbols', () => {
    assert.equal(formatShortcut('Mod+k', 'win32'), 'Ctrl+K')
    assert.equal(formatShortcut('Mod+\\', 'win32'), 'Ctrl+\\')
    assert.equal(formatShortcut('Mod+/', 'win32'), 'Ctrl+/')
    assert.equal(formatShortcut('Mod+=', 'win32'), 'Ctrl+=')
    assert.equal(formatShortcut('Mod+-', 'win32'), 'Ctrl+-')
    assert.equal(formatShortcut('Mod+,', 'win32'), 'Ctrl+,')
  })

  it('names special keys', () => {
    assert.equal(formatShortcut('Alt+ArrowUp', 'win32'), 'Alt+↑')
    assert.equal(formatShortcut('Mod+Alt+ArrowRight', 'win32'), 'Ctrl+Alt+→')
    assert.equal(formatShortcut('Enter', 'win32'), 'Enter')
    assert.equal(formatShortcut('Escape', 'win32'), 'Esc')
    assert.equal(formatShortcut('Backspace', 'linux'), 'Backspace')
    assert.equal(formatShortcut('Ctrl+Shift+Tab', 'win32'), 'Ctrl+Shift+Tab')
    assert.equal(formatShortcut('Mod+Plus', 'win32'), 'Ctrl+Plus')
    assert.equal(formatShortcut('F2', 'win32'), 'F2')
    assert.equal(formatShortcut('PageDown', 'win32'), 'Page Down')
  })
})

describe('formatShortcut on macOS', () => {
  it('uses symbols in Apple order with no separators', () => {
    assert.equal(formatShortcut('Mod+Shift+S', 'darwin'), '⇧⌘S')
    assert.equal(formatShortcut('Mod+Alt+S', 'darwin'), '⌥⌘S')
    assert.equal(formatShortcut('Shift+Mod+Alt+Ctrl+Z', 'darwin'), '⌃⌥⇧⌘Z')
  })

  it('keeps Ctrl as Control (⌃), distinct from Mod', () => {
    assert.equal(formatShortcut('Ctrl+Tab', 'darwin'), '⌃⇥')
    assert.equal(formatShortcut('Ctrl+Shift+Tab', 'darwin'), '⌃⇧⇥')
  })

  it('draws special keys as symbols', () => {
    assert.equal(formatShortcut('Alt+ArrowUp', 'darwin'), '⌥↑')
    assert.equal(formatShortcut('ArrowDown', 'darwin'), '↓')
    assert.equal(formatShortcut('Mod+Enter', 'darwin'), '⌘↩')
    assert.equal(formatShortcut('Escape', 'darwin'), 'Esc')
    assert.equal(formatShortcut('Mod+Backspace', 'darwin'), '⌘⌫')
    assert.equal(formatShortcut('Tab', 'darwin'), '⇥')
    assert.equal(formatShortcut('Mod+Plus', 'darwin'), '⌘+')
    assert.equal(formatShortcut('Mod+\\', 'darwin'), '⌘\\')
    assert.equal(formatShortcut('F2', 'darwin'), 'F2')
  })
})

describe('shortcutParts', () => {
  it('splits a shortcut into one label per key', () => {
    assert.deepEqual(shortcutParts('Mod+Shift+P', 'darwin'), ['⇧', '⌘', 'P'])
    assert.deepEqual(shortcutParts('Mod+Shift+P', 'win32'), ['Ctrl', 'Shift', 'P'])
  })

  it('returns unparseable input as a single part', () => {
    assert.deepEqual(shortcutParts('Hyper+K', 'win32'), ['Hyper+K'])
    assert.equal(formatShortcut('Hyper+K', 'darwin'), 'Hyper+K')
  })
})

describe('matchesShortcut: modifiers', () => {
  it('uses Ctrl for Mod on Windows/Linux and Cmd on macOS', () => {
    assert.ok(matchesShortcut(key('s', 'KeyS', ctrl), 'Mod+S', 'win32'))
    assert.ok(matchesShortcut(key('s', 'KeyS', ctrl), 'Mod+S', 'linux'))
    assert.ok(matchesShortcut(key('s', 'KeyS', meta), 'Mod+S', 'darwin'))
    assert.ok(!matchesShortcut(key('s', 'KeyS', ctrl), 'Mod+S', 'darwin'))
    assert.ok(!matchesShortcut(key('s', 'KeyS', meta), 'Mod+S', 'win32'))
  })

  it('requires every modifier to match exactly', () => {
    assert.ok(!matchesShortcut(key('S', 'KeyS', { ctrlKey: true, shiftKey: true }), 'Mod+S', 'win32'))
    assert.ok(!matchesShortcut(key('s', 'KeyS', { ctrlKey: true, altKey: true }), 'Mod+S', 'win32'))
    assert.ok(!matchesShortcut(key('s', 'KeyS'), 'Mod+S', 'win32'))
    assert.ok(matchesShortcut(key('S', 'KeyS', { ctrlKey: true, shiftKey: true }), 'Mod+Shift+S', 'win32'))
    assert.ok(matchesShortcut(key('s', 'KeyS', { ctrlKey: true, altKey: true }), 'Mod+Alt+S', 'win32'))
  })

  it('matches Ctrl shortcuts on macOS with the Control key', () => {
    assert.ok(matchesShortcut(key('Tab', 'Tab', { ctrlKey: true }), 'Ctrl+Tab', 'darwin'))
    assert.ok(matchesShortcut(key('Tab', 'Tab', { ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+Tab', 'darwin'))
    assert.ok(!matchesShortcut(key('Tab', 'Tab', { metaKey: true }), 'Ctrl+Tab', 'darwin'))
  })

  it('never matches a malformed shortcut', () => {
    assert.ok(!matchesShortcut(key('k', 'KeyK', ctrl), 'Hyper+K', 'win32'))
  })
})

describe('matchesShortcut: letters', () => {
  it('compares letters case-insensitively', () => {
    assert.ok(matchesShortcut(key('K', 'KeyK', ctrl), 'Mod+k', 'win32'))
    assert.ok(matchesShortcut(key('k', 'KeyK', ctrl), 'Mod+K', 'win32'))
  })

  it('follows the typed Latin letter on remapped layouts (Dvorak, AZERTY)', () => {
    // Dvorak: the key labelled "b" sits where QWERTY has "n".
    assert.ok(matchesShortcut(key('b', 'KeyN', ctrl), 'Mod+B', 'win32'))
    assert.ok(!matchesShortcut(key('x', 'KeyB', ctrl), 'Mod+B', 'win32'))
  })

  it('falls back to the physical key when the layout types non-Latin letters', () => {
    assert.ok(matchesShortcut(key('ы', 'KeyS', ctrl), 'Mod+S', 'win32'))
    assert.ok(matchesShortcut(key('ש', 'KeyA', meta), 'Mod+A', 'darwin'))
  })

  it('matches Option+letter on macOS, which types a different character', () => {
    assert.ok(matchesShortcut(key('˜', 'KeyN', { altKey: true }), 'Alt+N', 'darwin'))
    assert.ok(matchesShortcut(key('Dead', 'KeyN', { altKey: true }), 'Alt+N', 'darwin'))
  })

  it('does not treat AltGr text as a shortcut on Windows', () => {
    // Polish AltGr+S types "ś" and reports Ctrl+Alt.
    assert.ok(!matchesShortcut(key('ś', 'KeyS', { ctrlKey: true, altKey: true }), 'Mod+Alt+S', 'win32'))
  })
})

describe('matchesShortcut: named keys', () => {
  it('matches arrows, Enter, Escape, Tab, Backspace and F-keys', () => {
    assert.ok(matchesShortcut(key('ArrowUp', 'ArrowUp', { altKey: true }), 'Alt+ArrowUp', 'win32'))
    assert.ok(matchesShortcut(key('ArrowRight', 'ArrowRight', { ctrlKey: true, altKey: true }), 'Mod+Alt+ArrowRight', 'win32'))
    assert.ok(matchesShortcut(key('Enter', 'Enter'), 'Enter', 'win32'))
    assert.ok(matchesShortcut(key('Escape', 'Escape'), 'Escape', 'darwin'))
    assert.ok(matchesShortcut(key('Tab', 'Tab', ctrl), 'Ctrl+Tab', 'win32'))
    assert.ok(matchesShortcut(key('Backspace', 'Backspace', meta), 'Mod+Backspace', 'darwin'))
    assert.ok(matchesShortcut(key('F2', 'F2'), 'F2', 'linux'))
    assert.ok(!matchesShortcut(key('F3', 'F3'), 'F2', 'linux'))
  })

  it('accepts legacy key spellings', () => {
    assert.ok(matchesShortcut(key('Esc'), 'Escape', 'win32'))
    assert.ok(matchesShortcut(key('Up', undefined, { altKey: true }), 'Alt+ArrowUp', 'win32'))
    assert.ok(matchesShortcut(key('Spacebar', undefined, ctrl), 'Mod+Space', 'win32'))
  })

  it('requires Shift to match for named keys', () => {
    assert.ok(!matchesShortcut(key('Tab', 'Tab', { ctrlKey: true, shiftKey: true }), 'Ctrl+Tab', 'win32'))
  })
})

describe('matchesShortcut: symbol keys', () => {
  it('matches Mod+\\ by key and by code', () => {
    assert.ok(matchesShortcut(key('\\', 'Backslash', ctrl), 'Mod+\\', 'win32'))
    // UK and German layouts type other characters on that physical key.
    assert.ok(matchesShortcut(key('#', 'Backslash', ctrl), 'Mod+\\', 'win32'))
  })

  it('matches Mod+= from Equal, numpad plus, and Ctrl+Shift+= ("Ctrl++")', () => {
    assert.ok(matchesShortcut(key('=', 'Equal', ctrl), 'Mod+=', 'win32'))
    assert.ok(matchesShortcut(key('+', 'NumpadAdd', ctrl), 'Mod+=', 'win32'))
    assert.ok(matchesShortcut(key('+', 'Equal', { ctrlKey: true, shiftKey: true }), 'Mod+=', 'win32'))
    assert.ok(matchesShortcut(key('+', 'BracketRight', ctrl), 'Mod+=', 'win32')) // German "+" key
    assert.ok(matchesShortcut(key('=', 'Equal', meta), 'Mod+Plus', 'darwin'))
  })

  it('matches Mod+- from Minus and numpad minus', () => {
    assert.ok(matchesShortcut(key('-', 'Minus', ctrl), 'Mod+-', 'win32'))
    assert.ok(matchesShortcut(key('-', 'NumpadSubtract', ctrl), 'Mod+-', 'win32'))
    assert.ok(!matchesShortcut(key('_', 'Minus', { ctrlKey: true, shiftKey: true }), 'Mod+-', 'win32'))
  })

  it('matches Mod+/ by code and when the layout needs Shift for "/"', () => {
    assert.ok(matchesShortcut(key('/', 'Slash', ctrl), 'Mod+/', 'win32'))
    assert.ok(matchesShortcut(key('/', 'NumpadDivide', ctrl), 'Mod+/', 'win32'))
    // German: "/" is Shift+7.
    assert.ok(matchesShortcut(key('/', 'Digit7', { ctrlKey: true, shiftKey: true }), 'Mod+/', 'win32'))
    // US: Shift+/ types "?", which is not Mod+/.
    assert.ok(!matchesShortcut(key('?', 'Slash', { ctrlKey: true, shiftKey: true }), 'Mod+/', 'win32'))
  })

  it('keeps a key that typed another bound symbol from matching by position', () => {
    // German: the US "/" position types "-", so it means Mod+-, not Mod+/.
    assert.ok(!matchesShortcut(key('-', 'Slash', ctrl), 'Mod+/', 'win32'))
    assert.ok(matchesShortcut(key('-', 'Slash', ctrl), 'Mod+-', 'win32'))
  })

  it('matches Mod+Shift+<digit> by code even when Shift+digit types a bound symbol', () => {
    // Arrange: German, Swiss and Nordic layouts type "/" with Shift+7 and "=" with Shift+0
    const shift7 = key('/', 'Digit7', { ctrlKey: true, shiftKey: true })
    const shift0 = key('=', 'Digit0', { metaKey: true, shiftKey: true })

    // Act / Assert: the numbered-list shortcut works; Mod+/ also answers, and the
    // caller's priority (editor shortcuts first) settles the overlap
    assert.ok(matchesShortcut(shift7, 'Mod+Shift+7', 'win32'))
    assert.ok(matchesShortcut(shift7, 'Mod+/', 'win32'))
    assert.ok(matchesShortcut(shift0, 'Mod+Shift+0', 'darwin'))
    assert.ok(!matchesShortcut(shift7, 'Mod+Shift+8', 'win32'))
    assert.ok(!matchesShortcut(key('/', 'Digit7', ctrl), 'Mod+Shift+7', 'win32'))
  })

  it('matches Shift variants of symbol and digit shortcuts by code', () => {
    // US: Shift+. types ">", Shift+8 "*", Shift+7 "&", Shift+9 "(".
    assert.ok(matchesShortcut(key('>', 'Period', { ctrlKey: true, shiftKey: true }), 'Mod+Shift+.', 'win32'))
    assert.ok(matchesShortcut(key('*', 'Digit8', { ctrlKey: true, shiftKey: true }), 'Mod+Shift+8', 'win32'))
    assert.ok(matchesShortcut(key('&', 'Digit7', { metaKey: true, shiftKey: true }), 'Mod+Shift+7', 'darwin'))
    assert.ok(matchesShortcut(key('(', 'Digit9', { ctrlKey: true, shiftKey: true }), 'Mod+Shift+9', 'linux'))
  })

  it('keeps Mod+. and Mod+Shift+. apart', () => {
    assert.ok(matchesShortcut(key('.', 'Period', ctrl), 'Mod+.', 'win32'))
    assert.ok(!matchesShortcut(key('>', 'Period', { ctrlKey: true, shiftKey: true }), 'Mod+.', 'win32'))
    assert.ok(!matchesShortcut(key('.', 'Period', ctrl), 'Mod+Shift+.', 'win32'))
  })

  it('matches digits by key and, on AZERTY, by code', () => {
    assert.ok(matchesShortcut(key('1', 'Digit1', ctrl), 'Mod+1', 'win32'))
    assert.ok(matchesShortcut(key('&', 'Digit1', ctrl), 'Mod+1', 'win32'))
    assert.ok(matchesShortcut(key('0', 'Digit0', meta), 'Mod+0', 'darwin'))
    assert.ok(!matchesShortcut(key('2', 'Digit2', ctrl), 'Mod+1', 'win32'))
  })

  it('matches Mod+Alt+digit on macOS, where Option changes the character', () => {
    assert.ok(matchesShortcut(key('¡', 'Digit1', { metaKey: true, altKey: true }), 'Mod+Alt+1', 'darwin'))
  })

  it('does not treat AltGr symbols as Ctrl+Alt+digit shortcuts', () => {
    // German AltGr+2 types "²".
    assert.ok(!matchesShortcut(key('²', 'Digit2', { ctrlKey: true, altKey: true }), 'Mod+Alt+2', 'win32'))
    assert.ok(matchesShortcut(key('2', 'Digit2', { ctrlKey: true, altKey: true }), 'Mod+Alt+2', 'win32'))
  })

  it('matches Mod+, for settings', () => {
    assert.ok(matchesShortcut(key(',', 'Comma', meta), 'Mod+,', 'darwin'))
    assert.ok(matchesShortcut(key(';', 'Comma', meta), 'Mod+,', 'darwin') === false)
  })

  it('does not require a code to be present', () => {
    assert.ok(matchesShortcut(key('\\', undefined, ctrl), 'Mod+\\', 'win32'))
    assert.ok(!matchesShortcut(key('|', undefined, ctrl), 'Mod+\\', 'win32'))
  })
})
