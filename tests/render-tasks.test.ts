import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { setupRenderEnv } from './render-env.ts'

setupRenderEnv()
const { toggleTaskAt, taskLines } = await import('../src/renderer/src/lib/reader/tasks.ts')

describe('toggleTaskAt', () => {
  it('checks and unchecks bullet tasks with any marker', () => {
    // Arrange
    const md = '- [ ] a\n* [x] b\n+ [X] c'
    // Act + Assert
    assert.equal(toggleTaskAt(md, 0, true), '- [x] a\n* [x] b\n+ [X] c')
    assert.equal(toggleTaskAt(md, 1, false), '- [ ] a\n* [ ] b\n+ [X] c')
    assert.equal(toggleTaskAt(md, 2, false), '- [ ] a\n* [x] b\n+ [ ] c')
  })

  it('handles numbered, nested and quoted items', () => {
    assert.equal(toggleTaskAt('1. [ ] one\n2) [ ] two', 1, true), '1. [ ] one\n2) [x] two')
    assert.equal(toggleTaskAt('- [ ] top\n    - [ ] deep', 1, true), '- [ ] top\n    - [x] deep')
    assert.equal(toggleTaskAt('> [!TIP]\n> - [ ] in callout', 1, true), '> [!TIP]\n> - [x] in callout')
  })

  it('keeps CRLF line endings and the rest of the line', () => {
    const md = '- [ ] keep [x] this text\r\n- [ ] next\r\n'
    assert.equal(toggleTaskAt(md, 0, true), '- [x] keep [x] this text\r\n- [ ] next\r\n')
  })

  it('returns null for lines that are not tasks, out of range, or inside code fences', () => {
    const md = 'text\n- plain item\n```\n- [ ] in code\n```\n- [ ] real'
    assert.equal(toggleTaskAt(md, 0, true), null)
    assert.equal(toggleTaskAt(md, 1, true), null)
    assert.equal(toggleTaskAt(md, 3, true), null)
    assert.equal(toggleTaskAt(md, 99, true), null)
    assert.equal(toggleTaskAt(md, -1, true), null)
    assert.equal(toggleTaskAt('- [ ]', 0, true), '- [x]')
    assert.equal(toggleTaskAt('- [ ]x', 0, true), null)
  })

  it('returns the same text when the box already has that state', () => {
    assert.equal(toggleTaskAt('- [x] done', 0, true), '- [x] done')
  })
})

describe('taskLines', () => {
  it('lists task items outside code fences', () => {
    assert.deepEqual(taskLines('- [ ] a\n```\n- [ ] b\n```\n  1. [x] c'), [0, 4])
  })
})
