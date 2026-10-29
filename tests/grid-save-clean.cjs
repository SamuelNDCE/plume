// Regression: rows and columns the grid draws past the data (margin and window fill) exist only in the view.
// Open a CSV and an .xlsx, scroll to the end of the grid, save with Ctrl+S, and check the file on disk is unchanged:
// CSV bytes identical, .xlsx has the same used range (rows, columns, cell refs) as before.
// Run: node tests/grid-save-clean.cjs   (PLUME_UI_LOCK = machine-wide window lock script on a shared machine)
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const JSZip = require('jszip')
const { runApp } = require('./ui-runner.cjs')

async function makeXlsx() {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>')
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
  zip.file('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>')
  zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>')
  const rows = [['Item', 'Count'], ['Apples', 4], ['Pears', 7]]
  let x = ''
  rows.forEach((row, r) => { x += '<row r="' + (r + 1) + '">'; row.forEach((v, c) => { const ref = String.fromCharCode(65 + c) + (r + 1); x += typeof v === 'number' ? '<c r="' + ref + '"><v>' + v + '</v></c>' : '<c r="' + ref + '" t="inlineStr"><is><t>' + v + '</t></is></c>' }); x += '</row>' })
  zip.file('xl/worksheets/sheet1.xml', '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:B3"/><sheetData>' + x + '</sheetData></worksheet>')
  return zip.generateAsync({ type: 'nodebuffer' })
}
async function usedRange(file) {
  const z = await JSZip.loadAsync(fs.readFileSync(file))
  const xml = await z.file('xl/worksheets/sheet1.xml').async('string')
  const rows = [...xml.matchAll(/<row\b[^>]*\sr="(\d+)"/g)].map((m) => m[1])
  const refs = [...xml.matchAll(/<c\b[^>]*\sr="([A-Z]+\d+)"/g)].map((m) => m[1])
  const dim = (/<dimension\s+ref="([^"]+)"/.exec(xml) || [])[1] || ''
  return JSON.stringify({ rows, refs, dim })
}

;(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plume-gridsave-'))
  const csv = path.join(dir, 'three.csv')
  const xlsx = path.join(dir, 'three.xlsx')
  fs.writeFileSync(csv, 'name,qty\nAlpha,3\nBeta,5\n')
  fs.writeFileSync(xlsx, await makeXlsx())
  const csvBefore = fs.readFileSync(csv)
  const xlsxRangeBefore = await usedRange(xlsx)
  const J = (f) => JSON.stringify(f.split(path.sep).join('/'))
  const size = (sel) => ({ js: `(()=>{const g=document.querySelector('${sel}');return JSON.stringify({h:g.scrollHeight,w:g.scrollWidth})})()`, wait: 200 })
  // scroll to the end three times: each time near the end the grid adds 20 rows / 5 columns, so the scroll range keeps growing
  const scrollEnd = (sel) => [1, 2, 3].map(() => ({ js: `(()=>{const g=document.querySelector('${sel}');g.scrollTop=1e9;g.scrollLeft=1e9;g.focus();return 1})()`, wait: 700 }))
  const steps = [
    { js: `window.__plume.actions.openPath(${J(csv)});1`, wait: 2500 },
    size('.sh-grid'),
    ...scrollEnd('.sh-grid'),
    size('.sh-grid'),
    { key: 's', mods: ['control'], wait: 1500 },
    { js: `window.__plume.actions.openPath(${J(xlsx)});1`, wait: 4000 },
    size('.xv-scroll'),
    ...scrollEnd('.xv-scroll'),
    size('.xv-scroll'),
    { key: 's', mods: ['control'], wait: 2500 },
  ]
  let r
  try { r = await runApp(steps, { grantDir: dir, label: 'gridsave', timeoutMs: 90000 }) } catch (e) { fs.rmSync(dir, { recursive: true, force: true }); throw e }
  const sz = r.results.filter((x) => typeof x === 'string' && x.startsWith('{')).map((x) => JSON.parse(x))
  const grewOk = sz.length === 4 && sz[1].h > sz[0].h && sz[1].w > sz[0].w && sz[3].h > sz[2].h && sz[3].w > sz[2].w
  console.log((grewOk ? 'PASS' : 'FAIL') + '  scrolling to the end grew the scroll range: ' + JSON.stringify(sz))
  const csvAfter = fs.readFileSync(csv)
  const xlsxRangeAfter = await usedRange(xlsx)
  fs.rmSync(dir, { recursive: true, force: true })
  const csvOk = Buffer.compare(csvBefore, csvAfter) === 0
  const xlsxOk = xlsxRangeBefore === xlsxRangeAfter
  console.log((csvOk ? 'PASS' : 'FAIL') + '  CSV bytes identical after scroll to end + Ctrl+S (' + csvBefore.length + ' -> ' + csvAfter.length + ' bytes)')
  console.log((xlsxOk ? 'PASS' : 'FAIL') + '  xlsx used range unchanged: before ' + xlsxRangeBefore + ' after ' + xlsxRangeAfter)
  process.exit(csvOk && xlsxOk && grewOk ? 0 : 1)
})().catch((e) => { console.error('FAIL', e.message); process.exit(1) })
