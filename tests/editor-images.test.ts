import './support/aliases.ts'
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { Window } from 'happy-dom'

// CodeMirror needs a DOM: install happy-dom's before loading anything that builds a view.
const win = new Window()

// happy-dom's DragEvent drops `dataTransfer` from its init; browsers keep it.
class TestDragEvent extends win.Event {
  readonly dataTransfer: unknown
  constructor(type: string, init: { dataTransfer?: unknown; bubbles?: boolean; cancelable?: boolean } = {}) {
    super(type, init)
    this.dataTransfer = init.dataTransfer ?? null
  }
}

Object.assign(globalThis, {
  window: win,
  document: win.document,
  Node: win.Node,
  Element: win.Element,
  HTMLElement: win.HTMLElement,
  MutationObserver: win.MutationObserver,
  DOMParser: win.DOMParser,
  DataTransfer: win.DataTransfer,
  DragEvent: TestDragEvent,
  getComputedStyle: win.getComputedStyle.bind(win),
  requestAnimationFrame: win.requestAnimationFrame.bind(win),
  cancelAnimationFrame: win.cancelAnimationFrame.bind(win)
})

type Images = typeof import('../src/renderer/src/lib/editor/images.ts')
type View = typeof import('@codemirror/view')
type State = typeof import('@codemirror/state')
let images: Images
let cmView: View
let cmState: State

before(async () => {
  images = await import('../src/renderer/src/lib/editor/images.ts')
  cmView = await import('@codemirror/view')
  cmState = await import('@codemirror/state')
})

after(() => win.close())

const png = (name = 'image.png'): File => new win.File(['png'], name, { type: 'image/png' }) as unknown as File
const md = (name = 'notes.md'): File => new win.File(['# hi'], name, { type: 'text/markdown' }) as unknown as File

function clipboard(files: File[], text = '', html = ''): { files: File[]; getData(format: string): string } {
  return { files, getData: (format) => (format === 'text/plain' ? text : format === 'text/html' ? html : '') }
}

