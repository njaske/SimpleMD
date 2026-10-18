import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

// save-paths imports its siblings without a file extension (as the bundler
// expects); Node's strip-types loader needs the ".ts", so add it for relative
// imports that fail to resolve, then load the module under test dynamically.
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (err) {
      if (!/^\.\.?\//.test(specifier) || /\.[cm]?[jt]s$/.test(specifier)) throw err
      return nextResolve(`${specifier}.ts`, context)
    }
  }
})

const { chosenPath, exportStem, hasRealExtension, suggestedName } = await import('../src/main/save-paths.ts')

const dir = tmpdir()

describe('chosenPath', () => {
  it('adds .md to titles whose ending is a number or has a space', () => {
    assert.equal(chosenPath(join(dir, 'Version 1.2'), '.md'), join(dir, 'Version 1.2.md'))
    assert.equal(chosenPath(join(dir, 'Chapter 1. Intro'), '.md'), join(dir, 'Chapter 1. Intro.md'))
  })

  it('adds the extension when the user typed none', () => {
    assert.equal(chosenPath(join(dir, 'notes'), '.md'), join(dir, 'notes.md'))
    assert.equal(chosenPath(join(dir, 'report'), '.html'), join(dir, 'report.html'))
  })

  it('keeps a real extension as typed', () => {
    assert.equal(chosenPath(join(dir, 'notes.txt'), '.md'), join(dir, 'notes.txt'))
    assert.equal(chosenPath(join(dir, 'notes.markdown'), '.md'), join(dir, 'notes.markdown'))
    assert.equal(chosenPath(join(dir, 'page.htm'), '.html'), join(dir, 'page.htm'))
  })

  it('treats a runnable ending as part of the title and adds the extension', () => {
    assert.equal(chosenPath(join(dir, 'Intro to Node.js'), '.md'), join(dir, 'Intro to Node.js.md'))
    assert.equal(chosenPath(join(dir, 'Learning Next.js'), '.html'), join(dir, 'Learning Next.js.html'))
    assert.equal(chosenPath(join(dir, 'evil.exe'), '.md'), join(dir, 'evil.exe.md'))
    assert.equal(chosenPath(join(dir, 'evil.CMD'), '.pdf'), join(dir, 'evil.CMD.pdf'))
  })

  it('still refuses a runnable final type', () => {
    assert.throws(() => chosenPath(join(dir, 'notes'), '.exe'), /type/)
  })

  it('refuses network locations', () => {
    assert.throws(() => chosenPath('\\\\server\\share\\notes.md', '.md'), /network/)
    assert.throws(() => chosenPath('//server/share/notes', '.md'), /network/)
  })
})

describe('hasRealExtension', () => {
  it('accepts letter-led endings up to 16 characters', () => {
    assert.equal(hasRealExtension('a.md'), true)
    assert.equal(hasRealExtension('a.tar_gz-1'), true)
    assert.equal(hasRealExtension('a'), false)
    assert.equal(hasRealExtension('a.2'), false)
    assert.equal(hasRealExtension('a.2b'), false)
    assert.equal(hasRealExtension(`a.${'x'.repeat(17)}`), false)
  })
})

describe('suggestedName / exportStem', () => {
  it('keeps only the bare name the renderer sent', () => {
    assert.equal(suggestedName('C:\\Users\\me\\notes.md', 'Untitled.md'), 'notes.md')
    assert.equal(suggestedName('../../etc/notes.md', 'Untitled.md'), 'notes.md')
  })

  it('keeps titles that only end like a program', () => {
    assert.equal(suggestedName('Learning Next.js', 'Untitled.md'), 'Learning Next.js')
  })

  it('falls back for invalid or missing names', () => {
    assert.equal(suggestedName(undefined, 'Untitled.md'), 'Untitled.md')
    assert.equal(suggestedName('   ', 'Untitled.md'), 'Untitled.md')
    assert.equal(suggestedName('con', 'Untitled.md'), 'Untitled.md')
    assert.equal(suggestedName('a<b>.md', 'Untitled.md'), 'Untitled.md')
  })

  it('strips a Markdown extension for exports', () => {
    assert.equal(exportStem('notes.md'), 'notes')
    assert.equal(exportStem('Version 1.2.md'), 'Version 1.2')
    assert.equal(exportStem('Guide.markdown'), 'Guide')
    assert.equal(exportStem(42), 'document')
  })

  it('keeps other endings of a stem the renderer already stripped', () => {
    assert.equal(exportStem('Intro to Node.js'), 'Intro to Node.js')
    assert.equal(exportStem('Version 1.2'), 'Version 1.2')
  })
})
