import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  colToLetters, lettersToCol, addr, parseAddr, parseRange,
  parseCsv, serializeCsv, detectDelimiter, parseNumber, evaluateGrid, displayValue, ERR,
  adjustFormula, shiftFormula, sortPerm, computeStats, detectHeader, formatDisplay, Sheet, MAX_HISTORY,
} from '../src/modules/sheet-core.js'

const rt = (text, d = ',') => {
  const p = parseCsv(text, d)
  return serializeCsv(p.rows, { delimiter: d, ...p })
}

// ---------------------------------------------------------------- parse / serialize
test('simple parse', () => {
  assert.deepEqual(parseCsv('a,b,c\n1,2,3').rows, [['a', 'b', 'c'], ['1', '2', '3']])
})
test('quotes, escaped quotes, embedded delimiter and newline', () => {
  const t = 'a,"b,c","say ""hi""","line1\nline2"\n1,2,3,4'
  const p = parseCsv(t)
  assert.deepEqual(p.rows[0], ['a', 'b,c', 'say "hi"', 'line1\nline2'])
  assert.equal(rt(t), t)
})
test('round trip keeps CRLF, BOM and trailing newline state', () => {
  const t = '﻿a,b\r\n1,2\r\n'
  const p = parseCsv(t)
  assert.equal(p.bom, true)
  assert.equal(p.eol, '\r\n')
  assert.equal(p.trailingEol, true)
  assert.equal(rt(t), t)
  const noTrail = 'a,b\n1,2'
  assert.equal(parseCsv(noTrail).trailingEol, false)
  assert.equal(rt(noTrail), noTrail)
})
test('ragged rows survive', () => {
  const t = 'a,b,c\n1\n1,2,3,4,5\n'
  assert.deepEqual(parseCsv(t).rows.map((r) => r.length), [3, 1, 5])
  assert.equal(rt(t), t)
})
test('empty fields, blank lines and trailing delimiter', () => {
  const t = 'a,,c\n\n,,\nx,y,'
  assert.deepEqual(parseCsv(t).rows, [['a', '', 'c'], [''], ['', '', ''], ['x', 'y', '']])
  assert.equal(rt(t), t)
})
test('empty text gives one empty cell and serialises back to empty', () => {
  assert.deepEqual(parseCsv('').rows, [['']])
  assert.equal(rt(''), '')
})
test('semicolon CSV and TSV', () => {
  assert.equal(rt('a;b\n"x;y";2', ';'), 'a;b\n"x;y";2')
  const tsv = 'a\tb\n"x\ty"\t2\n'
  assert.deepEqual(parseCsv(tsv, '\t').rows[1], ['x\ty', '2'])
  assert.equal(rt(tsv, '\t'), tsv)
  assert.equal(rt('p|q\n1|"a|b"', '|'), 'p|q\n1|"a|b"')
})
test('serialize quotes only when needed', () => {
  assert.equal(serializeCsv([['a b', 'c,d', 'e"f', 'g\nh', '']], {}), 'a b,"c,d","e""f","g\nh",')
})
test('lone CR line endings', () => {
  const p = parseCsv('a,b\r1,2\r')
  assert.deepEqual(p.rows, [['a', 'b'], ['1', '2']])
  assert.equal(p.eol, '\r')
})
test('unterminated quote does not hang', () => {
  assert.deepEqual(parseCsv('a,"b\nc').rows, [['a', 'b\nc']])
})

// ---------------------------------------------------------------- delimiter
test('detect delimiter', () => {
  assert.equal(detectDelimiter('a,b,c\n1,2,3\n4,5,6'), ',')
  assert.equal(detectDelimiter('a;b;c\n1;2;3\n4,5;6'), ';')
  assert.equal(detectDelimiter('a\tb\tc\n1\t2\t3'), '\t')
  assert.equal(detectDelimiter('a|b\n1|2\n3|4'), '|')
  assert.equal(detectDelimiter('a;b\n1,5;2\n2,5;3'), ';')
  assert.equal(detectDelimiter('just words'), ',')
  assert.equal(detectDelimiter('"a;b",c\n"d;e",f'), ',')
})
test('switching delimiter re-serialises', () => {
  const s = Sheet.fromText('a,b\n"x,y",2\n')
  s.setDelimiter('\t')
  assert.equal(s.serialize(), 'a\tb\nx,y\t2\n')
  s.setDelimiter(';')
  assert.equal(s.serialize(), 'a;b\nx,y;2\n')
  s.undo()
  assert.equal(s.delimiter, '\t')
})

