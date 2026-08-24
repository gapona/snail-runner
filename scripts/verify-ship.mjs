#!/usr/bin/env node
// Logic check for the rail shooter's player movement -- src/rail/shipMotion.ts (the damped
// spring and its fixed timestep), src/race/fixedStep.ts (the accumulator inherited from the
// racer), src/road/track.ts's groundYAt, and src/platform/heldSources.ts (held-input
// tracking). None import phaser, which is what makes them runnable here. Plain assertions,
// no framework, via the register-ts-loader.mjs + ts-extensionless-loader.mjs setup.
//
// Replaces the deleted verify-car-physics.mjs: the handling model it covered died with the
// change of genre, but the frame-rate-invariance and held-input cases carried over verbatim,
// because the code they cover did.
import assert from 'node:assert/strict'
import { clampShipToBounds, createShipState, moveInputPoint, restPosition, stepShip } from '../src/rail/shipMotion.ts'
import {
  ENEMY_BAND_BOTTOM,
  SHIP_DAMPING,
  SHIP_HEIGHT_FRACTION,
  SHIP_MAX_WIDTH_FRACTION,
  laneEdgeFraction,
  laneEdgeGlow,
  LANE_SOFT_BAND,
  LANE_WARN_BAND,
  TELEGRAPH_MS,
  SHIP_MAX_Y_FRACTION,
  SHIP_MIN_Y_FRACTION,
  SHIP_REST_Y_FRACTION,
  SHIP_STIFFNESS,
  shipResponse,
} from '../src/rail/constants.ts'
import { FIXED_STEP_MS, MAX_SUB_STEPS } from '../src/race/constants.ts'
import { runFixedSteps } from '../src/race/fixedStep.ts'
import { buildStraightTrack, groundYAt, trackLengthOf, TrackBuilder } from '../src/road/track.ts'
import { ROAD_HILL, ROAD_LENGTH, SEGMENT_LENGTH } from '../src/road/constants.ts'
import { axisFrom, HeldSourceSet } from '../src/platform/heldSources.ts'

let passed = 0
function check(name, fn) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

// A hull half-height on every bounds object, because the ceiling is a limit on the ship's *top
// edge* now (see `SHIP_MIN_Y_FRACTION`). Sized exactly as `Ship.layout` sizes it, so the box
// under test is the box the game uses rather than a point-sized one.
const halfHullFor = (h) => (h * SHIP_HEIGHT_FRACTION) / 2
// The hull's own aspect, so a fixture's lane edge is the one the game would compute. `ship.png`
// is 64x92; a `Graphics` fallback has a different aspect again, which is exactly why `Ship`
// measures it rather than deriving it.
const halfHullWidthFor = (h) => (halfHullFor(h) * 64) / 92
const BOUNDS = { w: 1920, h: 1080, halfHeight: halfHullFor(1080), halfWidth: halfHullWidthFor(1080) }
const CENTRE = { targetX: BOUNDS.w / 2, targetY: BOUNDS.h / 2, active: true }

function run(state, input, totalMs, stepMs, bounds = BOUNDS) {
  let current = state
  const steps = Math.round(totalMs / stepMs)
  for (let i = 0; i < steps; i++) current = stepShip(current, input, stepMs, bounds)
  return current
}

function assertStatesMatch(a, b, message, tolerance = 1e-6) {
  for (const field of ['x', 'y', 'vx', 'vy', 'stepRemainderMs']) {
    assert.ok(
      Math.abs(a[field] - b[field]) < tolerance,
      `${message}: ${field} differs -- ${a[field]} vs ${b[field]}`,
    )
  }
}

const distanceTo = (state, target) => Math.hypot(state.x - target.targetX, state.y - target.targetY)

console.log('src/rail/shipMotion.ts -- frame-rate invariance')

check('one 16.67ms step and two 8.335ms steps land on the same state', () => {
  const start = createShipState(BOUNDS)
  assertStatesMatch(stepShip(start, CENTRE, 16.67, BOUNDS), run(start, CENTRE, 16.67, 8.335), 'one tick')
})

check('a full second of chasing a target lands identically at 30, 60 and 144 Hz', () => {
  // The end-to-end version: the spring integrates velocity into position, so any rate
  // dependence compounds over many frames rather than showing up in one.
  const start = createShipState(BOUNDS)
  const target = { targetX: BOUNDS.w * 0.2, targetY: BOUNDS.h * 0.4, active: true }
  const at30 = run(start, target, 1000, 1000 / 30)
  const at60 = run(start, target, 1000, 1000 / 60)
  const at144 = run(start, target, 1000, 1000 / 144)

  assertStatesMatch(at30, at60, '30Hz vs 60Hz')
  assertStatesMatch(at60, at144, '60Hz vs 144Hz')
  console.log(`    after 1s chasing: x=${at60.x.toFixed(3)} y=${at60.y.toFixed(3)} at 30/60/144Hz alike`)
})

check('an irregular, jittery frame sequence matches a regular one of the same total time', () => {
  const start = createShipState(BOUNDS)
  const target = { targetX: BOUNDS.w * 0.8, targetY: BOUNDS.h * 0.4, active: true }
  const jitter = [9.1, 22.4, 14.8, 17.2, 6.3, 31.5, 12.9, 19.1, 11.4, 15.3]
  const total = jitter.reduce((a, b) => a + b, 0)

  let jittery = start
  for (const dt of jitter) jittery = stepShip(jittery, target, dt, BOUNDS)
  const uniform = run(start, target, Math.round(total), 1)

  // They can differ by at most one un-run tick's worth of travel.
  assert.ok(Math.hypot(jittery.x - uniform.x, jittery.y - uniform.y) < 5, `drifted: ${jittery.x},${jittery.y} vs ${uniform.x},${uniform.y}`)
})

console.log('src/race/fixedStep.ts -- the accumulator inherited from the racer')

