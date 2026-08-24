#!/usr/bin/env node
// Logic check for src/run/runState.ts -- the run's own clock: how far it has gone, how fast it is
// going, and where on the looping track that puts the camera. Plain assertions, no framework, via
// the register-ts-loader.mjs + ts-extensionless-loader.mjs Node-native-TS setup.
//
// **The two properties here are the ones a runner cannot be wrong about.**
//
// 1. *Distance is the score*, so it has to be frame-rate independent. If a 144Hz phone travels
//    further per second than a 60Hz one, the leaderboard measures hardware. `runFixedSteps` is
//    what makes that true, and this suite is what stops someone from "simplifying" the
//    accumulator back into a raw-delta Euler step months from now.
// 2. *The track loops*, so `z` must wrap in both directions. Forward is obvious; backward is not,
//    and `wrapZ` on a negative `z` has to land at the *end* of the track rather than at zero --
//    a knockback at `z = 30` would otherwise teleport the camera to the start line.
import assert from 'node:assert/strict'
import {
  addShield,
  applyBoost,
  createRunState,
  earnCoin,
  isRunOver,
  runSeconds,
  stepRun,
  takeHit,
} from '../src/run/runState.ts'
import {
  BOOST_FACTOR,
  BOOST_MS,
  HIT_SPEED_LOSS,
  RUN_LIVES,
  SPEED_ACCEL,
  SPEED_BASE,
  SPEED_CAP,
} from '../src/run/constants.ts'
import { wrapZ } from '../src/road/project.ts'
import { FIXED_STEP_MS } from '../src/race/constants.ts'

let passed = 0
function check(name, fn) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

/** A long enough loop that nothing below wraps by accident. */
const TRACK = 286_800

/** Drives `stepRun` for `seconds` of wall clock at a given frame rate, and returns the end state. */
function drive(seconds, hz, options = {}) {
  const dt = 1000 / hz
  let state = createRunState()

  for (let i = 0; i < Math.round(seconds * hz); i++) {
    state = stepRun(state, dt, { trackLength: TRACK, ...options })
  }

  return state
}

console.log('src/run/runState.ts -- the run clock')

check('a fresh run starts at the base speed, at the start of the track, having gone nowhere', () => {
  const state = createRunState()

  assert.equal(state.speed, SPEED_BASE)
  assert.equal(state.z, 0)
  assert.equal(state.distance, 0)
  assert.equal(state.stepRemainderMs, 0)
})

check('distance over one second is the same at 60Hz and at 144Hz, to within one tick', () => {
  // The whole reason the fixed timestep exists. One tick of slack, because the two rates land on
  // different remainders -- what is forbidden is a *systematic* difference, not a partial tick.
  const slow = drive(1, 60)
  const fast = drive(1, 144)
  const oneTick = slow.speed * (FIXED_STEP_MS / 1000)

  assert.ok(
    Math.abs(slow.distance - fast.distance) <= oneTick,
    `60Hz travelled ${slow.distance.toFixed(1)}, 144Hz ${fast.distance.toFixed(1)} -- more than one tick (${oneTick.toFixed(1)}) apart`,
  )
  console.log(`    1s: 60Hz ${slow.distance.toFixed(1)}u, 144Hz ${fast.distance.toFixed(1)}u, one tick is ${oneTick.toFixed(1)}u`)
})

check('...and over ten seconds, where a per-frame bias would have accumulated 600 times', () => {
  // The one-second check passes for a *biased* integrator too if the bias is small. Ten seconds is
  // where a raw-delta Euler step separates: 144Hz would run 1440 steps against 600.
  const slow = drive(10, 60)
  const fast = drive(10, 144)
  const oneTick = slow.speed * (FIXED_STEP_MS / 1000)

  assert.ok(
    Math.abs(slow.distance - fast.distance) <= oneTick,
    `after 10s: 60Hz ${slow.distance.toFixed(1)}, 144Hz ${fast.distance.toFixed(1)}`,
  )
  assert.ok(Math.abs(slow.speed - fast.speed) < 1, 'the speeds diverged even though the distances did not')
  console.log(`    10s: 60Hz ${slow.distance.toFixed(0)}u at ${slow.speed.toFixed(0)}u/s, 144Hz ${fast.distance.toFixed(0)}u at ${fast.speed.toFixed(0)}u/s`)
})

