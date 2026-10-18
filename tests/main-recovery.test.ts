import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { after, before, beforeEach, describe, it } from 'node:test'
import {
  MAX_RECOVERY_BYTES,
  MAX_RECOVERY_ENTRIES,
  RECOVERY_FILE,
  loadRecovery,
  sanitizeEntries,
  sanitizeEntry,
  saveRecovery
} from '../src/main/recovery-store.ts'
import type { RecoveryEntry } from '../src/shared/types.ts'

const allowAll = (): boolean => true
const docPath = resolve('/docs/notes.md')

function untitled(n: number, content = `text ${n}`): RecoveryEntry {
  return { id: `untitled:${n}`, path: null, title: `Untitled ${n}`, content, savedAt: 1_700_000_000_000 }
}

function fileEntry(path: string, content = 'unsaved'): RecoveryEntry {
  return { id: path, path, title: 'notes.md', content, savedAt: 1_700_000_000_000 }
}

let base: string
let dir: string
let counter = 0

before(async () => {
  base = await mkdtemp(join(tmpdir(), 'simplemd-recovery-'))
})

after(async () => {
  await rm(base, { recursive: true, force: true })
})

beforeEach(() => {
  dir = join(base, `store-${++counter}`, 'recovery')
})

describe('sanitizeEntry', () => {
  it('keeps well-formed untitled and file entries', () => {
    assert.deepEqual(sanitizeEntry(untitled(1), allowAll), untitled(1))
    assert.deepEqual(sanitizeEntry(fileEntry(docPath), allowAll), fileEntry(docPath))
  })

  it('copies only the known fields', () => {
    const entry = sanitizeEntry({ ...untitled(2), extra: '<script>', __proto__: { polluted: true } }, allowAll)
    assert.deepEqual(Object.keys(entry ?? {}).sort(), ['content', 'id', 'path', 'savedAt', 'title'])
  })

  it('rejects wrong shapes and types', () => {
    const bad: unknown[] = [
      null,
      'x',
      [],
      { ...untitled(1), content: 5 },
      { ...untitled(1), title: null },
      { ...untitled(1), savedAt: Number.NaN },
      { ...untitled(1), savedAt: -1 },
      { ...untitled(1), savedAt: '1' },
      { ...untitled(1), id: '' }
    ]
    for (const value of bad) assert.equal(sanitizeEntry(value, allowAll), null, JSON.stringify(value))
  })

  it('requires untitled:<digits> ids for entries without a path', () => {
    assert.equal(sanitizeEntry({ ...untitled(1), id: 'untitled:x' }, allowAll), null)
    assert.equal(sanitizeEntry({ ...untitled(1), id: 'notes.md' }, allowAll), null)
  })

  it('requires file entries to carry a local absolute path equal to the id', () => {
    assert.equal(sanitizeEntry({ ...fileEntry(docPath), id: 'other' }, allowAll), null)
    assert.equal(sanitizeEntry(fileEntry('relative/notes.md'), allowAll), null)
    assert.equal(sanitizeEntry(fileEntry('\\\\host\\share\\notes.md'), allowAll), null)
    assert.equal(sanitizeEntry({ ...fileEntry(docPath), path: 7 }, allowAll), null)
  })

  it('drops file entries the access check refuses', () => {
    assert.equal(sanitizeEntry(fileEntry(docPath), () => false), null)
  })

  it('shortens very long titles', () => {
    const entry = sanitizeEntry({ ...untitled(1), title: 't'.repeat(5000) }, allowAll)
    assert.equal(entry?.title.length, 256)
  })
})

