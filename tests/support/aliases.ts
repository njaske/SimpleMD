// Lets node:test load renderer modules as Vite does: resolves the "@/" and
// "@shared/" aliases and extensionless relative imports to .ts files.
// Import this first, then load the module under test with a dynamic import().
import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'

const SRC = new URL('../../src/', import.meta.url)
const HAS_EXT = /\.(?:[cm]?[jt]s|json)$/

function aliased(specifier: string): string {
  if (specifier.startsWith('@/')) return new URL(`renderer/src/${specifier.slice(2)}`, SRC).href
  if (specifier.startsWith('@shared/')) return new URL(`shared/${specifier.slice(8)}`, SRC).href
  return specifier
}

registerHooks({
  resolve(specifier, context, next) {
    const spec = aliased(specifier)
    const local = spec.startsWith('file:') || spec.startsWith('.')
    if (local && !HAS_EXT.test(spec) && context.parentURL) {
      const base = new URL(spec, context.parentURL)
      const hit = ['.ts', '/index.ts'].map((ext) => new URL(base.href + ext)).find((u) => existsSync(u))
      if (hit) return next(hit.href, context)
    }
    return next(spec, context)
  }
})
