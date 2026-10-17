import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { describe, it } from 'node:test'
import { extractLaunchPaths } from '../src/main/launch.ts'

const cwd = resolve('/work/dir')

describe('extractLaunchPaths', () => {
  it('returns an absolute file path as-is', () => {
    const file = resolve('/docs/notes.md')
    assert.deepEqual(extractLaunchPaths([file], cwd), [file])
  })

  it('resolves relative paths against the working directory', () => {
    assert.deepEqual(extractLaunchPaths(['notes.md'], cwd), [resolve(cwd, 'notes.md')])
  })

  it('skips Chromium/Electron flags', () => {
    const file = resolve('/docs/a.md')
    assert.deepEqual(extractLaunchPaths(['--no-sandbox', '--allow-file-access', file], cwd), [file])
  })

  it('drops duplicates and empty arguments', () => {
    const file = resolve('/docs/a.md')
    assert.deepEqual(extractLaunchPaths([file, '', file], cwd), [file])
  })

  it('caps the number of paths', () => {
    const many = Array.from({ length: 200 }, (_, i) => resolve(`/docs/${i}.md`))
    assert.equal(extractLaunchPaths(many, cwd).length, 50)
  })

  it('returns nothing for no arguments', () => {
    assert.deepEqual(extractLaunchPaths([], cwd), [])
  })
})
