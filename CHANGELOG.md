# Changelog

## 1.1.0

A redesign and a big step up in everyday features. Reading is still the heart of it.

### Design
- New "Paper & Ink" look: one slim top bar (tabs, view switcher, reading controls) instead of
  three stacked bars, a calmer sidebar, and an "On this page" outline that follows your reading.
- Light, dark, sepia, or follow the system. Bundled fonts (Literata, Inter, JetBrains Mono,
  Atkinson Hyperlegible) so documents look the same on every computer.
- Reading controls (Aa): theme, font, text size, line height and width. Settings (Ctrl+,) adds
  accent colour, interface scale, reduce motion and the status bar.
- Welcome screen with New document, Open file, Open folder, Paste from AI and your recent
  files and folders.
- Focus mode (Ctrl+.) hides everything but the document.

### Reading
- ChatGPT and Claude style math: `\(…\)`, `\[…\]` and ` ```math ` blocks.
- GitHub alerts (`> [!NOTE]`) and Obsidian callouts, including foldable ones.
- Footnotes, front matter as a properties card, and task boxes you can tick (the file is saved).
- Find in document (Ctrl+F) with match highlights.
- Forgiving rendering: an unclosed code fence, a table without its divider row or curly quotes
  in a Mermaid diagram are repaired for display, never in the file.
- Large files render progressively instead of as plain text.
- Option to block remote images, with a one-click "Load images".

### Made for AI work
- Paste from AI (Ctrl+Shift+V): the clipboard becomes a new rendered document.
- What changed: when an agent edits an open file, the edits are highlighted, counted, and you can
  step through them (Alt+N).
- Follow the end of a file while an agent writes it.
- New files get a dot; agent instruction files (AGENTS.md, CLAUDE.md, …) get their own group.

### Editing and files
- New document (Ctrl+N), Save As, rename (F2), duplicate, new file and new folder.
- Formatting bar and shortcuts in Edit and Split, smart paste (web pages, Word, Excel tables),
  pasted or dropped images saved to an `assets` folder next to the document.
- Synced scrolling between editor and preview.
- Command palette (Ctrl+K) and Quick Open (Ctrl+P).
- Unsaved edits survive a crash and are offered back on the next launch.
- Closing a tab with unsaved edits now asks first; Ctrl+Shift+T reopens a closed tab.

### Export
- Export a single self-contained HTML file, print, or copy as rich text for Docs, Word and email,
  next to PDF (now Ctrl+Shift+E; Ctrl+P is Quick Open).

### Platforms, speed and safety
- macOS and Linux support in the app (native macOS menu and window buttons, `open-file`, Linux
  icon and file watching) and in the release workflow (dmg/zip, AppImage/deb/rpm).
- Smaller and faster: minified renderer (startup code 1.07 MB → 0.49 MB) and leaner packaging
  (unpacked Windows app about 600 MB → 345 MB).
- Every new file operation is checked in the main process: the window can still only touch
  what you opened. See SECURITY.md.
- Over 960 unit tests and an end-to-end suite that drives the real app, including automated
  WCAG 2.2 AA accessibility checks.

## 1.0.3

Faster loading and switching, the original icon restored, and "Open with" fixes on Windows.
