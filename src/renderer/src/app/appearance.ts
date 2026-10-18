// Appearance constants and helpers: themes, accents, reading fonts and metrics.
// No runtime imports, so node:test can load it directly.
import type { ReadingFont, ResolvedTheme, ThemeName } from '@shared/types'

export interface AccentPreset {
  name: string
  value: string
}

export const ACCENTS: readonly AccentPreset[] = [
  { name: 'Ember', value: '#c0392b' },
  { name: 'Amber', value: '#b45309' },
  { name: 'Ocean', value: '#2563eb' },
  { name: 'Forest', value: '#15803d' },
  { name: 'Iris', value: '#7c3aed' },
  { name: 'Graphite', value: '#57534e' }
]
export const DEFAULT_ACCENT = ACCENTS[0].value

// 1.0 shipped brighter presets that fail contrast with white text; map them over.
const LEGACY_ACCENTS: Record<string, string> = {
  '#d97706': '#b45309',
  '#2b6cb0': '#2563eb',
  '#2f855a': '#15803d'
}

/** A stored accent as one of today's presets (unknown values fall back to Ember). */
export function normalizeAccent(value: string): string {
  const v = value.toLowerCase()
  if (ACCENTS.some((a) => a.value === v)) return v
  return LEGACY_ACCENTS[v] ?? DEFAULT_ACCENT
}

export const READING_FONTS: Record<ReadingFont, string> = {
  Serif: "'Literata Variable', 'Literata', Georgia, 'Times New Roman', serif",
  Sans: "'Inter Variable', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
  Mono: "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
  Hyperlegible:
    "'Atkinson Hyperlegible Next Variable', 'Atkinson Hyperlegible Next', 'Atkinson Hyperlegible', Verdana, sans-serif"
}

export const FONT_LABELS: Record<ReadingFont, string> = {
  Serif: 'Serif',
  Sans: 'Sans',
  Mono: 'Mono',
  Hyperlegible: 'Legible'
}

export const THEME_LABELS: Record<ThemeName, string> = {
  light: 'Light',
  sepia: 'Sepia',
  dark: 'Dark',
  system: 'System'
}
export const THEME_ORDER: readonly ThemeName[] = ['light', 'sepia', 'dark', 'system']

export const TEXT_SIZE = { min: 13, max: 26, default: 17 }
export const UI_SCALE = { min: 0.9, max: 1.5, step: 0.05 }

export const LINE_HEIGHTS: readonly { label: string; value: number }[] = [
  { label: 'Compact', value: 1.5 },
  { label: 'Comfortable', value: 1.7 },
  { label: 'Airy', value: 1.9 }
]
export const WIDTHS: readonly { label: string; value: number }[] = [
  { label: 'Narrow', value: 600 },
  { label: 'Medium', value: 720 },
  { label: 'Wide', value: 880 }
]

/** The preset closest to `value` (settings may hold any number in range). */
export function nearest<T extends { value: number }>(options: readonly T[], value: number): T {
  return options.reduce((best, o) => (Math.abs(o.value - value) < Math.abs(best.value - value) ? o : best))
}

export function clampTextSize(px: number): number {
  return Math.min(TEXT_SIZE.max, Math.max(TEXT_SIZE.min, Math.round(px)))
}

export function clampScale(f: number): number {
  return Math.min(UI_SCALE.max, Math.max(UI_SCALE.min, Math.round(f * 100) / 100))
}

/** The theme to paint: 'system' follows the OS. */
export function resolveTheme(theme: ThemeName, systemDark: boolean): ResolvedTheme {
  if (theme === 'system') return systemDark ? 'dark' : 'light'
  return theme
}
