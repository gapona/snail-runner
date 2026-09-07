import * as Phaser from 'phaser'
import { MIN_TOUCH } from './kitPalette'

const REFERENCE_WIDTH = 400
const MIN_UI_SCALE = 0.8

/**
 * The touch floor, re-exported rather than restated.
 *
 * **One number, one place.** It was declared here *and* as `kitPalette.MIN_TOUCH`, both 44, and two
 * constants for one rule is one of them going stale. `kitPalette` owns it because that module is
 * pure — this one imports `phaser` as a value, so a `verify:` script can reach the floor there and
 * not here.
 */
export const MIN_TOUCH_TARGET = MIN_TOUCH

/**
 * Uniform scale factor for interactive UI at the given viewport width: 1 at/above
 * REFERENCE_WIDTH, floored at MIN_UI_SCALE below it — so text/buttons shrink
 * gracefully on narrow screens instead of collapsing.
 */
export function uiScale(width: number): number {
  return Phaser.Math.Clamp(width / REFERENCE_WIDTH, MIN_UI_SCALE, 1)
}

/**
 * ⚠ **Never call this on a child of a widget whose container is already interactive** — a
 * `KitButton`'s label being the case that caused it. The container is what `bindAction` binds; making
 * a child interactive too puts *two* objects under one press, and which one receives it is decided by
 * hit-test ordering that the caller does not control. When the child wins, the press lands on an
 * object with no handler and is silently swallowed: the control simply stops responding, with nothing
 * in the frame or the console to say why.
 *
 * It is for a *standalone* object — a bare `Text` or `Image` acting as its own button, which is what
 * every correct caller here passes.
 *

 * Ensures an interactive object's tap target is at least `minSize` CSS px square,
 * centered on its current (possibly shrunk by uiScale) bounds — the object may render
 * smaller than that on narrow screens, but stays reliably tappable.
 *
 * Safe to call every `layout()` (including resizes): per Phaser's GameObject docs,
 * re-calling `setInteractive()` on an already-interactive object does NOT recompute
 * its hit area (it just re-enables the existing one) — so once `.input` exists, this
 * mutates the existing hit-area Rectangle in place instead.
 */
export function ensureMinHitArea(obj: Phaser.GameObjects.Text, minSize = MIN_TOUCH_TARGET): void {
  const w = Math.max(obj.width, minSize)
  const h = Math.max(obj.height, minSize)
  const x = (obj.width - w) / 2
  const y = (obj.height - h) / 2

  if (!obj.input) {
    obj.setInteractive({
      hitArea: new Phaser.Geom.Rectangle(x, y, w, h),
      hitAreaCallback: Phaser.Geom.Rectangle.Contains,
      useHandCursor: true,
    })
    return
  }

  ;(obj.input.hitArea as Phaser.Geom.Rectangle).setTo(x, y, w, h)
}
