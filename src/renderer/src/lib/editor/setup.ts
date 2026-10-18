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
  type Command,
  type KeyBinding
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, selectParentSyntax, toggleBlockComment, toggleComment } from '@codemirror/commands'
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { editorKeymap } from './commands'
import { smartPaste } from './paste'
import { imageHandling, type ImageHooks } from './images'
import { editorHighlight, editorTheme } from './theme'
import { frontmatter } from './frontmatter'
import { createSearchPanel } from './searchPanel'
import { strokeIcon } from './domIcons'

// Default bindings the app (or our own keymap) owns: Mod+/ is the shortcuts sheet, Mod+I
// is italic, and HTML block comments (Shift+Alt+A) mean nothing in Markdown. Matched by
// command rather than key so a respelt key can't bring them back.
const RESERVED_COMMANDS: ReadonlySet<Command> = new Set([toggleComment, selectParentSyntax, toggleBlockComment])
export const appDefaultKeymap: readonly KeyBinding[] = defaultKeymap.filter((b) => !b.run || !RESERVED_COMMANDS.has(b.run))

// The go-to-line prompt's words, in sentence case (the search panel has its own).
const PHRASES = { 'Go to line': 'Go to line', go: 'Go' }

/** A small chevron for the fold gutter, drawn like the app's stroke icons. */
function foldMarker(open: boolean): HTMLElement {
  const wrap = document.createElement('span')
  wrap.className = open ? 'is-open' : 'is-folded'
  wrap.title = open ? 'Fold' : 'Unfold'
  wrap.appendChild(strokeIcon(open ? 'chevronDown' : 'chevronRight', 12, 2))
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
    search({ top: true, createPanel: createSearchPanel }),
    EditorView.lineWrapping,
    editorKeymap(),
    keymap.of([...closeBracketsKeymap, ...appDefaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap]),
    // Our paste handling replaces lang-markdown's URL-over-selection paste.
    markdown({ base: markdownLanguage, codeLanguages: languages, extensions: frontmatter, pasteURLAsLink: false }),
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
