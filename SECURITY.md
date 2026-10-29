# Security

## Reporting a vulnerability

Please open a private security advisory on GitHub (Security tab, "Report a vulnerability"). Do not file public issues for vulnerabilities. You will get a reply within a few days.

## Model

Plume opens local files you choose. Its renderer is locked down:

- `contextIsolation` on, `nodeIntegration` off, `sandbox` on. The renderer reaches the disk only through a small, named set of IPC calls (`electron/preload.cjs`).
- A Content-Security-Policy blocks inline and remote scripts (`script-src 'self'`).
  > Correction 2026-10-29: the policy is also sent as a `Content-Security-Policy` response header (set in `electron/main.cjs`), not only as the meta tag in `index.html`, so it is enforced and not just declared. The script rule is now `script-src 'self' plume-plugin:` (the second source serves enabled plugins).
- Only `http:`, `https:` and `mailto:` links are ever handed to your system. Everything else is dropped. One exception: on Windows, the "Open Windows settings" buttons call a fixed handler that opens `ms-settings:defaultapps?registeredAppUser=Plume` (Plume's page in Windows Default apps). It accepts no input from the page, so a document or plugin cannot choose what it opens.
  > Correction 2026-10-29: this said `ms-settings:defaultapps` before; the fixed `?registeredAppUser=Plume` query was added. It is still constant.
- **File grants.** The main process only reads or writes a file the user granted: chosen in an open or save dialog, dropped on the window (the renderer passes File objects, main turns them into paths), or passed on launch or by the OS. Opening a folder grants that folder and everything inside it. Folder tree and folder search need a granted folder; a single granted file is not enough. A path is resolved with symlinks followed before it is judged, and a dangling link is refused. The app's own `userData` folder and dotfiles or dot-folders under the home folder (`.ssh`, `.aws`, `.gnupg`, `.env` and so on) are refused even if a dialog or drop names them and even inside a granted folder. A granted file also allows writing pasted images to `assets/` beside it, nothing else in that folder. Grants are saved in `grants.json` in `userData`, capped at 500 files and 50 folders (oldest dropped first).
- **Navigation.** The window may only load the app's own `dist/index.html`. In development the dev server's exact origin is also allowed. Any other navigation is blocked, and only `http:`, `https:` and `mailto:` URLs are passed to the system. New windows are always denied.
- **Excel save path.** Saving an edited `.xlsx` goes through the IPC call `file:write-bytes` in `electron/main.cjs`. It runs the same grant check as `file:write` (the path must be granted), requires non-empty bytes, writes a temp file and renames it over the target. Nothing new is reachable without a grant.
- **QA environment variables** (`PLUME_SMOKE`, `PLUME_STEPS`, `PLUME_USER_DATA`, `PLUME_SEARCH_LOG`) are ignored in packaged builds.
- **Word files.** The Word viewer converts with mammoth, then sanitises every chunk with DOMPurify using a strict allow list (`src/modules/docxview.js`): no scripts, styles, forms, frames, objects, SVG or MathML, no `style`, `class`, `srcset` or event attributes, and link and image addresses limited to `http:`, `https:`, `mailto:` and `#`.
- **MCP server.** The optional server in `tools/plume-mcp` is local stdio only. It reads, and only with `--allow-write` writes, Markdown and text files inside the one folder given on the command line. It makes no network calls.
- Plugins are disabled by default, run only after the user enables them, and are served only from the user's own plugins folder over a path-checked custom protocol. They are not sandboxed from the app window: see `docs/PLUGINS.md`.
- No telemetry, no analytics, no accounts. The only network request Plume makes is an optional update check against this repository's GitHub Releases at startup (Settings, Files, Updates turns it off). Updates are downloaded over HTTPS from GitHub and checked against the SHA-512 in the release feed. A document that references a remote `https` image will load that image, as any viewer would.

## Verifying a download

Every release attaches `SHA256SUMS.txt` and a signed build-provenance attestation produced by the GitHub Actions workflow in `.github/workflows/release.yml`.

```bash
sha256sum -c SHA256SUMS.txt
```

```bash
gh attestation verify Plume-<version>-win-x64-setup.exe --repo SamuelNDCE/plume
```

## Code signing status

Release binaries (and the in-app updater) are **not yet signed with a Windows (Authenticode) or Apple certificate**. Until they are, Windows SmartScreen and macOS Gatekeeper will warn on first run. The checksum and provenance attestation above are how you verify the build came from this repository's CI. If you prefer, build from source: `npm ci && npm run dist`.
