import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { after, before, beforeEach, describe, it } from 'node:test'
import {
  UNSAFE_EXTENSIONS,
  copyName,
  createFile,
  createFolder,
  duplicateFile,
  nameProblem,
  rebasePath,
  rebasePaths,
  renamePath,
  renamedFileName,
  withMarkdownExtension
} from '../src/main/file-ops.ts'
import { saveMdFile } from '../src/main/fs-md.ts'

let base: string
let dir: string
let counter = 0

before(async () => {
  base = await mkdtemp(join(tmpdir(), 'simplemd-fileops-'))
})

after(async () => {
  await rm(base, { recursive: true, force: true })
})

// A fresh, empty folder per test so cases never see each other's files.
beforeEach(async () => {
  dir = join(base, `case-${++counter}`)
  await mkdir(dir)
})

describe('nameProblem', () => {
  it('accepts ordinary file and folder names', () => {
    for (const name of ['notes.md', 'Meeting notes 2026-10-18.md', 'résumé.md', 'a', '.hidden.md']) {
      assert.equal(nameProblem(name, 'file'), null, name)
    }
    assert.equal(nameProblem('Project files', 'folder'), null)
  })

  it('rejects empty, whitespace-only and non-string names', () => {
    assert.ok(nameProblem('', 'file'))
    assert.ok(nameProblem('   ', 'file'))
    assert.ok(nameProblem(undefined, 'file'))
    assert.ok(nameProblem(42, 'folder'))
  })

  it('rejects path separators and dot names', () => {
    for (const name of ['a/b.md', 'a\\b.md', '../x.md', '..\\x.md', '.', '..', '/abs.md']) {
      assert.ok(nameProblem(name, 'file'), name)
    }
  })

  it('rejects characters Windows forbids and control characters', () => {
    for (const name of ['a<b.md', 'a>b.md', 'a:b.md', 'a"b.md', 'a|b.md', 'a?b.md', 'a*b.md', 'a\u0000b.md', 'a\nb.md']) {
      assert.ok(nameProblem(name, 'file'), JSON.stringify(name))
    }
  })

  it('rejects text-direction overrides that disguise an extension', () => {
    assert.ok(nameProblem('report‮dm.exe', 'file'))
  })

  it('rejects Windows reserved device names with or without an extension', () => {
    for (const name of ['CON', 'con.md', 'Prn.txt', 'aux', 'NUL.md', 'COM1', 'lpt9.md']) {
      assert.ok(nameProblem(name, 'file'), name)
    }
    assert.equal(nameProblem('console.md', 'file'), null)
    assert.equal(nameProblem('com10.md', 'file'), null)
  })

  it('rejects names ending in a dot or a space, and overlong names', () => {
    assert.ok(nameProblem('notes.', 'file'))
    assert.ok(nameProblem('notes ', 'folder'))
    assert.ok(nameProblem(`${'a'.repeat(253)}.md`, 'file'))
  })

  it('rejects runnable file types for files but not for folders', () => {
    for (const name of ['evil.exe', 'run.BAT', 'x.ps1', 'link.lnk', 'app.hta', 'script.js']) {
      assert.ok(nameProblem(name, 'file'), name)
    }
    assert.equal(nameProblem('tools.js', 'folder'), null)
  })

  it('refuses exactly the extensions the save path refuses', async () => {
    for (const ext of UNSAFE_EXTENSIONS) {
      await assert.rejects(saveMdFile(join(dir, `x${ext}`), 'x'), ext)
    }
  })
})

