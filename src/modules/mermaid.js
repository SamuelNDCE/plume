import { Crepe } from '@milkdown/crepe'

// Mermaid (lazy) + dependency-free ```chart blocks + plugin blocks (app.blocks), rendered via Crepe code-block renderPreview.
// Look comes from the theme's CSS variables (--chart-1..8, --chart-grid, --chart-radius, --chart-stroke, --chart-font, --chart-style).
const FALLBACK_DARK = new Set(['dark', 'nord', 'dracula', 'midnight'])
const PALETTE = Array.from({ length: 8 }, (_, i) => 'var(--chart-' + (i + 1) + ')')
const cache = new Map() // "themeSig|src" -> svg string
let app = null
let mermaidP = null
let mermaidSig = null
let seq = 0
let queue = Promise.resolve()

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const root = () => document.documentElement
const isDark = () => {
  const id = root().dataset.theme
  const d = app?.themes?.get?.(id)
  return d ? !!d.dark : FALLBACK_DARK.has(id)
}
const cssVar = (n) => getComputedStyle(root()).getPropertyValue(n).trim()
const chartStyle = () => root().dataset.chartStyle || cssVar('--chart-style') || 'smooth'

/* ---------- colour helpers: resolve any CSS colour to [r,g,b,a] via canvas, mix in JS (mermaid cannot parse color-mix) ---------- */
let ctx2d = null
function rgba(val, fb = [128, 128, 128, 1]) {
  try {
    ctx2d ||= document.createElement('canvas').getContext('2d')
    ctx2d.fillStyle = '#000'
    ctx2d.fillStyle = val
    const c = ctx2d.fillStyle
    if (c[0] === '#') return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16), 1]
    const m = c.match(/[\d.]+/g)
    return m ? [+m[0], +m[1], +m[2], m[3] === undefined ? 1 : +m[3]] : fb
  } catch {
    return fb
  }
}
const hex = ([r, g, b]) => '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')
const mix = (a, b, t) => hex([0, 1, 2].map((i) => a[i] * t + b[i] * (1 - t)))

/* Mermaid themeVariables from live CSS variables, merged over the active theme's own overrides. */
function mermaidVars() {
  const bg = rgba(cssVar('--bg'))
  const fg = rgba(cssVar('--fg'))
  const muted = rgba(cssVar('--fg-muted'))
  const accent = rgba(cssVar('--accent'))
  const bg2 = rgba(cssVar('--bg-2'))
  const c = (i) => rgba(cssVar('--chart-' + i))
  let font = cssVar('--chart-font')
  if (!font || font === 'inherit') font = getComputedStyle(document.body).fontFamily
  const v = {
    darkMode: isDark(),
    background: hex(bg),
    fontFamily: font,
    primaryColor: mix(accent, bg, 0.16),
    primaryTextColor: hex(fg),
    primaryBorderColor: mix(accent, bg, 0.7),
    secondaryColor: mix(c(2), bg, 0.18),
    tertiaryColor: hex(bg2),
    lineColor: hex(muted),
    textColor: hex(fg),
    mainBkg: mix(accent, bg, 0.16),
    nodeBorder: mix(accent, bg, 0.7),
    clusterBkg: hex(bg2),
    clusterBorder: mix(fg, bg, 0.25),
    titleColor: hex(fg),
    edgeLabelBackground: hex(bg),
    noteBkgColor: mix(c(5), bg, 0.2),
    noteTextColor: hex(fg),
  }
  for (let i = 1; i <= 8; i++) v['pie' + i] = hex(c(i))
  const own = app?.themes?.get?.(root().dataset.theme)?.mermaid?.themeVariables
  return { ...v, ...(own && typeof own === 'object' ? own : {}) }
}
const themeSig = () => {
  try {
    return JSON.stringify(mermaidVars())
  } catch {
    return root().dataset.theme || ''
  }
}

function errorBox(msg) {
  const d = document.createElement('div')
  d.className = 'folio-diagram-error'
  d.textContent = msg
  return d
}

