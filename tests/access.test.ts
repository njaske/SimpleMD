import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, beforeEach, describe, it } from 'node:test'
import { approveFile, approveRoot, isApproved, isApprovedRoot, resetAccess } from '../src/main/access.ts'
import { pickRendererSettings } from '../src/main/settings-schema.ts'

let base: string

before(async () => {
  base = await mkdtemp(join(tmpdir(), 'simplemd-access-'))
  await mkdir(join(base, 'workspace', 'sub'), { recursive: true })
  await writeFile(join(base, 'workspace', 'sub', 'note.md'), '# x')
  await writeFile(join(base, 'loose.md'), '# y')
  await writeFile(join(base, 'secret.md'), '# z')
})

after(async () => {
  await rm(base, { recursive: true, force: true })
})

beforeEach(() => resetAccess())

describe('access allow-list', () => {
  it('denies everything until something is granted', () => {
    assert.equal(isApproved(join(base, 'loose.md')), false)
  })

  it('allows files inside an approved root, and the root itself', () => {
    approveRoot(join(base, 'workspace'))
    assert.equal(isApproved(join(base, 'workspace', 'sub', 'note.md')), true)
    assert.equal(isApproved(join(base, 'workspace')), true)
    assert.equal(isApprovedRoot(join(base, 'workspace')), true)
    assert.equal(isApprovedRoot(join(base, 'workspace', 'sub')), false)
  })

  it('rejects siblings and ../ escapes from an approved root', () => {
    approveRoot(join(base, 'workspace'))
    assert.equal(isApproved(join(base, 'secret.md')), false)
    assert.equal(isApproved(join(base, 'workspace', '..', 'secret.md')), false)
  })

  it('allows an individually approved file but not its neighbours', () => {
    approveFile(join(base, 'loose.md'))
    assert.equal(isApproved(join(base, 'loose.md')), true)
    assert.equal(isApproved(join(base, 'secret.md')), false)
  })

  it('rejects relative, UNC and non-string paths', () => {
    approveRoot(join(base, 'workspace'))
    assert.equal(isApproved('workspace/sub/note.md'), false)
    assert.equal(isApproved('\\\\attacker\\share\\a.md'), false)
    assert.equal(isApproved(42), false)
    assert.equal(isApproved(null), false)
  })
})

describe('pickRendererSettings', () => {
  it('keeps valid display settings', () => {
    const picked = pickRendererSettings({ theme: 'light', accent: '#2b6cb0', readingWidth: 760, openTabs: ['a.md'] })
    assert.deepEqual(picked, { theme: 'light', accent: '#2b6cb0', readingWidth: 760, openTabs: ['a.md'] })
  })

  it('never lets the renderer set access-granting keys', () => {
    const picked = pickRendererSettings({ lastFolder: 'C:\\', approvedFiles: ['C:\\x.md'] })
    assert.deepEqual(picked, {})
  })

  it('drops values of the wrong type', () => {
    const picked = pickRendererSettings({
      openTabs: 5,
      accent: 'red; background:url(x)',
      theme: 'neon',
      sidebarOpen: 'yes',
      readingWidth: Infinity
    })
    assert.deepEqual(picked, {})
  })

  it('ignores non-object input', () => {
    assert.deepEqual(pickRendererSettings(null), {})
    assert.deepEqual(pickRendererSettings(['theme']), {})
    assert.deepEqual(pickRendererSettings('theme'), {})
  })
})
