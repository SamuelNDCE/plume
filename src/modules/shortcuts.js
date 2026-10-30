// Shared helpers for the keyboard shortcuts of the PDF and Excel viewers (pdfview.js, xlsxview.js).
// The shortcuts are the ones people already know from Adobe Reader / Chrome's PDF viewer and from Excel / Google Sheets.
// This module holds: the text-field test, command wrapping (the app's own window-level key handler runs commands such as
// Ctrl+= or Ctrl+H first, so a viewer that is on screen takes those commands over and passes them on otherwise),
// and the small "Keyboard shortcuts" panel (F1 or Ctrl+/), styled like the find bar (its CSS is the keyboard shortcuts block at the end of modules.css).

export function isTextField(t) {
  if (!t || t.nodeType !== 1) return false
  const tag = t.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag === 'INPUT') return !/^(button|checkbox|radio|submit|reset|range|color|file|image)$/i.test(t.type)
  return t.isContentEditable
}

// While active() is true the viewer's fn runs instead of the app command; otherwise (or inside a text field when
// allowInText is false) the previous behaviour runs unchanged. Returns a cleanup that puts the command back.
export function wrapCommand(app, id, active, fn, allowInText = false) {
  const c = app && app.commands && app.commands.items && app.commands.items.get(id)
  if (!c) return () => {}
  const prev = c.run
  const mine = function () {
    if (active() && (allowInText || !isTextField(document.activeElement))) return fn()
    return prev.apply(this, arguments)
  }
  c.run = mine
  return () => {
    if (c.run === mine) c.run = prev
  }
}

export const PDF_KEYS = [
  ['Pages', [
    ['Down / Right / PageDown', 'Next page (page list focused)'],
    ['Up / Left / PageUp', 'Previous page (page list focused)'],
    ['Home / End', 'First or last page'],
    ['Type a number', 'Jump to that page'],
    ['Ctrl+Shift+R', 'Rotate the page (saved when you save the file)'],
    ['Alt+Up / Alt+Down', 'Move the page up or down (edit tools)'],
    ['Ctrl+Z / Ctrl+Y', 'Undo or redo a PDF edit'],
    ['Ctrl+P', 'Print the PDF'],
  ]],
  ['Find', [
    ['Ctrl+F', 'Find in the PDF'],
    ['Enter / F3', 'Next match'],
    ['Shift+Enter / Shift+F3', 'Previous match'],
    ['Esc', 'Close find'],
  ]],
  ['Move', [
    ['Ctrl+G', 'Go to page'],
    ['Home / End', 'First / last page'],
    ['PgDn / PgUp', 'Down / up one screen'],
    ['Space / Shift+Space', 'Down / up one screen'],
    ['Arrow keys', 'Scroll'],
  ]],
  ['Zoom', [
    ['Ctrl+= / Ctrl++', 'Zoom in'],
    ['Ctrl+-', 'Zoom out'],
    ['Ctrl+0', 'Fit width'],
    ['Ctrl+1', 'Actual size (100%)'],
    ['Ctrl+Wheel', 'Zoom'],
  ]],
  ['Text', [
    ['Ctrl+A', 'Select all text on the page'],
    ['Ctrl+C', 'Copy selected text'],
    ['F1 / Ctrl+/', 'This list'],
  ]],
]

export const XLSX_KEYS = [
  ['Move', [
    ['Arrow keys', 'Move one cell'],
    ['Ctrl+Arrow', 'Jump to the data edge'],
    ['Home / Ctrl+Home', 'Row start / A1'],
    ['Ctrl+End', 'Last used cell'],
    ['PgDn / PgUp', 'Down / up one screen'],
    ['Alt+PgDn / Alt+PgUp', 'Right / left one screen'],
    ['Tab / Shift+Tab', 'Next / previous cell'],
    ['Enter / Shift+Enter', 'Down / up'],
    ['Ctrl+PgDn / Ctrl+PgUp', 'Next / previous sheet'],
    ['Ctrl+G', 'Go to a cell (B12, Sheet2!A1)'],
  ]],
  ['Select', [
    ['Shift+Arrow', 'Extend the selection'],
    ['Ctrl+Shift+Arrow', 'Extend to the data edge'],
    ['Ctrl+A', 'Select all'],
    ['Ctrl+Space', 'Select the column'],
    ['Shift+Space', 'Select the row'],
  ]],
  ['Edit', [
    ['F2', 'Edit the cell'],
    ['Esc', 'Cancel the edit'],
    ['Delete / Backspace', 'Clear the cells'],
    ['Ctrl+Enter', 'Fill the selection'],
    ['Ctrl+D / Ctrl+R', 'Fill down / right'],
    ['Ctrl+; / Ctrl+Shift+;', 'Enter the date / time'],
    ['Ctrl+Z', 'Undo'],
    ['Ctrl+Y / Ctrl+Shift+Z', 'Redo'],
  ]],
  ['Clipboard, find, save', [
    ['Ctrl+C / Ctrl+X', 'Copy / cut'],
    ['Ctrl+V / Ctrl+Shift+V', 'Paste (text, tab separated)'],
    ['Ctrl+F / Ctrl+H', 'Find / replace'],
    ['Ctrl+S', 'Save'],
    ['F1 / Ctrl+/', 'This list'],
  ]],
]

// A closeable panel appended to root. groups: [[heading, [[keys, what], ...]], ...]. Returns { el, toggle, close, isOpen }.
export function shortcutPanel(root, groups, closeIcon) {
  const bar = document.createElement('div')
  bar.className = 'find-bar kb-panel'
  bar.setAttribute('role', 'dialog')
  bar.setAttribute('aria-label', 'Keyboard shortcuts')
  bar.tabIndex = -1
  bar.hidden = true
  const head = document.createElement('div')
  head.className = 'kb-head'
  const title = document.createElement('span')
  title.textContent = 'Keyboard shortcuts'
  const x = document.createElement('button')
  x.type = 'button'
  x.className = 'find-btn'
  x.title = 'Close (Escape)'
  x.setAttribute('aria-label', 'Close keyboard shortcuts')
  if (closeIcon) x.innerHTML = closeIcon
  else x.textContent = 'x'
  head.append(title, x)
  const cols = document.createElement('div')
  cols.className = 'kb-cols'
  for (const [h, rows] of groups) {
    const g = document.createElement('section')
    g.className = 'kb-grp'
    const hh = document.createElement('h3')
    hh.textContent = h
    g.appendChild(hh)
    for (const [k, what] of rows) {
      const r = document.createElement('div')
      r.className = 'kb-row'
      const kb = document.createElement('kbd')
      kb.textContent = k
      const sp = document.createElement('span')
      sp.textContent = what
      r.append(kb, sp)
      g.appendChild(r)
    }
    cols.appendChild(g)
  }
  bar.append(head, cols)
  root.appendChild(bar)
  let back = null
  const api = {
    el: bar,
    isOpen: () => !bar.hidden,
    open() {
      back = document.activeElement
      bar.hidden = false
      bar.focus({ preventScroll: true })
    },
    close() {
      if (bar.hidden) return
      bar.hidden = true
      if (back && back.isConnected && back !== document.body) back.focus({ preventScroll: true })
      back = null
    },
    toggle() {
      bar.hidden ? api.open() : api.close()
    },
  }
  x.addEventListener('click', () => api.close())
  return api
}
