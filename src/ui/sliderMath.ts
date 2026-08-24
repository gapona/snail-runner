/**
 * The arithmetic behind a slider: where a value sits on a track, and what a pointer at some x
 * means.
 *
 * **Rule: this file never imports `phaser`** — `npm run verify:ui` loads it under Node.
 *
 * Small enough to be tempting to inline, and exactly the kind of thing that is wrong in a way
 * nobody notices: an off-by-a-half-handle slider still moves, still reaches both ends, and simply
 * never quite agrees with the number printed beside it. Written once, asserted once.
 */

/**
 * How many steps a slider snaps to.
 *
 * **Snapping is not a nicety here, it is what makes the readout honest.** A continuous slider
 * beside a percentage shows the player 63%, then 64% for a pixel of travel, and there is no
 * gesture on a touchscreen that can deliberately produce either. Twenty steps of 5% is what a
 * finger can actually aim at, and it is also what makes "the same volume as last time" reachable.
 */
export const SLIDER_STEPS = 20

/** Snaps `value` (`0..1`) to the nearest step, clamped. */
export function snapValue(value: number, steps = SLIDER_STEPS): number {
  if (!Number.isFinite(value)) return 0

  const clamped = value < 0 ? 0 : value > 1 ? 1 : value

  return Math.round(clamped * steps) / steps
}

/**
 * The value a pointer at `x` selects, on a track running from `left` to `left + width`.
 *
 * `handle` is the handle's full width: the usable travel is the track minus one handle, because
 * the handle's *centre* cannot reach the very ends without half of it hanging off. Ignoring that
 * is the classic slider bug — the value saturates a few pixels before the end of the track, so the
 * player can see space left to drag into and nothing happens when they do.
 */
export function valueFromX(x: number, left: number, width: number, handle = 0): number {
  const travel = Math.max(1, width - handle)
  const start = left + handle / 2

  return snapValue((x - start) / travel)
}

/** Where the handle's centre goes for `value`. The exact inverse of `valueFromX`. */
export function xForValue(value: number, left: number, width: number, handle = 0): number {
  const travel = Math.max(1, width - handle)
  const start = left + handle / 2

  return start + snapValue(value) * travel
}

/** One step of keyboard or wheel adjustment, in the given direction. */
export function stepValue(value: number, direction: number, steps = SLIDER_STEPS): number {
  if (direction === 0) return snapValue(value)

  return snapValue(snapValue(value) + Math.sign(direction) / steps)
}

/** The percentage a slider shows beside itself. Rounded the same way the snap rounds. */
export function percentFor(value: number): number {
  return Math.round(snapValue(value) * 100)
}
