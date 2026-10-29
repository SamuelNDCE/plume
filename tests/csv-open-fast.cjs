// Regression: opening a tiny 3-row CSV must render the grid within 2 seconds (the grid margin/fill code must never loop or stall).
// Run: node tests/csv-open-fast.cjs   (set PLUME_UI_LOCK to the machine-wide window lock script on a shared machine)
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { runApp } = require('./ui-runner.cjs')

;(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plume-csvfast-'))
  const file = path.join(dir, 'data.csv')
  fs.writeFileSync(file, 'name,qty\nAlpha,3\nBeta,5\nGamma,8\n')
  const p = JSON.stringify(file.split(path.sep).join('/'))
  const steps = [
    { js: `window.__t0=performance.now();window.__plume.actions.openPath(${p});1`, wait: 50 },
    { js: `new Promise((res)=>{const t=performance.now();const f=()=>{const n=document.querySelectorAll('.sh-grid [role=gridcell]').length;if(n>0)res(JSON.stringify({ms:Math.round(performance.now()-window.__t0),cells:n}));else if(performance.now()-t>6000)res(JSON.stringify({ms:-1,cells:0}));else setTimeout(f,10)};f()})`, wait: 200 },
    { js: `(()=>{const g=document.querySelector('.sh-grid');return JSON.stringify({rows:document.querySelectorAll('.sh-rh').length,fillsWidth:g.scrollWidth>=g.clientWidth,fillsHeight:g.scrollHeight>=g.clientHeight})})()`, wait: 200 },
  ]
  let r
  try { r = await runApp(steps, { grantDir: dir, label: 'csvfast', timeoutMs: 90000 }) } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  const [a, b] = r.results.filter((x) => typeof x === 'string').map((x) => JSON.parse(x))
  const ok = a && a.ms >= 0 && a.ms < 2000 && b && b.rows >= 23 && b.fillsWidth && b.fillsHeight && r.errors.filter((e) => !/ResizeObserver loop/.test(e)).length === 0
  console.log((ok ? 'PASS' : 'FAIL') + '  3-row CSV grid renders in ' + (a ? a.ms : '?') + ' ms (limit 2000), rows drawn ' + (b ? b.rows : '?'))
  process.exit(ok ? 0 : 1)
})().catch((e) => { console.error('FAIL', e.message); process.exit(1) })
