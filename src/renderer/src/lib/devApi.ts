// Dev-only fallback for `window.api`, used when the renderer runs in a plain
// browser (no Electron preload) — e.g. opening the Vite dev server directly for
// visual checks. Guarded behind import.meta.env.DEV at the call site, so this
// module is tree-shaken out of production builds. Everything lives in memory.
import type { Api, FolderScan, MdFolderInfo, OpenedFile, Platform, RecoveryEntry, Settings } from '@shared/types'
import { DEV_SAMPLE_FILES } from './devSamples'

const ROOT = '/sample-notes'

const PASTED_ANSWER = `# How to center a div

Use **flexbox** on the parent:

\`\`\`css
.parent { display: flex; align-items: center; justify-content: center; }
\`\`\`

> [!TIP]
> \`place-items: center\` on a grid parent does the same in one line.
`

function joinPath(dir: string, name: string): string {
  return `${dir.replace(/\/+$/, '')}/${name}`
}
function baseName(p: string): string {
  return p.split('/').filter(Boolean).pop() ?? p
}
function dirName(p: string): string {
  const i = p.lastIndexOf('/')
  return i > 0 ? p.slice(0, i) : '/'
}
function withMdExt(name: string): string {
  return /\.(md|markdown|mdown|mkd|mdx|markdn)$/i.test(name) ? name : `${name}.md`
}

function previewPlatform(): Platform {
  const forced = new URLSearchParams(location.search).get('platform')
  if (forced === 'darwin' || forced === 'linux' || forced === 'win32') return forced
  return /Mac/i.test(navigator.platform) ? 'darwin' : 'win32'
}

