// Dispatches PDF, Word and Excel documents to their viewer modules. Each viewer is loaded on first use, so none of
// them costs startup time. A viewer exports mount(host, doc, app) and fills the host it is given.
const VIEWERS = {
  pdf: () => import('./pdfview.js'),
  docx: () => import('./docxview.js'),
  xlsx: () => import('./xlsxview.js'),
}

export async function mountDocument(host, d, app) {
  host.textContent = ''
  const load = VIEWERS[d.kind]
  if (!load) return
  try {
    const mod = await load()
    await mod.mount(host, d, app)
  } catch (e) {
    console.error('[docviewer]', d.kind, e)
    const msg = document.createElement('div')
    msg.className = 'doc-viewer-error'
    msg.textContent = 'Could not show this ' + d.kind.toUpperCase() + ' file.'
    host.textContent = ''
    host.appendChild(msg)
  }
}
