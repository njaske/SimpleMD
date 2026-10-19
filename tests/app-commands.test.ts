import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { Window } from 'happy-dom'
import './support/aliases.ts'
import { fakeHost, type FakeHost } from './support/fakeHost.ts'
import type * as TableModule from '../src/renderer/src/app/commandTable.ts'
import type * as CommandsModule from '../src/renderer/src/lib/commands.ts'
import type * as HostModule from '../src/renderer/src/app/host.ts'
import type * as AppearanceModule from '../src/renderer/src/app/appearance.ts'
import type * as ReadingModule from '../src/renderer/src/app/reading.ts'

// The command table behind the palette and shortcuts, plus the small helpers the
// shell's toasts and reader features lean on.
const win = new Window()
Object.assign(globalThis, { document: win.document, Element: win.Element, Node: win.Node })

let table: typeof TableModule
let commands: typeof CommandsModule
let host: typeof HostModule
let appearance: typeof AppearanceModule
let reading: typeof ReadingModule
before(async () => {
  table = await import('../src/renderer/src/app/commandTable.ts')
  commands = await import('../src/renderer/src/lib/commands.ts')
  host = await import('../src/renderer/src/app/host.ts')
  appearance = await import('../src/renderer/src/app/appearance.ts')
  reading = await import('../src/renderer/src/app/reading.ts')
})

/** Every dependency records the name of what it was asked to do. */
function recorder(calls: string[]): Record<string, unknown> {
  return new Proxy({}, { get: (_t, key) => (...args: unknown[]) => void calls.push([String(key), ...args].join(':')) })
}

function build(fake: FakeHost, calls: string[], hasChanges = false): TableModule.CommandTable {
  return table.buildCommandTable({
    host: fake.host,
    docs: recorder(calls) as never,
    files: recorder(calls) as never,
    view: recorder(calls) as never,
    exports: recorder(calls) as never,
    renameTarget: () => null,
    reading: {
      find: () => void calls.push('find'),
      nextChange: () => void calls.push('nextChange'),
      dismissChanges: () => void calls.push('dismissChanges'),
      followEnd: () => void calls.push('followEnd'),
      hasChanges: () => hasChanges
    }
  })
}

describe('command table', () => {
  it('binds every command in the registry (no dead palette entries)', async () => {
    const fake = await fakeHost()

    const bound = build(fake, [])

    const missing = commands.COMMANDS.map((c) => c.id).filter((id) => !bound[id])
    assert.deepEqual(missing, [])
  })

  it('offers find, follow and change commands only when they can act', async () => {
    const calls: string[] = []
    const empty = build(await fakeHost(), calls)
    const doc = await fakeHost({ activeId: '/a.md', openTabs: ['/a.md'], viewMode: 'read' })
    const withChanges = build(doc, calls, true)
    const editing = build(await fakeHost({ activeId: '/a.md', openTabs: ['/a.md'], viewMode: 'edit' }), calls, true)

    assert.equal(empty.findInDocument?.enabled?.(), false)
    assert.equal(withChanges.findInDocument?.enabled?.(), true)
    assert.equal(withChanges.nextChange?.enabled?.(), true)
    assert.equal(editing.nextChange?.enabled?.(), false)
    assert.equal(build(await fakeHost({ activeId: 'untitled:1' }), calls).followEnd?.enabled?.(), false)
    assert.equal(withChanges.followEnd?.enabled?.(), true)
    withChanges.findInDocument?.run()
    withChanges.nextChange?.run()
    assert.deepEqual(calls, ['find', 'nextChange'])
  })

  it('labels toggles by what they will do', async () => {
    const on = build(await fakeHost({ blockRemoteImages: true, showStatusBar: true, syncScroll: false }), [])

    assert.equal(on.toggleRemoteImages?.label?.(), 'Allow remote images')
    assert.equal(on.toggleStatusBar?.label?.(), 'Hide status bar')
    assert.equal(on.toggleSyncScroll?.label?.(), 'Turn on synced scrolling')
  })

  it('says so when Save all has nothing to save', async () => {
    const calls: string[] = []
    const fake = await fakeHost({ contents: { '/a.md': 'A' }, saved: { '/a.md': 'A' } })

    build(fake, calls).saveAll?.run()

    assert.deepEqual(calls, [])
    assert.equal(fake.toasts[0], 'Everything is already saved')
  })

  it('explains why the outline cannot show in a narrow window', async () => {
    const calls: string[] = []
    const fake = await fakeHost({ activeId: '/a.md', narrow: true })

    build(fake, calls).toggleOutline?.run()

    assert.deepEqual(calls, [])
    assert.match(fake.toasts[0], /wider/)
  })
})

describe('toast wording', () => {
  it('drops trailing punctuation from error reasons so toasts never read ".)."', () => {
    assert.equal(host.reason(new Error('prompt() is not supported.')), 'prompt() is not supported')
    assert.equal(host.reason(new Error("Error invoking remote method 'fs:save': Error: Disk full!")), 'Disk full')
    assert.equal(host.reason('x'.repeat(200)), '')
    assert.equal(host.reason(42), '')
  })
})

describe('editor text size', () => {
  it('follows the reader size and stays within 12 to 20 px', () => {
    assert.equal(appearance.editorFontSize(17), 14)
    assert.equal(appearance.editorFontSize(13), 12)
    assert.equal(appearance.editorFontSize(26), 20)
  })
})

describe('find seed', () => {
  function selectionOf(node: unknown, text: string): Selection {
    return { anchorNode: node, toString: () => text } as unknown as Selection
  }

  it('uses a short one-line selection inside the reader', () => {
    const reader = win.document.createElement('div')
    reader.className = 'smd-reader'
    const p = win.document.createElement('p')
    p.textContent = 'cache hit'
    reader.appendChild(p)

    assert.equal(reading.readerSelection(selectionOf(p.firstChild, '  cache hit ')), 'cache hit')
    assert.equal(reading.readerSelection(selectionOf(p.firstChild, 'two\nlines')), '')
    assert.equal(reading.readerSelection(selectionOf(p.firstChild, 'x'.repeat(200))), '')
  })

  it('ignores selections outside the reader', () => {
    const elsewhere = win.document.createElement('div')

    assert.equal(reading.readerSelection(selectionOf(elsewhere, 'tree row')), '')
    assert.equal(reading.readerSelection(null), '')
  })
})
