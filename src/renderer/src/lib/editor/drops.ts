// The drag-and-drop contract between the editor and the app. The editor takes image files
// (saved next to the document and linked where they land); every other drop bubbles up
// for the app to open. The app's own drag handlers call these to stay out of the editor's
// way. No CodeMirror here, so the app shell can import it without loading the editor.

// The formats the main process accepts for pasted/dropped images (it checks the bytes too).
export const IMAGE_TYPES: ReadonlySet<string> = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp', 'image/avif'])

const EDITOR_SELECTOR = '.cm-editor'

interface DragLike {
  readonly target: EventTarget | null
  readonly defaultPrevented: boolean
  readonly dataTransfer: DataTransfer | null
}

function isInsideEditor(target: EventTarget | null): boolean {
  if (typeof Node === 'undefined' || !(target instanceof Node)) return false
  const el = target instanceof Element ? target : target.parentElement
  return el?.closest(EDITOR_SELECTOR) != null
}

/** During a drag only the item types are readable, not the files themselves. */
export function dragCarriesImages(data: DataTransfer | null): boolean {
  return Array.from(data?.items ?? []).some((item) => item.kind === 'file' && IMAGE_TYPES.has(item.type))
}

/** A drop the editor already took: images it is inserting, or text moved within it. The
 *  app should only clear its drop UI, not try to open the files ("Nothing to open"). */
export function isEditorHandledDrop(e: DragLike): boolean {
  return e.defaultPrevented && isInsideEditor(e.target)
}

/** Image files dragged over an editor that saves images (CodeEditor got onSaveImage): they
 *  will be inserted, not opened, so the app shouldn't show its "Drop to open" overlay. */
export function isEditorImageDrag(e: DragLike): boolean {
  return isInsideEditor(e.target) && dragCarriesImages(e.dataTransfer)
}
