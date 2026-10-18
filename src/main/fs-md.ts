import { randomBytes } from 'crypto'
import { promises as fs } from 'fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'path'
import type { DropResult, FolderScan, MdFileInfo, MdFolderInfo, OpenedFile } from '../shared/types'

const MD_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.mkd', '.mdx', '.markdn'])
/** Folders the scanner never enters. file-ops refuses these as new folder names
 *  (a test keeps the two lists equal), so a created folder never seems to vanish. */
export const SKIP_DIRS: ReadonlySet<string> = new Set([
  'node_modules', '.git', '.svn', '.hg', '.cache', '.next', '.nuxt',
  'dist', 'out', 'build', '.obsidian', '.vscode', '.idea', '.trash'
])
const IMG_MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.bmp': 'image/bmp', '.ico': 'image/x-icon',
  '.avif': 'image/avif', '.apng': 'image/apng'
}

const MAX_FILES = 4000
const MAX_DEPTH = 12
const MAX_FILE_BYTES = 5 * 1024 * 1024
const MAX_IMAGE_BYTES = 16 * 1024 * 1024
/** Parallel file reads during a scan: enough to keep the disk busy without
 *  queueing thousands of pending reads behind libuv's small thread pool. */
const READ_CONCURRENCY = 32
/** Upper bound (in characters) on file text kept for re-scans. */
const MAX_CACHE_CHARS = 48 * 1024 * 1024

// Default-locale collation, same ordering as String#localeCompare but without
// re-resolving the locale on every comparison (noticeable when sorting thousands
// of paths).
const collator = new Intl.Collator()
const byLocale = (a: string, b: string): number => collator.compare(a, b)

/** Run `fn` over `items` with at most `limit` in flight; results keep input order. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

// Text of recently read files keyed by path, validated against size + mtime/ctime
// so an unchanged file is not read again. The folder watcher triggers a full
// re-scan on every change, which would otherwise re-read every file in the tree.
interface CachedRead {
  size: number
  mtimeMs: number
  ctimeMs: number
  text: string
}
const readCache = new Map<string, CachedRead>()
let readCacheChars = 0

function cacheDrop(path: string): void {
  const hit = readCache.get(path)
  if (!hit) return
  readCacheChars -= hit.text.length
  readCache.delete(path)
}

function cachePut(path: string, entry: CachedRead): void {
  cacheDrop(path)
  if (entry.text.length > MAX_CACHE_CHARS) return
  readCache.set(path, entry)
  readCacheChars += entry.text.length
  for (const oldest of readCache.keys()) {
    if (readCacheChars <= MAX_CACHE_CHARS) break
    cacheDrop(oldest)
  }
}

/** True when a path (relative to the watched root) lies inside something the
 *  scanner skips: dot-files/dirs (incl. our own save temp files) and SKIP_DIRS
 *  such as node_modules or .git. Changes there can never alter a scan result. */
export function isScanIgnored(relPath: string): boolean {
  return relPath.split(/[\\/]/).some((seg) => seg.startsWith('.') || SKIP_DIRS.has(seg))
}

async function walk(dir: string, depth: number, out: string[]): Promise<void> {
  if (depth > MAX_DEPTH || out.length >= MAX_FILES) return
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (out.length >= MAX_FILES) break
    if (entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      await walk(full, depth + 1, out)
    } else if (entry.isFile() && MD_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      out.push(full)
    }
  }
}