export function installDevApi(): void {
  const contents: Record<string, string> = {}
  // folder path -> file names
  const folders = new Map<string, string[]>()
  for (const [folder, files] of Object.entries(DEV_SAMPLE_FILES)) {
    const dir = joinPath(ROOT, folder)
    folders.set(
      dir,
      files.map(([name]) => name)
    )
    for (const [name, body] of files) contents[joinPath(dir, name)] = body
  }

  const scan = (): FolderScan => {
    const tree: MdFolderInfo[] = []
    for (const [dir, names] of folders) {
      if (!names.length) continue
      const sorted = [...names].sort((a, b) => a.localeCompare(b))
      tree.push({
        id: dir,
        name: dir.slice(ROOT.length + 1) || 'sample-notes',
        path: dir,
        files: sorted.map((name) => ({
          id: joinPath(dir, name),
          name,
          path: joinPath(dir, name),
          dir
        }))
      })
    }
    const snapshot: Record<string, string> = {}
    for (const f of tree.flatMap((t) => t.files)) snapshot[f.path] = contents[f.path] ?? ''
    return { root: ROOT, name: 'sample-notes', tree, contents: snapshot }
  }

  const folderListeners = new Set<() => void>()
  const changed = (): void => folderListeners.forEach((cb) => setTimeout(cb, 50))

  const first = scan().tree[0]?.files[0]?.path ?? null
  const welcome = joinPath(ROOT, 'Getting Started/Welcome.md')
  const settings: Settings = {
    theme: 'system',
    accent: '#c0392b',
    readingFont: 'Serif',
    readingWidth: 720,
    readingSize: 17,
    lineHeight: 1.7,
    uiScale: 1,
    reduceMotion: false,
    syncScroll: true,
    blockRemoteImages: false,
    showStatusBar: true,
    sidebarOpen: true,
    outlineOpen: true,
    activity: 'files',
    viewMode: 'read',
    lastFolder: ROOT,
    pinned: [welcome],
    recents: [],
    openTabs: first ? [first, welcome] : [],
    activeId: first,
    looseFiles: [],
    recentFolders: [ROOT, '/Users/demo/Projects/agent-notes'],
    updateChecks: 'off',
    lastUpdateCheck: 0,
    skippedUpdate: ''
  }
  if (new URLSearchParams(location.search).has('empty')) {
    settings.lastFolder = null
    settings.openTabs = []
    settings.activeId = null
  }

  // ?recovery previews the "Recovered unsaved documents" prompt.
  let recovery: RecoveryEntry[] = new URLSearchParams(location.search).has('recovery')
    ? [
        {
          id: welcome,
          path: welcome,
          title: 'Welcome.md',
          content: `${contents[welcome] ?? ''}\n\nA line typed just before the crash.\n`,
          savedAt: Date.now() - 6 * 60_000
        },
        {
          id: 'untitled:1',
          path: null,
          title: 'Trip ideas',
          content: '# Trip ideas\n\n- Lisbon in spring\n',
          savedAt: Date.now() - 5 * 60_000
        }
      ]
    : []
  let zoom = 1

  const addFile = (dir: string, name: string, content: string): OpenedFile => {
    const path = joinPath(dir, name)
    if (contents[path] !== undefined) throw new Error(`${name} already exists`)
    contents[path] = content
    folders.set(dir, [...(folders.get(dir) ?? []), name])
    changed()
    return { path, content }
  }

  const api: Api = {
    platform: previewPlatform(),
    openFolder: async () => scan(),
    openFiles: async () => [
      {
        path: '/Sample Folder/Loose Note.md',
        content: '# Loose Note\n\nOpened as an individual file, grouped by its folder.'
      }
    ],
    openRecentFolder: async (path) => (path === ROOT ? scan() : null),
    resolveDrop: async () => ({ folder: null, files: [] }),
    takeLaunchFiles: async () => null,
    onOpenPaths: () => () => {},
    scanFolder: async () => scan(),
    readFile: async (path) => {
      if (contents[path] === undefined) throw new Error('missing')
      return contents[path]
    },
    saveFile: async (path, content) => {
      contents[path] = content
      return true
    },
    readImage: async () => null,
    createFile: async (dir, name, content = '') => addFile(dir, withMdExt(name), content),
    createFolder: async (parent, name) => {
      const dir = joinPath(parent, name)
      folders.set(dir, folders.get(dir) ?? [])
      return dir
    },
    renamePath: async (path, newName) => {
      const dir = dirName(path)
      const next = joinPath(dir, newName)
      if (contents[path] !== undefined) {
        if (contents[next] !== undefined) throw new Error(`${newName} already exists`)
        contents[next] = contents[path]
        delete contents[path]
        folders.set(
          dir,
          (folders.get(dir) ?? []).map((n) => (n === baseName(path) ? newName : n))
        )
      }
      changed()
      return next
    },
    duplicateFile: async (path) => {
      const dir = dirName(path)
      const stem = baseName(path).replace(/\.[^.]+$/, '')
      let n = 1
      let name = `${stem} copy.md`
      while (contents[joinPath(dir, name)] !== undefined) name = `${stem} copy ${++n}.md`
      return addFile(dir, name, contents[path] ?? '')
    },
    saveAs: async (defaultName, content) => {
      const name = window.prompt('Save as (preview)', withMdExt(defaultName))
      if (!name) return null
      const dir = joinPath(ROOT, 'Getting Started')
      const path = joinPath(dir, withMdExt(name))
      if (contents[path] === undefined) folders.set(dir, [...(folders.get(dir) ?? []), withMdExt(name)])
      contents[path] = content
      changed()
      return path
    },
    writeAsset: async (_docPath, fileName) => `assets/${fileName}`,
    exportHtml: async (defaultName, html) => {
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `${defaultName.replace(/\.[^.]+$/, '')}.html`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      return a.download
    },
    exportPdf: async () => {
      window.print()
      return false
    },
    readClipboardText: async () => {
      try {
        return (await navigator.clipboard.readText()) || PASTED_ANSWER
      } catch {
        return PASTED_ANSWER
      }
    },
    writeClipboardRich: async (html, text) => {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': new Blob([html], { type: 'text/html' }),
            'text/plain': new Blob([text], { type: 'text/plain' })
          })
        ])
      } catch {
        // clipboard permission denied in the preview
      }
    },
    saveRecovery: async (entries) => {
      recovery = entries
    },
    loadRecovery: async () => recovery,
    getSettings: async () => ({ ...settings }),
    setSettings: async (partial) => Object.assign(settings, partial),
    openExternal: async (url) => {
      window.open(url, '_blank', 'noopener')
    },
    // The browser preview never goes online: it always reports this version as the latest.
    checkForUpdates: async () => ({
      ok: true,
      info: { current: '0.0.0', latest: '0.0.0', available: false, url: 'https://github.com/njaske/SimpleMD/releases' }
    }),
    trashItem: async (path) => {
      if (contents[path] !== undefined) {
        delete contents[path]
        const dir = dirName(path)
        folders.set(
          dir,
          (folders.get(dir) ?? []).filter((n) => n !== baseName(path))
        )
        changed()
      }
      return true
    },
    revealItem: async () => {},
    setUnsaved: async () => {},
    onFolderChanged: (cb) => {
      folderListeners.add(cb)
      return () => folderListeners.delete(cb)
    },
    onRequestClose: () => () => {},
    win: {
      minimize: async () => {},
      maximizeToggle: async () => false,
      close: async () => {},
      forceClose: async () => {},
      isMaximized: async () => false,
      onMaximizeChange: () => () => {},
      setZoom: async (factor) => {
        zoom = factor
        document.documentElement.style.zoom = String(zoom)
      },
      toggleFullScreen: async () => {
        if (document.fullscreenElement) await document.exitFullscreen()
        else await document.documentElement.requestFullscreen()
        return !!document.fullscreenElement
      }
    }
  }
  ;(window as unknown as { api: Api }).api = api
  ;(window as unknown as { __smdDev: DevHelpers }).__smdDev = devHelpers(contents, folders, changed)
}

/** Preview-only hooks that act like an agent writing into the sample folder. */
export interface DevHelpers {
  /** Append `text` to the file at `path`. */
  appendToFile(path: string, text: string): void
  /** Replace the first occurrence of `search` in the file at `path`. */
  replaceInFile(path: string, search: string, replace: string): void
  /** Create a new file `name` in `dir` (created when missing). */
  addFile(dir: string, name: string, text: string): void
}

function devHelpers(contents: Record<string, string>, folders: Map<string, string[]>, changed: () => void): DevHelpers {
  const existing = (path: string): string => {
    const text = contents[path]
    if (text === undefined) throw new Error(`No file at ${path}`)
    return text
  }
  return {
    appendToFile(path, text) {
      contents[path] = existing(path) + text
      changed()
    },
    replaceInFile(path, search, replace) {
      const text = existing(path)
      if (!text.includes(search)) throw new Error(`"${search}" isn't in ${path}`)
      contents[path] = text.replace(search, replace)
      changed()
    },
    addFile(dir, name, text) {
      const path = joinPath(dir, name)
      if (contents[path] !== undefined) throw new Error(`${path} already exists`)
      contents[path] = text
      folders.set(dir, [...(folders.get(dir) ?? []), name])
      changed()
    }
  }
}
