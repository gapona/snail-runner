/**
 * Whether this device's main pointer is a finger.
 *
 * **Asked of the browser, not of a pointer the game has seen**, because the question comes up before
 * the first touch of a run: the tutorial's first card is up while the road is still, and it has to
 * say "slide a finger" or "move the mouse" before either has happened. `(pointer: coarse)` is the
 * primary pointer's own accuracy, which is what separates a phone from a laptop with a touchscreen
 * whose player is using the trackpad.
 *
 * Never imports `phaser`; safe under Node, where there is no `window` and the answer is no.
 */
export function isTouchPrimary(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false

  return window.matchMedia('(pointer: coarse)').matches
}
