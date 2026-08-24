/**
 * Where the snail's ground point is on screen — the one projection in this game that cannot be
 * read straight off a segment.
 *
 * **Rule: this file never imports `phaser`.** It is loaded under plain Node by
 * `scripts/verify-player.mjs`, which is the whole reason it is a module rather than four lines
 * inside `PlayerView`.
 *
 * **Every other billboard is attached to its segment; the snail is not.** A tree stands at a
 * segment's near edge, so `Segment.s1` *is* its ground point and drawing it there is exact. The
 * snail holds a fixed `PLAYER_Z` ahead of the camera: the segment under it changes every
 * `SEGMENT_LENGTH` while its true distance never changes at all. Read off `s1`, its projected
 * scale therefore swings between `D / PLAYER_Z` and `D / (PLAYER_Z - SEGMENT_LENGTH)` and snaps
 * back — **11.3% of its size and screen row, 7 times a second at `SPEED_BASE` and 18 at
 * `SPEED_CAP`.** That was the judder, and it was there running straight too; sideways motion is
 * just where the eye could see it.
 *
 * The fix is to interpolate between the segment's two edges by how far into it the snail actually
 * is. `s2` of one segment is `s1` of the next, so the result is continuous across a boundary, and
 * both already carry the curvature and hill offsets the mesh integrated this frame — which is why
 * this reads them rather than projecting a point of its own.
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
 * Writes the snail's ground projection into `out`, interpolated across the segment it is over.
 *
 * `worldZ` is the snail's own wrapped position along the track — `wrapZ(cameraZ + PLAYER_Z)`.
 * `near`/`far` are the segment's own `s1`/`s2`, already projected by the mesh pass this frame.
 */
export function playerGroundInto(
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
