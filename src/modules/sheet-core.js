// sheet-core.js: pure spreadsheet logic for CSV/TSV (no DOM).
// Parse/serialize (RFC 4180), delimiter detection, A1 helpers, a formula engine
// (tokenizer + recursive descent, no eval), sorting, stats, fill/paste and an
// undoable Sheet model. sheet.js is the UI on top of this.

export const MAX_HISTORY = 200
export const DELIMITERS = [',', ';', '\t', '|']

// ---------------------------------------------------------------- addresses
export function colToLetters(c) {
  let s = ''
  let n = c + 1
  while (n > 0) {
    const m = (n - 1) % 26
    s = String.fromCharCode(65 + m) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}
export function lettersToCol(s) {
  let n = 0
  for (const ch of String(s).toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}
export const addr = (r, c) => colToLetters(c) + (r + 1)
const REF_RE = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/
export function parseAddr(s) {
  const m = REF_RE.exec(String(s).trim())
  if (!m) return null
  const row = parseInt(m[4], 10)
  if (row < 1) return null
  return { r: row - 1, c: lettersToCol(m[2]), absC: !!m[1], absR: !!m[3] }
}
export function parseRange(s) {
  const parts = String(s).split(':')
  const a = parseAddr(parts[0])
  const b = parts.length > 1 ? parseAddr(parts[1]) : a
  if (!a || !b) return null
  return { r0: Math.min(a.r, b.r), c0: Math.min(a.c, b.c), r1: Math.max(a.r, b.r), c1: Math.max(a.c, b.c) }
}
const fmtRef = (p) => (p.absC ? '$' : '') + colToLetters(p.c) + (p.absR ? '$' : '') + (p.r + 1)

// ---------------------------------------------------------------- parse / serialize
// Returns { rows, eol, bom, trailingEol }. Quotes, "" escapes, embedded newlines and delimiters,
// CRLF / LF / CR, BOM and ragged rows are handled. maxRows is for cheap sampling.
export function parseCsv(text, delimiter = ',', maxRows = Infinity) {
  text = String(text == null ? '' : text)
  let bom = false
  if (text.charCodeAt(0) === 0xfeff) {
    bom = true
    text = text.slice(1)
  }
  const dc = delimiter.charCodeAt(0)
  const n = text.length
  const rows = []
  let eol = null
  let trailing = false
  let i = 0
  while (i < n) {
    const row = []
    let lineEnded = false
    for (;;) {
      let field
      if (text.charCodeAt(i) === 34) {
        let j = i + 1
        let out = ''
        for (;;) {
          const q = text.indexOf('"', j)
          if (q === -1) {
            out += text.slice(j)
            j = n
            break
          }
          out += text.slice(j, q)
          if (text.charCodeAt(q + 1) === 34) {
            out += '"'
            j = q + 2
            continue
          }
          j = q + 1
          break
        }
        let k = j
        while (k < n) {
          const ch = text.charCodeAt(k)
          if (ch === dc || ch === 10 || ch === 13) break
          k++
        }
        field = out + (k > j ? text.slice(j, k) : '')
        i = k
      } else {
        let k = i
        while (k < n) {
          const ch = text.charCodeAt(k)
          if (ch === dc || ch === 10 || ch === 13) break
          k++
        }
        field = text.slice(i, k)
        i = k
      }
      row.push(field)
      if (i >= n) break
      const ch = text.charCodeAt(i)
      if (ch === dc) {
        i++
        if (i >= n) {
          row.push('')
          break
        }
        continue
      }
      if (ch === 13 && text.charCodeAt(i + 1) === 10) {
        if (!eol) eol = '\r\n'
        i += 2
      } else {
        if (!eol) eol = ch === 13 ? '\r' : '\n'
        i++
      }
      lineEnded = true
      break
    }
    rows.push(row)
    if (lineEnded && i >= n) trailing = true
    if (rows.length >= maxRows) break
  }
  if (!rows.length) rows.push([''])
  return { rows, eol: eol || '\n', bom, trailingEol: trailing }
}

const quoteRe = new Map()
function needsQuoteRe(d) {
  let re = quoteRe.get(d)
  if (!re) {
    re = new RegExp('[\\' + d + '"\\r\\n]')
    quoteRe.set(d, re)
  }
  return re
}

export function serializeCsv(rows, { delimiter = ',', eol = '\n', bom = false, trailingEol = false } = {}) {
  const re = needsQuoteRe(delimiter)
  const lines = new Array(rows.length)
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]
    const parts = new Array(row.length)
    for (let c = 0; c < row.length; c++) {
      const v = row[c]
      parts[c] = v !== '' && re.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v
    }
    lines[r] = parts.join(delimiter)
  }
  return (bom ? '﻿' : '') + lines.join(eol) + (trailingEol ? eol : '')
}

// Pick the delimiter whose parse gives the most consistent multi-column shape.
export function detectDelimiter(text, fallback = ',') {
  const sample = String(text || '').slice(0, 40000)
  let best = null
  let bestScore = 0
  let bestW = 0
  for (const d of DELIMITERS) {
    const rows = parseCsv(sample, d, 60).rows
    const counts = new Map()
    for (const r of rows) counts.set(r.length, (counts.get(r.length) || 0) + 1)
    let w = 0
    let k = 0
    for (const [width, num] of counts) if (num > k || (num === k && width > w)) ((w = width), (k = num))
    if (w < 2) continue
    const frac = k / rows.length
    if (frac > bestScore + 1e-9 || (Math.abs(frac - bestScore) < 1e-9 && w > bestW)) {
      best = d
      bestScore = frac
      bestW = w
    }
  }
  return best || fallback
}

