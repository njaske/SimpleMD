import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, beforeEach, describe, it } from 'node:test'
import {
  MAX_ASSET_BYTES,
  assetName,
  detectImageType,
  sanitizeStem,
  writeAsset
} from '../src/main/assets.ts'
import { readImageDataUrl } from '../src/main/fs-md.ts'

// 1x1 transparent PNG
const PNG = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64'
  )
)

function bytes(...parts: Array<string | number[]>): Uint8Array {
  const chunks = parts.map((p) => (typeof p === 'string' ? [...Buffer.from(p, 'latin1')] : p))
  return new Uint8Array(chunks.flat())
}

const pad = (n: number): number[] => new Array<number>(n).fill(0)
const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0], pad(16))
const GIF = bytes('GIF89a', pad(10))
const WEBP = bytes('RIFF', [0x24, 0, 0, 0], 'WEBPVP8 ', pad(8))
const BMP = bytes('BM', pad(12), [40, 0, 0, 0], pad(16))
const AVIF = bytes([0, 0, 0, 0x1c], 'ftypavif', [0, 0, 0, 0], 'avifmif1miaf', pad(4))
const AVIF_COMPAT = bytes([0, 0, 0, 0x18], 'ftypmif1', [0, 0, 0, 0], 'mif1avif', pad(4))

const symlinkDirType = process.platform === 'win32' ? 'junction' : 'dir'

let base: string
let docDir: string
let doc: string
let counter = 0

before(async () => {
  base = await mkdtemp(join(tmpdir(), 'simplemd-assets-'))
})

after(async () => {
  await rm(base, { recursive: true, force: true })
})

beforeEach(async () => {
  docDir = join(base, `doc-${++counter}`)
  await mkdir(docDir)
  doc = join(docDir, 'notes.md')
  await writeFile(doc, '# Notes')
})

