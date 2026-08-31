#!/usr/bin/env node
// Logic check for src/run/tutorial.ts -- the first run, which teaches itself. Plain assertions, no
// framework, via the register-ts-loader.mjs + ts-extensionless-loader.mjs Node-native-TS setup.
//
// **What is worth checking here is that the tutorial cannot get in the way.** A card that blocks, a
// card that is up while its own object is already behind the player, a lesson dealt before the one
// it depends on, a hand-placed row nobody can get through -- every one of those turns the thing
// meant to teach the game into the reason somebody stops playing it, and none of them is visible in
// a screenshot of the frame they happen on.
import assert from 'node:assert/strict'
import { placeRamps, rampIdStride } from '../src/run/ramp.ts'
import {
  awaitingAcknowledgement,
  cardVisible,
  createTutorialState,
  currentStep,
  insideTutorialBand,
  stepTutorial,
  tutorialLayout,
  tutorialPaused,
  tutorialRunning,
  TUTORIAL_HOLD_MS,
  TUTORIAL_LEAD_Z,
  TUTORIAL_LENGTH_Z,
  TUTORIAL_PASSED_Z,
  TUTORIAL_STEER_UNITS,
  TUTORIAL_STEPS,
} from '../src/run/tutorial.ts'
import { hits, obstacleRows, passableLine } from '../src/run/obstacles.ts'
import { JUMP_APEX, OBSTACLE_BANDS, PLAYER_BODY_H, ROAD_EDGE, SPEED_BASE, SPEED_CAP } from '../src/run/constants.ts'
import { REACTION_MS } from '../src/run/constants.ts'
import { SEGMENT_LENGTH } from '../src/road/constants.ts'

// The id the scene hands the tutorial's ramp: the top of lap 0's block, which the generator
// provably cannot reach. See `rampIdStride`.
const TUTORIAL_RAMP_ID = rampIdStride(286800) - 1

let passed = 0

function check(name, fn) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

/**
 * Drives the tutorial the way the scene does, one frame at a time.
 *
 * **The distance only advances while the run is not paused**, which is the whole point: a card
 * stops the road, so a check that walked distance regardless would be testing a game that does not
 * exist -- and would pass every one of the deadlocks this suite is for.
 */
function drive(player, frames = 40000) {
  let state = createTutorialState()
  let distance = 0
  // Cumulative for the whole run and never reset, exactly as the scene keeps them: what answers a
  // card is what happens after it arms, and the baseline for that is the tutorial's own.
  const signals = { steered: 0, jumps: 0, acknowledgements: 0 }
  const seen = []
  const pausedFor = []
  let pauseFrames = 0

  for (let frame = 0; frame < frames && tutorialRunning(state); frame++) {
    const before = state.index
    const paused = tutorialPaused(state, distance)
    const now = frame * (1000 / 60)
    const acts = player(frame, { state, distance, paused, awaiting: awaitingAcknowledgement(state, distance) })

    if (acts.steer) signals.steered += acts.steer
    if (acts.jump) signals.jumps += 1
    if (acts.acknowledge) signals.acknowledgements += 1

    state = stepTutorial(state, { distance, ...signals, now })

    if (paused) pauseFrames += 1
    else distance += SPEED_BASE / 60

    if (state.index !== before) {
      seen.push({ id: TUTORIAL_STEPS[before].id, at: distance, now })
      pausedFor.push({ id: TUTORIAL_STEPS[before].id, ms: Math.round(pauseFrames * (1000 / 60)) })
      pauseFrames = 0
    }
  }

  return { state, seen, pausedFor, distance, signals }
}

/** A state sitting on step `index`, already armed at `distance` with every baseline at zero. */
function armed(index, distance) {
  return stepTutorial(
    { index, doneAt: -1, armed: false, base: { steered: 0, jumps: 0, acknowledgements: 0 } },
    { distance, steered: 0, jumps: 0, acknowledgements: 0, now: -1 },
  )
}

console.log('the lessons and their order')

