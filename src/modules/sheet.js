// sheet.js: virtualised spreadsheet UI for CSV/TSV. Logic lives in sheet-core.js.
// Contract: mount(host, { name, text, delimiter, path? }, ctx) -> { serialize(), destroy() }
//   ctx.setText(text)  called (debounced) after content really changed
//   ctx.toast(msg)
// All cell text goes through textContent. Colours come from CSS variables (see modules.css "sheet").
import {
  Sheet, colToLetters, parseRange, addr, displayValue, isErr, computeStats,
  detectHeader, formatDisplay, parseCsv, serializeCsv, shiftFormula,
} from './sheet-core.js'

const ROW_H = 24
const HEAD_H = 24
const DEF_W = 110
const MIN_W = 36
const MAX_FIT = 480
const BUF_R = 12
const BUF_C = 3
const MAXR = 1048576
const MAXC = 16384
const LARGE_CELLS = 1000000
const MAX_DISTINCT = 500
const DELIM_NAMES = { ',': 'Comma', ';': 'Semicolon', '\t': 'Tab', '|': 'Pipe' }

const FORMATS = [
  ['General', null],
  ['Number (0 decimals)', { type: 'number', decimals: 0 }],
  ['Number (2 decimals)', { type: 'number', decimals: 2 }],
  ['Currency $', { type: 'currency', symbol: '$', decimals: 2 }],
  ['Currency £', { type: 'currency', symbol: '£', decimals: 2 }],
  ['Currency €', { type: 'currency', symbol: '€', decimals: 2 }],
  ['Percent (0 decimals)', { type: 'percent', decimals: 0 }],
  ['Percent (2 decimals)', { type: 'percent', decimals: 2 }],
  ['Date (YYYY-MM-DD)', { type: 'date' }],
]

// Small static icons: lists of SVG path strings (never built from cell data).
const ICON = {
  undo: ['M9 14 4 9l5-5', 'M4 9h10a6 6 0 0 1 0 12h-3'],
  redo: ['m15 14 5-5-5-5', 'M20 9H10a6 6 0 0 0 0 12h3'],
  filter: ['M3 5h18l-7 8v6l-4 2v-8z'],
  sortAsc: ['M11 5h10M11 11h7M11 17h4', 'm3 8 3-3 3 3M6 5v14'],
  sortDesc: ['M11 5h4M11 11h7M11 17h10', 'm3 16 3 3 3-3M6 5v14'],
  fit: ['M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4'],
}
function icon(name) {
  const ns = 'http://www.w3.org/2000/svg'
  const s = document.createElementNS(ns, 'svg')
  s.setAttribute('viewBox', '0 0 24 24')
  s.setAttribute('class', 'sh-ico')
  s.setAttribute('aria-hidden', 'true')
  for (const d of ICON[name]) {
    const pa = document.createElementNS(ns, 'path')
    pa.setAttribute('d', d)
    s.append(pa)
  }
  return s
}

function h(tag, cls, text) {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text != null) e.textContent = text
  return e
}
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)
const num = (n) => Number(n.toPrecision(10)).toLocaleString(undefined, { maximumFractionDigits: 6 })
let uidCounter = 0

