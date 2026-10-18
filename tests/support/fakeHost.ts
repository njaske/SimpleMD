// A stand-in for the App component: state in a variable, patches applied
// immutably, toasts collected. Pair it with a stubbed window.api per test.
import type { Api, FolderScan, MdFileInfo } from '../../src/shared/types.ts'
import type { AppHost, Updater } from '../../src/renderer/src/app/host.ts'
import type { AppState } from '../../src/renderer/src/app/types.ts'
import type { ToastAction } from '../../src/renderer/src/components/Toast.tsx'

export interface FakeHost {
  host: AppHost
  state: () => AppState
  toasts: string[]
  /** The action button of each toast (undefined when it had none). */
  toastActions: (ToastAction | undefined)[]
}

export async function fakeHost(over: Partial<AppState> = {}): Promise<FakeHost> {
  const { initialState } = await import('../../src/renderer/src/app/initialState.ts')
  let state: AppState = { ...initialState({ systemDark: false, narrow: false, compact: false }), ready: true, restored: true, ...over }
  const toasts: string[] = []
  const toastActions: (ToastAction | undefined)[] = []
  const host: AppHost = {
    platform: 'win32',
    reader: {} as AppHost['reader'],
    state: () => state,
    update: (u: Updater, then?: () => void) => {
      const patch = typeof u === 'function' ? u(state) : u
      if (patch) state = { ...state, ...patch }
      then?.()
    },
    toast: (message, action) => {
      toasts.push(message)
      toastActions.push(action)
    },
    nameOf: (id) => id.split(/[\/]/).pop() ?? id,
    renderDoc: () => undefined,
    focusEditor: () => undefined
  }
  return { host, state: () => state, toasts, toastActions }
}

/** Install `api` as window.api (only the methods a test needs). */
export function stubApi(api: Partial<Api>): void {
  Object.assign(globalThis, { window: { api } })
}

export function file(dir: string, name: string): MdFileInfo {
  const path = `${dir}/${name}`
  return { id: path, name, path, dir }
}

/** A workspace scan of `files` (path -> text), grouped by directory. */
export function scanOf(root: string, files: Record<string, string>): FolderScan {
  const byDir = new Map<string, MdFileInfo[]>()
  for (const path of Object.keys(files)) {
    const dir = path.slice(0, path.lastIndexOf('/'))
    byDir.set(dir, [...(byDir.get(dir) ?? []), file(dir, path.slice(dir.length + 1))])
  }
  const tree = [...byDir].map(([dir, list]) => ({ id: dir, name: dir.split('/').pop() ?? dir, path: dir, files: list }))
  return { root, name: root.split('/').pop() ?? root, tree, contents: { ...files } }
}
