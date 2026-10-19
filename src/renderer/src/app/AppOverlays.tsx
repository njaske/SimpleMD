// Every floating layer of the shell in one place: palette, settings, the Aa
// popover, dialogs, crash recovery, toasts and the drop overlay. Stateless: it
// renders from App state and calls back into the controller modules.
import { Suspense, type ReactNode } from 'react'
import type { Platform } from '@shared/types'
import type { CommandId } from '@/lib/commands'
import type { QuickOpenItem } from '@/state/viewmodel'
import type { PaletteCommand, PaletteFolder } from '@/components/CommandPalette'
import type { SettingsValues } from '@/components/SettingsDialog'
import Toast, { ToastAnnouncer } from '@/components/Toast'
import DropOverlay from '@/components/DropOverlay'
import LazyBoundary from './LazyBoundary'
import {
  CloseWindowDialog,
  CommandPalette,
  ConfirmDialog,
  NameDialog,
  ReadingPopover,
  RecoveryPrompt,
  SettingsDialog,
  UnsavedDialog
} from './lazyParts'
import type { AppHost } from './host'
import type { DocumentActions } from './documents'
import type { FileActions } from './files'
import type { AppState, DialogState } from './types'
import { clampScale, clampTextSize } from './appearance'
import { baseName, isDirtyIn, unsavedIds } from './model'

interface Props {
  state: AppState
  platform: Platform
  readingAnchor: HTMLElement | null
  nameOf: (id: string) => string
  /** Built lazily: only while the palette is open. */
  quickOpen: () => QuickOpenItem[]
  paletteCommands: () => PaletteCommand[]
  recentFolders: readonly PaletteFolder[]
  host: AppHost
  docs: DocumentActions
  files: FileActions
  runCommand: (id: CommandId) => void
  hasCommand: (id: CommandId) => boolean
  onRestore: () => void
  onDiscard: () => void
  onCloseWindow: (save: boolean) => void
}

function settingsValues(s: AppState): SettingsValues {
  return {
    theme: s.theme,
    accent: s.accent,
    uiScale: s.uiScale,
    reduceMotion: s.reduceMotion,
    showStatusBar: s.showStatusBar,
    readingFont: s.readingFont,
    readingSize: s.readingSize,
    lineHeight: s.lineHeight,
    readingWidth: s.readingWidth,
    blockRemoteImages: s.blockRemoteImages,
    syncScroll: s.syncScroll
  }
}

/** Settings edits are clamped to the ranges the main process accepts. */
function clean(patch: Partial<SettingsValues>): Partial<SettingsValues> {
  return {
    ...patch,
    ...(patch.uiScale !== undefined ? { uiScale: clampScale(patch.uiScale) } : {}),
    ...(patch.readingSize !== undefined ? { readingSize: clampTextSize(patch.readingSize) } : {})
  }
}

/** One lazy overlay: its own boundary, so a loading part never hides another. */
function Lazy({ children }: { children: ReactNode }) {
  return (
    <LazyBoundary>
      <Suspense fallback={null}>{children}</Suspense>
    </LazyBoundary>
  )
}

