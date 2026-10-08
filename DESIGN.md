# Folio design

Calm, light, fast. No gradients, no heavy shadows, no JS in styling, system fonts only.

## Files
- `src/themes/themes.css`: all colour tokens per theme, plus the Crepe variable mapping.
- `src/styles.css`: layout, tabs, typography, modes, print. Uses tokens only (exceptions: print, error red).
- `src/modules/modules.css`: module UI, tokens only.

## Variable contract
`--bg` page, `--bg-2` sidebar/tabbar/statusbar/popups, `--fg` text, `--fg-muted` secondary text, `--border` hairlines, `--accent` and `--accent-fg` (text on accent), `--hover` translucent hover wash, `--code-bg` code and inset surfaces, `--shadow` popup shadow, `--radius` corner radius (6px).
Set by main.js: `--fs` (font size), `--doc-width` (column width). Derived in styles.css: `--doc-font`, `--mono-font`, `--ui-font`, `--t` (120ms).

## Themes (`html[data-theme]`)
Light: light, sepia, github. Dark: dark, nord, dracula, midnight, solarized-dark. Each block also sets `color-scheme`.
To add a theme: add one `html[data-theme="name"]` block with all 11 tokens, add it to the settings list, and to `THEME_DARK` in main.js if dark. The Crepe mapping follows automatically.

## Crepe mapping
Crepe sets its variables on `.milkdown`, so `html[data-theme] .milkdown` (higher specificity) rebinds every `--crepe-color-*` to a token: background=bg, surface=bg-2, surface-low/high=code-bg, outline=border, primary and inline-code=accent, hover=hover, selected=18% accent mix. Crepe fonts follow `--doc-font` / `--mono-font`.

## Typography
`html[data-font="sans|serif|mono"]` picks a system stack. Line-height 1.7. Headings 2 / 1.6 / 1.3 / 1.1 / 1 / .9em; h1 and h2 carry a hairline rule.

## Layout
Flex app: sidebar (inline width, 4px resizer) + main (34px tabbar, scrolling doc column, 24px statusbar). Body classes: `no-sidebar`, `mode-source`, `focus-mode` (inactive blocks at 35% opacity), `typewriter` (extra bottom padding). Motion: 120ms hover transitions only, disabled under `prefers-reduced-motion`. Print shows only the document, black on white.
