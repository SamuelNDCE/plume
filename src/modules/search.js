// Search in folder: the Search pane. Greps the open folder through window.folio.searchFolder and
// groups the hits by file. Clicking a hit opens the file and jumps to the match.
// Owns the pane-switch commands: search.folder (Ctrl+Shift+F), library.show (Ctrl+Shift+E), outline.show (Ctrl+Shift+L).
// Output is built with DOM APIs (no innerHTML).

export function init(app) {
  const pane = document.getElementById('search-pane')
  if (!pane) return

  const el = (tag, cls, text) => {
    const n = document.createElement(tag)
    if (cls) n.className = cls
    if (text != null) n.textContent = text
    return n
  }

  const opts = { matchCase: false, regex: false }
  const collapsed = new Set() // file paths the user collapsed
  let lastList = []
  let lastRun = null // { query, opts } of the results on screen
  let seq = 0
  let timer = null

  /* ---------- pattern helpers ---------- */
  function buildRe(q, o) {
    const src = o.regex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(src, o.matchCase ? 'g' : 'gi')
  }
  function safeRe(q, o) {
    try {
      return buildRe(q, o)
    } catch {
      return null
    }
  }

  // Splits text into plain text and <mark> nodes, so highlighting never touches innerHTML.
  function appendHighlighted(parent, text, q, o) {
    const re = safeRe(q, o)
    if (!re) {
      parent.textContent = text
      return
    }
    let last = 0
    let m
    while ((m = re.exec(text))) {
      if (!m[0].length) {
        re.lastIndex++
        continue
      }
      if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)))
      parent.appendChild(el('mark', null, m[0]))
      last = m.index + m[0].length
    }
    if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)))
  }

  /* ---------- UI ---------- */
  pane.textContent = ''
  const hint = el('div', 'search-hint')
  hint.append(
    el('p', 'lib-empty', 'Open a folder to search every file in it.'),
    (() => {
      const b = el('button', 'side-btn', 'Open Folder')
      b.type = 'button'
      b.addEventListener('click', () => app.actions.openFolder())
      return b
    })(),
  )

  const row = el('div', 'search-row')
  const input = el('input', 'search-input')
  input.type = 'search'
  input.placeholder = 'Search in folder'
  input.setAttribute('aria-label', 'Search in folder')
  input.spellcheck = false

  const toggle = (key, text, title) => {
    const b = el('button', 'lib-toggle', text)
    b.type = 'button'
    b.title = title
    b.setAttribute('aria-label', title)
    b.setAttribute('aria-pressed', 'false')
    b.addEventListener('click', () => {
      opts[key] = !opts[key]
      b.setAttribute('aria-pressed', String(opts[key]))
      b.classList.toggle('on', opts[key])
      runSoon(0)
      input.focus()
    })
    return b
  }
  row.append(input, toggle('matchCase', 'Aa', 'Match case'), toggle('regex', '.*', 'Regular expression'))

  const status = el('div', 'search-status')
  status.setAttribute('aria-live', 'polite')
  const results = el('div', 'search-results')
  pane.append(hint, row, status, results)

  /* ---------- results ---------- */
  function hitEl(h) {
    const b = el('button', 'search-hit')
    b.type = 'button'
    b.title = h.path
    b.append(el('span', 'search-line', String(h.line)))
    const txt = el('span', 'search-text')
    appendHighlighted(txt, h.text, lastRun.query, lastRun.opts)
    b.appendChild(txt)
    b.addEventListener('click', () => openHit(h))
    return b
  }

  function groupEl(g) {
    const wrap = el('div', 'search-group')
    const open = !collapsed.has(g.path)
    const head = el('button', 'search-file')
    head.type = 'button'
    head.title = g.path
    head.setAttribute('aria-expanded', String(open))
    head.append(el('span', 'caret', open ? '▾' : '▸'), el('span', 'search-file-name', g.name), el('span', 'search-count', String(g.hits.length)))
    head.addEventListener('click', () => {
      if (collapsed.has(g.path)) collapsed.delete(g.path)
      else collapsed.add(g.path)
      renderResults(lastList)
    })
    wrap.appendChild(head)
    if (open) for (const h of g.hits) wrap.appendChild(hitEl(h))
    return wrap
  }

  function renderResults(list) {
    lastList = list
    results.textContent = ''
    const groups = new Map()
    for (const r of list) {
      if (!groups.has(r.path)) groups.set(r.path, { path: r.path, name: r.name, hits: [] })
      groups.get(r.path).hits.push(r)
    }
    if (!list.length) {
      status.textContent = 'No results'
      return
    }
    const files = groups.size
    status.textContent = `${list.length}${list.length >= 300 ? '+' : ''} ${list.length === 1 ? 'result' : 'results'} in ${files} ${files === 1 ? 'file' : 'files'}`
    for (const g of groups.values()) results.appendChild(groupEl(g))
  }

  /* ---------- search ---------- */
  function showHint(on) {
    hint.hidden = !on
    status.hidden = on
    results.hidden = on
  }

  function run() {
    const q = input.value
    const root = app.state.folder
    if (!root) {
      showHint(true)
      return
    }
    showHint(false)
    if (!q) {
      lastRun = null
      status.textContent = ''
      results.textContent = ''
      return
    }
    if (opts.regex && !safeRe(q, opts)) {
      status.textContent = 'Invalid pattern'
      results.textContent = ''
      return
    }
    const mine = ++seq
    status.textContent = 'Searching…'
    const snapshot = { ...opts }
    window.folio
      .searchFolder(root.root, q, snapshot)
      .then((list) => {
        if (mine !== seq) return
        lastRun = { query: q, opts: snapshot }
        renderResults(list || [])
      })
      .catch(() => {
        if (mine === seq) status.textContent = 'Search failed'
      })
  }

  function runSoon(ms) {
    clearTimeout(timer)
    timer = setTimeout(run, ms)
  }

  /* ---------- open a hit ---------- */
  async function openHit(h) {
    const q = lastRun ? lastRun.query : ''
    const o = lastRun ? lastRun.opts : opts
    await app.actions.openPath(h.path)
    if (app.state.mode === 'source') {
      const code = app.code
      if (!code) return
      const lines = code.getValue().split('\n')
      const idx = Math.max(0, h.line - 1)
      let from = 0
      for (let i = 0; i < idx && i < lines.length; i++) from += lines[i].length + 1
      const re = safeRe(q, o)
      const m = re ? re.exec(lines[idx] || '') : null
      if (m && m[0].length) code.selectRange(from + m.index, from + m.index + m[0].length)
      else code.selectRange(from, from)
      code.scrollToLine(h.line)
      code.focus()
      return
    }
    // Rich view: first matching text node under .ProseMirror. Approximate, since the rendered text drops markup.
    const pm = document.querySelector('#editor .ProseMirror')
    const re = safeRe(q, o)
    if (!pm || !re) return
    const walker = document.createTreeWalker(pm, NodeFilter.SHOW_TEXT)
    let n
    while ((n = walker.nextNode())) {
      re.lastIndex = 0
      const m = re.exec(n.data)
      if (m && m[0].length) {
        ;(n.parentElement || pm).scrollIntoView({ block: 'center' })
        return
      }
    }
  }

  /* ---------- wiring ---------- */
  input.addEventListener('input', () => runSoon(250))
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      runSoon(0)
    }
  })
  app.bus.on('folder:change', () => {
    showHint(!app.state.folder)
    if (app.state.folder && input.value) runSoon(0)
  })

  // Pane switches. Each one also makes sure the sidebar is visible.
  const showSidebar = (tab) => {
    app.settings.set('sidebar', true)
    app.settings.set('sidebarTab', tab)
  }
  const reg = (id, title, keys, category, run) => app.commands.register({ id, title, keys, category, run })
  reg('search.folder', 'Search in Folder', 'Ctrl+Shift+F', 'Search', () => {
    showSidebar('search')
    setTimeout(() => {
      input.focus()
      input.select()
    }, 0)
  })
  reg('library.show', 'Show Library', 'Ctrl+Shift+E', 'View', () => showSidebar('files'))
  reg('outline.show', 'Show Outline', 'Ctrl+Shift+L', 'View', () => {
    if (app.outlinePin && app.outlinePin()) return
    app.toast('No headings to outline in this document')
  })

  showHint(!app.state.folder)
}
