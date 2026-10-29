// Read-only Word (.docx) viewer. mount(host, doc, app) is called by docviewer.js.
//
// Pipeline: bytes -> mammoth (browser build) -> HTML split into top-level chunks -> DOMPurify on every chunk ->
// chunks appended to the page a few milliseconds at a time. mammoth runs in a module worker made from this same file
// (the worker branch is at the bottom of the file) so a big document never freezes the window; if a worker cannot be
// started it falls back to the main thread. Nothing here is written back to disk.

const IS_WORKER = typeof document === 'undefined'

/* ---------- conversion (runs in the worker, or on the main thread as a fallback) ---------- */

const STYLE_MAP = [
  "p[style-name='Title'] => h1:fresh",
  "p[style-name='Subtitle'] => p:fresh",
  "p[style-name='Quote'] => blockquote:fresh",
  "p[style-name='Intense Quote'] => blockquote:fresh",
  'u => u',
]

async function loadMammoth() {
  // The explicit browser build: the package's default entry pulls in Node modules.
  const m = await import('mammoth/mammoth.browser.min.js')
  return m.default || m
}

const VOID = new Set(['img', 'br', 'hr', 'col'])
// mammoth escapes text and attribute values, so every "<" starts a tag. Split at depth 0 into chunks of about `target` characters.
function splitBlocks(html, target) {
  const out = []
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)[^>]*?(\/?)>/g
  let depth = 0
  let start = 0
  let m
  while ((m = re.exec(html))) {
    const closing = m[1] === '/'
    const name = m[2].toLowerCase()
    if (closing) depth--
    else if (!VOID.has(name) && m[3] !== '/') depth++
    if (depth <= 0 && re.lastIndex - start >= target) {
      out.push(html.slice(start, re.lastIndex))
      start = re.lastIndex
      depth = 0
    }
  }
  if (start < html.length) out.push(html.slice(start))
  return out
}

async function convert(arrayBuffer) {
  const mammoth = await loadMammoth()
  const res = await mammoth.convertToHtml({ arrayBuffer }, { styleMap: STYLE_MAP })
  const messages = res.messages.map((x) => ({ type: x.type, message: String(x.message) }))
  return { chunks: splitBlocks(res.value, 120000), messages, size: res.value.length }
}

if (IS_WORKER) {
  self.onmessage = async (e) => {
    try {
      self.postMessage({ ok: true, ...(await convert(e.data)) })
    } catch (err) {
      self.postMessage({ ok: false, error: String((err && err.message) || err) })
    }
  }
}

/* ---------- main thread ---------- */

const MAX_MATCHES = 100000
const MAX_PAINTED = 4000
const BLOCKS = 'p,li,td,th,h1,h2,h3,h4,h5,h6,blockquote,pre,caption'
const BAD_FILE =
  'This file could not be shown as a Word document. It may be damaged, password protected, or not a .docx file.'

let active = null // the one live viewer, destroyed before the next one mounts

const el = (tag, cls, text) => {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text != null) n.textContent = text
  return n
}
const svg = (inner) =>
  `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`
const ICON = { up: svg('<path d="m6 15 6-6 6 6"/>'), down: svg('<path d="m6 9 6 6 6-6"/>'), close: svg('<path d="M6 6l12 12M18 6 6 18"/>') }
const tick = () => new Promise((r) => setTimeout(r, 0))

// DOMPurify profile: strict allow list. No scripts, styles, forms, frames, objects, embeds, SVG, MathML, event or
// data-* attributes. Links only http, https, mailto and in-page "#" anchors. Images only as data: URIs of raster types.
let purifier = null
async function getPurifier() {
  if (purifier) return purifier
  const mod = await import('dompurify')
  const factory = mod.default || mod
  const own = factory(window) // a private instance, so these hooks never touch the app's other DOMPurify users
  own.addHook('uponSanitizeAttribute', (node, data) => {
    if (data.attrName === 'src' && !/^data:image\/(png|jpe?g|gif|bmp|webp);/i.test(String(data.attrValue).trim())) data.keepAttr = false
    if (data.attrName === 'href' && !/^(https?:|mailto:|#)/i.test(String(data.attrValue).trim())) data.keepAttr = false
  })
  own.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      if (node.hasAttribute('href')) node.setAttribute('rel', 'noopener noreferrer')
    } else if (node.tagName === 'IMG') {
      if (!node.hasAttribute('src')) node.remove()
      else if (!node.hasAttribute('alt')) node.setAttribute('alt', 'Image (no description in the file)')
    }
  })
  purifier = own
  return own
}
const PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr', 'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup',
    'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
    'a', 'img', 'blockquote', 'pre', 'code', 'span',
  ],
  ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'colspan', 'rowspan', 'id', 'rel'],
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false,
  ALLOW_UNKNOWN_PROTOCOLS: false,
  FORBID_TAGS: ['script', 'style', 'iframe', 'frame', 'object', 'embed', 'form', 'input', 'button', 'svg', 'math', 'link', 'meta', 'base'],
  FORBID_ATTR: ['style', 'class', 'target', 'srcset', 'on*'],
  SANITIZE_NAMED_PROPS: true,
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#)/i,
}

