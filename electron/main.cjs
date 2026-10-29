const { app, BrowserWindow, ipcMain, dialog, shell, Menu, nativeTheme } = require('electron')
const fs = require('node:fs')
const textio = require('./textio.cjs')
const { writeAtomic } = require('./atomicwrite.cjs')
const grants = require('./grants.cjs')
const path = require('node:path')
// Grants made by the main process for something the OS or the user handed us (never from a renderer request).
const grantQuiet = (p, opts) => { try { grants.grant(p, opts) } catch {} }
const need = grants.assert

const isDev = !!process.env.VITE_DEV_URL
// QA hooks (PLUME_STEPS, PLUME_SMOKE, PLUME_USER_DATA, PLUME_SEARCH_LOG) only run outside a packaged build.
const QA = !app.isPackaged
const MD_EXT = new Set(['.md', '.markdown', '.mdown', '.mkd'])
const IMG_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.avif'])
const TEXT_EXT = new Set(['.txt', '.text', '.log', '.json', '.jsonc', '.json5', '.csv', '.tsv', '.xml', '.yaml', '.yml', '.toml', '.ini', '.conf', '.cfg', '.html', '.htm', '.css', '.scss', '.less', '.js', '.mjs', '.cjs', '.ts', '.jsx', '.tsx', '.vue', '.svelte', '.py', '.rs', '.go', '.java', '.kt', '.c', '.h', '.cpp', '.hpp', '.cs', '.rb', '.php', '.sh', '.bash', '.zsh', '.bat', '.cmd', '.ps1', '.sql', '.lua', '.swift', '.tex', '.rst', '.org', '.diff', '.patch', '.gitignore', '.env', '.env.example', '.mdx', '.jsonl', '.out', '.err', '.properties'])
// a dotfile such as .env or .gitignore has no extname, so its whole name counts as the extension
const extOf = (p) => { const b = path.basename(p).toLowerCase(); return b.startsWith('.') && b.indexOf('.', 1) < 0 ? b : path.extname(b) }
const OPENABLE = (p) => { const e = extOf(p); return MD_EXT.has(e) || TEXT_EXT.has(e) || IMG_EXT.has(e) }
// Optional feature modules (each owned by one area). Required lazily so a missing one never blocks launch.
const optional = (name) => {
  try {
    return require(name)
  } catch (e) {
    if (e.code !== 'MODULE_NOT_FOUND') console.error('[main] ' + name, e)
    return null
  }
}
const pluginsIpc = optional('./plugins-ipc.cjs')
const themesIpc = optional('./themes-ipc.cjs')
const updaterIpc = optional('./updater.cjs')
// Custom schemes must be registered before the app is ready.
pluginsIpc && pluginsIpc.registerSchemes && pluginsIpc.registerSchemes()

let win = null
let pendingOpen = process.argv.slice(app.isPackaged ? 1 : 2).find((a) => OPENABLE(a))

// Last-used window colour, so a dark theme never flashes white on launch.
const bgFile = () => path.join(app.getPath('userData'), 'window-bg.json')
const readBg = () => {
  try {
    return JSON.parse(fs.readFileSync(bgFile(), 'utf8'))
  } catch {
    return { color: '#ffffff', dark: false }
  }
}

