#!/usr/bin/env node
// Plume MCP server: local stdio only, zero dependencies, no network.
// Newline-delimited JSON-RPC 2.0. Usage: node server.mjs <folder> [--allow-write]
import fs from 'node:fs/promises'
import path from 'node:path'
import readline from 'node:readline'

const EXTS = new Set(['.md', '.markdown', '.mdown', '.mkd', '.txt'])
const MAX_BYTES = 2 * 1024 * 1024
const MAX_DEPTH = 6
const MAX_HITS = 200
const MAX_LIST = 5000
const PROTOCOL = '2024-11-05'

const argv = process.argv.slice(2)
const allowWrite = argv.includes('--allow-write')
const rootArg = argv.find((a) => !a.startsWith('--')) || process.env.PLUME_MCP_ROOT

function log(...a) { process.stderr.write('[plume-mcp] ' + a.join(' ') + '\n') }

if (!rootArg) {
  log('no root folder. Usage: node server.mjs <folder> [--allow-write] (or set PLUME_MCP_ROOT)')
  process.exit(2)
}
let ROOT
try {
  ROOT = await fs.realpath(path.resolve(rootArg))
  if (!(await fs.stat(ROOT)).isDirectory()) throw new Error('not a directory')
} catch (e) {
  log('root is not an existing directory: ' + (e && e.message))
  process.exit(2)
}

const cmp = (s) => (process.platform === 'win32' ? s.toLowerCase() : s)
function inside(p) {
  const rel = path.relative(cmp(ROOT), cmp(p))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}
class ToolError extends Error {}
const fail = (m) => { throw new ToolError(m) }

// Validate a caller-supplied relative path. Returns { abs, rel }.
async function safePath(input, { mustExist }) {
  if (typeof input !== 'string' || !input) fail('path must be a non-empty string')
  if (input.includes('\0')) fail('invalid path')
  if (path.win32.isAbsolute(input) || path.posix.isAbsolute(input) || /^[a-zA-Z]:/.test(input) || input.startsWith('\\\\')) {
    fail('absolute paths are not allowed')
  }
  const parts = input.split(/[\\/]+/).filter((s) => s !== '' && s !== '.')
  if (!parts.length) fail('invalid path')
  if (parts.includes('..')) fail("'..' is not allowed")
  const ext = path.extname(parts[parts.length - 1]).toLowerCase()
  if (!EXTS.has(ext)) fail('file type not allowed (allowed: ' + [...EXTS].join(' ') + ')')
  const abs = path.join(ROOT, ...parts)
  let real
  try {
    const st = await fs.lstat(abs)
    if (st.isSymbolicLink()) fail('symlinks are not allowed')
    real = await fs.realpath(abs)
  } catch (e) {
    if (e instanceof ToolError) throw e
    if (mustExist) fail('file not found')
    let parent
    try { parent = await fs.realpath(path.dirname(abs)) } catch { fail('parent folder does not exist') }
    real = path.join(parent, path.basename(abs))
  }
  if (!inside(real)) fail('path is outside the root')
  return { abs: real, rel: parts.join('/') }
}

async function walk(dir, depth, out, relDir = '') {
  if (depth > MAX_DEPTH || out.length >= MAX_LIST) return
  let ents
  try { ents = await fs.readdir(dir, { withFileTypes: true }) } catch { return }
  ents.sort((a, b) => a.name.localeCompare(b.name))
  for (const e of ents) {
    if (out.length >= MAX_LIST) return
    if (e.isSymbolicLink()) continue
    const rel = relDir ? relDir + '/' + e.name : e.name
    if (e.isDirectory()) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue
      await walk(path.join(dir, e.name), depth + 1, out, rel)
    } else if (e.isFile() && EXTS.has(path.extname(e.name).toLowerCase())) {
      try { out.push({ path: rel, size: (await fs.stat(path.join(dir, e.name))).size }) } catch {}
    }
  }
}

const text = (s) => ({ content: [{ type: 'text', text: s }] })

async function listDocuments() {
  const out = []
  await walk(ROOT, 0, out)
  return text(out.length ? out.map((f) => `${f.path}\t${f.size} bytes`).join('\n') : '(no documents found)')
}

async function readDocument(args) {
  const { abs } = await safePath(args?.path, { mustExist: true })
  const st = await fs.stat(abs)
  if (!st.isFile()) fail('not a file')
  if (st.size > MAX_BYTES) fail('file is larger than 2 MB')
  return text(await fs.readFile(abs, 'utf8'))
}

