// Fixture files for the UI suites (tests/ui-regression.cjs, tests/a11y-check.cjs). make(dir) writes them and returns their paths.
// Only the repo's own dependency jszip is used, so nothing has to be installed. The PDF is written by hand.
const fs = require('node:fs')
const path = require('node:path')
const JSZip = require('jszip')

function makePdf(text) {
  const stream = `BT /F1 24 Tf 72 700 Td (${text}) Tj ET`
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let out = '%PDF-1.4\n'
  const offs = []
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n` })
  const xref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
  offs.forEach((o) => { out += String(o).padStart(10, '0') + ' 00000 n \n' })
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

async function makeXlsx(cells) {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>')
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
  zip.file('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>')
  zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>')
  const strings = []
  let rows = ''
  cells.forEach((row, r) => {
    rows += `<row r="${r + 1}">`
    row.forEach((v, c) => {
      const ref = String.fromCharCode(65 + c) + (r + 1)
      if (typeof v === 'number') rows += `<c r="${ref}"><v>${v}</v></c>`
      else { strings.push(v); rows += `<c r="${ref}" t="s"><v>${strings.length - 1}</v></c>` }
    })
    rows += '</row>'
  })
  zip.file('xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`)
  zip.file('xl/sharedStrings.xml', `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${strings.map((s) => `<si><t>${s}</t></si>`).join('')}</sst>`)
  return zip.generateAsync({ type: 'nodebuffer' })
}

async function makeDocx(paragraphs) {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
  const body = paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join('')
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`)
  return zip.generateAsync({ type: 'nodebuffer' })
}

async function make(dir) {
  fs.mkdirSync(dir, { recursive: true })
  const f = (n) => path.join(dir, n)
  fs.writeFileSync(f('note.md'), '# Plume regression\n\nThe quick brown fox jumps over the lazy dog. The fox is quick.\n')
  let log = ''
  for (let i = 0; i < 12; i++) log += `2026-10-29 10:00:${String(i).padStart(2, '0')} INFO request ${i} handled\n`
  for (let i = 0; i < 3; i++) log += `2026-10-29 10:01:${String(i).padStart(2, '0')} WARN slow response ${i}\n`
  for (let i = 0; i < 2; i++) log += `2026-10-29 10:02:${String(i).padStart(2, '0')} ERROR failed job ${i}\n`
  fs.writeFileSync(f('app.log'), log)
  fs.writeFileSync(f('data.csv'), 'name,qty\nAlpha,3\nBeta,5\nGamma,8\n')
  fs.writeFileSync(f('doc.pdf'), makePdf('Plume PDF fixture'))
  fs.writeFileSync(f('sheet.xlsx'), await makeXlsx([['Item', 'Count'], ['Apples', 4], ['Pears', 7]]))
  fs.writeFileSync(f('word.docx'), await makeDocx(['Plume Word fixture', 'Second paragraph of the sample.']))
  return { dir, md: f('note.md'), log: f('app.log'), csv: f('data.csv'), pdf: f('doc.pdf'), xlsx: f('sheet.xlsx'), docx: f('word.docx') }
}

module.exports = { make }
