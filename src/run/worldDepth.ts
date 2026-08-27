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
