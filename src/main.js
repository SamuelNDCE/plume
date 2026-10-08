import { Crepe } from '@milkdown/crepe'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame.css'
import './styles.css'
import './themes/themes.css'
import './modules/modules.css'
import { createApp } from './app.js'
import * as sidebar from './modules/sidebar.js'
import * as outline from './modules/outline.js'
import * as statusbar from './modules/statusbar.js'
import * as palette from './modules/palette.js'
import * as find from './modules/find.js'
import * as exporter from './modules/export.js'
import * as mermaidMod from './modules/mermaid.js'
import * as viewmodes from './modules/viewmodes.js'

const app = createApp()
const api = window.folio
const $ = (s) => document.querySelector(s)
const editorEl = $('#editor')
const sourceEl = $('#source')
const tabbar = $('#tabbar')

let crepe = null
let suppress = false
let untitledCount = 0
let autosaveTimer = null

const baseName = (p) => p.split(/[\\/]/).pop()
const dirName = (p) => p.slice(0, Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')))
const tab = () => app.state.tabs[app.state.active]

/* ---------- editor lifecycle ---------- */
async function mountEditor(markdown) {
  if (crepe) {
    try {
      await crepe.destroy()
    } catch {}
    crepe = null
  }
  editorEl.innerHTML = ''
  const mm = mermaidMod.crepeConfig ? mermaidMod.crepeConfig() : {}
  const upload = async (file) => {
    const t = tab()
    const b64 = await new Promise((res) => {
      const r = new FileReader()
      r.onload = () => res(String(r.result))
      r.readAsDataURL(file)
    })
    if (t && t.path) {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase()
      const name = `img-${Date.now()}.${ext}`
      return api.saveImage(dirName(t.path), name, b64.split(',')[1])
    }
    return b64
  }
  crepe = new Crepe({
    root: editorEl,
    defaultValue: markdown,
    features: { [Crepe.Feature.Latex]: true },
    featureConfigs: {
      [Crepe.Feature.Placeholder]: { text: 'Start writing…  Type / for commands', mode: 'doc' },
      [Crepe.Feature.ImageBlock]: { onUpload: upload, inlineOnUpload: upload, blockOnUpload: upload },
      ...mm,
    },
  })
  crepe.on((l) => {
    l.markdownUpdated((_ctx, md) => {
      if (suppress) return
      const t = tab()
      if (!t) return
      if (t.content !== md) {
        t.content = md
        t.dirty = t.content !== t.saved
        onDocChanged()
      }
    })
  })
  await crepe.create()
  const t0 = tab()
  if (t0 && !t0.dirty) {
    // normalise: Crepe re-serialises markdown, so a clean file must not look modified
    t0.content = t0.saved = crepe.getMarkdown()
  }
  const pm = editorEl.querySelector('.ProseMirror')
  if (pm) pm.setAttribute('spellcheck', String(app.settings.get('spellcheck')))
  applyImagePaths()
  app.bus.emit('editor:ready', { root: editorEl })
}

// rewrite relative image srcs so local images display
function applyImagePaths() {
  const t = tab()
  if (!t || !t.path) return
  const dir = dirName(t.path)
  const fix = async () => {
    for (const img of editorEl.querySelectorAll('img')) {
      const src = img.getAttribute('src') || ''
      if (!src || /^(https?:|data:|blob:|file:)/.test(src) || img.dataset.fixed === src) continue
      img.dataset.fixed = src
      const abs = /^[a-zA-Z]:|^\//.test(src) ? src : dir + '/' + src
      const data = await api.readImage(abs)
      if (data) img.src = data
    }
  }
  new MutationObserver(fix).observe(editorEl, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] })
  fix()
}

function getMarkdown() {
  if (app.state.mode === 'source') return sourceEl.value
  return crepe ? crepe.getMarkdown() : tab()?.content || ''
}
async function setMarkdown(md) {
  const t = tab()
  if (t) {
    t.content = md
    t.dirty = md !== t.saved
  }
  if (app.state.mode === 'source') sourceEl.value = md
  else await mountEditor(md)
  onDocChanged()
}
app.getMarkdown = getMarkdown
app.setMarkdown = setMarkdown

