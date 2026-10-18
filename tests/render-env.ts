// Test environment for the renderer modules (not a test file itself). The renderer
// imports with the bundler's conventions (extensionless relative paths, `@/` aliases,
// CSS side imports) and DOMPurify needs a window, so tests call setupRenderEnv() and
// then load the modules under test with a dynamic import().
import { existsSync, statSync } from 'node:fs'
import * as nodeModule from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Window } from 'happy-dom'

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../src')
const ALIASES: Record<string, string> = {
  '@/': resolve(SRC, 'renderer/src'),
  '@shared/': resolve(SRC, 'shared')
}
const EMPTY_MODULE = 'data:text/javascript,export default {}'

function asFile(base: string): string | null {
  for (const candidate of [base + '.ts', base + '.tsx', resolve(base, 'index.ts')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return existsSync(base) && statSync(base).isFile() ? base : null
}

function sourcePath(specifier: string, parentURL: string | undefined): string | null {
  for (const [prefix, dir] of Object.entries(ALIASES)) {
    if (specifier.startsWith(prefix)) return asFile(resolve(dir, specifier.slice(prefix.length)))
  }
  const fromSource = parentURL?.startsWith('file:') && fileURLToPath(parentURL).startsWith(SRC)
  if (fromSource && /^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
    return asFile(resolve(dirname(fileURLToPath(parentURL)), specifier))
  }
  return null
}

let installed = false

function following(node: Node, root: Node): Node | null {
  if (node.firstChild) return node.firstChild
  for (let n: Node | null = node; n && n !== root; n = n.parentNode) if (n.nextSibling) return n.nextSibling
  return null
}

type Filter = ((node: Node) => number) | { acceptNode(node: Node): number } | null

/** A NodeIterator that survives removal of its current node (as the DOM spec says);
 *  happy-dom's stops there, which would end DOMPurify's walk early. */
function createNodeIterator(root: Node, whatToShow = 0xffffffff, filter: Filter = null): NodeIterator {
  const visited: Node[] = []
  const accepts = (node: Node): boolean => {
    if (!(whatToShow & (1 << (node.nodeType - 1)))) return false
    if (!filter) return true
    return (typeof filter === 'function' ? filter(node) : filter.acceptNode(node)) === 1
  }
  const nextNode = (): Node | null => {
    let from: Node | null = null
    while (visited.length) {
      const last = visited[visited.length - 1]
      if (last === root || root.contains(last)) {
        from = last
        break
      }
      visited.pop()
    }
    let node = from ? following(from, root) : root
    while (node && !accepts(node)) node = following(node, root)
    if (node) visited.push(node)
    return node
  }
  return { root, whatToShow, filter, nextNode, detach: () => undefined } as unknown as NodeIterator
}

/** happy-dom defines nodeName per subclass, while DOMPurify reads it through the
 *  Node.prototype getter (as browsers allow); route that getter to the subclass.
 *  Its removeAttributeNode also ignores attribute objects it didn't hand out itself. */
function patchForPurify(window: Window): void {
  Object.defineProperty(window.document, 'createNodeIterator', { value: createNodeIterator })
  const element = window.Element.prototype
  const removeNode = element.removeAttributeNode
  element.removeAttributeNode = function (this: Element, attr: Attr): Attr | null {
    const removed = removeNode.call(this, attr)
    if (this.hasAttribute(attr.name)) this.removeAttribute(attr.name)
    return removed
  } as typeof removeNode
  const proto = window.Node.prototype
  const base = Object.getOwnPropertyDescriptor(proto, 'nodeName')
  Object.defineProperty(proto, 'nodeName', {
    configurable: true,
    get(this: object): string {
      for (let p = Object.getPrototypeOf(this); p && p !== proto; p = Object.getPrototypeOf(p)) {
        const own = Object.getOwnPropertyDescriptor(p, 'nodeName')
        if (own?.get) return own.get.call(this)
      }
      return base?.get ? base.get.call(this) : ''
    }
  })
}

/** Install the module resolution hooks and happy-dom globals (idempotent). */
export function setupRenderEnv(): Window {
  if (!installed) {
    // A namespace import, so older Node gets this message instead of a link error.
    const { registerHooks } = nodeModule
    if (typeof registerHooks !== 'function') {
      throw new Error(`The renderer tests need Node 22.15+ (module.registerHooks); this is Node ${process.version}.`)
    }
    registerHooks({
      resolve(specifier, context, nextResolve) {
        if (specifier.endsWith('.css')) return { url: EMPTY_MODULE, shortCircuit: true }
        const file = sourcePath(specifier, context.parentURL)
        if (file) return { url: pathToFileURL(file).href, shortCircuit: true }
        return nextResolve(specifier, context)
      }
    })
    installed = true
  }
  const existing = (globalThis as { window?: Window }).window
  if (existing instanceof Window) return existing
  const window = new Window({ url: 'http://localhost/' })
  patchForPurify(window)
  // Standards mode, as in the app (KaTeX warns in quirks mode).
  window.document.write('<!doctype html><html><head></head><body></body></html>')
  Object.assign(globalThis, {
    window,
    document: window.document,
    Node: window.Node,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    DocumentFragment: window.DocumentFragment,
    NodeFilter: window.NodeFilter,
    DOMParser: window.DOMParser
  })
  return window
}

/** A detached <body> holding `html`, for DOM assertions. */
export function parseHtml(html: string): HTMLElement {
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}</body>`, 'text/html')
  return doc.body
}
