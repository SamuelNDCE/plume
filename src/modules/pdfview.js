// PDF viewer. mount(host, doc, app) fills the host with a toolbar and a continuous, lazily rendered page column.
// pdf.js (and its worker, same-origin via Vite) is imported on first use, so startup is unaffected.
// Only pages near the viewport hold a canvas and a text layer; the rest are empty boxes of the right size.
// Out of scope here: password prompt, export, annotations/forms, link clicking.
// Page rotation is for viewing only: it lives in ROT for the session and is never written to the file.
// Print builds a sheet of page images (every page, with its rotation) and calls window.print(), see printPdf().

import { isTextField, wrapCommand, shortcutPanel, PDF_KEYS } from './shortcuts.js'

const ZOOMS = [50, 75, 100, 125, 150, 200, 300, 400]
const CSS_UNITS = 96 / 72 // 100% = actual size on a 96 dpi screen
const PAD = 12 // keep in sync with .pdfv-pages padding and gap in modules.css
const GAP = 12
const PRE = 1 // pages rendered beyond the visible range
const KEEP = 4 // pages kept beyond the visible range, everything further is released
const MAX_JOBS = 2
const MAX_PIXELS = 36e6 // per canvas, lowers the output scale instead of failing on huge zooms
const SAVED = new WeakMap() // doc -> { page, mode, pct } so a tab switch returns to the same spot
const ROT = new WeakMap() // doc -> Map(page index -> extra clockwise degrees 0/90/180/270), view only, kept for the session
const PRINT_SCALE = 2 // css px per pdf point on the print sheet (144 dpi)

let libPromise = null
const loadLib = () =>
  (libPromise ||= (async () => {
    const [lib, worker] = await Promise.all([import('pdfjs-dist/build/pdf.mjs'), import('pdfjs-dist/build/pdf.worker.mjs?url')])
    lib.GlobalWorkerOptions.workerSrc = worker.default
    return lib
  })())

