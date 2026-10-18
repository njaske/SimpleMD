// Everything the Markdown editor is made of, in one list. A hand-picked basicSetup: no
// autocompletion popups (Markdown is prose), app-friendly key bindings, smart paste,
// image handling and the Paper & Ink theme.
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
  type KeyBinding
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { editorKeymap } from './commands'
import { smartPaste } from './paste'
import { imageHandling, type ImageHooks } from './images'
import { editorHighlight, editorTheme } from './theme'

// Default bindings the app (or our own keymap) owns: Mod+/ is the shortcuts sheet,
// Mod+I is italic, Shift+Alt+A has no meaning in Markdown.
const RESERVED_KEYS = new Set(['Mod-/', 'Mod-i', 'Alt-A'])
const defaults: readonly KeyBinding[] = defaultKeymap.filter((b) => !b.key || !RESERVED_KEYS.has(b.key))

// The search panel's words, in sentence case.
const PHRASES = {
  next: 'Next',
  previous: 'Previous',
  all: 'All',
  'match case': 'Match case',
  regexp: 'Regex',
  'by word': 'Whole word',
  replace: 'Replace',
  'replace all': 'Replace all',
  close: 'Close',
  'Go to line': 'Go to line',
  go: 'Go'
}

const SVG_NS = 'http://www.w3.org/2000/svg'

/** A small chevron for the fold gutter, drawn like the app's stroke icons. */
function foldMarker(open: boolean): HTMLElement {
  const wrap = document.createElement('span')
  wrap.className = open ? 'is-open' : 'is-folded'
  wrap.title = open ? 'Fold' : 'Unfold'
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', '12')
  svg.setAttribute('height', '12')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  const path = document.createElementNS(SVG_NS, 'path')
  path.setAttribute('d', open ? 'M6 9l6 6 6-6' : 'M9 6l6 6-6 6')
  svg.appendChild(path)
  wrap.appendChild(svg)
  return wrap
}

export interface EditorSetup {
  isDark: boolean
  darkMode: Compartment
  images: ImageHooks
  onDocChange: (text: string) => void
}

export const darkTheme = (isDark: boolean): Extension => EditorView.theme({}, { dark: isDark })

export function editorExtensions(setup: EditorSetup): Extension[] {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    foldGutter({ markerDOM: foldMarker }),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    EditorState.phrases.of(PHRASES),
    indentOnInput(),
    syntaxHighlighting(editorHighlight),
    bracketMatching(),
    closeBrackets(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    search({ top: true }),
    EditorView.lineWrapping,
    editorKeymap(),
    keymap.of([...closeBracketsKeymap, ...defaults, ...searchKeymap, ...historyKeymap, ...foldKeymap]),
    // Our paste handling replaces lang-markdown's URL-over-selection paste.
    markdown({ base: markdownLanguage, codeLanguages: languages, pasteURLAsLink: false }),
    imageHandling(setup.images),
    smartPaste(),
    editorTheme,
    setup.darkMode.of(darkTheme(setup.isDark)),
    EditorView.contentAttributes.of({ 'aria-label': 'Markdown source', autocorrect: 'off', autocapitalize: 'off' }),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) setup.onDocChange(u.state.doc.toString())
    })
  ]
}