// ---------------------------------------------------------------- numbers
const PLAIN_NUM = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/
const GROUPED_NUM = /^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/
// Number or null. "1,234.5" and "1,234,567" are numbers; "1,234" (could be a decimal comma) is not.
export function parseNumber(s) {
  if (typeof s === 'number') return Number.isFinite(s) ? s : null
  if (typeof s !== 'string') return null
  const t = s.trim()
  if (t === '') return null
  if (PLAIN_NUM.test(t)) return Number(t)
  const m = GROUPED_NUM.exec(t)
  if (m) {
    const groups = t.split(',').length - 1
    if (groups >= 2 || m[2] !== undefined) return Number(t.replace(/,/g, ''))
  }
  return null
}

// ---------------------------------------------------------------- formula engine
export class FErr {
  constructor(code) {
    this.code = code
  }
  toString() {
    return this.code
  }
}
export const ERR = {
  DIV0: new FErr('#DIV/0!'),
  REF: new FErr('#REF!'),
  NAME: new FErr('#NAME?'),
  VALUE: new FErr('#VALUE!'),
  CIRC: new FErr('#CIRC!'),
  NUM: new FErr('#NUM!'),
}
export const isErr = (v) => v instanceof FErr

export const fmtNum = (n) => (Number.isFinite(n) ? String(Number(n.toPrecision(15))) : String(n))
export function displayValue(v) {
  if (v == null) return ''
  if (typeof v === 'number') return fmtNum(v)
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  return String(v)
}

class ParseError extends Error {}
class DeepError {
  constructor(r, c) {
    this.r = r
    this.c = c
  }
}

