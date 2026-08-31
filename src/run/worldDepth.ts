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
