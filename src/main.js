import { Crepe } from '@milkdown/crepe'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame.css'
import './styles.css'
import './themes/themes.css'
import './modules/modules.css'
import WELCOME from './welcome.md?raw'
import { createApp } from './app.js'
import { createCodeEditor } from './modules/codeeditor.js'
import { renderCsv, renderImage } from './modules/viewers.js'
import * as sidebar from './modules/sidebar.js'
import * as outline from './modules/outline.js'
import * as statusbar from './modules/statusbar.js'
import * as palette from './modules/palette.js'
import * as find from './modules/find.js'
import * as exporter from './modules/export.js'
import * as mermaidMod from './modules/mermaid.js'
import * as viewmodes from './modules/viewmodes.js'
import * as header from './modules/header.js'
import * as settingsPanel from './modules/settings.js'
import * as searchPane from './modules/search.js'
import * as empty from './modules/empty.js'

const app = createApp()
window.__plume = app
const api = window.folio
const $ = (s) => document.querySelector(s)
const editorEl = $('#editor')
const scrollEl = $('#editor-scroll')
const cmHost = $('#cm-host')
const viewerHost = $('#viewer-host')
const emptyEl = $('#empty')

let crepe = null
let code = null
let untitledCount = 0
let autosaveTimer = null
let mountToken = 0

const IMG_RE = /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i
const MD_RE = /\.(md|markdown|mdown|mkd)$/i
const baseName = (p) => p.split(/[\\/]/).pop()
const dirName = (p) => p.slice(0, Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')))
const kindOf = (name) => (MD_RE.test(name) ? 'md' : IMG_RE.test(name) ? 'image' : /\.(csv|tsv)$/i.test(name) ? 'table' : 'text')
const doc = () => app.state.tabs[app.state.active]

/* ---------- views ---------- */
// app.state.mode: 'wysiwyg' (rich Markdown) | 'source' (code editor) | 'table' | 'image' | 'empty'
function show(view) {
  scrollEl.hidden = view !== 'wysiwyg'
  cmHost.hidden = view !== 'source'
  viewerHost.hidden = view !== 'table' && view !== 'image'
  emptyEl.hidden = view !== 'empty'
  app.state.mode = view
  document.body.dataset.view = view
  document.body.classList.toggle('mode-source', view === 'source')
}

function ensureCode() {
  if (code) return code
  code = createCodeEditor(cmHost, {
    onChange: (value) => {
      const d = doc()
      if (!d || app.state.mode !== 'source') return
      d.content = value
      d.dirty = d.content !== d.saved
      onDocChanged()
    },
  })
  app.code = code
  return code
}

async function destroyRich() {
  if (!crepe) return
  const c = crepe
  crepe = null
  try {
    await c.destroy()
  } catch {}
}

async function mountRich(markdown) {
  const token = ++mountToken
  await destroyRich()
  if (token !== mountToken) return
  editorEl.innerHTML = ''
  const mm = mermaidMod.crepeConfig ? mermaidMod.crepeConfig() : {}
  const upload = async (file) => {
    const d = doc()
    const b64 = await new Promise((res) => {
      const r = new FileReader()
      r.onload = () => res(String(r.result))
      r.readAsDataURL(file)
    })
    if (d && d.path) {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase()
      return api.saveImage(dirName(d.path), `img-${Date.now()}.${ext}`, b64.split(',')[1])
    }
    return b64
  }
  const c = new Crepe({
    root: editorEl,
    defaultValue: markdown,
    features: { [Crepe.Feature.Latex]: true },
    featureConfigs: {
      [Crepe.Feature.Placeholder]: { text: 'Start writing…  Type / for commands', mode: 'doc' },
      [Crepe.Feature.ImageBlock]: { onUpload: upload, inlineOnUpload: upload, blockOnUpload: upload },
      ...mm,
    },
  })
  c.on((l) => {
    l.markdownUpdated((_ctx, md) => {
      const d = doc()
      if (!d || app.state.mode !== 'wysiwyg' || c !== crepe) return
      if (d.content !== md) {
        d.content = md
        d.dirty = d.content !== d.saved
        onDocChanged()
      }
    })
  })
  await c.create()
  if (token !== mountToken) {
    try {
      await c.destroy()
    } catch {}
    return
  }
  crepe = c
  const d = doc()
  if (d && !d.dirty) d.content = d.saved = c.getMarkdown() // Crepe re-serialises; a clean file must not look modified
  const pm = editorEl.querySelector('.ProseMirror')
  if (pm) pm.setAttribute('spellcheck', String(app.settings.get('spellcheck')))
  applyImagePaths()
  app.bus.emit('editor:ready', { root: editorEl })
}

let imgObserver = null
function applyImagePaths() {
  const d = doc()
  imgObserver && imgObserver.disconnect()
  if (!d || !d.path) return
  const dir = dirName(d.path)
  const fix = async () => {
    for (const img of editorEl.querySelectorAll('img')) {
      const src = img.getAttribute('src') || ''
      if (!src || /^(https?:|data:|blob:|file:)/.test(src) || img.dataset.fixed === src) continue
      img.dataset.fixed = src
      const data = await api.readImage(/^[a-zA-Z]:|^\//.test(src) ? src : dir + '/' + src)
      if (data) img.src = data
    }
  }
  imgObserver = new MutationObserver(fix)
  imgObserver.observe(editorEl, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] })
  fix()
}

