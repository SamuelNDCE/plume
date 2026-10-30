// While a text selection is being dragged, the editor's scroller is made non-scrollable, and it is restored on release.
// Chromium autoscrolls a scroller that is being selected from while the pointer is past its edge. The autoscroll keeps going after the
// button is released in some cases, which is the view moving on its own and jumping back to the selection. With the scroller not
// user-scrollable for the length of the press, that autoscroll has nothing to move, and the view stays where it is.
// The wheel is unaffected outside a press. scrollbar-gutter keeps the layout the same when the scrollbar is hidden.
export function initDragScroll() {
  const scroller = document.querySelector('#editor-scroll')
  if (!scroller) return
  scroller.style.scrollbarGutter = 'stable'
  let held = false
  const inText = (t) => !!(t && t.closest && t.closest('.ProseMirror'))
  const release = () => {
    if (!held) return
    held = false
    scroller.style.overflowY = ''
  }
  window.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || !inText(e.target)) return
    held = true
    scroller.style.overflowY = 'hidden'
  }, true)
  window.addEventListener('mouseup', release, true)
  window.addEventListener('blur', release)
  // a release that never reached the window, or a wheel while held: the scroller must never stay locked
  window.addEventListener('mousemove', (e) => { if (e.buttons === 0) release() }, true)
  window.addEventListener('wheel', release, true)
}
