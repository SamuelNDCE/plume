// Run after `npm run build`: npx electron tests/stress-open.cjs
// Large-input check. Needs four paths in the environment:
//   PLUME_STRESS_DIR   a big folder, e.g. C:/Program Files (the filter tests use 'note1' and 'zz-needle')
//   PLUME_STRESS_BIG   a Markdown file over 2 MB (opens in Source view, must stay responsive)
//   PLUME_STRESS_HUGE  a file over the whole-read limit (the main process must refuse it, not freeze)
//   PLUME_STRESS_HTML  an .html page with a relative stylesheet, image and a script
// Prints the timings and checks in RESULTS. Fails if the window reports errors.
const { app } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const need = (k) => {
  if (!process.env[k]) throw new Error('set ' + k)
  return process.env[k]
}
const dir = path.resolve(need('PLUME_STRESS_DIR'))
const big = need('PLUME_STRESS_BIG')
const huge = need('PLUME_STRESS_HUGE')
const html = need('PLUME_STRESS_HTML')

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'plume-stress-'))
app.setPath('userData', profile)
app.setPath('sessionData', profile)
// Grant the folder the way a user's open-folder dialog would (grants.json is read at startup).
// The fixture files sit in their own folder (the big, huge and html paths), granted the same way.
fs.writeFileSync(path.join(profile, 'grants.json'), JSON.stringify({ files: [], folders: [dir, path.resolve(path.dirname(big))] }))

const j = JSON.stringify
const steps = [
  { wait: 1500 },
  {
    js: `(async () => { const a = window.__plume; const t0 = performance.now(); await a.actions.openFolder(${j(dir)}); await new Promise((r) => setTimeout(r, 80)); return { folderOpenMs: Math.round(performance.now() - t0), topRows: document.querySelectorAll('#sidebar .tree-row').length } })()`,
    wait: 500,
  },
  {
    js: `(async () => { const a = window.__plume; let maxGap = 0; let last = performance.now(); const tick = setInterval(() => { const n = performance.now(); maxGap = Math.max(maxGap, n - last); last = n }, 20); const t0 = performance.now(); await a.actions.openPath(${j(big)}); const ms = performance.now() - t0; clearInterval(tick); const d = a.state.tabs[a.state.active]; return { bigOpenMs: Math.round(ms), maxUiGapMs: Math.round(maxGap), kind: d.kind, view: d.view, chars: d.content.length } })()`,
    wait: 1200,
    shot: 'stress-big.png',
  },
  {
    js: `window.folio.readFile(${j(huge)}).then(() => 'opened (unexpected)', (e) => 'refused: ' + e.message)`,
    wait: 300,
  },
  {
    js: `(async () => { const f = document.querySelector('.lib-filter'); const t0 = performance.now(); f.value = 'zz-needle'; f.dispatchEvent(new Event('input')); for (let i = 0; i < 300; i++) { await new Promise((r) => setTimeout(r, 25)); if (!document.querySelector('.lib-tree').textContent.includes('Searching')) break } return { needleMs: Math.round(performance.now() - t0), rows: [...document.querySelectorAll('.lib-tree .tree-row')].map((r) => r.textContent) } })()`,
    wait: 300,
  },
  {
    js: `(async () => { const f = document.querySelector('.lib-filter'); const t0 = performance.now(); f.value = 'note1'; f.dispatchEvent(new Event('input')); for (let i = 0; i < 300; i++) { await new Promise((r) => setTimeout(r, 25)); if (!document.querySelector('.lib-tree').textContent.includes('Searching')) break } return { note1Ms: Math.round(performance.now() - t0), rows: document.querySelectorAll('.lib-tree .tree-row').length, capped: document.querySelector('.lib-tree').textContent.includes('Showing the first') } })()`,
    wait: 300,
  },
  { js: `(() => { const f = document.querySelector('.lib-filter'); f.value = ''; f.dispatchEvent(new Event('input')); return 'cleared' })()`, wait: 200 },
  {
    js: `(async () => { const a = window.__plume; await a.actions.openPath(${j(html)}); await new Promise((r) => setTimeout(r, 600)); const frame = document.querySelector('.htmlv-frame'); const d = a.state.tabs[a.state.active]; return { kind: d.kind, view: d.view, mode: a.state.mode, frame: !!frame, sandbox: frame ? frame.getAttribute('sandbox') : null, srcdocHasScript: frame ? frame.srcdoc.includes('<script') : null, cssInlined: frame ? frame.srcdoc.includes('color:rgb(200') : null, svgInlined: frame ? frame.srcdoc.includes('data:image/svg+xml') : null } })()`,
    wait: 800,
    shot: 'stress-html-rich.png',
  },
  { js: `(() => { window.__plume.actions.toggleSource(); return 'toggled to source' })()`, wait: 900 },
  {
    js: `(async () => { await new Promise((r) => setTimeout(r, 300)); return { frameGone: !document.querySelector('.htmlv-frame'), mode: window.__plume.state.mode, source: (document.querySelector('#cm-host .cm-content') || {}).textContent ? document.querySelector('#cm-host .cm-content').textContent.slice(0, 80) : '' } })()`,
    wait: 200,
    shot: 'stress-html-source.png',
  },
]

const stepsFile = path.join(profile, 'steps.json')
fs.writeFileSync(stepsFile, j(steps))
process.env.PLUME_STEPS = stepsFile
process.env.PLUME_SHOT_DIR = process.env.PLUME_SHOT_DIR || profile

let errors = null
const log = console.log.bind(console)
console.log = (...args) => {
  if (typeof args[0] === 'string' && args[0].startsWith('ERRORS:')) errors = JSON.parse(args[0].slice(7))
  log(...args)
}
const exit = app.exit.bind(app)
app.exit = (code) => exit(errors === null || errors.length ? 1 : code)
setTimeout(() => exit(1), 120000).unref()

require(path.join(__dirname, '..', 'electron', 'main.cjs'))
