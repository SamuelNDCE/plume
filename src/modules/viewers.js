// Read-only viewers: CSV/TSV table and image. All text goes through textContent.

function el(tag, cls, text) {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text != null) e.textContent = text
  return e
}

// ---------- CSV ----------
function parseDelimited(text, delim) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const rows = []
  let row = []
  let field = ''
  let i = 0
  const n = text.length
  let inQ = false
  let any = false
  while (i < n) {
    const c = text[i]
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQ = false
        i++
        continue
      }
      field += c
      i++
      continue
    }
    if (c === '"' && field === '') {
      inQ = true
      any = true
      i++
    } else if (c === delim) {
      row.push(field)
      field = ''
      any = true
      i++
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      any = false
      i++
    } else {
      field += c
      any = true
      i++
    }
  }
  if (any || field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

const NUM_RE = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i
function toNum(s) {
  const t = s.trim().replace(/,/g, '')
  if (t === '' || !NUM_RE.test(t)) return null
  return Number(t)
}

const ROW_H = 26
const WINDOW_AT = 2000
const BUFFER = 12

export function renderCsv(host, text, delimiter = ',') {
  host.textContent = ''
  const all = parseDelimited(String(text || ''), delimiter || ',')
  const header = all.length ? all[0] : []
  const body = all.slice(1)
  const ncols = Math.max(header.length, ...body.slice(0, 5000).map((r) => r.length), 0)
  const cell = (r, c) => (r[c] == null ? '' : r[c])

  // column widths (sampled) and numeric detection
  const widths = []
  const numeric = []
  for (let c = 0; c < ncols; c++) {
    let max = (header[c] || '').length + 3
    let nums = 0
    let seen = 0
    const lim = Math.min(body.length, 300)
    for (let r = 0; r < lim; r++) {
      const v = cell(body[r], c)
      if (v.length > max) max = v.length
      if (v !== '') {
        seen++
        if (toNum(v) !== null) nums++
      }
    }
    widths.push(Math.max(60, Math.min(420, Math.round(max * 7.4 + 24))))
    numeric.push(seen > 0 && nums === seen)
  }
  const totalW = 56 + widths.reduce((a, b) => a + b, 0)

  const root = el('div', 'csv-view')
  const bar = el('div', 'csv-bar')
  const filter = el('input', 'csv-filter')
  filter.type = 'search'
  filter.placeholder = 'Filter rows...'
  filter.spellcheck = false
  const info = el('span', 'csv-info')
  bar.append(filter, info)
  const scroll = el('div', 'csv-scroll')
  const table = el('table', 'csv-table')
  table.style.width = totalW + 'px'
  const colgroup = el('colgroup')
  const rc = el('col')
  rc.style.width = '56px'
  colgroup.append(rc)
  widths.forEach((w) => {
    const c = el('col')
    c.style.width = w + 'px'
    colgroup.append(c)
  })
  const thead = el('thead')
  const htr = el('tr')
  htr.append(el('th', 'csv-rn', '#'))
  const ths = []
  for (let c = 0; c < ncols; c++) {
    const th = el('th', numeric[c] ? 'num' : '')
    th.title = header[c] || ''
    const label = el('span', 'csv-th-label', header[c] || `Column ${c + 1}`)
    const arrow = el('span', 'csv-arrow')
    th.append(label, arrow)
    th.addEventListener('click', () => sortBy(c))
    ths.push({ th, arrow })
    htr.append(th)
  }
  thead.append(htr)
  const tbody = el('tbody')
  table.append(colgroup, thead, tbody)
  scroll.append(table)
  root.append(bar, scroll)
  host.append(root)

  let order = body.map((_, i) => i) // original indices, sorted
  let view = order // filtered
  let sortCol = -1
  let sortDir = 1
  let windowed = false

  function updateInfo() {
    const f = view.length !== body.length ? ` (filtered from ${body.length.toLocaleString()})` : ''
    info.textContent = `${view.length.toLocaleString()} rows${f} · ${ncols} columns`
  }

  function rowEl(idx) {
    const r = body[idx]
    const tr = el('tr')
    tr.append(el('td', 'csv-rn', String(idx + 1)))
    for (let c = 0; c < ncols; c++) {
      const v = cell(r, c)
      const td = el('td', numeric[c] ? 'num' : '', v)
      if (v.length > 40) td.title = v.slice(0, 500)
      tr.append(td)
    }
    return tr
  }

  function spacer(h) {
    const tr = el('tr', 'csv-spacer')
    const td = el('td')
    td.colSpan = ncols + 1
    td.style.height = h + 'px'
    td.style.padding = '0'
    tr.append(td)
    return tr
  }

  let lastStart = -1
  let lastEnd = -1
  function draw(force) {
    windowed = view.length > WINDOW_AT
    if (!windowed) {
      tbody.textContent = ''
      const frag = document.createDocumentFragment()
      for (const i of view) frag.append(rowEl(i))
      tbody.append(frag)
      lastStart = lastEnd = -1
      return
    }
    const headH = thead.offsetHeight || ROW_H
    const viewH = scroll.clientHeight || 600
    const first = Math.max(0, Math.floor(Math.max(0, scroll.scrollTop - headH) / ROW_H) - BUFFER)
    const last = Math.min(view.length, Math.ceil((scroll.scrollTop + viewH) / ROW_H) + BUFFER)
    if (!force && first === lastStart && last === lastEnd) return
    lastStart = first
    lastEnd = last
    tbody.textContent = ''
    const frag = document.createDocumentFragment()
    frag.append(spacer(first * ROW_H))
    for (let k = first; k < last; k++) frag.append(rowEl(view[k]))
    frag.append(spacer((view.length - last) * ROW_H))
    tbody.append(frag)
  }

  let raf = 0
  scroll.addEventListener('scroll', () => {
    if (!windowed || raf) return
    raf = requestAnimationFrame(() => {
      raf = 0
      draw(false)
    })
  })

  function applyFilter() {
    const q = filter.value.trim().toLowerCase()
    if (!q) view = order
    else view = order.filter((i) => body[i].join('\u0001').toLowerCase().includes(q))
    scroll.scrollTop = 0
    updateInfo()
    draw(true)
  }

  function sortBy(c) {
    if (sortCol === c) sortDir = -sortDir
    else {
      sortCol = c
      sortDir = 1
    }
    const keyed = body.map((r, i) => {
      const v = cell(r, c)
      return { i, v, n: toNum(v) }
    })
    keyed.sort((a, b) => {
      const ae = a.v === ''
      const be = b.v === ''
      if (ae || be) return ae && be ? a.i - b.i : ae ? 1 : -1 // empties always last
      let d
      if (a.n !== null && b.n !== null) d = a.n - b.n
      else d = a.v.localeCompare(b.v, undefined, { numeric: true, sensitivity: 'base' })
      return d * sortDir || a.i - b.i
    })
    order = keyed.map((k) => k.i)
    ths.forEach((t, k) => {
      t.arrow.textContent = k === c ? (sortDir === 1 ? ' ▲' : ' ▼') : ''
    })
    applyFilter()
  }

  let timer = 0
  filter.addEventListener('input', () => {
    clearTimeout(timer)
    timer = setTimeout(applyFilter, 150)
  })

  updateInfo()
  draw(true)
  // windowed rendering needs real layout metrics; redraw once attached/laid out
  if (windowed) requestAnimationFrame(() => draw(true))
}

// ---------- Image ----------
export function renderImage(host, dataUrl, name) {
  host.textContent = ''
  const root = el('div', 'img-view')
  const bar = el('div', 'img-bar')
  const mk = (label, title, fn) => {
    const b = el('button', 'img-btn', label)
    b.type = 'button'
    b.title = title
    b.addEventListener('click', fn)
    return b
  }
  const stage = el('div', 'img-stage')
  const img = el('img', 'img-el')
  img.alt = name || ''
  img.draggable = false
  stage.append(img)
  const info = el('span', 'img-info', name || '')

  let s = 1
  let tx = 0
  let ty = 0
  let fit = true
  let nw = 0
  let nh = 0
  const MIN = 0.02
  const MAX = 40

  function apply() {
    img.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`
    info.textContent = `${name || ''}${nw ? `  ${nw} × ${nh}` : ''}  ${Math.round(s * 100)}%`
  }
  function center() {
    const r = stage.getBoundingClientRect()
    tx = (r.width - nw * s) / 2
    ty = (r.height - nh * s) / 2
  }
  function fitView() {
    if (!nw) return
    const r = stage.getBoundingClientRect()
    if (!r.width || !r.height) return
    fit = true
    s = Math.min(1, (r.width - 24) / nw, (r.height - 24) / nh)
    center()
    apply()
  }
  function actual() {
    if (!nw) return
    fit = false
    s = 1
    center()
    apply()
  }
  function zoomAt(factor, cx, cy) {
    const r = stage.getBoundingClientRect()
    if (cx == null) {
      cx = r.width / 2
      cy = r.height / 2
    }
    const ns = Math.max(MIN, Math.min(MAX, s * factor))
    tx = cx - ((cx - tx) * ns) / s
    ty = cy - ((cy - ty) * ns) / s
    s = ns
    fit = false
    apply()
  }

  bar.append(
    mk('−', 'Zoom out', () => zoomAt(1 / 1.25)),
    mk('+', 'Zoom in', () => zoomAt(1.25)),
    mk('Fit', 'Fit to window', fitView),
    mk('100%', 'Actual size', actual),
    info,
  )
  root.append(bar, stage)
  host.append(root)

  img.addEventListener('load', () => {
    nw = img.naturalWidth
    nh = img.naturalHeight
    fitView()
  })
  img.src = dataUrl

  stage.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault()
      const r = stage.getBoundingClientRect()
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top)
    },
    { passive: false },
  )

  let drag = null
  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    drag = { x: e.clientX, y: e.clientY, tx, ty }
    stage.setPointerCapture(e.pointerId)
    stage.classList.add('panning')
  })
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return
    tx = drag.tx + e.clientX - drag.x
    ty = drag.ty + e.clientY - drag.y
    apply()
  })
  const end = (e) => {
    if (!drag) return
    drag = null
    stage.classList.remove('panning')
    try {
      stage.releasePointerCapture(e.pointerId)
    } catch {}
  }
  stage.addEventListener('pointerup', end)
  stage.addEventListener('pointercancel', end)
  stage.addEventListener('dblclick', () => {
    if (fit && s < 1) actual()
    else if (Math.abs(s - 1) < 1e-6 && !fit) fitView()
    else if (fit) actual()
    else fitView()
  })

  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => {
      if (fit && nw) fitView()
    }).observe(stage)
  }
}
