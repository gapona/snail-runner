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
// simulation with the clearing taken out, because a floor that has never rejected anything is not a
// floor.
import assert from 'node:assert/strict'
import {
  addFruit,
  createFeverState,
  feverCharge,
  feverClearanceUnits,
  feverInvulnerable,
  feverMagnet,
  feverSpeedFactor,
  magnetPull,
  stepFever,
} from '../src/run/fever.ts'
import { createRunState, eatFruit, stepRun } from '../src/run/runState.ts'
import { placeRunObstacles } from '../src/run/obstacles.ts'
import { PICKUP_KINDS, PICKUP_WEIGHTS } from '../src/run/pickups.ts'
import {
  FEVER_EASE_MS,
  FEVER_FRUIT_TARGET,
  FEVER_MAGNET_RATE,
  FEVER_MAGNET_Z,
  FEVER_MS,
  FEVER_SPEED_FACTOR,
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
  for (let i = 0; i < HZ * 10; i++) state = stepFever(state, DT).state
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

console.log('the shape of a Fever')

check('it lasts FEVER_MS + FEVER_EASE_MS of simulated time, at any frame rate', () => {
  const at = (hz) => {
    let state = createFeverState()

    for (let i = 0; i < FEVER_FRUIT_TARGET; i++) state = addFruit(state)

    let ms = 0

    while (state.phase !== 'idle') {
      state = stepFever(state, 1000 / hz).state
      ms += 1000 / hz
      assert.ok(ms < 60000, 'a Fever never ended')
    }

    return ms
  }

  for (const hz of [30, 60, 144]) {
    const ms = at(hz)
    const want = FEVER_MS + FEVER_EASE_MS

    assert.ok(Math.abs(ms - want) <= 1000 / hz + 1e-6, `${hz}Hz ran ${ms}ms against ${want}ms`)
  }
  console.log(`    ${FEVER_MS}ms of Fever and ${FEVER_EASE_MS}ms of landing, identical at 30/60/144Hz`)
})

check('the ceiling is FEVER_SPEED_FACTOR throughout, and exactly 1 the moment the guard drops', () => {
  let state = createFeverState()

  for (let i = 0; i < FEVER_FRUIT_TARGET; i++) state = addFruit(state)

  let lastActive = 0

  while (state.phase === 'active') {
    assert.equal(feverSpeedFactor(state), FEVER_SPEED_FACTOR)
    lastActive = feverSpeedFactor(state)
    state = stepFever(state, DT).state
  }
  assert.equal(lastActive, FEVER_SPEED_FACTOR)

  let previous = feverSpeedFactor(state)

  while (state.phase === 'easing') {
    const factor = feverSpeedFactor(state)

    assert.ok(factor <= previous + 1e-9, 'the landing ramp went back up')
    previous = factor
    state = stepFever(state, DT).state
  }
  assert.equal(feverSpeedFactor(state), 1, 'the ramp did not arrive at the ordinary ceiling')
})

check('the guard outlives the speed - it covers the landing, not just the Fever', () => {
  // Step 2 of the ordering, and the whole reason `easing` is a phase rather than a flag. If the
  // guard came off with the speed, the player would be vulnerable at 1.6x for a full second.
  let state = createFeverState()

  for (let i = 0; i < FEVER_FRUIT_TARGET; i++) state = addFruit(state)

  let easingTicks = 0

  while (state.phase !== 'idle') {
    assert.equal(feverInvulnerable(state), true, `the guard came off during ${state.phase}`)
    assert.equal(feverMagnet(state), true, 'the magnet stopped before the guard did')
    if (state.phase === 'easing') easingTicks++
    state = stepFever(state, DT).state
  }
  assert.equal(feverInvulnerable(state), false, 'the guard never came off')
  assert.ok(easingTicks >= FEVER_EASE_MS / DT - 1, `only ${easingTicks} guarded ticks of landing`)
})

check('the speed is actually back in the normal range when the guard drops', () => {
  // The ceiling ramping to 1 is not the same claim as the speed following it: at the ordinary
  // `SPEED_ACCEL` -- a 5.9-second time constant -- one second of ramp sheds a sixth of the Fever
  // and the run leaves the guard still flying. See `FEVER_SPEED_ACCEL`.
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
    `the guard dropped at ${run.speed.toFixed(0)}u/s, past the ${SPEED_CAP}u/s ceiling`,
  )
  console.log(`    cruise ${cruise.toFixed(0)} -> Fever ${peak.toFixed(0)} -> ${run.speed.toFixed(0)}u/s at the drop`)
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

console.log('the exit, over the real placer')

/**
 * One simulated exit. Returns how long the player has, in milliseconds, before the first obstacle
 * that can hurt them -- measured from the frame the guard came off.
 *
 * `clear` is the whole variable: with it, this is the shipped arrangement; without it, this is the
 * arrangement before the fix, kept as the negative control the house rule asks for.
 */
function simulateExit(obstacles, exitZ, clear) {
  let run = createRunState()

  // Put the run at Fever speed and in the landing phase, at `exitZ`, without waiting out six
  // seconds of Fever per sample: what is being measured is the exit, and the entry is checked
  // above.
  run = {
    ...run,
    speed: SPEED_CAP * FEVER_SPEED_FACTOR,
    distance: exitZ,
    z: exitZ % TRACK,
    fever: { fruit: 0, phase: 'easing', msRemaining: FEVER_EASE_MS },
  }

  const cleared = new Set()

  if (clear) {
    const units = feverClearanceUnits(run.speed)

    for (const obstacle of obstacles) {
      const ahead = (((obstacle.z - exitZ) % TRACK) + TRACK) % TRACK

      if (ahead <= units) cleared.add(obstacle.id)
    }
  }

  while (run.fever.phase !== 'idle') run = stepRun(run, DT, { trackLength: TRACK })

  const guardZ = run.distance

  let soonest = Infinity

  for (const obstacle of obstacles) {
    if (cleared.has(obstacle.id)) continue

    const ahead = (((obstacle.z - guardZ) % TRACK) + TRACK) % TRACK

    // Only the road in front. Half a lap is the same bound `isBehindCamera` uses.
    if (ahead > TRACK / 2) continue
    soonest = Math.min(soonest, (ahead / run.speed) * 1000)
  }

  return { ms: soonest, speed: run.speed, travelled: guardZ - exitZ }
}

check('in 200 exits the first obstacle after the guard is never sooner than REACTION_MS', () => {
  const obstacles = placeRunObstacles(1234, TRACK, 0)
  const rng = createRng(99)
  const samples = []
  const control = []

  for (let i = 0; i < 200; i++) {
    // Exit anywhere on the lap, including deep into the difficulty curve where the rows are
    // tightest -- which is where the defect would show first.
    const exitZ = rng() * TRACK

    samples.push(simulateExit(obstacles, exitZ, true))
    control.push(simulateExit(obstacles, exitZ, false))
  }

  const worst = Math.min(...samples.map((s) => s.ms))
  const worstControl = Math.min(...control.map((s) => s.ms))
  const sorted = [...samples.map((s) => s.ms)].sort((a, b) => a - b)

  console.log(`    ${obstacles.length} obstacles on the lap, landing over ${samples[0].travelled.toFixed(0)} units`)
  console.log(
    `    shipped: min ${worst.toFixed(0)}ms, 5th pct ${sorted[9].toFixed(0)}ms, median ${sorted[100].toFixed(0)}ms`,
  )
  console.log(`    without the clearing: min ${worstControl.toFixed(0)}ms`)

  // **The negative control first.** Without the clearing an exit lands on top of a row, and the
  // budget is whatever the gap happens to be -- which is the reported bug.
  assert.ok(
    worstControl < REACTION_MS,
    `the control passed at ${worstControl.toFixed(0)}ms, so this check is measuring nothing`,
  )
  assert.ok(worst >= REACTION_MS, `the worst exit gave the player ${worst.toFixed(0)}ms against ${REACTION_MS}ms`)
})

check('the clearance is an upper bound on what the landing actually covers', () => {
  // It is computed at the Fever speed and the run only slows from there, so it may never come out
  // short -- erring long costs a row the player did not have to dodge, erring short costs the hit.
  const speed = SPEED_CAP * FEVER_SPEED_FACTOR
  const { travelled } = simulateExit([], 0, true)
  const needed = travelled + (speed * REACTION_MS) / 1000

  assert.ok(
    feverClearanceUnits(speed) >= needed,
    `cleared ${feverClearanceUnits(speed).toFixed(0)} against ${needed.toFixed(0)} units needed`,
  )
  console.log(`    cleared ${feverClearanceUnits(speed).toFixed(0)} units against ${needed.toFixed(0)} needed`)
})

console.log(`${passed} checks passed`)