/** A promise we resolve by hand, to hold a save "in flight". */
function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void } {
  let resolve: (value: T) => void = () => undefined
  let reject: (error: unknown) => void = () => undefined
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

function editor(doc: string, cursor: number, hooks: import('../src/renderer/src/lib/editor/images.ts').ImageHooks) {
  const parent = win.document.createElement('div')
  win.document.body.appendChild(parent)
  return new cmView.EditorView({
    parent: parent as unknown as HTMLElement,
    state: cmState.EditorState.create({ doc, selection: { anchor: cursor }, extensions: [images.imageHandling(hooks)] })
  })
}

describe('pastedImages', () => {
  it('takes an image-only clipboard', () => {
    const file = png()
    assert.deepEqual(images.pastedImages(clipboard([file])), [file])
  })

  it('takes an image whose HTML is just the picture (copy image in a browser or Office)', () => {
    const html = '<html><head><style>p{}</style></head><body><!--StartFragment--><img src="x.png">&nbsp;<!--EndFragment--></body></html>'
    assert.equal(images.pastedImages(clipboard([png()], '', html)).length, 1)
  })

  it('takes an image copied from a file manager, whose text is just its name or path', () => {
    assert.equal(images.pastedImages(clipboard([png('shot.png')], 'C:\\Users\\me\\shot.png')).length, 1)
  })

  it('leaves spreadsheet cells to smart paste even when Excel adds a picture of them', () => {
    const tsv = 'Name\tScore\nAda\t3\n'
    assert.deepEqual(images.pastedImages(clipboard([png()], tsv, '<table><tr><td>Name</td></tr></table>')), [])
  })

  it('leaves rich text with pictures to smart paste', () => {
    assert.deepEqual(images.pastedImages(clipboard([png()], '', '<p>Hello <img src="a.png"></p>')), [])
  })

  it('ignores clipboards without image files', () => {
    assert.deepEqual(images.pastedImages(clipboard([md()])), [])
    assert.deepEqual(images.pastedImages(null), [])
  })
})

describe('splitFiles and htmlHasText', () => {
  it('splits a mixed drop into images and the rest', () => {
    const [a, b, c] = [png('a.png'), md(), new win.File([''], 'photo.JPG', { type: '' }) as unknown as File]
    const { images: imgs, others } = images.splitFiles([a, b, c])
    assert.deepEqual(imgs, [a, c])
    assert.deepEqual(others, [b])
  })

  it('sees text only outside tags, comments and styles', () => {
    assert.equal(images.htmlHasText('<style>td { color: red }</style><img src="a">'), false)
    assert.equal(images.htmlHasText('<b>hi</b>'), true)
  })
})

describe('placeImages', () => {
  const doc = (text: string) => cmState.Text.of(text.split('\n'))
  const img = '![image](assets/image.png)'

  it('puts an image at the start of a heading on its own paragraph above it', () => {
    const place = images.placeImages(doc('# Test'), 0, 0, img)
    assert.equal(place.insert, img + '\n\n')
    assert.equal(place.cursor, img.length)
  })

  it('separates an image at a line start from the paragraph above', () => {
    const text = 'first line\nsecond line'
    const place = images.placeImages(doc(text), 11, 11, img)
    assert.equal(place.insert, '\n' + img + '\n\n')
    assert.equal(place.cursor, 11 + 1 + img.length)
  })

  it('makes a blank line between paragraphs its own paragraph', () => {
    const place = images.placeImages(doc('a\n\nb'), 2, 2, img)
    assert.deepEqual([place.from, place.to, place.insert], [2, 2, '\n' + img + '\n'])
  })

  it('stays inline in the middle of a paragraph', () => {
    const place = images.placeImages(doc('see this'), 4, 4, img)
    assert.deepEqual([place.from, place.to, place.insert, place.cursor], [4, 4, img, 4 + img.length])
  })
})

describe('insertImages', () => {
  it('lands where the cursor was, mapped past text typed above while saving', async () => {
    // Arrange
    const saving = deferred<string | null>()
    const view = editor('one\nsee ', 8, { save: () => () => saving.promise, notice: () => undefined })
    // Act
    assert.equal(images.insertImages(view, [png('my-chart.png')], { from: 8, to: 8 }, { save: () => () => saving.promise, notice: () => undefined }, 'input.paste'), true)
    view.dispatch({ changes: { from: 0, insert: 'zero\n' } })
    saving.resolve('assets/my-chart.png')
    await tick()
    // Assert
    assert.equal(view.state.doc.toString(), 'zero\none\nsee ![my chart](assets/my-chart.png)')
    assert.equal(view.state.selection.main.head, view.state.doc.length)
    view.destroy()
  })

  it('leaves the cursor alone when the user moved on while the image saved', async () => {
    const saving = deferred<string | null>()
    const hooks = { save: () => () => saving.promise, notice: () => undefined }
    const view = editor('ab cd', 2, hooks)
    images.insertImages(view, [png()], { from: 2, to: 2 }, hooks, 'input.paste')
    view.dispatch({ selection: { anchor: 5 } })
    saving.resolve('assets/image.png')
    await tick()
    assert.equal(view.state.doc.toString(), 'ab![image](assets/image.png) cd')
    assert.equal(view.state.selection.main.head, view.state.doc.length)
    view.destroy()
  })

  it('tells an unsaved document to save first and inserts nothing', async () => {
    const notices: string[] = []
    const hooks = { save: () => async () => null, notice: (m: string) => notices.push(m) }
    const view = editor('text', 4, hooks)
    images.insertImages(view, [png()], { from: 4, to: 4 }, hooks, 'input.paste')
    await tick()
    assert.deepEqual(notices, [images.UNSAVED_NOTICE])
    assert.equal(view.state.doc.toString(), 'text')
    view.destroy()
  })

  it('says what went wrong when saving fails', async () => {
    const notices: string[] = []
    const hooks = { save: () => () => Promise.reject(new Error('gone')), notice: (m: string) => notices.push(m) }
    const view = editor('text', 4, hooks)
    images.insertImages(view, [png()], { from: 4, to: 4 }, hooks, 'input.paste')
    await tick()
    assert.equal(notices.length, 1)
    assert.match(notices[0], /Couldn't add the image/)
    assert.equal(view.state.doc.toString(), 'text')
    view.destroy()
  })

  it('declines when the editor has nowhere to save images', () => {
    const view = editor('text', 0, { save: () => undefined, notice: () => undefined })
    assert.equal(images.insertImages(view, [png()], { from: 0, to: 0 }, { save: () => undefined, notice: () => undefined }, 'input.paste'), false)
    view.destroy()
  })
})

describe('mixed drops', () => {
  function drop(target: EventTarget, files: File[]): void {
    const event = new win.Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', { value: { types: ['Files'], files, items: [] } })
    Object.assign(event, { clientX: 0, clientY: 0, screenX: 0, screenY: 0 })
    target.dispatchEvent(event as unknown as Event)
  }

  it('inserts the images and hands the other files on to the app', async () => {
    // Arrange
    const saved: string[] = []
    const hooks = { save: () => async (f: File) => (saved.push(f.name), `assets/${f.name}`), notice: () => undefined }
    const view = editor('', 0, hooks)
    const forwarded: string[][] = []
    view.dom.parentElement?.addEventListener('drop', (e) => {
      if (e.target === view.dom.parentElement) forwarded.push(Array.from((e as DragEvent).dataTransfer?.files ?? []).map((f) => f.name))
    })
    // Act
    drop(view.contentDOM, [png('shot.png'), md('notes.md')])
    await tick()
    // Assert
    assert.deepEqual(saved, ['shot.png'])
    assert.deepEqual(forwarded, [['notes.md']])
    assert.equal(view.state.doc.toString(), '![shot](assets/shot.png)')
    view.destroy()
  })

  it('hands every file on when the editor cannot save images', async () => {
    const hooks = { save: () => undefined, notice: () => undefined }
    const view = editor('', 0, hooks)
    const forwarded: number[] = []
    view.dom.parentElement?.addEventListener('drop', (e) => {
      if (e.target === view.dom.parentElement) forwarded.push((e as DragEvent).dataTransfer?.files.length ?? 0)
    })
    drop(view.contentDOM, [png(), md()])
    await tick()
    assert.deepEqual(forwarded, [2])
    assert.equal(view.state.doc.toString(), '')
    view.destroy()
  })
})
