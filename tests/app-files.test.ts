import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { Window } from 'happy-dom'
import './support/aliases.ts'
import { fakeHost, scanOf, stubApi } from './support/fakeHost.ts'
import type { DocumentActions } from '../src/renderer/src/app/documents.ts'
import type { DiskReload } from '../src/renderer/src/app/host.ts'
import type * as FilesModule from '../src/renderer/src/app/files.ts'
import type * as DocumentsModule from '../src/renderer/src/app/documents.ts'

// Folder rescans while something else (an agent) writes files: background reloads
// stay quiet, open documents report their reloads, and only news gets a toast.
const win = new Window()
Object.assign(globalThis, { document: win.document, CSS: win.CSS })

let files: typeof FilesModule
let docs: typeof DocumentsModule
before(async () => {
  files = await import('../src/renderer/src/app/files.ts')
  docs = await import('../src/renderer/src/app/documents.ts')
})

const noDocs = (): DocumentActions => ({}) as DocumentActions
const workspace = { '/w/a.md': 'A', '/w/b.md': 'B', '/w/c.md': 'C' }

async function rescanned(over: Parameters<typeof fakeHost>[0], disk: Record<string, string>) {
  const fake = await fakeHost({ root: '/w', tree: scanOf('/w', workspace).tree, ...over })
  stubApi({ scanFolder: async () => scanOf('/w', disk) })
  const reloads: DiskReload[][] = []
  let applied = 0
  const actions = files.createFileActions(fake.host, noDocs, {
    onReload: (r) => {
      reloads.push([...r])
      return () => void applied++
    }
  })
  await actions.reconcileFolder()
  return { fake, reloads, applied: () => applied }
}

describe('rescans while an agent writes', () => {
  it('reloads a file nobody has open without a toast', async () => {
    const { fake } = await rescanned(
      { contents: { ...workspace }, saved: { ...workspace }, openTabs: ['/w/a.md'], activeId: '/w/a.md' },
      { ...workspace, '/w/b.md': 'B2' }
    )

    assert.equal(fake.state().contents['/w/b.md'], 'B2')
    assert.deepEqual(fake.toasts, [])
  })

  it('tells the App about each clean reload, before and after, then runs its callback', async () => {
    const { reloads, applied } = await rescanned(
      { contents: { ...workspace }, saved: { ...workspace }, openTabs: ['/w/a.md'], activeId: '/w/a.md' },
      { ...workspace, '/w/a.md': 'A2' }
    )

    assert.deepEqual(reloads, [[{ id: '/w/a.md', before: 'A', after: 'A2' }]])
    assert.equal(applied(), 1)
  })

  it('does not report unsaved documents as reloads', async () => {
    const { reloads, fake } = await rescanned(
      {
        contents: { ...workspace, '/w/a.md': 'mine' },
        saved: { ...workspace },
        openTabs: ['/w/a.md'],
        activeId: '/w/a.md'
      },
      { ...workspace, '/w/a.md': 'A2' }
    )

    assert.deepEqual(reloads, [])
    assert.equal(fake.state().externalChanges['/w/a.md'], true)
    // The active document shows the conflict bar instead of a toast.
    assert.deepEqual(fake.toasts, [])
  })

  it('names an unsaved background tab whose file changed on disk', async () => {
    const { fake } = await rescanned(
      {
        contents: { ...workspace, '/w/b.md': 'mine' },
        saved: { ...workspace },
        openTabs: ['/w/a.md', '/w/b.md'],
        activeId: '/w/a.md'
      },
      { ...workspace, '/w/b.md': 'B2' }
    )

    assert.match(fake.toasts[0], /^b\.md changed on disk while you had unsaved edits/)
  })

  it('mentions a removed file only when its tab had to close', async () => {
    const quiet = await rescanned(
      { contents: { ...workspace }, saved: { ...workspace }, openTabs: ['/w/a.md'], activeId: '/w/a.md' },
      { '/w/a.md': 'A', '/w/b.md': 'B' }
    )
    const closed = await rescanned(
      { contents: { ...workspace }, saved: { ...workspace }, openTabs: ['/w/a.md', '/w/c.md'], activeId: '/w/a.md' },
      { '/w/a.md': 'A', '/w/b.md': 'B' }
    )

    assert.deepEqual(quiet.fake.toasts, [])
    assert.equal(closed.fake.toasts[0], 'c.md was deleted or moved on disk, so its tab closed.')
  })
})

describe('Reload from disk', () => {
  it('reports a clean reload so changes can be shown, and says when nothing changed', async () => {
    const fake = await fakeHost({ contents: { '/a.md': 'old' }, saved: { '/a.md': 'old' }, activeId: '/a.md' })
    const reloads: DiskReload[][] = []
    let disk = 'new'
    stubApi({ readFile: async () => disk })
    const actions = docs.createDocumentActions(fake.host, {
      rescan: () => undefined,
      onReload: (r) => {
        reloads.push([...r])
        return () => undefined
      }
    })

    await actions.reloadFromDisk('/a.md')
    disk = 'new'
    await actions.reloadFromDisk('/a.md')

    assert.deepEqual(reloads[0], [{ id: '/a.md', before: 'old', after: 'new' }])
    assert.equal(fake.state().contents['/a.md'], 'new')
    assert.equal(fake.toasts.at(-1), 'a.md is already up to date')
  })
})

describe('new file in a folder', () => {
  it('opens the new file with its name ready to edit inline in the tree', async () => {
    const fake = await fakeHost({ root: '/w', tree: scanOf('/w', { '/w/a.md': 'A' }).tree, activity: 'files', sidebarOpen: true })
    stubApi({ createFile: async (dir: string, name: string) => ({ path: `${dir}/${name}`, content: '' }) })
    let docsApi: DocumentActions | null = null
    const actions = files.createFileActions(fake.host, () => docsApi as DocumentActions)
    docsApi = docs.createDocumentActions(fake.host, { rescan: () => undefined })

    await actions.newFileIn('/w')

    assert.deepEqual(fake.state().renaming, { path: '/w/Untitled.md', isFolder: false })
    assert.equal(fake.state().dialog, null)
    assert.equal(fake.state().viewMode, 'edit')
  })
})
