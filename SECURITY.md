# Security

## Reporting a vulnerability

Please report vulnerabilities **privately** through
[GitHub Security Advisories](https://github.com/njaske/SimpleMD/security/advisories/new)
instead of opening a public issue. Include the Markdown file or steps that trigger it.

## Threat model

SimpleMD opens Markdown files that may come from untrusted sources (downloads, AI tools, other people).

- **Rendering:** Markdown is converted with `marked`, then sanitized with DOMPurify. `<style>`, forms and interactive controls are removed. Mermaid runs with `securityLevel: 'strict'`; KaTeX `trust` is off.
- **Process isolation:** the renderer is sandboxed with `contextIsolation` on and `nodeIntegration` off. It talks to the main process only through a small typed preload API.
- **File access allow-list:** the main process only reads, writes, trashes or reveals paths inside folders and files the user opened through a dialog, by drag-and-drop, or from the system file manager (double-click / "Open with" in Explorer, Finder or a Linux file manager). Dropped paths are resolved in the preload, never taken from the page, and launch paths come only from the process command line or macOS `open-file` events. Settings that grant access (`lastFolder`, `approvedFiles`, `recentFolders`) can only be written by the main process, and every renderer-settable value is type-checked.
- **New files, folders, rename and duplicate:** new files and folders can only be created inside an opened workspace folder, never next to a loose file. Names are checked in the main process: no path separators, `..`, characters Windows forbids, reserved device names (`CON`, `NUL`, …), text-direction tricks, names the file list would hide (a leading dot, `node_modules`, `build`, …) or runnable extensions. A rename never changes a file's type (a Markdown file stays Markdown), so it can't turn a document into something that runs. Nothing is ever overwritten: creates use exclusive flags, a rename refuses an existing name, and duplicates pick the next free "copy" name. A rename stays in the same folder, the opened workspace folder itself can't be renamed, and a renamed or duplicated loose file keeps its access under the new name only. Trashing a file or folder drops every access grant at or below it.
- **Save As and exports:** Save As, Export HTML and Export PDF write only to a path the user picks in the system Save dialog. Save As grants access to that file, like opening it; exports don't. Runnable file types and network locations are refused, and Save As and HTML exports are written atomically.
- **Pasted images:** images pasted or dropped into the editor are saved only next to an opened document, in its `assets` folder, and only when the bytes really are PNG, JPEG, GIF, WebP, BMP or AVIF (checked by content, never by name; SVG is refused). They are capped at 25 MB, get a sanitized file name, never overwrite an existing file, and the `assets` folder must really be inside the document's folder, so a planted symlink or junction can't redirect the write.
- **Crash recovery:** unsaved text is kept in `recovery/session.json` inside the app's own data folder (at most 50 documents and about 20 million characters), written atomically and validated again when it is read back. Only documents the user had already opened are stored, their access is restored once per launch (and only for files that still exist), and the file is deleted as soon as everything is saved.
- **Recent folders:** the renderer can only ask to reopen a folder that is an exact entry of the main-process list of folders the user opened before; a folder that no longer exists is dropped from the list.
- **CSP:** a strict Content-Security-Policy is applied in production (scripts from the app bundle only, no frames, no forms, no `http:` images).
- **Document styling:** inline styles that could cover the app (`position: fixed/sticky`, `z-index`, `inset`) or load remote resources (`url()`, `@import`) are stripped, as are non-checkbox `<input>`s and media elements. Documents over 1 MB are shown as plain source.
- **Packaged binary:** Electron fuses disable `RunAsNode`, `NODE_OPTIONS` and `--inspect`, and enforce loading only the integrity-checked app archive.
- **Local images:** image references are resolved in the main process and only read if they stay inside the document's folder or the opened workspace (symlink and `..` escapes are rejected), up to 25 MB, the same cap as pasted images. UNC / network paths are refused so a document cannot trigger an SMB connection.
- **Writes:** saves go through an atomic temp-file-and-rename and refuse file types that run when opened on Windows, macOS or Linux (`.exe`, `.bat`, `.ps1`, `.command`, `.terminal`, `.webloc`, `.sh`, `.desktop`, …).
- **macOS menu:** the native menu holds only standard roles: the app menu (About, Services, Hide, Quit), Edit, View (Toggle Full Screen) and Window; it adds no reload, developer-tools or file items.
- **Network:** SimpleMD makes no network requests of its own. Remote `https:` images embedded in a document are loaded by the renderer. Spell-checking uses the system dictionaries on Windows and macOS; on Linux it is turned off, because Chromium would download its dictionaries from Google.
- **Permissions:** all Chromium permission requests (camera, microphone, location, …) are denied.

## Known limitations

- Releases are **not code-signed** with a publisher certificate: the macOS app is ad-hoc signed (so it launches on Apple Silicon) but not notarized, and the Windows installer is unsigned. Windows SmartScreen and macOS Gatekeeper will warn. Verify downloads with `SHA256SUMS.txt`, which covers every platform's files.
- Remote `https:` images in a document reveal your IP address to that image host, as in any browser.
