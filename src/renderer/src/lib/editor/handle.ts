// The imperative EditorHandle the App drives: formatting, focus, text insertion, the
// find panel, and the source-line scroll position used by synced scrolling in Split view.
import { EditorView } from '@codemirror/view'
import { openSearchPanel } from '@codemirror/search'
import { runFormat } from './commands'
import type { EditorHandle } from './types'

/** How long scroll events after our own scroll are treated as its echo. */
const QUIET_MS = 150

/** Pixels from the top of the scrollable content to the document's first line. */
function docOffset(view: EditorView): number {
  const scroller = view.scrollDOM
  return view.documentTop - scroller.getBoundingClientRect().top + scroller.scrollTop
}

function topLine(view: EditorView): number | null {
  const doc = view.state.doc
  if (!view.dom.isConnected) return null
  if (doc.length === 0) return 0
  const height = view.scrollDOM.scrollTop - docOffset(view)
  if (height <= 0) return 0
  const block = view.lineBlockAtHeight(height)
  const line = doc.lineAt(block.from).number - 1
  const within = block.height > 0 ? (height - block.top) / block.height : 0
  return line + Math.min(Math.max(within, 0), 0.999)
}

export interface EditorHandleController {
  readonly handle: EditorHandle
  destroy(): void
}

export function createEditorHandle(view: EditorView): EditorHandleController {
  const listeners = new Set<() => void>()
  // Scroll events right after our own scroll are its echo, plus CodeMirror settling the
  // position once it measures the newly visible lines; neither is the user scrolling.
  let quietUntil = 0

  const onScroll = (): void => {
    if (performance.now() < quietUntil) return
    generation++
    listeners.forEach((cb) => cb())
  }
  view.scrollDOM.addEventListener('scroll', onScroll, { passive: true })

  // First CodeMirror brings the line into view inside its measure cycle (so far-off lines
  // whose heights are still estimates land right). A frame later, with the heights there
  // measured, fine-tune to the exact pixel, including the fraction within a wrapped line.
  let generation = 0
  const scrollTo = (line: number): void => {
    const doc = view.state.doc
    const index = Math.min(Math.max(Math.floor(line), 0), doc.lines - 1)
    const from = doc.line(index + 1).from
    const fraction = Math.min(Math.max(line - index, 0), 1)
    const current = ++generation
    quietUntil = performance.now() + QUIET_MS
    // Following a continuous scroll, the line is already laid out: go to the exact pixel in one
    // step. (The two-step path below gets cancelled by the next frame's scroll before its
    // fine-tune runs, so the editor would only move in whole-line jumps beside a gliding reader.)
    const { viewport } = view
    if (from >= viewport.from && from <= viewport.to) {
      const block = view.lineBlockAt(from)
      view.scrollDOM.scrollTop = docOffset(view) + block.top + fraction * block.height
      return
    }
    view.dispatch({ effects: EditorView.scrollIntoView(from, { y: 'start' }) })
    requestAnimationFrame(() => {
      if (current === generation && view.dom.isConnected) view.requestMeasure(fineTune(from, fraction, current))
    })
  }

  const fineTune = (from: number, fraction: number, current: number) => ({
    key: 'smd-scroll-fine-tune',
    read: (): number => {
      const block = view.lineBlockAt(Math.min(from, view.state.doc.length))
      return block.top + fraction * block.height - (view.scrollDOM.scrollTop - docOffset(view))
    },
    write: (delta: number): void => {
      // A newer scroll (ours or the user's) wins over this correction.
      if (current !== generation || Math.abs(delta) < 1 || performance.now() >= quietUntil) return
      quietUntil = performance.now() + QUIET_MS
      view.scrollDOM.scrollTop += delta
    }
  })

  const handle: EditorHandle = {
    format: (cmd) => runFormat(view, cmd),
    focus: () => view.focus(),
    insertText(text) {
      view.dispatch(view.state.replaceSelection(text), { scrollIntoView: true, userEvent: 'input' })
      view.focus()
    },
    getTopLine: () => topLine(view),
    scrollToLine(line) {
      if (!Number.isFinite(line) || !view.dom.isConnected) return
      scrollTo(line)
    },
    onScroll(cb) {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
    openSearch() {
      if (!view.dom.isConnected) return
      // Opening focuses the panel's field; when it's already open, that refocuses it.
      openSearchPanel(view)
    }
  }

  return {
    handle,
    destroy() {
      listeners.clear()
      view.scrollDOM.removeEventListener('scroll', onScroll)
    }
  }
}
