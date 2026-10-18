// View and appearance actions: modes, panels, focus mode, theme and text size.
import type { Activity, ThemeName, ViewMode } from '@shared/types'
import { SEARCH_INPUT_ID } from '@/components/SearchPanel'
import type { AppHost } from './host'
import type { SettingsSection } from './types'
import { TEXT_SIZE, clampTextSize, resolveTheme } from './appearance'

export type ViewActions = ReturnType<typeof createViewActions>

const SIDEBAR_FOCUS = ['.smd-tree [tabindex="0"]', '.smd-side-switch [aria-checked="true"]', 'button']

function focusSidebar(): void {
  const side = document.querySelector<HTMLElement>('.smd-sidebar')
  for (const sel of SIDEBAR_FOCUS) {
    const el = side?.querySelector<HTMLElement>(sel)
    if (el) return el.focus()
  }
}

export function createViewActions(host: AppHost) {
  const setView = (viewMode: ViewMode): void =>
    host.update({ viewMode }, () => {
      if (viewMode !== 'read') host.focusEditor()
    })

  const toggleReadEdit = (): void => setView(host.state().viewMode === 'read' ? 'edit' : 'read')

  const toggleSidebar = (): void =>
    host.update((s) =>
      s.compact ? { sidebarPeek: !s.sidebarPeek, focusMode: false } : { sidebarOpen: !s.sidebarOpen, focusMode: false }
    )

  /** The button that showed the sidebar unmounts, so keyboard focus moves into the
   *  sidebar instead of falling back to the page. Focus mode hides the sidebar, so
   *  asking for it leaves focus mode. */
  const showSidebar = (): void =>
    host.update(
      (s) => (s.compact ? { sidebarPeek: true, focusMode: false } : { sidebarOpen: true, focusMode: false }),
      focusSidebar
    )

  const setActivity = (activity: Activity): void =>
    host.update((s) => ({ activity, sidebarOpen: true, sidebarPeek: s.compact }))

  /** Focus mode hides the outline, so asking for it there leaves focus mode. */
  const toggleOutline = (): void =>
    host.update((s) => (s.focusMode ? { focusMode: false, outlineOpen: true } : { outlineOpen: !s.outlineOpen }))
  const toggleStatusBar = (): void => host.update((s) => ({ showStatusBar: !s.showStatusBar }))
  const toggleFocus = (): void =>
    host.update((s) => ({ focusMode: !s.focusMode, sidebarPeek: false, readingOpen: false }))

  const setTheme = (theme: ThemeName): void => host.update({ theme })
  const toggleTheme = (): void =>
    host.update((s) => ({ theme: resolveTheme(s.theme, s.systemDark) === 'dark' ? 'light' : 'dark' }))

  const textSize = (delta: number | 'reset'): void =>
    host.update((s) => ({ readingSize: delta === 'reset' ? TEXT_SIZE.default : clampTextSize(s.readingSize + delta) }))

  const toggleSyncScroll = (): void => {
    const on = !host.state().syncScroll
    host.update({ syncScroll: on })
    host.toast(on ? 'Synced scrolling on' : 'Synced scrolling off')
  }

  const toggleRemoteImages = (): void => {
    const on = !host.state().blockRemoteImages
    host.update({ blockRemoteImages: on })
    host.toast(on ? 'Remote images blocked' : 'Remote images allowed')
  }

  const openPalette = (query: string, folders = false): void =>
    host.update({ palette: { query, folders }, menu: null, readingOpen: false })

  const openSettings = (section: SettingsSection = 'appearance'): void =>
    host.update({ settings: section, menu: null, readingOpen: false, palette: null })

  /** Show the Search panel and put the cursor in its field. */
  const searchAll = (): void => {
    host.update(
      (s) => ({ activity: 'search', sidebarOpen: true, sidebarPeek: s.compact, focusMode: false }),
      () => {
        requestAnimationFrame(() => {
          const input = document.getElementById(SEARCH_INPUT_ID) as HTMLInputElement | null
          input?.focus()
          input?.select()
        })
      }
    )
  }

  return {
    setView,
    toggleReadEdit,
    toggleSidebar,
    showSidebar,
    setActivity,
    toggleOutline,
    toggleStatusBar,
    toggleFocus,
    setTheme,
    toggleTheme,
    textSize,
    toggleSyncScroll,
    toggleRemoteImages,
    openPalette,
    openSettings,
    searchAll
  }
}
