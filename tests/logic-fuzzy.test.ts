import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fuzzyFilter, fuzzyMatch, scoreAlignment } from '../src/renderer/src/lib/logic/fuzzy.ts'

/** The matched characters, read back through the reported positions. */
function picked(text: string, positions: readonly number[]): string {
  return positions.map((p) => text.slice(p, p + (text.codePointAt(p)! > 0xffff ? 2 : 1))).join('')
}

function score(query: string, text: string): number {
  const m = fuzzyMatch(query, text)
  assert.ok(m, `expected "${query}" to match "${text}"`)
  return m.score
}

function order(query: string, texts: readonly string[]): string[] {
  return fuzzyFilter(query, texts, (t) => t).map((r) => r.item)
}

/** A small seeded generator (LCG), so the property test is reproducible. */
function seededRandom(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff
    return state / 0x7fffffff
  }
}

function randomString(next: () => number, alphabet: string, maxLength: number): string {
  const length = 1 + Math.floor(next() * maxLength)
  return Array.from({ length }, () => alphabet[Math.floor(next() * alphabet.length)]).join('')
}

/** Every alignment of `query` in `text` (ASCII only), by brute force. */
function allAlignments(query: string, text: string): number[][] {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  const out: number[][] = []
  const walk = (from: number, acc: number[]): void => {
    if (acc.length === q.length) {
      out.push(acc)
      return
    }
    for (let j = from; j < t.length; j++) {
      if (t[j] === q[acc.length]) walk(j + 1, [...acc, j])
    }
  }
  walk(0, [])
  return out
}

function paths(prefix: string): string[] {
  return Array.from({ length: 5000 }, (_, i) => `${prefix}project-${i % 41}/notes/${i % 13}/Meeting notes ${i}.md`)
}

/** Best of five runs of each query after a warm-up, to be robust to a busy machine. */
function slowestBestRun(items: readonly string[], queries: readonly string[]): { query: string; ms: number } {
  queries.forEach((q) => fuzzyFilter(q, items, (s) => s)) // warm up the JIT
  return queries
    .map((query) => {
      const runs = Array.from({ length: 5 }, () => {
        const started = performance.now()
        fuzzyFilter(query, items, (s) => s)
        return performance.now() - started
      })
      return { query, ms: Math.min(...runs) }
    })
    .reduce((a, b) => (b.ms > a.ms ? b : a))
}

describe('fuzzyMatch basics', () => {
  it('matches an empty query with score 0 and no positions', () => {
    // Arrange / Act
    const m = fuzzyMatch('', 'anything')

    // Assert
    assert.deepEqual(m, { score: 0, positions: [] })
  })

  it('treats a whitespace-only query as empty', () => {
    assert.deepEqual(fuzzyMatch('   ', 'notes.md'), { score: 0, positions: [] })
  })

  it('returns null when the query is not a subsequence', () => {
    assert.equal(fuzzyMatch('xyz', 'notes.md'), null)
    assert.equal(fuzzyMatch('ba', 'ab'), null)
  })

  it('returns null when the query is longer than the text', () => {
    assert.equal(fuzzyMatch('notes.md!', 'notes.md'), null)
  })

  it('returns null for any non-empty query against an empty text', () => {
    assert.equal(fuzzyMatch('a', ''), null)
  })

  it('is case-insensitive in both directions', () => {
    // Arrange
    const text = 'ReadMe.MD'

    // Act
    const lower = fuzzyMatch('readme', text)
    const upper = fuzzyMatch('README', text)

    // Assert
    assert.deepEqual(lower?.positions, [0, 1, 2, 3, 4, 5])
    assert.deepEqual(upper?.positions, lower?.positions)
  })

  it('ignores whitespace inside the query', () => {
    // Arrange
    const text = 'New file in folder'

    // Act
    const m = fuzzyMatch('new file', text)

    // Assert
    assert.ok(m)
    assert.equal(picked(text, m.positions).toLowerCase(), 'newfile')
  })

  it('reports ascending positions that point at the query characters', () => {
    // Arrange
    const cases: Array<[string, string]> = [
      ['smd', 'SimpleMD/src/main.ts'],
      ['abc', 'a_b_c_abc'],
      ['ttt', 'tttt'],
      ['ole', 'Toggle outline'],
      ['md', 'docs/notes/meeting-minutes.md'],
      ['aaa', 'a a a aaa']
    ]

    for (const [query, text] of cases) {
      // Act
      const m = fuzzyMatch(query, text)

      // Assert
      assert.ok(m, `${query} in ${text}`)
      assert.equal(m.positions.length, query.length)
      assert.equal(picked(text, m.positions).toLowerCase(), query.toLowerCase())
      m.positions.forEach((p, i) => i > 0 && assert.ok(p > m.positions[i - 1]))
    }
  })
})

