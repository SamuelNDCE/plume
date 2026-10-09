// Reading and writing text files the way Notepad does: detect the encoding and the line endings on open,
// and write both back unchanged on save, so opening a file and saving it never rewrites it.
// Encodings: utf-8, utf-8-bom, utf-16le, utf-16be (with BOM), windows-1252 (legacy ANSI fallback).
// The editor works on text with plain "\n" line breaks; the file's real line ending is carried alongside.

const ENCODINGS = ['utf-8', 'utf-8-bom', 'utf-16le', 'utf-16be', 'windows-1252']
const EOLS = { lf: '\n', crlf: '\r\n', cr: '\r' }

let cp1252Reverse = null
function reverse1252() {
  if (cp1252Reverse) return cp1252Reverse
  const dec = new TextDecoder('windows-1252')
  cp1252Reverse = new Map()
  for (let b = 0; b < 256; b++) cp1252Reverse.set(dec.decode(Uint8Array.of(b)), b)
  return cp1252Reverse
}

function swap16(buf) {
  const out = Buffer.from(buf)
  for (let i = 0; i + 1 < out.length; i += 2) {
    const t = out[i]
    out[i] = out[i + 1]
    out[i + 1] = t
  }
  return out
}

// UTF-16 without a BOM: mostly-ASCII text has a zero byte in every other position.
function sniffUtf16(buf) {
  const n = Math.min(buf.length, 4000) & ~1
  if (n < 4) return null
  let even = 0
  let odd = 0
  for (let i = 0; i < n; i += 2) {
    if (buf[i] === 0) even++
    if (buf[i + 1] === 0) odd++
  }
  const pairs = n / 2
  if (odd > pairs * 0.4 && even === 0) return 'utf-16le'
  if (even > pairs * 0.4 && odd === 0) return 'utf-16be'
  return null
}

function detectEol(text) {
  let crlf = 0
  let lf = 0
  let cr = 0
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c === 13) {
      if (text.charCodeAt(i + 1) === 10) {
        crlf++
        i++
      } else cr++
    } else if (c === 10) lf++
  }
  const kinds = [['crlf', crlf], ['lf', lf], ['cr', cr]].filter((k) => k[1] > 0)
  if (!kinds.length) return { eol: null, mixed: false }
  kinds.sort((a, b) => b[1] - a[1])
  return { eol: kinds[0][0], mixed: kinds.length > 1 }
}

const normalizeEol = (text) => text.replace(/\r\n?/g, '\n')

// -> { binary, content, encoding, eol, mixedEol }
function decode(buf) {
  let encoding = null
  let body = buf
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    encoding = 'utf-8-bom'
    body = buf.subarray(3)
  } else if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    encoding = 'utf-16le'
    body = buf.subarray(2)
  } else if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    encoding = 'utf-16be'
    body = buf.subarray(2)
  } else {
    const sniffed = sniffUtf16(buf)
    if (sniffed) encoding = sniffed
    else if (buf.subarray(0, 8000).includes(0)) return { binary: true, content: '', encoding: null, eol: null, mixedEol: false }
  }
  let text
  if (encoding === 'utf-16le') text = body.toString('utf16le')
  else if (encoding === 'utf-16be') text = swap16(body).toString('utf16le')
  else {
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(body)
      if (!encoding) encoding = 'utf-8'
    } catch {
      text = new TextDecoder('windows-1252').decode(body)
      encoding = 'windows-1252'
    }
  }
  const { eol, mixed } = detectEol(text)
  return { binary: false, content: normalizeEol(text), encoding, eol, mixedEol: mixed }
}

// text uses "\n"; eol is 'lf' | 'crlf' | 'cr' (default lf); encoding as above (default utf-8)
function encode(text, encoding = 'utf-8', eol = 'lf') {
  const nl = EOLS[eol] || '\n'
  const s = nl === '\n' ? normalizeEol(text) : normalizeEol(text).replace(/\n/g, nl)
  switch (encoding) {
    case 'utf-8-bom':
      return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(s, 'utf8')])
    case 'utf-16le':
      return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(s, 'utf16le')])
    case 'utf-16be':
      return Buffer.concat([Buffer.from([0xfe, 0xff]), swap16(Buffer.from(s, 'utf16le'))])
    case 'windows-1252': {
      const map = reverse1252()
      const bytes = []
      for (const ch of s) bytes.push(map.has(ch) ? map.get(ch) : 0x3f)
      return Buffer.from(bytes)
    }
    default: {
      if (SINGLE_BYTE.includes(encoding)) {
        const map = reverseSingleByte(encoding)
        const bytes = []
        for (const ch of s) bytes.push(map.has(ch) ? map.get(ch) : 0x3f)
        return Buffer.from(bytes)
      }
      if (MULTI_BYTE_READ_ONLY.includes(encoding)) throw new Error(`Saving as ${encoding} is not supported. Use Save As with UTF-8.`)
      return Buffer.from(s, 'utf8')
    }
  }
}

// Reopen with a chosen code page. Single-byte pages can also be saved (the encoder is the decoder run backwards).
// Multi-byte pages can be reopened but not saved: there is no reliable encoder for them in this build.
const SINGLE_BYTE = ['windows-1250', 'windows-1251', 'windows-1253', 'koi8-r', 'iso-8859-2', 'iso-8859-5']
const MULTI_BYTE_READ_ONLY = ['shift_jis', 'gbk', 'big5', 'euc-kr']
const reverseMaps = new Map()
function reverseSingleByte(label) {
  if (reverseMaps.has(label)) return reverseMaps.get(label)
  const dec = new TextDecoder(label)
  const map = new Map()
  for (let b = 0; b < 256; b++) {
    const ch = dec.decode(Uint8Array.of(b))
    if (!map.has(ch)) map.set(ch, b)
  }
  reverseMaps.set(label, map)
  return map
}

// Decode with an explicit code page (the user chose it). Keeps the same line-ending detection as decode().
function decodeAs(buf, label) {
  const text = new TextDecoder(label).decode(buf)
  const { eol, mixed } = detectEol(text)
  return { binary: false, content: normalizeEol(text), encoding: label, eol, mixedEol: mixed }
}

module.exports = { decode, decodeAs, encode, ENCODINGS, EOLS, SINGLE_BYTE, MULTI_BYTE_READ_ONLY }
