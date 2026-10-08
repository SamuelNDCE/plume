// Find & replace bar (Ctrl+F find, Ctrl+H replace).
// WYSIWYG: searches rendered text inside .ProseMirror, highlighted with the CSS Custom Highlight API.
//   Replace goes through a Selection + execCommand('insertText') so ProseMirror records the edit.
// Source: searches app.code (CodeMirror wrapper), selects matches with selectRange, and replaces with
//   replaceSelection. The editor's change listener in main.js picks the edit up.

let app = null
let bar = null
let findIn = null
let replIn = null
let replRow = null
let countEl = null
let optBtns = {}
let timer = null
let isOpen = false
let invalid = false
let matches = [] // [start, end] flat offsets into the searched text
let wnodes = [] // WYSIWYG only: { node, start, len } for the last collection
let cur = -1
const state = { case: false, word: false, regex: false }

const pmEl = () => document.querySelector('#editor .ProseMirror')
const hasHighlights = () => typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight !== 'undefined'
const inSource = () => app.state.mode === 'source'
// The code editor, only in source mode (app.code is null until the first source view).
const codeEd = () => (inSource() && app.code) || null
// 1-based line number of a character offset.
const lineAt = (text, pos) => text.slice(0, pos).split('\n').length

function el(tag, cls, text) {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text != null) n.textContent = text
  return n
}

function buildBar() {
  bar = el('div', 'find-bar')
  bar.setAttribute('role', 'search')
  bar.hidden = true

  const row = el('div', 'find-row')
  findIn = el('input', 'find-input')
  findIn.type = 'text'
  findIn.placeholder = 'Find'
  findIn.setAttribute('aria-label', 'Find')
  countEl = el('span', 'find-count')
  countEl.setAttribute('aria-live', 'polite')

  const btn = (text, title, onClick, cls = 'find-btn') => {
    const b = el('button', cls, text)
    b.type = 'button'
    b.title = title
    b.setAttribute('aria-label', title)
    b.addEventListener('mousedown', (e) => e.preventDefault())
    b.addEventListener('click', onClick)
    return b
  }

  const opt = (key, text, title) => {
    const b = btn(text, title, () => {
      state[key] = !state[key]
      b.setAttribute('aria-pressed', String(state[key]))
      b.classList.toggle('on', state[key])
      refresh(false)
      findIn.focus()
    }, 'find-btn find-opt')
    b.setAttribute('aria-pressed', 'false')
    optBtns[key] = b
    return b
  }

  row.append(
    findIn,
    countEl,
    opt('case', 'Aa', 'Match case'),
    opt('word', 'W', 'Whole word'),
    opt('regex', '.*', 'Regular expression'),
    btn('↑', 'Previous match (Shift+Enter)', () => step(-1)),
    btn('↓', 'Next match (Enter)', () => step(1)),
    btn('×', 'Close (Esc)', () => close()),
  )

  replRow = el('div', 'find-row replace-row')
  replRow.hidden = true
  replIn = el('input', 'replace-input')
  replIn.type = 'text'
  replIn.placeholder = 'Replace'
  replIn.setAttribute('aria-label', 'Replace with')
  replRow.append(
    replIn,
    btn('Replace', 'Replace current match', () => replaceOne(), 'find-btn find-text'),
    btn('Replace all', 'Replace all matches', () => replaceAll(), 'find-btn find-text'),
  )

  bar.append(row, replRow)
  document.getElementById('find-root').appendChild(bar)

  findIn.addEventListener('input', () => {
    cur = 0
    refresh(false)
    if (!inSource() && cur >= 0) revealWysiwyg()
  })
  findIn.addEventListener('keydown', barKey)
  replIn.addEventListener('keydown', barKey)
}

function barKey(e) {
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    close()
  } else if (e.key === 'Enter' && e.target === findIn) {
    e.preventDefault()
    step(e.shiftKey ? -1 : 1)
  } else if (e.key === 'Enter' && e.target === replIn) {
    e.preventDefault()
    replaceOne()
  }
}

