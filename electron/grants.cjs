// File access grants. The renderer may only touch files the user chose.
// A path is granted when it was granted itself, or lies inside a granted folder.
// Grants are made by the main process only (dialog results, files the OS handed us, the one drop IPC),
// and are saved in userData/grants.json so a restarted app can reopen them.
const fs = require('node:fs')
const path = require('node:path')

const MAX_FILES = 500
const MAX_FOLDERS = 50
const WIN = process.platform === 'win32'
const key = (p) => (WIN ? p.toLowerCase() : p)

const os = require('node:os')

let store = null // path of grants.json, null means memory only
let files = [] // real paths, oldest first
let folders = []
let userData = null // the app's own data folder (holds grants.json): never grantable
let home = null

// Real path of p with symlinks followed. A path that does not exist yet resolves through its nearest
// existing ancestor, so a new file or a new assets/ folder inside a granted folder is judged by where it will land.
function resolveReal(p) {
  if (typeof p !== 'string' || !p || p.includes('\0') || !path.isAbsolute(p)) throw new Error('bad path')
  let cur = path.resolve(p)
  const rest = []
  for (;;) {
    try {
      return rest.length ? path.join(fs.realpathSync.native(cur), ...rest.reverse()) : fs.realpathSync.native(cur)
    } catch (e) {
      if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') throw e
    }
    // present but unresolvable means a dangling symlink: refuse rather than write through it
    try { fs.lstatSync(cur); throw new Error('dangling link') } catch (e) { if (e.message === 'dangling link') throw e }
    const up = path.dirname(cur)
    if (up === cur) throw new Error('bad path')
    rest.push(path.basename(cur))
    cur = up
  }
}

const inside = (root, target) => {
  const a = key(root)
  const b = key(target)
  if (a === b) return true
  const rel = path.relative(a, b)
  return !!rel && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel)
}

function save() {
  if (!store) return
  try {
    const tmp = store + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify({ files, folders }))
    fs.renameSync(tmp, store)
  } catch {}
}

// Point the module at its file and load what it holds. Call once at startup (tests call it per temp folder).
function configure(storePath, opts = {}) {
  store = storePath || null
  userData = store ? path.dirname(store) : null
  try { home = fs.realpathSync.native(opts.home || os.homedir()) } catch { home = null }
  files = []
  folders = []
  if (!store) return
  try {
    const j = JSON.parse(fs.readFileSync(store, 'utf8'))
    const ok = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string' && path.isAbsolute(x) && !x.includes('\0')) : [])
    files = ok(j.files).slice(-MAX_FILES)
    folders = ok(j.folders).slice(-MAX_FOLDERS)
  } catch {}
}

// The app's userData folder, and dotfiles or dot-folders under the home folder (.ssh, .aws, .gnupg, .env ...), are refused
// even when a dialog or a drop names them, and even when a granted folder contains them.
function sensitive(real) {
  if (userData && inside(resolveReal(userData), real)) return true
  if (home && inside(home, real)) return path.relative(home, real).split(path.sep).some((s) => s.startsWith('.'))
  return false
}

function grant(absPath, opts = {}) {
  const real = resolveReal(absPath)
  if (sensitive(real)) throw new Error('not permitted: ' + path.basename(real))
  const list = opts.folder ? folders : files
  const i = list.findIndex((x) => key(x) === key(real))
  if (i >= 0) list.splice(i, 1)
  list.push(real)
  const max = opts.folder ? MAX_FOLDERS : MAX_FILES
  while (list.length > max) list.shift() // oldest dropped first
  save()
  return real
}

// opts.folder: the path must lie inside a granted folder (folder tree and search), a single granted file is not enough.
function isGranted(absPath, opts = {}) {
  let real
  try { real = resolveReal(absPath); if (sensitive(real)) return false } catch { return false }
  if (folders.some((r) => inside(r, real))) return true
  return !opts.folder && files.some((f) => key(f) === key(real))
}

// Narrow rule for pasted images: a granted file also allows WRITES to <its folder>/assets/<name>, nothing else in that folder.
// Used by file:save-image only, never for reads. The real path is compared, so an assets symlink pointing elsewhere fails.
function isAssetWrite(absPath) {
  let real
  try { real = resolveReal(absPath) } catch { return false }
  const dir = key(path.dirname(real))
  return files.some((f) => key(path.join(path.dirname(f), 'assets')) === dir)
}

const grantedRoots = () => ({ files: [...files], folders: [...folders] })

// For the IPC handlers: throws the error the renderer sees.
function assert(absPath, opts) {
  if (!isGranted(absPath, opts)) throw new Error('not permitted: ' + path.basename(String(absPath || '')))
}

module.exports = { configure, grant, isGranted, isAssetWrite, grantedRoots, assert, MAX_FILES, MAX_FOLDERS }
