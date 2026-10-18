// The global keyboard handler. Runs in the capture phase so app shortcuts beat
// focused widgets, except where the spec 3.1 conflict rules give the key to the
// editor or a text field (decided by lib/commands.ts).
import type { Platform } from '@shared/types'
import { commandForKey, type CommandId } from '@/lib/commands'
import { matchesShortcut } from '@/lib/logic/platform'

export interface KeyboardDeps {
  platform: Platform
  /** 'palette' lets the palette's own shortcuts through; 'dialog' blocks all. */
  modal: () => 'palette' | 'dialog' | null
  available: (id: CommandId) => boolean
  run: (id: CommandId) => void
}

const PALETTE_KEYS: ReadonlySet<CommandId> = new Set(['commandPalette', 'quickOpen'])

function isTextField(el: Element | null): boolean {
  if (!el) return false
  if (el instanceof HTMLTextAreaElement) return true
  if (el instanceof HTMLInputElement) return !['checkbox', 'radio', 'range', 'button', 'submit'].includes(el.type)
  return el instanceof HTMLElement && el.isContentEditable
}

export function createKeyHandler(deps: KeyboardDeps): (e: KeyboardEvent) => void {
  return (e) => {
    if (e.defaultPrevented || e.isComposing || e.key === 'Escape') return
    const modal = deps.modal()
    if (modal === 'dialog') return
    const active = document.activeElement
    const ctx = { inEditor: !!active?.closest('.cm-editor'), inTextField: isTextField(active) }
    const available = (id: CommandId): boolean => (modal !== 'palette' || PALETTE_KEYS.has(id)) && deps.available(id)
    const spec = commandForKey(e, ctx, deps.platform, available, matchesShortcut)
    if (!spec) return
    e.preventDefault()
    e.stopPropagation()
    deps.run(spec.id)
  }
}
