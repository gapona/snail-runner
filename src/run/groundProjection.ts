/**
 * Where a thing standing on the road is on screen, interpolated across the segment it stands in.
 *
 * **Rule: this file never imports `phaser`.** It is loaded under plain Node by
 * `scripts/verify-player.mjs`, which is the whole reason it is a module rather than four lines
 * inside `PlayerView`.
 *
 * ## Why it exists: the snail is not attached to its segment
 *
 * A tree stands at a segment's near edge, so `Segment.s1` *is* its ground point. The snail holds a
 * fixed `PLAYER_Z` ahead of the camera: the segment under it changes every `SEGMENT_LENGTH` while
 * its true distance never changes at all. Read off `s1`, its projected scale therefore swings
 * between `D / PLAYER_Z` and `D / (PLAYER_Z - SEGMENT_LENGTH)` and snaps back — **11.3% of its
 * size and screen row, 7 times a second at `SPEED_BASE` and 18 at `SPEED_CAP`.** That was the
 * judder, and it was there running straight too; sideways motion is just where the eye caught it.
 *
 * The fix is to interpolate between the segment's two edges by how far into it the thing actually
 * is. `s2` of one segment is `s1` of the next, so the result is continuous across a boundary, and
 * both already carry the curvature and hill offsets the mesh integrated this frame — which is why
 * this reads them rather than projecting a point of its own.
 *
 * ## ⚠ And the rule that "anything standing on the road does not need this" was wrong
 *
 * That is what this module used to say, and it is true about **judder**: an obstacle's error never
 * changes, so nothing about it moves and no eye can catch it. It is false about **accuracy**. An
 * obstacle's own `z` is anywhere inside its segment while its sprite was drawn from the segment's
 * near edge, so the drawn object could be reasoning about a depth up to one `SEGMENT_LENGTH` from
 * the collision box's — and a lateral offset projects *through* that depth. Measured before the
 * fix, at 1280x720: the drawn lateral position was off by up to **0.095 road half-widths at the
 * road's edge, which is 0.76 of the snail's own half-width.**
 *
 * Invisible while nothing depended on it. It stopped being invisible when a reward began to depend
 * on how close a pass was: a mechanic that pays for clearance cannot stand on a projection whose
 * error is most of the threshold. So everything that stands on the road goes through this now —
 * obstacles, pickups, ramps and the bugs — and the residual is what the "close pass" threshold is
 * *derived* from rather than a number chosen to be safely bigger than a known defect.
 */
import { interpolate, segmentPercent } from '../road/track'

/** The four numbers `billboardRectInto` needs from a ground point. */
export interface GroundPoint {
  x: number
  y: number
  w: number
  scale: number
}

/**
 * Writes a ground projection into `out`, interpolated across the segment the point is in.
 *
 * `worldZ` is the object's own wrapped position along the track. `near`/`far` are the segment's own
 * `s1`/`s2`, already projected by the mesh pass this frame.
 */
export function groundPointInto(
  out: GroundPoint,
  near: GroundPoint,
  far: GroundPoint,
  worldZ: number,
): GroundPoint {
  const percent = segmentPercent(worldZ)

  out.x = interpolate(near.x, far.x, percent)
  out.y = interpolate(near.y, far.y, percent)
  out.w = interpolate(near.w, far.w, percent)
  out.scale = interpolate(near.scale, far.scale, percent)

  return out
}
