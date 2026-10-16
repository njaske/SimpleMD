import { randomBytes } from 'crypto'
import { promises as fs } from 'fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'path'
import type { DropResult, FolderScan, MdFileInfo, MdFolderInfo, OpenedFile } from '../shared/types'

const MD_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.mkd', '.mdx', '.markdn'])
const SKIP_DIRS = new Set([
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
  files.sort((a, b) => a.localeCompare(b))

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
      files: list.sort((a, b) => a.name.localeCompare(b.name))
    })
  }
  tree.sort((a, b) => {
    if (a.path === root) return -1
    if (b.path === root) return 1
    return a.name.localeCompare(b.name)
  })

  const contents: Record<string, string> = {}
  await Promise.all(
    files.map(async (file) => {
      try {
        contents[file] = await readCapped(file)
      } catch {
        contents[file] = ''
      }
    })
  )

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
    return `> _This file is too large to preview (${Math.round(stat.size / 1024)} KB)._`
  }
  return fs.readFile(path, 'utf8')
}

export async function readMdFile(path: string): Promise<string> {
  return readCapped(path)
}

/** Read several files, skipping any that can't be read. */
export async function readMdFiles(paths: string[]): Promise<OpenedFile[]> {
  const out: OpenedFile[] = []
  await Promise.all(
    paths.map(async (path) => {
      try {
        out.push({ path, content: await readCapped(path) })
      } catch {
        // skip unreadable file
      }
    })
  )
  return out
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
 *  runnable file (e.g. into the Startup folder) through the save bridge. */
const UNSAFE_SAVE_EXTENSIONS = new Set([
  '.exe', '.com', '.scr', '.bat', '.cmd', '.ps1', '.psm1', '.vbs', '.vbe', '.js', '.jse',
  '.wsf', '.wsh', '.hta', '.msi', '.msp', '.lnk', '.dll', '.reg', '.cpl', '.jar', '.url'
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
