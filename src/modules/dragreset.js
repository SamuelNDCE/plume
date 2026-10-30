// Milkdown's table drag (dragging a row or column) shows a copy of the table as an absolutely positioned overlay. It is hidden only by the
// dragend event on the element that was dragged. When the table is re-rendered by the drop, that element can be gone before dragend
// reaches the window, so the overlay stays visible and sits over the table, taking clicks and wheel events. This module hides any such
// leftover on the next drop or press, and never touches a drag that is still in progress (a press cannot happen during a drag).
const SHOWN = '[data-show="true"]'

// Only the overlay is reset. The row and column handles are left alone: a press on a handle starts its drag, so it must find them.
export function clearStrayTableDrag() {
  document.querySelectorAll(`.milkdown-table-block .drag-preview${SHOWN}`).forEach((p) => {
    p.querySelector('tbody')?.replaceChildren()
    p.dataset.show = 'false'
  })
}

export function initDragReset() {
  // After the drop has been handled: Milkdown's own drop handler must still see the overlay as shown to move the column or row.
  window.addEventListener('drop', () => setTimeout(clearStrayTableDrag, 0))
  window.addEventListener('dragend', () => setTimeout(clearStrayTableDrag, 0))
  window.addEventListener('mousedown', (e) => {
    if (!e.target.closest?.('.milkdown-table-block .handle')) clearStrayTableDrag()
  }, true)
}
