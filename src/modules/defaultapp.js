// First-run bubble (Windows only): offers to open the Windows Default apps page, once. It is a window-level card at the bottom left
// (12px from the bottom, 12px right of the icon rail), so it stays visible whatever the sidebar does, until the user answers. A question-mark button at the end of the title opens a short
// popover (click it again or press Escape to close). Either main button sets defaultAppPrompted, so the bubble never returns
// on its own. Settings > Files has the same action for later. The IPC handler opens a fixed page, never a renderer URL.
function el(tag, cls, text) {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text != null) e.textContent = text
  return e
}

export function init(app) {
  const api = window.folio
  if (!api || api.platform !== 'win32' || !api.openDefaultApps) return
  if (app.settings.get('defaultAppPrompted')) return
  const bubble = el('div', 'default-bar')
  bubble.setAttribute('role', 'region')
  bubble.setAttribute('aria-label', 'Default app')

  const title = el('div', 'default-bar-title')
  title.appendChild(el('span', 'default-bar-text', 'Make Plume your default app'))
  const help = el('button', 'default-bar-help', '?')
  help.type = 'button'
  help.id = 'default-bar-help'
  help.setAttribute('aria-label', 'What does this do?')
  help.setAttribute('aria-expanded', 'false')
  help.setAttribute('aria-controls', 'default-bar-pop')
  title.appendChild(help)

  const pop = el('div', 'default-bar-pop', "Windows lets you pick Plume for each file type. Open settings jumps straight to Plume's page.")
  pop.id = 'default-bar-pop'
  pop.setAttribute('role', 'note')
  pop.inert = true

  const setPop = (open) => {
    pop.classList.toggle('open', open)
    pop.inert = !open
    help.setAttribute('aria-expanded', String(open))
  }
  const onKey = (e) => {
    if (e.key !== 'Escape' || !pop.classList.contains('open')) return
    e.preventDefault()
    e.stopPropagation()
    setPop(false)
    help.focus()
  }
  const onDown = (e) => {
    if (pop.classList.contains('open') && !bubble.contains(e.target)) setPop(false)
  }
  help.onclick = () => setPop(!pop.classList.contains('open'))
  document.addEventListener('keydown', onKey, true)
  document.addEventListener('mousedown', onDown)

  const done = () => {
    app.settings.set('defaultAppPrompted', true)
    document.removeEventListener('keydown', onKey, true)
    document.removeEventListener('mousedown', onDown)
    bubble.remove()
  }
  const row = el('div', 'default-bar-row')
  const go = el('button', 'default-bar-btn primary', 'Open settings')
  go.type = 'button'
  go.onclick = () => {
    api.openDefaultApps().catch(() => {})
    done()
  }
  const later = el('button', 'default-bar-btn', 'No thanks')
  later.type = 'button'
  later.onclick = done
  row.append(go, later)

  bubble.append(pop, title, row)
  document.body.appendChild(bubble)
}