function onDocChanged() {
  renderTabs()
  updateTitle()
  app.bus.emit('doc:change', tab()?.content ?? '')
  scheduleAutosave()
}

/* ---------- tabs ---------- */
function renderTabs() {
  tabbar.innerHTML = ''
  app.state.tabs.forEach((t, i) => {
    const el = document.createElement('div')
    el.className = 'tab' + (i === app.state.active ? ' active' : '') + (t.dirty ? ' dirty' : '')
    el.title = t.path || t.name
    el.innerHTML = `<span class="dot"></span><span class="tname"></span><button class="x" aria-label="Close tab">×</button>`
    el.querySelector('.tname').textContent = t.name
    el.addEventListener('mousedown', (e) => {
      if (e.button === 1) {
        e.preventDefault()
        closeTab(i)
      } else if (!e.target.closest('.x')) switchTab(i)
    })
    el.querySelector('.x').addEventListener('click', (e) => {
      e.stopPropagation()
      closeTab(i)
    })
    tabbar.appendChild(el)
  })
  const plus = document.createElement('button')
  plus.className = 'newtab'
  plus.textContent = '+'
  plus.title = 'New file (Ctrl+N)'
  plus.onclick = () => newTab()
  tabbar.appendChild(plus)
  app.bus.emit('tab:list', app.state.tabs)
}

function updateTitle() {
  const t = tab()
  api.setTitle(t ? `${t.dirty ? '● ' : ''}${t.name} — Lumenmark` : 'Lumenmark')
}

function pushTab(t) {
  app.state.tabs.push(t)
  return switchTab(app.state.tabs.length - 1)
}

async function switchTab(i) {
  if (i < 0 || i >= app.state.tabs.length) return
  // persist current content first
  const cur = tab()
  if (cur && crepe && app.state.mode === 'wysiwyg') cur.content = crepe.getMarkdown()
  else if (cur && app.state.mode === 'source') cur.content = sourceEl.value
  app.state.active = i
  const t = tab()
  if (app.state.mode === 'source') sourceEl.value = t.content
  else await mountEditor(t.content)
  renderTabs()
  updateTitle()
  app.bus.emit('tab:switch', t)
  app.bus.emit('doc:change', t.content)
  saveSession()
}

function newTab(content = '', name) {
  untitledCount++
  return pushTab({ name: name || `Untitled-${untitledCount}.md`, path: null, content, saved: content, dirty: false })
}

async function openPath(p) {
  const existing = app.state.tabs.findIndex((t) => t.path === p)
  if (existing >= 0) return switchTab(existing)
  try {
    const f = await api.readFile(p)
    // replace a pristine empty untitled tab
    if (app.state.tabs.length === 1 && !tab().path && !tab().content && !tab().dirty) app.state.tabs = []
    await pushTab({ name: f.name, path: p, content: f.content, saved: f.content, dirty: false })
  } catch (e) {
    app.toast('Could not open ' + baseName(p))
  }
}

async function openFile() {
  const paths = await api.openDialog()
  for (const p of paths) await openPath(p)
}

async function saveTab(t, forceAs = false) {
  if (t === tab()) t.content = getMarkdown()
  let p = t.path
  if (!p || forceAs) {
    p = await api.saveDialog(t.path || t.name)
    if (!p) return false
  }
  await api.writeFile(p, t.content)
  t.path = p
  t.name = baseName(p)
  t.saved = t.content
  t.dirty = false
  renderTabs()
  updateTitle()
  app.bus.emit('file:saved', t)
  return true
}

const save = () => tab() && saveTab(tab())
const saveAs = () => tab() && saveTab(tab(), true)

async function closeTab(i) {
  const t = app.state.tabs[i]
  if (!t) return
  if (i === app.state.active && crepe && app.state.mode === 'wysiwyg') t.content = crepe.getMarkdown()
  t.dirty = t.content !== t.saved
  if (t.dirty) {
    const r = await api.confirm(`Save changes to ${t.name}?`, 'Your changes will be lost if you do not save them.', ['Save', "Don't Save", 'Cancel'])
    if (r === 2) return
    if (r === 0 && !(await saveTab(t))) return
  }
  app.state.tabs.splice(i, 1)
  if (!app.state.tabs.length) {
    app.state.active = -1
    return newTab()
  }
  await switchTab(Math.min(i, app.state.tabs.length - 1) === app.state.active && i < app.state.active ? app.state.active - 1 : Math.min(i, app.state.tabs.length - 1))
}

