/**
 * How hard the road gets, as a pure function of how far the run has come.
 *
 * **Rule: this file never imports `phaser`.** It is loaded under plain Node by
 * `scripts/verify-obstacles.mjs`, which sweeps the whole curve rather than sampling it.
 *
 * **Distance, never time.** A curve driven by elapsed seconds punishes the player for going
 * slowly — which in this game means punishing them for having been hit, on top of the speed they
 * already lost. Driven by distance, a careful run and a fast one meet the same road at the same
 * point, and going faster simply means meeting it sooner. It also composes with `runState`'s own
 * `distance`, which is already the score, so there is exactly one number the run is measured by.
 *
 * **Four knobs, and the floor is not one of them.** Density, the share of obstacles that cannot be
 * jumped, the share that punish jumping, and how often a row is a *wall* — all four rise and all
 * four saturate. What does *not* move is `REACTION_MS`: the placer's row spacing is floored against
 * it at the fastest speed the game can reach, so no setting these knobs can take produces a row the
 * player was not shown in time. If the curve ever wants something the floor forbids, the curve is
 * what changes.
 *
 * The biomes do the rest for free: the run circuit cycles through eight of them along the track,
 * so a long run *looks* like progress without the difficulty having to carry that job as well.
 */

/**
 * How far the run travels before the curve is 63% of the way to its ceiling, in world units.
 *
 * 90 000 units is 900 metres, which at the speeds a run actually reaches is a little over half a
 * minute of play. Chosen so a first run gets a recognisably easy start and a good run is at the
 * ceiling well before the player is bored of it — the curve is there to stop an endless game from
 * being flat, not to gate anything.
 */
export const DIFFICULTY_TAU_Z = 90_000

export interface Difficulty {
  /** How busy the road is, `0..1`. Feeds `placeObstacles`' spacing, never its floor. */
  density: number
  /** Share of obstacles that cannot be jumped and must be gone around. */
  blockingShare: number
  /** Share that are overhead — run under, and fatal to jump into. */
  overheadShare: number
  /**
   * How often a row is a **wall**: low obstacles across the whole road, passable only by jumping.
   *
   * **This knob exists because the jump was optional without it.** An ordinary row is three
   * obstacles at most on a road seven of them wide, so there is nearly always a line through it on
   * the ground — and a scripted play-through of 443 metres never had to leave the ground once. A
   * runner whose jump button is never *required* is a runner with one verb. A wall is the row that
   * requires it, and `provePassable` still refuses to put anything air-blocking inside the flight
   * it commits the player to.
   */
  wallShare: number
}

/** Where each knob starts and where it saturates. */
const CURVE = {
  density: { from: 0.28, to: 0.92 },
  blockingShare: { from: 0.12, to: 0.34 },
  overheadShare: { from: 0.06, to: 0.24 },
  // Starts high enough that the very first stretch teaches the jump, and rises far less than the
  // others: a road that is mostly walls is a road with one answer, which is the same failure as a
  // road with none.
  wallShare: { from: 0.18, to: 0.3 },
} as const

/**
 * How far along the curve a run at `distance` is, `0..1`.
 *
 * An exponential approach rather than a ramp with an end: a ramp needs a distance at which the
 * game stops getting harder, and any such number is a promise the endless mode cannot keep — a
 * player who passes it finds the road has quietly stopped responding to them. This never quite
 * arrives, and after three time constants the difference is under 5%.
 */
export function difficultyProgress(distance: number): number {
  if (!(distance > 0)) return 0

  return 1 - Math.exp(-distance / DIFFICULTY_TAU_Z)
}

/** The placement parameters for a run that has come `distance` world units. */
export function difficultyAt(distance: number): Difficulty {
  const t = difficultyProgress(distance)
  const lerp = (range: { from: number; to: number }) => range.from + (range.to - range.from) * t

  return {
    density: lerp(CURVE.density),
    blockingShare: lerp(CURVE.blockingShare),
    overheadShare: lerp(CURVE.overheadShare),
    wallShare: lerp(CURVE.wallShare),
  }
}
