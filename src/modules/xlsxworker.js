// Runs off the main thread (started by xlsxview.js), in two jobs.
// Parse: in { buf }; out { t: 'meta', sheets: [{ name, total }] }, then { t: 'rows', i, rows } chunks, then { t: 'done' }.
// Save:  in { t: 'save', buf, edits: [{ si, r, c, v }] }; out { t: 'saved', bytes }. Only the edited cells of the sheet XML are
//        rewritten; every other part of the zip is left as it was. On failure: { t: 'error', msg }.
import readXlsxFile from 'read-excel-file/web-worker'

const CHUNK_CELLS = 250000

self.onmessage = async (e) => {
  if (e.data.t === 'save') return save(e.data)
  try {
    const sheets = await readXlsxFile(e.data.buf)
    self.postMessage({ t: 'meta', sheets: sheets.map((s) => ({ name: s.sheet, total: s.data.length })) })
    for (let i = 0; i < sheets.length; i++) {
      const data = sheets[i].data
      let start = 0
      let cells = 0
      for (let r = 0; r < data.length; r++) {
        cells += data[r].length || 1
        if (cells >= CHUNK_CELLS || r === data.length - 1) {
          self.postMessage({ t: 'rows', i, rows: data.slice(start, r + 1) })
          start = r + 1
          cells = 0
        }
      }
      if (!data.length) self.postMessage({ t: 'rows', i, rows: [] })
      sheets[i].data = null
    }
    self.postMessage({ t: 'done' })
  } catch (err) {
    self.postMessage({ t: 'error', msg: String((err && err.message) || err) })
  }
}

/* ---------- save ---------- */
const colNum = (s) => {
  let n = 0
  for (const ch of s) n = n * 26 + ch.charCodeAt(0) - 64
  return n - 1
}
const colName = (c) => {
  let s = ''
  let n = c + 1
  while (n > 0) {
    const m = (n - 1) % 26
    s = String.fromCharCode(65 + m) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const clean = (s) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
const isFormulaText = (v) => typeof v === 'string' && v.length > 1 && v[0] === '='

// New XML for one cell. Keeps the original style (s="..."), drops the old type and value.
function cellXml(ref, oldAttrs, v) {
  const sm = /\ss="([^"]*)"/.exec(oldAttrs || '')
  const s = sm ? ' s="' + sm[1] + '"' : ''
  if (v == null || v === '') return '<c r="' + ref + '"' + s + '/>'
  if (typeof v === 'number' && Number.isFinite(v)) return '<c r="' + ref + '"' + s + '><v>' + v + '</v></c>'
  if (typeof v === 'boolean') return '<c r="' + ref + '"' + s + ' t="b"><v>' + (v ? 1 : 0) + '</v></c>'
  const t = clean(String(v))
  if (isFormulaText(t)) return '<c r="' + ref + '"' + s + '><f>' + esc(t.slice(1)) + '</f></c>'
  return '<c r="' + ref + '"' + s + ' t="inlineStr"><is><t xml:space="preserve">' + esc(t) + '</t></is></c>'
}

