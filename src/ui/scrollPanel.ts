import * as Phaser from 'phaser'
import { clampScroll, maxScroll } from './scrollList'
import {
  computeReleaseVelocity,
  createScrollMomentumState,
  pushDragSample,
  resetScrollMomentum,
  stepMomentum,
  type ScrollMomentumState,
} from './scrollMomentum'
import { scrollableCameraRegion, type ScrollableCameraRegion } from './scrollRegion'

/**
 * A scrolling window of rows: the clipping camera, the flick physics, and the pointer binding that
 * drives them, as one object.
 *
 * **Extracted from `Shop.ts` when a second screen needed it, not before.** The three pieces it
 * joins have existed since the template — `scrollRegion.ts` for the clip, `scrollMomentum.ts` for
 * the physics, `scrollList.ts` for the arithmetic — but the code that *wires* them was inside the
 * shop, and it is the wiring that carries the two non-obvious rules: the drag's sign, and the
 * pointer's own event clock. A second copy of those would be a second place for them to be subtly
 * wrong, and neither is visible in a screenshot when it is.
 *
 * What it deliberately does **not** own: which objects belong to the window and which to the chrome.
 * Only the caller knows that, so the caller does both `ignore()` calls — the same split
 * `scrollRegion.ts` documents and `Game.ts` uses for its own world/UI cameras.
 */
export interface ScrollPanel {
  /** The clipping camera. The caller must `ignore()` its chrome on it, and its rows on the main one. */
  readonly camera: Phaser.Cameras.Scene2D.Camera
  /** The current offset, for a caller that needs to convert a row's y into a screen y. */
  readonly offset: number
  /** The window's top edge in screen space, for the same reason. */
  readonly windowTop: number
  /** The window's height in screen space. */
  readonly windowHeight: number
  /**
   * Re-points the window and tells it how tall its content is.
   *
   * Called from `layout()`. The offset is **re-clamped rather than reset**: a rotation that
   * lengthens the window shortens the travel and would otherwise leave blank space under the last
   * row, while a reset would throw away the player's place in the list on every orientation change.
   */
  setWindow(bounds: { x: number; y: number; width: number; height: number }, contentExtent: number): void
  /**
   * Jumps to an offset, clamped, killing any flick in flight.
   *
   * For a caller that has *replaced* the content rather than resized it — the shop's tabs are the
   * one case today. `setWindow` deliberately re-clamps instead of resetting, which is right when
   * the same list is merely a different shape and wrong when it is a different list: clamping
   * would leave the player part-way down a list they have never seen.
   */
  scrollTo(next: number): void
  /**
   * Switches the window on and off.
   *
   * Off, the camera draws nothing and no press or wheel reaches the list. For a window that is only
   * sometimes on screen — the front screen's quest panel, which is collapsed unless it is asked for:
   * a list that went on catching drags while it was shut would steal the steer from under it.
   */
  setEnabled(on: boolean): void
  /** Called from the scene's `update`. Steps the flick; a no-op while the finger is down or still. */
  update(time: number, delta: number): void
  destroy(): void
}

export function scrollPanel(scene: Phaser.Scene): ScrollPanel {
  const region: ScrollableCameraRegion = scrollableCameraRegion(scene, { x: 0, y: 0, width: 1, height: 1 })
  const momentum: ScrollMomentumState = createScrollMomentumState()

  let offset = 0
  let dragging = false
  let enabled = true
  let windowLeft = 0
  let windowWidth = 0
  let windowTop = 0
  let windowHeight = 0
  let extent = 0

  function setScroll(next: number): void {
    offset = clampScroll(next, extent, windowHeight)
    region.camera.scrollY = offset
  }

  // **Both axes.** It was the vertical band alone, which was harmless while the only window was a
  // modal shop panel nearly as wide as the frame; on the front screen the window is a third of it,
  // and a drag started beside it is the player steering a menu, not scrolling a list.
  const inWindow = (pointer: Phaser.Input.Pointer) =>
    enabled &&
    pointer.x >= windowLeft &&
    pointer.x <= windowLeft + windowWidth &&
    pointer.y >= windowTop &&
    pointer.y <= windowTop + windowHeight

  const onDown = (pointer: Phaser.Input.Pointer) => {
    if (!inWindow(pointer)) return

    dragging = true
    resetScrollMomentum(momentum)
    pushDragSample(momentum, pointer.y, pointer.downTime)
  }
  const onMove = (pointer: Phaser.Input.Pointer) => {
    if (!dragging || !pointer.isDown) return

    const previous = momentum.samples[momentum.samples.length - 1]

    // Dragging down must move the list down, i.e. *decrease* the scroll offset — the camera scrolls
    // the window over the content, so the content moves opposite to the camera.
    if (previous) setScroll(offset - (pointer.y - previous.pos))
    // The pointer's own event clock, never a frame clock: several raw moves can land inside one
    // frame, and sharing a timestamp between them corrupts the release velocity in a way that
    // depends on how the render rate lines up with the input rate. See `scrollMomentum.ts`.
    pushDragSample(momentum, pointer.y, pointer.moveTime)
  }
  const onUp = () => {
    if (!dragging) return

    dragging = false
    // Negated for the same reason the drag is: the physics works in the axis it is handed, and the
    // axis here is the scroll offset rather than the finger.
    momentum.velocity = -computeReleaseVelocity(momentum)
  }
  const onWheel = (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
    if (!enabled) return

    resetScrollMomentum(momentum)
    setScroll(offset + dy)
  }

  scene.input.on(Phaser.Input.Events.POINTER_DOWN, onDown)
  scene.input.on(Phaser.Input.Events.POINTER_MOVE, onMove)
  scene.input.on(Phaser.Input.Events.POINTER_UP, onUp)
  // A release off the canvas never fires POINTER_UP; without this the list stays grabbed.
  scene.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, onUp)
  scene.input.on(Phaser.Input.Events.POINTER_WHEEL, onWheel)

  return {
    camera: region.camera,
    get offset() {
      return offset
    },
    get windowTop() {
      return windowTop
    },
    get windowHeight() {
      return windowHeight
    },
    setWindow(bounds, contentExtent) {
      windowLeft = bounds.x
      windowWidth = bounds.width
      windowTop = bounds.y
      windowHeight = bounds.height
      extent = contentExtent
      region.setBounds(bounds)
      setScroll(offset)
    },
    scrollTo(next) {
      resetScrollMomentum(momentum)
      setScroll(next)
    },
    setEnabled(on) {
      enabled = on
      region.camera.setVisible(on)
      if (!on) {
        dragging = false
        resetScrollMomentum(momentum)
      }
    },
    update(time, delta) {
      if (dragging || momentum.velocity === 0) return

      setScroll(stepMomentum(momentum, offset, delta, 0, maxScroll(extent, windowHeight), time))
    },
    destroy() {
      scene.input.off(Phaser.Input.Events.POINTER_DOWN, onDown)
      scene.input.off(Phaser.Input.Events.POINTER_MOVE, onMove)
      scene.input.off(Phaser.Input.Events.POINTER_UP, onUp)
      scene.input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, onUp)
      scene.input.off(Phaser.Input.Events.POINTER_WHEEL, onWheel)
      region.destroy()
    },
  }
}
