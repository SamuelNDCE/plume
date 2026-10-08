// Shared icons, sidebar toggle, breadcrumb, header actions. DOM APIs only.
const p = (d) => `<path d="${d}"/>`
const svg = (inner) =>
  `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`

// Shared hand-drawn icon set (strings of inline SVG). Other modules may import this.
export const ICONS = {
  files: svg(p('M4 6.5A1.5 1.5 0 0 1 5.5 5h4l2 2.2h7A1.5 1.5 0 0 1 20 8.7V17.5A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5z')),
  outline: svg(p('M5 7h14M5 12h10M5 17h12')),
  search: svg('<circle cx="11" cy="11" r="6"/>' + p('m20 20-4.2-4.2')),
  sidebar: svg('<rect x="4" y="5" width="16" height="14" rx="2"/>' + p('M9.5 5v14')),
  settings: svg(p('M4 8h9M17 8h3M4 16h3M11 16h9') + '<circle cx="15" cy="8" r="2"/><circle cx="9" cy="16" r="2"/>'),
  save: svg(p('M6 4h10l3 3v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z') + p('M8 4v5h7V4M8 20v-6h8v6')),
  find: svg('<circle cx="10.5" cy="10.5" r="5.5"/>' + p('m15 15 4.5 4.5M8.5 10.5h4')),
  command: svg(p('M9 6.5A2.5 2.5 0 1 0 6.5 9H9zm0 0v11m0-11h6m0 0V9m0-2.5A2.5 2.5 0 1 1 17.5 9H15m0 0v6m0 0h2.5A2.5 2.5 0 1 1 15 17.5zm0 0H9m0 0H6.5A2.5 2.5 0 1 0 9 20.5z')),
  present: svg('<rect x="4" y="5" width="16" height="11" rx="1.5"/>' + p('M12 16v3.5M8.5 19.5h7')),
  plus: svg(p('M12 5v14M5 12h14')),
  folder: svg(p('M4 6.5A1.5 1.5 0 0 1 5.5 5h4l2 2.2h7A1.5 1.5 0 0 1 20 8.7V17.5A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5z')),
  file: svg(p('M7 4h7l4 4v11a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z') + p('M14 4v4h4')),
  close: svg(p('M6 6l12 12M18 6 6 18')),
  chevron: svg(p('m9 6 6 6-6 6')),
  trash: svg(p('M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12M10 11v5M14 11v5')),
  edit: svg(p('M5 19l1-4L16.5 4.5a1.8 1.8 0 0 1 2.5 2.5L8.5 17.5z M14.5 6.5l3 3')),
  reveal: svg(p('M14 5h5v5M19 5l-8 8M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4')),
  check: svg(p('m5 12.5 4.5 4.5L19 7.5')),
}

const baseName = (s) => s.split(/[\\/]/).pop()

export function init(app) {
  const $ = (s) => document.querySelector(s)

  /* ---- breadcrumb ---- */
  const crumb = $('#crumb')
  const actions = $('#header-actions')
  const doc = () => app.state.tabs[app.state.active]

  const el = (tag, cls, text) => {
    const n = document.createElement(tag)
    if (cls) n.className = cls
    if (text != null) n.textContent = text
    return n
  }

  function renderCrumb() {
    crumb.textContent = ''
    const d = doc()
    if (!d) return
    if (d.path) {
      const parts = d.path.split(/[\\/]/).filter(Boolean)
      const folders = parts.slice(0, -1).slice(-2)
      folders.forEach((f) => {
        crumb.appendChild(el('span', 'crumb-seg', f))
        crumb.appendChild(el('span', 'crumb-sep', '/'))
      })
    }
    const file = el('span', 'crumb-file', d.name || (d.path ? baseName(d.path) : ''))
    crumb.appendChild(file)
    if (d.dirty) {
      const dot = el('span', 'crumb-dot')
      dot.title = 'Unsaved changes'
      crumb.appendChild(dot)
    }
  }

  /* ---- actions ---- */
  function iconBtn(icon, title, onClick) {
    const b = el('button', 'icon-btn')
    b.type = 'button'
    b.title = title
    b.setAttribute('aria-label', title)
    b.innerHTML = icon
    b.addEventListener('click', onClick)
    return b
  }

  function renderActions() {
    actions.textContent = ''
    const d = doc()
    if (!d) return
    if (d.kind === 'md' || d.kind === 'table') {
      const seg = el('div', 'seg')
      seg.setAttribute('role', 'group')
      const richOn = d.view !== 'source'
      const a = el('button', richOn ? 'on' : '', d.kind === 'table' ? 'Table' : 'Rich')
      const b = el('button', richOn ? '' : 'on', 'Source')
      for (const x of [a, b]) x.type = 'button'
      a.addEventListener('click', () => {
        if (d.view === 'source') app.actions.toggleSource()
      })
      b.addEventListener('click', () => {
        if (d.view !== 'source') app.actions.toggleSource()
      })
      seg.append(a, b)
      actions.appendChild(seg)
      actions.appendChild(el('span', 'hdr-sep'))
    }
    if (d.dirty) actions.appendChild(iconBtn(ICONS.save, 'Save (Ctrl+S)', () => app.actions.save()))
    actions.appendChild(iconBtn(ICONS.find, 'Find (Ctrl+F)', () => app.commands.run('find.open')))
    actions.appendChild(iconBtn(ICONS.command, 'Command palette (Ctrl+P)', () => app.commands.run('palette.open')))
    actions.appendChild(iconBtn(ICONS.present, 'Present', () => app.commands.run('view.presentation')))
    actions.appendChild(iconBtn(ICONS.settings, 'Settings (Ctrl+,)', () => app.commands.run('settings.open')))
  }

  const toggle = iconBtn(ICONS.sidebar, 'Toggle sidebar (Ctrl+\\)', () => app.commands.run('view.sidebar'))
  toggle.id = 'sidebar-toggle'
  const syncToggle = () => toggle.classList.toggle('on', !!app.settings.get('sidebar'))
  syncToggle()
  app.bus.on('settings:change', ({ key }) => {
    if (key === 'sidebar') syncToggle()
  })
  const headerEl = $('#header')
  if (headerEl) headerEl.insertBefore(toggle, headerEl.firstChild)

  const render = () => {
    renderCrumb()
    renderActions()
  }
  let timer = null
  const later = () => {
    clearTimeout(timer)
    timer = setTimeout(render, 150)
  }
  for (const evt of ['tab:switch', 'tab:list', 'file:saved', 'mode:change']) app.bus.on(evt, render)
  app.bus.on('doc:change', later)
  render()
}