// Put the right view on screen for the active doc.
async function render() {
  const d = doc()
  if (!d) {
    await destroyRich()
    show('empty')
    app.bus.emit('empty:show')
    return
  }
  if (d.kind === 'image') {
    await destroyRich()
    show('image')
    renderImage(viewerHost, d.dataUrl, d.name)
    return
  }
  if (d.kind === 'table' && d.view !== 'source') {
    await destroyRich()
    show('table')
    renderCsv(viewerHost, d.content, /\.tsv$/i.test(d.name) ? '\t' : ',')
    return
  }
  if (d.kind === 'md' && d.view !== 'source') {
    show('wysiwyg')
    await mountRich(d.content)
    return
  }
  await destroyRich()
  show('source')
  ensureCode().setDoc(d.content, d.name)
  code.focus()
}

function getMarkdown() {
  const d = doc()
  if (app.state.mode === 'wysiwyg' && crepe) return crepe.getMarkdown()
  if (app.state.mode === 'source' && code) return code.getValue()
  return d ? d.content : ''
}
// Pull the live editor text into the doc record.
function syncActive() {
  const d = doc()
  if (!d || d.kind === 'image') return
  if (app.state.mode === 'wysiwyg' && crepe) d.content = crepe.getMarkdown()
  else if (app.state.mode === 'source' && code) d.content = code.getValue()
  d.dirty = d.content !== d.saved
}
async function setMarkdown(md) {
  const d = doc()
  if (!d) return
  d.content = md
  d.dirty = md !== d.saved
  await render()
  onDocChanged()
}
app.getMarkdown = getMarkdown
app.setMarkdown = setMarkdown

function onDocChanged() {
  updateTitle()
  app.bus.emit('tab:list', app.state.tabs)
  app.bus.emit('doc:change', doc()?.content ?? '')
  scheduleAutosave()
}

function updateTitle() {
  const d = doc()
  api.setTitle(d ? `${d.dirty ? '● ' : ''}${d.name} — Plume` : 'Plume')
}

/* ---------- documents (the "open documents" list replaces tabs) ---------- */
function rememberRecent(p) {
  if (!p) return
  try {
    const r = JSON.parse(localStorage.getItem('folio.recent') || '[]').filter((x) => x !== p)
    r.unshift(p)
    localStorage.setItem('folio.recent', JSON.stringify(r.slice(0, 12)))
  } catch {}
}
app.recent = () => {
  try {
    return JSON.parse(localStorage.getItem('folio.recent') || '[]')
  } catch {
    return []
  }
}

async function activate(i) {
  if (i < 0 || i >= app.state.tabs.length) return
  syncActive()
  app.state.active = i
  await render()
  const d = doc()
  updateTitle()
  app.bus.emit('tab:list', app.state.tabs)
  app.bus.emit('tab:switch', d)
  app.bus.emit('doc:change', d.content)
  saveSession()
  checkExternal()
}

async function addDoc(d) {
  app.state.tabs.push(d)
  await activate(app.state.tabs.length - 1)
}

