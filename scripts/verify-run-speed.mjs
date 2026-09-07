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
  canTakeHeal,
  eatFruit,
  heal,
  createRunState,
  earnCoin,
  isRunOver,
  revive,
  runSeconds,
  stepRun,
  takeHit,
} from '../src/run/runState.ts'
import {
  CONTINUE_LIVES,
  FEVER_SPEED_FACTOR,
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
  // What Fever does is raise the ceiling, so the curve has to work in both directions -- otherwise
  // a Fever that ends leaves the run permanently fast. Fever's own arithmetic is verify:fever's;
  // what is checked here is that the *option* behaves, since the difficulty curve uses it too.
  const boosted = SPEED_CAP * FEVER_SPEED_FACTOR
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

check('a fresh run has all its lives, an empty gauge and no coins', () => {
  const state = createRunState()

  assert.equal(state.lives, RUN_LIVES)
  assert.equal(state.shields, 0)
  assert.equal(state.coins, 0)
  assert.equal(state.fever.fruit, 0)
  assert.equal(state.fever.phase, 'idle')
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

check('a medkit puts a life back, up to the number a run starts with', () => {
  let state = createRunState()

  // **Worth nothing at full health, and that is the honest outcome rather than a defect** — which
  // is why `canTakeHeal` exists: `RunScene` asks it while the pickup is still beyond the draw
  // distance and withholds one the player has no room for, so a medkit is never driven through for
  // no effect. A pickup that gave nothing would read as the game dropping it.
  assert.equal(canTakeHeal(state), false, 'a full run has room for a medkit')
  assert.deepEqual({ ...heal(state) }, { ...state }, 'a medkit at full health changed the run')

  state = takeHit(takeHit(state))
  assert.equal(state.lives, RUN_LIVES - 2)
  assert.equal(canTakeHeal(state), true, 'a damaged run has no room for a medkit')

  const speedBefore = state.speed

  state = heal(state)
  assert.equal(state.lives, RUN_LIVES - 1, 'the medkit gave back more or less than one life')
  // **It answers a life and nothing else.** A hit costs speed *and* a life, and giving the speed
  // back too would make this the only pickup worth having — the argument `addShield` is under.
  assert.equal(state.speed, speedBefore, 'the medkit gave speed back as well as a life')

  // **The cap is the starting count**, so a stretch of lucky road cannot turn three lives into a
  // health bar: the lives are the ceiling on carelessness rather than the medium of exchange.
  state = heal(heal(heal(state)))
  assert.equal(state.lives, RUN_LIVES, `a medkit took the run past ${RUN_LIVES} lives`)
})

// The Fever ceiling, its duration, its landing and the guard are all `verify:fever`'s -- they are
// one mechanism and splitting its assertions across two suites is how half of one gets forgotten.
check('a fruit banks into the gauge and nothing else touches it', () => {
  let state = createRunState()

  for (let i = 0; i < 3; i++) state = eatFruit(state)
  assert.equal(state.fever.fruit, 3)
  assert.equal(state.fever.phase, 'idle', 'three fruit is not a Fever')

  const before = state.fever.fruit

  for (let i = 0; i < 600; i++) state = stepRun(state, 1000 / 60, { trackLength: TRACK })
  assert.equal(state.fever.fruit, before, 'the gauge drained on its own — see fever.ts, it may not')
})

check('coins accumulate and are never fractional', () => {
  let state = createRunState()

  for (let i = 0; i < 7; i++) state = earnCoin(state)
  assert.equal(state.coins, 7)
  assert.equal(state.coins, Math.floor(state.coins))
})

check('a continue gives back the life and nothing else', () => {
  let state = createRunState()

  for (let i = 0; i < 12; i++) state = stepRun(state, 1000 / 60, { trackLength: TRACK })
  state = earnCoin(eatFruit(state))
  for (let i = 0; i < RUN_LIVES; i++) state = takeHit(state)
  assert.ok(isRunOver(state), 'the fixture did not actually end the run')

  const dead = state
  const alive = revive(dead)

  assert.equal(alive.lives, CONTINUE_LIVES)
  assert.equal(isRunOver(alive), false)
  // **Everything the run *is* survives, which is the whole difference between a continue and a
  // restart.** A continue that reset the distance would be selling the player a new run under the
  // old one's name; one that gave the speed back would make the last mistake of a run cheaper than
  // every other mistake in it.
  for (const field of ['z', 'distance', 'speed', 'coins', 'shields', 'ticks', 'stepRemainderMs']) {
    assert.equal(alive[field], dead[field], `a continue changed ${field}, which is not its to change`)
  }
  assert.deepEqual(alive.fever, dead.fever, 'a continue reset the fruit gauge')

  // A run that is still going has nothing to continue, and saying so here is what stops a stray
  // second press handing out a life mid-run.
  const running = createRunState()

  assert.deepEqual(revive(running), running)
})

check('every mutator is pure', () => {
  // The whole module is values in, values out — which is what makes the run testable here at all,
  // and what stops a scene from half-applying a change.
  const original = createRunState()
  const snapshot = { ...original }

  takeHit(original)
  eatFruit(original)
  earnCoin(original)
  addShield(original)
  heal(original)
  revive(original)
  assert.deepEqual({ ...original }, snapshot)
})

console.log(`${passed} checks passed`)