async function getMermaid() {
  mermaidP ||= import('mermaid').then((m) => m.default || m)
  const mm = await mermaidP
  const sig = themeSig()
  if (mermaidSig !== sig) {
    mm.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'base', themeVariables: mermaidVars() })
    mermaidSig = sig
  }
  return mm
}

async function renderMermaid(src, apply) {
  const key = themeSig() + '|' + src
  if (cache.has(key)) return apply(wrap(cache.get(key), 'mermaid', src))
  try {
    const mm = await getMermaid()
    const { svg } = await mm.render('folio-mm-' + ++seq, src)
    if (cache.size > 60) cache.clear()
    cache.set(key, svg)
    apply(wrap(svg, 'mermaid', src))
  } catch (e) {
    document.getElementById('dfolio-mm-' + seq)?.remove()
    apply(errorBox('Mermaid error: ' + String(e?.message || e).split('\n')[0]))
  }
}

function wrap(svg, kind, src, lang) {
  const d = document.createElement('div')
  d.className = 'folio-diagram'
  d.innerHTML = svg
  if (kind) {
    d.dataset.kind = kind
    d.dataset.src = src
    if (lang) d.dataset.lang = lang
  }
  return d
}

/* ---------- plugin blocks (app.blocks: lang -> (code, ctx) => HTMLElement | SVG/HTML string | Promise) ---------- */
// Minimal sanitiser for strings returned by plugin renderers.
function sanitize(str) {
  const doc = new DOMParser().parseFromString(String(str), 'text/html')
  doc.querySelectorAll('script,iframe,object,embed,link,meta,foreignObject').forEach((n) => n.remove())
  doc.body.querySelectorAll('*').forEach((el) => {
    for (const a of [...el.attributes]) {
      const bad = /^on/i.test(a.name) || (/^(href|src|xlink:href)$/i.test(a.name) && /^\s*(javascript|data):/i.test(a.value))
      if (bad) el.removeAttribute(a.name)
    }
  })
  return doc.body.innerHTML
}

function blockToElement(res, lang, code) {
  if (res instanceof Element) {
    res.dataset.kind = 'block'
    res.dataset.src = code
    res.dataset.lang = lang
    return res
  }
  return wrap(sanitize(res ?? ''), 'block', code, lang)
}

function runBlock(lang, code) {
  const dark = isDark()
  try {
    const out = app.blocks.get(lang)(code, { app, dark, isDark: dark })
    if (out && typeof out.then === 'function') return out.then((r) => blockToElement(r, lang, code)).catch((e) => errorBox(lang + ' error: ' + (e?.message || e)))
    return blockToElement(out, lang, code)
  } catch (e) {
    return errorBox(lang + ' error: ' + (e?.message || e))
  }
}

/* ---------- chart ---------- */
const num = (v) => (Number.isFinite(+v) ? +v : 0)
const fmt = (n) => (Math.abs(n) >= 1000 ? +(n / 1000).toFixed(1) + 'k' : +n.toFixed(2) + '')

function niceMax(max) {
  if (max <= 0) return 1
  const p = Math.pow(10, Math.floor(Math.log10(max)))
  const f = max / p
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p
}