function createWindow() {
  const bg = readBg()
  nativeTheme.themeSource = bg.dark ? 'dark' : 'light'
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 640,
    minHeight: 420,
    show: false,
    // keeps the page painting while the window is hidden, so QA screenshots still work
    paintWhenInitiallyHidden: true,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    backgroundColor: bg.color,
    title: 'Plume',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  Menu.setApplicationMenu(null)
  // QA only: PLUME_HIDDEN=1 keeps the test window off the screen and out of the taskbar. The app still runs and paints.
  const hidden = QA && !!process.env.PLUME_HIDDEN
  if (hidden) win.setSkipTaskbar(true)
  win.once('ready-to-show', () => win && !hidden && win.show())
  if (isDev) win.loadURL(process.env.VITE_DEV_URL)
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  // Only web and mail links ever leave the app; anything else (file:, javascript:, custom schemes) is dropped.
  const openSafe = (url) => {
    try {
      if (['http:', 'https:', 'mailto:'].includes(new URL(url).protocol)) shell.openExternal(url)
    } catch {}
  }
  win.webContents.setWindowOpenHandler(({ url }) => {
    openSafe(url)
    return { action: 'deny' }
  })
  // Same policy as the meta tag in index.html, also sent as a response header so it is enforced and Electron can see it.
  const CSP = "default-src 'self'; img-src 'self' data: blob: https: file: plume-plugin:; style-src 'self' 'unsafe-inline' plume-plugin:; script-src 'self' plume-plugin:; font-src 'self' data:; connect-src 'self' ws://localhost:5199 http://localhost:5199"
  win.webContents.session.webRequest.onHeadersReceived((details, cb) => {
    cb({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [CSP] } })
  })
  // Only the app's own file (and, in development, the dev server's exact origin) may load in the window.
  // A prefix check let http://localhost.evil.com and any file: URL through; compare parsed values instead.
  const appFile = path.join(__dirname, '..', 'dist', 'index.html')
  const devOrigin = isDev ? new URL(process.env.VITE_DEV_URL).origin : null
  const isOwnPage = (url) => {
    try {
      const u = new URL(url)
      if (u.protocol === 'file:') return path.normalize(decodeURIComponent(u.pathname.replace(/^\/([A-Za-z]:)/, '$1'))).toLowerCase() === path.normalize(appFile).toLowerCase()
      return !!devOrigin && u.origin === devOrigin
    } catch {
      return false
    }
  }
  win.webContents.on('will-navigate', (e, url) => {
    if (!isOwnPage(url)) {
      e.preventDefault()
      openSafe(url)
    }
  })
  win.on('closed', () => (win = null))
  // Scripted click-through for QA: PLUME_STEPS=<json file> of [{js?, text?, key?, click?, wait?, shot?}], PLUME_SHOT_DIR=<dir>.
  if (QA && process.env.PLUME_STEPS) {
    const errs = []
    win.webContents.on('console-message', (_e, level, msg) => level >= 2 && errs.push(msg))
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    win.webContents.on('did-finish-load', () => setTimeout(async () => {
      const steps = JSON.parse(fs.readFileSync(process.env.PLUME_STEPS, 'utf8'))
      const dir = process.env.PLUME_SHOT_DIR || '.'
      const out = []
      for (const st of steps) {
        try {
          if (st.js) out.push(await win.webContents.executeJavaScript(st.js))
          if (st.text) for (const ch of st.text) { win.webContents.sendInputEvent({ type: 'keyDown', keyCode: ch }); win.webContents.sendInputEvent({ type: 'char', keyCode: ch }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: ch }) ; await sleep(8) }
          if (st.key) { const mods = st.mods || []; win.webContents.sendInputEvent({ type: 'keyDown', keyCode: st.key, modifiers: mods }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: st.key, modifiers: mods }) }
          if (st.move) win.webContents.sendInputEvent({ type: 'mouseMove', x: st.move.x, y: st.move.y })
          if (st.click) { const { x, y } = st.click; win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 }); win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 }) }
        } catch (e) { errs.push('step ' + JSON.stringify(st).slice(0, 80) + ': ' + e.message) }
        await sleep(st.wait ?? 400)
        if (st.shot) fs.writeFileSync(path.join(dir, st.shot), (await win.webContents.capturePage()).toPNG())
      }
      try { await win.webContents.session.flushStorageData() } catch {}
      console.log('RESULTS:' + JSON.stringify(out))
      console.log('ERRORS:' + JSON.stringify(errs))
      app.exit(0)
    }, 3000))
  }
  if (QA && process.env.PLUME_SMOKE) {
    const errs = []
    win.webContents.on('console-message', (_e, level, msg) => level >= 2 && errs.push(msg))
    win.webContents.on('did-finish-load', () => setTimeout(async () => {
      if (process.env.PLUME_SMOKE_JS) { try { await win.webContents.executeJavaScript(process.env.PLUME_SMOKE_JS) } catch (e) { errs.push('smokejs: ' + e.message) } await new Promise((r) => setTimeout(r, 2500)) }
      const img = await win.webContents.capturePage()
      fs.writeFileSync(process.env.PLUME_SMOKE, img.toPNG())
      console.log('ERRORS:' + JSON.stringify(errs))
      app.exit(0)
    }, 3500))
  }
}

const readDirTree = (dir, depth = 0) => {
  let entries = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((e) => !e.name.startsWith('.') && e.name !== 'node_modules')
    .map((e) => {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) return { name: e.name, path: full, dir: true, children: depth < 6 ? readDirTree(full, depth + 1) : [] }
      return OPENABLE(e.name) ? { name: e.name, path: full, dir: false } : null
    })
    .filter(Boolean)
    .filter((n) => !n.dir || n.children.length)
    .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1))
}

