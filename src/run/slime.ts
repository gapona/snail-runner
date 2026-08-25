/**
 * The slime trail: where the snail has been, and how fast it was going when it was there.
 *
 * **Rule: this file never imports `phaser`.** It is loaded under plain Node by
 * `scripts/verify-player.mjs`. The Phaser half is `SlimeTrail.ts`.
 *
 * **The trail is a record of the player's own line, and that is the whole reason it earns its
 * place.** Everything else in the frame tells the player what is *coming*; this is the only thing
 * that tells them what they just did. On a bend it curves with the road, so a clean line through a
 * row of obstacles is visible behind them as a clean line — which is a kind of feedback a runner
 * usually has no way to give.
 *
 * **It is also the speed gauge.** `SPEED_BASE` to `SPEED_CAP` is a factor of 2.5, and the ground
 * texture alone does not sell that; a trail that gets wider and brighter as the run accelerates
 * does, and it does it *in the world* rather than as a number in the corner. The plan called this
 * "slime as the visual trace of acceleration" and it is the one HUD element that is not in the HUD.
 *
 * **Where it is on screen is a consequence of the geometry, and a lucky one.** The camera sits
 * `PLAYER_Z` *behind* the snail, so slime laid at the snail flows *towards* the viewer and passes
 * the camera about a second later. It occupies the near band under the snail — the part of the road
 * a run deliberately leaves empty — and nothing else competes for those rows.
 */
import { PLAYER_HALF_WIDTHS, PLAYER_Z, SPEED_BASE, SPEED_CAP } from './constants'
import { wrapZ } from '../road/project'

export interface SlimePoint {
  /** Where on the track this was laid, in world units. */
  z: number
  /** Where across the road, in half-widths — the snail's own line at that moment. */
  offsetX: number
  /** Half the trail's width here, in half-widths. Wider the faster the snail was going. */
  halfWidth: number
  /** How strongly it was laid, `0..1`. Brighter the faster the snail was going. */
  strength: number
}

/**
 * How far the snail travels between one blob of slime and the next, in world units.
 *
 * **Spaced by distance, not by time**, the same rule the glide cycle follows: a time-spaced trail
 * would thin out exactly when the run got fast, which is precisely backwards for something whose
 * job is to express speed. 60 units puts a point every third of a segment, which at the widths
 * below overlaps into a continuous ribbon rather than a dotted line.
 */
export const SLIME_SPACING_Z = 60

/**
 * The ceiling on retained points.
 *
 * `PLAYER_Z / SLIME_SPACING_Z` is 33 — the number alive at any moment, since a point is culled as
 * it passes the camera. The extra few absorb a frame that lays two at once after a long delta.
 */
export const SLIME_MAX_POINTS = 40

/** How wide the trail is at a standstill and at full speed, in half-widths. */
export const SLIME_HALF_WIDTH = { slow: PLAYER_HALF_WIDTHS * 0.4, fast: PLAYER_HALF_WIDTHS * 0.85 } as const

/**
 * How strongly it is laid at a standstill and at full speed.
 *
 * **Raised from 0.22/0.72 after measuring what is actually on screen.** The visible ribbon is only
 * the band from the snail down to the bottom edge — everything nearer than about 1100 units
 * projects below the frame — so at the old values the *whole* visible trail sat at alpha 0.37 and
 * read as a smudge. These are the numbers for the part the player can see.
 */
export const SLIME_STRENGTH = { slow: 0.32, fast: 0.82 } as const

/**
 * How close to the camera a point may come before it is dropped, in world units.
 *
 * **Not a look decision — an arithmetic one.** The projected width of a point goes as `1 / ahead`,
 * so a point at `ahead = 5` fills a quad thousands of pixels across. Measured at `ahead = 164`: 668
 * pixels wide, entirely below the frame, and pure wasted fill. Culling at 150 costs nothing visible
 * on any aspect this game supports, and `slimeFade` takes the edge off the cull.
 */
export const SLIME_NEAR_CULL_Z = 150

