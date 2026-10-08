// Timeline Block: one event per line, "date | label".
//
// ```timeline
// 2024 | Idea
// 2025 | Prototype
// 2026 | Launch
// ```
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

export function activate(api) {
  api.blocks.register('timeline', (code) => {
    const events = String(code)
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const i = l.indexOf('|')
        return i < 0 ? { date: '', label: l } : { date: l.slice(0, i).trim(), label: l.slice(i + 1).trim() }
      })
    if (!events.length) return '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="30"><text x="4" y="20" fill="currentColor">Empty timeline</text></svg>'
    const step = 150
    const w = 60 + step * (events.length - 1) + 60
    const y = 60
    const dots = events
      .map((e, k) => {
        const x = 60 + k * step
        const up = k % 2 === 0
        return (
          `<circle cx="${x}" cy="${y}" r="7" fill="currentColor"/>` +
          `<text x="${x}" y="${up ? y - 22 : y + 32}" text-anchor="middle" font-weight="700" font-size="14" fill="currentColor">${esc(e.date)}</text>` +
          `<text x="${x}" y="${up ? y - 6 - 30 + 14 : y + 50}" text-anchor="middle" font-size="13" fill="currentColor" opacity="0.8">${esc(e.label)}</text>`
        )
      })
      .join('')
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} 130" width="${w}" height="130" style="max-width:100%;height:auto">` +
      `<line x1="40" y1="${y}" x2="${w - 40}" y2="${y}" stroke="currentColor" stroke-width="3" opacity="0.4"/>${dots}</svg>`
    )
  })
}