check('every lesson is dealt once, in order, and every one of them stops the road', () => {
  // The player who does what each card asks: steers, jumps, and taps past every explanation.
  const { state, seen, pausedFor } = drive((frame, ctx) => ({
    steer: TUTORIAL_STEER_UNITS,
    jump: ctx.paused,
    acknowledge: ctx.awaiting,
  }))

  assert.ok(!tutorialRunning(state), 'the tutorial never finished for a player who did everything')
  assert.equal(seen.length, TUTORIAL_STEPS.length, 'a lesson was skipped or repeated')
  for (let i = 0; i < TUTORIAL_STEPS.length; i++) {
    assert.equal(seen[i].id, TUTORIAL_STEPS[i].id, `lesson ${i} came out of order`)
  }
  // **Every card is a pause**, and a card that never stopped the road is a card the player read
  // while something was arriving — which is the thing this design exists not to ask of them.
  for (const entry of pausedFor) {
    assert.ok(entry.ms > 0, `the "${entry.id}" card never stopped the road`)
  }

  // Two cards may never be up at once: each subject is 55 segments past the last against a
  // 45-segment lead, so the next card cannot come up until the previous one's object is behind.
  for (let i = 1; i < TUTORIAL_STEPS.length; i++) {
    const gap = TUTORIAL_STEPS[i].z - TUTORIAL_STEPS[i - 1].z

    assert.ok(
      gap > TUTORIAL_LEAD_Z + TUTORIAL_PASSED_Z,
      `${TUTORIAL_STEPS[i - 1].id} -> ${TUTORIAL_STEPS[i].id} is ${(gap / SEGMENT_LENGTH).toFixed(0)} segments, inside the lead`,
    )
  }

  console.log(
    `    ${TUTORIAL_STEPS.length} lessons over ${(TUTORIAL_LENGTH_Z / SEGMENT_LENGTH).toFixed(0)} segments of road — ` +
      `about ${(TUTORIAL_LENGTH_Z / SPEED_BASE).toFixed(0)}s of running, plus however long the player takes over each card`,
  )
})

check('⚠ the road stops on every card and starts again the moment it is answered', () => {
  // **The failure this is for: a pause nobody can get out of.** A runner that stops is a runner
  // that has to be started again, and the only thing that starts it is the player answering the
  // card in front of them — so every card must have an answer the player can actually give.
  let state = armed(0, 0)

  assert.ok(tutorialPaused(state, 0), 'the first card does not stop the road')

  // An `act` card: the road is still, and an acknowledgement does not start it — the control does.
  state = stepTutorial(state, { distance: 0, steered: 0, jumps: 0, acknowledgements: 5, now: 0 })
  assert.ok(tutorialPaused(state, 0), 'an `act` card was dismissed by an acknowledgement')
  state = stepTutorial(state, { distance: 0, steered: TUTORIAL_STEER_UNITS, jumps: 0, acknowledgements: 5, now: 1 })
  assert.ok(!tutorialPaused(state, 0), 'the road did not start when the control was used')

  // A `read` card: the road is still, and using a control does NOT start it — only the
  // acknowledgement does, because the thing it explains has not arrived yet.
  const readStep = TUTORIAL_STEPS.findIndex((step) => step.kind === 'read')

  assert.ok(readStep > 0, 'there are no `read` cards, so this is measuring nothing')
  const readAt = TUTORIAL_STEPS[readStep].z - TUTORIAL_LEAD_Z
  let atRead = armed(readStep, readAt)

  assert.ok(tutorialPaused(atRead, readAt), 'a `read` card does not stop the road')
  assert.ok(awaitingAcknowledgement(atRead, readAt), 'a `read` card is not waiting to be acknowledged')
  atRead = stepTutorial(atRead, { distance: readAt, steered: 99, jumps: 9, acknowledgements: 0, now: 0 })
  assert.ok(tutorialPaused(atRead, readAt), 'a `read` card was cleared by jumping at it')
  atRead = stepTutorial(atRead, { distance: readAt, steered: 99, jumps: 9, acknowledgements: 1, now: 1 })
  assert.ok(!tutorialPaused(atRead, readAt), 'the road did not start when the card was acknowledged')

  // And once answered it is never waiting again, so the next press belongs to the game.
  assert.ok(!awaitingAcknowledgement(atRead, readAt), 'an answered card still swallows the jump')
})

