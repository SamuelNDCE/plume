// Document quick bar and right-click menu (Rich and Source views), one component.
//   Select text: a slim one-row bar floats below the selection. It is the ONE place for the common changes:
//   block style, inline (Bold, Italic, Underline, Strikethrough, Code),
//   and size (a drop-down of the text sizes). The block-style drop-down lists Paragraph, Title, Heading 2 to 6, Quote and Code block.
//   It replaces Crepe's own selection toolbar (turned off in main.js).
//   Right-click: the SAME bar expands in place into the menu. The bar row stays on top, and the menu rows
//   (Clipboard, direct Link, Quote, Bullet list, Numbered list and Task list, an Edit group of Select all, Undo, Redo and Paste as plain text, Find, then Insert more and More edit) open below it; each submenu opens on hover (short intent
//   delay) or with the Right arrow. Left closes a submenu, Escape closes the menu. Nothing the bar shows is repeated in the menu.
// Rich view sends the same shortcuts Milkdown binds (checked in preset-commonmark and preset-gfm): Ctrl+B, Ctrl+I,
// Ctrl+E, Ctrl+Alt+X, Ctrl+Alt+0..6, Ctrl+Alt+7/8, Ctrl+Alt+C, Ctrl+Shift+B. Task list, divider, link and clear
// formatting have no Milkdown shortcut, so Rich view uses typed input rules (execCommand insertText) and
// execCommand createLink, which ProseMirror reads back from the DOM. Source view edits the CodeMirror text directly.
// Other views (sheet, viewer, empty) keep their own behaviour and get neither.

import { countText } from './statusbar.js'
import { leave } from './leave.js'

const el = (tag, cls, text) => {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text != null) n.textContent = text
  return n
}

const SIZE_MIN = 11
const SIZE_MAX = 32
const SIZE_DEFAULT = 17
const INTENT_MS = 120
const MENU_W = 250
const PRESETS = [
  ['Small', 14],
  ['Normal', 17],
  ['Large', 20],
  ['X-Large', 24],
  ['Huge', 28],
]

// 24x24 stroke icons, currentColor. Static strings written here, never user input.
const P = {
  underline: 'M7 4v7a5 5 0 0 0 10 0V4M5 20h14',
  bold: 'M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z',
  italic: 'M19 4h-9M14 20H5M15 4 9 20',
  strike: 'M16 6.5A4 4 0 0 0 12 4.5c-2.4 0-4 1.2-4 3 0 3.8 8 2.2 8 6.5 0 1.9-1.8 3.2-4 3.2a4.6 4.6 0 0 1-4.4-2.6M4 12h16',
  code: 'm9 18-6-6 6-6M15 6l6 6-6 6',
  smaller: 'M3 19 8.5 5l5.5 14M5 14.5h7M17 12h5',
  larger: 'M3 19 8.5 5l5.5 14M5 14.5h7M17 12h5M19.5 9.5v5',
  cut: 'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  paste: 'M9 4h6v3H9zM7 5.5H5v15h14v-15h-2',
  selectall: 'M4 4h16v16H4z',
  clipboard: 'M9 4h6v3H9zM7 5.5H5v15h14v-15h-2M8.5 12h7M8.5 16h5',
  block: 'M5 5v14M13 5v14M5 12h8M17.5 9l2.5-1.5V19',
  format: 'M4 7V5h16v2M12 5v14M9 19h6',
  size: 'M3 19 8.5 5l5.5 14M5 14.5h7M17 7l2.5-3L22 7M17 17l2.5 3 2.5-3',
  insert: 'M12 5v14M5 12h14',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  bullets: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  numbers: 'M10 6h10M10 12h10M10 18h10M4 5.5l1.2-1v4.5M3.8 14.2h2.4L3.8 17h2.6',
  task: 'M4 4h6v6H4zM5.3 7l1.5 1.5L9 5.8M13 7h7M4 14h6v6H4zM13 17h7',
  codeblock: 'M4 4h16v16H4zM10 9l-3 3 3 3M14 9l3 3-3 3',
  quote: 'M7 7h4v4c0 3-1.5 5-4 6M15 7h4v4c0 3-1.5 5-4 6',
  divider: 'M3 12h18M8 6h8M8 18h8',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  clear: 'M20 20H9L4 15a2 2 0 0 1 0-2.8l8-8a2 2 0 0 1 2.8 0l5 5a2 2 0 0 1 0 2.8L12 20M7 10l7 7',
  reset: 'M4 12a8 8 0 1 0 2.5-5.8M4 4v4h4',
  redo: 'M20 12a8 8 0 1 1-2.5-5.8M20 4v4h-4',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  table: 'M4 5h16v14H4zM4 10h16M4 15h16M10 5v14M15 5v14',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  count: 'M5 7h14M5 12h14M5 17h8',
  plain: 'M9 4h6v3H9zM7 5.5H5v15h14v-15h-2M8 12l8 5M16 12l-8 5',
  line: 'M3 12h18M3 6h4M3 18h4',
  dup: 'M9 9h11v11H9zM5 15H4V4h11v1M12 14.5h5M14.5 12v5',
  up: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  replace: 'M4 7h12l-3-3M20 17H8l3 3',
  chevron: 'm6 9 6 6 6-6',
}
const iconSvg = (name) =>
  `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"${name === 'selectall' ? ' stroke-dasharray="3 3"' : ''}><path d="${P[name]}"/></svg>`
const icon = (name) => {
  const s = el('span', 'ctx-ico')
  s.setAttribute('aria-hidden', 'true')
  s.innerHTML = iconSvg(name)
  return s
}

