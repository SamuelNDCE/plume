# Plume themes

A theme controls the whole look of a document: colours, typography, headings, code and how charts and diagrams are drawn.

## Where themes live

Run **Open themes folder** from the command palette (`theme.openFolder`). Drop files there, then run **Reload custom themes**.

- `*.json`: a theme definition (below). Safe, sandboxed to CSS variables.
- `*.css`: plain CSS injected as-is (power users). Start the file with `/* plume-theme: my-id | My Name | dark */` to list it in the gallery, and target `html[data-theme="my-id"]`.

Limits: 1 MB per file, 100 files. Bad files are skipped with a console warning.

## JSON schema

```json
{
  "id": "sunset",
  "name": "Sunset",
  "dark": false,
  "vars": { "--bg": "#fff7f0", "--fg": "#3a2a24", "--accent": "#d9531e" },
  "typography": { "body": "Georgia, serif", "headingScale": 1.1, "width": 740 },
  "chart": { "colors": ["#d9531e", "#2b6f8f"], "style": "smooth" },
  "mermaid": { "themeVariables": { "primaryColor": "#fde0c9" } }
}
```

`id` must match `a-z0-9-` (max 40) and must not clash with a built-in. Themes appear in group **Custom**.

### vars

Any CSS custom property starting with `--`. Values may not contain `;` `{` `}` `<`, `url(` or `@import`. Core set (set all of them; unset ones fall back to the light theme, so a dark theme must set the lot):

`--bg` canvas, `--bg-2` sidebar/status bar, `--bg-3` raised surfaces, `--fg`, `--fg-muted`, `--border` (use an alpha colour), `--accent`, `--accent-fg` (text on accent), `--hover`, `--code-bg`, `--shadow`, `--shadow-lg`, `--ring`. `--shadow`, `--shadow-lg` and `--ring` get sensible defaults.

### typography (all optional)

| key | becomes | notes |
|---|---|---|
| body, heading, mono | `--font-body`, `--font-heading`, `--font-mono` | font-family stacks, system fonts only |
| headingWeight | `--h-weight` | 400-900 |
| headingScale | `--h-scale` | multiplier, about 0.9-1.3 |
| lineHeight | `--lh` | unitless |
| paragraphSpacing | `--p-space` | em, space above and below paragraphs |
| width | `--doc-width` | px; the Settings "max width" value wins when set |

### chart (all optional)

`colors` array of 8 hex values (categorical, colour-blind considerate; missing ones use a default palette), `gridOpacity` 0-1, `radius` px for bar corners, `strokeWidth` for lines, `style` `"smooth"` (curves, round bars) or `"sharp"` (straight lines, square bars), `font` font-family. They become `--chart-1..8`, `--chart-grid`, `--chart-radius`, `--chart-stroke`, `--chart-font`, `--chart-style`.

### mermaid

`themeVariables` is merged over the variables Plume derives from your colours (see mermaid's `themeVariables` docs). Mermaid always uses its `base` theme.

## User overrides

Settings override themes: `fontBody`, `fontHeading`, `fontMono`, `headingScale`, `paraSpacing`, `accent`, `chartStyle` (empty or 0 means "use the theme"), and `customCss`, which is injected after everything else. Target `html .milkdown .ProseMirror h2` etc.

## The 8 built-in themes

All eight are defined in `src/themes/themes.css` (colours, typography and chart style per theme); `src/themes/registry.js` holds their gallery preview data. Your own JSON themes and plugin themes appear after them in the **Custom** and **Plugin** groups. A saved theme id that no longer exists falls back to `light`.

| id | name | mode | character |
|---|---|---|---|
| `light` | Light | light | clean modern sans, airy, indigo accent |
| `github` | GitHub | light | GitHub-markdown look, 16px sans, hairlines under h1/h2, grey code blocks |
| `newsprint` | Newsprint | light | serif newspaper, narrow column, double rule under h1, red ink, sharp charts |
| `sepia` | Sepia | light | warm book page, large serif, generous leading, brown accent |
| `dark` | Dark | dark | neutral charcoal, sans, blue accent |
| `nord` | Nord | dark | arctic blues, humanist sans, frost accent |
| `dracula` | Dracula | dark | purple/pink, monospace body and headings, sharp charts |
| `midnight` | Midnight | dark | deep navy, serif body, teal accent, rounded charts |

Typography takes effect by default: the `fontFamily` setting defaults to `theme`. The old values `serif`, `sans` and `mono` still force a family if stored. Settings > Typography has Body, Heading and Code pickers with "Theme default".

## Tips

- Keep text contrast at 4.5:1 or better against `--bg`; check `--fg-muted` too.
- Pick chart colours that differ in lightness as well as hue so they survive colour blindness; keep them readable on `--bg`.
- Prefer `dark: true` only if `--bg` is dark: it sets `color-scheme` and window chrome.
- Plugins can call `app.themes.register(def)` with the same object shape.
