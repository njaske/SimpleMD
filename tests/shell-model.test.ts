import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { FolderScan, MdFolderInfo } from '../src/shared/types.ts'
import {
  adoptSavedAs,
  autoOpenFiles,
  baseName,
  closeTabs,
  cycleTab,
  dirOf,
  displayDir,
  dropDoc,
  initialExpanded,
  insertTab,
  insertTreeFile,
  isUntitled,
  isWithin,
  namesIn,
  neighbourAfterClose,
  pushRecents,
  rebase,
  reconcileNote,
  reconcileScan,
  remapPaths,
  remapTree,
  stemLength,
  tabsRightOf,
  uniqueName,
  unsavedIds,
  untitledId,
  without,
  type DocSlice
} from '../src/renderer/src/app/model.ts'

const slice = (over: Partial<DocSlice> = {}): DocSlice => ({
  openTabs: [],
  activeId: null,
  contents: {},
  saved: {},
  pinned: [],
  recents: [],
  looseFiles: [],
  externalChanges: {},
  expanded: {},
  closed: [],
  newPaths: {},
  ...over
})

const folder = (dir: string, names: string[], name = baseName(dir)): MdFolderInfo => ({
  id: dir,
  name,
  path: dir,
  files: names.map((n) => ({ id: `${dir}/${n}`, path: `${dir}/${n}`, name: n, dir }))
})

describe('paths', () => {
  it('splits names and parents on both separators', () => {
    assert.equal(baseName('C:\\notes\\a.md'), 'a.md')
    assert.equal(dirOf('/w/notes/a.md'), '/w/notes')
    assert.equal(dirOf('/notes'), '/')
    assert.equal(dirOf('untitled:3'), 'untitled:3')
  })

  it('knows untitled ids', () => {
    assert.equal(untitledId(4), 'untitled:4')
    assert.equal(isUntitled('untitled:4'), true)
    assert.equal(isUntitled('/w/a.md'), false)
    assert.equal(isUntitled(null), false)
  })

  it('tests containment without matching sibling prefixes', () => {
    assert.equal(isWithin('/w/notes/a.md', '/w/notes'), true)
    assert.equal(isWithin('/w/notes-old/a.md', '/w/notes'), false)
    assert.equal(isWithin('C:\\w\\a.md', 'C:\\w'), true)
  })

  it('rebases paths inside a renamed folder only', () => {
    assert.equal(rebase('/w/a/x.md', '/w/a', '/w/b'), '/w/b/x.md')
    assert.equal(rebase('/w/a', '/w/a', '/w/b'), '/w/b')
    assert.equal(rebase('/w/ab/x.md', '/w/a', '/w/b'), null)
  })

  it('selects the stem of a file name', () => {
    assert.equal(stemLength('notes.md'), 5)
    assert.equal(stemLength('.env'), 4)
    assert.equal(stemLength('README'), 6)
  })

  it('shows folders relative to the workspace', () => {
    assert.equal(displayDir('/w/a/b', '/w', 'w'), 'w/a/b')
    assert.equal(displayDir('/w', '/w', 'w'), 'w')
    assert.equal(displayDir('C:\\other', '/w', 'w'), 'C:/other')
  })

  it('finds a free name case-insensitively', () => {
    assert.equal(uniqueName('Untitled', '.md', []), 'Untitled.md')
    assert.equal(uniqueName('Untitled', '.md', ['untitled.md', 'Untitled 2.md']), 'Untitled 3.md')
  })

  it('lists the names in one folder', () => {
    assert.deepEqual(namesIn('/w', ['/w/a.md', '/w/sub/b.md', '/w/c.md']), ['a.md', 'c.md'])
  })
})

describe('small helpers', () => {
  it('removes keys without touching the input', () => {
    const rec = { a: 1, b: 2 }
    assert.deepEqual(without(rec, 'a'), { b: 2 })
    assert.deepEqual(rec, { a: 1, b: 2 })
    assert.equal(without(rec, 'zz'), rec)
  })

  it('lists unsaved ids, including untitled documents with text', () => {
    const contents = { a: 'x', b: 'y', 'untitled:1': 'hi', 'untitled:2': '' }
    const saved = { a: 'x', b: 'z', 'untitled:1': '', 'untitled:2': '' }
    assert.deepEqual(unsavedIds(contents, saved), ['b', 'untitled:1'])
  })

  it('keeps recents unique, capped and free of untitled ids', () => {
    assert.deepEqual(pushRecents(['b', 'untitled:1'], ['a', 'b']), ['b', 'a'])
    assert.equal(
      pushRecents(
        ['x'],
        Array.from({ length: 20 }, (_, i) => `f${i}`)
      ).length,
      8
    )
  })
})