check('⚠ a card can only be answered by what happens after it comes up', () => {
  // **The defect this caught, and the reason the signals are cumulative with a baseline.** The first
  // version asked "has this player ever left the ground", so somebody who tapped once out of
  // curiosity while the STEERING card was up arrived at the jump card with it already satisfied —
  // the card that teaches the jump appeared and cleared in the same frame and taught nothing.
  const eager = drive((frame, ctx) => ({
    // Every control, from the very first frame, whether or not it is what the card is asking for.
    steer: 1,
    jump: true,
    acknowledge: true,
  }))

  assert.ok(!tutorialRunning(eager.state), 'the tutorial never finished for a player mashing everything')
  for (const entry of eager.pausedFor) {
    assert.ok(entry.ms > 0, `the "${entry.id}" card was answered before it came up`)
  }

  // And the negative control: the same run measured WITHOUT baselines — the shipped defect — clears
  // every card on the frame it arms, which is what the pausing above is shown to prevent.
  let unbaselined = createTutorialState()
  let cleared = 0

  for (let frame = 0; frame < 4000 && tutorialRunning(unbaselined); frame++) {
    const before = unbaselined.index
    const step = TUTORIAL_STEPS[unbaselined.index]

    // Cumulative signals that were already high before this card existed, compared with no baseline
    // at all — i.e. `state.base` pinned at zero, which is what the first version effectively had.
    unbaselined = stepTutorial(
      { ...unbaselined, base: { steered: 0, jumps: 0, acknowledgements: 0 } },
      { distance: step.z - TUTORIAL_LEAD_Z, steered: 99, jumps: 99, acknowledgements: 99, now: frame * 1000 },
    )
    if (unbaselined.index !== before) cleared += 1
  }

  assert.ok(cleared > 0, 'the unbaselined form clears nothing, so this control measures nothing')
  console.log(
    `    ${eager.pausedFor.length} cards, every one of them stopped the road for at least ` +
      `${Math.min(...eager.pausedFor.map((entry) => entry.ms))}ms even for a player pressing everything; ` +
      `without baselines ${cleared} clear themselves on sight`,
  )
})

check('⚠ a player who does nothing is held, and holds nothing but themselves', () => {
  // A tutorial that pauses can deadlock, and the player who triggers it is by definition the one
  // who did not understand the card. What makes that safe is that the pause is *theirs*: it costs
  // the run nothing, it ends the instant they act, and it can never advance past them.
  const idle = drive(() => ({}), 4000)

  assert.ok(tutorialRunning(idle.state), 'a card cleared for a player who did nothing')
  assert.equal(currentStep(idle.state).id, 'steer', 'the tutorial moved past a lesson nobody performed')
  assert.equal(idle.seen.length, 0)
  // **The road really did not move under them**, which is what makes waiting free.
  assert.equal(idle.distance, 0, `the run travelled ${idle.distance.toFixed(0)} units while a card was up`)

  // And a late starter still sees every lesson, in order, with nothing lost to having waited.
  const late = drive((frame, ctx) => ({
    steer: frame > 600 ? TUTORIAL_STEER_UNITS : 0,
    jump: frame > 900 && ctx.paused && frame % 90 === 0,
    acknowledge: frame > 1200 && ctx.awaiting,
  }))

  assert.ok(!tutorialRunning(late.state), 'a late starter never finished the tutorial')
  assert.equal(late.seen.length, TUTORIAL_STEPS.length)
  console.log(
    `    an idle player holds on "${currentStep(idle.state).id}" forever and the road does not move; ` +
      `a late one still sees all ${late.seen.length}`,
  )
})

