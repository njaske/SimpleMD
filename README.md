<div align="center">

<img src="build/icon.png" width="96" height="96" alt="SimpleMD icon">

# SimpleMD

### The desktop reader for everything your AI writes.

Equations come out typeset. Mermaid blocks become real diagrams. Code gets highlighted.<br>
And your files never leave your machine.

[![Download for Windows](https://img.shields.io/badge/Download-Windows%2010%20%2F%2011-D32F2F?style=for-the-badge&logo=windows&logoColor=white)](https://github.com/njaske/SimpleMD/releases/latest)
&nbsp;
[![Website](https://img.shields.io/badge/Website-njaske.github.io-1C1C1F?style=for-the-badge)](https://njaske.github.io/SimpleMD/)

[![CI](https://github.com/njaske/SimpleMD/actions/workflows/ci.yml/badge.svg)](https://github.com/njaske/SimpleMD/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/njaske/SimpleMD?color=D32F2F)](https://github.com/njaske/SimpleMD/releases/latest)
[![VirusTotal Setup](https://img.shields.io/badge/VirusTotal%20(Setup)-0%2F53-2EA44F?logo=virustotal&logoColor=white)](https://www.virustotal.com/gui/file/e58e5226030e3d9e940bee1af65a4d455f619c724aba56c4a73f2a6fac096dff)
[![VirusTotal Portable](https://img.shields.io/badge/VirusTotal%20(Portable)-0%2F57-2EA44F?logo=virustotal&logoColor=white)](https://www.virustotal.com/gui/file/5125c941df2de04d39e299161cc1dbe941f380234616541fbe1e52da86bf4fef)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

<br>

<img src="site/screenshots/math-code-dark.png" alt="SimpleMD reading an AI-generated design doc with a typeset equation, highlighted TypeScript and a live outline" width="100%">

</div>

<br>

## Why SimpleMD

ChatGPT, Claude, Copilot and every other assistant answer in Markdown, full of LaTeX math, Mermaid diagrams and code. Save that answer to a `.md` file, open it in a normal Markdown viewer, and you get a wall of `$$\frac{…}{…}$$` and raw code fences.

SimpleMD renders all of it the way it was meant to look, in a fast desktop app that never uploads your files. No account, no telemetry, no cloud. Open a file or a whole folder and read.

<br>

## See it

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="site/screenshots/diagrams-dark.png" alt="Table with inline math above a rendered Mermaid flowchart and a task list"><br>
      <b>Diagrams and tables.</b> Mermaid flowcharts, sequence diagrams, tables with inline math and task lists, all rendered inline.
    </td>
    <td width="50%" valign="top">
      <img src="site/screenshots/split-dark.png" alt="Split view with the Markdown source on the left and the rendered preview on the right"><br>
      <b>Split view.</b> Edit the source on the left, watch the preview follow as you type. Ctrl+S saves.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="site/screenshots/search-dark.png" alt="Workspace search results listing every match by file and line"><br>
      <b>Search everything.</b> Find any word across every file in the folder you opened, with each match in context.
    </td>
    <td width="50%" valign="top">
      <img src="site/screenshots/reading-light.png" alt="Light theme with the reading preferences open over Fourier series equations"><br>
      <b>Light or dark.</b> One shortcut (Ctrl+Shift+D). Pick Sans, Serif or Mono, set the reading width and accent colour.
    </td>
  </tr>
</table>

<br>

## Features

| | |
|---|---|
| **Math** | Inline `$…$` and display `$$…$$` LaTeX, typeset by KaTeX |
| **Diagrams** | Mermaid flowcharts, sequence, class, state and more, drawn as crisp vectors that follow your theme |
| **Code** | Syntax highlighting for fenced code blocks in dozens of languages |
| **Editing** | CodeMirror 6 editor with find and replace, bracket matching and Markdown highlighting; Read, Split and Edit modes |
| **Navigation** | Live heading outline, workspace-wide search, pinned and recent files, tabs |
| **Folders** | Open a whole folder at once, or single files, or drag and drop; files changed on disk reload automatically |
| **Windows integration** | Shows up in Explorer's "Open with" for `.md`, `.markdown`, `.mdx` and friends; double-click to open |
| **Export** | Ctrl+P for a clean A4 PDF with equations, diagrams and code intact |
| **Privacy** | No account, no telemetry, no update checks. The app never phones home; the only thing it ever fetches is an image a document itself links to on the web |

### Keyboard shortcuts

| Action | Shortcut |
|---|---|
| Search all files | `Ctrl` `F` |
| Save | `Ctrl` `S` |
| Export to PDF | `Ctrl` `P` |
| Close tab | `Ctrl` `W` |
| Toggle sidebar / outline | `Ctrl` `B` / `Ctrl` `\` |
| Switch theme | `Ctrl` `Shift` `D` |

<br>

## Download

Grab the [latest release](https://github.com/njaske/SimpleMD/releases/latest). Windows 10 and 11, 64-bit.

| File | Best for |
|---|---|
| **`SimpleMD-Setup.exe`** | Most people. Installs for your user only (no admin), adds Start Menu and desktop shortcuts and an uninstaller, and registers SimpleMD for "Open with" |
| **`SimpleMD-portable.exe`** | USB sticks and locked-down PCs. One file, nothing to install |
| `SHA256SUMS.txt` | Checksums to verify either download |

### Scanned clean

Every release is uploaded to VirusTotal. For **v1.0.3**, not one antivirus engine flagged either file.

| File | Result | SHA-256 |
|---|---|---|
| `SimpleMD-Setup.exe` | [**0 / 53 detections**](https://www.virustotal.com/gui/file/e58e5226030e3d9e940bee1af65a4d455f619c724aba56c4a73f2a6fac096dff) | `e58e5226030e3d9e940bee1af65a4d455f619c724aba56c4a73f2a6fac096dff` |
| `SimpleMD-portable.exe` | [**0 / 57 detections**](https://www.virustotal.com/gui/file/5125c941df2de04d39e299161cc1dbe941f380234616541fbe1e52da86bf4fef) | `5125c941df2de04d39e299161cc1dbe941f380234616541fbe1e52da86bf4fef` |

<details>
<summary><b>Show the VirusTotal reports</b></summary>
<br>

**SimpleMD-Setup.exe**

<a href="https://www.virustotal.com/gui/file/e58e5226030e3d9e940bee1af65a4d455f619c724aba56c4a73f2a6fac096dff"><img src="docs/virustotal-setup.png" alt="VirusTotal report for SimpleMD-Setup.exe: no security vendors flagged this file, 0 of 53"></a>

**SimpleMD-portable.exe**

<a href="https://www.virustotal.com/gui/file/5125c941df2de04d39e299161cc1dbe941f380234616541fbe1e52da86bf4fef"><img src="docs/virustotal-portable.png" alt="VirusTotal report for SimpleMD-portable.exe: no security vendors flagged this file, 0 of 57"></a>

</details>

To check that your download is the exact file that was scanned, compare its hash with the table above:

```powershell
certutil -hashfile SimpleMD-Setup.exe SHA256
```

### "Windows protected your PC"

SimpleMD isn't code-signed (certificates cost money this free project doesn't spend), so SmartScreen warns about it until it builds download reputation. Click **More info**, then **Run anyway**. If you'd rather not, every line of the source is here and you can [build it yourself](#build-from-source).

<br>

## Safe with files from anyone

A Markdown file is just text, but a careless viewer can be tricked into running code from it. SimpleMD treats every document as untrusted:

- **Sanitized rendering.** Every document passes through DOMPurify. Scripts, event handlers, iframes, forms, media and style tricks like full-screen overlays are stripped before anything reaches the page.
- **Sandboxed window.** The renderer runs sandboxed and context-isolated, with no Node.js access and a strict Content-Security-Policy that allows only the app's own code.
- **File access you control.** The app can only read the folders and files you opened. Local images can't be read from outside them, and network (UNC) paths are refused.
- **Hardened binary.** Electron fuses disable running as plain Node, `NODE_OPTIONS` and debugger injection, and the app only loads its integrity-checked bundle.
- **Safe saves.** Writes go to a temporary file that replaces the original in one step, so a crash can't leave you with half a file.

Full details and how to report a vulnerability privately: [SECURITY.md](SECURITY.md).

<br>

## Build from source

Requires [Node.js](https://nodejs.org) 22.12 or newer.

```bash
git clone https://github.com/njaske/SimpleMD.git
cd SimpleMD
npm ci
npm run dev        # run with hot reload
npm test           # unit tests
npm run dist:win   # build the installer and portable exe into dist/
```

Try it on the demo documents in [`sample-notes/`](sample-notes) (math, diagrams, tables, an AI-style design doc) with **Open folder**.

Releases are built by [GitHub Actions](.github/workflows/release.yml) from the tagged source, never on a personal machine, and published with their checksums.

<br>

## Disclaimer

SimpleMD is a free, independent, open-source hobby project, provided **"as is", without warranty of any kind**, under the [MIT License](LICENSE).

- **Scans are a second opinion, not a guarantee.** The VirusTotal results above apply only to the exact files and hashes listed. Download only from this repository's [Releases page](https://github.com/njaske/SimpleMD/releases), and verify the hash.
- **No software is perfectly secure.** SimpleMD takes care to render untrusted documents safely (see above), but you open files at your own risk. Please [report](SECURITY.md) anything that looks wrong.
- **SimpleMD shows content; it doesn't check it.** It renders whatever is in the file. It does not verify that AI-generated text, math or code is correct.
- **Not affiliated** with VirusTotal, Microsoft, OpenAI, Anthropic, GitHub or any other company mentioned here. Names and trademarks belong to their owners.

<br>

## Built with

[Electron](https://electronjs.org) · [React](https://react.dev) · [CodeMirror 6](https://codemirror.net) · [KaTeX](https://katex.org) · [Mermaid](https://mermaid.js.org) · [marked](https://marked.js.org) · [DOMPurify](https://github.com/cure53/DOMPurify) · [highlight.js](https://highlightjs.org)

## Contributing

Issues and pull requests are welcome. Please run `npm run typecheck && npm test` before opening a PR. Found a security issue? Please follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

## License

[MIT](LICENSE) © 2026 njaske
