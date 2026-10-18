// Launch: load settings, restore the last session (workspace, loose files, tabs),
// open files passed by the shell, then offer crash recovery.
import type { OpenedFile, RecoveryEntry, Settings } from '@shared/types'
import type { AppHost, Patch } from './host'
import type { FileActions } from './files'
import type { RecoveryKeeper } from './recovery'
import { restorePatch } from './recovery'
import { normalizeAccent } from './appearance'

export interface BootDeps {
  host: AppHost
  files: FileActions
  recovery: RecoveryKeeper
  /** Called once settings are in state (apply CSS variables, zoom, first paint). */
  onSettings: (s: Settings) => void
}

/** The persisted display settings as a state patch. */
export function settingsPatch(s: Settings): Patch {
  return {
    theme: s.theme,
    accent: normalizeAccent(s.accent),
    readingFont: s.readingFont,
    readingWidth: s.readingWidth,
    readingSize: s.readingSize,
    lineHeight: s.lineHeight,
    uiScale: s.uiScale,
    reduceMotion: s.reduceMotion,
    syncScroll: s.syncScroll,
    blockRemoteImages: s.blockRemoteImages,
    showStatusBar: s.showStatusBar,
    activity: s.activity,
    sidebarOpen: s.sidebarOpen,
    outlineOpen: s.outlineOpen,
    viewMode: s.viewMode,
    pinned: s.pinned,
    recents: s.recents,
    recentFolders: s.recentFolders ?? [],
    ready: true
  }
}

async function readLooseFiles(paths: string[] | undefined): Promise<OpenedFile[]> {
  if (!paths?.length) return []
  const items = await Promise.all(
    paths.map((p) =>
      window.api.readFile(p).then(
        (content) => ({ path: p, content }),
        () => null // gone or no longer approved: just drop it from the sidebar
      )
    )
  )
  return items.filter((x): x is OpenedFile => x !== null)
}

export async function bootstrap({ host, files, recovery, onSettings }: BootDeps): Promise<void> {
  let s: Settings
  try {
    s = await window.api.getSettings()
  } catch {
    host.update({ ready: true })
    host.toast("Couldn't load your settings, so SimpleMD started with the defaults.")
    // Recovery doesn't depend on settings: still offer what the last session left.
    await offerRecovery(host, recovery, window.api.loadRecovery().catch(() => []))
    return
  }
  host.update(settingsPatch(s), () => onSettings(s))
  // The disk reads below are independent, so start them together and apply the
  // results in the original order.
  const looseRead = readLooseFiles(s.looseFiles)
  const folderScan = s.lastFolder ? window.api.scanFolder(s.lastFolder).catch(() => null) : Promise.resolve(null)
  const launchFiles = window.api.takeLaunchFiles().catch(() => null)
  const recovered = window.api.loadRecovery().catch(() => [])

  // Restore individually-opened files into the tree (without reopening tabs;
  // the persisted openTabs already reference them).
  const valid = await looseRead
  const loosePaths = valid.map((x) => x.path)
  if (valid.length) files.addLooseFiles(valid, { open: false })
  const scan = await folderScan
  if (scan) {
    files.applyScan(scan, { restoreTabs: s.openTabs, restoreActive: s.activeId, availablePaths: new Set(loosePaths) })
  } else if (loosePaths.length) {
    // No workspace folder: restore just the loose-file tabs.
    const openTabs = s.openTabs.filter((p) => loosePaths.includes(p))
    const activeId = s.activeId && openTabs.includes(s.activeId) ? s.activeId : (openTabs[0] ?? null)
    host.update({ openTabs, activeId }, () => host.renderDoc(true))
  }
  // Files opened from the shell that started this launch go on top of the session.
  const launched = await launchFiles
  if (launched) files.openResult(launched)

  await offerRecovery(host, recovery, recovered)
}

/** Show the recovery prompt when the last session left unsaved buffers; recovery
 *  writes start only once it is answered, so those buffers survive until then. */
async function offerRecovery(host: AppHost, recovery: RecoveryKeeper, loaded: Promise<RecoveryEntry[]>): Promise<void> {
  const entries = await loaded
  if (entries.length) host.update({ recovery: entries })
  else recovery.enable()
}

/** Reopen recovered buffers as unsaved tabs, then resume recovery writes. */
export async function restoreRecovered(host: AppHost, recovery: RecoveryKeeper): Promise<void> {
  const state = host.state()
  const entries = state.recovery ?? []
  const disk: Record<string, string | null> = {}
  await Promise.all(
    entries.map(async (e) => {
      if (!e.path) return
      disk[e.path] = state.saved[e.path] ?? (await window.api.readFile(e.path).catch(() => null))
    })
  )
  host.update(
    (s) => restorePatch(s, entries, disk),
    () => {
      host.renderDoc(true)
      recovery.enable()
    }
  )
}