check('an erratic frame rate travels the same distance as a steady one', () => {
  // A real device does not hand out even deltas. Same total wall clock, wildly uneven frames.
  const steady = drive(6, 60)
  let jittery = createRunState()
  let elapsed = 0
  let i = 0

  while (elapsed < 6000) {
    const dt = [7.1, 33.4, 16.7, 4.2, 21.9][i++ % 5]

    jittery = stepRun(jittery, Math.min(dt, 6000 - elapsed), { trackLength: TRACK })
    elapsed += dt
  }

  const oneTick = steady.speed * (FIXED_STEP_MS / 1000)

  assert.ok(
    Math.abs(steady.distance - jittery.distance) <= oneTick * 2,
    `steady ${steady.distance.toFixed(0)}, jittery ${jittery.distance.toFixed(0)}`,
  )
})

check('a garbage delta stalls the sim rather than corrupting it', () => {
  // A clock that jumps -- a backgrounded tab, a debugger pause -- must not integrate backwards.
  for (const dt of [-100, Number.NaN, Number.POSITIVE_INFINITY, 0]) {
    const state = stepRun(createRunState(), dt, { trackLength: TRACK })

    assert.equal(state.distance, 0, `a delta of ${dt} moved the run`)
    assert.equal(state.z, 0)
    assert.ok(Number.isFinite(state.speed))
  }
})

console.log('the speed curve')

check('speed climbs towards the cap and never passes it', () => {
  let state = createRunState()
  let previous = state.speed

  for (let i = 0; i < 60 * 120; i++) {
    state = stepRun(state, 1000 / 60, { trackLength: TRACK })
    assert.ok(state.speed >= previous - 1e-9, 'the speed went down on its own')
    assert.ok(state.speed <= SPEED_CAP + 1e-9, `the speed reached ${state.speed}, past the cap of ${SPEED_CAP}`)
    previous = state.speed
  }
  assert.ok(state.speed > SPEED_CAP * 0.99, `after two minutes the speed is only ${state.speed.toFixed(0)}`)
})

check('the saturating curve closes 63% of the gap in 1/SPEED_ACCEL seconds', () => {
  // The documented property of `v += (cap - v) * SPEED_ACCEL * dt`, and the reason that form was
  // chosen over a linear ramp. Checked against the closed form rather than against a screenshot.
  const tau = 1 / SPEED_ACCEL
  const state = drive(tau, 60)
  const expected = SPEED_CAP - (SPEED_CAP - SPEED_BASE) * Math.exp(-1)

  assert.ok(
    Math.abs(state.speed - expected) / expected < 0.01,
    `after ${tau.toFixed(1)}s the speed is ${state.speed.toFixed(0)}, not the ${expected.toFixed(0)} the curve predicts`,
  )
  console.log(`    tau = ${tau.toFixed(1)}s: ${state.speed.toFixed(0)}u/s of a ${SPEED_CAP}u/s cap`)
})

