// Smart paste: rich clipboard content becomes Markdown. HTML (from a browser, Docs, a chat
// app) goes through htmlPaste.ts; spreadsheet cells (tab-separated rows) become a table.
// Plain text is left alone (callers paste it as is). Pure apart from the DOM parser, so it
// runs under happy-dom in tests.
import { htmlToMarkdown } from './htmlPaste'

export { collapseBlankLines, htmlToMarkdown } from './htmlPaste'

export interface PasteConversion {
  readonly markdown: string
  /** Starts or ends with a table, so it must sit on its own lines, not inside a paragraph. */
  readonly block: boolean
  /** Ends with a table, whose last row would swallow the next line typed after it: the
   *  cursor goes to a fresh paragraph below instead. */
  readonly fresh: boolean
}

const TABLE_ROW = /^[ \t]*\|.*\|[ \t]*$/

function conversion(markdown: string): PasteConversion {
  const lines = markdown.split('\n')
  const fresh = TABLE_ROW.test(lines[lines.length - 1])
  return { markdown, block: fresh || TABLE_ROW.test(lines[0]), fresh }
}

/** What to insert for a paste, or null to paste the plain text unchanged. */
export function convertPaste(html: string, text: string): PasteConversion | null {
  const table = tsvToTable(text)
  if (table) return conversion(table)
  if (!html.trim()) return null
  const markdown = htmlToMarkdown(html)
  if (!markdown || markdown === text.trim()) return null
  return conversion(markdown)
}

// ---- spreadsheet cells -----------------------------------------------------------------

/** Split tab-separated text into rows of cells, honouring Excel-style quoted cells. */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let i = 0
  const src = text.replace(/\r\n?/g, '\n').replace(/\n$/, '')
  while (i <= src.length) {
    const ch = src[i]
    if (cell === '' && ch === '"' && src.indexOf('"', i + 1) > 0) {
      // Quoted cell: runs to the next lone quote; "" is a literal quote.
      let j = i + 1
      let value = ''
      while (j < src.length && !(src[j] === '"' && src[j + 1] !== '"')) {
        value += src[j]
        j += src[j] === '"' ? 2 : 1
      }
      const next = src[j + 1]
      if (next === undefined || next === '\t' || next === '\n') {
        cell = value
        i = j + 1
        continue
      }
    }
    if (ch === '\t' || ch === '\n' || ch === undefined) {
      row = [...row, cell]
      cell = ''
      if (ch !== '\t') {
        rows.push(row)
        row = []
      }
    } else {
      cell += ch
    }
    i++
  }
  return rows
}

const MAX_PAD = 40

function tableCell(value: string): string {
  return value.trim().replace(/\|/g, '\\|').replace(/\n/g, '<br>')
}

function tableLine(cells: readonly string[], widths: readonly number[]): string {
  return '| ' + cells.map((c, k) => c.padEnd(widths[k])).join(' | ') + ' |'
}

/** Rows of tab-separated cells (at least 2 rows x 2 columns, all the same width) as a
 *  Markdown table with the first row as the header; null for anything else. */
export function tsvToTable(text: string): string | null {
  if (!text.includes('\t')) return null
  const rows = parseTsv(text).map((r) => r.map(tableCell))
  if (rows.length < 2) return null
  const cols = rows[0].length
  if (cols < 2 || rows.some((r) => r.length !== cols)) return null
  // Every row starting with a tab is indented code, not a sheet.
  if (rows.every((r) => r[0] === '')) return null
  const widths = rows[0].map((_, k) => Math.min(MAX_PAD, Math.max(3, ...rows.map((r) => r[k].length))))
  const lines = [tableLine(rows[0], widths), tableLine(widths.map((w) => '-'.repeat(w)), widths), ...rows.slice(1).map((r) => tableLine(r, widths))]
  return lines.join('\n')
}
