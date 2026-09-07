/**
 * A frog hops, and the whole of it is one sprite deformed.
 *
 * **Rule: this file never imports `phaser`** — it is arithmetic, and `npm run verify:critters`
 * loads it under Node.
 *
 * ── One drawing, not a set of poses ────────────────────────────────────────────────────────────
 *
 * The mascot's own animation system is a single volume-preserving scalar (`squash.ts`), for the
 * reason written there: a creature with a gait needs a launch pose, an airborne pose and a landing
 * pose, and every one of them is art that can disagree with the others. A hop is the same problem
 * and takes the same answer — crouch by compressing, fly by stretching, land by compressing hard,
 * and offset the whole sprite along an arc.
 *
 * ── ⚠ The arc is the PLAYER'S flight solver, not a curve of its own ────────────────────────────
 *
 * `flightHeight` and `flightDuration` are imported from `playerMotion.ts` and given a launch
 * velocity solved from `JUMP_GRAVITY` — the game's one gravity. A hand-authored sine would look
 * near enough and would be a second statement of how things fall in this world, free to drift from
 * the first the next time the jump is re-tuned. `formations.ts` makes the identical argument for
 * the ramp's coin arc: an arc laid by hand is one the player can be shown and still miss.
 *
 * ── Driven by DISTANCE, never by a clock ───────────────────────────────────────────────────────
 *
 * The same rule the beetle's gait, the slime trail and the glide cycle are all under. A critter's
 * speed is constant, so its travel converts to elapsed seconds exactly — which is what lets the arc
 * stay physical (it is evaluated in seconds) while the cadence stays tied to the ground going past.
 */

import { flightDuration, flightHeight } from './playerMotion'
import { JUMP_GRAVITY } from './constants'

/**
 * How high a hop carries the frog, in world units.
 *
 * A third of `GROUND_MAX_HEIGHT` — enough to read as a hop at the distance a critter is met, and
 * far below the height at which it would start looking like the player's own jump. It does **not**
 * change what the frog can do: the collision band is `CRITTER_KINDS.frog`'s and is not consulted
 * here, so a hopping frog is hit exactly where a walking one is. Making the band follow the hop
 * would be a hazard whose hitbox moves while the player is committing to a lane.
 */
export const HOP_APEX = 110

/** The wind-up. Short: a frog's crouch is a flick, not a wind-up. */
export const CROUCH_MS = 120

/**
 * The landing, split into an impact and a recovery.
 *
 * **⚠ It used to be one number and the impact was INSTANTANEOUS, which is what made it snap.** The
 * flight ends fully stretched (`1 + FLIGHT_STRETCH`, because the vertical speed is back to the
 * launch speed at touchdown) and the landing began at `LANDING_SQUASH` with nothing in between —
 * a change of 0.50 in the vertical scale in zero time, measured as a 76-unit jump in the
 * creature's centre of mass on a frog 343 units tall. Reported as too sharp, and it was not a
 * question of depth: there was no compression, only a recovery from a compression that had already
 * happened.
 *
 * So the impact now has a rise. `LANDING_IN_MS` is the absorption — stretched to fully compressed —
 * and the rest of `LANDING_MS` is the recovery back to rest. The rise is the shorter of the two
 * because that is what makes it read as an impact rather than as a crouch: a body arrives fast and
 * pushes back slowly.
 *
 * ── The line the numbers were picked against ──────────────────────────────────────────────────
 *
 * **A landing may be the punchiest moment of the hop, but not by a MULTIPLE.** Measured as how far
 * the creature's centre of mass moves in one 60Hz frame, against the most the flight itself ever
 * moves it:
 *
 * ```
 *   rise    depth   ease      landing / flight
 *   none     0.66   --              4.45x     what shipped, and what was reported
 *    60ms    0.72   out             1.60x
 *    85ms    0.72   out             1.29x     <- shipped
 *    85ms    0.72   smoothstep      1.10x
 *   100ms    0.74   smoothstep      0.93x     no impact left at all
 * ```
 *
 * Under 1 the landing has stopped being the hardest moment of the hop, which is a different defect
 * from the one being fixed. `verify:critters` holds it between 1 and 2.
 */
export const LANDING_MS = 190
export const LANDING_IN_MS = 85

/** Solved from the apex through the game's one gravity, exactly as `JUMP_LAUNCH_V` is. */
export const HOP_LAUNCH_V = Math.sqrt(2 * JUMP_GRAVITY * HOP_APEX)
export const HOP_FLIGHT_MS = flightDuration(HOP_LAUNCH_V) * 1000

