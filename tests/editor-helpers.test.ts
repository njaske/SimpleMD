import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { describe, it } from 'node:test'
import { BAR_METRICS, barWidth, controlCount, rovingIndex, visibleGroupCount } from '../src/renderer/src/lib/editor/formatLayout.ts'
import { ariaShortcut, FORMAT_SHORTCUTS, shortcutFor, toCodeMirrorKey } from '../src/renderer/src/lib/editor/shortcuts.ts'

// images.ts imports its siblings without extensions (Vite style); node needs the ".ts".
registerHooks({
  resolve(specifier, context, next) {
    const extensionless = /^\.\.?\//.test(specifier) && !/\.\w+$/.test(specifier)
    return next(extensionless && context.parentURL?.endsWith('.ts') ? `${specifier}.ts` : specifier, context)
  }
})
const { imageAlt, isImageFile, markdownImage, UNSAVED_NOTICE } = await import('../src/renderer/src/lib/editor/images.ts')

describe('format bar layout', () => {
  const groups = [4, 2, 4, 3]

  it('shows every group when there is room', () => {
    assert.equal(visibleGroupCount(1000, groups), 4)
    assert.equal(visibleGroupCount(barWidth(groups, 4), groups), 4)
  })

  it('folds trailing groups into More as the bar narrows', () => {
    assert.equal(visibleGroupCount(barWidth(groups, 4) - 1, groups), 3)
    assert.equal(visibleGroupCount(barWidth(groups, 2), groups), 2)
    assert.equal(visibleGroupCount(barWidth(groups, 1) - 1, groups), 0)
  })

  it('reserves room for the More button only when something is hidden', () => {
    const all = barWidth(groups, 4)
    const three = barWidth(groups, 3)
    assert.equal(all - three, BAR_METRICS.divider + 3 * BAR_METRICS.button + 2 * BAR_METRICS.gap - (BAR_METRICS.divider + BAR_METRICS.button))
  })
})

describe('format bar roving focus', () => {
  const groups = [4, 2, 4, 3]

  it('counts the heading menu, the shown buttons and More', () => {
    assert.equal(controlCount(groups, 4), 14)
    assert.equal(controlCount(groups, 2), 8)
    assert.equal(controlCount(groups, 0), 2)
  })

  it('keeps a control tabbable after the focused one folds into More', () => {
    assert.equal(rovingIndex(13, controlCount(groups, 4)), 13)
    assert.equal(rovingIndex(13, controlCount(groups, 2)), 7)
    assert.equal(rovingIndex(13, controlCount(groups, 0)), 1)
    assert.equal(rovingIndex(3, controlCount(groups, 2)), 3)
  })
})

describe('editor shortcuts', () => {
  it('maps portable shortcuts to CodeMirror key names', () => {
    assert.equal(toCodeMirrorKey('Mod+B'), 'Mod-b')
    assert.equal(toCodeMirrorKey('Mod+Shift+C'), 'Mod-Shift-c')
    assert.equal(toCodeMirrorKey('Mod+Alt+1'), 'Mod-Alt-1')
    assert.equal(toCodeMirrorKey('Mod+Shift+.'), 'Mod-Shift-.')
  })

  it('formats aria-keyshortcuts per platform', () => {
    assert.equal(ariaShortcut('Mod+Shift+X', 'win32'), 'Control+Shift+X')
    assert.equal(ariaShortcut('Mod+K', 'darwin'), 'Meta+K')
  })

  it('covers the spec shortcuts', () => {
    assert.equal(shortcutFor('bold'), 'Mod+B')
    assert.equal(shortcutFor('quote'), 'Mod+Shift+.')
    assert.equal(shortcutFor('taskList'), 'Mod+Shift+9')
    assert.equal(shortcutFor('table'), null)
    assert.equal(new Set(FORMAT_SHORTCUTS.map(([, s]) => s)).size, FORMAT_SHORTCUTS.length)
  })
})

describe('image helpers', () => {
  it('accepts the image formats the app can save', () => {
    assert.equal(isImageFile({ type: 'image/png', name: 'a.png' }), true)
    assert.equal(isImageFile({ type: 'image/webp', name: 'a' }), true)
    assert.equal(isImageFile({ type: '', name: 'photo.JPG' }), true)
    assert.equal(isImageFile({ type: 'image/svg+xml', name: 'a.svg' }), false)
    assert.equal(isImageFile({ type: 'text/markdown', name: 'notes.md' }), false)
  })

  it('derives readable alt text from file names', () => {
    assert.equal(imageAlt('team-photo_2.png'), 'team photo 2')
    assert.equal(imageAlt('[weird].jpeg'), 'weird')
    assert.equal(imageAlt('.png'), 'image')
  })

  it('wraps destinations with spaces or parentheses in angle brackets', () => {
    assert.equal(markdownImage('shot', 'assets/shot-1.png'), '![shot](assets/shot-1.png)')
    assert.equal(markdownImage('my shot', 'assets/my shot (2).png'), '![my shot](<assets/my shot (2).png>)')
  })

  it('uses the spec wording for unsaved documents', () => {
    assert.equal(UNSAVED_NOTICE, 'Save this document first to add images')
  })
})
