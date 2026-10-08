// Settings modal. Every control writes immediately via app.settings.set.
const THEMES = [
  ['light', 'Light', '#ffffff', '#1f2328', '#0969da'],
  ['dark', 'Dark', '#1e1f22', '#e6e6e6', '#5b9dff'],
  ['sepia', 'Sepia', '#f4ecd8', '#433422', '#9a5b1f'],
  ['nord', 'Nord', '#2e3440', '#d8dee9', '#88c0d0'],
  ['dracula', 'Dracula', '#282a36', '#f8f8f2', '#bd93f9'],
  ['midnight', 'Midnight', '#0b1020', '#d6deeb', '#7fdbca'],
  ['solarized-dark', 'Solarized Dark', '#002b36', '#93a1a1', '#2aa198'],
  ['github', 'GitHub', '#ffffff', '#0969da', '#1f2328'],
]
const DEFAULTS = {
  theme: 'light', focusMode: false, typewriter: false, sidebar: true, sidebarTab: 'files',
  sidebarWidth: 260, fontSize: 17, fontFamily: 'serif', maxWidth: 820, autosave: true,
  spellcheck: true, lineNumbersSource: true, wrapSource: true, lineHeight: 1.7, zen: false,
}
const SECTIONS = ['Appearance', 'Typography', 'Editor', 'Files', 'Shortcuts', 'About']
const PRESETS = [['Narrow', 640], ['Comfortable', 820], ['Wide', 1100], ['Full', 1400]]
const FONTS = [['serif', 'Serif'], ['sans', 'Sans'], ['mono', 'Mono']]

function el(tag, cls, text) {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text != null) e.textContent = text
  return e
}

