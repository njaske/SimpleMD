import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { medianMs } from './support/logic-timing.ts'
import { changedLineRanges, countChangedLines, mergeRanges } from '../src/renderer/src/lib/logic/changes.ts'

const lines = (...ls: string[]): string => ls.join('\n')

/** `count` distinct, realistic-looking lines, joined. */
const generated = (count: number, tag: string): string =>
  Array.from({ length: count }, (_, i) => `${tag} paragraph ${i}: some words that vary ${(i * 7) % 13}`).join('\n')

describe('changedLineRanges: no change', () => {
  it('returns [] for identical texts', () => {
    assert.deepEqual(changedLineRanges('a\nb', 'a\nb'), [])
    assert.deepEqual(changedLineRanges('', ''), [])
  })

  it('ignores CRLF vs LF and old Mac CR line endings', () => {
    assert.deepEqual(changedLineRanges('a\r\nb\r\nc\r\n', 'a\nb\nc\n'), [])
    assert.deepEqual(changedLineRanges('a\rb', 'a\nb'), [])
  })

  it('ignores trailing whitespace changes', () => {
    assert.deepEqual(changedLineRanges('a  \nb\t\nc', 'a\nb\nc   '), [])
  })

  it('ignores a missing or added final newline', () => {
    assert.deepEqual(changedLineRanges('a\nb', 'a\nb\n'), [])
    assert.deepEqual(changedLineRanges('a\nb\n', 'a\nb'), [])
  })
})

describe('changedLineRanges: edits', () => {
  it('reports an edited line', () => {
    assert.deepEqual(changedLineRanges(lines('a', 'b', 'c'), lines('a', 'B', 'c')), [{ from: 1, to: 2 }])
  })

  it('reports leading-whitespace (indentation) changes', () => {
    assert.deepEqual(changedLineRanges(lines('- a', '- b'), lines('- a', '  - b')), [{ from: 1, to: 2 }])
  })

  it('reports inserted lines in the middle', () => {
    // Arrange
    const before = lines('a', 'b', 'c')
    const after = lines('a', 'new 1', 'new 2', 'b', 'c')

    // Act / Assert
    assert.deepEqual(changedLineRanges(before, after), [{ from: 1, to: 3 }])
  })

  it('reports lines appended at the end', () => {
    assert.deepEqual(changedLineRanges('a\nb\n', 'a\nb\nc\nd\n'), [{ from: 2, to: 4 }])
  })

  it('reports lines added at the start', () => {
    assert.deepEqual(changedLineRanges('b\nc', 'a\nb\nc'), [{ from: 0, to: 1 }])
  })

  it('reports a replacement of several lines by fewer', () => {
    assert.deepEqual(changedLineRanges(lines('a', 'x', 'y', 'z', 'b'), lines('a', 'q', 'b')), [{ from: 1, to: 2 }])
  })

  it('reports separate edits as separate sorted ranges', () => {
    // Arrange
    const before = lines('1', '2', '3', '4', '5', '6', '7', '8')
    const after = lines('1', 'two', '3', '4', '5', '6', 'seven', '8')

    // Act / Assert
    assert.deepEqual(changedLineRanges(before, after), [{ from: 1, to: 2 }, { from: 6, to: 7 }])
  })

  it('merges edits on adjacent lines into one range', () => {
    assert.deepEqual(changedLineRanges(lines('a', 'b', 'c', 'd'), lines('a', 'B', 'C', 'd')), [{ from: 1, to: 3 }])
  })

  it('reports everything when the whole text is new', () => {
    assert.deepEqual(changedLineRanges('', 'one\ntwo\nthree'), [{ from: 0, to: 3 }])
    assert.deepEqual(changedLineRanges('old', 'new\nnewer'), [{ from: 0, to: 2 }])
  })

  it('handles non-ASCII lines', () => {
    assert.deepEqual(changedLineRanges('café\n日本\n😀', 'café\n日本語\n😀'), [{ from: 1, to: 2 }])
  })
})