export async function mount(host, opts, ctx) {
  const { name = 'untitled', path } = opts || {}
  const origText = String((opts && opts.text) == null ? '' : opts.text)
  const sheet = Sheet.fromText(origText, opts && opts.delimiter)
  const uid = 'sh' + ++uidCounter
  const toast = (m) => ctx && ctx.toast && ctx.toast(m)
  const total0 = sheet.rowCount * sheet.ncols
  const large = total0 > LARGE_CELLS

  // ---------------------------------------------------------------- state
  let header = detectHeader(sheet.rows)
  let freeze = true
  let widths = []
  let formats = [] // per column display format (session only)
  const filters = new Map() // col -> { text, hide:Set }
  let list = null // display order of data rows when filtered (includes header row 0 when header is on); null = identity
  const sel = { ar: 0, ac: 0, r: 0, c: 0, kind: 'cell' } // anchor + active, kind: cell|row|col|all
  let editing = null // { input, r, c, typed, done }
  let clip = null // last internal copy { text, rows, r0, c0 }
  let colX = [0]
  let totalW = 0
  let gutterW = 44
  let bodyW = 0
  let bodyH = 0
  let padR = 100 // extra virtual rows
  let padC = 26 // extra virtual columns
  let win = null // rendered window { c0, c1, r0, r1 }
  let ox = 0
  let oy = 0
  let cellRefs = []
  let headRefs = []
  let rowRefs = []
  let dragging = null
  let menuEl = null
  let saveTimer = null
  let statTimer = null
  let lastSent = origText
  let destroyed = false
  const offs = []
  const on = (t, ev, fn, o) => {
    t.addEventListener(ev, fn, o)
    offs.push(() => t.removeEventListener(ev, fn, o))
  }

  const widthKey = 'plume.sheet.widths.' + (path || name)
  function loadWidths() {
    try {
      const a = JSON.parse(localStorage.getItem(widthKey) || 'null')
      if (Array.isArray(a) && a.every((n) => typeof n === 'number' && n >= MIN_W)) return a
    } catch {}
    return null
  }
  function saveWidths() {
    try {
      localStorage.setItem(widthKey, JSON.stringify(widths.slice(0, sheet.ncols)))
    } catch {}
  }

  // ---------------------------------------------------------------- DOM
  host.textContent = ''
  const root = h('div', 'sh-root')
  const toolbar = h('div', 'sh-toolbar')
  toolbar.setAttribute('role', 'toolbar')
  toolbar.setAttribute('aria-label', 'Spreadsheet tools')
  const fbar = h('div', 'sh-fbar')
  const nameBox = h('input', 'sh-name')
  nameBox.setAttribute('aria-label', 'Active cell address')
  nameBox.spellcheck = false
  const fx = h('span', 'sh-fx', 'fx')
  const fInput = h('input', 'sh-finput')
  fInput.setAttribute('aria-label', 'Cell content')
  fInput.spellcheck = false
  fbar.append(nameBox, fx, fInput)

  const grid = h('div', 'sh-grid')
  grid.tabIndex = 0
  grid.setAttribute('role', 'grid')
  grid.setAttribute('aria-label', 'Spreadsheet ' + name)
  const inner = h('div', 'sh-inner')
  const vp = h('div', 'sh-vp')
  const corner = h('div', 'sh-corner')
  corner.title = 'Select all'
  const box = (cls) => {
    const b = h('div', 'sh-box ' + cls)
    const layer = h('div', 'sh-layer')
    const content = h('div', 'sh-content')
    layer.append(content)
    b.append(layer)
    return { b, layer, content }
  }
  const headB = box('sh-headbox')
  const frozB = box('sh-frozbox')
  const rowB = box('sh-rowbox')
  const bodyB = box('sh-bodybox')
  vp.append(bodyB.b, frozB.b, headB.b, rowB.b, corner)
  inner.append(vp)
  grid.append(inner)

  const status = h('div', 'sh-status')
  const stDims = h('span', 'sh-st-dims')
  const stDelim = h('span', 'sh-st-delim')
  const stFilter = h('span', 'sh-st-filter')
  const stClear = h('button', 'sh-link', 'Clear filter')
  stClear.type = 'button'
  stFilter.append(h('span', null, ''), stClear)
  const stNote = h('span', 'sh-st-note')
  const stStats = h('span', 'sh-st-stats')
  stStats.setAttribute('aria-live', 'polite')
  status.append(stDims, stDelim, stFilter, stNote, h('span', 'sh-spacer'), stStats)
  root.append(toolbar, fbar, grid, status)
  host.append(root)

  // ---------------------------------------------------------------- toolbar
  // One compact row; items that do not fit move into the "..." menu (see fitToolbar).
  const tb = {}
  const tbItems = []
  function addBtn(key, label, title, fn, ico, menuLabel) {
    const b = h('button', 'sh-btn')
    b.type = 'button'
    b.title = title
    b.setAttribute('aria-label', title)
    if (ico) b.append(icon(ico))
    if (label) b.append(h('span', null, label))
    b.addEventListener('click', () => {
      closeMenu()
      fn()
      if (!editing) grid.focus({ preventScroll: true })
    })
    toolbar.append(b)
    tb[key] = b
    tbItems.push({ el: b, label: menuLabel || title, run: fn })
    return b
  }
  const sep = () => {
    const e = h('span', 'sh-sep')
    toolbar.append(e)
    tbItems.push({ el: e, sep: true })
  }
  addBtn('undo', null, 'Undo (Ctrl+Z)', () => doUndo(), 'undo', 'Undo')
  addBtn('redo', null, 'Redo (Ctrl+Y)', () => doRedo(), 'redo', 'Redo')
  sep()
  addBtn('addRow', '+ Row', 'Add a row at the end', () => opAddRow(), null, 'Add row')
  addBtn('addCol', '+ Col', 'Add a column at the end', () => opAddCol(), null, 'Add column')
  addBtn('delRow', '- Row', 'Delete selected rows (Ctrl+-)', () => opDeleteRows(), null, 'Delete row')
  addBtn('delCol', '- Col', 'Delete selected columns (Ctrl+Alt+-)', () => opDeleteCols(), null, 'Delete column')
  sep()
  addBtn('asc', null, 'Sort the active column A-Z', () => opSort(sel.c, 'asc'), 'sortAsc', 'Sort A-Z')
  addBtn('desc', null, 'Sort the active column Z-A', () => opSort(sel.c, 'desc'), 'sortDesc', 'Sort Z-A')
  addBtn('filter', null, 'Filter the active column (view only, data is untouched)', () => openColumnPanel(sel.c, tb.filter), 'filter', 'Filter column...')
  sep()
  addBtn('header', 'Header', 'Treat the first row as a header', () => setHeader(!header), null, 'Toggle header row')
  addBtn('freeze', 'Freeze', 'Keep the header row visible while scrolling', () => setFreeze(!freeze), null, 'Toggle freeze header')
  addBtn('fit', null, 'Autofit column widths', () => autofitAll(), 'fit', 'Autofit columns')
  sep()
  const delimSel = h('select', 'sh-select')
  delimSel.title = 'Delimiter used when saving (converts the file)'
  delimSel.setAttribute('aria-label', 'Delimiter')
  for (const d of Object.keys(DELIM_NAMES)) {
    const o = h('option', null, DELIM_NAMES[d])
    o.value = d
    delimSel.append(o)
  }
  const setDelim = (d) => {
    sheet.setDelimiter(d)
    toast('Saving as ' + DELIM_NAMES[d].toLowerCase() + '-separated')
    afterChange()
    grid.focus({ preventScroll: true })
  }
  delimSel.addEventListener('change', () => setDelim(delimSel.value))
  toolbar.append(delimSel)
  tbItems.push({ el: delimSel, select: true })
  const moreBtn = h('button', 'sh-btn sh-more', '\u2026')
  moreBtn.type = 'button'
  moreBtn.title = 'More tools'
  moreBtn.setAttribute('aria-label', 'More tools')
  moreBtn.setAttribute('aria-haspopup', 'menu')
  moreBtn.hidden = true
  toolbar.append(moreBtn)
  let overflowed = []
  function fitToolbar() {
    if (destroyed) return
    for (const it of tbItems) it.el.hidden = false
    moreBtn.hidden = true
    overflowed = []
    if (toolbar.scrollWidth <= toolbar.clientWidth + 1) return
    moreBtn.hidden = false
    for (let i = tbItems.length - 1; i >= 0 && toolbar.scrollWidth > toolbar.clientWidth + 1; i--) {
      tbItems[i].el.hidden = true
      overflowed.unshift(tbItems[i])
    }
    overflowed = overflowed.filter((it) => !it.sep)
  }
  moreBtn.addEventListener('click', () => {
    const items = []
    for (const it of overflowed) {
      if (it.select) for (const d of Object.keys(DELIM_NAMES)) items.push({ label: 'Delimiter: ' + DELIM_NAMES[d], disabled: sheet.delimiter === d, run: () => setDelim(d) })
      else items.push({ label: it.label, disabled: it.el.disabled, run: it.run })
    }
    const b = moreBtn.getBoundingClientRect()
    openMenu(b.left, b.bottom + 2, items)
  })

  // ---------------------------------------------------------------- view mapping
  const topN = () => (header && freeze ? 1 : 0)
  // Virtual extents: empty rows/columns past the data, so the grid fills the pane (like Excel).
  const realDisp = () => (list ? list.length : sheet.rowCount)
  const vRows = () => Math.min(MAXR, sheet.rowCount + padR)
  const vCols = () => Math.min(MAXC, sheet.ncols + padC)
  const dispCount = () => realDisp() + Math.max(0, vRows() - sheet.rowCount)
  const toData = (d) => {
    const rd = realDisp()
    return d < rd ? (list ? list[d] : d) : sheet.rowCount + (d - rd)
  }
  function toDisp(r) {
    if (r >= sheet.rowCount) {
      const d = realDisp() + r - sheet.rowCount
      return d < dispCount() ? d : -1
    }
    if (!list) return r >= 0 ? r : -1
    let lo = 0
    let hi = list.length - 1
    while (lo <= hi) {
      const m = (lo + hi) >> 1
      if (list[m] === r) return m
      if (list[m] < r) lo = m + 1
      else hi = m - 1
    }
    return -1
  }
  // nearest displayed index for a data row that may be hidden
  function toDispNear(r) {
    const d = toDisp(r)
    if (d >= 0) return d
    if (!list) return clamp(r, 0, dispCount() - 1)
    let i = 0
    while (i < list.length && list[i] < r) i++
    return clamp(i, 0, list.length - 1)
  }
  const plain = (r, c) => (sheet.isFormula(r, c) ? sheet.display(r, c) : sheet.raw(r, c))

  function passes(r) {
    for (const [c, f] of filters) {
      const s = plain(r, c)
      if (f.text && !s.toLowerCase().includes(f.text.toLowerCase())) return false
      if (f.hide.size && f.hide.has(s)) return false
    }
    return true
  }
  function rebuildView() {
    if (!filters.size) {
      list = null
      return
    }
    const out = []
    const start = header ? 1 : 0
    if (header) out.push(0)
    for (let r = start; r < sheet.rowCount; r++) if (passes(r)) out.push(r)
    list = out
  }
  function visibleRows(r0, r1) {
    const out = []
    if (!list) {
      for (let r = r0; r <= r1 && r < sheet.rowCount; r++) out.push(r)
      return out
    }
    for (const r of list) {
      if (r > r1) break
      if (r >= r0) out.push(r)
    }
    return out
  }

  // ---------------------------------------------------------------- columns
  function ensureWidths() {
    const n = vCols()
    while (widths.length < n) widths.push(DEF_W)
    while (formats.length < n) formats.push(null)
  }
  function recalcCols() {
    ensureWidths()
    const n = vCols()
    colX = new Array(n + 1)
    colX[0] = 0
    for (let c = 0; c < n; c++) colX[c + 1] = colX[c] + widths[c]
    totalW = colX[n]
  }
  function colAt(x) {
    const n = vCols()
    if (x <= 0) return 0
    if (x >= totalW) return n - 1
    let lo = 0
    let hi = n - 1
    while (lo < hi) {
      const m = (lo + hi + 1) >> 1
      if (colX[m] <= x) lo = m
      else hi = m - 1
    }
    return lo
  }
  let mctx = null
  function measure(str) {
    if (!mctx) {
      mctx = document.createElement('canvas').getContext('2d')
      const cs = getComputedStyle(grid)
      mctx.font = cs.font || `${cs.fontSize} ${cs.fontFamily}`
    }
    return mctx.measureText(str).width
  }
  function fitWidth(c) {
    let max = measure(colToLetters(c)) + 12
    const n = Math.min(sheet.rowCount, 1500)
    for (let r = 0; r < n; r++) {
      const s = cellText(r, c)
      if (s) {
        const w = measure(s.length > 80 ? s.slice(0, 80) : s)
        if (w > max) max = w
      }
    }
    return clamp(Math.ceil(max) + 22, MIN_W, MAX_FIT)
  }
  function autofitCols(cols) {
    if (large) {
      toast('Large file: autofit is off')
      return
    }
    for (const c of cols) widths[c] = fitWidth(c)
    saveWidths()
    layout()
    render(true)
  }
  const autofitAll = () => autofitCols([...Array(sheet.ncols).keys()])

  // ---------------------------------------------------------------- cell text
  function cellText(r, c) {
    const fmt = formats[c]
    if (!sheet.isFormula(r, c) && !fmt) return sheet.raw(r, c)
    return fmt ? formatDisplay(sheet.value(r, c), fmt) : sheet.display(r, c)
  }

  // ---------------------------------------------------------------- layout & render
  function layout() {
    padC = Math.max(padC, 26, Math.ceil(grid.clientWidth / 60) + 6)
    padR = Math.min(Math.max(padR, 100, Math.ceil(grid.clientHeight / ROW_H) + 20), Math.max(0, MAXR - sheet.rowCount))
    recalcCols()
    gutterW = Math.max(44, String(sheet.rowCount).length * 9 + 18)
    const tn = topN()
    const innerH = HEAD_H + tn * ROW_H + Math.max(0, dispCount() - tn) * ROW_H
    inner.style.width = gutterW + totalW + 'px'
    inner.style.height = innerH + 'px'
    const gw = grid.clientWidth
    const gh = grid.clientHeight
    vp.style.width = gw + 'px'
    vp.style.height = gh + 'px'
    bodyW = Math.max(0, gw - gutterW)
    bodyH = Math.max(0, gh - HEAD_H - tn * ROW_H)
    inner.style.width = Math.max(gutterW + totalW, gw) + 'px'
    inner.style.height = Math.max(innerH, gh) + 'px'
    const place = (b, l, t, w, hh) => {
      b.style.left = l + 'px'
      b.style.top = t + 'px'
      b.style.width = w + 'px'
      b.style.height = hh + 'px'
    }
    corner.style.width = gutterW + 'px'
    corner.style.height = HEAD_H + 'px'
    place(headB.b, gutterW, 0, bodyW, HEAD_H)
    place(frozB.b, gutterW, HEAD_H, bodyW, tn * ROW_H)
    frozB.b.style.display = tn ? '' : 'none'
    place(rowB.b, 0, HEAD_H + tn * ROW_H, gutterW, bodyH)
    place(bodyB.b, gutterW, HEAD_H + tn * ROW_H, bodyW, bodyH)
    grid.setAttribute('aria-rowcount', String(sheet.rowCount + 1))
    grid.setAttribute('aria-colcount', String(sheet.ncols))
  }

  function applyTransforms() {
    const sx = grid.scrollLeft
    const sy = grid.scrollTop
    const tx = `translate(${ox - sx}px,0)`
    headB.layer.style.transform = tx
    frozB.layer.style.transform = tx
    bodyB.layer.style.transform = `translate(${ox - sx}px,${oy - sy}px)`
    rowB.layer.style.transform = `translate(0,${oy - sy}px)`
  }

  function render(force) {
    if (destroyed) return
    const sx = grid.scrollLeft
    const sy = grid.scrollTop
    const tn = topN()
    const dc = dispCount()
    const vc0 = colAt(sx)
    const vc1 = colAt(sx + bodyW)
    const vr0 = tn + Math.floor(sy / ROW_H)
    const vr1 = Math.min(dc - 1, tn + Math.floor((sy + bodyH) / ROW_H))
    // grow the virtual extent when the user scrolls near its end
    let grew = false
    if (vr1 >= dc - 30 && vRows() < MAXR) {
      padR += 200
      grew = true
    }
    if (vc1 >= vCols() - 4 && vCols() < MAXC) {
      padC += 26
      grew = true
    }
    if (grew) {
      layout()
      return render(true)
    }
    if (!force && win && vc0 >= win.c0 && vc1 <= win.c1 && vr0 >= win.r0 && vr1 <= win.r1) {
      applyTransforms()
      return
    }
    win = {
      c0: Math.max(0, vc0 - BUF_C),
      c1: Math.min(vCols() - 1, vc1 + BUF_C),
      r0: Math.max(tn, vr0 - BUF_R),
      r1: Math.min(dc - 1, vr1 + BUF_R),
    }
    ox = colX[win.c0]
    oy = (win.r0 - tn) * ROW_H
    const R = selRect()
    cellRefs = []
    headRefs = []
    rowRefs = []
    const rowW = colX[win.c1 + 1] - ox

    // column letters
    const hf = document.createDocumentFragment()
    for (let c = win.c0; c <= win.c1; c++) {
      const e = h('div', 'sh-ch')
      e.setAttribute('role', 'columnheader')
      e.setAttribute('aria-colindex', String(c + 1))
      e.style.cssText = `left:${colX[c] - ox}px;width:${widths[c]}px`
      e.append(h('span', 'sh-ch-l', colToLetters(c)), h('span', 'sh-caret', '▾'))
      headRefs.push([e, c])
      hf.append(e)
    }
    headB.content.setAttribute('role', 'row')
    headB.content.replaceChildren(hf)

    const buildRow = (d, top, parent) => {
      const r = toData(d)
      const re = h('div', 'sh-row' + (header && r === 0 ? ' hdr' : ''))
      re.setAttribute('role', 'row')
      re.setAttribute('aria-rowindex', String(d + 2))
      re.style.cssText = `top:${top}px;width:${rowW}px`
      for (let c = win.c0; c <= win.c1; c++) {
        const e = document.createElement('div')
        const v = sheet.value(r, c)
        const fmt = formats[c]
        const fxc = sheet.isFormula(r, c)
        let t
        if (!fxc && !fmt) t = sheet.raw(r, c)
        else t = fmt ? formatDisplay(v, fmt) : displayValue(v)
        let base = 'sh-c'
        if (typeof v === 'number') base += ' num'
        if (isErr(v)) base += ' err'
        if (fxc) base += ' fx'
        e.style.cssText = `left:${colX[c] - ox}px;width:${widths[c]}px`
        e.textContent = t
        e.id = `${uid}-${r}-${c}`
        e.setAttribute('role', 'gridcell')
        e.setAttribute('aria-colindex', String(c + 1))
        if (isErr(v)) e.title = t
        else if (fxc) e.title = sheet.raw(r, c)
        cellRefs.push([e, r, c, base])
        re.append(e)
      }
      parent.append(re)
    }
    // frozen header row
    if (tn) {
      const ff = document.createDocumentFragment()
      buildRow(0, 0, ff)
      frozB.content.replaceChildren(ff)
    } else frozB.content.replaceChildren()
    // body rows + gutter
    const bf = document.createDocumentFragment()
    const gf = document.createDocumentFragment()
    for (let d = win.r0; d <= win.r1; d++) {
      const top = (d - tn) * ROW_H - oy
      buildRow(d, top, bf)
      const r = toData(d)
      const g = h('div', 'sh-rh', String(r + 1))
      g.setAttribute('role', 'rowheader')
      g.style.top = top + 'px'
      rowRefs.push([g, r])
      gf.append(g)
    }
    bodyB.content.replaceChildren(bf)
    rowB.content.replaceChildren(gf)
    if (tn) {
      const g = h('div', 'sh-rh', '1')
      g.style.cssText = 'position:absolute;left:0;top:0'
      // frozen header number lives in the corner strip below the letters
      frozGutter.replaceChildren(g)
      rowRefs.push([g, 0])
    } else frozGutter.replaceChildren()
    frozGutter.style.display = tn ? '' : 'none'
    frozGutter.style.width = gutterW + 'px'
    frozGutter.style.height = tn * ROW_H + 'px'
    applyTransforms()
    paintSel(R)
    placeEditor()
  }
  const frozGutter = h('div', 'sh-frozgut')
  vp.append(frozGutter)
  frozGutter.style.top = HEAD_H + 'px'

  // ---------------------------------------------------------------- selection
  function selRect() {
    let r0 = Math.min(sel.ar, sel.r)
    let r1 = Math.max(sel.ar, sel.r)
    let c0 = Math.min(sel.ac, sel.c)
    let c1 = Math.max(sel.ac, sel.c)
    if (sel.kind === 'col' || sel.kind === 'all') {
      r0 = 0
      r1 = sheet.rowCount - 1
    }
    if (sel.kind === 'row' || sel.kind === 'all') {
      c0 = 0
      c1 = sheet.ncols - 1
    }
    return { r0, r1, c0, c1 }
  }
  function paintSel(R = selRect()) {
    for (const [e, r, c, base] of cellRefs) {
      let cls = base
      if (r >= R.r0 && r <= R.r1 && c >= R.c0 && c <= R.c1) {
        cls += ' sel'
        if (r === R.r0) cls += ' st'
        if (r === R.r1) cls += ' sb'
        if (c === R.c0) cls += ' sl'
        if (c === R.c1) cls += ' sr'
      }
      const act = r === sel.r && c === sel.c
      if (act) cls += ' act'
      if (e.className !== cls) e.className = cls
      if (act) {
        e.setAttribute('aria-selected', 'true')
        grid.setAttribute('aria-activedescendant', e.id)
      } else if (e.hasAttribute('aria-selected')) e.removeAttribute('aria-selected')
    }
    for (const [e, c] of headRefs) {
      const on = c >= R.c0 && c <= R.c1
      e.className = 'sh-ch' + (on ? (sel.kind === 'col' || sel.kind === 'all' ? ' full' : ' on') : '') + (filters.has(c) ? ' filtered' : '')
    }
    for (const [e, r] of rowRefs) {
      const on = r >= R.r0 && r <= R.r1
      e.className = 'sh-rh' + (on ? (sel.kind === 'row' || sel.kind === 'all' ? ' full' : ' on') : '')
    }
    corner.classList.toggle('on', sel.kind === 'all')
  }
  function afterSel(doReveal = true) {
    if (doReveal) reveal(sel.r, sel.c)
    paintSel()
    refreshFormulaBar()
    scheduleStats()
    updateToolbar()
  }
  function select(r, c, extend) {
    r = clamp(r, 0, MAXR - 1)
    c = clamp(c, 0, MAXC - 1)
    if (!extend || sel.kind === 'all') {
      sel.ar = r
      sel.ac = c
    }
    sel.r = r
    sel.c = c
    sel.kind = 'cell'
    afterSel()
  }
  function selectCols(a, b) {
    sel.kind = 'col'
    sel.ac = a
    sel.c = b
    sel.ar = 0
    sel.r = toData(0)
    afterSel(false)
  }
  function selectRows(a, b) {
    sel.kind = 'row'
    sel.ar = a
    sel.r = b
    sel.ac = 0
    sel.c = 0
    afterSel(false)
  }
  function selectAll() {
    sel.kind = 'all'
    sel.ar = sel.r = 0
    sel.ac = sel.c = 0
    afterSel(false)
  }
  function clampSel() {
    sel.ar = clamp(sel.ar, 0, MAXR - 1)
    sel.r = clamp(sel.r, 0, MAXR - 1)
    sel.ac = clamp(sel.ac, 0, MAXC - 1)
    sel.c = clamp(sel.c, 0, MAXC - 1)
  }

  // Bring a cell into the scrolling body.
  function reveal(r, c) {
    const d = toDisp(r)
    if (d < 0) return
    const tn = topN()
    let sx = grid.scrollLeft
    let sy = grid.scrollTop
    const x = colX[c]
    const w = widths[c]
    if (x < sx) sx = x
    else if (x + w > sx + bodyW) sx = Math.min(x, x + w - bodyW)
    if (d >= tn) {
      const y = (d - tn) * ROW_H
      if (y < sy) sy = y
      else if (y + ROW_H > sy + bodyH) sy = y + ROW_H - bodyH
    }
    if (sx !== grid.scrollLeft) grid.scrollLeft = sx
    if (sy !== grid.scrollTop) grid.scrollTop = sy
    applyTransforms()
    render(false)
  }

  // Move the active cell by display rows / columns.
  function move(dr, dc, extend) {
    const d = clamp(toDispNear(sel.r) + dr, 0, dispCount() - 1)
    const c = clamp(sel.c + dc, 0, vCols() - 1)
    select(toData(d), c, extend)
  }
  function jump(dr, dc, extend) {
    let d = toDispNear(sel.r)
    const maxD = Math.max(realDisp() - 1, d)
    const maxC = Math.max(sheet.ncols - 1, sel.c)
    let c = sel.c
    const inb = (a, b) => a >= 0 && a <= maxD && b >= 0 && b <= maxC
    const empty = (a, b) => sheet.raw(toData(a), b) === ''
    if (!inb(d + dr, c + dc)) return
    let nd = d + dr
    let nc = c + dc
    if (!empty(d, c) && !empty(nd, nc)) {
      while (inb(nd + dr, nc + dc) && !empty(nd + dr, nc + dc)) {
        nd += dr
        nc += dc
      }
    } else {
      while (inb(nd, nc) && empty(nd, nc)) {
        nd += dr
        nc += dc
      }
      if (!inb(nd, nc)) {
        nd = clamp(nd, 0, maxD)
        nc = clamp(nc, 0, maxC)
      }
    }
    select(toData(nd), nc, extend)
  }

  // ---------------------------------------------------------------- formula bar
  function refreshFormulaBar() {
    if (document.activeElement !== nameBox) nameBox.value = addr(sel.r, sel.c)
    if (document.activeElement !== fInput && !editing) fInput.value = sheet.raw(sel.r, sel.c)
  }
  on(fInput, 'keydown', (e) => {
    e.stopPropagation()
    if (e.key === 'Enter') {
      e.preventDefault()
      if (sheet.setCell(sel.r, sel.c, fInput.value)) afterChange()
      grid.focus({ preventScroll: true })
      move(e.shiftKey ? -1 : 1, 0, false)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      fInput.value = sheet.raw(sel.r, sel.c)
      grid.focus({ preventScroll: true })
    }
  })
  on(nameBox, 'keydown', (e) => {
    e.stopPropagation()
    if (e.key === 'Enter') {
      e.preventDefault()
      const rg = parseRange(nameBox.value.trim())
      if (rg) {
        grid.focus({ preventScroll: true })
        sel.ar = Math.min(rg.r0, MAXR - 1)
        sel.ac = Math.min(rg.c0, MAXC - 1)
        sel.r = Math.min(rg.r1, MAXR - 1)
        sel.c = Math.min(rg.c1, MAXC - 1)
        sel.kind = 'cell'
        afterSel()
      } else toast('Not a valid cell address')
    } else if (e.key === 'Escape') {
      grid.focus({ preventScroll: true })
    }
  })
  on(nameBox, 'focus', () => nameBox.select())
  on(nameBox, 'blur', () => (nameBox.value = addr(sel.r, sel.c)))

  // ---------------------------------------------------------------- editing
  function startEdit(r, c, initial, typed) {
    if (editing) commitEdit(0, 0)
    reveal(r, c)
    const input = h('input', 'sh-edit')
    input.spellcheck = false
    input.value = initial == null ? sheet.raw(r, c) : initial
    input.setAttribute('aria-label', 'Editing ' + addr(r, c))
    editing = { input, r, c, typed: !!typed, done: false }
    placeEditor()
    input.focus({ preventScroll: true })
    if (initial == null) input.select()
    else input.setSelectionRange(input.value.length, input.value.length)
    fInput.value = input.value
    input.addEventListener('input', () => (fInput.value = input.value))
    input.addEventListener('keydown', onEditKey)
    input.addEventListener('blur', () => {
      if (editing && editing.input === input && !editing.done) commitEdit(0, 0, true)
    })
  }
  function placeEditor() {
    if (!editing) return
    const { input, r, c } = editing
    const d = toDisp(r)
    if (d < 0) return
    const tn = topN()
    const parent = d < tn ? frozB.layer : bodyB.layer
    if (input.parentNode !== parent) parent.append(input)
    const y = d < tn ? 0 : (d - tn) * ROW_H
    // layers sit at the render-window origin, so editor coordinates are relative to it
    input.style.cssText = `left:${colX[c] - ox}px;top:${d < tn ? 0 : (d - tn) * ROW_H - oy}px;width:${Math.max(widths[c], 90)}px;height:${ROW_H}px`
  }
  function endEdit() {
    if (!editing) return
    editing.done = true
    const inp = editing.input
    editing = null
    if (inp.parentNode) inp.remove()
  }
  function commitEdit(dr, dc, fromBlur) {
    if (!editing) return
    const { r, c, input } = editing
    const v = input.value
    endEdit()
    if (sheet.setCell(r, c, v)) afterChange()
    else refreshFormulaBar()
    if (!fromBlur) grid.focus({ preventScroll: true })
    if (dr || dc) move(dr, dc, false)
  }
  function cancelEdit() {
    endEdit()
    refreshFormulaBar()
    grid.focus({ preventScroll: true })
  }
  function onEditKey(e) {
    e.stopPropagation()
    const k = e.key
    if (k === 'Enter') {
      e.preventDefault()
      commitEdit(e.shiftKey ? -1 : 1, 0)
    } else if (k === 'Tab') {
      e.preventDefault()
      commitEdit(0, e.shiftKey ? -1 : 1)
    } else if (k === 'Escape') {
      e.preventDefault()
      cancelEdit()
    } else if (editing && editing.typed && (k === 'ArrowDown' || k === 'ArrowUp' || k === 'ArrowLeft' || k === 'ArrowRight')) {
      e.preventDefault()
      commitEdit(k === 'ArrowDown' ? 1 : k === 'ArrowUp' ? -1 : 0, k === 'ArrowRight' ? 1 : k === 'ArrowLeft' ? -1 : 0)
    }
  }

  // ---------------------------------------------------------------- change plumbing
  function afterChange() {
    clampSel()
    rebuildView()
    layout()
    render(true)
    refreshFormulaBar()
    updateStatus()
    scheduleStats()
    updateToolbar()
    scheduleSave()
  }
  function currentText() {
    return sheet.isPristine ? origText : sheet.serialize()
  }
  function flush() {
    clearTimeout(saveTimer)
    saveTimer = null
    if (destroyed) return
    const t = currentText()
    if (t !== lastSent) {
      lastSent = t
      ctx && ctx.setText && ctx.setText(t)
    }
  }
  function scheduleSave() {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(flush, large ? 500 : 150)
  }
  // Column structure edits also carry widths/formats so undo restores them.
  function tagUi(before) {
    const e = sheet.undoStack[sheet.undoStack.length - 1]
    if (e) e.ui = { before, after: { w: widths.slice(), f: formats.slice() } }
  }
  const snapUi = () => ({ w: widths.slice(), f: formats.slice() })
  function doUndo() {
    if (editing) cancelEdit()
    if (!sheet.undo()) return
    const e = sheet.redoStack[sheet.redoStack.length - 1]
    if (e && e.ui) {
      widths = e.ui.before.w.slice()
      formats = e.ui.before.f.slice()
    }
    delimSel.value = sheet.delimiter
    afterChange()
  }
  function doRedo() {
    if (editing) cancelEdit()
    if (!sheet.redo()) return
    const e = sheet.undoStack[sheet.undoStack.length - 1]
    if (e && e.ui) {
      widths = e.ui.after.w.slice()
      formats = e.ui.after.f.slice()
    }
    delimSel.value = sheet.delimiter
    afterChange()
  }

  // ---------------------------------------------------------------- operations
  const rowSpan = () => {
    const R = selRect()
    return sel.kind === 'col' || sel.kind === 'all' ? { ...R, r0: sel.r, r1: sel.r } : R
  }
  const colSpan = () => {
    const R = selRect()
    return sel.kind === 'row' || sel.kind === 'all' ? { ...R, c0: sel.c, c1: sel.c } : R
  }
  const hasHidden = (R) => list && visibleRows(R.r0, R.r1).length !== R.r1 - R.r0 + 1
  function opAddRow() {
    sheet.insertRows(sheet.rowCount, 1)
    afterChange()
    select(sheet.rowCount - 1, sel.c, false)
  }
  function opAddCol() {
    const before = snapUi()
    const at = sheet.ncols
    sheet.insertCols(at, 1)
    widths.splice(at, 0, DEF_W)
    formats.splice(at, 0, null)
    tagUi(before)
    afterChange()
    select(sel.r, sheet.ncols - 1, false)
  }
  function opInsertRows(after) {
    const R = rowSpan()
    const n = R.r1 - R.r0 + 1
    const at = after ? R.r1 + 1 : R.r0
    sheet.insertRows(at, n)
    afterChange()
    selectRows(at, at + n - 1)
  }
  function opDeleteRows() {
    const R = rowSpan()
    if (hasHidden(R)) return toast('Clear the filter first: the selection spans hidden rows')
    sheet.deleteRows(R.r0, R.r1 - R.r0 + 1)
    afterChange()
    select(Math.min(R.r0, sheet.rowCount - 1), sel.c, false)
  }
  function opInsertCols(after) {
    const R = colSpan()
    const n = R.c1 - R.c0 + 1
    const at = after ? R.c1 + 1 : R.c0
    const before = snapUi()
    sheet.insertCols(at, n)
    widths.splice(at, 0, ...new Array(n).fill(DEF_W))
    formats.splice(at, 0, ...new Array(n).fill(null))
    filters.clear()
    tagUi(before)
    afterChange()
    selectCols(at, at + n - 1)
  }
  function opDeleteCols() {
    const R = colSpan()
    const n = Math.min(R.c1 - R.c0 + 1, sheet.ncols)
    const before = snapUi()
    if (!sheet.deleteCols(R.c0, n)) return
    widths.splice(R.c0, n)
    formats.splice(R.c0, n)
    filters.clear()
    if (!widths.length) widths = [DEF_W]
    tagUi(before)
    afterChange()
    select(sel.r, Math.min(R.c0, sheet.ncols - 1), false)
  }
  function opClear() {
    const R = selRect()
    const ch = []
    for (const r of visibleRows(R.r0, R.r1)) for (let c = R.c0; c <= R.c1; c++) if (sheet.raw(r, c) !== '') ch.push([r, c, ''])
    if (ch.length && sheet.setCells(ch, 'Clear')) afterChange()
  }
  function opSort(col, dir) {
    if (sheet.sortBy(col, dir, header ? 1 : 0)) {
      afterChange()
      toast('Sorted by column ' + colToLetters(col) + (dir === 'asc' ? ' (A-Z)' : ' (Z-A)'))
    }
  }
  function opFill(down) {
    const R = selRect()
    if (hasHidden(R)) return toast('Clear the filter first: the selection spans hidden rows')
    if (down ? sheet.fillDown(R.r0, R.c0, R.r1, R.c1) : sheet.fillRight(R.r0, R.c0, R.r1, R.c1)) afterChange()
  }
  function setHeader(on) {
    header = on
    rebuildView()
    layout()
    render(true)
    updateToolbar()
    updateStatus()
  }
  function setFreeze(on) {
    freeze = on
    layout()
    render(true)
    updateToolbar()
  }
  function clearFilters() {
    filters.clear()
    afterChange()
  }

  // ---------------------------------------------------------------- clipboard
  function copyMatrix(cut) {
    const R = selRect()
    const rows = visibleRows(R.r0, R.r1)
    if (rows.length * (R.c1 - R.c0 + 1) > 2000000) {
      toast('Selection too large to copy')
      return null
    }
    const raw = rows.map((r) => {
      const o = []
      for (let c = R.c0; c <= R.c1; c++) o.push(sheet.raw(r, c))
      return o
    })
    const vals = rows.map((r) => {
      const o = []
      for (let c = R.c0; c <= R.c1; c++) o.push(sheet.isFormula(r, c) ? sheet.display(r, c) : sheet.raw(r, c))
      return o
    })
    const text = serializeCsv(vals, { delimiter: '\t', eol: '\r\n' })
    clip = { text, rows: raw, r0: rows[0], c0: R.c0 }
    if (cut) {
      const ch = []
      rows.forEach((r, i) => raw[i].forEach((v, j) => v !== '' && ch.push([r, R.c0 + j, ''])))
      if (ch.length && sheet.setCells(ch, 'Cut')) afterChange()
    }
    return text
  }
  function applyPaste(text) {
    if (!text) return
    const R = selRect()
    let matrix
    if (clip && clip.text === text) {
      const dr = R.r0 - clip.r0
      const dc = R.c0 - clip.c0
      matrix = clip.rows.map((row) => row.map((v) => shiftFormula(v, dr, dc)))
    } else matrix = parseCsv(text, '\t').rows
    if (!matrix.length) return
    const mw = Math.max(...matrix.map((r) => r.length))
    const ch = []
    // one value pasted over a bigger selection fills the selection
    if (matrix.length === 1 && matrix[0].length === 1 && (R.r1 > R.r0 || R.c1 > R.c0)) {
      for (const r of visibleRows(R.r0, R.r1)) for (let c = R.c0; c <= R.c1; c++) ch.push([r, c, matrix[0][0]])
    } else {
      let targets
      if (list && R.r0 < sheet.rowCount) {
        const start = toDisp(R.r0)
        targets = list.slice(Math.max(0, start), Math.max(0, start) + matrix.length)
        if (targets.length < matrix.length) toast('Paste truncated: not enough visible rows')
      } else targets = matrix.map((_, i) => R.r0 + i)
      matrix.forEach((row, i) => {
        if (targets[i] == null) return
        for (let j = 0; j < row.length; j++) ch.push([targets[i], R.c0 + j, row[j]])
      })
    }
    if (!ch.length) return
    const before = snapUi()
    if (sheet.setCells(ch, 'Paste')) {
      ensureWidths()
      tagUi(before)
      afterChange()
      const lastR = ch.reduce((m, x) => Math.max(m, x[0]), 0)
      sel.ar = R.r0
      sel.ac = R.c0
      sel.r = lastR
      sel.c = Math.min(sheet.ncols - 1, R.c0 + mw - 1)
      sel.kind = 'cell'
      afterSel(false)
    }
  }
  on(grid, 'copy', (e) => {
    if (e.target !== grid) return
    const t = copyMatrix(false)
    if (t != null) {
      e.clipboardData.setData('text/plain', t)
      e.preventDefault()
    }
  })
  on(grid, 'cut', (e) => {
    if (e.target !== grid) return
    const t = copyMatrix(true)
    if (t != null) {
      e.clipboardData.setData('text/plain', t)
      e.preventDefault()
    }
  })
  on(grid, 'paste', (e) => {
    if (e.target !== grid) return
    e.preventDefault()
    applyPaste(e.clipboardData.getData('text/plain'))
  })

  // ---------------------------------------------------------------- keyboard
  on(grid, 'keydown', (e) => {
    if (e.target !== grid || destroyed) return
    const k = e.key
    const ctrl = e.ctrlKey || e.metaKey
    const shift = e.shiftKey
    if (ctrl && !e.altKey) {
      const lk = k.toLowerCase()
      if (lk === 'a') selectAll()
      else if (lk === 'z') (shift ? doRedo : doUndo)()
      else if (lk === 'y') doRedo()
      else if (lk === 'd') opFill(true)
      else if (lk === 'r') opFill(false)
      else if (k === '+' || k === '=' || k === 'Add') (sel.kind === 'col' ? opInsertCols(false) : opInsertRows(false))
      else if (k === '-' || k === 'Subtract') (sel.kind === 'col' ? opDeleteCols() : opDeleteRows())
      else if (k === 'ArrowUp') jump(-1, 0, shift)
      else if (k === 'ArrowDown') jump(1, 0, shift)
      else if (k === 'ArrowLeft') jump(0, -1, shift)
      else if (k === 'ArrowRight') jump(0, 1, shift)
      else if (k === 'Home') select(toData(0), 0, shift)
      else if (k === 'End') select(toData(realDisp() - 1), sheet.ncols - 1, shift)
      else if (k === ' ') selectCols(sel.c, sel.c)
      else return // Ctrl+C/X/V use the native clipboard events; the rest belongs to the app
      e.preventDefault()
      return
    }
    if (e.altKey && ctrl) {
      if (k === '+' || k === '=') opInsertCols(false)
      else if (k === '-') opDeleteCols()
      else return
      e.preventDefault()
      return
    }
    switch (k) {
      case 'ArrowUp': move(-1, 0, shift); break
      case 'ArrowDown': move(1, 0, shift); break
      case 'ArrowLeft': move(0, -1, shift); break
      case 'ArrowRight': move(0, 1, shift); break
      case 'Tab': move(0, shift ? -1 : 1, false); break
      case 'Enter': move(shift ? -1 : 1, 0, false); break
      case 'Home': select(sel.r, 0, shift); break
      case 'End': select(sel.r, sheet.ncols - 1, shift); break
      case 'PageDown': move(Math.max(1, Math.floor(bodyH / ROW_H) - 1), 0, shift); break
      case 'PageUp': move(-Math.max(1, Math.floor(bodyH / ROW_H) - 1), 0, shift); break
      case 'F2': startEdit(sel.r, sel.c, null, false); break
      case 'Delete':
      case 'Backspace': opClear(); break
      case 'Escape': clip = null; closeMenu(); break
      case ' ':
        if (shift) selectRows(sel.r, sel.r)
        else startEdit(sel.r, sel.c, ' ', true)
        break
      default:
        if (k.length === 1 && !e.altKey) startEdit(sel.r, sel.c, k, true)
        else return
    }
    e.preventDefault()
  })

  // ---------------------------------------------------------------- mouse
  const gridRect = () => grid.getBoundingClientRect()
  // Classify a pointer position into header / gutter / cell / resize zones.
  function hit(ev) {
    const rc = gridRect()
    const px = ev.clientX - rc.left
    const py = ev.clientY - rc.top
    if (px >= grid.clientWidth || py >= grid.clientHeight || px < 0 || py < 0) return { zone: 'bar' }
    const sx = grid.scrollLeft
    const sy = grid.scrollTop
    const tn = topN()
    if (px < gutterW && py < HEAD_H) return { zone: 'corner' }
    if (py < HEAD_H) {
      const x = px - gutterW + sx
      const c = colAt(x)
      if (px < gutterW) return { zone: 'corner' }
      // resize handle: within 4px of a column's right edge
      for (const cc of [c - 1, c]) {
        if (cc >= 0 && cc < vCols() && Math.abs(x - colX[cc + 1]) <= 4 && px - gutterW >= 0) return { zone: 'resize', c: cc }
      }
      return { zone: 'colhead', c, caret: colX[c + 1] - x < 18 && widths[c] > 50 }
    }
    let d
    if (py < HEAD_H + tn * ROW_H) d = 0
    else d = tn + Math.floor((py - HEAD_H - tn * ROW_H + sy) / ROW_H)
    d = clamp(d, 0, dispCount() - 1)
    const r = toData(d)
    if (px < gutterW) return { zone: 'rowhead', r, d }
    return { zone: 'cell', r, c: colAt(px - gutterW + sx), d }
  }
  // same, but clamped for drags that leave the grid
  function hitDrag(ev) {
    const rc = gridRect()
    const px = clamp(ev.clientX - rc.left, gutterW, grid.clientWidth - 1)
    const py = clamp(ev.clientY - rc.top, HEAD_H, grid.clientHeight - 1)
    const tn = topN()
    const sy = grid.scrollTop
    const d = clamp(py < HEAD_H + tn * ROW_H ? 0 : tn + Math.floor((py - HEAD_H - tn * ROW_H + sy) / ROW_H), 0, dispCount() - 1)
    return { r: toData(d), c: colAt(px - gutterW + grid.scrollLeft), d }
  }

  let lastMouse = null
  let scrollTimer = null
  function dragTick() {
    if (!dragging || !lastMouse) return
    const rc = gridRect()
    const bx0 = rc.left + gutterW
    const by0 = rc.top + HEAD_H + topN() * ROW_H
    const dx = lastMouse.clientX < bx0 ? lastMouse.clientX - bx0 : lastMouse.clientX > rc.left + grid.clientWidth ? lastMouse.clientX - rc.left - grid.clientWidth : 0
    const dy = lastMouse.clientY < by0 ? lastMouse.clientY - by0 : lastMouse.clientY > rc.top + grid.clientHeight ? lastMouse.clientY - rc.top - grid.clientHeight : 0
    if (dragging.mode === 'resize') return
    if (dx || dy) {
      grid.scrollLeft += clamp(dx / 2, -60, 60)
      grid.scrollTop += clamp(dy / 2, -60, 60)
      applyTransforms()
      render(false)
    }
    dragMove(lastMouse)
  }
  function dragMove(ev) {
    if (!dragging) return
    if (dragging.mode === 'cells') {
      const p = hitDrag(ev)
      if (p.r !== sel.r || p.c !== sel.c) {
        sel.r = p.r
        sel.c = p.c
        sel.kind = 'cell'
        paintSel()
        refreshFormulaBar()
        scheduleStats()
      }
    } else if (dragging.mode === 'cols') {
      const c = colAt(clamp(ev.clientX - gridRect().left, gutterW, grid.clientWidth) - gutterW + grid.scrollLeft)
      sel.c = c
      paintSel()
      scheduleStats()
    } else if (dragging.mode === 'rows') {
      const p = hitDrag(ev)
      sel.r = p.r
      paintSel()
      scheduleStats()
    } else if (dragging.mode === 'resize') {
      const w = Math.max(MIN_W, dragging.w0 + ev.clientX - dragging.x0)
      if (w !== widths[dragging.c]) {
        widths[dragging.c] = w
        layout()
        render(true)
      }
    }
  }
  on(grid, 'mousedown', (e) => {
    if (e.button !== 0 && e.button !== 2) return
    closeMenu()
    const z = hit(e)
    if (z.zone === 'bar') return
    if (editing) commitEdit(0, 0, true)
    if (e.button === 2) return // contextmenu handler selects
    e.preventDefault()
    grid.focus({ preventScroll: true })
    lastMouse = e
    if (z.zone === 'corner') return selectAll()
    if (z.zone === 'resize') {
      dragging = { mode: 'resize', c: z.c, x0: e.clientX, w0: widths[z.c] }
    } else if (z.zone === 'colhead') {
      if (z.caret) return openColumnPanel(z.c, null, e)
      if (e.shiftKey && sel.kind === 'col') sel.c = z.c
      else {
        sel.ac = z.c
        sel.c = z.c
      }
      selectCols(sel.ac, sel.c)
      dragging = { mode: 'cols' }
    } else if (z.zone === 'rowhead') {
      if (e.shiftKey && sel.kind === 'row') selectRows(sel.ar, z.r)
      else selectRows(z.r, z.r)
      dragging = { mode: 'rows' }
    } else {
      select(z.r, z.c, e.shiftKey)
      dragging = { mode: 'cells' }
    }
    clearInterval(scrollTimer)
    scrollTimer = setInterval(dragTick, 40)
  })
  on(document, 'mousemove', (e) => {
    if (dragging) {
      lastMouse = e
      dragMove(e)
    }
  })
  on(document, 'mouseup', () => {
    if (!dragging) return
    if (dragging.mode === 'resize') saveWidths()
    dragging = null
    clearInterval(scrollTimer)
    scrollTimer = null
    scheduleStats()
  })
  on(grid, 'mousemove', (e) => {
    if (dragging) return
    const z = hit(e)
    grid.style.cursor = z.zone === 'resize' ? 'col-resize' : ''
  })
  on(grid, 'dblclick', (e) => {
    const z = hit(e)
    if (z.zone === 'resize') autofitCols([z.c])
    else if (z.zone === 'cell') startEdit(z.r, z.c, null, false)
  })
  on(grid, 'contextmenu', (e) => {
    e.preventDefault()
    const z = hit(e)
    if (z.zone === 'bar') return
    grid.focus({ preventScroll: true })
    const R = selRect()
    if (z.zone === 'cell') {
      if (!(z.r >= R.r0 && z.r <= R.r1 && z.c >= R.c0 && z.c <= R.c1)) select(z.r, z.c, false)
      openMenu(e.clientX, e.clientY, cellMenu(z.c))
    } else if (z.zone === 'colhead' || z.zone === 'resize') {
      const c = z.c
      if (!(c >= R.c0 && c <= R.c1 && sel.kind === 'col')) selectCols(c, c)
      openColumnPanel(c, null, e)
    } else if (z.zone === 'rowhead') {
      if (!(z.r >= R.r0 && z.r <= R.r1 && sel.kind === 'row')) selectRows(z.r, z.r)
      openMenu(e.clientX, e.clientY, cellMenu(sel.c))
    }
  })
  let scrollRaf = 0
  on(grid, 'scroll', () => {
    applyTransforms()
    if (scrollRaf) return
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0
      render(false)
    })
  })

  // ---------------------------------------------------------------- menus
  function closeMenu() {
    if (menuEl) {
      menuEl.remove()
      menuEl = null
    }
  }
  function placeFloating(el, x, y) {
    root.append(el)
    const b = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    el.style.left = clamp(x, 4, Math.max(4, vw - b.width - 4)) + 'px'
    el.style.top = clamp(y, 4, Math.max(4, vh - b.height - 4)) + 'px'
  }
  function openMenu(x, y, items) {
    closeMenu()
    const m = h('div', 'sh-menu')
    m.setAttribute('role', 'menu')
    for (const it of items) {
      if (it === '-') {
        m.append(h('div', 'sh-msep'))
        continue
      }
      const b = h('button', 'sh-mi')
      b.type = 'button'
      b.setAttribute('role', 'menuitem')
      b.append(h('span', null, it.label))
      if (it.hint) b.append(h('span', 'sh-hint', it.hint))
      b.disabled = !!it.disabled
      b.addEventListener('click', () => {
        closeMenu()
        grid.focus({ preventScroll: true })
        it.run()
      })
      m.append(b)
    }
    m.addEventListener('keydown', (e) => {
      const bs = [...m.querySelectorAll('button:not(:disabled)')]
      const i = bs.indexOf(document.activeElement)
      if (e.key === 'ArrowDown') bs[(i + 1) % bs.length].focus()
      else if (e.key === 'ArrowUp') bs[(i - 1 + bs.length) % bs.length].focus()
      else if (e.key === 'Escape') {
        closeMenu()
        grid.focus({ preventScroll: true })
      } else return
      e.preventDefault()
      e.stopPropagation()
    })
    menuEl = m
    placeFloating(m, x, y)
    const first = m.querySelector('button:not(:disabled)')
    if (first) first.focus({ preventScroll: true })
  }
  function cellMenu(col) {
    const R = selRect()
    const nr = R.r1 - R.r0 + 1
    const nc = R.c1 - R.c0 + 1
    return [
      { label: 'Cut', hint: 'Ctrl+X', run: () => navigator.clipboard.writeText(copyMatrix(true) || '').catch(() => {}) },
      { label: 'Copy', hint: 'Ctrl+C', run: () => navigator.clipboard.writeText(copyMatrix(false) || '').catch(() => {}) },
      {
        label: 'Paste',
        hint: 'Ctrl+V',
        run: () =>
          navigator.clipboard
            .readText()
            .then(applyPaste)
            .catch(() => toast('Press Ctrl+V to paste')),
      },
      '-',
      { label: 'Insert row above', run: () => opInsertRows(false) },
      { label: 'Insert row below', run: () => opInsertRows(true) },
      { label: 'Insert column left', run: () => opInsertCols(false) },
      { label: 'Insert column right', run: () => opInsertCols(true) },
      '-',
      { label: nr > 1 ? `Delete ${nr} rows` : 'Delete row', run: () => opDeleteRows() },
      { label: nc > 1 ? `Delete ${nc} columns` : 'Delete column', run: () => opDeleteCols() },
      { label: 'Clear contents', hint: 'Del', run: () => opClear() },
      '-',
      { label: `Sort column ${colToLetters(col)} A-Z`, run: () => opSort(col, 'asc') },
      { label: `Sort column ${colToLetters(col)} Z-A`, run: () => opSort(col, 'desc') },
      { label: `Filter column ${colToLetters(col)}...`, run: () => openColumnPanel(col, null, lastMouse) },
    ]
  }

  // Column menu: sort, filter (text + distinct values), display format.
  function openColumnPanel(c, anchorEl, ev) {
    closeMenu()
    const p = h('div', 'sh-menu sh-pop')
    p.setAttribute('role', 'dialog')
    p.setAttribute('aria-label', 'Column ' + colToLetters(c))
    const title = header && sheet.raw(0, c) ? ` (${sheet.raw(0, c)})` : ''
    p.append(h('div', 'sh-pop-title', 'Column ' + colToLetters(c) + title))
    const row = h('div', 'sh-pop-row')
    const mk = (label, fn) => {
      const b = h('button', 'sh-btn', label)
      b.type = 'button'
      b.addEventListener('click', () => {
        closeMenu()
        fn()
        grid.focus({ preventScroll: true })
      })
      return b
    }
    row.append(mk('Sort A-Z', () => opSort(c, 'asc')), mk('Sort Z-A', () => opSort(c, 'desc')), mk('Autofit', () => autofitCols([c])))
    p.append(row)

    // filter
    const cur = filters.get(c) || { text: '', hide: new Set() }
    p.append(h('div', 'sh-pop-h', 'Filter (view only, data is not changed)'))
    const ti = h('input', 'sh-pop-input')
    ti.placeholder = 'Text contains...'
    ti.value = cur.text
    ti.spellcheck = false
    p.append(ti)
    const distinct = []
    const seen = new Set()
    let capped = false
    for (let r = header ? 1 : 0; r < sheet.rowCount; r++) {
      const s = plain(r, c)
      if (!seen.has(s)) {
        if (seen.size >= MAX_DISTINCT) {
          capped = true
          break
        }
        seen.add(s)
        distinct.push(s)
      }
    }
    distinct.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    const listEl = h('div', 'sh-pop-list')
    const checks = []
    for (const s of distinct) {
      const lab = h('label', 'sh-chk')
      const cb = document.createElement('input')
      cb.type = 'checkbox'
      cb.checked = !cur.hide.has(s)
      lab.append(cb, h('span', null, s === '' ? '(blank)' : s))
      listEl.append(lab)
      checks.push([cb, s])
    }
    p.append(listEl)
    if (capped) p.append(h('div', 'sh-pop-note', `Showing the first ${MAX_DISTINCT} distinct values.`))
    const all = h('div', 'sh-pop-row')
    all.append(
      mk('All', () => {}),
      mk('None', () => {}),
    )
    const [bAll, bNone] = all.children
    bAll.addEventListener('click', (e) => {
      e.stopImmediatePropagation()
      checks.forEach(([cb]) => (cb.checked = true))
    }, true)
    bNone.addEventListener('click', (e) => {
      e.stopImmediatePropagation()
      checks.forEach(([cb]) => (cb.checked = false))
    }, true)
    p.append(all)
    const act = h('div', 'sh-pop-row')
    const apply = mk('Apply filter', () => {
      const hide = new Set()
      checks.forEach(([cb, s]) => !cb.checked && hide.add(s))
      if (!ti.value && !hide.size) filters.delete(c)
      else filters.set(c, { text: ti.value, hide })
      afterChange()
    })
    apply.classList.add('primary')
    act.append(apply, mk('Clear filter', () => {
      filters.delete(c)
      afterChange()
    }))
    p.append(act)

    // display format
    p.append(h('div', 'sh-pop-h', 'Display format (this session only; CSV cannot store formats)'))
    const fs = h('select', 'sh-select')
    fs.setAttribute('aria-label', 'Display format')
    FORMATS.forEach(([label], i) => {
      const o = h('option', null, label)
      o.value = String(i)
      fs.append(o)
    })
    const ci = FORMATS.findIndex(([, f]) => JSON.stringify(f) === JSON.stringify(formats[c] || null))
    fs.value = String(Math.max(0, ci))
    fs.addEventListener('change', () => {
      formats[c] = FORMATS[+fs.value][1]
      render(true)
      scheduleStats()
    })
    p.append(fs)

    p.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Escape') {
        closeMenu()
        grid.focus({ preventScroll: true })
      } else if (e.key === 'Enter' && e.target === ti) apply.click()
    })
    menuEl = p
    let x = 0
    let y = 0
    if (anchorEl) {
      const b = anchorEl.getBoundingClientRect()
      x = b.left
      y = b.bottom + 2
    } else {
      const rc = gridRect()
      x = (ev ? ev.clientX : rc.left + gutterW + colX[c] - grid.scrollLeft) - 8
      y = rc.top + HEAD_H
    }
    placeFloating(p, x, y)
    ti.focus({ preventScroll: true })
  }
  on(
    document,
    'mousedown',
    (e) => {
      if (menuEl && !menuEl.contains(e.target)) closeMenu()
    },
    true,
  )
  on(window, 'blur', closeMenu)
  on(stClear, 'click', () => clearFilters())

  // ---------------------------------------------------------------- status & toolbar state
  function updateToolbar() {
    tb.undo.disabled = !sheet.canUndo
    tb.redo.disabled = !sheet.canRedo
    const press = (b, v) => b.setAttribute('aria-pressed', v ? 'true' : 'false')
    press(tb.header, header)
    press(tb.freeze, freeze && header)
    tb.freeze.disabled = !header
    press(tb.filter, filters.size > 0)
    delimSel.value = sheet.delimiter
  }
  function updateStatus() {
    stDims.textContent = `${sheet.rowCount.toLocaleString()} rows x ${sheet.ncols.toLocaleString()} columns`
    stDelim.textContent = DELIM_NAMES[sheet.delimiter] + '-separated'
    if (list) {
      const tot = sheet.rowCount - (header ? 1 : 0)
      const shown = list.length - (header ? 1 : 0)
      stFilter.firstChild.textContent = `Filtered: ${shown.toLocaleString()} of ${tot.toLocaleString()} rows `
      stFilter.hidden = false
    } else stFilter.hidden = true
  }
  function scheduleStats() {
    clearTimeout(statTimer)
    statTimer = setTimeout(updateStats, 60)
  }
  function updateStats() {
    if (destroyed) return
    const R = selRect()
    const cells = (R.r1 - R.r0 + 1) * (R.c1 - R.c0 + 1)
    if (cells <= 1) {
      stStats.textContent = ''
      return
    }
    if (cells > 3000000) {
      stStats.textContent = 'Selection too large for live stats'
      return
    }
    const rows = visibleRows(R.r0, R.r1)
    const vals = []
    for (const r of rows) for (let c = R.c0; c <= R.c1; c++) vals.push(sheet.value(r, c))
    const s = computeStats(vals)
    const parts = [`Count: ${s.count.toLocaleString()}`]
    if (s.numCount) parts.push(`Sum: ${num(s.sum)}`, `Average: ${num(s.avg)}`, `Min: ${num(s.min)}`, `Max: ${num(s.max)}`)
    stStats.textContent = parts.join('   ')
  }

  // ---------------------------------------------------------------- start
  const saved = loadWidths()
  if (saved) widths = saved.slice()
  ensureWidths()
  if (!saved && !large) {
    // quick first-pass fit from the top of the file
    recalcCols()
    for (let c = 0; c < sheet.ncols; c++) widths[c] = clamp(fitWidthQuick(c), 60, 300)
  }
  function fitWidthQuick(c) {
    let max = 0
    const n = Math.min(sheet.rowCount, 200)
    for (let r = 0; r < n; r++) {
      const s = cellText(r, c)
      if (s.length > max) max = s.length
    }
    return Math.round(max * 7.4 + 24)
  }
  stNote.textContent = large ? 'Large file: autofit is off' : ''
  delimSel.value = sheet.delimiter
  if (large) toast('Large file (' + total0.toLocaleString() + ' cells): autofit is off')

  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => (layout(), render(true))) : null
  if (ro) ro.observe(grid)
  const ro2 = typeof ResizeObserver === 'function' ? new ResizeObserver(() => fitToolbar()) : null
  if (ro2) ro2.observe(toolbar)
  on(host, 'focusout', (e) => {
    if (!root.contains(e.relatedTarget)) flush()
  })
  layout()
  layout() // second pass: scrollbars may have changed the client size
  rebuildView()
  render(true)
  refreshFormulaBar()
  updateStatus()
  updateToolbar()
  updateStats()
  fitToolbar()

  return {
    serialize() {
      if (editing) commitEdit(0, 0, true)
      return { text: currentText() }
    },
    destroy() {
      if (destroyed) return
      try {
        if (editing) commitEdit(0, 0, true)
        flush()
      } catch {}
      destroyed = true
      clearTimeout(saveTimer)
      clearTimeout(statTimer)
      clearInterval(scrollTimer)
      cancelAnimationFrame(scrollRaf)
      if (ro) ro.disconnect()
      if (ro2) ro2.disconnect()
      closeMenu()
      offs.forEach((f) => f())
      offs.length = 0
      host.textContent = ''
    },
  }
}