check('an answered control card holds for a beat; an answered explanation waits for its object', () => {
  // A control card's lesson is over the moment it is performed, so it holds only long enough for
  // the player to see that it was them that cleared it -- and the road is already moving again.
  let state = createTutorialState()
  const signals = { distance: 0, steered: TUTORIAL_STEER_UNITS, jumps: 1, acknowledgements: 0, now: 1000 }

  // The first call arms the card and takes its baselines; the second is the one that can answer it.
  state = stepTutorial({ ...state }, { ...signals, steered: 0, jumps: 0, now: 999 })
  state = stepTutorial(state, signals)
  assert.equal(state.index, 0, 'the card went the instant it was satisfied')
  assert.equal(state.doneAt, 1000)
  assert.ok(!tutorialPaused(state, 0), 'an answered card is still holding the road')

  state = stepTutorial(state, { ...signals, now: 1000 + TUTORIAL_HOLD_MS - 1 })
  assert.equal(state.index, 0, 'the card went early')

  state = stepTutorial(state, { ...signals, now: 1000 + TUTORIAL_HOLD_MS })
  assert.equal(state.index, 1, 'the card never went')
  assert.equal(state.doneAt, -1)

  // **An explanation is the other way round and no amount of waiting clears it**: its lesson has not
  // happened yet, so the card stays until its own object is behind the player, which is what puts
  // the sentence and the thing on screen together.
  const readStep = TUTORIAL_STEPS.findIndex((step) => step.kind === 'read')
  const step = TUTORIAL_STEPS[readStep]
  const armAt = step.z - TUTORIAL_LEAD_Z
  let read = armed(readStep, armAt)

  read = stepTutorial(read, { distance: armAt, steered: 0, jumps: 0, acknowledgements: 1, now: 0 })
  assert.equal(read.index, readStep)
  read = stepTutorial(read, { distance: step.z, steered: 0, jumps: 0, acknowledgements: 1, now: 60000 })
  assert.equal(read.index, readStep, 'an explanation went before its own object arrived')
  read = stepTutorial(read, {
    distance: step.z + TUTORIAL_PASSED_Z + 1,
    steered: 0,
    jumps: 0,
    acknowledgements: 1,
    now: 60001,
  })
  assert.equal(read.index, readStep + 1, 'an explanation never went, even once its object was behind')
})

check('a card is on screen ahead of its subject and gone once it is behind', () => {
  for (const step of TUTORIAL_STEPS) {
    assert.ok(!cardVisible(step, step.z - TUTORIAL_LEAD_Z - 1), `${step.id} is up before its lead`)
    assert.ok(cardVisible(step, step.z - TUTORIAL_LEAD_Z + 1), `${step.id} is not up at its lead`)
    assert.ok(cardVisible(step, step.z), `${step.id} is not up at its own subject`)

    if (step.kind === 'read') {
      assert.ok(!cardVisible(step, step.z + TUTORIAL_PASSED_Z + 1), `${step.id} stays up past its subject`)
    } else {
      // An `act` card has no subject to be past, so it never expires by distance.
      assert.ok(cardVisible(step, step.z + TUTORIAL_LENGTH_Z), `${step.id} expired, and it has nothing to expire past`)
    }
  }

  // **The lead has to be worth several `REACTION_MS`**, because reading a sentence and then acting
  // on it is a much longer job than reacting to a rock — which is what that floor is for.
  const worst = (TUTORIAL_LEAD_Z / SPEED_CAP) * 1000

  assert.ok(worst > REACTION_MS * 4, `a card is up for only ${worst.toFixed(0)}ms at the cap`)
  console.log(
    `    a card leads its subject by ${(TUTORIAL_LEAD_Z / SEGMENT_LENGTH).toFixed(0)} segments — ` +
      `${((TUTORIAL_LEAD_Z / SPEED_BASE) * 1000).toFixed(0)}ms at the start of a run, ${worst.toFixed(0)}ms at the cap, ` +
      `against a ${REACTION_MS}ms reaction floor`,
  )
})

