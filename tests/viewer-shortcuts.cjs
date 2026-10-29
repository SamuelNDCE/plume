// Keyboard shortcut suite for the PDF and Excel viewers. Real key events (webContents.sendInputEvent) in the real,
// unpackaged app, fresh profile. Same runner and fixtures as tests/ui-regression.cjs.
//   node tests/viewer-shortcuts.cjs
// Prints PASS or FAIL per check, exits 1 on any failure or crash. KB_SHOT_DIR=<dir> keeps the screenshots of the panel.
// Optional: PLUME_UI_LOCK=<path to electron-lock.sh> wraps the Electron run in a machine-wide window lock.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const JSZip = require('jszip')
const { runApp } = require('./ui-runner.cjs')
const fixtures = require('./ui-fixtures.cjs')

// five pages, each with the word "fox" once
function makePdf5() {
  const kids = [3, 4, 5, 6, 7].map((n) => n * 2 - 3 + ' 0 R') // page objects 3,5,7,9,11
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${kids.join(' ')}] /Count 5 >>`]
  for (let i = 0; i < 5; i++) {
    const pageObj = 3 + i * 2
    const stream = `BT /F1 24 Tf 72 700 Td (Plume page ${i + 1} fox) Tj ET`
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${pageObj + 1} 0 R /Resources << /Font << /F1 13 0 R >> >> >>`)
    objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
  }
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  let out = '%PDF-1.4\n'
  const offs = []
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n` })
  const xref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
  offs.forEach((o) => { out += String(o).padStart(10, '0') + ' 00000 n \n' })
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

// the fixture workbook has one sheet; add a second one called "Sheet2"
async function addSheet2(buf, cells) {
  const zip = await JSZip.loadAsync(buf)
  let rows = ''
  cells.forEach((row, r) => {
    rows += `<row r="${r + 1}">`
    row.forEach((v, c) => {
      const ref = String.fromCharCode(65 + c) + (r + 1)
      rows += typeof v === 'number' ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t>${v}</t></is></c>`
    })
    rows += '</row>'
  })
  zip.file('xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`)
  let wb = await zip.file('xl/workbook.xml').async('string')
  wb = wb.replace('</sheets>', '<sheet name="Sheet2" sheetId="2" r:id="rId9"/></sheets>')
  zip.file('xl/workbook.xml', wb)
  let rels = await zip.file('xl/_rels/workbook.xml.rels').async('string')
  rels = rels.replace('</Relationships>', '<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>')
  zip.file('xl/_rels/workbook.xml.rels', rels)
  let ct = await zip.file('[Content_Types].xml').async('string')
  ct = ct.replace('</Types>', '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>')
  zip.file('[Content_Types].xml', ct)
  zip.file('xl/worksheets/sheet2.xml', '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1"><v>11</v></c><c r="B1"><v>22</v></c></row></sheetData></worksheet>')
  return zip.generateAsync({ type: 'nodebuffer' })
}

function suite() {
  const steps = []
  const checks = []
  const js = (code, wait = 300) => { steps.push({ js: code, wait }); checks.push(null) }
  const check = (name, code, test, wait = 300) => { steps.push({ js: code, wait }); checks.push({ name, test }) }
  const key = (k, mods = [], wait = 450) => steps.push({ key: k, mods, wait })
  const type = (text, wait = 400) => steps.push({ text, wait })
  const shot = (name) => steps.push({ wait: 1500, shot: name })
  return { steps, checks, js, check, key, type, shot }
}
const eq = (want) => (v) => (v === want ? true : `expected ${JSON.stringify(want)}, got ${JSON.stringify(v)}`)
const match = (re) => (v) => (re.test(String(v)) ? true : `expected ${re}, got ${JSON.stringify(v)}`)
const sel = (s) => `document.querySelector(${JSON.stringify(s)})`
const txt = (s) => `(()=>{const e=${sel(s)};return e?e.innerText.trim():null})()`
const bool = (code) => `!!(${code})`

