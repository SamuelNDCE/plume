// Plugin discovery + the plume-plugin:// protocol. Plugins are ordinary JS (NOT sandboxed); see docs/PLUGINS.md.
const fs = require('node:fs')
const path = require('node:path')
const { protocol: protocolMod } = require('electron')

const SCHEME = 'plume-plugin'
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/
const MAX_BYTES = 2 * 1024 * 1024
const MIME = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
}

function registerSchemes() {
  protocolMod.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  ])
}

const within = (root, target) => {
  const rel = path.relative(root, target)
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

function register({ app, ipcMain, shell, protocol }) {
  const pluginsDir = path.join(app.getPath('userData'), 'plugins')
  const stateFile = path.join(app.getPath('userData'), 'plugins-state.json')
  try {
    fs.mkdirSync(pluginsDir, { recursive: true })
    const readme = path.join(pluginsDir, 'README.txt')
    if (!fs.existsSync(readme)) {
      fs.writeFileSync(
        readme,
        'Plume plugins live here: one folder per plugin, folder name = plugin id, containing plugin.json and index.js.\n' +
          'Plugins are ordinary JavaScript with access to your open documents. Only enable plugins you trust.\n' +
          'Docs: docs/PLUGINS.md in the Plume repository, with examples in examples/plugins/.\n'
      )
    }
  } catch (e) {
    console.error('[plugins] cannot create plugins dir', e)
  }

  const readState = () => {
    try {
      const s = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
      return s && typeof s.enabled === 'object' && s.enabled ? s : { enabled: {} }
    } catch {
      return { enabled: {} }
    }
  }
  const writeState = (s) => fs.writeFileSync(stateFile, JSON.stringify(s, null, 2))
  const isEnabled = (id) => readState().enabled[id] === true

  // Resolve a manifest's main file safely inside its folder.
  const validate = (folder) => {
    const dir = path.join(pluginsDir, folder)
    const base = { id: folder, name: folder, version: '', description: '', author: '', main: 'index.js', permissions: [] }
    let m
    try {
      m = JSON.parse(fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8'))
    } catch (e) {
      return { ...base, valid: false, error: 'plugin.json missing or not valid JSON' }
    }
    const out = {
      id: String(m.id || folder),
      name: String(m.name || m.id || folder),
      version: String(m.version || ''),
      description: String(m.description || ''),
      author: String(m.author || ''),
      main: typeof m.main === 'string' && m.main ? m.main : 'index.js',
      permissions: Array.isArray(m.permissions) ? m.permissions.map(String) : [],
      minPlumeVersion: m.minPlumeVersion ? String(m.minPlumeVersion) : undefined,
    }
    const bad = (error) => ({ ...out, valid: false, error })
    if (!ID_RE.test(out.id)) return bad('id must be lowercase a-z, 0-9 and dashes')
    if (out.id !== folder) return bad('folder name must equal plugin id')
    if (!out.version) return bad('version is required')
    if (path.isAbsolute(out.main) || out.main.split(/[\/]/).includes('..')) return bad('main must be a relative path inside the plugin folder')
    if (!MIME[path.extname(out.main).toLowerCase()] || !/\.m?js$/i.test(out.main)) return bad('main must be a .js or .mjs file')
    if (!fs.existsSync(path.join(dir, out.main))) return bad('main file not found: ' + out.main)
    return { ...out, valid: true }
  }

  ipcMain.handle('plugins:list', () => {
    let names = []
    try {
      names = fs.readdirSync(pluginsDir, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => d.name)
    } catch {}
    const enabled = readState().enabled
    return names.map((n) => {
      const p = validate(n)
      return { ...p, enabled: p.valid && enabled[p.id] === true }
    })
  })
  ipcMain.handle('plugins:set-enabled', (_e, id, on) => {
    if (typeof id !== 'string' || !ID_RE.test(id)) throw new Error('bad plugin id')
    const s = readState()
    if (on) s.enabled[id] = true
    else delete s.enabled[id]
    writeState(s)
    return true
  })
  ipcMain.handle('plugins:open-folder', async () => {
    fs.mkdirSync(pluginsDir, { recursive: true })
    return shell.openPath(pluginsDir)
  })

  const text = (status, body) => new Response(body, { status, headers: { 'content-type': 'text/plain' } })
  protocol.handle(SCHEME, async (request) => {
    try {
      const url = new URL(request.url)
      const id = decodeURIComponent(url.hostname)
      if (!ID_RE.test(id) || !isEnabled(id)) return text(404, 'not found')
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '')
      if (!rel || rel.includes('\0') || path.isAbsolute(rel) || /^[a-zA-Z]:/.test(rel)) return text(404, 'not found')
      const ext = path.extname(rel).toLowerCase()
      const type = MIME[ext]
      if (!type) return text(404, 'not found')
      const root = fs.realpathSync(path.join(pluginsDir, id))
      const target = path.resolve(root, rel)
      if (!within(root, target)) return text(404, 'not found')
      const real = fs.realpathSync(target) // follows symlinks; must still be inside
      if (!within(root, real)) return text(404, 'not found')
      const st = fs.statSync(real)
      if (!st.isFile() || st.size > MAX_BYTES) return text(404, 'not found')
      return new Response(fs.readFileSync(real), { status: 200, headers: { 'content-type': type, 'cache-control': 'no-store' } })
    } catch {
      return text(404, 'not found')
    }
  })
}

module.exports = { registerSchemes, register }