// Catmull-Rom -> cubic bezier through all points (smooth style)
function smoothPath(pts) {
  if (pts.length < 3) return pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')
  let d = 'M' + pts[0][0].toFixed(1) + ',' + pts[0][1].toFixed(1)
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`
  }
  return d
}

function chartSvg(spec) {
  const type = String(spec.type || 'bar').toLowerCase()
  const sharp = chartStyle() === 'sharp'
  const labels = (spec.labels || []).map(String)
  const sets = (spec.datasets || []).map((d, i) => ({ label: d.label || 'Series ' + (i + 1), data: (d.data || []).map(num), color: PALETTE[i % PALETTE.length] }))
  if (!sets.length) throw new Error('chart needs at least one dataset')
  const n = Math.max(labels.length, ...sets.map((s) => s.data.length))
  const W = 640
  const H = 360
  const sw = 'style="stroke-width:var(--chart-stroke)"'
  const title = spec.title ? `<text x="${W / 2}" y="22" text-anchor="middle" font-size="15" font-weight="600" fill="currentColor">${esc(spec.title)}</text>` : ''
  let body = ''
  let legend = []

  if (type === 'pie') {
    const data = sets[0].data
    const total = data.reduce((a, b) => a + Math.max(b, 0), 0) || 1
    const cx = 200, cy = 200, r = 120
    let a0 = -Math.PI / 2
    data.forEach((v, i) => {
      const frac = Math.max(v, 0) / total
      const a1 = a0 + frac * Math.PI * 2
      const col = PALETTE[i % PALETTE.length]
      const tip = `<title>${esc(labels[i] ?? 'Item ' + (i + 1))}: ${fmt(v)} (${(frac * 100).toFixed(1)}%)</title>`
      if (frac >= 0.9999) body += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${col}">${tip}</circle>`
      else if (frac > 0) {
        const [x0, y0, x1, y1] = [cx + r * Math.cos(a0), cy + r * Math.sin(a0), cx + r * Math.cos(a1), cy + r * Math.sin(a1)]
        body += `<path d="M${cx},${cy} L${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${frac > 0.5 ? 1 : 0} 1 ${x1.toFixed(2)},${y1.toFixed(2)} Z" fill="${col}" stroke="var(--bg)" stroke-width="${sharp ? 1 : 2}" stroke-linejoin="${sharp ? 'miter' : 'round'}">${tip}</path>`
      }
      a0 = a1
    })
    legend = data.map((v, i) => ({ label: `${labels[i] ?? 'Item ' + (i + 1)} (${((Math.max(v, 0) / total) * 100).toFixed(0)}%)`, color: PALETTE[i % PALETTE.length] }))
    legend.x = 380
  } else {
    const m = { l: 48, r: 16, t: spec.title ? 38 : 16, b: 52 }
    const pw = W - m.l - m.r
    const ph = H - m.t - m.b
    const all = sets.flatMap((s) => s.data)
    const top = niceMax(Math.max(0, ...all))
    const bottom = Math.min(0, ...all) < 0 ? -niceMax(-Math.min(...all)) : 0
    const y = (v) => m.t + ph - ((v - bottom) / (top - bottom)) * ph
    for (let i = 0; i <= 5; i++) {
      const v = bottom + ((top - bottom) * i) / 5
      body += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" style="stroke:var(--chart-grid)" stroke-width="1"/><text x="${m.l - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--fg-muted)">${fmt(v)}</text>`
    }
    body += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(0)}" y2="${y(0)}" stroke="var(--fg-muted)"/>`
    const bandW = pw / n
    const xc = (i) => m.l + bandW * (i + 0.5)
    for (let i = 0; i < n; i++) body += `<text x="${xc(i)}" y="${H - m.b + 16}" text-anchor="middle" font-size="11" fill="var(--fg-muted)">${esc((labels[i] ?? i + 1).toString().slice(0, 14))}</text>`
    if (type === 'bar') {
      const bw = Math.min(48, (bandW * 0.8) / sets.length)
      const rx = sharp ? 'rx:0' : 'rx:var(--chart-radius)'
      sets.forEach((s, si) =>
        s.data.forEach((v, i) => {
          const x = xc(i) - (bw * sets.length) / 2 + si * bw
          const y0 = y(0), y1 = y(v)
          body += `<rect x="${x.toFixed(1)}" y="${Math.min(y0, y1).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${Math.abs(y0 - y1).toFixed(1)}" style="${rx}" fill="${s.color}"><title>${esc(s.label)} / ${esc(labels[i] ?? i + 1)}: ${fmt(v)}</title></rect>`
        }),
      )
    } else {
      sets.forEach((s) => {
        const pts = s.data.map((v, i) => [xc(i), y(v)])
        const line = sharp ? pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ') : smoothPath(pts)
        if (type === 'area' && pts.length) body += `<path d="${line} L${pts[pts.length - 1][0].toFixed(1)},${y(0)} L${pts[0][0].toFixed(1)},${y(0)} Z" fill="${s.color}" opacity="0.22"/>`
        body += `<path d="${line}" fill="none" stroke="${s.color}" ${sw} stroke-linejoin="${sharp ? 'miter' : 'round'}" stroke-linecap="${sharp ? 'butt' : 'round'}"/>`
        s.data.forEach((v, i) => {
          const tip = `<title>${esc(s.label)} / ${esc(labels[i] ?? i + 1)}: ${fmt(v)}</title>`
          body += sharp
            ? `<rect x="${(pts[i][0] - 3.5).toFixed(1)}" y="${(pts[i][1] - 3.5).toFixed(1)}" width="7" height="7" fill="${s.color}" stroke="var(--bg)" stroke-width="1.5">${tip}</rect>`
            : `<circle cx="${pts[i][0].toFixed(1)}" cy="${pts[i][1].toFixed(1)}" r="4" fill="${s.color}" stroke="var(--bg)" stroke-width="1.5">${tip}</circle>`
        })
      })
    }
    legend = sets.map((s) => ({ label: s.label, color: s.color }))
  }

  let lg = ''
  if (legend.length && (type === 'pie' || sets.length > 1 || spec.legend)) {
    legend.forEach((l, i) => {
      const lx = legend.x ?? 16 + i * 120
      const ly = legend.x ? 100 + i * 22 : H - 10
      lg += `<rect x="${lx}" y="${ly - 9}" width="11" height="11" style="rx:${sharp ? 0 : 2}px" fill="${l.color}"/><text x="${lx + 16}" y="${ly}" font-size="12" fill="currentColor">${esc(l.label)}</text>`
    })
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" style="max-width:${W}px;color:var(--fg);font-family:var(--chart-font,inherit)">${title}${body}${lg}</svg>`
}

