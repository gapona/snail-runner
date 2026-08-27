/**
 * What a ground shadow looks like at a given height.
 *
 * **Rule: this file never imports `phaser`** — `npm run verify:jump` loads it under Node.
 *
 * **A shadow here is a height gauge, not lighting.** On a pseudo-3D road there is no other cue for
 * altitude: an object at `y = 300` and one standing on a rise both draw higher up the frame, and
 * the projection cannot tell the player which it is looking at. The ellipse on the ground is the
 * only thing that answers, so every rule below is chosen for how *readable* the height is rather
 * than for what light would actually do.
 *
 * **⚠ The shape is reserved, and that is half of why this module exists.** Soft ragged blobs are
 * `decals.ts` — stains, puddles, scatter — and there are now dozens of them lying across the verge.
 * A shadow drawn as another soft blob is indistinguishable from one, which was reported as shadows
 * lying nowhere near their objects: they were not shadows at all. A shadow is a **hard-edged
 * ellipse**, a decal is a soft irregular patch, and the two are told apart by shape before position
 * ever comes into it.
 */
import { JUMP_APEX } from './constants'

/**
 * Ellipse size on the ground, as fractions of the owner's own drawn footprint.
 *
 * Wider than it is tall by about four to one, which is what a circle on the ground projects to at
 * this camera pitch — the same ratio the road's own quads foreshorten by.
 */
export const SHADOW_FOOTPRINT = { width: 0.82, height: 0.22 } as const

/**
 * How much wider the ellipse gets at `JUMP_APEX`, and how much of its alpha it keeps there.
 *
 * **⚠ This is the reverse of what shipped before, and the reversal is deliberate — but the failure
 * it has to avoid is recorded and real.** The first version scaled size *and* alpha down together:
 * the two multiply, so at the apex the shadow was 41px wide at alpha 0.18 on grey asphalt, i.e.
 * invisible at the one moment its whole job is to report height. The fix then was to stop fading
 * it. The fix now is the physically right one — a shadow spreads and softens as its caster rises —
 * and it is only safe because the two terms now pull *against* each other rather than together.
 *
 * Measured on these constants, total ink (area x alpha, so `scale^2 * alpha`) is **0.42 on the
 * ground and 0.49 at the apex**: the apex shadow is fainter per pixel and covers enough more of
 * them to stay at least as visible. `verify:jump` asserts that, because "wide and weak" and
 * "invisible" differ by exactly this arithmetic and by nothing a screenshot of one frame shows.
 */
export const SHADOW_APEX = { spread: 1.75, alphaKept: 0.38 } as const

/** Alpha of the ellipse when its owner is standing on the ground. */
export const SHADOW_GROUND_ALPHA = 0.42

/**
 * How dark the shadow multiplies the ground under it, as `0..1` of full black.
 *
 * **Drawn with a MULTIPLY blend rather than in a colour of its own, and that is the whole of rule
 * 3.** A grey ellipse on pale sand reads as a puddle — a neutral patch is a *thing lying there*,
 * not an absence of light. Multiplying takes the ground's own colour down instead, so the shadow
 * is sand-coloured on sand and stone-coloured on flagstone with nothing branching on the biome,
 * the theme, the distance fog or which of the five ground shades that segment happens to carry.
 * The compositor does the multiply against the pixels actually on screen, which is stricter than
 * recomputing the palette column here and cannot drift from it.
 */
export const SHADOW_DARKEN = 0.45

/** Never smaller than this share of its ground size, however close to the ground it is. */
const MIN_SCALE = 0.75

/** How far up the ramp is spent. Above this the shadow stops growing. */
const FULL_LIFT = JUMP_APEX

/** `0..1` of the way from the ground to `JUMP_APEX`. */
function lift(y: number): number {
  if (!(FULL_LIFT > 0)) return 0

  return Math.min(1, Math.max(0, y) / FULL_LIFT)
}

/**
 * How much wider the ellipse is drawn than its ground size, at height `y`.
 *
 * Linear in height rather than in the projected distance to the ground: what the player is reading
 * off this is *how high*, and a curve would make the same change of size mean a different number of
 * units at different points of the arc.
 */
export function shadowScale(y: number): number {
  return Math.max(MIN_SCALE, 1 + (SHADOW_APEX.spread - 1) * lift(y))
}

/** How strongly the ellipse multiplies the ground, at height `y`. */
export function shadowAlpha(y: number): number {
  return SHADOW_GROUND_ALPHA * (1 - (1 - SHADOW_APEX.alphaKept) * lift(y))
}

/**
 * Total ink the shadow puts on the ground: area times alpha, in units of its ground value.
 *
 * Not used by the renderer. It exists because "wide and weak" is one arithmetic step away from
 * "gone", the difference is invisible in any single frame, and this project has already shipped the
 * gone version once.
 */
export function shadowInk(y: number): number {
  const scale = shadowScale(y)

  return scale * scale * shadowAlpha(y)
}