describe('tabs', () => {
  it('activates the right neighbour, else the left one, after a close', () => {
    assert.equal(neighbourAfterClose(['a', 'b', 'c'], 'b', new Set(['b'])), 'c')
    assert.equal(neighbourAfterClose(['a', 'b', 'c'], 'c', new Set(['c'])), 'b')
    assert.equal(neighbourAfterClose(['a', 'b'], 'a', new Set(['b'])), 'a')
    assert.equal(neighbourAfterClose(['a'], 'a', new Set(['a'])), null)
  })

  it('remembers closed files (not untitled) for Reopen closed tab', () => {
    const r = closeTabs({ openTabs: ['a', 'untitled:1', 'c'], activeId: 'c', closed: [{ id: 'z', index: 0 }] }, [
      'a',
      'untitled:1',
      'c'
    ])
    assert.deepEqual(r.openTabs, [])
    assert.equal(r.activeId, null)
    assert.deepEqual(
      r.closed.map((c) => c.id),
      ['c', 'a', 'z']
    )
  })

  it('cycles through tabs both ways', () => {
    assert.equal(cycleTab(['a', 'b', 'c'], 'c', 1), 'a')
    assert.equal(cycleTab(['a', 'b', 'c'], 'a', -1), 'c')
    assert.equal(cycleTab([], null, 1), null)
  })

  it('inserts a tab once, at a clamped index', () => {
    assert.deepEqual(insertTab(['a', 'b'], 'x', 1), ['a', 'x', 'b'])
    assert.deepEqual(insertTab(['a', 'b'], 'x', 9), ['a', 'b', 'x'])
    assert.deepEqual(insertTab(['a', 'x'], 'x', 0), ['a', 'x'])
  })

  it('finds tabs to the right', () => {
    assert.deepEqual(tabsRightOf(['a', 'b', 'c'], 'a'), ['b', 'c'])
    assert.deepEqual(tabsRightOf(['a'], 'q'), [])
  })
})

