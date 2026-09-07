/**
 * A critter clears what is standing in front of it instead of walking through it.
 *
 * **Rule: this file never imports `phaser`** — it is arithmetic, and `npm run verify:critters`
 * loads it under Node.
 *
 * ── ⚠ Reported by pointing at a frame: the bugs go through the barriers ────────────────────────
 *
 * Nothing ever connected the two. Obstacles belong to a *piece of road* — laid a lap at a time and
 * filed under the segment they stand on — while a critter is a population walking against the
 * traffic, spawned ahead of the camera and retired behind it (see `critters.ts`). Neither system
 * had ever been told the other existed, so a frog crossed a boulder and a bee crossed a barrier
 * panel, and the frame said the two objects were not in the same world.
 *
 * The fix asked for was *"let them jump over them the way we do, with the same animation, just
 * higher"*, and that is exactly what this is: the crouch, the arc and the landing are
 * `critterJump.ts`'s, unchanged, driven from a different clock at a different height.
 *
 * ── The arc is SOLVED from what has to be cleared, never chosen ────────────────────────────────
 *
 * A per-kind vault height would be a table somebody has to keep in step with `OBSTACLE_BANDS`, and
 * it would go out of step the first time a band moved. What the creature actually needs is to be
 * above the thing's top as it passes it, so the apex is that height and the launch follows from the
 * game's one gravity — the discipline `JUMP_APEX`, `RAMP_APEX` and `HOP_APEX` are all under.
 *
 * That makes the height a consequence of the obstacle rather than of the creature: a frog clearing
 * a `low` block rises 230 units and the same frog clearing a `blocking` panel rises 620, because
 * that is what those two things are. Neither number is written down anywhere here.
 *
 * ── ⚠ It changes what the creature LOOKS like and never what it can do ─────────────────────────
 *
 * The same rule the hop is under, and it matters more here: the collision band in `CRITTER_KINDS`
 * is never consulted and never moved, so a bee vaulting a barrier is hit at exactly the height a
 * bee is always hit at. A hitbox that rose over every barrier would be a hazard whose answer
 * changes depending on what it happens to be standing next to, which no player could read — and it
 * would quietly break the two safety proofs `verify:critters` makes about the ground line and the
 * air line.
 *
 * It is also why nothing here is a *decision* the creature makes. `stepCritters` still takes three
 * arguments and still cannot steer; this is a drawing that reads the road, in the layer where the
 * hop already lives.
 */

import type { Critter } from './critters'
import type { Obstacle } from './obstacles'
import { CROUCH_MS, GROUNDED_POSE, cycleMsFor, flightMsFor, poseAtPhase } from './critterJump'
import type { HopPose } from './critterJump'
import { JUMP_GRAVITY } from './constants'
import { SEGMENT_LENGTH } from '../road/constants'

/**
 * Daylight over the thing being cleared, as a fraction of the creature's own height.
 *
 * A fraction rather than a fixed number of units, so a big creature clears by more than a small
 * one and the gap reads as the same gap at every size — the same reasoning `BEE_CLEARANCE` states
 * for the daylight under a flyer, which is what makes a gap *legible* rather than merely present.
 */
export const VAULT_CLEARANCE = 0.3

/**
 * How deep the thing being crossed is, in world units.
 *
 * A billboard occupies the segment it stands on, so this is `SEGMENT_LENGTH` — the same 200 units
 * `resolveObstacles` sweeps a hit across. It is used only to put the apex over the middle of the
 * obstacle rather than over its near edge; at this depth the difference is a tenth of a hop.
 */
export const VAULT_DEPTH_Z = SEGMENT_LENGTH

export interface VaultTarget {
  /** How far the creature still has to travel to be over the obstacle's middle. Negative once past. */
  readonly gapZ: number
  /** The top of what has to be cleared, in world units. */
  readonly top: number
  /** The launch speed that puts the apex over it, solved from the game's one gravity. */
  readonly launchV: number
}

