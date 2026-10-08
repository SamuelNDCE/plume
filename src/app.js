// Shared app context handed to every module's init(app).
// Contract (modules must only rely on this):
//   app.bus.on(evt, fn) / app.bus.emit(evt, data)
//     events: 'doc:change' (markdown) 'tab:switch' (tab) 'tab:list' (tabs) 'file:saved' (tab)
//             'settings:change' ({key,value}) 'mode:change' ('wysiwyg'|'source') 'folder:change' (tree)
//   app.commands.register({ id, title, category, keys, run })  app.commands.list()  app.commands.run(id)
//   app.settings.get(key) / set(key, value)   (persisted)
//   app.getMarkdown() / app.setMarkdown(md)   current document text, either mode
//   app.state: { tabs, active (index), folder (tree|null), mode }
//   app.actions: newTab openFile openPath save saveAs closeTab toggleSource openFolder
//   app.toast(msg)

class Bus {
  constructor() {
    this.map = new Map()
  }
  on(evt, fn) {
    if (!this.map.has(evt)) this.map.set(evt, new Set())
    this.map.get(evt).add(fn)
    return () => this.map.get(evt).delete(fn)
  }
  emit(evt, data) {
    ;(this.map.get(evt) || []).forEach((fn) => {
      try {
        fn(data)
      } catch (e) {
        console.error('[bus]', evt, e)
      }
    })
  }
}

class Commands {
  constructor() {
    this.items = new Map()
  }
  register(cmd) {
    this.items.set(cmd.id, cmd)
  }
  list() {
    return [...this.items.values()]
  }
  run(id) {
    const c = this.items.get(id)
    if (c) return c.run()
  }
}

const DEFAULTS = {
  theme: 'light',
  focusMode: false,
  typewriter: false,
  sidebar: true,
  sidebarTab: 'files',
  sidebarWidth: 260,
  fontSize: 17,
  fontFamily: 'serif',
  maxWidth: 820,
  autosave: true,
  spellcheck: true,
  lineNumbersSource: false,
}

class Settings {
  constructor(bus) {
    this.bus = bus
    this.data = { ...DEFAULTS }
    try {
      Object.assign(this.data, JSON.parse(localStorage.getItem('folio.settings') || '{}'))
    } catch {}
  }
  get(k) {
    return this.data[k]
  }
  set(k, v) {
    this.data[k] = v
    try {
      localStorage.setItem('folio.settings', JSON.stringify(this.data))
    } catch {}
    this.bus.emit('settings:change', { key: k, value: v })
  }
}

export function createApp() {
  const bus = new Bus()
  const app = {
    bus,
    commands: new Commands(),
    settings: new Settings(bus),
    state: { tabs: [], active: -1, folder: null, mode: 'wysiwyg' },
    actions: {},
    getMarkdown: () => '',
    setMarkdown: () => {},
    toast(msg) {
      const root = document.getElementById('toast-root')
      const el = document.createElement('div')
      el.className = 'toast'
      el.textContent = msg
      root.appendChild(el)
      setTimeout(() => el.classList.add('out'), 1800)
      setTimeout(() => el.remove(), 2300)
    },
  }
  return app
}
