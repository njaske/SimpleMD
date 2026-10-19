import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, beforeEach, describe, it } from 'node:test'
import {
  approveFile,
  approveRoot,
  containsApprovedRoot,
  grantKey,
  isApproved,
  isApprovedFile,
  isApprovedRoot,
  isInsideApprovedRoot,
  moveFileGrants,
  resetAccess,
  revokeFile
} from '../src/main/access.ts'
import { addRecentFolder, isRecentFolder, removeRecentFolder, MAX_RECENT_FOLDERS } from '../src/main/recent-folders.ts'
import { pickRendererSettings } from '../src/main/settings-schema.ts'

const symlinkDirType = process.platform === 'win32' ? 'junction' : 'dir'

let base: string
let workspace: string
let outside: string

before(async () => {
  base = await mkdtemp(join(tmpdir(), 'simplemd-access2-'))
  workspace = join(base, 'workspace')
  outside = join(base, 'outside')
  await mkdir(join(workspace, 'sub'), { recursive: true })
  await mkdir(join(workspace, '..notes'))
  await mkdir(outside)
  await writeFile(join(outside, 'secret.md'), '# secret')
  await symlink(outside, join(workspace, 'link'), symlinkDirType)
})

after(async () => {
  await rm(base, { recursive: true, force: true })
})

beforeEach(() => resetAccess())

describe('isInsideApprovedRoot', () => {
  it('accepts a root and folders inside it, including ones not created yet', () => {
    approveRoot(workspace)
    assert.equal(isInsideApprovedRoot(workspace), true)
    assert.equal(isInsideApprovedRoot(join(workspace, 'sub')), true)
    assert.equal(isInsideApprovedRoot(join(workspace, 'sub', 'new.md')), true)
  })

  it('does not count individually approved files', () => {
    approveFile(join(outside, 'secret.md'))
    assert.equal(isInsideApprovedRoot(join(outside, 'secret.md')), false)
    assert.equal(isInsideApprovedRoot(outside), false)
  })

  it('rejects ../ escapes and symlinks that lead out of the root', () => {
    approveRoot(workspace)
    assert.equal(isInsideApprovedRoot(join(workspace, '..', 'outside')), false)
    assert.equal(isInsideApprovedRoot(join(workspace, 'link')), false)
    assert.equal(isApproved(join(workspace, 'link', 'secret.md')), false)
  })

  it('treats a folder whose name starts with two dots as inside', () => {
    approveRoot(workspace)
    assert.equal(isInsideApprovedRoot(join(workspace, '..notes')), true)
  })
})

describe('containsApprovedRoot', () => {
  it('is true for the root and its ancestors, false for folders inside it', () => {
    approveRoot(join(workspace, 'sub'))
    assert.equal(containsApprovedRoot(join(workspace, 'sub')), true)
    assert.equal(containsApprovedRoot(workspace), true)
    assert.equal(containsApprovedRoot(outside), false)
    assert.equal(containsApprovedRoot('relative'), false)
  })

  it('forgets a subfolder root once its parent is opened, keeping its access', () => {
    approveRoot(join(workspace, 'sub'))
    approveRoot(workspace)
    assert.equal(containsApprovedRoot(join(workspace, 'sub')), false)
    assert.equal(isApprovedRoot(join(workspace, 'sub')), false)
    assert.equal(isApproved(join(workspace, 'sub', 'a.md')), true)
    assert.equal(containsApprovedRoot(workspace), true)
  })

  it('keeps earlier roots elsewhere, so their open documents still save', () => {
    approveRoot(outside)
    approveRoot(workspace)
    assert.equal(isApproved(join(outside, 'secret.md')), true)
    assert.equal(isApprovedRoot(outside), true)
  })

  it('keeps a parent root when a subfolder is opened after it', () => {
    approveRoot(workspace)
    approveRoot(join(workspace, 'sub'))
    assert.equal(isApprovedRoot(workspace), true)
    assert.equal(isApprovedRoot(join(workspace, 'sub')), true)
  })
})

