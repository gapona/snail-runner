/**
 * The shield, as the player can see it.
 *
 * **⚠ A shield was invisible in every one of the three moments it exists in, and was reported as
 * "the shield's effect cannot be seen at all".** It is the rarest pickup on the road, it is worth
 * more points than anything else, and the whole of its presence in the frame was a `◆` glued onto
 * the front of the coin counter. Specifically:
 *
 * | moment | what the frame said |
 * |---|---|
 * | taking one | the ordinary pickup blip, three semitones down |
 * | holding one | a `◆` in the corner, in the coin readout's own colour |
 * | spending one | **nothing** — the same shake, the same impact, the same blink as losing a life |
 *
 * The third is the one that matters. A shield's entire product is "the next mistake is free", and a
 * mistake that looks and sounds exactly like an expensive one has not been made free in the only
 * place the player can check: the screen.
 *
 * So there are three cues, and they are deliberately three rather than one bigger one — each
 * answers a different question. A **bubble around the snail** says *you are carrying one*, in the
 * one place the player is already looking. **Pips beside the lives** say *how many*, which a bubble
 * cannot. And a **break** — the bubble thrown outward as it fades, in the shield's own green rather
 * than the threat red — says *that is what just happened to it*.
 *
 * **Rule: this file never imports `phaser`** — `npm run verify:player` loads it under Node. The ring
 * texture lives in `shieldArt.ts` for that reason.
 */

/**
 * How far the bubble reaches past the mascot, as a multiple of the snail's own drawn width.
 *
 * Over 1, or it is not a bubble around anything — but not far over: the bubble is drawn between the
 * player and the pickups in `WORLD_LAYER`, so everything it covers is road the player is reading
 * obstacles out of. 1.28 clears the mascot's silhouette by a seventh of its width on every side,
 * which is enough to read as a shell of air and little enough that a rock arriving beside the snail
 * is still met by the snail rather than by the bubble.
 */
export const SHIELD_BUBBLE_SPAN = 1.28

/**
 * How hard the bubble is drawn while it is simply being carried.
 *
 * **The snail is the one object in this game allowed to be saturated** — thirteen times the chroma
 * of anything it shares a frame with, precisely so the player never has to search for it — and a
 * bright ring drawn around it is spending exactly that separation. It is a rim, not a fill: the
 * texture is transparent through the middle (see `shieldArt.ts`), so what is over the mascot is
 * only the edge of the ring.
 */
export const SHIELD_BUBBLE_ALPHA = 0.62

/**
 * The breath: how far the bubble's size and alpha swing, and over what period.
 *
 * **A ring that does not move reads as a decal painted onto the sprite**, which is the failure the
 * sun's own corona was rebuilt to avoid — and this one is worse, because a decal on the mascot
 * looks like part of the mascot and the player has no way to learn it is a state.
 *
 * Two incommensurate periods rather than one, for `SUN_ANIM`'s reason: the eye finds a single
 * sine's period in about three cycles and the thing starts reading as a mechanism. 1700 and 2600
 * have a common multiple of 44.2 seconds, which is longer than a shield ever survives.
 */
export const SHIELD_BREATH = { scale: 0.05, alpha: 0.16, sizePeriodMs: 1700, alphaPeriodMs: 2600 } as const

/**
 * How long the break plays, and how far the ring is thrown.
 *
 * **⚠ Under the grace period a hit buys, measured at the speed that makes it shortest.**
 * `HIT_INVULNERABLE_Z` is a *distance*, so what it is worth in milliseconds depends on how fast the
 * run is going: it is about a second at the speed a run starts at and **248ms at
 * `MAX_ATTAINABLE_SPEED`**. The first version of this was 380ms, i.e. a burst that would still be
 * playing when the player could be hit again — they would be watching a shield they no longer have,
 * at exactly the moment they need to know they have none. `verify:player` measures it against the
 * fast end, not the comfortable one.
 *
 * The ring is thrown *outward* and faded, which is the opposite curve to the shadow's and to the
 * hit flash's: this is a thing coming apart, and the one shape a burst has is expansion.
 */
export const SHIELD_POP = { durationMs: 220, spread: 0.85 } as const

/** `0` before the window, rising to `1` at its end, and clamped at both. */
export function shieldPopProgress(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0

  return Math.min(1, elapsedMs / SHIELD_POP.durationMs)
}

/**
 * How much bigger the breaking ring is than the carried one, at `progress`.
 *
 * Eased *out* — most of the expansion is spent in the first third — so it reads as a burst rather
 * than as a balloon. Same argument, and the same direction, as the impact burst in the rail
 * shooter and the wreck's own swell.
 */
export function shieldPopScale(progress: number): number {
  const t = Math.max(0, Math.min(1, progress))

  return 1 + SHIELD_POP.spread * (1 - (1 - t) * (1 - t) * (1 - t))
}

/**
 * How solid the breaking ring is, at `progress`.
 *
 * Eased *in*, i.e. the mirror of the size: it holds for a beat and then goes. The pair is what
 * makes the break a burst — an alpha that fell as fast as the size grew would be invisible by the
 * time it was big enough to see, which is the defect the shadow's own two terms record from the
 * other side.
 */
export function shieldPopAlpha(progress: number): number {
  const t = Math.max(0, Math.min(1, progress))

  return SHIELD_BUBBLE_ALPHA * (1 - t * t)
}

/** The carried bubble's size multiplier at `nowMs`. Exactly 1 at rest. */
export function shieldBreathScale(nowMs: number): number {
  return 1 + SHIELD_BREATH.scale * Math.sin((nowMs / SHIELD_BREATH.sizePeriodMs) * Math.PI * 2)
}

/** The carried bubble's alpha at `nowMs`. */
export function shieldBreathAlpha(nowMs: number): number {
  return SHIELD_BUBBLE_ALPHA * (1 + SHIELD_BREATH.alpha * Math.sin((nowMs / SHIELD_BREATH.alphaPeriodMs) * Math.PI * 2))
}
