// View modes: reading, zen, presentation, plus TOC and date insertion.
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

/* ----- tiny safe markdown renderer (escape first, then re-add a whitelist) ----- */
function inline(s) {
  let t = esc(s)
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>')
  t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, a, u) => (/^(https?:|data:image|file:|\.|\/|[\w-]+\/)/i.test(u) ? `<img alt="${a}" src="${u}">` : a))
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, a, u) => (/^(https?:|mailto:)/i.test(u) ? `<a href="${u}" target="_blank" rel="noopener noreferrer">${a}</a>` : a))
  t = t.replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_, a, b) => `<strong>${a || b}</strong>`)
  t = t.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>').replace(/(^|\W)_([^_\s][^_]*)_(?=\W|$)/g, '$1<em>$2</em>')
  return t
}

function renderMd(md) {
  const out = []
  const lines = md.split('\n')
  let i = 0
  let list = null
  const closeList = () => list && (out.push(`</${list}>`), (list = null))
  while (i < lines.length) {
    const l = lines[i]
    const fence = l.match(/^\s*```\s*(\w*)/)
    if (fence) {
      closeList()
      const body = []
      i++
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++])
      i++
      const lang = fence[1].toLowerCase()
      out.push(lang === 'mermaid' || lang === 'chart' ? `<div class="pres-placeholder">${lang} diagram (view in editor)</div>` : `<pre><code>${esc(body.join('\n'))}</code></pre>`)
      continue
    }
    let m
    if ((m = l.match(/^(#{1,6})\s+(.*)$/))) (closeList(), out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`))
    else if ((m = l.match(/^\s*[-*+]\s+(?:\[( |x)\]\s+)?(.*)$/i))) {
      if (list !== 'ul') (closeList(), out.push('<ul>'), (list = 'ul'))
      out.push(`<li>${m[1] ? (m[1] === ' ' ? '☐ ' : '☑ ') : ''}${inline(m[2])}</li>`)
    } else if ((m = l.match(/^\s*\d+[.)]\s+(.*)$/))) {
      if (list !== 'ol') (closeList(), out.push('<ol>'), (list = 'ol'))
      out.push(`<li>${inline(m[1])}</li>`)
    } else if ((m = l.match(/^>\s?(.*)$/))) (closeList(), out.push(`<blockquote>${inline(m[1])}</blockquote>`))
    else if (l.trim()) (closeList(), out.push(`<p>${inline(l)}</p>`))
    else closeList()
    i++
  }
  closeList()
  return out.join('')
}

function splitSlides(md) {
  const slides = []
  let cur = []
  let fenced = false
  for (const l of md.split('\n')) {
    if (/^\s*```/.test(l)) fenced = !fenced
    if (!fenced && /^---\s*$/.test(l)) (slides.push(cur.join('\n')), (cur = []))
    else cur.push(l)
  }
  slides.push(cur.join('\n'))
  return slides.filter((s) => s.trim())
}

export function init(app) {
  const body = document.body
  const pm = () => document.querySelector('#editor .ProseMirror')

  /* ----- reading mode ----- */
  const applyReading = () => {
    const on = body.classList.contains('reading-mode')
    const el = pm()
    if (el) el.setAttribute('contenteditable', on ? 'false' : 'true')
  }
  app.bus.on('editor:ready', applyReading)
  app.bus.on('tab:switch', () => setTimeout(applyReading, 50))
  const reading = () => {
    body.classList.toggle('reading-mode')
    applyReading()
    app.toast(body.classList.contains('reading-mode') ? 'Reading mode on' : 'Reading mode off')
  }

  /* ----- zen mode ----- */
  const setZen = (on) => {
    body.classList.toggle('zen', on)
    if (on) app.toast('Zen mode: press Esc to exit')
  }
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && body.classList.contains('zen') && !document.querySelector('.folio-presentation')) setZen(false)
  })

  /* ----- presentation ----- */
  function present() {
    if (document.querySelector('.folio-presentation')) return
    const slides = splitSlides(app.getMarkdown())
    if (!slides.length) return app.toast('Nothing to present')
    let idx = 0
    const ov = document.createElement('div')
    ov.className = 'folio-presentation'
    ov.tabIndex = -1
    const stage = document.createElement('div')
    stage.className = 'pres-stage'
    const counter = document.createElement('div')
    counter.className = 'pres-counter'
    ov.append(stage, counter)
    const show = () => {
      idx = Math.max(0, Math.min(slides.length - 1, idx))
      stage.innerHTML = renderMd(slides[idx])
      counter.textContent = `${idx + 1} / ${slides.length}`
    }
    const close = () => {
      window.removeEventListener('keydown', onKey, true)
      ov.remove()
    }
    const onKey = (e) => {
      const k = e.key
      if (k === 'Escape') close()
      else if (['ArrowRight', 'ArrowDown', ' ', 'PageDown', 'Enter'].includes(k)) (idx++, show())
      else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(k)) (idx--, show())
      else if (k === 'Home') (idx = 0, show())
      else if (k === 'End') (idx = slides.length - 1, show())
      else if (k !== 'F5') return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    ov.addEventListener('click', (e) => {
      if (e.target.closest('a')) return
      idx++
      show()
    })
    document.body.appendChild(ov)
    show()
    ov.focus()
    if (slides.length === 1) app.toast('Separate slides with --- on its own line')
  }

  /* ----- insertion helpers ----- */
  function insertAtCursor(text) {
    if (app.state.mode === 'source') {
      const ta = document.getElementById('source')
      ta.focus()
      document.execCommand('insertText', false, text)
    } else {
      const el = pm()
      if (!el || el.getAttribute('contenteditable') === 'false') return app.toast('Editor is read-only')
      el.focus()
      document.execCommand('insertText', false, text)
    }
  }
  function toc() {
    const heads = []
    let fenced = false
    for (const l of app.getMarkdown().split('\n')) {
      if (/^\s*```/.test(l)) fenced = !fenced
      const m = !fenced && l.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/)
      if (m) heads.push([m[1].length, m[2].replace(/[*_`]/g, '')])
    }
    if (!heads.length) return app.toast('No headings found')
    const base = Math.min(...heads.map((h) => h[0]))
    const slug = (t) => t.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-')
    insertAtCursor(heads.map(([d, t]) => `${'  '.repeat(d - base)}- [${t}](#${slug(t)})`).join('\n') + '\n')
  }

  const reg = (id, title, run, keys, category = 'View') => app.commands.register({ id, title, run, keys, category })
  reg('view.reading', 'Toggle Reading Mode', reading)
  reg('view.zen', 'Toggle Zen Mode', () => setZen(!body.classList.contains('zen')), 'F11')
  reg('view.presentation', 'Start Presentation', present, 'F5')
  reg('view.tableOfContents', 'Insert Table of Contents', toc, null, 'Insert')
  reg('edit.insertDate', 'Insert Date', () => insertAtCursor(new Date().toISOString().slice(0, 10)), null, 'Insert')
}
