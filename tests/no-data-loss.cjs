// No-data-loss regression for Plume: opening a file must never change it on disk.
//   npm run build        (needed once; the runner builds by itself only if dist/ is missing)
//   node tests/no-data-loss.cjs
// For every file type it writes a sample file, records its SHA-256 and mtime, opens it in the real unpackaged app
// (QA hooks, fresh profile) the way a user first does (launch argument, or a grant + openPath for the types the OS
// launch argument does not carry), waits past the autosave timers, exits, and compares. Then the same profile is
// started again (session restore, then the file opened a second time) and compared again.
// Any change to the bytes, or any rewrite of the file (mtime), without a user edit is a failure. Exits 1 on failure.
// Optional: PLUME_UI_LOCK=<path to electron-lock.sh> wraps every Electron run in a machine-wide window lock.
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { runApp } = require('./ui-runner.cjs')
const fixtures = require('./ui-fixtures.cjs')

const WAIT_MS = 5500 // longer than the 1.5 s autosave timer and the session save
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

async function makeAll(dir) {
  const base = await fixtures.make(dir)
  const f = (n) => path.join(dir, n)
  // Markdown that the rich editor re-serialises differently (setext heading, * bullets, raw HTML, hard break, table, reference link, no final newline)
  fs.writeFileSync(f('tricky.md'), 'Setext Heading\n==============\n\n* item one\n* item two\n\n<div class="x">raw html</div>\n\nTrailing spaces  \nnext line\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n[ref]: http://example.com "Title"\n\nSee [ref] and \\* escaped.')
  fs.writeFileSync(f('crlf.md'), '# Windows file\r\n\r\nLine one\r\nLine two\r\n\r\n- a\r\n- b\r\n')
  fs.writeFileSync(f('plain.txt'), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('Notes\r\nsecond line with café\r\n', 'utf8')]))
  fs.writeFileSync(f('data.json'), '{"a":1,"list":[1,2,3],"nested":{"k":"v"}}')
  fs.writeFileSync(f('pic.png'), PNG)
  const open = [ // launch argument: OPENABLE types
    ['.md (tricky)', f('tricky.md'), true], ['.md (CRLF)', f('crlf.md'), true], ['.txt (BOM, CRLF)', f('plain.txt'), true],
    ['.log', base.log, true], ['.csv', base.csv, true], ['.json', f('data.json'), true], ['.png', f('pic.png'), true],
    ['.xlsx', base.xlsx, false], ['.pdf', base.pdf, false], ['.docx', base.docx, false],
  ]
  return open.map(([type, file, viaArg]) => ({ type, file, viaArg }))
}

async function runOne(t, phase, profile) {
  const p = JSON.stringify(t.file)
  const steps = [
    // the second phase passes the launch argument again on a profile that already has the file in its session
    { js: t.viaArg ? 'new Promise(r=>setTimeout(r,2500))' : `window.__plume.actions.openPath(${p}).then(()=>1)`, wait: 1500 },
    { js: `new Promise(r=>setTimeout(()=>r(JSON.stringify({tabs:window.__plume.state.tabs.map(d=>({name:d.name,kind:d.kind,dirty:!!d.dirty,ro:!!d.readOnly})),active:window.__plume.state.active})),${WAIT_MS}))`, wait: 200 },
  ]
  const r = await runApp(steps, { grantFiles: [t.file], profile, args: t.viaArg ? [t.file] : [], label: 'ndl-' + phase, timeoutMs: 400000 })
  return { state: JSON.parse(r.results[1]), errors: r.errors }
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plume-ndl-'))
  const types = await makeAll(dir)
  let failed = 0
  for (const t of types) {
    const before = { hash: sha(t.file), mtime: fs.statSync(t.file).mtimeMs, size: fs.statSync(t.file).size }
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'plume-ndl-profile-'))
    const notes = []
    let ok = true
    for (const phase of ['first-open', 'restart+reopen']) {
      try {
        const r = await runOne(t, phase, profile)
        const st = fs.statSync(t.file)
        const h = sha(t.file)
        const changed = h !== before.hash
        const rewritten = st.mtimeMs !== before.mtime
        const opened = r.state.tabs.some((d) => d.name === path.basename(t.file))
        const dirty = r.state.tabs.filter((d) => d.name === path.basename(t.file) && d.dirty).length
        if (changed || rewritten || !opened) ok = false
        notes.push(`${phase}: ${changed ? 'CHANGED ' + h.slice(0, 12) : 'unchanged'}${rewritten ? ' REWRITTEN(mtime)' : ''}${opened ? '' : ' NOT-OPENED'}${dirty ? ' dirty-flag-set' : ''}`)
      } catch (e) { ok = false; notes.push(`${phase}: run failed: ${e.message}`) }
    }
    if (!ok) failed++
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${t.type}  sha256 ${before.hash.slice(0, 12)}  ${notes.join(' | ')}`)
    try { fs.rmSync(profile, { recursive: true, force: true }) } catch {}
  }
  console.log(`\n${types.length - failed} unchanged, ${failed} failed`)
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error('FAIL  suite crashed: ' + e.message); process.exit(1) })