describe('changedLineRanges: pure deletions', () => {
  it('marks the line that now follows removed text', () => {
    assert.deepEqual(changedLineRanges(lines('a', 'b', 'c', 'd'), lines('a', 'd')), [{ from: 1, to: 2 }])
  })

  it('clamps a deletion at the end to the last line', () => {
    assert.deepEqual(changedLineRanges(lines('a', 'b', 'c'), lines('a', 'b')), [{ from: 1, to: 2 }])
  })

  it('marks line 0 when the start was removed', () => {
    assert.deepEqual(changedLineRanges(lines('x', 'a', 'b'), lines('a', 'b')), [{ from: 0, to: 1 }])
  })

  it('marks line 0 when everything was removed', () => {
    assert.deepEqual(changedLineRanges('a\nb\nc', ''), [{ from: 0, to: 1 }])
  })

  it('marks a removed blank line', () => {
    assert.deepEqual(changedLineRanges('a\n\nb', 'a\nb'), [{ from: 1, to: 2 }])
  })

  it('merges a deletion marker with an edit right after it', () => {
    // Arrange: "b" removed, then "d" (now line 2) edited.
    const before = lines('a', 'b', 'c', 'd')
    const after = lines('a', 'c', 'D')

    // Act / Assert
    assert.deepEqual(changedLineRanges(before, after), [{ from: 1, to: 3 }])
  })
})

describe('changedLineRanges: large documents', () => {
  it('finds a few edits in a 60,000-line document quickly', () => {
    // Arrange
    const base = Array.from({ length: 60_000 }, (_, i) => `line ${i} of a long generated document`)
    const edited = base.map((l, i) => (i === 10 || i === 30_000 ? `${l} (edited)` : l))
    edited.splice(50_000, 0, 'inserted A', 'inserted B')

    const [before, after] = [base.join('\n'), edited.join('\n')]

    // Act
    const ranges = changedLineRanges(before, after)
    const ms = medianMs(() => changedLineRanges(before, after), 3)

    // Assert
    assert.deepEqual(ranges, [{ from: 10, to: 11 }, { from: 30_000, to: 30_001 }, { from: 50_000, to: 50_002 }])
    assert.ok(ms < 1000, `took ${ms.toFixed(1)} ms`)
  })

  it('gives up gracefully on huge, completely different texts', () => {
    // Arrange: no shared lines, so a precise diff would be quadratic.
    const before = Array.from({ length: 40_000 }, (_, i) => `a${i}`).join('\n')
    const after = Array.from({ length: 40_000 }, (_, i) => `b${i}`).join('\n')

    // Act
    const ranges = changedLineRanges(before, after)
    const ms = medianMs(() => changedLineRanges(before, after), 3)

    // Assert
    assert.deepEqual(ranges, [{ from: 0, to: 40_000 }])
    assert.ok(ms < 3000, `took ${ms.toFixed(1)} ms`)
  })

  it('marks a full rewrite of a typical 5,000-line file without stalling the UI', () => {
    // Arrange: an agent rewrote every line
    const before = generated(5000, 'old')
    const after = generated(5000, 'new')

    // Act
    const ranges = changedLineRanges(before, after)
    const ms = medianMs(() => changedLineRanges(before, after))

    // Assert (typically a few ms; the bound is generous for busy machines yet far below
    // what a quadratic diff of 10,000 lines takes)
    assert.deepEqual(ranges, [{ from: 0, to: 5000 }])
    assert.ok(ms < 200, `took ${ms.toFixed(1)} ms`)
  })

  it('reports scattered edits exactly, even when there are thousands of them', () => {
    // Arrange: every 10th line of a 20,000-line document edited
    const base = generated(20_000, 'line').split('\n')
    const edited = base.map((l, i) => (i % 10 === 0 ? `${l} (edited)` : l))

    const [before, after] = [base.join('\n'), edited.join('\n')]

    // Act
    const ranges = changedLineRanges(before, after)
    const ms = medianMs(() => changedLineRanges(before, after), 3)

    // Assert
    assert.equal(ranges.length, 2000)
    assert.ok(ranges.every((r, k) => r.from === k * 10 && r.to === k * 10 + 1))
    assert.ok(ms < 500, `took ${ms.toFixed(1)} ms`)
  })

  it('reports only the rewritten half when an agent replaces the second half', () => {
    // Arrange
    const base = generated(6000, 'kept').split('\n')
    const after = [...base.slice(0, 3000), ...generated(3000, 'fresh').split('\n')]

    // Act
    const ranges = changedLineRanges(base.join('\n'), after.join('\n'))

    // Assert
    assert.deepEqual(ranges, [{ from: 3000, to: 6000 }])
  })

  it('marks a moved block and the spot it left', () => {
    // Arrange: the first half moved below the second
    const base = generated(2000, 'para').split('\n')
    const after = [...base.slice(1000), ...base.slice(0, 1000)]

    // Act
    const ranges = changedLineRanges(base.join('\n'), after.join('\n'))

    // Assert: one half stays put, the other is reported as new
    assert.equal(countChangedLines(ranges), 1000 + (ranges.length > 1 ? 1 : 0))
  })

  it('finds edits in a document made of repeated lines (no unique lines to split at)', () => {
    // Arrange: blank lines, rules and table rows repeat throughout
    const base = Array.from({ length: 4000 }, (_, i) => ['', '---', '| a | b |', 'text'][i % 4])
    const edited = base.map((l, i) => (i % 400 === 3 ? 'changed text' : l))

    // Act
    const ranges = changedLineRanges(base.join('\n'), edited.join('\n'))

    // Assert
    assert.deepEqual(ranges, Array.from({ length: 10 }, (_, k) => ({ from: k * 400 + 3, to: k * 400 + 4 })))
  })

  it('approximates a big rewrite of repeated lines line by line', () => {
    // Arrange: no unique lines and more edits than a precise diff will take on
    const base = Array.from({ length: 3000 }, (_, i) => ['alpha', 'beta', ''][i % 3])
    const edited = base.map((l, i) => (i % 3 === 0 ? `alpha ${i % 7}` : l))

    // Act
    const ranges = changedLineRanges(base.join('\n'), edited.join('\n'))

    // Assert: exactly the 1,000 rewritten lines, each on its own
    assert.equal(ranges.length, 1000)
    assert.ok(ranges.every((r, k) => r.from === k * 3 && r.to === k * 3 + 1))
  })
})