describe('withMarkdownExtension / renamedFileName / copyName', () => {
  it('adds .md only when there is no Markdown extension', () => {
    assert.equal(withMarkdownExtension('notes'), 'notes.md')
    assert.equal(withMarkdownExtension('notes.MD'), 'notes.MD')
    assert.equal(withMarkdownExtension('notes.markdown'), 'notes.markdown')
    assert.equal(withMarkdownExtension('notes.txt'), 'notes.txt.md')
  })

  it('keeps the old extension when a bare stem is typed', () => {
    assert.equal(renamedFileName('draft.md', 'final'), 'final.md')
    assert.equal(renamedFileName('draft.markdown', 'final'), 'final.markdown')
    assert.equal(renamedFileName('draft.md', 'final.mdx'), 'final.mdx')
  })

  it('numbers copies the way file managers do', () => {
    assert.equal(copyName('notes.md', 1), 'notes copy.md')
    assert.equal(copyName('notes.md', 2), 'notes copy 2.md')
    assert.equal(copyName('README', 3), 'README copy 3')
  })
})

describe('createFile', () => {
  it('creates a Markdown file with the given content and adds .md', async () => {
    const path = await createFile(dir, 'Ideas', '# Ideas\n')
    assert.equal(path, join(dir, 'Ideas.md'))
    assert.equal(await readFile(path, 'utf8'), '# Ideas\n')
  })

  it('refuses to overwrite an existing file', async () => {
    await writeFile(join(dir, 'taken.md'), 'original')
    await assert.rejects(createFile(dir, 'taken.md', 'new'), /already exists/)
    assert.equal(await readFile(join(dir, 'taken.md'), 'utf8'), 'original')
  })

  it('refuses invalid and traversal names without touching the disk', async () => {
    await assert.rejects(createFile(dir, '../escape', 'x'), /can’t contain/)
    await assert.rejects(createFile(dir, 'nul', 'x'), /reserved/)
    await assert.rejects(createFile(dir, 'evil.exe', 'x'))
    assert.deepEqual(await readdir(dir), [])
    assert.deepEqual((await readdir(base)).filter((n) => n.startsWith('escape')), [])
  })
})

describe('createFolder', () => {
  it('creates a folder and returns its path', async () => {
    const path = await createFolder(dir, 'Drafts')
    assert.equal(path, join(dir, 'Drafts'))
    assert.ok((await stat(path)).isDirectory())
  })

  it('refuses a name that already exists', async () => {
    await mkdir(join(dir, 'Drafts'))
    await assert.rejects(createFolder(dir, 'Drafts'), /already exists/)
    await writeFile(join(dir, 'file'), 'x')
    await assert.rejects(createFolder(dir, 'file'), /already exists/)
  })

  it('refuses separators', async () => {
    await assert.rejects(createFolder(dir, 'a/b'))
  })
})

describe('renamePath', () => {
  it('renames a file in place, keeping its extension for a bare stem', async () => {
    await writeFile(join(dir, 'draft.md'), 'text')
    const next = await renamePath(join(dir, 'draft.md'), 'final')
    assert.equal(next, join(dir, 'final.md'))
    assert.equal(await readFile(next, 'utf8'), 'text')
    assert.deepEqual(await readdir(dir), ['final.md'])
  })

  it('renames a folder', async () => {
    await mkdir(join(dir, 'old'))
    await writeFile(join(dir, 'old', 'a.md'), 'a')
    const next = await renamePath(join(dir, 'old'), 'new.v2')
    assert.equal(next, join(dir, 'new.v2'))
    assert.equal(await readFile(join(next, 'a.md'), 'utf8'), 'a')
  })

  it('never overwrites an existing file', async () => {
    await writeFile(join(dir, 'a.md'), 'A')
    await writeFile(join(dir, 'b.md'), 'B')
    await assert.rejects(renamePath(join(dir, 'a.md'), 'b.md'), /already exists/)
    assert.equal(await readFile(join(dir, 'a.md'), 'utf8'), 'A')
    assert.equal(await readFile(join(dir, 'b.md'), 'utf8'), 'B')
  })

  it('never replaces an existing folder', async () => {
    await mkdir(join(dir, 'one'))
    await mkdir(join(dir, 'two'))
    await writeFile(join(dir, 'two', 'keep.md'), 'keep')
    await assert.rejects(renamePath(join(dir, 'one'), 'two'), /already exists/)
    assert.equal(await readFile(join(dir, 'two', 'keep.md'), 'utf8'), 'keep')
  })

  it('allows a case-only rename', async () => {
    await writeFile(join(dir, 'notes.md'), 'n')
    const next = await renamePath(join(dir, 'notes.md'), 'Notes.md')
    assert.equal(next, join(dir, 'Notes.md'))
    assert.deepEqual(await readdir(dir), ['Notes.md'])
  })

  it('returns the same path when the name is unchanged', async () => {
    await writeFile(join(dir, 'same.md'), 's')
    assert.equal(await renamePath(join(dir, 'same.md'), 'same.md'), join(dir, 'same.md'))
  })

  it('refuses names that would move the file or make it runnable', async () => {
    await writeFile(join(dir, 'a.md'), 'A')
    await assert.rejects(renamePath(join(dir, 'a.md'), '../a.md'))
    await assert.rejects(renamePath(join(dir, 'a.md'), 'sub/a.md'))
    await assert.rejects(renamePath(join(dir, 'a.md'), 'a.cmd'))
    await assert.rejects(renamePath(join(dir, 'a.md'), 'a.md '))
    assert.deepEqual(await readdir(dir), ['a.md'])
  })

  it('fails for a path that does not exist', async () => {
    await assert.rejects(renamePath(join(dir, 'missing.md'), 'x.md'))
  })
})

