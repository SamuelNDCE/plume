# Security

## Reporting a vulnerability

Please open a private security advisory on GitHub (Security tab, "Report a vulnerability"). Do not file public issues for vulnerabilities. You will get a reply within a few days.

## Model

Plume opens local files you choose. Its renderer is locked down:

- `contextIsolation` on, `nodeIntegration` off, `sandbox` on. The renderer reaches the disk only through a small, named set of IPC calls (`electron/preload.cjs`).
- A Content-Security-Policy blocks inline and remote scripts (`script-src 'self'`).
- Only `http:`, `https:` and `mailto:` links are ever handed to your system. Everything else is dropped.
- No telemetry, no analytics, no accounts, no auto-update. Plume itself makes no network requests. A document that references a remote `https` image will load that image, as any viewer would.

## Verifying a download

Every release attaches `SHA256SUMS.txt` and a signed build-provenance attestation produced by the GitHub Actions workflow in `.github/workflows/release.yml`.

```bash
sha256sum -c SHA256SUMS.txt
```

```bash
gh attestation verify Plume-<version>-win-x64.exe --repo SamuelNDCE/plume
```

## Code signing status

Release binaries are **not yet signed with a Windows (Authenticode) or Apple certificate**. Until they are, Windows SmartScreen and macOS Gatekeeper will warn on first run. The checksum and provenance attestation above are how you verify the build came from this repository's CI. If you prefer, build from source: `npm ci && npm run dist`.
