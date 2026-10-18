// CodeMirror commands around the pure transforms in format.ts: formatting (toolbar and
// shortcuts), Tab/Shift+Tab on list items, and plain-text paste.
import { EditorSelection, Prec, type EditorState, type Extension } from '@codemirror/state'
import { keymap, type Command, type EditorView, type KeyBinding } from '@codemirror/view'
import { indentLess, indentMore } from '@codemirror/commands'
import { applyFormat, indentList, type FormatEdit, type TextState } from './format'
import { readClipboardText } from './clipboard'
import { FORMAT_SHORTCUTS, PASTE_PLAIN_SHORTCUT, toCodeMirrorKey } from './shortcuts'
import type { FormatCommand } from './types'

export function textState(state: EditorState): TextState {
  const { from, to } = state.selection.main
  return { text: state.doc.toString(), selection: { from, to } }
}

const isLive = (view: EditorView): boolean => view.dom.isConnected

export function dispatchEdit(view: EditorView, edit: FormatEdit, userEvent = 'input.format'): void {
  view.dispatch({
    changes: [...edit.changes],
    selection: EditorSelection.single(edit.selection.anchor, edit.selection.head),
    scrollIntoView: true,
    userEvent
  })
}

// Link and image look at the clipboard for a copied URL.
const USES_CLIPBOARD: ReadonlySet<FormatCommand> = new Set(['link', 'image'])

async function formatWithClipboard(view: EditorView, cmd: FormatCommand): Promise<void> {
  const before = view.state
  const clipboard = await readClipboardText()
  if (!isLive(view)) return
  // The read is async: only use it if the user didn't move on meanwhile.
  const unchanged = view.state.doc.eq(before.doc) && view.state.selection.eq(before.selection)
  const edit = applyFormat(cmd, textState(view.state), unchanged ? { clipboard } : {})
  if (edit) dispatchEdit(view, edit)
  view.focus()
}

/** Apply a formatting command to the main selection and keep focus in the editor. */
export function runFormat(view: EditorView, cmd: FormatCommand): void {
  if (USES_CLIPBOARD.has(cmd)) {
    void formatWithClipboard(view, cmd)
    return
  }
  const edit = applyFormat(cmd, textState(view.state))
  if (edit) dispatchEdit(view, edit)
  view.focus()
}

function indentOrList(dir: 1 | -1): Command {
  return (view) => {
    const edit = indentList(textState(view.state), dir)
    if (!edit) return dir > 0 ? indentMore(view) : indentLess(view)
    if (edit.changes.length) dispatchEdit(view, edit, dir > 0 ? 'input.indent' : 'delete.dedent')
    return true
  }
}

const pastePlain: Command = (view) => {
  void readClipboardText().then((text) => {
    if (!text || !isLive(view)) return
    view.dispatch(view.state.replaceSelection(text), { scrollIntoView: true, userEvent: 'input.paste' })
  })
  return true
}

/** Formatting shortcuts, list-aware Tab, and plain paste. High precedence so Mod+I beats
 *  CodeMirror's select-parent; stopPropagation so the app's own Mod+B/Mod+K don't fire too. */
export function editorKeymap(): Extension {
  const formatting: KeyBinding[] = FORMAT_SHORTCUTS.map(([cmd, shortcut]) => ({
    key: toCodeMirrorKey(shortcut),
    run: (view) => {
      runFormat(view, cmd)
      return true
    },
    preventDefault: true,
    stopPropagation: true
  }))
  return Prec.high(
    keymap.of([
      ...formatting,
      { key: toCodeMirrorKey(PASTE_PLAIN_SHORTCUT), run: pastePlain, preventDefault: true, stopPropagation: true },
      { key: 'Tab', run: indentOrList(1), shift: indentOrList(-1) }
    ])
  )
}