describe('fuzzyMatch scoring', () => {
  it('prefers consecutive characters over scattered ones', () => {
    assert.ok(score('abc', 'xx abc') > score('abc', 'a x b x c'))
  })

  it('picks the contiguous occurrence when the text has both', () => {
    assert.deepEqual(fuzzyMatch('abc', 'aXbXc abc')?.positions, [6, 7, 8])
  })

  it('rewards word starts after space, -, _, /, \\ and .', () => {
    for (const sep of [' ', '-', '_', '/', '\\', '.']) {
      assert.ok(score('b', `a${sep}b`) > score('b', 'ab'), `separator ${JSON.stringify(sep)}`)
    }
  })

  it('treats a lower-to-upper case change as a word start', () => {
    // Arrange / Act
    const m = fuzzyMatch('fs', 'fooSettings')

    // Assert
    assert.deepEqual(m?.positions, [0, 3])
    assert.ok(score('s', 'fooSettings') > score('s', 'foosettings'))
  })

  it('aligns to word starts when they are available', () => {
    assert.deepEqual(fuzzyMatch('tl', 'Theme: Light')?.positions, [0, 7])
    assert.deepEqual(fuzzyMatch('gcm', 'git commit message')?.positions, [0, 4, 11])
  })

  it('rewards an early first match', () => {
    assert.ok(score('x', 'xaaaa') > score('x', 'aaaax'))
  })

  it('penalizes longer gaps more', () => {
    assert.ok(score('ab', 'a b') > score('ab', 'a      b'))
    assert.ok(score('ab', 'axb') > score('ab', 'axxxxxb'))
  })

  it('rewards the query typed as the start of the name', () => {
    assert.ok(score('not', 'notes.md') > score('not', 'my-notes.md'))
  })

  it('rewards an exact name, with or without the extension', () => {
    assert.ok(score('notes', 'notes.md') > score('notes', 'notes-old.md'))
    assert.ok(score('notes.md', 'notes.md') > score('notes.md', 'notes.md-copy.md'))
  })

  it('prefers matches in the base name of a path', () => {
    assert.deepEqual(order('read', ['readers/notes.md', 'docs/readme.md']), ['docs/readme.md', 'readers/notes.md'])
  })

  it('uses the base name even after a Windows separator', () => {
    assert.deepEqual(fuzzyMatch('plan', 'C:\\work\\plans\\plan.md')?.positions, [14, 15, 16, 17])
  })

  it('ranks commands the way a palette user expects', () => {
    // Arrange
    const commands = ['Toggle outline', 'Theme: Light', 'Toggle status bar', 'Export HTML']

    // Act
    const ranked = order('tl', commands)

    // Assert
    assert.equal(ranked[0], 'Theme: Light')
  })
})