const NUM_TOK = /(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/y
const REF_TOK = /\$?[A-Za-z]{1,3}\$?\d+(?![A-Za-z0-9_.(])/y
const ID_TOK = /[A-Za-z_][A-Za-z0-9_.]*/y

// src excludes the leading '='. Tokens carry source offsets (s, e) so refs can be rewritten.
function tokenize(src) {
  const toks = []
  const n = src.length
  let i = 0
  while (i < n) {
    const ch = src[i]
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++
      continue
    }
    const s = i
    if (ch === '"') {
      let j = i + 1
      let out = ''
      for (;;) {
        if (j >= n) throw new ParseError('unterminated string')
        if (src[j] === '"') {
          if (src[j + 1] === '"') {
            out += '"'
            j += 2
            continue
          }
          j++
          break
        }
        out += src[j++]
      }
      toks.push({ t: 'str', v: out, s, e: j })
      i = j
      continue
    }
    if ((ch >= '0' && ch <= '9') || (ch === '.' && src[i + 1] >= '0' && src[i + 1] <= '9')) {
      NUM_TOK.lastIndex = i
      const m = NUM_TOK.exec(src)
      toks.push({ t: 'num', v: Number(m[0]), s, e: i + m[0].length })
      i += m[0].length
      continue
    }
    if (ch === '#' && src.startsWith('#REF!', i)) {
      toks.push({ t: 'referr', v: '#REF!', s, e: i + 5 })
      i += 5
      continue
    }
    if (/[A-Za-z_$]/.test(ch)) {
      REF_TOK.lastIndex = i
      let m = REF_TOK.exec(src)
      if (m) {
        toks.push({ t: 'ref', v: m[0], s, e: i + m[0].length })
        i += m[0].length
        continue
      }
      ID_TOK.lastIndex = i
      m = ID_TOK.exec(src)
      if (!m) throw new ParseError('bad token')
      toks.push({ t: 'id', v: m[0], s, e: i + m[0].length })
      i += m[0].length
      continue
    }
    const two = src.substr(i, 2)
    if (two === '<>' || two === '<=' || two === '>=') {
      toks.push({ t: 'op', v: two, s, e: i + 2 })
      i += 2
      continue
    }
    if ('+-*/^&%(),:;=<>'.includes(ch)) {
      toks.push({ t: 'op', v: ch, s, e: i + 1 })
      i++
      continue
    }
    throw new ParseError('unexpected ' + ch)
  }
  return toks
}

function parseFormulaTokens(toks) {
  let p = 0
  const peek = () => toks[p]
  const isOp = (v) => toks[p] && toks[p].t === 'op' && toks[p].v === v
  const expectOp = (v) => {
    if (!isOp(v)) throw new ParseError('expected ' + v)
    p++
  }
  function refNode(tok) {
    const a = parseAddr(tok.v)
    if (!a) return { k: 'err', e: ERR.REF }
    return { k: 'ref', r: a.r, c: a.c }
  }
  function primary() {
    const t = toks[p]
    if (!t) throw new ParseError('unexpected end')
    if (t.t === 'num') {
      p++
      return { k: 'lit', v: t.v }
    }
    if (t.t === 'str') {
      p++
      return { k: 'lit', v: t.v }
    }
    if (t.t === 'referr') {
      p++
      if (isOp(':')) {
        p++
        if (peek() && (peek().t === 'ref' || peek().t === 'referr')) p++
      }
      return { k: 'err', e: ERR.REF }
    }
    if (t.t === 'ref') {
      p++
      const a = refNode(t)
      if (isOp(':')) {
        p++
        const t2 = peek()
        if (!t2 || (t2.t !== 'ref' && t2.t !== 'referr')) throw new ParseError('bad range')
        p++
        const b = t2.t === 'ref' ? refNode(t2) : { k: 'err' }
        if (a.k === 'err' || b.k === 'err') return { k: 'err', e: ERR.REF }
        return { k: 'range', r0: Math.min(a.r, b.r), c0: Math.min(a.c, b.c), r1: Math.max(a.r, b.r), c1: Math.max(a.c, b.c) }
      }
      return a
    }
    if (t.t === 'id') {
      p++
      if (isOp('(')) {
        p++
        const args = []
        if (isOp(')')) {
          p++
        } else {
          for (;;) {
            if (isOp(',') || isOp(';') || isOp(')')) args.push({ k: 'empty' })
            else args.push(expr())
            if (isOp(',') || isOp(';')) {
              p++
              continue
            }
            expectOp(')')
            break
          }
        }
        return { k: 'fn', name: t.v.toUpperCase(), args }
      }
      const up = t.v.toUpperCase()
      if (up === 'TRUE') return { k: 'lit', v: true }
      if (up === 'FALSE') return { k: 'lit', v: false }
      return { k: 'err', e: ERR.NAME }
    }
    if (isOp('(')) {
      p++
      const e = expr()
      expectOp(')')
      return e
    }
    throw new ParseError('unexpected ' + t.v)
  }
  function postfix() {
    let e = primary()
    while (isOp('%')) {
      p++
      e = { k: 'pct', a: e }
    }
    return e
  }
  function unary() {
    if (isOp('-')) {
      p++
      return { k: 'neg', a: unary() }
    }
    if (isOp('+')) {
      p++
      return unary()
    }
    return postfix()
  }
  function binLevel(next, ops) {
    return () => {
      let l = next()
      while (toks[p] && toks[p].t === 'op' && ops.includes(toks[p].v)) {
        const op = toks[p++].v
        l = { k: 'bin', op, l, r: next() }
      }
      return l
    }
  }
  const pow = binLevel(unary, ['^'])
  const mul = binLevel(pow, ['*', '/'])
  const add = binLevel(mul, ['+', '-'])
  const cat = binLevel(add, ['&'])
  const expr = binLevel(cat, ['=', '<>', '<', '>', '<=', '>='])
  const ast = expr()
  if (p < toks.length) throw new ParseError('trailing input')
  return ast
}

const astCache = new Map()
function parseFormula(text) {
  let hit = astCache.get(text)
  if (hit) return hit
  try {
    hit = { ast: parseFormulaTokens(tokenize(text.slice(1))) }
  } catch (e) {
    if (!(e instanceof ParseError)) throw e
    hit = { error: ERR.VALUE }
  }
  if (astCache.size > 5000) astCache.clear()
  astCache.set(text, hit)
  return hit
}

function toNum(v) {
  if (v == null) return 0
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  if (isErr(v)) return v
  const n = parseNumber(v)
  return n === null ? ERR.VALUE : n
}
function toStr(v) {
  return v == null ? '' : displayValue(v)
}
function toBool(v) {
  if (v == null) return false
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  if (isErr(v)) return v
  const u = String(v).toUpperCase()
  if (u === 'TRUE') return true
  if (u === 'FALSE') return false
  return ERR.VALUE
}
function compareVals(a, b) {
  if (a == null) a = typeof b === 'string' ? '' : typeof b === 'boolean' ? false : 0
  if (b == null) b = typeof a === 'string' ? '' : typeof a === 'boolean' ? false : 0
  const rank = (x) => (typeof x === 'number' ? 0 : typeof x === 'string' ? 1 : 2)
  const ra = rank(a)
  const rb = rank(b)
  if (ra !== rb) return ra - rb
  if (ra === 1) {
    const x = a.toLowerCase()
    const y = b.toLowerCase()
    return x < y ? -1 : x > y ? 1 : 0
  }
  return a < b ? -1 : a > b ? 1 : 0
}
const finite = (n) => (Number.isFinite(n) ? n : ERR.NUM)

export class Evaluator {
  // getRaw(r,c) -> string|undefined. rowCount/colCount bound range iteration.
  constructor(getRaw, rowCount, colCount) {
    this.getRaw = getRaw
    this.rowCount = rowCount
    this.colCount = colCount
    this.memo = new Map()
    this.busy = new Set()
    this.depth = 0
  }

  // Computed value: number | string | boolean | null (empty) | FErr
  // Deep dependency chains are resolved with a trampoline so the JS stack never overflows.
  get(r, c) {
    const key = r * 20000 + c
    if (this.memo.has(key)) return this.memo.get(key)
    if (this.depth > 0) return this.compute(r, c, key)
    const stack = [[r, c]]
    const onStack = new Set([key])
    while (stack.length) {
      const [cr, cc] = stack[stack.length - 1]
      try {
        this.compute(cr, cc, cr * 20000 + cc)
        stack.pop()
        onStack.delete(cr * 20000 + cc)
      } catch (e) {
        if (!(e instanceof DeepError)) throw e
        const k = e.r * 20000 + e.c
        if (onStack.has(k)) this.memo.set(k, ERR.CIRC)
        else {
          stack.push([e.r, e.c])
          onStack.add(k)
        }
      }
    }
    return this.memo.get(key)
  }

  compute(r, c, key) {
    if (this.memo.has(key)) return this.memo.get(key)
    if (this.busy.has(key)) return ERR.CIRC
    const raw = this.getRaw(r, c)
    let out
    if (raw == null || raw === '') out = null
    else if (raw.charCodeAt(0) === 61 && raw.length > 1) {
      if (this.depth >= 250) throw new DeepError(r, c)
      this.busy.add(key)
      this.depth++
      try {
        const f = parseFormula(raw)
        out = f.error || this.scalar(this.node(f.ast))
      } catch (e) {
        if (e instanceof DeepError) throw e
        out = ERR.VALUE
      } finally {
        this.depth--
        this.busy.delete(key)
      }
    } else {
      const n = parseNumber(raw)
      out = n !== null ? n : raw
    }
    this.memo.set(key, out)
    return out
  }

  scalar(v) {
    if (v && v.range) {
      if (v.r0 === v.r1 && v.c0 === v.c1) return this.get(v.r0, v.c0)
      return ERR.VALUE
    }
    return v
  }

  // Visit the cells of a range value (clamped to the used area).
  eachCell(rng, fn) {
    const r1 = Math.min(rng.r1, this.rowCount - 1)
    const c1 = Math.min(rng.c1, this.colCount - 1)
    for (let r = rng.r0; r <= r1; r++) for (let c = rng.c0; c <= c1; c++) fn(this.get(r, c))
  }

  node(n) {
    switch (n.k) {
      case 'lit':
        return n.v
      case 'empty':
        return null
      case 'err':
        return n.e
      case 'ref':
        return this.get(n.r, n.c)
      case 'range':
        return { range: true, r0: n.r0, c0: n.c0, r1: n.r1, c1: n.c1 }
      case 'neg': {
        const a = toNum(this.scalar(this.node(n.a)))
        return isErr(a) ? a : -a
      }
      case 'pct': {
        const a = toNum(this.scalar(this.node(n.a)))
        return isErr(a) ? a : a / 100
      }
      case 'bin':
        return this.binary(n)
      case 'fn':
        return this.call(n)
    }
    return ERR.VALUE
  }

  binary(n) {
    const a = this.scalar(this.node(n.l))
    if (isErr(a)) return a
    const b = this.scalar(this.node(n.r))
    if (isErr(b)) return b
    const op = n.op
    if (op === '&') return toStr(a) + toStr(b)
    if (op === '=' || op === '<>' || op === '<' || op === '>' || op === '<=' || op === '>=') {
      const c = compareVals(a, b)
      return op === '=' ? c === 0 : op === '<>' ? c !== 0 : op === '<' ? c < 0 : op === '>' ? c > 0 : op === '<=' ? c <= 0 : c >= 0
    }
    const x = toNum(a)
    if (isErr(x)) return x
    const y = toNum(b)
    if (isErr(y)) return y
    if (op === '+') return finite(x + y)
    if (op === '-') return finite(x - y)
    if (op === '*') return finite(x * y)
    if (op === '/') return y === 0 ? ERR.DIV0 : finite(x / y)
    if (op === '^') return finite(Math.pow(x, y))
    return ERR.VALUE
  }

  call(n) {
    const fn = FUNCS[n.name]
    if (!fn) return ERR.NAME
    if (fn.lazy) return fn.run(this, n.args)
    const args = []
    for (const a of n.args) {
      const v = this.node(a)
      if (isErr(v)) return v
      args.push(v)
    }
    return fn.run(this, args)
  }

  // Numbers from a mix of ranges and scalars (SUM/AVERAGE/MIN/MAX/COUNT semantics). Returns array or FErr.
  numbers(args, forCount) {
    const out = []
    let err = null
    for (const a of args) {
      if (a && a.range) {
        this.eachCell(a, (v) => {
          if (err) return
          if (isErr(v)) err = v
          else if (typeof v === 'number') out.push(v)
        })
        if (err) return err
      } else {
        if (a == null) continue
        if (typeof a === 'string' && parseNumber(a) === null) {
          if (forCount) continue
          return ERR.VALUE
        }
        const v = toNum(a)
        if (isErr(v)) return v
        out.push(v)
      }
    }
    return out
  }

  // Flatten args to scalars (for CONCAT and COUNTA).
  flat(args) {
    const out = []
    for (const a of args) {
      if (a && a.range) this.eachCell(a, (v) => out.push(v))
      else out.push(a)
    }
    return out
  }
}

const arity = (args, min, max) => args.length >= min && args.length <= max
function num1(ev, args, f, min = 1, max = 1) {
  if (!arity(args, min, max)) return ERR.VALUE
  const a = toNum(ev.scalar(args[0]))
  if (isErr(a)) return a
  let b = 0
  if (args.length > 1) {
    b = toNum(ev.scalar(args[1]))
    if (isErr(b)) return b
  }
  return f(a, b)
}
function text1(ev, args, f, min = 1, max = 1) {
  if (!arity(args, min, max)) return ERR.VALUE
  const s = ev.scalar(args[0])
  if (isErr(s)) return s
  let n = 1
  if (args.length > 1) {
    n = toNum(ev.scalar(args[1]))
    if (isErr(n)) return n
    if (n < 0) return ERR.VALUE
  }
  return f(toStr(s), Math.floor(n))
}
const pad = (n) => String(n).padStart(2, '0')

const FUNCS = {
  SUM: { run: (ev, a) => { const n = ev.numbers(a); return isErr(n) ? n : finite(n.reduce((x, y) => x + y, 0)) } },
  AVERAGE: { run: (ev, a) => { const n = ev.numbers(a); return isErr(n) ? n : n.length ? finite(n.reduce((x, y) => x + y, 0) / n.length) : ERR.DIV0 } },
  MIN: { run: (ev, a) => { const n = ev.numbers(a); return isErr(n) ? n : n.length ? n.reduce((x, y) => (y < x ? y : x)) : 0 } },
  MAX: { run: (ev, a) => { const n = ev.numbers(a); return isErr(n) ? n : n.length ? n.reduce((x, y) => (y > x ? y : x)) : 0 } },
  COUNT: { run: (ev, a) => { const n = ev.numbers(a, true); return isErr(n) ? n : n.length } },
  COUNTA: { run: (ev, a) => ev.flat(a).filter((v) => v != null).length },
  IF: {
    lazy: true,
    run(ev, args) {
      if (!arity(args, 2, 3)) return ERR.VALUE
      const c = toBool(ev.scalar(ev.node(args[0])))
      if (isErr(c)) return c
      if (c) return ev.scalar(ev.node(args[1]))
      return args.length > 2 ? ev.scalar(ev.node(args[2])) : false
    },
  },
  IFERROR: {
    lazy: true,
    run(ev, args) {
      if (args.length !== 2) return ERR.VALUE
      const v = ev.scalar(ev.node(args[0]))
      return isErr(v) ? ev.scalar(ev.node(args[1])) : v
    },
  },
  ROUND: {
    run: (ev, args) =>
      num1(ev, args, (x, d) => {
        const f = Math.pow(10, Math.trunc(d))
        return finite((Math.sign(x) * Math.round(Number((Math.abs(x) * f).toPrecision(15)))) / f)
      }, 1, 2),
  },
  ABS: { run: (ev, a) => num1(ev, a, (x) => Math.abs(x)) },
  SQRT: { run: (ev, a) => num1(ev, a, (x) => (x < 0 ? ERR.NUM : Math.sqrt(x))) },
  POWER: { run: (ev, a) => (a.length !== 2 ? ERR.VALUE : num1(ev, a, (x, y) => finite(Math.pow(x, y)), 2, 2)) },
  MOD: {
    run: (ev, a) =>
      a.length !== 2 ? ERR.VALUE : num1(ev, a, (x, y) => (y === 0 ? ERR.DIV0 : finite(x - y * Math.floor(x / y))), 2, 2),
  },
  CONCAT: { run: (ev, a) => ev.flat(a).map(toStr).join('') },
  LEN: { run: (ev, a) => text1(ev, a, (s) => s.length) },
  UPPER: { run: (ev, a) => text1(ev, a, (s) => s.toUpperCase()) },
  LOWER: { run: (ev, a) => text1(ev, a, (s) => s.toLowerCase()) },
  TRIM: { run: (ev, a) => text1(ev, a, (s) => s.trim().replace(/ {2,}/g, ' ')) },
  LEFT: { run: (ev, a) => text1(ev, a, (s, n) => s.slice(0, n), 1, 2) },
  RIGHT: { run: (ev, a) => text1(ev, a, (s, n) => (n === 0 ? '' : s.slice(-n)), 1, 2) },
  NOW: {
    run(ev, a) {
      const d = new Date()
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    },
  },
  TODAY: {
    run() {
      const d = new Date()
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    },
  },
}
export const FUNCTION_NAMES = Object.keys(FUNCS)

// Evaluate a standalone grid (handy for tests): rows is string[][].
export function evaluateGrid(rows) {
  const w = rows.reduce((m, r) => Math.max(m, r.length), 0)
  const ev = new Evaluator((r, c) => rows[r] && rows[r][c], rows.length, w)
  return (r, c) => ev.get(r, c)
}

// ---------------------------------------------------------------- formula rewriting
// Rewrite refs after row/col insert/delete. axis: 'row'|'col', kind: 'insert'|'delete'.
export function adjustFormula(f, axis, kind, index, count) {
  if (typeof f !== 'string' || f.charCodeAt(0) !== 61) return f
  let toks
  try {
    toks = tokenize(f.slice(1))
  } catch {
    return f
  }
  const key = axis === 'row' ? 'r' : 'c'
  const one = (v) => {
    if (kind === 'delete') return v >= index + count ? v - count : v >= index ? null : v
    return v >= index ? v + count : v
  }
  const reps = []
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]
    if (t.t !== 'ref') continue
    const a = parseAddr(t.v)
    if (!a) continue
    const nx = toks[i + 1]
    const t2 = toks[i + 2]
    if (nx && nx.t === 'op' && nx.v === ':' && t2 && t2.t === 'ref') {
      const b = parseAddr(t2.v)
      if (b) {
        // range: normalise ends along the axis
        let lo = a
        let hi = b
        if (lo[key] > hi[key]) [lo, hi] = [hi, lo]
        let s
        let e
        if (kind === 'delete') {
          if (lo[key] >= index && hi[key] < index + count) {
            reps.push([t.s, t2.e, '#REF!'])
            i += 2
            continue
          }
          s = lo[key] < index ? lo[key] : lo[key] < index + count ? index : lo[key] - count
          e = hi[key] < index ? hi[key] : hi[key] < index + count ? index - 1 : hi[key] - count
        } else {
          s = one(lo[key])
          e = one(hi[key])
        }
        const p1 = { ...lo, [key]: s }
        const p2 = { ...hi, [key]: e }
        reps.push([t.s, t2.e, fmtRef(p1) + ':' + fmtRef(p2)])
        i += 2
        continue
      }
    }
    const nv = one(a[key])
    reps.push([t.s, t.e, nv === null ? '#REF!' : fmtRef({ ...a, [key]: nv })])
  }
  return applyReps(f, reps)
}

