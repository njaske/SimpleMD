// Fuzzy matching for Quick Open and the command palette. An fzf-style scorer: the best
// alignment of the query in the text is found with a small dynamic program, and every
// candidate alignment is scored by one function so the DP and the fallbacks agree.

export interface FuzzyMatch {
  /** Higher is better. Only comparable between matches of the same query. */
  score: number
  /** Indexes into the matched text of each query character, for highlighting. */
  positions: number[]
}

const SCORE_MATCH = 16
const GAP_START = 3
const GAP_EXTENSION = 1
/** Floor for the bonus of a character that continues a run, so runs beat scattered hits. */
const BONUS_CONSECUTIVE = 5
const BONUS_AFTER_SPACE = 10
const BONUS_AFTER_SEPARATOR = 9
const BONUS_AFTER_PUNCTUATION = 8
const BONUS_CAMEL = 7
/** Matching a non-word character (".", "-", " ") is worth as much as a word start. */
const BONUS_NON_WORD = 8
/** Added to every character of the base name, so "read" prefers docs/readme.md over readers/x.md. */
const BONUS_BASENAME = 4
const FIRST_CHAR_MULTIPLIER = 2
const LEADING_GAP_PENALTY = 1
const MAX_LEADING_GAP_PENALTY = 8
/** The whole query typed as the start of the name (or of the text). */
const BONUS_PREFIX = 12
/** The query is the whole name, with or without its extension. */
const BONUS_EXACT = 20
/** Above this many DP cells (query × text) a greedy alignment is used instead. */
const MAX_DP_CELLS = 120_000
/** "No alignment ends here" in the integer DP table. */
const NONE = -1_000_000_000

// Character classes, ordered so every class from LOWER up is a word character.
// (Plain constants rather than an enum: node's type stripping can't run enums.)
const WHITE = 0
const SEPARATOR = 1
const PUNCTUATION = 2
const LOWER = 3
const UPPER = 4
const DIGIT = 5
const LETTER = 6

const DOT = 46
const ASCII_ONLY = /^[\x00-\x7f]*$/
const COMBINING_MARKS = /[\u0300-\u036f]/g
const WHITESPACE = /\s/

/** The text as folded code points plus what scoring needs, in scratch buffers indexed by
 *  character (code point), not UTF-16 unit; `offsets` maps back for highlighting. Valid
 *  until the next text is prepared. */
interface Prepared {
  length: number
  folded: Int32Array
  offsets: Int32Array
  bonus: Int32Array
  /** Index where the base name starts; 0 when the text has no path. */
  baseStart: number
  /** Index where the base name's extension starts, or `length` when it has none. */
  extStart: number
}

// Scratch buffers reused across calls: the hot loop runs once per Quick Open item, and
// allocating per item would dominate the cost. Grown on demand, never shrunk.
let textCap = 0
let foldedBuf = new Int32Array(0)
let offsetBuf = new Int32Array(0)
let classBuf = new Int32Array(0)
let bonusBuf = new Int32Array(0)
let cellCap = 0
let scoreBuf = new Int32Array(0)
let prevBuf = new Int32Array(0)
let runBuf = new Int32Array(0)

function ensureTextCapacity(length: number): void {
  if (length <= textCap) return
  textCap = Math.max(length, textCap * 2, 256)
  foldedBuf = new Int32Array(textCap)
  offsetBuf = new Int32Array(textCap)
  classBuf = new Int32Array(textCap)
  bonusBuf = new Int32Array(textCap)
}

function ensureCellCapacity(cells: number): void {
  if (cells <= cellCap) return
  cellCap = Math.max(cells, cellCap * 2, 4096)
  scoreBuf = new Int32Array(cellCap)
  prevBuf = new Int32Array(cellCap)
  runBuf = new Int32Array(cellCap)
}

/** Lower-case one character and drop its accents ("É" → "e"), as a single code point. */
function foldCode(ch: string): number {
  const code = ch.codePointAt(0) ?? 0
  if (code < 128) return code >= 65 && code <= 90 ? code + 32 : code
  const lower = ch.toLowerCase()
  const base = lower.normalize('NFD').replace(COMBINING_MARKS, '')
  const pick = [...base].length === 1 ? base : [...lower].length === 1 ? lower : ch
  return pick.codePointAt(0) ?? code
}

