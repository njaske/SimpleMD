// The open document: conflict bar, then the panes. Edit and Split show the format bar
// over the editor; Read and Split show the reader, with the change bar as a slim strip
// above it (never over the text) and the find bar floating at its top-right. Read view
// stays just the document.
import { Suspense, useCallback, useLayoutEffect, useRef, type ReactNode } from 'react'
import type { Platform, ViewMode } from '@shared/types'
import type { EditorJump } from '@/components/CodeEditor'
import ChangeBar from '@/components/ChangeBar'
import type { FormatCommand, EditorHandle } from '@/lib/editor/types'
import type { ReaderController } from '@/lib/reader/ReaderController'
import { InfoIcon } from '@/lib/icons'
import LazyBoundary from './LazyBoundary'
import { CodeEditor, FindBar, FormatBar } from './lazyParts'
import type { FindState } from './types'

export interface DocumentViewProps {
  id: string
  /** Display name, for the reader's accessible label. */
  name: string
  viewMode: ViewMode
  platform: Platform
  value: string
  isDark: boolean
  editorFontSize: number
  jump: EditorJump | null
  /** Unsaved edits while the file changed on disk. */
  conflict: boolean
  find: FindState | null
  /** Changes marked since the file reloaded (0 hides the change bar). */
  changes: number
  reader: ReaderController
  outline: ReactNode
  setReaderEl: (el: HTMLDivElement | null) => void
  onEditorChange: (value: string) => void
  onEditorReady: (handle: EditorHandle | null) => void
  onSaveImage: (file: File) => Promise<string | null>
  onNotice: (message: string) => void
  onFormat: (cmd: FormatCommand) => void
  onReloadConflict: () => void
  onKeepMine: () => void
  onCloseFind: () => void
  onNextChange: () => void
  onDismissChanges: () => void
}

function ConflictBar({ onReload, onKeep }: { onReload: () => void; onKeep: () => void }) {
  return (
    <div className="smd-conflict" role="alert">
      <InfoIcon size={16} />
      <span>This file changed on disk while you had unsaved edits.</span>
      <button type="button" className="smd-btn smd-btn--sm" onClick={onReload}>
        Reload from disk
      </button>
      <button type="button" className="smd-btn smd-btn--sm smd-btn--ghost" onClick={onKeep}>
        Keep mine
      </button>
    </div>
  )
}

/** Holds the format bar's height while its chunk loads, so the editor doesn't jump. */
const FORMAT_BAR_SLOT = <div className="smd-formatbar smd-formatbar--loading" aria-hidden="true" />
/** A quiet blank editor surface while CodeMirror loads. */
const EDITOR_SLOT = <div className="smd-editor smd-editor--loading" aria-busy="true" />

function EditorPane(p: DocumentViewProps) {
  return (
    <div className="smd-editor-pane">
      <LazyBoundary resetKey={p.id}>
        <Suspense fallback={FORMAT_BAR_SLOT}>
          <FormatBar onFormat={p.onFormat} platform={p.platform} />
        </Suspense>
      </LazyBoundary>
      <div className="smd-editor-host">
        <LazyBoundary resetKey={p.id} fallback={<EditorFailed />}>
          <Suspense fallback={EDITOR_SLOT}>
            <CodeEditor
              key={p.id}
              value={p.value}
              onChange={p.onEditorChange}
              isDark={p.isDark}
              jump={p.jump}
              fontSize={p.editorFontSize}
              onReady={p.onEditorReady}
              onSaveImage={p.onSaveImage}
              onNotice={p.onNotice}
            />
          </Suspense>
        </LazyBoundary>
      </div>
    </div>
  )
}

function EditorFailed() {
  return (
    <div className="smd-editor-failed" role="alert">
      The editor couldn’t load. Switch to Read, then try Edit again.
    </div>
  )
}

/** When the change bar appears it takes its height from the reader; a reader that was
 *  at the very end (following a file an agent is writing) stays at the end. */
function useEndKept(scroller: { current: HTMLDivElement | null }, barShown: boolean): void {
  useLayoutEffect(() => {
    const el = scroller.current
    const bar = el?.parentElement?.querySelector<HTMLElement>('.smd-changebar')
    if (!el || !bar || !barShown) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight <= bar.offsetHeight + 2) el.scrollTop = el.scrollHeight
  }, [scroller, barShown])
}

function ReaderPane(p: DocumentViewProps) {
  const scroller = useRef<HTMLDivElement | null>(null)
  const { setReaderEl } = p
  const setRef = useCallback(
    (el: HTMLDivElement | null) => {
      scroller.current = el
      setReaderEl(el)
    },
    [setReaderEl]
  )
  useEndKept(scroller, p.changes > 0)
  return (
    // Positioned pane: the find bar floats inside it.
    <div className="smd-reader-pane">
      {p.changes > 0 && (
        <ChangeBar count={p.changes} platform={p.platform} onNext={p.onNextChange} onDismiss={p.onDismissChanges} />
      )}
      <div
        ref={setRef}
        className="smd-reader"
        role="article"
        tabIndex={0}
        aria-label={`${p.name}, rendered`}
      />
      {p.find && (
        <LazyBoundary>
          <Suspense fallback={null}>
            <FindBar key={p.find.key} reader={p.reader} initialQuery={p.find.seed} onClose={p.onCloseFind} />
          </Suspense>
        </LazyBoundary>
      )}
    </div>
  )
}

export default function DocumentView(p: DocumentViewProps) {
  return (
    <div className="smd-workspace">
      <div className="smd-docarea">
        {p.conflict && <ConflictBar onReload={p.onReloadConflict} onKeep={p.onKeepMine} />}
        <div className={'smd-panes' + (p.viewMode === 'split' ? ' smd-panes--split' : '')}>
          {/* Reader left, editor right: the same order as the Read · Split · Edit switch. */}
          {p.viewMode !== 'edit' ? <ReaderPane {...p} /> : null}
          {p.viewMode !== 'read' ? <EditorPane {...p} /> : null}
        </div>
      </div>
      {p.outline}
    </div>
  )
}