// Shift relative refs by (dr, dc), as when copying or filling a formula.
export function shiftFormula(f, dr, dc) {
  if (typeof f !== 'string' || f.charCodeAt(0) !== 61 || (!dr && !dc)) return f
  let toks
  try {
    toks = tokenize(f.slice(1))
  } catch {
    return f
  }
  const reps = []
  for (const t of toks) {
    if (t.t !== 'ref') continue
    const a = parseAddr(t.v)
    if (!a) continue
    const r = a.absR ? a.r : a.r + dr
    const c = a.absC ? a.c : a.c + dc
    reps.push([t.s, t.e, r < 0 || c < 0 ? '#REF!' : fmtRef({ ...a, r, c })])
  }
  return applyReps(f, reps)
}

function applyReps(f, reps) {
  if (!reps.length) return f
  let out = ''
  let pos = 1
  for (const [s, e, txt] of reps) {
    out += f.slice(pos, s + 1) + txt
    pos = e + 1
  }
  return '=' + out + f.slice(pos)
}

// ---------------------------------------------------------------- sorting / stats / header
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

// Permutation (new index -> old index) sorting rows [from, rows) by getVal(row). Empties always last, stable.
export function sortPerm(count, from, dir, getVal) {
  const perm = Array.from({ length: count }, (_, i) => i)
  const idx = []
  for (let i = from; i < count; i++) {
    const v = getVal(i)
    const empty = v == null || v === ''
    const t = empty ? 3 : isErr(v) ? 2 : typeof v === 'number' ? 0 : typeof v === 'boolean' ? 0.5 : 1
    idx.push({ i, v: isErr(v) ? v.code : v, t })
  }
  const sign = dir === 'desc' ? -1 : 1
  idx.sort((a, b) => {
    if (a.t === 3 || b.t === 3) return a.t === b.t ? a.i - b.i : a.t === 3 ? 1 : -1
    let d
    if (a.t !== b.t) d = a.t - b.t
    else if (a.t === 0) d = a.v - b.v
    else if (a.t === 0.5) d = (a.v ? 1 : 0) - (b.v ? 1 : 0)
    else d = collator.compare(String(a.v), String(b.v))
    return d ? d * sign : a.i - b.i
  })
  for (let k = 0; k < idx.length; k++) perm[from + k] = idx[k].i
  return perm
}

