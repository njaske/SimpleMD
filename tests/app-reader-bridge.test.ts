import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import './support/aliases.ts'
import { fakeHost, stubApi, type FakeHost } from './support/fakeHost.ts'
import type * as BridgeModule from '../src/renderer/src/app/readerBridge.ts'
import type { LineRange } from '../src/renderer/src/lib/ranges.ts'

// The App's handling of reader callbacks and disk reloads: task boxes, the
// "fixed for display" list, "what changed" marks and following the end.
let bridgeMod: typeof BridgeModule
before(async () => {
  bridgeMod = await import('../src/renderer/src/app/readerBridge.ts')
})

interface ReaderStub {
  nearEnd: boolean
  marked: number
  shown: LineRange[][]
  cleared: number
  scrolledToEnd: number
  repaints: number
}

/** A fake host whose reader records what the bridge asked of it. */
async function setup(over: Parameters<typeof fakeHost>[0] = {}): Promise<{ fake: FakeHost; reader: ReaderStub }> {
  const fake = await fakeHost(over)
  const reader: ReaderStub = { nearEnd: false, marked: 2, shown: [], cleared: 0, scrolledToEnd: 0, repaints: 0 }
  Object.assign(fake.host, {
    reader: {
      isNearEnd: () => reader.nearEnd,
      scrollToEnd: () => void reader.scrolledToEnd++,
      showChanges: (ranges: LineRange[]) => {
        reader.shown.push(ranges)
        return reader.marked
      },
      clearChanges: () => void reader.cleared++,
      getArticle: () => null
    },
    renderDoc: () => void reader.repaints++
  })
  return { fake, reader }
}

