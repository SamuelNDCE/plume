import test from 'node:test'
import assert from 'node:assert/strict'
import { parseLine, levelGroup, groupMask, isLogName, looksLikeLog, shouldUseLogMode, LogIndex, lineMatches, windowFor, LEVEL } from '../src/modules/logview.js'

const lv = (s) => parseLine(s).level

test('levels: case-insensitive whole words near the start', () => {
  assert.equal(lv('ERROR something broke'), LEVEL.error)
  assert.equal(lv('2024-05-01T10:00:00Z warn disk low'), LEVEL.warn)
  assert.equal(lv('2024-05-01 10:00:00,123 [main] INFO  com.foo.Bar - started'), LEVEL.info)
  assert.equal(lv('[2024-05-01 10:00:00] [DEBUG] x'), LEVEL.debug)
  assert.equal(lv('10:00:00.5 (thread-3) Trace enter'), LEVEL.trace)
  assert.equal(lv('FATAL: out of memory'), LEVEL.fatal)
  assert.equal(lv('WARNING: careful'), LEVEL.warn)
  assert.equal(lv('level=error msg="x"'), LEVEL.error)
  assert.equal(lv('{"ts":1,"severity":"warn","m":"x"}'), LEVEL.warn)
})

test('levels: no false hits inside words or far into the message', () => {
  assert.equal(lv('ERRORS were found'), 0)
  assert.equal(lv('informational note'), 0)
  assert.equal(lv('The request failed with an error code'), 0)
  assert.equal(lv('2024-05-01 10:00:00 Connection reset, error ignored'), 0)
  assert.equal(lv(''), 0)
})

test('level span points at the word', () => {
  const s = '2024-05-01 10:00:00 [main] ERROR boom'
  const p = parseLine(s)
  assert.equal(s.slice(p.lvStart, p.lvEnd), 'ERROR')
  assert.equal(s.slice(0, p.tsEnd), '2024-05-01 10:00:00')
})

test('timestamps: ISO, slash, clf, syslog, bare time, brackets', () => {
  const end = (s) => s.slice(0, parseLine(s).tsEnd)
  assert.equal(end('2024-05-01T10:00:00.123Z hi'), '2024-05-01T10:00:00.123Z')
  assert.equal(end('2024-05-01 10:00:00,456 hi'), '2024-05-01 10:00:00,456')
  assert.equal(end('2024-05-01T10:00:00+02:00 hi'), '2024-05-01T10:00:00+02:00')
  assert.equal(end('[2024-05-01 10:00:00] hi'), '[2024-05-01 10:00:00]')
  assert.equal(end('2024/05/01 10:00:00 hi'), '2024/05/01 10:00:00')
  assert.equal(end('10/Oct/2000:13:55:36 -0700 GET'), '10/Oct/2000:13:55:36 -0700')
  assert.equal(end('Oct  5 10:00:00 host x'), 'Oct  5 10:00:00')
  assert.equal(end('10:00:00.250 start'), '10:00:00.250')
  assert.equal(end('2024-05-01 only a date'), '2024-05-01')
  assert.equal(end('no stamp here'), '')
  assert.equal(end('version 2024-05-01 later'), '')
})

test('levelGroup and groupMask', () => {
  assert.equal(levelGroup(LEVEL.fatal), 'error')
  assert.equal(levelGroup(LEVEL.trace), 'debug')
  assert.equal(levelGroup(LEVEL.none), null)
  assert.equal(groupMask([]), 0)
  assert.equal(groupMask(['warn']), 1 << LEVEL.warn)
  assert.equal(groupMask(['error']), (1 << 5) | (1 << 6))
})

test('detection by name and by content', () => {
  for (const n of ['a.log', 'B.OUT', 'x.err', 'app.log.1', 'app.log.2024-10-01', 'a.b.log']) assert.ok(isLogName(n), n)
  for (const n of ['a.txt', 'catalog.md', 'log.txt', 'a.logic', 'out']) assert.ok(!isLogName(n), n)
  const stamped = Array.from({ length: 12 }, (_, i) => `2024-05-01 10:00:${String(i).padStart(2, '0')} something happened ${i}`).join('\n')
  assert.ok(looksLikeLog(stamped))
  const levelled = Array.from({ length: 10 }, (_, i) => `INFO step ${i}`).join('\n')
  assert.ok(looksLikeLog(levelled))
  assert.ok(!looksLikeLog('# Title\n\nSome prose about the error handling.\n'))
  assert.ok(!looksLikeLog('one\ntwo\nthree'))
  assert.ok(!looksLikeLog(Array.from({ length: 30 }, (_, i) => `info about item ${i}, mixed case`).join('\n')))
  assert.ok(shouldUseLogMode('x.log', 'hello'))
  assert.ok(shouldUseLogMode('notes.txt', stamped))
})

