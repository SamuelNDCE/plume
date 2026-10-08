// Status bar: file path, dirty dot, file kind, word/char counts, reading time, cursor line (source),
// and the view-mode toggle. Theme and font now live in the settings panel, not here.

// CJK ideographs, kana and hangul: each character counts as one word.
const CJK = /[ᄀ-ᇿ⺀-⿟぀-ヿ㄀-ㄯ㄰-㆏㐀-䶿一-鿿가-힯豈-﫿ｦ-ﾟ]/g

const KIND_LABEL = { md: 'Markdown', text: 'Plain text', table: 'Table', image: 'Image' }
const MODE_LABEL = { wysiwyg: 'Rich', source: 'Source', table: 'Table', image: 'Image' }

// Plain text of a markdown document: fences, syntax and HTML removed, text kept.
function stripMarkdown(md) {
  return md
    .replace(/^\s*(`{3,}|~{3,})[\s\S]*?^\s*\1[^\n]*$/gm, ' ') // fenced code blocks
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // images keep alt text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links keep label
    .replace(/\[\^[^\]]*\]/g, ' ') // footnote refs
    .replace(/`([^`]*)`/g, '$1') // inline code keeps content
    .replace(/<[^>]+>/g, ' ') // html tags
    .replace(/^\s*\|?[\s|:-]+\|?\s*$/gm, ' ') // table alignment rows
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+|\[[ xX]\]\s+)/gm, '') // block prefixes
    .replace(/^\s*([-*_]\s*){3,}$/gm, ' ') // horizontal rules
    .replace(/\|/g, ' ') // table cell separators
    .replace(/[*_~]+/g, '') // emphasis markers (joins snake_case words)
}

export function countText(text) {
  const cjk = (text.match(CJK) || []).length
  const rest = text.replace(CJK, ' ')
  const latin = rest.split(/\s+/).filter((t) => /[\p{L}\p{N}]/u.test(t)).length
  return { words: cjk + latin, chars: text.replace(/\s/g, '').length }
}

export function computeStats(md) {
  const text = stripMarkdown(md || '')
  const { words, chars } = countText(text)
  return { words, chars, lines: (md || '').split('\n').length }
}

export function init(app) {
  const $ = (s) => document.querySelector(s)
  const bar = $('#statusbar')
  if (!bar) return

  /* ---------- build once ---------- */
  bar.textContent = ''
  const el = (tag, cls, text) => {
    const n = document.createElement(tag)
    if (cls) n.className = cls
    if (text != null) n.textContent = text
    return n
  }

  const left = el('div', 'sb-left')
  left.id = 'status-left'
  const pathEl = el('span', 'sb-path')
  const dirtyEl = el('span', 'sb-dirty')
  dirtyEl.title = 'Unsaved changes'
  dirtyEl.setAttribute('aria-label', 'Unsaved changes')
  const kindEl = el('span', 'sb-kind')
  left.append(pathEl, dirtyEl, kindEl)

  const right = el('div', 'sb-right')
  right.id = 'status-right'
  const wordsEl = el('span', 'sb-stat sb-words')
  const charsEl = el('span', 'sb-stat sb-chars')
  const readEl = el('span', 'sb-stat sb-read')
  const cursorEl = el('span', 'sb-stat sb-lines')
  const modeBtn = el('button', 'sb-mode')
  modeBtn.type = 'button'
  modeBtn.title = 'Toggle source mode (Ctrl+/)'
  modeBtn.addEventListener('click', () => app.actions.toggleSource())

  right.append(wordsEl, charsEl, readEl, cursorEl, modeBtn)
  bar.append(left, right)

  /* ---------- state ---------- */
  let stats = computeStats('')
  let selWords = 0
  let docTimer = null
  let selFrame = 0
  let codeHooked = false

  function selectionText() {
    if (app.state.mode === 'source') return (app.code && app.code.getSelection()) || ''
    const sel = window.getSelection()
    const ed = document.getElementById('editor')
    if (!sel || sel.isCollapsed || !sel.anchorNode || !ed || !ed.contains(sel.anchorNode)) return ''
    return sel.toString()
  }

  function updateSelection() {
    selWords = countText(selectionText()).words
    renderStats()
  }

  function onSelectionMaybeChanged() {
    if (selFrame) return
    selFrame = requestAnimationFrame(() => {
      selFrame = 0
      updateSelection()
    })
  }

  function renderStats() {
    const selecting = selWords > 0
    wordsEl.textContent = selecting ? `${selWords} selected ${selWords === 1 ? 'word' : 'words'}` : `${stats.words} words`
    charsEl.hidden = selecting
    readEl.hidden = selecting
    charsEl.textContent = `${stats.chars} characters`
    readEl.textContent = stats.words ? `${Math.max(1, Math.ceil(stats.words / 200))} min read` : '0 min read'
    const inSource = app.state.mode === 'source' && !!app.code
    cursorEl.hidden = !inSource
    if (inSource) cursorEl.textContent = `Ln ${app.code.cursorLine()} of ${app.code.lineCount()}`
  }

  // Source selection and cursor moves come from the code editor, once it exists.
  function hookCode() {
    if (codeHooked || !app.code) return
    codeHooked = true
    app.code.onSelection(() => onSelectionMaybeChanged())
  }

  function render() {
    hookCode()
    const t = app.state.tabs[app.state.active]
    // Show only folder/name; the full path is in the tooltip.
    let shown = 'No file'
    if (t) {
      const parts = (t.path || '').split(/[\\/]/).filter(Boolean)
      shown = parts.length > 1 ? parts.slice(-2).join('/') : t.name || parts[0] || 'Untitled'
    }
    pathEl.textContent = shown
    pathEl.title = t && t.path ? t.path : t ? t.name : ''
    dirtyEl.hidden = !(t && t.dirty)
    kindEl.textContent = t ? KIND_LABEL[t.kind] || '' : ''
    const mode = app.state.mode
    const label = MODE_LABEL[mode] || ''
    const toggles = mode === 'wysiwyg' || mode === 'source'
    modeBtn.textContent = label
    modeBtn.hidden = !label
    modeBtn.disabled = !toggles
    modeBtn.setAttribute('aria-label', 'View: ' + label + (toggles ? '. Click to toggle.' : ''))
    renderStats()
    updateSelection()
  }

  /* ---------- events ---------- */
  app.bus.on('doc:change', (md) => {
    clearTimeout(docTimer)
    docTimer = setTimeout(() => {
      stats = computeStats(md ?? '')
      render()
    }, 150)
  })
  app.bus.on('tab:switch', (t) => {
    stats = computeStats(t ? t.content : '')
    render()
  })
  app.bus.on('mode:change', () => render())
  app.bus.on('file:saved', () => render())
  app.bus.on('editor:ready', () => render())

  document.addEventListener('selectionchange', onSelectionMaybeChanged)

  const current = app.state.tabs[app.state.active]
  stats = computeStats(current ? current.content : '')
  render()
}
