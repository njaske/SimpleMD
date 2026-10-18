// Links and images: the toolbar/shortcut command and a URL pasted over selected text.
import { lineAround, select, wordAt, type FormatEdit, type FormatOptions, type TextChange, type TextRange, type TextState } from './text'

const URL_RE = /^(?:https?:\/\/|mailto:|www\.)[^\s<>]+$/i
const LINK_RE = /(!?)\[([^[\]\n]*)\]\([^)\n]*\)/g

interface LinkAround extends TextRange {
  readonly image: boolean
  readonly label: string
}

/** The link or image on the line that holds the selection (a cursor strictly inside). */
function linkAround(text: string, sel: TextRange): LinkAround | null {
  const [start, end] = lineAround(text, sel.from)
  for (const m of text.slice(start, end).matchAll(LINK_RE)) {
    const from = start + (m.index ?? 0)
    const to = from + m[0].length
    const inside = sel.from === sel.to ? from < sel.from && sel.from < to : from <= sel.from && sel.to <= to
    if (inside) return { from, to, image: m[1] === '!', label: m[2] }
  }
  return null
}

/** True for a single http(s)/mailto/www URL with no spaces. */
export function isUrl(text: string): boolean {
  return URL_RE.test(text.trim())
}

const normalizeUrl = (url: string): string => (/^www\./i.test(url) ? 'https://' + url : url)

/** Insert a link (or image with `image`) around the selection or word at the cursor.
 *  A selected URL becomes the target with the cursor in the brackets; a copied URL is
 *  used as the target; otherwise the "url" placeholder is selected. Inside an existing
 *  link it toggles back to the link text; inside an image it links the whole image. */
export function insertLink(state: TextState, options: FormatOptions = {}, image = false): FormatEdit {
  const { text, selection } = state
  const around = image ? null : linkAround(text, selection)
  if (around && !around.image) {
    return select([{ from: around.from, to: around.to, insert: around.label }], around.from, around.from + around.label.length)
  }
  const word = selection.from === selection.to && !image ? wordAt(text, selection.from) : null
  const sel = around ?? word ?? selection
  const selected = text.slice(sel.from, sel.to)
  const open = image ? '![' : '['
  const at = (insert: string): TextChange[] => [{ from: sel.from, to: sel.to, insert }]
  if (selected && isUrl(selected)) {
    return select(at(`${open}](${normalizeUrl(selected.trim())})`), sel.from + open.length)
  }
  const clip = options.clipboard?.trim() ?? ''
  if (clip && isUrl(clip)) {
    const insert = `${open}${selected}](${normalizeUrl(clip)})`
    return select(at(insert), selected ? sel.from + insert.length : sel.from + open.length)
  }
  const urlStart = sel.from + open.length + selected.length + 2
  return select(at(`${open}${selected}](url)`), urlStart, urlStart + 3)
}

/** Pasting a URL over selected plain text makes it a link: "[text](url)". Null when the
 *  paste isn't a lone URL or the selection is empty, multi-line or a URL itself. */
export function pasteUrlOverSelection(state: TextState, pasted: string): FormatEdit | null {
  const { from, to } = state.selection
  const selected = state.text.slice(from, to)
  if (from === to || selected.includes('\n') || !isUrl(pasted) || isUrl(selected)) return null
  const insert = `[${selected}](${normalizeUrl(pasted.trim())})`
  return select([{ from, to, insert }], from + insert.length)
}
