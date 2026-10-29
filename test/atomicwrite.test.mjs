import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
const { writeAtomic } = createRequire(import.meta.url)('../electron/atomicwrite.cjs')

const mk = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plume-atomic-'))
  const f = path.join(dir, 'a.txt')
  fs.writeFileSync(f, 'original')
  return { dir, f }
}

test('writes the new content and leaves no temp file', () => {
  const { dir, f } = mk()
  writeAtomic(f, Buffer.from('new content'))
  assert.equal(fs.readFileSync(f, 'utf8'), 'new content')
  assert.deepEqual(fs.readdirSync(dir), ['a.txt'])
})

test('a failure in the middle of the write leaves the original intact', () => {
  const { dir, f } = mk()
  const bad = { ...fs, writeSync: () => { throw new Error('disk full') } }
  assert.throws(() => writeAtomic(f, Buffer.from('half'), bad), /disk full/)
  assert.equal(fs.readFileSync(f, 'utf8'), 'original')
  assert.deepEqual(fs.readdirSync(dir), ['a.txt'])
})

test('a failure at the rename leaves the original intact and removes the temp file', () => {
  const { dir, f } = mk()
  const bad = { ...fs, renameSync: () => { throw new Error('locked') } }
  assert.throws(() => writeAtomic(f, Buffer.from('x'), bad), /locked/)
  assert.equal(fs.readFileSync(f, 'utf8'), 'original')
  assert.deepEqual(fs.readdirSync(dir), ['a.txt'])
})

test('a target in a missing folder fails without touching anything', () => {
  const { dir } = mk()
  assert.throws(() => writeAtomic(path.join(dir, 'nope', 'b.txt'), Buffer.from('x')))
  assert.deepEqual(fs.readdirSync(dir), ['a.txt'])
})

test('keeps the original file mode (POSIX only)', { skip: process.platform === 'win32' ? 'file modes are not meaningful on Windows' : false }, () => {
  const { f } = mk()
  fs.chmodSync(f, 0o640)
  writeAtomic(f, Buffer.from('new'))
  assert.equal(fs.statSync(f).mode & 0o7777, 0o640)
})

test('a pre-existing file at a guessable temp name is not followed or touched', () => {
  const { dir, f } = mk()
  const planted = path.join(dir, 'a.txt.plume-tmp')
  fs.writeFileSync(planted, 'planted')
  writeAtomic(f, Buffer.from('new'))
  assert.equal(fs.readFileSync(planted, 'utf8'), 'planted')
  assert.equal(fs.readFileSync(f, 'utf8'), 'new')
})

test('the temp file is created exclusively (wx)', () => {
  const { f } = mk()
  const flags = []
  const spy = { ...fs, openSync: (p, fl, m) => { flags.push(fl); return fs.openSync(p, fl, m) } }
  writeAtomic(f, Buffer.from('x'), spy)
  assert.deepEqual(flags, ['wx'])
})