/** Recursively scan a folder, grouping Markdown files by their containing directory. */
export async function scanFolder(root: string): Promise<FolderScan | null> {
  try {
    const stat = await fs.stat(root)
    if (!stat.isDirectory()) return null
  } catch {
    return null
  }

  const files: string[] = []
  await walk(root, 0, files)
  files.sort(byLocale)

  const byDir = new Map<string, MdFileInfo[]>()
  for (const file of files) {
    const dir = dirname(file)
    const list = byDir.get(dir) ?? []
    list.push({ id: file, name: basename(file), path: file, dir })
    byDir.set(dir, list)
  }

  const tree: MdFolderInfo[] = []
  for (const [dir, list] of byDir) {
    const rel = relative(root, dir)
    const name = rel === '' ? basename(root) || root : rel.split(sep).join('  /  ')
    tree.push({
      id: dir,
      name,
      path: dir,
      files: list.sort((a, b) => byLocale(a.name, b.name))
    })
  }
  tree.sort((a, b) => {
    if (a.path === root) return -1
    if (b.path === root) return 1
    return byLocale(a.name, b.name)
  })

  const contents: Record<string, string> = {}
  const texts = await mapLimit(files, READ_CONCURRENCY, async (file) => {
    try {
      return await readCapped(file)
    } catch {
      return ''
    }
  })
  files.forEach((file, i) => {
    contents[file] = texts[i]
  })

  return { root, name: basename(root) || root, tree, contents }
}

export function isMarkdownFile(path: string): boolean {
  return MD_EXTENSIONS.has(extname(path).toLowerCase())
}

/** Read a file as UTF-8 text, but replace an oversized file with a short
 *  placeholder so a huge (or accidentally-picked binary) file can't lock up the
 *  renderer. Shared by every read path so the cap is enforced consistently. */
async function readCapped(path: string): Promise<string> {
  const stat = await fs.stat(path)
  if (stat.size > MAX_FILE_BYTES) {
    cacheDrop(path)
    return `> _This file is too large to preview (${Math.round(stat.size / 1024)} KB)._`
  }
  const hit = readCache.get(path)
  if (hit && hit.size === stat.size && hit.mtimeMs === stat.mtimeMs && hit.ctimeMs === stat.ctimeMs) {
    // Refresh recency so frequently scanned files outlive idle ones.
    readCache.delete(path)
    readCache.set(path, hit)
    return hit.text
  }
  const text = await fs.readFile(path, 'utf8')
  cachePut(path, { size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, text })
  return text
}

export async function readMdFile(path: string): Promise<string> {
  return readCapped(path)
}

/** Read several files, skipping any that can't be read. */
export async function readMdFiles(paths: string[]): Promise<OpenedFile[]> {
  const read = await mapLimit(paths, READ_CONCURRENCY, async (path): Promise<OpenedFile | null> => {
    try {
      return { path, content: await readCapped(path) }
    } catch {
      return null // skip unreadable file
    }
  })
  return read.filter((f): f is OpenedFile => f !== null)
}

/** Classify dropped paths: scan the first directory as a workspace, read loose .md files. */
export async function resolveDrop(paths: string[]): Promise<DropResult> {
  const dirs: string[] = []
  const files: string[] = []
  await Promise.all(
    paths.map(async (path) => {
      try {
        const stat = await fs.stat(path)
        if (stat.isDirectory()) dirs.push(path)
        else if (stat.isFile() && isMarkdownFile(path)) files.push(path)
      } catch {
        // ignore unresolvable path
      }
    })
  )
  const folder = dirs.length > 0 ? await scanFolder(dirs[0]) : null
  const opened = await readMdFiles(files)
  return { folder, files: opened }
}

export async function saveMdFile(path: string, content: string): Promise<void> {
  assertSafeSavePath(path)
  if (typeof content !== 'string') throw new Error('Invalid content')
  // Atomic write: write to a temp file in the same directory, then rename it
  // over the target. rename is atomic within a filesystem, so a crash or power
  // loss mid-write leaves the original file intact instead of truncated. The
  // temp name starts with a dot so the folder scanner ignores it if seen, and
  // carries a random suffix opened with `wx` so it can never follow a pre-planted
  // file or symlink.
  const tmp = join(dirname(path), `.${basename(path)}.${randomBytes(6).toString('hex')}.tmp`)
  try {
    await fs.writeFile(tmp, content, { encoding: 'utf8', flag: 'wx' })
    await fs.rename(tmp, path)
    cacheDrop(path)
  } catch (err) {
    try {
      await fs.unlink(tmp)
    } catch {
      // temp file may not exist if the initial write failed
    }
    throw err
  }
}

/** True for UNC / network-share paths (`\\host\share`, `//host/share`, `\\?\UNC\...`). */
export function isNetworkPath(p: string): boolean {
  return /^[\\/]{2}/.test(p)
}