console.log('the road the tutorial lays')

check('⚠ every row has a line through it, and only the wall requires the jump', () => {
  let nextId = 1
  let nextPickupId = 1
  const { obstacles } = tutorialLayout(
    () => nextId++,
    () => nextPickupId++,
    TUTORIAL_RAMP_ID,
  )
  const rows = obstacleRows(obstacles)
  let jumpOnly = 0

  for (const row of rows) {
    // `passableLine` reports the CHEAPEST way through — `'ground'` when there is one and `'air'`
    // only when a jump is required — so "jump-only" is the mode it comes back with, not a null.
    const line = passableLine(row.obstacles)

    assert.ok(line !== null, `the row at ${(row.z / SEGMENT_LENGTH).toFixed(0)} segments cannot be passed at all`)
    if (line.mode === 'air') jumpOnly += 1
  }

  // Exactly one row a jump is required for, and it is the wall — the lesson the wall exists to be.
  assert.equal(jumpOnly, 1, `${jumpOnly} rows in the tutorial have no ground line; there must be exactly one`)
  const wall = TUTORIAL_STEPS.find((step) => step.id === 'wall')
  const wallRow = rows.find((row) => row.z === wall.z)

  assert.ok(wallRow && passableLine(wallRow.obstacles).mode === 'air', 'the wall is not the row with no ground line')

  // **And the tall barrier really is unjumpable**, or its card is teaching something false. Checked
  // by the collision itself rather than by comparing the constants, which is the same discipline
  // `verify:obstacles` holds the three classes to.
  const blocking = TUTORIAL_STEPS.find((step) => step.id === 'blocking')
  const barrier = obstacles.find((obstacle) => obstacle.z === blocking.z)

  assert.ok(hits({ offsetX: barrier.offsetX, y: JUMP_APEX }, barrier), 'the "too tall" barrier can be jumped')
  assert.ok(
    !hits({ offsetX: barrier.offsetX + barrier.halfWidths * 2 + 0.3, y: 0 }, barrier),
    'the "too tall" barrier cannot be gone around',
  )
  // The low rock must be the opposite on both counts, or the two cards say the same thing.
  const low = TUTORIAL_STEPS.find((step) => step.id === 'low')
  const rock = obstacles.find((obstacle) => obstacle.z === low.z)

  assert.ok(!hits({ offsetX: rock.offsetX, y: JUMP_APEX }, rock), 'the "hop it" rock is not clearable by a jump')
  assert.ok(hits({ offsetX: rock.offsetX, y: 0 }, rock), 'the "hop it" rock does not block the ground')

  console.log(
    `    ${rows.length} rows, ${jumpOnly} of them jump-only; the tall barrier reaches ${OBSTACLE_BANDS.blocking.yHigh} ` +
      `against an apex of ${JUMP_APEX} + a body of ${PLAYER_BODY_H}`,
  )
})

check('every pickup and ramp the tutorial lays is on the road and inside its own band', () => {
  let nextId = 1
  let nextPickupId = 1
  const { obstacles, pickups, ramps } = tutorialLayout(
    () => nextId++,
    () => nextPickupId++,
    TUTORIAL_RAMP_ID,
  )

  for (const item of [...obstacles, ...pickups, ...ramps]) {
    assert.ok(
      insideTutorialBand(item.z),
      `something is laid at ${(item.z / SEGMENT_LENGTH).toFixed(0)} segments, past the band's own end`,
    )
  }
  for (const pickup of [...pickups, ...ramps]) {
    assert.ok(Math.abs(pickup.offsetX) <= ROAD_EDGE, `something is laid at offsetX ${pickup.offsetX}, off the road`)
  }

  // **Nothing may be laid inside an obstacle**, which is the rule `formations.ts` already holds its
  // own chains to — a coin a hair in front of a boulder is an invitation to drive into the boulder.
  for (const pickup of pickups) {
    for (const obstacle of obstacles) {
      if (Math.abs(pickup.z - obstacle.z) > SEGMENT_LENGTH) continue
      assert.ok(
        Math.abs(pickup.offsetX - obstacle.offsetX) > obstacle.halfWidths,
        `a ${pickup.kind} sits inside an obstacle at ${(pickup.z / SEGMENT_LENGTH).toFixed(0)} segments`,
      )
    }
  }

  const kinds = new Set(pickups.map((pickup) => pickup.kind))

  // Each of the three kinds is met at least once: the tutorial is the only place a first-time
  // player is *guaranteed* to see a shield, which is the rarest thing the placer deals.
  for (const kind of ['coin', 'fruit', 'shield']) {
    assert.ok(kinds.has(kind), `the tutorial never deals a ${kind}`)
  }
  assert.equal(ramps.length, 1, 'the tutorial deals more than one ramp, so its card points at two things')
  console.log(`    ${obstacles.length} obstacles, ${pickups.length} pickups (${[...kinds].join(', ')}), ${ramps.length} ramp`)
})

