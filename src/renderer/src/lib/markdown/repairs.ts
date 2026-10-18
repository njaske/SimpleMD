// "Forgiving rendering": display-only repairs for the broken Markdown that chat apps
// and coding agents often produce. The file itself is never changed. Each repair works
// on a copy of the lines and keeps `map` (repaired line -> original line) so source
// line mapping stays exact, and reports a short human sentence for the status bar.

export interface RepairResult {
  lines: string[]
  /** For every repaired line, the 0-based original line it came from. */
  map: number[]
  fixes: string[]
}

interface Step {
  lines: string[]
  map: number[]
  fix: string | null
}

export const FIX_FENCE = 'Closed a code block that was left open'
export const FIX_TABLE = 'Added a missing divider row to a table'
export const FIX_MATH = 'Joined a math block that blank lines had split'
export const FIX_DIAGRAM = 'Straightened curly quotes and dashes in a diagram'

const FENCE = /^([ \t]*(?:>[ \t]?)*[ \t]*)(`{3,}|~{3,})(.*)$/

interface FenceInfo {
  /** True for lines inside a fenced block (fence lines included). */
  inside: boolean[]
  /** The fence still open at the end of the text, if any. */
  open: { prefix: string; marker: string } | null
}

/** Which lines are inside fenced code blocks. */
export function scanFences(lines: readonly string[]): FenceInfo {
  const inside = new Array<boolean>(lines.length).fill(false)
  let open: { prefix: string; marker: string } | null = null
  for (let i = 0; i < lines.length; i++) {
    const m = FENCE.exec(lines[i])
    if (open) {
      inside[i] = true
      const closes =
        !!m && m[2][0] === open.marker[0] && m[2].length >= open.marker.length && !m[3].trim()
      if (closes) open = null
    } else if (m && !(m[2][0] === '`' && m[3].includes('`'))) {
      inside[i] = true
      open = { prefix: m[1], marker: m[2] }
    }
  }
  return { inside, open }
}

function closeUnclosedFence(lines: string[], map: number[]): Step {
  const { open } = scanFences(lines)
  if (!open || !lines.length) return { lines, map, fix: null }
  const last = map[map.length - 1] ?? 0
  return { lines: [...lines, open.prefix + open.marker], map: [...map, last], fix: FIX_FENCE }
}

const PIPE_ROW = /^ {0,3}\|.*\|[ \t]*$/
const SEP_ROW = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/

function cellCount(row: string): number {
  return row.trim().slice(1, -1).split(/(?<!\\)\|/).length
}

function isTableRow(line: string | undefined): line is string {
  return line !== undefined && PIPE_ROW.test(line) && !SEP_ROW.test(line)
}

/** Two or more `| a | b |` rows with no `| --- |` divider under the first one: GFM
 *  shows them as a paragraph of pipes, so add the divider. */
function addMissingTableSeparators(lines: string[], map: number[]): Step {
  const { inside } = scanFences(lines)
  const outLines: string[] = []
  const outMap: number[] = []
  let fixed = false
  for (let i = 0; i < lines.length; i++) {
    outLines.push(lines[i])
    outMap.push(map[i])
    const prev = lines[i - 1]
    const startsBlock = prev === undefined || !prev.trim() || /^ {0,3}#{1,6}\s/.test(prev)
    const header = lines[i]
    const next = lines[i + 1]
    if (inside[i] || inside[i + 1] || !startsBlock || !isTableRow(header) || !isTableRow(next)) continue
    const cells = cellCount(header)
    if (cells < 2 || cellCount(next) !== cells) continue
    const indent = /^ */.exec(header)?.[0] ?? ''
    outLines.push(indent + '|' + ' --- |'.repeat(cells))
    outMap.push(map[i])
    fixed = true
    // Skip the rest of this table so its rows aren't mistaken for new headers.
    while (isTableRow(lines[i + 1])) {
      i++
      outLines.push(lines[i])
      outMap.push(map[i])
    }
  }
  return { lines: fixed ? outLines : lines, map: fixed ? outMap : map, fix: fixed ? FIX_TABLE : null }
}

const DOLLAR_LINE = /^[ \t]*\$\$[ \t]*$/
const BRACKET_OPEN = /^[ \t]*\\\[[ \t]*$/
const BRACKET_CLOSE = /^[ \t]*\\\][ \t]*$/
const MAX_MATH_LINES = 60

/** Formula lines are short or full of TeX; a prose line means we paired the wrong fences. */
function isFormulaLine(line: string): boolean {
  return !line.trim() || /[\\^_={}&]/.test(line) || line.trim().length <= 24
}

function findMathPairs(lines: readonly string[], inside: readonly boolean[]): Array<[number, number]> {
  const pairs: Array<[number, number]> = []
  const dollars: number[] = []
  let bracketOpen = -1
  for (let i = 0; i < lines.length; i++) {
    if (inside[i]) continue
    if (DOLLAR_LINE.test(lines[i])) dollars.push(i)
    else if (BRACKET_OPEN.test(lines[i])) bracketOpen = i
    else if (BRACKET_CLOSE.test(lines[i]) && bracketOpen >= 0) {
      pairs.push([bracketOpen, i])
      bracketOpen = -1
    }
  }
  // An odd number of lone `$$` lines makes the pairing a guess, so leave them all.
  if (dollars.length % 2 === 0) {
    for (let k = 0; k < dollars.length; k += 2) pairs.push([dollars[k], dollars[k + 1]])
  }
  return pairs
}

function isJoinable(lines: readonly string[], [open, close]: [number, number]): boolean {
  if (close - open > MAX_MATH_LINES) return false
  const body = lines.slice(open + 1, close)
  return (
    body.some((line) => !line.trim()) &&
    body.some((line) => line.trim()) &&
    body.every((line) => !line.includes('$$') && isFormulaLine(line))
  )
}

/** `$$` / `\[` display blocks with blank lines inside: rejoin them when unambiguous. */
function joinSplitDisplayMath(lines: string[], map: number[]): Step {
  const { inside } = scanFences(lines)
  const drop = new Set<number>()
  for (const pair of findMathPairs(lines, inside)) {
    if (!isJoinable(lines, pair)) continue
    for (let i = pair[0] + 1; i < pair[1]; i++) if (!lines[i].trim()) drop.add(i)
  }
  if (!drop.size) return { lines, map, fix: null }
  return {
    lines: lines.filter((_, i) => !drop.has(i)),
    map: map.filter((_, i) => !drop.has(i)),
    fix: FIX_MATH
  }
}

const STEPS = [joinSplitDisplayMath, addMissingTableSeparators, closeUnclosedFence]

/** Apply every repair to `lines` (not modified). */
export function repairMarkdown(lines: readonly string[]): RepairResult {
  let state = { lines: [...lines], map: lines.map((_, i) => i) }
  const fixes: string[] = []
  for (const step of STEPS) {
    const out = step(state.lines, state.map)
    state = { lines: out.lines, map: out.map }
    if (out.fix) fixes.push(out.fix)
  }
  return { ...state, fixes }
}

const TYPOGRAPHY: Array<[RegExp, string]> = [
  // Autocorrect turns the "--" of an arrow into a dash: "A —> B" was "A --> B".
  [/[\u2013\u2014]>/g, '-->'],
  [/<[\u2013\u2014]/g, '<--'],
  [/[\u201C\u201D\u201E\u201F\u2033\u00AB\u00BB]/g, '"'],
  [/[\u2018\u2019\u201A\u201B\u2032]/g, "'"],
  [/[\u2013\u2014\u2212]/g, '-'],
  [/\u2026/g, '...'],
  [/[\u00A0\u2007\u202F]/g, ' '],
  [/[\u200B-\u200D\uFEFF]/g, '']
]

/** Mermaid source with typographic quotes, dashes and odd spaces made plain, which is
 *  what most "Syntax error" diagrams pasted from a chat need. */
export function normalizeDiagramSource(source: string): string {
  return TYPOGRAPHY.reduce((text, [re, plain]) => text.replace(re, plain), source)
}
