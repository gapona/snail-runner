/**
 * The perspective projection behind the pseudo-3D road — pure math, and the only part of
 * the renderer that is unit-testable on its own.
 *
 * **Rule: this file never imports `phaser`.** It is imported directly by
 * `scripts/verify-road-projection.mjs` under plain Node (`npm run verify:road`), and a
 * value import of Phaser executes its init code, which reads `window`.
 */
import { HORIZON_Y } from './constants'

/** A point in track space: `x` across the road, `y` height, `z` along the track. */
export interface WorldPoint {
  x: number
  y: number
  z: number
}

/** A projected point: screen position, projected road half-width, and the scale factor. */
export interface ScreenPoint {
  x: number
  y: number
  w: number
  scale: number
}

/** Allocates a zeroed `ScreenPoint`, for a `Segment`'s reusable per-frame slots. */
export function createScreenPoint(): ScreenPoint {
  return { x: 0, y: 0, w: 0, scale: 0 }
}

/**
 * Projects `point` into screen space, writing the result into `out`.
 *
 * This in-place form exists because the renderer projects `DRAW_DISTANCE * 2` points every
 * frame; returning a fresh object each time (as `project` does) would allocate 600 short-
 * lived objects per frame purely for the GC to collect. `Segment` carries its own `s1`/`s2`
 * slots so the render loop can write straight into them.
 *
 * `scale` is left non-finite when the point sits exactly on the camera plane
 * (`point.z === cameraZ`), which happens on the very first frame at `cameraZ === 0`.
 * Callers must reject a non-finite scale, not just a negative one.
 */
export function projectInto(
  out: ScreenPoint,
  point: WorldPoint,
  cameraX: number,
  cameraY: number,
  cameraZ: number,
  cameraDepth: number,
  screenWidth: number,
  screenHeight: number,
  roadWidth: number,
): ScreenPoint {
  const scale = cameraDepth / (point.z - cameraZ)

  out.scale = scale
  out.x = screenWidth / 2 + (scale * (point.x - cameraX) * screenWidth) / 2
  // `HORIZON_Y` rather than a centred `screenHeight / 2`: as `scale` goes to zero this term is
  // all that is left, so it *is* the vanishing row. Shifting it is exactly equivalent to tilting
  // the camera, and it deliberately touches only y — a horizontal shift would swing the road's
  // centreline off the middle of the screen, which is a different (and unwanted) camera move.
  out.y = screenHeight * HORIZON_Y - (scale * (point.y - cameraY) * screenHeight) / 2
  out.w = (scale * roadWidth * screenWidth) / 2

  return out
}

/**
 * Projects `point` into a freshly allocated `ScreenPoint`.
 *
 * Convenience/tested form of `projectInto`. The render loop uses `projectInto` instead —
 * see its note on why.
 */
export function project(
  point: WorldPoint,
  cameraX: number,
  cameraY: number,
  cameraZ: number,
  cameraDepth: number,
  screenWidth: number,
  screenHeight: number,
  roadWidth: number,
): ScreenPoint {
  return projectInto(
    createScreenPoint(),
    point,
    cameraX,
    cameraY,
    cameraZ,
    cameraDepth,
    screenWidth,
    screenHeight,
    roadWidth,
  )
}

/**
 * Wraps a track-space `z` into `[0, trackLength)`.
 *
 * The track loops, so both ends need handling: a camera driven past the end wraps back to
 * the start, and (once chunk 3 lets the player be pushed backwards) a negative `z` must wrap
 * to the *end*, not clamp to zero. The double-modulo form also normalises `-0` to `0`.
 */
export function wrapZ(z: number, trackLength: number): number {
  if (!(trackLength > 0)) return 0

  return ((z % trackLength) + trackLength) % trackLength
}
