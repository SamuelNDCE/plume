// electron-builder hook (build.afterPack). Sets the one Electron fuse that the electronFuses schema in electron-builder 26 does not accept:
// grantFileProtocolExtraPrivileges off. The other fuses stay in package.json.
const path = require('node:path')

exports.default = async function fusesAfterPack(context) {
  const { flipFuses, FuseVersion, FuseV1Options } = await import('@electron/fuses')
  const name = context.packager.appInfo.productFilename
  const exe = context.electronPlatformName === 'darwin'
    ? path.join(context.appOutDir, `${name}.app`, 'Contents', 'MacOS', name)
    : path.join(context.appOutDir, context.electronPlatformName === 'win32' ? `${name}.exe` : name)
  await flipFuses(exe, { version: FuseVersion.V1, [FuseV1Options.GrantFileProtocolExtraPrivileges]: false })
}
