import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { Window } from 'happy-dom'
import './support/aliases.ts'
import { fakeHost, file, scanOf, stubApi } from './support/fakeHost.ts'
import type { DocumentActions } from '../src/renderer/src/app/documents.ts'
import type * as FilesModule from '../src/renderer/src/app/files.ts'
import type * as ModelModule from '../src/renderer/src/app/model.ts'
import type * as ViewModule from '../src/renderer/src/app/view.ts'

// Folder and file flows through createFileActions with a fake App host.
const win = new Window()
Object.assign(globalThis, { document: win.document, CSS: win.CSS })

let files: typeof FilesModule
let model: typeof ModelModule
let view: typeof ViewModule
before(async () => {
  files = await import('../src/renderer/src/app/files.ts')
  model = await import('../src/renderer/src/app/model.ts')
  view = await import('../src/renderer/src/app/view.ts')
})

const noDocs = (): DocumentActions => ({}) as DocumentActions

describe('opening a folder never clobbers unsaved edits', () => {
  it('keeps edits when the open folder is opened again, and flags the disk change', async () => {
    // Arrange: a.md has unsaved edits, and its disk text changed meanwhile.
    const scan = scanOf('/w', { '/w/a.md': 'disk new', '/w/b.md': 'B2' })
    const fake = await fakeHost({
      root: '/w',
      tree: scan.tree,
      contents: { '/w/a.md': 'mine', '/w/b.md': 'B' },
      saved: { '/w/a.md': 'old', '/w/b.md': 'B' },
      openTabs: ['/w/a.md'],
      activeId: '/w/a.md'
    })
    stubApi({ openRecentFolder: async () => scan, getSettings: async () => ({ recentFolders: ['/w'] }) as never })
    const actions = files.createFileActions(fake.host, noDocs)

    // Act
    await actions.openRecentFolder('/w')

    // Assert
    const s = fake.state()
    assert.equal(s.contents['/w/a.md'], 'mine')
    assert.equal(s.saved['/w/a.md'], 'old')
    assert.equal(s.externalChanges['/w/a.md'], true)
    assert.equal(s.contents['/w/b.md'], 'B2')
    assert.ok(s.openTabs.includes('/w/a.md'))
    assert.match(fake.toasts.at(-1) ?? '', /unsaved edits in a\.md were kept/)
  })

  it('keeps dirty tabs from the previous folder open when switching folders', async () => {
    const fake = await fakeHost({
      root: '/old',
      contents: { '/old/x.md': 'edited', 'untitled:1': 'draft' },
      saved: { '/old/x.md': 'x', 'untitled:1': '' },
      openTabs: ['/old/x.md', 'untitled:1'],
      activeId: '/old/x.md'
    })
    stubApi({
      openRecentFolder: async () => scanOf('/new', { '/new/n.md': 'N' }),
      getSettings: async () => ({}) as never
    })
    const actions = files.createFileActions(fake.host, noDocs)

    await actions.openRecentFolder('/new')

    const s = fake.state()
    assert.deepEqual(s.openTabs, ['/new/n.md', '/old/x.md', 'untitled:1'])
    assert.equal(s.contents['/old/x.md'], 'edited')
    assert.equal(s.activeId, '/new/n.md')
  })

  it('says clearly when a recent folder is gone', async () => {
    const fake = await fakeHost()
    stubApi({ openRecentFolder: async () => null })
    await files.createFileActions(fake.host, noDocs).openRecentFolder('/gone/notes')
    assert.match(fake.toasts[0], /Couldn't open notes/)
  })
})

describe('inline rename', () => {
  const agentDir = '/w/Agent'
  const agents = file(agentDir, 'AGENTS.md')
  const tree = [{ id: agentDir, name: 'Agent', path: agentDir, files: [agents] }]

  it('expands a collapsed folder so the rename field can appear', async () => {
    const fake = await fakeHost({ root: '/w', tree, expanded: { [agentDir]: false } })

    files.createFileActions(fake.host, noDocs).startRename(agents.path, false)

    const s = fake.state()
    assert.deepEqual(s.renaming, { path: agents.path, isFolder: false })
    assert.equal(s.expanded[agentDir], true)
    assert.equal(s.dialog, null)
  })

  it('uses the name dialog when the file tree is hidden', async () => {
    const fake = await fakeHost({ root: '/w', tree, sidebarOpen: false })

    files.createFileActions(fake.host, noDocs).startRename(agents.path, false)

    assert.equal(fake.state().renaming, null)
    assert.deepEqual(fake.state().dialog, { kind: 'rename', path: agents.path, isFolder: false })
  })

  it('moves unsaved edits, tabs and pins to the new path', async () => {
    const from = '/w/Agent/notes.md'
    const to = '/w/Agent/ideas.md'
    const fake = await fakeHost({
      root: '/w',
      tree: [{ ...tree[0], files: [file(agentDir, 'notes.md')] }],
      contents: { [from]: 'edited' },
      saved: { [from]: 'old' },
      openTabs: [from],
      activeId: from,
      pinned: [from],
      renaming: { path: from, isFolder: false }
    })
    stubApi({ renamePath: async () => to, scanFolder: async () => null as never })

    await files.createFileActions(fake.host, noDocs).commitRename(from, 'ideas', false)

    const s = fake.state()
    assert.equal(s.contents[to], 'edited')
    assert.equal(s.saved[to], 'old')
    assert.deepEqual(s.openTabs, [to])
    assert.deepEqual(s.pinned, [to])
    assert.equal(s.renaming, null)
  })

  it('validates names live, including clashes with files already there', async () => {
    const fake = await fakeHost({ root: '/w', tree: [{ ...tree[0], files: [agents, file(agentDir, 'b.md')] }] })
    const actions = files.createFileActions(fake.host, noDocs)

    assert.match(actions.validateName(agents.path, 'b', false) ?? '', /already a file named b\.md/)
    assert.equal(actions.validateName(agents.path, 'AGENTS', false), null)
  })
})

describe('scan helpers', () => {
  it('mergeScanDocs reloads clean files and flags dirty ones that changed on disk', () => {
    const merged = model.mergeScanDocs(
      { contents: { a: 'mine', b: 'B', c: 'C' }, saved: { a: 'old', b: 'B', c: 'C' }, externalChanges: { b: true } },
      { contents: { a: 'disk', b: 'B2', c: 'C' } }
    )

    assert.deepEqual(merged.contents, { a: 'mine', b: 'B2', c: 'C' })
    assert.deepEqual(merged.conflicts, ['a'])
    assert.deepEqual(merged.reloaded, ['b'])
    assert.deepEqual(merged.externalChanges, { a: true })
  })

  it('tabsToCarry keeps untitled and unsaved tabs only', () => {
    const carry = model.tabsToCarry({
      openTabs: ['/a.md', '/b.md', 'untitled:2'],
      contents: { '/a.md': 'x', '/b.md': 'edited', 'untitled:2': '' },
      saved: { '/a.md': 'x', '/b.md': 'b', 'untitled:2': '' }
    })

    assert.deepEqual(carry, ['/b.md', 'untitled:2'])
  })

  it('labels new nested folders with Windows paths', () => {
    const tree = view.buildTree(
      {
        tree: [],
        looseFiles: [],
        expanded: {},
        pinned: [],
        activeId: null,
        newPaths: {},
        root: 'C:\\w',
        emptyFolders: ['C:\\w\\sub\\New folder']
      },
      () => false
    )

    assert.equal(view.folderLabel('C:\\w\\sub\\New folder', 'C:\\w'), 'sub  /  New folder')
    assert.equal(view.folderLabel('/w/sub/New folder', '/w'), 'sub  /  New folder')
    assert.equal(tree.folders[0].name, 'sub  /  New folder')
  })
})