const mdFilters = [
  { name: 'Documents', extensions: ['md', 'markdown', 'mdown', 'mkd', 'txt', 'json', 'csv', 'tsv', 'html', 'yaml', 'yml', 'xml', 'log', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] },
  { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd'] },
  { name: 'All files', extensions: ['*'] },
]

ipcMain.handle('file:open-dialog', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: mdFilters })
  if (r.canceled) return []
  r.filePaths.forEach((p) => grantQuiet(p))
  return r.filePaths
})
// The ONE grant a renderer can ask for: files dropped on the window (paths from webUtils.getPathForFile).
// A drop is a user gesture the main process cannot see, so it is accepted on trust. Only existing regular files,
// never folders, so page code cannot widen access to a whole directory this way.
ipcMain.handle('grant:dropped', (_e, paths) => {
  const out = []
  for (const p of Array.isArray(paths) ? paths.slice(0, 50) : []) {
    try {
      if (typeof p === 'string' && fs.statSync(p).isFile()) { grants.grant(p); out.push(p) }
    } catch {}
  }
  return out // the paths that were granted
})
// opts.maxBytes reads only the start of a file (the read-only preview of a very large one), cut back to a whole line.
ipcMain.handle('file:read', (_e, p, opts = {}) => {
  need(p)
  const size = fs.statSync(p).size
  let buf
  if (opts.maxBytes && size > opts.maxBytes) {
    buf = Buffer.alloc(opts.maxBytes)
    const fd = fs.openSync(p, 'r')
    try { fs.readSync(fd, buf, 0, opts.maxBytes, 0) } finally { fs.closeSync(fd) }
    const nl = buf.lastIndexOf(0x0a)
    if (nl > 0) buf = buf.subarray(0, nl + 1)
  } else buf = fs.readFileSync(p)
  const d = opts.encoding ? textio.decodeAs(buf, opts.encoding) : textio.decode(buf)
  return { path: p, name: path.basename(p), size, truncated: buf.length < size, binary: d.binary, content: d.content, encoding: d.encoding, eol: d.eol, mixedEol: d.mixedEol }
})
// Log follow: the whole lines added after byte offset `from` (a half-written last line waits for its newline).
ipcMain.handle('file:read-tail', (_e, p, from, encoding) => {
  need(p)
  const st = fs.statSync(p)
  const base = { size: st.size, mtimeMs: st.mtimeMs, consumed: from, content: '' }
  if (/^utf-16/.test(encoding || '')) return { ...base, unsupported: true }
  if (st.size < from) return { ...base, reset: true }
  if (st.size === from) return base
  const len = Math.min(st.size - from, 8 * 1024 * 1024)
  let buf = Buffer.alloc(len)
  const fd = fs.openSync(p, 'r')
  try { fs.readSync(fd, buf, 0, len, from) } finally { fs.closeSync(fd) }
  const nl = buf.lastIndexOf(0x0a)
  if (nl < 0) return base
  buf = buf.subarray(0, nl + 1)
  const label = !encoding || encoding === 'utf-8-bom' ? 'utf-8' : encoding
  let d
  try { d = textio.decodeAs(buf, label) } catch { d = textio.decodeAs(buf, 'utf-8') }
  return { ...base, content: d.content, consumed: from + buf.length }
})
ipcMain.handle('file:create', (_e, dir, name) => {
  const dest = path.join(dir, name)
  need(dest)
  if (fs.existsSync(dest)) throw new Error('exists')
  fs.writeFileSync(dest, '', { flag: 'wx' }) // wx: fails if the file appeared since the check, never truncates an existing one
  return dest
})
ipcMain.handle('file:rename', (_e, from, to) => {
  need(from)
  need(to)
  if (fs.existsSync(to)) throw new Error('exists')
  fs.renameSync(from, to)
  return to
})
ipcMain.handle('file:trash', async (_e, p) => {
  need(p)
  await shell.trashItem(p)
  return true
})
// Folder search: runs in a worker thread (electron/searchworker.cjs), streams hits in batches, one search at a time.
// The renderer's query is only ever used as a plain string (or, in regex mode, inside the worker, which is killed on cancel or after SEARCH_TIMEOUT_MS).
const SEARCH_TIMEOUT_MS = 20000
let searchRun = null // { id, worker, timer }
const stopSearch = () => {
  if (!searchRun) return
  clearTimeout(searchRun.timer)
  const w = searchRun.worker
  searchRun = null
  w.removeAllListeners()
  w.on('error', () => {})
  w.terminate()
}
ipcMain.on('folder:search-cancel', () => stopSearch())
ipcMain.on('folder:search-start', (e, id, dir, query, opts) => {
  stopSearch()
  const sender = e.sender
  const send = (m) => { if (!sender.isDestroyed()) sender.send('folder:search-batch', { id, ...m }) }
  try {
    if (typeof id !== 'number' || typeof dir !== 'string' || typeof query !== 'string' || !query || query.length > 500 || !path.isAbsolute(dir)) throw new Error('bad args')
    need(dir, { folder: true })
    const root = fs.realpathSync(dir)
    if (!fs.statSync(root).isDirectory()) throw new Error('not a folder')
    opts = opts || {}
    const t0 = process.hrtime.bigint()
    const { Worker } = require('node:worker_threads')
    const worker = new Worker(path.join(__dirname, 'searchworker.cjs'), {
      workerData: {
        dir: root, query, matchCase: !!opts.matchCase, regex: !!opts.regex,
        extOk: [...MD_EXT, ...TEXT_EXT], maxHits: 200, maxBytes: 2_000_000, maxDepth: 12,
      },
    })
    const run = { id, worker, timer: setTimeout(() => { if (searchRun === run) { stopSearch(); send({ hits: [], done: true, timedOut: true }) } }, SEARCH_TIMEOUT_MS) }
    searchRun = run
    let firstAt = null
    worker.on('message', (m) => {
      if (searchRun !== run) return
      if (m.hits && m.hits.length && firstAt === null) firstAt = Number(process.hrtime.bigint() - t0) / 1e6
      send(m)
      if (m.done) {
        if (QA && process.env.PLUME_SEARCH_LOG) console.log('SEARCHT ' + JSON.stringify({ firstHitMs: firstAt && Math.round(firstAt), totalMs: Math.round(Number(process.hrtime.bigint() - t0) / 1e6), files: m.files, capped: !!m.capped }))
        clearTimeout(run.timer)
        searchRun = null
      }
    })
    worker.on('error', () => { if (searchRun === run) { stopSearch(); send({ hits: [], done: true, failed: true }) } })
  } catch {
    send({ hits: [], done: true, failed: true })
  }
})
ipcMain.handle('file:write', (_e, p, content, fmt = {}) => {
  need(p)
  if (typeof content !== 'string') throw new Error('nothing to write') // never write "undefined" or an object over a file
  writeAtomic(p, textio.encode(content, fmt.encoding, fmt.eol)) // temp file + rename: a failed write leaves the original intact
  return true
})
// Binary save (the Excel viewer): same grant check as file:write, written to a temp file then renamed so a crash never leaves a half file.
ipcMain.handle('file:write-bytes', (_e, p, bytes) => {
  need(p)
  if (!(bytes instanceof Uint8Array) || !bytes.length) throw new Error('nothing to write')
  const tmp = p + '.plume-tmp'
  try {
    fs.writeFileSync(tmp, bytes)
    fs.renameSync(tmp, p)
  } catch (e) {
    try { fs.unlinkSync(tmp) } catch {}
    throw e
  }
  return true
})
ipcMain.handle('file:save-dialog', async (_e, suggested) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: suggested || 'Untitled.md', filters: mdFilters })
  if (r.canceled) return null
  grantQuiet(r.filePath)
  return r.filePath
})
ipcMain.handle('folder:open-dialog', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
  if (r.canceled) return null
  grantQuiet(r.filePaths[0], { folder: true })
  return r.filePaths[0]
})
ipcMain.handle('folder:tree', (_e, dir) => {
  need(dir, { folder: true })
  return { root: dir, name: path.basename(dir), children: readDirTree(dir) }
})
ipcMain.handle('file:reveal', (_e, p) => {
  need(p)
  return shell.showItemInFolder(p)
})
ipcMain.handle('file:stat', (_e, p) => {
  need(p)
  try {
    const st = fs.statSync(p)
    return { mtimeMs: st.mtimeMs, size: st.size }
  } catch {
    return null
  }
})
// Whole-file bytes for the PDF, Word and Excel viewers. Capped so one request cannot exhaust memory.
const BYTES_MAX = 512 * 1024 * 1024
ipcMain.handle('file:read-bytes', (_e, p) => {
  need(p)
  const st = fs.statSync(p)
  if (!st.isFile()) throw new Error('not a file')
  if (st.size > BYTES_MAX) throw new Error('file too large to open')
  return fs.readFileSync(p)
})
ipcMain.handle('file:read-image', (_e, p) => {
  need(p)
  try {
    const ext = path.extname(p).slice(1).toLowerCase().replace('jpg', 'jpeg').replace('svg', 'svg+xml')
    return `data:image/${ext};base64,${fs.readFileSync(p).toString('base64')}`
  } catch {
    return null
  }
})
ipcMain.handle('file:save-image', (_e, dir, name, base64) => {
  // A plain file name only: no separators, no '..', no drive letters. Nothing from the page can write outside assets/.
  if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name) || name.includes('..')) throw new Error('bad image name')
  const out = path.join(dir, 'assets')
  const target = path.join(out, name)
  if (!grants.isAssetWrite(target)) need(target) // a granted file may write images to its own assets/ folder
  fs.mkdirSync(out, { recursive: true })
  const dest = path.join(out, name)
  fs.writeFileSync(dest, Buffer.from(base64, 'base64'), { flag: 'wx' }) // never overwrite an image that is already there
  return 'assets/' + name
})
ipcMain.handle('export:html', async (_e, html, suggested) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: suggested, filters: [{ name: 'HTML', extensions: ['html'] }] })
  if (r.canceled) return null
  fs.writeFileSync(r.filePath, html, 'utf8')
  return r.filePath
})
ipcMain.handle('export:pdf', async (_e, suggested) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: suggested, filters: [{ name: 'PDF', extensions: ['pdf'] }] })
  if (r.canceled) return null
  const data = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4' })
  fs.writeFileSync(r.filePath, data)
  return r.filePath
})
ipcMain.handle('app:take-pending-open', () => {
  const p = pendingOpen
  pendingOpen = null
  return p || null
})
ipcMain.handle('app:set-title', (_e, t) => win && win.setTitle(t))
ipcMain.handle('app:set-theme-bg', (_e, color, dark) => {
  if (!win) return
  win.setBackgroundColor(color)
  nativeTheme.themeSource = dark ? 'dark' : 'light'
  try {
    fs.writeFileSync(bgFile(), JSON.stringify({ color, dark: !!dark }))
  } catch {}
})
ipcMain.handle('app:confirm', async (_e, message, detail, buttons) => {
  const r = await dialog.showMessageBox(win, { type: 'question', message, detail, buttons, defaultId: 0, cancelId: buttons.length - 1 })
  return r.response
})
ipcMain.handle('app:devtools', () => win && win.webContents.toggleDevTools())
// The one non-web link that leaves the app: the Windows Default apps page. A fixed string, nothing from the renderer, Windows only.
ipcMain.on('edit:paste', (e) => e.sender.paste())
ipcMain.handle('app:open-default-apps', async () => {
  if (process.platform !== 'win32') return false
  try {
    await shell.openExternal('ms-settings:defaultapps?registeredAppUser=Plume')
    return true
  } catch {
    return false
  }
})