describe('revokeFile / moveFileGrants', () => {
  it('revokes a single file grant', () => {
    const file = join(outside, 'secret.md')
    approveFile(file)
    revokeFile(file)
    assert.equal(isApproved(file), false)
  })

  it('moves a renamed file’s grant to its new path', async () => {
    const from = join(outside, 'loose.md')
    const to = join(outside, 'renamed.md')
    await writeFile(from, 'x')
    approveFile(from)
    await rename(from, to)
    assert.equal(moveFileGrants(from, to), 1)
    assert.equal(isApprovedFile(to), true)
    assert.equal(isApproved(from), false)
  })

  it('moves grants of files under a renamed folder', async () => {
    const folder = join(base, 'loose-folder')
    await mkdir(folder)
    await writeFile(join(folder, 'a.md'), 'a')
    approveFile(join(folder, 'a.md'))
    await rename(folder, join(base, 'moved-folder'))
    assert.equal(moveFileGrants(folder, join(base, 'moved-folder')), 1)
    assert.equal(isApproved(join(base, 'moved-folder', 'a.md')), true)
    assert.equal(isApproved(join(folder, 'a.md')), false)
  })

  it('moves a grant by the key taken before the rename', async () => {
    const from = join(outside, 'before.md')
    const to = join(outside, 'after.md')
    await writeFile(from, 'x')
    approveFile(from)
    const fromKey = grantKey(from)
    await rename(from, to)
    // On a case-insensitive macOS disk `from` would now resolve to `to`; the
    // key taken earlier still names the stored grant.
    assert.equal(moveFileGrants(join(outside, 'unrelated.md'), to, fromKey), 1)
    assert.equal(isApprovedFile(to), true)
    assert.equal(isApprovedFile(from), false)
  })

  it('moves nothing for unrelated paths', () => {
    approveFile(join(outside, 'secret.md'))
    assert.equal(moveFileGrants(join(base, 'nothing'), join(base, 'else')), 0)
    assert.equal(isApproved(join(outside, 'secret.md')), true)
  })
})

describe('recent folders', () => {
  it('puts the newest folder first without duplicates', () => {
    const list = addRecentFolder(['/a', '/b', '/c'], '/b', false)
    assert.deepEqual(list, ['/b', '/a', '/c'])
  })

  it('dedupes case-insensitively when asked (Windows)', () => {
    assert.deepEqual(addRecentFolder(['C:\\Notes', 'D:\\x'], 'c:\\notes', true), ['c:\\notes', 'D:\\x'])
    assert.deepEqual(addRecentFolder(['/Notes'], '/notes', false), ['/notes', '/Notes'])
  })

  it('keeps at most 10 and ignores junk entries', () => {
    const many = Array.from({ length: 15 }, (_, i) => `/f${i}`)
    const list = addRecentFolder([...many, 3, null], '/new', false)
    assert.equal(list.length, MAX_RECENT_FOLDERS)
    assert.equal(list[0], '/new')
    assert.equal(addRecentFolder(undefined, '/x', false).length, 1)
  })

  it('does not mutate the input list', () => {
    const input = ['/a']
    addRecentFolder(input, '/b', false)
    assert.deepEqual(input, ['/a'])
  })

  it('only recognises exact entries', () => {
    const list = ['/home/me/notes']
    assert.equal(isRecentFolder(list, '/home/me/notes'), true)
    assert.equal(isRecentFolder(list, '/home/me/notes/sub'), false)
    assert.equal(isRecentFolder(list, '/home/me'), false)
    assert.equal(isRecentFolder(list, '/HOME/ME/NOTES'), false)
    assert.equal(isRecentFolder(list, 42), false)
    assert.equal(isRecentFolder(undefined, '/home/me/notes'), false)
  })

  it('removes an exact entry', () => {
    assert.deepEqual(removeRecentFolder(['/a', '/b'], '/a'), ['/b'])
  })
})

describe('pickRendererSettings (1.1 fields)', () => {
  it('accepts the new display settings', () => {
    const input = {
      readingFont: 'Hyperlegible',
      uiScale: 1.25,
      lineHeight: 1.9,
      reduceMotion: true,
      syncScroll: false,
      blockRemoteImages: true,
      showStatusBar: false,
      viewMode: 'split',
      activity: 'pinned',
      activeId: 'untitled:3',
      openTabs: ['untitled:3', '/docs/a.md']
    }
    assert.deepEqual(pickRendererSettings(input), input)
  })

  it('rejects out-of-range or misspelled values for the new fields', () => {
    const picked = pickRendererSettings({
      readingFont: 'Comic Sans',
      uiScale: 3,
      lineHeight: 0.5,
      reduceMotion: 'true',
      syncScroll: 1,
      blockRemoteImages: null,
      showStatusBar: 'no',
      viewMode: 'preview',
      activity: 'outline'
    })
    assert.deepEqual(picked, {})
  })

  it('never lets the renderer write recentFolders', () => {
    assert.deepEqual(pickRendererSettings({ recentFolders: ['C:\\'], theme: 'dark' }), { theme: 'dark' })
  })
})