check('a raised ceiling is chased, and a lowered one is fallen back to', () => {
  // What the boost pickup does (chunk 5) is raise `speedCap`, so the curve has to work in both
  // directions -- otherwise a boost that ends leaves the run permanently fast.
  const boosted = SPEED_CAP * BOOST_FACTOR
  let state = createRunState()

  for (let i = 0; i < 60 * 60; i++) state = stepRun(state, 1000 / 60, { trackLength: TRACK, speedCap: boosted })
  assert.ok(state.speed > SPEED_CAP, 'a raised ceiling was not chased')

  for (let i = 0; i < 60 * 60; i++) state = stepRun(state, 1000 / 60, { trackLength: TRACK })
  // Approached from *above* and asymptotically, so it never lands exactly on the cap -- which is
  // the same curve the climb uses and is why the tolerance here is a fraction of a percent rather
  // than an epsilon. What would be a defect is settling somewhere else entirely.
  assert.ok(
    state.speed < SPEED_CAP * 1.001,
    `the speed stayed at ${state.speed.toFixed(0)} after the boost ended, against a cap of ${SPEED_CAP}`,
  )
  assert.ok(state.speed > SPEED_CAP * 0.99, 'falling back overshot downwards')
})

check('drag makes the verge strictly slower than the road, at every speed', () => {
  // `OFFROAD_DRAG`'s whole claim. Sampled across the speed range rather than at one point,
  // because the acceleration term goes to zero at the ceiling and a drag that only won at the
  // bottom would make the verge free at top speed -- which is exactly where it must not be.
  for (const seconds of [0.5, 3, 10, 40]) {
    const clean = drive(seconds, 60)
    const dragged = drive(seconds, 60, { drag: 0.55 })

    assert.ok(
      dragged.speed < clean.speed,
      `after ${seconds}s off-road is ${dragged.speed.toFixed(0)} against ${clean.speed.toFixed(0)} on-road`,
    )
  }
})

console.log('the looping track')

check('z wraps forward, and distance does not', () => {
  let state = createRunState()

  // Long enough to go round a short loop several times.
  for (let i = 0; i < 60 * 200; i++) state = stepRun(state, 1000 / 60, { trackLength: 20_000 })

  assert.ok(state.z >= 0 && state.z < 20_000, `z left the track at ${state.z}`)
  assert.ok(state.distance > 20_000 * 5, 'distance wrapped along with z -- it is the score, it must not')
})

check('wrapZ on a negative z returns to the end of the track, not to zero', () => {
  // The property `project.ts` documents and the one a knockback depends on.
  assert.equal(wrapZ(-1, 1000), 999)
  assert.equal(wrapZ(-1000, 1000), 0)
  assert.equal(wrapZ(-1500, 1000), 500)
  // ...and -0 normalises to 0, so nothing downstream sees a signed zero.
  assert.ok(Object.is(wrapZ(-0, 1000), 0))
})

check('runSeconds reports the wall clock the run has actually simulated', () => {
  // Distance is the score, but the difficulty curve and the HUD both want elapsed time, and
  // reading it from `Date.now()` would count the frames a backgrounded tab dropped.
  const state = drive(5, 60)

  assert.ok(Math.abs(runSeconds(state) - 5) < FIXED_STEP_MS / 1000, `5s of frames simulated ${runSeconds(state)}s`)
})

console.log('the run as an economy')

check('a fresh run has all its lives, no boost and no coins', () => {
  const state = createRunState()

  assert.equal(state.lives, RUN_LIVES)
  assert.equal(state.shields, 0)
  assert.equal(state.coins, 0)
  assert.equal(state.boostMsRemaining, 0)
  assert.equal(isRunOver(state), false)
})

check('a hit costs speed, and costs it in the same unit the run is scored in', () => {
  // **The punishment is measured in the currency of the reward**, which is what makes this one
  // economy rather than a score with a health bar bolted to it.
  let state = drive(20, 60)
  const before = state.speed

  state = takeHit(state)

  assert.ok(state.speed < before - HIT_SPEED_LOSS * 0.9, `a hit cost only ${(before - state.speed).toFixed(0)}u/s`)
  assert.equal(state.lives, RUN_LIVES - 1)
  assert.equal(isRunOver(state), false)
})

