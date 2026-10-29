// UI regression suite for Plume. Runs the real, unpackaged app once (QA hooks, fresh profile) and checks the main views.
//   npm run build        (needed once; the suite builds by itself only if dist/ is missing)
//   node tests/ui-regression.cjs
// Prints PASS or FAIL per check and exits 1 if any check fails or the app crashes.
// Optional: PLUME_UI_LOCK=<path to electron-lock.sh> wraps the Electron run in a machine-wide window lock.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { runApp } = require('./ui-runner.cjs')
const fixtures = require('./ui-fixtures.cjs')

const FAILED = (m) => ({ ok: false, got: m })

async function main() {
  const F = await fixtures.make(fs.mkdtempSync(path.join(os.tmpdir(), 'plume-ui-fx-')))
  const steps = []
  const checks = [] // one entry per js step: { name, test(value) -> true | string } or null for setup steps
  const js = (code, wait = 400) => { steps.push({ js: code, wait }); checks.push(null) }
  const check = (name, code, test, wait = 400) => { steps.push({ js: code, wait }); checks.push({ name, test }) }
  const key = (k, mods = [], wait = 500) => steps.push({ key: k, mods, wait })
  const type = (text, wait = 300) => steps.push({ text, wait })
  const open = (p, wait = 2500) => js(`window.__plume.actions.openPath(${JSON.stringify(p)})`, wait)
  const eq = (want) => (v) => (v === want ? true : `expected ${JSON.stringify(want)}, got ${JSON.stringify(v)}`)
  const match = (re) => (v) => (re.test(String(v)) ? true : `expected ${re}, got ${JSON.stringify(v)}`)
  const sel = (s) => `document.querySelector(${JSON.stringify(s)})`
  const textOf = (s) => `(()=>{const e=${sel(s)};return e?e.innerText:null})()`

  // 1. window opens
  check('window opens: app shell, Milkdown editor and Welcome tab', `(()=>{const a=window.__plume;return JSON.stringify({shell:!!${sel('#app')},pm:!!${sel('#editor .ProseMirror')},mode:a.state.mode,tabs:a.state.tabs.length})})()`,
    (v) => { const o = JSON.parse(v); return o.shell && o.pm && o.mode === 'wysiwyg' && o.tabs === 1 ? true : 'got ' + v })

  // 2. Markdown rich: open and type
  open(F.md, 2000)
  check('open Markdown: rich view shows the file heading', textOf('#editor .ProseMirror h1'), eq('Plume regression'))
  js(`(()=>{const pm=${sel('#editor .ProseMirror')};pm.focus();const r=document.createRange();r.selectNodeContents(pm);r.collapse(false);const s=getSelection();s.removeAllRanges();s.addRange(r)})()`)
  type('Zebra123')
  check('type in rich view: typed text lands in the document', `window.__plume.getMarkdown()`, match(/Zebra123/))

  // 3. Source and back
  js('window.__plume.actions.toggleSource()', 900)
  check('toggle to Source: CodeMirror shows the typed text', `JSON.stringify({mode:window.__plume.state.mode,cm:!!${sel('.cm-editor')},txt:(${sel('.cm-content')}||{}).innerText||''})`,
    (v) => { const o = JSON.parse(v); return o.mode === 'source' && o.cm && /Zebra123/.test(o.txt) ? true : 'got ' + v })
  js('window.__plume.actions.toggleSource()', 900)
  check('toggle back to rich: ProseMirror shows the typed text', `JSON.stringify({mode:window.__plume.state.mode,txt:(${sel('#editor .ProseMirror')}||{}).innerText||''})`,
    (v) => { const o = JSON.parse(v); return o.mode === 'wysiwyg' && /Zebra123/.test(o.txt) ? true : 'got ' + v })

  // 4. Find
  key('F', ['control'], 600)
  check('Ctrl+F opens the find bar', `(()=>{const b=${sel('#find-root .find-bar')};return !!b&&!b.hidden})()`, eq(true))
  type('quick', 700)
  check('find: "quick" is found twice, count shown', textOf('#find-root .find-count'), match(/\b2\b/))
  key('Escape', [], 500)
  check('Escape closes the find bar', `(()=>{const b=${sel('#find-root .find-bar')};return !b||b.hidden})()`, eq(true))

  // 5. Quick bar and right-click menu (rich view, text selected)
  js(`(()=>{const p=${sel('#editor .ProseMirror p')};const r=document.createRange();r.selectNodeContents(p);const s=getSelection();s.removeAllRanges();s.addRange(r)})()`, 500)
  check('quick bar appears on a text selection', `(()=>{const q=document.getElementById('qbar');return !!q&&!q.hidden})()`, eq(true))
  js(`(()=>{const pm=${sel('#editor .ProseMirror')};const r=pm.querySelector('p').getBoundingClientRect();pm.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.left+20,clientY:r.top+8,button:2}))})()`, 600)
  check('right-click menu opens with Cut, Copy and Paste', `(()=>{const t=(document.getElementById('ctx-root').innerText+' '+document.getElementById('qbar').innerText).toLowerCase();return JSON.stringify({cut:/cut/.test(t),copy:/copy/.test(t),paste:/paste/.test(t)})})()`,
    (v) => { const o = JSON.parse(v); return o.cut && o.copy && o.paste ? true : 'got ' + v })
  key('Escape', [], 400)

  // 6. Settings and palette
  key(',', ['control'], 800)
  check('Ctrl+, opens the settings page', `JSON.stringify({dlg:!!${sel('.st-dialog')},title:(${sel('#st-title')}||{}).innerText||''})`,
    (v) => { const o = JSON.parse(v); return o.dlg && o.title ? true : 'got ' + v })
  key('Escape', [], 500)
  key('P', ['control'], 700)
  check('Ctrl+P opens the command palette', `(()=>{const r=document.getElementById('palette-root');return !r.hidden&&!!r.querySelector('.pal-input')&&r.querySelectorAll('.pal-item').length>0})()`, eq(true))
  key('Escape', [], 500)

  // 7. Log file
  open(F.log, 2500)
  check('open .log: log view shows level chips with counts INFO 12, WARN 3, ERROR 2', `JSON.stringify([...document.querySelectorAll('.lv-chip')].map(c=>c.innerText.replace(/\\s+/g,' ').trim()))`,
    (v) => { const a = JSON.parse(v).join('|'); return /info.*12/i.test(a) && /warn.*3/i.test(a) && /error.*2/i.test(a) ? true : 'got ' + a })
  check('status bar for the log shows a size and a word count', `JSON.stringify({size:(${sel('.sb-size')}||{}).innerText||'',words:(${sel('.sb-words')}||{}).innerText||''})`,
    (v) => { const o = JSON.parse(v); return /^\d[\d.,]*\s?(B|KB|MB)$/i.test(o.size) && /^\d+\s+words?$/i.test(o.words) ? true : 'got ' + v })

  // 8. CSV, PDF, XLSX, DOCX
  open(F.csv, 2500)
  check('open CSV: grid shows the cell "Alpha"', `[...document.querySelectorAll('[role=gridcell]')].some(c=>c.innerText.trim()==='Alpha')`, eq(true))
  open(F.pdf, 3500)
  check('open PDF: viewer shows a canvas', `document.querySelectorAll('#viewer-host .pdfv canvas').length`, (v) => (v >= 1 ? true : 'canvas count ' + v))
  open(F.xlsx, 3000)
  check('open XLSX: sheet grid shows the first cell "Item"', `[...document.querySelectorAll('#viewer-host [role=gridcell]')].some(c=>c.innerText.trim()==='Item')`, eq(true))
  open(F.docx, 3000)
  check('open DOCX: Word viewer shows the first paragraph', textOf('#viewer-host .dx-page'), match(/Plume Word fixture/))

  const r = await runApp(steps, { grantDir: F.dir, label: 'reg', timeoutMs: Number(process.env.PLUME_UI_TIMEOUT) || 150000 })
  let pass = 0
  let fail = 0
  const report = (ok, name, msg) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '\n      ' + msg}`) }
  const jsErrors = r.errors
  let i = 0
  checks.forEach((c, n) => {
    const v = r.results[n]
    if (!c) return
    let res
    try { res = c.test(v) } catch (e) { res = 'test threw: ' + e.message }
    const stepErr = jsErrors.find((e) => e.startsWith('step ') && e.includes(JSON.stringify(steps.filter((s) => s.js)[n].js).slice(1, 40)))
    report(res === true, c.name, (typeof res === 'string' ? res : '') + (stepErr ? ' | ' + stepErr : ''))
    i++
  })
  report(jsErrors.length === 0, 'no renderer errors (console error or failed step) during the whole run', jsErrors.join('\n      '))
  console.log(`\n${pass} passed, ${fail} failed`)
  try { fs.rmSync(F.dir, { recursive: true, force: true }) } catch {}
  process.exit(fail ? 1 : 0)
}

main().catch((e) => { console.error('FAIL  suite crashed: ' + e.message); process.exit(1) })