check('a delta shorter than one tick runs nothing but banks the time', () => {
  let ticks = 0
  const remainder = runFixedSteps(0, 5, () => ticks++)
  assert.equal(ticks, 0)
  assert.equal(remainder, 5)

  // ...and the banked time is spent as soon as enough accumulates.
  const after = runFixedSteps(remainder, 12, () => ticks++)
  assert.equal(ticks, 1)
  assert.ok(after < FIXED_STEP_MS)
})

check('exact tick multiples are not lost to floating-point drift -- the TICK_EPSILON_MS case', () => {
  // 144 frames of 1000/144 ms sum to a hair under 1000ms; a bare `>=` runs 59 ticks, not 60.
  let ticks = 0
  let remainder = 0
  for (let i = 0; i < 144; i++) remainder = runFixedSteps(remainder, 1000 / 144, () => ticks++)
  assert.equal(ticks, 60, 'one second must be exactly 60 ticks whatever the frame rate')

  let ticksAt30 = 0
  remainder = 0
  for (let i = 0; i < 30; i++) remainder = runFixedSteps(remainder, 1000 / 30, () => ticksAt30++)
  assert.equal(ticksAt30, 60)
})

check('a huge delta is capped at MAX_SUB_STEPS and the backlog is dropped, not carried', () => {
  let ticks = 0
  const remainder = runFixedSteps(0, 10_000, () => ticks++)
  assert.equal(ticks, MAX_SUB_STEPS)
  assert.equal(remainder, 0, 'carrying the backlog would cap out every frame from here on')
})

check('negative and non-finite deltas run nothing and leave the remainder untouched', () => {
  for (const dt of [-100, NaN, Infinity, -Infinity, 0]) {
    let ticks = 0
    const remainder = runFixedSteps(3, dt, () => ticks++)
    assert.equal(ticks, 0, `dt=${dt} ran a tick`)
    assert.equal(remainder, 3, `dt=${dt} altered the accumulator`)
  }
})

console.log('src/rail/shipMotion.ts -- the spring')

// A stepper of the documented tick, parametrised by stiffness/damping. The shipped `stepShip`
// reads the constants directly, so this is the only way to ask "would a stiffer ship still
// pass?" -- which chunk 6 has to ask before it can reconcile the telegraph with the ship's
// inertia. Kept honest by 'the reference tick reproduces stepShip exactly' below: if the real
// integrator ever changes, that check goes red rather than this silently testing a fiction.
function referenceStep(state, input, bounds, stiffness, damping) {
  const dtSec = FIXED_STEP_MS / 1000
  const s = { x: state.x, y: state.y, vx: state.vx, vy: state.vy }

  s.vx = (s.vx + (input.targetX - s.x) * stiffness * dtSec) * damping
  s.vy = (s.vy + (input.targetY - s.y) * stiffness * dtSec) * damping
  s.x += s.vx * dtSec
  s.y += s.vy * dtSec

  const minX = bounds.w * (1 - laneEdgeFraction(bounds.w, bounds.halfWidth))
  const maxX = bounds.w * laneEdgeFraction(bounds.w, bounds.halfWidth)
  const maxY = bounds.h * SHIP_MAX_Y_FRACTION
  // Top-edge ceiling, exactly as `clampInPlace` does it: the centre stops half a hull short of
  // `SHIP_MIN_Y_FRACTION`, and the `min` keeps the box from inverting on a very short viewport.
  const minY = Math.min(bounds.h * SHIP_MIN_Y_FRACTION + bounds.halfHeight, maxY)
  if (s.x < minX) { s.x = minX; if (s.vx < 0) s.vx = 0 } else if (s.x > maxX) { s.x = maxX; if (s.vx > 0) s.vx = 0 }
  if (s.y < minY) { s.y = minY; if (s.vy < 0) s.vy = 0 } else if (s.y > maxY) { s.y = maxY; if (s.vy > 0) s.vy = 0 }

  return { ...s, stepRemainderMs: 0 }
}

/**
 * Runs a step response and returns every excursion past the target, largest-first within each
 * excursion. Measured on x alone, with the target on the ship's own row, so an overshoot is a
 * sign flip and not a diagonal artefact.
 */
function overshootProfile(step, bounds, targetX, ticks) {
  const start = createShipState(bounds)
  const input = { targetX, targetY: start.y, active: true }
  const initialDistance = Math.abs(targetX - start.x)
  const approachSign = Math.sign(targetX - start.x)
  const peaks = []

  let state = start
  let excursion = 0
  for (let i = 0; i < ticks; i++) {
    state = step(state, input, bounds)
    const error = targetX - state.x
    if (error !== 0 && Math.sign(error) !== approachSign) {
      excursion = Math.max(excursion, Math.abs(error))
    } else if (excursion > 0) {
      peaks.push(excursion)
      excursion = 0
    }
  }
  if (excursion > 0) peaks.push(excursion)

  return { peaks, initialDistance, finalDistance: Math.abs(targetX - state.x) }
}

/**
 * The convergence criterion, stated as "does not diverge" rather than "distance decreases
 * monotonically".
 *
 * Monotonicity only holds while `zeta > 1`, so it would forbid any stiffness above ~24 -- and
 * a small overshoot is *wanted* in an action game: it reads as a snap instead of as mush.
 * Chunk 6 is expected to raise `SHIP_STIFFNESS` to fit the telegraph budget, and this test
 * must catch a genuinely diverging spring without vetoing that tuning.
 */
function assertConverges({ peaks, initialDistance, finalDistance }, label) {
  for (const [i, peak] of peaks.entries()) {
    assert.ok(
      peak <= initialDistance * 0.2,
      `${label}: overshoot ${i} was ${peak.toFixed(1)}px, over 20% of the ${initialDistance.toFixed(0)}px approach`,
    )
    if (i > 0) {
      assert.ok(peak < peaks[i - 1], `${label}: overshoot ${i} (${peak.toFixed(2)}px) did not shrink -- that is divergence`)
    }
  }
  assert.ok(finalDistance < initialDistance * 0.15, `${label}: expected to have closed most of the gap, ${finalDistance.toFixed(1)}px left`)
}

