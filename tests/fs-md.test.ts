import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { isNetworkPath, readImageDataUrl, saveMdFile } from '../src/main/fs-md.ts'

// 1x1 transparent PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
)

let root: string
let outside: string

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'simplemd-root-'))
  outside = await mkdtemp(join(tmpdir(), 'simplemd-outside-'))
  await writeFile(join(root, 'ok.png'), PNG)
  await writeFile(join(outside, 'secret.png'), PNG)
})

after(async () => {
  await rm(root, { recursive: true, force: true })
  await rm(outside, { recursive: true, force: true })
})

describe('isNetworkPath', () => {
  it('flags UNC and protocol-relative paths', () => {
    assert.equal(isNetworkPath('//attacker.example/share/a.png'), true)
    assert.equal(isNetworkPath('\\\\attacker.example\\share\\a.png'), true)
    assert.equal(isNetworkPath('\\\\?\\UNC\\host\\share'), true)
  })

  it('does not flag ordinary paths', () => {
    assert.equal(isNetworkPath('images/a.png'), false)
    assert.equal(isNetworkPath('C:\\Users\\me\\a.png'), false)
    assert.equal(isNetworkPath('/home/me/a.png'), false)
  })
})

describe('readImageDataUrl', () => {
  const doc = (): string => join(root, 'doc.md')

  it('reads an image inside the document folder', async () => {
    const url = await readImageDataUrl(doc(), 'ok.png', [root])
    assert.ok(url?.startsWith('data:image/png;base64,'))
  })

  it('rejects protocol-relative UNC references without touching the network', async () => {
    assert.equal(await readImageDataUrl(doc(), '//attacker.example/s/a.png', [root]), null)
  })

  it('rejects percent-encoded backslash UNC references', async () => {
    assert.equal(await readImageDataUrl(doc(), '%5C%5Cattacker.example%5Cs%5Ca.png', [root]), null)
  })

  it('rejects file:// UNC references', async () => {
    assert.equal(await readImageDataUrl(doc(), 'file:////attacker.example/s/a.png', [root]), null)
  })

  it('rejects ../ traversal out of the allowed root', async () => {
    const escape = `../${outside.split(/[\\/]/).pop()}/secret.png`
    assert.equal(await readImageDataUrl(doc(), escape, [root]), null)
  })

  it('rejects absolute paths outside the allowed roots', async () => {
    assert.equal(await readImageDataUrl(doc(), join(outside, 'secret.png'), [root]), null)
  })

  it('rejects non-image extensions', async () => {
    await writeFile(join(root, 'notes.txt'), 'x')
    assert.equal(await readImageDataUrl(doc(), 'notes.txt', [root]), null)
  })

  it('leaves remote and data URLs to the renderer', async () => {
    assert.equal(await readImageDataUrl(doc(), 'https://example.com/a.png', [root]), null)
    assert.equal(await readImageDataUrl(doc(), 'data:image/png;base64,AAAA', [root]), null)
  })
})

describe('saveMdFile', () => {
  it('writes content atomically and leaves no temp file behind', async () => {
    const target = join(root, 'note.md')
    await saveMdFile(target, '# hello')
    assert.equal(await readFile(target, 'utf8'), '# hello')
    await saveMdFile(target, '# updated')
    assert.equal(await readFile(target, 'utf8'), '# updated')
    const leftovers = (await readdir(root)).filter((name) => name.endsWith('.tmp'))
    assert.deepEqual(leftovers, [])
  })

  it('refuses to write runnable file types', async () => {
    for (const name of ['evil.exe', 'evil.BAT', 'evil.ps1', 'evil.lnk']) {
      await assert.rejects(saveMdFile(join(root, name), 'x'))
    }
  })

  it('refuses relative paths', async () => {
    await assert.rejects(saveMdFile('relative/note.md', 'x'))
  })
})
