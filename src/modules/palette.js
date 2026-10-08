// Command palette (Ctrl+P, Ctrl+Shift+P). Lists app commands, open tabs, and
// headings (typing '@'). A leading '>' is ignored so VS Code-style habits work.
// Contract: only app.* from src/app.js is used. Output built with DOM APIs (no innerHTML).

const RECENT_KEY = 'folio.palette.recent'
const MAX_RECENT = 8
const MAX_ITEMS = 60

const THEMES = [
  ['light', 'Light'],
  ['github', 'GitHub'],
  ['newsprint', 'Newsprint'],
  ['sepia', 'Sepia'],
  ['dark', 'Dark'],
  ['nord', 'Nord'],
  ['dracula', 'Dracula'],
  ['midnight', 'Midnight'],
]
const FONTS = [
  ['theme', 'Theme default'],
  ['serif', 'Serif'],
  ['sans', 'Sans'],
  ['mono', 'Mono'],
]
const WIDTHS = [
  ['narrow', 'Narrow', 640],
  ['normal', 'Normal', 820],
  ['wide', 'Wide', 1100],
]

let app = null
let root = null
let input = null
let list = null
let items = []
let sel = 0
let isOpen = false
let restoreTo = null

function loadRecent() {
  try {
    const r = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
    return Array.isArray(r) ? r : []
  } catch {
    return []
  }
}

function pushRecent(id) {
  try {
    const r = [id, ...loadRecent().filter((x) => x !== id)].slice(0, MAX_RECENT)
    localStorage.setItem(RECENT_KEY, JSON.stringify(r))
  } catch {}
}

// Subsequence fuzzy match. Returns null when query characters are not all present in order.
export function fuzzyScore(query, text) {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  if (!q) return 0
  let score = 0
  let ti = 0
  let last = -2
  for (const ch of q) {
    const idx = t.indexOf(ch, ti)
    if (idx < 0) return null
    let s = 1
    if (idx === last + 1) s += 4
    if (idx === 0 || /[\s\-_/:>.]/.test(t[idx - 1])) s += 3
    score += s - (idx - ti) * 0.1
    last = idx
    ti = idx + 1
  }
  return score - t.length * 0.01
}

function bestScore(q, ...texts) {
  let best = null
  for (const text of texts) {
    const s = fuzzyScore(q, text)
    if (s !== null && (best === null || s > best)) best = s
  }
  return best
}

function headings() {
  const md = app.getMarkdown() || ''
  const out = []
  let fence = false
  md.split('\n').forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence
      return
    }
    if (fence) return
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (m) out.push({ level: m[1].length, text: m[2], line: i })
  })
  return out
}

function jumpToHeading(h, index) {
  if (app.state.mode === 'source') {
    const code = app.code
    if (!code) return
    const lines = code.getValue().split('\n')
    let pos = 0
    for (let i = 0; i < h.line && i < lines.length; i++) pos += lines[i].length + 1
    code.selectRange(pos, pos)
    code.scrollToLine(h.line + 1) // h.line is 0-based; the code editor API takes 1-based lines
    code.focus()
    return
  }
  const pm = document.querySelector('#editor .ProseMirror')
  if (!pm) return
  const all = [...pm.querySelectorAll('h1, h2, h3, h4, h5, h6')]
  const el = all.find((e) => e.textContent.trim() === h.text.trim()) || all[index]
  if (!el) return
  el.scrollIntoView({ block: 'center' })
  pm.focus()
  const range = document.createRange()
  range.selectNodeContents(el)
  range.collapse(true)
  const s = window.getSelection()
  s.removeAllRanges()
  s.addRange(range)
}

function buildItems(rawQuery) {
  let q = rawQuery.replace(/^\s*>\s*/, '')
  const out = []

  if (q.startsWith('@')) {
    const needle = q.slice(1).trim()
    headings().forEach((h, i) => {
      const s = needle ? fuzzyScore(needle, h.text) : 0
      if (s === null) return
      out.push({ kind: 'heading', label: h.text, meta: 'H' + h.level, indent: h.level - 1, score: s, run: () => jumpToHeading(h, i) })
    })
    return out.sort((a, b) => b.score - a.score).slice(0, MAX_ITEMS)
  }

  q = q.trim()
  const recent = loadRecent()
  app.commands.list().forEach((c) => {
    if (c.id === 'palette.open') return
    const s = bestScore(q, c.title, `${c.category || ''} ${c.title}`)
    if (s === null) return
    const r = recent.indexOf(c.id)
    const bonus = r >= 0 ? (MAX_RECENT - r) * 2 : 0
    out.push({ kind: 'command', id: c.id, label: c.title, meta: c.category || '', keys: c.keys, score: s + bonus, run: () => c.run() })
  })

  app.state.tabs.forEach((t, i) => {
    const s = bestScore(q, t.name)
    if (s === null) return
    out.push({ kind: 'tab', label: t.name, meta: 'Tab', score: s - 1000, run: () => app.actions.switchTab(i) })
  })

  const baseName = (p) => p.split(/[\\/]/).pop()
  ;(app.recent ? app.recent() : []).forEach((p) => {
    const name = baseName(p)
    const s = bestScore(q, name)
    if (s === null) return
    out.push({ kind: 'recent', label: name, meta: 'Open Recent', score: s - 500, run: () => app.actions.openPath(p) })
  })

  // Go to file: only with a typed query, so the empty palette stays short.
  if (q && app.state.folder) {
    for (const f of flattenFiles(app.state.folder.children || [], '')) {
      const s = bestScore(q, f.name, f.rel)
      if (s === null) continue
      out.push({ kind: 'file', label: f.name, meta: f.rel, score: s - 200, run: () => app.actions.openPath(f.path) })
    }
  }

  out.sort((a, b) => b.score - a.score)
  return out.slice(0, MAX_ITEMS)
}