check('the ship converges on a stationary target without diverging', () => {
  const profile = overshootProfile((s, input, b) => stepShip(s, input, FIXED_STEP_MS, b), BOUNDS, BOUNDS.w * 0.25, 120)

  assertConverges(profile, `k=${SHIP_STIFFNESS}`)
  const overshoots = profile.peaks.length === 0 ? 'none' : profile.peaks.map((p) => `${((p / profile.initialDistance) * 100).toFixed(1)}%`).join(', ')
  console.log(`    2s of chase closes ${profile.initialDistance.toFixed(0)}px to ${profile.finalDistance.toFixed(1)}px; overshoot: ${overshoots}`)
})

check('the reference tick reproduces stepShip exactly at the shipped constants', () => {
  let real = createShipState(BOUNDS)
  let reference = createShipState(BOUNDS)
  const input = { targetX: BOUNDS.w * 0.8, targetY: BOUNDS.h * 0.45, active: true }

  for (let i = 0; i < 300; i++) {
    real = stepShip(real, input, FIXED_STEP_MS, BOUNDS)
    reference = referenceStep(reference, input, BOUNDS, SHIP_STIFFNESS, SHIP_DAMPING)
    for (const field of ['x', 'y', 'vx', 'vy']) {
      assert.ok(Math.abs(real[field] - reference[field]) < 1e-9, `diverged on ${field} at tick ${i}: ${real[field]} vs ${reference[field]}`)
    }
  }
})

check('the criterion has a real ceiling -- it passes the shipped spring and rejects a wilder one', () => {
  // The criterion must leave room to tune (chunk 6 raised the stiffness from 12 to 60 to fit
  // TELEGRAPH_MS, and that must not turn this red) while still catching a spring that has
  // genuinely gone loose. Both halves are asserted, because a criterion that only ever passes
  // proves nothing.
  const runaway = overshootProfile((s, input, b) => referenceStep(s, input, b, 4000, 0.99), BOUNDS, BOUNDS.w * 0.25, 240)
  assert.throws(() => assertConverges(runaway, 'runaway'), /overshoot/)

  // Where the ceiling actually bites, reported rather than asserted at a fixed number: it is a
  // consequence of the damping, not a constant anyone chose.
  let firstRejected = null
  for (let k = SHIP_STIFFNESS; k <= 400 && firstRejected === null; k += 5) {
    const profile = overshootProfile((s, input, b) => referenceStep(s, input, b, k, SHIP_DAMPING), BOUNDS, BOUNDS.w * 0.25, 400)
    try {
      assertConverges(profile, `k=${k}`)
    } catch {
      firstRejected = k
    }
  }

  assert.ok(firstRejected !== null && firstRejected > SHIP_STIFFNESS, `the criterion rejects the shipped stiffness itself (${firstRejected})`)
  console.log(`    shipped k=${SHIP_STIFFNESS} passes; the criterion first rejects k=${firstRejected}`)
})

check('the steady-state lag matches shipResponse().lagPerPointerSpeed', () => {
  // A viewport big enough that a multi-second drag never reaches the box walls; the clamp
  // would otherwise cap the lag and make this measure nothing.
  const wide = { w: 20_000, h: 20_000, halfHeight: halfHullFor(20_000), halfWidth: halfHullWidthFor(20_000) }
  const DRAG_SPEED = 480 // px/s -- a brisk finger sweep

  let state = createShipState(wide)
  let targetX = state.x
  const targetY = state.y
  let gap = 0
  let gapEarlier = 0

  const TICKS = 600 // 10s, ~13 slow-pole time constants
  for (let i = 0; i < TICKS; i++) {
    targetX += DRAG_SPEED * (FIXED_STEP_MS / 1000)
    // The gap the spring itself sees, sampled before the tick that reacts to it -- the same
    // quantity the formula solves for. Sampling it after the tick reads one x-step (v*dt, 8px
    // here) smaller, which is a real 2% and would muddy a 5% tolerance for no reason.
    gap = targetX - state.x
    if (i === Math.round(TICKS * 0.75)) gapEarlier = gap
    state = stepShip(state, { targetX, targetY, active: true }, FIXED_STEP_MS, wide)
  }
  const predicted = shipResponse().lagPerPointerSpeed * DRAG_SPEED

  assert.ok(Math.abs(gap - gapEarlier) < gap * 1e-3, `the drag had not settled: ${gapEarlier} then ${gap}`)
  assert.ok(
    Math.abs(gap - predicted) <= predicted * 0.05,
    `measured lag ${gap.toFixed(1)}px vs predicted ${predicted.toFixed(1)}px -- more than 5% apart, so the constants are not tunable by formula`,
  )

  // The continuous reading of the damping, which is the intuitive one and is wrong here.
  const naive = (-Math.log(SHIP_DAMPING) * 60 * DRAG_SPEED) / SHIP_STIFFNESS
  console.log(`    drag at ${DRAG_SPEED}px/s trails by ${gap.toFixed(1)}px; formula says ${predicted.toFixed(1)}px (a continuous -ln(d)*60 would say ${naive.toFixed(1)}px, ${(((naive - gap) / gap) * 100).toFixed(1)}% off)`)
})