/** Extensions SimpleMD will never write, so a compromised renderer cannot drop a
 *  runnable file (e.g. into the Startup folder) through the save bridge. Covers
 *  what launches on double-click on Windows, macOS and Linux; file-ops keeps an
 *  identical list for create and rename (a test checks that). */
export const UNSAFE_SAVE_EXTENSIONS: ReadonlySet<string> = new Set([
  // Windows: executables, scripts, installers, shortcuts and shell handlers.
  '.exe', '.com', '.scr', '.pif', '.bat', '.cmd', '.ps1', '.psm1', '.psd1', '.ps1xml', '.psc1',
  '.vb', '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh', '.wsc', '.sct', '.hta', '.msi', '.msp',
  '.mst', '.msc', '.lnk', '.url', '.scf', '.dll', '.cpl', '.ocx', '.sys', '.reg', '.inf',
  '.chm', '.gadget', '.appref-ms', '.application', '.settingcontent-ms', '.library-ms',
  '.search-ms', '.searchconnector-ms', '.xbap', '.diagcab', '.jar', '.jnlp',
  // macOS: shell commands, Terminal/Automator/AppleScript documents, bundles, links.
  '.command', '.tool', '.terminal', '.fileloc', '.webloc', '.inetloc', '.scpt', '.scptd',
  '.applescript', '.workflow', '.action', '.app', '.pkg', '.mpkg', '.prefpane', '.kext',
  // Linux and Unix: shell scripts, launchers and self-running packages.
  '.sh', '.bash', '.zsh', '.csh', '.ksh', '.fish', '.desktop', '.run', '.appimage'
])

/** Validate a renderer-supplied path before any filesystem write. */
export function assertSafeSavePath(path: unknown): asserts path is string {
  if (typeof path !== 'string' || path.length === 0) throw new Error('Invalid path')
  if (!isAbsolute(path)) throw new Error('Path must be absolute')
  if (UNSAFE_SAVE_EXTENSIONS.has(extname(path).toLowerCase())) throw new Error('Refusing to write this file type')
}

async function realpathOrNull(p: string): Promise<string | null> {
  try {
    return await fs.realpath(p)
  } catch {
    return null
  }
}

/** Resolve a Markdown image reference to a data URL, but only if the resolved
 *  file is contained within one of the allowed roots (the document's own folder
 *  and/or the opened workspace). Defeats `../../secret.png` traversal, absolute
 *  paths, and symlink escapes — opening an untrusted document cannot read
 *  arbitrary files off disk. */
export async function readImageDataUrl(
  docPath: string,
  src: string,
  allowedRoots: string[]
): Promise<string | null> {
  try {
    if (/^(https?:|data:)/i.test(src)) return null // loaded directly by the renderer
    // Protocol-relative (`//host/share/a.png`) and backslash forms are UNC paths on
    // Windows: touching them would make the OS authenticate to a remote SMB server.
    if (isNetworkPath(src)) return null
    let raw = src.replace(/^file:\/\//i, '')
    try {
      raw = decodeURIComponent(raw)
    } catch {
      // leave as-is if it is not valid percent-encoding
    }
    if (isNetworkPath(raw)) return null
    const abs = isAbsolute(raw) ? resolve(raw) : resolve(dirname(docPath), raw)
    if (isNetworkPath(abs)) return null
    const ext = extname(abs).toLowerCase()
    const mime = IMG_MIME[ext]
    if (!mime) return null

    const real = await realpathOrNull(abs)
    if (!real) return null
    const roots = (await Promise.all(allowedRoots.map(realpathOrNull))).filter(
      (r): r is string => r !== null
    )
    const contained = roots.some((root) => {
      const rel = relative(root, real)
      return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
    })
    if (!contained) return null

    const stat = await fs.stat(real)
    if (!stat.isFile() || stat.size > MAX_IMAGE_BYTES) return null
    const buffer = await fs.readFile(real)
    return `data:${mime};base64,${buffer.toString('base64')}`
  } catch {
    return null
  }
}
