#!/usr/bin/env node
// Logic check for src/run/fever.ts -- the fruit gauge, the Fever it pays for, and above all the
// ORDER it is left in. Plain assertions, no framework, via the register-ts-loader.mjs +
// ts-extensionless-loader.mjs Node-native-TS setup.
//
// **The suite exists for one defect, and the rest of it is scaffolding around that defect.**
// Leaving Fever at Fever speed is a guaranteed hit: the player has spent six seconds flying through
// obstacles, the guard comes off, and the next row arrives sooner than anyone can answer it. The
// best moment of the run would end in a death the player cannot explain and would rightly blame the
// game for. So the exit is three ordered steps -- the speed comes back, THEN the guard comes off,
// and the road is already clear for `REACTION_MS` past that -- and every one of them is asserted
// here, over the real placer's output and the real `stepRun`.
//
// The last check is the headline: 200 simulated exits, each measuring how long the player actually
// has before the first obstacle that can hurt them. **It is shown failing first**, against the same
// simulation with the hold taken out, because a floor that has never rejected anything is not a
// floor.
//
// ⚠ The hold REPLACED an earlier fix that deleted the obstacles inside the window. That worked and
// was reported anyway: the window is 42 segments against a road drawn 300 ahead, so the player
// watched rocks vanish in front of them -- and it broke `lapLayout.ts`'s rule that nothing already
// on screen is ever rewritten. Holding the guard until the road opens removes nothing.
import assert from 'node:assert/strict'
import {
  addFruit,
  createFeverState,
  feverCharge,
  feverMagnet,
  feverSpeedFactor,
  magnetPull,
  stepFever,
} from '../src/run/fever.ts'
import { createRunState, eatFruit, stepRun } from '../src/run/runState.ts'
import { hits, placeRunObstacles } from '../src/run/obstacles.ts'
import { PICKUP_KINDS, PICKUP_WEIGHTS } from '../src/run/pickups.ts'
import {
  FEVER_EASE_MS,
  FEVER_FRUIT_TARGET,
  FEVER_MAGNET_RATE,
  FEVER_MAGNET_Z,
  FEVER_MS,
  FEVER_SPEED_FACTOR,
  MAX_ATTAINABLE_SPEED,
  REACTION_MS,
  SPEED_CAP,
} from '../src/run/constants.ts'
import { createRng } from '../src/race/rng.ts'

let passed = 0

function check(name, fn) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

const TRACK = 286800
const HZ = 60
const DT = 1000 / HZ

console.log('the gauge')

check('only fruit fills it, and only a Fever empties it', () => {
  let state = createFeverState()

  for (let i = 0; i < FEVER_FRUIT_TARGET - 1; i++) state = addFruit(state)
  assert.equal(state.phase, 'idle', 'a Fever started early')
  assert.ok(feverCharge(state) > 0.8 && feverCharge(state) < 1)

  // Ten seconds of nothing happening. The gauge may not move -- a slow drain punishes the player
  // for playing a stretch the placer put no fruit on, and reads as the game taking something back.
  for (let i = 0; i < HZ * 10; i++) state = stepFever(state, DT)
  assert.equal(state.fruit, FEVER_FRUIT_TARGET - 1, 'the gauge drained on its own')

  state = addFruit(state)
  assert.equal(state.phase, 'active', 'a full gauge did not start a Fever')
  assert.equal(state.fruit, 0, 'the gauge was not spent on entry')
})

check('fruit taken during a Fever counts toward the next one', () => {
  // The alternative -- resetting on exit -- throws away a pickup the player went and got, and the
  // magnet means they get a lot of them.
  let state = createFeverState()

  for (let i = 0; i < FEVER_FRUIT_TARGET; i++) state = addFruit(state)
  assert.equal(state.phase, 'active')

  for (let i = 0; i < 3; i++) state = addFruit(state)
  assert.equal(state.fruit, 3)
  assert.equal(state.phase, 'active', 'banking fruit mid-Fever restarted it')
})

check('⚠ a Fever that ends on a full gauge starts the next one, and never idles full', () => {
  // **A permanently full gauge is a permanent question**, which is the same objection that hid the
  // boost meter when it was empty. Fruit collected during a Fever banks toward the next, and the
  // magnet means there is a lot of it -- so the leaf used to come back reading 1.00 with the run
  // idle, waiting for one further fruit before it would fire.
  let state = createFeverState()

  for (let i = 0; i < FEVER_FRUIT_TARGET; i++) state = addFruit(state)
  for (let i = 0; i < 10; i++) state = addFruit(state)
  assert.equal(state.fruit, 10, 'fruit taken during a Fever was not banked')

  let ms = 0
  let ignitions = 0
  let previous = state.phase

  while (ms < 60000) {
    state = stepFever(state, DT)
    ms += DT
    if (previous !== 'active' && state.phase === 'active') ignitions++
    // The invariant this check exists for: an idle run never sits on a full gauge.
    if (state.phase === 'idle') assert.ok(feverCharge(state) < 1, `idle with the gauge at ${feverCharge(state)}`)
    previous = state.phase
    if (state.phase === 'idle') break
  }

  assert.equal(ignitions, 1, `the banked overflow started ${ignitions} further Fevers rather than one`)
  assert.equal(state.fruit, 10 - FEVER_FRUIT_TARGET, 'the chained Fever did not spend exactly one gauge')
  console.log(`    10 banked mid-Fever -> one more Fever, ${state.fruit} left over, ${Math.round(ms)}ms in total`)
})