check('shipResponse describes the same spring the integrator actually runs', () => {
  const shipped = shipResponse()

  assert.equal(shipped.oscillates, shipped.dampingRatio < 1)
  assert.ok(shipResponse(12).dampingRatio > 1, 'shipResponse must still identify an overdamped spring -- k=12 was the chunk-4 tuning')
  assert.ok(shipResponse(12).timeConstantSec > shipped.timeConstantSec, 'the shipped spring must settle faster than the one it replaced')
  assert.equal(shipped.lagPerPointerSpeed, shipped.decayRate / SHIP_STIFFNESS)

  // tau is the slow pole, so a step response must be within ~1/e of the target after it, and
  // must NOT have got there in a third of it -- that is what makes it a usable budget for
  // chunk 6's TELEGRAPH_MS.
  const ticksFor = (seconds) => Math.round((seconds * 1000) / FIXED_STEP_MS)
  const target = { targetX: BOUNDS.w * 0.2, targetY: BOUNDS.h * 0.5, active: true }
  const start = createShipState(BOUNDS)
  const gap0 = Math.abs(target.targetX - start.x)
  const remainingAfter = (seconds) => Math.abs(target.targetX - run(start, target, seconds * 1000, FIXED_STEP_MS).x) / gap0

  assert.ok(remainingAfter(shipped.timeConstantSec) < 0.45, 'one time constant must close most of the gap')
  assert.ok(remainingAfter(shipped.timeConstantSec / 3) > 0.45, 'a third of a time constant must not -- tau would be meaningless')
  console.log(`    k=${SHIP_STIFFNESS} d=${SHIP_DAMPING}: lambda=${shipped.decayRate.toFixed(2)}/s zeta=${shipped.dampingRatio.toFixed(2)} tau=${shipped.timeConstantSec.toFixed(2)}s lag=${shipped.lagPerPointerSpeed.toFixed(2)}px per px/s`)
  console.log(`    k=12, the chunk-4 tuning, for contrast: zeta=${shipResponse(12).dampingRatio.toFixed(2)} tau=${shipResponse(12).timeConstantSec.toFixed(2)}s lag=${shipResponse(12).lagPerPointerSpeed.toFixed(2)}px per px/s`)
})

check('it is a spring, not a teleport -- the ship lags the target rather than snapping to it', () => {
  const target = { targetX: BOUNDS.w * 0.8, targetY: BOUNDS.h * 0.4, active: true }
  const afterOneFrame = stepShip(createShipState(BOUNDS), target, FIXED_STEP_MS, BOUNDS)
  const initialGap = distanceTo(createShipState(BOUNDS), target)

  assert.ok(distanceTo(afterOneFrame, target) > initialGap * 0.9, 'one frame must not close the gap -- that would be a cursor')
  assert.ok(afterOneFrame.vx !== 0 || afterOneFrame.vy !== 0, 'but it must have started moving')
})

check('releasing the input coasts the ship back to the rest point, without snapping', () => {
  const held = { targetX: BOUNDS.w * 0.85, targetY: BOUNDS.h * 0.4, active: true }
  const flown = run(createShipState(BOUNDS), held, 3000, FIXED_STEP_MS)
  const rest = restPosition(BOUNDS)
  assert.ok(Math.abs(flown.x - held.targetX) < 20, 'sanity: should have arrived at the held target')

  const released = { targetX: 0, targetY: 0, active: false }
  const oneFrameAfterRelease = stepShip(flown, released, FIXED_STEP_MS, BOUNDS)
  assert.ok(Math.abs(oneFrameAfterRelease.x - flown.x) < 20, 'release must not teleport the ship home')

  const settled = run(flown, released, 4000, FIXED_STEP_MS)
  assert.ok(Math.hypot(settled.x - rest.x, settled.y - rest.y) < 5, `expected to coast back to rest, ended ${settled.x},${settled.y} vs ${rest.x},${rest.y}`)
  assert.equal(rest.y, BOUNDS.h * SHIP_REST_Y_FRACTION)
})

console.log('src/rail/shipMotion.ts -- the bounding box')

check('no input can push the ship outside its box', () => {
  const minX = BOUNDS.w * (1 - laneEdgeFraction(BOUNDS.w, BOUNDS.halfWidth))
  const maxX = BOUNDS.w * laneEdgeFraction(BOUNDS.w, BOUNDS.halfWidth)
  const minY = BOUNDS.h * SHIP_MIN_Y_FRACTION
  const maxY = BOUNDS.h * SHIP_MAX_Y_FRACTION

  // Targets far outside the box, from every direction, including absurd ones.
  const targets = [
    [-100000, -100000], [100000, 100000], [-100000, 100000], [100000, -100000],
    [BOUNDS.w / 2, -5000], [BOUNDS.w / 2, 5000], [-5000, BOUNDS.h / 2], [5000, BOUNDS.h / 2],
  ]

  for (const [tx, ty] of targets) {
    let state = createShipState(BOUNDS)
    for (let i = 0; i < 600; i++) {
      state = stepShip(state, { targetX: tx, targetY: ty, active: true }, FIXED_STEP_MS, BOUNDS)
      assert.ok(state.x >= minX - 1e-9 && state.x <= maxX + 1e-9, `x=${state.x} escaped [${minX}, ${maxX}] chasing ${tx},${ty}`)
      assert.ok(state.y >= minY - 1e-9 && state.y <= maxY + 1e-9, `y=${state.y} escaped [${minY}, ${maxY}] chasing ${tx},${ty}`)
    }
  }
})

check('velocity does not wind up against a wall -- the ship leaves the edge immediately when the target does', () => {
  // Without zeroing the into-the-wall velocity component, the spring keeps integrating while
  // pinned and the ship lurches when the target finally moves back inside.
  //
  // **It no longer pins to the hard limit, and that is the soft wall working.** The target is
  // clamped to the lane and the last `LANE_SOFT_BAND` pixels push back, so a player leaning on the
  // wall is held a little short of it rather than parked on it. What still has to be true is that
  // nothing accumulates: the ship comes to rest, and it does so inside the band.
  const maxX = BOUNDS.w * laneEdgeFraction(BOUNDS.w, BOUNDS.halfWidth)
  const pinned = run(createShipState(BOUNDS), { targetX: 99999, targetY: BOUNDS.h * 0.6, active: true }, 3000, FIXED_STEP_MS)

  assert.ok(pinned.x < maxX && pinned.x > maxX - LANE_SOFT_BAND, `settled at ${pinned.x.toFixed(1)}, outside the ${LANE_SOFT_BAND}px band ending at ${maxX.toFixed(1)}`)
  // A thousandth of a pixel per second after three seconds: the pushback and the spring balance
  // asymptotically rather than exactly, which is what a pair of springs does. The old hard stop
  // zeroed it outright, and the thing that actually mattered then and now is that it does not
  // *accumulate* -- a wound-up velocity is hundreds of px/s, not 0.001.
  assert.ok(Math.abs(pinned.vx) < 0.01, `velocity against the wall did not settle: ${pinned.vx}`)
})

