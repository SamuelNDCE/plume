// Selection and scroll test for the rich view. It opens a real Markdown file (paragraphs, a heading, a table, a chart block and a
// Mermaid diagram), selects text inside each kind of block with a real mouse drag, then scrolls with the wheel and checks that:
//   1. the selection bar (block style and text size controls) opens and is visible on screen,
//   2. the view keeps moving forward with the wheel while the selection is there (no snap back to the selection),
//   3. the selection bar is still there after scrolling.
// Run: node tests/selection-scroll.cjs   (the window is shown, so wheel events are delivered).
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { runApp } = require('./ui-runner.cjs')

const MD = `# Selection test

${'The quick brown fox jumps over the lazy dog while the editor keeps a long paragraph of ordinary text on screen. '.repeat(3)}

## A heading to select

${'Second long paragraph, to give the view room to scroll away from the first selection and come back to it. '.repeat(3)}

| Name | Value | Notes |
| --- | --- | --- |
| alpha | 1 | first row of the table |
| beta | 2 | second row of the table |
| gamma | 3 | third row of the table |

\`\`\`chart
{"type":"bar","title":"Sales","labels":["Jan","Feb","Mar"],"values":[3,7,5]}
\`\`\`

\`\`\`mermaid
graph TD
  A[Start] --> B[Select text]
  B --> C[Scroll]
\`\`\`

${'Final paragraph of plain text, to keep the document longer than the window so scrolling has somewhere to go. '.repeat(8)}
`

// Where the blocks are on screen, read before any selection.
const PROBE = [
  {
    wait: 3000,
    js: `JSON.stringify((() => {
      const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) } }
      const q = (s) => document.querySelector(s)
      return { win: [innerWidth, innerHeight], p: r(q('#editor .ProseMirror p')), h2: r(q('#editor .ProseMirror h2')), td: r(q('#editor .ProseMirror td')), chart: r(q('#editor .ProseMirror [data-type="chart"], #editor .ProseMirror .chart-block, #editor .ProseMirror svg')), mermaid: r(q('#editor .ProseMirror .mermaid, #editor .ProseMirror [data-type="mermaid"]')) }
    })())`,
  },
]

// A real drag inside one block: press on its left part, move across, release. Clicking a blank header area first gives the window focus.
function selectSteps(box, y) {
  const x0 = box.x + 6
  const x1 = Math.min(box.x + box.w - 6, box.x + 260)
  return [
    { click: { x: 1100, y: 20 }, wait: 300 },
    { down: { x: x0, y }, wait: 80 },
    { move: { x: Math.round((x0 + x1) / 2), y, drag: true }, wait: 80 },
    { move: { x: x1, y, drag: true }, wait: 120 },
    { up: { x: x1, y }, wait: 900 },
  ]
}

// Read in the page after each step: scroll position and the selection bar. Returned as a JSON string.
const READ_BAR = `(() => {
  const b = document.querySelector('.qbar')
  if (!b) return { bar: 'missing' }
  const r = b.getBoundingClientRect()
  const cs = getComputedStyle(b)
  const onScreen = r.width > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth
  return {
    open: b.className.includes('open'), hidden: b.hidden, onScreen, opacity: Number(cs.opacity),
    rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
    block: !!document.querySelector('.qb-block'), size: !!document.querySelector('.qb-size'),
    sel: String(getSelection()).length,
  }
})()`
const read = (phase) => `JSON.stringify({ phase: '${phase}', top: Math.round(document.querySelector('#editor-scroll').scrollTop), bar: ${READ_BAR} })`

function scrollSteps() {
  const out = []
  for (let i = 0; i < 4; i++) {
    out.push({ wheel: { x: 700, y: 400, dy: -120 }, wait: 700 })
    out.push({ wait: 120, js: read('scroll') })
  }
  return out
}

function targets(p) {
  const list = []
  const mid = (b) => b.y + Math.round(b.h / 2)
  if (p.p) list.push({ name: 'paragraph', box: p.p, y: mid(p.p) })
  if (p.h2) list.push({ name: 'heading', box: p.h2, y: mid(p.h2) })
  if (p.td) list.push({ name: 'table cell', box: p.td, y: mid(p.td) })
  if (p.chart) list.push({ name: 'chart block', box: p.chart, y: mid(p.chart) })
  if (p.mermaid) list.push({ name: 'mermaid block', box: p.mermaid, y: mid(p.mermaid) })
  return list
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plume-sel-'))
  const file = path.join(dir, 'selection-test.md')
  fs.writeFileSync(file, MD)
  const probe = await runApp(PROBE, { grantFiles: [file], args: [file], label: 'probe', timeoutMs: 120000 })
  const p = JSON.parse(probe.results[0])
  const list = targets(p)
  console.log('window', p.win.join('x'), '- blocks found:', list.map((t) => t.name).join(', ') || 'none')
  const failures = []
  for (const t of list) {
    const steps = [...selectSteps(t.box, t.y), { wait: 600, js: read('select') }, ...scrollSteps()]
    const run = await runApp(steps, { grantFiles: [file], args: [file], label: 'sel', timeoutMs: 150000 })
    const r = run.results.map((x) => JSON.parse(x))
    const sel = r.find((x) => x.phase === 'select')
    const scrolls = r.filter((x) => x.phase === 'scroll')
    const problems = []
    const bar = sel && sel.bar
    if (!bar || !bar.open || !bar.onScreen || bar.opacity < 1 || !bar.block || !bar.size || !bar.sel) {
      problems.push('selection bar not shown on screen after selecting: ' + JSON.stringify(bar))
    }
    const tops = [sel ? sel.top : 0, ...scrolls.map((x) => x.top)]
    for (let i = 1; i < tops.length; i++) {
      if (tops[i] < tops[i - 1] - 2) problems.push('view snapped back from ' + tops[i - 1] + ' to ' + tops[i] + ' during the wheel scroll')
    }
    if (tops[tops.length - 1] === tops[0]) problems.push('view did not move with the wheel at all')
    if (scrolls.some((x) => !x.bar.open || !x.bar.onScreen)) problems.push('selection bar disappeared while scrolling')
    console.log(t.name.padEnd(15) + (problems.length ? 'FAIL' : 'PASS') + '  tops=' + tops.join(','))
    for (const pr of problems) console.log('   - ' + pr)
    if (problems.length) failures.push(t.name)
    if (run.errors.length) console.log('   renderer errors:', JSON.stringify(run.errors).slice(0, 300))
  }
  fs.rmSync(dir, { recursive: true, force: true })
  console.log(failures.length ? '\nFAILED: ' + failures.join(', ') : '\nALL PASS')
  process.exit(failures.length ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(2) })
