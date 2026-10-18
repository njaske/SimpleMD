import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { Window } from 'happy-dom'

// The helpers check targets with instanceof Node/Element, so install a DOM first.
const win = new Window()
Object.assign(globalThis, { Node: win.Node, Element: win.Element })

type Drops = typeof import('../src/renderer/src/lib/editor/drops.ts')
let drops: Drops

before(async () => {
  drops = await import('../src/renderer/src/lib/editor/drops.ts')
})

// happy-dom nodes stand in for the browser's; the helpers only read them.
const asTarget = (node: unknown): EventTarget => node as EventTarget

function page(): { line: EventTarget; text: EventTarget; out: EventTarget } {
  const doc = win.document
  doc.body.innerHTML = '<div class="cm-editor"><div class="cm-content"><div class="cm-line">text</div></div></div><aside id="out">x</aside>'
  const line = doc.querySelector('.cm-line')
  const out = doc.querySelector('#out')
  assert.ok(line && out)
  return { line: asTarget(line), text: asTarget(line.firstChild), out: asTarget(out) }
}

function transfer(...types: string[]): DataTransfer {
  return { items: types.map((type) => ({ kind: 'file', type })) } as unknown as DataTransfer
}

describe('editor drop contract', () => {
  it('reports a cancelled drop inside the editor as handled', () => {
    // Arrange
    const { line, text, out } = page()
    // Act + Assert
    assert.equal(drops.isEditorHandledDrop({ target: line, defaultPrevented: true, dataTransfer: null }), true)
    assert.equal(drops.isEditorHandledDrop({ target: text, defaultPrevented: true, dataTransfer: null }), true)
    assert.equal(drops.isEditorHandledDrop({ target: out, defaultPrevented: true, dataTransfer: null }), false)
  })

  it('leaves uncancelled drops in the editor to the app', () => {
    const { line } = page()
    assert.equal(drops.isEditorHandledDrop({ target: line, defaultPrevented: false, dataTransfer: null }), false)
  })

  it('spots image drags over the editor only', () => {
    const { line, out } = page()
    assert.equal(drops.isEditorImageDrag({ target: line, defaultPrevented: false, dataTransfer: transfer('image/png') }), true)
    assert.equal(drops.isEditorImageDrag({ target: line, defaultPrevented: false, dataTransfer: transfer('text/markdown') }), false)
    assert.equal(drops.isEditorImageDrag({ target: out, defaultPrevented: false, dataTransfer: transfer('image/png') }), false)
  })

  it('ignores targets that are not nodes and empty transfers', () => {
    assert.equal(drops.isEditorHandledDrop({ target: null, defaultPrevented: true, dataTransfer: null }), false)
    assert.equal(drops.dragCarriesImages(null), false)
  })
})
