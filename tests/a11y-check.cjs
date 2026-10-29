// Accessibility check for Plume: injects axe-core into the real app and lists violations per view.
//   Install axe-core OUTSIDE the repo, e.g. in a scratch folder:  npm i axe-core
//   Point at it:  PLUME_AXE=<path to axe.min.js> node tests/a11y-check.cjs      (add --strict to exit 1 on any violation)
// Without PLUME_AXE it tries require.resolve('axe-core/axe.min.js'). Nothing is added to package.json.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { runApp } = require('./ui-runner.cjs')
const fixtures = require('./ui-fixtures.cjs')

function axePath() {
  if (process.env.PLUME_AXE) return process.env.PLUME_AXE
  try { return require.resolve('axe-core/axe.min.js') } catch {}
  console.error('axe-core not found. Install it outside the repo and set PLUME_AXE=<path>/axe.min.js')
  process.exit(2)
}

async function main() {
  const axeSrc = fs.readFileSync(axePath(), 'utf8')
  const F = await fixtures.make(fs.mkdtempSync(path.join(os.tmpdir(), 'plume-a11y-fx-')))
  const views = []
  const steps = [{ js: axeSrc + '\n;typeof axe', wait: 300 }]
  const open = (p, wait) => steps.push({ js: `window.__plume.actions.openPath(${JSON.stringify(p)})`, wait })
  const run = (name) => {
    views.push(name)
    steps.push({ wait: 300, js: `axe.run(document,{resultTypes:['violations']}).then(r=>JSON.stringify(r.violations.map(v=>({id:v.id,impact:v.impact,count:v.nodes.length,help:v.help,els:v.nodes.slice(0,3).map(n=>n.target.join(' ')+' :: '+(n.html||'').slice(0,90))}))))` })
  }
  // empty first: close the Welcome tab
  steps.push({ js: `(async()=>{const a=window.__plume;while(a.state.tabs.length)await a.actions.closeTab(0);await new Promise(r=>setTimeout(r,500));return a.state.mode})()`, wait: 600 })
  run('empty')
  open(F.md, 2000); run('rich Markdown')
  steps.push({ js: 'window.__plume.actions.toggleSource()', wait: 1000 }); run('source (Markdown)')
  open(F.csv, 2500); run('CSV grid')
  open(F.log, 2500); run('log view')
  open(F.pdf, 3500); run('PDF viewer')
  open(F.xlsx, 3000); run('XLSX grid')
  open(F.docx, 3000); run('Word viewer')
  const r = await runApp(steps, { grantDir: F.dir, label: 'a11y', timeoutMs: Number(process.env.PLUME_UI_TIMEOUT) || 150000 })
  // results: [axe typeof, empty mode, ...] with one entry per js step; axe runs are every second entry after the first two
  let total = 0
  const res = r.results
  let idx = 2
  views.forEach((v, n) => {
    // find the axe result for this view: scan forward for a JSON array string
    while (idx < res.length && !(typeof res[idx] === 'string' && res[idx].startsWith('['))) idx++
    const list = idx < res.length ? JSON.parse(res[idx++]) : null
    console.log(`\n== ${v}`)
    if (!list) return console.log('  (no axe result)')
    if (!list.length) console.log('  no violations')
    list.forEach((x) => { total += x.count; console.log(`  ${x.id} [${x.impact}] x${x.count}: ${x.help}`); x.els.forEach((e) => console.log('      ' + e)) })
  })
  console.log(`\n${total} violating elements in total. Renderer errors: ${r.errors.length}`)
  try { fs.rmSync(F.dir, { recursive: true, force: true }) } catch {}
  process.exit(process.argv.includes('--strict') && total ? 1 : 0)
}

main().catch((e) => { console.error('a11y check crashed: ' + e.message); process.exit(1) })
