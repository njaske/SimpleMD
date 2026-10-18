// Document actions: new / paste from AI / open / save / save as / close with the
// unsaved-changes prompt / reopen closed tab. Every IPC call reports failure with
// a toast that says what happened and what to do.
import { normalizePastedMarkdown, suggestFileName } from '@/lib/logic/files'
import type { AppHost, ReloadHook } from './host'
import { reason } from './host'
import {
  adoptSavedAs,
  baseName,
  closeTabs,
  cycleTab,
  dropDoc,
  insertTab,
  isDirtyIn,
  isUntitled,
  isWithin,
  pushRecents,
  tabsRightOf,
  untitledId,
  without
} from './model'
import type { AppState } from './types'

export interface DocumentDeps {
  /** Re-scan the workspace (a file was saved into it). */
  rescan: () => void
  /** A clean document is about to take its disk text (Reload from disk). */
  onReload?: ReloadHook
}

export type DocumentActions = ReturnType<typeof createDocumentActions>

function isDirty(s: AppState, id: string): boolean {
  return isDirtyIn(s.contents, s.saved, id)
}

export function createDocumentActions(host: AppHost, deps: DocumentDeps) {
  const fail = (what: string, err: unknown, fix: string): void => {
    const why = reason(err)
    host.toast(`${what}${why ? ` (${why})` : ''}. ${fix}`)
  }

  const openFile = async (id: string): Promise<boolean> => {
    if (host.state().contents[id] === undefined) {
      try {
        const text = await window.api.readFile(id)
        host.update((s) => ({ contents: { ...s.contents, [id]: text }, saved: { ...s.saved, [id]: text } }))
      } catch {
        // A stale pinned/recent entry: say so, and don't open a blank tab.
        host.toast(`Couldn't open ${baseName(id)}. It may have been moved or deleted.`)
        return false
      }
    }
    host.update((s) => ({
      openTabs: s.openTabs.includes(id) ? s.openTabs : [...s.openTabs, id],
      activeId: id,
      recents: pushRecents([id], s.recents),
      newPaths: without(s.newPaths, id),
      closed: s.closed.filter((c) => c.id !== id)
    }))
    return true
  }

  /** A new untitled tab right after the active one. */
  const newDocument = (content = '', mode: AppState['viewMode'] = 'edit'): string => {
    const id = untitledId(host.state().untitledSeq + 1)
    host.update(
      (s) => {
        const at = s.activeId ? s.openTabs.indexOf(s.activeId) + 1 : s.openTabs.length
        return {
          untitledSeq: s.untitledSeq + 1,
          contents: { ...s.contents, [id]: content },
          saved: { ...s.saved, [id]: '' },
          openTabs: insertTab(s.openTabs, id, at),
          activeId: id,
          viewMode: mode,
          focusMode: false
        }
      },
      () => {
        if (mode !== 'read') host.focusEditor()
      }
    )
    return id
  }

  const pasteFromAi = async (): Promise<void> => {
    let text = ''
    try {
      text = await window.api.readClipboardText()
    } catch (err) {
      fail("Couldn't read the clipboard", err, 'Try copying the answer again.')
      return
    }
    if (!text.trim()) {
      host.toast('Your clipboard is empty. Copy an answer from your AI chat, then try again.')
      return
    }
    const id = newDocument(normalizePastedMarkdown(text), 'read')
    host.toast('Pasted as a new document', { label: 'Save…', run: () => void saveAs(id) })
  }

  /** Save under a new name. Resolves to the document's id afterwards (the file path),
   *  or null when cancelled or failed. */
  const saveAs = async (id: string): Promise<string | null> => {
    const s = host.state()
    const content = s.contents[id]
    if (content === undefined) return null
    const name = isUntitled(id) ? suggestFileName(content) : baseName(id)
    let path: string | null = null
    try {
      path = await window.api.saveAs(name, content)
    } catch (err) {
      fail(`Couldn't save ${host.nameOf(id)}`, err, 'Pick another folder, then try again.')
      return null
    }
    if (!path) return null
    const savedPath = path
    const inWorkspace = !!s.root && isWithin(savedPath, s.root)
    host.update(
      (st) => adoptSavedAs(st, id, savedPath, content, !inWorkspace),
      () => host.renderDoc(true)
    )
    if (inWorkspace) deps.rescan()
    host.toast(`Saved as ${baseName(savedPath)}`)
    return savedPath
  }

  /** Save a document (untitled ones go through Save as). Resolves to its id
   *  afterwards, or null when it wasn't saved. */
  const save = async (id: string | null = host.state().activeId): Promise<string | null> => {
    if (!id) return null
    if (isUntitled(id)) return saveAs(id)
    const content = host.state().contents[id]
    if (content === undefined) return null
    if (!isDirty(host.state(), id)) return id
    try {
      await window.api.saveFile(id, content)
      host.update((s) => ({ saved: { ...s.saved, [id]: content }, externalChanges: without(s.externalChanges, id) }))
      return id
    } catch (err) {
      fail(`Couldn't save ${baseName(id)}`, err, 'Check that the folder still exists, then try again.')
      return null
    }
  }

  /** Save every unsaved document; true when all of them were saved. */
  const saveAll = async (): Promise<boolean> => {
    const s = host.state()
    const ids = Object.keys(s.contents).filter((id) => isDirty(s, id))
    let ok = true
    for (const id of ids) ok = (await save(id)) !== null && ok
    if (ok && ids.length > 1) host.toast(`Saved ${ids.length} documents`)
    return ok
  }

  /** Close tabs now, dropping untitled buffers and discarding unsaved edits. */
  const closeNow = (ids: readonly string[]): void => {
    host.update((s) => {
      const tabs = closeTabs(s, ids)
      let contents = s.contents
      let saved = s.saved
      for (const id of ids) {
        if (isUntitled(id)) {
          contents = without(contents, id)
          saved = without(saved, id)
        } else if (isDirtyIn(contents, saved, id)) {
          contents = { ...contents, [id]: saved[id] }
        }
      }
      return { ...tabs, contents, saved, dialog: null }
    })
  }

  /** Close tabs, asking first when any has unsaved text. */
  const requestClose = (ids: readonly string[]): void => {
    const s = host.state()
    if (ids.some((id) => isDirty(s, id))) host.update({ dialog: { kind: 'unsaved', ids: [...ids] } })
    else closeNow(ids)
  }

  const resolveUnsaved = async (choice: 'save' | 'discard' | 'cancel'): Promise<void> => {
    const d = host.state().dialog
    if (!d || d.kind !== 'unsaved') return
    if (choice === 'cancel') return host.update({ dialog: null })
    if (choice === 'discard') return closeNow(d.ids)
    host.update({ dialog: null })
    const closing: string[] = []
    for (const id of d.ids) {
      if (!isDirty(host.state(), id)) {
        closing.push(id)
        continue
      }
      const savedId = await save(id)
      if (savedId) closing.push(savedId)
    }
    closeNow(closing)
  }

  const closeActive = (): void => {
    const id = host.state().activeId
    if (id) requestClose([id])
  }
  const closeOthers = (id: string | null = host.state().activeId): void => {
    if (id) requestClose(host.state().openTabs.filter((t) => t !== id))
  }
  const closeRight = (id: string): void => requestClose(tabsRightOf(host.state().openTabs, id))
  const closeAll = (): void => requestClose(host.state().openTabs)

  const reopenClosed = async (): Promise<void> => {
    const [last, ...rest] = host.state().closed
    if (!last) {
      host.toast('No recently closed tabs.')
      return
    }
    host.update({ closed: rest })
    if (await openFile(last.id)) {
      host.update((s) => ({
        openTabs: insertTab(
          s.openTabs.filter((t) => t !== last.id),
          last.id,
          last.index
        )
      }))
    }
  }

  const cycle = (delta: number): void =>
    host.update((s) => {
      const next = cycleTab(s.openTabs, s.activeId, delta)
      return next && next !== s.activeId ? { activeId: next } : null
    })

  const readFromDisk = async (id: string): Promise<void> => {
    try {
      const text = await window.api.readFile(id)
      // Only a clean document gets "what changed" marks: discarded edits aren't news.
      const s0 = host.state()
      const before = s0.contents[id]
      const clean = before !== undefined && !isDirty(s0, id)
      const after = clean && deps.onReload ? deps.onReload([{ id, before, after: text }]) : undefined
      host.update(
        (s) => ({
          contents: { ...s.contents, [id]: text },
          saved: { ...s.saved, [id]: text },
          externalChanges: without(s.externalChanges, id)
        }),
        after
      )
      if (clean && before === text) host.toast(`${baseName(id)} is already up to date`)
    } catch (err) {
      fail(`Couldn't reload ${baseName(id)}`, err, 'It may have been moved or deleted.')
    }
  }

  /** Replace a document's text with the disk copy. Unsaved edits are only thrown
   *  away after a confirm, unless the caller already asked (the conflict bar). */
  const reloadFromDisk = async (
    id: string | null = host.state().activeId,
    opts: { confirmed?: boolean } = {}
  ): Promise<void> => {
    if (!id || isUntitled(id)) return
    if (opts.confirmed || !isDirty(host.state(), id)) return readFromDisk(id)
    host.update({
      menu: null,
      dialog: {
        kind: 'confirm',
        title: `Discard your edits to “${host.nameOf(id)}”?`,
        message: 'Reloading replaces your unsaved edits with the text on disk. This can’t be undone.',
        confirmLabel: 'Discard and reload',
        danger: true,
        safeDefault: true,
        onConfirm: () => readFromDisk(id)
      }
    })
  }

  const keepMine = (id: string): void => host.update((s) => ({ externalChanges: without(s.externalChanges, id) }))

  const forget = (id: string): void => host.update((s) => dropDoc(s, id))

  return {
    openFile,
    newDocument,
    pasteFromAi,
    save,
    saveAs,
    saveAll,
    requestClose,
    resolveUnsaved,
    closeActive,
    closeOthers,
    closeRight,
    closeAll,
    reopenClosed,
    cycle,
    reloadFromDisk,
    keepMine,
    forget
  }
}