// ---------------------------------------------------------------- addresses
test('column letters', () => {
  assert.equal(colToLetters(0), 'A')
  assert.equal(colToLetters(25), 'Z')
  assert.equal(colToLetters(26), 'AA')
  assert.equal(colToLetters(51), 'AZ')
  assert.equal(colToLetters(52), 'BA')
  assert.equal(colToLetters(701), 'ZZ')
  assert.equal(colToLetters(702), 'AAA')
  for (const c of [0, 5, 25, 26, 100, 701, 702, 16383]) assert.equal(lettersToCol(colToLetters(c)), c)
})
test('A1 addresses and ranges', () => {
  assert.equal(addr(0, 0), 'A1')
  assert.equal(addr(9, 27), 'AB10')
  assert.deepEqual(parseAddr('B3'), { r: 2, c: 1, absC: false, absR: false })
  assert.deepEqual(parseAddr('$C$4'), { r: 3, c: 2, absC: true, absR: true })
  assert.equal(parseAddr('A0'), null)
  assert.equal(parseAddr('hello'), null)
  assert.deepEqual(parseRange('B2:A1'), { r0: 0, c0: 0, r1: 1, c1: 1 })
})

// ---------------------------------------------------------------- numbers
test('number detection', () => {
  assert.equal(parseNumber('42'), 42)
  assert.equal(parseNumber(' -3.5 '), -3.5)
  assert.equal(parseNumber('1e3'), 1000)
  assert.equal(parseNumber('1,234.5'), 1234.5)
  assert.equal(parseNumber('1,234,567'), 1234567)
  assert.equal(parseNumber('1,234'), null) // ambiguous (decimal comma?)
  assert.equal(parseNumber('1,23'), null)
  assert.equal(parseNumber('12,34.5'), null)
  assert.equal(parseNumber('abc'), null)
  assert.equal(parseNumber(''), null)
  assert.equal(parseNumber('1.2.3'), null)
})

// ---------------------------------------------------------------- formulas
const g = (rows) => evaluateGrid(rows)
const f = (formula, rows = []) => g([[formula], ...rows.map((r) => r)])(0, 0)