check('a viewport resize re-clamps the ship instead of stranding it outside the new box', () => {
  const wide = run(createShipState(BOUNDS), { targetX: 99999, targetY: 99999, active: true }, 3000, FIXED_STEP_MS)
  const narrow = { w: 390, h: 844, halfHeight: halfHullFor(844), halfWidth: halfHullWidthFor(844) }
  const reclamped = clampShipToBounds(wide, narrow)

  assert.ok(reclamped.x <= narrow.w * laneEdgeFraction(narrow.w, narrow.halfWidth) + 1e-9, `x=${reclamped.x} is outside the narrow viewport`)
  assert.ok(reclamped.y <= narrow.h * SHIP_MAX_Y_FRACTION + 1e-9, `y=${reclamped.y} is outside the narrow viewport`)
  assert.ok(reclamped.x >= narrow.w * (1 - laneEdgeFraction(narrow.w, narrow.halfWidth)) - 1e-9, `x=${reclamped.x} is outside the narrow viewport`)

  // Stepping by zero must NOT be relied on for this: no ticks run, so nothing is clamped.
  // Ship.layout() used to do exactly that, and this is the case that caught it.
  const notReclamped = stepShip(wide, { targetX: wide.x, targetY: wide.y, active: true }, 0, narrow)
  assert.ok(notReclamped.x > narrow.w, 'a zero-length step is expected to clamp nothing -- that is why clampShipToBounds exists')

  // Clamping preserves the accumulator and does not invent motion.
  assert.equal(reclamped.stepRemainderMs, wide.stepRemainderMs)
})

check('the ceiling stops the ship\'s TOP EDGE, not its centre, and keeps it out of ENEMY_BAND', () => {
  // The failure this exists for: the ceiling used to hold the *centre* at SHIP_MIN_Y_FRACTION,
  // so the upper half of the hull flew inside the band the enemies live in -- 70px of the
  // player's own craft drawn among the targets at 1080p, on the one row the player is reading.
  // Asserted across viewports because the hull is a fraction of height and the band is too, so
  // a version that happened to work at one size proves nothing about another.
  for (const [w, h] of [[1920, 1080], [1600, 900], [390, 844], [844, 390], [768, 1024]]) {
    const bounds = { w, h, halfHeight: halfHullFor(h), halfWidth: halfHullWidthFor(h) }
    // Straight up, held long enough to settle against the wall including the overshoot.
    const pinned = run(createShipState(bounds), { targetX: w * 0.5, targetY: -99999, active: true }, 4000, FIXED_STEP_MS, bounds)
    const top = pinned.y - bounds.halfHeight

    assert.ok(
      top >= h * ENEMY_BAND_BOTTOM - 1e-9,
      `${w}x${h}: the ship's top edge reached ${(top / h).toFixed(4)} of the frame, inside ENEMY_BAND (${ENEMY_BAND_BOTTOM})`,
    )
    // ...and the ceiling is actually reached, or the check is passing on a ship that simply
    // never got there.
    assert.ok(
      Math.abs(top - h * ENEMY_BAND_BOTTOM) < 1,
      `${w}x${h}: the ship stopped ${(top - h * ENEMY_BAND_BOTTOM).toFixed(1)}px short of the ceiling -- it is not the clamp that stopped it`,
    )
  }
  console.log(`    the hull is ${(SHIP_HEIGHT_FRACTION * 100).toFixed(0)}% of frame height and its top edge stops on ENEMY_BAND_BOTTOM (${ENEMY_BAND_BOTTOM})`)
})

check('a viewport short enough to invert the box does not, and the ship stays inside it', () => {
  // 844x390 is a real device orientation and it is where the arithmetic gets tight: the ceiling
  // plus half a hull can land below the floor, and an unguarded clamp would then pin the ship to
  // a minY greater than its maxY -- i.e. outside the box on both counts at once.
  const bounds = { w: 844, h: 390, halfHeight: halfHullFor(390), halfWidth: halfHullWidthFor(390) }
  const up = run(createShipState(bounds), { targetX: bounds.w * 0.5, targetY: -99999, active: true }, 4000, FIXED_STEP_MS, bounds)
  const down = run(createShipState(bounds), { targetX: bounds.w * 0.5, targetY: 99999, active: true }, 4000, FIXED_STEP_MS, bounds)

  assert.ok(up.y <= bounds.h * SHIP_MAX_Y_FRACTION + 1e-9, `pushed up, the ship landed at ${up.y}, past the floor`)
  assert.ok(down.y <= bounds.h * SHIP_MAX_Y_FRACTION + 1e-9, `pushed down, the ship landed at ${down.y}, past the floor`)
  assert.ok(up.y <= down.y + 1e-9, 'pushing up must not put the ship below where pushing down does')
})

check('the drawn hull fits its width cap in portrait, and its height rule everywhere else', () => {
  // Mirrors `Ship.layout`: height first, width from the art's aspect, then the portrait cap --
  // which must shrink the height with it rather than squashing the sprite out of its aspect.
  const ART_ASPECT = 200 / 224 // public/assets/ship.png

  for (const [w, h] of [[1920, 1080], [390, 844], [844, 390], [320, 1000]]) {
    let height = h * SHIP_HEIGHT_FRACTION
    let width = height * ART_ASPECT

    if (width > w * SHIP_MAX_WIDTH_FRACTION) {
      width = w * SHIP_MAX_WIDTH_FRACTION
      height = width / ART_ASPECT
    }

    assert.ok(width <= w * SHIP_MAX_WIDTH_FRACTION + 1e-9, `${w}x${h}: hull is ${width.toFixed(0)}px wide`)
    assert.ok(height <= h * SHIP_HEIGHT_FRACTION + 1e-9, `${w}x${h}: hull is taller than the height rule allows`)
    assert.ok(Math.abs(width / height - ART_ASPECT) < 1e-9, `${w}x${h}: the cap squashed the hull out of its aspect`)
  }
})

