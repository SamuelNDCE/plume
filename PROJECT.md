# Plume: project rules

Free, open-source (MIT) Markdown editor and viewer. Electron + Vite, vanilla JS. Milkdown (rich), CodeMirror 6 (source), Mermaid (lazy). Current version in `package.json` (0.3.0 at 2026-10-08).

## Run and build
- `npm install`, then `npm start` (builds the renderer, launches Electron). Dev: `npm run dev`, then `VITE_DEV_URL=http://localhost:5199 npm run app`.
- Installers: `npm run dist` (electron-builder, output in `release/`).
- If `node_modules/electron/dist` is empty after install, extract the cached zip from `%LOCALAPPDATA%\electron\Cache` into it and write `path.txt` containing `electron.exe`.

## Verify before claiming anything works
- Spreadsheet logic: `node --test test/sheet-core.test.mjs` (use the file path; the directory form fails on Node 24).
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
- Only `http`, `https` and `mailto` links may be opened outside the app.
- Never delete a wrong statement in a doc or issue: mark it with an asterisk and add a dated correction.
- Contributors: review a PR by running its test on the fixed and the unfixed code before merging.

## Deferred on purpose
PDF (#8), Word (#9) and Excel (#10) support, a Settings Updates section (#12), and a one-click installer with an in-app updating screen (#13). Signing is parked (#1).
