// Shared helper for the UI suites: runs the real (unpackaged) app once with a PLUME_STEPS script in a fresh profile.
// The renderer only reads files the user granted, so the fixture folder is written into the new profile's grants.json first.
// If PLUME_UI_LOCK is set it is the command that wraps the Electron run (a machine-wide window lock), for shared machines.
const { spawn, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')

function ensureBuilt() {
  if (fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) return
  console.log('dist/ is missing, running vite build ...')
  const r = spawnSync('npx', ['vite', 'build'], { cwd: ROOT, stdio: 'inherit', shell: true })
  if (r.status !== 0) throw new Error('vite build failed')
}

// steps: array for PLUME_STEPS. Resolves { results, errors, stdout } or rejects on crash or timeout.
function runApp(steps, { grantDir, grantFiles, profile: keepProfile, args: extraArgs = [], timeoutMs = 120000, shotDir, label = 'run' } = {}) {
  ensureBuilt()
  const work = fs.mkdtempSync(path.join(os.tmpdir(), `plume-ui-${label}-`))
  // keepProfile: reuse one profile folder across runs (a restart); grants are written only when it has none yet.
  const profile = keepProfile || path.join(work, 'profile')
  fs.mkdirSync(profile, { recursive: true })
  if ((grantDir || grantFiles) && !fs.existsSync(path.join(profile, 'grants.json'))) fs.writeFileSync(path.join(profile, 'grants.json'), JSON.stringify({ files: (grantFiles || []).map((f) => fs.realpathSync.native(f)), folders: grantDir ? [fs.realpathSync.native(grantDir)] : [] }))
  const stepsFile = path.join(work, 'steps.json')
  fs.writeFileSync(stepsFile, JSON.stringify(steps))
  // Test runs are hidden by default so they never appear on the screen. Set PLUME_HIDDEN=0 to watch a run.
  const env = { ...process.env, PLUME_HIDDEN: process.env.PLUME_HIDDEN ?? '1', PLUME_USER_DATA: profile, PLUME_STEPS: stepsFile, PLUME_SHOT_DIR: shotDir || work }
  delete env.ELECTRON_RUN_AS_NODE
  const electron = require('electron') // path to electron.exe
  const lock = process.env.PLUME_UI_LOCK
  const cmd = lock ? 'bash' : electron
  const args = lock ? [lock, electron, '.', ...extraArgs] : ['.', ...extraArgs]
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    p.stdout.on('data', (d) => (stdout += d))
    p.stderr.on('data', () => {})
    const timer = setTimeout(() => { p.kill(); spawnSync('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' }); reject(new Error('app run timed out after ' + timeoutMs + ' ms')) }, timeoutMs)
    p.on('exit', () => {
      clearTimeout(timer)
      const res = /RESULTS:(.*)/.exec(stdout)
      const err = /ERRORS:(.*)/.exec(stdout)
      if (!res || !err) return reject(new Error('app exited without RESULTS/ERRORS. Output tail: ' + stdout.slice(-400)))
      try { fs.rmSync(work, { recursive: true, force: true }) } catch {}
      resolve({ results: JSON.parse(res[1]), errors: JSON.parse(err[1]), stdout })
    })
  })
}

module.exports = { runApp, ROOT }
