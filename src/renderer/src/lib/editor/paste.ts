// Smart paste in the editor: a URL over selected text becomes a link, spreadsheet cells a
// table, rich HTML Markdown. Inside code (fenced blocks, inline code) everything pastes as
// is, and so does plain text. Image-only clipboards are handled by images.ts, which runs
// first; when it passes (text or HTML came along), the text wins here.
import type { EditorState, Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'
import { insertBlockText, pasteUrlOverSelection, type FormatEdit } from './format'
import { convertPaste } from './smartPaste'
import { dispatchEdit, textState } from './commands'

const CODE_NODES = /^(FencedCode|CodeBlock|InlineCode|CodeText|CodeInfo)$/

/** The clipboard parts paste routing reads; a DataTransfer fits. */
export interface ClipboardText {
  getData(format: string): string
}

/** What a paste does: wrap the selection as a link, insert a block on its own lines,
 *  replace the selection inline, or (null) leave it to CodeMirror's plain paste. */
export type PastePlan =
  | { readonly kind: 'link' | 'block'; readonly edit: FormatEdit }
  | { readonly kind: 'inline'; readonly text: string }
  | null

/** Is the main selection inside code, where text must stay exactly as pasted? */
export function selectionInCode(state: EditorState): boolean {
  const { from } = state.selection.main
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(from, -1); node; node = node.parent) {
    if (CODE_NODES.test(node.name)) return true
  }
  return false
}

export function planPaste(state: EditorState, data: ClipboardText): PastePlan {
  if (selectionInCode(state)) return null
  const text = data.getData('text/plain')
  const link = pasteUrlOverSelection(textState(state), text)
  if (link) return { kind: 'link', edit: link }
  const converted = convertPaste(data.getData('text/html'), text)
  if (!converted) return null
  // Tables, and multi-line Markdown pasted onto an empty line, get blank lines around them.
  const { main } = state.selection
  const emptyLine = main.empty && state.doc.lineAt(main.head).text.trim() === ''
  if (main.empty && (converted.block || (emptyLine && converted.markdown.includes('\n')))) {
    return { kind: 'block', edit: insertBlockText(textState(state), converted.markdown, converted.fresh) }
  }
  return { kind: 'inline', text: converted.markdown }
}

function handlePaste(event: ClipboardEvent, view: EditorView): boolean {
  const plan = event.clipboardData ? planPaste(view.state, event.clipboardData) : null
  if (!plan) return false
  if (plan.kind === 'inline') {
    view.dispatch(view.state.replaceSelection(plan.text), { scrollIntoView: true, userEvent: 'input.paste' })
  } else {
    dispatchEdit(view, plan.edit, 'input.paste')
  }
  return true
}

export function smartPaste(): Extension {
  return EditorView.domEventHandlers({ paste: handlePaste })
}
