// Notepad-style text tools: Go to line (Ctrl+G), insert date and time (Ctrl+Shift+D),
// and the line-ending / encoding pickers behind the status bar chips.
// File format itself (detect on open, preserve on save) lives in electron/textio.cjs and src/main.js.

export const EOL_LABEL = { crlf: 'CRLF', lf: 'LF', cr: 'CR' }
export const EOL_NAME = { crlf: 'Windows (CRLF)', lf: 'Unix (LF)', cr: 'Classic Mac (CR)' }
export const ENC_LABEL = { 'utf-8': 'UTF-8', 'utf-8-bom': 'UTF-8 with BOM', 'utf-16le': 'UTF-16 LE', 'utf-16be': 'UTF-16 BE', 'windows-1252': 'ANSI (Windows-1252)' }

const el = (tag, cls, text) => {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text != null) n.textContent = text
  return n
}

export function init(app) {
  const root = document.getElementById('texttools-root') || (() => {
    const r = el('div')
    r.id = 'texttools-root'
    document.body.appendChild(r)
    return r
  })()
  let closeCurrent = null

  function close() {
    if (closeCurrent) closeCurrent()
    closeCurrent = null
    root.textContent = ''
  }

  const activeDoc = () => app.state.tabs[app.state.active]
  const editable = () => {
    const d = activeDoc()
    return !!d && (d.kind === 'md' || d.kind === 'text')
  }

  /* ---------- Go to line ---------- */
  function gotoLine() {
    if (app.state.mode !== 'source' || !app.code) return app.toast('Go to line works in Source view (Ctrl+/)')
    close()
    const total = app.code.lineCount()
    const box = el('div', 'tt-dialog')
    box.setAttribute('role', 'dialog')
    box.setAttribute('aria-label', 'Go to line')
    const label = el('label', 'tt-label', `Go to line (1 to ${total})`)
    const input = el('input', 'tt-input')
    input.type = 'text'
    input.inputMode = 'numeric'
    input.id = 'tt-line'
    input.autocomplete = 'off'
    input.spellcheck = false
    input.value = String(app.code.cursorLine())
    label.htmlFor = input.id
    const err = el('div', 'tt-err')
    err.setAttribute('role', 'alert')
    const go = () => {
      const n = parseInt(input.value, 10)
      if (!Number.isFinite(n) || n < 1) return (err.textContent = 'Enter a line number')
      if (n > total) return (err.textContent = `This file has ${total} lines`)
      close()
      app.code.scrollToLine(n)
      app.code.focus()
    }
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        go()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        close()
        app.code.focus()
      }
    })
    box.append(label, input, err)
    root.appendChild(box)
    const away = (e) => {
      if (!box.contains(e.target)) close()
    }
    setTimeout(() => document.addEventListener('mousedown', away), 0)
    closeCurrent = () => document.removeEventListener('mousedown', away)
    input.focus()
    input.select()
  }

  /* ---------- date and time ---------- */
  function insertDateTime() {
    if (!editable()) return
    const now = new Date()
    const s = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + ' ' + now.toLocaleDateString()
    if (app.state.mode === 'source' && app.code) app.code.insert(s)
    else if (app.state.mode === 'wysiwyg') document.execCommand('insertText', false, s)
  }

  /* ---------- pickers for the status bar chips ---------- */
  function menu(anchor, items, current) {
    close()
    const m = el('div', 'tt-menu')
    m.setAttribute('role', 'menu')
    const buttons = []
    for (const [value, text, run] of items) {
      const b = el('button', 'tt-item' + (value === current ? ' on' : ''), text)
      b.type = 'button'
      b.setAttribute('role', 'menuitemradio')
      b.setAttribute('aria-checked', String(value === current))
      b.addEventListener('click', () => {
        close()
        run()
      })
      buttons.push(b)
      m.appendChild(b)
    }
    root.appendChild(m)
    const r = anchor.getBoundingClientRect()
    m.style.right = Math.max(8, window.innerWidth - r.right) + 'px'
    m.style.bottom = window.innerHeight - r.top + 6 + 'px'
    const onKey = (e) => {
      const i = buttons.indexOf(document.activeElement)
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
        anchor.focus()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        buttons[(i + 1) % buttons.length].focus()
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        buttons[(i - 1 + buttons.length) % buttons.length].focus()
      }
    }
    const away = (e) => {
      if (!m.contains(e.target) && !anchor.contains(e.target)) close()
    }
    m.addEventListener('keydown', onKey)
    setTimeout(() => document.addEventListener('mousedown', away), 0)
    closeCurrent = () => document.removeEventListener('mousedown', away)
    ;(buttons.find((b) => b.classList.contains('on')) || buttons[0]).focus()
  }

  const setEol = (eol) => app.actions.setFormat({ eol })
  const setEnc = (encoding) => app.actions.setFormat({ encoding })

  function pick(kind, anchor) {
    const d = activeDoc()
    if (!d) return
    if (kind === 'eol') menu(anchor, Object.keys(EOL_NAME).map((k) => [k, EOL_NAME[k], () => setEol(k)]), d.eol)
    else menu(anchor, Object.keys(ENC_LABEL).map((k) => [k, ENC_LABEL[k], () => setEnc(k)]), d.encoding)
  }

  const reg = (id, title, run, keys, category) => app.commands.register({ id, title, run, keys, category })
  reg('text.gotoLine', 'Go to Line…', gotoLine, 'Ctrl+G', 'Edit')
  reg('text.datetime', 'Insert Date and Time', insertDateTime, 'Ctrl+Shift+D', 'Edit')
  for (const k of Object.keys(EOL_NAME)) reg('text.eol.' + k, 'Line Endings: ' + EOL_NAME[k], () => editable() && setEol(k), null, 'File')
  for (const k of Object.keys(ENC_LABEL)) reg('text.enc.' + k, 'Save Encoding: ' + ENC_LABEL[k], () => editable() && setEnc(k), null, 'File')

  app.textTools = { pick, gotoLine, insertDateTime }
}
