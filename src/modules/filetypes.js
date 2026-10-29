// The file types Plume registers with Windows. One source: package.json build.fileAssociations, which electron-builder
// also reads. The named import keeps only `build` in the bundle.
import { build } from '../../package.json'

export const FILE_TYPES = ((build && build.fileAssociations) || []).map((a) => ({ ext: String(a.ext), name: String(a.name || '') }))
