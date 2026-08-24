/**
 * The run's own clock: how far it has gone, how fast it is going, and where on the looping track
 * that puts the camera.
 *
 * **Rule: this file never imports `phaser`.** It is loaded directly under plain Node by
 * `scripts/verify-run-speed.mjs` (`npm run verify:run-speed`), and a value import of Phaser
 * executes its init code, which reads `window`.
 *
 * **The distinction this module exists to hold is `z` versus `distance`.** They advance by exactly
 * the same amount every tick and they are not the same number:
 *
 * - `z` is a *position on the track*, wrapped into `[0, trackLength)`. The track is a closed
 *   circuit, so it is the only thing the renderer can be handed.
 * - `distance` is *how far the run has travelled*, and it never wraps. It is the score, and it is
 *   what the difficulty curve reads.
 *
 * The rail shooter had no equivalent of the second: it scored kills, and its lap was scenery. Here
 * the lap is still scenery — the seam is not readable because the biomes change along the track
 * rather than around it — and the *number* is what the player is playing for.
 */
import { runFixedSteps } from '../race/fixedStep'
import { FIXED_STEP_MS } from '../race/constants'
import { wrapZ } from '../road/project'
import { SPEED_ACCEL, SPEED_BASE, SPEED_CAP } from './constants'

export interface RunState {
  /** Where the camera is on the closed track, in world units, always `[0, trackLength)`. */
  z: number
  /** How far this run has travelled, in world units. Never wraps — this is the score. */
  distance: number
  /** Current travel speed, in world units per second. */
  speed: number
  /** Fixed ticks simulated so far. `runSeconds` is the honest elapsed time, derived from this. */
  ticks: number
  /**
   * Simulated time owed but not yet stepped, in milliseconds — always `< FIXED_STEP_MS`.
   *
   * The fixed timestep only produces identical results at different frame rates if the leftover
   * fraction of a tick survives into the next call, and `stepRun` is pure, so the accumulator has
   * to live in the state. Callers treat it as opaque.
   */
  stepRemainderMs: number
}

export interface RunStepOptions {
  /** Length of the closed circuit, in world units — `WorldView.trackLength`. */
  trackLength: number
  /**
   * The ceiling the speed is currently chasing. Defaults to `SPEED_CAP`.
   *
   * **A parameter rather than a constant read inside**, because the boost pickup (chunk 5) is
   * exactly "the ceiling is higher for three seconds" and the fall-back afterwards has to use the
   * same curve in the other direction. A boost implemented as an impulse on `speed` instead would
   * be worth almost nothing taken just after a hit, which is when the player most needs it.
   */
  speedCap?: number
  /**
   * Fraction of the current speed shed per second — `OFFROAD_DRAG` while the snail is on the
   * verge, `0` on the asphalt. Defaults to `0`.
   *
   * Applied inside the tick, alongside the acceleration rather than after it, so the two settle
   * against each other at a lower equilibrium instead of the drag being a per-frame subtraction
   * whose size depends on the frame rate.
   */
  drag?: number
}

/** A run at the start line, at `SPEED_BASE`, having travelled nothing. */
export function createRunState(): RunState {
  return { z: 0, distance: 0, speed: SPEED_BASE, ticks: 0, stepRemainderMs: 0 }
}

/**
 * How long this run has been going, in seconds of *simulated* time.
 *
 * Counted in ticks rather than read from a wall clock on purpose: a backgrounded tab hands back a
 * multi-second delta whose backlog `runFixedSteps` deliberately drops (see `MAX_SUB_STEPS`), and a
 * difficulty curve driven by `Date.now()` would treat that dropped time as played.
 */
export function runSeconds(state: RunState): number {
  return (state.ticks * FIXED_STEP_MS) / 1000
}

/**
 * Advances the run by `dtMs` of wall-clock time and returns a new state.
 *
 * **The speed is a saturating chase, not a ramp**: `v += (cap - v) * SPEED_ACCEL * dt`. Constant
 * acceleration would either spend the whole run pinned at the ceiling or never reach it, depending
 * on how long the run happened to last; this closes 63% of the remaining gap in `1 / SPEED_ACCEL`
 * seconds and asymptotes, so a short run feels like acceleration and a long one like a settled top
 * speed — out of one number, and in both directions, which is what makes the boost's expiry work.
 *
 * Integrated with the fixed 60Hz tick inherited from the racer — see `runFixedSteps` for why
 * nothing here may be integrated over a raw frame delta. `distance` is accumulated *inside* the
 * tick rather than derived as `speed * elapsed` afterwards: the speed changes during the second,
 * so the outside form would be wrong by the integral of the change.
 */
export function stepRun(state: RunState, dtMs: number, options: RunStepOptions): RunState {
  const cap = options.speedCap ?? SPEED_CAP
  const drag = options.drag ?? 0

  let speed = state.speed
  let distance = state.distance
  let ticks = state.ticks

  const remainder = runFixedSteps(state.stepRemainderMs, dtMs, (dtSec) => {
    speed += (cap - speed) * SPEED_ACCEL * dtSec
    if (drag > 0) speed -= speed * drag * dtSec
    // Nothing may push the run backwards: the ground scrolls one way, and a negative speed would
    // put the camera behind obstacles it has already passed.
    if (speed < 0) speed = 0
    distance += speed * dtSec
    ticks++
  })

  return {
    // The only place the track's closure is applied. `distance` above is deliberately left alone.
    z: wrapZ(distance, options.trackLength),
    distance,
    speed,
    ticks,
    stepRemainderMs: remainder,
  }
}