export const HOP_CYCLE_MS = CROUCH_MS + HOP_FLIGHT_MS + LANDING_MS

/**
 * How far the sprite deforms, as a volume-preserving scalar: `> 1` taller and narrower, `< 1`
 * flatter and wider. `squash.ts`'s convention, so the two creatures speak one language.
 */
export const CROUCH_SQUASH = 0.76
/**
 * ⚠ 0.72, not the 0.66 it shipped at. The depth was the *second* half of the report: giving the
 * impact a rise fixes the discontinuity, and a shallower squash keeps the whole landing inside the
 * per-frame motion the rest of the hop already has. See the measurement in `verify:critters`.
 */
export const LANDING_SQUASH = 0.72
/** How much of the airborne stretch follows vertical speed, per unit of `HOP_LAUNCH_V`. */
export const FLIGHT_STRETCH = 0.16

export interface HopPose {
  /** Height above the ground, in world units. Zero on the ground. */
  readonly y: number
  /** Multiplier on the drawn width. */
  readonly scaleX: number
  /** Multiplier on the drawn height. */
  readonly scaleY: number
  /** In flight, as opposed to crouching or landing. */
  readonly airborne: boolean
  /**
   * Draw the kind's second, tucked pose instead of deforming the first.
   *
   * **Not the same as `airborne`, and the difference is what stops the swap clicking.** The tucked
   * drawing's feet hang below its body, so placing it with its anchor where the crouch's anchor is
   * puts its base `tuckOffset` world units below the road. Swapping the instant flight begins would
   * therefore draw the feet under the road for the first fifth of the hop. Waiting until the hop
   * has lifted the creature by exactly that offset puts the base at ground level at the moment of
   * the swap — position continuous, nothing to tune. See `tuckOffset` in `critters.ts`.
   */
  readonly tucked: boolean
}

/** The pose a kind that does not hop is always in. Exported so the caller needs no literal. */
export const GROUNDED_POSE: HopPose = { y: 0, scaleX: 1, scaleY: 1, airborne: false, tucked: false }

/**
 * How far apart two critters' hop cycles are pushed, per unit of id.
 *
 * Two frogs on screen hopping in lockstep read as one object drawn twice -- the same objection
 * `nextRepeat` answers for a sound played twice in a frame and `NO_REPEAT_WINDOW` answers for two
 * identical props side by side. A prime-ish number so consecutive ids do not land back in phase
 * after a short run of them.
 */
export const HOP_PHASE_STAGGER_MS = 137

/**
 * How much of the volume-preserving width change is actually applied.
 *
 * **⚠ 1 is the mascot's rule and it is wrong for a limbed animal.** `squash.ts` uses `width / s`
 * exactly, which is right for a snail: a blob has no parts, so compressing it has to push
 * something sideways or it reads as the sprite being scaled. A frog is drawn front-on with its legs
 * splayed to the edges of the canvas, so the widest part of the silhouette is the part that should
 * NOT move — a real frog's legs fold, they do not spread further.
 *
 * At 1 the landing squash of 0.66 widens the sprite by 52%, and the legs travel that whole
 * distance: measured on the first clip, that is what read as rubber at close range. Damped, the
 * vertical carries the compression and the legs stay nearly where they are drawn.
 *
 * It is not zero, because *some* horizontal give is what separates a squash from a vertical scale.
 */
export const WIDTH_RESPONSE = 0.42

/** `s` taller-and-narrower into a pose. Volume-preserving on the vertical, damped on the width. */
function pose(s: number, y: number, airborne: boolean, tuckAbove = Infinity): HopPose {
  // The threshold is scaled by the CURRENT vertical stretch, because the offset it is compared
  // against is a distance in the drawn sprite and the sprite is being stretched. Compared against
  // the unscaled offset the base would cross zero a few units early and the swap would show it.
  return {
    y,
    scaleX: 1 + (1 / s - 1) * WIDTH_RESPONSE,
    scaleY: s,
    airborne,
    tucked: airborne && y >= tuckAbove * s,
  }
}