check('a chain has to be paid for in fruit, so it cannot run away', () => {
  // Structural rather than empirical: every ignition spends `FEVER_FRUIT_TARGET`, so N Fevers back
  // to back need 8N fruit and one Fever does not earn the next. The measurement that says so is on
  // the placer, not here: a Fever plus its landing covers 14.1% of a lap and a lap carries 33.2
  // fruit, which is 4.7 under the magnet against a target of 8.
  // Started inside a Fever with three further gauges banked. **Not from `idle` with a full gauge**:
  // that state is unreachable in play — `addFruit` ignites and so does the end of a hold — and
  // making the step itself ignite would let a Fever start with no fruit landing to start it.
  let state = { fruit: FEVER_FRUIT_TARGET * 3, phase: 'active', msRemaining: FEVER_MS }
  let ignitions = 0
  // Seeded from the state rather than from `'idle'`, or the Fever it starts inside counts as one.
  let previous = state.phase
  let ms = 0

  while (ms < 120000) {
    state = stepFever(state, DT)
    ms += DT
    if (previous !== 'active' && state.phase === 'active') ignitions++
    previous = state.phase
    if (state.phase === 'idle' && feverCharge(state) < 1) break
  }

  // Four gauges' worth in the bank buys four Fevers and then stops, with nothing left over.
  assert.equal(ignitions, 3, `${ignitions} further Fevers from a bank of three gauges`)
  assert.equal(state.fruit, 0)
  assert.ok(ms < 60000, 'the chain did not terminate')
  console.log(`    a bank of ${FEVER_FRUIT_TARGET * 3} fruit is spent in ${ignitions} further Fevers and then stops`)
})

console.log('the shape of a Fever')

check('it lasts FEVER_MS + FEVER_EASE_MS of simulated time, at any frame rate', () => {
  const at = (hz) => {
    let state = createFeverState()

    for (let i = 0; i < FEVER_FRUIT_TARGET; i++) state = addFruit(state)

    let ms = 0

    while (state.phase !== 'idle') {
      state = stepFever(state, 1000 / hz)
      ms += 1000 / hz
      assert.ok(ms < 60000, 'a Fever never ended')
    }

    return ms
  }

  for (const hz of [30, 60, 144]) {
    const ms = at(hz)
    const want = FEVER_MS + FEVER_EASE_MS

    assert.ok(Math.abs(ms - want) <= 2 * (1000 / hz) + 1e-6, `${hz}Hz ran ${ms}ms against ${want}ms`)
  }
  console.log(`    ${FEVER_MS}ms of Fever and ${FEVER_EASE_MS}ms of landing, identical at 30/60/144Hz`)
})

check('the ceiling is FEVER_SPEED_FACTOR throughout, and exactly 1 the moment the Fever ends', () => {
  let state = createFeverState()

  for (let i = 0; i < FEVER_FRUIT_TARGET; i++) state = addFruit(state)

  let lastActive = 0

  while (state.phase === 'active') {
    assert.equal(feverSpeedFactor(state), FEVER_SPEED_FACTOR)
    lastActive = feverSpeedFactor(state)
    state = stepFever(state, DT)
  }
  assert.equal(lastActive, FEVER_SPEED_FACTOR)

  let previous = feverSpeedFactor(state)

  while (state.phase === 'easing') {
    const factor = feverSpeedFactor(state)

    assert.ok(factor <= previous + 1e-9, 'the landing ramp went back up')
    previous = factor
    state = stepFever(state, DT)
  }
  assert.equal(feverSpeedFactor(state), 1, 'the ramp did not arrive at the ordinary ceiling')
})

