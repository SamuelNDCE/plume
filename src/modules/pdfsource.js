// PDF source and check (read only). Loaded on first use from the PDF viewer's Source button, so startup never pays for pdf-lib.
// inspect(bytes) returns a check (does the file parse, how many pages, is it encrypted, form fields, objects) and the
// file's object source as PDF syntax. Nothing here writes; editing the PDF is in pdfedit.js (pdf-lib, saved with Ctrl+S).
import { PDFDocument } from 'pdf-lib'

const MAX_SOURCE_CHARS = 1500000 // the object source is cut here so a huge file cannot freeze the panel
const HEADER_RE = /%PDF-(\d\.\d)/

export async function inspect(bytes) {
  const check = []
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024))
  const ver = HEADER_RE.exec(head)
  check.push(['PDF version', ver ? ver[1] : 'no %PDF header found'])
  const tail = new TextDecoder('latin1').decode(bytes.subarray(Math.max(0, bytes.length - 1024)))
  check.push(['End of file marker (%%EOF)', tail.includes('%%EOF') ? 'present' : 'missing (file may be truncated)'])
  check.push(['File size', bytes.length.toLocaleString() + ' bytes'])

  let doc
  try {
    // ignoreEncryption: read the structure of an encrypted file without its password (content may be unreadable)
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
  } catch (e) {
    check.push(['Structure parses', 'NO: ' + String((e && e.message) || e).slice(0, 200)])
    return { check, source: '' }
  }
  check.push(['Structure parses', 'yes'])
  check.push(['Encrypted', doc.isEncrypted ? 'yes (password needed to read the content)' : 'no'])
  check.push(['Pages', String(doc.getPageCount())])
  try {
    check.push(['Form fields', String(doc.getForm().getFields().length)])
  } catch {
    check.push(['Form fields', '0'])
  }
  try {
    const title = doc.getTitle()
    const author = doc.getAuthor()
    if (title) check.push(['Title', title])
    if (author) check.push(['Author', author])
  } catch {}
  const objects = doc.context.enumerateIndirectObjects()
  check.push(['Indirect objects', String(objects.length)])

  const parts = []
  let size = 0
  let cut = false
  for (const [ref, obj] of objects) {
    const block = `${ref.objectNumber} ${ref.generationNumber} obj\n${obj.toString()}\nendobj\n`
    if (size + block.length > MAX_SOURCE_CHARS) { cut = true; break }
    parts.push(block)
    size += block.length
  }
  if (cut) parts.push(`\n... source cut at ${MAX_SOURCE_CHARS.toLocaleString()} characters; the rest is in the file\n`)
  return { check, source: parts.join('') }
}

// The text the Source view shows: the check as % comment lines, then the object source. Read only.
export async function pdfSourceText(bytes) {
  const r = await inspect(bytes)
  const head = [
    '% PDF source and check (read only). Editing the PDF in this window is coming in a later update.',
    '% PDF edits are made through the code for now and saved with Ctrl+S.',
    ...r.check.map(([k, v]) => `% ${k}: ${v}`),
    '',
  ]
  return head.join('\n') + r.source
}
