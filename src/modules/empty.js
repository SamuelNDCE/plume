// Calm empty state. DOM APIs / textContent only (icons come from static header.js strings).
import { ICONS } from './header.js'

const baseName = (s) => s.split(/[\\/]/).pop()
const dirName = (s) => {
  const parts = s.split(/[\\/]/)
  parts.pop()
  return parts.slice(-2).join('/')
}

export function init(app) {
  const root = document.getElementById('empty')
  if (!root) return

  const el = (tag, cls, text) => {
    const n = document.createElement(tag)
    if (cls) n.className = cls
    if (text != null) n.textContent = text
    return n
  }

  function button(icon, label, primary, run) {
    const b = el('button', 'em-btn' + (primary ? ' primary' : ''))
    b.type = 'button'
    const i = el('span', 'em-ico')
    i.innerHTML = icon
    b.append(i, el('span', null, label))
    b.addEventListener('click', run)
    return b
  }

  function render() {
    root.textContent = ''
    const wrap = el('div', 'em-wrap')
    wrap.appendChild(el('h1', 'em-mark', 'Plume'))
    wrap.appendChild(el('p', 'em-tag', 'A quiet place to read and write Markdown.'))

    const row = el('div', 'em-actions')
    row.append(
      button(ICONS.file, 'Open File', true, () => app.actions.openFile()),
      button(ICONS.folder, 'Open Folder', false, () => app.actions.openFolder()),
      button(ICONS.plus, 'New Document', false, () => app.actions.newTab()),
    )
    wrap.appendChild(row)

    const hints = el('div', 'em-hints')
    ;[
      ['Ctrl+O', 'Open a file'],
      ['Ctrl+P', 'Command palette'],
      ['Ctrl+/', 'Toggle rich / source'],
      ['Ctrl+,', 'Settings'],
    ].forEach(([k, t]) => {
      const r = el('div', 'em-hint')
      r.append(el('kbd', null, k), el('span', null, t))
      hints.appendChild(r)
    })
    wrap.appendChild(hints)

    let recent = []
    try {
      recent = (app.recent && app.recent()) || []
    } catch {}
    if (recent.length) {
      const sec = el('div', 'em-recent')
      sec.appendChild(el('div', 'em-h', 'Recent'))
      recent.slice(0, 6).forEach((path) => {
        const r = el('button', 'em-rec')
        r.type = 'button'
        r.title = path
        r.append(el('span', 'em-rec-name', baseName(path)), el('span', 'em-rec-dir', dirName(path)))
        r.addEventListener('click', () => app.actions.openPath(path))
        sec.appendChild(r)
      })
      wrap.appendChild(sec)
    }
    root.appendChild(wrap)
  }

  app.bus.on('empty:show', render)
  if (!root.hidden) render()
}