check('⚠ there is no guard, and being hittable at Fever speed is safe by construction', () => {
  // **Reported twice, from two directions**: that a lot of things on the road were passing through
  // the snail doing nothing, and that the fruit boost should not make the player immortal. Fever
  // used to switch the hitbox off for its whole length, its landing, and a fourth phase after that.
  //
  // What makes removing it safe is not a measurement of this file's own making. Every row in the
  // game is spaced against `REACTION_MS` at `MAX_ATTAINABLE_SPEED`, and that constant *is* the
  // Fever ceiling — so the placer has always laid the road on the assumption that the player might
  // be meeting it this fast and would have to react. Asserted here rather than trusted, because the
  // day those two stop being the same number is the day a Fever outruns the spacing it was measured
  // against, and nothing else would say so.
  assert.equal(
    MAX_ATTAINABLE_SPEED,
    SPEED_CAP * FEVER_SPEED_FACTOR,
    'the speed the rows are spaced against is no longer the speed a Fever reaches',
  )

  // Structural: the module exports no way to ask whether the player is safe, so a scene cannot
  // reintroduce one by reading a flag that quietly came back.
  const fever = { addFruit, createFeverState, feverCharge, feverMagnet, feverSpeedFactor, magnetPull, stepFever }

  for (const name of Object.keys(fever)) {
    assert.ok(!/invulnerab|guard/i.test(name), `${name} looks like a guard, and there is not supposed to be one`)
  }

  // The magnet is what still runs for the whole of it, guard or no guard — the reward is one
  // continuous thing rather than two overlapping ones.
  let state = createFeverState()

  for (let i = 0; i < FEVER_FRUIT_TARGET; i++) state = addFruit(state)

  let easingTicks = 0

  while (state.phase !== 'idle') {
    assert.equal(feverMagnet(state), true, `the magnet stopped during ${state.phase}`)
    if (state.phase === 'easing') easingTicks++
    state = stepFever(state, DT)
  }
  assert.equal(feverMagnet(state), false, 'the magnet outlived the Fever')
  assert.ok(easingTicks >= FEVER_EASE_MS / DT - 1, `only ${easingTicks} ticks of landing`)
  console.log(
    `    rows are spaced for ${MAX_ATTAINABLE_SPEED.toFixed(0)}u/s, which is exactly Fever speed — ` +
      `${(REACTION_MS / 1000).toFixed(2)}s of warning at the fastest the game goes`,
  )
})

check('the speed is actually back in the normal range by the time the Fever ends', () => {
  // The ceiling ramping to 1 is not the same claim as the speed following it: at the ordinary
  // `SPEED_ACCEL` -- a 5.9-second time constant -- one second of ramp sheds a sixth of the Fever
  // and the run comes out of it still flying. See `FEVER_SPEED_ACCEL`.
  //
  // **It matters more now than it did, not less.** It used to end an invulnerability a tenth above
  // the ceiling; with no guard left it hands the player rows that were spaced for a slower run.
  let run = createRunState()

  for (let i = 0; i < HZ * 40; i++) run = stepRun(run, DT, { trackLength: TRACK })

  const cruise = run.speed

  for (let i = 0; i < FEVER_FRUIT_TARGET; i++) run = eatFruit(run)

  let peak = 0

  while (run.fever.phase !== 'idle') {
    run = stepRun(run, DT, { trackLength: TRACK })
    peak = Math.max(peak, run.speed)
  }

  assert.ok(peak > cruise * 1.4, `Fever only reached ${peak.toFixed(0)} against a cruise of ${cruise.toFixed(0)}`)
  assert.ok(
    run.speed <= SPEED_CAP * 1.02,
    `the Fever ended at ${run.speed.toFixed(0)}u/s, past the ${SPEED_CAP}u/s ceiling`,
  )
  console.log(`    cruise ${cruise.toFixed(0)} -> Fever ${peak.toFixed(0)} -> ${run.speed.toFixed(0)}u/s at the end`)
})

console.log('the magnet')

check('the pull is total at the snail and nothing at the window edge', () => {
  assert.equal(magnetPull(0), 1)
  assert.equal(magnetPull(FEVER_MAGNET_Z), 0)
  assert.equal(magnetPull(FEVER_MAGNET_Z * 2), 0)
  assert.equal(magnetPull(-1), 0, 'something already passed was pulled backwards')
  assert.ok(Math.abs(magnetPull(FEVER_MAGNET_Z / 2) - 0.5) < 1e-9)
})

check('a pickup across the road is on the line by the time it arrives', () => {
  // The scene's own integration, reproduced: an exponential approach at FEVER_MAGNET_RATE, applied
  // per frame while the pickup closes the window. What is asserted is the outcome the player sees.
  const rate = FEVER_MAGNET_RATE
  let offsetX = -0.95
  const line = 0.2
  const speed = SPEED_CAP * FEVER_SPEED_FACTOR

  for (let ahead = FEVER_MAGNET_Z; ahead > 0; ahead -= (speed * DT) / 1000) {
    offsetX += (line - offsetX) * (1 - Math.exp((-rate * DT) / 1000)) * magnetPull(ahead)
  }
  assert.ok(
    Math.abs(offsetX - line) < 0.16,
    `it arrived ${Math.abs(offsetX - line).toFixed(2)} half-widths off the line`,
  )
  console.log(`    -0.95 -> ${offsetX.toFixed(2)} against a snail at ${line}`)
})

