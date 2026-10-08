// User themes: <userData>/themes/*.json and *.css. Wired by main.cjs via register({ app, ipcMain, shell }).
const fs = require('fs')
const path = require('path')

const MAX_BYTES = 1024 * 1024
const MAX_FILES = 100

const README = `Plume themes
============
Drop theme files in this folder, then run "Reload custom themes" from the command palette.

  *.json   a theme definition (id, name, dark, vars, typography, chart, mermaid)
  *.css    plain CSS injected as-is; optionally start the file with
           /* plume-theme: my-id | My Name | dark */  to list it in the theme gallery

Docs and examples: docs/THEMES.md and examples/themes/ in the Plume repository.
`

function register({ app, ipcMain, shell }) {
  const dir = () => path.join(app.getPath('userData'), 'themes')
  const ensure = () => {
    const d = dir()
    fs.mkdirSync(d, { recursive: true })
    const readme = path.join(d, 'README.txt')
    if (!fs.existsSync(readme)) fs.writeFileSync(readme, README, 'utf8')
    return d
  }

  ipcMain.handle('themes:list', async () => {
    const d = ensure()
    const out = []
    let names = []
    try {
      names = fs.readdirSync(d)
    } catch {
      return out
    }
    for (const file of names.sort()) {
      if (out.length >= MAX_FILES) break
      const ext = path.extname(file).toLowerCase()
      if (ext !== '.json' && ext !== '.css') continue
      try {
        const full = path.join(d, file)
        const st = fs.statSync(full)
        if (!st.isFile() || st.size > MAX_BYTES) continue
        out.push({ file, kind: ext === '.json' ? 'json' : 'css', text: fs.readFileSync(full, 'utf8') })
      } catch {}
    }
    return out
  })

  ipcMain.handle('themes:open-folder', async () => {
    const err = await shell.openPath(ensure())
    return err ? { ok: false, error: err } : { ok: true }
  })
}

module.exports = { register }
