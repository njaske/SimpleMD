// What the controller modules need from the App component. Keeps App.tsx a thin
// shell: modules read state, apply immutable patches and report through toasts.
import type { Platform } from '@shared/types'
import type { ReaderController } from '@/lib/reader/ReaderController'
import type { ToastAction } from '@/components/Toast'
import type { AppState } from './types'

export type Patch = Partial<AppState>
export type Updater = Patch | ((s: AppState) => Patch | null)

export interface AppHost {
  readonly platform: Platform
  readonly reader: ReaderController
  /** Current state (read fresh each time; never mutate it). */
  state(): AppState
  update(u: Updater, then?: () => void): void
  toast(message: string, action?: ToastAction): void
  /** Display name of a document: file name, or the untitled document's title. */
  nameOf(id: string): string
  renderDoc(force: boolean): void
  /** Focus the editor once it is mounted (new documents open ready to type). */
  focusEditor(): void
}

/** A short, human reason from an unknown error, for the end of a toast. */
export function reason(err: unknown): string {
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  // IPC errors arrive as "Error invoking remote method 'x': Error: actual message".
  const tail = msg.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '').trim()
  return tail && tail.length < 140 ? tail : ''
}
