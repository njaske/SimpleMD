import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import '@fontsource-variable/jetbrains-mono'
import type { EditorHandle } from '@/lib/editor/types'
import { createEditorHandle } from '@/lib/editor/handle'
import { darkTheme, editorExtensions } from '@/lib/editor/setup'
import { ImageIcon } from '@/lib/editor/formatIcons'
import '@/styles/editor-ui.css'

export interface EditorJump {
  fileId: string
  line: number
  col: number
  len: number
  nonce: number
}

interface Props {
  value: string
  onChange: (value: string) => void
  isDark: boolean
  jump: EditorJump | null
  /** Editor text size in px (CONTRACT: lane E applies it). */
  fontSize?: number
  /** Receives the imperative handle once mounted, and null on unmount (CONTRACT: lane E). */
  onReady?: (handle: EditorHandle | null) => void
  /** Save a pasted/dropped image next to the document; resolves to the relative link
   *  path ("assets/x.png"), or null when the document has no folder yet (untitled).
   *  Image drops the editor takes still bubble (cancelled): the app's drop handlers should
   *  skip them with isEditorHandledDrop / isEditorImageDrag from lib/editor/drops. */
  onSaveImage?: (file: File) => Promise<string | null>
  /** Short messages for the user ("Save this document first to add images"). When this
   *  is omitted the editor shows them itself as a small inline notice. */
  onNotice?: (message: string) => void
}

const DEFAULT_FONT_SIZE = 14
const NOTICE_MS = 4000

/** The editor's own inline notice, used when the App doesn't take notices itself. */
function useInlineNotice() {
  const [notice, setNotice] = useState<{ text: string; id: number } | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const show = useCallback((text: string) => {
    window.clearTimeout(timer.current)
    setNotice({ text, id: Date.now() })
    timer.current = window.setTimeout(() => setNotice(null), NOTICE_MS)
  }, [])
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return { notice, show }
}

export default function CodeEditor({ value, onChange, isDark, jump, fontSize = DEFAULT_FONT_SIZE, onReady, onSaveImage, onNotice }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  // Callbacks change identity every render; the editor reads them through refs.
  const latest = useRef({ onChange, onReady, onSaveImage, onNotice })
  latest.current = { onChange, onReady, onSaveImage, onNotice }
  const darkMode = useRef(new Compartment())
  // Last text the editor itself reported, so the sync effect below can skip a
  // full-document comparison for the echo of the user's own keystroke.
  const lastEmitted = useRef(value)
  const inline = useInlineNotice()
  const showInline = inline.show

  // Create the editor once per mount. The parent keys this component by file id,
  // so switching files remounts with a clean state/history and the right content.
  useEffect(() => {
    if (!host.current) return
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: editorExtensions({
          isDark,
          darkMode: darkMode.current,
          images: {
            save: () => latest.current.onSaveImage,
            notice: (message) => (latest.current.onNotice ?? showInline)(message)
          },
          onDocChange: (text) => {
            lastEmitted.current = text
            latest.current.onChange(text)
          }
        })
      })
    })
    viewRef.current = view
    const controller = createEditorHandle(view)
    latest.current.onReady?.(controller.handle)
    view.focus()
    return () => {
      latest.current.onReady?.(null)
      controller.destroy()
      view.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sync external content changes (e.g. reload-from-disk of the same file)
  // without disturbing the cursor while the user is typing.
  useEffect(() => {
    const view = viewRef.current
    if (!view || value === lastEmitted.current) return
    const current = view.state.doc.toString()
    if (value !== current) {
      lastEmitted.current = value
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } })
    }
  }, [value])

  // Track the app theme for CodeMirror's internal dark/light defaults.
  useEffect(() => {
    viewRef.current?.dispatch({ effects: darkMode.current.reconfigure(darkTheme(isDark)) })
  }, [isDark])

  // A new text size changes every line height; let CodeMirror re-measure.
  useEffect(() => {
    viewRef.current?.requestMeasure()
  }, [fontSize])

  // Jump to a match (from the search panel) and select it.
  useEffect(() => {
    const view = viewRef.current
    if (!view || !jump) return
    try {
      const lineNo = Math.min(Math.max(jump.line + 1, 1), view.state.doc.lines)
      const line = view.state.doc.line(lineNo)
      const from = Math.min(line.from + jump.col, view.state.doc.length)
      const to = Math.min(from + jump.len, view.state.doc.length)
      view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true })
      view.focus()
    } catch {
      // out-of-range selection — ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jump?.nonce])

  const style = { '--smd-editor-size': `${fontSize}px` } as CSSProperties
  return (
    <div className="smd-editor" style={style}>
      <div ref={host} className="smd-editor__host" />
      <div className="smd-editor-notices" role="status" aria-live="polite">
        {inline.notice && (
          <div key={inline.notice.id} className="smd-editor-notice">
            <ImageIcon size={15} />
            <span>{inline.notice.text}</span>
          </div>
        )}
      </div>
    </div>
  )
}
