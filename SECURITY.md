# Security

## Reporting a vulnerability

Please report vulnerabilities **privately** through
[GitHub Security Advisories](https://github.com/njaske/SimpleMD/security/advisories/new)
instead of opening a public issue. Include the Markdown file or steps that trigger it.

## Threat model

SimpleMD opens Markdown files that may come from untrusted sources (downloads, AI tools, other people).

- **Rendering:** Markdown is converted with `marked`, then sanitized with DOMPurify. `<style>`, forms and interactive controls are removed. Mermaid runs with `securityLevel: 'strict'`; KaTeX `trust` is off.
- **Process isolation:** the renderer is sandboxed with `contextIsolation` on and `nodeIntegration` off. It talks to the main process only through a small typed preload API.
- **File access allow-list:** the main process only reads, writes, trashes or reveals paths inside folders and files the user opened through a dialog, by drag-and-drop, or from Windows Explorer (double-click / "Open with"). Dropped paths are resolved in the preload, never taken from the page, and launch paths come only from the process command line. Settings that grant access (`lastFolder`, `approvedFiles`) can only be written by the main process, and every renderer-settable value is type-checked.
- **CSP:** a strict Content-Security-Policy is applied in production (scripts from the app bundle only, no frames, no forms, no `http:` images).
- **Document styling:** inline styles that could cover the app (`position: fixed/sticky`, `z-index`, `inset`) or load remote resources (`url()`, `@import`) are stripped, as are non-checkbox `<input>`s and media elements. Documents over 1 MB are shown as plain source.
- **Packaged binary:** Electron fuses disable `RunAsNode`, `NODE_OPTIONS` and `--inspect`, and enforce loading only the integrity-checked app archive.
- **Local images:** image references are resolved in the main process and only read if they stay inside the document's folder or the opened workspace (symlink and `..` escapes are rejected). UNC / network paths are refused so a document cannot trigger an SMB connection.
- **Writes:** saves go through an atomic temp-file-and-rename and refuse executable/script file types.
- **Network:** SimpleMD makes no network requests of its own. Remote `https:` images embedded in a document are loaded by the renderer.
- **Permissions:** all Chromium permission requests (camera, microphone, location, …) are denied.

## Known limitations

- Releases are **not code-signed**; Windows SmartScreen will warn. Verify downloads with `SHA256SUMS.txt`.
- Remote `https:` images in a document reveal your IP address to that image host, as in any browser.
- `npm audit` reports an advisory in KaTeX (prototype pollution that bypasses the `trust` option). SimpleMD never enables `trust`, so it is not exploitable here; the fix requires a breaking KaTeX upgrade that Mermaid does not yet support.