describe('mergeRanges', () => {
  it('sorts and merges overlapping and touching ranges', () => {
    assert.deepEqual(
      mergeRanges([{ from: 5, to: 7 }, { from: 0, to: 2 }, { from: 2, to: 3 }, { from: 6, to: 9 }]),
      [{ from: 0, to: 3 }, { from: 5, to: 9 }]
    )
  })

  it('drops empty ranges and keeps gaps', () => {
    assert.deepEqual(mergeRanges([{ from: 4, to: 4 }, { from: 1, to: 2 }, { from: 3, to: 4 }]), [
      { from: 1, to: 2 },
      { from: 3, to: 4 }
    ])
  })

  it('does not modify its input', () => {
    // Arrange
    const input = [{ from: 3, to: 5 }, { from: 0, to: 4 }]
    const copy = structuredClone(input)

    // Act
    const out = mergeRanges(input)

    // Assert
    assert.deepEqual(input, copy)
    assert.notEqual(out[0], input[1])
  })
})

describe('countChangedLines', () => {
  it('sums the lines covered by the ranges', () => {
    assert.equal(countChangedLines([{ from: 0, to: 2 }, { from: 5, to: 6 }]), 3)
  })

  it('is 0 for no ranges and ignores inverted ones', () => {
    assert.equal(countChangedLines([]), 0)
    assert.equal(countChangedLines([{ from: 4, to: 2 }]), 0)
  })
})
