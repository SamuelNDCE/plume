import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'server.mjs')

function start(args, env = {}) {
  const child = spawn(process.execPath, [SERVER, ...args], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...env } })
  let buf = ''
  const waiters = new Map()
  const seen = new Map()
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (d) => {
    buf += d
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i)
      buf = buf.slice(i + 1)
      if (!line.trim()) continue
      const m = JSON.parse(line)
      if (waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id) } else seen.set(m.id, m)
    }
  })
  let n = 0
  const call = (method, params) => new Promise((resolve) => {
    const id = ++n
    waiters.set(id, resolve)
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  })
  const tool = (name, args) => call('tools/call', { name, arguments: args })
  const close = () => { child.stdin.end(); child.kill() }
  return { child, call, tool, close }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plume-mcp-'))
const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'plume-mcp-out-'))
fs.writeFileSync(path.join(root, 'a.md'), '# Alpha\nHello World\n')
fs.mkdirSync(path.join(root, 'sub'))
fs.writeFileSync(path.join(root, 'sub', 'b.txt'), 'line one\nhello again\n')
fs.mkdirSync(path.join(root, 'node_modules'))
fs.writeFileSync(path.join(root, 'node_modules', 'x.md'), 'hello hidden')
fs.writeFileSync(path.join(root, 'c.js'), 'hello js')
fs.writeFileSync(path.join(outside, 'secret.md'), 'top secret')

const txt = (r) => r.result.content[0].text

test('initialize and tools/list (read-only has no write_document)', async () => {
  const s = start([root])
  try {
    const init = await s.call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } })
    assert.equal(init.result.serverInfo.name, 'plume-mcp')
    const list = await s.call('tools/list', {})
    const names = list.result.tools.map((t) => t.name).sort()
    assert.deepEqual(names, ['list_documents', 'read_document', 'search_documents'])
  } finally { s.close() }
})

test('write_document is registered with --allow-write', async () => {
  const s = start([root, '--allow-write'])
  try {
    const list = await s.call('tools/list', {})
    assert.ok(list.result.tools.some((t) => t.name === 'write_document'))
  } finally { s.close() }
})

test('list, read and search', async () => {
  const s = start([root])
  try {
    const l = txt(await s.tool('list_documents', {}))
    assert.match(l, /a\.md/)
    assert.match(l, /sub\/b\.txt/)
    assert.doesNotMatch(l, /node_modules/)
    assert.doesNotMatch(l, /c\.js/)
    assert.match(txt(await s.tool('read_document', { path: 'a.md' })), /Hello World/)
    assert.match(txt(await s.tool('read_document', { path: 'sub/b.txt' })), /hello again/)
    const hits = txt(await s.tool('search_documents', { query: 'HELLO' }))
    assert.match(hits, /a\.md:2: Hello World/)
    assert.match(hits, /sub\/b\.txt:2: hello again/)
    assert.doesNotMatch(hits, /hidden/)
  } finally { s.close() }
})

test('traversal and absolute paths are refused', async () => {
  const s = start([root])
  try {
    for (const p of ['../x.md', 'sub/../../x.md', '..\\x.md', path.join(outside, 'secret.md'), '/etc/passwd.md', 'C:\\Windows\\a.md', 'C:a.md', '\\\\host\\share\\a.md']) {
      const r = await s.tool('read_document', { path: p })
      assert.equal(r.result.isError, true, 'should refuse ' + p)
    }
    const bad = await s.tool('read_document', { path: 'c.js' })
    assert.equal(bad.result.isError, true)
    const missing = await s.tool('read_document', {})
    assert.equal(missing.result.isError, true)
  } finally { s.close() }
})

test('symlink pointing outside the root is refused', async (t) => {
  try {
    fs.symlinkSync(path.join(outside, 'secret.md'), path.join(root, 'link.md'), 'file')
    fs.symlinkSync(outside, path.join(root, 'linkdir'), 'junction')
  } catch (e) {
    t.skip('cannot create symlinks on this machine: ' + e.code)
    return
  }
  const s = start([root])
  try {
    const r = await s.tool('read_document', { path: 'link.md' })
    assert.equal(r.result.isError, true)
    const r2 = await s.tool('read_document', { path: 'linkdir/secret.md' })
    assert.equal(r2.result.isError, true)
    assert.doesNotMatch(txt(await s.tool('list_documents', {})), /secret|link/)
    assert.doesNotMatch(txt(await s.tool('search_documents', { query: 'top secret' })), /secret\.md/)
  } finally { s.close() }
})

test('write_document refuses overwrite without overwrite: true', async () => {
  const s = start([root, '--allow-write'])
  try {
    const ok = await s.tool('write_document', { path: 'new.md', content: 'fresh' })
    assert.ok(!ok.result.isError)
    assert.equal(fs.readFileSync(path.join(root, 'new.md'), 'utf8'), 'fresh')
    const no = await s.tool('write_document', { path: 'new.md', content: 'changed' })
    assert.equal(no.result.isError, true)
    assert.equal(fs.readFileSync(path.join(root, 'new.md'), 'utf8'), 'fresh')
    const yes = await s.tool('write_document', { path: 'new.md', content: 'changed', overwrite: true })
    assert.ok(!yes.result.isError)
    assert.equal(fs.readFileSync(path.join(root, 'new.md'), 'utf8'), 'changed')
    assert.equal((await s.tool('write_document', { path: '../evil.md', content: 'x' })).result.isError, true)
    assert.equal((await s.tool('write_document', { path: 'big.md', content: 'x'.repeat(2 * 1024 * 1024 + 1) })).result.isError, true)
    assert.equal((await s.tool('write_document', { path: 'x.js', content: 'x' })).result.isError, true)
  } finally { s.close() }
})

test('server refuses to start with no root or a bad root', () => {
  const env = { ...process.env }
  delete env.PLUME_MCP_ROOT
  const r = spawnSync(process.execPath, [SERVER], { env, encoding: 'utf8', timeout: 10000 })
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /no root folder/)
  const r2 = spawnSync(process.execPath, [SERVER, path.join(root, 'does-not-exist')], { env, encoding: 'utf8', timeout: 10000 })
  assert.notEqual(r2.status, 0)
})

test('cleanup', () => {
  fs.rmSync(root, { recursive: true, force: true })
  fs.rmSync(outside, { recursive: true, force: true })
})
