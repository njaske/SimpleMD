// Dev-only fallback for `window.api`, used when the renderer runs in a plain
// browser (no Electron preload) — e.g. opening the Vite dev server directly for
// visual checks. Guarded behind import.meta.env.DEV at the call site, so this
// module is tree-shaken out of production builds.
import type { Api, FolderScan, Settings, MdFolderInfo } from '@shared/types'

const WELCOME = `# Welcome to SimpleMD

A calm, focused space for reading and writing Markdown. No accounts, no clutter — just your documents.

## Why SimpleMD

- Open an entire **folder** of notes in a single click
- Read beautifully rendered Markdown, or edit the source side by side
- Move fast with a live **outline** and full-text **search**

> Good tools disappear. SimpleMD tries to.

This is a browser preview with sample content.`

const GUIDE = `# Markdown Guide

Everything SimpleMD knows how to render.

## Emphasis

You can write *italic*, **bold**, ***both***, and ~~strikethrough~~. Inline \`code\` too.

## Task lists

- [x] Render headings
- [x] Render tables
- [ ] Achieve inbox zero

## Code

\`\`\`js
function debounce(fn, ms = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
\`\`\`

## Tables

| Feature | Status |
| --- | --- |
| Tables | Done |
| Footnotes | Planned |

## Math

Inline math like $E = mc^2$ renders with KaTeX, and display equations too:

$$ \\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi} $$

## Diagrams

\`\`\`mermaid
flowchart LR
  A[Open folder] --> B{Has .md files?}
  B -- Yes --> C[Open all at once]
  B -- No --> D[Show empty state]
  C --> E[Read / Split / Edit]
\`\`\`

> The details are not the details. They make the design.`

const ROADMAP = `# Q3 Roadmap

*Owner: Product*

## Milestones

1. **Reliability** — fewer crashes
2. **Collaboration** — shared folders
3. **Polish** — the thousand small things

- [x] Ship folder opener
- [ ] Comment threads`

const MATH = `# Formulas and Theory

## 1. Definition and Degree of a Polynomial

A polynomial (in one variable $x$) is an expression of the form

$$ P_n(x) = a_n x^n + a_{n-1} x^{n-1} + \\cdots + a_1 x + a_0, $$

where $a_0, a_1, \\dots, a_n$ are the **coefficients**, and the non-negative integer $n$ is the **degree of the polynomial**, denoted $\\deg P$, provided the leading coefficient $a_n \\neq 0$.

## 2. Polynomial Division

For any two polynomials $P(x)$ and $Q(x) \\neq 0$ there exist unique polynomials $S(x)$ and $R(x)$ such that

$$ P(x) = Q(x) \\cdot S(x) + R(x), \\qquad \\deg R < \\deg Q. $$

The quadratic formula gives the roots of a second-degree polynomial:

$$ x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}. $$

Inline example: the solution is $x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$ for $a \\neq 0$.`

const DIAGRAM = `# Flowchart

A mermaid diagram, rendered live by SimpleMD:

\`\`\`mermaid
flowchart LR
  A[Open folder] --> B{Has .md files?}
  B -- Yes --> C[Open all at once]
  B -- No --> D[Show empty state]
  C --> E[Read / Split / Edit]
\`\`\`

Diagrams sit inline with the rest of your document.`

const SHOWCASE = `# Neural Networks — Study Notes

A quick refresher generated from a chat — with the math and the diagram intact.

## Gradient descent

Parameters move along the negative gradient of the loss $L$:

$$ \\theta_{t+1} = \\theta_t - \\eta \\, \\nabla_\\theta L(\\theta_t) $$

where $\\eta$ is the learning rate and $\\nabla_\\theta L$ is the gradient.

## Forward pass

\`\`\`mermaid
flowchart LR
  X[Input x] --> H[Hidden layer]
  H --> Y[Output ŷ]
  Y --> L[Loss]
  L -. backprop .-> H
\`\`\`
`

const FILES: Record<string, Array<[string, string]>> = {
  'Getting Started': [
    ['Neural Networks.md', SHOWCASE],
    ['Welcome.md', WELCOME],
    ['Markdown Guide.md', GUIDE]
  ],
  Projects: [['Q3 Roadmap.md', ROADMAP]],
  Math: [['Polynomials.md', MATH]],
  Diagrams: [['Flowchart.md', DIAGRAM]]
}

function buildScan(): FolderScan {
  const root = '/sample-notes'
  const tree: MdFolderInfo[] = []
  const contents: Record<string, string> = {}
  for (const [folder, files] of Object.entries(FILES)) {
    const dir = `${root}/${folder}`
    tree.push({
      id: dir,
      name: folder,
      path: dir,
      files: files.map(([name]) => ({ id: `${dir}/${name}`, name, path: `${dir}/${name}`, dir }))
    })
    for (const [name, body] of files) contents[`${dir}/${name}`] = body
  }
  return { root, name: 'sample-notes', tree, contents }
}

export function installDevApi(): void {
  const scan = buildScan()
  const contents = { ...scan.contents }
  const welcome = `${scan.root}/Getting Started/Welcome.md`
  const showcase = `${scan.root}/Getting Started/Neural Networks.md`
  const settings: Settings = {
    theme: 'dark',
    accent: '#c0392b',
    readingFont: 'Serif',
    readingWidth: 760,
    sidebarOpen: true,
    outlineOpen: true,
    activity: 'files',
    viewMode: 'read',
    lastFolder: scan.root,
    pinned: [welcome],
    recents: [],
    openTabs: [showcase, welcome],
    activeId: showcase,
    looseFiles: []
  }

  const api: Api = {
    openFolder: async () => scan,
    openFiles: async () => [
      { path: '/Sample Folder/Loose Note.md', content: '# Loose Note\n\nOpened as an individual file, grouped by its folder.' }
    ],
    resolveDrop: async () => ({ folder: null, files: [] }),
    takeLaunchFiles: async () => null,
    onOpenPaths: () => () => {},
    scanFolder: async () => scan,
    readFile: async (path) => contents[path] ?? '',
    saveFile: async (path, content) => {
      contents[path] = content
      return true
    },
    readImage: async () => null,
    getSettings: async () => settings,
    setSettings: async (partial) => Object.assign(settings, partial),
    openExternal: async (url) => {
      window.open(url, '_blank', 'noopener')
    },
    trashItem: async () => true,
    revealItem: async () => {},
    exportPdf: async () => {
      window.print()
      return false
    },
    setUnsaved: async () => {},
    onFolderChanged: () => () => {},
    onRequestClose: () => () => {},
    win: {
      minimize: async () => {},
      maximizeToggle: async () => false,
      close: async () => {},
      forceClose: async () => {},
      isMaximized: async () => false,
      onMaximizeChange: () => () => {}
    }
  }
  ;(window as unknown as { api: Api }).api = api
}
