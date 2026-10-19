// Reading commands: find in document (the reader's find bar, or CodeMirror's search
// panel where the editor is in charge), next change / dismiss, and follow the end.
import type { ReadingCommands } from './commandTable'
import type { EditorLink } from './editorLink'
import type { AppHost } from './host'
import type { ReaderBridge } from './readerBridge'

/** Longest selection that seeds the find bar (longer ones are rarely a search). */
const MAX_SEED = 120
const FIND_INPUT = '.smd-findbar-input'

/** The text selected in the reader, if it makes a sensible search. */
export function readerSelection(sel: Selection | null): string {
  const node = sel?.anchorNode ?? null
  const el = node instanceof Element ? node : (node?.parentElement ?? null)
  if (!el?.closest('.smd-reader')) return ''
  const text = (sel?.toString() ?? '').trim()
  return text && text.length <= MAX_SEED && !/[\r\n]/.test(text) ? text : ''
}

export function createReadingCommands(host: AppHost, bridge: ReaderBridge, editor: EditorLink): ReadingCommands {
  let findKey = 0

  const find = (): void => {
    const s = host.state()
    if (!s.activeId) return
    if (s.viewMode === 'edit' || document.activeElement?.closest('.cm-editor')) {
      editor.openSearch()
      return
    }
    const seed = readerSelection(window.getSelection())
    const input = document.querySelector<HTMLInputElement>(FIND_INPUT)
    // Already open and nothing new to look for: back to its field, query selected.
    if (s.find && input && !seed) {
      input.focus()
      input.select()
      return
    }
    host.update({ find: { seed, key: ++findKey }, menu: null, readingOpen: false })
  }

  /** From Edit view, switch to Read first (the reader is where the end is followed). */
  const followEnd = (): void => {
    if (host.state().viewMode === 'edit') host.update({ viewMode: 'read' }, bridge.followEnd)
    else bridge.followEnd()
  }

  return {
    find,
    nextChange: bridge.nextChange,
    dismissChanges: bridge.dismiss,
    followEnd,
    hasChanges: () => bridge.hasChanges(host.state().activeId)
  }
}
