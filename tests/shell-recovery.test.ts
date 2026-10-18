import assert from 'node:assert/strict'
import { afterEach, before, beforeEach, describe, it, mock } from 'node:test'
import './support/aliases.ts'
import { fakeHost, stubApi, type FakeHost } from './support/fakeHost.ts'
import type { RecoveryEntry } from '../src/shared/types.ts'
import type * as RecoveryModule from '../src/renderer/src/app/recovery.ts'
import type * as BootstrapModule from '../src/renderer/src/app/bootstrap.ts'
import type { FileActions } from '../src/renderer/src/app/files.ts'

// Crash recovery timing (fake timers) and the launch prompt.
let recovery: typeof RecoveryModule
let boot: typeof BootstrapModule
before(async () => {
  recovery = await import('../src/renderer/src/app/recovery.ts')
  boot = await import('../src/renderer/src/app/bootstrap.ts')
})

/** Flush pending promise callbacks (the write itself is async). */
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

describe('RecoveryKeeper', () => {
  let fake: FakeHost
  let writes: RecoveryEntry[][]

  beforeEach(async () => {
    mock.timers.enable({ apis: ['setTimeout'] })
    fake = await fakeHost({ contents: { '/a.md': 'a' }, saved: { '/a.md': 'a' } })
    writes = []
    stubApi({
      saveRecovery: async (entries) => {
        writes.push(entries)
      }
    })
  })
  afterEach(() => mock.timers.reset())

  const type = (keeper: RecoveryModule.RecoveryKeeper, text: string): void => {
    fake.host.update((s) => ({ contents: { ...s.contents, '/a.md': text } }))
    keeper.schedule()
  }

  it('writes within 5 seconds even while the user keeps typing', async () => {
    // Arrange
    const keeper = new recovery.RecoveryKeeper(fake.host)
    keeper.enable()

    // Act: a keystroke every second for ten seconds.
    for (let i = 1; i <= 10; i++) {
      type(keeper, `a${'x'.repeat(i)}`)
      mock.timers.tick(1000)
      await settle()
    }

    // Assert
    assert.ok(writes.length >= 2, `expected at least 2 writes, got ${writes.length}`)
    assert.equal(writes[0][0].id, '/a.md')
    assert.equal(writes[0][0].content, 'axxxxx')
  })

  it('clears the stored buffers soon after everything is saved', async () => {
    const keeper = new recovery.RecoveryKeeper(fake.host)
    keeper.enable()
    type(keeper, 'edited')
    mock.timers.tick(recovery.RECOVERY_DELAY_MS)
    await settle()

    fake.host.update((s) => ({ saved: { ...s.saved, '/a.md': 'edited' } }))
    keeper.schedule()
    mock.timers.tick(recovery.CLEAR_DELAY_MS)
    await settle()

    assert.equal(writes.length, 2)
    assert.deepEqual(writes[1], [])
  })

  it('writes nothing before it is enabled (the launch prompt is still open)', async () => {
    const keeper = new recovery.RecoveryKeeper(fake.host)

    type(keeper, 'edited')
    mock.timers.tick(recovery.RECOVERY_DELAY_MS * 2)
    await settle()

    assert.equal(writes.length, 0)
  })
})

describe('launch recovery', () => {
  const entry: RecoveryEntry = { id: 'untitled:7', path: null, title: 'Draft', content: '# Draft', savedAt: 1 }

  it('still offers recovered documents when settings fail to load', async () => {
    // Arrange
    const fake = await fakeHost({ ready: false })
    const keeper = new recovery.RecoveryKeeper(fake.host)
    let enabled = false
    keeper.enable = () => {
      enabled = true
    }
    stubApi({
      getSettings: async () => {
        throw new Error('corrupt')
      },
      loadRecovery: async () => [entry]
    })

    // Act
    await boot.bootstrap({ host: fake.host, files: {} as FileActions, recovery: keeper, onSettings: () => undefined })

    // Assert
    assert.deepEqual(fake.state().recovery, [entry])
    assert.equal(enabled, false)
    assert.match(fake.toasts[0], /Couldn't load your settings/)
  })

  it('restores recovered buffers as unsaved tabs', () => {
    const base = { contents: {}, saved: {}, openTabs: ['/a.md'], untitledSeq: 2, activeId: '/a.md' }
    const file: RecoveryEntry = { id: '/b.md', path: '/b.md', title: 'b.md', content: 'mine', savedAt: 1 }

    const patch = recovery.restorePatch(base as never, [entry, file], { '/b.md': 'disk' })

    assert.deepEqual(patch.openTabs, ['/a.md', 'untitled:3', '/b.md'])
    assert.equal(patch.contents?.['untitled:3'], '# Draft')
    assert.equal(patch.saved?.['untitled:3'], '')
    assert.equal(patch.contents?.['/b.md'], 'mine')
    assert.equal(patch.saved?.['/b.md'], 'disk')
  })
})
