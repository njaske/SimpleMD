// Fuzzy matching for Quick Open and the command palette. An fzf-style scorer: the best
// alignment of the query in the text is found with an exact dynamic program, and every
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
let bonusBuf = new Int32Array(0)
let cellCap = 0
/** Best score of an alignment of query[0..i] whose last match is at text column j. */
let endBuf = new Int32Array(0)
/** Column where that alignment's final run starts. */
let runBuf = new Int32Array(0)
/** For a run starting at (i, j): the column of query[i - 1]'s match before the gap. */
let prevBuf = new Int32Array(0)
let bandCap = 0
let loBuf = new Int32Array(0)
let hiBuf = new Int32Array(0)

function ensureTextCapacity(length: number): void {
  if (length <= textCap) return
  textCap = Math.max(length, textCap * 2, 256)
  foldedBuf = new Int32Array(textCap)
  offsetBuf = new Int32Array(textCap)
  bonusBuf = new Int32Array(textCap)
}

function ensureCellCapacity(cells: number): void {
  if (cells <= cellCap) return
  cellCap = Math.max(cells, cellCap * 2, 4096)
  endBuf = new Int32Array(cellCap)
  runBuf = new Int32Array(cellCap)
  prevBuf = new Int32Array(cellCap)
}

// ---------------------------------------------------------------------------------------
// Characters

