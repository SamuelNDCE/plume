// Run: node --test test/textio.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const { decode, encode } = createRequire(import.meta.url)('../electron/textio.cjs')

const roundTrip = (buf) => {
  const d = decode(buf)
  assert.equal(d.binary, false)
  return encode(d.content, d.encoding, d.eol || 'lf')
}

test('plain UTF-8 with LF', () => {
  const d = decode(Buffer.from('a\nb\n', 'utf8'))
  assert.deepEqual([d.encoding, d.eol, d.mixedEol, d.content], ['utf-8', 'lf', false, 'a\nb\n'])
})

test('CRLF is detected, normalised for the editor, and restored on save', () => {
  const buf = Buffer.from('one\r\ntwo\r\n', 'utf8')
  const d = decode(buf)
  assert.equal(d.eol, 'crlf')
  assert.equal(d.content, 'one\ntwo\n')
  assert.deepEqual(roundTrip(buf), buf)
})

test('lone CR (classic Mac) round-trips', () => {
  const buf = Buffer.from('a\rb\r', 'utf8')
  assert.equal(decode(buf).eol, 'cr')
  assert.deepEqual(roundTrip(buf), buf)
})

test('mixed endings are flagged and saved with the dominant one', () => {
  const d = decode(Buffer.from('a\r\nb\r\nc\nd', 'utf8'))
  assert.equal(d.eol, 'crlf')
  assert.equal(d.mixedEol, true)
})

test('no line breaks: eol unknown', () => {
  assert.equal(decode(Buffer.from('hello', 'utf8')).eol, null)
})

test('UTF-8 BOM is kept', () => {
  const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('héllo\r\n', 'utf8')])
  const d = decode(buf)
  assert.deepEqual([d.encoding, d.content], ['utf-8-bom', 'héllo\n'])
  assert.deepEqual(roundTrip(buf), buf)
})

test('UTF-16 LE and BE with BOM open (not "binary") and round-trip', () => {
  const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Hi ☃\r\nyo', 'utf16le')])
  const dle = decode(le)
  assert.deepEqual([dle.binary, dle.encoding, dle.content], [false, 'utf-16le', 'Hi ☃\nyo'])
  assert.deepEqual(roundTrip(le), le)
  const be = encode('Hi ☃\nyo', 'utf-16be', 'crlf')
  const dbe = decode(be)
  assert.deepEqual([dbe.encoding, dbe.content, dbe.eol], ['utf-16be', 'Hi ☃\nyo', 'crlf'])
  assert.deepEqual(roundTrip(be), be)
})

test('UTF-16 LE without a BOM is sniffed', () => {
  const d = decode(Buffer.from('hello world, plain ascii text', 'utf16le'))
  assert.deepEqual([d.binary, d.encoding], [false, 'utf-16le'])
})

test('invalid UTF-8 falls back to Windows-1252 and round-trips', () => {
  const buf = Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x20, 0x80, 0x0d, 0x0a]) // "café €\r\n"
  const d = decode(buf)
  assert.deepEqual([d.encoding, d.content], ['windows-1252', 'café €\n'])
  assert.deepEqual(roundTrip(buf), buf)
})

test('real binary data is still rejected', () => {
  assert.equal(decode(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 1, 2, 3])).binary, true)
})

test('converting: encode honours a changed encoding and ending', () => {
  assert.deepEqual(encode('a\nb', 'utf-8', 'crlf'), Buffer.from('a\r\nb'))
  assert.deepEqual(encode('é', 'windows-1252'), Buffer.from([0xe9]))
  assert.deepEqual(encode('☃', 'windows-1252'), Buffer.from([0x3f]))
})

test('empty file', () => {
  const d = decode(Buffer.alloc(0))
  assert.deepEqual([d.binary, d.content, d.encoding], [false, '', 'utf-8'])
})
