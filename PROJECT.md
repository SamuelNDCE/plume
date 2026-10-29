# Plume: project rules

Free, open-source (MIT) Markdown editor and viewer. Electron + Vite, vanilla JS. Milkdown (rich), CodeMirror 6 (source), Mermaid (lazy). Current version in `package.json` (0.4.0 at 2026-10-09).

## Run and build
- `npm install`, then `npm start` (builds the renderer, launches Electron). Dev: `npm run dev`, then `VITE_DEV_URL=http://localhost:5199 npm run app`.
- Installers: `npm run dist` (electron-builder, output in `release/`).
- If `node_modules/electron/dist` is empty after install, extract the cached zip from `%LOCALAPPDATA%\electron\Cache` into it and write `path.txt` containing `electron.exe`.

## Verify before claiming anything works
- Spreadsheet logic: `node --test test/sheet-core.test.mjs` (use the file path; the directory form fails on Node 24).
- Text file handling (encoding, line endings): `node --test test/textio.test.mjs`.
- Source-view shortcuts: build, then `npx electron tests/source-redo.cjs`.
- Real-app QA hook in `electron/main.cjs`: `PLUME_SMOKE=<png>` (screenshot, prints `ERRORS:[...]`, must be `[]`), or `PLUME_STEPS=<json>` with `PLUME_SHOT_DIR` to type keys, move the mouse, click, run JS and take screenshots (`window.__plume` is the app object). Stop stray Electron windows and clear `%APPDATA%\plume\Local Storage` first, or runs share state with a leftover window.
- UI work is not done until it has been run in the real app and screenshotted. Build unminified (`vite build --minify false`) to read a minified startup error.

## Release process (GitHub Actions, on a version tag)
1. Bump `version` in `package.json`, run the checks above, commit, push to `main`.
2. `git tag vX.Y.Z` and push the tag. `.github/workflows/release.yml` builds Windows, macOS and Linux, writes `SHA256SUMS.txt`, attests provenance, and creates the release with the `latest*.yml` update feeds.
3. After the run: download `latest.yml` and the Windows setup exe and confirm the sha512 and size match (the in-app updater depends on it). Installer names: `Plume-<version>-win-x64-setup.exe`, `...-win-x64-portable.exe`, `...-mac-arm64.dmg`, `...-linux-x86_64.AppImage`, `...-linux-amd64.deb`.
4. v0.1.0 builds have no updater. 0.2.0 is the first that can update itself.
5. Signing is wired for Azure Artifact Signing and runs only when the `AZURE_*` secrets and variables exist. See `docs/CODE-SIGNING.md`. Not set up yet.
   > Update 2026-10-09: signing is postponed. Azure is dropped (paid); the plan is to apply to SignPath Foundation (free, Windows only) once the project has traction. macOS stays unsigned. README has a first-run note.

## Rules
- Modules live in `src/modules/*.js`, each exports `init(app)`; the contract is the header of `src/app.js`. Style with the CSS variables in `DESIGN.md` only, no hard-coded colours. Heavy or rare features load lazily after first paint.
- No telemetry. The only network request is the optional update check to GitHub (setting `checkUpdates`, default on). Do not add others without updating README, SECURITY.md and this file.
- Plugins are off by default and are not sandboxed; keep that stated everywhere it is described.
- Only `http`, `https` and `mailto` links may be opened outside the app. One exception: the IPC handler `app:open-default-apps` (Windows only) opens the fixed page `ms-settings:defaultapps?registeredAppUser=Plume`. It takes no argument, so the renderer cannot pass a URL.
  > Correction 2026-10-29: the URI was `ms-settings:defaultapps` until now. It gained the fixed `?registeredAppUser=Plume` query so Settings opens Plume's own page. Still constant, no renderer input.
- File access: the main process (`electron/grants.cjs`) only reads or writes files the user granted through an open or save dialog, a drop, or the launch argument, plus folders they opened and anything inside them. Everything else is refused, including `userData` and dotfiles under the home folder.
- QA hooks (`PLUME_SMOKE`, `PLUME_STEPS`, `PLUME_USER_DATA`, `PLUME_SEARCH_LOG`) are disabled in packaged builds (`QA = !app.isPackaged` in `electron/main.cjs`).
- The optional MCP server in `tools/plume-mcp` is local stdio only, reads (and with `--allow-write` writes) files inside the folder given on the command line, and makes no network calls.
- Never delete a wrong statement in a doc or issue: mark it with an asterisk and add a dated correction.
- Folder search runs in a worker thread (`electron/searchworker.cjs`), streams batches over IPC (`folder:search-start`, `folder:search-batch`, `folder:search-cancel`), caps at 200 hits and 2 MB per file, skips dot-entries, node_modules, symlinks and binaries. Regex mode only runs inside that worker, which is killed on cancel or after 20 s. Never run a renderer-supplied RegExp on the main thread.
- Contributors: review a PR by running its test on the fixed and the unfixed code before merging.

## Deferred on purpose
PDF (#8), Word (#9) and Excel (#10) support. Signing is parked (#1).
  > Correction 2026-10-29: PDF, Word and Excel are no longer deferred. Built, checked against the code: PDF viewer (`src/modules/pdfview.js`, read only, pdf.js loaded on first use); Word viewer (`src/modules/docxview.js`, read only, mammoth then DOMPurify); Excel viewer (`src/modules/xlsxview.js`). The Excel viewer is read only in its own code: it parses `.xlsx` in a worker and has sheet tabs, a cell value line and find, and no cell editing. `src/main.js` has a save path for `.xlsx` that calls `saveXlsx` and `commitXlsx` from `xlsxview.js`, but that module exports only `mount`, so editing and saving to `.xlsx` is NOT built yet. Legacy `.xls` and `.ods` are not supported.
  > Correction 2026-10-29 (later): the Excel gap above is closed. `xlsxview.js` now exports `saveXlsx` and `commitXlsx`, so the Excel viewer edits cells (typing, F2, Enter, Tab, Escape, Delete, Ctrl+Z, Ctrl+Y, Ctrl+X, Ctrl+V) and saves back to `.xlsx` with Ctrl+S through `file:write-bytes`. Limits: Save As is not yet tested, edits are lost if the app restarts before you save, edits and paste stay inside the existing data range, and for a file with a calc chain the chain is removed on save (`xlsxworker.js`).
  Done 2026-10-09: update controls in Settings, About and the in-app update screen (#12, #13), one-click per-user Windows installer, Notepad-style text handling (encoding and line endings preserved, Go to line, date and time).
