// Removes a menu or drop-down with a short fade, so it never just vanishes. Every popup in the app leaves through here.
// The CSS class `leaving` runs the fade (styles in modules.css). The fallback timer removes the node even when no animation
// runs, for example with reduced motion, so a popup can never stay on screen.
const LEAVE_MS = 120

export function leave(node) {
  if (!node || !node.isConnected || node.classList.contains('leaving')) return
  node.classList.add('leaving')
  node.style.pointerEvents = 'none'
  const done = () => node.remove()
  node.addEventListener('animationend', (e) => e.target === node && done())
  setTimeout(done, LEAVE_MS + 40)
}