describe('fuzzyMatch with Unicode', () => {
  it('folds accents so plain letters find accented ones', () => {
    // Arrange
    const text = 'Café notes.md'

    // Act
    const m = fuzzyMatch('cafe', text)

    // Assert
    assert.deepEqual(m?.positions, [0, 1, 2, 3])
    assert.ok(fuzzyMatch('CAFÉ', 'cafe'))
  })

  it('matches a decomposed (NFD) accent in the query against precomposed names', () => {
    // Arrange
    const decomposedE = `e${String.fromCharCode(0x301)}`

    // Act
    const m = fuzzyMatch(decomposedE, 'Café.md')
    const whole = fuzzyMatch(`caf${decomposedE}`, 'Café.md')

    // Assert
    assert.deepEqual(m?.positions, [3])
    assert.deepEqual(whole?.positions, [0, 1, 2, 3])
  })

  it('treats a decomposed accent in a name as part of its letter', () => {
    // Arrange: macOS-style NFD name next to the same name precomposed
    const nfd = `Cafe${String.fromCharCode(0x301)}.md`
    const nfc = 'Café.md'

    // Act
    const m = fuzzyMatch('cafe.md', nfd)

    // Assert: the run isn't broken, so both spellings score the same
    assert.deepEqual(m?.positions, [0, 1, 2, 3, 5, 6, 7])
    assert.equal(m?.score, score('cafe.md', nfc))
    assert.ok(fuzzyMatch('é', nfd))
  })

  it('ignores an accent mark in the query that composes with nothing', () => {
    // "x" + U+0301 has no precomposed form, so NFC leaves the mark on its own
    assert.deepEqual(fuzzyMatch(`x${String.fromCharCode(0x301)}y`, 'xy.md')?.positions, [0, 1])
  })

  it('reports UTF-16 positions after astral characters', () => {
    // Arrange
    const text = '😀 ab.md'

    // Act
    const m = fuzzyMatch('ab', text)

    // Assert
    assert.deepEqual(m?.positions, [3, 4])
    assert.equal(picked(text, m!.positions), 'ab')
  })

  it('matches emoji in the query', () => {
    // Arrange
    const text = 'Plan 🚀 launch'

    // Act
    const m = fuzzyMatch('🚀', text)

    // Assert
    assert.deepEqual(m?.positions, [5])
  })

  it('matches CJK text', () => {
    assert.deepEqual(fuzzyMatch('日本', 'メモ/日本語.md')?.positions, [3, 4])
  })

  it('handles letters whose lower case is longer (Turkish dotted I)', () => {
    assert.deepEqual(fuzzyMatch('ist', 'İstanbul.md')?.positions, [0, 1, 2])
  })

  it('treats Cyrillic case-insensitively', () => {
    assert.ok(fuzzyMatch('заметки', 'Заметки.md'))
  })
})

describe('fuzzyMatch on large inputs', () => {
  it('matches a long query against a long name through the DP band', () => {
    // Arrange
    const text = 'folder12/sub-3/Some File Name 1234 with extra words.md'
    const query = 'folder sub some file name'

    // Act
    const m = fuzzyMatch(query, text)

    // Assert
    assert.ok(m)
    assert.equal(picked(text, m.positions).toLowerCase(), query.replace(/ /g, ''))
  })

  it('falls back to a greedy alignment for huge texts and stays correct', () => {
    // Arrange
    const text = `${'lorem ipsum '.repeat(20_000)}needle in the haystack`
    const query = 'needle haystack'

    // Act
    const started = performance.now()
    const m = fuzzyMatch(query, text)
    const elapsed = performance.now() - started

    // Assert
    assert.ok(m)
    assert.equal(picked(text, m.positions), 'needlehaystack')
    assert.ok(elapsed < 1000, `took ${elapsed.toFixed(1)} ms`)
  })

  it('rejects a huge non-matching text quickly', () => {
    assert.equal(fuzzyMatch('zzz', 'a'.repeat(1_000_000)), null)
  })
})

describe('fuzzyMatch optimality', () => {
  it('finds the best alignment where a weaker path has the stronger run start', () => {
    // Arrange: a greedy "best path per cell" DP scores this 121
    const query = '_aBAA'
    const text = 'aab_.1AaBAA-'

    // Act
    const m = fuzzyMatch(query, text)

    // Assert
    assert.equal(m?.score, 131)
    assert.deepEqual(m?.positions, [3, 6, 8, 9, 10])
  })

  it('always scores as well as the best alignment found by brute force', () => {
    // Arrange
    const next = seededRandom(20261018)
    let compared = 0

    for (let c = 0; c < 4000; c++) {
      const text = randomString(next, 'aAbB_-./1 ', 12)
      const query = randomString(next, 'aAbB_-./1', 5)

      // Act
      const m = fuzzyMatch(query, text)
      const scores = allAlignments(query, text).map((pos) => scoreAlignment(query, text, pos) ?? -Infinity)

      // Assert
      if (scores.length === 0) {
        assert.equal(m, null, `"${query}" in "${text}"`)
        continue
      }
      compared++
      assert.ok(m, `"${query}" in "${text}"`)
      assert.equal(m.score, Math.max(...scores), `"${query}" in "${text}"`)
      assert.equal(scoreAlignment(query, text, m.positions), m.score)
    }
    assert.ok(compared > 500, `only ${compared} matching cases`)
  })
})