test('arithmetic, precedence, unary, percent, power', () => {
  assert.equal(f('=1+2*3'), 7)
  assert.equal(f('=(1+2)*3'), 9)
  assert.equal(f('=-2^2'), 4) // Excel: unary minus binds tighter than ^
  assert.equal(f('=2^3^2'), 64) // left associative
  assert.equal(f('=50%'), 0.5)
  assert.equal(f('=10-4-3'), 3)
  assert.equal(f('=7/2'), 3.5)
  assert.equal(f('=0.1+0.2'), 0.30000000000000004)
  assert.equal(displayValue(f('=0.1+0.2')), '0.3')
  assert.equal(f('=2*-3'), -6)
})
test('cell refs and ranges', () => {
  const v = g([['3', '4', '=A1+B1'], ['10', '', '=SUM(A1:B2)'], ['x', '5', '=$A$1*2']])
  assert.equal(v(0, 2), 7)
  assert.equal(v(1, 2), 17)
  assert.equal(v(2, 2), 6)
})
test('strings, concat, comparisons', () => {
  assert.equal(f('="a"&"b"'), 'ab')
  assert.equal(f('="x"&1+1'), 'x2')
  assert.equal(f('="say ""hi"""'), 'say "hi"')
  assert.equal(f('=1<2'), true)
  assert.equal(f('=2<=1'), false)
  assert.equal(f('=3<>4'), true)
  assert.equal(f('="a"="A"'), true)
  assert.equal(f('=1="1"'), false)
})
test('SUM AVERAGE MIN MAX COUNT COUNTA', () => {
  const rows = [['1'], ['2'], ['x'], [''], ['4']]
  const run = (fn) => g([[`=${fn}(A2:A6)`], ...rows])(0, 0)
  assert.equal(run('SUM'), 7)
  assert.equal(run('AVERAGE'), 7 / 3)
  assert.equal(run('MIN'), 1)
  assert.equal(run('MAX'), 4)
  assert.equal(run('COUNT'), 3)
  assert.equal(run('COUNTA'), 4)
  assert.equal(f('=SUM(1,2,"3")'), 6)
  assert.equal(f('=SUM(1,"x")'), ERR.VALUE)
  assert.equal(f('=MIN(A2:A3)'), 0)
  assert.equal(f('=AVERAGE(A2:A3)'), ERR.DIV0)
})
test('IF and IFERROR are lazy', () => {
  assert.equal(f('=IF(1>0,"y","n")'), 'y')
  assert.equal(f('=IF(0,1/0,"ok")'), 'ok')
  assert.equal(f('=IF(0,1)'), false)
  assert.equal(f('=IFERROR(1/0,"bad")'), 'bad')
  assert.equal(f('=IFERROR(5,1/0)'), 5)
  assert.equal(f('=IF("maybe",1,2)'), ERR.VALUE)
})
test('ROUND ABS SQRT POWER MOD', () => {
  assert.equal(f('=ROUND(2.675,2)'), 2.68)
  assert.equal(f('=ROUND(-2.5)'), -3)
  assert.equal(f('=ROUND(1234.5,-2)'), 1200)
  assert.equal(f('=ABS(-4)'), 4)
  assert.equal(f('=SQRT(16)'), 4)
  assert.equal(f('=SQRT(-1)'), ERR.NUM)
  assert.equal(f('=POWER(2,10)'), 1024)
  assert.equal(f('=MOD(10,3)'), 1)
  assert.equal(f('=MOD(-1,3)'), 2)
  assert.equal(f('=MOD(5,0)'), ERR.DIV0)
})
test('text functions', () => {
  assert.equal(f('=CONCAT("a",1,TRUE)'), 'a1TRUE')
  assert.equal(g([['=CONCAT(B1:C1)', 'x', 'y']])(0, 0), 'xy')
  assert.equal(f('=LEN("hello")'), 5)
  assert.equal(f('=UPPER("abc")'), 'ABC')
  assert.equal(f('=LOWER("ABC")'), 'abc')
  assert.equal(f('=TRIM("  a   b  ")'), 'a b')
  assert.equal(f('=LEFT("hello",2)'), 'he')
  assert.equal(f('=LEFT("hello")'), 'h')
  assert.equal(f('=RIGHT("hello",3)'), 'llo')
  assert.equal(f('=RIGHT("hi",0)'), '')
})
test('NOW and TODAY', () => {
  assert.match(f('=TODAY()'), /^\d{4}-\d{2}-\d{2}$/)
  assert.match(f('=NOW()'), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
})
test('errors', () => {
  assert.equal(f('=1/0'), ERR.DIV0)
  assert.equal(f('=FOO(1)'), ERR.NAME)
  assert.equal(f('=bogus'), ERR.NAME)
  assert.equal(f('="a"+1'), ERR.VALUE)
  assert.equal(f('=1+'), ERR.VALUE)
  assert.equal(f('=(1'), ERR.VALUE)
  assert.equal(f('=A0'), ERR.REF) // row 0 is not a valid ref
  assert.equal(f('=#REF!+1'), ERR.REF)
  assert.equal(g([['=B1', '=1/0']])(0, 0), ERR.DIV0) // propagates
  assert.equal(g([['=SUM(B1:C1)', '=1/0', '2']])(0, 0), ERR.DIV0) // range error propagates
  assert.equal(displayValue(ERR.DIV0), '#DIV/0!')
  assert.equal(g([['=A1:A2+1', '']])(0, 0), ERR.VALUE) // range as scalar
})
test('circular references', () => {
  const v = g([['=B1', '=A1'], ['=A2+1'], ['=C1', '=1']])
  assert.equal(v(0, 0), ERR.CIRC)
  assert.equal(v(0, 1), ERR.CIRC)
  assert.equal(v(1, 0), ERR.CIRC)
  assert.equal(displayValue(v(1, 0)), '#CIRC!')
  assert.equal(v(2, 1), 1)
  assert.equal(v(2, 0), null) // =C1 points at an empty cell
  assert.equal(g([['=IFERROR(A1,5)']])(0, 0), 5)
})
test('formula cells with a bare = are text; no eval', () => {
  assert.equal(g([['=']])(0, 0), '=')
  assert.equal(f('=constructor'), ERR.NAME)
  assert.equal(f('=process.exit()'), ERR.NAME)
})
test('chained dependencies evaluate once, deep chains do not crash', () => {
  const rows = [['1']]
  for (let i = 1; i < 3000; i++) rows.push([`=A${i}+1`])
  const v = g(rows)
  assert.equal(v(2999, 0), 3000)
})

// ---------------------------------------------------------------- formula rewriting
test('adjust formulas for insert and delete', () => {
  assert.equal(adjustFormula('=A1+B2', 'row', 'insert', 1, 1), '=A1+B3')
  assert.equal(adjustFormula('=A1+B2', 'col', 'insert', 0, 2), '=C1+D2')
  assert.equal(adjustFormula('=SUM(A1:A5)', 'row', 'insert', 2, 1), '=SUM(A1:A6)')
  assert.equal(adjustFormula('=SUM(A1:A5)', 'row', 'delete', 1, 2), '=SUM(A1:A3)')
  assert.equal(adjustFormula('=A2+1', 'row', 'delete', 1, 1), '=#REF!+1')
  assert.equal(adjustFormula('=SUM(A2:A3)', 'row', 'delete', 1, 2), '=SUM(#REF!)')
  assert.equal(adjustFormula('=$A$3', 'row', 'delete', 0, 1), '=$A$2')
  assert.equal(adjustFormula('="A1"&A1', 'row', 'insert', 0, 1), '="A1"&A2')
  assert.equal(adjustFormula('plain', 'row', 'insert', 0, 1), 'plain')
})
test('shift formulas for fill', () => {
  assert.equal(shiftFormula('=A1+B1', 1, 0), '=A2+B2')
  assert.equal(shiftFormula('=$A1+B$1', 2, 1), '=$A3+C$1')
  assert.equal(shiftFormula('=A1', -1, 0), '=#REF!')
  assert.equal(shiftFormula('text', 3, 3), 'text')
})

// ---------------------------------------------------------------- sort / stats / header
test('sortPerm: numeric aware, stable, empties last, header kept', () => {
  const col = ['h', '10', '9', 'b', '', 'a', '9']
  const val = (r) => (col[r] === '' ? null : parseNumber(col[r]) ?? col[r])
  const asc = sortPerm(col.length, 1, 'asc', val)
  assert.deepEqual(asc.map((i) => col[i]), ['h', '9', '9', '10', 'a', 'b', ''])
  assert.deepEqual([asc[1], asc[2]], [2, 6]) // stable
  const desc = sortPerm(col.length, 1, 'desc', val)
  assert.deepEqual(desc.map((i) => col[i]), ['h', 'b', 'a', '10', '9', '9', ''])
})
test('computeStats', () => {
  const s = computeStats([1, 2, 'x', null, '', 3.5])
  assert.deepEqual(s, { count: 4, numCount: 3, sum: 6.5, avg: 6.5 / 3, min: 1, max: 3.5 })
  assert.equal(computeStats([]).avg, null)
})
test('detectHeader', () => {
  assert.equal(detectHeader([['name', 'age'], ['Al', '30'], ['Bo', '41']]), true)
  assert.equal(detectHeader([['1', '2'], ['3', '4']]), false)
  assert.equal(detectHeader([['name', 'city'], ['Al', 'Paris']]), true)
  assert.equal(detectHeader([['x']]), false)
  assert.equal(detectHeader([['2020', '2021'], ['1', '2']]), false)
})
test('display formats', () => {
  assert.equal(formatDisplay(1234.5, { type: 'number', decimals: 2 }), '1,234.50')
  assert.equal(formatDisplay(1234.5, { type: 'currency', symbol: '$', decimals: 2 }), '$1,234.50')
  assert.equal(formatDisplay(0.256, { type: 'percent', decimals: 1 }), '25.6%')
  assert.equal(formatDisplay(45000, { type: 'date' }), '2023-03-15')
  assert.equal(formatDisplay('abc', { type: 'number' }), 'abc')
  assert.equal(formatDisplay(3, { type: 'general' }), '3')
})

// ---------------------------------------------------------------- Sheet: edit / fill / insert / delete / undo
const mk = (t) => Sheet.fromText(t, ',')

test('setCell, grow, serialize keeps eol and undo/redo', () => {
  const s = mk('a,b\r\n1,2\r\n')
  s.setCell(1, 1, '9')
  assert.equal(s.serialize(), 'a,b\r\n1,9\r\n')
  s.setCell(3, 2, 'z')
  assert.equal(s.rowCount, 4)
  assert.equal(s.ncols, 3)
  assert.equal(s.serialize(), 'a,b\r\n1,9\r\n,\r\n,,z\r\n')
  s.undo()
  assert.equal(s.serialize(), 'a,b\r\n1,9\r\n')
  assert.equal(s.ncols, 2)
  s.undo()
  assert.equal(s.serialize(), 'a,b\r\n1,2\r\n')
  assert.equal(s.canUndo, false)
  s.redo()
  s.redo()
  assert.equal(s.raw(3, 2), 'z')
  assert.equal(s.canRedo, false)
})
test('no-op edits create no history', () => {
  const s = mk('a,b\n1,2')
  assert.equal(s.setCell(0, 0, 'a'), false)
  assert.equal(s.canUndo, false)
})
test('new edit clears redo', () => {
  const s = mk('1,2')
  s.setCell(0, 0, 'x')
  s.undo()
  assert.equal(s.canRedo, true)
  s.setCell(0, 1, 'y')
  assert.equal(s.canRedo, false)
})
test('history is capped', () => {
  const s = mk('0')
  for (let i = 1; i <= MAX_HISTORY + 50; i++) s.setCell(0, 0, String(i))
  assert.equal(s.undoStack.length, MAX_HISTORY)
})
test('paste block grows the grid and undoes', () => {
  const s = mk('a,b\n1,2')
  const r = s.pasteBlock(1, 1, [['x', 'y', 'z'], ['p', 'q', 'r']])
  assert.equal(r.r1, 2)
  assert.equal(r.c1, 3)
  assert.equal(s.serialize(), 'a,b\n1,x,y,z\n,p,q,r')
  s.undo()
  assert.equal(s.serialize(), 'a,b\n1,2')
})
test('clearRange', () => {
  const s = mk('a,b\n1,2')
  s.clearRange(0, 0, 1, 0)
  assert.equal(s.serialize(), ',b\n,2')
  s.undo()
  assert.equal(s.serialize(), 'a,b\n1,2')
})
test('fill down and right, shifting formulas', () => {
  const s = mk('1,=A1+1\n,\n,\n')
  s.fillDown(0, 0, 2, 1)
  assert.equal(s.raw(2, 0), '1')
  assert.equal(s.raw(1, 1), '=A2+1')
  assert.equal(s.raw(2, 1), '=A3+1')
  assert.equal(s.display(2, 1), '2')
  s.undo()
  assert.equal(s.raw(2, 1), '')
  const t = mk('5\n\n')
  t.setCell(1, 0, '')
  t.fillDown(1, 0, 1, 0) // single row copies from above
  assert.equal(t.raw(1, 0), '5')
  const u = mk('1,,\n2,,')
  u.fillRight(0, 0, 1, 2)
  assert.equal(u.serialize(), '1,1,1\n2,2,2')
  const v = mk('a,')
  v.fillRight(0, 1, 0, 1)
  assert.equal(v.raw(0, 1), 'a')
})
test('insert and delete rows adjust formulas and undo exactly', () => {
  const s = mk('1\n2\n=SUM(A1:A2)\n')
  s.insertRows(1, 2)
  assert.equal(s.rowCount, 5)
  assert.equal(s.raw(4, 0), '=SUM(A1:A4)')
  assert.equal(s.display(4, 0), '3')
  s.deleteRows(1, 2)
  assert.equal(s.serialize(), '1\n2\n=SUM(A1:A2)\n')
  s.deleteRows(0, 1)
  assert.equal(s.raw(1, 0), '=SUM(A1:A1)')
  s.undo()
  s.undo()
  s.undo()
  assert.equal(s.serialize(), '1\n2\n=SUM(A1:A2)\n')
  assert.equal(s.canUndo, false)
})
test('delete every row leaves one blank row', () => {
  const s = mk('a\nb')
  s.deleteRows(0, 5)
  assert.equal(s.rowCount, 1)
  s.undo()
  assert.equal(s.serialize(), 'a\nb')
})
test('insert and delete columns', () => {
  const s = mk('a,b,c\n1,2,3')
  s.insertCols(1, 1)
  assert.equal(s.serialize(), 'a,,b,c\n1,,2,3')
  assert.equal(s.ncols, 4)
  s.deleteCols(0, 2)
  assert.equal(s.serialize(), 'b,c\n2,3')
  assert.equal(s.ncols, 2)
  s.undo()
  s.undo()
  assert.equal(s.serialize(), 'a,b,c\n1,2,3')
  assert.equal(s.ncols, 3)
  s.redo()
  s.redo()
  assert.equal(s.serialize(), 'b,c\n2,3')
})
test('column insert at the end and delete of all columns', () => {
  const s = mk('a,b\n1,2')
  s.insertCols(2, 1)
  assert.equal(s.ncols, 3)
  s.setCell(0, 2, 'new')
  assert.equal(s.serialize(), 'a,b,new\n1,2')
  s.undo()
  s.undo()
  assert.equal(s.ncols, 2)
  s.deleteCols(0, 9)
  assert.equal(s.ncols, 1)
  s.undo()
  assert.equal(s.serialize(), 'a,b\n1,2')
  assert.equal(s.ncols, 2)
})
test('column delete fixes formulas to #REF!', () => {
  const s = mk('1,2,=A1+B1')
  s.deleteCols(1, 1)
  assert.equal(s.raw(0, 1), '=A1+#REF!')
  assert.equal(s.display(0, 1), '#REF!')
})
test('sortBy keeps header and is undoable', () => {
  const s = mk('n,v\nb,2\na,10\nc,\nd,1\n')
  s.sortBy(1, 'asc', 1)
  assert.equal(s.serialize(), 'n,v\nd,1\nb,2\na,10\nc,\n')
  s.sortBy(0, 'desc', 1)
  assert.equal(s.serialize(), 'n,v\nd,1\nc,\nb,2\na,10\n')
  s.undo()
  s.undo()
  assert.equal(s.serialize(), 'n,v\nb,2\na,10\nc,\nd,1\n')
  assert.equal(s.sortBy(0, 'asc', 5), false)
})
test('sort by formula results', () => {
  const s = mk('=2*2\n=1+0\n3')
  s.sortBy(0, 'asc', 0)
  assert.deepEqual([0, 1, 2].map((r) => s.display(r, 0)), ['1', '3', '4'])
})
test('undo after structural edit then sort restores exact text', () => {
  const t = 'a,b\n3,x\n1,y\n2,z\n'
  const s = mk(t)
  s.insertRows(2, 1)
  s.insertCols(0, 1)
  s.sortBy(1, 'desc', 1)
  s.deleteCols(0, 1)
  while (s.canUndo) s.undo()
  assert.equal(s.serialize(), t)
})
test('untouched file round trips byte for byte', () => {
  const t = '﻿id;name\r\n1;"Ann ""A"""\r\n2;Bob\r\n'
  const s = Sheet.fromText(t)
  assert.equal(s.delimiter, ';')
  assert.equal(s.serialize(), t)
})

test('growth past the data is not saved when empty', () => {
  const t = 'a,b\n1,2\n'
  const s = mk(t)
  s.setCell(40, 7, 'x') // type into the virtual grid
  assert.equal(s.rowCount, 41)
  assert.equal(s.ncols, 8)
  assert.equal(s.serialize().split('\n').length, 42) // 41 rows + trailing newline
  s.setCell(40, 7, '') // clear it again
  assert.equal(s.serialize(), t)
  s.insertRows(s.rowCount, 3)
  assert.equal(s.serialize(), t)
})
test('blank rows that were in the original file are kept', () => {
  const t = 'a,b\n\n,\n'
  assert.equal(mk(t).serialize(), t)
  const s = mk(t)
  s.setCell(0, 0, 'z')
  assert.equal(s.serialize(), 'z,b\n\n,\n')
})