async function searchDocuments(args) {
  const q = args?.query
  if (typeof q !== 'string' || !q) fail('query must be a non-empty string')
  const needle = q.toLowerCase()
  const files = []
  await walk(ROOT, 0, files)
  const hits = []
  for (const f of files) {
    if (hits.length >= MAX_HITS) break
    if (f.size > MAX_BYTES) continue
    let body
    try { body = await fs.readFile(path.join(ROOT, ...f.path.split('/')), 'utf8') } catch { continue }
    const lines = body.split(/\r\n|\n|\r/)
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(needle)) {
        hits.push(`${f.path}:${i + 1}: ${lines[i].slice(0, 300)}`)
        if (hits.length >= MAX_HITS) break
      }
    }
  }
  const note = hits.length >= MAX_HITS ? `\n(capped at ${MAX_HITS} hits)` : ''
  return text(hits.length ? hits.join('\n') + note : 'no matches')
}

async function writeDocument(args) {
  if (typeof args?.content !== 'string') fail('content must be a string')
  if (Buffer.byteLength(args.content, 'utf8') > MAX_BYTES) fail('content is larger than 2 MB')
  const { abs, rel } = await safePath(args.path, { mustExist: false })
  const overwrite = args.overwrite === true
  try {
    await fs.writeFile(abs, args.content, { encoding: 'utf8', flag: overwrite ? 'w' : 'wx' })
  } catch (e) {
    if (e && e.code === 'EEXIST') fail('file exists; pass overwrite: true to replace it')
    fail('could not write file')
  }
  return text(`wrote ${rel}`)
}

const strProp = (d) => ({ type: 'string', description: d })
const TOOLS = [
  { name: 'list_documents', description: 'List Markdown and text files under the root folder (relative paths and sizes).', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, run: listDocuments },
  { name: 'read_document', description: 'Read one Markdown or text file by relative path (max 2 MB).', inputSchema: { type: 'object', properties: { path: strProp('Relative path inside the root') }, required: ['path'], additionalProperties: false }, run: readDocument },
  { name: 'search_documents', description: 'Case-insensitive plain-text search across documents. Returns path, line number and line (max 200 hits).', inputSchema: { type: 'object', properties: { query: strProp('Text to find') }, required: ['query'], additionalProperties: false }, run: searchDocuments },
]
if (allowWrite) {
  TOOLS.push({ name: 'write_document', description: 'Create or overwrite one Markdown or text file (max 2 MB). Refuses to replace an existing file unless overwrite is true.', inputSchema: { type: 'object', properties: { path: strProp('Relative path inside the root'), content: strProp('Full file text'), overwrite: { type: 'boolean', description: 'Allow replacing an existing file' } }, required: ['path', 'content'], additionalProperties: false }, run: writeDocument })
}

const send = (obj) => process.stdout.write(JSON.stringify(obj) + '\n')
const rpcError = (id, code, message) => send({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })

async function handle(msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.method !== 'string') {
    return rpcError(msg && msg.id, -32600, 'Invalid Request')
  }
  const { id, method, params } = msg
  if (id === undefined || id === null) return // notifications (incl. notifications/initialized): no reply
  switch (method) {
    case 'initialize':
      return send({ jsonrpc: '2.0', id, result: { protocolVersion: typeof params?.protocolVersion === 'string' ? params.protocolVersion : PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: 'plume-mcp', version: '0.1.0' } } })
    case 'ping':
      return send({ jsonrpc: '2.0', id, result: {} })
    case 'tools/list':
      return send({ jsonrpc: '2.0', id, result: { tools: TOOLS.map(({ run, ...t }) => t) } })
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === params?.name)
      if (!tool) return rpcError(id, -32602, 'Unknown tool')
      try {
        const args = params.arguments && typeof params.arguments === 'object' ? params.arguments : {}
        return send({ jsonrpc: '2.0', id, result: await tool.run(args) })
      } catch (e) {
        if (!(e instanceof ToolError)) log(String((e && e.stack) || e))
        const m = e instanceof ToolError ? e.message : 'internal error'
        return send({ jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: m }] } })
      }
    }
    default:
      return rpcError(id, -32601, 'Method not found')
  }
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
const pending = new Set()
rl.on('line', (line) => {
  if (!line.trim()) return
  let msg
  try { msg = JSON.parse(line) } catch { return rpcError(null, -32700, 'Parse error') }
  const p = handle(msg).catch((e) => { log(String((e && e.stack) || e)); rpcError(msg && msg.id, -32603, 'Internal error') })
  pending.add(p)
  p.finally(() => pending.delete(p))
})
rl.on('close', async () => { await Promise.all(pending); process.exit(0) })
log(`serving ${allowWrite ? 'read+write' : 'read-only'} on stdio`)