// Files under a folder tree node list, depth first, with their path relative to the folder.
function flattenFiles(nodes, prefix, acc = []) {
  for (const n of nodes) {
    if (acc.length >= 5000) break
    if (n.dir) flattenFiles(n.children || [], prefix + n.name + '/', acc)
    else acc.push({ name: n.name, path: n.path, rel: prefix + n.name })
  }
  return acc
}

function runItem(it) {
  if (!it) return
  if (it.kind === 'command') pushRecent(it.id)
  close()
  try {
    it.run()
  } catch (e) {
    console.error('[palette]', e)
  }
}

function updateSelection() {
  const rows = list.querySelectorAll('.pal-item')
  rows.forEach((r, i) => {
    const on = i === sel
    r.classList.toggle('sel', on)
    r.setAttribute('aria-selected', String(on))
    if (on) r.scrollIntoView({ block: 'nearest' })
  })
}

function render() {
  items = buildItems(input.value)
  if (sel >= items.length) sel = Math.max(0, items.length - 1)
  list.textContent = ''
  if (!items.length) {
    const li = document.createElement('li')
    li.className = 'pal-empty'
    li.textContent = 'No matches'
    list.appendChild(li)
    return
  }
  items.forEach((it, i) => {
    const li = document.createElement('li')
    li.className = 'pal-item'
    li.setAttribute('role', 'option')
    li.setAttribute('aria-selected', String(i === sel))
    if (i === sel) li.classList.add('sel')

    const title = document.createElement('span')
    title.className = 'pal-title'
    title.textContent = it.label
    if (it.indent) title.style.paddingLeft = it.indent * 14 + 'px'

    const cat = document.createElement('span')
    cat.className = 'pal-cat'
    cat.textContent = it.meta || ''

    const keys = document.createElement('span')
    keys.className = 'pal-keys'
    const combo = (it.keys || '').split('|')[0]
    if (combo) {
      combo.split('+').forEach((k) => {
        const kbd = document.createElement('kbd')
        kbd.textContent = k
        keys.appendChild(kbd)
      })
    }

    li.append(title, cat, keys)
    li.addEventListener('mousemove', () => {
      if (sel !== i) {
        sel = i
        updateSelection()
      }
    })
    li.addEventListener('click', () => runItem(items[i]))
    list.appendChild(li)
  })
}

function onKey(e) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    sel = Math.min(sel + 1, Math.max(0, items.length - 1))
    updateSelection()
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    sel = Math.max(sel - 1, 0)
    updateSelection()
  } else if (e.key === 'Enter') {
    e.preventDefault()
    runItem(items[sel])
  } else if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    close()
  }
}

function open() {
  if (isOpen) return close()
  isOpen = true
  restoreTo = document.activeElement
  sel = 0

  root.textContent = ''
  const overlay = document.createElement('div')
  overlay.className = 'pal-overlay'
  const box = document.createElement('div')
  box.className = 'pal-box'
  box.setAttribute('role', 'dialog')
  box.setAttribute('aria-label', 'Command palette')

  input = document.createElement('input')
  input.className = 'pal-input'
  input.type = 'text'
  input.placeholder = 'Type a command, a tab name, or @ for headings'
  input.setAttribute('aria-label', 'Command palette search')
  input.setAttribute('autocomplete', 'off')
  input.spellcheck = false

  list = document.createElement('ul')
  list.className = 'pal-list'
  list.setAttribute('role', 'listbox')

  box.append(input, list)
  overlay.appendChild(box)
  // Outside click: the overlay is the backdrop, so a mousedown outside the box closes.
  overlay.addEventListener('mousedown', (e) => {
    if (!box.contains(e.target)) close()
  })
  root.appendChild(overlay)
  root.hidden = false

  input.addEventListener('input', () => {
    sel = 0
    render()
  })
  input.addEventListener('keydown', onKey)
  render()
  input.focus()
}

function close() {
  if (!isOpen) return
  isOpen = false
  root.hidden = true
  root.textContent = ''
  input = null
  list = null
  items = []
  const back = restoreTo
  restoreTo = null
  if (back && typeof back.focus === 'function' && document.contains(back)) back.focus()
}

export function init(appCtx) {
  app = appCtx
  root = document.getElementById('palette-root')
  if (!root) return

  root.hidden = true
  app.commands.register({ id: 'palette.open', title: 'Command Palette', category: 'View', keys: 'Ctrl+P|Ctrl+Shift+P', run: open })

  THEMES.forEach(([id, label]) =>
    app.commands.register({ id: 'theme.' + id, title: 'Theme: ' + label, category: 'Theme', keys: null, run: () => app.settings.set('theme', id) }),
  )
  FONTS.forEach(([id, label]) =>
    app.commands.register({ id: 'font.' + id, title: 'Font: ' + label, category: 'Appearance', keys: null, run: () => app.settings.set('fontFamily', id) }),
  )
  WIDTHS.forEach(([id, label, px]) =>
    app.commands.register({ id: 'width.' + id, title: `Width: ${label} (${px}px)`, category: 'Appearance', keys: null, run: () => app.settings.set('maxWidth', px) }),
  )
}
