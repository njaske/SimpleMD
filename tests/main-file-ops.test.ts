import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { after, before, beforeEach, describe, it } from 'node:test'
import {
  HIDDEN_FOLDER_NAMES,
  UNSAFE_EXTENSIONS,
  copyName,
  createFile,
  createFolder,
  duplicateFile,
  nameProblem,
  nameShapeProblem,
  rebasePath,
  rebasePaths,
  renamePath,
  renamedFileName,
  withMarkdownExtension
} from '../src/main/file-ops.ts'
import { SKIP_DIRS, UNSAFE_SAVE_EXTENSIONS, saveMdFile } from '../src/main/fs-md.ts'

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
    for (const name of ['notes.md', 'Meeting notes 2026-10-18.md', 'résumé.md', 'a', 'Version 1.2.md']) {
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

  it('rejects COM0 and LPT0, which Windows reserves as well', () => {
    for (const name of ['COM0', 'com0.md', 'LPT0.txt', 'lpt0']) {
      assert.match(nameProblem(name, 'file') ?? '', /reserved/, name)
    }
  })

  it('rejects names ending in a dot or a space, and overlong names', () => {
    assert.ok(nameProblem('notes.', 'file'))
    assert.ok(nameProblem('notes ', 'folder'))
    assert.ok(nameProblem(`${'a'.repeat(253)}.md`, 'file'))
  })

  it('counts UTF-8 bytes too, since ext4 and APFS cap names at 255 bytes', () => {
    const cjk = `${'文'.repeat(90)}.md` // 93 characters, 273 bytes
    assert.match(nameProblem(cjk, 'file') ?? '', /too long/)
    assert.equal(nameProblem(`${'文'.repeat(84)}.md`, 'file'), null) // 255 bytes
  })

  it('rejects runnable file types for files but not for folders', () => {
    for (const name of ['evil.exe', 'run.BAT', 'x.ps1', 'link.lnk', 'app.hta', 'script.js']) {
      assert.ok(nameProblem(name, 'file'), name)
    }
    assert.equal(nameProblem('tools.js', 'folder'), null)
  })

  it('rejects types that run on double-click on macOS and Linux too', () => {
    for (const name of ['x.command', 'x.terminal', 'x.tool', 'x.webloc', 'x.scpt', 'x.sh', 'x.desktop', 'x.AppImage']) {
      assert.ok(nameProblem(name, 'file'), name)
    }
    for (const name of ['x.pif', 'x.scf', 'x.msc', 'x.chm', 'x.appref-ms', 'x.settingcontent-ms', 'x.inf']) {
      assert.ok(nameProblem(name, 'file'), name)
    }
  })

  it('rejects folder names that macOS treats as app or installer bundles', () => {
    for (const name of ['Evil.app', 'x.workflow', 'setup.pkg']) assert.ok(nameProblem(name, 'folder'), name)
    assert.equal(nameProblem('chart.js', 'folder'), null)
    assert.equal(nameProblem('v1.2', 'folder'), null)
  })

  it('rejects names the workspace tree would hide', () => {
    for (const name of ['.notes', '.draft.md', '.hidden']) {
      assert.match(nameProblem(name, 'file') ?? '', /dot/, name)
      assert.match(nameProblem(name, 'folder') ?? '', /dot/, name)
    }
    for (const name of ['build', 'out', 'dist', 'node_modules']) {
      assert.match(nameProblem(name, 'folder') ?? '', /hidden/, name)
    }
    // Only folders are skipped by name; a file called "build.md" is listed.
    assert.equal(nameProblem('build.md', 'file'), null)
    // The scanner matches exactly, so a differently cased folder is shown.
    assert.equal(nameProblem('Build', 'folder'), null)
  })

  it('hides exactly the folders the scanner skips', () => {
    assert.deepEqual([...HIDDEN_FOLDER_NAMES].sort(), [...SKIP_DIRS].sort())
  })

  it('refuses exactly the extensions the save path refuses', async () => {
    assert.deepEqual([...UNSAFE_EXTENSIONS].sort(), [...UNSAFE_SAVE_EXTENSIONS].sort())
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

  it('keeps a Markdown file Markdown when the new name contains a dot', () => {
    assert.equal(renamedFileName('draft.md', 'Version 1.2'), 'Version 1.2.md')
    assert.equal(renamedFileName('draft.md', 'Chapter 1. Intro'), 'Chapter 1. Intro.md')
    assert.equal(renamedFileName('draft.md', 'notes.txt'), 'notes.txt.md')
    assert.equal(renamedFileName('draft.MD', 'Final.Markdown'), 'Final.Markdown')
  })

  it('never changes the type of a non-Markdown file', () => {
    assert.equal(renamedFileName('photo.png', 'cover'), 'cover.png')
    assert.equal(renamedFileName('photo.png', 'cover.PNG'), 'cover.PNG')
    assert.equal(renamedFileName('photo.png', 'cover.plist'), 'cover.plist.png')
    assert.equal(renamedFileName('LICENSE', 'COPYING'), 'COPYING')
    assert.throws(() => renamedFileName('LICENSE', 'info.plist'), /type/)
  })

  it('numbers copies the way file managers do', () => {
    assert.equal(copyName('notes.md', 1), 'notes copy.md')
    assert.equal(copyName('notes.md', 2), 'notes copy 2.md')
    assert.equal(copyName('README', 3), 'README copy 3')
  })
})

describe('nameShapeProblem', () => {
  it('accepts titles whose ending only looks runnable, as typed before ".md" is added', () => {
    for (const name of ['Learning Next.js', 'Intro to Node.js', 'evil.exe', 'Vue.js']) {
      assert.equal(nameShapeProblem(name, 'file'), null, name)
      assert.ok(nameProblem(name, 'file'), name)
    }
  })

  it('still rejects separators, reserved, hidden and overlong names', () => {
    for (const name of ['a/b', '..', 'CON', '.hidden', 'end.', 'x'.repeat(256)]) {
      assert.ok(nameShapeProblem(name, 'file'), name)
    }
    assert.ok(nameShapeProblem('node_modules', 'folder'))
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
    await assert.rejects(createFile(dir, '.notes', 'x'), /dot/)
    assert.deepEqual(await readdir(dir), [])
    assert.deepEqual((await readdir(base)).filter((n) => n.startsWith('escape')), [])
  })
})

describe('createFile with a runnable-looking ending', () => {
  it('adds .md to "Learning Next.js" instead of refusing it', async () => {
    const path = await createFile(dir, 'Learning Next.js', '# Next')
    assert.equal(path, join(dir, 'Learning Next.js.md'))
    assert.equal(await readFile(path, 'utf8'), '# Next')
  })

  it('turns any typed type into a Markdown document', async () => {
    assert.equal(await createFile(dir, 'evil.exe', 'x'), join(dir, 'evil.exe.md'))
    assert.equal(await createFile(dir, 'x.command', 'x'), join(dir, 'x.command.md'))
    assert.deepEqual((await readdir(dir)).sort(), ['evil.exe.md', 'x.command.md'])
  })

  it('refuses a name that is too long once ".md" is added', async () => {
    await assert.rejects(createFile(dir, 'a'.repeat(254), 'x'), /too long/)
    assert.deepEqual(await readdir(dir), [])
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

  it('refuses names the scanner would hide', async () => {
    await assert.rejects(createFolder(dir, 'out'), /hidden/)
    await assert.rejects(createFolder(dir, '.private'), /dot/)
    assert.deepEqual(await readdir(dir), [])
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
    await assert.rejects(renamePath(join(dir, 'a.md'), 'a.md '))
    assert.deepEqual(await readdir(dir), ['a.md'])
  })

  it('keeps the Markdown extension for a name with a dot, so the file stays listed', async () => {
    await writeFile(join(dir, 'draft.md'), 'text')
    const next = await renamePath(join(dir, 'draft.md'), 'Version 1.2')
    assert.equal(next, join(dir, 'Version 1.2.md'))
    assert.deepEqual(await readdir(dir), ['Version 1.2.md'])
  })

  it('keeps a document a document when the new name ends like a program', async () => {
    await writeFile(join(dir, 'a.md'), 'A')
    assert.equal(await renamePath(join(dir, 'a.md'), 'Intro to Node.js'), join(dir, 'Intro to Node.js.md'))
    assert.equal(await renamePath(join(dir, 'Intro to Node.js.md'), 'x.command'), join(dir, 'x.command.md'))
    assert.equal(await renamePath(join(dir, 'x.command.md'), 'a.cmd'), join(dir, 'a.cmd.md'))
    assert.deepEqual(await readdir(dir), ['a.cmd.md'])
  })

  it('refuses a rename whose final name would be runnable', async () => {
    await writeFile(join(dir, 'tool.js'), 'x')
    await assert.rejects(renamePath(join(dir, 'tool.js'), 'other'), /type/)
    assert.deepEqual(await readdir(dir), ['tool.js'])
  })

  it('refuses hidden names for files and folders', async () => {
    await writeFile(join(dir, 'a.md'), 'A')
    await mkdir(join(dir, 'docs'))
    await assert.rejects(renamePath(join(dir, 'a.md'), '.a.md'), /dot/)
    await assert.rejects(renamePath(join(dir, 'docs'), 'build'), /hidden/)
    assert.deepEqual((await readdir(dir)).sort(), ['a.md', 'docs'])
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