// Returns { xml, formula }; formula is true when a formula cell was replaced or added (the calc chain is then stale).
function patchSheet(xml, edits) {
  let formula = false
  const byRow = new Map()
  for (const e of edits) {
    if (!byRow.has(e.r + 1)) byRow.set(e.r + 1, [])
    byRow.get(e.r + 1).push(e)
  }
  const rowRe = /<row\b[^>]*?(\/?)>/g
  const rows = []
  let m
  while ((m = rowRe.exec(xml))) {
    const rn = /\sr="(\d+)"/.exec(m[0])
    let end
    if (m[1] === '/') end = m.index + m[0].length
    else {
      const x = xml.indexOf('</row>', m.index)
      if (x < 0) throw new Error('Unexpected sheet XML')
      end = x + 6
      rowRe.lastIndex = end
    }
    rows.push({ n: rn ? +rn[1] : 0, start: m.index, end, open: m[0], self: m[1] === '/' })
  }
  const selfSd = /<sheetData\s*\/>/.exec(xml)
  if (selfSd) {
    let body = ''
    for (const n of [...byRow.keys()].sort((a, b) => a - b)) {
      const list = byRow.get(n).sort((a, b) => a.c - b.c)
      body += '<row r="' + n + '">' + list.map((e) => cellXml(colName(e.c) + n, '', e.v)).join('') + '</row>'
      if (list.some((e) => isFormulaText(e.v))) formula = true
    }
    return { xml: xml.replace(selfSd[0], '<sheetData>' + body + '</sheetData>'), formula }
  }
  const sdEnd = xml.indexOf('</sheetData>')
  if (sdEnd < 0) throw new Error('Unexpected sheet XML')
  const existing = new Map()
  for (const r of rows) if (byRow.has(r.n)) existing.set(r.n, r)
  const reps = []
  for (const [n, list] of byRow) {
    const ed = new Map()
    for (const e of list) ed.set(e.c, e.v)
    const cells = []
    let open
    const row = existing.get(n)
    if (row) {
      open = row.open.replace(/\sspans="[^"]*"/, '').replace(/\/>$/, '>')
      const inner = row.self ? '' : xml.slice(row.start + row.open.length, row.end - 6)
      const cellRe = /<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g
      let cm
      while ((cm = cellRe.exec(inner))) {
        const ref = /\sr="([A-Z]+)\d+"/.exec(cm[0])
        if (!ref) throw new Error('Unexpected cell XML')
        const col = colNum(ref[1])
        if (ed.has(col)) {
          const attrs = /^<c\b([^>]*?)\/?>/.exec(cm[0])[1]
          if (cm[0].includes('<f')) formula = true
          cells.push({ col, text: cellXml(ref[1] + n, attrs, ed.get(col)) })
          ed.delete(col)
        } else cells.push({ col, text: cm[0] })
      }
    } else open = '<row r="' + n + '">'
    for (const [col, v] of ed) cells.push({ col, text: cellXml(colName(col) + n, '', v) })
    for (const e of list) if (isFormulaText(e.v)) formula = true
    cells.sort((a, b) => a.col - b.col)
    const text = open + cells.map((x) => x.text).join('') + '</row>'
    if (row) reps.push({ start: row.start, end: row.end, text, n })
    else {
      const next = rows.find((x) => x.n > n)
      const pos = next ? next.start : sdEnd
      reps.push({ start: pos, end: pos, text, n })
    }
  }
  reps.sort((a, b) => a.start - b.start || a.n - b.n)
  let out = ''
  let at = 0
  for (const r of reps) {
    out += xml.slice(at, r.start) + r.text
    at = r.end
  }
  out += xml.slice(at)
  // keep <dimension> covering the edited cells
  const maxR = Math.max(...edits.map((e) => e.r + 1))
  const maxC = Math.max(...edits.map((e) => e.c))
  const dm = /<dimension\s+ref="([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?"\s*\/>/.exec(out)
  if (dm) {
    const eC = colNum(dm[3] || dm[1])
    const eR = +(dm[4] || dm[2])
    if (maxR > eR || maxC > eC) out = out.replace(dm[0], '<dimension ref="' + dm[1] + dm[2] + ':' + colName(Math.max(maxC, eC)) + Math.max(maxR, eR) + '"/>')
  }
  return { xml: out, formula }
}

async function save({ buf, edits }) {
  try {
    const { default: JSZip } = await import('jszip')
    const zip = await JSZip.loadAsync(buf)
    const read = async (p) => {
      const f = zip.file(p)
      if (!f) throw new Error('Missing ' + p)
      return f.async('string')
    }
    const wb = await read('xl/workbook.xml')
    const rels = await read('xl/_rels/workbook.xml.rels')
    const relTarget = {}
    for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
      const id = /\sId="([^"]*)"/.exec(m[0])
      const tg = /\sTarget="([^"]*)"/.exec(m[0])
      if (id && tg) relTarget[id[1]] = tg[1].startsWith('/') ? tg[1].slice(1) : 'xl/' + tg[1]
    }
    const sheetPaths = [...wb.matchAll(/<sheet\b[^>]*>/g)].map((m) => {
      const id = /\sr:id="([^"]*)"/.exec(m[0]) || /\s\w+:id="([^"]*)"/.exec(m[0])
      return id && relTarget[id[1]]
    })
    const bySheet = new Map()
    for (const e of edits) {
      if (!bySheet.has(e.si)) bySheet.set(e.si, [])
      bySheet.get(e.si).push(e)
    }
    let formula = false
    for (const [si, list] of bySheet) {
      const p = sheetPaths[si]
      if (!p) throw new Error('Sheet not found in workbook')
      const res = patchSheet(await read(p), list)
      if (res.formula) formula = true
      zip.file(p, res.xml)
    }
    // Excel recalculates on open, so formulas that depend on an edited cell are refreshed.
    let wb2 = wb
    if (/<calcPr\b/.test(wb2)) {
      wb2 = wb2.replace(/<calcPr\b([^>]*?)(\/?)>/, (m0, a, sl) => (/fullCalcOnLoad=/.test(a) ? m0 : '<calcPr' + a + ' fullCalcOnLoad="1"' + sl + '>'))
    } else {
      const anchor = ['</definedNames>', '</externalReferences>', '</sheets>'].find((a) => wb2.includes(a))
      if (anchor) wb2 = wb2.replace(anchor, anchor + '<calcPr fullCalcOnLoad="1"/>')
    }
    if (wb2 !== wb) zip.file('xl/workbook.xml', wb2)
    if (formula && zip.file('xl/calcChain.xml')) {
      zip.remove('xl/calcChain.xml')
      const ct = await read('[Content_Types].xml')
      zip.file('[Content_Types].xml', ct.replace(/<Override\b[^>]*calcChain[^>]*\/>/, ''))
      zip.file('xl/_rels/workbook.xml.rels', rels.replace(/<Relationship\b[^>]*calcChain[^>]*\/>/, ''))
    }
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } })
    self.postMessage({ t: 'saved', bytes }, [bytes.buffer])
  } catch (err) {
    self.postMessage({ t: 'error', msg: String((err && err.message) || err) })
  }
}
