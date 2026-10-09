// In-app updates UI. The main process does the work (electron/updater.cjs); this shows it.
// A check only ever happens when the user asks, or on launch while "Check for updates" is on in Settings.
// Flow: a small card says a version is available; Update (or Settings, Updates, Update now) downloads it behind one
// full-window update screen with progress, then saves open documents and restarts into the new version by itself.
// No installer wizard is involved: the Windows build installs silently per user.
export function init(app) {
  const api = window.folio
  if (!api || !api.checkUpdates) return
  let card = null
  let screen = null
  let dismissed = ''
  let manual = false
  let last = null
  let userStarted = false // the person chose to update in this session, so restart on their behalf when ready
  let installing = false
  const listeners = new Set()
  let lastChecked = 0
  try {
    lastChecked = Number(localStorage.getItem('plume.updateChecked')) || 0
  } catch {}

  const el = (tag, cls, text) => {
    const n = document.createElement(tag)
    if (cls) n.className = cls
    if (text != null) n.textContent = text
    return n
  }

  function hideCard() {
    if (card) card.remove()
    card = null
  }

  function hideScreen() {
    if (screen) screen.root.remove()
    screen = null
  }

  /* ---------- the update screen ---------- */
  function showScreen(s) {
    if (!screen) {
      const root = el('div', 'update-screen')
      root.setAttribute('role', 'alertdialog')
      root.setAttribute('aria-modal', 'true')
      root.setAttribute('aria-labelledby', 'us-title')
      const box = el('div', 'us-box')
      const title = el('h2', 'us-title')
      title.id = 'us-title'
      const sub = el('div', 'us-sub')
      const bar = el('div', 'update-bar us-bar')
      bar.setAttribute('role', 'progressbar')
      bar.setAttribute('aria-valuemin', '0')
      bar.setAttribute('aria-valuemax', '100')
      const fill = el('div', 'update-fill')
      bar.appendChild(fill)
      const pct = el('div', 'us-pct')
      pct.setAttribute('aria-live', 'polite')
      box.append(title, sub, bar, pct)
      root.appendChild(box)
      document.body.appendChild(root)
      screen = { root, title, sub, bar, fill, pct }
    }
    const pctNum = Math.max(0, Math.min(100, s.percent || 0))
    const restarting = installing || s.state === 'ready'
    screen.title.textContent = restarting ? 'Restarting Plume…' : `Updating Plume to ${s.version || 'the latest version'}`
    screen.sub.textContent = restarting ? 'Your documents are saved. Plume reopens on the new version in a moment.' : `Downloading. You have ${s.current}. Your documents stay open and are saved before the restart.`
    screen.fill.style.width = (restarting ? 100 : pctNum) + '%'
    screen.bar.setAttribute('aria-valuenow', String(restarting ? 100 : pctNum))
    screen.pct.textContent = restarting ? '' : pctNum + '%'
  }

  async function installNow() {
    if (installing) return
    installing = true
    if (last) showScreen(last)
    try {
      app.actions.saveAll && (await app.actions.saveAll())
    } catch {}
    // a short beat so the "Restarting" text is readable
    setTimeout(() => api.installUpdate(), 700)
  }

  /* ---------- state changes ---------- */
  function notify() {
    listeners.forEach((fn) => {
      try {
        fn(last)
      } catch (e) {
        console.error('[updates]', e)
      }
    })
  }

  function render(s) {
    last = s
    if (s.state === 'none' || s.state === 'available') {
      lastChecked = Date.now()
      try {
        localStorage.setItem('plume.updateChecked', String(lastChecked))
      } catch {}
    }
    if (s.state === 'none' && manual) {
      manual = false
      app.toast(s.note || `Plume ${s.current} is up to date`)
    }
    if (s.state === 'error') {
      if (manual || userStarted) app.toast('Update failed: ' + (s.error || 'unknown error'))
      manual = false
      userStarted = false
      installing = false
      hideScreen()
    }

    if (userStarted && s.state === 'downloading') {
      hideCard()
      showScreen(s)
    } else if (userStarted && s.state === 'ready') {
      hideCard()
      userStarted = false
      installNow()
    } else if (!installing) {
      hideScreen()
      const show = s.state === 'available' || s.state === 'ready'
      if (!show || (s.state === 'available' && dismissed === s.version)) hideCard()
      else drawCard(s)
    }
    notify()
  }

  function drawCard(s) {
    hideCard()
    card = el('div', 'update-card')
    card.setAttribute('role', 'status')
    const title = el('div', 'update-title')
    const sub = el('div', 'update-sub')
    const row = el('div', 'update-row')
    if (s.state === 'available') {
      title.textContent = `Plume ${s.version} is available`
      sub.textContent = `You have ${s.current}.` + (s.canInstall ? '' : ' Download the new version from GitHub.')
      const go = el('button', 'update-btn primary', s.canInstall ? 'Update' : 'Download')
      go.onclick = () => start()
      const later = el('button', 'update-btn', 'Later')
      later.onclick = () => {
        dismissed = s.version
        hideCard()
      }
      row.append(go, later)
    } else {
      title.textContent = `Plume ${s.version} is ready`
      sub.textContent = 'Restart to finish installing. Your open documents are saved first.'
      const go = el('button', 'update-btn primary', 'Restart and install')
      go.onclick = () => installNow()
      const later = el('button', 'update-btn', 'Later')
      later.onclick = hideCard
      row.append(go, later)
    }
    card.append(title, sub, row)
    document.body.appendChild(card)
  }

  /* ---------- actions ---------- */
  const check = () => {
    manual = true
    return api.checkUpdates()
  }
  function start() {
    // Installs in place where the build allows it; otherwise the main process opens the download page.
    if (last && last.canInstall) userStarted = true
    return api.downloadUpdate()
  }

  api.onUpdateStatus(render)
  api
    .getUpdateState()
    .then((s) => {
      last = s
      notify()
    })
    .catch(() => {})

  app.commands.register({ id: 'update.check', title: 'Check for Updates…', category: 'Help', run: check })
  app.commands.register({ id: 'update.releases', title: 'Open Release Notes (GitHub)', category: 'Help', run: () => api.openReleases() })
  app.updates = {
    check,
    start,
    install: installNow,
    state: () => last,
    lastChecked: () => lastChecked,
    onChange(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    refresh: () => api.getUpdateState().then((s) => ((last = s), notify(), s)),
  }

  // Quiet check shortly after launch, only if the user has not turned it off.
  if (app.settings.get('checkUpdates')) setTimeout(() => api.checkUpdates().catch(() => {}), 6000)
}