function buildRegex() {
  const q = findIn.value
  if (!q) return null
  let src = state.regex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (state.word) src = `\\b(?:${src})\\b`
  try {
    return new RegExp(src, 'g' + (state.case ? '' : 'i') + 'm')
  } catch {
    return 'bad'
  }
}

// Collect text nodes under .ProseMirror with their flat start offsets.
function collectNodes(root) {
  const out = []
  let start = 0
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let n
  while ((n = walker.nextNode())) {
    const len = n.data.length
    out.push({ node: n, start, len })
    start += len
  }
  return out
}

function collect() {
  matches = []
  invalid = false
  const re = buildRegex()
  if (re === 'bad') {
    invalid = true
    return
  }
  if (!re) return
  let text
  if (inSource()) {
    const code = codeEd()
    text = code ? code.getValue() : ''
  } else {
    const pm = pmEl()
    if (!pm) return
    wnodes = collectNodes(pm)
    text = wnodes.map((n) => n.node.data).join('')
  }
  re.lastIndex = 0
  let m
  while ((m = re.exec(text))) {
    if (m[0].length === 0) {
      re.lastIndex++
      continue
    }
    matches.push([m.index, m.index + m[0].length])
  }
}

function locate(pos, isEnd) {
  for (const n of wnodes) {
    const inside = isEnd ? pos > n.start && pos <= n.start + n.len : pos >= n.start && pos < n.start + n.len
    if (inside) return { node: n.node, off: pos - n.start }
  }
  return null
}

function rangeOf(m) {
  const a = locate(m[0], false)
  const b = locate(m[1], true)
  if (!a || !b) return null
  const r = document.createRange()
  r.setStart(a.node, a.off)
  r.setEnd(b.node, b.off)
  return r
}

function paint() {
  if (!hasHighlights()) return
  CSS.highlights.delete('folio-find')
  CSS.highlights.delete('folio-find-current')
  if (inSource() || !matches.length) return
  const ranges = matches.map(rangeOf)
  const others = ranges.filter((r, i) => r && i !== cur)
  if (others.length) CSS.highlights.set('folio-find', new Highlight(...others))
  const current = ranges[cur]
  if (current) CSS.highlights.set('folio-find-current', new Highlight(current))
}

function revealWysiwyg() {
  const r = matches[cur] && rangeOf(matches[cur])
  if (!r) return
  const node = r.startContainer.nodeType === 3 ? r.startContainer.parentElement : r.startContainer
  node?.scrollIntoView({ block: 'center' })
}

function selectSource() {
  const code = codeEd()
  if (!code || !matches[cur]) return
  const [s, e] = matches[cur]
  code.selectRange(s, e)
  code.scrollToLine(lineAt(code.getValue(), s))
  findIn.focus({ preventScroll: true })
}

function setCount() {
  if (!findIn.value) countEl.textContent = ''
  else if (invalid) countEl.textContent = 'Invalid pattern'
  else if (!matches.length) countEl.textContent = 'No results'
  else countEl.textContent = `${cur + 1} of ${matches.length}`
  findIn.classList.toggle('invalid', invalid)
}

// Re-search. reveal=true scrolls/selects the current match (navigation); typing does not move focus.
function refresh(reveal = false) {
  if (!isOpen) return
  collect()
  if (!matches.length) cur = -1
  else if (cur < 0 || cur >= matches.length) cur = 0
  setCount()
  paint()
  // Only explicit navigation moves the caret or selection. Plain re-search (typing, doc edits) never does.
  if (reveal && cur >= 0) {
    if (inSource()) selectSource()
    else revealWysiwyg()
  }
}

function step(d) {
  if (!isOpen) return
  if (!matches.length) {
    refresh(false)
    if (!matches.length) return
  }
  cur = (cur + d + matches.length) % matches.length
  setCount()
  paint()
  if (inSource()) selectSource()
  else revealWysiwyg()
}

function selectInWysiwyg(range) {
  const pm = pmEl()
  if (!pm) return false
  pm.focus()
  const s = window.getSelection()
  s.removeAllRanges()
  s.addRange(range)
  return true
}

