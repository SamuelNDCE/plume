const { contextBridge, ipcRenderer, webUtils } = require('electron')

const inv = (ch) => (...a) => ipcRenderer.invoke(ch, ...a)

contextBridge.exposeInMainWorld('folio', {
  openDialog: inv('file:open-dialog'),
  readFile: inv('file:read'),
  readTail: inv('file:read-tail'),
  writeFile: inv('file:write'),
  writeBytes: inv('file:write-bytes'),
  saveDialog: inv('file:save-dialog'),
  openFolderDialog: inv('folder:open-dialog'),
  folderTree: inv('folder:tree'),
  reveal: inv('file:reveal'),
  createFile: inv('file:create'),
  renameFile: inv('file:rename'),
  trashFile: inv('file:trash'),
  searchStart: (id, dir, query, opts) => ipcRenderer.send('folder:search-start', id, dir, query, opts),
  searchCancel: () => ipcRenderer.send('folder:search-cancel'),
  onSearchBatch: (cb) => ipcRenderer.on('folder:search-batch', (_e, m) => cb(m)),
  stat: inv('file:stat'),
  // Takes File objects only (a File cannot be forged with a disk path), turns them into paths here, and asks main to grant them.
  grantDropped: (files) => {
    const paths = [...(files || [])].filter((f) => f instanceof File).map((f) => webUtils.getPathForFile(f)).filter(Boolean)
    return ipcRenderer.invoke('grant:dropped', paths)
  },
  getUpdateState: inv('update:get'),
  checkUpdates: inv('update:check'),
  downloadUpdate: inv('update:download'),
  installUpdate: inv('update:install'),
  openReleases: inv('update:releases'),
  onUpdateStatus: (cb) => ipcRenderer.on('update:status', (_e, s) => cb(s)),
  listUserThemes: inv('themes:list'),
  openThemesFolder: inv('themes:open-folder'),
  listPlugins: inv('plugins:list'),
  setPluginEnabled: inv('plugins:set-enabled'),
  openPluginsFolder: inv('plugins:open-folder'),
  readImage: inv('file:read-image'),
  readBytes: inv('file:read-bytes'),
  saveImage: inv('file:save-image'),
  exportHtml: inv('export:html'),
  exportPdf: inv('export:pdf'),
  takePendingOpen: inv('app:take-pending-open'),
  setTitle: inv('app:set-title'),
  setThemeBg: inv('app:set-theme-bg'),
  confirm: inv('app:confirm'),
  devtools: inv('app:devtools'),
  platform: process.platform,
  openDefaultApps: inv('app:open-default-apps'),
  menuItems: inv('app:menu-items'),
  // Native paste into the focused field (takes no argument, so the renderer cannot pass data through it).
  paste: () => ipcRenderer.send('edit:paste'),
  onOpenPath: (cb) => ipcRenderer.on('open-path', (_e, p) => cb(p)),
})