describe('moving documents', () => {
  it('moves contents, unsaved edits, tabs, pins and recents with a renamed file', () => {
    const s = slice({
      openTabs: ['/w/a.md', '/w/b.md'],
      activeId: '/w/a.md',
      contents: { '/w/a.md': 'edited' },
      saved: { '/w/a.md': 'old' },
      pinned: ['/w/a.md'],
      recents: ['/w/a.md'],
      looseFiles: [{ id: '/w/a.md', path: '/w/a.md', name: 'a.md', dir: '/w' }]
    })
    const r = remapPaths(s, '/w/a.md', '/w/z.md')
    assert.deepEqual(r.openTabs, ['/w/z.md', '/w/b.md'])
    assert.equal(r.activeId, '/w/z.md')
    assert.deepEqual(r.contents, { '/w/z.md': 'edited' })
    assert.deepEqual(r.saved, { '/w/z.md': 'old' })
    assert.deepEqual(r.pinned, ['/w/z.md'])
    assert.deepEqual(r.recents, ['/w/z.md'])
    assert.equal(r.looseFiles[0].name, 'z.md')
    assert.equal(s.openTabs[0], '/w/a.md', 'input untouched')
  })

  it('moves everything inside a renamed folder', () => {
    const s = slice({ openTabs: ['/w/a/x.md', '/w/b/y.md'], expanded: { '/w/a': true } })
    const r = remapPaths(s, '/w/a', '/w/c')
    assert.deepEqual(r.openTabs, ['/w/c/x.md', '/w/b/y.md'])
    assert.deepEqual(r.expanded, { '/w/c': true })
  })

  it('turns an untitled tab into the saved file in place', () => {
    const s = slice({
      openTabs: ['/w/a.md', 'untitled:1', '/w/b.md'],
      activeId: 'untitled:1',
      contents: { 'untitled:1': '# Hi' },
      saved: { 'untitled:1': '' }
    })
    const r = adoptSavedAs(s, 'untitled:1', '/d/Hi.md', '# Hi', true)
    assert.deepEqual(r.openTabs, ['/w/a.md', '/d/Hi.md', '/w/b.md'])
    assert.equal(r.activeId, '/d/Hi.md')
    assert.equal(r.contents['untitled:1'], undefined)
    assert.equal(r.saved['/d/Hi.md'], '# Hi')
    assert.equal(r.looseFiles[0].path, '/d/Hi.md')
    assert.equal(r.recents[0], '/d/Hi.md')
  })

  it('leaves the original file at its saved text after Save as', () => {
    const s = slice({
      openTabs: ['/w/a.md'],
      activeId: '/w/a.md',
      contents: { '/w/a.md': 'new' },
      saved: { '/w/a.md': 'old' }
    })
    const r = adoptSavedAs(s, '/w/a.md', '/w/a copy.md', 'new', false)
    assert.equal(r.contents['/w/a.md'], 'old')
    assert.equal(r.contents['/w/a copy.md'], 'new')
    assert.deepEqual(r.looseFiles, [])
  })

  it('does not duplicate a tab when saving over a file that is already open', () => {
    const s = slice({
      openTabs: ['/w/a.md', 'untitled:1'],
      activeId: 'untitled:1',
      contents: { 'untitled:1': 'x' },
      saved: { 'untitled:1': '' }
    })
    assert.deepEqual(adoptSavedAs(s, 'untitled:1', '/w/a.md', 'x', false).openTabs, ['/w/a.md'])
  })

  it('treats Save as onto the same file as a plain save', () => {
    const s = slice({
      openTabs: ['/w/a.md', '/w/b.md'],
      activeId: '/w/a.md',
      contents: { '/w/a.md': 'NEW EDITS' },
      saved: { '/w/a.md': 'old' },
      externalChanges: { '/w/a.md': true }
    })
    const r = adoptSavedAs(s, '/w/a.md', '/w/a.md', 'NEW EDITS', false)
    assert.deepEqual(r.openTabs, ['/w/a.md', '/w/b.md'])
    assert.equal(r.activeId, '/w/a.md')
    assert.equal(r.contents['/w/a.md'], 'NEW EDITS')
    assert.equal(r.saved['/w/a.md'], 'NEW EDITS')
    assert.deepEqual(r.externalChanges, {})
  })

  it('hands a real file saved onto another open tab to that tab', () => {
    const s = slice({
      openTabs: ['/w/a.md', '/w/b.md'],
      activeId: '/w/a.md',
      contents: { '/w/a.md': 'mine', '/w/b.md': 'theirs' },
      saved: { '/w/a.md': 'old a', '/w/b.md': 'theirs' }
    })
    const r = adoptSavedAs(s, '/w/a.md', '/w/b.md', 'mine', false)
    assert.deepEqual(r.openTabs, ['/w/b.md'])
    assert.equal(r.activeId, '/w/b.md')
    assert.equal(r.contents['/w/b.md'], 'mine')
    assert.equal(r.saved['/w/b.md'], 'mine')
    assert.equal(r.contents['/w/a.md'], 'old a', 'the old file was not written')
  })

  it('forgets a document everywhere', () => {
    const s = slice({
      openTabs: ['a', 'b'],
      activeId: 'a',
      contents: { a: '1' },
      saved: { a: '1' },
      pinned: ['a'],
      recents: ['a', 'b'],
      closed: [{ id: 'a', index: 0 }]
    })
    const r = dropDoc(s, 'a')
    assert.deepEqual(r.openTabs, ['b'])
    assert.equal(r.activeId, 'b')
    assert.deepEqual(r.pinned, [])
    assert.deepEqual(r.recents, ['b'])
    assert.deepEqual(r.closed, [])
    assert.equal(r.contents.a, undefined)
  })
})

