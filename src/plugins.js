// Plugin host. Plugins are ordinary JavaScript running in the app window (NOT a sandbox); see docs/PLUGINS.md.
const API_VERSION = '0.1.0'

const cmpVer = (a, b) => {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0)
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0)
  return 0
}

// Strip scripts, event handlers and external hrefs from an inline SVG string.
function sanitizeSvg(svg) {
  const doc = new DOMParser().parseFromString(String(svg || ''), 'image/svg+xml')
  const root = doc.documentElement
  if (!root || root.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) return null
  root.querySelectorAll('script, foreignObject, iframe, object, embed').forEach((n) => n.remove())
  for (const el of [root, ...root.querySelectorAll('*')]) {
    for (const a of [...el.attributes]) {
      const n = a.name.toLowerCase()
      const v = a.value.trim()
      if (n.startsWith('on') || ((n === 'href' || n === 'xlink:href') && !v.startsWith('#'))) el.removeAttribute(a.name)
    }
  }
  return root
}

export async function initPlugins(app) {
  const loaded = new Map() // id -> { mod, cleanups[], manifest }
  const bridge = window.folio || {}

  const list = async () => {
    try {
      return (await bridge.listPlugins?.()) || []
    } catch (e) {
      console.error('[plugins] list failed', e)
      return []
    }
  }

  function fail(id, e) {
    console.error(`[plugin ${id}]`, e)
    app.toast(`Plugin ${id} failed: ${e && e.message ? e.message : e}`)
  }
  function safe(id, fn) {
    try {
      const r = fn()
      if (r && typeof r.catch === 'function') r.catch((e) => fail(id, e))
      return r
    } catch (e) {
      fail(id, e)
    }
  }

  const cleanupOf = (id) => {
    const rec = loaded.get(id)
    if (!rec) return
    try {
      rec.mod?.deactivate?.()
    } catch (e) {
      console.error(`[plugin ${id}] deactivate`, e)
    }
    for (const fn of [...rec.cleanups].reverse()) {
      try {
        fn()
      } catch (e) {
        console.error(`[plugin ${id}] cleanup`, e)
      }
    }
    loaded.delete(id)
  }

  function makeApi(manifest, cleanups) {
    const id = manifest.id
    const track = (fn) => {
      cleanups.push(fn)
      return fn
    }
    const ns = `plume.plugin.${id}.`
    return {
      version: API_VERSION,
      id,
      commands: {
        register({ id: cid, title, category, keys, run }) {
          const full = `plugin.${id}.${cid}`
          app.commands.register({ id: full, title, category: category || manifest.name, keys, run: () => safe(id, () => run()) })
          track(() => app.commands.items && app.commands.items.delete(full))
          return full
        },
      },
      on(evt, fn) {
        const off = app.bus.on(evt, (d) => safe(id, () => fn(d)))
        track(off)
        return off
      },
      editor: {
        getMarkdown: () => app.getMarkdown(),
        setMarkdown: (md) => app.setMarkdown(String(md)),
        insertText(t) {
          if (app.state.mode === 'source' && app.code) app.code.insert(String(t))
          else document.execCommand('insertText', false, String(t))
        },
        getSelection() {
          if (app.state.mode === 'source' && app.code) return app.code.getSelection()
          return String(window.getSelection() || '')
        },
        activeDoc() {
          const d = app.state.tabs[app.state.active]
          return d ? { name: d.name, path: d.path || null, kind: d.kind, dirty: !!d.dirty } : null
        },
      },
      themes: {
        register(def) {
          const r = app.themes && app.themes.register(def)
          if (def && def.id && app.themes && app.themes.unregister) track(() => app.themes.unregister(def.id))
          return r
        },
        apply: (tid) => app.themes && app.themes.apply(tid),
      },
      blocks: {
        register(lang, renderFn) {
          const key = String(lang).toLowerCase()
          app.blocks.set(key, renderFn)
          track(() => {
            if (app.blocks.get(key) === renderFn) app.blocks.delete(key)
          })
        },
      },
      ui: {
        toast: (msg) => app.toast(String(msg)),
        addStatusItem({ id: sid, render, onUpdate }) {
          const el = document.createElement('span')
          el.className = 'plugin-status-item'
          el.dataset.plugin = id
          el.dataset.item = sid
          (document.getElementById('status-right') || document.getElementById('statusbar'))?.appendChild(el)
          const update = () => safe(id, () => (onUpdate || render)(el))
          safe(id, () => render(el))
          const remove = () => el.remove()
          track(remove)
          return { update, remove }
        },
        addHeaderButton({ id: bid, title, icon, run }) {
          const btn = document.createElement('button')
          btn.className = 'icon-btn plugin-header-btn'
          btn.type = 'button'
          btn.title = title || bid
          btn.setAttribute('aria-label', title || bid)
          btn.dataset.plugin = id
          const svg = icon ? sanitizeSvg(icon) : null
          if (svg) btn.appendChild(document.importNode(svg, true))
          else btn.textContent = String(title || bid).slice(0, 1).toUpperCase()
          btn.addEventListener('click', () => safe(id, () => run()))
          document.getElementById('header-actions')?.appendChild(btn)
          const remove = () => btn.remove()
          track(remove)
          return { remove }
        },
        addStyles(css) {
          const s = document.createElement('style')
          s.dataset.plugin = id
          s.textContent = String(css)
          document.head.appendChild(s)
          track(() => s.remove())
        },
      },
      storage: {
        get(k) {
          try {
            const v = localStorage.getItem(ns + k)
            return v == null ? undefined : JSON.parse(v)
          } catch {
            return undefined
          }
        },
        set(k, v) {
          try {
            localStorage.setItem(ns + k, JSON.stringify(v))
          } catch {}
        },
      },
    }
  }

  async function activate(manifest) {
    const cleanups = []
    loaded.set(manifest.id, { mod: null, cleanups, manifest })
    try {
      if (manifest.minPlumeVersion && cmpVer(manifest.minPlumeVersion, API_VERSION) > 0) {
        throw new Error(`needs Plume ${manifest.minPlumeVersion} or newer`)
      }
      const main = manifest.main.split('/').map(encodeURIComponent).join('/')
      const mod = await import(/* @vite-ignore */ `plume-plugin://${manifest.id}/${main}`)
      loaded.get(manifest.id).mod = mod
      const fn = typeof mod.activate === 'function' ? mod.activate : typeof mod.default === 'function' ? mod.default : null
      if (!fn) throw new Error('no activate(api) export')
      await fn(makeApi(manifest, cleanups))
    } catch (e) {
      fail(manifest.id, e)
      cleanupOf(manifest.id)
    }
  }

  app.plugins = {
    list,
    loaded: () => [...loaded.keys()],
    reload() {
      app.toast('Restart Plume to apply plugin changes')
    },
  }

  app.commands.register({
    id: 'plugins.openFolder',
    title: 'Open plugins folder',
    category: 'Plugins',
    run: () => bridge.openPluginsFolder?.(),
  })

  if (!app.settings.get('pluginsConsent')) return

  for (const p of await list()) {
    if (p.enabled && p.valid) await activate(p)
    else if (p.enabled) console.warn(`[plugins] ${p.id} invalid: ${p.error}`)
  }
  window.addEventListener('beforeunload', () => [...loaded.keys()].forEach(cleanupOf))
}
