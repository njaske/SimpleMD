import { useEffect, useRef } from 'react'
import { EditorState, Compartment } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

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
}

// Colors come from the app's CSS custom properties, so a single theme tracks
// both light and dark automatically (the .smd-root class drives the vars).
const smdTheme = EditorView.theme({
  '&': { color: 'var(--fg)', backgroundColor: 'var(--bg)', height: '100%', fontSize: '13.5px' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.62', overflow: 'auto' },
  '.cm-content': { padding: '24px 8px 200px', caretColor: 'var(--accent)' },
  '.cm-gutters': { backgroundColor: 'var(--bg)', color: 'var(--fg-faint)', border: 'none' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--fg-muted)' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in oklch, var(--fg) 3%, transparent)' },
  '.cm-foldGutter': { color: 'var(--fg-faint)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)' },
  '.cm-selectionBackground, .cm-content ::selection': { backgroundColor: 'var(--sel)' },
  '&.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--sel)' },
  '.cm-selectionMatch': { backgroundColor: 'var(--accent-soft)' },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
    backgroundColor: 'var(--accent-soft)',
    outline: 'none'
  },
  '.cm-searchMatch': { backgroundColor: 'var(--accent-soft)', borderRadius: '2px' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--sel)' },
  '.cm-panels': { backgroundColor: 'var(--bg-elev)', color: 'var(--fg)' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--border)' },
  '.cm-panel.cm-search': { padding: '6px 8px', fontFamily: "'Helvetica Neue',Helvetica,Arial,sans-serif" },
  '.cm-panel.cm-search input, .cm-panel.cm-search button, .cm-textfield': {
    backgroundColor: 'var(--bg)',
    color: 'var(--fg)',
    border: '1px solid var(--border-strong)',
    borderRadius: '5px',
    fontSize: '12px'
  },
  '.cm-button': { backgroundColor: 'var(--bg-elev2)', backgroundImage: 'none' },
  '.cm-tooltip': {
    backgroundColor: 'var(--bg)',
    border: '1px solid var(--border-strong)',
    color: 'var(--fg)',
    borderRadius: '8px'
  },
  '.cm-tooltip-autocomplete ul li[aria-selected]': {
    backgroundColor: 'var(--accent-soft)',
    color: 'var(--fg)'
  }
})

const smdHighlight = HighlightStyle.define([
  { tag: [t.heading, t.heading1, t.heading2, t.heading3], color: 'var(--fg)', fontWeight: '650' },
  { tag: t.strong, fontWeight: '700', color: 'var(--fg)' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through', color: 'var(--fg-faint)' },
  { tag: [t.link, t.url], color: 'var(--accent)' },
  { tag: t.quote, color: 'var(--fg-muted)', fontStyle: 'italic' },
  { tag: [t.processingInstruction, t.contentSeparator], color: 'var(--fg-faint)' },
  { tag: t.list, color: 'var(--accent)' },
  { tag: t.keyword, color: 'var(--tok-kw)', fontWeight: '600' },
  { tag: [t.string, t.special(t.string)], color: 'var(--tok-str)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--tok-com)', fontStyle: 'italic' },
  { tag: [t.number, t.bool], color: 'var(--tok-num)' },
  { tag: [t.function(t.variableName), t.labelName, t.definition(t.function(t.variableName))], color: 'var(--tok-fn)' },
  { tag: [t.typeName, t.className, t.tagName], color: 'var(--tok-kw)' },
  { tag: [t.propertyName, t.attributeName, t.variableName], color: 'var(--fg-muted)' },
  { tag: [t.operator, t.punctuation, t.bracket], color: 'var(--tok-punc)' },
  { tag: t.monospace, color: 'var(--fg)' }
])

export default function CodeEditor({ value, onChange, isDark, jump }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const darkComp = useRef(new Compartment())
  // Last text the editor itself reported, so the sync effect below can skip a
  // full-document comparison for the echo of the user's own keystroke.
  const lastEmitted = useRef(value)

  // Create the editor once per mount. The parent keys this component by file id,
  // so switching files remounts with a clean state/history and the right content.
  useEffect(() => {
    if (!host.current) return
    const listener = EditorView.updateListener.of((u) => {
      if (u.docChanged) {
        const text = u.state.doc.toString()
        lastEmitted.current = text
        onChangeRef.current(text)
      }
    })
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          keymap.of([indentWithTab]),
          EditorView.lineWrapping,
          markdown({ base: markdownLanguage, codeLanguages: languages }),
          smdTheme,
          syntaxHighlighting(smdHighlight),
          darkComp.current.of(EditorView.theme({}, { dark: isDark })),
          listener
        ]
      })
    })
    viewRef.current = view
    view.focus()
    return () => {
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
    const view = viewRef.current
    if (!view) return
    view.dispatch({ effects: darkComp.current.reconfigure(EditorView.theme({}, { dark: isDark })) })
  }, [isDark])

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

  return <div ref={host} className="smd-editor" style={{ height: '100%', minWidth: 0, overflow: 'hidden' }} />
}