// Stats over computed values: count of non-empty, and sum/avg/min/max of numeric ones.
export function computeStats(values) {
  const s = { count: 0, numCount: 0, sum: 0, avg: null, min: null, max: null }
  for (const v of values) {
    if (v == null || v === '') continue
    s.count++
    if (typeof v === 'number' && Number.isFinite(v)) {
      s.numCount++
      s.sum += v
      if (s.min === null || v < s.min) s.min = v
      if (s.max === null || v > s.max) s.max = v
    }
  }
  if (s.numCount) s.avg = s.sum / s.numCount
  return s
}

// Likely header: first row mostly text and filled in, later rows numeric somewhere (or all-text unique labels).
export function detectHeader(rows) {
  if (rows.length < 2) return false
  const first = rows[0]
  if (!first.length) return false
  let nonEmpty = 0
  let textual = 0
  const seen = new Set()
  for (const v of first) {
    if (v === '') continue
    nonEmpty++
    seen.add(v)
    if (parseNumber(v) === null) textual++
  }
  if (!nonEmpty || nonEmpty < first.length * 0.5 || textual < nonEmpty * 0.8) return false
  const lim = Math.min(rows.length, 51)
  for (let c = 0; c < first.length; c++) {
    let filled = 0
    let nums = 0
    for (let r = 1; r < lim; r++) {
      const v = rows[r][c]
      if (v == null || v === '') continue
      filled++
      if (parseNumber(v) !== null) nums++
    }
    if (filled && nums >= filled * 0.8 && first[c] !== '' && parseNumber(first[c]) === null) return true
  }
  return first.length >= 2 && seen.size === nonEmpty
}