describe('sanitizeEntries', () => {
  it('returns [] for non-lists', () => {
    assert.deepEqual(sanitizeEntries({ entries: [] }, allowAll), [])
    assert.deepEqual(sanitizeEntries(undefined, allowAll), [])
  })

  it('drops invalid items and duplicate ids, keeping order', () => {
    const result = sanitizeEntries([untitled(2), { nope: true }, untitled(1), untitled(2)], allowAll)
    assert.deepEqual(result.map((e) => e.id), ['untitled:2', 'untitled:1'])
  })

  it('keeps at most 50 entries', () => {
    const many = Array.from({ length: 80 }, (_, i) => untitled(i + 1))
    assert.equal(sanitizeEntries(many, allowAll).length, MAX_RECOVERY_ENTRIES)
  })

  it('stays within the 20 MB budget by skipping what does not fit', () => {
    const big = 'x'.repeat(MAX_RECOVERY_BYTES / 2)
    const result = sanitizeEntries([untitled(1, big), untitled(2, big), untitled(3, 'small')], allowAll)
    assert.deepEqual(result.map((e) => e.id), ['untitled:1', 'untitled:3'])
  })
})

describe('saveRecovery / loadRecovery', () => {
  it('round-trips entries through session.json', async () => {
    const entries = [untitled(1), fileEntry(docPath)]
    await saveRecovery(dir, entries, allowAll)
    assert.deepEqual(await loadRecovery(dir), entries)
    assert.ok((await stat(join(dir, RECOVERY_FILE))).isFile())
  })

  it('leaves no temp files behind', async () => {
    await saveRecovery(dir, [untitled(1)], allowAll)
    await saveRecovery(dir, [untitled(2)], allowAll)
    assert.deepEqual(await readdir(dir), [RECOVERY_FILE])
    assert.deepEqual(await loadRecovery(dir), [untitled(2)])
  })

  it('applies the access check when saving', async () => {
    const other = resolve('/secret/elsewhere.md')
    await saveRecovery(dir, [fileEntry(docPath), fileEntry(other)], (p) => p === docPath)
    assert.deepEqual(await loadRecovery(dir), [fileEntry(docPath)])
  })

  it('deletes the file when the list is empty', async () => {
    await saveRecovery(dir, [untitled(1)], allowAll)
    await saveRecovery(dir, [], allowAll)
    assert.deepEqual(await readdir(dir), [])
    assert.deepEqual(await loadRecovery(dir), [])
  })

  it('treats a list with nothing valid as empty', async () => {
    await saveRecovery(dir, [untitled(1)], allowAll)
    await saveRecovery(dir, [{ id: 'bogus' }], allowAll)
    assert.deepEqual(await readdir(dir), [])
  })

  it('rejects a payload that is not a list', async () => {
    await assert.rejects(saveRecovery(dir, { entries: [] }, allowAll))
  })

  it('keeps the newest snapshot when saves overlap', async () => {
    await Promise.all([
      saveRecovery(dir, [untitled(1)], allowAll),
      saveRecovery(dir, [untitled(2)], allowAll),
      saveRecovery(dir, [untitled(3)], allowAll)
    ])
    assert.deepEqual(await loadRecovery(dir), [untitled(3)])
  })

  it('loads nothing, without throwing, from a missing, corrupt or foreign file', async () => {
    assert.deepEqual(await loadRecovery(dir), [])
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, RECOVERY_FILE), '{ not json')
    assert.deepEqual(await loadRecovery(dir), [])
    await writeFile(join(dir, RECOVERY_FILE), JSON.stringify([untitled(1)]))
    assert.deepEqual(await loadRecovery(dir), [])
    await writeFile(join(dir, RECOVERY_FILE), JSON.stringify({ version: 99, entries: [untitled(1)] }))
    assert.deepEqual(await loadRecovery(dir), [])
  })

  it('validates entries again on load', async () => {
    await mkdir(dir, { recursive: true })
    const stored = { version: 1, entries: [untitled(1), { ...untitled(2), id: '../../x' }, fileEntry('rel.md')] }
    await writeFile(join(dir, RECOVERY_FILE), JSON.stringify(stored))
    assert.deepEqual(await loadRecovery(dir), [untitled(1)])
  })

  it('stores the documented shape', async () => {
    await saveRecovery(dir, [untitled(1)], allowAll)
    const parsed: unknown = JSON.parse(await readFile(join(dir, RECOVERY_FILE), 'utf8'))
    assert.deepEqual(parsed, { version: 1, entries: [untitled(1)] })
  })
})
