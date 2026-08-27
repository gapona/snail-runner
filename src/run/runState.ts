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
import {
  FEVER_SPEED_ACCEL,
  HIT_SPEED_LOSS,
  RUN_LIVES,
  SPEED_ACCEL,
  SPEED_BASE,
  SPEED_CAP,
} from './constants'
import { addFruit as bankFruit, createFeverState, feverSpeedFactor, stepFever, type FeverState } from './fever'

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
  /** Hits left before the run ends. */
  lives: number
  /** One-hit absorbers picked up along the way. Spent before a life is. */
  shields: number
  /** Coins collected this run. Banked into the save when the run ends. */
  coins: number
  /**
   * The fruit gauge and the Fever it pays for — see `fever.ts`.
   *
   * **Ticked inside the fixed step rather than against a `Date.now()` deadline**, for the same
   * reason everything else here is: a wall-clock deadline gives a backgrounded tab a Fever that
   * expires while nothing is being drawn, and gives a 144Hz phone the same Fever over a different
   * number of frames. Ticking it here makes its duration a property of the simulation — which for
   * Fever is load-bearing rather than tidy, because the guard comes off when the ease *ends*.
   */
  fever: FeverState
  /** Set once the last life is gone. Nothing else in this module writes it. */
  over: boolean
}

export interface RunStepOptions {
  /** Length of the closed circuit, in world units — `WorldView.trackLength`. */
  trackLength: number
  /**
   * The ceiling the speed is currently chasing. Defaults to `SPEED_CAP`, times
   * `feverSpeedFactor` while a Fever is running or landing.
   *
   * **A parameter rather than a constant read inside**, so a caller can override it — but Fever
   * does not use that: it is state, ticked down here, precisely so its duration is frame-rate
   * independent. What the parameter is for is the difficulty curve and the tests. A Fever
   * implemented as an impulse on `speed` instead of a raised ceiling would be worth almost nothing
   * entered just after a hit, which is exactly when the gauge is most likely to fill.
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
  return {
    z: 0,
    distance: 0,
    speed: SPEED_BASE,
    ticks: 0,
    stepRemainderMs: 0,
    lives: RUN_LIVES,
    shields: 0,
    coins: 0,
    fever: createFeverState(),
    over: false,
  }
}

/** Whether the run has ended. A separate reader so nothing has to know the shape of the flag. */
export function isRunOver(state: RunState): boolean {
  return state.over
}

/**
 * What hitting something costs.
 *
 * **Speed, not a life — until there is no shield left, and then both.** That ordering is the whole
 * economy: the reward for playing well is speed, and the punishment for playing badly is measured
 * in the same unit, so a run is one currency rather than a score with a health bar bolted to it.
 * The three lives are the ceiling on carelessness, not the medium of exchange.
 *
 * The speed floor is not decoration: a hit at the starting speed would otherwise take the run
 * below zero, and a run at zero speed has ended without saying so.
 *
 * A shield is spent *instead of* a life and does not save the speed. Absorbing everything would
 * make it the only pickup worth having.
 */
export function takeHit(state: RunState): RunState {
  if (state.over) return state

  const speed = Math.max(SPEED_BASE * 0.4, state.speed - HIT_SPEED_LOSS)

  if (state.shields > 0) return { ...state, speed, shields: state.shields - 1 }

  const lives = state.lives - 1

  return { ...state, speed, lives, over: lives <= 0 }
}

/** Grants a one-hit absorber. */
export function addShield(state: RunState): RunState {
  return { ...state, shields: state.shields + 1 }
}

/** Banks one fruit, which may start a Fever. All of the rule is in `fever.ts`. */
export function eatFruit(state: RunState): RunState {
  return { ...state, fever: bankFruit(state.fever) }
}

/** Banks one coin. */
export function earnCoin(state: RunState): RunState {
  return { ...state, coins: state.coins + 1 }
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
  const base = options.speedCap ?? SPEED_CAP
  const drag = options.drag ?? 0

  let speed = state.speed
  let distance = state.distance
  let ticks = state.ticks
  let fever = state.fever

  const remainder = runFixedSteps(state.stepRemainderMs, dtMs, (dtSec) => {
    // Fever is ticked in the same tick it raises the ceiling in, so the last tick of a Fever is
    // still boosted and the first tick after it is not — no off-by-one frame either way.
    fever = stepFever(fever, dtSec * 1000).state

    const factor = feverSpeedFactor(fever)
    const cap = base * factor
    // **⚠ Two accelerations, and which one applies is not a nicety.** The ordinary chase has a
    // 5.9-second time constant, so over the one-second ease it would shed a sixth of the Fever's
    // speed and the guard would come off with the run still flying — see `FEVER_SPEED_ACCEL`. The
    // fast approach is used for the whole of Fever, entry included, so the ceiling is something
    // the speed rides rather than something it lags behind.
    //
    // **⚠ Keyed on the phase, not on the factor**, and the difference is the whole of
    // `FEVER_SETTLE_MS`: through the settle the factor is exactly 1, so a `factor > 1` test hands
    // the last stretch of the landing back to the slow chase — which is the one stretch whose only
    // job is shedding the lag. Measured with that test: the guard dropped at **4146 u/s against a
    // 3600 ceiling**, i.e. worse than having no settle at all.
    const accel = fever.phase === 'idle' ? SPEED_ACCEL : FEVER_SPEED_ACCEL

    speed += (cap - speed) * accel * dtSec
    if (drag > 0) speed -= speed * drag * dtSec
    // Nothing may push the run backwards: the ground scrolls one way, and a negative speed would
    // put the camera behind obstacles it has already passed.
    if (speed < 0) speed = 0
    distance += speed * dtSec
    ticks++
  })

  return {
    ...state,
    // The only place the track's closure is applied. `distance` above is deliberately left alone.
    z: wrapZ(distance, options.trackLength),
    distance,
    speed,
    ticks,
    fever,
    stepRemainderMs: remainder,
  }
}
