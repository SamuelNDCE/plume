// Read-only Excel (.xlsx) viewer. mount(host, doc, app) is called by docviewer.js.
// Parsing runs in a worker (xlsxworker.js, read-excel-file) so a large workbook never freezes the window; rows
// stream in by chunk. The grid is virtualised in both directions, has sticky column letters and row numbers
// (same visual language as the CSV grid in sheet.js, which is an editor and cannot be reused read-only), a cell
// value line, sheet tabs, and Ctrl+F find that is active only while this viewer is on screen.
// Legacy .xls and .ods are out of scope. read-excel-file does not expose merged ranges (the parser
// reads them and discards them), so merged cells are drawn as the plain cells the parser returns.

import { isTextField, wrapCommand, shortcutPanel, XLSX_KEYS } from './shortcuts.js'

const ROW_H = 24
const HEAD_H = 26
const BUF_ROWS = 6
const BUF_COLS = 2
const MAX_HITS = 100000
const KEY = 16384 // hit key = row * KEY + col; Excel has at most 16384 columns
// The grid ends at the data plus this margin of empty cells. Typing or pasting inside the margin adds data, and the margin moves with it.
const SPARE_ROWS = 20
const SPARE_COLS = 5
const MAX_ROWS = 1048576
// sh.fillRows / sh.fillCols: extra drawn grid so the whole visible pane is cells (set by fitFill); the scroll range is never larger than the pane needs.
const vRows = (sh) => Math.min(MAX_ROWS, Math.max(sh.rows.length + SPARE_ROWS + (sh.growR || 0), sh.fillRows || 0))
const vCols = (sh) => Math.min(KEY, Math.max(sh.cols + SPARE_COLS + (sh.growC || 0), sh.fillCols || 0))

const ico = (inner) =>
  `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`
const ICON = {
  up: ico('<path d="m6 15 6-6 6 6"/>'),
  down: ico('<path d="m6 9 6 6 6-6"/>'),
  close: ico('<path d="M6 6l12 12M18 6 6 18"/>'),
}

function el(tag, cls, text) {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text != null) n.textContent = text
  return n
}