function classOfAscii(code: number): number {
  if (code >= 97 && code <= 122) return LOWER
  if (code >= 65 && code <= 90) return UPPER
  if (code >= 48 && code <= 57) return DIGIT
  if (code === 32 || code === 9) return WHITE
  if (code === 47 || code === 92) return SEPARATOR
  return PUNCTUATION
}

function classOf(ch: string): number {
  const code = ch.codePointAt(0) ?? 0
  if (code < 128) return classOfAscii(code)
  if (WHITESPACE.test(ch)) return WHITE
  if (/\p{N}/u.test(ch)) return DIGIT
  if (ch.toLowerCase() !== ch) return UPPER
  if (ch.toUpperCase() !== ch) return LOWER
  return /[\p{L}\p{M}]/u.test(ch) ? LETTER : PUNCTUATION
}

/** Bonus for matching a character of class `cls` that follows one of class `prev`. */
function bonusFor(prev: number, cls: number): number {
  if (cls < LOWER) return BONUS_NON_WORD
  if (prev === WHITE) return BONUS_AFTER_SPACE
  if (prev === SEPARATOR) return BONUS_AFTER_SEPARATOR
  if (prev === PUNCTUATION) return BONUS_AFTER_PUNCTUATION
  if (prev === LOWER && cls === UPPER) return BONUS_CAMEL
  if (prev !== DIGIT && cls === DIGIT) return BONUS_CAMEL
  return 0
}

/** Start of the last path segment, ignoring trailing separators ("docs/" → "docs"). */
function baseNameStart(length: number): number {
  let end = length
  while (end > 0 && classBuf[end - 1] === SEPARATOR) end--
  for (let i = end - 1; i >= 0; i--) {
    if (classBuf[i] === SEPARATOR) return i + 1
  }
  return 0
}

/** Bonuses, base name and extension, once folded/offsets/classes are filled in. */
function finishPrepare(length: number): Prepared {
  const baseStart = baseNameStart(length)
  for (let i = 0; i < length; i++) {
    const b = bonusFor(i === 0 ? WHITE : classBuf[i - 1], classBuf[i])
    bonusBuf[i] = i >= baseStart ? b + BONUS_BASENAME : b
  }
  let extStart = length
  for (let i = length - 1; i > baseStart; i--) {
    if (foldedBuf[i] === DOT) {
      extStart = i
      break
    }
  }
  return { length, folded: foldedBuf, offsets: offsetBuf, bonus: bonusBuf, baseStart, extStart }
}

function prepareAscii(text: string): Prepared {
  const length = text.length
  ensureTextCapacity(length)
  for (let i = 0; i < length; i++) {
    const code = text.charCodeAt(i)
    foldedBuf[i] = code >= 65 && code <= 90 ? code + 32 : code
    offsetBuf[i] = i
    classBuf[i] = classOfAscii(code)
  }
  return finishPrepare(length)
}

function prepareUnicode(text: string): Prepared {
  const chars = [...text]
  ensureTextCapacity(chars.length)
  let offset = 0
  chars.forEach((ch, i) => {
    foldedBuf[i] = foldCode(ch)
    offsetBuf[i] = offset
    classBuf[i] = classOf(ch)
    offset += ch.length
  })
  return finishPrepare(chars.length)
}

/** Query characters to look for, folded, with whitespace dropped so "new file" finds
 *  "New file in folder". */
function prepareQuery(query: string): number[] {
  const out: number[] = []
  for (const ch of query) {
    if (!WHITESPACE.test(ch)) out.push(foldCode(ch))
  }
  return out
}

/** Cheap reject on the raw string before any work (ASCII text only). */
function asciiSubsequence(q: readonly number[], text: string): boolean {
  let ti = 0
  for (const want of q) {
    for (;;) {
      if (ti >= text.length) return false
      const code = text.charCodeAt(ti++)
      if ((code >= 65 && code <= 90 ? code + 32 : code) === want) break
    }
  }
  return true
}

/** Leftmost (`lo`) and rightmost (`hi`) text index each query character can take in any
 *  alignment, or null when the query isn't a subsequence. Bounds the DP to a band. */
function bandOf(q: readonly number[], p: Prepared): { lo: number[]; hi: number[] } | null {
  const n = q.length
  const lo = new Array<number>(n)
  const hi = new Array<number>(n)
  let j = 0
  for (let i = 0; i < n; i++) {
    while (j < p.length && p.folded[j] !== q[i]) j++
    if (j >= p.length) return null
    lo[i] = j++
  }
  j = p.length - 1
  for (let i = n - 1; i >= 0; i--) {
    while (p.folded[j] !== q[i]) j--
    hi[i] = j--
  }
  return { lo, hi }
}

