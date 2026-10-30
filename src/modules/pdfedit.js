// PDF editing for the PDF viewer (pdfview.js loads this on first use, so startup never pays for pdf-lib).
// What it writes (all with pdf-lib, nothing is written to disk until the user saves):
//   annotations: highlight and underline on selected text, a sticky note, freehand ink, and "cover and retype" (a white
//   rectangle in the page plus a FreeText annotation; the ORIGINAL TEXT STAYS in the file under the white box).
//   page edits: delete, move, rotate (saved), extract selected pages to a new file, merge another PDF onto the end.
//   form fields: text, checkbox, radio, dropdown, filled through HTML inputs over the page and written with pdf-lib's form API.
// Every edit makes a new snapshot of the bytes. The first snapshot is the file as opened, so undo can always return to it and
// nothing touches the file on disk until saveDoc() in main.js asks savePdf() for the bytes and writes them through the
// grant-checked file:write-bytes IPC. If pdf-lib cannot parse the file the edit is refused and nothing changes.

import { PDFDocument, PDFHexString, PDFString, StandardFonts, degrees, rgb, PDFTextField, PDFCheckBox, PDFDropdown, PDFOptionList, PDFRadioGroup } from 'pdf-lib'

const MAX_SNAPSHOTS = 25
const ST = new WeakMap() // doc tab -> { stack, idx, saveIdx, forms, formsDirty, tool, busy }

function st(d) {
  let s = ST.get(d)
  if (!s) {
    s = { stack: [d.bytes], idx: 0, saveIdx: 0, forms: new Map(), formsDirty: false, tool: null, busy: false }
    ST.set(d, s)
  }
  return s
}
const isDirty = (s) => s.idx !== s.saveIdx || s.formsDirty

