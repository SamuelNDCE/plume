# Security

## Reporting a vulnerability

Please open a private security advisory on GitHub (Security tab, "Report a vulnerability"). Do not file public issues for vulnerabilities. You will get a reply within a few days.

## Model

Plume opens local files you choose. Its renderer is locked down:

- `contextIsolation` on, `nodeIntegration` off, `sandbox` on. The renderer reaches the disk only through a small, named set of IPC calls (`electron/preload.cjs`).
- A Content-Security-Policy blocks inline and remote scripts (`script-src 'self'`).
- Only `http:`, `https:` and `mailto:` links are ever handed to your system. Everything else is dropped.
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