export function init(app) {
  const root = document.getElementById('settings-root')
  if (!root) return
  const S = app.settings
  let overlay = null
  let current = 'Appearance'
  let content = null
  let navBtns = {}
  let prevFocus = null
  let refreshers = []
  let uid = 0

  const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  function row(label, desc, control, forId) {
    const r = el('div', 'st-row')
    const left = el('div', 'st-row-text')
    const l = el('label', 'st-label', label)
    if (forId) l.htmlFor = forId
    left.appendChild(l)
    if (desc) left.appendChild(el('div', 'st-desc', desc))
    r.append(left, control)
    return r
  }

  function toggle(key, label, desc) {
    const id = 'st-' + ++uid
    const b = el('button', 'st-switch')
    b.type = 'button'
    b.id = id
    b.setAttribute('role', 'switch')
    b.appendChild(el('span', 'st-knob'))
    const sync = () => b.setAttribute('aria-checked', String(!!S.get(key)))
    b.addEventListener('click', () => S.set(key, !S.get(key)))
    refreshers.push(sync)
    sync()
    return row(label, desc, b, id)
  }

  function slider(key, label, min, max, step, fmt) {
    const id = 'st-' + ++uid
    const wrap = el('div', 'st-slider')
    const inp = el('input')
    inp.type = 'range'
    inp.id = id
    inp.min = min
    inp.max = max
    inp.step = step
    const out = el('output', 'st-num')
    out.htmlFor = id
    const sync = () => {
      inp.value = S.get(key)
      out.textContent = fmt(Number(S.get(key)))
    }
    inp.addEventListener('input', () => {
      S.set(key, Number(inp.value))
    })
    wrap.append(inp, out)
    refreshers.push(sync)
    sync()
    return row(label, null, wrap, id)
  }

  function group(title) {
    const g = el('div', 'st-group')
    if (title) g.appendChild(el('h3', 'st-h', title))
    return g
  }

  function secAppearance() {
    const f = el('div')
    const g = group('Theme')
    const grid = el('div', 'st-themes')
    grid.setAttribute('role', 'radiogroup')
    grid.setAttribute('aria-label', 'Theme')
    const cards = []
    for (const [id, name, bg, fg, ac] of THEMES) {
      const c = el('button', 'st-theme')
      c.type = 'button'
      c.setAttribute('role', 'radio')
      c.setAttribute('aria-label', name)
      const sw = el('div', 'st-swatch')
      sw.style.background = bg
      sw.style.color = fg
      const l1 = el('i')
      l1.style.background = fg
      const l2 = el('i')
      l2.style.background = fg
      l2.style.opacity = '.45'
      const dot = el('b')
      dot.style.background = ac
      sw.append(dot, l1, l2)
      c.append(sw, el('span', 'st-theme-name', name))
      c.addEventListener('click', () => S.set('theme', id))
      cards.push([id, c])
      grid.appendChild(c)
    }
    refreshers.push(() => cards.forEach(([id, c]) => {
      const on = S.get('theme') === id
      c.setAttribute('aria-checked', String(on))
      c.classList.toggle('on', on)
    }))
    g.appendChild(grid)
    const g2 = group('Layout')
    g2.append(
      toggle('sidebar', 'Show sidebar', 'Files and outline panel on the left.'),
      toggle('zen', 'Zen mode', 'Hide all chrome and just write.')
    )
    f.append(g, g2)
    return f
  }

  function secTypography() {
    const f = el('div')
    const g = group('Text')
    const seg = el('div', 'st-seg')
    seg.setAttribute('role', 'radiogroup')
    seg.setAttribute('aria-label', 'Font family')
    const btns = FONTS.map(([v, n]) => {
      const b = el('button', 'st-seg-btn', n)
      b.type = 'button'
      b.setAttribute('role', 'radio')
      b.addEventListener('click', () => S.set('fontFamily', v))
      seg.appendChild(b)
      return [v, b]
    })
    refreshers.push(() => btns.forEach(([v, b]) => {
      const on = S.get('fontFamily') === v
      b.setAttribute('aria-checked', String(on))
      b.classList.toggle('on', on)
    }))
    const famRow = row('Font family', 'Typeface for documents.', seg)
    famRow.querySelector('.st-label').removeAttribute('for')
    g.append(
      famRow,
      slider('fontSize', 'Font size', 11, 32, 1, (v) => v + ' px'),
      slider('lineHeight', 'Line height', 1.3, 2.2, 0.05, (v) => v.toFixed(2)),
      slider('maxWidth', 'Content width', 480, 1400, 20, (v) => v + ' px')
    )
    const pre = el('div', 'st-presets')
    const pb = PRESETS.map(([n, v]) => {
      const b = el('button', 'st-chip', n)
      b.type = 'button'
      b.addEventListener('click', () => S.set('maxWidth', v))
      pre.appendChild(b)
      return [v, b]
    })
    refreshers.push(() => pb.forEach(([v, b]) => b.classList.toggle('on', Number(S.get('maxWidth')) === v)))
    g.appendChild(pre)
    const g2 = group('Preview')
    const p = el('div', 'st-preview')
    p.appendChild(el('h4', null, 'The quiet craft of writing'))
    p.appendChild(el('p', null, 'Good tools disappear. A page, a cursor, and enough room to think: that is all a writer needs. Plume keeps the rest out of the way so the words stay in front.'))
    const fam = { serif: 'Georgia, "Times New Roman", serif', sans: 'system-ui, "Segoe UI", sans-serif', mono: 'ui-monospace, Consolas, monospace' }
    refreshers.push(() => {
      p.style.fontFamily = fam[S.get('fontFamily')] || fam.serif
      p.style.fontSize = Math.min(S.get('fontSize'), 24) + 'px'
      p.style.lineHeight = S.get('lineHeight')
      p.style.maxWidth = Math.min(S.get('maxWidth'), 620) + 'px'
    })
    g2.appendChild(p)
    f.append(g, g2)
    return f
  }

  function secEditor() {
    const g = group('Writing')
    g.append(
      toggle('spellcheck', 'Spellcheck', 'Underline misspelled words while you type.'),
      toggle('focusMode', 'Focus mode', 'Dim everything except the current paragraph.'),
      toggle('typewriter', 'Typewriter mode', 'Keep the cursor line vertically centered.')
    )
    const g2 = group('Source view')
    g2.append(
      toggle('lineNumbersSource', 'Line numbers', 'Show line numbers in source mode.'),
      toggle('wrapSource', 'Word wrap', 'Wrap long lines in source mode.')
    )
    const f = el('div')
    f.append(g, g2)
    return f
  }

  function btn(text, cls, fn) {
    const b = el('button', 'st-btn ' + (cls || ''), text)
    b.type = 'button'
    b.addEventListener('click', fn)
    return b
  }

  function secFiles() {
    const g = group('Saving')
    g.appendChild(toggle('autosave', 'Autosave', 'Save changes automatically after you stop typing.'))
    const g2 = group('Data')
    g2.append(
      row('Clear recent files', 'Forget the list of recently opened files.', btn('Clear', '', () => {
        try { localStorage.removeItem('folio.recent') } catch {}
        app.toast('Recent files cleared')
      })),
      row('Reset all settings', 'Restore every setting to its default.', btn('Reset', 'danger', async () => {
        let r = 0
        try {
          r = await window.folio.confirm('Reset all settings?', 'This restores the defaults for every setting.', ['Reset', 'Cancel'])
        } catch { r = 0 }
        if (r !== 0) return
        for (const k of Object.keys(DEFAULTS)) S.set(k, DEFAULTS[k])
        app.toast('Settings reset')
      }))
    )
    const f = el('div')
    f.append(g, g2)
    return f
  }

  function secShortcuts() {
    const f = el('div')
    const id = 'st-' + ++uid
    const q = el('input', 'st-search')
    q.type = 'search'
    q.id = id
    q.placeholder = 'Search commands or keys'
    q.setAttribute('aria-label', 'Search shortcuts')
    const wrap = el('div', 'st-table-wrap')
    const table = el('table', 'st-table')
    const head = el('thead')
    const hr = el('tr')
    for (const h of ['Command', 'Category', 'Shortcut']) hr.appendChild(el('th', null, h))
    head.appendChild(hr)
    const body = el('tbody')
    table.append(head, body)
    wrap.appendChild(table)
    const all = app.commands.list().slice().sort((a, b) => String(a.category || '').localeCompare(String(b.category || '')) || String(a.title).localeCompare(String(b.title)))
    const draw = () => {
      const t = q.value.trim().toLowerCase()
      body.textContent = ''
      let n = 0
      for (const c of all) {
        const keys = c.keys ? String(c.keys).split('|').join('  /  ') : ''
        if (t && !(String(c.title) + ' ' + (c.category || '') + ' ' + keys).toLowerCase().includes(t)) continue
        const tr = el('tr')
        tr.appendChild(el('td', null, c.title))
        tr.appendChild(el('td', 'st-muted', c.category || ''))
        const kd = el('td')
        if (keys) for (const k of String(c.keys).split('|')) kd.appendChild(el('kbd', null, k))
        tr.appendChild(kd)
        body.appendChild(tr)
        n++
      }
      if (!n) {
        const tr = el('tr')
        const td = el('td', 'st-muted', 'No matching commands')
        td.colSpan = 3
        tr.appendChild(td)
        body.appendChild(tr)
      }
    }
    q.addEventListener('input', draw)
    draw()
    f.append(q, wrap)
    return f
  }

  function secAbout() {
    const f = el('div', 'st-about')
    f.appendChild(el('div', 'st-logo', 'L'))
    f.appendChild(el('h2', 'st-name', 'Plume'))
    f.appendChild(el('div', 'st-muted', 'Version 0.1.0'))
    f.appendChild(el('p', null, 'Free and open source. No telemetry.'))
    f.appendChild(el('div', 'st-muted', 'Released under the MIT licence.'))
    f.appendChild(btn('View on GitHub', '', () => window.open('https://github.com/SamuelNDCE/plume')))
    return f
  }

  const BUILD = { Appearance: secAppearance, Typography: secTypography, Editor: secEditor, Files: secFiles, Shortcuts: secShortcuts, About: secAbout }

  function show(name) {
    current = name
    refreshers = []
    content.textContent = ''
    const h = el('h2', 'st-title', name)
    h.id = 'st-title'
    content.append(h, BUILD[name]())
    content.scrollTop = 0
    for (const [n, b] of Object.entries(navBtns)) {
      b.classList.toggle('on', n === name)
      if (n === name) b.setAttribute('aria-current', 'page')
      else b.removeAttribute('aria-current')
    }
    refresh()
  }

  function refresh() {
    refreshers.forEach((fn) => fn())
  }

  function focusables() {
    return [...overlay.querySelectorAll('button, input, [tabindex]:not([tabindex="-1"])')].filter((n) => !n.disabled && n.offsetParent !== null)
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
    } else if (e.key === 'Tab') {
      const f = focusables()
      if (!f.length) return
      const first = f[0], last = f[f.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
  }

  function open() {
    if (overlay) return
    prevFocus = document.activeElement
    overlay = el('div', 'st-overlay')
    const dlg = el('div', 'st-dialog')
    dlg.setAttribute('role', 'dialog')
    dlg.setAttribute('aria-modal', 'true')
    dlg.setAttribute('aria-labelledby', 'st-title')
    const nav = el('nav', 'st-nav')
    nav.setAttribute('aria-label', 'Settings sections')
    navBtns = {}
    for (const n of SECTIONS) {
      const b = el('button', 'st-nav-btn', n)
      b.type = 'button'
      b.addEventListener('click', () => show(n))
      nav.appendChild(b)
      navBtns[n] = b
    }
    content = el('div', 'st-content')
    const x = el('button', 'st-close', '×')
    x.type = 'button'
    x.setAttribute('aria-label', 'Close settings')
    x.addEventListener('click', close)
    dlg.append(nav, content, x)
    overlay.appendChild(dlg)
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close() })
    overlay.addEventListener('keydown', onKey)
    root.appendChild(overlay)
    show(current)
    requestAnimationFrame(() => overlay && overlay.classList.add('in'))
    navBtns[current].focus()
  }

  function close() {
    if (!overlay) return
    const o = overlay
    overlay = null
    refreshers = []
    o.classList.remove('in')
    if (reduced()) o.remove()
    else setTimeout(() => o.remove(), 150)
    if (prevFocus && prevFocus.focus) try { prevFocus.focus() } catch {}
  }

  app.bus.on('settings:change', () => { if (overlay) refresh() })
  app.commands.register({ id: 'settings.open', title: 'Open Settings', category: 'App', keys: 'Ctrl+,', run: open })
}
