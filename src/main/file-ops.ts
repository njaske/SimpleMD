import { constants as fsConstants, promises as fs, type Stats } from 'fs'
import { basename, dirname, extname, join, resolve, sep } from 'path'

// Workspace file operations (new file, new folder, rename, duplicate). Pure
// filesystem logic with no Electron imports, so it can be unit-tested; access
// checks happen in ipc.ts before any of these run. Nothing here ever overwrites:
// creates use exclusive flags and a rename refuses a target that already exists.

export type NameKind = 'file' | 'folder'

/** Markdown file extensions SimpleMD opens (same list as the folder scanner). */
export const MARKDOWN_EXTENSIONS: ReadonlySet<string> = new Set([
  '.md', '.markdown', '.mdown', '.mkd', '.mdx', '.markdn'
])

/** Extensions SimpleMD never writes, so a compromised renderer cannot create a
 *  runnable file. Kept identical to fs-md's save list (a test checks that). */
export const UNSAFE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.exe', '.com', '.scr', '.bat', '.cmd', '.ps1', '.psm1', '.vbs', '.vbe', '.js', '.jse',
  '.wsf', '.wsh', '.hta', '.msi', '.msp', '.lnk', '.dll', '.reg', '.cpl', '.jar', '.url'
])

const MAX_NAME_LENGTH = 255
const MAX_COPIES = 1000
const RESERVED_NAME = /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(\..*)?$/i
const FORBIDDEN_CHAR = /[<>:"|?*\u0000-\u001f\u007f]/
// Bidi overrides can disguise an extension ("report‮dm.exe" shows as "reportexe.md").
const BIDI_CONTROL = /[‪-‮⁦-⁩]/

export function isMarkdownName(name: string): boolean {
  return MARKDOWN_EXTENSIONS.has(extname(name).toLowerCase())
}

/** `name` with ".md" appended unless it already has a Markdown extension. */
export function withMarkdownExtension(name: string): string {
  return isMarkdownName(name) ? name : `${name}.md`
}

export function hasUnsafeExtension(name: string): boolean {
  return UNSAFE_EXTENSIONS.has(extname(name).toLowerCase())
}

/** Why `name` can't be used as a bare file or folder name, or null when it's fine.
 *  Checked on every OS, because files travel between Windows, macOS and Linux. */
export function nameProblem(name: unknown, kind: NameKind): string | null {
  if (typeof name !== 'string' || name.trim() === '') return 'Enter a name.'
  if (name === '.' || name === '..') return 'That name is reserved.'
  if (/[\\/]/.test(name)) return 'A name can’t contain / or \\.'
  if (FORBIDDEN_CHAR.test(name)) return 'A name can’t contain < > : " | ? * or control characters.'
  if (BIDI_CONTROL.test(name)) return 'A name can’t contain text-direction characters.'
  if (/[. ]$/.test(name)) return 'A name can’t end with a dot or a space.'
  if (name.length > MAX_NAME_LENGTH) return 'That name is too long.'
  if (RESERVED_NAME.test(name)) return 'That name is reserved by Windows.'
  if (kind === 'file' && hasUnsafeExtension(name)) return 'SimpleMD can’t create files of that type.'
  return null
}

export function assertValidName(name: unknown, kind: NameKind): asserts name is string {
  const problem = nameProblem(name, kind)
  if (problem) throw new Error(problem)
}

function errorCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err
    ? String((err as { code: unknown }).code)
    : undefined
}

function existsError(name: string): Error {
  return new Error(`“${name}” already exists here. Choose another name.`)
}

/** Create a new Markdown file in `dir` (".md" is added when missing). Fails if
 *  the file exists. Returns the new file's absolute path. */
export async function createFile(dir: string, name: unknown, content: string): Promise<string> {
  assertValidName(name, 'file')
  const fileName = withMarkdownExtension(name)
  assertValidName(fileName, 'file')
  const target = join(dir, fileName)
  try {
    await fs.writeFile(target, content, { encoding: 'utf8', flag: 'wx' })
  } catch (err) {
    if (errorCode(err) === 'EEXIST') throw existsError(fileName)
    throw err
  }
  return target
}

