// logview.js: log mode for .log / .out / .err files (and files whose first lines look like logs).
// Pure helpers (no DOM, unit tested in test/logview.test.mjs) come first; the view is below.
// Contract: mount(host, doc, ctx) -> { destroy() } for main.js render(); init(app) registers the toggle command and the back button.
//   ctx = { api (window.folio), toast(msg), raw() }  Colours come from CSS variables (see modules.css "log view").
// The file is never edited from here: filtering only changes what is drawn, the text lives on the doc untouched.

/* ------------------------------------------------------------------ pure: parsing */
export const LEVEL = { none: 0, trace: 1, debug: 2, info: 3, warn: 4, error: 5, fatal: 6 }
export const LEVEL_NAMES = ['', 'trace', 'debug', 'info', 'warn', 'error', 'fatal']
// Chips group the seven levels into four: FATAL counts as ERROR, TRACE as DEBUG.
export const GROUPS = { error: [5, 6], warn: [4], info: [3], debug: [1, 2] }

const WORD = {
  fatal: LEVEL.fatal, critical: LEVEL.fatal, severe: LEVEL.error, error: LEVEL.error, err: LEVEL.error,
  warning: LEVEL.warn, warn: LEVEL.warn, info: LEVEL.info, notice: LEVEL.info,
  debug: LEVEL.debug, trace: LEVEL.trace, verbose: LEVEL.trace,
}
const LV = 'FATAL|CRITICAL|SEVERE|ERROR|ERR|WARNING|WARN|NOTICE|INFO|DEBUG|TRACE|VERBOSE'

// Leading timestamp: ISO-8601 (T or space, optional fraction and zone), 2024/01/31, 31/Jan/2024:10:00:00 +0000,
// syslog "Jan  5 10:00:00", bare time 10:00:00.123, or a date alone. May sit inside [] or ().
const TS_RE = /^\s*[[(]?(?:\d{4}[-/]\d{2}[-/]\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:[.,]\d{1,9})?)?(?:\s?(?:Z|UTC|[+-]\d{2}(?::?\d{2})?))?|\d{4}[-/]\d{2}[-/]\d{2}|\d{1,2}\/[A-Za-z]{3}\/\d{4}:\d{2}:\d{2}:\d{2}(?: [+-]\d{4})?|[A-Z][a-z]{2} {1,2}\d{1,2} \d{2}:\d{2}:\d{2}(?:[.,]\d+)?|\d{2}:\d{2}:\d{2}(?:[.,]\d{1,9})?)[\])]?/
// Level word right at the start (after the timestamp): up to two [thread]/(pid) tokens may come first.
const START_RE = new RegExp('^[\\s|:\\-]*(?:[[(<][^\\])>]{1,40}[\\])>][\\s|:\\-]*){0,2}[[(<]?(' + LV + ')\\b', 'i')
// key=value and JSON forms: level=error, "severity":"warn"
const KV_RE = new RegExp('(?:level|lvl|severity)["\']?\\s*[=:]\\s*["\']?(' + LV + ')\\b', 'i')

// -> { tsEnd, level, lvStart, lvEnd }  (tsEnd 0 = no timestamp; level 0 = none; indices into `line`)
export function parseLine(line) {
  let tsEnd = 0
  const t = TS_RE.exec(line)
  if (t) tsEnd = t[0].length
  const head = line.slice(tsEnd, tsEnd + 160)
  let m = START_RE.exec(head)
  let at
  if (m) at = tsEnd + m.index + m[0].length - m[1].length
  else if ((m = KV_RE.exec(line.length > 400 ? line.slice(0, 400) : line))) at = m.index + m[0].length - m[1].length
  if (!m) return { tsEnd, level: 0, lvStart: -1, lvEnd: -1 }
  return { tsEnd, level: WORD[m[1].toLowerCase()], lvStart: at, lvEnd: at + m[1].length }
}

export function levelGroup(level) {
  for (const g in GROUPS) if (GROUPS[g].includes(level)) return g
  return null
}
export function groupMask(groups) {
  let mask = 0
  for (const g of groups) for (const l of GROUPS[g] || []) mask |= 1 << l
  return mask
}

const LOG_NAME_RE = /\.(log|out|err)(\.\d+|\.\d{4}-\d{2}-\d{2}\S*)?$/i
export const isLogName = (name) => LOG_NAME_RE.test(name || '')

