import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { registerHooks } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, beforeEach, describe, it } from 'node:test'
import type { Settings } from '../src/shared/types.ts'

// workspace-ops and grant-store import their sibling modules without a file
// extension (as the bundler expects). Node's strip-types loader needs the
// ".ts", so add it for relative imports that fail to resolve, then load the
// modules under test dynamically, after the hook is in place.
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

const access = await import('../src/main/access.ts')
const grants = await import('../src/main/grant-store.ts')
const ops = await import('../src/main/workspace-ops.ts')
const recovery = await import('../src/main/recovery-store.ts')
const fsMd = await import('../src/main/fs-md.ts')

type Store = import('../src/main/grant-store.ts').SettingsStore & { saved: Partial<Settings>[] }

/** An in-memory settings file: `save` merges like the real one and records each write. */
function memoryStore(initial: Partial<Settings> = {}): Store {
  let current = { ...initial } as Settings
  const saved: Partial<Settings>[] = []
  return {
    saved,
    load: async () => current,
    save: async (partial) => {
      saved.push(partial)
      current = { ...current, ...partial }
      return current
    }
  }
}

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])

let base: string
let root: string
let loose: string
let counter = 0

before(async () => {
  base = await mkdtemp(join(tmpdir(), 'simplemd-workspace-'))
})

after(async () => {
  await rm(base, { recursive: true, force: true })
})

// A fresh workspace folder and loose-files folder per test, and no grants.
beforeEach(async () => {
  access.resetAccess()
  const caseDir = join(base, `case-${++counter}`)
  root = join(caseDir, 'workspace')
  loose = join(caseDir, 'loose')
  await mkdir(join(root, 'notes'), { recursive: true })
  await mkdir(loose)
})

describe('createFileIn / createFolderIn', () => {
  it('creates inside an approved workspace folder', async () => {
    access.approveRoot(root)
    const file = await ops.createFileIn(join(root, 'notes'), 'Ideas', '# Ideas')
    assert.deepEqual(file, { path: join(root, 'notes', 'Ideas.md'), content: '# Ideas' })
    assert.equal(await ops.createFolderIn(root, 'Drafts'), join(root, 'Drafts'))
  })

  it('refuses the folder of a loose file and anything outside a workspace', async () => {
    const doc = join(loose, 'doc.md')
    await writeFile(doc, 'x')
    access.approveFile(doc)
    await assert.rejects(ops.createFileIn(loose, 'next', ''), /Access denied/)
    await assert.rejects(ops.createFolderIn(loose, 'sub'), /Access denied/)
    assert.deepEqual(await readdir(loose), ['doc.md'])
  })

  it('refuses a workspace folder that no longer exists, and non-text content', async () => {
    access.approveRoot(root)
    await assert.rejects(ops.createFileIn(join(root, 'gone'), 'a', ''), /no longer exists/)
    await assert.rejects(ops.createFileIn(root, 'a', 42), /Invalid content/)
  })
})

describe('renameApproved', () => {
  it('refuses to rename an open workspace folder or a folder holding one', async () => {
    const store = memoryStore()
    access.approveRoot(join(root, 'notes'))
    await assert.rejects(ops.renameApproved(store, join(root, 'notes'), 'other'), /open in SimpleMD/)
    access.approveRoot(root)
    await assert.rejects(ops.renameApproved(store, root, 'other'), /open in SimpleMD/)
    assert.deepEqual(await readdir(root), ['notes'])
  })

  it('refuses a folder outside every workspace, even if it was granted like a file', async () => {
    const folder = join(loose, 'folder')
    await mkdir(folder)
    access.approveFile(folder)
    await assert.rejects(ops.renameApproved(memoryStore(), folder, 'moved'), /Access denied/)
  })

  it('refuses paths that were never opened', async () => {
    const doc = join(loose, 'private.md')
    await writeFile(doc, 'x')
    await assert.rejects(ops.renameApproved(memoryStore(), doc, 'public'), /Access denied/)
  })

  it('moves a loose file’s grant, in memory and in settings, to the new name', async () => {
    const doc = join(loose, 'draft.md')
    await writeFile(doc, 'x')
    const store = memoryStore()
    await grants.persistFileGrants(store, [doc])
    const next = await ops.renameApproved(store, doc, 'Version 1.2')
    assert.equal(next, join(loose, 'Version 1.2.md'))
    assert.equal(access.isApproved(next), true)
    assert.equal(access.isApproved(doc), false)
    assert.deepEqual((await store.load()).approvedFiles, [next])
  })

  it('renames a folder inside a workspace and carries the grants below it', async () => {
    access.approveRoot(root)
    const inner = join(root, 'notes', 'a.md')
    await writeFile(inner, 'a')
    const store = memoryStore({ approvedFiles: [inner] })
    access.approveFile(inner)
    const next = await ops.renameApproved(store, join(root, 'notes'), 'Journal')
    assert.equal(next, join(root, 'Journal'))
    assert.deepEqual((await store.load()).approvedFiles, [join(root, 'Journal', 'a.md')])
  })
})