function newTab(content = '', name) {
  untitledCount++
  return addDoc({ name: name || `Untitled-${untitledCount}.md`, kind: 'md', view: 'rich', path: null, content, saved: content, dirty: false })
}

async function openPath(p) {
  const existing = app.state.tabs.findIndex((t) => t.path === p)
  if (existing >= 0) return activate(existing)
  try {
    const name = baseName(p)
    const kind = kindOf(name)
    const st = await api.stat(p)
    let d
    if (kind === 'image') {
      d = { name, kind, view: 'rich', path: p, content: '', saved: '', dirty: false, dataUrl: await api.readImage(p) }
    } else {
      const f = await api.readFile(p)
      if (f.binary) return app.toast(`${name} is a binary file`)
      d = { name, kind, view: 'rich', path: p, content: f.content, saved: f.content, dirty: false }
    }
    d.mtime = st?.mtimeMs
    // replace a pristine empty untitled doc
    if (app.state.tabs.length === 1 && !doc().path && !doc().content && !doc().dirty) app.state.tabs = []
    rememberRecent(p)
    await addDoc(d)
  } catch (e) {
    app.toast('Could not open ' + baseName(p))
  }
}

async function openFile() {
  for (const p of await api.openDialog()) await openPath(p)
}

async function saveDoc(d, forceAs = false) {
  if (d.kind === 'image') return true
  if (d === doc()) syncActive()
  let p = d.path
  if (!p || forceAs) {
    p = await api.saveDialog(d.path || d.name)
    if (!p) return false
  }
  await api.writeFile(p, d.content)
  d.path = p
  d.name = baseName(p)
  d.kind = kindOf(d.name) === 'image' ? 'text' : kindOf(d.name)
  d.saved = d.content
  d.dirty = false
  d.mtime = (await api.stat(p))?.mtimeMs
  rememberRecent(p)
  updateTitle()
  app.bus.emit('tab:list', app.state.tabs)
  app.bus.emit('file:saved', d)
  return true
}
const save = () => doc() && saveDoc(doc())
const saveAs = () => doc() && saveDoc(doc(), true)
async function saveAll() {
  for (const d of app.state.tabs) if (d.dirty && d.path) await saveDoc(d)
  app.toast('Saved all')
}

async function closeDoc(i = app.state.active) {
  const d = app.state.tabs[i]
  if (!d) return
  if (i === app.state.active) syncActive()
  if (d.dirty) {
    const r = await api.confirm(`Save changes to ${d.name}?`, 'Your changes will be lost if you do not save them.', ['Save', "Don't Save", 'Cancel'])
    if (r === 2) return
    if (r === 0 && !(await saveDoc(d))) return
  }
  const wasActive = i === app.state.active
  app.state.tabs.splice(i, 1)
  if (!app.state.tabs.length) {
    app.state.active = -1
    await render()
    updateTitle()
    app.bus.emit('tab:list', app.state.tabs)
    app.bus.emit('tab:switch', null)
    app.bus.emit('doc:change', '')
    saveSession()
    return
  }
  if (!wasActive) {
    if (i < app.state.active) app.state.active--
    app.bus.emit('tab:list', app.state.tabs)
    return saveSession()
  }
  app.state.active = -1
  await activate(Math.min(i, app.state.tabs.length - 1))
}

// A document renamed/moved/deleted from the sidebar.
function retarget(oldPath, newPath) {
  for (const d of app.state.tabs) {
    if (d.path === oldPath) {
      d.path = newPath
      if (newPath) d.name = baseName(newPath)
    }
  }
  updateTitle()
  app.bus.emit('tab:list', app.state.tabs)
}

/* ---------- view toggle: rich <-> source ---------- */
async function toggleSource() {
  const d = doc()
  if (!d || d.kind === 'image') return
  syncActive()
  d.view = d.view === 'source' ? 'rich' : 'source'
  if (d.kind === 'text' && d.view === 'rich') d.view = 'source'
  await render()
  app.bus.emit('mode:change', app.state.mode)
  app.bus.emit('doc:change', d.content)
}

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
async function refreshFolder() {
  if (!app.state.folder) return
  app.state.folder = await api.folderTree(app.state.folder.root)
  app.bus.emit('folder:change', app.state.folder)
}

