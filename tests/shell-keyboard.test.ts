import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { Window } from 'happy-dom'
import './support/aliases.ts'
import { keyFromCode, type CommandId } from '../src/renderer/src/lib/commands.ts'
import type { KeyboardDeps } from '../src/renderer/src/app/keyboard.ts'

// The global key handler driven by real KeyboardEvent objects (happy-dom), whose
// modifier flags live on the prototype, not on the event itself.
const win = new Window()
Object.assign(globalThis, {
  document: win.document,
  HTMLElement: win.HTMLElement,
  HTMLInputElement: win.HTMLInputElement,
  HTMLTextAreaElement: win.HTMLTextAreaElement
})

let createKeyHandler: (deps: KeyboardDeps) => (e: KeyboardEvent) => void
before(async () => {
  ;({ createKeyHandler } = await import('../src/renderer/src/app/keyboard.ts'))
})

function press(platform: KeyboardDeps['platform'], init: KeyboardEventInit): { ran: CommandId[]; prevented: boolean } {
  const ran: CommandId[] = []
  const handler = createKeyHandler({ platform, modal: () => null, available: () => true, run: (id) => ran.push(id) })
  const event = new win.KeyboardEvent('keydown', { ...init, cancelable: true }) as unknown as KeyboardEvent
  handler(event)
  return { ran, prevented: event.defaultPrevented }
}

/** Like Chromium's KeyboardEvent: the fields are prototype getters, so `{ ...e }`
 *  copies none of them (happy-dom uses own properties and would hide that bug). */
class ChromiumLikeEvent {
  readonly #init: Required<Pick<KeyboardEventInit, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>>
  constructor(init: KeyboardEventInit) {
    this.#init = { key: '', code: '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...init }
  }
  get key(): string {
    return this.#init.key
  }
  get code(): string {
    return this.#init.code
  }
  get ctrlKey(): boolean {
    return this.#init.ctrlKey
  }
  get metaKey(): boolean {
    return this.#init.metaKey
  }
  get altKey(): boolean {
    return this.#init.altKey
  }
  get shiftKey(): boolean {
    return this.#init.shiftKey
  }
}

describe('physical-key fallback', () => {
  it('keeps the modifiers of events whose fields are prototype getters', () => {
    // Arrange
    const e = new ChromiumLikeEvent({ key: 'з', code: 'KeyP', ctrlKey: true, shiftKey: true })

    // Act
    const physical = keyFromCode(e, 'win32')

    // Assert
    assert.deepEqual(physical, { key: 'p', code: 'KeyP', ctrlKey: true, metaKey: false, altKey: false, shiftKey: true })
  })
})

describe('keyboard handler with real key events', () => {
  it('opens Quick Open for Ctrl+P on a Russian layout (key "з", code KeyP)', () => {
    const { ran, prevented } = press('win32', { key: 'з', code: 'KeyP', ctrlKey: true })
    assert.deepEqual(ran, ['quickOpen'])
    assert.equal(prevented, true)
  })

  it('runs Save all for Cmd+Option+S on macOS (key "ß")', () => {
    assert.deepEqual(press('darwin', { key: 'ß', code: 'KeyS', metaKey: true, altKey: true }).ran, ['saveAll'])
  })

  it('does not close the tab for AZERTY Ctrl+Z (key "z", code KeyW)', () => {
    const { ran, prevented } = press('win32', { key: 'z', code: 'KeyW', ctrlKey: true })
    assert.deepEqual(ran, [])
    assert.equal(prevented, false)
  })

  it('lets AltGr+S type "ś" on a Polish layout', () => {
    assert.deepEqual(press('win32', { key: 'ś', code: 'KeyS', ctrlKey: true, altKey: true }).ran, [])
  })

  it('still matches plain Latin shortcuts directly', () => {
    assert.deepEqual(press('win32', { key: 'w', code: 'KeyW', ctrlKey: true }).ran, ['closeTab'])
  })

  it('ignores every shortcut while a dialog is open', () => {
    const ran: CommandId[] = []
    const handler = createKeyHandler({
      platform: 'win32',
      modal: () => 'dialog',
      available: () => true,
      run: (id) => ran.push(id)
    })
    handler(new win.KeyboardEvent('keydown', { key: 's', ctrlKey: true }) as unknown as KeyboardEvent)
    assert.deepEqual(ran, [])
  })
})
