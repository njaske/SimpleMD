import { app } from 'electron'
import { promises as fs } from 'fs'
import { randomBytes } from 'crypto'
import { join } from 'path'
import type { Settings } from '../shared/types'

const DEFAULTS: Settings = {
  theme: 'system',
  accent: '#c0392b',
  readingFont: 'Serif',
  readingWidth: 720,
  readingSize: 17,
  lineHeight: 1.7,
  uiScale: 1,
  reduceMotion: false,
  syncScroll: true,
  blockRemoteImages: false,
  showStatusBar: true,
  sidebarOpen: true,
  outlineOpen: true,
  activity: 'files',
  viewMode: 'read',
  lastFolder: null,
  pinned: [],
  recents: [],
  openTabs: [],
  activeId: null,
  looseFiles: [],
  updateChecks: 'ask',
  lastUpdateCheck: 0,
  skippedUpdate: ''
}

let cache: Settings | null = null

function settingsPath(): string {
  return join(app.getPath('userData'), 'simplemd-settings.json')
}

let loading: Promise<Settings> | null = null

// The file is read once; concurrent callers share that read, so a late-finishing
// load can never overwrite a save made in the meantime.
export function loadSettings(): Promise<Settings> {
  if (cache) return Promise.resolve(cache)
  loading ??= (async () => {
    try {
      const raw = await fs.readFile(settingsPath(), 'utf8')
      const parsed = JSON.parse(raw) as Partial<Settings>
      cache ??= { ...DEFAULTS, ...parsed }
    } catch {
      cache ??= { ...DEFAULTS }
    }
    return cache
  })()
  return loading
}

// Writes are serialized: while one is in flight, further saves only update the
// in-memory cache and share a single follow-up write of the latest state, so a
// burst of saves (settings changes + access grants) never races or piles up.
let writing: Promise<void> | null = null
let writeQueued: Promise<void> | null = null

async function writeSettingsFile(): Promise<void> {
  const path = settingsPath()
  const data = JSON.stringify(cache, null, 2)
  // Temp file + rename so a crash mid-write can't leave truncated settings.
  const tmp = `${path}.${randomBytes(4).toString('hex')}.tmp`
  try {
    await fs.writeFile(tmp, data, 'utf8')
    await fs.rename(tmp, path)
  } catch {
    try {
      await fs.unlink(tmp)
    } catch {
      // temp file may not exist
    }
    try {
      await fs.writeFile(path, data, 'utf8') // e.g. rename blocked by a scanner
    } catch {
      // Persisting settings is best-effort; ignore write failures.
    }
  }
}

function scheduleWrite(): Promise<void> {
  if (!writing) {
    const run = writeSettingsFile().finally(() => {
      writing = null
    })
    writing = run
    return run
  }
  if (!writeQueued) {
    writeQueued = writing.then(() => {
      writeQueued = null
      return scheduleWrite()
    })
  }
  return writeQueued
}

/** Resolves once every queued settings write has reached disk. */
export function settingsWritten(): Promise<void> {
  return writeQueued ?? writing ?? Promise.resolve()
}

export async function saveSettings(partial: Partial<Settings>): Promise<Settings> {
  const current = await loadSettings()
  // Merge onto the live cache: another save may have landed during the await.
  cache = { ...(cache ?? current), ...partial }
  await scheduleWrite()
  return cache
}