// ---------------------------------------------------------------- display formats (display only)
export function formatDisplay(value, fmt, locale = 'en-US') {
  const plain = displayValue(value)
  if (!fmt || fmt.type === 'general' || value == null || isErr(value)) return plain
  if (fmt.type === 'date') {
    if (typeof value === 'number') {
      const d = new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86400000)
      return Number.isNaN(d.getTime()) ? plain : d.toISOString().slice(0, 10)
    }
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(value))
    return m ? m[1] : plain
  }
  const n = typeof value === 'number' ? value : parseNumber(value)
  if (n === null) return plain
  const dec = fmt.decimals == null ? (fmt.type === 'percent' ? 0 : 2) : fmt.decimals
  const o = { minimumFractionDigits: dec, maximumFractionDigits: dec }
  if (fmt.type === 'number') return n.toLocaleString(locale, o)
  if (fmt.type === 'percent') return (n * 100).toLocaleString(locale, o) + '%'
  if (fmt.type === 'currency') {
    const neg = n < 0
    return (neg ? '-' : '') + (fmt.symbol || '$') + Math.abs(n).toLocaleString(locale, o)
  }
  return plain
}

// ---------------------------------------------------------------- history primitives
// A primitive is a self-describing patch with an exact inverse.
function applyPrim(sh, p) {
  switch (p.t) {
    case 'cells': {
      for (const [r, c, , nw] of p.ch) {
        const row = sh.rows[r]
        if (nw === '' && c >= row.length) continue
        while (row.length < c) row.push('')
        row[c] = nw
      }
      sh.ncols = p.n1
      if (p.l1) {
        for (const [r, len] of p.l1) {
          const row = sh.rows[r]
          if (row.length > len) row.length = len
          while (row.length < len) row.push('')
        }
      }
      break
    }
    case 'rows': {
      const rows = sh.rows
      if (p.ins.length + p.del.length > 500) sh.rows = rows.slice(0, p.at).concat(p.ins, rows.slice(p.at + p.del.length))
      else rows.splice(p.at, p.del.length, ...p.ins)
      break
    }
    case 'cols': {
      const rows = sh.rows
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        const d = p.del[i]
        const ins = p.ins[i]
        if (d.length + ins.length === 0) continue
        if (row.length < p.at) {
          if (!ins.length) continue
          while (row.length < p.at) row.push('')
        }
        row.splice(p.at, d.length, ...ins)
      }
      sh.ncols = Math.max(1, sh.ncols + p.dn)
      break
    }
    case 'order': {
      const old = sh.rows
      sh.rows = p.perm.map((i) => old[i])
      break
    }
    case 'meta':
      sh.delimiter = p.b
      break
  }
}
function invertPrim(p) {
  switch (p.t) {
    case 'cells':
      return { t: 'cells', ch: p.ch.map(([r, c, a, b]) => [r, c, b, a]), n0: p.n1, n1: p.n0, l0: p.l1, l1: p.l0 }
    case 'rows':
      return { t: 'rows', at: p.at, del: p.ins, ins: p.del }
    case 'cols':
      return { t: 'cols', at: p.at, del: p.ins, ins: p.del, dn: -p.dn }
    case 'order': {
      const inv = new Array(p.perm.length)
      for (let i = 0; i < p.perm.length; i++) inv[p.perm[i]] = i
      return { t: 'order', perm: inv }
    }
    case 'meta':
      return { t: 'meta', a: p.b, b: p.a }
  }
  return p
}