function renderChart(src) {
  try {
    return wrap(chartSvg(JSON.parse(src)), 'chart', src)
  } catch (e) {
    return errorBox('Chart error: ' + (e?.message || e))
  }
}

/* ---------- re-render everything visible when the look changes ---------- */
let rerenderQueued = false
function rerenderAll() {
  if (rerenderQueued) return
  rerenderQueued = true
  requestAnimationFrame(() => {
    rerenderQueued = false
    document.querySelectorAll('.folio-diagram[data-kind]').forEach((el) => {
      const { kind, src, lang } = el.dataset
      if (!src) return
      if (kind === 'chart') {
        const next = renderChart(src)
        if (next.dataset.kind) el.innerHTML = next.innerHTML
      } else if (kind === 'mermaid') {
        queue = queue.then(() =>
          renderMermaid(src, (node) => {
            if (el.isConnected && node.dataset?.kind) el.innerHTML = node.innerHTML
          }),
        )
      } else if (kind === 'block' && app?.blocks?.has(lang)) {
        Promise.resolve(runBlock(lang, src)).then((node) => {
          if (el.isConnected && node?.dataset?.kind) {
            el.innerHTML = node.innerHTML
          }
        })
      }
    })
  })
}

/* ---------- Crepe wiring ---------- */
export function crepeConfig() {
  return {
    [Crepe.Feature.CodeMirror]: {
      renderPreview(language, content, applyPreview) {
        const lang = (language || '').toLowerCase()
        if (!content.trim()) return null
        // plugin-provided block types win over built-ins
        if (app?.blocks?.has(lang)) {
          const out = runBlock(lang, content)
          if (out && typeof out.then === 'function') {
            out.then(applyPreview)
            return undefined
          }
          return out
        }
        if (lang === 'chart') return renderChart(content)
        if (lang === 'mermaid') {
          const key = themeSig() + '|' + content
          if (cache.has(key)) return wrap(cache.get(key), 'mermaid', content)
          // renders are serialised (mermaid.render is not re-entrant); cache makes repeats free
          queue = queue.then(() => renderMermaid(content, applyPreview))
          return undefined
        }
        return null
      },
    },
  }
}

export function init(a) {
  app = a
  app.bus.on('theme:change', rerenderAll)
  app.bus.on('settings:change', ({ key }) => {
    if (key === 'chartStyle' || key === 'accent') rerenderAll()
  })
}
