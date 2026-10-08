// Sidebar: the Library pane (open documents, folder tree, recent files) and the pane switcher.
// Search renders into its own pane; this module only shows the one chosen in settings (a saved 'outline' means files).
// Relies only on the app contract in src/app.js. Output is built with DOM APIs (no innerHTML).

const TITLES = { files: 'Library', search: 'Search' }
const PANE_IDS = { files: 'files-pane', search: 'search-pane' }
const IMG_EXT = /^(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i

export function init(app) {
  const $ = (s) => document.querySelector(s)
  const tabsEl = $('#sidebar-tabs')
  const actionsEl = $('#sidebar-actions')
  const filesPane = $('#files-pane')
  if (!tabsEl || !filesPane) return

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
  folderHead.append(
    folderName,
    miniBtn('Refresh', () => app.actions.refreshFolder()),
    miniBtn('Open another', () => app.actions.openFolder()),
  )
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
  noFolder.append(el('p', 'lib-empty', 'No folder open. Open a folder to browse its files.'), miniBtn('Open Folder', () => app.actions.openFolder(), 'side-btn'))
  folderSec.append(el('div', 'lib-title', 'FOLDER'), noFolder, folderHead, filter, treeEl)

  // RECENT (only when no folder is open)
  const recentSec = el('section', 'lib-section')
  const recentList = el('div', 'lib-list')
  recentSec.append(el('div', 'lib-title', 'RECENT'), recentList)

  filesPane.append(openSec, folderSec, recentSec)

  if (actionsEl) {
    // + New / Open live at the top of the Files pane, not in the tab strip.
    filesPane.insertBefore(actionsEl, openSec)
    actionsEl.textContent = ''
    actionsEl.append(
      miniBtn('+ New', () => app.actions.newTab()),
      miniBtn('Open', () => app.actions.openFile()),
    )
  }

  /* ---------- open documents ---------- */
  function docRow(t, i) {
    const row = el('div', 'doc-row' + (i === app.state.active ? ' active' : '') + (t.dirty ? ' dirty' : ''))
    row.setAttribute('role', 'button')
    row.tabIndex = 0
    row.title = t.path || t.name
    const close = el('button', 'doc-close', '×')
    close.type = 'button'
    close.title = 'Close'
    close.setAttribute('aria-label', 'Close ' + t.name)
    close.addEventListener('click', (e) => {
      e.stopPropagation()
      app.actions.closeTab(i)
    })
    row.append(el('span', 'doc-glyph', badge(t.name)), el('span', 'doc-name', t.name), close)
    row.addEventListener('click', () => app.actions.switchTab(i))
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        app.actions.switchTab(i)
      }
    })
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
    const items = (app.recent() || []).slice(0, 8)
    recentSec.hidden = !!app.state.folder || !items.length
    for (const p of items) {
      const row = el('div', 'doc-row')
      row.setAttribute('role', 'button')
      row.tabIndex = 0
      row.title = p
      row.append(el('span', 'doc-glyph', badge(baseOf(p))), el('span', 'doc-name', baseOf(p)))
      row.addEventListener('click', () => app.actions.openPath(p))
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') app.actions.openPath(p)
      })
      recentList.appendChild(row)
    }
  }

  /* ---------- pane switching ---------- */
  function showPane(name) {
    const pane = TITLES[name] ? name : 'files'
    for (const [key, id] of Object.entries(PANE_IDS)) {
      const node = document.getElementById(id)
      if (node) node.hidden = key !== pane
    }
    tabsEl.querySelectorAll('button[data-pane]').forEach((b) => {
      const on = b.dataset.pane === pane
      b.classList.toggle('active', on)
      b.setAttribute('aria-selected', String(on))
      b.tabIndex = on ? 0 : -1
    })
  }

  /* ---------- wiring ---------- */
  tabsEl.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-pane]')
    if (b && PANE_IDS[b.dataset.pane] && app.settings.get('sidebarTab') !== b.dataset.pane) app.settings.set('sidebarTab', b.dataset.pane)
  })
  tabsEl.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    const keys = Object.keys(PANE_IDS)
    const cur = Math.max(0, keys.indexOf(app.settings.get('sidebarTab') || 'files'))
    const next = keys[(cur + (e.key === 'ArrowRight' ? 1 : keys.length - 1)) % keys.length]
    app.settings.set('sidebarTab', next)
    const nb = tabsEl.querySelector(`[data-pane="${next}"]`)
    if (nb) nb.focus()
  })
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
    if (key === 'sidebarTab') showPane(value)
  })

  showPane(app.settings.get('sidebarTab') || 'files')
  renderOpen()
  renderFolder()
  renderRecent()
}
