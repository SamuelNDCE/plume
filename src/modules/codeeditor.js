// CodeMirror 6 wrapper used by the source view. See the contract in src/app.js (app.code).
import { EditorState, Compartment, Annotation } from '@codemirror/state'
import {
  EditorView,
  keymap,
  drawSelection,
  highlightActiveLine,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import {
  indentOnInput,
  bracketMatching,
  syntaxHighlighting,
  defaultHighlightStyle,
  LanguageDescription,
} from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { markdown } from '@codemirror/lang-markdown'
import { search, highlightSelectionMatches } from '@codemirror/search'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { oneDarkHighlightStyle } from '@codemirror/theme-one-dark'

const programmatic = Annotation.define()

// Keys owned by the app: strip any CodeMirror binding that would swallow them.
const MOD_NAMES = new Set(['mod', 'ctrl', 'cmd', 'meta', 'c', 'm'])
const APP_KEYS = new Set(['s', 'o', 'n', 'w', 'p', '/', 'f', 'h', ','])
function isAppKey(k) {
  if (typeof k !== 'string') return false
  const parts = k.split('-')
  let rest = parts.pop()
  if (rest === '' && parts.length) rest = '-' // "Mod--"
  const mods = parts.map((p) => p.toLowerCase())
  if (!mods.some((m) => MOD_NAMES.has(m))) return false
  if (mods.includes('shift') || mods.includes('s')) return true
  return APP_KEYS.has(rest.toLowerCase())
}
function filterKeymap(bindings) {
  const out = []
  for (const b of bindings) {
    const nb = { ...b }
    for (const p of ['key', 'mac', 'win', 'linux']) if (isAppKey(nb[p])) delete nb[p]
    if (nb.key || nb.mac || nb.win || nb.linux) out.push(nb)
  }
  return out
}

const isMarkdown = (name) => /\.(md|markdown|mdown|mkd|mdx)$/i.test(name || '')

export function createCodeEditor(host, { onChange } = {}) {
  const opts = { dark: false, fontSize: 14, lineNumbers: true, wrap: true }
  const cLang = new Compartment()
  const cTheme = new Compartment()
  const cFont = new Compartment()
  const cNums = new Compartment()
  const cWrap = new Compartment()
  const selCbs = new Set()
  let docToken = 0

  const themeExt = () => [
    EditorView.theme({}, { dark: !!opts.dark }),
    syntaxHighlighting(opts.dark ? oneDarkHighlightStyle : defaultHighlightStyle, { fallback: true }),
  ]
  const fontExt = () =>
    EditorView.theme({
      '&': { fontSize: opts.fontSize + 'px' },
      '.cm-gutters': { fontSize: Math.max(10, opts.fontSize - 1) + 'px' },
    })
  const numsExt = () => (opts.lineNumbers ? lineNumbers() : [])
  const wrapExt = () => (opts.wrap ? EditorView.lineWrapping : [])

  const chrome = EditorView.theme({
    '&': { height: '100%', backgroundColor: 'transparent', color: 'var(--fg)' },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': {
      fontFamily: "ui-monospace, 'Cascadia Code', Consolas, monospace",
      lineHeight: '1.55',
      overflow: 'auto',
    },
    '.cm-content': { caretColor: 'var(--accent)', padding: '12px 0' },
    '.cm-line': { padding: '0 14px' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)' },
    '.cm-selectionBackground': { background: 'color-mix(in srgb, var(--accent) 22%, transparent)' },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
      background: 'color-mix(in srgb, var(--accent) 32%, transparent)',
    },
    '.cm-gutters': {
      backgroundColor: 'var(--bg-2)',
      color: 'var(--fg-muted)',
      border: 'none',
      borderRight: '1px solid var(--border)',
    },
    '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--hover) 60%, transparent)' },
    '.cm-activeLineGutter': {
      backgroundColor: 'color-mix(in srgb, var(--hover) 80%, transparent)',
      color: 'var(--fg)',
    },
    '.cm-selectionMatch': { backgroundColor: 'color-mix(in srgb, var(--accent) 18%, transparent)' },
    '&.cm-focused .cm-matchingBracket': {
      backgroundColor: 'color-mix(in srgb, var(--accent) 28%, transparent)',
      outline: 'none',
    },
    '&.cm-focused .cm-nonmatchingBracket': { backgroundColor: 'rgba(220, 60, 60, 0.3)' },
  })

  const keys = keymap.of(filterKeymap([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]))

  const updater = EditorView.updateListener.of((u) => {
    if (u.docChanged && onChange && !u.transactions.some((t) => t.annotation(programmatic))) {
      onChange(u.state.doc.toString())
    }
    if ((u.selectionSet || u.docChanged) && selCbs.size) {
      const r = u.state.selection.main
      const payload = { from: r.from, to: r.to, selected: u.state.sliceDoc(r.from, r.to) }
      selCbs.forEach((cb) => {
        try {
          cb(payload)
        } catch (e) {
          console.error('[code] onSelection', e)
        }
      })
    }
  })

  const makeState = (doc) =>
    EditorState.create({
      doc,
      extensions: [
        cNums.of(numsExt()),
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        search(),
        rectangularSelection(),
        EditorState.allowMultipleSelections.of(true),
        keys,
        chrome,
        cTheme.of(themeExt()),
        cFont.of(fontExt()),
        cWrap.of(wrapExt()),
        cLang.of([]),
        updater,
      ],
    })

  const view = new EditorView({ state: makeState(''), parent: host })

  function loadLanguage(filename, token) {
    if (isMarkdown(filename)) {
      view.dispatch({ effects: cLang.reconfigure(markdown({ codeLanguages: languages })), annotations: programmatic.of(true) })
      return
    }
    const desc = filename ? LanguageDescription.matchFilename(languages, filename) : null
    if (!desc) return
    desc
      .load()
      .then((support) => {
        if (token !== docToken) return
        view.dispatch({ effects: cLang.reconfigure(support), annotations: programmatic.of(true) })
      })
      .catch((e) => console.warn('[code] language load failed', e))
  }

  const api = {
    view,
    setDoc(text, filename) {
      const token = ++docToken
      view.setState(makeState(text || ''))
      loadLanguage(filename, token)
    },
    getValue: () => view.state.doc.toString(),
    setValue(t) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: t || '' } })
    },
    insert(t) {
      view.dispatch(view.state.replaceSelection(t), { scrollIntoView: true, userEvent: 'input' })
    },
    getSelection() {
      const r = view.state.selection.main
      return view.state.sliceDoc(r.from, r.to)
    },
    replaceSelection(t) {
      view.dispatch(view.state.replaceSelection(t), { scrollIntoView: true, userEvent: 'input' })
    },
    selectRange(from, to) {
      const n = view.state.doc.length
      const a = Math.max(0, Math.min(from, n))
      const b = Math.max(0, Math.min(to == null ? from : to, n))
      view.dispatch({ selection: { anchor: a, head: b }, effects: EditorView.scrollIntoView(a, { y: 'center' }) })
    },
    scrollToLine(n) {
      const line = view.state.doc.line(Math.max(1, Math.min(n | 0, view.state.doc.lines)))
      view.dispatch({
        selection: { anchor: line.from, head: line.to },
        effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
      })
    },
    cursorLine: () => view.state.doc.lineAt(view.state.selection.main.head).number,
    lineCount: () => view.state.doc.lines,
    setOptions(o = {}) {
      const effects = []
      if (o.dark !== undefined && !!o.dark !== opts.dark) {
        opts.dark = !!o.dark
        effects.push(cTheme.reconfigure(themeExt()))
      }
      if (o.fontSize !== undefined && o.fontSize !== opts.fontSize) {
        opts.fontSize = +o.fontSize || opts.fontSize
        effects.push(cFont.reconfigure(fontExt()))
      }
      if (o.lineNumbers !== undefined && !!o.lineNumbers !== opts.lineNumbers) {
        opts.lineNumbers = !!o.lineNumbers
        effects.push(cNums.reconfigure(numsExt()))
      }
      if (o.wrap !== undefined && !!o.wrap !== opts.wrap) {
        opts.wrap = !!o.wrap
        effects.push(cWrap.reconfigure(wrapExt()))
      }
      if (effects.length) view.dispatch({ effects })
    },
    focus: () => view.focus(),
    onSelection(cb) {
      selCbs.add(cb)
      return () => selCbs.delete(cb)
    },
    destroy() {
      selCbs.clear()
      view.destroy()
    },
  }
  return api
}
