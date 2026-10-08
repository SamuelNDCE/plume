// Outline rail: a floating stack of lines along the left edge of the document (one per heading, length = level).
// Hover or focus opens a details panel to the right listing the headings; click jumps to one.
// Rich view: built from the rendered h1-h6 elements, so the nth entry is the nth heading element.
// Source view: built from the Markdown text (ATX headings) and jumps through app.code.
// Hidden for non-Markdown documents and for documents without headings.

const MAX_LINES = 24
const OPEN_DELAY = 80
const CLOSE_DELAY = 250
const PIN_MS = 3000

export function init(app) {
  const host = document.querySelector('#doc')
  const scroller = document.querySelector('#editor-scroll')
  if (!host || !scroller) return

  let headings = [] // { level, text, index, line (source only) }
  let rows = [] // panel buttons, by heading index
  let ticks = [] // { el, from } minimap lines, `from` = first heading index it stands for
  let current = -1
  let timer = null
  let frame = 0
  let sig = null
  let codeHooked = false
  let openT = null
  let closeT = null
  let pinT = null
  let isOpen = false

  /* ---------- DOM ---------- */
  const root = document.createElement('div')
  root.id = 'outline-mini'
  root.hidden = true
  const trigger = document.createElement('div')
  trigger.className = 'om-trigger'
  trigger.setAttribute('role', 'group')
  trigger.setAttribute('aria-label', 'Document outline')
  const stack = document.createElement('div')
  stack.className = 'om-stack'
  trigger.appendChild(stack)
  const panel = document.createElement('div')
  panel.className = 'om-panel'
  panel.setAttribute('role', 'navigation')
  panel.setAttribute('aria-label', 'Outline')
  panel.hidden = true
  root.append(trigger, panel)
  host.appendChild(root)

  /* ---------- parsing ---------- */
  function cleanText(s) {
    return s
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/(\*\*|__|\*|_|~~)/g, '')
      .trim()
  }

  // ATX headings only, outside fenced code blocks. Allows a blockquote prefix, as the editor does.
  function parseMarkdown(md) {
    const out = []
    let fence = null
    ;(md || '').split('\n').forEach((raw, line) => {
      const fm = raw.match(/^\s*(`{3,}|~{3,})/)
      if (fm) {
        if (!fence) fence = fm[1][0].repeat(fm[1].length)
        else if (fm[1][0] === fence[0] && fm[1].length >= fence.length) fence = null
        return
      }
      if (fence) return
      const m = raw.match(/^ {0,3}(?:>\s?)*\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/)
      if (!m) return
      out.push({ level: m[1].length, text: cleanText(m[2]), line, index: out.length })
    })
    return out
  }

  function headingEls() {
    const pm = document.querySelector('#editor .ProseMirror')
    return pm ? [...pm.querySelectorAll('h1,h2,h3,h4,h5,h6')] : []
  }

  function domHeadings() {
    return headingEls().map((node, index) => ({
      level: Number(node.tagName[1]),
      text: node.textContent.replace(/\s+/g, ' ').trim(),
      index,
    }))
  }

  /* ---------- open / close ---------- */
  function setOpen(v) {
    if (v === isOpen) return
    if (v && root.hidden) return
    isOpen = v
    root.setAttribute('data-open', String(v))
    root.classList.toggle('open', v)
    if (v) {
      panel.hidden = false
      // next frame so the transition runs
      requestAnimationFrame(() => root.classList.contains('open') && panel.classList.add('shown'))
      const cur = rows[current]
      if (cur) cur.scrollIntoView({ block: 'nearest' })
    } else {
      panel.classList.remove('shown')
      const done = () => {
        if (!isOpen) panel.hidden = true
      }
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) done()
      else setTimeout(done, 130)
    }
  }
  const clearTimers = () => {
    clearTimeout(openT)
    clearTimeout(closeT)
  }
  function scheduleOpen() {
    clearTimers()
    if (pinT) return
    openT = setTimeout(() => setOpen(true), OPEN_DELAY)
  }
  function scheduleClose() {
    clearTimers()
    if (pinT) return
    closeT = setTimeout(() => setOpen(false), CLOSE_DELAY)
  }
  function unpin() {
    clearTimeout(pinT)
    pinT = null
  }
  function closeNow() {
    clearTimers()
    unpin()
    setOpen(false)
  }

  // Used by the outline.show command: open and hold for a few seconds (or until Esc).
  function pin() {
    if (root.hidden) return false
    clearTimers()
    unpin()
    setOpen(true)
    pinT = setTimeout(() => {
      pinT = null
      if (!root.matches(':hover') && !root.contains(document.activeElement)) setOpen(false)
    }, PIN_MS)
    return true
  }

  root.addEventListener('mouseenter', scheduleOpen)
  root.addEventListener('mouseleave', scheduleClose)
  root.addEventListener('focusin', scheduleOpen)
  root.addEventListener('focusout', (e) => {
    if (!root.contains(e.relatedTarget)) scheduleClose()
  })
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen) {
      closeNow()
      if (root.contains(document.activeElement)) trigger.blur()
    }
  })
  document.addEventListener('mousedown', (e) => {
    if (isOpen && !root.contains(e.target)) closeNow()
  })

  /* ---------- rendering ---------- */
  function hide() {
    headings = []
    rows = []
    ticks = []
    current = -1
    sig = null
    root.hidden = true
    closeNow()
    stack.textContent = ''
    panel.textContent = ''
  }

  function hover(i, on) {
    if (rows[i]) rows[i].classList.toggle('hovered', on)
    const t = ticks.find((x) => x.from === i)
    if (t) t.el.classList.toggle('hovered', on)
    if (on && isOpen && rows[i]) rows[i].scrollIntoView({ block: 'nearest' })
  }

  function render() {
    rows = []
    ticks = []
    current = -1
    stack.textContent = ''
    panel.textContent = ''

    // Minimap lines: all headings up to the cap, otherwise evenly thinned.
    const n = headings.length
    const shown = n <= MAX_LINES ? headings.map((_, i) => i) : Array.from({ length: MAX_LINES }, (_, k) => Math.round((k * (n - 1)) / (MAX_LINES - 1)))
    for (const i of shown) {
      const h = headings[i]
      const t = document.createElement('button')
      t.type = 'button'
      t.className = 'om-tick l' + Math.min(h.level, 4)
      t.setAttribute('aria-label', h.text || '(untitled)')
      t.addEventListener('click', () => {
        goTo(h)
        closeNow()
      })
      t.addEventListener('mouseenter', () => hover(i, true))
      t.addEventListener('mouseleave', () => hover(i, false))
      t.addEventListener('focus', () => hover(i, true))
      t.addEventListener('blur', () => hover(i, false))
      const bar = document.createElement('i')
      t.appendChild(bar)
      stack.appendChild(t)
      ticks.push({ el: t, from: i })
    }

    const list = document.createElement('div')
    list.className = 'om-list'
    for (const h of headings) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'om-row l' + Math.min(h.level, 4)
      b.textContent = h.text || '(untitled)'
      b.title = h.text
      b.addEventListener('click', () => {
        goTo(h)
        closeNow()
      })
      list.appendChild(b)
      rows[h.index] = b
    }
    panel.appendChild(list)
    root.hidden = false
    highlight()
  }

  // Rebuild from the live document only when the heading list actually changed.
  function build() {
    const d = app.state.tabs[app.state.active]
    if (!d || d.kind !== 'md') return hide()
    let list
    let mode
    if (app.state.mode === 'source') {
      mode = 'source'
      list = parseMarkdown(app.getMarkdown())
    } else if (app.state.mode === 'wysiwyg') {
      mode = 'wysiwyg'
      list = domHeadings()
    } else {
      return hide()
    }
    if (!list.length) return hide()
    const key = mode + '|' + list.map((h) => `${h.level}:${h.line ?? ''}:${h.text}`).join('\n')
    if (key === sig && !root.hidden) {
      highlight()
      return
    }
    sig = key
    headings = list
    render()
  }

  /* ---------- navigation ---------- */
  function goTo(h) {
    if (app.state.mode === 'source') {
      const code = app.code
      if (!code || h.line == null) return
      code.scrollToLine(h.line + 1) // h.line is 0-based; the code editor API takes 1-based lines
      code.focus()
      return
    }
    const el = headingEls()[h.index]
    if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  // Index of the last heading at or above the reading position.
  function computeCurrent() {
    if (!headings.length) return -1
    if (app.state.mode === 'source') {
      if (!app.code) return -1
      const line = app.code.cursorLine() - 1 // 1-based -> 0-based
      let idx = -1
      for (const h of headings) if (h.line <= line) idx = h.index
      return idx
    }
    const els = headingEls()
    const top = scroller.getBoundingClientRect().top
    let idx = -1
    els.forEach((el, i) => {
      if (el.getBoundingClientRect().top - top <= 60) idx = i
    })
    return idx
  }

  function hookCode() {
    if (codeHooked || !app.code) return
    codeHooked = true
    app.code.onSelection(() => {
      if (app.state.mode === 'source') highlight()
    })
  }

  function highlight() {
    hookCode()
    const idx = computeCurrent()
    if (idx === current) return
    if (rows[current]) {
      rows[current].classList.remove('current')
      rows[current].removeAttribute('aria-current')
    }
    current = idx
    if (rows[current]) {
      rows[current].classList.add('current')
      rows[current].setAttribute('aria-current', 'true')
      if (isOpen) rows[current].scrollIntoView({ block: 'nearest' })
    }
    // the minimap line standing for the current heading: last shown line at or before it
    let hit = -1
    ticks.forEach((t, k) => {
      if (t.from <= current) hit = k
      t.el.classList.remove('current')
    })
    if (current >= 0 && ticks[hit]) ticks[hit].el.classList.add('current')
  }

  function onScroll() {
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      highlight()
    })
  }
  scroller.addEventListener('scroll', onScroll, { passive: true })

  /* ---------- wiring ---------- */
  app.bus.on('doc:change', () => {
    clearTimeout(timer)
    timer = setTimeout(build, 200)
  })
  for (const evt of ['editor:ready', 'tab:switch', 'mode:change', 'empty:show']) app.bus.on(evt, build)

  // Ctrl+Shift+L (outline.show): open the panel and hold it briefly.
  app.outlinePin = pin

  build()
}