describe('workspace tree', () => {
  it('adds a created file to its folder (sorted) or a new group', () => {
    const tree = [folder('/w', ['b.md'])]
    const withA = insertTreeFile(tree, { id: '/w/a.md', path: '/w/a.md', name: 'a.md', dir: '/w' }, 'w')
    assert.deepEqual(
      withA[0].files.map((f) => f.name),
      ['a.md', 'b.md']
    )
    const withSub = insertTreeFile(tree, { id: '/w/s/c.md', path: '/w/s/c.md', name: 'c.md', dir: '/w/s' }, 's')
    assert.equal(withSub.length, 2)
    assert.equal(tree[0].files.length, 1, 'input untouched')
  })

  it('renames files and folders in the tree', () => {
    const tree = [folder('/w', ['a.md']), folder('/w/old', ['x.md'])]
    assert.equal(remapTree(tree, '/w/a.md', '/w/z.md')[0].files[0].name, 'z.md')
    const moved = remapTree(tree, '/w/old', '/w/new')[1]
    assert.equal(moved.id, '/w/new')
    assert.equal(moved.name, 'new')
    assert.equal(moved.files[0].path, '/w/new/x.md')
  })

  it('expands every folder when there are few, else the first three', () => {
    assert.equal(Object.values(initialExpanded([folder('/a', []), folder('/b', [])])).every(Boolean), true)
    const many = Array.from({ length: 8 }, (_, i) => folder(`/f${i}`, []))
    assert.equal(Object.values(initialExpanded(many)).filter(Boolean).length, 3)
  })
})

describe('reconcileScan', () => {
  const tree = [folder('/w', ['a.md', 'b.md', 'c.md'])]
  const base = {
    tree,
    contents: { '/w/a.md': 'A', '/w/b.md': 'B-edited', '/w/c.md': 'C' },
    saved: { '/w/a.md': 'A', '/w/b.md': 'B', '/w/c.md': 'C' },
    externalChanges: {},
    openTabs: ['/w/a.md', '/w/b.md', '/w/c.md', 'untitled:1'],
    activeId: '/w/c.md',
    looseFiles: []
  }
  const scan: FolderScan = {
    root: '/w',
    name: 'w',
    tree: [folder('/w', ['a.md', 'b.md', 'd.md'])],
    contents: { '/w/a.md': 'A2', '/w/b.md': 'B2', '/w/d.md': 'D' }
  }

  it('reloads clean files and never clobbers unsaved edits', () => {
    const r = reconcileScan(base, scan)
    assert.equal(r.contents['/w/a.md'], 'A2')
    assert.equal(r.contents['/w/b.md'], 'B-edited')
    assert.equal(r.externalChanges['/w/b.md'], true)
    assert.deepEqual(r.reloaded, ['/w/a.md'])
  })

  it('closes clean files that vanished and reports new ones', () => {
    const r = reconcileScan(base, scan)
    assert.equal(r.removed, 1)
    assert.deepEqual(r.openTabs, ['/w/a.md', '/w/b.md', 'untitled:1'])
    assert.equal(r.activeId, '/w/a.md')
    assert.deepEqual(r.added, ['/w/d.md'])
  })

  it('keeps a vanished file that has unsaved edits, flagged', () => {
    const r = reconcileScan({ ...base, contents: { ...base.contents, '/w/c.md': 'C-edited' } }, scan)
    assert.equal(r.contents['/w/c.md'], 'C-edited')
    assert.equal(r.externalChanges['/w/c.md'], true)
  })

  it('does not change its input', () => {
    reconcileScan(base, scan)
    assert.equal(base.contents['/w/a.md'], 'A')
  })

  it('summarizes what happened for a toast', () => {
    assert.equal(reconcileNote({ reloaded: ['a'], removed: 0 }), 'Reloaded 1 file changed on disk')
    assert.equal(reconcileNote({ reloaded: [], removed: 2 }), '2 files were removed on disk')
    assert.equal(reconcileNote({ reloaded: [], removed: 0 }), null)
  })
})

describe('autoOpenFiles', () => {
  it('puts README first and caps the tabs a new folder opens with', () => {
    const all = ['/w/a.md', '/w/b.md', '/w/c.md', '/w/d.md', '/w/e.md', '/w/f.md', '/w/g.md', '/w/README.md']
    assert.deepEqual(autoOpenFiles(all), ['/w/README.md', '/w/a.md', '/w/b.md', '/w/c.md'])
  })

  it('keeps tree order when there is no README', () => {
    assert.deepEqual(autoOpenFiles(['/w/x.md', '/w/y.md'], 6), ['/w/x.md', '/w/y.md'])
  })
})