function insertWysiwyg(range, replacement) {
  if (!selectInWysiwyg(range)) return
  if (replacement) document.execCommand('insertText', false, replacement)
  else document.execCommand('delete')
}

// Replacement text for one match. In regex mode $1-style references expand against the matched text.
function replacementFor(matched, re) {
  const rep = replIn.value
  if (!state.regex) return rep
  try {
    const one = new RegExp(re.source, re.flags.replace('g', ''))
    return matched.replace(one, rep)
  } catch {
    return rep
  }
}

function replaceOne() {
  if (!isOpen) return
  collect()
  if (!matches.length || invalid) return refresh(false)
  if (cur < 0 || cur >= matches.length) cur = 0
  const re = buildRegex()
  const code = codeEd()
  if (code) {
    const [s, e] = matches[cur]
    const rep = replacementFor(code.getValue().slice(s, e), re)
    code.selectRange(s, e)
    code.replaceSelection(rep)
  } else {
    const r = rangeOf(matches[cur])
    if (!r) return
    const rep = replacementFor(r.toString(), re)
    insertWysiwyg(r, rep)
  }
  refresh(false)
  findIn.focus({ preventScroll: true })
}

function replaceAll() {
  if (!isOpen) return
  collect()
  if (!matches.length || invalid) return refresh(false)
  const re = buildRegex()
  let count = 0
  const code = codeEd()
  if (code) {
    const text = code.getValue()
    // Work from the end so earlier offsets stay valid. Each replaceSelection is one undo step.
    for (let i = matches.length - 1; i >= 0; i--) {
      const [s, e] = matches[i]
      code.selectRange(s, e)
      code.replaceSelection(replacementFor(text.slice(s, e), re))
      count++
    }
  } else {
    // The DOM changes after each edit, so re-collect and continue after the inserted text.
    let from = 0
    for (let guard = 0; guard < 5000; guard++) {
      collect()
      const idx = matches.findIndex((m) => m[0] >= from)
      if (idx < 0) break
      const m = matches[idx]
      const r = rangeOf(m)
      if (!r) break
      const rep = replacementFor(r.toString(), re)
      insertWysiwyg(r, rep)
      from = m[0] + rep.length
      count++
    }
  }
  refresh(false)
  findIn.focus({ preventScroll: true })
  app.toast(`Replaced ${count} ${count === 1 ? 'match' : 'matches'}`)
}

function selectedText() {
  if (inSource()) {
    const code = codeEd()
    return code ? code.getSelection() || '' : ''
  }
  return String(window.getSelection() || '')
}

function open(withReplace) {
  if (!bar) return
  isOpen = true
  bar.hidden = false
  replRow.hidden = !withReplace
  const sel = selectedText()
  if (sel && !/[\r\n]/.test(sel) && sel.length < 200) {
    findIn.value = sel
    cur = 0
  }
  findIn.focus()
  findIn.select()
  refresh(false)
}

function close() {
  if (!isOpen) return
  isOpen = false
  bar.hidden = true
  matches = []
  if (hasHighlights()) {
    CSS.highlights.delete('folio-find')
    CSS.highlights.delete('folio-find-current')
  }
  if (codeEd()) app.code.focus()
  else pmEl()?.focus()
}

export function init(appCtx) {
  app = appCtx
  const root = document.getElementById('find-root')
  if (!root) return
  buildBar()

  app.commands.register({ id: 'find.open', title: 'Find', category: 'Edit', keys: 'Ctrl+F', run: () => open(false) })
  app.commands.register({ id: 'find.replace', title: 'Find and Replace', category: 'Edit', keys: 'Ctrl+H', run: () => open(true) })

  // Keep results current while the bar is open (debounced).
  const schedule = () => {
    if (!isOpen) return
    clearTimeout(timer)
    timer = setTimeout(() => refresh(false), 150)
  }
  app.bus.on('doc:change', schedule)
  app.bus.on('mode:change', () => refresh(false))
  app.bus.on('tab:switch', () => refresh(false))
}
