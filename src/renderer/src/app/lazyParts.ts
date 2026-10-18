// Everything the first paint of a document doesn't need loads on demand, keeping the
// startup chunk small: the editor and its format bar, the find bar, the palette,
// Settings, the Aa popover, dialogs, the Welcome screen, exports and the diff module.
// prefetchLazyParts() warms them all while the app is idle, so first use is instant.
import { lazy } from 'react'

const editor = () => import('@/components/CodeEditor')
const formatBar = () => import('@/components/FormatBar')
const findBar = () => import('@/components/FindBar')
const palette = () => import('@/components/CommandPalette')
const settings = () => import('@/components/SettingsDialog')
const reading = () => import('@/components/ReadingPopover')
const prompts = () => import('@/components/Prompts')
const recovery = () => import('@/components/RecoveryPrompt')
const welcome = () => import('@/components/Welcome')
const contextMenu = () => import('@/components/ContextMenu')
const menus = () => import('./menus')

export const CodeEditor = lazy(editor)
export const FormatBar = lazy(formatBar)
export const FindBar = lazy(findBar)
export const CommandPalette = lazy(palette)
export const SettingsDialog = lazy(settings)
export const ReadingPopover = lazy(reading)
export const RecoveryPrompt = lazy(recovery)
export const Welcome = lazy(welcome)
export const ContextMenu = lazy(contextMenu)
export const ConfirmDialog = lazy(() => prompts().then((m) => ({ default: m.ConfirmDialog })))
export const UnsavedDialog = lazy(() => prompts().then((m) => ({ default: m.UnsavedDialog })))
export const CloseWindowDialog = lazy(() => prompts().then((m) => ({ default: m.CloseWindowDialog })))
export const NameDialog = lazy(() => prompts().then((m) => ({ default: m.NameDialog })))

/** Export code (standalone HTML, rich text) is only needed when exporting. */
export const loadExport = () => import('@/lib/reader/export')

type Loader = () => Promise<unknown>

/** In rough order of likely first use. */
const WARM: readonly Loader[] = [
  palette,
  contextMenu,
  menus,
  findBar,
  reading,
  prompts,
  editor,
  formatBar,
  settings,
  recovery,
  welcome,
  loadExport
]

const idle = (cb: () => void): void => {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(cb, { timeout: 5_000 })
  else setTimeout(cb, 200)
}

/** Load each lazy part in its own idle slot, so warming never competes with input. */
export function prefetchLazyParts(extra: readonly Loader[] = []): void {
  const queue = [...WARM, ...extra]
  const next = (): void => {
    const load = queue.shift()
    if (!load) return
    // A failed prefetch just means the part loads (or reports) on first use.
    void load().catch(() => undefined)
    idle(next)
  }
  idle(next)
}
