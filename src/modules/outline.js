// Outline: headings of the open Markdown document as a nested, clickable list.
// Rich view: built from the rendered h1-h6 elements, so the nth outline entry is the nth heading element.
// Source view: built from the Markdown text (ATX headings) and jumps through app.code.
// Other file kinds (plain text, tables, images) show an empty state.

export function init(app) {
  const $ = (s) => document.querySelector(s)
  const pane = $('#outline-pane')
  const scroller = $('#editor-scroll')
  if (!pane || !scroller) return

  let headings = [] // { level, text, index, line (source only), children }
  let items = [] // outline buttons, by heading index
  let current = -1
  let timer = null
  let frame = 0
  let sig = null
  let codeHooked = false

  const emptyEl = (text) => {
    const p = document.createElement('p')
    p.className = 'outline-empty'
    p.textContent = text
    return p
  }

  /* ---------- parsing ---------- */
  // Strip inline markdown so the outline reads as plain text.
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
      out.push({ level: m[1].length, text: cleanText(m[2]), line, index: out.length, children: [] })
    })
    return out
  }

  // Rendered headings, in document order.
  function domHeadings() {
    const pm = document.querySelector('#editor .ProseMirror')
    if (!pm) return []
    return [...pm.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((node, index) => ({
      level: Number(node.tagName[1]),
      text: node.textContent.replace(/\s+/g, ' ').trim(),
      index,
      children: [],
    }))
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

  function render() {
    items = []
    current = -1
    pane.textContent = ''
    if (!headings.length) {
      pane.appendChild(emptyEl('No headings yet. Headings you add will appear here.'))
      return
    }
    const ul = document.createElement('ul')
    ul.className = 'outline-list'
    renderList(nest(headings), ul)
    pane.appendChild(ul)
    highlight()
  }

  function showEmpty(text) {
    headings = []
    sig = null
    items = []
    current = -1
    pane.textContent = ''
    pane.appendChild(emptyEl(text))
  }

  // Rebuild from the live document only when the heading list actually changed.
  function build() {
    const d = app.state.tabs[app.state.active]
    if (!d) return showEmpty('Open a document to see its outline.')
    if (d.kind !== 'md') return showEmpty('Outlines are for Markdown documents.')
    let list
    let mode
    if (app.state.mode === 'source') {
      mode = 'source'
      list = parseMarkdown(app.getMarkdown())
    } else if (app.state.mode === 'wysiwyg') {
      mode = 'wysiwyg'
      list = domHeadings()
    } else {
      return showEmpty('Outlines are for Markdown documents.')
    }
    const key = mode + '|' + list.map((h) => `${h.level}:${h.line ?? ''}:${h.text}`).join('\n')
    if (key === sig) {
      highlight()
      return
    }
    sig = key
    headings = list
    render()
  }

  /* ---------- navigation ---------- */
  function headingEls() {
    const pm = document.querySelector('#editor .ProseMirror')
    return pm ? [...pm.querySelectorAll('h1,h2,h3,h4,h5,h6')] : []
  }

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
      const line = app.code.cursorLine() - 1 // assumes cursorLine() is 1-based, like CodeMirror
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

  /* ---------- wiring ---------- */
  app.bus.on('doc:change', () => {
    clearTimeout(timer)
    timer = setTimeout(build, 200)
  })
  app.bus.on('editor:ready', build)
  app.bus.on('tab:switch', build)
  app.bus.on('mode:change', build)
  app.bus.on('empty:show', build)

  build()
}
