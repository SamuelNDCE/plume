// Packaged-build check that never shows a window. Runs the real main.cjs from an app.asar with every BrowserWindow forced hidden,
// waits for the first window to paint, then writes the page text and a screenshot to OUT_DIR. Nothing appears on screen.
// Usage (from the repo, after `npx electron-builder --win --dir`):
//   OUT_DIR=<folder> MAIN_CJS=release/win-unpacked/resources/app.asar/electron/main.cjs node_modules/electron/dist/electron.exe tests/packaged-hidden.cjs <file.pdf>
// Output: <OUT_DIR>/main-test.log (window count, body text, console errors) and <OUT_DIR>/main-hidden.png.
// Note: this runs the dev Electron binary, so it checks the app code and its asar, not the fuses of Plume.exe (read those with @electron/fuses).
const electron = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const OUT = process.env.OUT_DIR
const MAIN = process.env.MAIN_CJS
if (!OUT || !MAIN) {
  console.error('set OUT_DIR and MAIN_CJS (see the header of this file)')
  process.exit(2)
}
const Orig = electron.BrowserWindow
class Hidden extends Orig {
  constructor(o = {}) { super({ ...o, show: false, skipTaskbar: true }) }
  show() {}
  showInactive() {}
}
electron.BrowserWindow = Hidden
const log = []
require(path.resolve(MAIN)) // before ready: main.cjs registers schemes at load time
electron.app.whenReady().then(() => {
  setTimeout(async () => {
    const wins = Orig.getAllWindows()
    log.push('windows: ' + wins.length)
    const w = wins[0]
    if (w) {
      w.webContents.on('console-message', (_e, lvl, msg) => { if (lvl >= 2) log.push('console ' + msg) })
      const txt = await w.webContents.executeJavaScript('document.body.innerText.slice(0,200) + " | nodes=" + document.querySelectorAll("*").length').catch((e) => 'js error ' + e.message)
      log.push('body: ' + txt)
      fs.writeFileSync(path.join(OUT, 'main-hidden.png'), (await w.webContents.capturePage()).toPNG())
    }
    fs.writeFileSync(path.join(OUT, 'main-test.log'), log.join('\n') + '\n')
    electron.app.exit(0)
  }, 9000)
})
