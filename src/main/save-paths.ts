import { basename, extname } from 'path'
import { isLocalAbsolute } from './access'
import { hasUnsafeExtension, nameProblem } from './file-ops'

// Names and paths for the Save dialogs (Save As, HTML and PDF export). No
// Electron imports, so the rules are unit-tested; ipc-workspace shows the dialogs.

// An ending that reads as a real file type ("notes.txt", "page.html"). Numeric or
// spaced endings ("Version 1.2", "Chapter 1. Intro") are part of the title.
const REAL_EXTENSION = /^\.[A-Za-z][A-Za-z0-9_-]{0,15}$/

/** A bare, valid file name for a Save dialog, from whatever the renderer sent. */
export function suggestedName(defaultName: unknown, fallback: string): string {
  const raw = typeof defaultName === 'string' ? basename(defaultName.replace(/\\/g, '/')).trim() : ''
  return raw && !nameProblem(raw, 'file') ? raw : fallback
}

/** A bare stem for an export's file name ("notes.md" becomes "notes"). */
export function exportStem(defaultName: unknown): string {
  return suggestedName(defaultName, 'document').replace(/\.[^.]+$/, '') || 'document'
}

/** True when `name` ends in something that looks like a file type. */
export function hasRealExtension(name: string): boolean {
  return REAL_EXTENSION.test(extname(name))
}

/** The path the user chose, with `ext` added when they typed no real extension
 *  (dialogs on Linux never add one). Refuses runnable file types and network
 *  locations. */
export function chosenPath(filePath: string, ext: string): string {
  const target = hasRealExtension(filePath) ? filePath : `${filePath}${ext}`
  if (hasUnsafeExtension(target)) throw new Error('SimpleMD can’t save files of that type.')
  if (!isLocalAbsolute(target)) {
    throw new Error('SimpleMD can’t save to network locations. Choose a folder on this computer.')
  }
  return target
}
