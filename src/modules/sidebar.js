// Sidebar: a slim icon rail (#rail: menu, Files, Search, Pages, Settings) next to the left bar (#sidebar): open files, folder tree
// and recent (Files), or Search. The bar is closed by default; the Files icon or the header toggle extends it, hovering the Files icon
// shows it as a temporary overlay.
// Search renders into its own pane; this module shows the one chosen in settings (a saved 'outline' means files).
// While a PDF is open (body.pdf-pages, set by pdfview.js) the pane shows the page thumbnails and the rail's Pages button is active.
// Relies only on the app contract in src/app.js. Output is built with DOM APIs (static SVG strings are the only innerHTML).

import WELCOME from '../welcome.md?raw'
import { leave } from './leave.js'

const TITLES = { files: 'Files', search: 'Search' }
const PANE_IDS = { files: 'files-pane', search: 'search-pane' }
const IMG_EXT = /^(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i

export function init(app) {
  const $ = (s) => document.querySelector(s)
  const tabsEl = $('#sidebar-tabs')
  const actionsEl = $('#sidebar-actions')
  const filesPane = $('#files-pane')
  const sideEl = $('#sidebar')
  if (!tabsEl || !filesPane || !sideEl) return

  const collapsed = new Set() // folder paths the user collapsed
  let pending = null // { mode: 'create', dir } | { mode: 'rename', path }
  let filterText = ''
  let refreshTimer = null

  /* ---------- helpers ---------- */
  const el = (tag, cls, text) => {
    const n = document.createElement(tag)
    if (cls) n.className = cls
    if (text != null) n.textContent = text
    return n
  }
  const miniBtn = (text, onClick, cls = 'lib-mini') => {
    const b = el('button', cls, text)
    b.type = 'button'
    b.addEventListener('click', onClick)
    return b
  }
  const sepOf = (p) => (p.includes('\\') ? '\\' : '/')
  const dirOf = (p) => p.slice(0, Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')))
  const baseOf = (p) => p.split(/[\\/]/).pop()
  const isOpenPath = (p) => app.state.tabs.some((t) => t.path === p)
  const activePath = () => {
    const t = app.state.tabs[app.state.active]
    return t ? t.path : null
  }
  const badge = (name) => {
    const m = /\.([^.]+)$/.exec(name)
    if (!m) return 'FILE'
    return IMG_EXT.test(m[1]) ? 'IMG' : m[1].slice(0, 4).toUpperCase()
  }
  const errText = (e) => (e && e.message === 'exists' ? 'a file with that name already exists' : (e && e.message) || 'unknown error')

  /* ---------- context menu (one shared floating menu) ---------- */
  let menuEl = null
  function closeMenu() {
    if (menuEl) {
      menuEl.remove()
      menuEl = null
    }
  }
  function openMenu(x, y, items) {
    closeMenu()
    menuEl = el('div', 'lib-menu')
    menuEl.setAttribute('role', 'menu')
    for (const it of items) {
      const b = el('button', 'lib-menu-item' + (it.danger ? ' danger' : ''), it.label)
      b.type = 'button'
      b.setAttribute('role', 'menuitem')
      b.addEventListener('click', () => {
        closeMenu()
        it.run()
      })
      menuEl.appendChild(b)
    }
    document.body.appendChild(menuEl)
    const r = menuEl.getBoundingClientRect()
    menuEl.style.left = Math.max(4, Math.min(x, window.innerWidth - r.width - 4)) + 'px'
    menuEl.style.top = Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) + 'px'
  }
  document.addEventListener('mousedown', (e) => {
    if (menuEl && !menuEl.contains(e.target)) closeMenu()
  })
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenu()
  })
  window.addEventListener('blur', closeMenu)
  window.addEventListener('resize', closeMenu)

  /* ---------- static structure (built once so the filter keeps focus) ---------- */
  filesPane.textContent = ''

  // OPEN
  const openSec = el('section', 'lib-section')
  const openList = el('div', 'lib-list')
  openSec.append(el('div', 'lib-title', 'OPEN'), openList)

  // FOLDER
  const folderSec = el('section', 'lib-section')
  const folderHead = el('div', 'lib-folder-head')
  const folderName = el('span', 'lib-folder-name')
  folderHead.append(folderName, miniBtn('Refresh', () => app.actions.refreshFolder()))
  const filter = el('input', 'lib-filter')
  filter.type = 'search'
  filter.placeholder = 'Filter files…'
  filter.setAttribute('aria-label', 'Filter files by name')
  filter.addEventListener('input', () => {
    filterText = filter.value
    renderFolder()
  })
  const treeEl = el('div', 'lib-tree')
  treeEl.setAttribute('role', 'tree')
  treeEl.addEventListener('contextmenu', (e) => {
    if (e.defaultPrevented || !app.state.folder) return
    e.preventDefault()
    openMenu(e.clientX, e.clientY, [{ label: 'New File Here', run: () => startCreate(app.state.folder.root) }])
  })
  const noFolder = el('div', 'lib-nofolder')
  noFolder.append(el('p', 'lib-empty', 'No folder open. Open a folder to browse its files.'))
  folderSec.append(el('div', 'lib-title', 'FOLDER'), noFolder, folderHead, filter, treeEl)

  // two side by side buttons: Open file (primary) and Open folder (quiet)
  const actions = el('div', 'lib-actions')
  actions.append(miniBtn('Open file', () => app.actions.openFile(), 'lib-btn primary'), miniBtn('Open folder', () => app.actions.openFolder(), 'lib-btn'))
  filesPane.append(actions, openSec, folderSec)

  // RECENT
  const recentSec = el('section', 'lib-section')
  const recentList = el('div', 'lib-list')
  recentSec.append(el('div', 'lib-title', 'RECENT'), recentList)
  filesPane.appendChild(recentSec)

  // New and Open moved to the rail; the old header tab strip and action buttons are not used any more.
  tabsEl.hidden = true
  if (actionsEl) actionsEl.remove()
  const titleEl = el('h2', 'sidebar-title')
  titleEl.id = 'sidebar-title'
  const headEl = $('#sidebar-head')
  if (headEl) headEl.appendChild(titleEl)

  /* ---------- open documents ---------- */
  function docRow(t, i) {
    const row = el('div', 'doc-row' + (i === app.state.active ? ' active' : '') + (t.dirty ? ' dirty' : ''))
    row.title = t.path || t.name
    const close = el('button', 'doc-close', '×')
    close.type = 'button'
    close.title = 'Close'
    close.setAttribute('aria-label', 'Close ' + t.name)
    close.addEventListener('click', (e) => {
      e.stopPropagation()
      app.actions.closeTab(i)
    })
    const open = el('button', 'doc-open')
    open.type = 'button'
    open.append(el('span', 'doc-glyph', badge(t.name)), el('span', 'doc-name', t.name))
    row.append(open, close)
    row.addEventListener('click', () => app.actions.switchTab(i))
    row.addEventListener('mousedown', (e) => {
      if (e.button === 1) e.preventDefault() // stop middle-click autoscroll
    })
    row.addEventListener('auxclick', (e) => {
      if (e.button !== 1) return
      e.preventDefault()
      app.actions.closeTab(i)
    })
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      const items = [
        { label: 'Close', run: () => app.actions.closeTab(i) },
        {
          label: 'Save',
          run: async () => {
            await app.actions.switchTab(i)
            await app.actions.save()
          },
        },
      ]
      if (t.path) items.push({ label: 'Reveal in Explorer', run: () => window.folio.reveal(t.path) })
      openMenu(e.clientX, e.clientY, items)
    })
    return row
  }

  function renderOpen() {
    openList.textContent = ''
    const tabs = app.state.tabs
    if (!tabs.length) {
      openList.appendChild(el('p', 'lib-empty', 'No open documents.'))
      return
    }
    tabs.forEach((t, i) => openList.appendChild(docRow(t, i)))
  }

  /* ---------- folder tree ---------- */
  // Keeps files whose name matches q, and folders that match or contain a match.
  function pruneList(list, q) {
    const out = []
    for (const n of list) {
      const self = n.name.toLowerCase().includes(q)
      if (n.dir) {
        const kids = pruneList(n.children || [], q)
        if (kids.length || self) out.push({ ...n, children: kids })
      } else if (self) out.push(n)
    }
    return out
  }

  function inlineInput(initial, onCommit, onCancel) {
    const input = el('input', 'lib-input')
    input.type = 'text'
    input.value = initial
    input.spellcheck = false
    input.setAttribute('aria-label', 'Name')
    let done = false
    const finish = (commit) => {
      if (done) return
      done = true
      if (commit) onCommit(input.value)
      else onCancel()
    }
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        finish(true)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        finish(false)
      }
    })
    input.addEventListener('blur', () => finish(false))
    input.addEventListener('mousedown', (e) => e.stopPropagation())
    input.addEventListener('click', (e) => e.stopPropagation())
    return input
  }

  // Focus after the row is in the DOM. selectStem selects the name without its extension.
  function focusLater(input, selectStem) {
    setTimeout(() => {
      input.focus()
      const dot = input.value.lastIndexOf('.')
      if (selectStem && dot > 0) input.setSelectionRange(0, dot)
      else input.select()
    }, 0)
  }

  function cancelPending() {
    pending = null
    renderFolder()
  }

  function treeRow(depth, name, path, o) {
    const renaming = pending && pending.mode === 'rename' && pending.path === path
    const row = el('div', 'tree-row' + (o.file ? ' tree-file' : '') + (o.open ? ' open' : '') + (o.active ? ' active' : ''))
    row.style.paddingLeft = 8 + depth * 14 + 'px'
    row.setAttribute('role', 'treeitem')
    row.title = path
    if (o.dir) row.setAttribute('aria-expanded', String(!!o.open))
    row.appendChild(el('span', 'caret', o.dir ? (o.open ? '▾' : '▸') : ''))
    if (renaming) {
      const input = inlineInput(name, (v) => commitRename(path, v), cancelPending)
      row.appendChild(input)
      focusLater(input, true)
      return row
    }
    row.tabIndex = 0
    row.appendChild(el('span', 'tree-name', name))
    row.addEventListener('click', o.onClick)
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        row.click()
      }
    })
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      openMenu(e.clientX, e.clientY, menuItems(path, !!o.dir))
    })
    return row
  }

  function createRow(depth, dir) {
    const row = el('div', 'tree-row tree-new')
    row.style.paddingLeft = 8 + depth * 14 + 'px'
    const input = inlineInput('', (v) => commitCreate(dir, v), cancelPending)
    input.placeholder = 'New file name'
    row.appendChild(input)
    focusLater(input, false)
    return row
  }

  function renderNode(node, depth, q) {
    if (node.dir) {
      const open = q ? true : !collapsed.has(node.path)
      const row = treeRow(depth, node.name, node.path, {
        dir: true,
        open,
        onClick: () => {
          if (collapsed.has(node.path)) collapsed.delete(node.path)
          else collapsed.add(node.path)
          renderFolder()
        },
      })
      treeEl.appendChild(row)
      if (open && pending && pending.mode === 'create' && pending.dir === node.path) treeEl.appendChild(createRow(depth + 1, node.path))
      if (open) for (const c of node.children || []) renderNode(c, depth + 1, q)
      return
    }
    treeEl.appendChild(
      treeRow(depth, node.name, node.path, {
        file: true,
        open: isOpenPath(node.path),
        active: node.path === activePath(),
        onClick: () => app.actions.openPath(node.path),
      }),
    )
  }

  function renderFolder() {
    const root = app.state.folder
    folderHead.hidden = !root
    filter.hidden = !root
    treeEl.hidden = !root
    noFolder.hidden = !!root
    treeEl.textContent = ''
    if (!root) return
    folderName.textContent = root.name
    folderName.title = root.root
    const q = filterText.trim().toLowerCase()
    const kids = q ? pruneList(root.children || [], q) : root.children || []
    if (pending && pending.mode === 'create' && pending.dir === root.root) treeEl.appendChild(createRow(0, root.root))
    if (!kids.length) {
      treeEl.appendChild(el('p', 'lib-empty', q ? 'No files match this filter.' : 'This folder is empty.'))
      return
    }
    for (const c of kids) renderNode(c, 0, q)
  }

  /* ---------- tree actions ---------- */
  function menuItems(path, isDir) {
    const dir = isDir ? path : dirOf(path)
    return [
      { label: 'New File Here', run: () => startCreate(dir) },
      { label: 'Rename', run: () => startRename(path) },
      { label: 'Move to Trash', danger: true, run: () => trash(path, isDir) },
      { label: 'Reveal in Explorer', run: () => window.folio.reveal(path) },
    ]
  }

  function startCreate(dir) {
    collapsed.delete(dir)
    pending = { mode: 'create', dir }
    renderFolder()
  }

  function startRename(path) {
    pending = { mode: 'rename', path }
    renderFolder()
  }

  // Re-point open tabs after a rename or move. newPath null means the file was trashed.
  function retargetAll(oldPath, newPath) {
    const pre = oldPath + sepOf(oldPath)
    for (const t of [...app.state.tabs]) {
      if (!t.path) continue
      if (t.path === oldPath) app.actions.retarget(t.path, newPath)
      else if (t.path.startsWith(pre)) app.actions.retarget(t.path, newPath ? newPath + t.path.slice(oldPath.length) : null)
    }
  }

  async function commitCreate(dir, value) {
    pending = null
    const name = value.trim()
    if (!name || /[\\/]/.test(name)) {
      renderFolder()
      return
    }
    try {
      const dest = await window.folio.createFile(dir, name)
      app.actions.refreshFolder()
      await app.actions.openPath(dest)
    } catch (e) {
      app.toast(`Could not create ${name}: ${errText(e)}`)
      renderFolder()
    }
  }

  async function commitRename(oldPath, value) {
    pending = null
    const name = value.trim()
    const base = baseOf(oldPath)
    if (!name || name === base || /[\\/]/.test(name)) {
      renderFolder()
      return
    }
    const newPath = dirOf(oldPath) + sepOf(oldPath) + name
    try {
      await window.folio.renameFile(oldPath, newPath)
      retargetAll(oldPath, newPath)
      app.actions.refreshFolder()
    } catch (e) {
      app.toast(`Could not rename ${base}: ${errText(e)}`)
      renderFolder()
    }
  }

  async function trash(path, isDir) {
    const name = baseOf(path)
    const r = await window.folio.confirm(
      `Move "${name}" to the Recycle Bin?`,
      isDir ? 'The folder and everything in it will be moved.' : 'You can restore it from the Recycle Bin.',
      ['Move to Trash', 'Cancel'],
    )
    if (r !== 0) return
    try {
      await window.folio.trashFile(path)
      retargetAll(path, null)
      app.actions.refreshFolder()
    } catch (e) {
      app.toast(`Could not move ${name} to the Recycle Bin`)
    }
  }

  // Right-click on the empty tree area is handled by treeEl; rows call preventDefault first.
  filter.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      filter.value = ''
      filterText = ''
      renderFolder()
    }
  })

  /* ---------- recent ---------- */
  function renderRecent() {
    recentList.textContent = ''
    const hidden = new Set(app.settings.get('hiddenRecents') || [])
    const items = (app.recent() || []).filter((p) => !hidden.has(p)).slice(0, 8)
    recentSec.hidden = !items.length
    for (const p of items) {
      const row = el('div', 'doc-row')
      row.title = p
      const x = el('button', 'recent-x')
      x.type = 'button'
      x.setAttribute('aria-label', 'Remove from recent')
      x.title = 'Remove from recent'
      x.innerHTML = '<svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true" focusable="false"><path d="M2 2l8 8M10 2l-8 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>'
      x.addEventListener('click', (e) => {
        e.stopPropagation()
        const cur = app.settings.get('hiddenRecents') || []
        app.settings.set('hiddenRecents', [...cur.filter((q) => q !== p), p].slice(-200))
        renderRecent()
      })
      x.addEventListener('keydown', (e) => e.stopPropagation())
      const open = el('button', 'doc-open')
      open.type = 'button'
      open.append(el('span', 'doc-glyph', badge(baseOf(p))), el('span', 'doc-name', baseOf(p)))
      row.append(open, x)
      row.addEventListener('click', () => app.actions.openPath(p))
      row.addEventListener('keydown', (e) => {
        if ((e.key === 'Delete' || e.key === 'Backspace') && e.target === open) x.click()
      })
      recentList.appendChild(row)
    }
  }

  /* ---------- pane switching ---------- */
  const body = document.body
  const curTab = () => {
    const t = app.settings.get('sidebarTab')
    return TITLES[t] ? t : 'files'
  }
  const pdfPages = () => body.classList.contains('pdf-pages')
  const pagesMode = () => pdfPages() && !body.classList.contains('pages-off')
  const paneShown = () => !!app.settings.get('sidebar') && !body.classList.contains('zen')
  const peeking = () => body.classList.contains('sidebar-peek')

  function showPane(name) {
    const pane = TITLES[name] ? name : 'files'
    for (const [key, id] of Object.entries(PANE_IDS)) {
      const node = document.getElementById(id)
      if (node) node.hidden = key !== pane
    }
  }

  /* ---------- icon rail ---------- */
  const svg = (inner) =>
    `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${inner}</svg>`
  const P = (d) => `<path d="${d}"/>`
  const IC = {
    menu: svg(P('M5 7h14M5 12h14M5 17h14')),
    files: svg(P('M9 4h6l3 3v9a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z') + P('M15 4v3h3') + P('M6 8v11a1 1 0 0 0 1 1h8')),
    search: svg('<circle cx="11" cy="11" r="6"/>' + P('m20 20-4.2-4.2')),
    pages: svg('<rect x="4.5" y="4.5" width="6" height="7" rx="1"/><rect x="13.5" y="4.5" width="6" height="7" rx="1"/><rect x="4.5" y="13.5" width="6" height="6" rx="1"/><rect x="13.5" y="13.5" width="6" height="6" rx="1"/>'),
    help: svg('<circle cx="12" cy="12" r="8"/>' + P('M9.7 9.6a2.4 2.4 0 1 1 3.4 2.2c-.7.4-1.1.9-1.1 1.6') + P('M12 16.7h.01')),
    settings: svg(P('M4 8h9M17 8h3M4 16h3M11 16h9') + '<circle cx="15" cy="8" r="2"/><circle cx="9" cy="16" r="2"/>'),
  }

  const keysOf = (cmd) => {
    const c = cmd && app.commands.list().find((x) => x.id === cmd)
    return c && c.keys ? c.keys.split('|')[0] : ''
  }
  const openHelp = () => {
    app.commands.run('settings.open')
    setTimeout(() => {
      const b = [...document.querySelectorAll('.st-nav-btn')].find((x) => x.textContent === 'Shortcuts')
      if (b) b.click()
    }, 60)
  }

  const railEl = el('nav', 'rail')
  railEl.id = 'rail'
  railEl.setAttribute('aria-label', 'Plume toolbar')
  const railBtns = {}
  const railBtn = (id, label, icon, cmd, onClick, o = {}) => {
    const b = el('button', 'rail-btn')
    b.type = 'button'
    b.dataset.rail = id
    b.setAttribute('aria-label', label)
    b.innerHTML = icon
    const tip = () => {
      const k = o.keys || keysOf(cmd)
      b.dataset.tip = k ? `${label} (${k})` : label
    }
    tip()
    b.addEventListener('pointerenter', tip)
    b.addEventListener('focus', tip)
    b.addEventListener('click', onClick)
    if (o.pane) b.setAttribute('aria-pressed', 'false')
    if (o.hidden) b.hidden = true
    railBtns[id] = b
    return b
  }
  const sep = () => {
    const s = el('span', 'rail-sep')
    s.setAttribute('role', 'separator')
    return s
  }
  let peekOff = false // pages-off was added only for the hover overlay
  const paneClick = (name) => () => {
    peekOff = false
    const shown = paneShown()
    if (shown && !pagesMode() && curTab() === name) return app.settings.set('sidebar', false)
    if (pdfPages()) body.classList.add('pages-off')
    app.settings.set('sidebarTab', name)
    if (!shown) app.settings.set('sidebar', true)
    syncRail()
  }
  const pagesClick = () => {
    if (!pdfPages()) return
    peekOff = false
    const shown = paneShown()
    if (shown && pagesMode()) return app.settings.set('sidebar', false)
    body.classList.remove('pages-off')
    if (!shown) app.settings.set('sidebar', true)
    syncRail()
  }
  // Recent is a section of the Files pane: show the pane and bring that section into view
  function showRecent() {
    peekOff = false
    if (pdfPages()) body.classList.add('pages-off')
    app.settings.set('sidebarTab', 'files')
    if (!paneShown()) app.settings.set('sidebar', true)
    syncRail()
    setTimeout(() => {
      if (!recentSec.hidden) recentSec.scrollIntoView({ block: 'start' })
    }, 0)
  }

  /* ---------- app menu (hamburger) ---------- */
  // Rows point at commands in the registry (label and shortcut come from it), so the menu stays in sync with real commands.
  // A row whose command is not registered is left out. Settings rows read and write the real settings.
  const hasCmd = (id) => app.commands.list().some((c) => c.id === id)
  let lastEditable = null
  const editorEl = () => (lastEditable && lastEditable.isConnected ? lastEditable : document.querySelector('#editor .ProseMirror, #cm-host .cm-content'))
  const refocus = () => {
    const e = editorEl()
    if (e) e.focus()
  }
  const press = (key) => () => {
    refocus()
    const t = document.activeElement || document.body
    t.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true }))
  }
  const openAbout = () => {
    app.commands.run('settings.open')
    setTimeout(() => {
      const b = [...document.querySelectorAll('.st-nav-btn')].find((x) => x.textContent === 'About')
      if (b) b.click()
    }, 60)
  }
  // A row is [label, command id | function | children, shortcut shown when it is not a registry command].
  // Command rows take label shortcut from the registry; a row whose command is not registered is left out.
  const setMode = (want) => () => {
    if ((app.state.mode === 'source') !== (want === 'source')) app.commands.run('view.source')
  }
  // null is a hairline divider between groups. Sub-menus only for views with several, less used choices.
  // First level: the everyday commands of each group, then one labelled drop-down per group; null is a hairline divider.
  const MENU = [
    ['New', 'file.new'], ['Open', 'file.open'], ['Save', 'file.save'], ['Save As', 'file.saveAs'],
    [
      'File',
      [
        ['Open folder', 'file.openFolder'], ['Save All', 'file.saveAll'],
        ['Export', [['As HTML', 'export.html'], ['As PDF', 'export.pdf'], ['Copy as Markdown', 'export.markdown.copy'], ['Copy as HTML', 'export.html.copy'], ['Print', 'export.print']]],
        ['Recent', 'recent.show'], null,
        ['Reveal in File Explorer', 'file.reveal'], ['Close document', 'file.close'],
      ],
    ],
    null,
    ['Undo', press('z'), 'Ctrl+Z'], ['Redo', press('y'), 'Ctrl+Y'], ['Find', 'find.open'], ['Replace', 'find.replace'],
    ['Go to line', 'text.gotoLine'], ['Search in folder', 'search.folder'],
    null,
    [
      'View',
      [
        ['Toggle sidebar', 'view.sidebar'], ['Toggle outline', 'outline.show'], null,
        ['Rich', setMode('rich'), 'Ctrl+/'], ['Source', setMode('source'), 'Ctrl+/'], null,
        ['Zoom in', 'view.zoomIn'], ['Zoom out', 'view.zoomOut'], ['Reset zoom', 'view.zoomReset'],
      ],
    ],
    null,
    ['Insert date and time', 'text.datetime'],
    null,
    ['Help', [['Keyboard shortcuts', 'help.shortcuts'], ['Welcome document', () => app.actions.newTab(WELCOME, 'Welcome.md'), ''], ['About', openAbout, '']]],
  ]

  // The menu is a bar of drop-downs: the hamburger lists File, Edit, View, Insert, Help; a hovered item opens its drop-down to the
  // right, and an item with more options opens a side sub-menu the same way. menuPanels[i] is the panel at depth i.
  let menuPanels = []
  let menuHover = false // opened by hovering the hamburger: closes when the pointer leaves, unless a click keeps it open
  let menuOpenT = 0
  let menuCloseT = 0
  let menuSubT = 0
  let menuTok = 0
  let menuTree = []
  const railMenuOpen = () => menuPanels.length > 0
  function closeRailMenu(refocusBtn) {
    clearTimeout(menuOpenT)
    clearTimeout(menuCloseT)
    clearTimeout(menuSubT)
    menuHover = false
    menuTok++
    if (!menuPanels.length) return
    menuPanels.forEach((p) => leave(p))
    menuPanels = []
    railBtns.menu.setAttribute('aria-expanded', 'false')
    if (refocusBtn) railBtns.menu.focus()
  }
  function closeDeeper(depth) {
    while (menuPanels.length > depth) {
      const p = menuPanels.pop()
      if (p._row) p._row.setAttribute('aria-expanded', 'false')
      leave(p)
    }
  }
  const rowsOf = (items) =>
    items.filter((r) => r === null || Array.isArray(r[1]) || typeof r[1] === 'function' || (typeof r[1] === 'string' && hasCmd(r[1])))
  function openPanel(items, depth, anchor, focusFirst) {
    closeDeeper(depth)
    const panel = el('div', 'rail-menu')
    panel.setAttribute('role', 'menu')
    panel.dataset.depth = String(depth)
    const ar = anchor.getBoundingClientRect()
    let prevDiv = true
    for (const r of rowsOf(items)) {
      if (r === null) {
        if (!prevDiv) panel.appendChild(el('div', 'rail-menu-div'))
        prevDiv = true
        continue
      }
      prevDiv = false
      const sub = Array.isArray(r[1])
      const keys = sub ? '' : typeof r[1] === 'string' ? keysOf(r[1]) : r[2] || ''
      const b = el('button', 'rail-menu-item')
      b.type = 'button'
      b.setAttribute('role', 'menuitem')
      b.append(el('span', 'rail-menu-label', r[0]), el('span', sub ? 'rail-menu-more' : 'rail-menu-keys', sub ? '›' : keys))
      if (sub) {
        b.setAttribute('aria-haspopup', 'menu')
        b.setAttribute('aria-expanded', 'false')
        const open = (focus) => {
          clearTimeout(menuSubT)
          b.setAttribute('aria-expanded', 'true')
          const p = openPanel(r[1], depth + 1, b, focus)
          p._row = b
        }
        b.addEventListener('pointerenter', () => {
          clearTimeout(menuSubT)
          menuSubT = setTimeout(() => open(false), 90)
        })
        b.addEventListener('click', () => open(true))
        b._open = open
      } else {
        b.addEventListener('pointerenter', () => {
          clearTimeout(menuSubT)
          menuSubT = setTimeout(() => closeDeeper(depth + 1), 90)
        })
        b.addEventListener('click', () => {
          closeRailMenu(false)
          if (typeof r[1] === 'string') app.commands.run(r[1])
          else r[1]()
        })
      }
      panel.appendChild(b)
    }
    if (panel.lastChild && panel.lastChild.className === 'rail-menu-div') panel.lastChild.remove()
    document.body.appendChild(panel)
    // depth 0 sits beside the hamburger; deeper panels open beside the row that owns them
    const left = depth === 0 ? ar.right + 8 : ar.right - 2
    const w = panel.offsetWidth
    panel.style.left = Math.max(4, Math.min(left, window.innerWidth - w - 4)) + 'px'
    panel.style.top = Math.max(4, Math.min(depth === 0 ? ar.top : ar.top - 5, window.innerHeight - panel.offsetHeight - 4)) + 'px'
    panel.addEventListener('keydown', onMenuKey)
    panel.addEventListener('pointerenter', menuHoverIn)
    panel.addEventListener('pointerleave', menuHoverOut)
    menuPanels.push(panel)
    if (focusFirst) panel.querySelector('.rail-menu-item').focus()
    return panel
  }
  async function openRailMenu(hover) {
    closeRailMenu()
    closeMenu()
    menuHover = !!hover
    ++menuTok
    const ae = document.activeElement
    if (ae && ae.closest && ae.closest('#editor, #cm-host')) lastEditable = ae.closest('.ProseMirror, .cm-content') || ae
    menuTree = MENU.map((m) => (m ? m.slice() : m))
    const top = menuTree.map((t) => (t ? [t[0], t[1], t[2]] : t))
    const panel = openPanel(top, 0, railBtns.menu, !hover)
    panel.setAttribute('aria-label', 'Plume menu')
    railBtns.menu.setAttribute('aria-expanded', 'true')
  }
  function onMenuKey(e) {
    const panel = e.target.closest('.rail-menu')
    if (!panel) return
    const depth = Number(panel.dataset.depth)
    const items = [...panel.querySelectorAll('.rail-menu-item')]
    const i = items.indexOf(document.activeElement)
    const stop = () => {
      e.preventDefault()
      e.stopPropagation()
    }
    if (e.key === 'Escape') {
      stop()
      closeRailMenu(true)
    } else if (e.key === 'ArrowDown') {
      stop()
      items[(i + 1) % items.length].focus()
    } else if (e.key === 'ArrowUp') {
      stop()
      items[(i + items.length - 1) % items.length].focus()
    } else if (e.key === 'Home' || e.key === 'End') {
      stop()
      items[e.key === 'Home' ? 0 : items.length - 1].focus()
    } else if (e.key === 'ArrowRight' && items[i] && items[i]._open) {
      stop()
      items[i]._open(true)
    } else if (e.key === 'ArrowLeft' && depth > 0) {
      stop()
      const row = panel._row
      closeDeeper(depth)
      if (row) row.focus()
    }
  }

  /* ---------- help panel (question mark, bottom of the rail) ---------- */
  let helpPanel = null
  const README_URL = 'https://github.com/SamuelNDCE/plume#readme'
  function closeHelp(refocusBtn) {
    if (!helpPanel) return
    helpPanel.remove()
    helpPanel = null
    railBtns.help.setAttribute('aria-expanded', 'false')
    if (refocusBtn) railBtns.help.focus()
  }
  function toggleHelp() {
    if (helpPanel) return closeHelp(true)
    closeRailMenu(false)
    const p = el('div', 'rail-help')
    p.setAttribute('role', 'dialog')
    p.setAttribute('aria-label', 'Help')
    p.append(el('div', 'rail-help-title', 'Help'))
    p.append(el('p', 'rail-help-text', 'Plume edits Markdown, text, logs and tables, and views PDF, Word and Excel files. The full shortcut list is in Settings, Shortcuts (F1).'))
    const link = el('a', 'rail-help-link', 'Open the README on GitHub')
    link.href = README_URL
    link.addEventListener('click', (e) => {
      e.preventDefault()
      window.open(README_URL, '_blank', 'noopener')
    })
    p.append(link)
    const list = el('dl', 'rail-help-keys')
    for (const [label, cmd, fallback] of [['New', 'file.new'], ['Open', 'file.open'], ['Save', 'file.save'], ['Find', 'find.open'], ['Command palette', 'palette.open'], ['Rich or Source', 'view.source'], ['Search in folder', 'search.folder'], ['Toggle sidebar', 'view.sidebar']]) {
      const k = keysOf(cmd) || fallback
      if (!k) continue
      list.append(el('dt', null, label), el('dd', null, k))
    }
    p.append(list)
    p.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        closeHelp(true)
      }
    })
    document.body.appendChild(p)
    const r = railBtns.help.getBoundingClientRect()
    p.style.left = r.right + 8 + 'px'
    p.style.bottom = Math.max(8, window.innerHeight - r.bottom) + 'px'
    helpPanel = p
    railBtns.help.setAttribute('aria-expanded', 'true')
    link.focus()
  }
  document.addEventListener('mousedown', (e) => {
    if (helpPanel && !helpPanel.contains(e.target) && !railBtns.help.contains(e.target)) closeHelp(false)
  })

  function menuHoverIn() {
    clearTimeout(menuCloseT)
    if (railMenuOpen() || body.classList.contains('zen')) return
    clearTimeout(menuOpenT)
    menuOpenT = setTimeout(() => openRailMenu(true), 150)
  }
  function menuHoverOut() {
    clearTimeout(menuOpenT)
    if (!railMenuOpen() || !menuHover) return
    clearTimeout(menuCloseT)
    menuCloseT = setTimeout(() => {
      if (menuHover) closeRailMenu(false)
    }, 250)
  }
  document.addEventListener('mousedown', (e) => {
    if (railMenuOpen() && !menuPanels.some((n) => n.contains(e.target)) && !railBtns.menu.contains(e.target)) closeRailMenu(false)
  })
  window.addEventListener('blur', () => closeRailMenu(false))

  railEl.append(
    railBtn('menu', 'Menu', IC.menu, null, () => {
      if (railMenuOpen() && menuHover) {
        menuHover = false // a click keeps the hover-opened menu open
        menuPanels[0].querySelector('.rail-menu-item').focus()
      } else if (railMenuOpen()) closeRailMenu(true)
      else openRailMenu(false)
    }, { keys: '' }),
    sep(),
    railBtn('files', 'Files', IC.files, 'library.show', paneClick('files'), { pane: true }),
    railBtn('search', 'Search', IC.search, 'search.folder', paneClick('search'), { pane: true }),
    railBtn('pages', 'Pages', IC.pages, null, pagesClick, { pane: true, hidden: true }),
    el('span', 'rail-grow'),
    railBtn('settings', 'Settings', IC.settings, 'settings.open', () => app.commands.run('settings.open')),
    railBtn('help', 'Help', IC.help, null, toggleHelp, { keys: '' }),
  )
  railBtns.menu.addEventListener('pointerenter', menuHoverIn)
  railBtns.menu.addEventListener('pointerleave', menuHoverOut)
  railBtns.help.setAttribute('aria-haspopup', 'dialog')
  railBtns.help.setAttribute('aria-expanded', 'false')
  railBtns.menu.setAttribute('aria-haspopup', 'menu')
  railBtns.menu.setAttribute('aria-expanded', 'false')
  railEl.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const list = [...railEl.querySelectorAll('.rail-btn')].filter((b) => !b.hidden)
    const i = list.indexOf(document.activeElement)
    if (i < 0) return
    e.preventDefault()
    list[(i + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length].focus()
  })
  const appEl = document.getElementById('app')
  appEl.insertBefore(railEl, sideEl)

  function syncRail() {
    const tab = curTab()
    const pm = pagesMode()
    const shown = paneShown()
    for (const id of Object.keys(PANE_IDS)) {
      const on = shown && !pm && tab === id
      railBtns[id].classList.toggle('active', on)
      railBtns[id].setAttribute('aria-pressed', String(on))
    }
    railBtns.pages.hidden = !pdfPages()
    const pon = shown && pm
    railBtns.pages.classList.toggle('active', pon)
    railBtns.pages.setAttribute('aria-pressed', String(pon))
    titleEl.textContent = pm ? 'Pages' : TITLES[tab]
  }

  // the pane reveals from the rail edge (220 ms, CSS keyframes) when a PDF toggles the Pages view or the pane is shown again
  function animatePane() {
    sideEl.classList.remove('pane-in')
    void sideEl.offsetWidth
    sideEl.classList.add('pane-in')
  }
  sideEl.addEventListener('animationend', (e) => {
    if (e.target === sideEl) sideEl.classList.remove('pane-in')
  })
  let lastPdf = pdfPages()
  let lastPm = pagesMode()
  let lastShown = paneShown()
  new MutationObserver(() => {
    const pdf = pdfPages()
    const enteredPdf = pdf && !lastPdf
    lastPdf = pdf
    if (enteredPdf || (!pdf && body.classList.contains('pages-off'))) body.classList.remove('pages-off')
    const pm = pagesMode()
    const shown = paneShown()
    if (pm !== lastPm && shown) animatePane() // opening and closing the bar is a width and opacity transition (modules.css)
    lastPm = pm
    lastShown = shown
    syncRail()
  }).observe(body, { attributes: true, attributeFilter: ['class'] })

  /* ---------- hover overlay ---------- */
  // While the sidebar is collapsed, hovering the Files icon (150 ms) shows it as an overlay; leaving the icon and the overlay
  // closes it. Clicking the icon (or the sidebar toggle) extends it for good instead.
  let peekOpen = 0
  let peekClose = 0
  function setPeek(on) {
    clearTimeout(peekOpen)
    clearTimeout(peekClose)
    if (on === peeking()) return
    body.classList.toggle('sidebar-peek', on)
    if (on) {
      showPane('files')
      if (pdfPages() && !body.classList.contains('pages-off')) {
        body.classList.add('pages-off')
        peekOff = true
      }
    } else {
      showPane(curTab())
      if (peekOff) {
        peekOff = false
        body.classList.remove('pages-off')
      }
      closeMenu()
    }
  }
  const busy = () => !!menuEl || (sideEl.contains(document.activeElement) && document.activeElement.tagName === 'INPUT' && document.activeElement !== filter)
  const hoverIn = () => {
    clearTimeout(peekClose)
    if (paneShown() || peeking() || body.classList.contains('zen')) return
    clearTimeout(peekOpen)
    peekOpen = setTimeout(() => setPeek(true), 150)
  }
  const hoverOut = () => {
    clearTimeout(peekOpen)
    if (!peeking()) return
    clearTimeout(peekClose)
    peekClose = setTimeout(() => {
      if (!busy()) setPeek(false)
    }, 200)
  }
  for (const n of [railBtns.files, sideEl]) {
    n.addEventListener('pointerenter', hoverIn)
    n.addEventListener('pointerleave', hoverOut)
  }
  // picking a file opens it and closes the overlay
  sideEl.addEventListener('click', (e) => {
    if (peeking() && e.target.closest('.tree-file, .doc-row')) setTimeout(() => setPeek(false), 0)
  })
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && peeking() && !menuEl) setPeek(false)
  })

  /* ---------- commands ---------- */
  const reg = (id, title, keys, category, fn) => app.commands.register({ id, title, keys, category, run: fn })
  reg('recent.show', 'Show Recent Files', 'Ctrl+Shift+R', 'View', showRecent)
  reg('help.shortcuts', 'Help and Shortcuts', 'F1', 'Help', openHelp)

  /* ---------- wiring ---------- */
  app.bus.on('tab:list', () => {
    renderOpen()
    renderRecent()
  })
  app.bus.on('tab:switch', () => {
    renderOpen()
    renderFolder()
  })
  app.bus.on('folder:change', () => {
    renderFolder()
    renderRecent()
  })
  app.bus.on('file:saved', () => {
    renderOpen()
    clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => app.actions.refreshFolder(), 300)
  })
  app.bus.on('settings:change', ({ key, value }) => {
    if (key === 'sidebarTab') {
      if (pdfPages()) body.classList.add('pages-off') // Ctrl+Shift+F / E while a PDF is open shows that pane instead of the pages
      showPane(value)
    }
    if (key === 'sidebar' && value) setPeek(false)
    if (key === 'sidebarTab' || key === 'sidebar') syncRail()
  })

  // the bar is closed by default: a one-time reset so existing profiles start the same way
  if (!app.settings.get('sidebarClosedByDefault')) {
    app.settings.set('sidebarClosedByDefault', true)
    app.settings.set('sidebar', false)
  }
  showPane(curTab())
  syncRail()
  requestAnimationFrame(() => requestAnimationFrame(() => body.classList.add('sidebar-ready')))
  renderOpen()
  renderFolder()
  renderRecent()
}