/** A diff stand-in: one range per line that differs. */
const lineDiff = async () => (before: string, after: string): LineRange[] => {
  const a = before.split('\n')
  return after
    .split('\n')
    .map((line, i) => (line === a[i] ? null : { from: i, to: i + 1 }))
    .filter((r): r is LineRange => r !== null)
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

/** Like React: updates queue up and apply in order on flush(). */
function batched(fake: FakeHost): { flush: () => void } {
  const queue: Parameters<FakeHost['host']['update']>[] = []
  const apply = fake.host.update
  fake.host.update = (u, then) => void queue.push([u, then])
  return {
    flush: () => {
      for (const [u, then] of queue.splice(0)) apply(u, then)
    }
  }
}

const TASKS = '- [ ] one\n- [ ] two\n'

describe('clickable task boxes', () => {
  it('saves a clean file right away and quietly confirms', async () => {
    // Arrange
    const { fake } = await setup({ activeId: '/a.md', contents: { '/a.md': TASKS }, saved: { '/a.md': TASKS } })
    const writes: string[] = []
    stubApi({ saveFile: async (_p: string, text: string) => {
        writes.push(text)
        return true
      } })
    const bridge = new bridgeMod.ReaderBridge(fake.host, lineDiff)

    // Act
    bridge.onToggleTask(0, true)
    await tick()

    // Assert
    assert.deepEqual(writes, ['- [x] one\n- [ ] two\n'])
    assert.equal(fake.state().saved['/a.md'], '- [x] one\n- [ ] two\n')
    assert.equal(fake.toasts.at(-1), 'Saved')
  })

  it('lets quick clicks on several boxes all land in one serialized save', async () => {
    const { fake } = await setup({ activeId: '/a.md', contents: { '/a.md': TASKS }, saved: { '/a.md': TASKS } })
    const writes: string[] = []
    stubApi({ saveFile: async (_p: string, text: string) => {
        writes.push(text)
        return true
      } })
    const bridge = new bridgeMod.ReaderBridge(fake.host, lineDiff)

    bridge.onToggleTask(0, true)
    bridge.onToggleTask(1, true)
    await tick()
    await tick()

    assert.equal(writes.at(-1), '- [x] one\n- [x] two\n')
    assert.equal(fake.state().saved['/a.md'], '- [x] one\n- [x] two\n')
  })

  it('keeps the change unsaved when the document already had edits', async () => {
    const { fake } = await setup({ activeId: '/a.md', contents: { '/a.md': TASKS + 'typed' }, saved: { '/a.md': TASKS } })
    let saves = 0
    stubApi({ saveFile: async () => {
        saves++
        return true
      } })
    const bridge = new bridgeMod.ReaderBridge(fake.host, lineDiff)

    bridge.onToggleTask(1, true)
    await tick()

    assert.equal(saves, 0)
    assert.equal(fake.state().contents['/a.md'], '- [ ] one\n- [x] two\ntyped')
    assert.equal(fake.state().saved['/a.md'], TASKS)
  })

  it('never saves an untitled document', async () => {
    const { fake } = await setup({ activeId: 'untitled:1', contents: { 'untitled:1': TASKS }, saved: { 'untitled:1': '' } })
    let saves = 0
    stubApi({ saveFile: async () => {
        saves++
        return true
      } })

    new bridgeMod.ReaderBridge(fake.host, lineDiff).onToggleTask(0, true)
    await tick()

    assert.equal(saves, 0)
    assert.equal(fake.state().contents['untitled:1'], '- [x] one\n- [ ] two\n')
  })

  it('keeps a failed save as an unsaved edit and says what happened', async () => {
    const { fake } = await setup({ activeId: '/a.md', contents: { '/a.md': TASKS }, saved: { '/a.md': TASKS } })
    stubApi({
      saveFile: async () => {
        throw new Error('EACCES: permission denied.')
      }
    })

    new bridgeMod.ReaderBridge(fake.host, lineDiff).onToggleTask(0, true)
    await tick()
    await tick()

    assert.equal(fake.state().saved['/a.md'], TASKS)
    assert.notEqual(fake.state().contents['/a.md'], TASKS)
    assert.equal(fake.toasts.at(-1), "Couldn't save a.md (EACCES: permission denied). The change is kept as an unsaved edit; press Ctrl+S to try again.")
  })

  it('repaints instead of editing when the click is stale (not a task line)', async () => {
    const { fake, reader } = await setup({ activeId: '/a.md', contents: { '/a.md': 'plain\n' }, saved: { '/a.md': 'plain\n' } })

    new bridgeMod.ReaderBridge(fake.host, lineDiff).onToggleTask(0, true)

    assert.equal(reader.repaints, 1)
    assert.equal(fake.state().contents['/a.md'], 'plain\n')
  })
})

describe('render info', () => {
  it('keeps the active document\'s display fixes and blocked image count', async () => {
    const { fake } = await setup({ activeId: '/a.md', viewMode: 'read' })
    const bridge = new bridgeMod.ReaderBridge(fake.host, lineDiff)

    bridge.onRenderInfo({ fixes: ['Closed an unfinished code block'], blockedImages: 2 })

    assert.deepEqual(fake.state().renderFixes, ['Closed an unfinished code block'])
    assert.equal(fake.state().blockedImages, 2)
  })

  it('keeps the chips when the next document reports the same fixes and blocked images', async () => {
    // Arrange: A's values are in state; the App has switched to B.
    const fixes = ['Closed an unfinished code block']
    const { fake } = await setup({ activeId: '/b.md', viewMode: 'read', renderFixes: fixes, blockedImages: 1 })
    const bridge = new bridgeMod.ReaderBridge(fake.host, lineDiff)
    bridge.onRenderInfo({ fixes, blockedImages: 1 })
    const react = batched(fake)

    // Act: the App's switch (reset queued), then B's paint, applied in React's order.
    bridge.left('/a.md')
    fake.host.update({ renderFixes: [], blockedImages: 0 })
    bridge.onRenderInfo({ fixes, blockedImages: 1 })
    react.flush()

    // Assert
    assert.deepEqual(fake.state().renderFixes, fixes)
    assert.equal(fake.state().blockedImages, 1)
  })

  it('does not rewrite the chips on a repaint of the same document with the same info', async () => {
    const { fake } = await setup({ activeId: '/a.md', viewMode: 'read' })
    const bridge = new bridgeMod.ReaderBridge(fake.host, lineDiff)
    bridge.onRenderInfo({ fixes: ['x'], blockedImages: 0 })
    const before = fake.state()

    bridge.onRenderInfo({ fixes: ['x'], blockedImages: 0 })

    assert.equal(fake.state(), before)
  })
})

describe('closing a tab', () => {
  const open = { activeId: '/a.md', viewMode: 'read' as const, openTabs: ['/a.md', '/b.md'] }

  it('forgets a background document\'s changes, so a reopened tab starts fresh', async () => {
    // Arrange: /b.md changes while /a.md is in front, so the reader never showed them.
    const { fake, reader } = await setup(open)
    const bridge = new bridgeMod.ReaderBridge(fake.host, lineDiff)
    bridge.beforeReload([{ id: '/b.md', before: 'one\ntwo', after: 'one\nTWO' }])()
    await tick()
    assert.equal(fake.state().changes['/b.md'], 1)

    // Act: close it, reopen it and let it change again.
    bridge.closed('/b.md')
    fake.host.update({ activeId: '/b.md' })
    bridge.beforeReload([{ id: '/b.md', before: 'one\nTWO', after: 'one\nTWO\nthree' }])()
    await tick()

    // Assert: only the new change, measured from what the reopened tab showed.
    assert.equal(fake.state().changes['/b.md'], 1)
    assert.deepEqual(reader.shown.at(-1), [{ from: 2, to: 3 }])
  })

  it('drops the closed tab\'s count right away', async () => {
    const { fake } = await setup(open)
    const bridge = new bridgeMod.ReaderBridge(fake.host, lineDiff)
    bridge.beforeReload([{ id: '/b.md', before: 'x', after: 'y' }])()
    await tick()

    bridge.closed('/b.md')

    assert.equal(fake.state().changes['/b.md'], undefined)
  })
})

describe('what changed and following the end', () => {
  const open = { activeId: '/a.md', viewMode: 'read' as const, contents: { '/a.md': 'a\nb\n' }, saved: { '/a.md': 'a\nb\n' } }

  it('marks the changed lines of the active document once the diff is ready', async () => {
    const { fake, reader } = await setup(open)
    const bridge = new bridgeMod.ReaderBridge(fake.host, lineDiff)

    bridge.beforeReload([{ id: '/a.md', before: 'a\nb', after: 'a\nB\nc' }])()
    await tick()

    assert.deepEqual(reader.shown.at(-1), [
      { from: 1, to: 2 },
      { from: 2, to: 3 }
    ])
    assert.equal(fake.state().changes['/a.md'], 2)
    assert.equal(bridge.hasChanges('/a.md'), true)
  })

  it('keeps counting from what the user last saw across several reloads', async () => {
    const { fake, reader } = await setup(open)
    const bridge = new bridgeMod.ReaderBridge(fake.host, lineDiff)

    bridge.beforeReload([{ id: '/a.md', before: 'a\nb\n', after: 'a\nB\n' }])()
    await tick()
    bridge.beforeReload([{ id: '/a.md', before: 'a\nB\n', after: 'A\nB\n' }])()
    await tick()

    assert.deepEqual(reader.shown.at(-1), [
      { from: 0, to: 1 },
      { from: 1, to: 2 }
    ])
  })

  it('waits for the reader in Edit view and shows the changes when it paints', async () => {
    const { fake, reader } = await setup({ ...open, viewMode: 'edit' })
    const bridge = new bridgeMod.ReaderBridge(fake.host, lineDiff)

    bridge.beforeReload([{ id: '/a.md', before: 'a\nb\n', after: 'a\nx\n' }])()
    await tick()
    assert.equal(reader.shown.length, 0)
    fake.host.update({ viewMode: 'read' })
    bridge.onRenderInfo({ fixes: [] })

    assert.equal(reader.shown.length, 1)
  })

  it('clears a document\'s changes when the user leaves it or dismisses them', async () => {
    const { fake, reader } = await setup(open)
    const bridge = new bridgeMod.ReaderBridge(fake.host, lineDiff)
    bridge.beforeReload([{ id: '/a.md', before: 'a\nb\n', after: 'a\nx\n' }])()
    await tick()

    bridge.left('/a.md')
    assert.equal(fake.state().changes['/a.md'], undefined)

    bridge.beforeReload([{ id: '/a.md', before: 'a\nx\n', after: 'y\nx\n' }])()
    await tick()
    bridge.dismiss()
    assert.equal(fake.state().changes['/a.md'], undefined)
    assert.equal(reader.cleared, 1)
  })

  it('drops the marks once the user edits the document', async () => {
    const { fake, reader } = await setup(open)
    const bridge = new bridgeMod.ReaderBridge(fake.host, lineDiff)
    bridge.beforeReload([{ id: '/a.md', before: 'a\nb\n', after: 'a\nx\n' }])()
    await tick()

    bridge.edited('/a.md')

    assert.equal(fake.state().changes['/a.md'], undefined)
    assert.equal(reader.cleared, 1)
  })

  it('follows the end only when the reader was near it before the reload', async () => {
    const { fake, reader } = await setup(open)
    const bridge = new bridgeMod.ReaderBridge(fake.host, lineDiff)

    reader.nearEnd = false
    bridge.beforeReload([{ id: '/a.md', before: 'a\n', after: 'a\nb\n' }])()
    reader.nearEnd = true
    const after = bridge.beforeReload([{ id: '/a.md', before: 'a\nb\n', after: 'a\nb\nc\n' }])
    // Measured before the new text arrives; scrolling waits for the callback.
    reader.nearEnd = false
    assert.equal(reader.scrolledToEnd, 0)
    after()

    assert.equal(reader.scrolledToEnd, 1)
    assert.ok(fake.state().changes)
  })

  it('does not follow a background document', async () => {
    const { fake, reader } = await setup(open)
    reader.nearEnd = true

    new bridgeMod.ReaderBridge(fake.host, lineDiff).beforeReload([{ id: '/b.md', before: 'x', after: 'xy' }])()

    assert.equal(reader.scrolledToEnd, 0)
  })

  it('stays quiet when the diff module fails to load', async () => {
    const { fake, reader } = await setup(open)
    const bridge = new bridgeMod.ReaderBridge(fake.host, () => Promise.reject(new Error('chunk')))

    bridge.beforeReload([{ id: '/a.md', before: 'a', after: 'b' }])()
    await tick()

    assert.equal(reader.shown.length, 0)
    assert.deepEqual(fake.toasts, [])
  })
})