/* ---------- autosave, session, external changes ---------- */
function scheduleAutosave() {
  clearTimeout(autosaveTimer)
  saveSession()
  if (!app.settings.get('autosave')) return
  autosaveTimer = setTimeout(async () => {
    const d = doc()
    if (d && d.path && d.dirty) await saveDoc(d)
  }, 1500)
}
function saveSession() {
  try {
    localStorage.setItem(
      'folio.session',
      JSON.stringify({
        active: app.state.active,
        tabs: app.state.tabs.map((t) => ({ name: t.name, kind: t.kind, view: t.view, path: t.path, content: t.path && !t.dirty ? '' : t.content, saved: t.saved, dirty: t.dirty })),
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
          if (t.kind === 'image') app.state.tabs.push({ ...t, dataUrl: await api.readImage(t.path) })
          else {
            const f = await api.readFile(t.path)
            if (f.binary) continue
            app.state.tabs.push({ ...t, content: f.content, saved: f.content, mtime: (await api.stat(t.path))?.mtimeMs })
          }
        } catch {}
      } else if (t.kind !== 'image') app.state.tabs.push({ ...t })
    }
    if (!app.state.tabs.length) return false
    await activate(Math.min(Math.max(s.active, 0), app.state.tabs.length - 1))
    return true
  } catch {
    return false
  }
}
async function checkExternal() {
  const d = doc()
  if (!d || !d.path || d.dirty || d.kind === 'image') return
  const st = await api.stat(d.path)
  if (st && d.mtime && st.mtimeMs !== d.mtime) {
    try {
      const f = await api.readFile(d.path)
      if (f.content !== d.saved) {
        d.content = d.saved = f.content
        d.mtime = st.mtimeMs
        await render()
        app.toast('Reloaded — file changed on disk')
      }
    } catch {}
  }
}
window.addEventListener('focus', checkExternal)

app.actions = {
  newTab,
  openFile,
  openPath,
  save,
  saveAs,
  saveAll,
  closeTab: (i) => closeDoc(i),
  toggleSource,
  openFolder,
  refreshFolder,
  switchTab: activate,
  retarget,
  render,
}

/* ---------- settings application ---------- */
const THEME_DARK = new Set(['dark', 'nord', 'dracula', 'midnight', 'solarized-dark'])
function applySettings() {
  const s = app.settings
  const root = document.documentElement
  root.dataset.theme = s.get('theme')
  root.style.setProperty('--fs', s.get('fontSize') + 'px')
  root.style.setProperty('--doc-width', s.get('maxWidth') + 'px')
  root.style.setProperty('--lh', String(s.get('lineHeight')))
  root.dataset.font = s.get('fontFamily')
  document.body.classList.toggle('focus-mode', s.get('focusMode'))
  document.body.classList.toggle('typewriter', s.get('typewriter'))
  document.body.classList.toggle('no-sidebar', !s.get('sidebar'))
  document.body.classList.toggle('zen', !!s.get('zen'))
  $('#sidebar').style.width = s.get('sidebarWidth') + 'px'
  api.setThemeBg(getComputedStyle(document.body).backgroundColor, THEME_DARK.has(s.get('theme')))
  const pm = editorEl.querySelector('.ProseMirror')
  if (pm) pm.setAttribute('spellcheck', String(s.get('spellcheck')))
  if (code) code.setOptions({ dark: THEME_DARK.has(s.get('theme')), fontSize: s.get('fontSize') - 2, lineNumbers: s.get('lineNumbersSource'), wrap: s.get('wrapSource') })
}
app.bus.on('settings:change', applySettings)

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
      const r = n.getBoundingClientRect()
      const mid = scrollEl.getBoundingClientRect().top + scrollEl.clientHeight / 2
      scrollEl.scrollBy({ top: r.top - mid + r.height / 2, behavior: 'smooth' })
    }
  }
})

;(() => {
  const rz = $('#sidebar-resizer')
  let drag = false
  rz.addEventListener('mousedown', () => (drag = true))
  window.addEventListener('mouseup', () => {
    if (drag) app.settings.set('sidebarWidth', parseInt($('#sidebar').style.width))
    drag = false
  })
  window.addEventListener('mousemove', (e) => {
    if (drag) $('#sidebar').style.width = Math.min(520, Math.max(180, e.clientX - 48)) + 'px'
  })
})()

