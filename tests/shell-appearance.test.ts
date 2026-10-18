import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ACCENTS,
  DEFAULT_ACCENT,
  LINE_HEIGHTS,
  READING_FONTS,
  WIDTHS,
  clampScale,
  clampTextSize,
  nearest,
  normalizeAccent,
  resolveTheme
} from '../src/renderer/src/app/appearance.ts'

describe('appearance', () => {
  it('resolves system to the OS preference and keeps explicit themes', () => {
    assert.equal(resolveTheme('system', true), 'dark')
    assert.equal(resolveTheme('system', false), 'light')
    assert.equal(resolveTheme('sepia', true), 'sepia')
  })

  it('maps legacy 1.0 accents to the new presets and unknown ones to Ember', () => {
    assert.equal(normalizeAccent('#D97706'), '#b45309')
    assert.equal(normalizeAccent('#2563EB'), '#2563eb')
    assert.equal(normalizeAccent('#123456'), DEFAULT_ACCENT)
    assert.equal(ACCENTS.length, 6)
  })

  it('names every reading font with the bundled family first and fallbacks after', () => {
    assert.match(READING_FONTS.Serif, /^'Literata Variable'.*serif$/)
    assert.match(READING_FONTS.Sans, /^'Inter Variable'/)
    assert.match(READING_FONTS.Mono, /^'JetBrains Mono Variable'.*monospace$/)
    assert.match(READING_FONTS.Hyperlegible, /^'Atkinson Hyperlegible Next Variable'/)
  })

  it('clamps text size and interface scale', () => {
    assert.equal(clampTextSize(40), 26)
    assert.equal(clampTextSize(10), 13)
    assert.equal(clampTextSize(17.4), 17)
    assert.equal(clampScale(2), 1.5)
    assert.equal(clampScale(0.5), 0.9)
    assert.equal(clampScale(1.234), 1.23)
  })

  it('picks the nearest preset for any stored value', () => {
    assert.equal(nearest(LINE_HEIGHTS, 1.62).label, 'Comfortable')
    assert.equal(nearest(WIDTHS, 1000).label, 'Wide')
  })
})
