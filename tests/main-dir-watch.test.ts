import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { registerHooks } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'

// dir-watch imports its siblings without a file extension (as the bundler
// expects); Node's strip-types loader needs the ".ts", so add it for relative
// imports that fail to resolve, then load the module under test dynamically.
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (err) {
      if (!/^\.\.?\//.test(specifier) || /\.[cm]?[jt]s$/.test(specifier)) throw err
      return nextResolve(`${specifier}.ts`, context)
    }
  }
})

const {
  DEFAULT_WATCH_LIMITS,
  MAX_WATCHED_DIRS,
  collectWatchDirs,
  planWatchChanges,
  readSubdirs,
  usesNativeRecursiveWatch,
  watchTree
} = await import('../src/main/dir-watch.ts')
type WatchDir = import('../src/main/dir-watch.ts').WatchDir

const ROOT = join(tmpdir(), 'fake-workspace')
const at = (...parts: string[]): string => join(ROOT, ...parts)

/** An in-memory folder tree: folder path -> names of its subfolders. */
function fakeTree(entries: Record<string, string[]>): {
  tree: Map<string, string[]>
  list: (dir: string) => Promise<string[]>
  calls: () => number
} {
  const tree = new Map(Object.entries(entries))
  let count = 0
  return {
    tree,
    calls: () => count,
    list: async (dir) => {
      count++
      const names = tree.get(dir)
      if (!names) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      return names
    }
  }
}

interface FakeHandle {
  dir: string
  closed: boolean
  emit: (event: string, filename: string | null) => void
  fail: () => void
}

/** A watchDir that records every watch it starts; `refuse` makes chosen folders throw. */
function fakeWatcher(refuse: Set<string> = new Set()): { watchDir: WatchDir; open: () => string[]; handle: (dir: string) => FakeHandle } {
  const handles: FakeHandle[] = []
  const watchDir: WatchDir = (dir, onEvent, onError) => {
    if (refuse.has(dir)) throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' })
    const handle: FakeHandle = { dir, closed: false, emit: onEvent, fail: onError }
    handles.push(handle)
    return {
      close: () => {
        handle.closed = true
      }
    }
  }
  return {
    watchDir,
    open: () => handles.filter((h) => !h.closed).map((h) => h.dir).sort(),
    handle: (dir) => {
      const found = handles.filter((h) => h.dir === dir && !h.closed).at(-1)
      assert.ok(found, `no open watch for ${dir}`)
      return found
    }
  }
}

describe('usesNativeRecursiveWatch', () => {
  it('is native on Windows and macOS only', () => {
    assert.equal(usesNativeRecursiveWatch('win32'), true)
    assert.equal(usesNativeRecursiveWatch('darwin'), true)
    assert.equal(usesNativeRecursiveWatch('linux'), false)
    assert.equal(usesNativeRecursiveWatch('freebsd'), false)
  })
})

describe('collectWatchDirs', () => {
  it('lists the root and the folders the scanner enters, breadth-first', async () => {
    const { list } = fakeTree({
      [ROOT]: ['notes', 'docs', 'node_modules', '.git', 'build', '.obsidian'],
      [at('docs')]: ['api'],
      [at('docs', 'api')]: [],
      [at('notes')]: ['dist'],
      [at('node_modules')]: ['pkg']
    })
    assert.deepEqual(await collectWatchDirs(ROOT, list), [ROOT, at('docs'), at('notes'), at('docs', 'api')])
  })

  it('keeps the shallowest folders when there are more than the cap', async () => {
    const names = Array.from({ length: 10 }, (_, i) => `f${i}`)
    const { list } = fakeTree({ [ROOT]: names, [at('f0')]: ['deep'] })
    const dirs = await collectWatchDirs(ROOT, list, { maxDirs: 4, maxDepth: 12 })
    assert.deepEqual(dirs, [ROOT, at('f0'), at('f1'), at('f2')])
  })

  it('stops at the scanner depth', async () => {
    const { list } = fakeTree({ [ROOT]: ['a'], [at('a')]: ['b'], [at('a', 'b')]: ['c'], [at('a', 'b', 'c')]: [] })
    assert.deepEqual(await collectWatchDirs(ROOT, list, { maxDirs: 100, maxDepth: 2 }), [ROOT, at('a'), at('a', 'b')])
  })

  it('skips folders that vanish or cannot be read', async () => {
    const { list } = fakeTree({ [ROOT]: ['gone', 'kept'], [at('kept')]: [] })
    assert.deepEqual(await collectWatchDirs(ROOT, list), [ROOT, at('gone'), at('kept')])
  })

  it('uses the scanner depth and a cap of a few hundred folders by default', () => {
    assert.equal(DEFAULT_WATCH_LIMITS.maxDirs, MAX_WATCHED_DIRS)
    assert.ok(MAX_WATCHED_DIRS >= 100 && MAX_WATCHED_DIRS <= 1000)
    assert.equal(DEFAULT_WATCH_LIMITS.maxDepth, 12)
  })
})

describe('planWatchChanges', () => {
  it('starts new folders and stops removed ones', () => {
    assert.deepEqual(planWatchChanges(['a', 'b', 'c'], ['a', 'c', 'd']), { add: ['d'], remove: ['b'] })
    assert.deepEqual(planWatchChanges([], ['a', 'a']), { add: ['a'], remove: [] })
    assert.deepEqual(planWatchChanges(new Set(['a']), []), { add: [], remove: ['a'] })
  })
})

