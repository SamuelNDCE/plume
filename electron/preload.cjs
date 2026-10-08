const { contextBridge, ipcRenderer } = require('electron')

const inv = (ch) => (...a) => ipcRenderer.invoke(ch, ...a)

contextBridge.exposeInMainWorld('folio', {
  openDialog: inv('file:open-dialog'),
  readFile: inv('file:read'),
  writeFile: inv('file:write'),
  saveDialog: inv('file:save-dialog'),
  openFolderDialog: inv('folder:open-dialog'),
  folderTree: inv('folder:tree'),
  reveal: inv('file:reveal'),
  stat: inv('file:stat'),
  readImage: inv('file:read-image'),
  saveImage: inv('file:save-image'),
  exportHtml: inv('export:html'),
  exportPdf: inv('export:pdf'),
  takePendingOpen: inv('app:take-pending-open'),
  setTitle: inv('app:set-title'),
  setThemeBg: inv('app:set-theme-bg'),
  confirm: inv('app:confirm'),
  devtools: inv('app:devtools'),
  onOpenPath: (cb) => ipcRenderer.on('open-path', (_e, p) => cb(p)),
})