function leadingPenalty(j: number, baseStart: number): number {
  const from = j >= baseStart ? baseStart : 0
  return Math.min(MAX_LEADING_GAP_PENALTY, (j - from) * LEADING_GAP_PENALTY)
}

/** The score of one alignment (character indexes, ascending). The DP maximizes exactly
 *  this, so other candidate alignments can be compared fairly. */
function scorePositions(positions: readonly number[], p: Prepared): number {
  let score = 0
  let runStart = 0
  for (let k = 0; k < positions.length; k++) {
    const j = positions[k]
    if (k === 0) {
      score += SCORE_MATCH + p.bonus[j] * FIRST_CHAR_MULTIPLIER - leadingPenalty(j, p.baseStart)
      runStart = j
    } else if (j === positions[k - 1] + 1) {
      // A run keeps the bonus of the character it started on ("rea" at a word start).
      score += SCORE_MATCH + Math.max(p.bonus[j], p.bonus[runStart], BONUS_CONSECUTIVE)
    } else {
      const gap = j - positions[k - 1] - 1
      score += SCORE_MATCH + p.bonus[j] - GAP_START - GAP_EXTENSION * (gap - 1)
      runStart = j
    }
  }
  return score
}

/** Best alignment by dynamic programming over (query char, text char) with affine gaps.
 *  Row i only covers text indexes lo[i]..hi[i]; cells outside a row's band are never read. */
function alignDp(q: readonly number[], p: Prepared, lo: readonly number[], hi: readonly number[]): number[] {
  const n = q.length
  const m = p.length
  ensureCellCapacity(n * m)
  const score = scoreBuf
  const prev = prevBuf
  const run = runBuf
  for (let j = lo[0]; j <= hi[0]; j++) {
    score[j] = p.folded[j] === q[0]
      ? SCORE_MATCH + p.bonus[j] * FIRST_CHAR_MULTIPLIER - leadingPenalty(j, p.baseStart)
      : NONE
    run[j] = j
  }
  for (let i = 1; i < n; i++) {
    const row = i * m
    const up = row - m
    const want = q[i]
    const upLo = lo[i - 1]
    const upHi = hi[i - 1]
    // Best "earlier match minus the gap so far", for gaps of at least one character.
    let carry = NONE
    let carryFrom = -1
    for (let j = upLo + 2; j <= hi[i]; j++) {
      carry -= GAP_EXTENSION
      const k = j - 2
      if (k <= upHi && score[up + k] > NONE && score[up + k] - GAP_START > carry) {
        carry = score[up + k] - GAP_START
        carryFrom = k
      }
      if (j < lo[i]) continue
      score[row + j] = NONE
      if (p.folded[j] !== want) continue
      const k1 = j - 1
      const diag = k1 >= upLo && k1 <= upHi ? score[up + k1] : NONE
      const viaRun = diag > NONE
        ? diag + SCORE_MATCH + Math.max(p.bonus[j], p.bonus[run[up + k1]], BONUS_CONSECUTIVE)
        : NONE
      const viaGap = carryFrom >= 0 ? carry + SCORE_MATCH + p.bonus[j] : NONE
      if (viaRun > NONE && viaRun >= viaGap) {
        score[row + j] = viaRun
        prev[row + j] = k1
        run[row + j] = run[up + k1]
      } else if (viaGap > NONE) {
        score[row + j] = viaGap
        prev[row + j] = carryFrom
        run[row + j] = j
      }
    }
    // The first band cell may sit right after the previous band's start, before the loop.
    if (lo[i] === upLo + 1) seedRunStart(q, p, i, lo[i])
  }
  return backtrack(n, m, lo[n - 1], hi[n - 1])
}

/** Cell (i, upLo+1) can only be reached by a run from (i-1, upLo); the gap loop starts one
 *  column later, so fill it here. */
function seedRunStart(q: readonly number[], p: Prepared, i: number, j: number): void {
  const m = p.length
  const row = i * m
  const up = row - m
  scoreBuf[row + j] = NONE
  if (p.folded[j] !== q[i] || scoreBuf[up + j - 1] <= NONE) return
  const start = runBuf[up + j - 1]
  scoreBuf[row + j] = scoreBuf[up + j - 1] + SCORE_MATCH + Math.max(p.bonus[j], p.bonus[start], BONUS_CONSECUTIVE)
  prevBuf[row + j] = j - 1
  runBuf[row + j] = start
}