console.log('the set')

check('boost is gone, and the three that are left are three different sentences', () => {
  assert.deepEqual([...PICKUP_KINDS].sort(), ['coin', 'fruit', 'shield'])
  assert.equal(PICKUP_WEIGHTS.boost, undefined, 'boost is still in the weight table')
  for (const kind of PICKUP_KINDS) assert.ok(PICKUP_WEIGHTS[kind] > 0, `${kind} is never laid`)

  const total = PICKUP_KINDS.reduce((sum, kind) => sum + PICKUP_WEIGHTS[kind], 0)
  const share = PICKUP_WEIGHTS.fruit / total

  // A Fever the player reaches rather than one they hope for: at this share, a full gauge is about
  // 24 pickups of road, which is a couple of minutes of ordinary play.
  assert.ok(share > 0.2 && share < 0.45, `fruit is ${(share * 100).toFixed(0)}% of the table`)
  console.log(
    `    ${FEVER_FRUIT_TARGET} fruit at ${(share * 100).toFixed(0)}% of the table = ${Math.round(FEVER_FRUIT_TARGET / share)} pickups a Fever`,
  )
})

console.log('riding a Fever, over the real placer')

check('⚠ every obstacle met at Fever speed still gives REACTION_MS of warning', () => {
  // **The check that replaces the exit ordering, and it asks the question the removal actually
  // raises.** With a guard, what mattered was how much road the player had at the moment it came
  // off; with no guard, what matters is every obstacle on the lap, because a Fever now meets all of
  // them. The property is the placer's own row spacing read at the speed a Fever travels.
  const obstacles = placeRunObstacles(1234, TRACK, 0)
  const rows = [...new Set(obstacles.map((o) => Math.round(o.z)))].sort((a, b) => a - b)
  const speed = SPEED_CAP * FEVER_SPEED_FACTOR

  let worst = Infinity
  let worstAt = 0

  for (let i = 1; i < rows.length; i++) {
    const ms = ((rows[i] - rows[i - 1]) / speed) * 1000

    if (ms < worst) {
      worst = ms
      worstAt = rows[i]
    }
  }

  console.log(
    `    ${obstacles.length} obstacles in ${rows.length} rows; tightest pair ${worst.toFixed(0)}ms apart at ` +
      `${(speed / 1000).toFixed(1)}k u/s, ${(worstAt / 1000).toFixed(0)}k into the lap`,
  )
  assert.ok(worst >= REACTION_MS, `two rows are ${worst.toFixed(0)}ms apart at Fever speed, against ${REACTION_MS}ms`)

  // And the negative control the house rule asks for: the same measurement at a speed the placer
  // was never asked to hold has to fail, or this is asserting a property of arithmetic rather than
  // of the layout.
  let control = Infinity

  for (let i = 1; i < rows.length; i++) control = Math.min(control, ((rows[i] - rows[i - 1]) / (speed * 2)) * 1000)
  assert.ok(control < REACTION_MS, `even at twice Fever speed the spacing held, so this is measuring nothing`)
})

check('a Fever ridden end to end meets obstacles rather than passing through them', () => {
  // The report, as a number. A run held at Fever speed down a real lap has to *find* the obstacles:
  // this counts the rows whose interval the snail's own body actually overlaps, driving straight
  // down the centreline, and asserts the run does not sail through the lot.
  const obstacles = placeRunObstacles(4321, TRACK, 0)
  const body = { offsetX: 0, y: 0 }
  let met = 0

  for (const obstacle of obstacles) {
    if (hits(body, obstacle)) met++
  }

  assert.ok(met > 0, 'a snail on the centreline meets nothing on the whole lap')
  console.log(`    ${met} of ${obstacles.length} obstacles stand on the centreline — every one of them now hurts`)
})

check('nothing is deleted from the road', () => {
  // The rule `lapLayout.ts` states without qualification. An earlier fix cleared every obstacle
  // inside a 42-segment window on the way out of a Fever -- correct about the budget and reported
  // anyway, because the road is drawn 300 segments ahead and the player watched rocks vanish in
  // front of them. With no guard there is nothing left that would want to.
  const before = placeRunObstacles(1234, TRACK, 0)
  const ids = new Set(before.map((o) => o.id))

  let run = { ...createRunState(), fever: { fruit: 0, phase: 'easing', msRemaining: FEVER_EASE_MS } }

  while (run.fever.phase !== 'idle') run = stepRun(run, DT, { trackLength: TRACK })

  assert.equal(before.length, ids.size, 'the layout was mutated')
  for (const obstacle of before) {
    assert.equal('cleared' in obstacle, false, `an obstacle still carries a \`cleared\` flag`)
  }
})

console.log(`${passed} checks passed`)