/** Create a folder in `parent`. Fails if anything with that name exists. */
export async function createFolder(parent: string, name: unknown): Promise<string> {
  assertValidName(name, 'folder')
  const target = join(parent, name)
  try {
    await fs.mkdir(target)
  } catch (err) {
    if (errorCode(err) === 'EEXIST') throw existsError(name)
    throw err
  }
  return target
}

/** The name a file gets when renamed to `newName`: a bare stem keeps the
 *  original extension, so typing "notes" renames "draft.md" to "notes.md". */
export function renamedFileName(oldName: string, newName: string): string {
  return extname(newName) === '' ? `${newName}${extname(oldName)}` : newName
}

async function lstatOrNull(path: string): Promise<Stats | null> {
  try {
    return await fs.lstat(path)
  } catch {
    return null
  }
}

async function realpathOrNull(path: string): Promise<string | null> {
  try {
    return await fs.realpath(path)
  } catch {
    return null
  }
}

/** True when `target` is `source` itself: a case-only rename ("notes.md" to
 *  "Notes.md") on a case-insensitive disk finds the "existing" target is the source. */
async function isSameEntry(source: string, target: string, a: Stats, b: Stats): Promise<boolean> {
  if (source.toLowerCase() !== target.toLowerCase()) return false
  if (a.ino !== 0 && a.dev === b.dev && a.ino === b.ino) return true
  const [realSource, realTarget] = await Promise.all([realpathOrNull(source), realpathOrNull(target)])
  return realSource !== null && realSource === realTarget
}

/** Rename a file or folder within its own folder; never overwrites. Returns
 *  the new absolute path (unchanged when the name is the same). */
export async function renamePath(path: string, newName: unknown): Promise<string> {
  const source = await fs.lstat(path)
  const kind: NameKind = source.isDirectory() ? 'folder' : 'file'
  assertValidName(newName, kind)
  const finalName = kind === 'file' ? renamedFileName(basename(path), newName) : newName
  assertValidName(finalName, kind)
  const target = join(dirname(path), finalName)
  if (target === path) return path
  const existing = await lstatOrNull(target)
  if (existing && !(await isSameEntry(path, target, source, existing))) throw existsError(finalName)
  await fs.rename(path, target)
  return target
}

/** "name copy.md", then "name copy 2.md", "name copy 3.md", ... */
export function copyName(fileName: string, n: number): string {
  const ext = extname(fileName)
  const stem = fileName.slice(0, fileName.length - ext.length)
  return n <= 1 ? `${stem} copy${ext}` : `${stem} copy ${n}${ext}`
}

/** Copy a file next to itself under the first free copy name. Returns its path. */
export async function duplicateFile(path: string): Promise<string> {
  const stat = await fs.stat(path)
  if (!stat.isFile()) throw new Error('Only files can be duplicated.')
  const dir = dirname(path)
  for (let n = 1; n <= MAX_COPIES; n++) {
    const name = copyName(basename(path), n)
    if (nameProblem(name, 'file')) throw new Error('That file can’t be duplicated here.')
    const target = join(dir, name)
    try {
      // COPYFILE_EXCL: fail instead of replacing a file that appeared meanwhile.
      await fs.copyFile(path, target, fsConstants.COPYFILE_EXCL)
      return target
    } catch (err) {
      if (errorCode(err) !== 'EEXIST') throw err
    }
  }
  throw new Error('There are too many copies of this file already.')
}

/** `path` moved from under `from` to under `to`, or null when it isn't under
 *  `from`. Case-insensitive on Windows, like the access keys. */
export function rebasePath(path: string, from: string, to: string, caseInsensitive: boolean): string | null {
  const norm = (p: string): string => (caseInsensitive ? resolve(p).toLowerCase() : resolve(p))
  const full = resolve(path)
  const base = norm(from)
  const probe = norm(full)
  if (probe === base) return resolve(to)
  const prefix = base.endsWith(sep) ? base : base + sep
  if (!probe.startsWith(prefix)) return null
  return join(resolve(to), full.slice(prefix.length))
}

/** Settings path lists after a rename: entries at or under `from` follow it to `to`. */
export function rebasePaths(
  list: readonly string[],
  from: string,
  to: string,
  caseInsensitive: boolean
): string[] {
  return list.map((p) => rebasePath(p, from, to, caseInsensitive) ?? p)
}