/** Lower-case one character and drop its accents ("É" → "e"), as a single code point. */
function foldChar(ch: string): number {
  const code = ch.codePointAt(0) ?? 0
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

function classOfChar(ch: string): number {
  if (WHITESPACE.test(ch)) return WHITE
  if (/\p{N}/u.test(ch)) return DIGIT
  if (ch.toLowerCase() !== ch) return UPPER
  if (ch.toUpperCase() !== ch) return LOWER
  return /[\p{L}\p{M}]/u.test(ch) ? LETTER : PUNCTUATION
}

// Non-ASCII folding and classing cost a normalize() and several regexes, so each code
// point is worked out once. Real file lists use few distinct characters; the cap only
// guards against a pathological list.
const MAX_CACHED_CODES = 8192
const foldCache = new Map<number, number>()
const classCache = new Map<number, number>()

function cachedOf(cache: Map<number, number>, code: number, compute: (ch: string) => number): number {
  const hit = cache.get(code)
  if (hit !== undefined) return hit
  if (cache.size >= MAX_CACHED_CODES) cache.clear()
  const value = compute(String.fromCodePoint(code))
  cache.set(code, value)
  return value
}

function foldCode(code: number): number {
  if (code < 128) return code >= 65 && code <= 90 ? code + 32 : code
  return cachedOf(foldCache, code, foldChar)
}

function classOfCode(code: number): number {
  return code < 128 ? classOfAscii(code) : cachedOf(classCache, code, classOfChar)
}

/** The code point at UTF-16 index `i` (a lone surrogate stands for itself). */
function codeAt(text: string, i: number): number {
  const code = text.charCodeAt(i)
  if (code < 0xd800 || code > 0xdbff || i + 1 >= text.length) return code
  const low = text.charCodeAt(i + 1)
  return low >= 0xdc00 && low <= 0xdfff ? (code - 0xd800) * 0x400 + (low - 0xdc00) + 0x10000 : code
}

// ---------------------------------------------------------------------------------------
// Preparing text and query

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

const CLASS_COUNT = 7
const ASCII_CLASS = Int32Array.from({ length: 128 }, (_, code) => classOfAscii(code))
/** bonusFor(prev, cls) at [prev * CLASS_COUNT + cls], so the hot loop doesn't branch. */
const BONUS_TABLE = Int32Array.from({ length: CLASS_COUNT * CLASS_COUNT }, (_, k) =>
  bonusFor(Math.floor(k / CLASS_COUNT), k % CLASS_COUNT))

/** UTF-16 index where the last path segment starts, ignoring trailing separators
 *  ("a/docs/" → 2); 0 when the text has no path. */
function baseNameOffset(text: string): number {
  let end = text.length
  while (end > 0 && (text.charCodeAt(end - 1) === 47 || text.charCodeAt(end - 1) === 92)) end--
  if (end === 0) return 0
  return Math.max(text.lastIndexOf('/', end - 1), text.lastIndexOf('\\', end - 1)) + 1
}

/** Fold and score every character in one pass: this runs for every candidate item. */
function prepare(text: string): Prepared {
  ensureTextCapacity(text.length)
  // Locals, not module bindings, in the hot loops: V8 re-checks a module `let` per access.
  const folded = foldedBuf
  const offsets = offsetBuf
  const bonus = bonusBuf
  const baseOffset = baseNameOffset(text)
  const dot = text.lastIndexOf('.')
  const extOffset = dot > baseOffset ? dot : -1
  let length = 0
  let baseStart = 0
  let extStart = -1
  let prevClass = WHITE
  for (let i = 0; i < text.length; length++) {
    let code = text.charCodeAt(i)
    let cls: number
    if (code < 128) {
      cls = ASCII_CLASS[code]
      folded[length] = code >= 65 && code <= 90 ? code + 32 : code
    } else {
      code = codeAt(text, i)
      cls = classOfCode(code)
      folded[length] = foldCode(code)
    }
    if (i === baseOffset) baseStart = length
    if (i === extOffset) extStart = length
    offsets[length] = i
    bonus[length] = BONUS_TABLE[prevClass * CLASS_COUNT + cls] + (i >= baseOffset ? BONUS_BASENAME : 0)
    prevClass = cls
    i += code > 0xffff ? 2 : 1
  }
  return { length, folded, offsets, bonus, baseStart, extStart: extStart < 0 ? length : extStart }
}

/** Query characters to look for, folded, with whitespace dropped so "new file" finds
 *  "New file in folder". */
function prepareQuery(query: string): number[] {
  const out: number[] = []
  for (const ch of query) {
    if (!WHITESPACE.test(ch)) out.push(foldCode(ch.codePointAt(0) ?? 0))
  }
  return out
}

/** Cheap reject on the raw string before any other work: most items don't match. */
function isSubsequence(q: readonly number[], text: string): boolean {
  let qi = 0
  for (let i = 0; i < text.length && qi < q.length;) {
    const code = codeAt(text, i)
    if (foldCode(code) === q[qi]) qi++
    i += code > 0xffff ? 2 : 1
  }
  return qi === q.length
}

interface Band {
  lo: Int32Array
  hi: Int32Array
}

/** Leftmost (`lo`) and rightmost (`hi`) text index each query character can take in any
 *  alignment, or null when the query isn't a subsequence. Bounds the DP to a band. */
function bandOf(q: readonly number[], p: Prepared): Band | null {
  const n = q.length
  if (n > bandCap) {
    bandCap = Math.max(n, bandCap * 2, 64)
    loBuf = new Int32Array(bandCap)
    hiBuf = new Int32Array(bandCap)
  }
  const lo = loBuf
  const hi = hiBuf
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

// ---------------------------------------------------------------------------------------
// Scoring and alignment

function leadingPenalty(j: number, baseStart: number): number {
  const from = j >= baseStart ? baseStart : 0
  return Math.min(MAX_LEADING_GAP_PENALTY, (j - from) * LEADING_GAP_PENALTY)
}

function firstScore(j: number, p: Prepared): number {
  return SCORE_MATCH + p.bonus[j] * FIRST_CHAR_MULTIPLIER - leadingPenalty(j, p.baseStart)
}

/** A run keeps the bonus of the character it started on ("rea" at a word start). */
function runFloor(start: number, p: Prepared): number {
  return Math.max(p.bonus[start], BONUS_CONSECUTIVE)
}

/** The score of one alignment (character indexes, ascending). The DP maximizes exactly
 *  this, so other candidate alignments can be compared fairly. */
function scorePositions(positions: readonly number[], p: Prepared): number {
  let score = 0
  let floor = 0
  for (let k = 0; k < positions.length; k++) {
    const j = positions[k]
    if (k === 0) {
      score += firstScore(j, p)
      floor = runFloor(j, p)
    } else if (j === positions[k - 1] + 1) {
      score += SCORE_MATCH + Math.max(p.bonus[j], floor)
    } else {
      const gap = j - positions[k - 1] - 1
      score += SCORE_MATCH + p.bonus[j] - GAP_START - GAP_EXTENSION * (gap - 1)
      floor = runFloor(j, p)
    }
  }
  return score
}

/** A run of matches starting at (i, j) with `score` so far: record it as the best
 *  alignment ending there, then extend it down its diagonal while the characters keep
 *  matching, offering each cell "this run, this long". Runs are short, so this is cheap. */
function startRun(q: readonly number[], p: Prepared, i: number, j: number, score: number, hi: Int32Array): void {
  // Locals, not module bindings, in the hot loops: V8 re-checks a module `let` per access.
  const end = endBuf
  const run = runBuf
  const { folded, bonus, length: m } = p
  let cell = i * m + j
  // Strictly better only: on a tie the longer run pushed from an earlier row wins.
  if (score > end[cell]) {
    end[cell] = score
    run[cell] = j
  }
  const floor = runFloor(j, p)
  let total = score
  for (let t = 1; i + t < q.length && j + t <= hi[i + t] && folded[j + t] === q[i + t]; t++) {
    total += SCORE_MATCH + Math.max(bonus[j + t], floor)
    cell += m + 1
    if (total > end[cell]) {
      end[cell] = total
      run[cell] = j
    }
  }
}

/** Row i: every place query[i] can start a run, either as the first character or after a
 *  gap of at least one character from row i - 1's best alignments (kept in `prevBuf`). */
function fillRow(q: readonly number[], p: Prepared, i: number, lo: Int32Array, hi: Int32Array): void {
  const end = endBuf
  const prev = prevBuf
  const { folded, bonus, length: m } = p
  const want = q[i]
  if (i === 0) {
    for (let j = lo[0]; j <= hi[0]; j++) {
      if (folded[j] === want) startRun(q, p, 0, j, firstScore(j, p), hi)
    }
    return
  }
  const row = i * m
  const up = row - m
  const upHi = hi[i - 1]
  // Best "earlier match minus the gap so far", for gaps of at least one character.
  let carry = NONE
  let carryFrom = -1
  for (let j = lo[i - 1] + 2; j <= hi[i]; j++) {
    carry -= GAP_EXTENSION
    const k = j - 2
    if (k <= upHi && end[up + k] > NONE && end[up + k] - GAP_START > carry) {
      carry = end[up + k] - GAP_START
      carryFrom = k
    }
    if (j < lo[i] || carryFrom < 0 || folded[j] !== want) continue
    prev[row + j] = carryFrom
    startRun(q, p, i, j, carry + SCORE_MATCH + bonus[j], hi)
  }
}

/** Best alignment by an exact dynamic program over (query char, text char). A run's
 *  score depends on where it started, so cells hold "best alignment ending here" and
 *  every run start pushes its run forward; rows only cover the band lo[i]..hi[i]. */
function alignDp(q: readonly number[], p: Prepared, lo: Int32Array, hi: Int32Array): number[] {
  const n = q.length
  const m = p.length
  ensureCellCapacity(n * m)
  // Every row is reset first: runs from earlier rows write into later ones. (A plain loop:
  // bands are short and fill() costs more per call than it saves.)
  const end = endBuf
  for (let i = 0; i < n; i++) {
    for (let cell = i * m + lo[i], last = i * m + hi[i]; cell <= last; cell++) end[cell] = NONE
  }
  for (let i = 0; i < n; i++) fillRow(q, p, i, lo, hi)
  return backtrack(n, m, lo[n - 1], hi[n - 1])
}

function backtrack(n: number, m: number, from: number, to: number): number[] {
  const last = (n - 1) * m
  let j = from
  for (let k = from; k <= to; k++) {
    if (endBuf[last + k] > endBuf[last + j]) j = k
  }
  const positions = new Array<number>(n)
  let i = n - 1
  while (i >= 0) {
    const start = runBuf[i * m + j]
    const startRow = i - (j - start)
    for (let r = i; r >= startRow; r--) positions[r] = start + (r - startRow)
    j = prevBuf[startRow * m + start]
    i = startRow - 1
  }
  return positions
}

/** Leftmost match pulled right-to-left as tight as possible (fzf v1), for huge inputs. */
function alignGreedy(q: readonly number[], p: Prepared, lo: Int32Array): number[] {
  let end = lo[q.length - 1]
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
  if (q.length > text.length || !isSubsequence(q, text)) return null
  const p = prepare(text)
  const band = bandOf(q, p)
  if (!band) return null
  const best = q.length * p.length > MAX_DP_CELLS
    ? alignGreedy(q, p, band.lo)
    : alignDp(q, p, band.lo, band.hi)
  // The whole-query bonuses only reward contiguous alignments at these two starts, so
  // checking them next to the DP's best gives the true optimum of `totalScore`.
  let top = { score: totalScore(best, p), positions: best }
  for (const start of [p.baseStart, 0]) {
    const positions = contiguousAt(q, p, start)
    if (!positions) continue
    const score = totalScore(positions, p)
    if (score > top.score) top = { score, positions }
  }
  return { score: top.score, positions: top.positions.map((i) => p.offsets[i]) }
}

// ---------------------------------------------------------------------------------------
// Public API

/** Case-insensitive subsequence match of `query` in `text`, or null when it doesn't match.
 *  Rewards consecutive characters, word starts (after space, -, _, /, \, ., or a
 *  lower→upper case change) and an early first match. An empty query matches with score 0.
 *  Also prefers matches in the base name of a path, the query typed as the start of the
 *  name, and the exact name. Accents fold ("cafe" finds "Café") and whitespace in the query
 *  is ignored. Positions are UTF-16 indexes into `text`, one per non-space query character.
 *  The best-scoring alignment is always found, except for texts too long for the DP
 *  (query × text above 120,000 characters), which get a tight greedy alignment. */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = prepareQuery(query)
  if (q.length === 0) return { score: 0, positions: [] }
  return matchPrepared(q, text)
}

/** The score `fuzzyMatch` gives one particular alignment of `query` in `text` (UTF-16
 *  `positions`, ascending, one per non-space query character), or null when `positions`
 *  isn't an alignment. This is the function the matcher maximizes; useful for tests. */
export function scoreAlignment(query: string, text: string, positions: readonly number[]): number | null {
  const q = prepareQuery(query)
  if (q.length === 0) return positions.length === 0 ? 0 : null
  if (positions.length !== q.length) return null
  const p = prepare(text)
  const byOffset = new Map<number, number>()
  for (let i = 0; i < p.length; i++) byOffset.set(p.offsets[i], i)
  const indexes = positions.map((offset) => byOffset.get(offset) ?? -1)
  const valid = indexes.every((j, k) => j >= 0 && p.folded[j] === q[k] && (k === 0 || j > indexes[k - 1]))
  return valid ? totalScore(indexes, p) : null
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
