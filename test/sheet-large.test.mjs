// Regression: a CSV with hundreds of thousands of rows used to overflow the call stack in Sheet's column count
// (Math.max over a spread array). The column count must come from a loop.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Sheet } from '../src/modules/sheet-core.js'

test('Sheet builds from 700,000 rows without a stack overflow', () => {
  const rows = new Array(700000)
  for (let i = 0; i < rows.length; i++) rows[i] = i % 7 === 0 ? ['a', 'b', 'c', 'd'] : ['x', 'y']
  const sheet = new Sheet({ rows })
  assert.equal(sheet.ncols, 4)
  assert.equal(sheet.baseRows, 700000)
})
