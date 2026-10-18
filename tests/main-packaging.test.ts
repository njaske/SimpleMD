import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { builtinModules } from 'node:module'
import { join } from 'node:path'
import { describe, it } from 'node:test'

// electron-builder.yml leaves node_modules out of the app archive, and
// electron-vite keeps the main and preload dependencies external. So a package
// imported at runtime from main or preload would work in `npm run dev` and fail
// only in the installed app ("Cannot find module"). Only Electron, Node
// built-ins and our own files may be loaded there; type-only imports are erased.

const SOURCE_DIRS = ['src/main', 'src/preload', 'src/shared']
const BUILTINS = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]))

const STATIC_IMPORT = /^\s*(import|export)\s+(type\s+)?(?:[\w*{}\s,$]+?\s+from\s+)?['"]([^'"]+)['"]/gm
const DYNAMIC_IMPORT = /\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true })
  return entries
    .filter((entry) => entry.isFile() && /\.ts$/.test(entry.name) && !entry.name.endsWith('.d.ts'))
    .map((entry) => join(entry.parentPath, entry.name))
}

/** Every module a file loads at runtime (type-only imports excluded). */
export function runtimeImports(source: string): string[] {
  const found: string[] = []
  for (const match of source.matchAll(STATIC_IMPORT)) {
    if (!match[2]) found.push(match[3])
  }
  for (const match of source.matchAll(DYNAMIC_IMPORT)) found.push(match[1])
  return found
}

function isAllowed(specifier: string): boolean {
  return specifier === 'electron' || specifier.startsWith('.') || BUILTINS.has(specifier)
}

describe('main and preload runtime dependencies', () => {
  it('finds imports in multi-line and type-mixed forms, ignoring type-only ones', () => {
    const sample = [
      "import { app } from 'electron'",
      "import type { Settings } from 'some-types'",
      'import {',
      '  a,',
      '  type B',
      "} from './local'",
      "export { x } from './again'",
      "const lazy = await import('lazy-dep')"
    ].join('\n')
    assert.deepEqual(runtimeImports(sample), ['electron', './local', './again', 'lazy-dep'])
  })

  it('load only Electron, Node built-ins and relative files', async () => {
    const files = (await Promise.all(SOURCE_DIRS.map(sourceFiles))).flat()
    assert.ok(files.length > 10, 'expected to scan the main-process sources')
    const offenders: string[] = []
    for (const file of files) {
      for (const specifier of runtimeImports(await readFile(file, 'utf8'))) {
        if (!isAllowed(specifier)) offenders.push(`${file}: ${specifier}`)
      }
    }
    assert.deepEqual(offenders, [], 'bundle these or add node_modules back to electron-builder.yml')
  })
})
