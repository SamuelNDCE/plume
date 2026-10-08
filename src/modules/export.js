// Export and copy commands (category 'Export').
// HTML and PDF use the rendered .ProseMirror DOM, so they need WYSIWYG mode.
// Save dialogs go through window.folio (electron/preload.cjs); the PDF print CSS lives elsewhere.

let app = null

const EXPORT_CSS = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; background: #fff; color: #1f2328; font: 17px/1.7 Georgia, "Times New Roman", serif; }
.doc { max-width: 760px; margin: 0 auto; padding: 48px 24px 96px; overflow-wrap: break-word; }
h1, h2, h3, h4, h5, h6 { font-family: "Segoe UI", system-ui, sans-serif; line-height: 1.25; margin: 1.6em 0 0.6em; }
h1 { font-size: 2.1em; } h2 { font-size: 1.6em; } h3 { font-size: 1.3em; }
p, ul, ol, blockquote, pre, table, figure { margin: 0 0 1em; }
a { color: #0969da; }
img, video { max-width: 100%; height: auto; }
hr { border: 0; border-top: 1px solid #d0d7de; margin: 2em 0; }
blockquote { border-left: 4px solid #d0d7de; color: #57606a; padding: 0 1em; margin-left: 0; }
code, kbd { font-family: ui-monospace, Consolas, "Courier New", monospace; font-size: 0.88em; background: #f6f8fa; padding: 0.15em 0.35em; border-radius: 4px; }
pre { background: #f6f8fa; padding: 14px 16px; border-radius: 6px; overflow-x: auto; }
pre code { background: none; padding: 0; font-size: 0.86em; }
table { border-collapse: collapse; width: 100%; font-size: 0.95em; }
th, td { border: 1px solid #d0d7de; padding: 6px 10px; text-align: left; vertical-align: top; }
th { background: #f6f8fa; font-weight: 600; }
ul.contains-task-list, li.task-list-item { list-style: none; }
input[type="checkbox"] { margin-right: 0.45em; }
@media print { body { font-size: 12pt; } .doc { padding: 0; } a { color: inherit; } }
`

const baseName = () => {
  const t = app.state.tabs[app.state.active]
  return ((t && t.name) || 'Untitled').replace(/\.(md|markdown|mdown|txt)$/i, '')
}
const suggest = (ext) => `${baseName()}.${ext}`

const escHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

function ensureWysiwyg() {
  if (app.state.mode === 'source') {
    app.toast('Switch to WYSIWYG mode (Ctrl+/) to export the rendered document')
    return false
  }
  return true
}

// Clone the rendered editor so editing chrome and ProseMirror attributes do not leak into the export.
function renderedClone() {
  const pm = document.querySelector('#editor .ProseMirror')
  if (!pm) return null
  const clone = pm.cloneNode(true)
  clone.querySelectorAll('button, script, style, [contenteditable]').forEach((n) => {
    if (n.matches('button, script, style')) n.remove()
    else n.removeAttribute('contenteditable')
  })
  clone.removeAttribute('class')
  clone.removeAttribute('contenteditable')
  clone.removeAttribute('spellcheck')
  return clone
}

function buildHtmlDoc(title, bodyHtml) {
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escHtml(title)}</title>`,
    `<style>${EXPORT_CSS}</style>`,
    '</head>',
    '<body>',
    `<article class="doc">${bodyHtml}</article>`,
    '</body>',
    '</html>',
    '',
  ].join('\n')
}

async function exportHtml() {
  if (!ensureWysiwyg()) return
  const clone = renderedClone()
  if (!clone) return app.toast('Nothing to export yet')
  const html = buildHtmlDoc(baseName(), clone.innerHTML)
  const saved = await window.folio.exportHtml(html, suggest('html'))
  if (saved) app.toast('Exported HTML')
}

async function exportPdf() {
  if (!ensureWysiwyg()) return
  const saved = await window.folio.exportPdf(suggest('pdf'))
  if (saved) app.toast('Exported PDF')
}

async function copyMarkdown() {
  try {
    await navigator.clipboard.writeText(app.getMarkdown())
    app.toast('Markdown copied')
  } catch {
    app.toast('Copy failed')
  }
}

async function copyHtml() {
  if (!ensureWysiwyg()) return
  const clone = renderedClone()
  if (!clone) return app.toast('Nothing to copy yet')
  const html = clone.innerHTML
  const text = clone.textContent || ''
  try {
    if (navigator.clipboard.write && typeof ClipboardItem !== 'undefined') {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        }),
      ])
    } else {
      await navigator.clipboard.writeText(html)
    }
    app.toast('HTML copied')
  } catch {
    app.toast('Copy failed')
  }
}

function printDoc() {
  window.print()
}

export function init(appCtx) {
  app = appCtx
  const C = (id, title, run) => app.commands.register({ id, title, category: 'Export', keys: null, run })
  C('export.html', 'Export as HTML…', exportHtml)
  C('export.pdf', 'Export as PDF…', exportPdf)
  C('export.markdown.copy', 'Copy as Markdown', copyMarkdown)
  C('export.html.copy', 'Copy as HTML', copyHtml)
  C('export.print', 'Print…', printDoc)
}
