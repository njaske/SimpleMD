// Pasting or dropping image files into the editor: the app saves each file next to the
// document and we insert ![name](path) where it was dropped (or at the cursor). Other
// file drops are handed to the app untouched so it can open them.
import { StateEffect, StateField, type Extension, type Text } from '@codemirror/state'
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

// ---- what to take -------------------------------------------------------------------------

export function splitFiles(list: ArrayLike<File> | null | undefined): { images: File[]; others: File[] } {
  const files = Array.from(list ?? [])
  return { images: files.filter(isImageFile), others: files.filter((f) => !isImageFile(f)) }
}

/** Visible text in clipboard HTML (Office adds <style> and comments around a lone <img>). */
export function htmlHasText(html: string): boolean {
  const text = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(style|script|head|title)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;|&#160;/gi, ' ')
  return text.trim() !== ''
}

export interface ClipboardFiles {
  readonly files: ArrayLike<File>
  getData(format: string): string
}

/** The images to insert for a paste. Only an image-only clipboard counts: spreadsheets
 *  (Excel puts a picture of the cells next to the text) and rich text with pictures paste
 *  as text. Plain text naming the copied files (Finder, Explorer) doesn't count as text. */
export function pastedImages(data: ClipboardFiles | null): File[] {
  const { images } = splitFiles(data?.files)
  if (!data || !images.length) return []
  const lines = data.getData('text/plain').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const namesOnly = lines.every((line) => images.some((f) => f.name !== '' && line.endsWith(f.name)))
  return namesOnly && !htmlHasText(data.getData('text/html')) ? images : []
}

// ---- where it lands -----------------------------------------------------------------------

export interface ImageInsert {
  readonly from: number
  readonly to: number
  readonly insert: string
  /** Cursor position after the insert: just after the image text. */
  readonly cursor: number
}

const blank = (doc: Text, n: number): boolean => n < 1 || n > doc.lines || doc.line(n).text.trim() === ''

/** Where `images` (Markdown) goes for a paste or drop at [from, to]: its own paragraph on a
 *  blank line or at the start of a line (so "# Title" stays a heading), inline otherwise. */
export function placeImages(doc: Text, from: number, to: number, images: string): ImageInsert {
  const line = doc.lineAt(from)
  const inline = { from, to, insert: images, cursor: from + images.length }
  if (to > line.to) return inline
  const rest = line.text.slice(0, from - line.from) + line.text.slice(to - line.from)
  const before = blank(doc, line.number - 1) ? '' : '\n'
  if (rest.trim() === '') {
    const after = blank(doc, line.number + 1) ? '' : '\n'
    return { from: line.from, to: line.to, insert: before + images + after, cursor: line.from + before.length + images.length }
  }
  if (from !== line.from) return inline
  return { from, to, insert: before + images + '\n\n', cursor: from + before.length + images.length }
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
  const images = done.map((s) => markdownImage(imageAlt(s.name), s.path)).join('\n')
  const place = placeImages(view.state.doc, spot.from, spot.to, images)
  const { main } = view.state.selection
  // Follow the image with the cursor only if the user is still waiting where it lands.
  const cursorHere = main.empty && main.head >= spot.from && main.head <= spot.to
  view.dispatch({
    changes: { from: place.from, to: place.to, insert: place.insert },
    effects: removePending.of(id),
    selection: cursorHere ? { anchor: place.cursor } : undefined,
    scrollIntoView: cursorHere,
    userEvent
  })
}

/** Save `files` through the hooks and insert them at [at.from, at.to] once saved, wherever
 *  that range has moved to by then. False when the editor has no way to save images. */
export function insertImages(view: EditorView, files: readonly File[], at: { from: number; to: number }, hooks: ImageHooks, userEvent: string): boolean {
  const save = hooks.save()
  if (!save || !files.length) return false
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
  return true
}

// ---- DOM wiring -------------------------------------------------------------------------------

const hasFiles = (data: DataTransfer | null): boolean => Array.from(data?.types ?? []).includes('Files')

function dropImages(view: EditorView, event: DragEvent, images: readonly File[], hooks: ImageHooks): void {
  const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head
  view.focus()
  insertImages(view, images, { from: pos, to: pos }, hooks, 'input.drop')
}

/** A copy of `data` holding only `files`, for handing the rest of a mixed drop on. */
function transferOf(files: readonly File[]): DataTransfer {
  const data = new DataTransfer()
  files.forEach((file) => data.items.add(file))
  return data
}

/** Re-send a drop from outside the editor, un-cancelled, for the app to open. */
function forwardDrop(view: EditorView, e: DragEvent, data: DataTransfer | null): void {
  const target = view.dom.parentElement ?? document.body
  const init = { bubbles: true, cancelable: true, composed: true, clientX: e.clientX, clientY: e.clientY, screenX: e.screenX, screenY: e.screenY, dataTransfer: data }
  target.dispatchEvent(new DragEvent('drop', init))
}

/** Files the editor won't take (Markdown, folders, or images with nowhere to save them) go
 *  to the app: CodeMirror would otherwise read them into the document as text. A mixed
 *  drop is split: the images go in here, everything else goes on to the app. */
function forwardFileDrops(hooks: ImageHooks): Extension {
  return ViewPlugin.define((view) => {
    const saves = (): boolean => hooks.save() !== undefined
    const onDragOver = (e: DragEvent): void => {
      if (!hasFiles(e.dataTransfer) || (saves() && dragCarriesImages(e.dataTransfer))) return
      // Allow the drop but keep CodeMirror's caret away: this isn't going into the text.
      e.preventDefault()
      e.stopPropagation()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
    const onDrop = (e: DragEvent): void => {
      if (!hasFiles(e.dataTransfer)) return
      const { images, others } = splitFiles(e.dataTransfer?.files)
      const takeImages = images.length > 0 && saves()
      // Images alone: the drop handler in imageHandling takes it.
      if (takeImages && !others.length) return
      e.preventDefault()
      e.stopPropagation()
      if (takeImages) dropImages(view, e, images, hooks)
      forwardDrop(view, e, takeImages ? transferOf(others) : e.dataTransfer)
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
        return insertImages(view, pastedImages(event.clipboardData), view.state.selection.main, hooks, 'input.paste')
      },
      drop(event, view) {
        const { images } = splitFiles(event.dataTransfer?.files)
        if (!images.length || !hooks.save()) return false
        // Cancelled on purpose: the drop still bubbles, and the app's isEditorHandledDrop
        // (drops.ts) reads this to know the editor took it.
        event.preventDefault()
        dropImages(view, event, images, hooks)
        return true
      }
    })
  ]
}