// ---------------------------------------------------------------- Sheet model
export class Sheet {
  constructor({ rows, delimiter = ',', eol = '\n', bom = false, trailingEol = false }) {
    this.rows = rows.length ? rows : [['']]
    this.delimiter = delimiter
    this.eol = eol
    this.bom = bom
    this.trailingEol = trailingEol
    this.ncols = Math.max(1, ...this.rows.map((r) => r.length))
    this.baseRows = this.rows.length
    this.baseCols = this.ncols
    this.undoStack = []
    this.redoStack = []
    this.version = 0
    this.dropped = 0
    this._ev = null
    this._text = null
    this._textVersion = -1
  }

  // delimiter omitted -> auto-detect.
  static fromText(text, delimiter) {
    const d = delimiter || detectDelimiter(text)
    const p = parseCsv(text, d)
    return new Sheet({ ...p, delimiter: d })
  }

  get rowCount() {
    return this.rows.length
  }
  raw(r, c) {
    const row = this.rows[r]
    return (row && row[c]) || ''
  }
  _evaluator() {
    if (!this._ev) this._ev = new Evaluator((r, c) => (this.rows[r] ? this.rows[r][c] : undefined), this.rows.length, this.ncols)
    return this._ev
  }
  value(r, c) {
    return this._evaluator().get(r, c)
  }
  display(r, c) {
    return displayValue(this.value(r, c))
  }
  isFormula(r, c) {
    const v = this.raw(r, c)
    return v.length > 1 && v.charCodeAt(0) === 61
  }

  // Rows/columns added past the original extent (by editing in the empty grid) are saved
  // without trailing empty rows or cells, so padding never leaks into the file.
  _trimmed() {
    let rows = this.rows
    let end = rows.length
    while (end > this.baseRows && end > 1 && rows[end - 1].every((v) => v === '')) end--
    if (end < rows.length) rows = rows.slice(0, end)
    if (this.ncols > this.baseCols) {
      rows = rows.map((row) => {
        let w = row.length
        while (w > this.baseCols && row[w - 1] === '') w--
        return w < row.length ? row.slice(0, w) : row
      })
    }
    return rows
  }

  serialize() {
    if (this._textVersion !== this.version) {
      this._text = serializeCsv(this._trimmed(), this)
      this._textVersion = this.version
    }
    return this._text
  }

  // --- history
  _apply(p) {
    applyPrim(this, p)
    return p
  }
  _push(prims, label) {
    this.undoStack.push({ label, prims })
    if (this.undoStack.length > MAX_HISTORY) {
      this.undoStack.shift()
      this.dropped++
    }
    this.redoStack = []
    this._touch()
  }
  _touch() {
    this.version++
    this._ev = null
  }
  // True while the content equals what was opened (all edits undone, none dropped from history).
  get isPristine() {
    return this.undoStack.length === 0 && this.dropped === 0
  }
  get canUndo() {
    return this.undoStack.length > 0
  }
  get canRedo() {
    return this.redoStack.length > 0
  }
  undo() {
    const e = this.undoStack.pop()
    if (!e) return false
    for (let i = e.prims.length - 1; i >= 0; i--) applyPrim(this, invertPrim(e.prims[i]))
    this.redoStack.push(e)
    this._touch()
    return true
  }
  redo() {
    const e = this.redoStack.pop()
    if (!e) return false
    for (const p of e.prims) applyPrim(this, p)
    this.undoStack.push(e)
    this._touch()
    return true
  }

  _blankRow() {
    return new Array(this.ncols).fill('')
  }

  // Ensure rows exist up to index r (as prims pushed onto list).
  _growRows(upTo, prims) {
    if (upTo < this.rows.length) return
    const ins = []
    for (let i = this.rows.length; i <= upTo; i++) ins.push(this._blankRow())
    prims.push(this._apply({ t: 'rows', at: this.rows.length, del: [], ins }))
  }

