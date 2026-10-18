import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import './support/aliases.ts'
import { fakeHost, stubApi } from './support/fakeHost.ts'
import type * as DocumentsModule from '../src/renderer/src/app/documents.ts'

// Document flows (new, paste, save, save as, close with the unsaved prompt)
// through createDocumentActions with a fake App host and a stubbed window.api.
let docs: typeof DocumentsModule
before(async () => {
  docs = await import('../src/renderer/src/app/documents.ts')
})

const noRescan = { rescan: () => undefined }

describe('new documents and Paste from AI', () => {
  it('opens a new untitled tab right after the active one', async () => {
    const fake = await fakeHost({ openTabs: ['/a.md', '/b.md'], activeId: '/a.md', contents: { '/a.md': '' } })

    const id = docs.createDocumentActions(fake.host, noRescan).newDocument()

    assert.equal(id, 'untitled:1')
    assert.deepEqual(fake.state().openTabs, ['/a.md', 'untitled:1', '/b.md'])
    assert.equal(fake.state().activeId, 'untitled:1')
    assert.equal(fake.state().viewMode, 'edit')
  })

  it('pastes the clipboard as a new document in Read view', async () => {
    const fake = await fakeHost()
    stubApi({ readClipboardText: async () => '# Answer\r\n\r\nText' })

    await docs.createDocumentActions(fake.host, noRescan).pasteFromAi()

    const s = fake.state()
    assert.equal(s.activeId, 'untitled:1')
    assert.equal(s.viewMode, 'read')
    assert.match(s.contents['untitled:1'], /# Answer/)
  })

  it('explains an empty clipboard instead of opening a blank tab', async () => {
    const fake = await fakeHost()
    stubApi({ readClipboardText: async () => '   ' })

    await docs.createDocumentActions(fake.host, noRescan).pasteFromAi()

    assert.deepEqual(fake.state().openTabs, [])
    assert.match(fake.toasts[0], /clipboard is empty/)
  })
})

describe('saving', () => {
  it('saves an untitled document through Save as and converts the tab in place', async () => {
    const fake = await fakeHost({
      openTabs: ['/a.md', 'untitled:1'],
      activeId: 'untitled:1',
      contents: { '/a.md': 'A', 'untitled:1': '# Plan' },
      saved: { '/a.md': 'A', 'untitled:1': '' }
    })
    let suggested = ''
    stubApi({
      saveAs: async (name) => {
        suggested = name
        return '/notes/Plan.md'
      }
    })

    const id = await docs.createDocumentActions(fake.host, noRescan).save()

    const s = fake.state()
    assert.equal(id, '/notes/Plan.md')
    assert.match(suggested, /\.md$/)
    assert.deepEqual(s.openTabs, ['/a.md', '/notes/Plan.md'])
    assert.equal(s.activeId, '/notes/Plan.md')
    assert.equal(s.saved['/notes/Plan.md'], '# Plan')
    assert.equal(s.contents['untitled:1'], undefined)
  })

  it('reports a failed save with the reason and keeps the edits', async () => {
    const fake = await fakeHost({
      openTabs: ['/a.md'],
      activeId: '/a.md',
      contents: { '/a.md': 'new' },
      saved: { '/a.md': 'old' }
    })
    stubApi({
      saveFile: async () => {
        throw new Error("Error invoking remote method 'save': Error: EACCES")
      }
    })

    const id = await docs.createDocumentActions(fake.host, noRescan).save('/a.md')

    assert.equal(id, null)
    assert.equal(fake.state().saved['/a.md'], 'old')
    assert.match(fake.toasts[0], /Couldn't save a\.md \(EACCES\)/)
  })

  it('Save all saves every unsaved document and says how many', async () => {
    const fake = await fakeHost({
      contents: { '/a.md': 'A2', '/b.md': 'B2', '/c.md': 'C' },
      saved: { '/a.md': 'A', '/b.md': 'B', '/c.md': 'C' }
    })
    const written: string[] = []
    stubApi({
      saveFile: async (path) => {
        written.push(path)
        return true
      }
    })

    const ok = await docs.createDocumentActions(fake.host, noRescan).saveAll()

    assert.equal(ok, true)
    assert.deepEqual(written, ['/a.md', '/b.md'])
    assert.equal(fake.toasts[0], 'Saved 2 documents')
  })
})

describe('closing with unsaved changes', () => {
  const dirty = {
    openTabs: ['/a.md', 'untitled:1'],
    activeId: '/a.md',
    contents: { '/a.md': 'edited', 'untitled:1': 'draft' },
    saved: { '/a.md': 'old', 'untitled:1': '' }
  }

  it('asks before closing a dirty tab and closes a clean one right away', async () => {
    const fake = await fakeHost({
      ...dirty,
      openTabs: ['/a.md', '/c.md'],
      contents: { ...dirty.contents, '/c.md': 'c' },
      saved: { ...dirty.saved, '/c.md': 'c' }
    })
    const actions = docs.createDocumentActions(fake.host, noRescan)

    actions.requestClose(['/c.md'])
    actions.requestClose(['/a.md'])

    assert.deepEqual(fake.state().openTabs, ['/a.md'])
    assert.deepEqual(fake.state().dialog, { kind: 'unsaved', ids: ['/a.md'] })
  })

  it('Cancel keeps everything open', async () => {
    const fake = await fakeHost({ ...dirty, dialog: { kind: 'unsaved', ids: ['/a.md', 'untitled:1'] } })

    await docs.createDocumentActions(fake.host, noRescan).resolveUnsaved('cancel')

    assert.deepEqual(fake.state().openTabs, dirty.openTabs)
    assert.equal(fake.state().contents['/a.md'], 'edited')
    assert.equal(fake.state().dialog, null)
  })

  it("Don't save closes the tabs, reverts the file and drops the untitled buffer", async () => {
    const fake = await fakeHost({ ...dirty, dialog: { kind: 'unsaved', ids: ['/a.md', 'untitled:1'] } })

    await docs.createDocumentActions(fake.host, noRescan).resolveUnsaved('discard')

    const s = fake.state()
    assert.deepEqual(s.openTabs, [])
    assert.equal(s.contents['/a.md'], 'old')
    assert.equal(s.contents['untitled:1'], undefined)
    assert.deepEqual(s.closed.map((c) => c.id), ['/a.md'])
  })

  it('Save saves (untitled through Save as) and keeps a tab open when its save is cancelled', async () => {
    const fake = await fakeHost({ ...dirty, dialog: { kind: 'unsaved', ids: ['/a.md', 'untitled:1'] } })
    stubApi({ saveFile: async () => true, saveAs: async () => null })

    await docs.createDocumentActions(fake.host, noRescan).resolveUnsaved('save')

    const s = fake.state()
    assert.equal(s.saved['/a.md'], 'edited')
    assert.deepEqual(s.openTabs, ['untitled:1'])
    assert.equal(s.contents['untitled:1'], 'draft')
  })
})

describe('tabs', () => {
  it('reopens the last closed tab at its old position', async () => {
    const fake = await fakeHost({
      openTabs: ['/a.md', '/c.md'],
      activeId: '/a.md',
      contents: { '/a.md': '', '/b.md': '', '/c.md': '' },
      saved: { '/a.md': '', '/b.md': '', '/c.md': '' },
      closed: [{ id: '/b.md', index: 1 }]
    })

    await docs.createDocumentActions(fake.host, noRescan).reopenClosed()

    assert.deepEqual(fake.state().openTabs, ['/a.md', '/b.md', '/c.md'])
    assert.equal(fake.state().activeId, '/b.md')
    assert.deepEqual(fake.state().closed, [])
  })

  it('cycles to the next tab and wraps around', async () => {
    const fake = await fakeHost({ openTabs: ['/a.md', '/b.md'], activeId: '/b.md' })

    docs.createDocumentActions(fake.host, noRescan).cycle(1)

    assert.equal(fake.state().activeId, '/a.md')
  })
})
