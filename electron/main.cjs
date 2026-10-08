const { app, BrowserWindow, ipcMain, dialog, shell, Menu, nativeTheme } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const isDev = !!process.env.VITE_DEV_URL
const MD_EXT = new Set(['.md', '.markdown', '.mdown', '.mkd'])
const IMG_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.avif'])
const TEXT_EXT = new Set(['.txt', '.text', '.log', '.json', '.jsonc', '.json5', '.csv', '.tsv', '.xml', '.yaml', '.yml', '.toml', '.ini', '.conf', '.cfg', '.html', '.htm', '.css', '.scss', '.less', '.js', '.mjs', '.cjs', '.ts', '.jsx', '.tsx', '.vue', '.svelte', '.py', '.rs', '.go', '.java', '.kt', '.c', '.h', '.cpp', '.hpp', '.cs', '.rb', '.php', '.sh', '.bash', '.zsh', '.bat', '.cmd', '.ps1', '.sql', '.lua', '.swift', '.tex', '.rst', '.org', '.diff', '.patch', '.gitignore', '.env.example', '.mdx'])
const OPENABLE = (p) => { const e = path.extname(p).toLowerCase(); return MD_EXT.has(e) || TEXT_EXT.has(e) || IMG_EXT.has(e) }
let win = null
let pendingOpen = process.argv.slice(app.isPackaged ? 1 : 2).find((a) => OPENABLE(a))

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 640,
    minHeight: 420,
    backgroundColor: '#ffffff',
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
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file:') && !url.startsWith('http://localhost')) {
      e.preventDefault()
      openSafe(url)
    }
  })
  win.on('closed', () => (win = null))
  if (process.env.PLUME_SMOKE) {
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
  return r.canceled ? [] : r.filePaths
})
ipcMain.handle('file:read', (_e, p) => {
  const buf = fs.readFileSync(p)
  const binary = buf.subarray(0, 8000).includes(0)
  return { path: p, name: path.basename(p), size: buf.length, binary, content: binary ? '' : buf.toString('utf8') }
})
ipcMain.handle('file:create', (_e, dir, name) => {
  const dest = path.join(dir, name)
  if (fs.existsSync(dest)) throw new Error('exists')
  fs.writeFileSync(dest, '')
  return dest
})
ipcMain.handle('file:rename', (_e, from, to) => {
  if (fs.existsSync(to)) throw new Error('exists')
  fs.renameSync(from, to)
  return to
})
ipcMain.handle('file:trash', async (_e, p) => {
  await shell.trashItem(p)
  return true
})
ipcMain.handle('folder:search', (_e, dir, query, opts = {}) => {
  const out = []
  let re
  try {
    re = new RegExp(opts.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), opts.matchCase ? '' : 'i')
  } catch {
    return []
  }
  const walk = (d, depth) => {
    if (out.length >= 300 || depth > 8) return
    let ents = []
    try { ents = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue
      const full = path.join(d, e.name)
      if (e.isDirectory()) walk(full, depth + 1)
      else if (OPENABLE(e.name) && !IMG_EXT.has(path.extname(e.name).toLowerCase())) {
        let st
        try { st = fs.statSync(full) } catch { continue }
        if (st.size > 2_000_000) continue
        let text
        try { text = fs.readFileSync(full, 'utf8') } catch { continue }
        const lines = text.split(/\r?\n/)
        for (let i = 0; i < lines.length && out.length < 300; i++) {
          if (re.test(lines[i])) out.push({ path: full, name: e.name, line: i + 1, text: lines[i].trim().slice(0, 200) })
        }
      }
    }
  }
  walk(dir, 0)
  return out
})
ipcMain.handle('file:write', (_e, p, content) => {
  fs.writeFileSync(p, content, 'utf8')
  return true
})
ipcMain.handle('file:save-dialog', async (_e, suggested) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: suggested || 'Untitled.md', filters: mdFilters })
  return r.canceled ? null : r.filePath
})
ipcMain.handle('folder:open-dialog', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
  return r.canceled ? null : r.filePaths[0]
})
ipcMain.handle('folder:tree', (_e, dir) => ({ root: dir, name: path.basename(dir), children: readDirTree(dir) }))
ipcMain.handle('file:reveal', (_e, p) => shell.showItemInFolder(p))
ipcMain.handle('file:stat', (_e, p) => {
  try {
    return { mtimeMs: fs.statSync(p).mtimeMs }
  } catch {
    return null
  }
})
ipcMain.handle('file:read-image', (_e, p) => {
  try {
    const ext = path.extname(p).slice(1).toLowerCase().replace('jpg', 'jpeg').replace('svg', 'svg+xml')
    return `data:image/${ext};base64,${fs.readFileSync(p).toString('base64')}`
  } catch {
    return null
  }
})
ipcMain.handle('file:save-image', (_e, dir, name, base64) => {
  const out = path.join(dir, 'assets')
  fs.mkdirSync(out, { recursive: true })
  const dest = path.join(out, name)
  fs.writeFileSync(dest, Buffer.from(base64, 'base64'))
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
})
ipcMain.handle('app:confirm', async (_e, message, detail, buttons) => {
  const r = await dialog.showMessageBox(win, { type: 'question', message, detail, buttons, defaultId: 0, cancelId: buttons.length - 1 })
  return r.response
})
ipcMain.handle('app:devtools', () => win && win.webContents.toggleDevTools())

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()
else {
  app.on('second-instance', (_e, argv) => {
    const f = argv.find((a) => OPENABLE(a))
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
      if (f) win.webContents.send('open-path', f)
    }
  })
  app.whenReady().then(createWindow)
  app.on('window-all-closed', () => app.quit())
}
