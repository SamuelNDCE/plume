// In-app updates UI. The main process does the work (electron/updater.cjs); this shows it.
// A check only ever happens when the user asks, or on launch while "Check for updates" is on in Settings.
export function init(app) {
  const api = window.folio
  if (!api || !api.checkUpdates) return
  let card = null
  let dismissed = ''
  let manual = false
  let last = null

  const el = (tag, cls, text) => {
    const n = document.createElement(tag)
    if (cls) n.className = cls
    if (text != null) n.textContent = text
    return n
  }

  function hide() {
    if (card) card.remove()
    card = null
  }

  function render(s) {
    last = s
    if (s.state === 'none' && manual) {
      manual = false
      app.toast(s.note || `Plume ${s.current} is up to date`)
    }
    if (s.state === 'error' && manual) {
      manual = false
      app.toast('Update check failed: ' + (s.error || 'unknown error'))
    }
    const show = s.state === 'available' || s.state === 'downloading' || s.state === 'ready'
    if (!show || (s.state === 'available' && dismissed === s.version)) return hide()
    hide()
    card = el('div', 'update-card')
    card.setAttribute('role', 'status')
    const title = el('div', 'update-title')
    const sub = el('div', 'update-sub')
    const row = el('div', 'update-row')
    if (s.state === 'available') {
      title.textContent = `Plume ${s.version} is available`
      sub.textContent = `You have ${s.current}.` + (s.canInstall ? '' : ' Download the new version from GitHub.')
      const go = el('button', 'update-btn primary', s.canInstall ? 'Update' : 'Download')
      go.onclick = () => api.downloadUpdate()
      const later = el('button', 'update-btn', 'Later')
      later.onclick = () => {
        dismissed = s.version
        hide()
      }
      row.append(go, later)
    } else if (s.state === 'downloading') {
      title.textContent = `Downloading ${s.version || 'update'}…`
      const bar = el('div', 'update-bar')
      const fill = el('div', 'update-fill')
      fill.style.width = (s.percent || 0) + '%'
      bar.appendChild(fill)
      sub.textContent = (s.percent || 0) + '%'
      card.append(title, bar, sub)
      document.body.appendChild(card)
      return
    } else {
      title.textContent = `Plume ${s.version} is ready`
      sub.textContent = 'Restart to finish installing. Your open documents are saved first.'
      const go = el('button', 'update-btn primary', 'Restart and install')
      go.onclick = async () => {
        try {
          app.actions.saveAll && (await app.actions.saveAll())
        } catch {}
        api.installUpdate()
      }
      const later = el('button', 'update-btn', 'Later')
      later.onclick = hide
      row.append(go, later)
    }
    card.append(title, sub, row)
    document.body.appendChild(card)
  }

  api.onUpdateStatus(render)
  api.getUpdateState().then((s) => (last = s)).catch(() => {})

  const check = () => {
    manual = true
    return api.checkUpdates()
  }
  app.commands.register({ id: 'update.check', title: 'Check for Updates…', category: 'Help', run: check })
  app.commands.register({ id: 'update.releases', title: 'Open Release Notes (GitHub)', category: 'Help', run: () => api.openReleases() })
  app.updates = { check, state: () => last }

  // Quiet check shortly after launch, only if the user has not turned it off.
  if (app.settings.get('checkUpdates')) setTimeout(() => api.checkUpdates().catch(() => {}), 6000)
}