/* ---------- built-in commands ---------- */
const C = (id, title, run, keys, category = 'File') => app.commands.register({ id, title, run, keys, category })
C('file.new', 'New Document', () => newTab(), 'Ctrl+N')
C('file.open', 'Open Files…', openFile, 'Ctrl+O')
C('file.openFolder', 'Open Folder…', () => openFolder(), 'Ctrl+Shift+O')
C('file.save', 'Save', save, 'Ctrl+S')
C('file.saveAs', 'Save As…', saveAs, 'Ctrl+Shift+S')
C('file.saveAll', 'Save All', saveAll, 'Ctrl+Alt+S')
C('file.close', 'Close Document', () => closeDoc(), 'Ctrl+W')
C('file.reveal', 'Reveal in File Explorer', () => doc()?.path && api.reveal(doc().path))
C('file.next', 'Next Open Document', () => app.state.tabs.length && activate((app.state.active + 1) % app.state.tabs.length), 'Ctrl+Tab', 'Documents')
C('file.prev', 'Previous Open Document', () => app.state.tabs.length && activate((app.state.active - 1 + app.state.tabs.length) % app.state.tabs.length), 'Ctrl+Shift+Tab', 'Documents')
C('view.source', 'Toggle Rich / Source View', toggleSource, 'Ctrl+/', 'View')
C('view.sidebar', 'Toggle Sidebar', () => app.settings.set('sidebar', !app.settings.get('sidebar')), 'Ctrl+\\', 'View')
C('view.focus', 'Toggle Focus Mode', () => app.settings.set('focusMode', !app.settings.get('focusMode')), 'F8', 'View')
C('view.typewriter', 'Toggle Typewriter Mode', () => app.settings.set('typewriter', !app.settings.get('typewriter')), 'F9', 'View')
C('view.zoomIn', 'Increase Font Size', () => app.settings.set('fontSize', Math.min(32, app.settings.get('fontSize') + 1)), 'Ctrl+=|Ctrl++', 'View')
C('view.zoomOut', 'Decrease Font Size', () => app.settings.set('fontSize', Math.max(11, app.settings.get('fontSize') - 1)), 'Ctrl+-', 'View')
C('view.zoomReset', 'Reset Font Size', () => app.settings.set('fontSize', 17), 'Ctrl+0', 'View')
C('view.autosave', 'Toggle Autosave', () => {
  app.settings.set('autosave', !app.settings.get('autosave'))
  app.toast('Autosave ' + (app.settings.get('autosave') ? 'on' : 'off'))
}, null, 'View')
C('view.spellcheck', 'Toggle Spellcheck', () => app.settings.set('spellcheck', !app.settings.get('spellcheck')), null, 'View')
C('view.lineNumbers', 'Toggle Line Numbers (source)', () => app.settings.set('lineNumbersSource', !app.settings.get('lineNumbersSource')), null, 'View')
C('view.wrap', 'Toggle Word Wrap (source)', () => app.settings.set('wrapSource', !app.settings.get('wrapSource')), 'Alt+Z', 'View')
C('dev.tools', 'Toggle Developer Tools', () => api.devtools(), 'F12', 'Help')

/* ---------- keyboard ---------- */
const norm = (e) => {
  const k = e.key.length === 1 ? e.key.toUpperCase() : e.key
  const shift = e.shiftKey && (e.key.length > 1 || /[A-Z0-9]/i.test(e.key))
  return [e.ctrlKey || e.metaKey ? 'Ctrl' : '', shift ? 'Shift' : '', e.altKey ? 'Alt' : '', k === ' ' ? 'Space' : k].filter(Boolean).join('+')
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

window.addEventListener('dragover', (e) => e.preventDefault())
window.addEventListener('drop', async (e) => {
  const files = [...(e.dataTransfer?.files || [])]
  if (!files.length) return
  e.preventDefault()
  for (const f of files) {
    const p = api.pathForFile ? api.pathForFile(f) : f.path
    if (p) await openPath(p)
  }
})
window.addEventListener('beforeunload', () => {
  syncActive()
  saveSession()
})

/* ---------- boot ---------- */
async function boot() {
  applySettings()
  for (const m of [header, sidebar, outline, statusbar, palette, find, exporter, mermaidMod, viewmodes, settingsPanel, searchPane, empty]) {
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
