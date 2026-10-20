import { fileURLToPath } from 'url'
import { isAbsolute, relative, resolve } from 'path'

// The window is loaded from file://, and Chromium lets a file:// page fetch any other
// file:// URL. Documents are rendered as sanitized HTML, but if a renderer bug ever let
// script run, it could read anything on disk that way and send it out in an image URL,
// skipping the main-process allow-list. So file:// requests are limited to the app's
// own bundle; documents and images always travel through checked IPC instead.

/** True when `url` is a file:// URL naming a path inside `bundleDir`. */
export function isBundledFileUrl(url: string, bundleDir: string, platform: NodeJS.Platform = process.platform): boolean {
  let path: string
  try {
    path = fileURLToPath(url)
  } catch {
    return false // file://host/... (a network share) or a malformed URL
  }
  if (/^[\\/]{2}/.test(path)) return false
  const fold = (p: string): string => (platform === 'win32' ? p.toLowerCase() : p)
  const rel = relative(fold(resolve(bundleDir)), fold(resolve(path)))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}