check('a hit never stops the run dead', () => {
  // At low speed the loss would go negative, and a run that reaches zero speed is a run that has
  // silently ended without saying so.
  let state = takeHit(createRunState())

  assert.ok(state.speed > 0, 'a hit at the starting speed brought the run to a halt')
  for (let i = 0; i < 5; i++) state = takeHit(state)
  assert.ok(state.speed > 0)
})

check('three hits end the run, and a fourth changes nothing', () => {
  let state = createRunState()

  for (let i = 1; i <= RUN_LIVES; i++) {
    state = takeHit(state)
    assert.equal(state.lives, RUN_LIVES - i)
    assert.equal(isRunOver(state), i === RUN_LIVES)
  }

  const ended = state

  state = takeHit(state)
  assert.deepEqual(state, ended, 'a hit after the run ended changed the state')
})

check('a shield absorbs one hit instead of a life, and is spent doing it', () => {
  let state = addShield(createRunState())

  assert.equal(state.shields, 1)

  const speedBefore = state.speed

  state = takeHit(state)
  assert.equal(state.lives, RUN_LIVES, 'a shielded hit cost a life')
  assert.equal(state.shields, 0, 'the shield was not spent')
  // **A shield saves the life, not the speed**, and that is the design rather than an oversight:
  // a pickup that absorbed everything would be the only one worth having.
  assert.ok(state.speed < speedBefore, 'a shielded hit was free — it must still cost speed')

  state = takeHit(state)
  assert.equal(state.lives, RUN_LIVES - 1, 'the next hit did not land')
})

check('a boost raises the ceiling for BOOST_MS of simulated time, at any frame rate', () => {
  // Counted down inside the fixed tick rather than against a wall clock, for the same reason
  // everything else here is: a 144Hz phone must not get a shorter boost than a 60Hz one.
  const at = (hz) => {
    let state = applyBoost(createRunState())
    const dt = 1000 / hz

    for (let i = 0; i < Math.round((BOOST_MS / 1000) * hz); i++) {
      state = stepRun(state, dt, { trackLength: TRACK })
    }

    return state
  }

  for (const hz of [30, 60, 144]) {
    const state = at(hz)

    assert.ok(state.boostMsRemaining <= FIXED_STEP_MS, `${hz}Hz still had ${state.boostMsRemaining.toFixed(1)}ms of boost left`)
  }

  // ...and while it is running the speed climbs past the ordinary ceiling.
  let boosted = applyBoost(drive(30, 60))

  for (let i = 0; i < 90; i++) boosted = stepRun(boosted, 1000 / 60, { trackLength: TRACK })
  assert.ok(boosted.speed > SPEED_CAP, `boosted speed ${boosted.speed.toFixed(0)} never passed the plain cap`)
  assert.ok(boosted.speed <= SPEED_CAP * BOOST_FACTOR + 1e-9)
})

check('a second boost taken mid-boost extends it rather than being swallowed', () => {
  let state = applyBoost(createRunState())

  for (let i = 0; i < 60; i++) state = stepRun(state, 1000 / 60, { trackLength: TRACK })

  const midway = state.boostMsRemaining

  assert.ok(midway < BOOST_MS && midway > 0)
  state = applyBoost(state)
  assert.equal(state.boostMsRemaining, BOOST_MS, 'a refresh did not restore the full duration')
})

check('coins accumulate and are never fractional', () => {
  let state = createRunState()

  for (let i = 0; i < 7; i++) state = earnCoin(state)
  assert.equal(state.coins, 7)
  assert.equal(state.coins, Math.floor(state.coins))
})

check('every mutator is pure', () => {
  // The whole module is values in, values out — which is what makes the run testable here at all,
  // and what stops a scene from half-applying a change.
  const original = createRunState()
  const snapshot = { ...original }

  takeHit(original)
  applyBoost(original)
  earnCoin(original)
  addShield(original)
  assert.deepEqual({ ...original }, snapshot)
})

console.log(`${passed} checks passed`)