describe('duplicateApproved', () => {
  it('grants and persists the copy of a loose file', async () => {
    const doc = join(loose, 'plan.md')
    await writeFile(doc, '# Plan')
    const store = memoryStore()
    access.approveFile(doc)
    const copy = await ops.duplicateApproved(store, doc)
    assert.deepEqual(copy, { path: join(loose, 'plan copy.md'), content: '# Plan' })
    assert.equal(access.isApprovedFile(copy.path), true)
    assert.deepEqual((await store.load()).approvedFiles, [copy.path])
  })

  it('needs no extra grant for a copy inside a workspace', async () => {
    access.approveRoot(root)
    await writeFile(join(root, 'a.md'), 'a')
    const store = memoryStore()
    const copy = await ops.duplicateApproved(store, join(root, 'a.md'))
    assert.equal(copy.path, join(root, 'a copy.md'))
    assert.deepEqual(store.saved, [])
  })

  it('refuses files that were never opened', async () => {
    await writeFile(join(loose, 'x.md'), 'x')
    await assert.rejects(ops.duplicateApproved(memoryStore(), join(loose, 'x.md')), /Access denied/)
    assert.deepEqual(await readdir(loose), ['x.md'])
  })
})

describe('writeImageAsset', () => {
  it('saves next to an approved document', async () => {
    const doc = join(loose, 'doc.md')
    await writeFile(doc, 'x')
    access.approveFile(doc)
    assert.equal(await ops.writeImageAsset(doc, 'Shot.png', PNG), 'assets/shot.png')
    assert.deepEqual(await readFile(join(loose, 'assets', 'shot.png')), Buffer.from(PNG))
  })

  it('refuses unapproved documents and folders', async () => {
    const doc = join(loose, 'doc.md')
    await writeFile(doc, 'x')
    await assert.rejects(ops.writeImageAsset(doc, 'a.png', PNG), /Access denied/)
    access.approveRoot(root)
    await assert.rejects(ops.writeImageAsset(root, 'a.png', PNG), /Access denied/)
  })

  it('explains a document that is gone from disk without leaking the raw error', async () => {
    const doc = join(loose, 'deleted.md')
    access.approveFile(doc)
    await assert.rejects(ops.writeImageAsset(doc, 'a.png', PNG), (err: Error) => {
      assert.match(err.message, /no longer exists on disk/)
      assert.doesNotMatch(err.message, /ENOENT/)
      return true
    })
  })
})

describe('openRecentFolder', () => {
  it('grants, rescans and moves an exact recent entry to the top', async () => {
    const other = join(loose, 'Other')
    await mkdir(other)
    const store = memoryStore({ recentFolders: [other, root] })
    const scan = await ops.openRecentFolder(store, root)
    assert.equal(scan?.root, root)
    assert.equal(access.isApprovedRoot(root), true)
    const settings = await store.load()
    assert.equal(settings.lastFolder, root)
    assert.deepEqual(settings.recentFolders, [root, other])
  })

  it('refuses anything that is not an exact entry of the list', async () => {
    const store = memoryStore({ recentFolders: [root] })
    assert.equal(await ops.openRecentFolder(store, join(root, 'notes')), null)
    assert.equal(await ops.openRecentFolder(store, `${root}/`), null)
    assert.equal(await ops.openRecentFolder(store, 42), null)
    assert.equal(access.isApproved(join(root, 'notes')), false)
  })

  it('drops a folder that no longer exists', async () => {
    const gone = join(loose, 'gone')
    const store = memoryStore({ recentFolders: [gone, root] })
    assert.equal(await ops.openRecentFolder(store, gone), null)
    assert.deepEqual((await store.load()).recentFolders, [root])
    assert.equal(access.isApproved(gone), false)
  })
})

