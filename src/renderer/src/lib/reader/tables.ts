// Table cells that shouldn't wrap. A table squeezed into the column gives its narrow
// columns their min-content width, and a hyphen is a break opportunity, so short row
// labels like "Write-through" come out as "Write-" / "through". Short labels in the
// first column and single hyphenated words anywhere keep to one line instead; long
// text still wraps.

export const NOWRAP_CLASS = 'smd-nowrap'
/** Row labels up to this many characters stay on one line. */
const SHORT_LABEL = 24
/** One hyphenated word ("read-through", "x86-64", "2024-05-01") up to this long. */
const COMPOUND_WORD = /^[^\s-]+(?:-[^\s-]+)+$/
const COMPOUND_MAX = 32

function keepsTogether(cell: Element, isFirst: boolean): boolean {
  const text = (cell.textContent || '').trim()
  if (!text) return false
  if (isFirst && text.length <= SHORT_LABEL) return true
  return text.length <= COMPOUND_MAX && COMPOUND_WORD.test(text)
}

/** Mark the cells under `root` that should stay on one line. */
export function tidyTables(root: ParentNode): void {
  root.querySelectorAll('tr').forEach((row) => {
    Array.from(row.children).forEach((cell, i) => {
      if (/^T[DH]$/.test(cell.tagName) && keepsTogether(cell, i === 0)) cell.classList.add(NOWRAP_CLASS)
    })
  })
}
