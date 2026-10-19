import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// Launches the built app (out/main/index.js) against a throwaway settings folder and,
// optionally, a throwaway notes folder, so tests never touch the user's real data.

const ROOT = resolve(__dirname, '..', '..')

export interface Launched {
  app: ElectronApplication
  page: Page
  /** The notes folder the app opened (absolute), or null. */
  notes: string | null
  userData: string
}

export async function makeNotes(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'simplemd-e2e-notes-'))
  for (const [rel, text] of Object.entries(files)) {
    const full = join(dir, rel)
    await mkdir(resolve(full, '..'), { recursive: true })
    await writeFile(full, text, 'utf8')
  }
  return dir
}

export async function launch(opts: { notes?: string | null; userData?: string } = {}): Promise<Launched> {
  const userData = opts.userData ?? (await mkdtemp(join(tmpdir(), 'simplemd-e2e-data-')))
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v
  delete env.ELECTRON_RENDERER_URL
  env.SIMPLEMD_USER_DATA = userData
  if (opts.notes) env.SIMPLEMD_INITIAL_FOLDER = opts.notes
  const app = await electron.launch({ args: [join(ROOT, 'out', 'main', 'index.js')], env, cwd: ROOT })
  const page = await app.firstWindow()
  await page.waitForSelector('.smd-root')
  return { app, page, notes: opts.notes ?? null, userData }
}

/** Make the next Save dialog answer `filePath` without showing UI. */
export async function stubSaveDialog(app: ElectronApplication, filePath: string): Promise<void> {
  await app.evaluate(({ dialog }, target) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: target })) as typeof dialog.showSaveDialog
  }, filePath)
}

/** Kill the app and every helper process it started (like a crash or Task Manager).
 *  Child processes outliving a killed main process would keep the single-instance
 *  lock, so a relaunch would quit at once. */
export function killTree(launched: Launched): void {
  const pid = launched.app.process().pid
  if (!pid) return
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
    else process.kill(pid, 'SIGKILL')
  } catch {
    // already gone
  }
}

export async function close(launched: Launched, opts: { keepData?: boolean } = {}): Promise<void> {
  // A window with unsaved edits asks before closing, which would hang a graceful close.
  const closed = await Promise.race([
    launched.app.close().then(() => true, () => false),
    new Promise<boolean>((done) => setTimeout(() => done(false), 5_000))
  ])
  if (!closed) killTree(launched)
  if (!opts.keepData) await rm(launched.userData, { recursive: true, force: true }).catch(() => undefined)
}

/** Run axe-core inside the app window and return "rule: count" for each violation.
 *  (@axe-core/playwright needs to open extra pages, which Electron doesn't allow.) */
export async function axeViolations(page: Page, opts: { exclude?: string[] } = {}): Promise<string[]> {
  const source = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8')
  await page.evaluate(source)
  return page.evaluate(async (exclude) => {
    const axe = (window as unknown as { axe: { run: (ctx: unknown, opts: unknown) => Promise<{ violations: { id: string; nodes: unknown[] }[] }> } }).axe
    const result = await axe.run(
      { include: [document.body], exclude: exclude.map((sel) => [sel]) },
      { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } }
    )
    return result.violations.map((v) => `${v.id}: ${v.nodes.length}`)
  }, opts.exclude ?? [])
}

export async function removeDir(dir: string | null): Promise<void> {
  if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined)
}

/** The rendered article of the active document. */
export const article = (page: Page) => page.locator('.smd-reader .smd-article')
