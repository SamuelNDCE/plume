// Insert Snippets: each command inserts text at the cursor via api.editor.insertText.
const pad = (n) => String(n).padStart(2, '0')

export function activate(api) {
  const add = (id, title, text) =>
    api.commands.register({ id, title, category: 'Snippets', run: () => api.editor.insertText(typeof text === 'function' ? text() : text) })

  add('date', 'Insert date', () => {
    const d = new Date()
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  })
  add('time', 'Insert time', () => {
    const d = new Date()
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`
  })
  add('callout', 'Insert callout', '> **Note**\n> Write your note here.\n\n')
  add('front-matter', 'Insert front matter', () => {
    const d = new Date()
    const name = (api.editor.activeDoc() || { name: 'Untitled' }).name.replace(/\.[^.]+$/, '')
    return `---\ntitle: ${name}\ndate: ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}\ntags: []\n---\n\n`
  })
}