function startConversion(bytes) {
  // Returns { promise, cancel }. Tries a worker first; any worker failure falls back to the main thread.
  let worker = null
  let cancelled = false
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  const promise = new Promise((resolve, reject) => {
    const fallback = () => {
      if (cancelled) return
      if (worker) { worker.terminate(); worker = null }
      convert(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)).then((r) => resolve({ ...r, mode: 'main' }), reject)
    }
    try {
      worker = new Worker(new URL('./docxview.js', import.meta.url), { type: 'module' })
    } catch {
      fallback()
      return
    }
    worker.onmessage = (e) => {
      const d = e.data
      worker && worker.terminate()
      worker = null
      if (d.ok) resolve({ chunks: d.chunks, messages: d.messages, size: d.size, mode: 'worker' })
      else reject(new Error(d.error))
    }
    worker.onerror = (e) => {
      e.preventDefault && e.preventDefault()
      fallback()
    }
    worker.postMessage(copy, [copy])
  })
  return { promise, cancel: () => { cancelled = true; if (worker) worker.terminate(); worker = null } }
}

export async function mount(host, d, app) {
  if (active) active.destroy()
  host.textContent = ''
  const root = el('div', 'dx-root')
  root.setAttribute('role', 'document')
  const state = { alive: true, idx: null, matches: [], cur: -1, query: '' }
  const t0 = performance.now()

  const status = el('div', 'dx-status')
  status.setAttribute('role', 'status')
  status.setAttribute('aria-live', 'polite')
  const spin = el('span', 'dx-spin')
  spin.setAttribute('aria-hidden', 'true')
  const statusText = el('span', null, 'Opening ' + d.name + '...')
  const meter = el('span', 'dx-meter')
  const meterFill = el('span')
  meter.hidden = true
  meter.appendChild(meterFill)
  status.append(spin, statusText, meter)
  root.appendChild(status)
  host.appendChild(root)

  const fail = (msg) => {
    status.remove()
    const box = el('div', 'doc-viewer-error dx-error', msg)
    box.setAttribute('role', 'alert')
    root.appendChild(box)
  }

  /* find bar (same classes as the app's find bar) */
  const bar = el('div', 'find-bar dx-find')
  bar.hidden = true
  bar.setAttribute('role', 'search')
  bar.setAttribute('aria-label', 'Find in document')
  const row = el('div', 'find-row')
  const input = el('input', 'find-input')
  input.type = 'text'
  input.placeholder = 'Find in document'
  input.setAttribute('aria-label', 'Find in document')
  input.spellcheck = false
  const count = el('span', 'find-count')
  count.setAttribute('aria-live', 'polite')
  const mkBtn = (icon, label, fn) => {
    const b = el('button', 'find-btn')
    b.type = 'button'
    b.innerHTML = icon
    b.setAttribute('aria-label', label)
    b.title = label
    b.addEventListener('click', fn)
    return b
  }
  const prevB = mkBtn(ICON.up, 'Previous match (Shift+Enter)', () => step(-1))
  const nextB = mkBtn(ICON.down, 'Next match (Enter)', () => step(1))
  const closeB = mkBtn(ICON.close, 'Close find (Escape)', () => closeFind())
  row.append(input, count, el('span', 'find-sep'), prevB, nextB, closeB)
  bar.appendChild(row)
  host.appendChild(bar)

  const page = el('article', 'dx-page')
  page.tabIndex = 0
  page.setAttribute('aria-label', d.name)

  let page_ready = false
  let findOpen = false

  /* ---------- search ---------- */
  const buildIndex = () => {
    const walker = document.createTreeWalker(page, NodeFilter.SHOW_TEXT)
    const nodes = []
    const starts = []
    const parts = []
    let pos = 0
    let lastBlock = null
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const v = n.nodeValue
      if (!v) continue
      const blk = n.parentElement && n.parentElement.closest(BLOCKS)
      if (lastBlock !== null && blk !== lastBlock) {
        parts.push('\n')
        pos += 1
      }
      lastBlock = blk
      nodes.push(n)
      starts.push(pos)
      parts.push(v)
      pos += v.length
    }
    const text = parts.join('')
    const lower = text.toLowerCase()
    state.idx = { nodes, starts, text: lower.length === text.length ? lower : text, ci: lower.length === text.length }
  }
  const locate = (off) => {
    const { starts } = state.idx
    let lo = 0
    let hi = starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (starts[mid] <= off) lo = mid
      else hi = mid - 1
    }
    return lo
  }
  const rangeOf = (m) => {
    const { nodes, starts } = state.idx
    const a = locate(m)
    const b = locate(m + state.q.length - 1)
    const r = document.createRange()
    r.setStart(nodes[a], Math.min(m - starts[a], nodes[a].nodeValue.length))
    r.setEnd(nodes[b], Math.min(m + state.q.length - starts[b], nodes[b].nodeValue.length))
    return r
  }
  const hasHL = () => typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight !== 'undefined'
  const clearHL = () => {
    if (!hasHL()) return
    CSS.highlights.delete('dx-find')
    CSS.highlights.delete('dx-find-current')
  }
  const paint = () => {
    if (!hasHL()) return
    clearHL()
    if (!state.matches.length) return
    const all = new Highlight()
    const from = Math.max(0, Math.min(state.cur - MAX_PAINTED / 2, state.matches.length - MAX_PAINTED))
    const to = Math.min(state.matches.length, from + MAX_PAINTED)
    for (let i = from; i < to; i++) if (i !== state.cur) all.add(rangeOf(state.matches[i]))
    CSS.highlights.set('dx-find', all)
    const cur = new Highlight(rangeOf(state.matches[state.cur]))
    cur.priority = 1
    CSS.highlights.set('dx-find-current', cur)
  }
  const label = () => {
    const n = state.matches.length
    if (!state.query) count.textContent = ''
    else if (!n) count.textContent = 'No results'
    else count.textContent = state.cur + 1 + ' of ' + n + (n >= MAX_MATCHES ? '+' : '')
    input.classList.toggle('invalid', !!state.query && !n)
  }
  const reveal = () => {
    if (state.cur < 0) return
    const r = rangeOf(state.matches[state.cur])
    const node = r.startContainer.parentElement
    if (node) node.scrollIntoView({ block: 'center', inline: 'nearest' })
  }
  const run = (keep) => {
    const q = input.value
    state.query = q
    state.q = q.toLowerCase()
    state.matches = []
    if (q) {
      if (!state.idx) buildIndex()
      const needle = state.idx.ci ? state.q : q
      const hay = state.idx.text
      let at = hay.indexOf(needle)
      while (at !== -1 && state.matches.length < MAX_MATCHES) {
        state.matches.push(at)
        at = hay.indexOf(needle, at + needle.length)
      }
      state.q = needle
    }
    state.cur = state.matches.length ? (keep && state.cur >= 0 ? Math.min(state.cur, state.matches.length - 1) : 0) : -1
    label()
    paint()
    if (state.cur >= 0 && !keep) reveal()
  }
  function step(dir) {
    if (!state.matches.length) return run(false)
    state.cur = (state.cur + dir + state.matches.length) % state.matches.length
    label()
    paint()
    reveal()
  }
  function openFind() {
    findOpen = true
    bar.hidden = false
    const sel = window.getSelection && String(window.getSelection())
    if (sel && !/[\r\n]/.test(sel) && sel.length < 200 && page.contains(window.getSelection().anchorNode)) input.value = sel
    input.focus()
    input.select()
    run(false)
  }
  function closeFind() {
    findOpen = false
    bar.hidden = true
    clearHL()
    state.matches = []
    state.cur = -1
    page.focus({ preventScroll: true })
  }
  let timer = null
  input.addEventListener('input', () => {
    clearTimeout(timer)
    timer = setTimeout(() => run(false), 120)
  })
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      clearTimeout(timer)
      if (state.query !== input.value) run(false)
      else step(e.shiftKey ? -1 : 1)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      closeFind()
    }
  })

  /* Ctrl+F belongs to this viewer only while it is mounted: the shared find command is wrapped and restored on destroy. */
  const cmd = app && app.commands && app.commands.list().find((c) => c.id === 'find.open')
  const origRun = cmd && cmd.run
  const mine = () => {
    if (state.alive && root.isConnected && !host.hidden) return openFind()
    if (origRun) return origRun()
  }
  if (cmd) cmd.run = mine
  const onKey = (e) => {
    if (cmd || !(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'f' || host.hidden) return
    e.preventDefault()
    openFind()
  }
  document.addEventListener('keydown', onKey)

  /* in-page links (table of contents, bookmarks) */
  page.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href]')
    if (!a) return
    const href = a.getAttribute('href')
    if (href.startsWith('#')) {
      e.preventDefault()
      const id = decodeURIComponent(href.slice(1))
      const hit = [...page.querySelectorAll('[id]')].find((n) => n.id === 'user-content-' + id || n.id === id)
      if (hit) hit.scrollIntoView({ block: 'start' })
    }
  })

  /* cleanup */
  const b = d.bytes
  const bad = !b || !b.length ? 'This Word file is empty (0 bytes).' : !(b[0] === 0x50 && b[1] === 0x4b) ? BAD_FILE : null
  const conv = bad ? { promise: Promise.resolve(null), cancel() {} } : startConversion(b)
  conv.promise.catch(() => {}) // errors are handled where the promise is awaited; this only stops an unhandled-rejection report
  const onSwitch = (nd) => {
    if (nd !== d) destroy()
  }
  const bus = app && app.bus
  bus && bus.on('tab:switch', onSwitch)
  bus && bus.on('empty:show', () => destroy())
  function destroy() {
    if (!state.alive) return
    state.alive = false
    clearTimeout(timer)
    conv.cancel()
    clearHL()
    document.removeEventListener('keydown', onKey)
    if (cmd && cmd.run === mine) cmd.run = origRun
    root.remove()
    bar.remove()
    state.idx = null
    state.matches = []
    if (active && active.destroy === destroy) active = null
  }
  active = { destroy }

  /* ---------- convert, sanitise, render ---------- */
  if (bad) return fail(bad)

  let result
  try {
    result = await conv.promise
  } catch (e) {
    if (!state.alive) return
    console.info('[docxview] convert failed:', e && e.message)
    return fail(BAD_FILE)
  }
  if (!state.alive) return
  const tConv = performance.now()
  root.dataset.mode = result.mode
  root.dataset.convertMs = String(Math.round(tConv - t0))

  const purify = await getPurifier()
  if (!purify.isSupported) return fail('This viewer cannot render documents in this environment.')

  // messages: unsupported features, shown as a quiet collapsible note
  const msgs = new Map()
  for (const m of result.messages) msgs.set(m.message, (msgs.get(m.message) || 0) + 1)
  if (msgs.size) {
    const det = el('details', 'dx-notes')
    det.appendChild(el('summary', null, 'Some Word features are not shown (' + msgs.size + ')'))
    const ul = el('ul')
    for (const [text, n] of msgs) ul.appendChild(el('li', null, n > 1 ? text + ' (' + n + ' times)' : text))
    det.appendChild(ul)
    root.insertBefore(det, status)
  }
  root.appendChild(page)
  // Skip layout and paint of off-screen blocks only for big documents; small ones render plainly.
  if (result.size > 400000) page.classList.add('dx-lazy')

  const total = result.chunks.length
  if (!total) {
    status.remove()
    page.appendChild(el('p', 'dx-empty', 'This document has no content to show.'))
    return
  }
  meter.hidden = false
  let done = 0
  let sliceStart = performance.now()
  for (const chunk of result.chunks) {
    if (!state.alive) return
    const clean = purify.sanitize(chunk, PURIFY_CONFIG)
    const tpl = document.createElement('template')
    tpl.innerHTML = clean
    page.appendChild(tpl.content)
    state.idx = null
    done++
    if (performance.now() - sliceStart > 12) {
      const pct = Math.round((done / total) * 100)
      statusText.textContent = 'Rendering ' + pct + '%'
      meterFill.style.width = pct + '%'
      await tick()
      sliceStart = performance.now()
    }
  }
  if (!state.alive) return
  status.remove()
  page_ready = true
  root.dataset.renderMs = String(Math.round(performance.now() - tConv))
  root.dataset.totalMs = String(Math.round(performance.now() - t0))
  root.dataset.chunks = String(total)
  root.dataset.ready = '1'
  if (findOpen) run(true)
  void page_ready
}
