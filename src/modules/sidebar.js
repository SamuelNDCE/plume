// Sidebar: Files / Outline pane switcher, folder tree, open-tab list.
// Relies only on the app contract in src/app.js.

const PANES = ['files', 'outline']

export function init(app) {
  const $ = (s) => document.querySelector(s)
  const tabsBar = $('#sidebar-tabs')
  const filesPane = $('#files-pane')
  const outlinePane = $('#outline-pane')
  if (!tabsBar || !filesPane || !outlinePane) return

  const collapsed = new Set() // folder paths the user collapsed
  let filterText = ''

  // Static structure, built once so the filter input keeps focus across renders.
  const filterInput = document.createElement('input')
  filterInput.type = 'search'
  filterInput.className = 'side-filter'
  filterInput.placeholder = 'Filter files…'
  filterInput.setAttribute('aria-label', 'Filter files by name')
  const listEl = document.createElement('div')
  listEl.className = 'side-list'
  filesPane.textContent = ''
  filesPane.append(filterInput, listEl)

  /* ---------- pane switching ---------- */
  function showPane(name) {
    const pane = PANES.includes(name) ? name : 'files'
    tabsBar.querySelectorAll('button[data-pane]').forEach((b) => {
      const on = b.dataset.pane === pane
      b.classList.toggle('active', on)
      b.setAttribute('aria-selected', String(on))
    })
    filesPane.hidden = pane !== 'files'
    outlinePane.hidden = pane !== 'outline'
  }

  tabsBar.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-pane]')
    if (!btn) return
    showPane(btn.dataset.pane)
    app.settings.set('sidebarTab', btn.dataset.pane)
  })

  /* ---------- tree helpers ---------- */
  // Returns a pruned copy of node keeping files whose name matches q and folders with matching descendants.
  function prune(node, q) {
    if (!node.dir) return node.name.toLowerCase().includes(q) ? node : null
    const kids = (node.children || []).map((c) => prune(c, q)).filter(Boolean)
    if (!kids.length && !node.name.toLowerCase().includes(q)) return null
    return { ...node, children: kids }
  }

  function activePath() {
    const t = app.state.tabs[app.state.active]
    return t ? t.path : null
  }

  function makeRow(depth, opts) {
    const row = document.createElement('div')
    row.className = 'tree-row' + (opts.active ? ' active' : '')
    row.style.paddingLeft = 8 + depth * 14 + 'px'
    row.setAttribute('role', 'treeitem')
    row.tabIndex = 0
    row.title = opts.title || ''
    const caret = document.createElement('span')
    caret.className = 'caret'
    caret.textContent = opts.dir ? (opts.open ? '▾' : '▸') : ''
    const label = document.createElement('span')
    label.className = 'tree-name'
    label.textContent = opts.name
    row.append(caret, label)
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        row.click()
      }
    })
    return row
  }

  function renderNode(node, depth, parent, q) {
    if (node.dir) {
      const open = q ? true : !collapsed.has(node.path)
      const row = makeRow(depth, { dir: true, open, name: node.name, title: node.path })
      row.setAttribute('aria-expanded', String(open))
      row.addEventListener('click', () => {
        if (collapsed.has(node.path)) collapsed.delete(node.path)
        else collapsed.add(node.path)
        renderList()
      })
      parent.appendChild(row)
      if (open) for (const c of node.children || []) renderNode(c, depth + 1, parent, q)
      return
    }
    const row = makeRow(depth, { name: node.name, title: node.path, active: node.path === activePath() })
    row.addEventListener('click', () => app.actions.openPath(node.path))
    parent.appendChild(row)
  }

  function emptyText(text) {
    const p = document.createElement('p')
    p.className = 'side-empty'
    p.textContent = text
    return p
  }

  /* ---------- rendering ---------- */
  function renderList() {
    listEl.textContent = ''
    const root = app.state.folder
    filterInput.hidden = !root
    if (!root) {
      renderNoFolder()
      return
    }
    const q = filterText.trim().toLowerCase()
    const tree = q ? prune(root, q) : root
    if (!tree || !(tree.children || []).length) {
      listEl.appendChild(emptyText(q ? 'No files match this filter.' : 'This folder is empty.'))
      return
    }
    const head = document.createElement('div')
    head.className = 'side-root'
    head.textContent = root.name
    head.title = root.path
    listEl.appendChild(head)
    const tr = document.createElement('div')
    tr.setAttribute('role', 'tree')
    for (const c of tree.children) renderNode(c, 0, tr, q)
    listEl.appendChild(tr)
  }

  function renderNoFolder() {
    listEl.appendChild(emptyText('No folder open. Open a folder to browse its files.'))
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'side-btn'
    btn.textContent = 'Open Folder'
    btn.addEventListener('click', () => app.actions.openFolder())
    listEl.appendChild(btn)

    const tabs = app.state.tabs
    if (!tabs.length) return
    const h = document.createElement('div')
    h.className = 'side-root'
    h.textContent = 'Open tabs'
    listEl.appendChild(h)
    tabs.forEach((t, i) => {
      const row = makeRow(0, { name: t.name + (t.dirty ? ' ●' : ''), title: t.path || t.name, active: i === app.state.active })
      row.addEventListener('click', () => (t.path ? app.actions.openPath(t.path) : app.actions.switchTab(i)))
      listEl.appendChild(row)
    })
  }

  filterInput.addEventListener('input', () => {
    filterText = filterInput.value
    renderList()
  })

  // Re-fetch the tree after a save so new or renamed files appear.
  let refreshTimer = null
  async function refreshTree() {
    const root = app.state.folder
    if (!root || !root.path || !window.folio) return
    try {
      const fresh = await window.folio.folderTree(root.path)
      if (fresh) app.state.folder = fresh
      renderList()
    } catch (e) {
      console.error('[sidebar] refresh failed', e)
    }
  }

  app.bus.on('folder:change', () => renderList())
  app.bus.on('file:saved', () => {
    clearTimeout(refreshTimer)
    refreshTimer = setTimeout(refreshTree, 300)
    renderList()
  })
  app.bus.on('tab:switch', () => renderList())
  // tab:list fires on every keystroke (renderTabs), so only the tab list needs it, and only without a folder.
  app.bus.on('tab:list', () => {
    if (!app.state.folder) renderList()
  })

  showPane(app.settings.get('sidebarTab') || 'files')
  renderList()
}
