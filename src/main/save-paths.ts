import { basename, extname } from 'path'
import { isLocalAbsolute } from './access'
import { hasUnsafeExtension, isMarkdownName, nameShapeProblem } from './file-ops'

// Names and paths for the Save dialogs (Save As, HTML and PDF export). No
// Electron imports, so the rules are unit-tested; ipc-workspace shows the dialogs.

// An ending that reads as a real file type ("notes.txt", "page.html"). Numeric or
// spaced endings ("Version 1.2", "Chapter 1. Intro") are part of the title.
const REAL_EXTENSION = /^\.[A-Za-z][A-Za-z0-9_-]{0,15}$/

/** A bare, valid file name for a Save dialog, from whatever the renderer sent.
 *  Only a starting point: the path the user picks still goes through chosenPath,
 *  so a title such as "Intro to Node.js" is kept (it saves with ".md" added). */
export function suggestedName(defaultName: unknown, fallback: string): string {
  const raw = typeof defaultName === 'string' ? basename(defaultName.replace(/\\/g, '/')).trim() : ''
  return raw && !nameShapeProblem(raw, 'file') ? raw : fallback
}

/** A bare stem for an export's file name ("notes.md" becomes "notes"). Only a
 *  Markdown extension is dropped: the renderer usually sends the stem already,
 *  and "Intro to Node.js" or "Version 1.2" must keep their endings. */
export function exportStem(defaultName: unknown): string {
  const name = suggestedName(defaultName, 'document')
  return (isMarkdownName(name) ? name.slice(0, -extname(name).length) : name) || 'document'
}

/** True when `name` ends in something that looks like a file type. */
export function hasRealExtension(name: string): boolean {
  return REAL_EXTENSION.test(extname(name))
}

/** The path the user chose, with `ext` added when they typed no real extension
 *  (dialogs on Linux never add one). A runnable ending counts as part of the
 *  title, so "Intro to Node.js" saves as "Intro to Node.js.md". Refuses network
 *  locations, and runnable types as a backstop. */
export function chosenPath(filePath: string, ext: string): string {
  const typed = hasRealExtension(filePath) && !hasUnsafeExtension(filePath)
  const target = typed ? filePath : `${filePath}${ext}`
  if (hasUnsafeExtension(target)) throw new Error('SimpleMD can’t save files of that type.')
  if (!isLocalAbsolute(target)) {
    throw new Error('SimpleMD can’t save to network locations. Choose a folder on this computer.')
  }
  return target
}
