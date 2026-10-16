import { app } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import type { Settings } from '../shared/types'

const DEFAULTS: Settings = {
  theme: 'dark',
  accent: '#c0392b',
  readingFont: 'Serif',
  readingWidth: 760,
  sidebarOpen: true,
  outlineOpen: true,
  activity: 'files',
  viewMode: 'read',
  lastFolder: null,
  pinned: [],
  recents: [],
  openTabs: [],
  activeId: null,
  looseFiles: []
}

let cache: Settings | null = null

function settingsPath(): string {
  return join(app.getPath('userData'), 'simplemd-settings.json')
}

export async function loadSettings(): Promise<Settings> {
  if (cache) return cache
  try {
    const raw = await fs.readFile(settingsPath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<Settings>
    cache = { ...DEFAULTS, ...parsed }
  } catch {
    cache = { ...DEFAULTS }
  }
  return cache
}

export async function saveSettings(partial: Partial<Settings>): Promise<Settings> {
  const current = await loadSettings()
  cache = { ...current, ...partial }
  try {
    await fs.writeFile(settingsPath(), JSON.stringify(cache, null, 2), 'utf8')
  } catch {
    // Persisting settings is best-effort; ignore write failures.
  }
  return cache
}
