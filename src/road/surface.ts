/**
 * The marking painted on the ribbon's surface — pure geometry, no drawing.
 *
 * **Rule: this file never imports `phaser`.** It is loaded directly under plain Node by
 * `scripts/verify-road-projection.mjs` (`npm run verify:road`), same split as `project.ts` and
 * `billboard.ts`: the arithmetic lives here where it can be asserted, and `RoadMesh` does
 * nothing with it but hand the numbers to a quad.
 *
 * Splitting it out is not ceremony. The rung is the one piece of road geometry that is *inset*
 * from the surface it sits on rather than derived from its edges, so it is the one piece that
 * can silently escape onto the ground or merge with a rumble stripe — and a defect like that
 * shows up as "the road looks wrong at speed", which is not a thing anyone can bisect.
 */
import { TRACK_RUNG } from './constants'
import type { ScreenPoint } from './project'

/** The four corners of one rung, in screen space. Named the way `RoadMesh.writeQuad` reads them. */
export interface RungQuad {
  nearY: number
  nearLeftX: number
  nearRightX: number
  farY: number
  farLeftX: number
  farRightX: number
}

/** Allocates a zeroed `RungQuad`, so the render loop can write into it rather than allocate. */
export function createRungQuad(): RungQuad {
  return { nearY: 0, nearLeftX: 0, nearRightX: 0, farY: 0, farLeftX: 0, farRightX: 0 }
}

/**
 * Writes the rung standing on the segment between `s1` (near edge) and `s2` (far edge).
 *
 * The far edge is interpolated in **screen space** at `TRACK_RUNG.DEPTH` of the way between the
 * two projected edges. That is not an approximation of the correct perspective interpolation —
 * it is exactly what the rasteriser does between these same two edges when it fills the asphalt
 * quad, so the rung's back edge lands on the surface it is painted on rather than a fraction of
 * a pixel above or below it.
 *
 * Both the width and the centre are taken from the interpolated edge rather than from `s1`, so a
 * rung narrows with the road through a corner and leans with it instead of staying square to the
 * screen.
 */
export function rungQuadInto(out: RungQuad, s1: ScreenPoint, s2: ScreenPoint): void {
  const t = TRACK_RUNG.DEPTH
  const farY = s1.y + (s2.y - s1.y) * t
  const farX = s1.x + (s2.x - s1.x) * t
  const farW = s1.w + (s2.w - s1.w) * t
  const nearHalf = s1.w * TRACK_RUNG.WIDTH
  const farHalf = farW * TRACK_RUNG.WIDTH

  out.nearY = s1.y
  out.nearLeftX = s1.x - nearHalf
  out.nearRightX = s1.x + nearHalf
  out.farY = farY
  out.farLeftX = farX - farHalf
  out.farRightX = farX + farHalf
}
