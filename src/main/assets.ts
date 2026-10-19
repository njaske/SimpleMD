import { promises as fs } from 'fs'
import { basename, dirname, extname, isAbsolute, join, relative, sep } from 'path'

// Images pasted or dropped into the editor are saved into an `assets` folder
// next to the document. The type comes from the file's magic bytes, never from
// its name, and the target folder must really be inside the document's folder
// (a planted `assets` symlink can't redirect the write elsewhere).

export const MAX_ASSET_BYTES = 25 * 1024 * 1024
export const ASSETS_DIR = 'assets'
const MAX_STEM_LENGTH = 40
const MAX_ATTEMPTS = 1000
// COM0 and LPT0 are reserved too (Microsoft's current naming rules).
const RESERVED_STEM = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/

export type ImageExt = 'png' | 'jpg' | 'gif' | 'webp' | 'bmp' | 'avif'

// Header sizes a real BMP can carry (BITMAPCOREHEADER .. BITMAPV5HEADER).
const BMP_DIB_SIZES = new Set([12, 40, 52, 56, 64, 108, 124])

function ascii(data: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...data.subarray(start, start + length))
}

function startsWith(data: Uint8Array, bytes: readonly number[]): boolean {
  return bytes.every((b, i) => data[i] === b)
}

function isBmp(data: Uint8Array): boolean {
  if (data.length < 26 || ascii(data, 0, 2) !== 'BM') return false
  const dibSize = data[14] | (data[15] << 8) | (data[16] << 16) | (data[17] << 24)
  return BMP_DIB_SIZES.has(dibSize)
}

/** AVIF: an ISO-BMFF `ftyp` box whose major or a compatible brand is avif/avis. */
function isAvif(data: Uint8Array): boolean {
  if (data.length < 16 || ascii(data, 4, 4) !== 'ftyp') return false
  const boxSize = ((data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3]) >>> 0
  const end = Math.min(boxSize, data.length, 256)
  for (let at = 8; at + 4 <= end; at += 4) {
    if (at === 12) continue // minor version, not a brand
    const brand = ascii(data, at, 4)
    if (brand === 'avif' || brand === 'avis') return true
  }
  return false
}

/** The image type of `data` from its leading bytes, or null for anything else. */
export function detectImageType(data: Uint8Array): ImageExt | null {
  if (startsWith(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png'
  if (startsWith(data, [0xff, 0xd8, 0xff])) return 'jpg'
  if (data.length >= 6 && /^GIF8[79]a$/.test(ascii(data, 0, 6))) return 'gif'
  if (data.length >= 12 && ascii(data, 0, 4) === 'RIFF' && ascii(data, 8, 4) === 'WEBP') return 'webp'
  if (isBmp(data)) return 'bmp'
  if (isAvif(data)) return 'avif'
  return null
}

/** A safe file stem from a pasted image's name: lowercase a-z, 0-9, "-" and "_",
 *  at most 40 characters; "image" when nothing usable is left. */
export function sanitizeStem(fileName: unknown): string {
  const raw = typeof fileName === 'string' ? basename(fileName.replace(/\\/g, '/')) : ''
  const stem = raw.slice(0, raw.length - extname(raw).length)
  const cleaned = stem
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, MAX_STEM_LENGTH)
    .replace(/[-_]+$/, '')
  if (!cleaned) return 'image'
  return RESERVED_STEM.test(cleaned) ? `${cleaned}-image` : cleaned
}

/** "<stem>.<ext>", then "<stem>-2.<ext>", "<stem>-3.<ext>", ... */
export function assetName(stem: string, ext: ImageExt, n: number): string {
  return n <= 1 ? `${stem}.${ext}` : `${stem}-${n}.${ext}`
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

function errorCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err
    ? String((err as { code: unknown }).code)
    : undefined
}

/** The real `assets` folder next to `docPath`, created when missing. Throws when
 *  it resolves outside the document's folder (symlink / junction escape). */
async function assetsFolder(docPath: string): Promise<string> {
  const docDir = await fs.realpath(dirname(docPath))
  const wanted = join(docDir, ASSETS_DIR)
  try {
    await fs.mkdir(wanted)
  } catch (err) {
    if (errorCode(err) !== 'EEXIST') throw err
  }
  const real = await fs.realpath(wanted)
  if (!isInside(docDir, real)) throw new Error('The assets folder points outside this document’s folder.')
  if (!(await fs.stat(real)).isDirectory()) throw new Error('“assets” next to this document isn’t a folder.')
  return real
}

/** Validate `data` as an image and save it under `assets/` next to `docPath`
 *  without overwriting anything. Returns the POSIX path relative to the
 *  document's folder, ready for Markdown: "assets/screenshot-2.png". */
export async function writeAsset(docPath: string, fileName: unknown, data: unknown): Promise<string> {
  if (!(data instanceof Uint8Array)) throw new Error('Invalid image data.')
  if (data.byteLength === 0) throw new Error('The image is empty.')
  if (data.byteLength > MAX_ASSET_BYTES) throw new Error('Images larger than 25 MB can’t be added.')
  const ext = detectImageType(data)
  if (!ext) throw new Error('Only PNG, JPEG, GIF, WebP, BMP and AVIF images can be added.')
  const stem = sanitizeStem(fileName)
  const folder = await assetsFolder(docPath)
  for (let n = 1; n <= MAX_ATTEMPTS; n++) {
    const name = assetName(stem, ext, n)
    try {
      // `wx` never replaces (or follows a symlink planted at) an existing name.
      await fs.writeFile(join(folder, name), data, { flag: 'wx' })
      return `${ASSETS_DIR}/${name}`
    } catch (err) {
      if (errorCode(err) !== 'EEXIST') throw err
    }
  }
  throw new Error('The assets folder has too many images with this name.')
}
