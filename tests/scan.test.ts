import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { isScanIgnored, mapLimit, readMdFile, saveMdFile, scanFolder } from '../src/main/fs-md.ts'

let root: string

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'simplemd-scan-'))
  await mkdir(join(root, 'sub'))
  await mkdir(join(root, 'node_modules'))
  await writeFile(join(root, 'a.md'), '# A')
  await writeFile(join(root, 'b.md'), '# B')
  await writeFile(join(root, 'sub', 'c.md'), '# C')
  await writeFile(join(root, 'node_modules', 'skip.md'), '# skip')
  await writeFile(join(root, 'notes.txt'), 'not markdown')
})

after(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('mapLimit', () => {
  it('never runs more than the limit at once and keeps input order', async () => {
    let active = 0
    let peak = 0
    const out = await mapLimit([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3, async (n) => {
      active++
      peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 5))
      active--
      return n * 2
    })
    assert.deepEqual(out, [2, 4, 6, 8, 10, 12, 14, 16, 18, 20])
    assert.ok(peak <= 3, `peak concurrency was ${peak}`)
  })

  it('handles empty input', async () => {
    assert.deepEqual(await mapLimit([], 4, async (n: number) => n), [])
  })
})

describe('scanFolder', () => {
  it('returns every Markdown file with its contents, skipping ignored dirs', async () => {
    const scan = await scanFolder(root)
    assert.ok(scan)
    assert.deepEqual(
      Object.keys(scan.contents).sort(),
      [join(root, 'a.md'), join(root, 'b.md'), join(root, 'sub', 'c.md')].sort()
    )
    assert.equal(scan.contents[join(root, 'a.md')], '# A')
    assert.equal(scan.tree[0].path, root)
  })

  it('picks up a file edited on disk between scans', async () => {
    const file = join(root, 'b.md')
    assert.equal((await scanFolder(root))!.contents[file], '# B')
    await writeFile(file, '# B2')
    const later = new Date(Date.now() + 5000)
    await utimes(file, later, later)
    assert.equal((await scanFolder(root))!.contents[file], '# B2')
    assert.equal(await readMdFile(file), '# B2')
  })

  it('does not serve stale text after an in-app save', async () => {
    const file = join(root, 'sub', 'c.md')
    assert.equal(await readMdFile(file), '# C')
    await saveMdFile(file, '# C saved')
    assert.equal(await readMdFile(file), '# C saved')
    assert.equal((await scanFolder(root))!.contents[file], '# C saved')
  })

  it('returns null for a path that is not a directory', async () => {
    assert.equal(await scanFolder(join(root, 'a.md')), null)
  })
})

describe('isScanIgnored', () => {
  it('ignores dot paths and skipped directories', () => {
    assert.equal(isScanIgnored('.git/index'), true)
    assert.equal(isScanIgnored('docs/.a.md.1f2e3d.tmp'), true)
    assert.equal(isScanIgnored('node_modules\\pkg\\readme.md'), true)
    assert.equal(isScanIgnored('app/dist/out.md'), true)
  })

  it('keeps ordinary workspace paths', () => {
    assert.equal(isScanIgnored('notes.md'), false)
    assert.equal(isScanIgnored('docs/guide/intro.md'), false)
    assert.equal(isScanIgnored('v1.2'), false)
  })
})
