// Repeats one real drag-selection in the welcome document, in parallel, and reports how often the selection bar does not show.
// Pass: selection is non-empty AND the bar is open, visible on screen, and fully opaque 900 ms after release.
const { runApp } = require('./ui-runner.cjs')
const RUNS = Number(process.env.RUNS || 20)
const WORKERS = Number(process.env.WORKERS || 4)
const steps = [
  { wait: 2800 },
  { click: { x: 900, y: 600 }, wait: 300 },
  { down: { x: 380, y: 220 }, wait: 80 },
  { move: { x: 480, y: 220, drag: true }, wait: 80 },
  { move: { x: 600, y: 221, drag: true }, wait: 120 },
  { up: { x: 600, y: 221 }, wait: 900 },
  { wait: 50, js: `JSON.stringify((() => { const b = document.querySelector('.qbar'); const r = b ? b.getBoundingClientRect() : null; return { sel: String(getSelection()).length, open: !!b && b.className.includes('open'), onScreen: !!r && r.width > 0 && r.top < innerHeight && r.bottom > 0, opacity: b ? Number(getComputedStyle(b).opacity) : 0 } })())` },
]
async function one(i) {
  try {
    const r = await runApp(steps, { label: 'bar' + i, timeoutMs: 120000 })
    return JSON.parse(r.results[r.results.length - 1])
  } catch (e) { return { error: String(e.message || e).slice(0, 120) } }
}
(async () => {
  const results = []
  for (let base = 0; base < RUNS; base += WORKERS) {
    const batch = []
    for (let i = base; i < Math.min(RUNS, base + WORKERS); i++) batch.push(one(i))
    results.push(...(await Promise.all(batch)))
  }
  const ok = (x) => !x.error && x.sel > 0 && x.open && x.onScreen && x.opacity >= 1
  const bad = results.filter((x) => !ok(x))
  console.log(`bar OK ${results.length - bad.length} / ${results.length}`)
  for (const x of bad) console.log('  failed:', JSON.stringify(x))
  process.exit(bad.length ? 1 : 0)
})()