/* ---------- source mode ---------- */
async function toggleSource() {
  const t = tab()
  if (!t) return
  if (app.state.mode === 'wysiwyg') {
    t.content = crepe ? crepe.getMarkdown() : t.content
    app.state.mode = 'source'
    sourceEl.value = t.content
    document.body.classList.add('mode-source')
    editorEl.parentElement.hidden = true
    sourceEl.hidden = false
    sourceEl.focus()
  } else {
    t.content = sourceEl.value
    t.dirty = t.content !== t.saved
    app.state.mode = 'wysiwyg'
    document.body.classList.remove('mode-source')
    sourceEl.hidden = true
    editorEl.parentElement.hidden = false
    await mountEditor(t.content)
  }
  renderTabs()
  app.bus.emit('mode:change', app.state.mode)
  app.bus.emit('doc:change', t.content)
}
sourceEl.addEventListener('input', () => {
  const t = tab()
  t.content = sourceEl.value
  t.dirty = t.content !== t.saved
  onDocChanged()
})
sourceEl.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault()
    document.execCommand('insertText', false, '  ')
  }
})

/* ---------- folders ---------- */
async function openFolder(dir) {
  dir = dir || (await api.openFolderDialog())
  if (!dir) return
  app.state.folder = await api.folderTree(dir)
  try {
    localStorage.setItem('folio.folder', dir)
  } catch {}
  app.bus.emit('folder:change', app.state.folder)
  if (!app.settings.get('sidebar')) app.settings.set('sidebar', true)
}

/* ---------- autosave + session ---------- */
function scheduleAutosave() {
  clearTimeout(autosaveTimer)
  saveSession()
  if (!app.settings.get('autosave')) return
  autosaveTimer = setTimeout(async () => {
    const t = tab()
    if (t && t.path && t.dirty) await saveTab(t)
  }, 1500)
}
function saveSession() {
  try {
    localStorage.setItem(
      'folio.session',
      JSON.stringify({
        active: app.state.active,
        tabs: app.state.tabs.map((t) => ({ name: t.name, path: t.path, content: t.path && !t.dirty ? '' : t.content, saved: t.saved, dirty: t.dirty })),
      }),
    )
  } catch {}
}
async function restoreSession() {
  try {
    const s = JSON.parse(localStorage.getItem('folio.session') || 'null')
    if (!s || !s.tabs.length) return false
    for (const t of s.tabs) {
      if (t.path && !t.dirty) {
        try {
          const f = await api.readFile(t.path)
          app.state.tabs.push({ name: f.name, path: t.path, content: f.content, saved: f.content, dirty: false })
        } catch {}
      } else app.state.tabs.push({ ...t })
    }
    if (!app.state.tabs.length) return false
    await switchTab(Math.min(Math.max(s.active, 0), app.state.tabs.length - 1))
    return true
  } catch {
    return false
  }
}

app.actions = { newTab, openFile, openPath, save, saveAs, closeTab: () => closeTab(app.state.active), toggleSource, openFolder, switchTab }

/* ---------- settings application ---------- */
const THEME_DARK = new Set(['dark', 'nord', 'dracula', 'midnight', 'solarized-dark'])
function applySettings() {
  const s = app.settings
  const root = document.documentElement
  root.dataset.theme = s.get('theme')
  root.style.setProperty('--fs', s.get('fontSize') + 'px')
  root.style.setProperty('--doc-width', s.get('maxWidth') + 'px')
  root.dataset.font = s.get('fontFamily')
  document.body.classList.toggle('focus-mode', s.get('focusMode'))
  document.body.classList.toggle('typewriter', s.get('typewriter'))
  document.body.classList.toggle('no-sidebar', !s.get('sidebar'))
  $('#sidebar').style.width = s.get('sidebarWidth') + 'px'
  const bg = getComputedStyle(document.body).backgroundColor
  api.setThemeBg(bg, THEME_DARK.has(s.get('theme')))
  const pm = editorEl.querySelector('.ProseMirror')
  if (pm) pm.setAttribute('spellcheck', String(s.get('spellcheck')))
  sourceEl.spellcheck = false
}
app.bus.on('settings:change', applySettings)

