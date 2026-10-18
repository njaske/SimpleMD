// The "Recent folders" list: written by the main process only (it decides which
// folders `fs:openRecentFolder` will re-grant), most recent first, deduplicated.

export const MAX_RECENT_FOLDERS = 10

function sameFolder(a: string, b: string, caseInsensitive: boolean): boolean {
  return caseInsensitive ? a.toLowerCase() === b.toLowerCase() : a === b
}

/** `list` with `folder` moved (or added) to the front, capped at 10 entries. */
export function addRecentFolder(
  list: readonly unknown[] | undefined,
  folder: string,
  caseInsensitive: boolean
): string[] {
  const rest = (list ?? []).filter(
    (p): p is string => typeof p === 'string' && p.length > 0 && !sameFolder(p, folder, caseInsensitive)
  )
  return [folder, ...rest].slice(0, MAX_RECENT_FOLDERS)
}

/** `list` without the exact entry `folder`. */
export function removeRecentFolder(list: readonly unknown[] | undefined, folder: string): string[] {
  return (list ?? []).filter((p): p is string => typeof p === 'string' && p !== folder)
}

/** True only for an exact entry of the list: the renderer can't widen access by
 *  sending a differently spelled or nested path. */
export function isRecentFolder(list: readonly unknown[] | undefined, folder: unknown): folder is string {
  return typeof folder === 'string' && folder.length > 0 && (list ?? []).includes(folder)
}