function backtrack(n: number, m: number, from: number, to: number): number[] {
  const last = (n - 1) * m
  let bestJ = from
  for (let j = from; j <= to; j++) {
    if (scoreBuf[last + j] > scoreBuf[last + bestJ]) bestJ = j
  }
  const positions = new Array<number>(n)
  let j = bestJ
  for (let i = n - 1; i >= 0; i--) {
    positions[i] = j
    j = prevBuf[i * m + j]
  }
  return positions
}

/** Leftmost match pulled right-to-left as tight as possible (fzf v1), for huge inputs. */
function alignGreedy(q: readonly number[], p: Prepared, lo: readonly number[]): number[] {
  let end = lo[lo.length - 1]
  const tight = new Array<number>(q.length)
  for (let i = q.length - 1; i >= 0; i--) {
    while (p.folded[end] !== q[i]) end--
    tight[i] = end--
  }
  return tight
}

/** A contiguous alignment starting at `start`, when the query is literally there. */
function contiguousAt(q: readonly number[], p: Prepared, start: number): number[] | null {
  if (start + q.length > p.length) return null
  for (let i = 0; i < q.length; i++) {
    if (p.folded[start + i] !== q[i]) return null
  }
  return q.map((_, i) => start + i)
}

/** Score plus the whole-query bonuses (prefix of the name or text, exact name). */
function totalScore(positions: readonly number[], p: Prepared): number {
  const first = positions[0]
  const last = positions[positions.length - 1]
  const contiguous = last - first === positions.length - 1
  let score = scorePositions(positions, p)
  if (contiguous && (first === 0 || first === p.baseStart)) score += BONUS_PREFIX
  if (contiguous && first === p.baseStart && (last === p.length - 1 || last === p.extStart - 1)) {
    score += BONUS_EXACT
  }
  return score
}

function matchPrepared(q: readonly number[], text: string): FuzzyMatch | null {
  if (q.length > text.length) return null
  const ascii = ASCII_ONLY.test(text)
  if (ascii && !asciiSubsequence(q, text)) return null
  const p = ascii ? prepareAscii(text) : prepareUnicode(text)
  const band = bandOf(q, p)
  if (!band) return null
  const best = q.length * p.length > MAX_DP_CELLS
    ? alignGreedy(q, p, band.lo)
    : alignDp(q, p, band.lo, band.hi)
  let top = { score: totalScore(best, p), positions: best }
  for (const start of [p.baseStart, 0]) {
    const positions = contiguousAt(q, p, start)
    if (!positions) continue
    const score = totalScore(positions, p)
    if (score > top.score) top = { score, positions }
  }
  return { score: top.score, positions: top.positions.map((i) => p.offsets[i]) }
}

/** Case-insensitive subsequence match of `query` in `text`, or null when it doesn't match.
 *  Rewards consecutive characters, word starts (after space, -, _, /, \, ., or a
 *  lower→upper case change) and an early first match. An empty query matches with score 0.
 *  Also prefers matches in the base name of a path, the query typed as the start of the
 *  name, and the exact name. Accents fold ("cafe" finds "Café") and whitespace in the query
 *  is ignored. Positions are UTF-16 indexes into `text`, one per non-space query character. */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = prepareQuery(query)
  if (q.length === 0) return { score: 0, positions: [] }
  return matchPrepared(q, text)
}

export interface FuzzyResult<T> {
  item: T
  match: FuzzyMatch
}

/** Match every item's `key(item)` and return the matches best-first (stable for ties),
 *  at most `limit` of them. An empty query returns the first `limit` items in order. */
export function fuzzyFilter<T>(
  query: string,
  items: readonly T[],
  key: (item: T) => string,
  limit = 50
): FuzzyResult<T>[] {
  const max = Math.max(0, Math.floor(limit))
  if (max === 0) return []
  const q = prepareQuery(query)
  if (q.length === 0) {
    return items.slice(0, max).map((item) => ({ item, match: { score: 0, positions: [] } }))
  }
  const out: FuzzyResult<T>[] = []
  for (const item of items) {
    const match = matchPrepared(q, key(item))
    if (match) out.push({ item, match })
  }
  // Array.prototype.sort is stable, so equal scores keep their input order.
  return out.sort((a, b) => b.match.score - a.match.score).slice(0, max)
}
