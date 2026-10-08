// Status bar: file path, dirty dot, word/char/line counts, reading time, mode toggle, theme and font pickers.

const THEMES = [
  ['light', 'Light'],
  ['dark', 'Dark'],
  ['sepia', 'Sepia'],
  ['nord', 'Nord'],
  ['dracula', 'Dracula'],
  ['midnight', 'Midnight'],
  ['solarized-dark', 'Solarized dark'],
  ['github', 'GitHub'],
]
const FONTS = [
  ['serif', 'Serif'],
  ['sans', 'Sans'],
  ['mono', 'Mono'],
]

// CJK ideographs, kana and hangul: each character counts as one word.
const CJK = /[ᄀ-ᇿ⺀-⿟぀-ヿ㄀-ㄯ㄰-㆏㐀-䶿一-鿿가-힯豈-﫿ｦ-ﾟ]/g

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
  const source = $('#source')
  if (!bar) return

  /* ---------- build once ---------- */
  bar.textContent = ''
  const left = el('div', 'sb-left')
  const pathEl = el('span', 'sb-path')
  const dirtyEl = el('span', 'sb-dirty')
  dirtyEl.title = 'Unsaved changes'
  dirtyEl.setAttribute('aria-label', 'Unsaved changes')
  left.append(pathEl, dirtyEl)

  const right = el('div', 'sb-right')
  const wordsEl = el('span', 'sb-stat sb-words')
  const charsEl = el('span', 'sb-stat sb-chars')
  const readEl = el('span', 'sb-stat sb-read')
  const linesEl = el('span', 'sb-stat sb-lines')
  const modeBtn = el('button', 'sb-mode')
  modeBtn.type = 'button'
  modeBtn.title = 'Toggle source mode (Ctrl+/)'
  modeBtn.addEventListener('click', () => app.actions.toggleSource())

  const themeSel = select('sb-theme', THEMES, 'Theme', (v) => app.settings.set('theme', v))
  const fontSel = select('sb-font', FONTS, 'Font', (v) => app.settings.set('fontFamily', v))

  right.append(wordsEl, charsEl, readEl, linesEl, modeBtn, themeSel, fontSel)
  bar.append(left, right)

  function el(tag, cls) {
    const n = document.createElement(tag)
    n.className = cls
    return n
  }

  function select(cls, options, label, onPick) {
    const s = el('select', cls)
    s.setAttribute('aria-label', label)
    for (const [value, text] of options) {
      const o = document.createElement('option')
      o.value = value
      o.textContent = text
      s.appendChild(o)
    }
    s.addEventListener('change', () => onPick(s.value))
    return s
  }

  /* ---------- state ---------- */
  let stats = computeStats('')
  let selWords = 0
  let docTimer = null
  let selFrame = 0

  function selectionText() {
    if (app.state.mode === 'source') {
      if (source.selectionStart === source.selectionEnd) return ''
      return source.value.slice(source.selectionStart, source.selectionEnd)
    }
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
    linesEl.hidden = app.state.mode !== 'source'
    linesEl.textContent = `${stats.lines} lines`
  }

  function render() {
    const t = app.state.tabs[app.state.active]
    pathEl.textContent = t ? t.path || t.name : 'No file'
    pathEl.title = t && t.path ? t.path : ''
    dirtyEl.hidden = !(t && t.dirty)
    const wys = app.state.mode !== 'source'
    modeBtn.textContent = wys ? 'WYSIWYG' : 'Source'
    modeBtn.setAttribute('aria-label', 'Editor mode: ' + (wys ? 'WYSIWYG' : 'Source') + '. Click to toggle.')
    themeSel.value = app.settings.get('theme')
    fontSel.value = app.settings.get('fontFamily')
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
  app.bus.on('settings:change', ({ key }) => {
    if (key === 'theme' || key === 'fontFamily') render()
  })

  document.addEventListener('selectionchange', onSelectionMaybeChanged)
  source.addEventListener('select', onSelectionMaybeChanged)

  stats = computeStats(app.state.tabs[app.state.active] ? app.state.tabs[app.state.active].content : '')
  render()
}
