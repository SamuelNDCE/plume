# Plume plugins

Plugins add commands, UI bits, custom Markdown block renderers and themes to Plume.

## Security model (read this first)

**Plugins are ordinary JavaScript that runs inside the app window. This is NOT a sandbox.**
A plugin can read and change every open document, read what you type, call the app API and
make network requests the page is allowed to make. Only enable plugins you trust, and read
the code of anything you download.

What Plume does to limit the damage:

- All plugins are **disabled by default**. You must enable each one, and the first enable asks for consent.
- Plugin files are served only from the plugin's own folder, only while it is enabled, only for
  `.js .mjs .json .css .svg .png .jpg .webp .woff2`, max 2 MB, and never outside the folder (path traversal and symlinks out are refused).
- Plugins get no file system API (`api.fs` does not exist). The page's Content Security Policy still applies.
- A plugin that throws is isolated and reported with a toast; it cannot crash the app.

These are guard rails, not isolation. Treat enabling a plugin like installing a program.

## Quick start

1. Run the command **Open plugins folder** (category Plugins). It opens `<userData>/plugins`.
2. Create a folder whose name is your plugin id (`a-z`, `0-9`, `-`), for example `hello`.
3. Add `hello/plugin.json`:

```json
{ "id": "hello", "name": "Hello", "version": "1.0.0", "description": "Says hello.", "author": "You", "main": "index.js" }
```

4. Add `hello/index.js`:

```js
export function activate(api) {
  api.commands.register({
    id: 'say',
    title: 'Say hello',
    run: () => api.ui.toast('Hello from a plugin'),
  })
}
```

5. Enable the plugin in Settings (or `window.folio.setPluginEnabled('hello', true)` from devtools), then restart Plume.
6. Open the command palette and run **Say hello**.

`export default function (api) {}` also works. If you export `deactivate()`, it is called on unload.

## Manifest reference (`plugin.json`)

| Field | Required | Notes |
|---|---|---|
| `id` | yes | `a-z`, `0-9`, `-`. Must equal the folder name. |
| `name` | no | Display name. |
| `version` | yes | Your plugin version. |
| `description`, `author` | no | Shown in the plugin list. |
| `main` | no | Entry file inside the folder, default `index.js`. Relative, no `..`, must be `.js` or `.mjs`. |
| `minPlumeVersion` | no | Plugin API version needed (current: `0.1.0`). |
| `permissions` | no | Free-form list of what the plugin does (for example `editor:write`). Informational only, not enforced. |

Invalid plugins are listed with `valid: false` and an error message and are never loaded.

## API reference

The object passed to `activate(api)`:

| Member | Description |
|---|---|
| `api.version`, `api.id` | API version string and your plugin id. |
| `api.commands.register({id, title, category, keys, run})` | Adds a palette command. The id is prefixed `plugin.<id>.`. |
| `api.on(evt, fn)` | Subscribe to an app event, returns an unsubscribe function. Events: `doc:change` (markdown), `tab:switch`, `tab:list`, `file:saved`, `settings:change`, `mode:change`, `folder:change`, `editor:ready`, `empty:show`. |
| `api.editor.getMarkdown()` / `setMarkdown(md)` | Read or replace the whole document. |
| `api.editor.insertText(t)` | Insert at the cursor (rich: `execCommand('insertText')`, source: code editor insert). |
| `api.editor.getSelection()` | Selected text as a string. |
| `api.editor.activeDoc()` | Copy of `{name, path, kind, dirty}` or `null`. |
| `api.themes.register(def)` / `apply(id)` | Register or switch themes. Schema: `docs/THEMES.md`. |
| `api.blocks.register(lang, renderFn)` | Custom fenced block renderer. `renderFn(code, ctx)` returns an HTMLElement, an SVG string, or a Promise of either. |
| `api.ui.toast(msg)` | Short message. |
| `api.ui.addStatusItem({id, render(el), onUpdate?})` | Adds a span to the status bar; returns `{update(), remove()}`. |
| `api.ui.addHeaderButton({id, title, icon, run})` | Button in the header. `icon` is an inline SVG string; scripts, `on*` attributes and external hrefs are stripped. |
| `api.ui.addStyles(css)` | Adds a `<style>` tag, removed on unload. |
| `api.storage.get(k)` / `set(k, v)` | JSON values in localStorage, namespaced per plugin. |

Everything registered through `api` is tracked and removed when the plugin unloads. Disabling a plugin takes full
effect after a restart (`app.plugins.reload()` just tells the user so).

## Tutorial: a block renderer

Authors write:

````markdown
```stars
5
```
````

Plugin:

```js
export function activate(api) {
  api.blocks.register('stars', (code) => {
    const n = Math.max(0, Math.min(10, parseInt(code, 10) || 0))
    const el = document.createElement('div')
    el.textContent = '★'.repeat(n) + '☆'.repeat(5 - Math.min(n, 5))
    return el
  })
}
```

Return an SVG string for diagrams (see `examples/plugins/timeline-block`). Escape any text from the block before putting it in markup.

## Tutorial: a theme from a plugin

```js
export function activate(api) {
  api.themes.register({
    id: 'my-plugin-theme',
    name: 'My Plugin Theme',
    dark: true,
    vars: { '--bg': '#101418', '--fg': '#d7dde5', '--accent': '#7cc4ff' },
  })
  api.commands.register({ id: 'use-theme', title: 'Use my theme', run: () => api.themes.apply('my-plugin-theme') })
}
```

The exact definition schema and value limits are in `docs/THEMES.md`.

## Debugging

Press **F12** (or run the devtools command) to open devtools. Errors are logged as `[plugin <id>]`, and a toast
says `Plugin <id> failed: ...`. After editing a plugin, restart Plume. Check that the folder name equals the `id`
and that the plugin shows `valid: true` in `await window.folio.listPlugins()`.

## Examples

`examples/plugins/` contains `word-goal` (status bar item and commands), `timeline-block` (an SVG block renderer)
and `insert-snippets` (editor commands). Copy a folder into your plugins folder to try it.

## Publishing ideas

Put your plugin folder in its own git repository (the repo root is the plugin folder) and tag releases.
Users clone or download it into their plugins folder. A community index, a topic tag such as `plume-plugin`
on GitHub, and a zip release per version are all easy ways to share. Always tell users what the plugin accesses.
