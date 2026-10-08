// In-app updates, backed by GitHub Releases (electron-updater).
// Nothing here runs on its own: the renderer asks for a check (on launch if the user left "Check for updates" on,
// or from Settings / the command palette). No check means no network request.
const RELEASES_URL = 'https://github.com/SamuelNDCE/plume/releases/latest'

let state = { state: 'idle', current: '', canInstall: false }
let win = null
let updater = null

function setState(patch) {
  state = { ...state, ...patch }
  if (win && !win.isDestroyed()) win.webContents.send('update:status', state)
}

// Installing in place works for the Windows installer build and the Linux AppImage. The portable exe, the .deb and
// unsigned macOS builds cannot self-install, so for those the user is sent to the download page instead.
function canSelfInstall() {
  if (process.platform === 'win32') return !process.env.PORTABLE_EXECUTABLE_FILE
  if (process.platform === 'linux') return !!process.env.APPIMAGE
  return false
}

function load() {
  if (updater) return updater
  try {
    updater = require('electron-updater').autoUpdater
  } catch (e) {
    console.error('[updater] unavailable', e)
    return null
  }
  updater.autoDownload = false
  updater.autoInstallOnAppQuit = true
  updater.allowPrerelease = false
  const testUrl = process.env.PLUME_UPDATE_URL // test hook: point at a local generic feed
  if (testUrl) {
    updater.forceDevUpdateConfig = true
    updater.setFeedURL({ provider: 'generic', url: testUrl })
  }
  updater.on('checking-for-update', () => setState({ state: 'checking', error: undefined }))
  updater.on('update-available', (info) => setState({ state: 'available', version: info.version, notes: typeof info.releaseNotes === 'string' ? info.releaseNotes.slice(0, 4000) : '' }))
  updater.on('update-not-available', () => setState({ state: 'none', checkedAt: Date.now() }))
  updater.on('download-progress', (p) => setState({ state: 'downloading', percent: Math.round(p.percent || 0) }))
  updater.on('update-downloaded', (info) => setState({ state: 'ready', version: info.version, percent: 100 }))
  updater.on('error', (err) => setState({ state: 'error', error: String((err && err.message) || err).slice(0, 300) }))
  return updater
}

function register({ app, ipcMain, shell, getWindow }) {
  const active = () => app.isPackaged || !!process.env.PLUME_UPDATE_URL
  state = { ...state, current: app.getVersion(), canInstall: canSelfInstall(), supported: active() }

  ipcMain.handle('update:get', () => {
    win = getWindow()
    return state
  })
  ipcMain.handle('update:check', async () => {
    win = getWindow()
    if (!active()) {
      setState({ state: 'none', note: 'Updates are only checked in installed builds.' })
      return state
    }
    const u = load()
    if (!u) {
      setState({ state: 'error', error: 'Updater is not available in this build.' })
      return state
    }
    try {
      await u.checkForUpdates()
    } catch (e) {
      setState({ state: 'error', error: String((e && e.message) || e).slice(0, 300) })
    }
    return state
  })
  ipcMain.handle('update:download', async () => {
    win = getWindow()
    if (!state.canInstall) {
      shell.openExternal(RELEASES_URL)
      return state
    }
    const u = load()
    if (!u) return state
    try {
      setState({ state: 'downloading', percent: 0 })
      await u.downloadUpdate()
    } catch (e) {
      setState({ state: 'error', error: String((e && e.message) || e).slice(0, 300) })
    }
    return state
  })
  ipcMain.handle('update:install', () => {
    const u = load()
    if (u && state.state === 'ready') u.quitAndInstall(true, true)
    return true
  })
  ipcMain.handle('update:releases', () => {
    shell.openExternal(RELEASES_URL)
    return true
  })
}

module.exports = { register }
