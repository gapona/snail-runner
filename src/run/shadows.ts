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
 *
 * **⚠ 0.62, down from 0.82, because at 0.82 a shadow could be WIDER THAN THE THING CASTING IT.**
 * `SHADOW_APEX.spread` reaches 1.75, so the product reached **1.44** — measured in the running
 * game, an `overhead` 266px wide drew a 290px ellipse, which is not a mark under an object, it is
 * a second object. That is the same failure the previous two rounds were about, arrived at from a
 * third direction: a patch on the ground has to read as belonging to something, and one bigger
 * than its owner does not.
 *
 * At 0.62 the widest a shadow ever gets is **1.08x** its caster (the snail at `JUMP_APEX`) and an
 * `overhead` sits at **1.01x**. The cost is that a shadow on the ground is 0.62 of its object's
 * width rather than 0.82 — tucked under it rather than spread around it.
 *
 * **Nothing in `verify:jump` moved for this, and that is not luck**: `shadowInk` is measured in
 * units of the ground shadow, so both terms carry the same footprint and it cancels. What this
 * constant scales is the whole family at once, which is why it is the one safe place to make a
 * shadow smaller.
 */
export const SHADOW_FOOTPRINT = { width: 0.62, height: 0.166 } as const

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

/**
 * How much of its shadow an object keeps at `height`, from the link between mark and object alone.
 *
 * **⚠ A shadow only says "something is above this spot" while the eye can still pair the two, and
 * this is the rule that was missing.** Everything else in this file varies how the ellipse *looks*
 * with height; nothing asked how far from its object the ellipse ends up. Measured in the running
 * game over 33 185 drawn shadows, the gap between a mark and the thing casting it runs:
 *
 * ```
 * pickups on the ground line   0.17 - 0.23 of the object's own drawn height   reads as a pair
 * overhead obstacles           0.90                                          reads as a pair
 * pickups on a ramp arc        up to 2.06                                    reads as an orphan
 * ```
 *
 * The worst case was a coin 416px wide drawn with a 597px ellipse **847px below it on a 945px
 * frame** — the object at the top of the screen, its mark at the bottom, and nothing linking them.
 * Reported exactly as it looks: the shadow of a thing is visible where the thing is not. It is not
 * a pool desync — the same measurement found **0 orphans in 38 344 draws**, every mark had a live
 * owner — so the fix is not about pools, it is about how far a mark may be from its object.
 *
 * Full strength up to `fullUpTo`, nothing at all past `goneBy`, smoothstep between so a chain does
 * not have a hard on/off between two adjacent members. Smoothstep rather than linear for the reason
 * `billboardAppear` gives: a linear ramp has a corner at each end, and the corner at the top is
 * exactly the discontinuity the eye catches.
 *
 * **Who this is applied to is each pool's own decision, not this file's**, exactly as "only an
 * `overhead` casts one" is `ObstacleSprites`' — because what counts as "too far to pair" depends on
 * what the object is. The snail is the one object the player is already tracking, so its mark is
 * paired by the tracking rather than by the distance, and it keeps its shadow through a whole ramp
 * flight; a coin in an arc is one of several identical small things nobody is tracking, and its
 * airborne-ness is already told by the shape of the chain and by the ramp it comes off.
 */
export function shadowLinkFade(height: number, fullUpTo: number, goneBy: number): number {
  if (!(goneBy > fullUpTo)) return height <= fullUpTo ? 1 : 0
  if (height <= fullUpTo) return 1
  if (height >= goneBy) return 0

  const t = (height - fullUpTo) / (goneBy - fullUpTo)

  return 1 - t * t * (3 - 2 * t)
}

/**
 * How much of its shadow a ground mark keeps, given the hill in front of it.
 *
 * **⚠ A shadow lies IN the ground plane, so it is clipped by `clipY` like anything else standing
 * on that segment — and nothing was clipping it.** `billboardVisibleFraction` was applied to the
 * sprite and to the sprite only: the pools cropped the object against the crest and then drew its
 * mark through the hillside at full strength. Measured in the running game over **63 758 on-screen
 * shadow draws: 6 271 (10.6%) were drawn with their ground point behind a crest**, and **1 171
 * (1.8%) were drawn while the object above them was less than 35% visible**. Worst case, an
 * `overhead` **1% visible** with a 59px ellipse **21px past the clip line** — reported exactly as
 * it looks: climbing a rise, you see the shadow of a thing you cannot see yet.
 *
 * It is the crest's own ordering that makes this the visible half rather than a technicality. A
 * hill hides a billboard from the bottom up, so the object's top emerges *first* and the ground
 * beneath it emerges *last* — the mark is precisely the part that should still be hidden, and it
 * was the part that never was.
 *
 * **⚠ The test is the mark's CENTRE against `clipY`, never its extent, and the first version of
 * this check got that wrong.** `RoadMesh` records `clipY[n]` as the running horizon clip *before*
 * the cull, and on flat road that is exactly segment `n`'s own ground row — so an ellipse centred
 * on the ground straddles the clip line by construction and an extent test reports every mark in
 * the game as half hidden. The centre is the ground point; the ground point is what a hill either
 * covers or does not.
 *
 * Faded rather than cropped because a `Shape` has no crop component, and because the band is the
 * ellipse's own half-height — a few pixels — so what the fade buys over a hard cut is only that
 * the mark does not pop as the crest crosses it.
 */
export function shadowClipFade(groundY: number, drawnHeight: number, clipY: number): number {
  const hidden = groundY - clipY

  if (hidden <= 0) return 1

  const band = Math.max(1, drawnHeight / 2)

  if (hidden >= band) return 0

  const t = hidden / band

  return 1 - t * t * (3 - 2 * t)
}
