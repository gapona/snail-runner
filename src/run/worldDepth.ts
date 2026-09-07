/**
 * One depth scale for everything standing in the world.
 *
 * **Rule: this file never imports `phaser`.** It is loaded under plain Node by
 * `scripts/verify-obstacles.mjs`, which asserts the ordering rather than trusting it.
 *
 * **There is no depth buffer here.** The whole renderer is painter's-order: what is drawn last is
 * on top, and the only lever is `GameObject.depth`. `RoadSprites` has always got this right —
 * `setDepth(-distanceIndex)` every frame, so a nearer prop paints over a farther one — but the
 * obstacle and pickup pools set their depth **once, in the constructor**, to a single flat number.
 *
 * Every object in a pool therefore sorted equal, and equal depth falls back to display-list order,
 * which is pool-slot order, which is the order the render loop fills them: **near to far.** So the
 * farthest obstacle was added last and painted last — over everything nearer than it. Measured in
 * the running game: the nearest obstacle at screen y 805 sat at list index 134 and the farthest at
 * y 576 sat at 147, with both at depth 999. Pickups shared that same 999 and came after every
 * obstacle, so a coin fifty segments out drew over a boulder about to arrive.
 *
 * That is what "the textures ride over each other" was. The fix is not a special case per pool: it
 * is that **anything drawn in the world sorts on the same axis, in the same units the road already
 * uses** — distance from the camera in segments, negated.
 */

import { segmentPercent } from '../road/track'

/**
 * Per-category tiebreaks, in fractions of a segment.
 *
 * **Every one is below 1, and that is the property that matters**: distance always dominates, and
 * these only decide what happens between two things on the *same* segment — where the answer is
 * genuinely arbitrary but must at least be stable, or two objects at one distance flicker against
 * each other as the pool reorders.
 *
 * The order encodes what should win a tie: a pickup is a small bright thing that must never be
 * hidden by the boulder it is sitting beside, the snail sits between the two, and scenery — which
 * stands off the road rather than on it — loses to all of them.
 */
export const WORLD_LAYER = {
  scenery: 0,
  /**
   * **⚠ Below everything solid, not just below the snail.** This was 0.35 — above `obstacle` —
   * back when the only shadow in the game belonged to the player and the only thing it had to sit
   * under was the player. Pickups and overhead obstacles cast one now, and a shadow lies *on the
   * ground*: anything standing on that ground at the same distance has to paint over it, or a
   * boulder gets a dark ellipse laid across its foot.
   */
  shadow: 0.15,
  obstacle: 0.3,
  /**
   * A bug, above the barriers and below the snail.
   *
   * **It needs a slot of its own rather than sharing `obstacle`'s, and the reason is that it
   * moves.** Two things at the same depth fall back to display-list order, which is pool-slot
   * order — stable for two rocks, and not stable at all for a rock and a creature walking past it,
   * because the creature changes segments while the rock does not. A slot of its own makes the
   * answer a fact about the two objects instead of a fact about which pool filled first.
   *
   * Above `obstacle` because a bug runs *in front of* the barriers standing on its segment rather
   * than behind them; below `player`, because the snail is the object the player is tracking and
   * nothing may draw over it on its own row.
   */
  critter: 0.35,
  /**
   * A flyer's wings, just under its body.
   *
   * They are drawn BEHIND the creature: a wing sweeping across the thorax reads as a separate
   * object stuck to the front of it, and the references all draw them behind. Its own slot rather
   * than sharing `critter`'s, for the reason every tiebreak here exists -- two objects at one depth
   * fall back to pool order, which is stable for two bodies and not at all stable for a wing and
   * the body it belongs to.
   */
  critterWing: 0.34,
  player: 0.4,
  pickup: 0.5,
} as const

/**
 * The depth to draw something at, given how far away it is in segments.
 *
 * `distanceIndex` need not be a whole number — the snail's is `PLAYER_Z / SEGMENT_LENGTH` = 9.83,
 * which is exactly the point: it is not on a segment boundary, and its depth has to place it
 * *between* the obstacle one segment behind it and the one ahead. Negated because nearer must
 * paint later, and `RoadSprites` established that sign.
 */
