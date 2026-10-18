// Pasting or dropping image files into the editor: the app saves each file next to the
// document and we insert ![name](path) where it was dropped (or at the cursor). Other
// file drops are handed to the app untouched so it can open them.
import { StateEffect, StateField, type Extension } from '@codemirror/state'
import { EditorView, ViewPlugin } from '@codemirror/view'
import { dragCarriesImages, IMAGE_TYPES } from './drops'

/** Resolves to the Markdown-ready relative path, or null when the document has no folder. */
export type SaveImage = (file: File) => Promise<string | null>

export interface ImageHooks {
  /** The current save callback (read late, so it can change after the editor mounts). */
  save: () => SaveImage | undefined
  notice: (message: string) => void
}

export const UNSAVED_NOTICE = 'Save this document first to add images'
const FAILED_NOTICE = "Couldn't add the image. Check that the document's folder still exists, then try again."

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|avif)$/i

export function isImageFile(file: { type: string; name: string }): boolean {
  return file.type ? IMAGE_TYPES.has(file.type) : IMAGE_EXT.test(file.name)
}

/** Alt text from a file name: "team-photo_2.png" -> "team photo 2". */
export function imageAlt(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/, '')
  const words = stem.replace(/[-_]+/g, ' ').replace(/[[\]\\]/g, '').replace(/\s+/g, ' ').trim()
  return words || 'image'
}

/** "![alt](path)"; destinations with spaces or parentheses go in <angle brackets>. */
export function markdownImage(alt: string, path: string): string {
  const dest = /[\s()<>]/.test(path) ? `<${path.replace(/[<>]/g, '')}>` : path
  return `![${alt}](${dest})`
}

// ---- pending inserts -----------------------------------------------------------------------

interface Pending {
  readonly id: number
  readonly from: number
  readonly to: number
}

const addPending = StateEffect.define<Pending>()
const removePending = StateEffect.define<number>()

// Where each in-flight image will land, kept in step with edits made while it saves.
const pendingField = StateField.define<readonly Pending[]>({
  create: () => [],
  update(value, tr) {
    const mapped = tr.docChanged
      ? value.map((p) => ({ id: p.id, from: tr.changes.mapPos(p.from, -1), to: tr.changes.mapPos(p.to, 1) }))
      : value
    return tr.effects.reduce<readonly Pending[]>((list, e) => {
      if (e.is(addPending)) return [...list, e.value]
      if (e.is(removePending)) return list.filter((p) => p.id !== e.value)
      return list
    }, mapped)
  }
})

let nextId = 1

interface Saved {
  readonly name: string
  readonly path: string | null
}

function finishInsert(view: EditorView, id: number, saved: readonly Saved[], userEvent: string): void {
  const spot = view.state.field(pendingField).find((p) => p.id === id)
  const done = saved.filter((s): s is { name: string; path: string } => s.path !== null)
  if (!spot || !done.length) {
    view.dispatch({ effects: removePending.of(id) })
    return
  }
  const insert = done.map((s) => markdownImage(imageAlt(s.name), s.path)).join('\n')
  const { main } = view.state.selection
  // Follow the image with the cursor only if the user is still waiting where it lands.
  const cursorHere = main.empty && main.head >= spot.from && main.head <= spot.to
  view.dispatch({
    changes: { from: spot.from, to: spot.to, insert },
    effects: removePending.of(id),
    selection: cursorHere ? { anchor: spot.from + insert.length } : undefined,
    scrollIntoView: cursorHere,
    userEvent
  })
}

function insertImages(view: EditorView, files: readonly File[], at: { from: number; to: number }, hooks: ImageHooks, userEvent: string): void {
  const save = hooks.save()
  if (!save) return
  const id = nextId++
  view.dispatch({ effects: addPending.of({ id, from: at.from, to: at.to }) })
  Promise.all(files.map(async (file) => ({ name: file.name, path: await save(file) })))
    .then((saved) => {
      if (!view.dom.isConnected) return
      if (saved.some((s) => s.path === null)) hooks.notice(UNSAVED_NOTICE)
      finishInsert(view, id, saved, userEvent)
    })
    .catch(() => {
      if (!view.dom.isConnected) return
      hooks.notice(FAILED_NOTICE)
      view.dispatch({ effects: removePending.of(id) })
    })
}

// ---- DOM wiring -------------------------------------------------------------------------------

function imagesOf(list: FileList | null | undefined): File[] {
  return Array.from(list ?? []).filter(isImageFile)
}

const hasFiles = (data: DataTransfer | null): boolean => Array.from(data?.types ?? []).includes('Files')

/** Files the editor won't take (Markdown, folders, or images with nowhere to save them) go
 *  to the app: CodeMirror would otherwise read them into the document as text. The drop is
 *  stopped here and re-sent from outside the editor, un-cancelled, for the app to open. */
function forwardFileDrops(hooks: ImageHooks): Extension {
  return ViewPlugin.define((view) => {
    const wanted = (data: DataTransfer | null, files: boolean): boolean =>
      hooks.save() !== undefined && (files ? imagesOf(data?.files).length > 0 : dragCarriesImages(data))
    const onDragOver = (e: DragEvent): void => {
      if (!hasFiles(e.dataTransfer) || wanted(e.dataTransfer, false)) return
      // Allow the drop but keep CodeMirror's caret away: this isn't going into the text.
      e.preventDefault()
      e.stopPropagation()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
    const onDrop = (e: DragEvent): void => {
      if (!hasFiles(e.dataTransfer) || wanted(e.dataTransfer, true)) return
      e.preventDefault()
      e.stopPropagation()
      const target = view.dom.parentElement ?? document.body
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, composed: true, clientX: e.clientX, clientY: e.clientY, screenX: e.screenX, screenY: e.screenY, dataTransfer: e.dataTransfer }))
    }
    view.dom.addEventListener('dragover', onDragOver, true)
    view.dom.addEventListener('drop', onDrop, true)
    return {
      destroy() {
        view.dom.removeEventListener('dragover', onDragOver, true)
        view.dom.removeEventListener('drop', onDrop, true)
      }
    }
  })
}

/** Image paste and drop. Unsaved documents get `hooks.notice(UNSAVED_NOTICE)`. A drop the
 *  editor takes is cancelled but still bubbles; see drops.ts for how the app skips it. */
export function imageHandling(hooks: ImageHooks): Extension {
  return [
    pendingField,
    forwardFileDrops(hooks),
    EditorView.domEventHandlers({
      paste(event, view) {
        const images = imagesOf(event.clipboardData?.files)
        if (!images.length || !hooks.save()) return false
        insertImages(view, images, view.state.selection.main, hooks, 'input.paste')
        return true
      },
      drop(event, view) {
        const images = imagesOf(event.dataTransfer?.files)
        if (!images.length || !hooks.save()) return false
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head
        // Cancelled on purpose: the drop still bubbles, and the app's isEditorHandledDrop
        // (drops.ts) reads this to know the editor took it.
        event.preventDefault()
        view.focus()
        insertImages(view, images, { from: pos, to: pos }, hooks, 'input.drop')
        return true
      }
    })
  ]
}
