// Smart paste in the editor: a URL over selected text becomes a link, spreadsheet cells a
// table, rich HTML Markdown. Inside code (fenced blocks, inline code) everything pastes as
// is, and so does plain text. Image files are handled by images.ts.
import type { EditorState, Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'
import { insertBlockText, pasteUrlOverSelection } from './format'
import { convertPaste } from './smartPaste'
import { dispatchEdit, textState } from './commands'

const CODE_NODES = /^(FencedCode|CodeBlock|InlineCode|CodeText|CodeInfo)$/

/** Is the main selection inside code, where text must stay exactly as pasted? */
export function selectionInCode(state: EditorState): boolean {
  const { from } = state.selection.main
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(from, -1); node; node = node.parent) {
    if (CODE_NODES.test(node.name)) return true
  }
  return false
}

function handlePaste(event: ClipboardEvent, view: EditorView): boolean {
  const data = event.clipboardData
  if (!data || data.files.length > 0 || selectionInCode(view.state)) return false
  const text = data.getData('text/plain')
  const link = pasteUrlOverSelection(textState(view.state), text)
  if (link) {
    dispatchEdit(view, link, 'input.paste')
    return true
  }
  const converted = convertPaste(data.getData('text/html'), text)
  if (!converted) return false
  // Tables, and multi-line Markdown pasted onto an empty line, get blank lines around them.
  const { main } = view.state.selection
  const emptyLine = main.empty && view.state.doc.lineAt(main.head).text.trim() === ''
  if (main.empty && (converted.block || (emptyLine && converted.markdown.includes('\n')))) {
    dispatchEdit(view, insertBlockText(textState(view.state), converted.markdown, converted.block), 'input.paste')
  } else {
    view.dispatch(view.state.replaceSelection(converted.markdown), { scrollIntoView: true, userEvent: 'input.paste' })
  }
  return true
}

export function smartPaste(): Extension {
  return EditorView.domEventHandlers({ paste: handlePaste })
}
