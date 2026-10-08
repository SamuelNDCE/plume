// Run after `npm run build`: npx electron tests/source-redo.cjs
// Reuse Plume's native-input QA hook in a disposable profile.
const { app } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'plume-source-redo-'))
app.setPath('userData', profile)
app.setPath('sessionData', profile)
process.env.PLUME_STEPS = path.join(__dirname, 'source-redo.steps.json')

let errors = null
const log = console.log.bind(console)
console.log = (...args) => {
  if (typeof args[0] === 'string' && args[0].startsWith('ERRORS:')) {
    errors = JSON.parse(args[0].slice(7))
  }
  log(...args)
}
const exit = app.exit.bind(app)
app.exit = (code) => exit(errors === null || errors.length ? 1 : code)
setTimeout(() => exit(1), 45000).unref()

require(path.join(__dirname, '..', 'electron', 'main.cjs'))
