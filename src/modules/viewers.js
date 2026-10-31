// Read-only image viewer. All text goes through textContent. (The CSV table renderer was removed 2026-10-31: CSV opens in the spreadsheet grid.)

function el(tag, cls, text) {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text != null) e.textContent = text
  return e
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