const svg = (inner) => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`
const ICON = {
  highlight: svg('<path d="m9 11-5 5v4h4l5-5"/><path d="m14 6 4 4"/><path d="M12 8l4-4 4 4-4 4z"/>'),
  underline: svg('<path d="M7 4v7a5 5 0 0 0 10 0V4"/><path d="M5 20h14"/>'),
  note: svg('<path d="M5 4h14v12l-5 4H5z"/><path d="M14 20v-4h5"/>'),
  ink: svg('<path d="M3 17c3-6 5-9 7-6s3 5 5 1 3-6 6-8"/>'),
  cover: svg('<rect x="4" y="6" width="16" height="12" rx="1.5"/><path d="M8 12h8"/>'),
  del: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  up: svg('<path d="M12 19V5m-6 6 6-6 6 6"/>'),
  down: svg('<path d="M12 5v14m-6-6 6 6 6-6"/>'),
  extract: svg('<path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5M12 18v-6m-3 3 3-3 3 3"/>'),
  merge: svg('<path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5M12 11v6m-3-3h6"/>'),
  undo: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>'),
  redo: svg('<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>'),
  save: svg('<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>'),
}

const el = (tag, cls, attrs) => {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k])
  return n
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const toast = (v, msg) => {
  if (v && v.app && v.app.toast) v.app.toast(msg)
  else console.info('[pdfedit]', msg)
}
const load = (bytes) => PDFDocument.load(bytes, { updateMetadata: false })

/* ---------- low-level PDF writers ---------- */
const author = () => PDFHexString.fromText('Plume')
const stamp = () => PDFString.fromDate(new Date())
const latin = (s) => String(s).replace(/[\r\t]/g, ' ').replace(/[^\n\x20-\x7e\xa0-\xff]/g, '?')
const pdfStr = (s) => '(' + s.replace(/[\\()]/g, (c) => '\\' + c) + ')'
const n2 = (x) => (Math.round(x * 100) / 100).toString()

function addAnnot(doc, page, dict) {
  const ctx = doc.context
  page.node.addAnnot(ctx.register(ctx.obj(dict)))
}
// an appearance stream, so every reader draws the annotation the same way
function appearance(doc, bbox, content, resources) {
  const ctx = doc.context
  return ctx.register(ctx.stream(content, { Type: 'XObject', Subtype: 'Form', BBox: bbox, Resources: resources || {} }))
}
const unionRect = (rects) => [Math.min(...rects.map((r) => r[0])), Math.min(...rects.map((r) => r[1])), Math.max(...rects.map((r) => r[2])), Math.max(...rects.map((r) => r[3]))]

// rects: [x1,y1,x2,y2] in PDF user space
function addMarkup(doc, page, kind, rects, text) {
  const rect = unionRect(rects)
  const quad = rects.flatMap((r) => [r[0], r[3], r[2], r[3], r[0], r[1], r[2], r[1]])
  let content
  let color
  let resources = {}
  if (kind === 'Highlight') {
    color = [1, 1, 0]
    content = '/GS gs 1 1 0 rg\n' + rects.map((r) => `${n2(r[0])} ${n2(r[1])} ${n2(r[2] - r[0])} ${n2(r[3] - r[1])} re f`).join('\n')
    resources = { ExtGState: { GS: { Type: 'ExtGState', BM: 'Multiply' } } }
  } else {
    color = [0.9, 0.1, 0.1]
    content = '0.9 0.1 0.1 RG 1 w\n' + rects.map((r) => `${n2(r[0])} ${n2(r[1] + 1)} m ${n2(r[2])} ${n2(r[1] + 1)} l S`).join('\n')
  }
  const ap = appearance(doc, rect, content, resources)
  addAnnot(doc, page, {
    Type: 'Annot', Subtype: kind, Rect: rect, QuadPoints: quad, C: color, F: 4, T: author(), M: stamp(),
    Contents: PDFHexString.fromText(text || ''), AP: { N: ap },
  })
}

function addNote(doc, page, x, y, text) {
  const ap = appearance(doc, [0, 0, 20, 20], '1 0.85 0.2 rg 0.45 0.3 0 RG 1 w 1 1 18 18 re B\n0.45 0.3 0 RG 4 14 m 16 14 l 4 10 m 16 10 l 4 6 m 12 6 l S')
  addAnnot(doc, page, {
    Type: 'Annot', Subtype: 'Text', Rect: [x, y - 20, x + 20, y], Name: 'Note', C: [1, 0.85, 0.2], F: 28, Open: false, T: author(), M: stamp(),
    Contents: PDFHexString.fromText(text), AP: { N: ap },
  })
}

function addInk(doc, page, pts) {
  const w = 2
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const rect = [Math.min(...xs) - w, Math.min(...ys) - w, Math.max(...xs) + w, Math.max(...ys) + w]
  const d = pts.map((p, i) => `${n2(p[0])} ${n2(p[1])} ${i ? 'l' : 'm'}`).join('\n')
  const ap = appearance(doc, rect, `0.9 0.1 0.1 RG ${w} w 1 J 1 j\n${d}\nS`)
  addAnnot(doc, page, {
    Type: 'Annot', Subtype: 'Ink', Rect: rect, InkList: [pts.flatMap((p) => [p[0], p[1]])], C: [0.9, 0.1, 0.1], BS: { W: w }, F: 4, T: author(), M: stamp(), AP: { N: ap },
  })
}

// wrap text to a width with a standard font
function wrap(font, text, size, width) {
  const lines = []
  for (const para of text.split('\n')) {
    let line = ''
    for (const word of para.split(' ')) {
      const t = line ? line + ' ' + word : word
      if (!line || font.widthOfTextAtSize(t, size) <= width) line = t
      else {
        lines.push(line)
        line = word
      }
    }
    lines.push(line)
  }
  return lines
}

// A white rectangle drawn into the page, then a FreeText annotation with the new text on top of it.
async function addCover(doc, page, rect, text) {
  const [x1, y1, x2, y2] = rect
  page.drawRectangle({ x: x1, y: y1, width: x2 - x1, height: y2 - y1, color: rgb(1, 1, 1), borderWidth: 0 })
  const safe = latin(text)
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const pad = 2
  const w = x2 - x1
  const h = y2 - y1
  let size = clamp(Math.floor(h * 0.7), 6, 18)
  let lines = wrap(font, safe, size, w - pad * 2)
  while (size > 6 && lines.length * size * 1.2 > h - pad) {
    size -= 1
    lines = wrap(font, safe, size, w - pad * 2)
  }
  const lead = size * 1.2
  let content = `BT /Helv ${size} Tf 0 g ${n2(lead)} TL ${n2(pad)} ${n2(h - pad - size)} Td\n`
  lines.forEach((l, i) => { content += (i ? 'T* ' : '') + pdfStr(l) + ' Tj\n' })
  content += 'ET'
  const ap = appearance(doc, [0, 0, w, h], content, { Font: { Helv: font.ref } })
  // the stream's own bbox is [0 0 w h], so move it onto the rectangle with a matrix-free approach: the Rect maps BBox to Rect
  addAnnot(doc, page, {
    Type: 'Annot', Subtype: 'FreeText', Rect: [x1, y1, x2, y2], Contents: PDFHexString.fromText(text), DA: PDFString.of(`0 g /Helv ${size} Tf`), F: 4, T: author(), M: stamp(),
    Border: [0, 0, 0], AP: { N: ap },
  })
}

function applyForms(doc, forms) {
  if (!forms.size) return
  const form = doc.getForm()
  for (const [name, val] of forms) {
    let f = null
    try { f = form.getField(name) } catch { continue } // the field's page was deleted
    try {
      if (f instanceof PDFTextField) f.setText(String(val ?? ''))
      else if (f instanceof PDFCheckBox) val ? f.check() : f.uncheck()
      else if (f instanceof PDFRadioGroup) val && f.select(String(val))
      else if (f instanceof PDFDropdown || f instanceof PDFOptionList) val && f.select(String(val))
    } catch (e) {
      console.warn('[pdfedit] field', name, e && e.message)
    }
  }
}

/* ---------- state, save, undo (also used by main.js) ---------- */
// Called by saveDoc() in main.js. Returns the bytes to write; throws (and nothing is written) if pdf-lib cannot parse the file.
export async function savePdf(d) {
  const s = st(d)
  const bytes = s.stack[s.idx]
  if (!s.forms.size) return bytes
  const doc = await load(bytes)
  applyForms(doc, s.forms)
  return doc.save()
}

// Called after the bytes were written. The saved bytes replace the current snapshot; earlier snapshots stay so undo still works.
export function commitSaved(d, bytes) {
  const s = st(d)
  s.stack[s.idx] = bytes
  s.saveIdx = s.idx
  s.forms.clear()
  s.formsDirty = false
  d.bytes = bytes
}

export const hasEdits = (d) => isDirty(st(d))

/* ---------- the editor attached to one viewer ---------- */
class Editor {
  constructor(v) {
    this.v = v
    this.d = v.d
    this.s = st(v.d)
    this.built = new Set()
    this.sel = new Set()
    this.dead = false
    this.btns = {}
    this.buildBar()
    this.wire()
    this.layers()
    this.thumbs()
    this.setTool(this.s.tool, true)
    this.syncUi()
  }

  /* ----- toolbar ----- */
  buildBar() {
    const bar = this.v.editBar
    bar.textContent = ''
    bar.setAttribute('role', 'toolbar')
    bar.setAttribute('aria-label', 'PDF editing tools')
    const mk = (key, icon, label, fn, tool) => {
      const b = el('button', 'find-btn pdfv-btn pdfedit-btn', { type: 'button', 'aria-label': label, title: label })
      b.innerHTML = icon
      if (tool) b.setAttribute('aria-pressed', 'false')
      this.v.on(b, 'click', () => fn())
      this.btns[key] = b
      return b
    }
    const sep = () => el('span', 'find-sep', { role: 'separator', 'aria-hidden': 'true' })
    this.hint = el('span', 'pdfedit-hint', { role: 'status', 'aria-live': 'polite' })
    bar.append(
      mk('hl', ICON.highlight, 'Highlight the selected text (yellow)', () => this.markup('Highlight')),
      mk('ul', ICON.underline, 'Underline the selected text', () => this.markup('Underline')),
      mk('note', ICON.note, 'Sticky note: click the page, then type the note', () => this.setTool(this.s.tool === 'note' ? null : 'note'), true),
      mk('ink', ICON.ink, 'Draw freehand ink on the page', () => this.setTool(this.s.tool === 'ink' ? null : 'ink'), true),
      mk('cover', ICON.cover, 'Cover and retype: drag a white box over text, then type the replacement. The original text stays under the white box in the file. This is not true text editing', () => this.setTool(this.s.tool === 'cover' ? null : 'cover'), true),
      sep(),
      mk('del', ICON.del, 'Delete this page (asks first)', () => this.deletePage()),
      mk('up', ICON.up, 'Move this page up (Alt+Up)', () => this.movePage(-1)),
      mk('down', ICON.down, 'Move this page down (Alt+Down)', () => this.movePage(1)),
      mk('extract', ICON.extract, 'Extract the selected pages to a new PDF (Ctrl+click page thumbnails to select several, the current page if none)', () => this.extract()),
      mk('merge', ICON.merge, 'Merge another PDF onto the end of this one', () => this.merge()),
      sep(),
      mk('undo', ICON.undo, 'Undo the last edit (Ctrl+Z)', () => this.undo()),
      mk('redo', ICON.redo, 'Redo (Ctrl+Y)', () => this.redo()),
      mk('save', ICON.save, 'Save to the file (Ctrl+S). Save As (Ctrl+Shift+S) writes a new file', () => this.save()),
      this.hint,
    )
  }

  syncUi() {
    const s = this.s
    const b = this.btns
    b.undo.disabled = s.idx <= 0
    b.redo.disabled = s.idx >= s.stack.length - 1
    b.save.disabled = !isDirty(s)
    b.del.disabled = this.v.n <= 1
    b.up.disabled = this.v.cur <= 1
    b.down.disabled = this.v.cur >= this.v.n
    for (const k of ['note', 'ink', 'cover']) {
      b[k].classList.toggle('on', s.tool === k)
      b[k].setAttribute('aria-pressed', String(s.tool === k))
    }
  }

  setTool(tool, quiet) {
    this.s.tool = tool || null
    const r = this.v.root
    r.classList.toggle('pdfedit-tooling', !!tool)
    for (const k of ['note', 'ink', 'cover']) r.classList.toggle('pdfedit-tool-' + k, tool === k)
    const hints = {
      note: 'Click where the note goes. Escape to stop.',
      ink: 'Draw on the page. Escape to stop.',
      cover: 'Drag a box over the text. The original text stays under the white box in the file. Escape to stop.',
    }
    this.hint.textContent = tool ? hints[tool] : ''
    if (!quiet) this.syncUi()
  }

  /* ----- keys, thumbnails, layers ----- */
  wire() {
    const v = this.v
    v.on(document, 'keydown', (e) => {
      if (!v.isActive() || this.dead) return
      const t = e.target
      const field = t && t.closest && t.closest('.pdfedit-pop')
      const mod = e.ctrlKey || e.metaKey
      if (e.key === 'Escape' && this.s.tool && !field) {
        e.preventDefault()
        e.stopPropagation()
        return this.setTool(null)
      }
      if (field) return
      const typing = t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))
      if (typing && !(e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown'))) return
      if (mod && !e.altKey && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
        e.preventDefault()
        e.stopPropagation()
        return this.undo()
      }
      if (mod && !e.altKey && ((e.key === 'y' || e.key === 'Y') || ((e.key === 'z' || e.key === 'Z') && e.shiftKey))) {
        e.preventDefault()
        e.stopPropagation()
        return this.redo()
      }
      if (e.altKey && !mod && !e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault()
        e.stopPropagation()
        this.movePage(e.key === 'ArrowUp' ? -1 : 1)
      }
    }, true)
  }

  // page list: Ctrl or Shift click selects pages for Extract, drag reorders
  thumbs() {
    const th = this.v.thumbs
    if (!th || !th.list) return
    const list = th.list
    const idx = (e) => {
      const b = e.target.closest && e.target.closest('.pdfp-item')
      return b ? Number(b.dataset.i) : -1
    }
    const paint = () => th.items.forEach((it, i) => it.b.classList.toggle('pdfedit-sel', this.sel.has(i)))
    th.items.forEach((it) => it.b.setAttribute('draggable', 'true'))
    this.v.on(list, 'click', (e) => {
      const i = idx(e)
      if (i < 0) return
      if (e.ctrlKey || e.metaKey) {
        this.sel.has(i) ? this.sel.delete(i) : this.sel.add(i)
        this.anchor = i
      } else if (e.shiftKey && this.anchor != null) {
        const [a, b] = [Math.min(this.anchor, i), Math.max(this.anchor, i)]
        for (let k = a; k <= b; k++) this.sel.add(k)
      } else {
        this.sel.clear()
        this.anchor = i
      }
      paint()
    })
    let from = -1
    this.v.on(list, 'dragstart', (e) => {
      from = idx(e)
      if (from < 0) return
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', String(from))
    })
    this.v.on(list, 'dragover', (e) => {
      if (from < 0) return
      const i = idx(e)
      if (i < 0) return
      e.preventDefault()
      th.items.forEach((it, k) => it.b.classList.toggle('pdfedit-drop', k === i && k !== from))
    })
    this.v.on(list, 'dragleave', (e) => {
      if (!list.contains(e.relatedTarget)) th.items.forEach((it) => it.b.classList.remove('pdfedit-drop'))
    })
    this.v.on(list, 'drop', (e) => {
      const to = idx(e)
      th.items.forEach((it) => it.b.classList.remove('pdfedit-drop'))
      if (from < 0 || to < 0 || to === from) return
      e.preventDefault()
      const f = from
      from = -1
      this.moveTo(f, to)
    })
    this.v.on(list, 'dragend', () => {
      from = -1
      th.items.forEach((it) => it.b.classList.remove('pdfedit-drop'))
    })
  }

  layers() {
    this.v.pages.forEach((pg, i) => {
      const layer = el('div', 'pdfedit-layer')
      const fields = el('div', 'pdfedit-fields')
      const cap = el('div', 'pdfedit-cap')
      layer.append(fields, cap)
      pg.box.appendChild(layer)
      pg.edLayer = layer
      pg.edFields = fields
      this.captureEvents(cap, i)
    })
  }

  // note click, ink stroke, cover rectangle
  captureEvents(cap, i) {
    const v = this.v
    let mode = null
    let pts = []
    let rubber = null
    let poly = null
    let start = null
    const local = (e) => {
      const r = cap.getBoundingClientRect()
      return [e.clientX - r.left, e.clientY - r.top]
    }
    this.v.on(cap, 'pointerdown', (e) => {
      if (e.button !== 0 || !this.s.tool || this.s.busy) return
      e.preventDefault()
      try { cap.setPointerCapture(e.pointerId) } catch { /* a synthetic pointer id */ }
      mode = this.s.tool
      start = local(e)
      pts = [start]
      if (mode === 'cover') {
        rubber = el('div', 'pdfedit-rubber')
        cap.appendChild(rubber)
      } else if (mode === 'ink') {
        poly = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        poly.setAttribute('class', 'pdfedit-stroke')
        const pl = document.createElementNS('http://www.w3.org/2000/svg', 'polyline')
        poly.appendChild(pl)
        cap.appendChild(poly)
        poly._pl = pl
      }
    })
    this.v.on(cap, 'pointermove', (e) => {
      if (!mode) return
      const p = local(e)
      if (mode === 'cover') {
        rubber.style.left = Math.min(start[0], p[0]) + 'px'
        rubber.style.top = Math.min(start[1], p[1]) + 'px'
        rubber.style.width = Math.abs(p[0] - start[0]) + 'px'
        rubber.style.height = Math.abs(p[1] - start[1]) + 'px'
      } else if (mode === 'ink') {
        const last = pts[pts.length - 1]
        if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 1.5) return
        pts.push(p)
        poly._pl.setAttribute('points', pts.map((q) => q[0].toFixed(1) + ',' + q[1].toFixed(1)).join(' '))
      }
    })
    const done = async (e) => {
      if (!mode) return
      const m = mode
      mode = null
      const end = local(e)
      const box = cap.getBoundingClientRect()
      const keep = pts
      if (rubber) rubber.remove()
      if (poly) poly.remove()
      rubber = poly = null
      if (e.type === 'pointercancel') return
      if (m === 'note') await this.addNote(i, start, e)
      else if (m === 'ink' && keep.length >= 2) await this.addInk(i, keep)
      else if (m === 'cover' && Math.abs(end[0] - start[0]) > 6 && Math.abs(end[1] - start[1]) > 6) await this.addCover(i, start, end, box, e)
    }
    this.v.on(cap, 'pointerup', done)
    this.v.on(cap, 'pointercancel', done)
  }

  /* ----- editing core ----- */
  // Apply fn to a fresh pdf-lib copy of the current snapshot, then push the result as a new snapshot and show it.
  async edit(fn, opts = {}) {
    const s = this.s
    if (s.busy) return false
    s.busy = true
    try {
      const doc = await load(s.stack[s.idx])
      await fn(doc)
      const out = await doc.save()
      s.stack.length = s.idx + 1
      s.stack.push(out)
      s.idx++
      if (s.stack.length > MAX_SNAPSHOTS) {
        s.stack.shift()
        s.idx--
        s.saveIdx--
        if (s.saveIdx < -1) s.saveIdx = -1
      }
      this.d.bytes = out
      this.after(opts)
      return true
    } catch (e) {
      console.warn('[pdfedit] edit failed', e && e.message)
      toast(this.v, 'Could not edit this PDF: ' + String((e && e.message) || e).slice(0, 120) + '. Nothing was changed.')
      return false
    } finally {
      s.busy = false
    }
  }

  after(opts) {
    const v = this.v
    this.sel.clear()
    this.markDirty()
    if (opts.cur) v.cur = clamp(opts.cur, 1, 1e6)
    v.reload()
  }

  // the title, sidebar dot and the close prompt follow tab.dirty
  markDirty() {
    const a = this.v.app.actions
    if (a && a.setDirty) a.setDirty(this.d, isDirty(this.s))
  }

  undo() {
    const s = this.s
    if (s.busy || s.idx <= 0) return
    s.idx--
    this.d.bytes = s.stack[s.idx]
    this.after({})
  }

  redo() {
    const s = this.s
    if (s.busy || s.idx >= s.stack.length - 1) return
    s.idx++
    this.d.bytes = s.stack[s.idx]
    this.after({})
  }

  save() {
    const c = this.v.app.commands && this.v.app.commands.items && this.v.app.commands.items.get('file.save')
    if (c) c.run()
  }

  /* ----- annotations ----- */
  async viewportOf(i) {
    const page = await this.v.pdf.getPage(i + 1)
    return page.getViewport({ scale: this.v.scale })
  }

  textRects(pg, r) {
    const out = []
    const walker = document.createTreeWalker(pg.textEl, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!r.intersectsNode(n)) continue
      const a = n === r.startContainer ? r.startOffset : 0
      const b = n === r.endContainer ? r.endOffset : n.length
      if (b <= a) continue
      const sub = document.createRange()
      sub.setStart(n, a)
      sub.setEnd(n, b)
      const rc = sub.getBoundingClientRect()
      if (rc.width > 0.5 && rc.height > 0.5) out.push(rc)
    }
    return out
  }

  async markup(kind) {
    const v = this.v
    const sel = window.getSelection()
    if (!sel || !sel.rangeCount || sel.isCollapsed) return toast(v, 'Select some text on the page first')
    const r = sel.getRangeAt(0)
    const per = []
    v.pages.forEach((pg, i) => {
      if (!pg.textEl || !r.intersectsNode(pg.textEl)) return
      const rects = this.textRects(pg, r)
      if (rects.length) per.push({ i, rects, box: pg.box.getBoundingClientRect() })
    })
    if (!per.length) return toast(v, 'Select some text on the page first')
    const text = sel.toString().replace(/\s+/g, ' ').trim().slice(0, 400)
    const vps = await Promise.all(per.map((p) => this.viewportOf(p.i)))
    const ok = await this.edit(async (doc) => {
      per.forEach((p, k) => {
        const vp = vps[k]
        const rects = p.rects.map((rc) => {
          const a = vp.convertToPdfPoint(rc.left - p.box.left, rc.top - p.box.top)
          const b = vp.convertToPdfPoint(rc.right - p.box.left, rc.bottom - p.box.top)
          return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]
        })
        addMarkup(doc, doc.getPage(p.i), kind, rects, text)
      })
    })
    if (ok) sel.removeAllRanges()
  }

  // a small text box near the pointer; resolves with the text or null
  ask(title, e, okLabel) {
    return new Promise((resolve) => {
      const pop = el('div', 'pdfedit-pop', { role: 'dialog', 'aria-label': title })
      const lab = el('div', 'pdfedit-pop-title')
      lab.textContent = title
      const ta = el('textarea', 'pdfedit-pop-text', { rows: '3', 'aria-label': title, spellcheck: 'true' })
      const row = el('div', 'pdfedit-pop-row')
      const ok = el('button', 'pdfedit-pop-btn pdfedit-pop-ok', { type: 'button' })
      ok.textContent = okLabel
      const no = el('button', 'pdfedit-pop-btn', { type: 'button' })
      no.textContent = 'Cancel'
      row.append(no, ok)
      pop.append(lab, ta, row)
      this.v.root.appendChild(pop)
      const rr = this.v.root.getBoundingClientRect()
      pop.style.left = clamp(e.clientX - rr.left, 8, Math.max(8, rr.width - 280)) + 'px'
      pop.style.top = clamp(e.clientY - rr.top + 8, 8, Math.max(8, rr.height - 190)) + 'px'
      let closed = false
      const close = (val) => {
        if (closed) return
        closed = true
        pop.remove()
        this.v.scroller.focus({ preventScroll: true })
        resolve(val)
      }
      this.v.on(ok, 'click', () => close(ta.value.trim() || null))
      this.v.on(no, 'click', () => close(null))
      this.v.on(pop, 'keydown', (ev) => {
        ev.stopPropagation()
        if (ev.key === 'Escape') {
          ev.preventDefault()
          close(null)
        } else if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
          ev.preventDefault()
          close(ta.value.trim() || null)
        }
      })
      setTimeout(() => ta.focus(), 0)
    })
  }

  async addNote(i, at, e) {
    const text = await this.ask('Sticky note', e, 'Add note')
    if (!text) return
    const vp = await this.viewportOf(i)
    const [x, y] = vp.convertToPdfPoint(at[0], at[1])
    await this.edit((doc) => addNote(doc, doc.getPage(i), x, y, text))
  }

  async addInk(i, pts) {
    const vp = await this.viewportOf(i)
    const up = pts.map((p) => vp.convertToPdfPoint(p[0], p[1]))
    await this.edit((doc) => addInk(doc, doc.getPage(i), up))
  }

  async addCover(i, a, b, box, e) {
    const text = await this.ask('Replacement text. The original text stays under the white box in the file.', e, 'Cover and retype')
    if (!text) return
    const vp = await this.viewportOf(i)
    const p1 = vp.convertToPdfPoint(a[0], a[1])
    const p2 = vp.convertToPdfPoint(b[0], b[1])
    const rect = [Math.min(p1[0], p2[0]), Math.min(p1[1], p2[1]), Math.max(p1[0], p2[0]), Math.max(p1[1], p2[1])]
    const rot = (await this.v.pdf.getPage(i + 1)).rotate || 0
    if (rot) return toast(this.v, 'Cover and retype needs an upright page. Rotate this page back to 0 degrees first.')
    await this.edit((doc) => addCover(doc, doc.getPage(i), rect, text))
  }

  /* ----- page edits ----- */
  async deletePage() {
    const v = this.v
    if (v.n <= 1) return toast(v, 'A PDF needs at least one page')
    const i = v.cur - 1
    const confirm = window.folio && window.folio.confirm
    const r = confirm ? await confirm('Delete page ' + (i + 1) + '?', 'The page is removed from the PDF when you save. Undo (Ctrl+Z) brings it back until you close the tab.', ['Delete', 'Cancel']) : 0
    if (r !== 0) return
    await this.edit((doc) => doc.removePage(i), { cur: Math.min(i + 1, v.n - 1) })
  }

  movePage(dir) {
    return this.moveTo(this.v.cur - 1, this.v.cur - 1 + dir)
  }

  async moveTo(from, to) {
    const v = this.v
    if (to < 0 || to >= v.n || from === to) return
    await this.edit((doc) => {
      const page = doc.getPage(from)
      doc.removePage(from)
      doc.insertPage(to, page)
    }, { cur: to + 1 })
  }

  async rotate() {
    const i = this.v.cur - 1
    await this.edit((doc) => {
      const p = doc.getPage(i)
      p.setRotation(degrees((p.getRotation().angle + 90) % 360))
    }, { cur: i + 1 })
  }

  async extract() {
    const v = this.v
    const d = this.d
    const idxs = this.sel.size ? [...this.sel].sort((a, b) => a - b) : [v.cur - 1]
    const api = window.folio
    if (!api) return
    try {
      const suggested = (d.path || d.name).replace(/\.pdf$/i, '') + '-extract.pdf'
      const p = await api.saveDialog(suggested, 'pdf')
      if (!p) return
      if (d.path && p.toLowerCase() === d.path.toLowerCase()) return toast(v, 'Pick a different file name: Extract never overwrites the open PDF')
      const bytes = await this.extractBytes(idxs)
      await api.writeBytes(p, bytes)
      toast(v, 'Saved ' + idxs.length + (idxs.length === 1 ? ' page' : ' pages') + ' to ' + p.split(/[\\/]/).pop())
    } catch (e) {
      toast(v, 'Could not extract: ' + String((e && e.message) || e).slice(0, 120) + '. Nothing was written.')
    }
  }

  async extractBytes(idxs) {
    const src = await load(this.s.stack[this.s.idx])
    const out = await PDFDocument.create()
    const pages = await out.copyPages(src, idxs)
    pages.forEach((pg) => out.addPage(pg))
    return out.save()
  }

  async merge() {
    const api = window.folio
    if (!api) return
    let bytes
    try {
      const paths = await api.openDialog('pdf')
      if (!paths || !paths.length) return
      bytes = await api.readBytes(paths[0])
    } catch (e) {
      return toast(this.v, 'Could not read that file')
    }
    await this.mergeBytes(bytes)
  }

  mergeBytes(bytes) {
    const n = this.v.n
    return this.edit(async (doc) => {
      const other = await load(bytes)
      const pages = await doc.copyPages(other, other.getPageIndices())
      pages.forEach((p) => doc.addPage(p))
    }, { cur: n + 1 })
  }

  /* ----- form fields ----- */
  // called by the viewer after a page has rendered; builds the inputs for that page once
  async pageRendered(i, page) {
    if (this.dead || this.built.has(i) || !this.v.formMode) return
    this.built.add(i)
    let annots
    try { annots = await page.getAnnotations({ intent: 'display' }) } catch { return }
    if (this.dead) return
    const pg = this.v.pages[i]
    if (!pg || !pg.edFields) return
    const vp = page.getViewport({ scale: 1 })
    for (const a of annots) {
      if (a.subtype !== 'Widget' || !a.fieldName || !a.rect) continue
      if (a.annotationFlags & (2 | 32)) continue // hidden, no view
      const inp = this.fieldInput(a)
      if (!inp) continue
      const p1 = vp.convertToViewportPoint(a.rect[0], a.rect[1])
      const p2 = vp.convertToViewportPoint(a.rect[2], a.rect[3])
      const x = Math.min(p1[0], p2[0])
      const y = Math.min(p1[1], p2[1])
      const w = Math.abs(p2[0] - p1[0])
      const h = Math.abs(p2[1] - p1[1])
      inp.classList.add('pdfedit-field')
      inp.dataset.field = a.fieldName
      inp.style.left = (x / vp.width) * 100 + '%'
      inp.style.top = (y / vp.height) * 100 + '%'
      inp.style.width = (w / vp.width) * 100 + '%'
      inp.style.height = (h / vp.height) * 100 + '%'
      const fs = a.defaultAppearanceData && a.defaultAppearanceData.fontSize > 0 ? a.defaultAppearanceData.fontSize : clamp(h * 0.7, 7, 14)
      inp.style.setProperty('--pe-fs', String(fs))
      pg.edFields.appendChild(inp)
    }
  }

  setField(name, value) {
    this.s.forms.set(name, value)
    this.s.formsDirty = true
    this.markDirty()
    this.syncUi()
  }

  fieldInput(a) {
    const cur = this.s.forms.has(a.fieldName) ? this.s.forms.get(a.fieldName) : a.fieldValue
    const name = a.fieldName
    if (a.fieldType === 'Tx') {
      const t = a.multiLine ? el('textarea') : el('input', null, { type: 'text' })
      t.value = Array.isArray(cur) ? cur.join('\n') : cur == null ? '' : String(cur)
      if (a.maxLen) t.maxLength = a.maxLen
      t.disabled = !!a.readOnly
      t.setAttribute('aria-label', a.alternativeText || name)
      t.spellcheck = false
      this.v.on(t, 'input', () => {
        this.setField(name, t.value)
        this.v.root.querySelectorAll('.pdfedit-field').forEach((o) => { if (o !== t && o.dataset.field === name) o.value = t.value })
      })
      return t
    }
    if (a.fieldType === 'Btn' && a.checkBox) {
      const c = el('input', null, { type: 'checkbox' })
      c.checked = cur != null && cur !== 'Off' && cur !== false && cur !== ''
      c.disabled = !!a.readOnly
      c.setAttribute('aria-label', a.alternativeText || name)
      this.v.on(c, 'change', () => this.setField(name, c.checked))
      return c
    }
    if (a.fieldType === 'Btn' && a.radioButton) {
      const c = el('input', null, { type: 'radio' })
      c.name = name
      c.checked = cur != null && String(cur) === String(a.buttonValue)
      c.disabled = !!a.readOnly
      c.setAttribute('aria-label', (a.alternativeText || name) + ' ' + a.buttonValue)
      this.v.on(c, 'change', () => c.checked && this.setField(name, a.buttonValue))
      return c
    }
    if (a.fieldType === 'Ch' && Array.isArray(a.options)) {
      const s = el('select')
      for (const o of a.options) {
        const op = el('option')
        op.value = o.exportValue
        op.textContent = o.displayValue
        s.appendChild(op)
      }
      const first = Array.isArray(cur) ? cur[0] : cur
      s.value = first == null ? '' : String(first)
      s.disabled = !!a.readOnly
      s.setAttribute('aria-label', a.alternativeText || name)
      this.v.on(s, 'change', () => this.setField(name, s.value))
      return s
    }
    return null
  }

  destroy() {
    this.dead = true
    this.v.root.classList.remove('pdfedit-tooling', 'pdfedit-tool-note', 'pdfedit-tool-ink', 'pdfedit-tool-cover')
  }
}

export function attach(v) {
  return new Editor(v)
}
