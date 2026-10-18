import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  type BufferState,
  isAbsolutePath,
  MAX_RECOVERY_CHARS,
  recoveryEntries,
  sanitizeRecovered
} from '../src/renderer/src/lib/logic/recovery.ts'

const NOW = 1_700_000_000_000

function file(path: string, content: string, saved: string): BufferState {
  return { id: path, path, title: path.split(/[\\/]/).pop() ?? path, content, saved }
}

function untitled(n: number, content: string): BufferState {
  return { id: `untitled:${n}`, path: null, title: 'Untitled', content, saved: '' }
}

describe('recoveryEntries', () => {
  it('keeps only buffers that differ from their saved text', () => {
    // Arrange
    const buffers = [file('/a.md', 'edited', 'original'), file('/b.md', 'same', 'same')]

    // Act
    const out = recoveryEntries(buffers, NOW)

    // Assert
    assert.deepEqual(out, [{ id: '/a.md', path: '/a.md', title: 'a.md', content: 'edited', savedAt: NOW }])
  })

  it('keeps untitled documents only when they have real text', () => {
    // Arrange
    const buffers = [untitled(1, ''), untitled(2, '  \n\t'), untitled(3, '# Draft')]

    // Act
    const out = recoveryEntries(buffers, NOW)

    // Assert
    assert.deepEqual(out.map((e) => e.id), ['untitled:3'])
    assert.equal(out[0].path, null)
  })

  it('keeps a file whose unsaved edit is whitespace or an emptied document', () => {
    // Act
    const out = recoveryEntries([file('/w.md', 'text  ', 'text'), file('/e.md', '', 'text')], NOW)

    // Assert
    assert.deepEqual(out.map((e) => e.id), ['/w.md', '/e.md'])
  })

  it('stamps every entry with `now` and follows buffer order', () => {
    // Arrange
    const buffers = [untitled(2, 'two'), file('/z.md', 'z!', 'z'), untitled(1, 'one')]

    // Act
    const out = recoveryEntries(buffers, NOW)

    // Assert
    assert.deepEqual(out.map((e) => e.id), ['untitled:2', '/z.md', 'untitled:1'])
    assert.ok(out.every((e) => e.savedAt === NOW))
  })

  it('returns fresh objects without the saved text and leaves the input alone', () => {
    // Arrange
    const buffers = [file('/a.md', 'new', 'old')]
    const copy = structuredClone(buffers)

    // Act
    const [entry] = recoveryEntries(buffers, NOW)

    // Assert
    assert.ok(!('saved' in entry))
    assert.deepEqual(buffers, copy)
  })

  it('keeps a duplicated id once', () => {
    const out = recoveryEntries([file('/a.md', 'one', ''), file('/a.md', 'two', '')], NOW)
    assert.deepEqual(out.map((e) => e.content), ['one'])
  })

  it('returns [] for no buffers', () => {
    assert.deepEqual(recoveryEntries([], NOW), [])
  })

  it('drops the largest buffers first to stay under the size cap', () => {
    // Arrange
    const big = 'x'.repeat(Math.floor(MAX_RECOVERY_CHARS * 0.6))
    const medium = 'y'.repeat(Math.floor(MAX_RECOVERY_CHARS * 0.5))
    const small = 'z'.repeat(1000)
    const buffers = [untitled(1, small), untitled(2, big), untitled(3, medium)]

    // Act
    const out = recoveryEntries(buffers, NOW)

    // Assert
    assert.deepEqual(out.map((e) => e.id), ['untitled:1', 'untitled:3'])
    assert.ok(out.reduce((n, e) => n + e.content.length, 0) <= MAX_RECOVERY_CHARS)
  })

  it('drops a single buffer that is larger than the whole cap', () => {
    const out = recoveryEntries([untitled(1, 'x'.repeat(MAX_RECOVERY_CHARS + 1)), untitled(2, 'keep')], NOW)
    assert.deepEqual(out.map((e) => e.id), ['untitled:2'])
  })

  it('keeps everything that fits exactly at the cap', () => {
    const half = 'x'.repeat(MAX_RECOVERY_CHARS / 2)
    assert.equal(recoveryEntries([untitled(1, half), untitled(2, half)], NOW).length, 2)
  })

  it('drops the later of two equally large buffers first', () => {
    const big = 'x'.repeat(MAX_RECOVERY_CHARS * 0.75)
    const out = recoveryEntries([untitled(1, big), untitled(2, big)], NOW)
    assert.deepEqual(out.map((e) => e.id), ['untitled:1'])
  })
})