test('LogIndex: lines, counts, inheritance, open last line', () => {
  const ix = new LogIndex()
  ix.append('2024-05-01 10:00:00 INFO a\n2024-05-01 10:00:01 ERROR b\n  at foo()\n  at bar()\n2024-05-01 10:00:02 plain\nWARN c')
  assert.equal(ix.scan(1000), true)
  assert.equal(ix.n, 6)
  assert.deepEqual(ix.counts, { error: 1, warn: 1, info: 1, debug: 0 })
  assert.equal(ix.lineText(2), '  at foo()')
  assert.equal(ix.eff[2], LEVEL.error)
  assert.equal(ix.eff[3], LEVEL.error)
  assert.equal(ix.eff[4], 0) // a timestamped line without a level ends the block
  assert.equal(ix.own[2], 0)
  assert.ok(ix.open)
  // the half-written last line grows
  ix.append('ING d\nDEBUG e\n')
  ix.scan(1000)
  assert.equal(ix.n, 7)
  assert.equal(ix.lineText(5), 'WARN cING d')
  assert.deepEqual(ix.counts, { error: 1, warn: 1, info: 1, debug: 1 })
  assert.ok(!ix.open)
})

test('LogIndex: trailing newline adds no empty line; scan is time-sliced', () => {
  const ix = new LogIndex()
  ix.append('a\nb\n')
  ix.scan(1000)
  assert.equal(ix.n, 2)
  const big = new LogIndex()
  big.append(Array.from({ length: 5000 }, (_, i) => `ERROR line ${i}`).join('\n'))
  let t = 0
  const done = big.scan(0, () => t++) // a fake clock that always runs out of budget
  assert.equal(done, false)
  assert.ok(big.n >= 1024 && big.n < 5000)
  while (!big.scan(0, () => t++));
  assert.equal(big.n, 5000)
  assert.equal(big.counts.error, 5000)
})

test('lineMatches: level mask and text, filtering does not change the index', () => {
  const ix = new LogIndex()
  ix.append('INFO alpha\nERROR Beta\n  at foo()\nWARN gamma')
  ix.scan(1000)
  const m = groupMask(['error'])
  const all = [0, 1, 2, 3]
  assert.deepEqual(all.filter((i) => lineMatches(ix, i, m, '')), [1, 2])
  assert.deepEqual(all.filter((i) => lineMatches(ix, i, 0, 'beta')), [1])
  assert.deepEqual(all.filter((i) => lineMatches(ix, i, m, 'beta')), [1])
  assert.deepEqual(all.filter((i) => lineMatches(ix, i, 0, '')), all)
  assert.equal(ix.text, 'INFO alpha\nERROR Beta\n  at foo()\nWARN gamma')
})

test('windowFor: plain and scaled', () => {
  let w = windowFor(0, 400, 1000, 20)
  assert.equal(w.first, 0)
  assert.ok(w.last >= 20 && w.last <= 30)
  assert.equal(w.spacerH, 20000)
  w = windowFor(2000, 400, 1000, 20, 24e6, 0)
  assert.equal(w.first, 100)
  assert.equal(w.layerTop, 2000)
  // 5 million rows: the spacer is capped and the end of the scroll range is the end of the list
  const count = 5e6
  const viewH = 400
  const cap = 24e6
  const end = windowFor(cap - viewH, viewH, count, 20, cap, 0)
  assert.equal(end.spacerH, cap)
  assert.equal(end.last, count)
  assert.equal(windowFor(0, viewH, count, 20, cap).first, 0)
  assert.equal(windowFor(0, 400, 0, 20).last, 0)
})

test('LogIndex: lower-cased copy and lineOf follow the text, also after an open last line grows', () => {
  const ix = new LogIndex()
  ix.append('2026-01-01 INFO Alpha one\n2026-01-01 ERROR Beta two\n2026-01-01 INFO Gam')
  ix.scan(50)
  assert.equal(ix.lower, ix.text.toLowerCase())
  assert.equal(ix.lineOf(ix.lower.indexOf('beta')), 1)
  ix.append('ma three\n')
  ix.scan(50)
  assert.equal(ix.lower, ix.text.toLowerCase())
  assert.equal(ix.lineOf(ix.lower.indexOf('gamma')), 2)
  ix.reset()
  assert.equal(ix.lower, '')
  assert.equal(ix.n, 0)
})