async function main() {
  const F = await fixtures.make(fs.mkdtempSync(path.join(os.tmpdir(), 'plume-kb-fx-')))
  const pdf5 = path.join(F.dir, 'five.pdf')
  fs.writeFileSync(pdf5, makePdf5())
  const xl = path.join(F.dir, 'book.xlsx')
  fs.writeFileSync(xl, await addSheet2(fs.readFileSync(F.xlsx), [['Item', 'Count'], ['Apples', 4], ['Pears', 7], ['', ''], ['Plums', 9]]))
  const shotDir = process.env.KB_SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'plume-kb-shots-'))
  fs.mkdirSync(shotDir, { recursive: true })
  const open = (S, p, wait) => S.js(`window.__plume.actions.openPath(${JSON.stringify(p)})`, wait)

  /* ---------------- PDF ---------------- */
  const P = suite()
  open(P, pdf5, 4500)
  const pv = `document.getElementById('viewer-host').__pdfv`
  const pct = `Math.round(${pv}.scale*72/96*100)`
  const pageNo = `(()=>{const e=${sel('.pdfv-page')};return e?e.value:null})()`
  P.js(`window.__kl=[];window.addEventListener('keydown',e=>window.__kl.push(e.key+(e.shiftKey?'+S':'')+(e.ctrlKey?'+C':'')+'@'+(e.target.className||e.target.tagName)+(e.defaultPrevented?'!':'')),true);0`, 50)
  P.check('PDF opens with 5 pages', `${pv}.n`, eq(5))
  P.key('F', ['control'], 600)
  P.check('PDF Ctrl+F opens find with the box focused', `JSON.stringify({open:!${sel('.pdfv-find')}.hidden,focus:document.activeElement===${sel('.pdfv-find .find-input')}})`, (v) => (JSON.parse(v).open && JSON.parse(v).focus ? true : v))
  P.type('fox', 900)
  P.check('PDF find: "fox" gives 5 matches, first current', txt('.pdfv-find .find-count'), match(/^1 of 5$/))
  P.key('Enter', [], 500)
  P.check('PDF Enter: next match (2 of 5)', txt('.pdfv-find .find-count'), match(/^2 of 5$/))
  P.key('Enter', ['shift'], 500)
  P.check('PDF Shift+Enter: previous match (1 of 5)', txt('.pdfv-find .find-count'), match(/^1 of 5$/))
  P.key('F3', [], 500)
  P.check('PDF F3: next match (2 of 5)', txt('.pdfv-find .find-count'), match(/^2 of 5$/))
  P.key('F3', ['shift'], 500)
  P.check('PDF Shift+F3: previous match (1 of 5)', txt('.pdfv-find .find-count'), match(/^1 of 5$/))
  P.js(`window.__pg=${pageNo};0`, 50)
  P.key('End', [], 400)
  P.check('PDF keys do nothing while typing in the find box (End leaves the page alone)', `${pageNo}===window.__pg&&${pageNo}!=='5'`, eq(true))
  P.key('Escape', [], 500)
  P.check('PDF Escape closes find', `${sel('.pdfv-find')}.hidden`, eq(true))
  P.key('G', ['control'], 500)
  P.check('PDF Ctrl+G focuses the page box', `document.activeElement===${sel('.pdfv-page')}`, eq(true))
  P.type('3', 300)
  P.key('Enter', [], 900)
  P.check('PDF Ctrl+G 3 Enter: page 3', pageNo, eq('3'))
  P.js(`${pv}.setZoom('custom',100)`, 500)
  P.key('=', ['control'], 600)
  P.check('PDF Ctrl+= zooms in (100 to 125 percent)', pct, eq(125))
  P.key('+', ['control', 'shift'], 600)
  P.check('PDF Ctrl++ zooms in (125 to 150 percent)', pct, eq(150))
  P.key('-', ['control'], 600)
  P.check('PDF Ctrl+- zooms out (150 to 125 percent)', pct, eq(125))
  P.key('1', ['control'], 600)
  P.check('PDF Ctrl+1 actual size (100 percent)', pct, eq(100))
  P.key('0', ['control'], 600)
  P.check('PDF Ctrl+0 fit width (mode width)', `${pv}.mode`, eq('width'))
  P.js(`${sel('.pdfv-scroll')}.dispatchEvent(new WheelEvent('wheel',{ctrlKey:true,deltaY:-100,bubbles:true,cancelable:true}))`, 600)
  P.check('PDF Ctrl+Wheel zooms (synthetic wheel event, not a hardware key)', `${pv}.mode`, eq('custom'))
  P.key('Home', [], 700)
  P.check('PDF Home: page 1, scrolled to the top', `JSON.stringify({p:${pageNo},top:${sel('.pdfv-scroll')}.scrollTop})`, (v) => (JSON.parse(v).p === '1' && JSON.parse(v).top <= 8 ? true : v))
  P.key('End', [], 800)
  P.check('PDF End: last page (5)', pageNo, eq('5'))
  P.key('Home', [], 600)
  P.key('PageDown', [], 500)
  P.check('PDF Page Down moves a screen', `(()=>{const s=${sel('.pdfv-scroll')};return Math.round(s.scrollTop/(s.clientHeight-40))})()`, eq(1))
  P.key('PageUp', [], 500)
  P.check('PDF Page Up moves back a screen', `${sel('.pdfv-scroll')}.scrollTop`, (v) => (v <= 8 ? true : 'scrollTop ' + v))
  P.key('Space', [], 500)
  P.check('PDF Space moves down a screen', `${sel('.pdfv-scroll')}.scrollTop>100`, eq(true))
  P.key('Space', ['shift'], 500)
  P.check('PDF Shift+Space moves up a screen', `${sel('.pdfv-scroll')}.scrollTop`, (v) => (v <= 8 ? true : 'scrollTop ' + v))
  P.key('Down', [], 400)
  P.check('PDF Down arrow scrolls', `${sel('.pdfv-scroll')}.scrollTop`, (v) => (v > 20 && v < 100 ? true : 'scrollTop ' + v))
  P.key('Up', [], 400)
  P.js(`${pv}.goTo(1)`, 500)
  P.js('0', 900)
  P.js(`window.__cp=[];const o=navigator.clipboard.writeText.bind(navigator.clipboard);navigator.clipboard.writeText=(t)=>{window.__cp.push(String(t));return o(t).catch(()=>{})};0`, 100)
  P.key('A', ['control'], 500)
  P.check('PDF Ctrl+A selects the page text', `getSelection().toString()`, match(/Plume page 1 fox/))
  P.key('C', ['control'], 700)
  P.check('PDF Ctrl+C sends the selected text to the clipboard (value passed to clipboard.writeText)', `JSON.stringify(window.__cp)`, (v) => (/Plume page 1 fox/.test(v) ? true : v))
  P.key('F1', [], 500)
  P.check('PDF F1 opens the shortcut panel', bool(`${sel('.pdfv .kb-panel')}&&!${sel('.pdfv .kb-panel')}.hidden`), eq(true))
  P.shot('pdf-panel-light.png')
  P.key('Escape', [], 400)
  P.check('PDF Escape closes the shortcut panel', `${sel('.pdfv .kb-panel')}.hidden`, eq(true))
  P.key('/', ['control'], 500)
  P.check('PDF Ctrl+/ opens the shortcut panel', bool(`!${sel('.pdfv .kb-panel')}.hidden`), eq(true))
  P.js(`window.__plume.settings.set('theme','dark')`, 600)
  P.shot('pdf-panel-dark.png')
  P.key('/', ['control'], 400)
  P.check('PDF Ctrl+/ again closes it', `${sel('.pdfv .kb-panel')}.hidden`, eq(true))
  P.js(`window.__plume.settings.set('theme','light')`, 400)
  P.check('panel text has at least 4.5:1 contrast in all 8 themes', `(async()=>{
    const ids=['light','github','newsprint','sepia','dark','nord','dracula','midnight'];const out=[];
    const cv=document.createElement('canvas');cv.width=cv.height=1;const cx=cv.getContext('2d',{willReadFrequently:true});
    const px=(layers)=>{cx.clearRect(0,0,1,1);for(const c of layers){cx.fillStyle=c;cx.fillRect(0,0,1,1)}const d=cx.getImageData(0,0,1,1).data;return [d[0],d[1],d[2]]};
    const lum=(c)=>{const f=(v)=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)};return 0.2126*f(c[0])+0.7152*f(c[1])+0.0722*f(c[2])};
    const ratio=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05)};
    for(const id of ids){window.__plume.settings.set('theme',id);await new Promise(r=>setTimeout(r,250));
      const p=document.querySelector('.pdfv .kb-panel');const cs=(e)=>getComputedStyle(e);
      const pb=cs(p).backgroundColor;const base=px(['#000',pb]);
      const pairs={title:p.querySelector('.kb-head span'),head:p.querySelector('.kb-grp h3'),desc:p.querySelector('.kb-row span')};
      for(const k in pairs){out.push([id,k,ratio(px(['#000',pb,cs(pairs[k]).color]),base)])}
      const kb=p.querySelector('.kb-row kbd');out.push([id,'kbd',ratio(px(['#000',pb,cs(kb).color]),px(['#000',pb,cs(kb).backgroundColor]))]);
    }
    return JSON.stringify(out)})()`, (v) => { const bad = JSON.parse(v).filter((r) => r[2] < 4.5); return bad.length ? 'low contrast: ' + JSON.stringify(bad) : JSON.parse(v).length === 32 ? true : 'unexpected rows ' + v }, 500)

  /* ---------------- Excel ---------------- */
  const X = suite()
  open(X, xl, 3500)
  const ref = txt('.xv-ref')
  const fx = txt('.xv-fx')
  X.js(`window.__kl=[];window.addEventListener('keydown',e=>window.__kl.push(e.key+(e.shiftKey?'+S':'')+(e.ctrlKey?'+C':'')+'@'+(e.target.className||e.target.tagName)+(e.defaultPrevented?'!':'')),true);0`, 50)
  X.check('XLSX opens with the grid focused and A1 selected', `JSON.stringify({f:document.activeElement===${sel('.xv-scroll')},ref:${txt('.xv-ref')}})`, (v) => (JSON.parse(v).f && JSON.parse(v).ref === 'A1' ? true : v))
  X.key('Down', ['control'], 500)
  X.check('XLSX Ctrl+Down jumps to the data edge (A3)', ref, eq('A3'))
  X.key('Down', ['control'], 500)
  X.check('XLSX Ctrl+Down again jumps across the gap (A5)', ref, eq('A5'))
  X.key('Home', ['control'], 500)
  X.check('XLSX Ctrl+Home goes to A1', ref, eq('A1'))
  X.key('Down', ['shift'], 500)
  X.check('XLSX Shift+Down extends the selection (A1:A2)', ref, eq('A1:A2'))
  X.key('Down', ['control', 'shift'], 500)
  X.check('XLSX Ctrl+Shift+Down extends to the data edge (A1:A3)', ref, eq('A1:A3'))
  X.key('Right', [], 400)
  X.check('XLSX Right arrow collapses to one cell (B3)', ref, eq('B3'))
  X.key('Tab', [], 400)
  X.key('Tab', ['shift'], 400)
  X.check('XLSX Tab then Shift+Tab returns to B3', ref, eq('B3'))
  X.key('Enter', [], 400)
  X.check('XLSX Enter moves down (B4)', ref, eq('B4'))
  X.key('Enter', ['shift'], 400)
  X.check('XLSX Shift+Enter moves up (B3)', ref, eq('B3'))
  X.key('Home', [], 400)
  X.check('XLSX Home goes to the row start (A3)', ref, eq('A3'))
  X.key('End', ['control'], 400)
  X.check('XLSX Ctrl+End goes to the last used cell (B5)', ref, eq('B5'))
  X.key('PageUp', [], 400)
  X.check('XLSX Page Up moves up (row 1)', ref, eq('B1'))
  X.key('PageDown', [], 400)
  X.check('XLSX Page Down moves down a screen', ref, (v) => (/^B([2-9]|\d\d+)$/.test(v) && v !== 'B1' ? true : v))
  X.key('Home', ['control'], 400)
  X.key('PageDown', ['alt'], 500)
  X.check('XLSX Alt+Page Down moves right (column after A, row 1)', ref, (v) => (/^[B-Z]1$/.test(v) ? true : v))
  X.key('PageUp', ['alt'], 500)
  X.check('XLSX Alt+Page Up moves a screen to the left (A1)', ref, eq('A1'))
  X.key('Space', ['control'], 400)
  X.check('XLSX Ctrl+Space selects the column (A1:A5)', ref, eq('A1:A5'))
  X.key('Home', ['control'], 400)
  X.key('Space', ['shift'], 400)
  X.check('XLSX Shift+Space selects the row (A1 to the last column)', ref, (v) => (/^A1:[B-Z]1$/.test(v) ? true : v))
  X.key('A', ['control'], 400)
  X.check('XLSX Ctrl+A selects all (A1:B5)', ref, eq('A1:B5'))
  X.js(`window.__cp=[];const o=navigator.clipboard.writeText.bind(navigator.clipboard);navigator.clipboard.writeText=(t)=>{window.__cp.push(String(t));return o(t).catch(()=>{})};0`, 100)
  X.key('C', ['control'], 600)
  X.check('XLSX Ctrl+C copies tab-separated text (value passed to clipboard.writeText)', `window.__cp[0]||''`, (v) => (v.startsWith('Item	Count') && v.includes('Apples	4') ? true : JSON.stringify(v)))
  // go to a cell
  X.key('G', ['control'], 500)
  X.check('XLSX Ctrl+G opens the go-to box', bool(`${sel('.xv-goto')}&&!${sel('.xv-goto')}.hidden&&document.activeElement===${sel('.xv-goto input')}`), eq(true))
  X.type('B2', 300)
  X.key('Enter', [], 500)
  X.check('XLSX Ctrl+G B2 Enter selects B2', ref, eq('B2'))
  // fill down from B2 over B2:B4
  X.key('Down', ['shift'], 300)
  X.key('Down', ['shift'], 300)
  X.key('D', ['control'], 600)
  X.check('XLSX Ctrl+D fills down (B3 and B4 now 4)', `(()=>{const c=[...document.querySelectorAll('.xv-cells [role=gridcell]')].filter(e=>e.innerText.trim()==='4');return c.length})()`, eq(3))
  X.key('Z', ['control'], 600)
  X.check('XLSX Ctrl+Z undoes the fill (only B2 has 4)', `[...document.querySelectorAll('.xv-cells [role=gridcell]')].filter(e=>e.innerText.trim()==='4').length`, eq(1))
  X.key('Y', ['control'], 600)
  X.check('XLSX Ctrl+Y redoes it (three cells with 4)', `[...document.querySelectorAll('.xv-cells [role=gridcell]')].filter(e=>e.innerText.trim()==='4').length`, eq(3))
  // Ctrl+Enter: type an entry, fill the selection
  X.key('G', ['control'], 400)
  X.type('A2', 200)
  X.key('Enter', [], 400)
  X.key('Down', ['shift'], 300)
  X.key('F2', [], 400)
  X.type('Zed', 300)
  X.key('Enter', ['control'], 600)
  X.check('XLSX F2, typing, Ctrl+Enter fills A2:A3 with the entry', `[...document.querySelectorAll('.xv-cells [role=gridcell]')].filter(e=>e.innerText.trim()==='Zed').length`, eq(2))
  // Ctrl+Enter without editing: fill the selection from the active cell
  X.key('G', ['control'], 400)
  X.type('B2:B3', 200)
  X.key('Enter', [], 400)
  X.key('Enter', ['control'], 600)
  X.check('XLSX Ctrl+Enter (not editing) fills the selection with the active cell (B2:B3 equal)', `[...document.querySelectorAll('.xv-cells [role=gridcell]')].filter(e=>e.innerText.trim()==='4').length`, (v) => (v >= 3 ? true : 'cells with 4: ' + v))
  // fill right
  X.key('G', ['control'], 400)
  X.type('A5:B5', 200)
  X.key('Enter', [], 400)
  X.key('R', ['control'], 600)
  X.check('XLSX Ctrl+R fills right (A5:B5 both Plums)', `[...document.querySelectorAll('.xv-cells [role=gridcell]')].filter(e=>e.innerText.trim()==='Plums').length`, eq(2))
  // date and time
  X.key('G', ['control'], 400)
  X.type('A4', 200)
  X.key('Enter', [], 400)
  X.key(';', ['control'], 600)
  X.check('XLSX Ctrl+; enters today as date text', fx, match(/^\d{4}-\d{2}-\d{2}$/))
  X.key(';', ['control', 'shift'], 600)
  X.check('XLSX Ctrl+Shift+; enters the time', fx, match(/^\d{2}:\d{2}$/))
  X.key('Z', ['control'], 600)
  X.check('XLSX Ctrl+Z after an edit restores the date', fx, match(/^\d{4}-\d{2}-\d{2}$/))
  X.key('Delete', [], 500)
  X.check('XLSX Delete clears the cell', fx, eq(''))
  X.key('Backspace', [], 500)
  // edit and cancel
  X.key('F2', [], 400)
  X.type('nope', 300)
  X.key('Escape', [], 500)
  X.check('XLSX F2 then Escape cancels the edit', `JSON.stringify({ed:!!${sel('.xv-edit')},fx:${txt('.xv-fx')}})`, (v) => (JSON.parse(v).ed === false && JSON.parse(v).fx === '' ? true : v))
  // replace
  X.key('H', ['control'], 600)
  X.check('XLSX Ctrl+H opens find with the replace row', bool(`!${sel('.xv-find:not(.xv-goto)')}.hidden&&!${sel('.xv-find:not(.xv-goto) .replace-row')}.hidden&&document.activeElement===${sel('.xv-find:not(.xv-goto) .find-input')}`), eq(true))
  X.type('plums', 700)
  X.js(`${sel('.xv-find:not(.xv-goto) .replace-input')}.focus()`, 200)
  X.type('Kiwi', 300)
  X.key('Enter', [], 700)
  X.check('XLSX Ctrl+H replace: Plums became Kiwi in A5 (B5 still Plums)', `JSON.stringify({kiwi:[...document.querySelectorAll('.xv-cells [role=gridcell]')].filter(e=>e.innerText.trim()==='Kiwi').length,plums:[...document.querySelectorAll('.xv-cells [role=gridcell]')].filter(e=>e.innerText.trim()==='Plums').length})`, (v) => (JSON.parse(v).kiwi === 1 && JSON.parse(v).plums === 1 ? true : v))
  X.key('Escape', [], 500)
  X.check('XLSX Escape closes find and returns to the grid', `JSON.stringify({hidden:${sel('.xv-find:not(.xv-goto)')}.hidden,focus:document.activeElement===${sel('.xv-scroll')}})`, (v) => (JSON.parse(v).hidden && JSON.parse(v).focus ? true : v))
  // find
  X.key('F', ['control'], 500)
  X.type('kiwi', 700)
  X.check('XLSX Ctrl+F finds "kiwi" (1 of 1)', txt('.xv-find:not(.xv-goto) .find-count'), match(/^1 of 1$/))
  X.key('Escape', [], 400)
  // sheets and go to another sheet
  X.key('PageDown', ['control'], 600)
  X.check('XLSX Ctrl+Page Down switches to Sheet2', `${sel('.xv-tab[aria-selected=true]')}.innerText`, eq('Sheet2'))
  X.key('G', ['control'], 400)
  X.type('Sheet1!B2', 300)
  X.key('Enter', [], 700)
  X.check('XLSX Ctrl+G Sheet1!B2 switches sheet and selects B2', `JSON.stringify({s:${sel('.xv-tab[aria-selected=true]')}.innerText,r:${txt('.xv-ref')}})`, (v) => (JSON.parse(v).s === 'Sheet1' && JSON.parse(v).r === 'B2' ? true : v))
  X.key('PageUp', ['control'], 600)
  X.check('XLSX Ctrl+Page Up switches back to the last sheet (wraps)', `${sel('.xv-tab[aria-selected=true]')}.innerText`, eq('Sheet2'))
  X.key('PageDown', ['control'], 600)
  // typing in the go-to box must not trigger grid keys
  X.key('G', ['control'], 400)
  X.key('Home', ['control'], 300)
  X.check('XLSX keys are ignored while typing in a text field (Ctrl+Home in the go-to box leaves the cell alone)', ref, eq('B2'))
  X.key('Escape', [], 400)
  // save
  X.check('XLSX edits mark the tab dirty', `(()=>{const a=window.__plume;return a.state.tabs[a.state.active].dirty===true})()`, eq(true))
  X.key('S', ['control'], 1800)
  X.check('XLSX Ctrl+S saves (tab no longer dirty)', `(()=>{const a=window.__plume;const t=a.state.tabs[a.state.active];return t.dirty===false||t.dirty===undefined})()`, eq(true))
  X.key('F1', [], 500)
  X.check('XLSX F1 opens the shortcut panel', bool(`${sel('.xv .kb-panel')}&&!${sel('.xv .kb-panel')}.hidden`), eq(true))
  X.shot('xlsx-panel-light.png')
  X.js(`window.__plume.settings.set('theme','dark')`, 600)
  X.shot('xlsx-panel-dark.png')
  X.key('Escape', [], 400)
  X.check('XLSX Escape closes the shortcut panel', `${sel('.xv .kb-panel')}.hidden`, eq(true))
  X.key('/', ['control'], 500)
  X.check('XLSX Ctrl+/ opens the shortcut panel', bool(`!${sel('.xv .kb-panel')}.hidden`), eq(true))

  P.js('JSON.stringify(window.__kl)', 50)
  X.js('JSON.stringify(window.__kl)', 50)
  let pass = 0
  let fail = 0
  const report = (ok, name, msg) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '\n      ' + msg}`) }
  for (const [label, S] of [['pdf', P], ['xlsx', X]]) {
    if (process.env.KB_ONLY && process.env.KB_ONLY !== label) continue
    let r
    try { r = await runApp(S.steps, { grantDir: F.dir, label: 'kb-' + label, timeoutMs: 900000, shotDir }) } catch (e) { report(false, label + ' run completed', e.message); continue }
    S.checks.forEach((c, n) => {
      const v = r.results[n]
      if (!c) return
      let res
      try { res = c.test(v) } catch (e) { res = 'test threw: ' + e.message }
      report(res === true, c.name, typeof res === 'string' ? res : '')
    })
    if (process.env.KB_DEBUG) console.log('KEYLOG', label, r.results[r.results.length - 1])
    report(r.errors.length === 0, label + ': no renderer errors (console error or failed step) during the run', r.errors.join('\n      '))
  }
  console.log(`\n${pass} passed, ${fail} failed. Screenshots: ${shotDir}`)
  try { fs.rmSync(F.dir, { recursive: true, force: true }) } catch {}
  process.exit(fail ? 1 : 0)
}

main().catch((e) => { console.error('FAIL  suite crashed: ' + e.message); process.exit(1) })
