# Contributing to Plume

Plume is free and open source (MIT), and help is welcome: bug reports, fixes, themes, plugins, docs, translations of ideas into issues. You do not need to ask first.

## Quick start

```bash
git clone https://github.com/SamuelNDCE/plume.git
cd plume
npm install
npm start
```

`npm run dev` runs the Vite dev server; then `VITE_DEV_URL=http://localhost:5199 npm run app` opens Electron against it.

Before sending a pull request, run the smoke test and make sure it prints `ERRORS:[]`:

```bash
PLUME_SMOKE=smoke.png npx electron .
```

(On PowerShell: `$env:PLUME_SMOKE='smoke.png'; npx electron .`)

## Where things live

| Path | What |
| --- | --- |
| `electron/` | Main process and the preload bridge (the only door from the UI to the disk) |
| `src/main.js` | App core: documents, views, boot |
| `src/modules/*.js` | Features. Each exports `init(app)`; the contract is documented at the top of `src/app.js` |
| `src/themes/` | Theme registry and the built-in themes |
| `src/plugins.js`, `docs/PLUGINS.md` | The plugin system and its API |
| `docs/THEMES.md` | How to write a theme |
| `DESIGN.md` | Design tokens and rules. Style with the CSS variables only |

## Easiest ways to help

- **Make a theme.** A theme is one JSON file. See `docs/THEMES.md`; share it by opening a pull request that adds it to `examples/themes/`.
- **Make a plugin.** See `docs/PLUGINS.md`. Share it by adding it to `examples/plugins/` or publishing your own repo and opening an issue to get it listed.
- **Report a bug** with the bug template. A short recording or the exact file that misbehaves helps most.
- **Pick up an issue** labelled `good first issue` or `help wanted`. Comment first so two people do not do the same thing.

## Pull requests

- Keep each pull request focused on one thing.
- Match the surrounding code: plain JavaScript modules, no framework, no new runtime dependency unless it earns its weight (Plume must stay light and start fast; anything heavy must load lazily).
- Use theme CSS variables, never hard-coded colours.
- Do not add network calls, telemetry or analytics. Plume makes none and that is a feature.
- Update the docs and `DESIGN.md` in the same pull request when behaviour or tokens change.
- Explain what you changed and how you checked it.

## Security

Please report vulnerabilities privately, see [SECURITY.md](SECURITY.md).

## Conduct

Be kind and assume good faith. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