/**
 * Where one hop is, given how far the critter has travelled.
 *
 * `travelled` is in world units and `speed` in units per second, so the conversion to time is
 * exact rather than approximate — a critter holds one speed for its whole life.
 *
 * **⚠ The phase is taken from a POSITIVE modulo.** A critter is spawned at the draw distance and
 * closes on the player, so callers naturally hand this the distance it has covered; but a caller
 * that hands it a negative (a critter behind the camera, or a harness stepping backwards) would
 * get a negative phase out of `%` in JavaScript and a pose from the wrong end of the cycle. The
 * same clamp `progress01` carries, and for the same reason.
 */
export function hopPose(
  travelled: number,
  speed: number,
  offsetMs = 0,
  tuckAbove = Infinity,
): HopPose {
  if (!(speed > 0)) return GROUNDED_POSE

  const elapsed = (travelled / speed) * 1000 + offsetMs
  const phase = ((elapsed % HOP_CYCLE_MS) + HOP_CYCLE_MS) % HOP_CYCLE_MS

  return poseAtPhase(phase, HOP_LAUNCH_V, tuckAbove)
}

/** How long a hop of this launch strength stays in the air, in milliseconds. */
export function flightMsFor(launchV: number): number {
  return flightDuration(launchV) * 1000
}

/** The whole animation, crouch to recovery, for a hop of this launch strength. */
export function cycleMsFor(launchV: number): number {
  return CROUCH_MS + flightMsFor(launchV) + LANDING_MS
}

/**
 * The pose at one instant of ONE hop, measured from the start of its crouch.
 *
 * **The launch strength is an argument, and that is what lets a second caller reuse this whole
 * animation rather than draw its own.** `hopPose` is the periodic case: a frog hopping because it
 * is a frog, on its own cycle at its own apex. `critterVault.ts` is the other one — a creature
 * clearing something in front of it, whose apex is dictated by what it has to clear and whose
 * timing is dictated by when it gets there. Both are the same crouch, the same arc, the same
 * landing; only the height and the clock differ, which is exactly what a player means by *the same
 * animation, just higher*.
 *
 * Phase is not wrapped here. A caller driving this from a position rather than a cycle has to be
 * able to ask about an instant before the crouch or after the recovery and be told the creature is
 * simply not hopping, which a modulo would answer with the middle of a jump.
 */
export function poseAtPhase(phaseMs: number, launchV: number, tuckAbove = Infinity): HopPose {
  const flight = flightMsFor(launchV)

  if (phaseMs < 0 || phaseMs > CROUCH_MS + flight + LANDING_MS) return GROUNDED_POSE

  if (phaseMs < CROUCH_MS) {
    // Compress into the ground. Eased so it leaves slowly and arrives fast, which is what a
    // wind-up is; the mirror curve reads as the creature sinking rather than as it loading.
    const t = phaseMs / CROUCH_MS
    return pose(1 + (CROUCH_SQUASH - 1) * t * t, 0, false)
  }

  const flightMs = phaseMs - CROUCH_MS

  if (flightMs < flight) {
    const seconds = flightMs / 1000
    const y = Math.max(0, flightHeight(launchV, seconds))
    // Vertical speed, as a fraction of the launch. Its ABSOLUTE value drives the stretch, so the
    // frog is longest leaving the ground and arriving at it and roundest at the apex — the same
    // sign-free reading `squash.ts`'s own flight term uses, and for the same reason: a stretch that
    // inverted at the top would read as the creature flipping over.
    const vy = launchV - JUMP_GRAVITY * seconds
    return pose(1 + FLIGHT_STRETCH * Math.min(1, Math.abs(vy) / launchV), y, true, tuckAbove)
  }

  const landingMs = phaseMs - CROUCH_MS - flight

  if (landingMs < LANDING_IN_MS) {
    // The impact. Starts at exactly the scale the flight ended on, so the two phases meet without a
    // step, and eases OUT — fastest at first contact, settling into full compression. The mirror
    // curve would compress slowly and then slam, which is a creature being crushed rather than one
    // landing.
    const t = landingMs / LANDING_IN_MS
    const from = 1 + FLIGHT_STRETCH
    return pose(from + (LANDING_SQUASH - from) * (1 - (1 - t) * (1 - t)), 0, false)
  }

  // The recovery. `(1 - t)^2` for `squashAt`'s reason — a linear relax reads as the sprite being
  // animated back to shape rather than as elasticity.
  const t = (landingMs - LANDING_IN_MS) / (LANDING_MS - LANDING_IN_MS)
  const remaining = (1 - t) * (1 - t)
  return pose(1 + (LANDING_SQUASH - 1) * remaining, 0, false)
}