// focus mode: highlight the active block
document.addEventListener('selectionchange', () => {
  if (!document.body.classList.contains('focus-mode') && !document.body.classList.contains('typewriter')) return
  const sel = document.getSelection()
  if (!sel.anchorNode) return
  let n = sel.anchorNode.nodeType === 3 ? sel.anchorNode.parentElement : sel.anchorNode
  const pm = editorEl.querySelector('.ProseMirror')
  if (!pm || !pm.contains(n)) return
  while (n && n.parentElement !== pm) n = n.parentElement
  pm.querySelectorAll('.is-active-block').forEach((e) => e.classList.remove('is-active-block'))
  if (n) {
    n.classList.add('is-active-block')
    if (document.body.classList.contains('typewriter')) {
      const sc = $('#editor-scroll')
      const r = n.getBoundingClientRect()
      const mid = sc.getBoundingClientRect().top + sc.clientHeight / 2
      sc.scrollBy({ top: r.top - mid + r.height / 2, behavior: 'smooth' })
    }
  }
})

/* ---------- sidebar resize ---------- */
;(() => {
  const rz = $('#sidebar-resizer')
  let drag = false
  rz.addEventListener('mousedown', () => (drag = true))
  window.addEventListener('mouseup', () => {
    if (drag) app.settings.set('sidebarWidth', parseInt($('#sidebar').style.width))
    drag = false
  })
  window.addEventListener('mousemove', (e) => {
    if (!drag) return
    $('#sidebar').style.width = Math.min(520, Math.max(160, e.clientX)) + 'px'
  })
})()

/* ---------- built-in commands ---------- */
const C = (id, title, run, keys, category = 'File') => app.commands.register({ id, title, run, keys, category })
C('file.new', 'New File', () => newTab(), 'Ctrl+N')
C('file.open', 'Open File…', openFile, 'Ctrl+O')
C('file.openFolder', 'Open Folder…', () => openFolder(), 'Ctrl+Shift+O')
C('file.save', 'Save', save, 'Ctrl+S')
C('file.saveAs', 'Save As…', saveAs, 'Ctrl+Shift+S')
C('file.close', 'Close Tab', () => closeTab(app.state.active), 'Ctrl+W')
C('file.reveal', 'Reveal in File Explorer', () => tab()?.path && api.reveal(tab().path))
C('tab.next', 'Next Tab', () => switchTab((app.state.active + 1) % app.state.tabs.length), 'Ctrl+Tab', 'Tabs')
C('tab.prev', 'Previous Tab', () => switchTab((app.state.active - 1 + app.state.tabs.length) % app.state.tabs.length), 'Ctrl+Shift+Tab', 'Tabs')
C('view.source', 'Toggle Source Code Mode', toggleSource, 'Ctrl+/', 'View')
C('view.sidebar', 'Toggle Sidebar', () => app.settings.set('sidebar', !app.settings.get('sidebar')), 'Ctrl+\\', 'View')
C('view.focus', 'Toggle Focus Mode', () => app.settings.set('focusMode', !app.settings.get('focusMode')), 'F8', 'View')
C('view.typewriter', 'Toggle Typewriter Mode', () => app.settings.set('typewriter', !app.settings.get('typewriter')), 'F9', 'View')
C('view.zoomIn', 'Increase Font Size', () => app.settings.set('fontSize', Math.min(32, app.settings.get('fontSize') + 1)), 'Ctrl+=', 'View')
C('view.zoomOut', 'Decrease Font Size', () => app.settings.set('fontSize', Math.max(11, app.settings.get('fontSize') - 1)), 'Ctrl+-', 'View')
C('view.zoomReset', 'Reset Font Size', () => app.settings.set('fontSize', 17), 'Ctrl+0', 'View')
C('view.autosave', 'Toggle Autosave', () => {
  app.settings.set('autosave', !app.settings.get('autosave'))
  app.toast('Autosave ' + (app.settings.get('autosave') ? 'on' : 'off'))
}, null, 'View')
C('view.spellcheck', 'Toggle Spellcheck', () => app.settings.set('spellcheck', !app.settings.get('spellcheck')), null, 'View')
C('dev.tools', 'Toggle Developer Tools', () => api.devtools(), 'F12', 'Help')

