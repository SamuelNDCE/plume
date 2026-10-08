// Plume theme registry. Sets app.themes = { list, get, apply, register, unregister, onChange }.
// Built-in CSS themes live in themes.css; JS-defined ones are compiled to <style id="plume-theme-ID">.
// Schema + docs: docs/THEMES.md

const ID_RE = /^[a-z0-9-]{1,40}$/
const BAD_VALUE = /[;{}<]|url\s*\(|@import|expression\s*\(|javascript:/i

/* The 8 built-in themes. Their colours, typography and chart style live in themes.css (no flash on load);
   this table only carries the gallery preview data and the dark flag. Order: 4 light, then 4 dark. */
const CSS_THEMES = [
  { id: 'light', name: 'Light', dark: false, bg: '#ffffff', fg: '#1d1f23', accent: '#4f5bd5', colors: ['#3b6fd4', '#e07b1f', '#1f9d6b', '#b44fc7'] },
  { id: 'github', name: 'GitHub', dark: false, bg: '#ffffff', fg: '#1f2328', accent: '#0969da', colors: ['#0969da', '#bc4c00', '#1a7f37', '#8250df'] },
  { id: 'newsprint', name: 'Newsprint', dark: false, bg: '#f3f0ea', fg: '#141210', accent: '#b3141b', colors: ['#b3141b', '#1f3a5f', '#a87a12', '#2f6b4f'] },
  { id: 'sepia', name: 'Sepia', dark: false, bg: '#f6efdd', fg: '#3f3224', accent: '#a4532a', colors: ['#a4532a', '#2e7d6b', '#c28a1c', '#6f5aa8'] },
  { id: 'dark', name: 'Dark', dark: true, bg: '#1c1d20', fg: '#dcdee2', accent: '#5b9dff', colors: ['#5b9dff', '#f2a04a', '#4fcf9f', '#d68af0'] },
  { id: 'nord', name: 'Nord', dark: true, bg: '#2e3440', fg: '#d8dee9', accent: '#88c0d0', colors: ['#88c0d0', '#ebcb8b', '#a3be8c', '#b48ead'] },
  { id: 'dracula', name: 'Dracula', dark: true, bg: '#282a36', fg: '#f1f1ec', accent: '#bd93f9', colors: ['#bd93f9', '#ffb86c', '#50fa7b', '#ff79c6'] },
  { id: 'midnight', name: 'Midnight', dark: true, bg: '#0b1220', fg: '#cfd8e8', accent: '#2dd4bf', colors: ['#2dd4bf', '#fbbf6a', '#7aa7ff', '#c4a3f5'] },
]

const LIGHT_CHART = ['#3b6fd4', '#e07b1f', '#1f9d6b', '#b44fc7', '#b88f00', '#1c91b8', '#d6455d', '#6b7280']
const DARK_CHART = ['#8b95f7', '#f2a04a', '#4fcf9f', '#d68af0', '#e6c84b', '#5cc0ea', '#f0788a', '#a3a9b5']

/* JS-defined built-ins: none (all 8 are CSS themes). Kept so the register(def, 'Built-in') path stays available. */
const BUILTIN = []

export function init(app) {
  const root = document.documentElement
  const defs = new Map() // id -> { def, group, kind: 'css'|'js'|'user-css' }
  const listeners = new Set()
  const userCss = new Map() // file -> <style>
  let current = null

  /* ---------- helpers ---------- */
  const ensureStyle = (id) => {
    let el = document.getElementById(id)
    if (!el) {
      el = document.createElement('style')
      el.id = id
      document.head.appendChild(el)
    }
    return el
  }
  const cleanVars = (vars) => {
    const out = {}
    for (const [k, v] of Object.entries(vars || {})) {
      if (typeof k !== 'string' || !/^--[a-zA-Z0-9_-]+$/.test(k) || typeof v !== 'string' && typeof v !== 'number') {
        console.warn('[themes] ignored variable', k)
        continue
      }
      if (BAD_VALUE.test(String(v))) {
        console.warn('[themes] ignored unsafe value for', k)
        continue
      }
      out[k] = String(v)
    }
    return out
  }
  const safeStr = (v) => (typeof v === 'string' && !BAD_VALUE.test(v) ? v : null)
  const safeNum = (v) => (Number.isFinite(+v) && v !== '' && v !== null ? +v : null)

  /* def -> CSS text */
  function compile(def, allowCss) {
    const vars = cleanVars(def.vars)
    const t = def.typography || {}
    const c = def.chart || {}
    const set = (k, v) => v !== null && v !== undefined && (vars[k] = String(v))
    set('--font-body', safeStr(t.body))
    set('--font-heading', safeStr(t.heading))
    set('--font-mono', safeStr(t.mono))
    if (safeStr(t.mono)) vars['--mono-font'] = t.mono
    if (safeStr(t.body)) vars['--doc-font'] = t.body
    set('--h-weight', safeNum(t.headingWeight))
    set('--h-scale', safeNum(t.headingScale))
    set('--lh', safeNum(t.lineHeight))
    set('--p-space', safeNum(t.paragraphSpacing))
    if (safeNum(t.width) !== null) vars['--doc-width'] = safeNum(t.width) + 'px'
    const base = def.dark ? DARK_CHART : LIGHT_CHART
    const colors = Array.isArray(c.colors) ? c.colors : []
    for (let i = 0; i < 8; i++) {
      const col = /^#[0-9a-fA-F]{3,8}$/.test(colors[i] || '') ? colors[i] : base[i]
      vars['--chart-' + (i + 1)] = col
    }
    const go = safeNum(c.gridOpacity)
    vars['--chart-grid'] = `color-mix(in srgb, var(--fg) ${Math.round((go ?? (def.dark ? 0.14 : 0.1)) * 100)}%, transparent)`
    vars['--chart-radius'] = (safeNum(c.radius) ?? 3) + 'px'
    vars['--chart-stroke'] = String(safeNum(c.strokeWidth) ?? 2.5)
    vars['--chart-font'] = safeStr(c.font) || 'inherit'
    vars['--chart-style'] = c.style === 'sharp' ? 'sharp' : 'smooth'
    // derived defaults so partial themes still look right
    if (!vars['--ring']) vars['--ring'] = 'color-mix(in srgb, var(--accent) 45%, transparent)'
    if (!vars['--shadow-lg']) vars['--shadow-lg'] = def.dark ? '0 2px 8px rgba(0,0,0,.4), 0 22px 56px rgba(0,0,0,.55)' : '0 2px 6px rgba(20,22,30,.06), 0 18px 48px rgba(20,22,30,.16)'
    if (!vars['--shadow']) vars['--shadow'] = def.dark ? '0 1px 2px rgba(0,0,0,.3), 0 4px 16px rgba(0,0,0,.35)' : '0 1px 2px rgba(20,22,30,.05), 0 4px 14px rgba(20,22,30,.07)'
    const sel = `html[data-theme="${def.id}"]`
    const body = Object.entries(vars).map(([k, v]) => `${k}: ${v};`).join(' ')
    return `${sel} { color-scheme: ${def.dark ? 'dark' : 'light'}; ${body} }\n${allowCss && def.css ? def.css : ''}`
  }

  function emitChange() {
    listeners.forEach((cb) => {
      try {
        cb(list())
      } catch (e) {
        console.error('[themes] onChange', e)
      }
    })
    syncCommands()
  }

  function preview(entry) {
    const d = entry.def
    if (entry.kind === 'css') return { bg: d.bg, fg: d.fg, accent: d.accent, colors: d.colors }
    const v = d.vars || {}
    const colors = Array.isArray(d.chart?.colors) && d.chart.colors.length ? d.chart.colors.slice(0, 4) : (d.dark ? DARK_CHART : LIGHT_CHART).slice(0, 4)
    return { bg: v['--bg'] || (d.dark ? '#1c1d20' : '#ffffff'), fg: v['--fg'] || (d.dark ? '#dcdee2' : '#1d1f23'), accent: v['--accent'] || colors[0], colors }
  }

  function list() {
    return [...defs.values()].map((e) => ({ id: e.def.id, name: e.def.name, dark: !!e.def.dark, group: e.group, preview: preview(e) }))
  }
  const get = (id) => {
    const e = defs.get(id)
    return e ? { ...e.def, group: e.group } : null
  }

  function register(def, group = 'Custom') {
    if (!def || typeof def.id !== 'string' || !ID_RE.test(def.id) || typeof def.name !== 'string') throw new Error('theme needs id (a-z0-9-) and name')
    if (defs.get(def.id)?.kind === 'css') throw new Error('cannot replace built-in CSS theme ' + def.id)
    const isBuiltin = group === 'Built-in'
    const clean = { ...def, vars: cleanVars(def.vars) }
    if (!isBuiltin) delete clean.css // custom css only through .css files
    ensureStyle('plume-theme-' + def.id).textContent = compile(clean, isBuiltin)
    defs.set(def.id, { def: clean, group, kind: 'js' })
    if (current === def.id) apply(def.id) // live-update the active theme
    else emitChange()
    return def.id
  }

  function unregister(id) {
    const e = defs.get(id)
    if (!e || e.kind === 'css') return false
    document.getElementById('plume-theme-' + id)?.remove()
    defs.delete(id)
    if (current === id) apply('light')
    else emitChange()
    return true
  }

  /* ---------- user overrides ---------- */
  const OVERRIDE_KEYS = new Set(['fontBody', 'fontHeading', 'fontMono', 'headingScale', 'paraSpacing', 'accent', 'customCss', 'chartStyle'])
  function applyOverrides() {
    const s = app.settings
    const st = root.style
    const setOrClear = (prop, val) => (val ? st.setProperty(prop, val) : st.removeProperty(prop))
    const fam = (v) => (typeof v === 'string' && v.trim() && !BAD_VALUE.test(v) ? v.trim() : '')
    setOrClear('--font-body', fam(s.get('fontBody')))
    setOrClear('--font-heading', fam(s.get('fontHeading')))
    setOrClear('--font-mono', fam(s.get('fontMono')))
    if (fam(s.get('fontMono'))) st.setProperty('--mono-font', fam(s.get('fontMono')))
    else st.removeProperty('--mono-font')
    const hs = +s.get('headingScale')
    setOrClear('--h-scale', hs > 0 ? String(hs) : '')
    const ps = +s.get('paraSpacing')
    setOrClear('--p-space', ps > 0 ? String(ps) : '')
    const acc = s.get('accent')
    const okAcc = typeof acc === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(acc.trim()) ? acc.trim() : ''
    setOrClear('--accent', okAcc)
    setOrClear('--ring', okAcc ? 'color-mix(in srgb, var(--accent) 45%, transparent)' : '')
    const css = s.get('customCss')
    const el = document.getElementById('plume-custom-css')
    if (typeof css === 'string' && css.trim()) ensureStyle('plume-custom-css').textContent = css
    else if (el) el.textContent = ''
    const cs = s.get('chartStyle')
    if (cs === 'sharp' || cs === 'smooth') root.dataset.chartStyle = cs
    else delete root.dataset.chartStyle
  }

  /* ---------- apply ---------- */
  function apply(id) {
    if (!defs.has(id)) id = 'light'
    const e = defs.get(id)
    current = id
    root.dataset.theme = id
    root.style.colorScheme = e.def.dark ? 'dark' : 'light'
    if (app.settings.get('theme') !== id) app.settings.set('theme', id)
    applyOverrides()
    requestAnimationFrame(() => {
      try {
        window.folio?.setThemeBg?.(getComputedStyle(document.body).backgroundColor, !!e.def.dark)
      } catch {}
    })
    app.bus.emit('theme:change', { id })
    emitChange()
  }

  /* ---------- commands ---------- */
  const themeCmds = new Set()
  function syncCommands() {
    // Commands has no unregister: re-registering an id replaces it, stale ones just point at a missing theme and no-op.
    for (const t of list()) {
      themeCmds.add(t.id)
      app.commands.register({ id: 'theme.' + t.id, title: 'Theme: ' + t.name + (current === t.id ? ' (current)' : ''), category: 'Theme', run: () => apply(t.id) })
    }
    for (const id of themeCmds) if (!defs.has(id)) app.commands.register({ id: 'theme.' + id, title: 'Theme: ' + id + ' (removed)', category: 'Theme', run: () => {} })
  }
  app.commands.register({
    id: 'theme.next', title: 'Next theme', category: 'Theme', keys: 'Ctrl+Alt+T',
    run: () => {
      const ids = list().map((t) => t.id)
      apply(ids[(ids.indexOf(current) + 1) % ids.length])
    },
  })
  app.commands.register({ id: 'theme.reload', title: 'Reload custom themes', category: 'Theme', run: () => loadUser().then(() => app.toast?.('Custom themes reloaded')) })
  app.commands.register({ id: 'theme.openFolder', title: 'Open themes folder', category: 'Theme', run: () => window.folio?.openThemesFolder?.() })

  /* ---------- user themes ---------- */
  async function loadUser() {
    for (const [id, e] of [...defs]) if (e.group === 'Custom') { document.getElementById('plume-theme-' + id)?.remove(); defs.delete(id) }
    userCss.forEach((el) => el.remove())
    userCss.clear()
    let files = []
    try {
      files = (await window.folio?.listUserThemes?.()) || []
    } catch (e) {
      console.warn('[themes] could not list user themes', e)
    }
    for (const f of files) {
      try {
        if (f.kind === 'json') {
          const def = JSON.parse(f.text)
          if (!def || typeof def.id !== 'string' || !ID_RE.test(def.id) || typeof def.name !== 'string' || !def.vars || typeof def.vars !== 'object') throw new Error('needs id (a-z0-9-), name, vars')
          if (defs.has(def.id) && defs.get(def.id).group !== 'Custom') throw new Error('id clashes with a built-in theme')
          register({ id: def.id, name: def.name, dark: !!def.dark, vars: def.vars, typography: def.typography, chart: def.chart, mermaid: def.mermaid }, 'Custom')
        } else if (f.kind === 'css') {
          const el = document.createElement('style')
          el.id = 'plume-user-css-' + String(f.file).replace(/[^a-z0-9]/gi, '_')
          el.textContent = f.text
          document.head.appendChild(el)
          userCss.set(f.file, el)
          // optional header: /* plume-theme: my-id | My Name | dark */
          const m = /^\s*\/\*\s*plume-theme:\s*([a-z0-9-]+)\s*\|\s*([^|*]+?)\s*(?:\|\s*(dark|light)\s*)?\*\//.exec(f.text)
          if (m && !defs.has(m[1])) defs.set(m[1], { def: { id: m[1], name: m[2], dark: m[3] === 'dark', vars: {} }, group: 'Custom', kind: 'user-css' })
        }
      } catch (e) {
        console.warn('[themes] ignored', f.file, '-', e.message)
      }
    }
    if (current && !defs.has(current)) apply('light')
    else emitChange()
  }

  /* ---------- wire up ---------- */
  CSS_THEMES.forEach((t) => defs.set(t.id, { def: t, group: 'Built-in', kind: 'css' }))
  BUILTIN.forEach((t) => register(t, 'Built-in'))

  app.themes = { list, get, apply, register, unregister, onChange: (cb) => (listeners.add(cb), () => listeners.delete(cb)) }

  app.bus.on('settings:change', ({ key, value }) => {
    if (OVERRIDE_KEYS.has(key)) {
      applyOverrides()
      app.bus.emit('theme:change', { id: current, override: key })
    } else if (key === 'theme' && value !== current && defs.has(value)) apply(value)
  })

  syncCommands()
  // Saved theme ids that no longer exist (removed built-ins, deleted custom themes) fall back to 'light'.
  return loadUser().then(() => {
    const saved = app.settings.get('theme')
    apply(defs.has(saved) ? saved : 'light')
  })
}
