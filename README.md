# Plume

**A free, open-source, fast viewer and editor for Markdown and plain text.**

Open a file and read it beautifully, or edit it as rich text without ever seeing the syntax. Plume is built for `.md` first, and handles text, JSON, CSV and images too. No account, no telemetry, no subscription, no cloud.

## Why Plume

- **Light and quick.** Opens a file straight away. Diagrams and heavy renderers load only when a document needs them.
- **Open as many documents as you like.** Click files in the library on the left; they stay open side by side in a list, no tab bar.
- **Rich or source, one keystroke.** `Ctrl+/` flips between the rendered document and the raw text.
- **Reads more than Markdown.** Plain text, JSON, YAML, XML, HTML, code (syntax highlighted), CSV/TSV (sortable, filterable table) and images (zoom, pan).
- **Yours.** MIT licensed. Your files stay on your machine.

## Features

**Markdown**
- Live WYSIWYG editing (Milkdown / ProseMirror) with a slash menu (`/`) and a selection toolbar
- Tables, task lists, footnotes, fenced code with highlighting, KaTeX math
- Mermaid diagrams (flowcharts, sequence, gantt and more), loaded on demand
- Built-in `chart` blocks: bar, line, area and pie, from a few lines of JSON
- Paste or drop images; they are saved to an `assets/` folder beside the file

**Everything else**
- Source editor (CodeMirror 6) with language detection, line numbers, word wrap
- CSV/TSV table viewer with sort, filter and large-file windowing
- Image viewer with wheel zoom, drag to pan, fit / 100%

**Working with files**
- Library sidebar: open documents, folder tree, recent files, filter
- Right-click a file to create, rename, move to trash or reveal in Explorer
- Search across a whole folder (plain or regex)
- Document outline with click to jump
- Autosave, session restore, and reload when a file changes on disk
- Drag and drop files onto the window

**Writing**
- Find and replace (case, whole word, regex) in both rich and source views
- Focus mode (`F8`), typewriter mode (`F9`), zen mode, reading mode
- Presentation mode (`F5`): split a document on `---` into slides
- Command palette (`Ctrl+P`) with fuzzy search, "go to file" and `@` heading jump
- 8 themes: Light, Dark, Sepia, Nord, Dracula, Midnight, Solarized Dark, GitHub
- Settings (`Ctrl+,`): theme, font family and size, line height, content width, spellcheck and more

**Export**
- HTML (self-contained), PDF, print, copy as Markdown or HTML

### Chart blocks

````markdown
```chart
{"type":"bar","title":"Sales","labels":["Q1","Q2","Q3"],"datasets":[{"label":"2026","data":[12,19,7]}]}
```
````

## Install

Download the latest build for your system from the [Releases page](https://github.com/SamuelNDCE/plume/releases).

| System | File |
| --- | --- |
| Windows | `Plume-<version>-win-x64.exe` (installer) or the portable `.exe` |
| macOS | `Plume-<version>-mac-*.dmg` |
| Linux | `Plume-<version>-linux-x64.AppImage` or `.deb` |

> **Heads-up: the builds are not code-signed yet.** Windows SmartScreen and macOS Gatekeeper will warn the first time you run Plume. See [Is it safe?](#is-it-safe) for how to verify a download, or build it yourself below.

### Build from source

Needs [Node.js](https://nodejs.org) 20 or newer.

```bash
git clone https://github.com/SamuelNDCE/plume.git
cd plume
npm install
npm start
```

Make an installer for your OS:

```bash
npm run dist
```

Output lands in `release/`.

## Is it safe?

Plume is small and does little by design.

- **No telemetry, no accounts, no auto-update.** Plume itself makes no network requests. (A document that links a remote `https` image will load it, like any viewer.)
- **Locked-down window.** Context isolation and the renderer sandbox are on, Node integration is off, and a Content-Security-Policy blocks inline and remote scripts. The renderer reaches your disk only through a small named set of calls in [`electron/preload.cjs`](electron/preload.cjs).
- **Links.** Only `http`, `https` and `mailto` links are ever handed to your system.
- **Open source.** Read it, build it, change it.

**Verify a download.** Each release ships `SHA256SUMS.txt` and a signed build-provenance attestation made by the public GitHub Actions workflow, proving the file was built from this repository:

```bash
sha256sum -c SHA256SUMS.txt
```

```bash
gh attestation verify Plume-<version>-win-x64.exe --repo SamuelNDCE/plume
```

**Code signing.** Binaries are not yet signed with a Windows (Authenticode) or Apple certificate, which is why the OS warns. Signing is on the roadmap; until then use the checksum and attestation above, or build from source. Report vulnerabilities privately: see [SECURITY.md](SECURITY.md).

## Keyboard shortcuts

| | |
| --- | --- |
| `Ctrl+O` / `Ctrl+Shift+O` | Open files / folder |
| `Ctrl+N` | New document |
| `Ctrl+S` / `Ctrl+Shift+S` | Save / Save as |
| `Ctrl+W` | Close document |
| `Ctrl+/` | Rich / source view |
| `Ctrl+P` | Command palette |
| `Ctrl+F` / `Ctrl+H` | Find / replace |
| `Ctrl+Shift+F` | Search folder |
| `Ctrl+,` | Settings |
| `F5` | Presentation |
| `F8` / `F9` | Focus / typewriter mode |
| `Ctrl+=` `Ctrl+-` `Ctrl+0` | Font size |

The full, always-accurate list is in Settings, under Shortcuts.

## Built with

[Electron](https://www.electronjs.org), [Milkdown](https://milkdown.dev) (ProseMirror), [CodeMirror 6](https://codemirror.net), [Mermaid](https://mermaid.js.org), [KaTeX](https://katex.org), [Vite](https://vite.dev).

## Contributing

Issues and pull requests are welcome. Run `npm run dev` for the renderer and see `PROJECT.md` and `DESIGN.md` for how the code and the design tokens are organised.

## License

[MIT](LICENSE)