  // changes: [[r, c, newValue]] -> one undo step. Rows/cols grow as needed.
  setCells(changes, label = 'Edit') {
    const prims = []
    let maxR = -1
    let maxC = -1
    for (const [r, c, v] of changes) {
      if (r > maxR) maxR = r
      if (c > maxC && v !== '') maxC = c
    }
    this._growRows(maxR, prims)
    const ch = []
    for (const [r, c, v] of changes) {
      const old = this.rows[r][c] === undefined ? '' : this.rows[r][c]
      const nw = v == null ? '' : String(v)
      if (old !== nw) ch.push([r, c, old, nw])
    }
    if (!ch.length && !prims.length) return false
    const lens = new Map()
    for (const [r] of ch) if (!lens.has(r)) lens.set(r, this.rows[r].length)
    const prim = this._apply({ t: 'cells', ch, n0: this.ncols, n1: Math.max(this.ncols, maxC + 1) })
    prim.l0 = [...lens]
    prim.l1 = [...lens.keys()].map((r) => [r, this.rows[r].length])
    prims.push(prim)
    this._push(prims, label)
    return true
  }
  setCell(r, c, v) {
    return this.setCells([[r, c, v]])
  }
  clearRange(r0, c0, r1, c1) {
    const ch = []
    for (let r = r0; r <= Math.min(r1, this.rows.length - 1); r++)
      for (let c = c0; c <= c1; c++) if (this.raw(r, c) !== '') ch.push([r, c, ''])
    return this.setCells(ch, 'Clear')
  }

  // Paste a matrix of raw strings at (r0, c0); grows the grid. Returns the pasted extent.
  pasteBlock(r0, c0, matrix, label = 'Paste') {
    const ch = []
    let w = 0
    matrix.forEach((row, i) => {
      w = Math.max(w, row.length)
      row.forEach((v, j) => ch.push([r0 + i, c0 + j, v]))
    })
    const changed = this.setCells(ch, label)
    return { changed, r1: r0 + matrix.length - 1, c1: c0 + w - 1 }
  }

  // Copy the first row (or the row above a single-row selection) down the selection.
  fillDown(r0, c0, r1, c1) {
    let src = r0
    let from = r0 + 1
    if (r0 === r1) {
      if (r0 === 0) return false
      src = r0 - 1
      from = r0
    }
    const ch = []
    for (let c = c0; c <= c1; c++) {
      const v = this.raw(src, c)
      for (let r = from; r <= r1; r++) ch.push([r, c, shiftFormula(v, r - src, 0)])
    }
    return this.setCells(ch, 'Fill down')
  }
  fillRight(r0, c0, r1, c1) {
    let src = c0
    let from = c0 + 1
    if (c0 === c1) {
      if (c0 === 0) return false
      src = c0 - 1
      from = c0
    }
    const ch = []
    for (let r = r0; r <= r1; r++) {
      const v = this.raw(r, src)
      for (let c = from; c <= c1; c++) ch.push([r, c, shiftFormula(v, 0, c - src)])
    }
    return this.setCells(ch, 'Fill right')
  }

  // Formula text changes needed after a structural edit (already applied to rows).
  _formulaFixes(axis, kind, index, count) {
    const ch = []
    for (let r = 0; r < this.rows.length; r++) {
      const row = this.rows[r]
      for (let c = 0; c < row.length; c++) {
        const v = row[c]
        if (v.length > 1 && v.charCodeAt(0) === 61) {
          const nv = adjustFormula(v, axis, kind, index, count)
          if (nv !== v) ch.push([r, c, v, nv])
        }
      }
    }
    return ch
  }
  _structural(prim, axis, kind, index, count, label) {
    const prims = [this._apply(prim)]
    const fixes = this._formulaFixes(axis, kind, index, count)
    if (fixes.length) prims.push(this._apply({ t: 'cells', ch: fixes, n0: this.ncols, n1: this.ncols }))
    this._push(prims, label)
    return true
  }

  insertRows(at, count = 1) {
    at = Math.max(0, Math.min(at, this.rows.length))
    const ins = []
    for (let i = 0; i < count; i++) ins.push(this._blankRow())
    return this._structural({ t: 'rows', at, del: [], ins }, 'row', 'insert', at, count, 'Insert rows')
  }
  deleteRows(at, count = 1) {
    if (at >= this.rows.length) return false
    count = Math.min(count, this.rows.length - at)
    const del = this.rows.slice(at, at + count)
    const ins = count >= this.rows.length ? [this._blankRow()] : []
    return this._structural({ t: 'rows', at, del, ins }, 'row', 'delete', at, count, 'Delete rows')
  }
  insertCols(at, count = 1) {
    at = Math.max(0, Math.min(at, this.ncols))
    const ins = this.rows.map((row) => (row.length > at ? new Array(count).fill('') : []))
    const del = this.rows.map(() => [])
    return this._structural({ t: 'cols', at, del, ins, dn: count }, 'col', 'insert', at, count, 'Insert columns')
  }
  deleteCols(at, count = 1) {
    if (at >= this.ncols) return false
    count = Math.min(count, this.ncols - at)
    const del = this.rows.map((row) => row.slice(at, at + count))
    const all = count >= this.ncols
    const ins = this.rows.map(() => (all ? [''] : []))
    return this._structural({ t: 'cols', at, del, ins, dn: all ? 1 - count : -count }, 'col', 'delete', at, count, 'Delete columns')
  }

  // Sort data rows [from, end) by a column of computed values. Header rows (< from) never move.
  sortBy(col, dir = 'asc', from = 0) {
    const perm = sortPerm(this.rows.length, from, dir, (r) => this.value(r, col))
    if (perm.every((v, i) => v === i)) return false
    this._push([this._apply({ t: 'order', perm })], dir === 'desc' ? 'Sort Z-A' : 'Sort A-Z')
    return true
  }

  setDelimiter(d) {
    if (d === this.delimiter) return false
    this._push([this._apply({ t: 'meta', a: this.delimiter, b: d })], 'Delimiter')
    return true
  }
}