// Developer menu items: one fixed file in userData, created with an example on first use. No argument, so the renderer cannot choose a path.
// The renderer validates the entries; only a fixed list of actions is allowed there.
const MENU_ITEMS_EXAMPLE = JSON.stringify([
  { id: 'zoom-reset', label: 'Back to normal size', action: 'command', value: 'view.zoomReset' },
  { id: 'greeting', label: 'Insert greeting', action: 'insertText', value: 'Hello,' },
  { id: 'pick-file', label: 'Open a file', action: 'openFile' },
], null, 2)
ipcMain.handle('app:menu-items', () => {
  try {
    const f = path.join(app.getPath('userData'), 'commands.json')
    if (!fs.existsSync(f)) fs.writeFileSync(f, MENU_ITEMS_EXAMPLE + '\n')
    const st = fs.statSync(f)
    if (!st.isFile() || st.size > 65536) return null
    return fs.readFileSync(f, 'utf8')
  } catch {
    return null
  }
})

// QA only: PLUME_USER_DATA gives this copy its own profile and skips the single-instance lock, so several copies can be tested at once.
if (QA && process.env.PLUME_USER_DATA) app.setPath('userData', process.env.PLUME_USER_DATA)
const gotLock = QA && process.env.PLUME_USER_DATA ? true : app.requestSingleInstanceLock()
if (!gotLock) app.quit()
else {
  app.on('second-instance', (_e, argv) => {
    const f = argv.find((a) => OPENABLE(a))
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
      if (f) { grantQuiet(f); win.webContents.send('open-path', f) } // a file the OS asked us to open
    }
  })
  app.whenReady().then(() => {
    // Reload what the user opened before, so restored tabs and the last folder still open. Then the file the OS launched us with.
    grants.configure(path.join(app.getPath('userData'), 'grants.json'))
    if (pendingOpen) grantQuiet(pendingOpen)
    pluginsIpc && pluginsIpc.register({ app, ipcMain, shell, protocol: require('electron').protocol })
    themesIpc && themesIpc.register({ app, ipcMain, shell })
    updaterIpc && updaterIpc.register({ app, ipcMain, shell, getWindow: () => win })
    createWindow()
  })
  app.on('window-all-closed', () => app.quit())
}