function colLetter(c) {
  let s = ''
  let n = c + 1
  while (n > 0) {
    const m = (n - 1) % 26
    s = String.fromCharCode(65 + m) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

const pad2 = (n) => (n < 10 ? '0' + n : '' + n)
function fmtDate(d) {
  if (isNaN(d.getTime())) return ''
  const day = d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate())
  const h = d.getUTCHours(), m = d.getUTCMinutes(), s = d.getUTCSeconds()
  return h || m || s ? day + ' ' + pad2(h) + ':' + pad2(m) + ':' + pad2(s) : day
}
// Text shown in a grid cell.
function fmt(v) {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(parseFloat(v.toPrecision(12)))
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  if (v instanceof Date) return fmtDate(v)
  return String(v)
}
// Full value shown in the value line.
function fmtFull(v) {
  return typeof v === 'number' ? String(v) : fmt(v)
}

const bytesLabel = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB')
const secs = (ms) => (ms / 1000).toFixed(ms < 10000 ? 2 : 1) + ' s'

function showError(root, title, detail) {
  root.textContent = ''
  const box = el('div', 'xv-err')
  box.setAttribute('role', 'alert')
  box.appendChild(el('p', 'xv-err-title', title))
  if (detail) box.appendChild(el('p', 'xv-err-detail', detail))
  root.appendChild(box)
}

export async function mount(host, d, app) {
  const t0 = performance.now()
  host.textContent = ''
  const root = el('div', 'xv')
  root.setAttribute('role', 'region')
  root.setAttribute('aria-label', 'Excel workbook ' + (d.name || ''))
  host.appendChild(root)

  const bytes = d.bytes
  if (!bytes || !bytes.length) return showError(root, 'This file is empty.', 'There is nothing to show.')
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
    return showError(root, 'Plume opens .xlsx workbooks only.', 'This looks like a legacy .xls file or a password-protected workbook. Save it as .xlsx (without a password) in Excel and open that. Legacy .xls and .ods are not supported.')
  }
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    return showError(root, 'This is not a valid .xlsx file.', 'The file does not start like an Excel workbook, so it may be damaged or have the wrong extension. Only .xlsx is supported, not .xls or .ods.')
  }

  /* ---------- state ---------- */
  const S = { sheets: [], active: 0, find: null, dead: false, t0 }
  // Edits live on the document (d.xl) so they survive switching tabs; the viewer is rebuilt from d.bytes plus these.
  const xl = d.xl || (d.xl = { edits: new Map(), undo: [], redo: [] })
  const editable = !d.readOnly
  root.dataset.editable = editable ? '1' : '0'
  const cleanups = []
  let worker = null
  let raf = 0

  /* ---------- DOM ---------- */
  const fxbar = el('div', 'xv-fxbar')
  const refEl = el('div', 'xv-ref', '')
  refEl.setAttribute('role', 'group')
  refEl.setAttribute('aria-label', 'Selected cell')
  const fxEl = el('div', 'xv-fx')
  fxEl.tabIndex = 0
  fxEl.setAttribute('role', 'textbox')
  fxEl.setAttribute('aria-readonly', 'true')
  fxEl.setAttribute('aria-label', 'Cell value')
  fxEl.setAttribute('aria-live', 'polite')
  fxEl.dataset.ph = 'Click a cell to see its value'
  fxEl.dataset.empty = '1'
  fxbar.append(refEl, fxEl)

  const stage = el('div', 'xv-stage')
  const load = el('div', 'xv-load')
  load.setAttribute('role', 'status')
  const loadText = el('div', 'xv-load-text', 'Reading ' + (d.name || 'workbook') + ' (' + bytesLabel(bytes.length) + ')')
  const loadBar = el('div', 'xv-bar')
  loadBar.setAttribute('aria-hidden', 'true')
  load.append(loadBar, loadText)
  stage.appendChild(load)

  const scroll = el('div', 'xv-scroll')
  scroll.tabIndex = 0
  scroll.setAttribute('role', 'grid')
  scroll.setAttribute('aria-readonly', 'true')
  scroll.setAttribute('aria-multiselectable', 'true')
  scroll.hidden = true
  const head = el('div', 'xv-head')
  head.setAttribute('role', 'row')
  const corner = el('div', 'xv-corner')
  corner.setAttribute('aria-hidden', 'true')
  const hcells = el('div', 'xv-hcells')
  head.append(corner, hcells)
  const frozen = el('div', 'xv-frozen')
  const fnum = el('div', 'xv-fnum')
  fnum.setAttribute('aria-hidden', 'true')
  const fcells = el('div', 'xv-fcells')
  frozen.append(fnum, fcells)
  const body = el('div', 'xv-body')
  const nums = el('div', 'xv-nums')
  nums.setAttribute('aria-hidden', 'true')
  const cells = el('div', 'xv-cells')
  body.append(nums, cells)
  scroll.append(head, frozen, body)
  const emptyNote = el('div', 'xv-empty', 'This sheet is empty.')
  emptyNote.hidden = true
  stage.append(scroll, emptyNote)

  const foot = el('div', 'xv-foot')
  const tabs = el('div', 'xv-tabs')
  tabs.setAttribute('role', 'tablist')
  tabs.setAttribute('aria-label', 'Sheets')
  const fzBtn = el('button', 'xv-fz', 'Freeze row 1')
  fzBtn.type = 'button'
  fzBtn.setAttribute('aria-pressed', 'false')
  fzBtn.title = 'Freeze the first row so it stays visible while scrolling'
  fzBtn.hidden = true
  const countEl = el('div', 'xv-count', '')
  countEl.setAttribute('aria-live', 'polite')
  foot.append(tabs, fzBtn, countEl)

  root.append(fxbar, stage, foot)
  root.style.position = 'relative'
  const panel = shortcutPanel(root, XLSX_KEYS, ICON.close)

  /* ---------- sheet layout ---------- */
  const cur = () => S.sheets[S.active]
  const MAXW = 600

  function measure(sh, c, rowsToScan) {
    let w = 64
    const n = Math.min(sh.rows.length, rowsToScan)
    for (let r = 0; r < n; r++) {
      const row = sh.rows[r]
      if (c < row.length) {
        const px = Math.ceil(Math.min(fmt(row[c]).length, 90) * 7.3) + 18
        if (px > w) w = px
      }
    }
    return w
  }
  function offsetsFrom(sh) {
    const nc = vCols(sh)
    const off = new Float64Array(nc + 1)
    for (let c = 0; c < nc; c++) off[c + 1] = off[c] + sh.w[c]
    sh.offsets = off
  }
  function layout(sh) {
    if (sh.offsets) return
    sh.cols = sh.cols || 1
    sh.w = new Array(vCols(sh))
    for (let c = 0; c < sh.w.length; c++) sh.w[c] = Math.min(320, measure(sh, c, 300))
    offsetsFrom(sh)
    sh.numW = Math.max(44, String(vRows(sh)).length * 8 + 22)
    // Freeze the first row by default when it looks like a header (all text).
    const r0 = sh.rows[0] || []
    sh.fz = !(app && app.settings && app.settings.get('freezeFirstRow') === false) && sh.rows.length > 1 && r0.length > 0 && r0.every((v) => v == null || typeof v === 'string') && r0.some((v) => v) ? 1 : 0
  }
  const topH = (sh) => HEAD_H + sh.fz * ROW_H
  // Draw enough empty cells to fill the visible pane (no grey band), without growing the scroll range past data + margin.
  function fitFill(sh) {
    const fr = Math.ceil((scroll.clientHeight - HEAD_H) / ROW_H) + 1
    sh.fillRows = fr > 0 ? fr : 0
    const base = Math.min(KEY, sh.cols + SPARE_COLS + (sh.growC || 0))
    while (sh.w.length < base) sh.w.push(64)
    let acc = 0
    for (let c = 0; c < base; c++) acc += sh.w[c] || 64
    let c = base
    while (sh.numW + acc < scroll.clientWidth + 1 && c < KEY) {
      if (sh.w.length <= c) sh.w.push(64)
      acc += sh.w[c]
      c++
    }
    const fc = c > base ? c : 0
    if (fc !== (sh.fillCols || 0) || sh.offsets.length !== vCols({ ...sh, fillCols: fc }) + 1) {
      sh.fillCols = fc
      offsetsFrom(sh)
    }
  }

  // Largest column index whose left edge is <= x.
  function colAt(off, x) {
    let lo = 0
    let hi = off.length - 2
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (off[mid] <= x) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  /* ---------- selection model: sh.sel = active cell, sh.anc = anchor of the range ---------- */
  function range(sh) {
    if (!sh.sel) return null
    const a = sh.anc || sh.sel
    return { r0: Math.min(a.r, sh.sel.r), r1: Math.max(a.r, sh.sel.r), c0: Math.min(a.c, sh.sel.c), c1: Math.max(a.c, sh.sel.c) }
  }

  /* ---------- rendering ---------- */
  function render() {
    raf = 0
    const sh = cur()
    if (!sh || !sh.ready || !sh.rows.length || S.dead) return
    layout(sh)
    fitFill(sh)
    const off = sh.offsets
    const n = vRows(sh)
    const fz = sh.fz
    const totalW = off[vCols(sh)]
    const top = scroll.scrollTop
    const left = scroll.scrollLeft
    const vh = scroll.clientHeight
    const vw = scroll.clientWidth
    const r0 = Math.max(fz, Math.floor(top / ROW_H) + fz - BUF_ROWS)
    const r1 = Math.min(n - 1, Math.ceil((top + vh) / ROW_H) + fz + BUF_ROWS)
    const c0 = Math.max(0, colAt(off, Math.max(0, left - sh.numW)) - BUF_COLS)
    const c1 = Math.min(vCols(sh) - 1, colAt(off, Math.max(0, left + vw - sh.numW)) + BUF_COLS)
    // scrolling close to the end adds another SPARE_ROWS rows / SPARE_COLS columns (view only, never saved; bounded by the Excel limits)
    const lastVisR = Math.floor((top + vh - HEAD_H - fz * ROW_H) / ROW_H) + fz
    const lastVisC = colAt(off, Math.max(0, left + vw - sh.numW))
    let grew = false
    if (top > 0 && lastVisR >= n - 3 && n < MAX_ROWS) { sh.growR = (sh.growR || 0) + SPARE_ROWS; grew = true }
    if (left > 0 && lastVisC >= vCols(sh) - 2 && vCols(sh) < KEY) { sh.growC = (sh.growC || 0) + SPARE_COLS; grew = true }
    if (grew) return render()

    head.style.width = sh.numW + totalW + 'px'
    frozen.style.width = sh.numW + totalW + 'px'
    frozen.style.top = HEAD_H + 'px'
    frozen.hidden = !fz
    body.style.width = sh.numW + totalW + 'px'
    body.style.height = (n - fz) * ROW_H + 'px'
    corner.style.width = sh.numW + 'px'
    fnum.style.width = sh.numW + 'px'
    nums.style.width = sh.numW + 'px'
    hcells.style.width = totalW + 'px'
    cells.style.width = totalW + 'px'
    fcells.style.width = totalW + 'px'

    const rg = range(sh)
    const selR = sh.sel ? sh.sel.r : -1
    const selC = sh.sel ? sh.sel.c : -1
    const f = S.find
    const hitSet = f && f.set
    const curKey = f && f.hits.length ? f.hits[f.idx] : -1

    const hf = document.createDocumentFragment()
    for (let c = c0; c <= c1; c++) {
      const on = rg && c >= rg.c0 && c <= rg.c1
      const h = el('div', 'xv-h' + (on ? ' on' : ''), colLetter(c))
      h.setAttribute('role', 'columnheader')
      h.setAttribute('aria-colindex', String(c + 1))
      h.dataset.c = String(c)
      h.style.left = off[c] + 'px'
      h.style.width = sh.w[c] + 'px'
      const rz = el('div', 'xv-rz')
      rz.dataset.c = String(c)
      rz.title = 'Drag to resize, double-click to fit'
      h.appendChild(rz)
      hf.appendChild(h)
    }
    hcells.replaceChildren(hf)

    const buildRow = (r, y) => {
      const rOn = rg && r >= rg.r0 && r <= rg.r1
      const nn = el('div', 'xv-n' + (rOn ? ' on' : ''), String(r + 1))
      nn.style.top = y + 'px'
      nn.dataset.r = String(r)
      const row = el('div', 'xv-row')
      row.setAttribute('role', 'row')
      row.setAttribute('aria-rowindex', String(r + 1))
      row.style.top = y + 'px'
      row.style.width = totalW + 'px'
      const data = sh.rows[r] || []
      for (let c = c0; c <= c1; c++) {
        const v = c < data.length ? data[c] : null
        let cls = 'xv-c'
        if (typeof v === 'number' || v instanceof Date) cls += ' num'
        else if (typeof v === 'boolean') cls += ' bool'
        if (fz && r === 0) cls += ' fz'
        const inRg = rg && r >= rg.r0 && r <= rg.r1 && c >= rg.c0 && c <= rg.c1
        if (hitSet) {
          const k = r * KEY + c
          if (k === curKey) cls += ' hit cur'
          else if (hitSet.has(k)) cls += ' hit'
        }
        if (inRg) cls += ' rng'
        const active = r === selR && c === selC
        if (active) cls += ' sel'
        const cell = el('div', cls, fmt(v))
        cell.setAttribute('role', 'gridcell')
        cell.setAttribute('aria-colindex', String(c + 1))
        if (inRg) cell.setAttribute('aria-selected', 'true')
        cell.style.left = off[c] + 'px'
        cell.style.width = sh.w[c] + 'px'
        row.appendChild(cell)
      }
      return [nn, row]
    }
    if (fz) {
      const [a, b] = buildRow(0, 0)
      fnum.replaceChildren(a)
      fcells.replaceChildren(b)
    }
    const nf = document.createDocumentFragment()
    const rf = document.createDocumentFragment()
    for (let r = r0; r <= r1; r++) {
      const [a, b] = buildRow(r, (r - fz) * ROW_H)
      nf.appendChild(a)
      rf.appendChild(b)
    }
    nums.replaceChildren(nf)
    cells.replaceChildren(rf)
  }
  const schedule = () => {
    if (!raf && !S.dead) raf = requestAnimationFrame(render)
  }

  function setValueLine() {
    const sh = cur()
    if (!sh || !sh.sel) {
      refEl.textContent = ''
      fxEl.textContent = ''
      fxEl.dataset.empty = '1'
      return
    }
    const { r, c } = sh.sel
    const v = sh.rows[r] && c < sh.rows[r].length ? sh.rows[r][c] : null
    const rg = range(sh)
    refEl.textContent = rg.r0 === rg.r1 && rg.c0 === rg.c1 ? colLetter(c) + (r + 1) : colLetter(rg.c0) + (rg.r0 + 1) + ':' + colLetter(rg.c1) + (rg.r1 + 1)
    const t = fmtFull(v)
    fxEl.textContent = t
    if (t) delete fxEl.dataset.empty
    else fxEl.dataset.empty = '1'
    fxEl.dataset.ph = 'Empty cell'
  }

  function ensureVisible(r, c) {
    const sh = cur()
    layout(sh)
    const bodyH = scroll.clientHeight - topH(sh)
    const vw = scroll.clientWidth
    if (r >= sh.fz) {
      const rowTop = (r - sh.fz) * ROW_H
      if (rowTop < scroll.scrollTop) scroll.scrollTop = rowTop
      else if (rowTop + ROW_H > scroll.scrollTop + bodyH) scroll.scrollTop = rowTop + ROW_H - bodyH
    }
    const o = sh.offsets
    if (o[c] < scroll.scrollLeft) scroll.scrollLeft = o[c]
    else if (sh.numW + o[c + 1] > scroll.scrollLeft + vw) scroll.scrollLeft = sh.numW + o[c + 1] - vw
  }

  // Move the active cell; extend keeps the anchor so the range grows.
  function moveTo(r, c, extend, reveal = true) {
    const sh = cur()
    if (!sh || !sh.ready || !sh.rows.length) return
    r = Math.min(vRows(sh) - 1, Math.max(0, r))
    c = Math.min(vCols(sh) - 1, Math.max(0, c))
    if (!extend || !sh.anc) sh.anc = { r, c }
    if (!extend) sh.anc = { r, c }
    sh.sel = { r, c }
    if (reveal) ensureVisible(r, c)
    setValueLine()
    render()
  }
  const select = (r, c, reveal) => moveTo(r, c, false, reveal)

  const cellVal = (sh, r, c) => (sh.rows[r] && c < sh.rows[r].length ? sh.rows[r][c] : null)
  const isEmpty = (sh, r, c) => {
    const v = cellVal(sh, r, c)
    return v == null || v === ''
  }
  // Ctrl+arrow: jump to the edge of the data block, as Excel does.
  function jumpEdge(sh, r, c, dr, dc) {
    const inb = (a, b) => a >= 0 && b >= 0 && a < vRows(sh) && b < vCols(sh)
    let nr = r + dr
    let nc = c + dc
    if (!inb(nr, nc)) return { r, c }
    if (!isEmpty(sh, r, c) && !isEmpty(sh, nr, nc)) {
      while (inb(nr + dr, nc + dc) && !isEmpty(sh, nr + dr, nc + dc)) { nr += dr; nc += dc }
      return { r: nr, c: nc }
    }
    while (inb(nr, nc) && isEmpty(sh, nr, nc)) { nr += dr; nc += dc }
    if (!inb(nr, nc)) { nr -= dr; nc -= dc }
    return { r: nr, c: nc }
  }
  const lastDataCell = (sh) => {
    let lr = sh.rows.length - 1
    while (lr > 0 && sh.rows[lr].every((v) => v == null || v === '')) lr--
    let lc = 0
    for (let r = 0; r <= lr; r++) { const row = sh.rows[r]; for (let c = row.length - 1; c >= lc; c--) if (row[c] != null && row[c] !== '') { lc = c; break } }
    return { r: lr, c: lc }
  }

  // Tab-separated text of the selected range (cells holding a tab, quote or line break are quoted).
  function selectionText(sh) {
    const rg = range(sh)
    if (!rg) return ''
    if ((rg.r1 - rg.r0 + 1) * (rg.c1 - rg.c0 + 1) > 3000000) return null
    const lines = []
    for (let r = rg.r0; r <= rg.r1; r++) {
      const parts = []
      for (let c = rg.c0; c <= rg.c1; c++) {
        const t = fmtFull(cellVal(sh, r, c))
        parts.push(/[\t\r\n"]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t)
      }
      lines.push(parts.join('\t'))
    }
    return lines.join('\r\n')
  }
  async function copySelection() {
    const sh = cur()
    if (!sh || !sh.sel) return
    const t = selectionText(sh)
    if (t == null) { countEl.textContent = 'Selection too large to copy'; return }
    try {
      await navigator.clipboard.writeText(t)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = t
      ta.style.cssText = 'position:fixed;opacity:0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
      scroll.focus()
    }
    root.dataset.copied = String(t.length)
  }

  scroll.addEventListener('scroll', () => {
    const sh = cur()
    if (sh) {
      sh.sx = scroll.scrollLeft
      sh.sy = scroll.scrollTop
    }
    schedule()
  })

  // Cell under a mouse event, or null (headers, scrollbars, past the data).
  function hitCell(e, clamp) {
    const sh = cur()
    if (!sh || !sh.ready || !sh.offsets) return null
    const rect = scroll.getBoundingClientRect()
    const vx = e.clientX - rect.left
    const vy = e.clientY - rect.top - HEAD_H
    if (!clamp && (vx < sh.numW || vy < 0 || e.clientX > rect.left + scroll.clientWidth || e.clientY > rect.top + scroll.clientHeight)) return null
    const x = Math.max(0, vx - sh.numW + scroll.scrollLeft)
    let r = sh.fz && vy < sh.fz * ROW_H ? 0 : Math.floor((vy - sh.fz * ROW_H + scroll.scrollTop) / ROW_H) + sh.fz
    if (!clamp && r > vRows(sh) - 1) return null
    r = Math.min(vRows(sh) - 1, Math.max(0, r))
    const c = x >= sh.offsets[vCols(sh)] ? vCols(sh) - 1 : colAt(sh.offsets, x)
    if (!clamp && x >= sh.offsets[vCols(sh)]) return null
    return { r, c }
  }

  // Resize handle on a column letter: drag to resize, double-click to fit.
  function fitColumn(sh, c) {
    sh.w[c] = Math.min(MAXW, measure(sh, c, 20000))
    offsetsFrom(sh)
    schedule()
  }
  /* ---------- editing ---------- */
  const sameVal = (a, b) => {
    if (a == null || a === '') return b == null || b === ''
    if (a instanceof Date) return b instanceof Date && a.getTime() === b.getTime()
    return a === b
  }
  function putCell(sh, r, c, v) {
    if (!sh.rows[r] && (v == null || v === '')) return
    // data written into the margin becomes real rows/columns, and the margin (SPARE_ROWS / SPARE_COLS) moves with it
    while (sh.rows.length <= r) sh.rows.push([])
    const row = sh.rows[r]
    while (row.length <= c) row.push(null)
    row[c] = v
    if (v != null && v !== '' && c >= sh.cols) {
      sh.cols = c + 1
      if (sh.offsets) {
        while (sh.w.length < vCols(sh)) sh.w.push(64)
        offsetsFrom(sh)
      }
    }
    if (sh.offsets) sh.numW = Math.max(sh.numW, String(vRows(sh)).length * 8 + 22)
  }
  // Text typed or pasted into a cell: number, TRUE/FALSE, empty, or text. A leading = is a formula.
  function parseTyped(t) {
    const x = t.trim()
    if (x === '') return null
    if (/^(true|false)$/i.test(x)) return x.toLowerCase() === 'true'
    if (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(x)) { const n = Number(x); if (Number.isFinite(n)) return n }
    return t
  }
  function setDirty() {
    if (app && app.actions && app.actions.setDirty) app.actions.setDirty(d, xl.edits.size > 0)
  }
  // Apply [{si, r, c, old, nw}] as one undo step (or as an undo/redo replay when record is false).
  function applyChanges(changes, dir) {
    for (const ch of changes) {
      const sh = S.sheets[ch.si]
      if (!sh || !sh.ready) continue
      const target = dir === 'undo' ? ch.old : ch.nw
      const before = cellVal(sh, ch.r, ch.c) ?? null
      putCell(sh, ch.r, ch.c, target)
      const key = ch.si + ':' + ch.r + ':' + ch.c
      const e = xl.edits.get(key)
      if (!e) {
        if (!sameVal(before, target)) xl.edits.set(key, { si: ch.si, r: ch.r, c: ch.c, v: target, orig: before })
      } else if (sameVal(target, e.orig)) xl.edits.delete(key)
      else e.v = target
    }
    setDirty()
  }
  function commitChanges(changes) {
    const real = changes.filter((ch) => !sameVal(ch.old, ch.nw))
    if (!real.length) return
    applyChanges(real, 'redo')
    xl.undo.push(real)
    if (xl.undo.length > 200) xl.undo.shift()
    xl.redo.length = 0
    setValueLine()
    render()
  }
  function replay(from, to, dir) {
    const batch = from.pop()
    if (!batch) return
    if (S.active !== batch[0].si) activate(batch[0].si)
    applyChanges(batch, dir)
    to.push(batch)
    const sh = cur()
    sh.sel = sh.anc = { r: batch[0].r, c: batch[0].c }
    ensureVisible(batch[0].r, batch[0].c)
    setValueLine()
    render()
  }

  let ed = null
  function startEdit(initial) {
    const sh = cur()
    if (!editable || ed || !sh || !sh.ready || !sh.rows.length) return
    if (!sh.sel) { sh.sel = sh.anc = { r: 0, c: 0 } }
    const { r, c } = sh.sel
    ensureVisible(r, c)
    layout(sh)
    const orig = fmtFull(cellVal(sh, r, c))
    const input = el('input', 'xv-edit')
    input.type = 'text'
    input.value = initial == null ? orig : initial
    input.spellcheck = false
    input.setAttribute('aria-label', 'Edit cell ' + colLetter(c) + (r + 1))
    input.style.left = sh.numW + sh.offsets[c] + 'px'
    input.style.top = (r < sh.fz ? 0 : (r - sh.fz) * ROW_H) + 'px'
    input.style.minWidth = Math.max(sh.w[c], 96) + 'px'
    ed = { input, r, c, si: S.active, orig, rg: range(sh) }
    input.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); finishEdit(true, null, true) }
      else if (e.key === 'Enter') { e.preventDefault(); finishEdit(true, e.shiftKey ? 'up' : 'down') }
      else if (e.key === 'Tab') { e.preventDefault(); finishEdit(true, e.shiftKey ? 'left' : 'right') }
      else if (e.key === 'Escape') { e.preventDefault(); finishEdit(false) }
    })
    input.addEventListener('blur', () => finishEdit(true))
    ;(r < sh.fz ? frozen : body).appendChild(input)
    input.focus()
    if (initial == null) input.select()
    else input.setSelectionRange(input.value.length, input.value.length)
  }
  function finishEdit(commit, move, fill) {
    if (!ed) return
    const e = ed
    ed = null
    const text = e.input.value
    if (e.input.isConnected) e.input.remove()
    const sh = S.sheets[e.si]
    if (commit && sh && fill && e.rg) {
      // Ctrl+Enter: the typed entry goes into every cell of the selection
      const nw = parseTyped(text)
      const changes = []
      for (let r = e.rg.r0; r <= e.rg.r1; r++) for (let c = e.rg.c0; c <= e.rg.c1; c++) changes.push({ si: e.si, r, c, old: cellVal(sh, r, c) ?? null, nw })
      commitChanges(changes)
    } else if (commit && sh && text !== e.orig) {
      commitChanges([{ si: e.si, r: e.r, c: e.c, old: cellVal(sh, e.r, e.c) ?? null, nw: parseTyped(text) }])
    }
    if (!S.dead && !scroll.hidden) {
      scroll.focus()
      if (move) moveTo(e.r + (move === 'down' ? 1 : move === 'up' ? -1 : 0), e.c + (move === 'right' ? 1 : move === 'left' ? -1 : 0), false, true)
    }
  }
  function clearRange() {
    const sh = cur()
    const rg = sh && range(sh)
    if (!editable || !rg) return
    const changes = []
    for (let r = rg.r0; r <= rg.r1; r++) for (let c = rg.c0; c <= rg.c1; c++) { const v = cellVal(sh, r, c); if (v != null && v !== '') changes.push({ si: S.active, r, c, old: v, nw: null }) }
    commitChanges(changes)
  }
  function parseTSV(text) {
    const rows = []
    let row = []
    let cell = ''
    let q = false
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++ } else q = false }
        else cell += ch
      } else if (ch === '"' && cell === '') q = true
      else if (ch === '\t') { row.push(cell); cell = '' }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = '' }
      else cell += ch
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
    return rows
  }
  async function pasteClipboard() {
    const sh = cur()
    if (!editable || !sh || !sh.sel) return
    let text = ''
    try { text = await navigator.clipboard.readText() } catch { return }
    if (!text) return
    const grid = parseTSV(text)
    const rg = range(sh)
    const changes = []
    for (let i = 0; i < grid.length; i++) {
      const r = rg.r0 + i
      if (r >= MAX_ROWS) break
      for (let j = 0; j < grid[i].length; j++) {
        const c = rg.c0 + j
        if (c >= KEY) break
        changes.push({ si: S.active, r, c, old: cellVal(sh, r, c) ?? null, nw: parseTyped(grid[i][j]) })
      }
    }
    commitChanges(changes)
    const last = changes[changes.length - 1]
    if (last) { sh.anc = { r: rg.r0, c: rg.c0 }; sh.sel = { r: last.r, c: last.c }; setValueLine(); render() }
  }

  scroll.addEventListener('dblclick', (e) => {
    if (editable && !(e.target.closest && e.target.closest('.xv-rz'))) {
      const h = hitCell(e, false)
      if (h) { e.preventDefault(); moveTo(h.r, h.c, false, true); startEdit(null); return }
    }
    const rz = e.target.closest && e.target.closest('.xv-rz')
    const sh = cur()
    if (!rz || !sh) return
    e.preventDefault()
    fitColumn(sh, Number(rz.dataset.c))
  })

  scroll.addEventListener('mousedown', (e) => {
    const sh = cur()
    if (!sh || !sh.ready || e.button !== 0) return
    const rz = e.target.closest && e.target.closest('.xv-rz')
    if (rz) {
      e.preventDefault()
      const c = Number(rz.dataset.c)
      const startX = e.clientX
      const startW = sh.w[c]
      const mv = (m) => {
        sh.w[c] = Math.min(MAXW, Math.max(32, startW + m.clientX - startX))
        offsetsFrom(sh)
        schedule()
      }
      const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up) }
      document.addEventListener('mousemove', mv)
      document.addEventListener('mouseup', up)
      return
    }
    const hd = e.target.closest && e.target.closest('.xv-h')
    if (hd) { // whole column
      const c = Number(hd.dataset.c)
      scroll.focus()
      sh.anc = { r: 0, c: e.shiftKey && sh.anc ? sh.anc.c : c }
      sh.sel = { r: sh.rows.length - 1, c }
      setValueLine()
      render()
      return
    }
    const rn = e.target.closest && e.target.closest('.xv-n')
    if (rn) { // whole row
      const r = Number(rn.dataset.r)
      scroll.focus()
      sh.anc = { r: e.shiftKey && sh.anc ? sh.anc.r : r, c: 0 }
      sh.sel = { r, c: sh.cols - 1 }
      setValueLine()
      render()
      return
    }
    const hit = hitCell(e, false)
    if (!hit) return
    e.preventDefault()
    scroll.focus()
    moveTo(hit.r, hit.c, e.shiftKey && !!sh.anc, false)
    const mv = (m) => {
      if (!(m.buttons & 1)) return up()
      const h = hitCell(m, true)
      if (h) {
        sh.sel = h
        setValueLine()
        render()
      }
    }
    const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up) }
    document.addEventListener('mousemove', mv)
    document.addEventListener('mouseup', up)
  })

  /* ---------- Excel / Google Sheets keyboard shortcuts ---------- */
  const pad2 = (n) => String(n).padStart(2, '0')
  const todayText = () => { const n = new Date(); return n.getFullYear() + '-' + pad2(n.getMonth() + 1) + '-' + pad2(n.getDate()) }
  const timeText = () => { const n = new Date(); return pad2(n.getHours()) + ':' + pad2(n.getMinutes()) }
  // Ctrl+; and Ctrl+Shift+;: the date or time goes into the active cell as text
  function enterText(text) {
    const sh = cur()
    if (!editable || !sh || !sh.sel) return
    const { r, c } = sh.sel
    commitChanges([{ si: S.active, r, c, old: cellVal(sh, r, c) ?? null, nw: text }])
  }
  // Ctrl+Enter (whole selection from the active cell), Ctrl+D (down), Ctrl+R (right). One cell selected: copy from the neighbour above or left.
  function fillRange(kind) {
    const sh = cur()
    const rg = sh && range(sh)
    if (!editable || !rg) return
    const changes = []
    const put = (r, c, v) => changes.push({ si: S.active, r, c, old: cellVal(sh, r, c) ?? null, nw: v ?? null })
    if (kind === 'all') {
      const v = cellVal(sh, sh.sel.r, sh.sel.c)
      for (let r = rg.r0; r <= rg.r1; r++) for (let c = rg.c0; c <= rg.c1; c++) put(r, c, v)
    } else if (kind === 'down') {
      const single = rg.r0 === rg.r1
      if (single && rg.r0 === 0) return
      for (let c = rg.c0; c <= rg.c1; c++) {
        const src = cellVal(sh, single ? rg.r0 - 1 : rg.r0, c)
        for (let r = single ? rg.r0 : rg.r0 + 1; r <= rg.r1; r++) put(r, c, src)
      }
    } else {
      const single = rg.c0 === rg.c1
      if (single && rg.c0 === 0) return
      for (let r = rg.r0; r <= rg.r1; r++) {
        const src = cellVal(sh, r, single ? rg.c0 - 1 : rg.c0)
        for (let c = single ? rg.c0 : rg.c0 + 1; c <= rg.c1; c++) put(r, c, src)
      }
    }
    commitChanges(changes)
  }
  // Alt+PageDown / Alt+PageUp: one screen to the right or left
  function across(sh, dir, ext) {
    const s = sh.sel || { r: 0, c: 0 }
    const vw = Math.max(64, scroll.clientWidth - sh.numW)
    let nc = dir > 0 ? colAt(sh.offsets, sh.offsets[s.c] + vw) : colAt(sh.offsets, Math.max(0, sh.offsets[s.c] - vw))
    if (dir > 0 && nc <= s.c) nc = s.c + 1
    moveTo(s.r, nc, ext, true)
  }

  const onGridKey = (e) => {
    const sh = cur()
    if (!sh || !sh.ready || !sh.rows.length) return
    const mod = e.ctrlKey || e.metaKey
    const k = e.key
    if (e.altKey) {
      if (!mod && (k === 'PageDown' || k === 'PageUp')) { e.preventDefault(); across(sh, k === 'PageDown' ? 1 : -1, e.shiftKey) }
      return
    }
    if (mod && !e.shiftKey && (k === 'a' || k === 'A')) {
      e.preventDefault()
      sh.anc = { r: 0, c: 0 }
      sh.sel = { r: sh.rows.length - 1, c: sh.cols - 1 }
      setValueLine()
      render()
      return
    }
    if (mod && (k === 'c' || k === 'C')) {
      e.preventDefault()
      copySelection()
      return
    }
    // Ctrl+Space selects the column, Shift+Space the row (typing a space does not start an edit)
    if (k === ' ' && (mod || e.shiftKey)) {
      e.preventDefault()
      const s = sh.sel || { r: 0, c: 0 }
      if (mod) { sh.anc = { r: 0, c: s.c }; sh.sel = { r: sh.rows.length - 1, c: s.c } }
      else { sh.anc = { r: s.r, c: 0 }; sh.sel = { r: s.r, c: sh.cols - 1 } }
      setValueLine()
      render()
      return
    }
    if (mod && k === 'Enter') { e.preventDefault(); fillRange('all'); return }
    if (editable) {
      if (mod && (k === 'z' || k === 'Z') && !e.shiftKey) { e.preventDefault(); replay(xl.undo, xl.redo, 'undo'); return }
      if (mod && (k === 'y' || k === 'Y' || ((k === 'z' || k === 'Z') && e.shiftKey))) { e.preventDefault(); replay(xl.redo, xl.undo, 'redo'); return }
      if (mod && (k === 'v' || k === 'V')) { e.preventDefault(); pasteClipboard(); return }
      if (mod && (k === 'x' || k === 'X')) { e.preventDefault(); copySelection().then(clearRange); return }
      if (mod && !e.shiftKey && (k === 'd' || k === 'D')) { e.preventDefault(); fillRange('down'); return }
      if (mod && !e.shiftKey && (k === 'r' || k === 'R')) { e.preventDefault(); fillRange('right'); return }
      if (mod && (k === ';' || k === ':')) { e.preventDefault(); enterText(e.shiftKey || k === ':' ? timeText() : todayText()); return }
      if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); clearRange(); return }
      if (k === 'F2') { e.preventDefault(); startEdit(null); return }
      if (!mod && k.length === 1) { e.preventDefault(); startEdit(k); return }
    }
    const s = sh.sel || { r: 0, c: 0 }
    const page = Math.max(1, Math.floor((scroll.clientHeight - topH(sh)) / ROW_H) - 1)
    const ext = e.shiftKey
    let t = null
    switch (k) {
      case 'ArrowDown': t = mod ? jumpEdge(sh, s.r, s.c, 1, 0) : { r: s.r + 1, c: s.c }; break
      case 'ArrowUp': t = mod ? jumpEdge(sh, s.r, s.c, -1, 0) : { r: s.r - 1, c: s.c }; break
      case 'ArrowRight': t = mod ? jumpEdge(sh, s.r, s.c, 0, 1) : { r: s.r, c: s.c + 1 }; break
      case 'ArrowLeft': t = mod ? jumpEdge(sh, s.r, s.c, 0, -1) : { r: s.r, c: s.c - 1 }; break
      case 'PageDown': if (mod) return; t = { r: s.r + page, c: s.c }; break
      case 'PageUp': if (mod) return; t = { r: s.r - page, c: s.c }; break
      case 'Home': t = mod ? { r: 0, c: 0 } : { r: s.r, c: 0 }; break
      case 'End': t = mod ? lastDataCell(sh) : { r: s.r, c: sh.cols - 1 }; break
      case 'Tab': t = { r: s.r, c: s.c + (ext ? -1 : 1) }; break
      case 'Enter': t = { r: s.r + (ext ? -1 : 1), c: s.c }; break
      default: return
    }
    e.preventDefault()
    if (!sh.sel && /^Arrow/.test(k)) t = { r: 0, c: 0 }
    moveTo(t.r, t.c, ext && (k.startsWith('Arrow') || k === 'Home' || k === 'End' || k.startsWith('Page')), true)
  }
  scroll.addEventListener('keydown', onGridKey)
  // Sheet switching works from anywhere inside the viewer (grid, tabs, value line).
  const switchSheetKey = (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'PageDown' || e.key === 'PageUp') && S.sheets.length > 1) {
      e.preventDefault()
      e.stopPropagation()
      const n = S.sheets.length
      activate((S.active + (e.key === 'PageDown' ? 1 : n - 1)) % n)
      if (!scroll.hidden) scroll.focus()
    }
  }
  root.addEventListener('keydown', switchSheetKey)
  scroll.addEventListener('copy', (e) => {
    const sh = cur()
    if (!sh || !sh.sel || !e.clipboardData) return
    const t = selectionText(sh)
    if (t == null) return
    e.clipboardData.setData('text/plain', t)
    e.preventDefault()
  })
  fzBtn.addEventListener('click', () => {
    const sh = cur()
    if (!sh || !sh.ready) return
    sh.fz = sh.fz ? 0 : 1
    scroll.scrollTop = 0
    paintFz()
    render()
  })
  function paintFz() {
    const sh = cur()
    fzBtn.hidden = !sh || !sh.ready || sh.rows.length < 2
    fzBtn.setAttribute('aria-pressed', sh && sh.fz ? 'true' : 'false')
  }
  const ro = new ResizeObserver(schedule)
  ro.observe(scroll)
  cleanups.push(() => ro.disconnect())

  /* ---------- tabs ---------- */
  function buildTabs() {
    tabs.textContent = ''
    S.sheets.forEach((sh, i) => {
      const b = el('button', 'xv-tab', sh.name)
      b.type = 'button'
      b.setAttribute('role', 'tab')
      b.setAttribute('aria-label', 'Sheet ' + sh.name)
      b.title = sh.name
      b.addEventListener('click', () => activate(i))
      b.addEventListener('keydown', (e) => {
        const k = e.key
        if (k !== 'ArrowRight' && k !== 'ArrowLeft' && k !== 'Home' && k !== 'End') return
        e.preventDefault()
        const n = S.sheets.length
        const j = k === 'Home' ? 0 : k === 'End' ? n - 1 : (i + (k === 'ArrowRight' ? 1 : n - 1)) % n
        activate(j)
        tabs.children[j].focus()
      })
      sh.tab = b
      tabs.appendChild(b)
    })
  }
  function paintTabs() {
    S.sheets.forEach((sh, i) => {
      const on = i === S.active
      sh.tab.setAttribute('aria-selected', on ? 'true' : 'false')
      sh.tab.tabIndex = on ? 0 : -1
    })
  }

  function showSheet() {
    const sh = cur()
    paintTabs()
    paintFz()
    scroll.setAttribute('aria-label', sh.name + ' sheet')
    if (!sh.ready) {
      scroll.hidden = true
      emptyNote.hidden = true
      load.hidden = false
      updateLoadText()
      countEl.textContent = sh.total.toLocaleString() + ' rows'
      setValueLine()
      return
    }
    load.hidden = true
    paintFz()
    if (!sh.rows.length) {
      scroll.hidden = true
      emptyNote.hidden = false
      countEl.textContent = '0 rows'
      refEl.textContent = ''
      fxEl.textContent = ''
      fxEl.dataset.empty = '1'
      return
    }
    emptyNote.hidden = true
    scroll.hidden = false
    layout(sh)
    if (!sh.sel) sh.sel = sh.anc = { r: 0, c: 0 }
    countEl.textContent = sh.rows.length.toLocaleString() + ' rows × ' + sh.cols.toLocaleString() + ' columns'
    scroll.scrollTop = sh.sy || 0
    scroll.scrollLeft = sh.sx || 0
    paintFz()
    setValueLine()
    render()
  }

  function activate(i) {
    if (i === S.active && cur()) return
    S.active = i
    showSheet()
    if (S.find && S.find.open) runSearch()
  }

  function updateLoadText() {
    const sh = cur()
    if (!sh) return
    const elapsed = secs(performance.now() - t0)
    if (!S.sheets.length) loadText.textContent = 'Reading ' + (d.name || 'workbook') + ' (' + bytesLabel(bytes.length) + ') ' + elapsed
    else if (!sh.ready) loadText.textContent = 'Loading ' + sh.name + ': ' + sh.rows.length.toLocaleString() + ' of ' + sh.total.toLocaleString() + ' rows (' + elapsed + ')'
  }
  const tick = setInterval(updateLoadText, 250)
  cleanups.push(() => clearInterval(tick))

  /* ---------- data intake (from worker or main-thread fallback) ---------- */
  let firstShown = false
  function onMeta(list) {
    S.sheets = list.map((s) => ({ name: s.name, total: s.total, rows: [], ready: false, cols: 0, tab: null, sel: null, sx: 0, sy: 0 }))
    if (!S.sheets.length) return showError(root, 'This workbook has no sheets.', '')
    buildTabs()
    showSheet()
  }
  function onRows(i, rows) {
    const sh = S.sheets[i]
    if (!sh) return
    for (let k = 0; k < rows.length; k++) {
      const row = rows[k]
      sh.rows.push(row)
      if (row.length > sh.cols) sh.cols = row.length
    }
    if (sh.rows.length >= sh.total) {
      for (const e of xl.edits.values()) if (e.si === i) putCell(sh, e.r, e.c, e.v)
      sh.ready = true
      sh.loadedAt = performance.now() - t0
      if (i === 0 && !firstShown) {
        firstShown = true
        root.dataset.openMs = String(Math.round(sh.loadedAt))
      }
      if (i === S.active) showSheet()
      if (i === 0 && !scroll.hidden && document.activeElement === document.body) scroll.focus({ preventScroll: true })
    } else if (i === S.active) updateLoadText()
  }
  function onDone() {
    root.dataset.allMs = String(Math.round(performance.now() - t0))
    root.dataset.ready = '1'
    clearInterval(tick)
  }
  function onFail(msg) {
    clearInterval(tick)
    showError(root, 'Plume could not read this workbook.', 'The file may be damaged, password-protected, or not a real .xlsx file. Only .xlsx is supported. (' + String(msg || 'unknown error').slice(0, 160) + ')')
  }

  async function parseOnMainThread() {
    const mod = await import('read-excel-file/browser')
    const sheets = await mod.default(bytes.slice().buffer)
    onMeta(sheets.map((s) => ({ name: s.sheet, total: s.data.length })))
    for (let i = 0; i < sheets.length; i++) {
      onRows(i, sheets[i].data)
      await new Promise((r) => setTimeout(r, 0))
    }
    onDone()
  }

  try {
    let gotMessage = false
    worker = new Worker(new URL('./xlsxworker.js', import.meta.url), { type: 'module' })
    worker.onmessage = (e) => {
      if (S.dead) return
      gotMessage = true
      const m = e.data
      if (m.t === 'meta') onMeta(m.sheets)
      else if (m.t === 'rows') onRows(m.i, m.rows)
      else if (m.t === 'done') { onDone(); worker.terminate(); worker = null }
      else if (m.t === 'error') { onFail(m.msg); worker.terminate(); worker = null }
    }
    worker.onerror = (e) => {
      if (S.dead) return
      if (worker) { worker.terminate(); worker = null }
      if (gotMessage) return onFail(e && e.message)
      parseOnMainThread().catch((err) => onFail(err && err.message))
    }
    const copy = bytes.slice().buffer
    worker.postMessage({ buf: copy }, [copy])
  } catch (err) {
    parseOnMainThread().catch((e2) => onFail(e2 && e2.message))
  }

  /* ---------- find ---------- */
  function buildFind() {
    const bar = el('div', 'find-bar xv-find')
    bar.setAttribute('role', 'search')
    bar.setAttribute('aria-label', 'Find in sheet')
    bar.hidden = true
    const row = el('div', 'find-row')
    const input = el('input', 'find-input')
    input.type = 'text'
    input.placeholder = 'Find in sheet'
    input.setAttribute('aria-label', 'Find in sheet')
    input.spellcheck = false
    const count = el('span', 'find-count', '')
    count.setAttribute('aria-live', 'polite')
    const btn = (icon, label, fn) => {
      const b = el('button', 'find-btn')
      b.type = 'button'
      b.innerHTML = icon
      b.title = label
      b.setAttribute('aria-label', label)
      b.addEventListener('click', fn)
      return b
    }
    const prev = btn(ICON.up, 'Previous match', () => step(-1))
    const next = btn(ICON.down, 'Next match', () => step(1))
    const close = btn(ICON.close, 'Close find', () => closeFind(true))
    row.append(input, count, el('span', 'find-sep'), prev, next, close)
    bar.appendChild(row)
    const rrow = el('div', 'find-row replace-row')
    rrow.hidden = true
    const rin = el('input', 'replace-input')
    rin.type = 'text'
    rin.placeholder = 'Replace with'
    rin.setAttribute('aria-label', 'Replace with')
    rin.spellcheck = false
    const tb = (label, fn) => {
      const b = el('button', 'find-btn txt', label)
      b.type = 'button'
      b.addEventListener('click', fn)
      return b
    }
    rrow.append(rin, tb('Replace', () => replaceHits(false)), tb('Replace all', () => replaceHits(true)))
    bar.appendChild(rrow)
    rin.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); replaceHits(false) }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeFind(true) }
    })
    root.appendChild(bar)
    input.addEventListener('input', () => {
      clearTimeout(S.find.timer)
      S.find.timer = setTimeout(runSearch, 120)
    })
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); clearTimeout(S.find.timer); if (S.find.pending) runSearch(); else step(e.shiftKey ? -1 : 1) }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeFind(true) }
    })
    S.find = { bar, input, count, rrow, rin, hits: [], set: null, idx: 0, token: 0, open: false, timer: 0, pending: false }
  }

  function openFind(withReplace) {
    if (S.dead) return
    if (!S.find) buildFind()
    closeGoto()
    const f = S.find
    f.rrow.hidden = !(withReplace === true && editable)
    f.open = true
    f.bar.hidden = false
    f.input.focus()
    f.input.select()
    if (f.input.value) runSearch()
  }
  function closeFind(refocus) {
    const f = S.find
    if (!f || !f.open) return
    f.open = false
    f.token++
    f.bar.hidden = true
    f.hits = []
    f.set = null
    if (refocus && !scroll.hidden) scroll.focus()
    render()
  }
  // Ctrl+H: replace the current hit, or every hit, as one undo step. Matching is case-insensitive, like find.
  function replaceHits(all) {
    const f = S.find
    const sh = cur()
    const q = f && f.input.value
    if (!editable || !q || !sh || !f.hits.length) return
    const src = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(src, 'gi')
    const rep = f.rin.value
    const changes = []
    for (const k of all ? f.hits : [f.hits[f.idx]]) {
      const r = Math.floor(k / KEY)
      const c = k % KEY
      const old = cellVal(sh, r, c) ?? null
      const text = fmtFull(old)
      if (!text || !new RegExp(src, 'i').test(text)) continue
      changes.push({ si: S.active, r, c, old, nw: parseTyped(text.replace(re, () => rep)) })
    }
    commitChanges(changes)
    const n = changes.length
    runSearch().then(() => { if (all && S.find) S.find.count.textContent = 'Replaced ' + n })
  }
  function paintCount() {
    const f = S.find
    if (!f.input.value) f.count.textContent = ''
    else if (f.searching) f.count.textContent = 'Searching…'
    else if (!f.hits.length) f.count.textContent = 'No results'
    else f.count.textContent = (f.idx + 1).toLocaleString() + ' of ' + f.hits.length.toLocaleString() + (f.capped ? '+' : '')
  }
  async function runSearch() {
    const f = S.find
    if (!f) return
    const token = ++f.token
    const sh = cur()
    const q = f.input.value.toLowerCase()
    f.hits = []
    f.set = null
    f.idx = 0
    f.capped = false
    f.pending = false
    if (!q || !sh || !sh.ready) { f.searching = false; paintCount(); render(); return }
    f.searching = true
    paintCount()
    const hits = []
    const rows = sh.rows
    const startSel = sh.sel ? sh.sel.r * KEY + sh.sel.c : 0
    let slice = 0
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r]
      for (let c = 0; c < row.length; c++) {
        const v = row[c]
        if (v == null) continue
        if (fmt(v).toLowerCase().includes(q)) {
          hits.push(r * KEY + c)
          if (hits.length >= MAX_HITS) { f.capped = true; break }
        }
      }
      if (f.capped) break
      if (++slice >= 4000) {
        slice = 0
        await new Promise((res) => setTimeout(res, 0))
        if (f.token !== token || S.dead) return
      }
    }
    if (f.token !== token) return
    f.hits = hits
    f.set = new Set(hits)
    f.searching = false
    let i = hits.findIndex((k) => k >= startSel)
    if (i < 0) i = 0
    f.idx = i
    paintCount()
    if (hits.length) jump()
    else render()
  }
  function jump() {
    const f = S.find
    const k = f.hits[f.idx]
    const r = Math.floor(k / KEY)
    const c = k % KEY
    const sh = cur()
    sh.sel = { r, c }
    sh.anc = { r, c }
    ensureVisible(r, c)
    setValueLine()
    paintCount()
    render()
  }
  function step(dir) {
    const f = S.find
    if (!f || !f.hits.length) return
    f.idx = (f.idx + dir + f.hits.length) % f.hits.length
    jump()
  }

  // Ctrl+F and Ctrl+H belong to this viewer only while it is on screen.
  const active = () => !S.dead && root.isConnected && !host.hidden && host.offsetParent !== null
  const cmds = app && app.commands && app.commands.items
  let hooked = false
  if (cmds && typeof cmds.get === 'function') {
    for (const id of ['find.open', 'find.replace']) {
      const c = cmds.get(id)
      if (!c) continue
      const prev = c.run
      const mine = function () {
        if (active()) return openFind(id === 'find.replace')
        if (!root.isConnected && c.run === mine) c.run = prev
        return prev.apply(this, arguments)
      }
      c.run = mine
      hooked = true
      cleanups.push(() => { if (c.run === mine) c.run = prev })
    }
  }
  if (!hooked) {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f' && active()) {
        e.preventDefault()
        e.stopPropagation()
        openFind()
      }
    }
    window.addEventListener('keydown', onKey, true)
    cleanups.push(() => window.removeEventListener('keydown', onKey, true))
  }

  /* ---------- Ctrl+G: go to a cell (B12, B2:D5, Sheet2!A1, 'My sheet'!C3) ---------- */
  let go = null
  function buildGoto() {
    const bar = el('div', 'find-bar xv-find xv-goto')
    bar.setAttribute('role', 'search')
    bar.setAttribute('aria-label', 'Go to cell')
    bar.hidden = true
    const row = el('div', 'find-row')
    const input = el('input', 'find-input')
    input.type = 'text'
    input.placeholder = 'Go to cell, for example B12 or Sheet2!A1'
    input.setAttribute('aria-label', 'Go to cell')
    input.spellcheck = false
    const note = el('span', 'find-count', '')
    note.setAttribute('aria-live', 'polite')
    const close = el('button', 'find-btn')
    close.type = 'button'
    close.innerHTML = ICON.close
    close.title = 'Close (Escape)'
    close.setAttribute('aria-label', 'Close go to cell')
    close.addEventListener('click', () => closeGoto(true))
    row.append(input, note, el('span', 'find-sep'), close)
    bar.appendChild(row)
    root.appendChild(bar)
    input.addEventListener('input', () => { input.classList.remove('invalid'); note.textContent = '' })
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        if (gotoCell(input.value)) closeGoto(true)
        else { input.classList.add('invalid'); note.textContent = 'Not a cell' }
      } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeGoto(true) }
    })
    go = { bar, input, note }
  }
  function openGoto() {
    if (S.dead || scroll.hidden) return
    if (!go) buildGoto()
    if (S.find && S.find.open) closeFind(false)
    go.bar.hidden = false
    go.input.classList.remove('invalid')
    go.note.textContent = ''
    go.input.focus()
    go.input.select()
  }
  function closeGoto(refocus) {
    if (!go || go.bar.hidden) return
    go.bar.hidden = true
    if (refocus && !scroll.hidden) scroll.focus()
  }
  function gotoCell(text) {
    let t = String(text).trim()
    let si = S.active
    const bang = t.lastIndexOf('!')
    if (bang >= 0) {
      const name = t.slice(0, bang).replace(/^'(.*)'$/, '$1').replace(/''/g, "'").toLowerCase()
      si = S.sheets.findIndex((x) => x.name.toLowerCase() === name)
      if (si < 0) return false
      t = t.slice(bang + 1).trim()
    }
    const m = /^\$?([A-Za-z]{1,3})\$?(\d+)(?::\$?([A-Za-z]{1,3})\$?(\d+))?$/.exec(t)
    if (!m) return false
    const col = (L) => L.toUpperCase().split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1
    const c0 = col(m[1])
    const r0 = Number(m[2]) - 1
    const c1 = m[3] ? col(m[3]) : c0
    const r1 = m[4] ? Number(m[4]) - 1 : r0
    const target = S.sheets[si]
    if (!target || !target.ready || r0 < 0 || c0 < 0 || r0 >= target.rows.length || c0 >= target.cols) return false
    if (si !== S.active) activate(si)
    const sh = cur()
    sh.anc = { r: r0, c: c0 }
    sh.sel = m[3] ? { r: Math.min(sh.rows.length - 1, Math.max(r0, r1)), c: Math.min(sh.cols - 1, Math.max(c0, c1)) } : { r: r0, c: c0 }
    ensureVisible(sh.sel.r, sh.sel.c)
    setValueLine()
    render()
    return true
  }

  // F1 and Ctrl+/ open the shortcut list; Ctrl+G goes to a cell. They work from anywhere in the viewer except a text field.
  cleanups.push(wrapCommand(app, 'view.source', active, () => panel.toggle()))
  cleanups.push(wrapCommand(app, 'help.shortcuts', active, () => panel.toggle())) // F1; the app's help command otherwise
  cleanups.push(wrapCommand(app, 'text.gotoLine', active, () => openGoto())) // Ctrl+G is the app's Go to line otherwise
  const onDocKey = (e) => {
    if (!active() || e.defaultPrevented) return
    if (e.key === 'Escape' && panel.isOpen()) { e.preventDefault(); e.stopPropagation(); panel.close(); return }
    if (isTextField(e.target)) return
    if (e.key === 'F1') { e.preventDefault(); panel.toggle(); return }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === 'g' || e.key === 'G')) { e.preventDefault(); openGoto(); return }
    // nothing has focus (the page body): the grid takes the keys, as in a spreadsheet
    if ((e.target === document.body || e.target === document.documentElement) && !scroll.hidden) {
      switchSheetKey(e)
      if (e.defaultPrevented) return
      scroll.focus({ preventScroll: true })
      onGridKey(e)
    }
  }
  document.addEventListener('keydown', onDocKey)
  cleanups.push(() => document.removeEventListener('keydown', onDocKey))

  /* ---------- cleanup on tab switch / close ---------- */
  function cleanup() {
    if (S.dead) return
    if (ed) finishEdit(true)
    S.dead = true
    if (raf) cancelAnimationFrame(raf)
    if (S.find) { S.find.token++; clearTimeout(S.find.timer) }
    if (worker) { worker.terminate(); worker = null }
    for (const fn of cleanups) { try { fn() } catch {} }
    mo.disconnect()
    S.sheets = []
    S.find = null
    root.remove()
  }
  const mo = new MutationObserver(() => {
    if (!root.isConnected || host.hidden) cleanup()
  })
  mo.observe(host, { childList: true, attributes: true, attributeFilter: ['hidden'] })
}

// Build the saved workbook: the original zip with only the edited cells patched (done in a worker). Returns a Uint8Array.
export async function saveXlsx(d) {
  const xl = d.xl
  if (!xl || !xl.edits.size) return d.bytes
  const edits = [...xl.edits.values()].map((e) => ({ si: e.si, r: e.r, c: e.c, v: e.v }))
  const buf = d.bytes.slice().buffer
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./xlsxworker.js', import.meta.url), { type: 'module' })
    w.onmessage = (e) => {
      w.terminate()
      if (e.data.t === 'saved') resolve(e.data.bytes)
      else reject(new Error(e.data.msg || 'Could not build the workbook'))
    }
    w.onerror = (e) => { w.terminate(); reject(new Error((e && e.message) || 'Save worker failed')) }
    w.postMessage({ t: 'save', buf, edits }, [buf])
  })
}
// After a successful write: the saved bytes become the baseline and the edit list is empty again.
export function commitXlsx(d, bytes) {
  d.bytes = bytes
  if (d.xl) d.xl.edits.clear()
}
