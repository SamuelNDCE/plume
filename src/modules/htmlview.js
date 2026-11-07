// Rich view of an HTML file: the page is drawn in a sandboxed frame, so what you see is how the file renders.
// The frame has no script permission and a Content Security Policy that allows only inline data: images, styles and fonts.
// Scripts are removed from the preview. Local stylesheets and images the page links to are read through the main process
// (granted files only, small image and CSS files only) and inlined, so the page shows its real styling.
// Switching to Source (header Rich/Source control or Ctrl+/) shows the code, where the file is edited.

const CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; media-src data:"
// Anything with a scheme, a protocol-relative or absolute path, or a bare fragment is not a local file we inline.
const REMOTE = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\/)/i

// Resolves a relative link against the folder of the HTML file. Returns null for links that climb above the file's folder.
function resolveLocal(filePath, rel) {
  if (!rel || REMOTE.test(rel)) return null
  const clean = decodeURIComponent(rel.split('#')[0].split('?')[0])
  const sep = filePath.includes('\\') ? '\\' : '/'
  const parts = filePath.split(/[\\/]/)
  parts.pop()
  for (const seg of clean.split(/[\\/]+/)) {
    if (!seg || seg === '.') continue
    if (seg === '..') {
      if (parts.length <= 1) return null
      parts.pop()
    } else parts.push(seg)
  }
  return parts.join(sep)
}

async function readAssetFor(filePath, rel) {
  const abs = resolveLocal(filePath, rel)
  if (!abs || !window.folio || !window.folio.readAsset) return null
  try {
    return await window.folio.readAsset(abs)
  } catch {
    return null
  }
}

// Builds the preview markup: scripts removed, local assets inlined, the policy first in the head.
export async function previewDocument(src, filePath) {
  const doc = new DOMParser().parseFromString(src, 'text/html') // parsing runs no scripts and loads nothing
  for (const s of doc.querySelectorAll('script')) s.remove()
  const meta = doc.createElement('meta')
  meta.setAttribute('http-equiv', 'Content-Security-Policy')
  meta.setAttribute('content', CSP)
  doc.head.prepend(meta)
  for (const img of doc.querySelectorAll('img[src], source[src]')) {
    const got = await readAssetFor(filePath, img.getAttribute('src'))
    if (got && got.dataUrl) img.setAttribute('src', got.dataUrl)
    else img.removeAttribute('src')
  }
  for (const link of doc.querySelectorAll('link[rel~="stylesheet"][href]')) {
    const got = await readAssetFor(filePath, link.getAttribute('href'))
    const style = doc.createElement('style')
    style.textContent = got && got.text ? got.text : ''
    link.replaceWith(style)
  }
  return '<!doctype html>\n' + doc.documentElement.outerHTML
}

export async function mountHtmlPreview(host, d) {
  host.textContent = ''
  const root = document.createElement('div')
  root.className = 'htmlv'
  const note = document.createElement('div')
  note.className = 'htmlv-note'
  note.textContent = 'Rich preview. Scripts are off and remote files are not loaded. Switch to Source to edit.'
  const frame = document.createElement('iframe')
  frame.className = 'htmlv-frame'
  frame.setAttribute('sandbox', '')
  frame.setAttribute('referrerpolicy', 'no-referrer')
  frame.title = d.name || 'HTML preview'
  root.append(note, frame)
  host.append(root)
  frame.srcdoc = await previewDocument(d.content || '', d.path || d.name || '')
}
