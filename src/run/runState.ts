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
  CONTINUE_LIVES,
  FEVER_SPEED_ACCEL,
  HIT_SPEED_LOSS,
  MAX_SHIELDS,
  RUN_LIVES,
  SPEED_ACCEL,
  SPEED_BASE,
  SPEED_CAP,
} from './constants'
import { addFruit as bankFruit, createFeverState, feverSpeedFactor, stepFever, type FeverState } from './fever'
import { createTally, type QuestKind } from './quests'

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
   * What skill has been worth this run, in points — close passes and the streaks they build.
   *
   * **⚠ This field was deleted once and is back for the reason it went.** It held "distance plus
   * what the pickups paid", which nothing in the game read: the save, `sendScore` and the result
   * screen all record `distance`, so it was a third number saying one of the other two's things.
   * What is different now is that there is something to say. Distance is how far you got; this is
   * what you were willing to go near to get there, and no other number in the run carries it.
   *
   * Stored rather than derived, because unlike distance it cannot be recomputed from anything: it
   * is the sum of decisions the player already made. See `nearMiss.ts`.
   */
  bonus: number
  /**
   * What this run has done, per quest kind — fruit taken, close passes made, Fevers entered, ramps
   * ridden.
   *
   * **Tallied in the run and applied to the board once, at the end.** A quest advanced per event
   * would be a save write per fruit; and the board is read on the front screen, which is the only
   * place a quest can be claimed anyway. See `quests.ts`.
   */
  tally: Record<QuestKind, number>
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

/**
 * A run at the start line, at `SPEED_BASE`, having travelled nothing.
 *
 * **⚠ It used to take a `target`, and there was a mode that ended at one.** Five stages — 300m to
 * 2200m — each a distance to reach, riding the same curve, the same road and the same placer, with
 * `RunState.target` as their entire mechanical cost. They are removed: this game is the endless
 * run, and what a player who wants to put a run down needs is not a shorter run but the ability to
 * stop and come back. See `suspend.ts`, which is what replaced it.
 */
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
    bonus: 0,
    tally: createTally(),
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

/**
 * Puts a finished run back on the road: one life, and the flag that ended it cleared.
 *
 * **Only the two fields that ended the run move.** `distance`, `coins`, `speed`, the fever gauge
 * and the fixed step's own remainder are all left exactly as the crash left them — that is what
 * "continue from where you stopped" means, and rebuilding any of them here would make the continue
 * a second, shorter run wearing the first one's score.
 *
 * The speed the fatal hit docked is *not* given back either. A hit costs speed and a life, in that
 * order (`takeHit`), and a continue buys back the life; buying back the speed as well would make
 * the last mistake of a run cheaper than every other mistake in it.
 *
 * Pure, and takes no view on whether the player earned it — `adPolicy.ts` owns that question.
 */
export function revive(state: RunState): RunState {
  if (!state.over) return state

  return { ...state, lives: CONTINUE_LIVES, over: false }
}

/**
 * Grants a one-hit absorber, up to `MAX_SHIELDS`.
 *
 * **⚠ This used to have no ceiling**, which is what made the readout for it a counter rather than a
 * shape: nothing bounded how many `◆` could end up in the corner, so the HUD carried a cap of its
 * own and a `+` past it. The rule belongs here, where the state is, and the readout is a length
 * again because of it.
 *
 * Clamped rather than refused, so a caller that has not asked `canTakeShield` first cannot produce
 * a state the row could not draw. What stops the player *collecting* a shield they cannot hold is
 * that one is never laid in front of them — see `canTakeShield`.
 */
export function addShield(state: RunState): RunState {
  return { ...state, shields: Math.min(MAX_SHIELDS, state.shields + 1) }
}

/**
 * Whether a shield would be worth anything to this run right now.
 *
 * **Asked before one is drawn, not before it is collected.** A pickup the player drives through and
 * is given nothing for reads as the game dropping it; a pickup that was never there reads as
 * nothing at all, which is the honest outcome when there is nothing to give. See `RunScene`'s
 * dimming rule, which draws a pickup the run has no room for inert rather than taking it away.
 */
export function canTakeShield(state: RunState): boolean {
  return state.shields < MAX_SHIELDS
}

/**
 * Puts a life back, up to the number a run starts with.
 *
 * **Capped at `RUN_LIVES` rather than uncapped**, so a stretch of lucky road cannot turn the three
 * lives into a health bar — the lives are "the ceiling on carelessness, not the medium of
 * exchange", and a cap is what keeps that true. It is worth nothing at full health, which is honest
 * and is why `canTakeHeal` exists: a medkit the player has no room for is drawn dimmed and passed
 * through rather than collected for no effect — see `UNAVAILABLE_ALPHA`.
 *
 * The cap is the *starting* count and not the count a continue left behind: a continue is bought,
 * and a road that refilled it would be selling the same thing twice.
 */
export function heal(state: RunState): RunState {
  return { ...state, lives: Math.min(RUN_LIVES, state.lives + 1) }
}

/** Whether a medkit would be worth anything to this run right now. See `canTakeShield`. */
export function canTakeHeal(state: RunState): boolean {
  return state.lives < RUN_LIVES
}

/** Banks one fruit, which may start a Fever. All of the rule is in `fever.ts`. */
export function eatFruit(state: RunState): RunState {
  return { ...state, fever: bankFruit(state.fever) }
}

/** Adds one to a quest tally. The only way a run reports what it did. */
export function tally(state: RunState, kind: QuestKind, amount = 1): RunState {
  if (!(amount > 0)) return state

  return { ...state, tally: { ...state.tally, [kind]: state.tally[kind] + amount } }
}

/** Banks what a close pass was worth. */
export function earnBonus(state: RunState, points: number): RunState {
  if (!(points > 0)) return state

  return { ...state, bonus: state.bonus + Math.round(points) }
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
 * What the speed will be after `distance` more world units of ordinary running.
 *
 * **The one thing on the road that has to be laid for a speed it is not being laid at.** A ramp's
 * arc chain sits at `speed * t`, so it can only be right if it is built from the speed the flight
 * will actually be flown at — and `RunScene.relayArcs` builds it while the ramp is still 90
 * segments away. Laid from the speed *now*, the chain is short by everything the run accelerates
 * through on the way there, and the correction then lands at the launch where the player is looking
 * straight at it: measured, **4.8 segments of the tail at the speed a run starts at**.
 *
 * Walked with the same fixed tick and the same chase `stepRun` uses rather than solved: the closed
 * form is over *time* and this is a question about *distance*, which is transcendental — and a
 * second expression of the same curve is a second thing that can drift from it. About 650 ticks for
 * the shipped relay distance, once per ramp per lap.
 *
 * **It assumes an ordinary approach — no Fever, no hit, no verge.** All three are corrected at the
 * launch, which is the one instant the flight's speed is a fact rather than a prediction, and is
 * why that relay exists at all.
 */
export function speedAfter(speed: number, distance: number): number {
  const dt = FIXED_STEP_MS / 1000
  let v = speed
  let travelled = 0

  while (travelled < distance) {
    v += (SPEED_CAP - v) * SPEED_ACCEL * dt
    travelled += v * dt
  }

  return v
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
    fever = stepFever(fever, dtSec * 1000)

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
