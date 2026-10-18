import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  COMMANDS,
  appHandles,
  commandForKey,
  commandSpec,
  keyFromCode,
  matchesKey,
  paletteOrder,
  rememberCommand,
  type CommandId,
  type ShortcutMatcher
} from '../src/renderer/src/lib/commands.ts'

// A strict stand-in for lib/logic/platform matchesShortcut, so these tests don't
// depend on another lane's in-progress implementation.
const match: ShortcutMatcher = (e, shortcut, platform) => {
  const parts = shortcut.split('+')
  const key = parts[parts.length - 1].toLowerCase()
  const mod = platform === 'darwin' ? e.metaKey : e.ctrlKey
  const other = platform === 'darwin' ? e.ctrlKey : e.metaKey
  return (
    mod === parts.includes('Mod') &&
    !other &&
    e.shiftKey === parts.includes('Shift') &&
    e.altKey === parts.includes('Alt') &&
    e.key.toLowerCase() === key
  )
}

const key = (
  k: string,
  mods: Partial<{ ctrl: boolean; meta: boolean; shift: boolean; alt: boolean; code: string }> = {}
) => ({
  key: k,
  code: mods.code,
  ctrlKey: !!mods.ctrl,
  metaKey: !!mods.meta,
  shiftKey: !!mods.shift,
  altKey: !!mods.alt
})

const all = (): boolean => true
const outside = { inEditor: false, inTextField: false }
const editor = { inEditor: true, inTextField: true }
const field = { inEditor: false, inTextField: true }

describe('command registry', () => {
  it('has unique ids and labels in sentence case', () => {
    const ids = COMMANDS.map((c) => c.id)
    assert.equal(new Set(ids).size, ids.length)
    for (const c of COMMANDS) assert.match(c.label, /^[A-Z][^A-Z]*|^Theme: /, c.label)
  })

  it('never binds the same shortcut to two commands', () => {
    const seen = new Map<string, string>()
    for (const c of COMMANDS) {
      for (const s of c.shortcuts ?? []) {
        assert.ok(!seen.has(s), `${s} used by ${seen.get(s)} and ${c.id}`)
        seen.set(s, c.id)
      }
    }
  })

  it('looks up a spec by id and throws for unknown ids', () => {
    assert.equal(commandSpec('save').label, 'Save')
    assert.throws(() => commandSpec('nope' as CommandId))
  })
})

describe('commandForKey', () => {
  it('maps Ctrl+S to save on Windows and Cmd+S on macOS', () => {
    assert.equal(commandForKey(key('s', { ctrl: true }), outside, 'win32', all, match)?.id, 'save')
    assert.equal(commandForKey(key('s', { meta: true }), outside, 'darwin', all, match)?.id, 'save')
    assert.equal(commandForKey(key('s', { ctrl: true }), outside, 'darwin', all, match), null)
  })

  it('gives Mod+B, Mod+K and Mod+Shift+V to the editor while it has focus', () => {
    assert.equal(commandForKey(key('b', { ctrl: true }), editor, 'win32', all, match), null)
    assert.equal(commandForKey(key('k', { ctrl: true }), editor, 'win32', all, match), null)
    assert.equal(commandForKey(key('V', { ctrl: true, shift: true }), editor, 'win32', all, match), null)
    assert.equal(commandForKey(key('b', { ctrl: true }), outside, 'win32', all, match)?.id, 'toggleSidebar')
    assert.equal(commandForKey(key('k', { ctrl: true }), outside, 'win32', all, match)?.id, 'commandPalette')
  })

  it('still opens the palette with Mod+Shift+P from inside the editor', () => {
    assert.equal(
      commandForKey(key('P', { ctrl: true, shift: true }), editor, 'win32', all, match)?.id,
      'commandPalette'
    )
  })

  it('leaves bare keys and plain-text paste to a focused text field', () => {
    assert.equal(commandForKey(key('F2'), field, 'win32', all, match), null)
    assert.equal(commandForKey(key('F2'), outside, 'win32', all, match)?.id, 'rename')
    assert.equal(commandForKey(key('V', { ctrl: true, shift: true }), field, 'win32', all, match), null)
    assert.equal(commandForKey(key('w', { ctrl: true }), field, 'win32', all, match)?.id, 'closeTab')
  })

  it('skips commands that are not available right now', () => {
    const noSave = (id: CommandId): boolean => id !== 'save'
    assert.equal(commandForKey(key('s', { ctrl: true }), outside, 'win32', noSave, match), null)
  })

  it('treats Ctrl+Tab as the Control key on every platform', () => {
    assert.equal(commandForKey(key('Tab', { ctrl: true }), outside, 'darwin', all, match)?.id, 'nextTab')
    assert.equal(
      commandForKey(key('Tab', { ctrl: true, shift: true }), outside, 'win32', all, match)?.id,
      'previousTab'
    )
    assert.equal(commandForKey(key('Tab'), outside, 'darwin', all, match), null)
    assert.equal(commandForKey(key('Tab', { meta: true }), outside, 'darwin', all, match), null)
  })

  it('matches Option-modified letters by their physical key on macOS', () => {
    const optionS = key('ß', { meta: true, alt: true, code: 'KeyS' })
    assert.equal(commandForKey(optionS, outside, 'darwin', all, match)?.id, 'saveAll')
  })
})

describe('key helpers', () => {
  it('reads the physical letter or digit from the key code', () => {
    assert.equal(keyFromCode(key('*', { code: 'Digit8' }))?.key, '8')
    assert.equal(keyFromCode(key('s', { code: 'KeyS' })), null)
    assert.equal(keyFromCode(key('/', { code: 'Slash' })), null)
  })

  it('matchesKey requires the exact Ctrl modifiers for literal Ctrl shortcuts', () => {
    assert.equal(matchesKey(key('Tab', { ctrl: true, alt: true }), 'Ctrl+Tab', 'win32', match), false)
  })

  it('appHandles defers editor-owned shortcuts only inside the editor', () => {
    const bold = commandSpec('toggleSidebar')
    assert.equal(appHandles(bold, editor), false)
    assert.equal(appHandles(bold, outside), true)
  })
})

describe('palette order', () => {
  const items = (['save', 'saveAs', 'print', 'settings'] as CommandId[]).map((id) => ({ id }))

  it('puts recently used commands first, most recent first', () => {
    assert.deepEqual(
      paletteOrder(items, ['print', 'saveAs']).map((c) => c.id),
      ['print', 'saveAs', 'save', 'settings']
    )
  })

  it('keeps registry order with no history', () => {
    assert.deepEqual(
      paletteOrder(items, []).map((c) => c.id),
      ['save', 'saveAs', 'print', 'settings']
    )
  })

  it('remembers a command at the front without duplicates, capped', () => {
    assert.deepEqual(rememberCommand(['save', 'print'], 'print'), ['print', 'save'])
    const many = Array.from({ length: 10 }, () => 'save' as CommandId)
    assert.equal(rememberCommand(many, 'print', 3).length, 3)
  })
})
