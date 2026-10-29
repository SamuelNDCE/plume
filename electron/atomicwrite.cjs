// Atomic file write: the data goes to a temp file in the same folder, is flushed to disk, then renamed over the target.
// If anything fails before the rename, the original file is untouched and the temp file is removed.
const nodeFs = require('node:fs')
const crypto = require('node:crypto')

function writeAtomic(p, data, fs = nodeFs) {
  let target = p
  try { target = fs.realpathSync(p) } catch {} // write through a symlink instead of replacing it
  // Keep the original's permission bits (0o600 for a new file). The temp name is random and opened 'wx': a planted file or symlink there is never followed.
  let mode = 0o600
  try { mode = fs.statSync(target).mode & 0o7777 } catch {}
  const tmp = target + '.' + crypto.randomBytes(6).toString('hex') + '.plume-tmp'
  let fd
  try {
    fd = fs.openSync(tmp, 'wx', mode)
    try { fs.fchmodSync(fd, mode) } catch {}
    fs.writeSync(fd, data, 0, data.length)
    try { fs.fsyncSync(fd) } catch {}
    fs.closeSync(fd)
    fd = undefined
    fs.renameSync(tmp, target)
  } catch (e) {
    if (fd !== undefined) { try { fs.closeSync(fd) } catch {} }
    try { fs.unlinkSync(tmp) } catch {}
    throw e
  }
}

module.exports = { writeAtomic }