export function worldDepth(distanceIndex: number, layer: number): number {
  return -distanceIndex + layer
}

/**
 * Where an object sorts, given the segment it is in and its own position along the track.
 *
 * **⚠ Every pool used to answer this differently, and two of the answers were a whole segment
 * apart.** The obstacle, pickup and ramp pools passed the bare segment index `n` — so an obstacle
 * anywhere inside a segment sorted as though it stood on that segment's near edge — while the
 * critter pool and `PlayerView` passed a *continuous* distance measured from the **camera**, which
 * is a different origin again: the camera stands some way into its own base segment, and `n` counts
 * from that segment's near edge rather than from the camera.
 *
 * Two errors compounding, and measured on the shipped constants: **a critter was drawn in front of
 * an obstacle up to 208 world units BEHIND it, and behind one up to 189 units IN FRONT of it.** A
 * segment is 200 units and a flyer is 686–1050 units wide, so a bee passing a barrier drew straight
 * through it — reported three times as seeing the wings through the textures, which is exactly what
 * a sprite sorted a segment out of place looks like.
 *
 * The fix is that there is one answer: **the origin is the base segment's near edge and the unit is
 * a segment**, so an object's index is how many whole segments it is past that edge plus how far it
 * stands into its own. Everything the camera can see is measured the same way, so no two pools can
 * disagree — and because a common offset shifts every depth equally, it does not matter that the
 * camera itself is not the origin, only that nobody uses a different one.
 *
 * `segmentsAhead` is the object's segment minus the base segment; `worldZ` is its own wrapped
 * position along the track.
 */
export function distanceIndexOf(segmentsAhead: number, worldZ: number): number {
  return segmentsAhead + segmentPercent(worldZ)
}

/**
 * How much of a segment the scenery's own tiebreak may use.
 *
 * Under 1, like every `WORLD_LAYER` entry and for the same reason: the segment a prop stands on
 * always decides first, and this only orders two props standing on the *same* one.
 */
export const SCENERY_TIEBREAK = 0.9

/**
 * Where a prop sorts, given its segment, how far out it stands and where it fell in the segment's
 * own list.
 *
 * **⚠ `RoadSprites` used a bare `-distanceIndex` and every prop on one segment therefore tied.**
 * That is the exact defect this file was written for, left unfixed in the one pool it did not
 * touch: equal depth falls back to display-list order, which is pool-slot order, which changes as
 * the visible set changes — so which of two overlapping props is in front flickered frame to frame.
 *
 * It went unnoticed while scenery was a row of small things along the verge and became obvious the
 * moment `DECOR_TIERS.near` started drawing props 200 pixels wide close to the camera: a pair of
 * them tied at depth -29 in a measured frame, spanning most of the road between them. Reported as
 * "the barriers change which is in front and which is behind as we move" — and they are not
 * barriers at all, which is its own finding.
 *
 * **The tiebreak is `|offsetX|`, and it is the physically true answer rather than an arbitrary
 * stable one.** The camera rides the centreline, so of two props on one segment the one further out
 * really is further away; sorting it behind is what the projection would do if this renderer had a
 * depth buffer. The list index only separates the mirror case — two props the same distance either
 * side — and is a hundredth of the lateral term so it can never overrule it.
 */
export function sceneryDepth(
  distanceIndex: number,
  offsetX: number,
  indexInSegment: number,
  maxOffset: number,
): number {
  const lateral = Math.min(1, Math.abs(offsetX) / Math.max(1e-6, maxOffset))
  const bias = lateral * SCENERY_TIEBREAK * 0.98 + ((indexInSegment % 8) / 8) * SCENERY_TIEBREAK * 0.02

  return worldDepth(distanceIndex + bias, WORLD_LAYER.scenery)
}
