import type { Settings } from '../shared/types'

// Validation for settings sent by the renderer. Only display state may be set
// from the page; `lastFolder`, `approvedFiles` and `recentFolders` grant file
// access and are written by the main process alone. Values of the wrong type
// are dropped so a bad write can never break the next launch.

const MAX_LIST = 500
const THEMES = ['light', 'dark', 'sepia', 'system']
const FONTS = ['Serif', 'Sans', 'Mono', 'Hyperlegible']
const ACTIVITIES = ['files', 'search', 'pinned']
const VIEW_MODES = ['read', 'split', 'edit']

type Check = (value: unknown) => boolean

const isBool: Check = (v) => typeof v === 'boolean'
const inRange = (min: number, max: number): Check => (v) =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
const oneOf = (allowed: string[]): Check => (v) => typeof v === 'string' && allowed.includes(v)
const isPathList: Check = (v) =>
  Array.isArray(v) && v.length <= MAX_LIST && v.every((x) => typeof x === 'string' && x.length < 4096)

const RENDERER_SETTABLE: Partial<Record<keyof Settings, Check>> = {
  theme: oneOf(THEMES),
  accent: (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v),
  readingFont: oneOf(FONTS),
  readingWidth: inRange(400, 1600),
  readingSize: inRange(12, 28),
  lineHeight: inRange(1.2, 2.4),
  uiScale: inRange(0.8, 1.5),
  reduceMotion: isBool,
  syncScroll: isBool,
  blockRemoteImages: isBool,
  showStatusBar: isBool,
  sidebarOpen: isBool,
  outlineOpen: isBool,
  activity: oneOf(ACTIVITIES),
  viewMode: oneOf(VIEW_MODES),
  pinned: isPathList,
  recents: isPathList,
  openTabs: isPathList,
  activeId: (v) => v === null || (typeof v === 'string' && v.length < 4096),
  looseFiles: isPathList,
  updateChecks: oneOf(['ask', 'on', 'off']),
  // Up to the year 2100, in ms.
  lastUpdateCheck: inRange(0, 4_102_444_800_000),
  skippedUpdate: (v) => v === '' || (typeof v === 'string' && /^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(v))
}

/** Keep only renderer-settable keys whose values have the expected shape. */
export function pickRendererSettings(partial: unknown): Partial<Settings> {
  if (typeof partial !== 'object' || partial === null || Array.isArray(partial)) return {}
  const source = partial as Record<string, unknown>
  const picked: Record<string, unknown> = {}
  for (const [name, check] of Object.entries(RENDERER_SETTABLE)) {
    if (Object.prototype.hasOwnProperty.call(source, name) && check!(source[name])) {
      picked[name] = source[name]
    }
  }
  return picked as Partial<Settings>
}
