# Lumenmark

A free, open-source, light and fast WYSIWYG Markdown editor and viewer. Type Markdown, see it rendered as you write. No account, no telemetry, no subscription.

Built on Electron, [Milkdown](https://milkdown.dev) (ProseMirror) and Mermaid.

## Features

- Live WYSIWYG editing with a one-keystroke raw source mode (`Ctrl+/`)
- Tabs, folder sidebar, document outline, session restore, autosave
- Tables, task lists, footnotes, code blocks with syntax highlighting, KaTeX math
- Mermaid diagrams (lazy loaded) and built-in `chart` blocks (bar, line, area, pie)
- Find and replace with case, whole-word and regex options
- Command palette (`Ctrl+P`), heading jump (`@`)
- Focus mode (`F8`), typewriter mode (`F9`), reading mode, zen mode, presentation mode (`F5`)
- 8 themes: light, dark, sepia, nord, dracula, midnight, solarized-dark, github
- Export to HTML and PDF, copy as Markdown or HTML
- Paste or drop images (saved to an `assets/` folder beside the file)

### Chart blocks

````markdown
```chart
{"type":"bar","title":"Sales","labels":["Q1","Q2","Q3"],"datasets":[{"label":"2026","data":[12,19,7]}]}
```
````

## Run it

```bash
npm install
npm start
```

`npm run dist` builds an installer with electron-builder.

## License

MIT
