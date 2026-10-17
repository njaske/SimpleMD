import { resolve } from 'path'

const MAX_LAUNCH_PATHS = 50

/** Paths passed on the command line (double-click, "Open with", `SimpleMD file.md`).
 *  Flags are skipped, relative paths resolve against `cwd`, duplicates are dropped.
 *  Whether each path exists and is a Markdown file or folder is decided later by
 *  `resolveDrop`, so junk arguments are simply ignored. */
export function extractLaunchPaths(args: readonly string[], cwd: string): string[] {
  const out = new Set<string>()
  for (const arg of args) {
    if (typeof arg !== 'string' || arg.length === 0 || arg.startsWith('-')) continue
    out.add(resolve(cwd, arg))
    if (out.size >= MAX_LAUNCH_PATHS) break
  }
  return [...out]
}