describe('duplicateFile', () => {
  it('copies next to the original as "name copy", then "name copy 2"', async () => {
    const original = join(dir, 'plan.md')
    await writeFile(original, '# Plan')
    const first = await duplicateFile(original)
    const second = await duplicateFile(original)
    assert.equal(first, join(dir, 'plan copy.md'))
    assert.equal(second, join(dir, 'plan copy 2.md'))
    assert.equal(await readFile(second, 'utf8'), '# Plan')
    assert.equal(await readFile(original, 'utf8'), '# Plan')
  })

  it('skips names that are taken instead of overwriting them', async () => {
    const original = join(dir, 'plan.md')
    await writeFile(original, 'new')
    await writeFile(join(dir, 'plan copy.md'), 'older copy')
    const copy = await duplicateFile(original)
    assert.equal(copy, join(dir, 'plan copy 2.md'))
    assert.equal(await readFile(join(dir, 'plan copy.md'), 'utf8'), 'older copy')
  })

  it('refuses folders and runnable file types', async () => {
    await mkdir(join(dir, 'folder'))
    await assert.rejects(duplicateFile(join(dir, 'folder')))
    await writeFile(join(dir, 'tool.js'), 'x')
    await assert.rejects(duplicateFile(join(dir, 'tool.js')))
    assert.deepEqual((await readdir(dir)).sort(), ['folder', 'tool.js'])
  })
})

describe('rebasePath / rebasePaths', () => {
  const from = resolve('/work/old')
  const to = resolve('/work/new')

  it('moves the path itself and paths below it', () => {
    assert.equal(rebasePath(from, from, to, false), to)
    assert.equal(rebasePath(join(from, 'a', 'b.md'), from, to, false), join(to, 'a', 'b.md'))
  })

  it('leaves siblings with a shared prefix alone', () => {
    assert.equal(rebasePath(resolve('/work/older/b.md'), from, to, false), null)
  })

  it('matches case-insensitively only when asked', () => {
    const upper = resolve('/WORK/OLD/b.md')
    assert.equal(rebasePath(upper, from, to, false), null)
    assert.equal(rebasePath(upper, from, to, true), join(to, 'b.md'))
  })

  it('returns a new list and keeps unrelated entries', () => {
    const list = [join(from, 'a.md'), resolve('/elsewhere/c.md')]
    const next = rebasePaths(list, from, to, false)
    assert.deepEqual(next, [join(to, 'a.md'), resolve('/elsewhere/c.md')])
    assert.notEqual(next, list)
    assert.equal(list[0], join(from, 'a.md'))
  })
})