/** A creature's own numbers, so this module needs nothing from the kind table. */
export interface VaultBody {
  readonly trackZ: number
  readonly offsetX: number
  readonly halfWidths: number
  readonly yLow: number
  readonly yHigh: number
  readonly speed: number
}

/**
 * The signed distance from `from` to `to` around a loop, in `(-length/2, length/2]`.
 *
 * ⚠ An unsigned wrapped gap is the obvious thing and it loses the landing: the instant the creature
 * passes the obstacle the gap jumps from nearly zero to nearly a whole lap, so the recovery half of
 * the animation would be cut off mid-air. Signed, "just behind me" is a small negative rather than
 * an enormous positive.
 */
export function signedGap(from: number, to: number, length: number): number {
  const half = length / 2

  return ((((from - to + half) % length) + length) % length) - half
}

/**
 * The obstacle this creature is dealing with, or `null` if it has nothing to clear.
 *
 * **Chosen by nearness, not by height.** A creature crossing a low block with a tall panel just
 * behind it is answering the block first; picking the tallest would start the arc for something it
 * has not reached and drop it straight onto the near one.
 */
export function vaultTarget(
  body: VaultBody,
  obstacles: readonly Obstacle[],
  trackLength: number,
): VaultTarget | null {
  if (!(body.speed > 0) || !(trackLength > 0)) return null

  const height = Math.max(1, body.yHigh - body.yLow)
  let best: VaultTarget | null = null
  let nearest = Infinity

  for (const obstacle of obstacles) {
    // Nothing to clear: the creature already passes over it. A bee's band starts above every `low`
    // block in the game, so this is the branch that keeps a flyer flying level over most of a lap.
    if (obstacle.yHigh <= body.yLow) continue

    const lateral = Math.abs(body.offsetX - obstacle.offsetX)

    if (lateral >= obstacle.halfWidths + body.halfWidths) continue

    const gapZ = signedGap(body.trackZ, obstacle.z + VAULT_DEPTH_Z / 2, trackLength)
    const apex = obstacle.yHigh + VAULT_CLEARANCE * height - body.yLow
    const launchV = Math.sqrt(2 * JUMP_GRAVITY * apex)
    const phase = phaseFor(gapZ, body.speed, launchV)

    // Outside its own animation: either the launch has not come round yet or the landing is over.
    if (phase < 0 || phase > cycleMsFor(launchV)) continue

    const distance = Math.abs(gapZ)

    if (distance < nearest) {
      nearest = distance
      best = { gapZ, top: obstacle.yHigh, launchV }
    }
  }

  return best
}

/**
 * Where the animation is, given how far the creature still has to travel to the obstacle's middle.
 *
 * The apex is at the middle of the flight by definition, so the launch has to happen half a flight
 * *before* the creature gets there — that is the whole of the timing, and it is why nothing here
 * needs a trigger, a flag or a stored decision. The creature's distance to the thing IS its phase.
 */
export function phaseFor(gapZ: number, speed: number, launchV: number): number {
  const flight = flightMsFor(launchV)
  const toCentreMs = (gapZ / speed) * 1000

  return CROUCH_MS + flight / 2 - toCentreMs
}

/** The pose a creature is in for whatever it is clearing, or `null` when it is clearing nothing. */
export function vaultPose(
  body: VaultBody,
  obstacles: readonly Obstacle[],
  trackLength: number,
  tuckAbove = Infinity,
): HopPose | null {
  const target = vaultTarget(body, obstacles, trackLength)

  if (!target) return null

  const posed = poseAtPhase(phaseFor(target.gapZ, body.speed, target.launchV), target.launchV, tuckAbove)

  return posed === GROUNDED_POSE ? null : posed
}

/** The creature's own numbers, read off the live record. */
export function vaultBodyOf(critter: Critter, trackZ: number, speed: number): VaultBody {
  return {
    trackZ,
    offsetX: critter.offsetX,
    halfWidths: critter.halfWidths,
    yLow: critter.yLow,
    yHigh: critter.yHigh,
    speed,
  }
}