describe('isAbsolutePath', () => {
  it('accepts POSIX, Windows drive and UNC paths', () => {
    for (const p of ['/home/me/a.md', 'C:\\Users\\me\\a.md', 'd:/notes/a.md', '\\\\server\\share\\a.md']) {
      assert.ok(isAbsolutePath(p), p)
    }
  })

  it('rejects relative and malformed paths', () => {
    for (const p of ['a.md', './a.md', '..\\a.md', 'C:a.md', '\\\\server', '', 'untitled:1']) {
      assert.ok(!isAbsolutePath(p), p)
    }
  })
})

describe('sanitizeRecovered', () => {
  const good = { id: '/a.md', path: '/a.md', title: 'a.md', content: 'text', savedAt: NOW }
  const draft = { id: 'untitled:4', path: null, title: 'Untitled', content: 'draft', savedAt: NOW }

  it('returns [] for anything that is not an array', () => {
    for (const input of [null, undefined, 42, 'x', {}, { length: 1, 0: good }]) {
      assert.deepEqual(sanitizeRecovered(input), [])
    }
  })

  it('keeps well-formed file and untitled entries', () => {
    assert.deepEqual(sanitizeRecovered([good, draft]), [good, draft])
  })

  it('keeps Windows paths', () => {
    const win = { ...good, id: 'C:\\notes\\a.md', path: 'C:\\notes\\a.md' }
    assert.deepEqual(sanitizeRecovered([win]), [win])
  })

  it('drops entries with the wrong shape', () => {
    // Arrange
    const bad = [
      null,
      'string',
      [good],
      { ...good, id: 7 },
      { ...good, title: undefined },
      { ...good, content: null },
      { ...good, savedAt: '1' },
      { ...good, savedAt: Number.NaN },
      { ...good, savedAt: Number.POSITIVE_INFINITY },
      { ...good, savedAt: -1 },
      { id: '/a.md', path: '/a.md', title: 'a.md', savedAt: NOW }
    ]

    // Act / Assert
    assert.deepEqual(sanitizeRecovered(bad), [])
  })

  it('drops ids that are neither absolute paths nor untitled:<digits>', () => {
    const ids = ['a.md', 'untitled:', 'untitled:x', 'untitled:-1', 'untitled:1 ', 'file:///a.md', '/a\0.md']
    const input = ids.map((id) => ({ ...good, id, path: id.startsWith('untitled') ? null : id }))
    assert.deepEqual(sanitizeRecovered(input), [])
  })

  it('drops file entries whose path does not equal the id', () => {
    assert.deepEqual(sanitizeRecovered([{ ...good, path: '/b.md' }, { ...good, path: null }]), [])
  })

  it('drops untitled entries that carry a path', () => {
    assert.deepEqual(sanitizeRecovered([{ ...draft, path: '/x.md' }]), [])
  })

  it('strips unknown fields and returns fresh objects', () => {
    // Arrange
    const extra = { ...good, evil: '<script>', __proto__: { polluted: true } }

    // Act
    const [entry] = sanitizeRecovered([extra])

    // Assert
    assert.deepEqual(Object.keys(entry).sort(), ['content', 'id', 'path', 'savedAt', 'title'])
    assert.notEqual(entry, extra)
  })

  it('keeps the first of duplicate ids', () => {
    const out = sanitizeRecovered([good, { ...good, content: 'second' }])
    assert.deepEqual(out.map((e) => e.content), ['text'])
  })

  it('never throws, even on hostile getters', () => {
    // Arrange
    const hostile = Object.defineProperty({}, 'id', {
      get() {
        throw new Error('boom')
      },
      enumerable: true
    })
    const hostileArray = new Proxy([good], {
      get() {
        throw new Error('boom')
      }
    })

    // Act / Assert
    assert.deepEqual(sanitizeRecovered([hostile, good]), [good])
    assert.deepEqual(sanitizeRecovered(hostileArray), [])
  })

  it('round-trips what recoveryEntries produces', () => {
    // Arrange
    const entries = recoveryEntries([file('/a.md', 'new', 'old'), untitled(9, 'draft')], NOW)

    // Act / Assert
    assert.deepEqual(sanitizeRecovered(JSON.parse(JSON.stringify(entries))), entries)
  })
})