// First 50 lines look like a log when most of them start with a timestamp or an UPPERCASE level word.
export function looksLikeLog(text) {
  const lines = String(text || '').slice(0, 24000).split('\n', 50).filter((l) => l.trim())
  if (lines.length < 5) return false
  let ts = 0
  let lv = 0
  for (const l of lines) {
    const p = parseLine(l.length > 300 ? l.slice(0, 300) : l)
    if (p.tsEnd) ts++
    if (p.level && p.lvStart <= p.tsEnd + 48 && /^[\s[(<|:-]*(?:[[(<][^\])>]{1,40}[\])>][\s|:-]*){0,2}[[(<]?[A-Z]{3,8}\b/.test(l.slice(p.tsEnd))) lv++
  }
  return ts >= lines.length * 0.6 || lv >= lines.length * 0.6
}
export const shouldUseLogMode = (name, text) => isLogName(name) || looksLikeLog(text)

/* ------------------------------------------------------------------ pure: line index and filtering */
// Offsets of every line in a text, with the level of each. Built in time slices (scan) so a huge file never freezes the window.
// Lines without a level and without a timestamp (stack traces, wrapped text) inherit the level above them (eff).
export class LogIndex {
  constructor() {
    this.reset()
  }
  reset() {
    this.text = ''
    this.lower = '' // lower-cased copy of the indexed part of text, built as lines are indexed (fast text search)
    this.lowerLen = 0
    this.lowerOdd = false // true if lower-casing changed a length, so offsets no longer line up
    this.cap = 1024
    this.starts = new Int32Array(this.cap)
    this.ends = new Int32Array(this.cap)
    this.own = new Uint8Array(this.cap)
    this.eff = new Uint8Array(this.cap)
    // An entry starts at a line with a timestamp or a level word; the lines after it that start nothing belong to it.
    this.headOf = new Int32Array(this.cap) // line -> first line of its entry
    this.endOf = new Int32Array(this.cap) // entry head -> first line of the next entry (0 = not known yet, the entry is still open)
    this.fold = new Uint8Array(this.cap) // 1 = entry collapsed (only its first line is shown)
    this.lastHead = -1
    this.entries = 0
    this.n = 0
    this.pos = 0
    this.open = false // the last indexed line has no newline yet, so it may still grow
    this.counts = { error: 0, warn: 0, info: 0, debug: 0 }
    this.maxLen = 0
  }
  _grow() {
    const cap = this.cap * 2
    for (const k of ['starts', 'ends', 'own', 'eff', 'headOf', 'endOf', 'fold']) {
      const a = new this[k].constructor(cap)
      a.set(this[k])
      this[k] = a
    }
    this.cap = cap
  }
  _count(level, d) {
    const g = levelGroup(level)
    if (g) this.counts[g] += d
  }
  // Add text at the end. A last line that had no newline is taken back and read again with its new tail.
  append(more) {
    if (this.open && this.n > 0) {
      this.n--
      if (this.headOf[this.n] === this.n) this.entries--
      this.fold[this.n] = 0
      this.lastHead = this.n > 0 ? this.headOf[this.n - 1] : -1
      if (this.lastHead >= 0) this.endOf[this.lastHead] = 0
      this._count(this.own[this.n], -1)
      this.pos = this.starts[this.n]
      this.open = false
      if (this.lowerLen > this.pos) {
        this.lower = this.lower.slice(0, this.pos)
        this.lowerLen = this.pos
      }
    }
    this.text += more
  }
  get done() {
    return this.pos >= this.text.length
  }
  // Index lines until the time budget (ms) is spent. Returns true when the whole text is indexed.
  scan(budgetMs = 8, now = () => Date.now()) {
    const text = this.text
    const t0 = now()
    while (this.pos < text.length) {
      if (this.n >= this.cap) this._grow()
      const nl = text.indexOf('\n', this.pos)
      const end = nl < 0 ? text.length : nl
      const len = end - this.pos
      const line = text.slice(this.pos, this.pos + (len > 400 ? 400 : len))
      const p = parseLine(line)
      const i = this.n
      this.starts[i] = this.pos
      this.ends[i] = end
      this.own[i] = p.level
      this.eff[i] = p.level || (p.tsEnd === 0 && i > 0 ? this.eff[i - 1] : 0)
      this._count(p.level, 1)
      if (i === 0 || p.level > 0 || p.tsEnd > 0) {
        if (this.lastHead >= 0) this.endOf[this.lastHead] = i
        this.lastHead = i
        this.endOf[i] = 0
        this.entries++
      }
      this.headOf[i] = this.lastHead
      if (len > this.maxLen) this.maxLen = len
      this.n++
      if (nl < 0) {
        this.pos = text.length
        this.open = true
      } else this.pos = nl + 1
      if ((this.n & 1023) === 0 && now() - t0 > budgetMs) break
    }
    if (this.pos > this.lowerLen) {
      const chunk = text.slice(this.lowerLen, this.pos)
      const low = chunk.toLowerCase()
      if (low.length !== chunk.length) this.lowerOdd = true
      this.lower += low
      this.lowerLen = this.pos
    }
    return this.pos >= text.length
  }
  lineText(i) {
    return this.text.slice(this.starts[i], this.ends[i])
  }
  // Index of the line holding text offset p, looking only at lines lo..n-1 (starts[] is sorted).
  lineOf(p, lo = 0) {
    let a = lo
    let b = this.n - 1
    while (a < b) {
      const m = (a + b + 1) >> 1
      if (this.starts[m] <= p) a = m
      else b = m - 1
    }
    return a
  }
}

// Does line i pass the filter? mask = groupMask(...) (0 = every level), q = lower-cased text filter ('' = none).
export function lineMatches(idx, i, mask, q) {
  if (mask && !((mask >> idx.eff[i]) & 1)) return false
  if (q && !idx.lineText(i).toLowerCase().includes(q)) return false
  return true
}

// Which rows to draw. Browsers cap element height (~33 million px), so a huge log scales the scrollbar:
// vTop is the position in the (unscaled) list, layerTop where to put the rows inside the scroll area.
export function windowFor(scrollTop, viewH, count, rowH, maxH = 24e6, overscan = 8) {
  const totalH = count * rowH
  const spacerH = Math.min(totalH, maxH)
  const ratio = totalH > spacerH && spacerH > viewH ? (totalH - viewH) / (spacerH - viewH) : 1
  const vTop = Math.max(0, scrollTop * ratio)
  const hit = Math.min(Math.floor(vTop / rowH), Math.max(0, count - 1))
  const first = Math.max(0, hit - overscan)
  const last = Math.min(count, Math.ceil((vTop + viewH) / rowH) + overscan)
  return { first, last, layerTop: scrollTop - (vTop - first * rowH), spacerH, ratio }
}

/* ------------------------------------------------------------------ view */
const ROW_H = 26
const MAX_COLS = 1500 // longer lines are cut for display (the text itself is untouched)
const POLL_MS = 1000

function h(tag, cls, text) {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text != null) e.textContent = text
  return e
}

const CHIPS = [['error', 'ERROR'], ['warn', 'WARN'], ['info', 'INFO'], ['debug', 'DEBUG']]
const fmt = (n) => n.toLocaleString('en-US')
const yieldUi = () => new Promise((r) => setTimeout(r, 0))

let appRef = null // set by init(); lets a mounted view tell the status bar its document changed
export async function mount(host, d, ctx) {
  const { api } = ctx
  const idx = new LogIndex()
  const groups = new Set()
  let query = ''
  let vis = null // Int32Array of line numbers that pass the filter, null = all lines
  let vlen = 0
  let ventries = 0 // entries in vis
  let anyFold = false // some entry is collapsed, so rows are no longer the plain line list
  let fPos = 0 // next line the filter has not looked at yet
  let destroyed = false
  let pumping = false
  let pumpAgain = false
  let followOn = true
  try { followOn = localStorage.getItem('plume.logFollow') !== '0' } catch {}
  const canFollow = !!d.path && !d.readOnly && !d.truncated && typeof d.logSize === 'number' && !!api.readTail
  d.following = canFollow && followOn
  let pollTimer = 0
  let polling = false
  let notedDisk = false
  // Follow changes the text behind the tab's back: refresh the size now and have the status bar recount words and
  // characters later (coalesced, slower for big logs), through the existing 'doc:change' event it already listens to.
  let statTimer = 0
  function statsChanged(size) {
    if (typeof size === 'number') d.size = size
    clearTimeout(statTimer)
    statTimer = setTimeout(() => {
      if (!destroyed && appRef) appRef.bus.emit('doc:change', d.content)
    }, d.content.length > 2e7 ? 2000 : 400)
  }

  /* ----- DOM ----- */
  const root = h('div', 'lv')
  const bar = h('div', 'lv-bar')
  bar.setAttribute('role', 'toolbar')
  bar.setAttribute('aria-label', 'Log filters')
  const chipEls = {}
  const chipBox = h('div', 'lv-chips')
  for (const [g, label] of CHIPS) {
    const b = h('button', 'lv-chip lv-chip-' + g)
    b.type = 'button'
    b.setAttribute('aria-pressed', 'false')
    b.title = `Only show ${label} lines (click again to undo; select several to combine)`
    const dot = h('span', 'lv-dot')
    dot.setAttribute('aria-hidden', 'true')
    const name = h('span', 'lv-chip-name', label)
    const num = h('span', 'lv-chip-n', '0')
    b.append(dot, name, num)
    b.addEventListener('click', () => {
      if (groups.has(g)) groups.delete(g)
      else groups.add(g)
      b.setAttribute('aria-pressed', String(groups.has(g)))
      refilter()
    })
    chipEls[g] = { b, num }
    chipBox.append(b)
  }
  const input = h('input', 'lv-filter')
  input.type = 'text'
  input.placeholder = 'Filter lines'
  input.setAttribute('aria-label', 'Filter lines by text')
  input.title = 'Filter lines by text (Ctrl+F)'
  input.spellcheck = false
  let ft = 0
  input.addEventListener('input', () => {
    clearTimeout(ft)
    ft = setTimeout(() => {
      query = input.value.trim().toLowerCase()
      refilter()
    }, 120)
  })
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && input.value) {
      input.value = ''
      query = ''
      refilter()
      e.stopPropagation()
    }
  })
  // The filter is one field: magnifier, text, clear. Ctrl+F in the log view lands here, so find and filter are the same control.
  const field = h('div', 'lv-field')
  const mag = h('span', 'lv-mag')
  mag.setAttribute('aria-hidden', 'true')
  mag.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="m20 20-4.2-4.2"/></svg>'
  const clearBtn = h('button', 'lv-clear')
  clearBtn.type = 'button'
  clearBtn.title = 'Clear filter (Esc)'
  clearBtn.setAttribute('aria-label', 'Clear filter')
  clearBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"/></svg>'
  clearBtn.addEventListener('mousedown', (e) => e.preventDefault())
  clearBtn.addEventListener('click', () => {
    input.value = ''
    query = ''
    refilter()
    input.focus()
  })
  field.append(mag, input, clearBtn)
  input.addEventListener('input', () => field.classList.toggle('has', input.value !== ''))
  const countEl = h('span', 'lv-count')
  countEl.setAttribute('role', 'status')
  const countMain = h('span', 'lv-count-main')
  const countSub = h('span', 'lv-count-sub')
  countEl.append(countMain, countSub)
  const noteEl = h('span', 'lv-note')
  const followBtn = h('button', 'lv-btn', 'Follow')
  followBtn.type = 'button'
  followBtn.addEventListener('click', () => {
    if (!canFollow) return
    followOn = !followOn
    try { localStorage.setItem('plume.logFollow', followOn ? '1' : '0') } catch {}
    d.following = followOn
    syncFollowBtn()
    if (followOn) {
      scrollToEnd()
      startPoll()
    } else stopPoll()
  })
  function syncFollowBtn() {
    followBtn.setAttribute('aria-pressed', String(canFollow && followOn))
    followBtn.classList.toggle('on', canFollow && followOn)
    followBtn.disabled = !canFollow
    followBtn.title = canFollow
      ? followOn ? 'Following the file: new lines appear as it grows. Click to stop.' : 'Click to follow new lines as the file grows'
      : d.path ? 'Follow is off for read-only previews' : 'Follow needs a saved file'
  }
  // One overflow menu holds everything that is not used all the time.
  const moreBtn = h('button', 'lv-more')
  moreBtn.type = 'button'
  moreBtn.title = 'More'
  moreBtn.setAttribute('aria-label', 'More log actions')
  moreBtn.setAttribute('aria-haspopup', 'menu')
  moreBtn.setAttribute('aria-expanded', 'false')
  moreBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><circle cx="5.5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18.5" cy="12" r="1.6"/></svg>'
  const menu = h('div', 'lv-menu')
  menu.setAttribute('role', 'menu')
  menu.hidden = true
  const rawItem = h('button', 'lv-menu-item', 'Edit as text')
  rawItem.type = 'button'
  rawItem.setAttribute('role', 'menuitem')
  rawItem.title = 'Open the plain text editor for this file'
  rawItem.addEventListener('click', () => {
    closeMenu()
    if (ctx.raw) ctx.raw()
  })
  const menuItem = (label, title, fn) => {
    const b = h('button', 'lv-menu-item', label)
    b.type = 'button'
    b.setAttribute('role', 'menuitem')
    b.title = title
    b.addEventListener('click', () => {
      closeMenu()
      fn()
    })
    return b
  }
  menu.append(
    menuItem('Collapse all entries', 'Show only the first line of every entry', () => foldAll(true)),
    menuItem('Expand all entries', 'Show every line of every entry', () => foldAll(false)),
    rawItem,
  )
  function closeMenu() {
    menu.hidden = true
    moreBtn.setAttribute('aria-expanded', 'false')
    document.removeEventListener('mousedown', onDocDown, true)
  }
  function onDocDown(e) {
    if (!menu.contains(e.target) && e.target !== moreBtn && !moreBtn.contains(e.target)) closeMenu()
  }
  moreBtn.addEventListener('click', () => {
    if (!menu.hidden) return closeMenu()
    menu.hidden = false
    moreBtn.setAttribute('aria-expanded', 'true')
    document.addEventListener('mousedown', onDocDown, true)
    menu.querySelector('button').focus()
  })
  menu.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      closeMenu()
      moreBtn.focus()
    }
  })
  const tools = h('div', 'lv-tools')
  tools.append(followBtn, moreBtn)
  bar.append(chipBox, field, noteEl, countEl, tools, menu)

  const scroll = h('div', 'lv-scroll')
  scroll.tabIndex = 0
  scroll.setAttribute('role', 'log')
  scroll.setAttribute('aria-label', 'Log lines')
  const spacer = h('div', 'lv-spacer')
  const layer = h('div', 'lv-layer')
  scroll.append(spacer, layer)
  root.append(bar, scroll)
  host.append(root)

  /* ----- drawing ----- */
  const rows = () => (vis ? vlen : idx.n)
  const lineAt = (k) => (vis ? vis[k] : k)
  let cur = -1 // the selected line
  let lastFirst = -1
  let lastLast = -1
  let lastRows = -1

  function appendHighlighted(parent, s, q) {
    if (!q) return void parent.append(s)
    const low = s.toLowerCase()
    let at = 0
    for (;;) {
      const j = low.indexOf(q, at)
      if (j < 0) break
      if (j > at) parent.append(s.slice(at, j))
      parent.append(h('mark', 'lv-hit', s.slice(j, j + q.length)))
      at = j + q.length
    }
    if (at < s.length) parent.append(s.slice(at))
  }

  function rowEl(i) {
    let t = idx.lineText(i)
    if (t.length > MAX_COLS) t = t.slice(0, MAX_COLS) + ' ...'
    const head = idx.headOf[i] === i
    const end = head ? idx.endOf[i] || idx.n : 0
    const row = h('div', 'lv-row' + (head ? '' : ' lv-cont') + (i === cur ? ' cur' : ''))
    row.dataset.i = String(i)
    row.append(h('span', 'lv-n', String(i + 1)))
    const fold = h('span', 'lv-fold')
    if (head && end - i > 1) {
      const closed = !!idx.fold[i]
      fold.classList.add('can', closed ? 'closed' : 'open')
      fold.title = closed ? `Show ${end - i - 1} more ${end - i - 1 === 1 ? 'line' : 'lines'}` : 'Hide the lines under this entry'
    }
    row.append(fold)
    if (!head) {
      const body = h('span', 'lv-ct')
      appendHighlighted(body, t, query)
      row.append(body)
      return row
    }
    const p = parseLine(t)
    let at = 0
    if (p.tsEnd) {
      row.append(h('span', 'lv-ts', t.slice(0, p.tsEnd)))
      at = p.tsEnd
    }
    if (p.level) {
      if (p.lvStart > at) appendHighlighted(row, t.slice(at, p.lvStart), query)
      row.append(h('span', 'lv-lv lv-' + LEVEL_NAMES[p.level], t.slice(p.lvStart, p.lvEnd)))
      at = p.lvEnd
    }
    appendHighlighted(row, t.slice(at), query)
    if (idx.fold[i] && end - i > 1) row.append(h('span', 'lv-folded', `  +${end - i - 1} ${end - i - 1 === 1 ? 'line' : 'lines'}`))
    return row
  }

  function draw(force) {
    const count = rows()
    const viewH = scroll.clientHeight || 400
    const w = windowFor(scroll.scrollTop, viewH, count, ROW_H)
    spacer.style.height = w.spacerH + 'px'
    if (!force && w.first === lastFirst && w.last === lastLast && count === lastRows) {
      layer.style.top = w.layerTop + 'px'
      return
    }
    lastFirst = w.first
    lastLast = w.last
    lastRows = count
    layer.style.top = w.layerTop + 'px'
    const frag = document.createDocumentFragment()
    for (let k = w.first; k < w.last; k++) frag.append(rowEl(lineAt(k)))
    layer.replaceChildren(frag)
  }

  function sizeCols() {
    const cols = Math.min(idx.maxLen, MAX_COLS) + 6
    const digits = Math.max(5, String(Math.max(idx.n, 1)).length) // at least 5, so the gutter does not jump as lines are added
    root.style.setProperty('--lv-cols', String(cols))
    root.style.setProperty('--lv-digits', String(digits))
  }

  let raf = 0
  scroll.addEventListener('scroll', () => {
    if (raf) return
    raf = requestAnimationFrame(() => {
      raf = 0
      draw(false)
    })
  })
  function setCur(i, reveal) {
    cur = i
    if (reveal && !vis && i >= 0) {
      const top = i * ROW_H
      if (top < scroll.scrollTop) scroll.scrollTop = top
      else if (top + ROW_H > scroll.scrollTop + scroll.clientHeight) scroll.scrollTop = top + ROW_H - scroll.clientHeight
    }
    draw(true)
  }
  scroll.addEventListener('click', (e) => {
    const fold = e.target.closest && e.target.closest('.lv-fold.can')
    if (fold) return void toggleFold(+fold.parentElement.dataset.i)
    const row = e.target.closest && e.target.closest('.lv-row')
    if (!row || String(window.getSelection()).length) return
    setCur(+row.dataset.i, false)
  })
  scroll.addEventListener('keydown', (e) => {
    if ((e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || vis || !idx.n) return
    e.preventDefault()
    const base = cur < 0 ? Math.floor(scroll.scrollTop / ROW_H) : cur
    setCur(Math.max(0, Math.min(idx.n - 1, base + (e.key === 'ArrowDown' ? 1 : -1))), true)
  })
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => draw(true)) : null
  if (ro) ro.observe(scroll)

  const atEnd = () => scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - ROW_H * 2
  function scrollToEnd() {
    scroll.scrollTop = scroll.scrollHeight
    draw(false)
  }

  function updateCounts() {
    for (const [g] of CHIPS) chipEls[g].num.textContent = fmt(idx.counts[g])
    const total = idx.entries
    const shown = vis ? ventries : total
    const busy = !idx.done || (vis && fPos < idx.n)
    let s = shown === total ? `${fmt(total)} ${total === 1 ? 'entry' : 'entries'}` : `${fmt(shown)} of ${fmt(total)} entries`
    if (busy) s += ` · indexing ${Math.min(99, Math.floor((idx.pos / Math.max(1, idx.text.length)) * 100))}%`
    countMain.textContent = s
    countSub.textContent = `${fmt(idx.n)} ${idx.n === 1 ? 'line' : 'lines'}`
    countEl.title = 'Entries are log records; lines that continue a record (stack traces, wrapped text) sit under it.'
    field.classList.toggle('has', input.value !== '')
  }

  /* ----- background work: index lines, then filter them, a few ms at a time ----- */
  function ensureVis() {
    if (!vis) vis = new Int32Array(Math.max(1024, idx.n))
  }
  function push(i) {
    if (vlen >= vis.length) {
      const a = new Int32Array(vis.length * 2)
      a.set(vis)
      vis = a
    }
    vis[vlen++] = i
  }
  // An entry is shown whole: its first line, then its other lines unless it is collapsed.
  function addEntry(hd, end) {
    push(hd)
    ventries++
    if (!idx.fold[hd]) for (let k = hd + 1; k < end; k++) push(k)
  }
  const entryEnd = (hd) => idx.endOf[hd] || (idx.done ? idx.n : 0)
  const levelOk = (mask, hd) => !mask || ((mask >> idx.eff[hd]) & 1) === 1
  // Filter by entry. With a text query the lower-cased copy is searched with indexOf, hit to hit, and each hit pulls in
  // its whole entry. Entries whose end is not known yet (still being indexed) wait for the next slice.
  function filterSlice(budgetMs) {
    const mask = groupMask(groups)
    if (!mask && !query && !anyFold) return
    ensureVis()
    const t0 = Date.now()
    let cnt = 0
    if (query && !idx.lowerOdd && idx.lowerLen === idx.pos) {
      const low = idx.lower
      let from = fPos < idx.n ? idx.starts[fPos] : idx.pos
      while (fPos < idx.n) {
        const j = low.indexOf(query, from)
        if (j < 0 || j >= idx.pos) {
          fPos = idx.done ? idx.n : Math.max(fPos, idx.lastHead)
          break
        }
        const li = idx.lineOf(j, fPos)
        if (j + query.length > idx.ends[li]) {
          from = j + 1
          continue
        }
        const hd = idx.headOf[li]
        const end = entryEnd(hd)
        if (!end) {
          fPos = hd
          break
        }
        if (levelOk(mask, hd)) addEntry(hd, end)
        fPos = end
        from = end < idx.n ? idx.starts[end] : idx.pos
        if ((++cnt & 63) === 0 && Date.now() - t0 > budgetMs) break
      }
      return
    }
    while (fPos < idx.n) {
      const hd = fPos
      const end = entryEnd(hd)
      if (!end) break
      if (levelOk(mask, hd)) {
        let ok = true
        if (query) {
          ok = false
          for (let k = hd; k < end && !ok; k++) ok = idx.lineText(k).toLowerCase().includes(query)
        }
        if (ok) addEntry(hd, end)
      }
      fPos = end
      if ((++cnt & 255) === 0 && Date.now() - t0 > budgetMs) break
    }
  }
  const filterActive = () => groupMask(groups) !== 0 || query !== '' || anyFold

  // Folding one entry edits the row list in place (no rebuild, scroll position kept).
  function visPos(line) {
    let a = 0
    let b = vlen - 1
    while (a <= b) {
      const m = (a + b) >> 1
      if (vis[m] === line) return m
      if (vis[m] < line) a = m + 1
      else b = m - 1
    }
    return -1
  }
  function materialize() {
    // plain line list -> explicit rows, then step back to the start of the last entry (it may still grow)
    vis = new Int32Array(idx.n + 1024)
    const upto = idx.lastHead < 0 ? 0 : idx.lastHead
    for (let i = 0; i < upto; i++) vis[i] = i
    vlen = upto
    fPos = upto
    ventries = Math.max(0, idx.entries - (idx.n ? 1 : 0))
  }
  function toggleFold(hd) {
    const end = idx.endOf[hd] || idx.n
    const cnt = end - hd - 1
    if (cnt <= 0) return
    if (idx.fold[hd]) {
      idx.fold[hd] = 0
      const p = vis ? visPos(hd) : -1
      if (p >= 0) {
        while (vlen + cnt > vis.length) {
          const a = new Int32Array(vis.length * 2)
          a.set(vis)
          vis = a
        }
        vis.copyWithin(p + 1 + cnt, p + 1, vlen)
        for (let k = 0; k < cnt; k++) vis[p + 1 + k] = hd + 1 + k
        vlen += cnt
      }
    } else {
      idx.fold[hd] = 1
      anyFold = true
      if (!vis) materialize()
      const p = visPos(hd)
      if (p >= 0 && vis[p + 1] === hd + 1) {
        vis.copyWithin(p + 1, p + 1 + cnt, vlen)
        vlen -= cnt
      }
    }
    lastFirst = -1
    updateCounts()
    draw(true)
    if (!pumping && vis && fPos < idx.n) pump()
  }
  function foldAll(on) {
    if (on) {
      for (let i = 0; i < idx.n; i++) if (idx.headOf[i] === i && (idx.endOf[i] || idx.n) - i > 1) idx.fold[i] = 1
      anyFold = true
    } else {
      idx.fold.fill(0)
      anyFold = false
    }
    refilter()
  }
  // After follow adds text the last entry may have grown: drop its rows and let the filter read it again.
  function rewindTail() {
    if (!vis) return
    const hd = idx.lastHead < 0 ? 0 : idx.lastHead
    if (fPos > hd) fPos = hd
    while (vlen > 0 && vis[vlen - 1] >= fPos) {
      const l = vis[--vlen]
      if (idx.headOf[l] === l && ventries > 0) ventries--
    }
    if (vlen === 0) ventries = 0
  }

  async function pump() {
    if (pumping) return void (pumpAgain = true)
    pumping = true
    try {
      do {
        pumpAgain = false
        while (!destroyed) {
          const wasEnd = atEnd()
          if (!idx.done) idx.scan(8)
          if (filterActive()) filterSlice(6)
          sizeCols()
          updateCounts()
          draw(true)
          if (wasEnd && followOn && rows() > 0 && !idx.done) scrollToEnd()
          if (idx.done && (!filterActive() || fPos >= idx.n)) break
          await yieldUi()
        }
      } while (pumpAgain && !destroyed)
    } finally {
      pumping = false
    }
    if (!destroyed) updateCounts()
  }

  function refilter() {
    vis = null
    vlen = 0
    ventries = 0
    fPos = 0
    scroll.scrollTop = 0
    lastFirst = -1
    if (!filterActive()) {
      updateCounts()
      draw(true)
      return
    }
    pump()
  }

  /* ----- follow (tail) ----- */
  async function poll() {
    if (polling || destroyed || !followOn || !canFollow || document.hidden) return
    polling = true
    try {
      const st = await api.stat(d.path)
      if (!st || destroyed) return
      if (st.size === d.logSize) return
      if (d.dirty) {
        if (!notedDisk) {
          notedDisk = true
          noteEl.textContent = 'The file changed on disk. Follow is paused because this tab has unsaved edits.'
        }
        return
      }
      if (st.size < d.logSize) {
        // rotated or truncated: start again from the new file
        const f = await api.readFile(d.path)
        if (destroyed || d.dirty || f.binary) return
        d.content = d.saved = f.content
        d.logSize = f.size
        d.mtime = st.mtimeMs
        statsChanged(f.size)
        reset(f.content)
        return
      }
      const r = await api.readTail(d.path, d.logSize, d.encoding)
      if (destroyed || d.dirty || !r) return
      if (r.unsupported) {
        followOn = false
        d.following = false
        syncFollowBtn()
        noteEl.textContent = 'Follow does not support this encoding.'
        stopPoll()
        return
      }
      if (r.reset) return
      if (!r.content) return
      const wasEnd = atEnd()
      d.content += r.content
      d.saved = d.content
      d.logSize = r.consumed
      d.mtime = r.mtimeMs
      statsChanged(r.consumed)
      idx.append(r.content)
      rewindTail()
      await pump()
      if (wasEnd && followOn) scrollToEnd()
    } catch (e) {
      console.error('[logview]', e)
    } finally {
      polling = false
    }
  }
  function startPoll() {
    stopPoll()
    if (canFollow && followOn) pollTimer = setInterval(poll, POLL_MS)
  }
  function stopPoll() {
    clearInterval(pollTimer)
    pollTimer = 0
  }

  function reset(text) {
    idx.reset()
    anyFold = false
    ventries = 0
    idx.append(text)
    vis = null
    vlen = 0
    fPos = 0
    lastFirst = -1
    pump().then(() => followOn && scrollToEnd())
  }

  /* ----- go ----- */
  syncFollowBtn()
  idx.append(d.content || '')
  sizeCols()
  idx.scan(30) // first screen straight away
  updateCounts()
  draw(true)
  scrollToEnd()
  if (!idx.done) pump()
  startPoll()
  if (d.dirty) noteEl.textContent = 'This tab has unsaved edits. Use Edit as text to see and save them.'

  return {
    destroy() {
      destroyed = true
      d.following = false
      stopPoll()
      clearTimeout(ft)
      clearTimeout(statTimer)
      document.removeEventListener('mousedown', onDocDown, true)
      if (raf) cancelAnimationFrame(raf)
      if (ro) ro.disconnect()
      root.remove()
    },
    // test hooks
    _idx: idx,
    _state: () => ({ rows: rows(), n: idx.n, counts: { ...idx.counts }, rendered: layer.children.length }),
  }
}

/* ------------------------------------------------------------------ module init */
export function init(app) {
  appRef = app
  const doc = () => app.state.tabs[app.state.active]
  const back = h('button', 'lv-back', 'Log view')
  back.type = 'button'
  back.title = 'Back to the log view'
  back.hidden = true
  back.addEventListener('click', () => app.actions.toggleSource())
  const docEl = document.getElementById('doc')
  if (docEl) docEl.append(back)
  const sync = () => {
    const d = doc()
    back.hidden = !(d && d.kind === 'text' && d.log && d.view === 'source')
  }
  for (const evt of ['tab:switch', 'tab:list', 'mode:change', 'empty:show']) app.bus.on(evt, sync)
  sync()
  app.commands.register({
    id: 'view.log',
    title: 'Toggle log view',
    category: 'View',
    run: async () => {
      const d = doc()
      if (!d || d.kind !== 'text') return app.toast('Log view is for text files')
      if (d.log) return app.actions.toggleSource()
      d.log = true
      d.view = 'rich'
      d.logSize = undefined
      await app.actions.render()
      sync()
    },
  })
}