function DialogLayer({ dialog, p }: { dialog: DialogState; p: Props }) {
  const { host, docs, files, state: s } = p
  const close = (): void => host.update({ dialog: null })
  switch (dialog.kind) {
    case 'confirm':
      return (
        <ConfirmDialog
          title={dialog.title}
          message={dialog.message}
          confirmLabel={dialog.confirmLabel}
          danger={dialog.danger}
          safeDefault={dialog.safeDefault}
          onCancel={close}
          onConfirm={() => {
            close()
            void dialog.onConfirm()
          }}
        />
      )
    case 'unsaved': {
      const names = dialog.ids.filter((id) => isDirtyIn(s.contents, s.saved, id)).map(p.nameOf)
      return (
        <UnsavedDialog
          names={names}
          onSave={() => void docs.resolveUnsaved('save')}
          onDiscard={() => void docs.resolveUnsaved('discard')}
          onCancel={() => void docs.resolveUnsaved('cancel')}
        />
      )
    }
    case 'closeWindow':
      return (
        <CloseWindowDialog
          names={unsavedIds(s.contents, s.saved).map(p.nameOf)}
          onSave={() => p.onCloseWindow(true)}
          onDiscard={() => p.onCloseWindow(false)}
          onCancel={close}
        />
      )
    case 'rename':
      return (
        <NameDialog
          title={dialog.isFolder ? 'Rename folder' : 'Rename file'}
          label={dialog.isFolder ? 'Folder name' : 'File name'}
          initial={baseName(dialog.path)}
          confirmLabel="Rename"
          validate={(name) => files.validateName(dialog.path, name, dialog.isFolder)}
          onSubmit={(name) => void files.commitRename(dialog.path, name, dialog.isFolder)}
          onCancel={close}
        />
      )
    case 'newFolder':
      return (
        <NameDialog
          title="New folder"
          label="Folder name"
          initial="New folder"
          isNew
          confirmLabel="Create"
          validate={(name) => files.validateName(dialog.parent, name, true, true)}
          onSubmit={(name) => void files.createFolder(dialog.parent, name)}
          onCancel={close}
        />
      )
  }
}

export default function AppOverlays(p: Props) {
  const { state: s, host } = p
  return (
    <>
      {s.readingOpen && s.activeId && (
        <Lazy>
          <ReadingPopover
            anchor={p.readingAnchor}
            theme={s.theme}
            readingFont={s.readingFont}
            readingSize={s.readingSize}
            lineHeight={s.lineHeight}
            readingWidth={s.readingWidth}
            onTheme={(theme) => host.update({ theme })}
            onFont={(readingFont) => host.update({ readingFont })}
            onSize={(px) => host.update({ readingSize: clampTextSize(px) })}
            onLineHeight={(lineHeight) => host.update({ lineHeight })}
            onWidth={(readingWidth) => host.update({ readingWidth })}
            onMore={() => host.update({ readingOpen: false, settings: 'reading' })}
            onClose={() => host.update({ readingOpen: false })}
          />
        </Lazy>
      )}
      {s.palette && (
        <Lazy>
          <CommandPalette
            query={s.palette.query}
            onQuery={(query) => host.update((st) => (st.palette ? { palette: { ...st.palette, query } } : null))}
            foldersMode={!!s.palette.folders}
            folders={p.recentFolders}
            onOpenFolder={(path) => void p.files.openRecentFolder(path)}
            files={p.quickOpen()}
            commands={p.paletteCommands()}
            recentCommands={s.recentCommands}
            onOpenFile={(id) => void p.docs.openFile(id)}
            onRunCommand={p.runCommand}
            onClose={() => host.update({ palette: null })}
          />
        </Lazy>
      )}
      {s.settings && (
        <Lazy>
          <SettingsDialog
            section={s.settings}
            values={settingsValues(s)}
            platform={p.platform}
            hasCommand={p.hasCommand}
            onSection={(settings) => host.update({ settings })}
            onChange={(patch) => host.update(clean(patch))}
            onOpenLink={(url) => void window.api.openExternal(url).catch(() => host.toast("Couldn't open that link."))}
            onClose={() => host.update({ settings: null })}
          />
        </Lazy>
      )}
      {s.dialog && (
        <Lazy>
          <DialogLayer dialog={s.dialog} p={p} />
        </Lazy>
      )}
      {s.recovery && !s.dialog && (
        <Lazy>
          <RecoveryPrompt entries={s.recovery} onRestore={p.onRestore} onDiscard={p.onDiscard} />
        </Lazy>
      )}
      <ToastAnnouncer toast={s.toast} />
      {s.toast && (
        <Toast
          toast={s.toast}
          onDismiss={(id) => host.update((st) => (st.toast?.id === id ? { toast: null } : null))}
        />
      )}
      {s.dragOver && <DropOverlay />}
    </>
  )
}
