# Plume: project rules

Free, open-source (MIT) WYSIWYG Markdown editor. Electron + Vite + Milkdown Crepe + Mermaid.

- Run: `npm install`, then `npm start` (builds renderer, launches Electron). Dev server: `npm run dev` then `VITE_DEV_URL=http://localhost:5199 npm run app`.
- Installer: `npm run dist` (electron-builder).
- Smoke test: `PLUME_SMOKE=<out.png> npx electron .` writes a screenshot and prints console errors as `ERRORS:[...]`. `PLUME_SMOKE_JS` runs JS first. Must print `ERRORS:[]` before a release.
- Modules live in `src/modules/*.js`, each exports `init(app)`; contract in `src/app.js`. Style with the CSS variables in `DESIGN.md` only.
- If `node_modules/electron/dist` is empty after install, extract the cached zip from `%LOCALAPPDATA%\electron\Cache` there and write `path.txt` (`electron.exe`).
- No telemetry, no network calls except user-opened links. Keep it that way.