describe('grant-store', () => {
  it('forgets a trashed file in memory and in settings, whatever its spelling', async () => {
    const doc = join(loose, 'a.md')
    await writeFile(doc, 'a')
    const spelled = process.platform === 'win32' ? doc.toUpperCase() : doc
    const store = memoryStore({ approvedFiles: [spelled, join(loose, 'b.md')] })
    access.approveFile(doc)
    await rm(doc)
    await grants.forgetGrantsUnder(store, doc)
    assert.equal(access.isApproved(doc), false)
    assert.deepEqual((await store.load()).approvedFiles, [join(loose, 'b.md')])
  })

  it('forgets every grant under a trashed folder', async () => {
    const folder = join(loose, 'project')
    await mkdir(folder)
    const a = join(folder, 'a.md')
    const outsideIt = join(loose, 'keep.md')
    access.approveFile(a)
    access.approveFile(outsideIt)
    const store = memoryStore({ approvedFiles: [a, outsideIt] })
    await grants.forgetGrantsUnder(store, folder)
    assert.equal(access.isApproved(a), false)
    assert.equal(access.isApproved(outsideIt), true)
    assert.deepEqual((await store.load()).approvedFiles, [outsideIt])
  })

  it('records a granted root as the last and most recent folder', async () => {
    const store = memoryStore({ recentFolders: [loose] })
    await grants.persistRootGrant(store, root)
    const settings = await store.load()
    assert.equal(settings.lastFolder, root)
    assert.deepEqual(settings.recentFolders, [root, loose])
  })

  it('restores persisted grants and migrates old settings once', async () => {
    const doc = join(loose, 'old.md')
    const store = memoryStore({ lastFolder: root, looseFiles: [doc] })
    await grants.restoreGrants(store)
    assert.equal(access.isApprovedRoot(root), true)
    assert.equal(access.isApprovedFile(doc), true)
    assert.deepEqual(store.saved, [{ approvedFiles: [doc], recentFolders: [root] }])
  })

  it('does not write settings when a rename touches no grant', async () => {
    const store = memoryStore({ approvedFiles: [join(loose, 'x.md')] })
    await grants.moveGrants(store, join(root, 'a.md'), join(root, 'b.md'))
    assert.deepEqual(store.saved, [])
  })
})

describe('recoveryLoader', () => {
  it('re-grants every stored path on the first load only', async () => {
    const dir = join(loose, 'recovery')
    const kept = join(loose, 'kept.md')
    const gone = join(loose, 'gone.md')
    await writeFile(kept, 'saved')
    const entry = (path: string) => ({ id: path, path, title: 'x.md', content: 'unsaved', savedAt: 1 })
    await recovery.saveRecovery(dir, [entry(kept), entry(gone)], () => true)
    const load = ops.recoveryLoader(() => dir)

    const first = await load()
    assert.equal(first.length, 2)
    assert.equal(access.isApprovedFile(kept), true)
    assert.equal(access.isApprovedFile(gone), true)

    // Revoked during the session (trashed, renamed away): a later load can't undo that.
    access.revokeFile(kept)
    await load()
    assert.equal(access.isApprovedFile(kept), false)
  })

  it('lets a recovered file that was deleted on disk be saved back where it was', async () => {
    const dir = join(loose, 'recovery-deleted')
    const deleted = join(loose, 'deleted.md')
    await writeFile(deleted, 'before the crash')
    const entry = { id: deleted, path: deleted, title: 'deleted.md', content: 'unsaved', savedAt: 1 }
    await recovery.saveRecovery(dir, [entry], () => true)
    await rm(deleted)

    const [restored] = await ops.recoveryLoader(() => dir)()
    assert.equal(restored.path, deleted)
    assert.equal(access.isApproved(deleted), true)
    await fsMd.saveMdFile(deleted, restored.content)
    assert.equal(await readFile(deleted, 'utf8'), 'unsaved')
  })
})
