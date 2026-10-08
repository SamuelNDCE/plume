// Word Goal: counts words you add today in the current document and shows progress in the status bar.
const today = () => new Date().toISOString().slice(0, 10)
const countWords = (md) => (String(md).match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length

export function activate(api) {
  let goal = api.storage.get('goal') || 500
  // progress = { date, written, last } ; "last" is the previous word count of the active doc
  let progress = api.storage.get('progress')
  if (!progress || progress.date !== today()) progress = { date: today(), written: 0, last: null }

  const item = api.ui.addStatusItem({
    id: 'goal',
    render(el) {
      const pct = Math.min(100, Math.round((progress.written / goal) * 100))
      el.textContent = `Goal ${progress.written}/${goal} (${pct}%)`
      el.title = 'Words written today. Run "Set daily word goal" to change.'
      el.style.marginLeft = '12px'
    },
  })

  api.on('doc:change', (md) => {
    const n = countWords(md)
    if (progress.last !== null && n > progress.last) progress.written += n - progress.last
    progress.last = n
    api.storage.set('progress', progress)
    item.update()
  })
  api.on('tab:switch', () => {
    progress.last = countWords(api.editor.getMarkdown())
  })

  api.commands.register({
    id: 'set-goal',
    title: 'Set daily word goal',
    run() {
      const next = Number(window.prompt('Daily word goal', String(goal)))
      if (next > 0) {
        goal = Math.round(next)
        api.storage.set('goal', goal)
        item.update()
      }
    },
  })
  api.commands.register({
    id: 'reset-today',
    title: 'Reset today’s word count',
    run() {
      progress = { date: today(), written: 0, last: countWords(api.editor.getMarkdown()) }
      api.storage.set('progress', progress)
      item.update()
      api.ui.toast('Word count reset')
    },
  })
}