describe('scoreAlignment', () => {
  it('gives the score fuzzyMatch reports for its own alignment', () => {
    // Arrange
    const m = fuzzyMatch('rdme', 'docs/README.md')!

    // Act
    const s = scoreAlignment('rdme', 'docs/README.md', m.positions)

    // Assert
    assert.equal(s, m.score)
  })

  it('returns null for positions that are not an alignment', () => {
    assert.equal(scoreAlignment('ab', 'ab', [1, 0]), null)
    assert.equal(scoreAlignment('ab', 'ab', [0]), null)
    assert.equal(scoreAlignment('ab', 'ab', [0, 0]), null)
    assert.equal(scoreAlignment('ab', 'ab', [0, 5]), null)
    assert.equal(scoreAlignment('ab', 'xb', [0, 1]), null)
  })

  it('accepts UTF-16 positions after astral characters and an empty query', () => {
    assert.equal(scoreAlignment('ab', '😀 ab', [3, 4]), fuzzyMatch('ab', '😀 ab')?.score)
    assert.equal(scoreAlignment('ab', '😀 ab', [2, 3]), null)
    assert.equal(scoreAlignment('  ', 'abc', []), 0)
  })
})

describe('fuzzyFilter', () => {
  const files = ['notes.md', 'readme.md', 'docs/notes-old.md', 'todo.md', 'archive/n-o-t-e-s.md']

  it('returns the first `limit` items in order for an empty query', () => {
    // Act
    const out = fuzzyFilter('', files, (f) => f, 3)

    // Assert
    assert.deepEqual(out.map((r) => r.item), ['notes.md', 'readme.md', 'docs/notes-old.md'])
    assert.ok(out.every((r) => r.match.score === 0 && r.match.positions.length === 0))
  })

  it('returns matches best-first and drops non-matches', () => {
    // Act
    const out = order('notes', files)

    // Assert
    assert.deepEqual(out, ['notes.md', 'docs/notes-old.md', 'archive/n-o-t-e-s.md'])
  })

  it('keeps input order for equal scores', () => {
    // Arrange
    const items = [
      { id: 1, name: 'same.md' },
      { id: 2, name: 'same.md' },
      { id: 3, name: 'same.md' }
    ]

    // Act
    const out = fuzzyFilter('same', items, (i) => i.name)

    // Assert
    assert.deepEqual(out.map((r) => r.item.id), [1, 2, 3])
  })

  it('caps the result at `limit`', () => {
    // Arrange
    const items = Array.from({ length: 200 }, (_, i) => `note-${i}.md`)

    // Act / Assert
    assert.equal(fuzzyFilter('note', items, (s) => s).length, 50)
    assert.equal(fuzzyFilter('note', items, (s) => s, 7).length, 7)
  })

  it('returns nothing for a zero or negative limit', () => {
    assert.deepEqual(fuzzyFilter('n', files, (f) => f, 0), [])
    assert.deepEqual(fuzzyFilter('', files, (f) => f, -3), [])
  })

  it('handles an empty item list', () => {
    assert.deepEqual(fuzzyFilter('x', [], (f: string) => f), [])
  })

  it('does not modify the items array', () => {
    // Arrange
    const items = ['b.md', 'a.md', 'ab.md']
    const copy = [...items]

    // Act
    fuzzyFilter('a', items, (s) => s)

    // Assert
    assert.deepEqual(items, copy)
  })

  it('filters 5,000 paths well within a frame', () => {
    // Arrange
    const items = paths('')

    // Act
    const slowest = slowestBestRun(items, ['m', 'mtg', 'notes meeting', 'p7/n', 'zzz'])

    // Assert (target is < 10 ms; the bound is generous for slow CI machines)
    assert.ok(slowest.ms < 40, `"${slowest.query}" took ${slowest.ms.toFixed(2)} ms`)
  })

  it('filters 5,000 paths with accented and CJK folders just as fast', () => {
    for (const prefix of ['C:/Users/José Müller/Documents/', 'C:/Users/田中/ドキュメント/']) {
      // Arrange
      const items = paths(prefix)

      // Act
      const slowest = slowestBestRun(items, ['m', 'mtg', 'notes meeting', 'jose', 'zzz'])

      // Assert (target is < 10 ms; the bound is generous for slow CI machines)
      assert.ok(slowest.ms < 40, `${prefix} "${slowest.query}" took ${slowest.ms.toFixed(2)} ms`)
    }
  })

  it('still finds accented names among non-ASCII paths', () => {
    // Arrange
    const items = ['C:/Users/田中/メモ/Résumé.md', 'C:/Users/田中/メモ/notes.md']

    // Act
    const found = order('resume', items)

    // Assert
    assert.deepEqual(found, ['C:/Users/田中/メモ/Résumé.md'])
  })
})
