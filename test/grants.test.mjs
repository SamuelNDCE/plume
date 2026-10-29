import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const grants = createRequire(import.meta.url)('../electron/grants.cjs')
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plume-grants-')))
const mk = (...p) => {
  const f = path.join(tmp, ...p)
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, 'x')
  return f
}
const store = () => path.join(tmp, 'state', 'grants.json')
const fresh = () => { fs.mkdirSync(path.dirname(store()), { recursive: true }); fs.rmSync(store(), { force: true }); grants.configure(store()) }

test('a granted file is allowed, a sibling is refused', () => {
  fresh()
  const a = mk('one', 'a.md')
  const b = mk('one', 'b.md')
  grants.grant(a)
  assert.equal(grants.isGranted(a), true)
  assert.equal(grants.isGranted(b), false)
  assert.throws(() => grants.assert(b), /not permitted: b\.md/)
})

test('a file inside a granted folder is allowed, also one not created yet', () => {
  fresh()
  const f = mk('dir', 'sub', 'c.md')
  grants.grant(path.join(tmp, 'dir'), { folder: true })
  assert.equal(grants.isGranted(f), true)
  assert.equal(grants.isGranted(path.join(tmp, 'dir', 'sub', 'new.md')), true)
  assert.equal(grants.isGranted(path.join(tmp, 'dir', 'newdir', 'assets', 'x.png')), true)
  assert.equal(grants.isGranted(f, { folder: true }), true)
  assert.equal(grants.isGranted(mk('other', 'd.md')), false)
})

test('a new file is refused when no parent folder is granted', () => {
  fresh()
  grants.grant(mk('solo', 'a.md'))
  assert.equal(grants.isGranted(path.join(tmp, 'solo', 'new.md')), false)
})

test('a single granted file does not count as a folder', () => {
  fresh()
  const a = mk('f1', 'a.md')
  grants.grant(a)
  assert.equal(grants.isGranted(a, { folder: true }), false)
})

test('.. escape, relative path and NUL byte are refused', () => {
  fresh()
  grants.grant(path.join(tmp, 'dir'), { folder: true })
  const secret = mk('secret.txt')
  assert.equal(grants.isGranted(path.join(tmp, 'dir', '..', 'secret.txt')), false)
  assert.equal(grants.isGranted(secret), false)
  assert.equal(grants.isGranted('dir/a.md'), false)
  assert.equal(grants.isGranted(path.join(tmp, 'dir', 'a\0.md')), false)
  assert.throws(() => grants.grant('relative.md'))
  assert.throws(() => grants.grant(path.join(tmp, 'a\0')))
})

test('a symlink inside a granted folder that points outside is refused', (t) => {
  fresh()
  const outside = mk('outside', 'secret.md')
  const inner = path.join(tmp, 'granted')
  fs.mkdirSync(inner, { recursive: true })
  const link = path.join(inner, 'link.md')
  try {
    fs.symlinkSync(outside, link, 'file')
  } catch (e) {
    return t.skip('symlinks cannot be created here (' + e.code + '); needs Developer Mode or admin on Windows')
  }
  grants.grant(inner, { folder: true })
  assert.equal(grants.isGranted(link), false)
  // a dangling link is refused too, so a write cannot go through it
  const dangling = path.join(inner, 'dangling.md')
  fs.symlinkSync(path.join(tmp, 'nowhere', 'x.md'), dangling, 'file')
  assert.equal(grants.isGranted(dangling), false)
})

test('case change is allowed on Windows only', (t) => {
  if (process.platform !== 'win32') return t.skip('case-insensitive compare is Windows only')
  fresh()
  const a = mk('Case', 'File.md')
  grants.grant(a)
  assert.equal(grants.isGranted(a.toUpperCase()), true)
  grants.grant(path.join(tmp, 'Case'), { folder: true })
  assert.equal(grants.isGranted(path.join(tmp, 'CASE', 'file.MD')), true)
})

test('the granted list round-trips through grants.json and is written atomically', () => {
  fresh()
  const a = mk('rt', 'a.md')
  grants.grant(a)
  grants.grant(path.join(tmp, 'rt'), { folder: true })
  assert.equal(fs.existsSync(store() + '.tmp'), false)
  const saved = JSON.parse(fs.readFileSync(store(), 'utf8'))
  assert.deepEqual(saved.files, [a])
  grants.configure(store())
  assert.equal(grants.isGranted(a), true)
  assert.deepEqual(grants.grantedRoots().folders, [path.join(tmp, 'rt')])
})

test('caps: 500 files and 50 folders, oldest dropped first', () => {
  fresh()
  for (let i = 0; i < grants.MAX_FILES + 3; i++) grants.grant(path.join(tmp, 'cap', 'f' + i + '.md'))
  for (let i = 0; i < grants.MAX_FOLDERS + 2; i++) grants.grant(path.join(tmp, 'capd', 'd' + i), { folder: true })
  const r = grants.grantedRoots()
  assert.equal(r.files.length, 500)
  assert.equal(r.folders.length, 50)
  assert.equal(grants.isGranted(path.join(tmp, 'cap', 'f0.md')), false)
  assert.equal(grants.isGranted(path.join(tmp, 'cap', 'f502.md')), true)
})

test('a granted file may write only <folder>/assets/<name>', () => {
  fresh()
  const doc = mk('pic', 'doc.md')
  const sib = mk('pic', 'sibling.md')
  grants.grant(doc)
  const img = path.join(tmp, 'pic', 'assets', 'img-1.png')
  assert.equal(grants.isAssetWrite(img), true)
  assert.equal(grants.isAssetWrite(sib), false)
  assert.equal(grants.isAssetWrite(path.join(tmp, 'pic', 'other', 'img.png')), false)
  assert.equal(grants.isAssetWrite(path.join(tmp, 'pic', 'assets', 'deep', 'img.png')), false)
  assert.equal(grants.isAssetWrite(path.join(tmp, 'elsewhere', 'assets', 'img.png')), false)
  assert.equal(grants.isGranted(img), false) // reads stay refused
})

test('the userData folder and home dotfiles are refused, even inside a granted folder', () => {
  const home = path.join(tmp, 'home')
  fs.mkdirSync(path.join(home, 'docs'), { recursive: true })
  fs.mkdirSync(path.dirname(store()), { recursive: true })
  grants.configure(store(), { home })
  const ssh = mk('home', '.ssh', 'id_rsa')
  const env = mk('home', '.env')
  const ok = mk('home', 'docs', 'a.md')
  assert.throws(() => grants.grant(ssh), /not permitted/)
  assert.throws(() => grants.grant(env), /not permitted/)
  assert.throws(() => grants.grant(store()), /not permitted/)
  grants.grant(home, { folder: true })
  assert.equal(grants.isGranted(ok), true)
  assert.equal(grants.isGranted(ssh), false)
  assert.equal(grants.isGranted(env), false)
  grants.grant(tmp, { folder: true })
  assert.equal(grants.isGranted(store()), false)
  grants.configure(store())
})

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }))
