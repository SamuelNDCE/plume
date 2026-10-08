const { app, BrowserWindow, ipcMain, dialog, shell, Menu, nativeTheme } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const isDev = !!process.env.VITE_DEV_URL
const MD_EXT = new Set(['.md', '.markdown', '.mdown', '.txt'])
let win = null
let pendingOpen = process.argv.slice(app.isPackaged ? 1 : 2).find((a) => MD_EXT.has(path.extname(a).toLowerCase()))

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 640,
    minHeight: 420,
    backgroundColor: '#ffffff',
    title: 'Lumenmark',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })
  Menu.setApplicationMenu(null)
  if (isDev) win.loadURL(process.env.VITE_DEV_URL)
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file:') && !url.startsWith('http://localhost')) {
      e.preventDefault()
      shell.openExternal(url)
    }
  })
  win.on('closed', () => (win = null))
  if (process.env.LUMEN_SMOKE) {
    const errs = []
    win.webContents.on('console-message', (_e, level, msg) => level >= 2 && errs.push(msg))
    win.webContents.on('did-finish-load', () => setTimeout(async () => {
      if (process.env.LUMEN_SMOKE_JS) { try { await win.webContents.executeJavaScript(process.env.LUMEN_SMOKE_JS) } catch (e) { errs.push('smokejs: ' + e.message) } await new Promise((r) => setTimeout(r, 2500)) }
      const img = await win.webContents.capturePage()
      fs.writeFileSync(process.env.LUMEN_SMOKE, img.toPNG())
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
      return MD_EXT.has(path.extname(e.name).toLowerCase()) ? { name: e.name, path: full, dir: false } : null
    })
    .filter(Boolean)
    .filter((n) => !n.dir || n.children.length)
    .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1))
}

const mdFilters = [
  { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'txt'] },
  { name: 'All files', extensions: ['*'] },
]

ipcMain.handle('file:open-dialog', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: mdFilters })
  return r.canceled ? [] : r.filePaths
})
ipcMain.handle('file:read', (_e, p) => ({ path: p, content: fs.readFileSync(p, 'utf8'), name: path.basename(p) }))
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
    const f = argv.find((a) => MD_EXT.has(path.extname(a).toLowerCase()))
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
      if (f) win.webContents.send('open-path', f)
    }
  })
  app.whenReady().then(createWindow)
  app.on('window-all-closed', () => app.quit())
}