export function init(app) {
  const root = document.getElementById('ctx-root') || (() => {
    const r = el('div')
    r.id = 'ctx-root'
    document.body.appendChild(r)
    return r
  })()

  const docEl = document.getElementById('doc')
  const editable = () => app.state.mode === 'wysiwyg' || (app.state.mode === 'source' && !!app.code)
  const pm = () => document.querySelector('#editor .ProseMirror')
  const rich = () => app.state.mode === 'wysiwyg'

  let restoreFocus = null
  let expanded = false

  /* ---------- actions ---------- */
  function focusEditor() {
    if (restoreFocus) restoreFocus()
  }

  function richKey(key, { alt = false, shift = false } = {}) {
    const target = pm()
    if (!target) return
    target.dispatchEvent(new KeyboardEvent('keydown', { key, code: 'Key' + key.toUpperCase(), ctrlKey: true, altKey: alt, shiftKey: shift, bubbles: true, cancelable: true }))
  }

  const BLOCK_PREFIX = /^(#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+(\[[ xX]\][ \t]+)?|\d+\.[ \t]+)/

  // Source view: replace the block marker at the start of the current line.
  function sourceBlock(prefix) {
    const v = app.code.view
    const line = v.state.doc.lineAt(v.state.selection.main.head)
    const body = line.text.replace(BLOCK_PREFIX, '')
    v.dispatch({ changes: { from: line.from, to: line.to, insert: prefix + body }, selection: { anchor: line.from + prefix.length + body.length } })
    v.focus()
  }

  // Is the selection exactly wrapped by open...close? A lone '*' must not match the pair inside '**'.
  function sourceWrapped(open, close = open) {
    const v = app.code.view
    const r = v.state.selection.main
    if (r.empty) return false
    const d = v.state.doc
    const before = d.sliceString(Math.max(0, r.from - open.length), r.from)
    const after = d.sliceString(r.to, Math.min(d.length, r.to + close.length))
    if (before !== open || after !== close) return false
    if (open === '*') {
      const b2 = d.sliceString(Math.max(0, r.from - 2), Math.max(0, r.from - 1))
      const a2 = d.sliceString(Math.min(d.length, r.to + 1), Math.min(d.length, r.to + 2))
      if (b2 === '*' || a2 === '*') return false
    }
    return true
  }

  // Wrap the selection with a marker, or take the marker off when it is already there.
  function sourceWrap(open, close = open) {
    const v = app.code.view
    const r = v.state.selection.main
    if (sourceWrapped(open, close)) {
      const inner = v.state.sliceDoc(r.from, r.to)
      v.dispatch({ changes: { from: r.from - open.length, to: r.to + close.length, insert: inner }, selection: { anchor: r.from - open.length, head: r.from - open.length + inner.length } })
      return v.focus()
    }
    const inner = v.state.sliceDoc(r.from, r.to)
    v.dispatch({ changes: { from: r.from, to: r.to, insert: open + inner + close }, selection: { anchor: r.from + open.length, head: r.from + open.length + inner.length } })
    v.focus()
  }

  function sourceFence() {
    const v = app.code.view
    const r = v.state.selection.main
    const inner = v.state.sliceDoc(r.from, r.to)
    v.dispatch({ changes: { from: r.from, to: r.to, insert: '```\n' + inner + '\n```' }, selection: { anchor: r.from + 4, head: r.from + 4 + inner.length } })
    v.focus()
  }

  function sourceDivider() {
    const v = app.code.view
    const line = v.state.doc.lineAt(v.state.selection.main.head)
    v.dispatch({ changes: { from: line.to, insert: '\n\n---\n' }, selection: { anchor: line.to + 6 } })
    v.focus()
  }

  function sourceLink() {
    const v = app.code.view
    const r = v.state.selection.main
    const inner = v.state.sliceDoc(r.from, r.to) || 'text'
    const text = `[${inner}]()`
    v.dispatch({ changes: { from: r.from, to: r.to, insert: text }, selection: { anchor: r.from + text.length - 1 } })
    v.focus()
  }

  function stripMarks(t) {
    return t
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/~~([^~]+)~~/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\*([^*\s][^*]*)\*/g, '$1')
      .replace(/(^|[^\w])_([^_]+)_(?=[^\w]|$)/g, '$1$2')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  }

  function sourceClear() {
    const v = app.code.view
    let r = v.state.selection.main
    if (r.empty) {
      const line = v.state.doc.lineAt(r.head)
      r = { from: line.from, to: line.to }
    }
    const inner = v.state.sliceDoc(r.from, r.to)
    const out = stripMarks(inner)
    v.dispatch({ changes: { from: r.from, to: r.to, insert: out }, selection: { anchor: r.from, head: r.from + out.length } })
    v.focus()
  }

  // Rich view helpers (no Milkdown shortcut exists for these)
  // ProseMirror runs its input rules (`[ ] `, `---`) on text it reads back from the DOM, so type the text with
  // execCommand insertText one character at a time, as a keyboard would.
  const tick = (ms) => new Promise((r) => setTimeout(r, ms))
  async function richType(text) {
    for (const ch of text) {
      document.execCommand('insertText', false, ch)
      await tick(15)
    }
  }

  // Task list: make the block a bullet list item (Ctrl+Alt+8), then type "[ ] " at its start (the GFM rule needs a list item).
  async function richTask() {
    const s = document.getSelection()
    s.collapseToStart()
    s.modify('move', 'backward', 'paragraphboundary')
    await tick(60)
    richKey('8', { alt: true })
    await tick(80)
    const t = document.getSelection()
    t.collapseToStart()
    t.modify('move', 'backward', 'paragraphboundary')
    await tick(60)
    await richType('[ ] ')
  }

  async function richDivider() {
    const s = document.getSelection()
    s.collapseToEnd()
    s.modify('move', 'forward', 'paragraphboundary')
    await tick(60)
    pm().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true }))
    await tick(80)
    await richType('---')
  }

  const MARKS = [
    ['strong,b', 'b', {}],
    ['em,i', 'i', {}],
    ['del,s,strike', 'x', { alt: true }],
    ['code', 'e', {}],
  ]
  function richHas(sel) {
    const s = document.getSelection()
    if (!s.rangeCount) return false
    const rg = s.getRangeAt(0)
    const node = rg.commonAncestorContainer.nodeType === 1 ? rg.commonAncestorContainer : rg.commonAncestorContainer.parentElement
    if (node && node.closest(sel) && pm().contains(node.closest(sel))) return true
    return !!rg.cloneContents().querySelector(sel)
  }
  function richClear() {
    for (let pass = 0; pass < 3; pass++) {
      let did = false
      for (const [sel, key, o] of MARKS) {
        if (richHas(sel)) {
          richKey(key, o)
          did = true
        }
      }
      if (richHas('a')) {
        document.execCommand('unlink')
        did = true
      }
      if (!did) break
    }
  }

  // Markdown has no underline and Milkdown has no underline mark. Rich view stores it as the inline HTML <u>text</u>
  // (Milkdown's own inline "html" node), so the file holds <u>...</u> and renders underlined.
  // The <u> html node the selection sits in or covers (a ProseMirror node selection puts the range around the node).
  const isU = (sp) => /^<u>[\s\S]*<\/u>$/.test(sp.dataset.value || '')
  const htmlSpan = () => {
    const s = document.getSelection()
    const p = pm()
    if (!p || !s.rangeCount) return null
    const rg = s.getRangeAt(0)
    const e = s.anchorNode && (s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement)
    const own = e && e.closest('span[data-type="html"]')
    if (own && isU(own)) return own
    for (const sp of p.querySelectorAll('span[data-type="html"]')) {
      if (!isU(sp) || !rg.intersectsNode(sp)) continue
      const nr = document.createRange()
      nr.selectNode(sp)
      if (rg.compareBoundaryPoints(Range.START_TO_START, nr) <= 0 && rg.compareBoundaryPoints(Range.END_TO_END, nr) >= 0) return sp
    }
    return null
  }
  function richUnderline() {
    const s = document.getSelection()
    if (!s.rangeCount || s.isCollapsed) return
    const sp = htmlSpan()
    if (sp) {
      const inner = sp.dataset.value.slice(3, -4)
      const rg = document.createRange()
      rg.selectNode(sp)
      s.removeAllRanges()
      s.addRange(rg)
      return void document.execCommand('insertText', false, inner)
    }
    const attr = (t) => t.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    // The value is written as raw HTML into the document, so text with < or > could become live markup. Refuse those.
    const picked = s.toString()
    if (/[<>]/.test(picked)) return void app.toast("Underline can't include < or > characters")
    const value = '<u>' + picked + '</u>'
    // A paste of the html node keeps it inline in the paragraph (execCommand insertHTML would split the paragraph).
    const dt = new DataTransfer()
    dt.setData('text/html', '<span data-type="html" data-value="' + attr(value) + '"></span>')
    pm().dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }

  // Milkdown draws its html node as the literal tags. Show the <u>text</u> nodes as underlined text instead (display only:
  // the node and the saved Markdown are unchanged, and ProseMirror ignores edits inside a non-editable node).
  function decorateUnderline() {
    for (const sp of docEl.querySelectorAll('span[data-type="html"]')) {
      const m = /^<u>([\s\S]*)<\/u>$/.exec(sp.dataset.value || '')
      if (m && sp.dataset.pl !== m[1]) {
        sp.dataset.pl = m[1]
        sp.textContent = m[1]
        sp.classList.add('ctx-u')
      }
    }
  }
  new MutationObserver(decorateUnderline).observe(docEl, { childList: true, subtree: true })

  // What the bar highlights: the block style of the line, and which inline marks the selection carries.
  function barState() {
    const st = { block: null, codeblock: false, quote: false, bullets: false, numbers: false, task: false, bold: false, italic: false, underline: false, strike: false, code: false }
    if (rich()) {
      const s = document.getSelection()
      const p = pm()
      const n0 = s.rangeCount && s.anchorNode
      const n = n0 && (n0.nodeType === 1 ? n0 : n0.parentElement)
      if (!p || !n || !p.contains(n)) return st
      const h = n.closest('h1,h2,h3,h4,h5,h6')
      if (h && p.contains(h)) st.block = Number(h.tagName[1])
      else if (n.closest('p') || n.closest('li')) st.block = 0
      st.quote = !!n.closest('blockquote')
      st.codeblock = !!n.closest('pre')
      const li = n.closest('li')
      st.task = !!(li && li.dataset.itemType === 'task')
      st.bullets = !!(li && !st.task && li.parentElement && li.parentElement.tagName === 'UL')
      st.numbers = !!(li && li.parentElement && li.parentElement.tagName === 'OL')
      st.bold = richHas('strong,b')
      st.italic = richHas('em,i')
      st.strike = richHas('del,s,strike')
      st.code = richHas('code')
      st.underline = !!htmlSpan() || richHas('u')
      return st
    }
    const v = app.code && app.code.view
    if (!v) return st
    const line = v.state.doc.lineAt(v.state.selection.main.head).text
    const m = /^(#{1,6})[ \t]/.exec(line)
    st.block = m ? m[1].length : 0
    st.quote = /^>/.test(line)
    st.task = /^[-*+][ \t]+\[[ xX]\]/.test(line)
    st.bullets = !st.task && /^[-*+][ \t]/.test(line)
    st.numbers = /^\d+\.[ \t]/.test(line)
    st.bold = sourceWrapped('**')
    st.italic = sourceWrapped('*') || sourceWrapped('_')
    st.underline = sourceWrapped('<u>', '</u>')
    st.strike = sourceWrapped('~~')
    st.code = sourceWrapped('`')
    return st
  }

  function safeUrl(u) {
    u = (u || '').trim()
    if (!u) return null
    if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = /^[^\s/]+@[^\s/]+\.[^\s/]+$/.test(u) ? 'mailto:' + u : 'https://' + u
    return /^(https?|mailto):/i.test(u) ? u : null
  }

  function richLink(url) {
    const s = document.getSelection()
    if (s.isCollapsed) {
      const e = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
      document.execCommand('insertHTML', false, `<a href="${e}">${e}</a>`)
    } else document.execCommand('createLink', false, url)
  }

  async function pastePlain() {
    let t = ''
    try {
      t = await navigator.clipboard.readText()
    } catch {}
    if (!t) return app.toast && app.toast('Nothing to paste: the clipboard has no text')
    if (rich()) document.execCommand('insertText', false, t)
    else app.code.replaceSelection(t)
  }

  function sourceSelectLine() {
    const v = app.code.view
    const line = v.state.doc.lineAt(v.state.selection.main.head)
    v.dispatch({ selection: { anchor: line.from, head: Math.min(line.to + 1, v.state.doc.length) } })
    v.focus()
  }

  function sourceDuplicateLine() {
    const v = app.code.view
    const h = v.state.selection.main.head
    const line = v.state.doc.lineAt(h)
    v.dispatch({ changes: { from: line.to, insert: '\n' + line.text }, selection: { anchor: line.to + 1 + (h - line.from) } })
    v.focus()
  }

  function sourceMoveLine(dir) {
    const v = app.code.view
    const h = v.state.selection.main.head
    const line = v.state.doc.lineAt(h)
    const other = v.state.doc.line(Math.min(Math.max(line.number + dir, 1), v.state.doc.lines))
    if (other.number === line.number) return
    const a = dir < 0 ? other : line
    const b = dir < 0 ? line : other
    const col = h - line.from
    v.dispatch({ changes: { from: a.from, to: b.to, insert: b.text + '\n' + a.text }, selection: { anchor: other.from + col } })
    v.focus()
  }

  const TABLE_MD = '\n\n| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n|  |  |  |\n'
  function sourceTable() {
    const v = app.code.view
    const line = v.state.doc.lineAt(v.state.selection.main.head)
    v.dispatch({ changes: { from: line.to, insert: TABLE_MD }, selection: { anchor: line.to + TABLE_MD.length - 4 } })
    v.focus()
  }

  async function richTable() {
    const s = document.getSelection()
    s.collapseToEnd()
    s.modify('move', 'forward', 'paragraphboundary')
    await tick(60)
    pm().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true }))
    await tick(80)
    await richType('|3x3| ') // Milkdown GFM input rule: a 3 by 3 table
  }

  function wordCount() {
    let sel = ''
    if (rich()) {
      const g = document.getSelection()
      sel = g && !g.isCollapsed ? g.toString() : ''
    } else if (app.code) {
      const m = app.code.view.state.selection.main
      sel = m.empty ? '' : app.code.view.state.sliceDoc(m.from, m.to)
    }
    const all = countText(app.getMarkdown())
    const part = sel ? countText(sel) : null
    const msg = all.words + ' words, ' + all.chars + ' characters' + (part ? '. Selection: ' + part.words + ' words' : '')
    app.toast && app.toast(msg)
  }

  function setSize(px) {
    app.settings.set('fontSize', Math.min(SIZE_MAX, Math.max(SIZE_MIN, px)))
  }

  function run(action) {
    focusEditor()
    const r = rich()
    const H = { title: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 }
    if (H[action]) return r ? richKey(String(H[action]), { alt: true }) : sourceBlock('#'.repeat(H[action]) + ' ')
    if (action.startsWith('size:')) return setSize(Number(action.slice(5)))
    switch (action) {
      case 'cut':
      case 'copy':
        document.execCommand(action)
        break
      case 'paste':
        // execCommand('paste') is refused in some states; fall back to reading the clipboard as text
        if (window.folio && window.folio.paste) window.folio.paste()
        else if (!document.execCommand('paste')) pastePlain()
        break
      case 'selectAll':
        document.execCommand('selectAll')
        break
      case 'body':
        return r ? richKey('0', { alt: true }) : sourceBlock('')
      case 'quote':
        return r ? richKey('b', { shift: true }) : sourceBlock('> ')
      case 'codeblock':
        return r ? richKey('c', { alt: true }) : sourceFence()
      case 'bullets':
        return r ? richKey('8', { alt: true }) : sourceBlock('- ')
      case 'numbers':
        return r ? richKey('7', { alt: true }) : sourceBlock('1. ')
      case 'task':
        return r ? richTask() : sourceBlock('- [ ] ')
      case 'divider':
        return r ? richDivider() : sourceDivider()
      case 'bold':
        return r ? richKey('b') : sourceWrap('**')
      case 'italic':
        return r ? richKey('i') : sourceWrap('*')
      case 'underline':
        return r ? richUnderline() : sourceWrap('<u>', '</u>')
      case 'strike':
        return r ? richKey('x', { alt: true }) : sourceWrap('~~')
      case 'code':
        return r ? richKey('e') : sourceWrap('`')
      case 'clear':
        return r ? richClear() : sourceClear()
      case 'undo':
      case 'redo': {
        const key = action === 'undo' ? 'z' : 'y'
        const kc = action === 'undo' ? 90 : 89
        if (r) return richKey(key)
        return app.code.view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key, code: 'Key' + key.toUpperCase(), keyCode: kc, ctrlKey: true, bubbles: true, cancelable: true }))
      }
      case 'pastePlain':
        return pastePlain()
      case 'selectLine':
        return sourceSelectLine()
      case 'dupLine':
        return sourceDuplicateLine()
      case 'lineUp':
        return sourceMoveLine(-1)
      case 'lineDown':
        return sourceMoveLine(1)
      case 'table':
        return r ? richTable() : sourceTable()
      case 'find':
        return app.commands.run('find.open')
      case 'replace':
        return app.commands.run('find.replace')
      case 'wordcount':
        return wordCount()
      case 'datetime':
        return app.textTools && app.textTools.insertDateTime()
      case 'larger':
        return setSize(app.settings.get('fontSize') + 1)
      case 'smaller':
        return setSize(app.settings.get('fontSize') - 1)
      case 'reset':
        return setSize(SIZE_DEFAULT)
    }
  }

  // Remember the editor selection so a click or key on our UI can put it back before acting.
  function captureRestore() {
    const wasRich = rich()
    const editor = wasRich ? pm() : null
    const sel = document.getSelection()
    const saved = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null
    restoreFocus = () => {
      if (!wasRich) return app.code && app.code.view.focus()
      if (editor) editor.focus()
      if (saved) {
        const s = document.getSelection()
        s.removeAllRanges()
        s.addRange(saved)
      }
    }
  }

  /* ---------- the bar: icon row + collapsible menu body ---------- */
  const QUICK = [
    { block: true },
    { icon: 'bold', label: 'Bold', kbd: 'Ctrl+B', action: 'bold', st: 'bold' },
    { icon: 'italic', label: 'Italic', kbd: 'Ctrl+I', action: 'italic', st: 'italic' },
    { icon: 'underline', label: 'Underline', action: 'underline', st: 'underline' },
    { icon: 'strike', label: 'Strikethrough', kbd: 'Ctrl+Alt+X', action: 'strike', st: 'strike' },
    { icon: 'code', label: 'Code', kbd: 'Ctrl+E', action: 'code', st: 'code' },
    { sep: true },
    { size: true },
  ]
  const BLOCKS = [
    { label: 'Paragraph', action: 'body', key: 0, kbd: 'Ctrl+Alt+0' },
    { label: 'Title', action: 'title', key: 1, kbd: 'Ctrl+Alt+1' },
    { label: 'Heading 2', action: 'h2', key: 2, kbd: 'Ctrl+Alt+2' },
    { label: 'Heading 3', action: 'h3', key: 3, kbd: 'Ctrl+Alt+3' },
    { label: 'Heading 4', action: 'h4', key: 4, kbd: 'Ctrl+Alt+4' },
    { label: 'Heading 5', action: 'h5', key: 5, kbd: 'Ctrl+Alt+5' },
    { label: 'Heading 6', action: 'h6', key: 6, kbd: 'Ctrl+Alt+6' },
    { label: 'Quote', action: 'quote', key: 'quote', kbd: 'Ctrl+Shift+B' },
    { label: 'Code block', action: 'codeblock', key: 'code', kbd: 'Ctrl+Alt+C' },
  ]
  // The block name shown on the trigger: the standard styles by number, anything else by what the line is.
  function blockName(st) {
    if (st.codeblock) return 'Code block'
    if (st.task) return 'Task list'
    if (st.bullets) return 'Bullet list'
    if (st.numbers) return 'Numbered list'
    if (st.quote) return 'Quote'
    if (!st.block) return 'Paragraph'
    if (st.block === 1) return 'Title'
    return 'Heading ' + st.block
  }
  // Which BLOCKS row is current: a code block or quote by name, a list has no row (it gets its own), else the heading level.
  const blockKeyOf = (st) => (st.codeblock ? 'code' : st.task || st.bullets || st.numbers ? null : st.quote ? 'quote' : st.block || 0)
  const bar = el('div', 'qbar')
  bar.id = 'qbar'
  bar.hidden = true
  const row = el('div', 'qb-row')
  row.setAttribute('role', 'toolbar')
  row.setAttribute('aria-label', 'Quick formatting (Alt+F10 to focus)')
  const body = el('div', 'qb-body')
  const inner = el('div', 'qb-inner')
  const list = el('div', 'qb-list')
  list.setAttribute('role', 'menu')
  list.setAttribute('aria-label', 'Document menu')
  list.inert = true
  inner.appendChild(list)
  body.appendChild(inner)
  bar.append(row, body)
  document.body.appendChild(bar)

  /* ---------- compact drop-down: one family for the block style and the size ---------- */
  let dd = null // the open drop-down: { trigger, panel }
  function closeDd(refocus = false) {
    if (!dd) return
    const t = dd.trigger
    leave(dd.panel)
    t.setAttribute('aria-expanded', 'false')
    t.classList.remove('open')
    dd = null
    if (refocus) t.focus()
  }
  function makeDropdown(cls, name, tip, fill, onPick) {
    const t = el('button', 'qb-dd ' + cls)
    t.type = 'button'
    t.tabIndex = -1
    t.title = tip
    t.setAttribute('aria-label', name)
    t.setAttribute('aria-haspopup', 'listbox')
    t.setAttribute('aria-expanded', 'false')
    const lab = el('span', 'qb-dd-label')
    const chev = icon('chevron')
    chev.classList.add('qb-dd-chev')
    t.append(lab, chev)
    t.addEventListener('mousedown', (e) => e.preventDefault())
    const open = (viaKey) => {
      if (dd && dd.trigger === t) return closeDd()
      closeDd()
      closeSubs()
      const panel = el('div', 'ctx-menu ctx-dd ' + cls + '-panel')
      panel.setAttribute('role', 'listbox')
      panel.setAttribute('aria-label', name)
      const rows = []
      const setRow = (b, focus = true) => {
        for (const r of rows) r.classList.toggle('active', r === b)
        if (focus) b.focus()
      }
      for (const it of fill()) {
        const b = el('button', 'ctx-item ctx-dd-item' + (it.on ? ' ctx-on' : ''))
        b.type = 'button'
        b.tabIndex = -1
        b.setAttribute('role', 'option')
        b.setAttribute('aria-selected', it.on ? 'true' : 'false')
        const ck = icon('check')
        ck.classList.add('ctx-dd-check')
        if (!it.on) ck.classList.add('ctx-dd-off')
        b.append(ck, el('span', 'ctx-label', it.label))
        if (it.kbd) b.appendChild(el('kbd', null, it.kbd))
        b.addEventListener('mousedown', (e) => e.preventDefault())
        b.addEventListener('mouseenter', () => setRow(b, false))
        b.addEventListener('click', () => {
          closeDd()
          onPick(it)
        })
        panel.appendChild(b)
        rows.push(b)
      }
      root.appendChild(panel)
      t.setAttribute('aria-expanded', 'true')
      t.classList.add('open')
      // Block style lines up with the bar's left edge. Text size is as wide as its button (never narrower than 64 px) and lines up with the button's right edge.
      const br = bar.getBoundingClientRect()
      const tr = t.getBoundingClientRect()
      if (cls === 'qb-size') panel.style.minWidth = Math.max(64, Math.round(tr.width)) + 'px'
      // offsetWidth, not getBoundingClientRect: the open animation scales the panel and would shift its measured edge.
      const pw = panel.offsetWidth
      const ph = panel.offsetHeight
      const below = br.bottom + 4 + ph <= window.innerHeight - 8
      const x = cls === 'qb-size' ? tr.right - pw : br.left
      panel.style.left = Math.max(8, Math.min(x, window.innerWidth - pw - 8)) + 'px'
      panel.style.top = Math.max(8, below ? br.bottom + 4 : br.top - 4 - ph) + 'px'
      panel.style.transformOrigin = below ? 'top left' : 'bottom left'
      const cur = rows.find((r) => r.classList.contains('ctx-on')) || rows[0]
      panel.addEventListener('keydown', (e) => {
        const at = rows.indexOf(document.activeElement)
        const go = (i) => setRow(rows[(i + rows.length) % rows.length])
        if (e.key === 'ArrowDown') go(at + 1)
        else if (e.key === 'ArrowUp') go(at < 0 ? rows.length - 1 : at - 1)
        else if (e.key === 'Home') go(0)
        else if (e.key === 'End') go(rows.length - 1)
        else if (e.key === 'Enter' || e.key === ' ') rows[at] && rows[at].click()
        else if (e.key === 'Escape' || e.key === 'Tab') closeDd(true)
        else return
        e.preventDefault()
        e.stopPropagation()
      })
      dd = { trigger: t, panel }
      setRow(cur, viaKey !== false)
    }
    t.addEventListener('click', (e) => open(e.detail === 0))
    t.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && dd && dd.trigger === t) {
        e.preventDefault()
        e.stopPropagation()
        closeDd(true)
      } else if (e.key === 'ArrowDown' && !(dd && dd.trigger === t)) {
        e.preventDefault()
        e.stopPropagation()
        open(true)
      }
    })
    return { t, lab }
  }

  const barBtns = []
  let blockDd = null
  let sizeDd = null
  const afterPick = () => {
    if (expanded) hideAll()
    else setTimeout(updateBar, 30)
  }
  for (const q of QUICK) {
    if (q.sep) {
      row.appendChild(el('span', 'qb-sep'))
      continue
    }
    if (q.block) {
      blockDd = makeDropdown('qb-block', 'Block style', 'Block style', () => {
        const st = barState()
        const cur = blockKeyOf(st)
        const rows = BLOCKS.map((b) => ({ ...b, on: b.key === cur }))
        if (cur === null) rows.push({ label: blockName(st), action: null, on: true })
        return rows
      }, (it) => {
        focusEditor()
        if (!it.action || it.on) return
        run(it.action)
        afterPick()
      })
      blockDd.t.dataset.action = 'block'
      barBtns.push(blockDd.t)
      row.appendChild(blockDd.t)
      continue
    }
    if (q.size) {
      sizeDd = makeDropdown('qb-size', 'Text size', 'Text size in px', () => {
        const size = app.settings.get('fontSize')
        const rows = PRESETS.map(([, px]) => ({ label: String(px), px, on: px === size }))
        if (!rows.some((r) => r.on)) rows.push({ label: String(size), px: size, on: true })
        return rows
      }, (it) => {
        focusEditor()
        setSize(it.px)
        syncSizeButtons()
        refreshSizePanel()
        if (expanded) hideAll()
      })
      sizeDd.t.dataset.action = 'sizeset'
      barBtns.push(sizeDd.t)
      row.appendChild(sizeDd.t)
      continue
    }
    const b = el('button', 'qb-btn')
    b.type = 'button'
    b.tabIndex = -1
    b.dataset.action = q.action
    if (q.st) b.dataset.st = q.st
    b.title = q.kbd ? `${q.label} (${q.kbd})` : q.label
    b.setAttribute('aria-label', q.label)
    b.appendChild(icon(q.icon))
    if (q.st) b.setAttribute('aria-pressed', 'false')
    b.addEventListener('mousedown', (e) => e.preventDefault()) // keep the editor selection
    b.addEventListener('click', () => {
      closeDd()
      const wasExpanded = expanded
      if (wasExpanded) hideAll()
      run(q.action)
      if (!wasExpanded) setTimeout(updateBar, 30)
    })
    b.addEventListener('mouseenter', () => expanded && closeSubsSoon())
    barBtns.push(b)
    row.appendChild(b)
  }

  function syncSizeButtons() {
    if (sizeDd) sizeDd.lab.textContent = String(app.settings.get('fontSize'))
  }

  // Highlight the block style, inline marks and list type that apply to the selection.
  function syncState() {
    const st = barState()
    if (blockDd) blockDd.lab.textContent = blockName(st)
    for (const b of barBtns) {
      const key = b.dataset.st
      if (!key) continue
      const on = !!st[key]
      b.classList.toggle('on', on)
      b.setAttribute('aria-pressed', on ? 'true' : 'false')
    }
  }

  let mouseDown = false
  let quiet = false // set after a menu closes; cleared by the next pointer or key action in the document
  let dismissedSig = null
  let barActive = -1

  function selectionRect() {
    if (rich()) {
      const sel = document.getSelection()
      const p = pm()
      if (!p || !sel.rangeCount || sel.isCollapsed || !p.contains(sel.anchorNode) || !p.contains(sel.focusNode)) return null
      const rects = [...sel.getRangeAt(0).getClientRects()].filter((r) => r.width > 0 && r.height > 0)
      if (!rects.length) return null
      const first = rects[0]
      const last = rects[rects.length - 1]
      return { top: first.top, bottom: last.bottom, l: Math.min(...rects.map((q) => q.left)), r: Math.max(...rects.map((q) => q.right)), x: first.left + Math.min(first.width, 240) / 2, sig: 'r' + sel.toString().length + ':' + Math.round(first.left) + ':' + Math.round(first.top) }
    }
    const v = app.code && app.code.view
    if (!v) return null
    const m = v.state.selection.main
    if (m.empty) return null
    const a = v.coordsAtPos(m.from)
    const b = v.coordsAtPos(m.to)
    if (!a || !b) return null
    const sameLine = Math.abs(a.top - b.top) < 2
    const cr = v.contentDOM.getBoundingClientRect()
    return { top: a.top, bottom: b.bottom, l: sameLine ? Math.min(a.left, b.left) : cr.left, r: sameLine ? Math.max(a.left, b.left) : cr.right, x: sameLine ? (a.left + b.left) / 2 : a.left + 60, sig: 's' + m.from + ':' + m.to }
  }

  function hideBar() {
    if (expanded) return
    closeDd()
    closeSubs()
    bar.hidden = true
    bar.classList.remove('open')
    if (barActive >= 0) barBtns[barActive].classList.remove('active')
    barActive = -1
  }

  function updateBar() {
    if (expanded) return
    // focus is inside the bar (its size select) or its link box: leave it where it is
    const ae = document.activeElement
    if (!bar.hidden && ae && (bar.contains(ae) || root.contains(ae))) return syncState()
    if (quiet || mouseDown || !editable()) return hideBar()
    const r = selectionRect()
    if (!r) {
      dismissedSig = null
      return hideBar()
    }
    if (dismissedSig === r.sig) return hideBar()
    const hostRect = docEl.getBoundingClientRect()
    if (r.bottom < hostRect.top || r.top > hostRect.bottom) return hideBar()
    const wasHidden = bar.hidden
    bar.hidden = false
    const w = bar.offsetWidth
    const h = bar.offsetHeight
    let top = r.bottom + 8 // below the selected text, so it never covers what is being read or copied
    if (top + h > Math.min(window.innerHeight, hostRect.bottom) - 4) top = r.top - h - 8 // no room below: above
    top = Math.max(4, Math.min(top, window.innerHeight - h - 4))
    const left = Math.max(8, Math.min(r.x - w / 2, window.innerWidth - w - 8))
    bar.style.left = left + 'px'
    bar.style.top = top + 'px'
    if (wasHidden) {
      bar.classList.remove('open')
      void bar.offsetWidth
      bar.classList.add('open')
    }
    syncSizeButtons()
    syncState()
    const ae2 = document.activeElement
    if (!bar.contains(ae2) && !root.contains(ae2)) captureRestore()
  }

  let timerBar = 0
  const scheduleBar = () => {
    clearTimeout(timerBar)
    timerBar = setTimeout(updateBar, 30)
  }
  document.addEventListener('selectionchange', scheduleBar)
  docEl.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return
    mouseDown = true
    quiet = false
    if (expanded) hideAll()
    hideBar()
  })
  document.addEventListener('mouseup', () => {
    if (!mouseDown) return
    mouseDown = false
    scheduleBar()
  })
  docEl.addEventListener('keyup', () => {
    quiet = false
    scheduleBar()
  })
  document.addEventListener('mousedown', (e) => {
    // a click or right-click anywhere outside the open bar drop-down (and its own trigger) closes it
    if (dd && !dd.panel.contains(e.target) && !dd.trigger.contains(e.target)) closeDd()
  }, true)
  document.addEventListener('mousedown', (e) => {
    if (bar.hidden || bar.contains(e.target) || root.contains(e.target) || docEl.contains(e.target)) return
    hideAll()
    hideBar()
  }, true)
  document.addEventListener('scroll', (e) => {
    if (expanded && e.target && e.target.id === 'editor-scroll') hideAll()
    else scheduleBar()
  }, true)
  window.addEventListener('resize', () => (expanded ? hideAll() : scheduleBar()))
  window.addEventListener('focus', scheduleBar)

  /* ---------- menu content ---------- */
  // Grouped by what the user does, each group with a small heading and about six rows at most.
  // Copy and Paste are single clicks. Only items the app really supports are listed.
  // Source view edits plain text: only items that insert Markdown syntax or edit text, no block or mark commands.
  function sourceModel(level, clip, direct, editGroup) {
    // Block style (headings, quote, code block), inline marks and size live in the bar. Link, quote and the lists are direct rows.
    const line = [
      { label: 'Select line', icon: 'line', action: 'selectLine' },
      { label: 'Duplicate line', icon: 'dup', action: 'dupLine' },
      { label: 'Move line up', icon: 'up', action: 'lineUp' },
      { label: 'Move line down', icon: 'down', action: 'lineDown' },
    ]
    const table = { label: 'Table', icon: 'table', action: 'table' }
    const find = [{ label: 'Find', icon: 'search', kbd: 'Ctrl+F', action: 'find' }, { label: 'Replace', icon: 'replace', kbd: 'Ctrl+H', action: 'replace' }]
    const wc = { label: 'Word count', icon: 'count', action: 'wordcount' }
    if (level >= 1) {
      return [
        { head: 'Clipboard', noHead: true, items: level >= 2 ? [{ label: 'Clipboard', icon: 'paste', sub: clip }] : clip },
        { head: 'Insert', noHead: true, items: direct },
        { head: 'Edit', noHead: true, items: editGroup },
        { head: 'Menu', noHead: true, items: [find[0], { label: 'More', icon: 'insert', sub: [table, { sep: true }, find[1], wc, { sep: true }, ...line] }] },
      ]
    }
    return [
      { head: 'Clipboard', items: clip },
      { head: 'Insert', items: direct },
      { head: 'Edit', items: editGroup },
      { head: 'Menu', noHead: true, items: [find[0], { label: 'Line', icon: 'line', sub: line }, { label: 'More', icon: 'insert', sub: [table, { sep: true }, find[1], wc] }] },
    ]
  }

  function menuModel(level = 0) {
    const src = !rich()
    // Block style, inline marks and size live in the quick bar. Link, quote and the lists are direct rows here (none is on the bar).
    const direct = [
      { label: 'Link', icon: 'link', action: 'link', custom: 'link' },
      { label: 'Quote', icon: 'quote', kbd: 'Ctrl+Shift+B', action: 'quote' },
      { label: 'Bullet list', icon: 'bullets', kbd: 'Ctrl+Alt+8', action: 'bullets' },
      { label: 'Numbered list', icon: 'numbers', kbd: 'Ctrl+Alt+7', action: 'numbers' },
      { label: 'Task list', icon: 'task', action: 'task' },
    ]
    const more = [
      { label: 'Table', icon: 'table', action: 'table' },
      { label: 'Date and time', icon: 'calendar', kbd: 'Ctrl+Shift+D', action: 'datetime' },
      { label: 'Divider', icon: 'divider', action: 'divider' },
    ]
    // The Edit group: four quick rows. Everything else that edits sits under a More row, once.
    const editGroup = [
      { label: 'Select all', icon: 'selectall', kbd: 'Ctrl+A', action: 'selectAll' },
      { label: 'Undo', icon: 'reset', kbd: 'Ctrl+Z', action: 'undo' },
      { label: 'Redo', icon: 'redo', kbd: 'Ctrl+Y', action: 'redo' },
      { label: 'Paste as plain text', icon: 'plain', kbd: 'Ctrl+Shift+V', action: 'pastePlain' },
    ]
    const editMore = [
      { label: 'Replace', icon: 'replace', kbd: 'Ctrl+H', action: 'replace' },
      { label: 'Word count', icon: 'count', action: 'wordcount' },
      { label: 'Clear formatting', icon: 'clear', action: 'clear' },
    ]
    const clip = [{ label: 'Cut', icon: 'cut', kbd: 'Ctrl+X', action: 'cut' }, { label: 'Copy', icon: 'copy', kbd: 'Ctrl+C', action: 'copy' }, { label: 'Paste', icon: 'paste', kbd: 'Ctrl+V', action: 'paste' }]
    const find = { label: 'Find', icon: 'search', kbd: 'Ctrl+F', action: 'find' }
    if (src) return sourceModel(level, clip, direct, editGroup)
    if (level >= 1) {
      return [
        { head: 'Clipboard', noHead: true, items: level >= 2 ? [{ label: 'Clipboard', icon: 'paste', sub: clip }] : clip },
        { head: 'Insert', noHead: true, items: direct },
        { head: 'Edit', noHead: true, items: editGroup },
        { head: 'Menu', noHead: true, items: [find, { label: 'More', icon: 'insert', sub: [...more, { sep: true }, ...editMore] }] },
      ]
    }
    return [
      { head: 'Clipboard', items: clip },
      { head: 'Insert', items: direct },
      { head: 'Edit', items: [...editGroup, { label: 'More edit', icon: 'selectall', sub: editMore }] },
      { head: 'Menu', noHead: true, items: [find, { label: 'Insert more', icon: 'insert', sub: more }] },
    ]
  }

  function buildGroups(groups, container, onEnter) {
    const all = []
    groups.forEach((g, i) => {
      const box = el('div', 'ctx-group')
      box.setAttribute('role', 'group')
      box.setAttribute('aria-label', g.head)
      if (g.items.length > 2 && !g.noHead) box.appendChild(el('div', 'ctx-head', g.head))
      else if (i) box.appendChild(el('div', 'ctx-sep'))
      all.push(...buildPanelItems(g.items, box, onEnter))
      container.appendChild(box)
    })
    return all
  }

  let timer = 0
  const subs = [] // open submenus: { panel, buttons, parentBtn }
  let listBtns = []

  function closeSubs() {
    while (subs.length) {
      const s = subs.pop()
      leave(s.panel)
      s.parentBtn.setAttribute('aria-expanded', 'false')
    }
  }
  function closeSubsSoon() {
    clearTimeout(timer)
    timer = setTimeout(closeSubs, INTENT_MS)
  }

  function refreshSizePanel() {
    const panel = root.querySelector('.ctx-size')
    if (!panel) return
    const size = app.settings.get('fontSize')
    const line = panel.querySelector('.ctx-line')
    if (line) line.textContent = `Sample text at ${size} px`
    const ro = panel.querySelector('.ctx-readout')
    if (ro) ro.textContent = `${size} px`
    for (const b of panel.querySelectorAll('.ctx-stepbtn')) {
      if (b.dataset.act === 'smaller') b.disabled = size <= SIZE_MIN
      if (b.dataset.act === 'larger') b.disabled = size >= SIZE_MAX
    }
    for (const b of panel.querySelectorAll('[data-px]')) {
      const on = Number(b.dataset.px) === size
      b.classList.toggle('ctx-on', on)
      b.setAttribute('aria-checked', on ? 'true' : 'false')
      b.querySelector('.ctx-ico').innerHTML = iconSvg(on ? 'check' : 'size')
    }
    const rs = panel.querySelector('[data-reset]')
    if (rs) rs.disabled = size === SIZE_DEFAULT
  }

  function buildButton(it, container, onEnter) {
    const b = el('button', 'ctx-item' + (it.sub ? ' ctx-has-sub' : ''))
    b.type = 'button'
    b.setAttribute('role', 'menuitem')
    b.tabIndex = -1
    b.disabled = !!it.disabled
    if (it.badge) {
      const s = el('span', 'ctx-ico ctx-badge', it.badge)
      s.setAttribute('aria-hidden', 'true')
      b.appendChild(s)
    } else if (it.px) {
      b.dataset.px = it.px
      b.setAttribute('role', 'menuitemradio')
      b.appendChild(icon('size'))
    } else if (it.icon) b.appendChild(icon(it.icon))
    if (it.reset) b.dataset.reset = '1'
    const lab = el('span', 'ctx-label', it.label)
    if (it.sample) {
      lab.classList.add('ctx-sample')
      lab.style.setProperty('--ctx-scale', it.sample.scale)
      lab.style.fontWeight = it.sample.weight
      if (it.sample.italic) lab.style.fontStyle = 'italic'
      if (it.sample.kind) lab.classList.add('ctx-s-' + it.sample.kind)
    }
    if (it.px) {
      lab.classList.add('ctx-sample')
      lab.style.setProperty('--ctx-px', it.px + 'px')
      lab.classList.add('ctx-s-px')
    }
    b.appendChild(lab)
    if (it.sub) {
      b.setAttribute('aria-haspopup', 'menu')
      b.setAttribute('aria-expanded', 'false')
      b.appendChild(el('span', 'ctx-chev', '›'))
    } else if (it.px) b.appendChild(el('kbd', null, it.px + ' px'))
    else if (it.kbd) b.appendChild(el('kbd', null, it.kbd))
    b.addEventListener('mousedown', (e) => e.preventDefault())
    b.addEventListener('mouseenter', () => {
      if (b.disabled) return
      clearTimeout(timer)
      onEnter(b)
      if (it.sub || subs.length) {
        timer = setTimeout(() => {
          const top = subs[subs.length - 1]
          if (top && top.parentBtn === b) return
          if (top && root.contains(b)) return // hovering inside an open submenu keeps it
          closeSubs()
          if (it.sub) openSub(b, it)
        }, INTENT_MS)
      }
    })
    b.addEventListener('click', () => {
      if (it.sub) {
        clearTimeout(timer)
        closeSubs()
        openSub(b, it)
        return
      }
      if (it.custom === 'link') return openLink(b)
      if (it.keep) {
        run(it.action)
        syncSizeButtons()
        refreshSizePanel()
        b.focus()
        return
      }
      hideAll()
      run(it.action)
    })
    container.appendChild(b)
    return b
  }

  function buildStepper(container, onEnter) {
    const wrap = el('div', 'ctx-step')
    const btns = []
    const mk = (act, name) => {
      const b = el('button', 'ctx-item ctx-stepbtn')
      b.type = 'button'
      b.dataset.act = act
      b.setAttribute('role', 'menuitem')
      b.setAttribute('aria-label', name)
      b.title = name
      b.tabIndex = -1
      if (act === 'reset') b.classList.add('ctx-readout')
      else b.appendChild(icon(act))
      b.addEventListener('mousedown', (e) => e.preventDefault())
      b.addEventListener('mouseenter', () => !b.disabled && onEnter(b))
      b.addEventListener('click', () => {
        run(act)
        syncSizeButtons()
        refreshSizePanel()
        b.focus()
      })
      btns.push(b)
      return b
    }
    wrap.append(mk('smaller', 'Smaller'), mk('reset', 'Reset to ' + SIZE_DEFAULT + ' px'), mk('larger', 'Larger'))
    container.appendChild(wrap)
    return btns
  }

  function buildPanelItems(items, container, onEnter) {
    const buttons = []
    for (const it of items) {
      if (it.sep) container.appendChild(el('div', 'ctx-sep'))
      else if (it.line) container.appendChild(el('div', 'ctx-line'))
      else if (it.stepper) buttons.push(...buildStepper(container, onEnter))
      else buttons.push(buildButton(it, container, onEnter))
    }
    return buttons
  }

  function setActive(btn, focus = true) {
    for (const b of [...barBtns, ...listBtns, ...subs.flatMap((s) => s.buttons)]) b.classList.remove('active')
    btn.classList.add('active')
    if (focus) btn.focus()
  }

  function placeSub(panel, parentBtn) {
    const br = bar.getBoundingClientRect()
    const pr = parentBtn.getBoundingClientRect()
    const r = panel.getBoundingClientRect()
    const { innerWidth: W, innerHeight: H } = window
    let left = br.right - 3
    let origin = 'top left'
    if (left + r.width > W - 8) {
      left = br.left + 3 - r.width
      origin = 'top right'
    }
    panel.style.left = Math.max(8, left) + 'px'
    panel.style.top = Math.max(8, Math.min(pr.top - 5, H - r.height - 8)) + 'px'
    panel.style.transformOrigin = origin
  }

  function openSub(parentBtn, it) {
    const panel = el('div', 'ctx-menu ctx-sub' + (it.label === 'Text size' ? ' ctx-size' : ''))
    panel.setAttribute('role', 'menu')
    panel.setAttribute('aria-label', it.label)
    const buttons = buildPanelItems(it.sub, panel, (b) => setActive(b, false))
    panel.addEventListener('mouseenter', () => clearTimeout(timer))
    root.appendChild(panel)
    if (it.label === 'Text size') refreshSizePanel()
    placeSub(panel, parentBtn)
    subs.push({ panel, buttons, parentBtn })
    parentBtn.setAttribute('aria-expanded', 'true')
  }

  // Rich view needs an address for a link: a small input panel beside the Link row (Source view just inserts [text]()).
  function openLink(parentBtn) {
    if (!rich()) {
      hideAll()
      focusEditor()
      return sourceLink()
    }
    const sub = subs[subs.length - 1]
    const panel = el('div', 'ctx-menu ctx-sub ctx-linkbox')
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-label', 'Link address')
    panel.appendChild(el('label', 'ctx-line-label', 'Link address'))
    const input = el('input', 'ctx-input')
    input.type = 'text'
    input.placeholder = 'https://example.com'
    input.setAttribute('aria-label', 'Link address')
    panel.appendChild(input)
    panel.appendChild(el('div', 'ctx-hint', 'Enter to apply, Escape to cancel'))
    root.appendChild(panel)
    if (expanded) {
      placeSub(panel, parentBtn)
      panel.style.left = sub ? sub.panel.style.left : panel.style.left
      const bound = sub ? sub.panel.getBoundingClientRect() : bar.getBoundingClientRect()
      panel.style.left = Math.min(bound.right - 3, window.innerWidth - panel.offsetWidth - 8) + 'px'
      panel.style.top = Math.max(8, parentBtn.getBoundingClientRect().top - 5) + 'px'
    } else {
      // bar collapsed: the box sits just under the bar (above it when there is no room)
      const br = bar.getBoundingClientRect()
      const pw = panel.offsetWidth
      const ph = panel.offsetHeight
      panel.style.left = Math.max(8, Math.min(br.left, window.innerWidth - pw - 8)) + 'px'
      panel.style.top = (br.bottom + 4 + ph > window.innerHeight - 4 ? Math.max(8, br.top - ph - 4) : br.bottom + 4) + 'px'
      panel.style.transformOrigin = 'top left'
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          const url = safeUrl(input.value)
          if (!url) return input.classList.add('bad')
          closeSubs()
          hideBar()
          focusEditor()
          richLink(url)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          closeSubs()
          focusEditor()
        }
      })
    }
    subs.push({ panel, buttons: [], parentBtn, link: input })
    input.focus()
  }

  /* ---------- expand / hide ---------- */
  // The menu never scrolls. It is built at the fullest level that fits the room it has, and when it does not fit, rows move into submenus.
  function fillList(level) {
    list.textContent = ''
    listBtns = buildGroups(menuModel(level), list, (b) => setActive(b, false))
  }

  function openMenu(x, y) {
    closeDd() // one floating panel at a time: a bar drop-down never stays under the menu
    captureRestore()
    if (expanded) hideAll()
    const sel = selectionRect()
    if (bar.hidden || !sel) {
      bar.hidden = false
      if (sel) {
        // text is selected: the bar goes just below it, never over it
        bar.style.left = Math.max(8, Math.min(sel.x - bar.offsetWidth / 2, window.innerWidth - bar.offsetWidth - 8)) + 'px'
        bar.style.top = Math.min(sel.bottom + 8, window.innerHeight - bar.offsetHeight - 4) + 'px'
      } else {
        // no selection: the menu opens at the pointer (this event's clientX and clientY, nothing cached)
        bar.style.left = x + 'px'
        bar.style.top = y + 'px'
      }
      bar.classList.remove('open')
      void bar.offsetWidth
      bar.classList.add('open')
    }
    syncSizeButtons()
    syncState()
    list.style.maxHeight = ''
    list.inert = false
    expanded = true
    // layout position, not getBoundingClientRect: the open animation scales and nudges the bar, which would offset it by a few pixels
    const br0 = { left: bar.offsetLeft, top: bar.offsetTop, height: bar.offsetHeight, bottom: bar.offsetTop + bar.offsetHeight }
    const w0 = bar.offsetWidth
    bar.style.width = w0 + 'px'
    void bar.offsetWidth
    bar.classList.add('expanded')
    const target = Math.max(w0, MENU_W)
    bar.style.width = target + 'px'
    const barBelow = !!sel && br0.top >= sel.bottom - 1
    const room = (up) => (up ? br0.bottom - br0.height - 8 : window.innerHeight - 8 - br0.bottom) - 9
    let level = 0
    let up = false
    for (; level <= 2; level++) {
      fillList(level)
      const natural = list.scrollHeight
      // bar below the selection: grow upward and shift sideways (below). Bar above it: grow upward. Upward has no room: grow down.
      if (sel) up = barBelow ? natural <= room(true) : true
      else up = room(false) < natural && room(true) > room(false) // at the pointer: down, or up when down has no room
      if (natural <= room(up) || level === 2) break
    }
    const lh = list.scrollHeight
    bar.classList.toggle('up', up)
    const H = br0.height + lh + 9
    let left = Math.max(8, Math.min(br0.left, window.innerWidth - target - 8))
    bar.dataset.covers = ''
    if (sel && barBelow && up && sel.bottom > br0.bottom - H + 1 && sel.l != null) {
      // the menu opens over the selection's rows, so move it sideways until it clears the selected words
      const maxL = window.innerWidth - target - 8
      const clear = [sel.l - 8 - target, sel.r + 8].filter((c) => c >= 8 && c <= maxL)
      if (clear.length) left = clear.sort((p, q) => Math.abs(p - left) - Math.abs(q - left))[0]
      else {
        // a selection spanning the full width: cover the least of it
        const ov = (c) => Math.max(0, Math.min(c + target, sel.r) - Math.max(c, sel.l))
        left = [8, maxL, left].sort((p, q) => ov(p) - ov(q))[0]
        bar.dataset.covers = String(ov(left))
      }
    }
    let top = up ? br0.bottom - H : br0.top
    if (up && !sel) top = y - H // the menu opens above the pointer
    top = Math.max(8, Math.min(top, window.innerHeight - H - 4))
    bar.style.left = left + 'px'
    bar.style.top = top + 'px'
  }

  function hideAll() {
    clearTimeout(timer)
    closeDd()
    closeSubs()
    const was = expanded
    expanded = false
    bar.classList.remove('expanded', 'up')
    bar.style.width = ''
    list.style.maxHeight = ''
    list.inert = true
    list.textContent = ''
    listBtns = []
    bar.hidden = true
    bar.classList.remove('open')
    if (barActive >= 0) barBtns[barActive].classList.remove('active')
    barActive = -1
    if (was) quiet = true // the bar stays away until the next pointer or key action in the document
  }

  /* ---------- keyboard ---------- */
  const rowEnabled = () => barBtns.filter((b) => !b.disabled)
  const listEnabled = () => listBtns.filter((b) => !b.disabled)

  function markRow(i) {
    const rl = rowEnabled()
    if (!rl.length) return
    const next = rl[(i + rl.length) % rl.length]
    barActive = barBtns.indexOf(next)
    setActive(next)
  }

  function enterFirstOfTopSub() {
    const t = subs[subs.length - 1]
    const f = t && t.buttons.find((b) => !b.disabled)
    if (f) setActive(f)
  }

  document.addEventListener('keydown', (e) => {
    const k = e.key
    if (dd && dd.panel.contains(document.activeElement)) return // the open drop-down handles its own keys
    if (dd && e.key === 'Escape') { // opened with the mouse, so focus is elsewhere: Escape still closes it first
      e.preventDefault()
      return closeDd()
    }
    if (bar.hidden) return
    // collapsed bar: Escape dismisses it for this selection
    if (!expanded && k === 'Escape') {
      const r = selectionRect()
      dismissedSig = r ? r.sig : null
      const inBar = bar.contains(document.activeElement)
      hideBar()
      if (inBar) focusEditor()
      return
    }
    if (!expanded && e.altKey && k === 'F10') {
      e.preventDefault()
      markRow(0)
      return
    }
    const inBar = bar.contains(document.activeElement)
    if (!expanded && !inBar) return
    if (!expanded) {
      const i = rowEnabled().indexOf(barBtns[barActive])
      if (k === 'ArrowRight') (e.preventDefault(), markRow(i + 1))
      else if (k === 'ArrowLeft') (e.preventDefault(), markRow(i - 1))
      else if ((k === 'Enter' || k === ' ') && barActive >= 0) (e.preventDefault(), barBtns[barActive].click())
      return
    }
    // expanded menu
    const cur = document.activeElement
    const topSub = subs[subs.length - 1]
    // typing in the link box: only Enter and Escape are ours
    if (cur && cur.tagName === 'INPUT' && root.contains(cur)) {
      if (k === 'Enter') {
        e.preventDefault()
        const url = safeUrl(cur.value)
        if (!url) return cur.classList.add('bad')
        hideAll()
        focusEditor()
        richLink(url)
      } else if (k === 'Escape') {
        e.preventDefault()
        const parent = topSub.parentBtn
        leave(topSub.panel)
        subs.pop()
        setActive(parent)
      }
      return
    }
    const inSub = subs.length && root.contains(cur)
    const group = inSub ? topSub.buttons.filter((b) => !b.disabled) : null
    const onRow = barBtns.includes(cur)
    const stop = () => e.preventDefault()
    if (k === 'Escape') {
      stop()
      if (subs.length) {
        const parent = (subs.length > 1 && !topSub.buttons.length ? topSub : topSub).parentBtn
        const wasLink = !!topSub.link
        if (wasLink) {
          leave(topSub.panel)
          subs.pop()
        } else closeSubs()
        setActive(parent)
      } else {
        hideAll()
        focusEditor()
      }
    } else if (k === 'ArrowDown' || k === 'ArrowUp') {
      stop()
      const d = k === 'ArrowDown' ? 1 : -1
      if (group) {
        const at = group.indexOf(cur)
        setActive(group[at < 0 ? (d > 0 ? 0 : group.length - 1) : (at + d + group.length) % group.length])
      } else if (onRow) {
        const le = listEnabled()
        setActive(d > 0 ? le[0] : le[le.length - 1])
      } else {
        const le = listEnabled()
        const at = le.indexOf(cur)
        if (at < 0) setActive(d > 0 ? le[0] : le[le.length - 1])
        else if (d < 0 && at === 0) markRow(Math.max(0, rowEnabled().indexOf(barBtns[barActive])))
        else setActive(le[(at + d + le.length) % le.length])
      }
    } else if (k === 'Home' || k === 'End') {
      stop()
      const g = group || listEnabled()
      setActive(k === 'Home' ? g[0] : g[g.length - 1])
    } else if (k === 'ArrowRight') {
      stop()
      if (onRow) markRow(rowEnabled().indexOf(cur) + 1)
      else if (cur.classList.contains('ctx-has-sub')) {
        cur.click()
        enterFirstOfTopSub()
      } else if (cur.classList.contains('ctx-stepbtn') && group) {
        const at = group.indexOf(cur)
        if (at >= 0 && at < group.length - 1 && group[at + 1].classList.contains('ctx-stepbtn')) setActive(group[at + 1])
      }
    } else if (k === 'ArrowLeft') {
      stop()
      if (onRow) markRow(rowEnabled().indexOf(cur) - 1)
      else if (cur.classList.contains('ctx-stepbtn') && group && group.indexOf(cur) > 0 && group[group.indexOf(cur) - 1].classList.contains('ctx-stepbtn')) setActive(group[group.indexOf(cur) - 1])
      else if (subs.length) {
        const parent = subs[0].parentBtn
        closeSubs()
        setActive(parent)
      }
    } else if (k === 'Enter' || k === ' ') {
      if (cur && (cur.classList.contains('ctx-item') || onRow)) {
        stop()
        cur.click()
        if (cur.classList.contains('ctx-has-sub')) enterFirstOfTopSub()
      }
    }
  }, true)

  docEl.addEventListener('contextmenu', (e) => {
    if (!editable()) return
    e.preventDefault()
    clearTimeout(timerBar)
    openMenu(e.clientX, e.clientY)
  })
  document.addEventListener('mousedown', (e) => {
    // any left click outside the bar and its submenus closes the menu
    if (expanded && !bar.contains(e.target) && !root.contains(e.target) && e.button === 0) hideAll()
  }, true)
  document.addEventListener('contextmenu', (e) => {
    if (expanded && !bar.contains(e.target) && !root.contains(e.target) && !docEl.contains(e.target)) hideAll()
  }, true)
}