/* ---------- keyboard ---------- */
const norm = (e) => {
  const k = e.key.length === 1 ? e.key.toUpperCase() : e.key
  return [e.ctrlKey || e.metaKey ? 'Ctrl' : '', e.shiftKey && e.key.length > 1 ? 'Shift' : e.shiftKey && !/[A-Z0-9]/i.test(e.key) ? '' : e.shiftKey ? 'Shift' : '', e.altKey ? 'Alt' : '', k === ' ' ? 'Space' : k].filter(Boolean).join('+')
}
window.addEventListener(
  'keydown',
  (e) => {
    const combo = norm(e)
    const hit = app.commands.list().find((c) => c.keys && c.keys.split('|').includes(combo))
    if (hit) {
      e.preventDefault()
      e.stopPropagation()
      hit.run()
    }
  },
  true,
)
window.addEventListener(
  'wheel',
  (e) => {
    if (!e.ctrlKey) return
    e.preventDefault()
    app.settings.set('fontSize', Math.min(32, Math.max(11, app.settings.get('fontSize') + (e.deltaY < 0 ? 1 : -1))))
  },
  { passive: false },
)

/* ---------- drag & drop ---------- */
window.addEventListener('dragover', (e) => e.preventDefault())
window.addEventListener('drop', async (e) => {
  const files = [...(e.dataTransfer?.files || [])].filter((f) => /\.(md|markdown|mdown|txt)$/i.test(f.name))
  if (!files.length) return
  e.preventDefault()
  for (const f of files) {
    const p = api.pathForFile ? api.pathForFile(f) : f.path
    if (p) await openPath(p)
  }
})

window.addEventListener('beforeunload', () => {
  const t = tab()
  if (t && crepe && app.state.mode === 'wysiwyg') t.content = crepe.getMarkdown()
  saveSession()
})

/* ---------- boot ---------- */
const WELCOME = `# Welcome to Lumenmark

A free, open-source, **WYSIWYG** Markdown editor. Type Markdown and it renders as you write.

## Try it

- Type \`/\` for the block menu: headings, tables, code, math, images, diagrams
- Select text for the formatting toolbar
- **Ctrl+/** toggles raw source mode · **Ctrl+P** opens the command palette
- **F8** focus mode · **F9** typewriter mode · **Ctrl+F** find & replace

## Everything you'd expect

| Feature | Status |
| --- | --- |
| Tables, task lists, footnotes | yes |
| Math (KaTeX): $E = mc^2$ | yes |
| Mermaid diagrams | yes |
| Themes | many |

- [x] Build a Markdown editor
- [ ] Write something great

\`\`\`mermaid
graph LR
  A[Write] --> B[Preview] --> C[Export]
\`\`\`

\`\`\`chart
{"type":"bar","title":"Charts are built in","labels":["Q1","Q2","Q3","Q4"],"datasets":[{"label":"2025","data":[12,19,7,15]},{"label":"2026","data":[16,23,14,28]}]}
\`\`\`

> Lumenmark is MIT licensed. Make it yours.
`

async function boot() {
  applySettings()
  for (const m of [sidebar, outline, statusbar, palette, find, exporter, mermaidMod, viewmodes]) {
    try {
      m.init && m.init(app)
    } catch (e) {
      console.error('[module init]', e)
    }
  }
  api.onOpenPath((p) => openPath(p))
  const restored = await restoreSession()
  const pending = await api.takePendingOpen()
  if (pending) await openPath(pending)
  else if (!restored) await newTab(WELCOME, 'Welcome.md')
  const f = localStorage.getItem('folio.folder')
  if (f) openFolder(f).catch(() => {})
  applySettings()
}
boot()
