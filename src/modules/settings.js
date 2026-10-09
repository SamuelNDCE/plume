import logoUrl from '../assets/plume-logo.svg'
// Settings modal. Every control writes immediately via app.settings.set.
const CHART_COLORS = ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2']
const FALLBACK_THEMES = [
  ['light', 'Light', '#ffffff', '#1d1f23', '#4f5bd5'],
  ['github', 'GitHub', '#ffffff', '#1f2328', '#0969da'],
  ['newsprint', 'Newsprint', '#f3f0ea', '#141210', '#b3141b'],
  ['sepia', 'Sepia', '#f6efdd', '#3f3224', '#a4532a'],
  ['dark', 'Dark', '#1c1d20', '#dcdee2', '#5b9dff'],
  ['nord', 'Nord', '#2e3440', '#d8dee9', '#88c0d0'],
  ['dracula', 'Dracula', '#282a36', '#f1f1ec', '#bd93f9'],
  ['midnight', 'Midnight', '#0b1220', '#cfd8e8', '#2dd4bf'],
].map(([id, name, bg, fg, accent]) => ({ id, name, group: 'Built-in', preview: { bg, fg, accent, colors: CHART_COLORS } }))
const DEFAULTS = {
  theme: 'light', focusMode: false, typewriter: false, sidebar: true, sidebarTab: 'files',
  sidebarWidth: 260, fontSize: 17, fontFamily: 'theme', maxWidth: 820, autosave: true, checkUpdates: true,
  spellcheck: true, lineNumbersSource: true, wrapSource: true, lineHeight: 1.7, zen: false,
  fontBody: '', fontHeading: '', fontMono: '', headingScale: 0, paraSpacing: 0, accent: '',
  customCss: '', chartStyle: '', pluginsConsent: false,
}
const SECTIONS = ['Appearance', 'Typography', 'Editor', 'Files', 'Plugins', 'Shortcuts', 'About']
const FONT_PRESETS = [
  ['', 'Theme default'],
  ['system-ui, -apple-system, "Segoe UI", sans-serif', 'System UI'],
  ['Georgia, "Times New Roman", serif', 'Serif (Georgia)'],
  ['Inter, "Segoe UI", system-ui, sans-serif', 'Sans (Inter)'],
  ['Seravek, "Gill Sans Nova", "Gill Sans", Calibri, sans-serif', 'Humanist'],
  ['"Cascadia Code", Consolas, ui-monospace, monospace', 'Mono (Cascadia)'],
]
const CSS_NOTE = 'Selectors: .milkdown .ProseMirror h1, p, blockquote, table, code; #cm-host (source view); html[data-theme="dark"]. Variables: --font-body --accent --chart-1 to --chart-8.'
const PRESETS = [['Narrow', 640], ['Comfortable', 820], ['Wide', 1100], ['Full', 1400]]

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
  let cleanups = []
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
    const gallery = el('div', 'st-gallery')
    let cards = []
    const themeList = () => {
      try {
        const l = app.themes && app.themes.list && app.themes.list()
        if (Array.isArray(l) && l.length) return l
      } catch {}
      return FALLBACK_THEMES
    }
    const pick = (id) => {
      if (app.themes && app.themes.apply) {
        try { app.themes.apply(id) } catch {}
      }
      if (S.get('theme') !== id) S.set('theme', id)
    }
    const syncCards = () => cards.forEach(([id, c]) => {
      const on = S.get('theme') === id
      c.setAttribute('aria-checked', String(on))
      c.classList.toggle('on', on)
    })
    const drawGallery = () => {
      gallery.textContent = ''
      cards = []
      const list = themeList()
      for (const grp of ['Built-in', 'Custom', 'Plugin']) {
        const items = list.filter((t) => (t.group || 'Built-in') === grp)
        if (!items.length) continue
        gallery.appendChild(el('div', 'st-sub', grp))
        const grid = el('div', 'st-themes')
        grid.setAttribute('role', 'radiogroup')
        grid.setAttribute('aria-label', grp + ' themes')
        for (const t of items) {
          const p = t.preview || {}
          const c = el('button', 'st-theme')
          c.type = 'button'
          c.setAttribute('role', 'radio')
          c.setAttribute('aria-label', t.name)
          const sw = el('div', 'st-swatch')
          sw.style.background = p.bg || '#fff'
          const h = el('i')
          h.style.background = p.accent || p.fg || '#888'
          h.style.width = '55%'
          const l1 = el('i')
          l1.style.background = p.fg || '#222'
          l1.style.opacity = '.75'
          const l2 = el('i')
          l2.style.background = p.fg || '#222'
          l2.style.opacity = '.45'
          const bars = el('div', 'st-bars')
          const cols = Array.isArray(p.colors) && p.colors.length ? p.colors : CHART_COLORS
          const hs = [40, 70, 55, 85]
          for (let i = 0; i < 4; i++) {
            const bar = el('s')
            bar.style.background = cols[i % cols.length]
            bar.style.height = hs[i] + '%'
            bars.appendChild(bar)
          }
          sw.append(h, l1, l2, bars)
          c.append(sw, el('span', 'st-theme-name', t.name))
          c.addEventListener('click', () => pick(t.id))
          cards.push([t.id, c])
          grid.appendChild(c)
        }
        gallery.appendChild(grid)
      }
      syncCards()
    }
    drawGallery()
    refreshers.push(syncCards)
    if (app.themes && app.themes.onChange) {
      try {
        const off = app.themes.onChange(() => { if (overlay) { drawGallery() } })
        if (typeof off === 'function') cleanups.push(off)
      } catch {}
    }
    const tools = el('div', 'st-presets')
    tools.append(
      btn('Open themes folder', '', () => { try { window.folio.openThemesFolder() } catch {} }),
      btn('Reload custom themes', '', () => { try { app.commands.run('theme.reload') } catch {} })
    )
    const hint = el('div', 'st-desc', 'Drop a theme .json or .css file into the themes folder. See docs/THEMES.md for the format.')
    g.append(gallery, tools, hint)

    const ga = group('Colour')
    const colorIn = el('input', 'st-color')
    colorIn.type = 'color'
    colorIn.id = 'st-' + ++uid
    colorIn.setAttribute('aria-label', 'Accent colour')
    colorIn.addEventListener('input', () => S.set('accent', colorIn.value))
    const accWrap = el('div', 'st-slider')
    accWrap.append(colorIn, btn('Use theme accent', '', () => S.set('accent', '')))
    refreshers.push(() => {
      const a = S.get('accent')
      if (/^#[0-9a-f]{6}$/i.test(a || '')) colorIn.value = a
      else {
        const t = themeList().find((x) => x.id === S.get('theme'))
        const v = t && t.preview && /^#[0-9a-f]{6}$/i.test(t.preview.accent || '') ? t.preview.accent : '#0969da'
        colorIn.value = v
      }
    })
    ga.append(
      row('Accent colour', 'Overrides the theme accent everywhere.', accWrap, colorIn.id),
      segRow('chartStyle', 'Chart style', 'Line and shape feel in diagrams and charts.', [['', 'Theme default'], ['smooth', 'Smooth'], ['sharp', 'Sharp']])
    )

    const g2 = group('Layout')
    g2.append(
      toggle('sidebar', 'Show sidebar', 'Files and outline panel on the left.'),
      toggle('zen', 'Zen mode', 'Hide all chrome and just write.')
    )
    f.append(g, ga, g2)
    return f
  }

  function segRow(key, label, desc, opts) {
    const seg = el('div', 'st-seg')
    seg.setAttribute('role', 'radiogroup')
    seg.setAttribute('aria-label', label)
    const btns = opts.map(([v, n]) => {
      const b = el('button', 'st-seg-btn', n)
      b.type = 'button'
      b.setAttribute('role', 'radio')
      b.addEventListener('click', () => S.set(key, v))
      seg.appendChild(b)
      return [v, b]
    })
    refreshers.push(() => btns.forEach(([v, b]) => {
      const on = (S.get(key) || '') === v
      b.setAttribute('aria-checked', String(on))
      b.classList.toggle('on', on)
    }))
    const r = row(label, desc, seg)
    r.querySelector('.st-label').removeAttribute('for')
    return r
  }

  // font family preset select + custom text input
  function fontRow(key, label, desc) {
    const id = 'st-' + ++uid
    const wrap = el('div', 'st-fontpick')
    const sel = el('select', 'st-select')
    sel.id = id
    for (const [v, n] of FONT_PRESETS) {
      const o = el('option', null, n)
      o.value = v
      sel.appendChild(o)
    }
    const oc = el('option', null, 'Custom…')
    oc.value = '__custom'
    sel.appendChild(oc)
    const txt = el('input', 'st-text')
    txt.type = 'text'
    txt.placeholder = '"Palatino Linotype", serif'
    txt.setAttribute('aria-label', label + ' custom CSS font-family')
    txt.hidden = true
    let customMode = false
    sel.addEventListener('change', () => {
      if (sel.value === '__custom') {
        customMode = true
        txt.hidden = false
        txt.focus()
      } else {
        customMode = false
        txt.hidden = true
        S.set(key, sel.value)
      }
    })
    txt.addEventListener('input', () => S.set(key, txt.value.trim()))
    refreshers.push(() => {
      const v = S.get(key) || ''
      const known = FONT_PRESETS.some(([p]) => p === v)
      if (known && !customMode) { sel.value = v; txt.hidden = true }
      else {
        sel.value = '__custom'
        txt.hidden = false
        if (document.activeElement !== txt) txt.value = v
      }
    })
    wrap.append(sel, txt)
    return row(label, desc, wrap, id)
  }

  function resetSlider(key, label, desc, min, max, step, fmt, mid) {
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
    const rs = btn('Theme default', '', () => S.set(key, 0))
    rs.classList.add('sm')
    inp.addEventListener('input', () => S.set(key, Number(inp.value)))
    refreshers.push(() => {
      const v = Number(S.get(key)) || 0
      inp.value = v || mid
      out.textContent = v ? fmt(v) : 'Theme'
      rs.disabled = !v
    })
    wrap.append(inp, out, rs)
    return row(label, desc, wrap, id)
  }

  function secPlugins() {
    const f = el('div')
    const warn = el('div', 'st-warn')
    warn.setAttribute('role', 'note')
    warn.textContent = 'Plugins are JavaScript that runs inside Plume with access to your open documents. Only enable plugins you trust.'
    const note = el('div', 'st-restart', 'Restart Plume to apply')
    note.hidden = true
    note.setAttribute('role', 'status')
    const list = el('div', 'st-plugins')
    const tools = el('div', 'st-presets')
    const api = window.folio || {}
    const draw = async () => {
      list.textContent = ''
      if (typeof api.listPlugins !== 'function') {
        list.appendChild(el('div', 'st-muted', 'Plugins unavailable'))
        return
      }
      let items = []
      try { items = (await api.listPlugins()) || [] } catch { items = null }
      if (!overlay || current !== 'Plugins') return
      if (items === null) { list.appendChild(el('div', 'st-muted', 'Plugins unavailable')); return }
      if (!items.length) {
        list.appendChild(el('div', 'st-muted', 'No plugins installed. Open the plugins folder and drop a plugin folder (containing plugin.json and its script) into it, then press Refresh list. See docs/PLUGINS.md.'))
        return
      }
      for (const p of items) {
        const card = el('div', 'st-plugin' + (p.valid === false ? ' bad' : ''))
        const top = el('div', 'st-plugin-top')
        const nm = el('div', 'st-plugin-name', p.name || p.id)
        if (p.version) nm.appendChild(el('span', 'st-muted', ' v' + p.version))
        if (p.author) nm.appendChild(el('span', 'st-muted', ' by ' + p.author))
        const sw = el('button', 'st-switch')
        sw.type = 'button'
        sw.setAttribute('role', 'switch')
        sw.setAttribute('aria-label', 'Enable ' + (p.name || p.id))
        sw.setAttribute('aria-checked', String(!!p.enabled))
        sw.appendChild(el('span', 'st-knob'))
        if (p.valid === false) sw.disabled = true
        sw.addEventListener('click', async () => {
          const on = sw.getAttribute('aria-checked') !== 'true'
          if (on && !S.get('pluginsConsent')) {
            let r = 1
            const details = (p.name || p.id) + (p.permissions && p.permissions.length ? '\nPermissions: ' + p.permissions.join(', ') : '') + '\n\nThis plugin will run code inside Plume with access to your open documents. Only enable plugins you trust.'
            try { r = await window.folio.confirm('Enable plugin?', details, ['Enable', 'Cancel']) } catch { r = 1 }
            if (r !== 0) return
            S.set('pluginsConsent', true)
          }
          try { await api.setPluginEnabled(p.id, on) } catch { app.toast('Could not change plugin'); return }
          sw.setAttribute('aria-checked', String(on))
          note.hidden = false
          app.toast('Restart Plume to apply')
          if (app.plugins && typeof app.plugins.reload === 'function') { try { app.plugins.reload() } catch {} }
        })
        top.append(nm, sw)
        card.appendChild(top)
        if (p.description) card.appendChild(el('div', 'st-desc', p.description))
        if (p.permissions && p.permissions.length) {
          const chips = el('div', 'st-chips')
          for (const perm of p.permissions) chips.appendChild(el('span', 'st-perm', perm))
          card.appendChild(chips)
        }
        if (p.valid === false) card.appendChild(el('div', 'st-err', 'Invalid: ' + (p.error || 'unknown error')))
        list.appendChild(card)
      }
    }
    tools.append(
      btn('Open plugins folder', '', () => { try { api.openPluginsFolder() } catch {} }),
      btn('Refresh list', '', draw)
    )
    f.append(warn, note, list, tools, el('div', 'st-desc', 'Writing a plugin? See docs/PLUGINS.md.'))
    draw()
    return f
  }

  function secTypography() {
    const f = el('div')
    const g = group('Text')
    g.append(
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
    const gf = group('Fonts')
    gf.append(
      fontRow('fontBody', 'Body font', 'Text in documents.'),
      fontRow('fontHeading', 'Heading font', 'Titles and headings.'),
      fontRow('fontMono', 'Code font', 'Code blocks and source view.'),
      resetSlider('headingScale', 'Heading scale', 'Size of headings relative to body.', 0.9, 1.4, 0.05, (v) => v.toFixed(2) + 'x', 1.1),
      resetSlider('paraSpacing', 'Paragraph spacing', 'Space between paragraphs.', 0.4, 1.6, 0.05, (v) => v.toFixed(2) + ' em', 1)
    )
    const ga = group('Advanced: custom CSS')
    ga.appendChild(el('div', 'st-desc', CSS_NOTE))
    const ta = el('textarea', 'st-css')
    ta.spellcheck = false
    ta.rows = 8
    ta.setAttribute('aria-label', 'Custom CSS')
    ta.placeholder = '.milkdown .ProseMirror h1 { letter-spacing: -0.02em; }'
    let tmr = null
    ta.addEventListener('input', () => {
      clearTimeout(tmr)
      tmr = setTimeout(() => S.set('customCss', ta.value), 300)
    })
    ta.value = S.get('customCss') || ''
    const clr = btn('Clear', '', () => { clearTimeout(tmr); ta.value = ''; S.set('customCss', '') })
    const cr = el('div', 'st-presets')
    cr.appendChild(clr)
    ga.append(ta, cr)
    const g2 = group('Preview')
    const p = el('div', 'st-preview')
    p.appendChild(el('h4', null, 'The quiet craft of writing'))
    p.appendChild(el('p', null, 'Good tools disappear. A page, a cursor, and enough room to think: that is all a writer needs. Plume keeps the rest out of the way so the words stay in front.'))
    const fam = { serif: 'Georgia, "Times New Roman", serif', sans: 'system-ui, "Segoe UI", sans-serif', mono: 'ui-monospace, Consolas, monospace' }
    refreshers.push(() => {
      const fs = Math.min(S.get('fontSize'), 24)
      p.style.fontFamily = S.get('fontBody') || fam[S.get('fontFamily')] || 'var(--font-body)'
      p.style.fontSize = fs + 'px'
      p.style.lineHeight = S.get('lineHeight')
      p.style.maxWidth = Math.min(S.get('maxWidth'), 620) + 'px'
      const h = p.querySelector('h4')
      h.style.fontFamily = S.get('fontHeading') || 'var(--font-heading)'
      h.style.fontSize = (S.get('headingScale') ? 1.2 * S.get('headingScale') / 1.1 : 1.2) + 'em'
      p.querySelectorAll('p').forEach((q) => { q.style.margin = '0 0 ' + (S.get('paraSpacing') || 0.6) + 'em' })
      const code = p.querySelector('code')
      code.style.fontFamily = S.get('fontMono') || 'var(--font-mono)'
    })
    p.appendChild(el('p', null, 'Inline code looks like this:'))
    p.lastChild.appendChild(el('code', null, ' const x = 1'))
    g2.appendChild(p)
    f.append(g, gf, g2, ga)
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
        if (app.themes && app.themes.apply) { try { app.themes.apply('light') } catch {} }
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

  function secUpdates() {
    const f = el('div')
    const g = group('Updates')
    const statusEl = el('div', 'st-update-status')
    statusEl.setAttribute('role', 'status')
    statusEl.setAttribute('aria-live', 'polite')
    const detailEl = el('div', 'st-desc')
    const bar = el('div', 'update-bar')
    const fill = el('div', 'update-fill')
    bar.appendChild(fill)
    const checkBtn = btn('Check for updates', '', () => app.updates && app.updates.check())
    const goBtn = btn('Update now', 'primary', () => app.updates && app.updates.start())
    const restartBtn = btn('Restart and install', 'primary', () => app.updates && app.updates.install())
    const actions = el('div', 'st-update-actions')
    actions.append(goBtn, restartBtn, checkBtn)
    const box = el('div', 'st-update-box')
    box.append(statusEl, detailEl, bar, actions)
    g.appendChild(box)

    const when = (t) => {
      if (!t) return 'Not checked yet in this install.'
      const mins = Math.round((Date.now() - t) / 60000)
      const rel = mins < 1 ? 'just now' : mins < 60 ? mins + ' min ago' : mins < 1440 ? Math.round(mins / 60) + ' h ago' : Math.round(mins / 1440) + ' days ago'
      return 'Last checked ' + rel + ' (' + new Date(t).toLocaleString() + ').'
    }
    const sync = () => {
      const u = app.updates
      const s = (u && u.state()) || {}
      const cur = s.current || ''
      const st = s.state || 'idle'
      let status = cur ? 'Plume ' + cur : 'Plume'
      let detail = u ? when(u.lastChecked()) : 'Updates are not available in this build.'
      if (st === 'checking') status = 'Checking for updates…'
      else if (st === 'available') {
        status = 'Plume ' + s.version + ' is available'
        detail = 'You have ' + cur + '. ' + (s.canInstall ? 'Update now downloads it, saves your documents and restarts Plume.' : 'This copy cannot update itself; Update now opens the download page.')
      } else if (st === 'downloading') {
        status = 'Updating to ' + (s.version || 'the new version') + '… ' + (s.percent || 0) + '%'
        detail = 'Your documents stay open and are saved before the restart.'
      } else if (st === 'ready') {
        status = 'Plume ' + s.version + ' is ready to install'
        detail = 'Restart to finish. Your documents are saved first.'
      } else if (st === 'error') {
        status = 'The last update check failed'
        detail = (s.error || 'Unknown error') + ' ' + when(u && u.lastChecked())
      } else if (st === 'none') {
        status = 'You are up to date'
        detail = 'Plume ' + cur + '. ' + (s.note || when(u && u.lastChecked()))
      } else if (cur) detail = 'Plume ' + cur + '. ' + detail
      statusEl.textContent = status
      detailEl.textContent = detail
      bar.hidden = st !== 'downloading'
      fill.style.width = (s.percent || 0) + '%'
      goBtn.hidden = st !== 'available'
      goBtn.textContent = s.canInstall === false ? 'Open download page' : 'Update now'
      restartBtn.hidden = st !== 'ready'
      checkBtn.disabled = st === 'checking' || st === 'downloading'
    }
    refreshers.push(sync)
    if (app.updates) {
      cleanups.push(app.updates.onChange(sync))
      app.updates.refresh()
    }

    const g2 = group('Checking')
    g2.appendChild(toggle('checkUpdates', 'Check for updates on launch', 'Plume asks GitHub once at startup whether a newer version exists. Turn off for zero network activity. Nothing is sent but the request itself.'))
    f.append(g, g2)
    return f
  }

  function secAbout() {
    const f = el('div', 'st-about')
    const logo = el('img', 'st-logo-img')
    logo.src = logoUrl
    logo.alt = 'Plume logo'
    logo.width = 72
    logo.height = 72
    f.appendChild(logo)
    f.appendChild(el('h2', 'st-name', 'Plume'))
    const ver = el('div', 'st-muted', 'Version')
    f.appendChild(ver)
    try {
      window.folio.getUpdateState().then((u) => { ver.textContent = 'Version ' + (u && u.current ? u.current : '') })
    } catch {}
    f.appendChild(secUpdates())
    f.appendChild(el('p', null, 'Free and open source. No telemetry.'))
    f.appendChild(el('div', 'st-muted', 'Released under the MIT licence.'))
    f.appendChild(btn('View on GitHub', '', () => window.open('https://github.com/SamuelNDCE/plume')))
    return f
  }

  const BUILD = { Appearance: secAppearance, Typography: secTypography, Editor: secEditor, Files: secFiles, Plugins: secPlugins, Shortcuts: secShortcuts, About: secAbout }

  function show(name) {
    current = name
    cleanups.forEach((fn) => { try { fn() } catch {} })
    cleanups = []
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
    return [...overlay.querySelectorAll('button, input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((n) => !n.disabled && n.offsetParent !== null)
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
    cleanups.forEach((fn) => { try { fn() } catch {} })
    cleanups = []
    refreshers = []
    o.classList.remove('in')
    if (reduced()) o.remove()
    else setTimeout(() => o.remove(), 150)
    if (prevFocus && prevFocus.focus) try { prevFocus.focus() } catch {}
  }

  app.bus.on('settings:change', () => { if (overlay) refresh() })
  app.commands.register({ id: 'settings.open', title: 'Open Settings', category: 'App', keys: 'Ctrl+,', run: open })
}