const svg = (inner) => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`
const ICON = {
  up: svg('<path d="m6 15 6-6 6 6"/>'),
  down: svg('<path d="m6 9 6 6 6-6"/>'),
  minus: svg('<path d="M5 12h14"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  fitW: svg('<path d="M4 7v10M20 7v10M8 12h8m-2-2 2 2-2 2m-4-4-2 2 2 2"/>'),
  left: svg('<path d="m15 6-6 6 6 6"/>'),
  fitP: svg('<rect x="7" y="3" width="10" height="18" rx="1"/>'),
  find: svg('<circle cx="11" cy="11" r="6"/><path d="m20 20-4.2-4.2"/>'),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  rotate: svg('<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v5h-5"/>'),
  print: svg('<path d="M7 9V3h10v6"/><rect x="4" y="9" width="16" height="8" rx="1.5"/><path d="M7 14h10v7H7z"/>'),
}

const el = (tag, cls, attrs) => {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k])
  return n
}
const btn = (icon, label, cls) => {
  const b = el('button', 'find-btn pdfv-btn' + (cls ? ' ' + cls : ''), { type: 'button', 'aria-label': label, title: label })
  b.innerHTML = icon
  return b
}
const tick = () => new Promise((r) => setTimeout(r, 0))
const clamp = (v, a, b) => Math.min(b, Math.max(a, v))


/* ---------- page thumbnails in the sidebar ---------- */
// While a PDF is open, body.pdf-pages swaps the pane's file list for this pane and the rail's Pages button turns active.
// sidebar.js watches the class and plays the 220 ms reveal from the rail (CSS in modules.css); the pane title ("Pages") is set
// there too. The class and the pane are removed again when the last viewer goes away.
const THUMB_W = 112
let thumbPane = null
let thumbTimer = 0
let thumbRemove = 0

function claimPane() {
  clearTimeout(thumbTimer)
  clearTimeout(thumbRemove)
  if (!thumbPane || !thumbPane.isConnected) {
    const side = document.getElementById('sidebar')
    if (!side) return null
    thumbPane = el('div', 'pane pdfp', { id: 'pdf-pages-pane', role: 'navigation', 'aria-label': 'Page thumbnails' })
    side.appendChild(thumbPane)
    const head = el('div', 'pdfp-head')
    const t = el('span', 'pdfp-title')
    t.textContent = 'Pages'
    const hide = btn(ICON.left, 'Hide page list', 'pdfp-collapse')
    hide.addEventListener('click', () => document.body.classList.add('pages-off'))
    head.append(t, hide)
    thumbPane.appendChild(head)
  }
  watchMin()
  const fresh = !document.body.classList.contains('pdf-pages')
  document.body.classList.add('pdf-pages')
  // the sidebar shows Pages on entering a PDF; restore the user's last choice (hidden) right after that
  if (fresh) {
    settling = true
    setTimeout(() => {
      if (pagesMin && document.body.classList.contains('pdf-pages')) document.body.classList.add('pages-off')
      setTimeout(() => (settling = false), 80)
    }, 0)
  }
  return thumbPane
}

// Whether the user left the page list hidden, remembered across PDFs and restarts.
const MIN_KEY = 'plume.pdfPagesHidden'
let pagesMin = false
try { pagesMin = localStorage.getItem(MIN_KEY) === '1' } catch {}
let settling = false
let minObs = null
function watchMin() {
  if (minObs) return
  minObs = new MutationObserver(() => {
    const b = document.body.classList
    if (settling || !b.contains('pdf-pages')) return
    const off = b.contains('pages-off')
    if (off === pagesMin) return
    pagesMin = off
    try { localStorage.setItem(MIN_KEY, off ? '1' : '0') } catch {}
  })
  minObs.observe(document.body, { attributes: true, attributeFilter: ['class'] })
}

// a short grace period lets PDF -> PDF re-renders reuse the pane without a collapse
function releasePane() {
  clearTimeout(thumbTimer)
  thumbTimer = setTimeout(() => {
    document.body.classList.remove('pdf-pages')
    clearTimeout(thumbRemove)
    thumbRemove = setTimeout(() => {
      if (!document.body.classList.contains('pdf-pages') && thumbPane) {
        thumbPane.remove()
        thumbPane = null
      }
    }, 300)
  }, 60)
}

class Thumbs {
  constructor(viewer) {
    this.v = viewer
    this.dead = false
    this.items = []
    this.queue = []
    this.active = 0
    this.pane = claimPane()
    if (!this.pane) return
    this.list = el('div', 'pdfp-list')
    this.pane.appendChild(this.list)
    const frag = document.createDocumentFragment()
    for (let i = 0; i < viewer.n; i++) {
      const b = el('button', 'pdfp-item', { type: 'button', 'aria-label': 'Go to page ' + (i + 1), 'data-i': String(i) })
      const box = el('span', 'pdfp-box')
      const num = el('span', 'pdfp-num')
      num.textContent = String(i + 1)
      b.append(box, num)
      frag.appendChild(b)
      this.items.push({ b, box, canvas: null, task: null, job: false, ar: 0, tok: 0 })
    }
    this.list.appendChild(frag)
    this.list.addEventListener('click', (e) => {
      const b = e.target.closest('.pdfp-item')
      if (b) {
        if (document.activeElement !== b) b.focus({ preventScroll: true }) // a click on a button does not always focus it
        this.v.goTo(Number(b.dataset.i) + 1)
      }
    })
    // keyboard on the list: one page per key press, the main view follows at once
    this.list.addEventListener('keydown', (e) => this.onKey(e))
    this.io = new IntersectionObserver(
      (ents) => {
        for (const en of ents) {
          const i = Number(en.target.dataset.i)
          if (en.isIntersecting) this.want(i)
          else this.drop(i)
        }
      },
      { root: this.pane, rootMargin: '300px 0px' },
    )
    this.items.forEach((it) => this.io.observe(it.b))
    this.sync()
    // once the expand animation has given the pane its height, bring the current page into view
    this.settle = setTimeout(() => {
      const c = this.v.cur
      this.cur = 0
      this.setCurrent(c)
    }, 260)
  }

  onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
    const b = e.target.closest && e.target.closest('.pdfp-item')
    if (!b) return
    const at = Number(b.dataset.i) + 1
    const k = e.key
    let to = 0
    if (k === 'ArrowDown' || k === 'ArrowRight' || k === 'PageDown') to = at + 1
    else if (k === 'ArrowUp' || k === 'ArrowLeft' || k === 'PageUp') to = at - 1
    else if (k === 'Home') to = 1
    else if (k === 'End') to = this.v.n
    else return
    e.preventDefault()
    e.stopPropagation()
    to = clamp(to, 1, this.v.n)
    this.v.goTo(to)
    const it = this.items[to - 1]
    if (!it) return
    it.b.focus({ preventScroll: true })
    it.b.scrollIntoView({ block: 'nearest' })
  }

  // a page was rotated: new box height, new picture
  rotated(i) {
    const it = this.items[i]
    if (!it || !this.pane) return
    this.sync()
    this.drop(i)
    this.want(i)
  }

  sync() {
    if (!this.pane) return
    this.v.pages.forEach((pg, i) => {
      const it = this.items[i]
      const d = this.v.dims(i)
      const ar = d.h / d.w
      if (it && it.ar !== ar) {
        it.ar = ar
        it.box.style.height = Math.round(THUMB_W * ar) + 'px'
      }
    })
  }

  setCurrent(n) {
    if (!this.pane || n === this.cur) return
    if (this.cur) {
      const o = this.items[this.cur - 1]
      if (o) {
        o.b.classList.remove('cur')
        o.b.removeAttribute('aria-current')
      }
    }
    this.cur = n
    const it = this.items[n - 1]
    if (!it) return
    it.b.classList.add('cur')
    it.b.setAttribute('aria-current', 'page')
    const pr = this.pane.getBoundingClientRect()
    const r = it.b.getBoundingClientRect()
    if (pr.height && (r.top < pr.top + 24 || r.bottom > pr.bottom - 8)) this.pane.scrollTop += r.top - pr.top - pr.height / 3
  }

  want(i) {
    const it = this.items[i]
    if (!it || it.canvas || it.job) return
    it.job = true
    this.queue.push(i)
    this.pump()
  }

  pump() {
    while (!this.dead && this.active < 2 && this.queue.length) {
      const i = this.queue.shift()
      if (this.items[i].job) this.render(i)
    }
  }

  async render(i) {
    const it = this.items[i]
    const tok = ++it.tok
    this.active++
    try {
      const page = await this.v.pdf.getPage(i + 1)
      if (this.dead || tok !== it.tok) return
      const rotation = this.v.rotation(page, i)
      const base = page.getViewport({ scale: 1, rotation })
      const scale = THUMB_W / base.width
      const vp = page.getViewport({ scale, rotation })
      const dpr = window.devicePixelRatio || 1
      const canvas = el('canvas', 'pdfp-canvas')
      canvas.width = Math.max(1, Math.floor(vp.width * dpr))
      canvas.height = Math.max(1, Math.floor(vp.height * dpr))
      const rt = page.render({ canvas, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined, background: this.v.paper() })
      it.task = rt
      await rt.promise
      it.task = null
      if (this.dead || tok !== it.tok) {
        canvas.width = canvas.height = 0
        return
      }
      it.box.style.height = Math.round(THUMB_W * (base.height / base.width)) + 'px'
      it.box.appendChild(canvas)
      it.canvas = canvas
      page.cleanup()
      if (!Thumbs.first) {
        Thumbs.first = true
        document.documentElement.dataset.pdfFirstThumb = String(Math.round(performance.now()))
      }
    } catch (e) {
      /* cancelled or document gone */
    } finally {
      it.job = false
      this.active = Math.max(0, this.active - 1)
      this.pump()
    }
  }

  drop(i) {
    const it = this.items[i]
    if (!it) return
    it.tok++
    it.job = false
    if (it.task) {
      try { it.task.cancel() } catch {}
      it.task = null
    }
    if (it.canvas) {
      it.canvas.width = it.canvas.height = 0
      it.canvas.remove()
      it.canvas = null
    }
  }

  destroy() {
    if (this.dead) return
    this.dead = true
    clearTimeout(this.settle)
    if (this.io) this.io.disconnect()
    this.items.forEach((_, i) => this.drop(i))
    this.queue = []
    if (this.list) this.list.remove()
    this.items = []
    if (this.pane) releasePane()
  }
}

class PdfViewer {
  constructor(host, d, app) {
    this.host = host
    this.d = d
    this.app = app
    this.dead = false
    this.pdf = null
    this.task = null
    this.n = 0
    this.pages = [] // { box, w, h, canvas, textEl, tl, job, jobScale, token, doneScale, textDone, waiters }
    this.tops = []
    this.cur = 1
    this.mode = 'width' // 'width' | 'page' | 'custom'
    this.pct = 100
    this.scale = 1
    this.jobs = 0
    this.texts = [] // per page: { s, starts, strs } once extracted
    this.matches = []
    this.matchByPage = new Map()
    this.mi = -1
    this.sTok = 0
    this.raf = 0
    this.thumbs = null
    this.zoomTimer = 0
    this.cleanups = []
    this.build()
  }

  /* ---------- DOM ---------- */
  build() {
    const root = (this.root = el('div', 'pdfv'))
    const bar = el('div', 'pdfv-bar', { role: 'toolbar', 'aria-label': 'PDF controls', 'aria-orientation': 'horizontal' })
    this.prevB = btn(ICON.up, 'Previous page')
    this.nextB = btn(ICON.down, 'Next page')
    this.pageIn = el('input', 'pdfv-page', { type: 'text', inputmode: 'numeric', 'aria-label': 'Go to page number', autocomplete: 'off', spellcheck: 'false' })
    this.pageTot = el('span', 'pdfv-total')
    this.zoomOutB = btn(ICON.minus, 'Zoom out (Ctrl+Minus)')
    this.zoomInB = btn(ICON.plus, 'Zoom in (Ctrl+Plus)')
    this.zoomSel = el('select', 'pdfv-zoom', { 'aria-label': 'Zoom level' })
    this.fitWB = btn(ICON.fitW, 'Fit width (Ctrl+0)')
    this.fitPB = btn(ICON.fitP, 'Fit page (Ctrl+Shift+0)')
    this.findB = btn(ICON.find, 'Find in PDF (Ctrl+F)')
    this.rotB = btn(ICON.rotate, 'Rotate page 90 degrees clockwise (Ctrl+Shift+R). For viewing only, not saved to the file')
    this.printB = btn(ICON.print, 'Print the PDF (Ctrl+P)')
    const sep = () => el('span', 'find-sep', { role: 'separator', 'aria-hidden': 'true' })
    const grow = el('span', 'pdfv-grow')
    bar.append(this.prevB, this.pageIn, this.pageTot, this.nextB, sep(), this.zoomOutB, this.zoomSel, this.zoomInB, sep(), this.fitWB, this.fitPB, sep(), this.rotB, grow, this.printB, this.findB)
    this.buildZoomOptions()
    // page-number box: opens when digits are typed while the viewer has focus
    const jb = (this.jumpBox = el('div', 'pdfv-jump', { role: 'dialog', 'aria-label': 'Go to page' }))
    jb.hidden = true
    const jl = el('span', 'pdfv-jump-label')
    jl.textContent = 'Go to page'
    this.jumpIn = el('input', 'pdfv-jump-in', { type: 'text', inputmode: 'numeric', 'aria-label': 'Page number, Enter to go, Escape to cancel', autocomplete: 'off', spellcheck: 'false' })
    this.jumpTot = el('span', 'pdfv-jump-total')
    jb.append(jl, this.jumpIn, this.jumpTot)

    this.scroller = el('div', 'pdfv-scroll', { tabindex: '0', role: 'document', 'aria-label': this.d.name + ', PDF pages' })
    this.pagesEl = el('div', 'pdfv-pages')
    this.scroller.appendChild(this.pagesEl)
    this.status = el('div', 'pdfv-status', { role: 'status', 'aria-live': 'polite' })
    this.status.textContent = 'Opening ' + this.d.name + '...'

    const fb = (this.fbar = el('div', 'find-bar pdfv-find', { role: 'search', 'aria-label': 'Find in PDF' }))
    fb.hidden = true
    const row = el('div', 'find-row')
    this.findIn = el('input', 'find-input', { type: 'text', placeholder: 'Find in PDF', 'aria-label': 'Find in PDF', spellcheck: 'false', autocomplete: 'off' })
    this.findCount = el('span', 'find-count', { role: 'status', 'aria-live': 'polite' })
    this.fPrev = btn(ICON.up, 'Previous match (Shift+Enter)')
    this.fNext = btn(ICON.down, 'Next match (Enter)')
    this.fClose = btn(ICON.close, 'Close find (Escape)')
    row.append(this.findIn, this.findCount, this.fPrev, this.fNext, this.fClose)
    fb.appendChild(row)

    root.append(bar, this.scroller, this.status, fb, jb)
    this.panel = shortcutPanel(root, PDF_KEYS, ICON.close)
    this.host.appendChild(root)
    this.wire()
  }

  buildZoomOptions() {
    const s = this.zoomSel
    s.textContent = ''
    const add = (v, t) => {
      const o = el('option')
      o.value = v
      o.textContent = t
      s.appendChild(o)
    }
    add('width', 'Fit width')
    add('page', 'Fit page')
    for (const z of ZOOMS) add(String(z), z + '%')
    add('custom', '')
    this.customOpt = s.lastChild
    this.syncZoomUi()
  }

  syncZoomUi() {
    const pct = Math.round((this.scale / CSS_UNITS) * 100)
    let v = this.mode
    if (this.mode === 'custom') v = ZOOMS.includes(pct) ? String(pct) : 'custom'
    this.customOpt.textContent = pct + '%'
    this.customOpt.hidden = v !== 'custom'
    this.zoomSel.value = v
    this.fitWB.classList.toggle('on', this.mode === 'width')
    this.fitPB.classList.toggle('on', this.mode === 'page')
    this.fitWB.setAttribute('aria-pressed', String(this.mode === 'width'))
    this.fitPB.setAttribute('aria-pressed', String(this.mode === 'page'))
    this.zoomOutB.disabled = this.mode === 'custom' && pct <= ZOOMS[0]
    this.zoomInB.disabled = this.mode === 'custom' && pct >= ZOOMS[ZOOMS.length - 1]
  }

  syncPageUi() {
    if (document.activeElement !== this.pageIn) this.pageIn.value = String(this.cur)
    this.pageTot.textContent = '/ ' + this.n
    if (this.thumbs) this.thumbs.setCurrent(this.cur)
    this.prevB.disabled = this.cur <= 1
    this.nextB.disabled = this.cur >= this.n
  }

  on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts)
    this.cleanups.push(() => target.removeEventListener(type, fn, opts))
  }

  wire() {
    this.on(this.prevB, 'click', () => this.goTo(this.cur - 1, true))
    this.on(this.nextB, 'click', () => this.goTo(this.cur + 1, true))
    this.on(this.pageIn, 'focus', () => this.pageIn.select())
    this.on(this.pageIn, 'keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        const v = parseInt(this.pageIn.value, 10)
        if (Number.isFinite(v)) this.goTo(v)
        this.scroller.focus({ preventScroll: true })
      } else if (e.key === 'Escape') {
        this.pageIn.value = String(this.cur)
        this.scroller.focus({ preventScroll: true })
      }
    })
    this.on(this.pageIn, 'blur', () => (this.pageIn.value = String(this.cur)))
    this.on(this.zoomOutB, 'click', () => this.zoomStep(-1))
    this.on(this.zoomInB, 'click', () => this.zoomStep(1))
    this.on(this.fitWB, 'click', () => this.setZoom('width'))
    this.on(this.fitPB, 'click', () => this.setZoom('page'))
    this.on(this.zoomSel, 'change', () => {
      const v = this.zoomSel.value
      if (v === 'width' || v === 'page') this.setZoom(v)
      else if (v !== 'custom') this.setZoom('custom', Number(v))
    })
    this.on(this.findB, 'click', () => (this.fbar.hidden ? this.openFind() : this.closeFind()))
    this.on(this.rotB, 'click', () => this.rotateCurrent())
    this.on(this.printB, 'click', () => this.printPdf())
    this.on(this.jumpIn, 'keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        const v = parseInt(this.jumpIn.value, 10)
        this.closeJump()
        if (Number.isFinite(v)) this.goTo(v)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        this.closeJump()
      }
    })
    this.on(this.jumpIn, 'input', () => (this.jumpIn.value = this.jumpIn.value.replace(/\D/g, '').slice(0, String(this.n).length)))
    this.on(this.jumpIn, 'blur', () => this.closeJump(true))
    this.on(this.fNext, 'click', () => this.step(1))
    this.on(this.fPrev, 'click', () => this.step(-1))
    this.on(this.fClose, 'click', () => this.closeFind())
    let ft = 0
    this.on(this.findIn, 'input', () => {
      clearTimeout(ft)
      ft = setTimeout(() => this.runSearch(), 180)
    })
    this.cleanups.push(() => clearTimeout(ft))
    this.on(this.findIn, 'keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        if (this.pendingSearch) return
        this.step(e.shiftKey ? -1 : 1)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        this.closeFind()
      }
    })
    this.on(this.scroller, 'scroll', () => this.schedule(), { passive: true })
    this.on(this.scroller, 'wheel', (e) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      e.stopPropagation()
      const cur = Math.round((this.scale / CSS_UNITS) * 100)
      this.setZoom('custom', clamp(cur * (e.deltaY < 0 ? 1.1 : 1 / 1.1), ZOOMS[0], ZOOMS[ZOOMS.length - 1]), true)
    }, { passive: false })
    const ro = new ResizeObserver(() => {
      if (!this.pages.length) return
      if (this.mode !== 'custom') this.setZoom(this.mode, undefined, true)
      else this.schedule()
    })
    ro.observe(this.scroller)
    this.cleanups.push(() => ro.disconnect())
    // keys while this PDF is the active view. The app's own window handler runs commands first, so the commands that
    // collide with PDF keys are taken over here while this viewer is on screen and run unchanged otherwise.
    const act = () => this.isActive()
    const own = [
      ['view.zoomIn', () => this.zoomStep(1)],
      ['view.zoomOut', () => this.zoomStep(-1)],
      ['view.zoomReset', () => this.setZoom('width')],
      ['view.source', () => this.panel.toggle()],
      ['help.shortcuts', () => this.panel.toggle()], // F1: the app's help command (sidebar.js) otherwise
      ['text.gotoLine', () => (this.pageIn.focus(), this.pageIn.select())], // Ctrl+G: go to page (the app's Go to line otherwise)
    ]
    for (const [id, fn] of own) this.cleanups.push(wrapCommand(this.app, id, act, fn))
    // this viewer owns Ctrl+F (and Ctrl+H, there is nothing to replace) only while it is the active view
    this.cleanups.push(wrapCommand(this.app, 'find.open', act, () => this.openFind(), true))
    this.cleanups.push(wrapCommand(this.app, 'find.replace', act, () => this.openFind(), true))
    // Ctrl+Shift+R (Show Recent Files elsewhere) rotates and Ctrl+P (command palette elsewhere) prints, only for those exact key
    // presses while this viewer is active. The header's palette button and the rail's Recent button run the same commands from a
    // click, and those must keep working, hence the check of the event that is being handled.
    const hot = (ch, shift) => () => {
      const ev = window.event
      return this.isActive() && !!ev && ev.type === 'keydown' && (ev.ctrlKey || ev.metaKey) && !ev.altKey && ev.shiftKey === shift && String(ev.key).toLowerCase() === ch
    }
    this.cleanups.push(wrapCommand(this.app, 'recent.show', hot('r', true), () => this.rotateCurrent(), true))
    this.cleanups.push(wrapCommand(this.app, 'palette.open', hot('p', false), () => this.printPdf(), true))
    this.on(document, 'keydown', (e) => this.onKey(e))
    // a theme switch repaints the pages with the new paper colour
    const tmo = new MutationObserver(() => {
      for (let i = 0; i < this.pages.length; i++) if (this.pages[i].canvas) this.pages[i].doneScale = 0
      this.schedule()
    })
    tmo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    this.cleanups.push(() => tmo.disconnect())
    // leaving the tab (host hidden or emptied) releases the document and every canvas
    const mo = new MutationObserver(() => {
      if (this.host.hidden || !this.root.isConnected) this.destroy()
    })
    mo.observe(this.host, { attributes: true, attributeFilter: ['hidden'], childList: true })
    this.cleanups.push(() => mo.disconnect())
  }

  // light themes tint the paper with the theme background; dark themes keep white paper so the ink stays readable
  paper() {
    const cs = getComputedStyle(document.documentElement)
    if (cs.colorScheme && cs.colorScheme.includes('dark') && !cs.colorScheme.includes('light')) return 'rgb(255,255,255)'
    return cs.getPropertyValue('--bg').trim() || 'rgb(255,255,255)'
  }

  // Adobe Reader / Chrome PDF viewer keys that are not app commands. Plain keys only act when focus is in the
  // pages or nowhere in particular, never in a text field, a button or the sidebar.
  onKey(e) {
    if (!this.isActive() || e.defaultPrevented) return
    const k = e.key
    const mod = e.ctrlKey || e.metaKey
    const t = e.target
    const stop = () => {
      e.preventDefault()
      e.stopPropagation()
    }
    if (k === 'Escape' && this.panel.isOpen()) return stop(), this.panel.close()
    if (k === 'F3') {
      stop()
      return this.fbar.hidden ? this.openFind() : this.step(e.shiftKey ? -1 : 1)
    }
    if (mod && e.shiftKey && !e.altKey && e.code === 'Digit0') return stop(), this.setZoom('page')
    if (isTextField(t)) return
    if (k === 'F1') return stop(), this.panel.toggle()
    if (!mod && !e.altKey && k.length === 1 && k >= '0' && k <= '9') {
      const inThumbs = !!(this.thumbs && this.thumbs.pane && this.thumbs.pane.contains(t))
      if (t === document.body || t === document.documentElement || this.scroller.contains(t) || inThumbs) return stop(), this.openJump(k)
    }
    const inView = t === document.body || t === document.documentElement || this.scroller.contains(t)
    if (mod && !e.altKey) {
      if ((k === 'g' || k === 'G') && !e.shiftKey) return stop(), this.pageIn.focus(), this.pageIn.select()
      if (k === '1') return stop(), this.setZoom('custom', 100)
      if (!inView) return
      if ((k === 'a' || k === 'A') && !e.shiftKey) return stop(), this.selectPageText()
      if ((k === 'c' || k === 'C') && !e.shiftKey && this.copySelection()) return stop()
      return
    }
    if (e.altKey || !inView) return
    if (k === 'Escape' && !this.fbar.hidden) return stop(), this.closeFind()
    const sc = this.scroller
    const screen = Math.max(40, sc.clientHeight - 40)
    if (k === 'Enter' && !this.fbar.hidden && this.matches.length) return stop(), this.step(e.shiftKey ? -1 : 1)
    if (k === 'PageDown' || (k === ' ' && !e.shiftKey)) return stop(), (sc.scrollTop += screen)
    if (k === 'PageUp' || (k === ' ' && e.shiftKey)) return stop(), (sc.scrollTop -= screen)
    if (k === 'Home') return stop(), this.goTo(1)
    if (k === 'End') return stop(), this.goTo(this.n)
    if (k === 'ArrowDown') return stop(), (sc.scrollTop += 48)
    if (k === 'ArrowUp') return stop(), (sc.scrollTop -= 48)
    if (k === 'ArrowRight') return stop(), (sc.scrollLeft += 48)
    if (k === 'ArrowLeft') return stop(), (sc.scrollLeft -= 48)
  }

  selectPageText() {
    let pg = this.pages[this.cur - 1]
    if (!pg || !pg.textEl) pg = this.pages.find((p) => p.textEl) // the page is still redrawing: use the nearest one that has text
    const s = window.getSelection()
    if (!pg || !pg.textEl || !s) return
    const r = document.createRange()
    r.selectNodeContents(pg.textEl)
    s.removeAllRanges()
    s.addRange(r)
  }

  copySelection() {
    const s = window.getSelection()
    const text = s ? s.toString() : ''
    if (!text || !s.anchorNode || !this.root.contains(s.anchorNode)) return false
    const done = () => (this.root.dataset.copied = String(text.length))
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => document.execCommand('copy') && done())
    else if (document.execCommand('copy')) done()
    return true
  }

  isActive() {
    return !this.dead && this.root.isConnected && !this.host.hidden
  }

  /* ---------- open ---------- */
  async open() {
    let lib
    try {
      lib = await loadLib()
      this.lib = lib
      // pdf.js transfers the buffer to its worker; hand it a copy so the tab can be re-mounted from d.bytes
      const data = new Uint8Array(this.d.bytes.byteLength)
      data.set(this.d.bytes)
      this.task = lib.getDocument({ data, isEvalSupported: false, enableXfa: false, verbosity: 0 })
      this.pdf = await this.task.promise
      if (this.dead) return
      this.n = this.pdf.numPages
      if (!this.n) throw Object.assign(new Error('no pages'), { name: 'InvalidPDFException' })
      const p1 = await this.pdf.getPage(1)
      if (this.dead) return
      const vp = p1.getViewport({ scale: 1 })
      this.initPages(vp.width, vp.height)
      try {
        this.thumbs = new Thumbs(this)
      } catch (e) {
        console.warn('[pdfview] thumbnails', e)
        this.thumbs = null
      }
      const sv = SAVED.get(this.d)
      if (sv) {
        this.mode = sv.mode
        this.pct = sv.pct
      }
      this.applyZoom()
      this.status.hidden = true
      this.syncPageUi()
      if (sv && sv.page > 1) this.goTo(sv.page)
      else this.refresh()
      this.scroller.focus({ preventScroll: true })
      this.discoverSizes()
    } catch (e) {
      if (!this.dead) this.fail(e)
    }
  }

  fail(e) {
    console.info('[pdfview]', e && e.name, e && e.message)
    const name = e && e.name
    let title = 'This PDF could not be opened'
    let body = 'The file may be damaged or is not a PDF.'
    if (name === 'PasswordException') {
      title = 'This PDF is password protected'
      body = 'Plume cannot open encrypted PDFs yet: a password prompt is not supported.'
    } else if (name === 'InvalidPDFException') {
      body = 'The file is not a valid PDF or is damaged.'
    } else if (name === 'MissingPDFException') {
      body = 'The file could not be found.'
    } else if (e && e.message) {
      body = 'The file may be damaged. Details: ' + String(e.message).slice(0, 160)
    }
    this.root.textContent = ''
    const m = el('div', 'doc-viewer-error pdfv-msg', { role: 'alert' })
    const h = el('strong')
    h.textContent = title
    const p = el('p')
    p.textContent = body + ' (' + this.d.name + ')'
    m.append(h, p)
    this.root.appendChild(m)
    this.cleanupDoc()
  }

  initPages(w, h) {
    this.pagesEl.textContent = ''
    const frag = document.createDocumentFragment()
    for (let i = 0; i < this.n; i++) {
      const box = el('div', 'pdfv-pageBox', { 'data-page': String(i + 1), role: 'img', 'aria-label': 'Page ' + (i + 1) + ' of ' + this.n })
      frag.appendChild(box)
      this.pages.push({ box, w, h, canvas: null, textEl: null, tl: null, job: false, jobScale: 0, token: 0, doneScale: 0, textDone: false, waiters: [], known: i === 0 })
    }
    this.pagesEl.appendChild(frag)
    this.tops = new Array(this.n).fill(0)
  }

  // Real page sizes arrive in the background; placeholders use page 1's size until then.
  async discoverSizes() {
    let i = 1
    while (i < this.n && !this.dead) {
      const end = Math.min(this.n, i + 6)
      const got = await Promise.all(
        Array.from({ length: end - i }, (_, k) => this.pdf.getPage(i + k + 1).then((p) => p.getViewport({ scale: 1 })).catch(() => null)),
      )
      if (this.dead) return
      let changed = false
      got.forEach((vp, k) => {
        const pg = this.pages[i + k]
        if (!vp || !pg) return
        pg.known = true
        if (Math.abs(pg.w - vp.width) > 0.01 || Math.abs(pg.h - vp.height) > 0.01) {
          pg.w = vp.width
          pg.h = vp.height
          changed = true
        }
      })
      if (changed) this.relayout()
      i = end
      await tick()
    }
  }

  /* ---------- rotation (view only), jump box, print ---------- */
  extra(i) {
    const m = ROT.get(this.d)
    return (m && m.get(i)) || 0
  }

  // absolute rotation for pdf.js: the page's own rotation plus the viewing rotation
  rotation(page, i) {
    return (((page.rotate || 0) + this.extra(i)) % 360 + 360) % 360
  }

  // page size in pdf points as shown (width and height swap at 90 and 270)
  dims(i) {
    const pg = this.pages[i]
    return this.extra(i) % 180 ? { w: pg.h, h: pg.w } : { w: pg.w, h: pg.h }
  }

  rotateCurrent() {
    if (!this.pdf || !this.n) return
    const i = this.cur - 1
    let m = ROT.get(this.d)
    if (!m) ROT.set(this.d, (m = new Map()))
    const next = (this.extra(i) + 90) % 360
    if (next) m.set(i, next)
    else m.delete(i)
    this.root.dataset.rotated = i + 1 + ':' + next
    this.release(i)
    this.applyZoom()
    this.goTo(i + 1)
    if (this.thumbs) this.thumbs.rotated(i)
    this.refresh()
  }

  openJump(first) {
    this.jumpTot.textContent = '/ ' + this.n
    this.jumpBox.hidden = false
    this.jumpIn.value = first
    this.jumpIn.focus()
    this.jumpIn.setSelectionRange(first.length, first.length)
  }

  closeJump(fromBlur) {
    if (this.jumpBox.hidden) return
    this.jumpBox.hidden = true
    if (!fromBlur) this.scroller.focus({ preventScroll: true })
  }

  // Print: every page is drawn to an image on a sheet that only shows in print (see .pdfv-printsheet in modules.css), then
  // window.print() opens the system print dialog. Pages carry their viewing rotation.
  async printPdf() {
    if (!this.pdf || !this.n || this.printing) return
    this.printing = true
    const total = this.n
    const sheet = el('div', 'pdfv-printsheet', { 'aria-hidden': 'true' })
    const urls = []
    this.status.hidden = false
    try {
      for (let i = 0; i < total; i++) {
        if (this.dead) return
        this.status.textContent = 'Preparing to print, page ' + (i + 1) + ' of ' + total + '...'
        const page = await this.pdf.getPage(i + 1)
        const vp = page.getViewport({ scale: PRINT_SCALE, rotation: this.rotation(page, i) })
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.floor(vp.width))
        canvas.height = Math.max(1, Math.floor(vp.height))
        // the on-screen render and the thumbnails call page.cleanup() on the same page object, which cancels a render in flight: retry
        for (let tries = 0; ; tries++) {
          try {
            await page.render({ canvas, viewport: vp, background: 'rgb(255,255,255)' }).promise
            break
          } catch (e) {
            if (tries >= 4 || !e || e.name !== 'RenderingCancelledException') throw e
            await tick()
          }
        }
        const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.92))
        canvas.width = canvas.height = 0
        if (!blob) throw new Error('page image failed')
        const url = URL.createObjectURL(blob)
        urls.push(url)
        const img = el('img', 'pdfv-printpage', { alt: '', src: url })
        sheet.appendChild(img)
        await new Promise((res) => {
          img.onload = img.onerror = res
          if (img.complete) res()
        })
        // no timer here: a hidden or background window throttles setTimeout to about one per second
      }
      if (this.dead) return
      document.body.appendChild(sheet)
      document.body.classList.add('pdf-printing')
      this.root.dataset.printPages = String(total)
      let cleaned = false
      const clean = () => {
        if (cleaned) return
        cleaned = true
        window.removeEventListener('afterprint', clean)
        document.body.classList.remove('pdf-printing')
        sheet.remove()
        urls.forEach((u) => URL.revokeObjectURL(u))
      }
      window.addEventListener('afterprint', clean)
      setTimeout(clean, 10 * 60 * 1000) // safety net if afterprint never arrives
      this.status.hidden = true
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      this.root.dataset.printCalled = String((Number(this.root.dataset.printCalled) || 0) + 1)
      window.print()
    } catch (e) {
      console.warn('[pdfview] print', e && (e.name || '') + ' ' + (e.message || ''))
      this.status.textContent = 'Could not prepare the PDF for printing.'
      setTimeout(() => (this.status.hidden = true), 4000)
      urls.forEach((u) => URL.revokeObjectURL(u))
      document.body.classList.remove('pdf-printing')
      sheet.remove()
    } finally {
      this.printing = false
      if (!this.dead && this.status.textContent.startsWith('Preparing')) this.status.hidden = true
    }
  }

  /* ---------- layout and zoom ---------- */
  fitScale(mode) {
    let p = this.dims(0)
    if (ROT.get(this.d) && ROT.get(this.d).size) {
      // a rotated page may be wider or taller than the first: fit the widest and tallest so none needs a sideways scroll
      p = { w: 0, h: 0 }
      for (let i = 0; i < this.n; i++) {
        const d = this.dims(i)
        p.w = Math.max(p.w, d.w)
        p.h = Math.max(p.h, d.h)
      }
    }
    // same reading column as the Markdown editor: capped at --doc-width
    const docW = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--doc-width')) || 820
    const cw = Math.max(80, Math.min(this.scroller.clientWidth - 48, docW))
    const ch = Math.max(80, this.scroller.clientHeight - PAD * 2)
    const s = mode === 'page' ? Math.min(cw / p.w, ch / p.h) : cw / p.w
    return clamp(s, 0.25 * CSS_UNITS, 4 * CSS_UNITS)
  }

  applyZoom() {
    this.scale = this.mode === 'custom' ? (this.pct / 100) * CSS_UNITS : this.fitScale(this.mode)
    this.pagesEl.style.setProperty('--total-scale-factor', String(this.scale))
    this.relayout()
    this.syncZoomUi()
  }

  relayout() {
    if (!this.pages.length) return
    const anchor = this.cur - 1
    const before = this.tops[anchor] || 0
    let y = PAD
    const s = this.scale
    for (let i = 0; i < this.n; i++) {
      const pg = this.pages[i]
      const d = this.dims(i)
      const w = d.w * s
      const h = d.h * s
      if (pg._w !== w || pg._h !== h) {
        pg.box.style.width = w + 'px'
        pg.box.style.height = h + 'px'
        pg._w = w
        pg._h = h
      }
      this.tops[i] = y
      y += h + GAP
    }
    if (this.thumbs) this.thumbs.sync()
    const delta = (this.tops[anchor] || 0) - before
    if (delta && this.scroller.scrollTop > 0) this.scroller.scrollTop += delta
    this.schedule()
  }

  setZoom(mode, pct, soft) {
    const anchor = this.cur - 1
    const pg = this.pages[anchor]
    const frac = pg && pg._h ? (this.scroller.scrollTop - this.tops[anchor]) / pg._h : 0
    const sc = this.scroller
    const hFrac = sc.scrollWidth > sc.clientWidth ? (sc.scrollLeft + sc.clientWidth / 2) / sc.scrollWidth : -1
    this.mode = mode
    if (mode === 'custom' && pct) this.pct = clamp(pct, ZOOMS[0], ZOOMS[ZOOMS.length - 1])
    this.applyZoom()
    if (!soft || frac) {
      const p2 = this.pages[anchor]
      if (p2) this.scroller.scrollTop = this.tops[anchor] + frac * p2._h
    }
    if (hFrac >= 0) sc.scrollLeft = Math.max(0, hFrac * sc.scrollWidth - sc.clientWidth / 2)
    // keep the old pixels stretched until the sharp ones are ready
    clearTimeout(this.zoomTimer)
    this.zoomTimer = setTimeout(() => this.refresh(), 120)
  }

  zoomStep(dir) {
    const cur = Math.round((this.scale / CSS_UNITS) * 100)
    let next
    if (dir > 0) next = ZOOMS.find((z) => z > cur) ?? ZOOMS[ZOOMS.length - 1]
    else next = [...ZOOMS].reverse().find((z) => z < cur) ?? ZOOMS[0]
    this.setZoom('custom', next)
  }

  /* ---------- scrolling, current page, render window ---------- */
  pageAt(y) {
    let lo = 0
    let hi = this.n - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this.tops[mid] <= y) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  goTo(n, smooth) {
    n = clamp(Math.round(n), 1, this.n)
    const y = n >= this.n ? this.scroller.scrollHeight : Math.max(0, this.tops[n - 1] - 8)
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (smooth && !calm && Math.abs(y - this.scroller.scrollTop) < this.scroller.clientHeight * 3) this.scroller.scrollTo({ top: y, behavior: 'smooth' })
    else this.scroller.scrollTop = y
    // near the end the scroll position is clamped and the page found from it would be an earlier one: remember the target
    this.pin = smooth ? null : { n, top: this.scroller.scrollTop }
    this.cur = n
    this.syncPageUi()
    this.schedule()
  }

  schedule() {
    if (this.raf || this.dead) return
    this.raf = requestAnimationFrame(() => {
      this.raf = 0
      this.refresh()
    })
  }

  refresh() {
    if (this.dead || !this.n || !this.pages.length) return
    const st = this.scroller.scrollTop
    const vh = this.scroller.clientHeight
    const first = this.pageAt(st)
    const last = this.pageAt(st + vh)
    const atBottom = st > 0 && st >= this.scroller.scrollHeight - vh - 2
    if (this.pin && Math.abs(st - this.pin.top) > 2) this.pin = null
    const probe = this.pin ? this.pin.n - 1 : atBottom ? this.n - 1 : this.pageAt(st + Math.min(vh / 3, 80))
    if (probe + 1 !== this.cur) {
      this.cur = probe + 1
      this.syncPageUi()
    }
    SAVED.set(this.d, { page: this.cur, mode: this.mode, pct: Math.round((this.scale / CSS_UNITS) * 100) })
    for (let i = 0; i < this.n; i++) {
      if ((i < first - KEEP || i > last + KEEP) && (this.pages[i].canvas || this.pages[i].job)) this.release(i)
    }
    this.want = []
    const mid = (first + last) / 2
    for (let i = Math.max(0, first - PRE); i <= Math.min(this.n - 1, last + PRE); i++) {
      const pg = this.pages[i]
      if (pg.job && pg.jobScale === this.scale) continue
      if (pg.doneScale === this.scale && pg.canvas && pg.textDone) continue
      this.want.push(i)
    }
    this.want.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid))
    this.pump()
  }

  running() {
    let n = 0
    for (const p of this.pages) if (p.job) n++
    return n
  }

  pump() {
    while (!this.dead && this.running() < MAX_JOBS && this.want && this.want.length) {
      const i = this.want.shift()
      const pg = this.pages[i]
      if (pg.job && pg.jobScale === this.scale) continue
      this.renderPage(i)
    }
  }

  release(i) {
    const pg = this.pages[i]
    pg.token++
    if (pg.renderTask) {
      try { pg.renderTask.cancel() } catch {}
      pg.renderTask = null
    }
    if (pg.tl) {
      try { pg.tl.cancel() } catch {}
      pg.tl = null
    }
    if (pg.canvas) {
      pg.canvas.width = 0
      pg.canvas.height = 0
      pg.canvas.remove()
      pg.canvas = null
    }
    if (pg.textEl) {
      pg.textEl.remove()
      pg.textEl = null
    }
    pg.job = false
    pg.doneScale = 0
    pg.textDone = false
    if (this.pdf) this.pdf.getPage(i + 1).then((p) => p.cleanup()).catch(() => {})
    this.resolveWaiters(i)
  }

  resolveWaiters(i) {
    const w = this.pages[i].waiters
    this.pages[i].waiters = []
    for (const f of w) f()
  }

  async renderPage(i) {
    const pg = this.pages[i]
    const scale = this.scale
    if (pg.job) {
      pg.token++
      if (pg.renderTask) {
        try { pg.renderTask.cancel() } catch {}
      }
      if (pg.tl) {
        try { pg.tl.cancel() } catch {}
      }
    }
    pg.job = true
    pg.jobScale = scale
    const token = ++pg.token
    const stale = () => this.dead || token !== pg.token
    const finish = () => {
      if (token === pg.token) {
        pg.job = false
        pg.renderTask = null
      }
      if (!this.dead) {
        this.pump()
        if (this.want && !this.want.length && token === pg.token && pg.doneScale !== this.scale) this.schedule()
      }
    }
    try {
      const page = await this.pdf.getPage(i + 1)
      if (stale()) return finish()
      const vp = page.getViewport({ scale, rotation: this.rotation(page, i) })
      const v1 = page.getViewport({ scale: 1 })
      if (Math.abs(pg.w - v1.width) > 0.01 || Math.abs(pg.h - v1.height) > 0.01) {
        pg.w = v1.width
        pg.h = v1.height
        this.relayout()
      }
      const dpr = window.devicePixelRatio || 1
      const out = Math.min(dpr, Math.sqrt(MAX_PIXELS / Math.max(1, vp.width * vp.height)))
      const canvas = document.createElement('canvas')
      canvas.className = 'pdfv-canvas'
      canvas.width = Math.max(1, Math.floor(vp.width * out))
      canvas.height = Math.max(1, Math.floor(vp.height * out))
      const rt = page.render({ canvas, viewport: vp, transform: out !== 1 ? [out, 0, 0, out, 0, 0] : undefined, background: this.paper() })
      pg.renderTask = rt
      await rt.promise
      if (stale()) {
        canvas.width = canvas.height = 0
        return finish()
      }
      const had = !!pg.canvas
      if (pg.canvas) {
        pg.canvas.width = pg.canvas.height = 0
        pg.canvas.remove()
      }
      canvas.classList.toggle('fresh', !had)
      pg.canvas = canvas
      pg.box.insertBefore(canvas, pg.box.firstChild)
      pg.doneScale = scale
      this.noteFirstPage(i)
      // text layer
      const textEl = el('div', 'textLayer pdfv-text')
      textEl.style.setProperty('--total-scale-factor', String(scale))
      const tl = new this.lib.TextLayer({ textContentSource: page.streamTextContent(), container: textEl, viewport: vp })
      if (pg.tl) {
        try { pg.tl.cancel() } catch {}
      }
      pg.tl = tl
      await tl.render()
      if (stale()) return finish()
      if (pg.textEl) pg.textEl.remove()
      pg.textEl = textEl
      pg.box.appendChild(textEl)
      pg.textDone = true
      this.applyHighlights()
      this.resolveWaiters(i)
      finish()
    } catch (e) {
      const cancelled = e && (e.name === 'RenderingCancelledException' || e.name === 'AbortException' || /cancel/i.test(e.message || ''))
      if (!cancelled && !this.dead) console.warn('[pdfview] page', i + 1, e)
      finish()
    }
  }

  noteFirstPage(i) {
    if (i === 0 && !this.firstShown) {
      this.firstShown = true
      document.documentElement.dataset.pdfFirstPage = String(Math.round(performance.now()))
    }
  }

  /* ---------- search ---------- */
  openFind() {
    this.fbar.hidden = false
    const sel = window.getSelection()?.toString()
    if (sel && this.root.contains(window.getSelection().anchorNode) && !/[\r\n]/.test(sel) && sel.length < 200) this.findIn.value = sel
    this.findIn.focus()
    this.findIn.select()
    if (this.findIn.value) this.runSearch()
  }

  closeFind() {
    this.fbar.hidden = true
    this.sTok++
    this.pendingSearch = false
    this.matches = []
    this.matchByPage.clear()
    this.mi = -1
    this.clearHighlights()
    this.scroller.focus({ preventScroll: true })
  }

  clearHighlights() {
    if (typeof CSS !== 'undefined' && CSS.highlights) {
      CSS.highlights.delete('plume-pdf-find')
      CSS.highlights.delete('plume-pdf-find-current')
    }
  }

  async getText(i) {
    if (this.texts[i]) return this.texts[i]
    const page = await this.pdf.getPage(i + 1)
    const tc = await page.getTextContent()
    const starts = []
    const strs = []
    let s = ''
    for (const it of tc.items) {
      if (it.str === undefined) continue
      starts.push(s.length)
      strs.push(it.str)
      s += it.str + (it.hasEOL ? '\n' : '')
    }
    const t = { s: s.toLowerCase(), starts, strs }
    this.texts[i] = t
    page.cleanup()
    return t
  }

  async runSearch() {
    const q = this.findIn.value.trim() ? this.findIn.value : ''
    const tok = ++this.sTok
    this.matches = []
    this.matchByPage.clear()
    this.mi = -1
    this.clearHighlights()
    if (!q) {
      this.findCount.textContent = ''
      this.pendingSearch = false
      return
    }
    this.pendingSearch = true
    const ql = q.toLowerCase()
    const startPage = this.cur - 1
    let picked = false
    for (let i = 0; i < this.n; i++) {
      let t
      try {
        t = await this.getText(i)
      } catch {
        continue
      }
      if (tok !== this.sTok || this.dead) return
      let from = 0
      const firstNew = this.matches.length
      for (;;) {
        const at = t.s.indexOf(ql, from)
        if (at < 0) break
        const m = { page: i, start: at, end: at + ql.length }
        this.matches.push(m)
        let list = this.matchByPage.get(i)
        if (!list) this.matchByPage.set(i, (list = []))
        list.push(this.matches.length - 1)
        from = at + Math.max(1, ql.length)
      }
      if (!picked && this.matches.length > firstNew && i >= startPage) {
        picked = true
        this.mi = firstNew
        this.showMatch(tok)
      }
      if (i % 6 === 5) {
        if (!picked) this.findCount.textContent = 'Searching ' + (i + 1) + '/' + this.n
        else this.updateCount()
        await tick()
        if (tok !== this.sTok || this.dead) return
      }
    }
    this.pendingSearch = false
    if (!this.matches.length) {
      this.findCount.textContent = 'No matches'
      return
    }
    if (!picked) {
      this.mi = 0
      this.showMatch(tok)
    } else this.updateCount()
  }

  updateCount() {
    this.findCount.textContent = this.matches.length ? this.mi + 1 + ' of ' + this.matches.length : 'No matches'
  }

  step(dir) {
    if (!this.matches.length) return
    this.mi = (this.mi + dir + this.matches.length) % this.matches.length
    this.showMatch(this.sTok)
  }

  async showMatch(tok) {
    this.updateCount()
    const m = this.matches[this.mi]
    if (!m) return
    const pg = this.pages[m.page]
    if (!(pg.textDone && pg.doneScale === this.scale)) {
      // bring the page in, then wait for its text layer
      const probe = this.pageAt(this.scroller.scrollTop)
      if (Math.abs(probe - m.page) > 0 && (m.page < this.pageAt(this.scroller.scrollTop) || m.page > this.pageAt(this.scroller.scrollTop + this.scroller.clientHeight))) {
        this.scroller.scrollTop = Math.max(0, this.tops[m.page] - 8)
      }
      this.refresh()
      await new Promise((res) => {
        pg.waiters.push(res)
        setTimeout(res, 4000)
      })
    }
    if (this.dead || tok !== this.sTok) return
    this.applyHighlights()
    const r = this.rangeFor(m)
    if (!r) return
    const rect = r.getBoundingClientRect()
    const sr = this.scroller.getBoundingClientRect()
    if (rect.top < sr.top + 50 || rect.bottom > sr.bottom - 30) this.scroller.scrollTop += rect.top - sr.top - sr.height / 3
    if (rect.left < sr.left + 20 || rect.right > sr.right - 20) this.scroller.scrollLeft += rect.left - sr.left - sr.width / 3
  }

  rangeFor(m) {
    const pg = this.pages[m.page]
    const t = this.texts[m.page]
    if (!pg || !t || !pg.tl || !pg.textDone) return null
    const divs = pg.tl.textDivs
    const strs = pg.tl.textContentItemsStr
    const locate = (off) => {
      let lo = 0
      let hi = t.starts.length - 1
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1
        if (t.starts[mid] <= off) lo = mid
        else hi = mid - 1
      }
      return lo
    }
    const k1 = locate(m.start)
    const k2 = locate(m.end - 1)
    if (strs[k1] !== t.strs[k1] || strs[k2] !== t.strs[k2]) return null
    const a = divs[k1] && divs[k1].firstChild
    const b = divs[k2] && divs[k2].firstChild
    if (!a || !b) return null
    try {
      const r = document.createRange()
      r.setStart(a, clamp(m.start - t.starts[k1], 0, a.length))
      r.setEnd(b, clamp(m.end - t.starts[k2], 0, b.length))
      return r
    } catch {
      return null
    }
  }

  applyHighlights() {
    if (!this.matches.length || this.fbar.hidden || !(typeof CSS !== 'undefined' && CSS.highlights) || typeof Highlight === 'undefined') return
    const all = []
    const cur = []
    for (const [pi, list] of this.matchByPage) {
      const pg = this.pages[pi]
      if (!pg.textDone) continue
      for (const mi of list) {
        const r = this.rangeFor(this.matches[mi])
        if (!r) continue
        if (mi === this.mi) cur.push(r)
        else all.push(r)
      }
    }
    CSS.highlights.set('plume-pdf-find', new Highlight(...all))
    CSS.highlights.set('plume-pdf-find-current', new Highlight(...cur))
  }

  /* ---------- teardown ---------- */
  cleanupDoc() {
    for (let i = 0; i < this.pages.length; i++) if (this.pages[i].canvas || this.pages[i].job) this.release(i)
    this.pages.forEach((p, i) => this.resolveWaiters(i))
    const task = this.task
    const pdf = this.pdf
    this.task = null
    this.pdf = null
    // destroying the loading task also destroys the document (PDFDocumentProxy.destroy) and its worker
    try { pdf && pdf.destroy() } catch {}
    try { task && task.destroy() } catch {}
  }

  destroy() {
    if (this.dead) return
    if (this.n) SAVED.set(this.d, { page: this.cur, mode: this.mode, pct: Math.round((this.scale / CSS_UNITS) * 100) })
    this.dead = true
    this.sTok++
    document.body.classList.remove('pdf-printing')
    cancelAnimationFrame(this.raf)
    clearTimeout(this.zoomTimer)
    this.clearHighlights()
    for (const f of this.cleanups.splice(0)) {
      try { f() } catch {}
    }
    if (this.thumbs) this.thumbs.destroy()
    this.thumbs = null
    this.cleanupDoc()
    this.pages = []
    this.texts = []
    this.root.remove()
    if (this.host.__pdfv === this) delete this.host.__pdfv
  }
}

export async function mount(host, d, app) {
  if (host.__pdfv) host.__pdfv.destroy()
  const v = new PdfViewer(host, d, app)
  host.__pdfv = v
  await v.open()
}
