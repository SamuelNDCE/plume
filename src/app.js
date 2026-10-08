// Shared app context handed to every module's init(app).
// Contract (modules must only rely on this):
//   app.bus.on(evt, fn) / app.bus.emit(evt, data)
//     events: 'doc:change' (markdown) 'tab:switch' (tab) 'tab:list' (tabs) 'file:saved' (tab)
//             'settings:change' ({key,value}) 'mode:change' ('wysiwyg'|'source') 'folder:change' (tree)
//   app.commands.register({ id, title, category, keys, run })  app.commands.list()  app.commands.run(id)
//   app.settings.get(key) / set(key, value)   (persisted)
//   app.getMarkdown() / app.setMarkdown(md)   current document text, either mode
//   app.state: { tabs, active (index), folder (tree|null), mode }
//   app.actions: newTab openFile openPath save saveAs saveAll closeTab(i) toggleSource openFolder refreshFolder switchTab(i) retarget(old,new) render
//   app.code: CodeMirror wrapper (null until first source view). API: view setDoc(text,filename) getValue() setValue(t) insert(t) getSelection() replaceSelection(t) selectRange(from,to) scrollToLine(n) cursorLine() lineCount() setOptions({dark,fontSize,lineNumbers,wrap}) focus() onSelection(cb)
//   app.recent() -> recent file paths.  tab doc shape: {name,kind:'md'|'text'|'table'|'image',view:'rich'|'source',path,content,saved,dirty,dataUrl?}
//   app.state.mode: 'wysiwyg'|'source'|'table'|'image'|'empty'.  extra events: 'editor:ready' 'empty:show'
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
  fontFamily: 'theme',
  maxWidth: 820,
  autosave: true,
  spellcheck: true,
  lineNumbersSource: true,
  wrapSource: true,
  lineHeight: 1.7,
  zen: false,
  // typography overrides: empty string / 0 means 'use the theme's value'
  fontBody: '',
  fontHeading: '',
  fontMono: '',
  headingScale: 0,
  paraSpacing: 0,
  accent: '',
  customCss: '',
  chartStyle: '',
  pluginsConsent: false,
  checkUpdates: true,
}

class Settings {
  constructor(bus) {
    this.bus = bus
    this.data = { ...DEFAULTS }
    try {
      Object.assign(this.data, JSON.parse(localStorage.getItem('folio.settings') || '{}'))
    } catch {}
    // 'serif' was the old default before themes carried their own typography: follow the theme instead
    if (this.data.fontFamily === 'serif') this.data.fontFamily = 'theme'
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
    // custom fenced-block renderers: lang -> (code, ctx) => HTMLElement | SVG string | Promise of either. Used by the editor preview.
    blocks: new Map(),
    // filled by src/themes/registry.js: { list(), get(id), apply(id), register(def), onChange(cb) }
    themes: null,
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
