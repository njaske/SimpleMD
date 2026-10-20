// Regenerates site/screenshots/*.png (used by the README and the website) from the real app:
// five scenes in light and dark, 1440x900 at 2x, on a throwaway copy of sample-notes and a
// throwaway profile, so nothing on this machine is touched.
// Run: npx electron-vite build && node scripts/screenshots.mjs
import { _electron as electron } from 'playwright'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'site', 'screenshots')
const W = 1440
const H = 900

async function session(theme, work) {
  const notes = join(work, `notes-${theme}`, 'Notes')
  await cp(join(ROOT, 'sample-notes'), notes, { recursive: true })
  const userData = join(work, `data-${theme}`)
  await mkdir(userData, { recursive: true })
  const rate = join(notes, 'AI Answers', 'Rate Limiter Design.md')
  const kube = join(notes, 'AI Answers', 'Kubernetes Cheatsheet.md')
  await writeFile(join(userData, 'simplemd-settings.json'), JSON.stringify({
    theme, accent: '#c0392b', readingFont: 'Serif', readingWidth: 700, readingSize: 17, lineHeight: 1.7,
    uiScale: 1, reduceMotion: true, syncScroll: true, blockRemoteImages: false, showStatusBar: true,
    sidebarOpen: true, outlineOpen: true, activity: 'files', viewMode: 'read', pinned: [], recents: [],
    openTabs: [kube, rate], activeId: rate, looseFiles: []
  }))
  const env = { ...process.env, SIMPLEMD_USER_DATA: userData, SIMPLEMD_INITIAL_FOLDER: notes }
  delete env.ELECTRON_RENDERER_URL
  const app = await electron.launch({ args: [join(ROOT, 'out', 'main', 'index.js'), '--force-device-scale-factor=2'], env, cwd: ROOT })
  const page = await app.firstWindow()
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: false })
  await page.waitForSelector('.smd-root')
  return { app, page }
}

const settle = async (page, ms = 900) => {
  await page.evaluate(async () => {
    await document.fonts.ready
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  })
  await page.waitForTimeout(ms)
}
const shot = async (page, name, theme) => {
  await settle(page)
  await page.screenshot({ path: join(OUT, `${name}-${theme}.png`) })
  console.log('captured', `${name}-${theme}`)
}
const readerTo = (page, y) => page.evaluate((v) => { document.querySelector('.smd-reader').scrollTop = v }, y)

const work = await mkdtemp(join(tmpdir(), 'simplemd-shots-'))
for (const theme of ['dark', 'light']) {
  const { app, page } = await session(theme, work)
  await page.waitForSelector('.smd-article .smd-mermaid svg', { timeout: 20_000 })
  await page.waitForSelector('.smd-article .katex')
  await readerTo(page, 0)
  await shot(page, 'math-code', theme)

  // The table and the diagram.
  await page.evaluate(() => {
    const h = [...document.querySelectorAll('.smd-article h2')].find((e) => /trade-offs/i.test(e.textContent))
    document.querySelector('.smd-reader').scrollTop = h.offsetTop - 40
  })
  await shot(page, 'diagrams', theme)

  // Split view, back at the top.
  await readerTo(page, 0)
  await page.keyboard.press('Control+2')
  await page.waitForSelector('.cm-content')
  await shot(page, 'split', theme)
  await page.keyboard.press('Control+1')
  await settle(page, 500)

  // Workspace search.
  await page.getByRole('radio', { name: 'Search', exact: true }).click()
  await page.getByRole('searchbox', { name: 'Search all documents' }).or(page.getByLabel('Search all documents')).first().fill('token')
  await page.waitForTimeout(1200)
  await shot(page, 'search', theme)
  await page.getByRole('radio', { name: 'Files', exact: true }).click()

  // Reading preferences over the Fourier series notes.
  await page.getByRole('treeitem', { name: 'Fourier Series.md', exact: true }).click()
  await page.waitForSelector('.smd-article .katex')
  await settle(page, 600)
  await page.getByRole('button', { name: 'Reading settings' }).click()
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(OUT, `reading-${theme}.png`) })
  console.log('captured', `reading-${theme}`)

  try {
    execFileSync('taskkill', ['/PID', String(app.process().pid), '/T', '/F'], { stdio: 'ignore' })
  } catch {
    await app.close().catch(() => {})
  }
}
await rm(work, { recursive: true, force: true }).catch(() => {})