check('stepShip is pure -- it never mutates the state it was handed', () => {
  const start = { x: 100, y: 200, vx: 30, vy: -40, stepRemainderMs: 4 }
  const snapshot = { ...start }
  stepShip(start, CENTRE, 50, BOUNDS)
  assert.deepEqual(start, snapshot)
})

check('moveInputPoint travels at a constant rate and stays inside the box', () => {
  const start = restPosition(BOUNDS)
  const moved = moveInputPoint(start, 1, 0, 1000, 1000, BOUNDS)
  assert.ok(Math.abs(moved.x - Math.min(start.x + 1000, BOUNDS.w * laneEdgeFraction(BOUNDS.w, BOUNDS.halfWidth))) < 1e-9)

  // Driven hard into every corner, it must clamp rather than escape.
  for (const [ax, ay] of [[1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    let point = restPosition(BOUNDS)
    for (let i = 0; i < 300; i++) point = moveInputPoint(point, ax, ay, 5000, FIXED_STEP_MS, BOUNDS)
    assert.ok(point.x >= BOUNDS.w * (1 - laneEdgeFraction(BOUNDS.w, BOUNDS.halfWidth)) - 1e-9 && point.x <= BOUNDS.w * laneEdgeFraction(BOUNDS.w, BOUNDS.halfWidth) + 1e-9, `x=${point.x}`)
    assert.ok(point.y >= BOUNDS.h * SHIP_MIN_Y_FRACTION - 1e-9 && point.y <= BOUNDS.h * SHIP_MAX_Y_FRACTION + 1e-9, `y=${point.y}`)
  }

  // A non-finite dt must not produce a NaN point.
  const guarded = moveInputPoint(start, 1, 1, 1000, NaN, BOUNDS)
  assert.deepEqual(guarded, { x: start.x, y: start.y })
})

console.log('src/road/track.ts -- groundYAt')

check('groundYAt agrees from both sides of a segment junction', () => {
  const track = new TrackBuilder().addHill(ROAD_LENGTH.MEDIUM * 3, ROAD_HILL.MEDIUM).build()

  for (const index of [1, 17, 50, 120, track.length - 2]) {
    const junction = index * SEGMENT_LENGTH
    const atJunction = groundYAt(track, junction)
    const justBefore = groundYAt(track, junction - 1e-6)
    const justAfter = groundYAt(track, junction + 1e-6)

    // The junction belongs to the segment starting there, so it equals that segment's p1.y...
    assert.equal(atJunction, track[index].p1.y, `junction ${index} does not sit on the segment boundary`)
    // ...and the limit from the previous segment must arrive at the same height, or the
    // ground has a step in it and anything standing on it would jump.
    assert.ok(Math.abs(justBefore - atJunction) < 1e-6, `step of ${justBefore - atJunction} at junction ${index}`)
    assert.ok(Math.abs(justAfter - atJunction) < 1e-6, `step of ${justAfter - atJunction} just past junction ${index}`)
  }
})

check('groundYAt is continuous across the whole track, including the loop seam', () => {
  const track = new TrackBuilder()
    .addStraight(ROAD_LENGTH.LONG)
    .addLowRollingHills()
    .addSCurve()
    .build()
  const length = trackLengthOf(track.length)

  const STEP = 7.3 // deliberately not a divisor of SEGMENT_LENGTH
  let previous = groundYAt(track, 0)
  let worstStep = 0
  for (let z = STEP; z <= length; z += STEP) {
    const current = groundYAt(track, z)
    worstStep = Math.max(worstStep, Math.abs(current - previous))
    previous = current
  }
  // The steepest eased gradient over 7.3 units is a few units of height; a discontinuity
  // would be thousands.
  assert.ok(worstStep < 50, `ground jumped by ${worstStep} between samples`)

  // Straight across the seam: the last sample and the first must agree.
  assert.ok(Math.abs(groundYAt(track, length - 1e-9) - groundYAt(track, 0)) < 1e-6, 'ground steps at the loop seam')
})

check('groundYAt wraps for z outside the track, in both directions', () => {
  const track = new TrackBuilder().addHill(ROAD_LENGTH.MEDIUM * 3, ROAD_HILL.LOW).build()
  const length = trackLengthOf(track.length)

  // Not bit-exact: wrapping a z that is a whole lap larger goes through a bigger intermediate,
  // so the modulo lands a few ulps apart. On heights in the thousands that is nothing.
  const sameHeight = (a, b, message) => assert.ok(Math.abs(a - b) < 1e-6, `${message}: ${a} vs ${b}`)

  for (const z of [12345.6, 0, SEGMENT_LENGTH * 4.25]) {
    sameHeight(groundYAt(track, z + length), groundYAt(track, z), `z=${z} did not wrap forwards`)
    sameHeight(groundYAt(track, z + length * 3), groundYAt(track, z), `z=${z} did not wrap three laps forwards`)
    sameHeight(groundYAt(track, z - length), groundYAt(track, z), `z=${z} did not wrap backwards`)
  }
  // Deep negatives too -- chunk 6 spawns enemies relative to the camera, which can be near 0.
  sameHeight(groundYAt(track, -SEGMENT_LENGTH), groundYAt(track, length - SEGMENT_LENGTH), 'negative z')
})

check('groundYAt is flat zero on a flat track, and never NaN', () => {
  const flat = buildStraightTrack(120)
  for (const z of [0, 1, 5000, -5000, trackLengthOf(flat.length) * 2.5]) {
    assert.equal(groundYAt(flat, z), 0, `flat track returned a non-zero height at z=${z}`)
  }
})

console.log('src/platform/heldSources.ts')

check('HeldSourceSet: a held key reports as held, a released one does not', () => {
  const set = new HeldSourceSet()
  assert.equal(set.isHeld, false)
  set.press('key:LEFT')
  assert.equal(set.isHeld, true)
  set.release('key:LEFT')
  assert.equal(set.isHeld, false)
})

check('HeldSourceSet: OS key auto-repeat cannot make the action stick -- the regression this exists for', () => {
  // A held key delivers a burst of keydown events with no keyup between them. A counter would
  // climb to 30 here and the single release would leave it at 29, i.e. stuck on forever.
  const set = new HeldSourceSet()
  for (let i = 0; i < 30; i++) set.press('key:LEFT')
  assert.equal(set.heldCount, 1, 'repeats must be idempotent, not additive')
  set.release('key:LEFT')
  assert.equal(set.isHeld, false, 'one release must fully clear one key, however many repeats arrived')
})

check('HeldSourceSet: two sources for one action -- it stays held until BOTH let go', () => {
  const set = new HeldSourceSet()
  set.press('key:LEFT')
  set.press('pointer:1')
  set.release('key:LEFT')
  assert.equal(set.isHeld, true, 'the touch is still down')
  set.release('pointer:1')
  assert.equal(set.isHeld, false)
})

check('HeldSourceSet: clear() drops everything -- the focus-loss path, where no keyup is coming', () => {
  const set = new HeldSourceSet()
  set.press('key:LEFT')
  set.press('key:A')
  set.press('pointer:1')
  set.clear()
  assert.equal(set.isHeld, false)
  assert.equal(set.heldCount, 0)
})

check('axisFrom: holding both directions cancels, and releasing one immediately yields the other', () => {
  assert.equal(axisFrom(false, false), 0)
  assert.equal(axisFrom(true, false), -1)
  assert.equal(axisFrom(false, true), 1)
  assert.equal(axisFrom(true, true), 0, 'both held must cancel')

  const negative = new HeldSourceSet()
  const positive = new HeldSourceSet()
  negative.press('key:LEFT')
  positive.press('key:RIGHT')
  assert.equal(axisFrom(negative.isHeld, positive.isHeld), 0)
  negative.release('key:LEFT')
  assert.equal(axisFrom(negative.isHeld, positive.isHeld), 1, 'releasing one must leave the other steering')
})

console.log('the lane')

/** The five aspect ratios the acceptance is stated over, widest first. */
const ASPECTS = [
  ['21:9', 2560, 1080],
  ['16:9', 1920, 1080],
  ['4:3', 1440, 1080],
  ['3:4', 1080, 1440],
  ['9:16', 1080, 1920],
]

const boundsFor = (w, h) => ({ w, h, halfHeight: halfHullFor(h), halfWidth: halfHullWidthFor(h) })

check('the lane keeps the whole hull in frame, at every aspect ratio', () => {
  // **The one thing a flat fraction could not do.** The lane was `0.12..0.88` and the hull is sized
  // off frame *height*, so on a portrait screen -- where the hull is four times larger relative to
  // the road -- half of it hung off the edge. The edge is now the screen edge minus half a hull.
  console.log(`    ${'aspect'.padEnd(7)}${'hull half'.padStart(10)}${'lane edge'.padStart(11)}${'left in frame'.padStart(15)}`)

  for (const [name, w, h] of ASPECTS) {
    const bounds = boundsFor(w, h)
    const edge = laneEdgeFraction(w, bounds.halfWidth)
    const outer = w * edge + bounds.halfWidth

    assert.ok(outer <= w + 1e-9, `${name}: the hull reaches ${outer.toFixed(0)}px of a ${w}px frame`)
    assert.ok(edge > 0.5, `${name}: the lane collapsed to a point`)
    console.log(
      `    ${name.padEnd(7)}${bounds.halfWidth.toFixed(0).padStart(10)}${edge.toFixed(3).padStart(11)}${(w - outer).toFixed(1).padStart(15)}`,
    )
  }

  // ...and it is shown to bite: a hull as wide as the frame leaves no lane at all rather than a
  // negative one, and a zero-width hull gives the whole frame.
  assert.equal(laneEdgeFraction(1000, 2000), 0.5)
  assert.equal(laneEdgeFraction(1000, 0), 1)
})

check('the wall is soft: it pushes back rather than parking the ship', () => {
  // A hard stop reads as the input having stuck, which is the whole reason for the band. What has
  // to be true is both halves: the ship *moves* while it is held against the edge, and it still
  // never leaves the lane.
  const bounds = boundsFor(1920, 1080)
  const maxX = bounds.w * laneEdgeFraction(bounds.w, bounds.halfWidth)
  const held = { targetX: bounds.w * 2, targetY: bounds.h / 2, active: true }

  let state = createShipState(bounds)

  for (let i = 0; i < 240; i++) {
    state = stepShip(state, held, FIXED_STEP_MS, bounds)
    assert.ok(state.x <= maxX + 1e-9, `x=${state.x} left the lane, which ends at ${maxX}`)
  }

  // **Judged on where it settles, not on the deepest it ever got.** The spring is underdamped by
  // design (`zeta = 0.66`), so a flick at the wall overshoots and touches the hard limit once on
  // the way in; that is the snap the whole feel is built on. What the band changes is the resting
  // state: a player leaning on the wall is held short of it rather than parked on it.
  assert.ok(state.x < maxX - 1e-6, 'the ship rests on the hard limit, so the pushback does nothing')
  assert.ok(state.x > maxX - LANE_SOFT_BAND * 1.5, `the pushback holds the ship ${(maxX - state.x).toFixed(1)}px short, which is a wall well inside the lane`)
  console.log(`    held against the wall, the ship rests ${(maxX - state.x).toFixed(1)}px inside a ${LANE_SOFT_BAND}px band`)
})

check('the soft wall does not break 60/120Hz invariance', () => {
  // The pushback is applied inside the fixed tick for exactly this reason. Applied after the loop
  // it would scale with the frame rate, which is the one invariance this module exists to hold.
  const bounds = boundsFor(1920, 1080)
  const held = { targetX: bounds.w * 2, targetY: bounds.h * 0.2, active: true }

  const at60 = run(createShipState(bounds), held, 1000, FIXED_STEP_MS, bounds)
  const at120 = run(createShipState(bounds), held, 1000, FIXED_STEP_MS / 2, bounds)

  assertStatesMatch(at60, at120, 'the soft wall behaves differently at 120Hz')
})

check('how long a dodge takes, per aspect ratio -- the number the lane cannot fix', () => {
  // **The measurement the corridor plan asked for, and it does not come out even.** A shot is
  // escaped by moving the ship's own half-width out of the line it was aimed at, so the distance
  // scales with the hull -- which is sized off frame *height*. The ship's speed does not: the
  // spring is scale-free in pixels, so the same flick covers the same pixels whatever the frame
  // shape. Dodging therefore takes longer on a tall screen, and this prints by how much.
  const results = []

  for (const [name, w, h] of ASPECTS) {
    const bounds = boundsFor(w, h)
    const lane = bounds.w * laneEdgeFraction(w, bounds.halfWidth)
    const start = createShipState(bounds)
    // The flick a player actually makes when something winds up: all the way to the far wall.
    const away = { targetX: lane, targetY: start.y, active: true }
    const need = bounds.halfWidth

    let state = start
    let ms = Infinity

    for (let i = 1; i <= 200; i++) {
      state = stepShip(state, away, FIXED_STEP_MS, bounds)
      if (state.x - start.x >= need) {
        ms = i * FIXED_STEP_MS
        break
      }
    }

    // The plan's own stated metric: the *fraction of the dodge* covered by the time the shot
    // lands. Aimed at exactly the distance the dodge needs -- the minimum honest input -- rather
    // than at the wall, since aiming past the target says nothing about whether the target was
    // reachable.
    const exact = { targetX: start.x + bounds.halfWidth, targetY: start.y, active: true }
    let held = start
    for (let i = 0; i * FIXED_STEP_MS < TELEGRAPH_MS; i++) held = stepShip(held, exact, FIXED_STEP_MS, bounds)

    results.push({ name, need, ms, covered: (held.x - start.x) / need })
  }

  console.log(
    `    ${'aspect'.padEnd(7)}${'dodge px'.padStart(10)}${'time'.padStart(9)}${'of TELEGRAPH_MS'.padStart(17)}${'covered by then'.padStart(17)}`,
  )
  for (const r of results) {
    console.log(
      `    ${r.name.padEnd(7)}${r.need.toFixed(0).padStart(10)}${(r.ms.toFixed(0) + 'ms').padStart(9)}${((r.ms / TELEGRAPH_MS) * 100).toFixed(1).padStart(16)}%${((r.covered) * 100).toFixed(1).padStart(16)}%`,
    )
  }

  // **The plan's acceptance, met exactly rather than to 5%.** It asks for the *fraction of the
  // dodge covered within `TELEGRAPH_MS`* to agree across aspect ratios, and it does -- to the last
  // digit, on all five -- because the spring is linear: doubling the distance doubles the force,
  // so the fraction is scale-free and the aspect ratio cannot touch it. What differs is the
  // wall-clock time to clear one hull width, printed above, and that is a different quantity from
  // the one the test names.
  const coverage = results.map((r) => r.covered)
  const spread = Math.max(...coverage) - Math.min(...coverage)

  assert.ok(spread < 0.001, `coverage within the telegraph varies by ${(spread * 100).toFixed(2)}% across aspect ratios`)
  assert.ok(coverage[0] > 0.8, `only ${(coverage[0] * 100).toFixed(0)}% of a dodge is covered before the shot lands`)

  const worst = Math.max(...results.map((r) => r.ms))
  const best = Math.min(...results.map((r) => r.ms))

  // **Asserted as a budget, not as parity.** Parity is what the plan asked for and it is not
  // reachable by any choice of constants -- see the note in `laneEdgeFraction`. What can be
  // guaranteed is that the *worst* aspect still leaves most of the telegraph to react in, which is
  // the thing the player actually needs.
  assert.ok(worst < TELEGRAPH_MS * 0.5, `the slowest dodge takes ${worst}ms of a ${TELEGRAPH_MS}ms telegraph`)
  console.log(`    spread ${best.toFixed(0)}ms to ${worst.toFixed(0)}ms, i.e. x${(worst / best).toFixed(2)}; the budget is ${TELEGRAPH_MS}ms`)
})

check('the lane shows itself before it is reached, and only near an edge', () => {
  // **The acceptance of the corridor, and the reason the marker is screen-space.** Painting it on
  // the road was tried and measured wrong by 196px (see `SHIP_LANE_Z`); what is left has to be
  // true of the *screen*: dark in the middle, lit before the wall engages, full at the wall.
  const bounds = boundsFor(1920, 1080)
  const edge = bounds.w * laneEdgeFraction(bounds.w, bounds.halfWidth)

  const middle = laneEdgeGlow(bounds.w / 2, bounds.w, bounds.halfWidth)
  assert.equal(middle.left, 0, 'the lane is lit while the ship is nowhere near it')
  assert.equal(middle.right, 0, 'the lane is lit while the ship is nowhere near it')

  // Lit before the pushback engages, which is the whole word "before" in the acceptance.
  const atWall = laneEdgeGlow(edge - LANE_SOFT_BAND, bounds.w, bounds.halfWidth)
  assert.ok(atWall.right > 0, 'the boundary is invisible until the wall is already pushing back')
  assert.ok(laneEdgeGlow(edge, bounds.w, bounds.halfWidth).right === 1, 'the edge itself is not fully lit')

  // Monotonic, so the glow reads as distance rather than as a flicker.
  let previous = -1
  for (let d = LANE_WARN_BAND; d >= 0; d -= 4) {
    const value = laneEdgeGlow(edge - d, bounds.w, bounds.halfWidth).right
    assert.ok(value >= previous, `the glow fell from ${previous} to ${value} while approaching the wall`)
    previous = value
  }

  // Only the edge being approached lights up ${EM} at 1920 the two bands are nowhere near each other.
  assert.equal(laneEdgeGlow(edge, bounds.w, bounds.halfWidth).left, 0, 'both edges lit at once on a wide frame')
  console.log(
    `    dark until ${LANE_WARN_BAND}px out, full at the edge; the wall engages at ${LANE_SOFT_BAND}px, where the glow is already ${(atWall.right * 100).toFixed(0)}%`,
  )
})

console.log(`${passed} checks passed`)