/**
 * How much of the run's speed range is expressed, given a speed.
 *
 * Clamped above 1 rather than at it: a boost pushes past `SPEED_CAP`, and the trail is the clearest
 * place in the frame to show that the player is going faster than the game's own ceiling.
 */
export function slimeIntensity(speed: number): number {
  const range = SPEED_CAP - SPEED_BASE

  if (!(range > 0)) return 0

  return Math.max(0, Math.min(1.25, (speed - SPEED_BASE) / range))
}

/**
 * Lays new slime and drops what has passed the camera. Mutates `points` in place.
 *
 * **In place, like `debris.ts`**, and for the same reason: this runs every frame over a few dozen
 * entries, and returning a fresh array would allocate one per frame for the garbage collector to
 * take back. The rest of `src/run/` is pure because the rest of `src/run/` is state a scene
 * replaces; a pool is not.
 *
 * `distance` is the run's own unwrapped distance, which is what decides *when* to lay — using the
 * wrapped `z` would lay nothing for a whole lap after the seam and then a burst.
 */
export function stepSlime(
  points: SlimePoint[],
  distance: number,
  cameraZ: number,
  offsetX: number,
  speed: number,
  trackLength: number,
): void {
  // **Culled from the front, because points are laid in order and pass the camera in order.** A
  // point's distance ahead of the camera only ever shrinks; once it has gone past, `wrapZ` reports
  // it as almost a whole lap ahead, which is the cheapest possible test for "behind us".
  while (points.length > 0 && wrapZ(points[0].z - cameraZ, trackLength) > PLAYER_Z + SLIME_SPACING_Z) {
    points.shift()
  }

  const playerZ = cameraZ + PLAYER_Z
  const last = points[points.length - 1]

  // Nothing to do until the snail has travelled far enough for the next blob. Compared against the
  // *laid* position rather than a stored timestamp so a stalled frame cannot lay a burst.
  if (last && Math.abs(wrapZ(playerZ - last.z, trackLength)) < SLIME_SPACING_Z) return

  const intensity = slimeIntensity(speed)

  points.push({
    z: wrapZ(playerZ, trackLength),
    offsetX,
    halfWidth: SLIME_HALF_WIDTH.slow + (SLIME_HALF_WIDTH.fast - SLIME_HALF_WIDTH.slow) * Math.min(1, intensity),
    strength: SLIME_STRENGTH.slow + (SLIME_STRENGTH.fast - SLIME_STRENGTH.slow) * Math.min(1, intensity),
  })

  // The cap is a backstop, not the mechanism — the cull above is what normally bounds this.
  while (points.length > SLIME_MAX_POINTS) points.shift()
}

/**
 * How visible a point is, given how far ahead of the camera it still is.
 *
 * **Two ramps, because they answer two different questions, and the first version only had one.**
 *
 * `drying` is the look: slime is wettest where it was just laid, so the ribbon is brightest under
 * the snail and duller as it streams away. **It has to be scaled against `PLAYER_Z` and not against
 * some fraction of it** — the visible band is only `ahead` roughly 1100 to 1966, everything nearer
 * projects below the frame, so a ramp that finished before 1100 dimmed the part nobody sees and
 * left the visible ribbon flat. That was the first version, and it read as painted road marking
 * rather than as something wet.
 *
 * `cullRamp` is the guard: it takes a point out over the 300 units above `SLIME_NEAR_CULL_Z` so it
 * does not blink out of existence when it is dropped. Off screen on every aspect this game
 * supports, and cheap insurance if that ever stops being true.
 */
export function slimeFade(aheadZ: number): number {
  if (!(aheadZ > SLIME_NEAR_CULL_Z)) return 0

  const cullRamp = Math.min(1, (aheadZ - SLIME_NEAR_CULL_Z) / (PLAYER_Z * 0.15))
  const drying = 0.5 + 0.5 * Math.min(1, aheadZ / PLAYER_Z)

  return cullRamp * drying
}