describe('detectImageType', () => {
  it('recognises each supported format by its magic bytes', () => {
    assert.equal(detectImageType(PNG), 'png')
    assert.equal(detectImageType(JPEG), 'jpg')
    assert.equal(detectImageType(GIF), 'gif')
    assert.equal(detectImageType(bytes('GIF87a', pad(10))), 'gif')
    assert.equal(detectImageType(WEBP), 'webp')
    assert.equal(detectImageType(BMP), 'bmp')
    assert.equal(detectImageType(AVIF), 'avif')
    assert.equal(detectImageType(AVIF_COMPAT), 'avif')
  })

  it('rejects SVG, HTML, executables, text and truncated headers', () => {
    assert.equal(detectImageType(bytes('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null)
    assert.equal(detectImageType(bytes('<!doctype html><script>x</script>')), null)
    assert.equal(detectImageType(bytes('MZ', pad(64))), null)
    assert.equal(detectImageType(bytes('BM is not enough', pad(20))), null)
    assert.equal(detectImageType(bytes('RIFF', pad(4), 'WAVE')), null)
    assert.equal(detectImageType(bytes([0, 0, 0, 0x18], 'ftypmp42', pad(12))), null)
    assert.equal(detectImageType(PNG.subarray(0, 4)), null)
    assert.equal(detectImageType(new Uint8Array()), null)
  })
})

describe('sanitizeStem / assetName', () => {
  it('lowercases and keeps only a-z, 0-9, - and _', () => {
    assert.equal(sanitizeStem('Screenshot 2026-10-18 at 10.00.00.png'), 'screenshot-2026-10-18-at-10-00-00')
    assert.equal(sanitizeStem('Café Menü.JPG'), 'cafe-menu')
    assert.equal(sanitizeStem('my_diagram.webp'), 'my_diagram')
  })

  it('strips any directory part, including traversal', () => {
    assert.equal(sanitizeStem('../../etc/passwd.png'), 'passwd')
    assert.equal(sanitizeStem('C:\\Users\\me\\Desktop\\shot.png'), 'shot')
  })

  it('falls back to "image" and caps the length at 40', () => {
    assert.equal(sanitizeStem(''), 'image')
    assert.equal(sanitizeStem('😀😀.png'), 'image')
    assert.equal(sanitizeStem(undefined), 'image')
    assert.equal(sanitizeStem(`${'x'.repeat(60)}.png`).length, 40)
  })

  it('never produces a Windows device name', () => {
    assert.equal(sanitizeStem('CON.png'), 'con-image')
    assert.equal(sanitizeStem('lpt1.gif'), 'lpt1-image')
  })

  it('numbers later names', () => {
    assert.equal(assetName('shot', 'png', 1), 'shot.png')
    assert.equal(assetName('shot', 'png', 2), 'shot-2.png')
  })
})

describe('writeAsset', () => {
  it('saves into assets/ next to the document and returns a POSIX relative path', async () => {
    const rel = await writeAsset(doc, 'Screen Shot.png', PNG)
    assert.equal(rel, 'assets/screen-shot.png')
    assert.deepEqual(new Uint8Array(await readFile(join(docDir, 'assets', 'screen-shot.png'))), PNG)
  })

  it('uses the detected type, not the name, for the extension', async () => {
    assert.equal(await writeAsset(doc, 'photo.png', JPEG), 'assets/photo.jpg')
    assert.equal(await writeAsset(doc, 'evil.exe', GIF), 'assets/evil.gif')
  })

  it('never overwrites: picks name-2, name-3, ...', async () => {
    assert.equal(await writeAsset(doc, 'shot.png', PNG), 'assets/shot.png')
    assert.equal(await writeAsset(doc, 'shot.png', PNG), 'assets/shot-2.png')
    assert.equal(await writeAsset(doc, 'shot.png', PNG), 'assets/shot-3.png')
    assert.deepEqual((await readdir(join(docDir, 'assets'))).sort(), ['shot-2.png', 'shot-3.png', 'shot.png'])
  })

  it('keeps an existing file with the same name untouched', async () => {
    await mkdir(join(docDir, 'assets'))
    await writeFile(join(docDir, 'assets', 'image.png'), 'precious')
    assert.equal(await writeAsset(doc, '', PNG), 'assets/image-2.png')
    assert.equal(await readFile(join(docDir, 'assets', 'image.png'), 'utf8'), 'precious')
  })

  it('rejects data that is not a supported image', async () => {
    await assert.rejects(writeAsset(doc, 'x.png', bytes('<svg></svg>', pad(20))), /Only PNG/)
    await assert.rejects(writeAsset(doc, 'x.png', new Uint8Array()), /empty/)
    await assert.rejects(writeAsset(doc, 'x.png', 'not bytes'), /Invalid/)
    await assert.rejects(writeAsset(doc, 'x.png', [137, 80, 78, 71]), /Invalid/)
  })

  it('rejects images over 25 MB', async () => {
    const big = new Uint8Array(MAX_ASSET_BYTES + 1)
    big.set(PNG.subarray(0, 8))
    await assert.rejects(writeAsset(doc, 'big.png', big), /25 MB/)
  })

  it('refuses an assets folder that links outside the document folder', async () => {
    const outside = join(base, `outside-${counter}`)
    await mkdir(outside)
    await symlink(outside, join(docDir, 'assets'), symlinkDirType)
    await assert.rejects(writeAsset(doc, 'shot.png', PNG), /outside/)
    assert.deepEqual(await readdir(outside), [])
  })

  it('refuses an assets entry that is a file', async () => {
    await writeFile(join(docDir, 'assets'), 'not a folder')
    await assert.rejects(writeAsset(doc, 'shot.png', PNG))
  })

  it('does not follow a symlink planted at the target name', async (t) => {
    const outside = join(base, `victim-${counter}.png`)
    await writeFile(outside, 'victim')
    await mkdir(join(docDir, 'assets'))
    try {
      await symlink(outside, join(docDir, 'assets', 'shot.png'), 'file')
    } catch {
      t.skip('creating file symlinks needs extra privileges here')
      return
    }
    assert.equal(await writeAsset(doc, 'shot.png', PNG), 'assets/shot-2.png')
    assert.equal(await readFile(outside, 'utf8'), 'victim')
  })

  it('writes images the reader can then display', async () => {
    const rel = await writeAsset(doc, 'shot.png', PNG)
    const url = await readImageDataUrl(doc, rel, [docDir])
    assert.ok(url?.startsWith('data:image/png;base64,'))
  })
})
