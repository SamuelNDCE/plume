# Changelog

All notable changes to Plume are written here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

Nothing yet.

## [0.5.4] - 2026-10-30

### Changed

- Electron 44.10 to 45.1.0. Plume does not use the Node globals that Electron 45 removed from sandboxed preload scripts.
- Dependencies: CodeMirror view and autocomplete, Milkdown Crepe 7.23, Mermaid 12.2, Vite 8.3.5, electron-updater 6.8.11, electron-builder 26.18, and the GitHub Actions upload and download artifact steps.

### Fixed

- Typewriter mode: it no longer loops on every selection change, which stopped drag selection, the title and size bar and the wheel. The cursor line is centred after keyboard moves only.
- Selection bar and scrolling in the rich view: a drag selection no longer leaves the editor scroller locked; the title and size bar shows after selecting.
- The status bar shows the file size of unsaved documents; the line-ending chip and the read timer were removed.
- Menu: Save and Save As at the top, Go to line and Search in folder at the top level, the Custom group removed.
- Drop-downs line up with the selection bar and fade out instead of vanishing.
- Rich and source views slide when switched.

## [0.5.3] - 2026-10-30

### Added

- PDF page keys: Down, Right and PageDown go to the next page and Up, Left and PageUp to the previous one when the page list has focus. Home and End go to the first and last page.
- PDF number jump: type a number while the pages are in focus to open a small box and jump to that page. Ctrl+G focuses the page number field.
- PDF rotate: Ctrl+Shift+R or the toolbar button turns the page 90 degrees. The rotation is saved into the file when you save.
- PDF print: Ctrl+P or the toolbar button prints every page, with its rotation, through the system print dialog.
- PDF highlight, underline, sticky note and freehand ink, written into the file as standard annotations.
- PDF page edits: delete a page (it asks first), move a page up or down with Alt+Up and Alt+Down, rotate, extract the selected pages to a new PDF, and merge another PDF onto the end. Undo and redo cover every edit.
- PDF form fields: text, checkbox, radio and drop-down fields can be filled in and saved.
- PDF cover and retype: drag a white box over text and type the replacement. This does not edit the original text. The original text stays in the file under the white box.
- Selection bar: a one-row bar under selected text with block styles (Paragraph, Title, Heading 2 to 6, Quote, Code block), Bold, Italic, Underline, Strikethrough, Code, and a text size drop-down.
- CSV grid: find and replace (Ctrl+H) over the selection or the whole sheet, with match case and whole cell options. A replace is one undo step.
- CHANGELOG.md, in Keep a Changelog format, with an entry for each release.

### Changed

- Right-click menu: the selection bar sits on top and expands into the menu. The menu rows are grouped as Clipboard, Link, Quote and lists, Find, then a More group. Nothing the bar already shows is repeated.
- Save As for a PDF, and the Merge file picker, list PDF as the first file type.
- README, the welcome document and the screenshots were rewritten for 0.5.3.

### Security

- File access: the grant rule still applies. The main process only reads or writes files you granted (dialog, drop or launch), and PDF saves go through the same grant-checked call as every other binary save.
- Atomic saves: PDF saves write a temp file and rename it over the target, the same as Excel saves.
- Folder search results are filtered by the same grant rule as file access (added in 0.5.1, still in force).
- Print size cap: a PDF page with a huge page size lowers the print scale instead of allocating a huge canvas.
- Underline refusal: Underline is refused when the selected text contains < or >, because Markdown stores underline as an HTML tag.

## [0.5.2] - 2026-10-29

### Fixed

- Windows: Open with, Choose another app now lists Plume, and Settings search and Default apps show the short name Plume. The app description is now just Plume.

## [0.5.1] - 2026-10-29

### Fixed

- Binary saves (used by Excel) now use the same atomic writer as text saves, so a fixed temp name can no longer be redirected by a symlink.

### Security

- Folder search hits are filtered by the same grant rule as file access, so results can no longer come from Plume's own data folder or from dotfile folders under the home folder.
- Binary saves write atomically.

## [0.5.0] - 2026-10-29

### Added

- PDF viewer (pdf.js) with a page list, fit page, find and keyboard shortcuts.
- Word (.docx) viewer, read only. The document is sanitised with DOMPurify.
- Excel (.xlsx) viewer with cell editing and saving back to .xlsx. Limits: Save As is not yet tested, edits are lost if the app restarts before you save, and edits and paste stay inside the existing data range.
- Left bar with open files, folders, search and recent files, and a menu button.
- Log view with entries, level filters, follow mode and folding.
- Default-app registration on Windows and a Default apps list in Settings.
- Settings: every setting has a control.

### Changed

- Saves are atomic, and a save is refused when the file changed on disk.
- File access is limited to files you opened or dropped in, plus the folders you opened.
- Accessibility fixes from an axe-core scan.

### Fixed

- A reference error in update checks.

### Security

- File grants: the main process only touches files granted by a dialog, a drop or the launch argument, plus granted folders.
- Dependency alerts fixed: dompurify, fast-uri and undici.

## [0.4.0] - 2026-10-09

### Added

- Notepad-style text handling: UTF-8, UTF-8 with BOM, UTF-16 and ANSI files open correctly, and encoding and line endings are kept when you save. Ln and Col in the status bar, Go to line, insert date and time, and a zoom chip.
- Reopen a file with another encoding.
- An update screen with a progress bar, and Updates in Settings, About.
- One-click per-user Windows installer.
- Print and PDF export of a whole text file, spellcheck, and presentation split by heading.
- Large text files: files above 128 MiB open as a read-only preview of the first 5 MB and cannot be saved.
- CI that builds and runs the unit tests on pull requests.

### Changed

- Electron 33 to 44, electron-builder 25 to 26, Vite 6 to 8 and Mermaid 11 to 12. Node 20.19 or newer is now required.
- Plain-text statistics skip Markdown stripping.
- README has a first-run note, because builds are not code-signed.

### Fixed

- Ctrl+Shift+Z redo in the source editor.
- A doubled unsaved dot in the file list.

### Security

- Patched KaTeX is pinned, and Dependabot is configured for npm and GitHub Actions.
