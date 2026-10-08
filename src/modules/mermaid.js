import { Crepe } from '@milkdown/crepe'

// Mermaid (lazy) + dependency-free ```chart blocks, rendered via Crepe code-block renderPreview.
const DARK = new Set(['dark', 'nord', 'dracula', 'midnight', 'solarized-dark'])
const PALETTE = ['var(--accent)', '#e8833a', '#2fa57a', '#c05bd6', '#d9b12b', '#4aa3df', '#e0586b']
const cache = new Map() // "theme|src" -> svg string
let mermaidP = null
let mermaidTheme = null
let seq = 0
let queue = Promise.resolve()

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const theme = () => (DARK.has(document.documentElement.dataset.theme) ? 'dark' : 'default')

function errorBox(msg) {
  const d = document.createElement('div')
  d.className = 'folio-diagram-error'
  d.textContent = msg
  return d
}

async function getMermaid() {
  mermaidP ||= import('mermaid').then((m) => m.default || m)
  const mm = await mermaidP
  const t = theme()
  if (mermaidTheme !== t) {
    mm.initialize({ startOnLoad: false, securityLevel: 'strict', theme: t })
    mermaidTheme = t
  }
  return mm
}

async function renderMermaid(src, apply) {
  const key = theme() + '|' + src
  if (cache.has(key)) return apply(wrap(cache.get(key)))
  try {
    const mm = await getMermaid()
    const { svg } = await mm.render('folio-mm-' + ++seq, src)
    if (cache.size > 60) cache.clear()
    cache.set(key, svg)
    apply(wrap(svg))
  } catch (e) {
    document.getElementById('dfolio-mm-' + seq)?.remove()
    apply(errorBox('Mermaid error: ' + String(e?.message || e).split('\n')[0]))
  }
}

function wrap(svg) {
  const d = document.createElement('div')
  d.className = 'folio-diagram'
  d.innerHTML = svg
  return d
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

function chartSvg(spec) {
  const type = String(spec.type || 'bar').toLowerCase()
  const labels = (spec.labels || []).map(String)
  const sets = (spec.datasets || []).map((d, i) => ({ label: d.label || 'Series ' + (i + 1), data: (d.data || []).map(num), color: PALETTE[i % PALETTE.length] }))
  if (!sets.length) throw new Error('chart needs at least one dataset')
  const n = Math.max(labels.length, ...sets.map((s) => s.data.length))
  const W = 640
  const H = 360
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
        body += `<path d="M${cx},${cy} L${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${frac > 0.5 ? 1 : 0} 1 ${x1.toFixed(2)},${y1.toFixed(2)} Z" fill="${col}" stroke="var(--bg)" stroke-width="2">${tip}</path>`
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
      body += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--border)" stroke-width="1"/><text x="${m.l - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--fg-muted)">${fmt(v)}</text>`
    }
    body += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(0)}" y2="${y(0)}" stroke="var(--fg-muted)"/>`
    const bandW = pw / n
    const xc = (i) => m.l + bandW * (i + 0.5)
    for (let i = 0; i < n; i++) body += `<text x="${xc(i)}" y="${H - m.b + 16}" text-anchor="middle" font-size="11" fill="var(--fg-muted)">${esc((labels[i] ?? i + 1).toString().slice(0, 14))}</text>`
    if (type === 'bar') {
      const bw = Math.min(48, (bandW * 0.8) / sets.length)
      sets.forEach((s, si) =>
        s.data.forEach((v, i) => {
          const x = xc(i) - (bw * sets.length) / 2 + si * bw
          const y0 = y(0), y1 = y(v)
          body += `<rect x="${x.toFixed(1)}" y="${Math.min(y0, y1).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${Math.abs(y0 - y1).toFixed(1)}" rx="2" fill="${s.color}"><title>${esc(s.label)} / ${esc(labels[i] ?? i + 1)}: ${fmt(v)}</title></rect>`
        }),
      )
    } else {
      sets.forEach((s) => {
        const pts = s.data.map((v, i) => [xc(i), y(v)])
        const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')
        if (type === 'area' && pts.length) body += `<path d="${line} L${pts[pts.length - 1][0].toFixed(1)},${y(0)} L${pts[0][0].toFixed(1)},${y(0)} Z" fill="${s.color}" opacity="0.22"/>`
        body += `<path d="${line}" fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linejoin="round"/>`
        s.data.forEach((v, i) => (body += `<circle cx="${pts[i][0].toFixed(1)}" cy="${pts[i][1].toFixed(1)}" r="4" fill="${s.color}" stroke="var(--bg)" stroke-width="1.5"><title>${esc(s.label)} / ${esc(labels[i] ?? i + 1)}: ${fmt(v)}</title></circle>`))
      })
    }
    legend = sets.map((s) => ({ label: s.label, color: s.color }))
  }

  let lg = ''
  if (legend.length && (type === 'pie' || sets.length > 1 || spec.legend)) {
    legend.forEach((l, i) => {
      const lx = legend.x ?? 16 + i * 120
      const ly = legend.x ? 100 + i * 22 : H - 10
      lg += `<rect x="${lx}" y="${ly - 9}" width="11" height="11" rx="2" fill="${l.color}"/><text x="${lx + 16}" y="${ly}" font-size="12" fill="currentColor">${esc(l.label)}</text>`
    })
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" font-family="inherit" style="max-width:${W}px;color:var(--fg)">${title}${body}${lg}</svg>`
}

function renderChart(src) {
  try {
    return wrap(chartSvg(JSON.parse(src)))
  } catch (e) {
    return errorBox('Chart error: ' + (e?.message || e))
  }
}

/* ---------- Crepe wiring ---------- */
export function crepeConfig() {
  return {
    [Crepe.Feature.CodeMirror]: {
      renderPreview(language, content, applyPreview) {
        const lang = (language || '').toLowerCase()
        if (!content.trim()) return null
        if (lang === 'chart') return renderChart(content)
        if (lang === 'mermaid') {
          const key = theme() + '|' + content
          if (cache.has(key)) return wrap(cache.get(key))
          // renders are serialised (mermaid.render is not re-entrant); cache makes repeats free
          queue = queue.then(() => renderMermaid(content, applyPreview))
          return undefined
        }
        return null
      },
    },
  }
}

export function init(app) {
  // Diagram theme follows the app theme; cache is keyed by theme so a switch re-renders on next edit/remount.
  app.bus.on('settings:change', ({ key }) => {
    if (key === 'theme') cache.clear()
  })
}
