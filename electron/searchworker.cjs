// Folder search worker. Runs off the main thread so a big folder (or a pathological regex)
// can never freeze the app; the main process terminates it on cancel or timeout.
// Walks the folder, skips dot-entries, node_modules, symlinks and binaries, and posts hits in batches.
const { parentPort, workerData } = require('node:worker_threads')
const fs = require('node:fs')
const path = require('node:path')

const { dir, query, matchCase, regex, extOk, maxHits, maxBytes, maxDepth } = workerData
const extSet = new Set(extOk)
const SNIFF = 4096
const BATCH_HITS = 20
const BATCH_MS = 40

let re = null
if (regex) {
  try { re = new RegExp(query, matchCase ? '' : 'i') } catch { parentPort.postMessage({ done: true, invalid: true, hits: [], files: 0 }); process.exit(0) }
}
const needle = matchCase ? query : query.toLowerCase()

let batch = []
let lastSent = Date.now()
let total = 0
let files = 0
let capped = false
const flush = (final) => {
  if (!batch.length && !final) return
  parentPort.postMessage({ hits: batch, done: !!final, capped, files })
  batch = []
  lastSent = Date.now()
}

const scan = (full, name) => {
  let fd
  try { fd = fs.openSync(full, 'r') } catch { return }
  let text
  try {
    const head = Buffer.allocUnsafe(SNIFF)
    const n = fs.readSync(fd, head, 0, SNIFF, 0)
    if (head.subarray(0, n).indexOf(0) !== -1) return // binary
    if (n < SNIFF) text = head.toString('utf8', 0, n)
    else {
      const size = fs.fstatSync(fd).size
      if (size > maxBytes) return
      const buf = Buffer.allocUnsafe(size)
      head.copy(buf, 0, 0, n)
      let got = n
      while (got < size) {
        const r = fs.readSync(fd, buf, got, size - got, got)
        if (r <= 0) break
        got += r
      }
      text = buf.toString('utf8', 0, got)
    }
  } catch { return } finally { try { fs.closeSync(fd) } catch {} }
  files++
  // Cheap whole-file reject before splitting into lines.
  if (!re) {
    if ((matchCase ? text : text.toLowerCase()).indexOf(needle) === -1) return
  }
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    const hit = re ? re.test(l) : (matchCase ? l : l.toLowerCase()).indexOf(needle) !== -1
    if (!hit) continue
    batch.push({ path: full, name, line: i + 1, text: l.trim().slice(0, 200) })
    if (++total >= maxHits) { capped = true; return }
    if (batch.length >= BATCH_HITS || Date.now() - lastSent >= BATCH_MS) flush(false)
  }
}

const walk = (d, depth) => {
  if (capped || depth > maxDepth) return
  let ents
  try { ents = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
  for (const e of ents) {
    if (capped) return
    const nm = e.name
    if (nm.charCodeAt(0) === 46 || nm === 'node_modules') continue
    if (e.isSymbolicLink()) continue // never follow links: stay inside the opened folder
    const full = path.join(d, nm)
    if (e.isDirectory()) walk(full, depth + 1)
    else if (e.isFile() && extSet.has(path.extname(nm).toLowerCase())) {
      scan(full, nm)
      if (Date.now() - lastSent >= BATCH_MS) flush(false)
    }
  }
}

walk(dir, 0)
flush(true)