describe('readSubdirs', () => {
  let base: string

  before(async () => {
    base = await mkdtemp(join(tmpdir(), 'simplemd-dirwatch-'))
    await mkdir(join(base, 'docs'))
    await mkdir(join(base, 'node_modules', 'pkg'), { recursive: true })
    await writeFile(join(base, 'readme.md'), '# hi')
  })

  after(async () => {
    await rm(base, { recursive: true, force: true })
  })

  it('returns folders only, and collectWatchDirs leaves node_modules out', async () => {
    assert.deepEqual((await readSubdirs(base)).sort(), ['docs', 'node_modules'])
    assert.deepEqual(await collectWatchDirs(base, readSubdirs), [base, join(base, 'docs')])
  })
})

describe('watchTree', () => {
  const options = (list: (dir: string) => Promise<string[]>, watchDir: WatchDir) => ({
    listSubdirs: list,
    watchDir,
    resyncDelayMs: 1
  })

  it('watches each scanned folder, but never node_modules or .git', async () => {
    const { list } = fakeTree({ [ROOT]: ['docs', 'node_modules', '.git'], [at('docs')]: [] })
    const fake = fakeWatcher()
    const watcher = watchTree(ROOT, () => undefined, options(list, fake.watchDir))
    await watcher.settled()
    assert.deepEqual(fake.open(), [ROOT, at('docs')].sort())
    watcher.close()
  })

  it('starts watching a new folder and reports the change again once it does', async () => {
    const { tree, list } = fakeTree({ [ROOT]: [] })
    const fake = fakeWatcher()
    let changes = 0
    const watcher = watchTree(ROOT, () => changes++, options(list, fake.watchDir))
    await watcher.settled()
    tree.set(ROOT, ['new'])
    tree.set(at('new'), [])
    fake.handle(ROOT).emit('rename', 'new')
    await watcher.settled()
    assert.deepEqual(fake.open(), [ROOT, at('new')].sort())
    assert.equal(changes, 2) // the event itself, then "watching the new folder now"
    watcher.close()
  })

  it('stops watching a folder that was removed', async () => {
    const { tree, list } = fakeTree({ [ROOT]: ['old'], [at('old')]: [] })
    const fake = fakeWatcher()
    const watcher = watchTree(ROOT, () => undefined, options(list, fake.watchDir))
    await watcher.settled()
    const old = fake.handle(at('old'))
    tree.set(ROOT, [])
    tree.delete(at('old'))
    fake.handle(ROOT).emit('rename', 'old')
    await watcher.settled()
    assert.equal(old.closed, true)
    assert.deepEqual(fake.open(), [ROOT])
    watcher.close()
  })

  it('ignores churn in skipped names and re-reads folders only for renames', async () => {
    const { list, calls } = fakeTree({ [ROOT]: [] })
    const fake = fakeWatcher()
    let changes = 0
    const watcher = watchTree(ROOT, () => changes++, options(list, fake.watchDir))
    await watcher.settled()
    const before = calls()
    fake.handle(ROOT).emit('rename', '.notes.md.1a2b.tmp')
    fake.handle(ROOT).emit('rename', 'node_modules')
    assert.equal(changes, 0)
    fake.handle(ROOT).emit('change', 'notes.md')
    await watcher.settled()
    assert.equal(changes, 1)
    assert.equal(calls(), before)
    watcher.close()
  })

  it('skips a folder whose watch fails to start and retries it on the next change', async () => {
    const { list } = fakeTree({ [ROOT]: ['a', 'b'], [at('a')]: [], [at('b')]: [] })
    const refuse = new Set([at('a')])
    const fake = fakeWatcher(refuse)
    const watcher = watchTree(ROOT, () => undefined, options(list, fake.watchDir))
    await watcher.settled()
    assert.deepEqual(fake.open(), [ROOT, at('b')].sort())
    refuse.clear()
    fake.handle(ROOT).emit('rename', 'c')
    await watcher.settled()
    assert.deepEqual(fake.open(), [ROOT, at('a'), at('b')].sort())
    watcher.close()
  })

  it('replaces a watch that failed later', async () => {
    const { list } = fakeTree({ [ROOT]: ['a'], [at('a')]: [] })
    const fake = fakeWatcher()
    const watcher = watchTree(ROOT, () => undefined, options(list, fake.watchDir))
    await watcher.settled()
    const first = fake.handle(at('a'))
    first.fail()
    await watcher.settled()
    assert.equal(first.closed, true)
    assert.notEqual(fake.handle(at('a')), first)
    watcher.close()
  })

  it('closes every watch and ignores later events', async () => {
    const { list } = fakeTree({ [ROOT]: ['a'], [at('a')]: [] })
    const fake = fakeWatcher()
    let changes = 0
    const watcher = watchTree(ROOT, () => changes++, options(list, fake.watchDir))
    await watcher.settled()
    const root = fake.handle(ROOT)
    watcher.close()
    root.emit('change', 'notes.md')
    await watcher.settled()
    assert.deepEqual(fake.open(), [])
    assert.equal(changes, 0)
  })

  it('reports a real file written in a subfolder', async () => {
    const base = await mkdtemp(join(tmpdir(), 'simplemd-dirwatch-live-'))
    await mkdir(join(base, 'docs'))
    let resolveChange: () => void = () => undefined
    const changed = new Promise<void>((resolve) => {
      resolveChange = resolve
    })
    const watcher = watchTree(base, () => resolveChange())
    try {
      await watcher.settled()
      await writeFile(join(base, 'docs', 'new.md'), '# new')
      const timeout = new Promise<string>((resolve) => setTimeout(() => resolve('timeout'), 5000).unref())
      assert.notEqual(await Promise.race([changed.then(() => 'changed'), timeout]), 'timeout')
    } finally {
      watcher.close()
      await rm(base, { recursive: true, force: true })
    }
  })
})