check('ids are unique, so nothing the tutorial lays disarms anything else', () => {
  // `RunScene.resolvedOnLap` is keyed by obstacle id: two obstacles sharing one are one obstacle to
  // the collision, and passing the first disarms the second. That defect once left 66% of a lap
  // unable to hit the player, and a hand-placed band is a fresh chance to reintroduce it.
  let nextId = 1
  let nextPickupId = 1
  const { obstacles, pickups, ramps } = tutorialLayout(
    () => nextId++,
    () => nextPickupId++,
    TUTORIAL_RAMP_ID,
  )
  const obstacleIds = new Set(obstacles.map((obstacle) => obstacle.id))

  assert.equal(obstacleIds.size, obstacles.length, 'two tutorial obstacles share an id')
  assert.equal(new Set(pickups.map((pickup) => pickup.id)).size, pickups.length, 'two tutorial pickups share an id')

  // **⚠ This used to assert the tutorial's ramp did not share an id with an OBSTACLE, and that was
  // asking about the wrong space.** It was the right question while the ramp borrowed
  // `nextObstacleId()` — which is what it did, and which put a ramp id in the hundreds, where a
  // later lap's ramp block would eventually reach it. Nothing looks a ramp up by an obstacle id;
  // what `arcOf` collides in is the *ramp* space, so that is what has to be clear. See
  // `rampIdStride`, and `verify:ramp` for the cross-lap collision this all comes from.
  const generated = placeRamps(4242 ^ 0x2a17, 286800, 0, obstacles).map((ramp) => ramp.id)

  for (const ramp of ramps) {
    assert.ok(!generated.includes(ramp.id), `the tutorial ramp took id ${ramp.id}, which the generator also uses`)
    assert.ok(ramp.id < rampIdStride(286800), "the tutorial ramp is outside lap 0's own id block")
  }
})

check('⚠ every card that names a readout points at one, and no other card does', () => {
  // "Fills the leaf" is a sentence about an object the player has never been told the name of, in a
  // corner they have no reason to be looking at — which is how it was reported. A card that names
  // something on the HUD carries which one, and `Hud.highlightRect` says where it is.
  const named = { fruit: 'gauge', shield: 'lives' }

  for (const step of TUTORIAL_STEPS) {
    assert.equal(
      step.highlight,
      named[step.id],
      `the "${step.id}" card points at ${step.highlight ?? 'nothing'} and should point at ${named[step.id] ?? 'nothing'}`,
    )
  }

  // **A pointer on a card that names nothing is worse than none**: it would ring a readout the
  // sentence is not about, which is a wrong answer rather than a missing one.
  const pointing = TUTORIAL_STEPS.filter((step) => step.highlight !== undefined)

  assert.equal(pointing.length, Object.keys(named).length)
  console.log(`    ${pointing.length} of ${TUTORIAL_STEPS.length} cards name a readout: ${pointing.map((step) => `${step.id} -> ${step.highlight}`).join(', ')}`)
})

console.log(`${passed} checks passed`)
