# Plume design

Calm, quiet, premium (Linear / Bear / iA Writer feel), still light and fast. No gradients, no decoration for its own sake, system fonts only, hairline alpha borders, soft shadows only on raised surfaces.

## Files
- `src/themes/themes.css`: colour tokens per theme plus the Crepe variable mapping.
- `src/styles.css`: shell layout (rail, sidebar, header, canvas, statusbar), toasts, document typography, empty state, modes, print. \*
- `src/modules/modules.css`: overlay/module UI (palette, find, settings, statusbar contents). Tokens only.
- `src/modules/header.js`: rail icons + wiring, breadcrumb, header actions; exports shared `ICONS`. \*
- `src/modules/empty.js`: empty-state view.

## Tokens
`--bg` canvas, `--bg-2` rail/sidebar/statusbar, `--bg-3` raised surfaces (popups, pills, segmented control, inputs), `--fg`, `--fg-muted`, `--border` (alpha hairline), `--accent`, `--accent-fg`, `--hover` (translucent wash), `--code-bg`, `--shadow` (small), `--shadow-lg` (popups, toasts), `--ring` (focus ring), `--radius` (8px).
Set by main.js: `--fs`, `--doc-width`, `--lh`. Derived in styles.css: `--doc-font`, `--mono-font`, `--ui-font`, `--t` (120ms), `--rail-w` (48px), `--header-h` (40px).

## Themes (`html[data-theme]`)
Exactly 8 built-ins. Light: light, github, newsprint, sepia. Dark: dark, nord, dracula, midnight. Each block in themes.css also sets its own typography (`--doc-font`, `--font-heading`, `--h-weight`, `--h-scale`, `--lh`, `--p-space`, `--doc-width`) and chart style (`--chart-1..8`, `--chart-grid/radius/stroke/font/style`). Character: Light = clean sans, indigo; GitHub = markdown look, hairline h1/h2; Newsprint = serif, narrow, red ink; Sepia = large book serif; Dark = neutral charcoal; Nord = arctic humanist sans; Dracula = monospace everything, sharp charts; Midnight = navy serif, teal, rounded charts. Hierarchy: bg-2 sits slightly darker than bg in dark themes and slightly off-white in light ones; bg-3 is the lightest/most raised surface. To add a theme: one block with all tokens above plus `color-scheme`, add it to the preview table in registry.js, the palette and the settings fallback list.

## Crepe mapping
`html[data-theme] .milkdown` rebinds every `--crepe-color-*` to a token (surface = bg-3, outline = border, primary/inline-code = accent, shadow-2 = shadow-lg).

## Layout
`#rail` 48px icon rail (36px buttons, soft active pill + 3px indicator) | `#sidebar` (40px head with small-caps title, panes, library list: `.lib-section .lib-title .doc-row(.active .dirty) .doc-name .doc-close`, tree: `.tree-row .tree-folder .tree-file`, `.icon-btn`) | `#main`: `#header` 40px translucent (breadcrumb: last 2 folders muted, strong filename, unsaved dot; right: Rich/Source segmented control for md/table, Save when dirty, Find, Palette, Present, Settings) + `#doc` (one of `#editor-scroll`, `#cm-host`, `#viewer-host`, `#empty`) + `#statusbar` 26px. \*
No tab bar: documents live in the sidebar library. Body classes: `zen` (hides rail/sidebar/header/statusbar), `no-sidebar` (rail stays), `mode-source`, `focus-mode` (inactive blocks 32%), `typewriter`. \*
The source editor owns undo and redo; its `Ctrl+Shift+Z` binding passes through the app shortcut filter to CodeMirror history.

## Typography
Doc font comes from the active theme (`html[data-font="theme"]`, the default); the legacy `data-font` values sans/serif/mono still force a family; Settings > Typography has Body/Heading/Code pickers. Size `--fs`, line-height `--lh`. Headings 2.15 / 1.55 / 1.25 / 1.05em, tight negative tracking, no underline rules. Blockquote: thin accent bar, muted italic. Inline code: bordered pill. Tables: rounded, hairline rows, subtle zebra. HR: hairline.

## Motion and print
120ms hover transitions only; toasts ease in; all disabled under `prefers-reduced-motion`. Print shows only the document, black on white.

> \*Corrected 2026-10-08: the 48px icon rail (`#rail`) was removed in 0.2.0. The sidebar now has two tabs, Files and Search (`#sidebar-tabs`), the sidebar toggle is the first button in the header, and `header.js` no longer wires a rail. `zen` hides sidebar, header and statusbar; `no-sidebar` hides the sidebar and its resizer.

## Outline rail
`#outline-mini` (built by `src/modules/outline.js`) floats at the left edge of `#doc`, top-aligned 20px below the header. One 18px-wide button per heading (up to 24): the line inside it gets longer and thicker with level (h1 18x4px, h2 13x3, h3 9x2, h4+ 6x1), muted, the heading in view uses `--accent`. Click jumps; hover or focus opens a card to the right (`--bg-3`, `--shadow-lg`) listing headings indented by level. Hidden unless the active view is rich Markdown (`body[data-view="wysiwyg"]`), and `#editor-scroll` gets 44px left padding while it is shown so text never sits under it.

## Spreadsheet grid (CSV and TSV)
`src/modules/sheet.js` over the pure logic in `sheet-core.js`. Fills `#viewer-host`; sticky column letters and row numbers, formula bar, one-row toolbar that overflows into a menu, status line with selection stats. Virtualised rows and columns; empty cells are drawn past the data with the same `--border` gridlines. Uses theme variables only (errors use `var(--danger, red)`).
