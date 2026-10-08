// Outline: headings from the document as a nested, clickable list.
// Headings are matched to the editor by document order (nth heading), in both modes.

export function init(app) {
  const $ = (s) => document.querySelector(s)
  const pane = $('#outline-pane')
  const scroller = $('#editor-scroll')
  const source = $('#source')
  const editor = $('#editor')
  if (!pane) return

  let headings = [] // { level, text, line, index, children }
  let items = [] // outline row elements, by heading index
  let current = -1
  let timer = null
  let frame = 0

  /* ---------- parsing ---------- */
  // ATX headings only, outside fenced code blocks. Allows a blockquote prefix, as the editor does.
  function parse(md) {
    const out = []
    const lines = (md || '').split('\n')
    let fence = null
    lines.forEach((raw, line) => {
      const fm = raw.match(/^\s*(`{3,}|~{3,})/)
      if (fm) {
        if (!fence) fence = fm[1][0].repeat(fm[1].length)
        else if (fm[1][0] === fence[0] && fm[1].length >= fence.length) fence = null
        return
      }
      if (fence) return
      const m = raw.match(/^ {0,3}(?:>\s?)*\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/)
      if (!m) return
      out.push({ level: m[1].length, text: cleanText(m[2]), line, index: out.length, children: [] })
    })
    return out
  }

  // Strip inline markdown so the outline reads as plain text.
  function cleanText(s) {
    return s
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/(\*\*|__|\*|_|~~)/g, '')
      .trim()
  }

  // Nest by level: a heading is a child of the nearest preceding heading with a smaller level.
  function nest(flat) {
    const root = { level: 0, children: [] }
    const stack = [root]
    for (const h of flat) {
      while (stack.length > 1 && stack[stack.length - 1].level >= h.level) stack.pop()
      stack[stack.length - 1].children.push(h)
      stack.push(h)
    }
    return root.children
  }

  /* ---------- rendering ---------- */
  function renderList(nodes, ul) {
    for (const h of nodes) {
      const li = document.createElement('li')
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'outline-item lvl' + h.level
      btn.textContent = h.text || '(untitled)'
      btn.title = h.text
      btn.addEventListener('click', () => goTo(h))
      li.appendChild(btn)
      items[h.index] = btn
      if (h.children.length) {
        const sub = document.createElement('ul')
        renderList(h.children, sub)
        li.appendChild(sub)
      }
      ul.appendChild(li)
    }
  }

  function render(md = currentMarkdown()) {
    headings = parse(md)
    items = []
    current = -1
    pane.textContent = ''
    if (!headings.length) {
      const p = document.createElement('p')
      p.className = 'outline-empty'
      p.textContent = 'No headings yet. Headings you add will appear here.'
      pane.appendChild(p)
      return
    }
    const ul = document.createElement('ul')
    ul.className = 'outline-list'
    renderList(nest(headings), ul)
    pane.appendChild(ul)
    highlight()
  }

  function currentMarkdown() {
    return app.state.tabs[app.state.active] ? app.getMarkdown() : ''
  }

  /* ---------- navigation ---------- */
  function inSource() {
    return app.state.mode === 'source'
  }

  function goTo(h) {
    if (inSource()) {
      const lines = source.value.split('\n')
      let off = 0
      for (let i = 0; i < h.line && i < lines.length; i++) off += lines[i].length + 1
      source.focus({ preventScroll: true })
      source.setSelectionRange(off, off)
      source.scrollTop = Math.max(0, (h.line / Math.max(1, lines.length)) * source.scrollHeight - 40)
      return
    }
    const el = headingEls()[h.index]
    if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  function headingEls() {
    const pm = editor ? editor.querySelector('.ProseMirror') : null
    return pm ? [...pm.querySelectorAll('h1,h2,h3,h4,h5,h6')] : []
  }

  // Index of the last heading that has reached the top of the viewport.
  function computeCurrent() {
    if (!headings.length) return -1
    if (inSource()) {
      const total = Math.max(1, source.value.split('\n').length)
      const pos = source.scrollTop
      let idx = -1
      for (const h of headings) {
        if ((h.line / total) * source.scrollHeight <= pos + 40) idx = h.index
      }
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

  function highlight() {
    const idx = computeCurrent()
    if (idx === current) return
    if (items[current]) items[current].classList.remove('current')
    current = idx
    if (items[current]) {
      items[current].classList.add('current')
      items[current].scrollIntoView({ block: 'nearest' })
    }
  }

  function onScroll() {
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      highlight()
    })
  }
  scroller.addEventListener('scroll', onScroll, { passive: true })
  source.addEventListener('scroll', onScroll, { passive: true })

  app.bus.on('doc:change', (md) => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      render(md ?? '')
    }, 200)
  })
  app.bus.on('tab:switch', () => render())
  app.bus.on('mode:change', () => render())

  render()
}
