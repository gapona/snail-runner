#!/usr/bin/env node
// Logic check for src/run/playerMotion.ts -- the snail's horizontal spring, in road half-widths
// rather than in screen pixels. Plain assertions, no framework, via the register-ts-loader.mjs +
// ts-extensionless-loader.mjs Node-native-TS setup.
//
// **This suite is the rail shooter's verify:ship, moved into a different space.** The spring is
// the same one (`PLAYER_STIFFNESS`/`PLAYER_DAMPING` are `SHIP_STIFFNESS`/`SHIP_DAMPING`
// unchanged), so the response checks are the same claims about the same integrator; what is new
// is everything to do with *where* the state lives. Three things follow from the move, and each
// gets its own section below:
//
// - the target is a finger position converted through `halfWidthsAtLane`, exact on the player's
//   own row and nowhere else;
// - the walls are world facts (the asphalt's edge, then the ground running out) rather than a
//   fraction of a viewport, so they do not move when the window does;
// - **a bend cannot drag the snail off the road**, because `offsetX` is measured from the road's
//   own projected centre. That is the property the fork exists for, and the last section proves
//   it against `billboardRectInto` rather than asserting it in prose.
import assert from 'node:assert/strict'
import {
  createPlayerState,
  isOffRoad,
  playerScreenFraction,
  stepPlayer,
} from '../src/run/playerMotion.ts'
import {
  OFFROAD_LIMIT,
  PLAYER_DAMPING,
  PLAYER_HALF_WIDTHS,
  PLAYER_STIFFNESS,
  PLAYER_Z,
  ROAD_EDGE,
  halfWidthsAtLane,
  playerResponse,
} from '../src/run/constants.ts'
import { FIXED_STEP_MS } from '../src/race/constants.ts'
import { billboardRectInto, createBillboardRect } from '../src/road/billboard.ts'
import { createScreenPoint, projectInto } from '../src/road/project.ts'
import { CAMERA_DEPTH, CAMERA_HEIGHT, ROAD_WIDTH } from '../src/road/constants.ts'

let passed = 0
function check(name, fn) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

/** Holds a finger at `fraction` across the frame for `ms`, and returns the resulting state. */
function hold(fraction, ms, from = createPlayerState(), dtMs = FIXED_STEP_MS) {
  let state = from

  for (let i = 0; i < Math.round(ms / dtMs); i++) {
    state = stepPlayer(state, { targetFraction: fraction, active: true }, dtMs)
  }

  return state
}

console.log('src/run/playerMotion.ts -- the fixed timestep')

check('one 16.67ms step and two 8.335ms steps land on the same state', () => {
  const one = stepPlayer(createPlayerState(), { targetFraction: 0.8, active: true }, FIXED_STEP_MS)
  let two = createPlayerState()

  two = stepPlayer(two, { targetFraction: 0.8, active: true }, FIXED_STEP_MS / 2)
  two = stepPlayer(two, { targetFraction: 0.8, active: true }, FIXED_STEP_MS / 2)

  assert.ok(Math.abs(one.offsetX - two.offsetX) < 1e-12)
  assert.ok(Math.abs(one.vx - two.vx) < 1e-12)
})

check('a full second of chasing a target lands identically at 30, 60 and 144 Hz', () => {
  const at = (hz) => hold(0.85, 1000, createPlayerState(), 1000 / hz)
  const [slow, normal, fast] = [30, 60, 144].map(at)

  for (const [label, state] of [['30Hz', slow], ['144Hz', fast]]) {
    assert.ok(
      Math.abs(state.offsetX - normal.offsetX) < 1e-9,
      `${label} landed at ${state.offsetX}, 60Hz at ${normal.offsetX}`,
    )
  }
  console.log(`    1s of chase lands at offsetX ${normal.offsetX.toFixed(6)} at every rate`)
})

check('an irregular, jittery frame sequence matches a regular one of the same total time', () => {
  const regular = hold(0.2, 2000)
  let jittery = createPlayerState()
  let elapsed = 0
  let i = 0

  while (elapsed < 2000) {
    const dt = Math.min([3.3, 41.2, 16.7, 9.9, 24.5][i++ % 5], 2000 - elapsed)

    jittery = stepPlayer(jittery, { targetFraction: 0.2, active: true }, dt)
    elapsed += dt
  }

  assert.ok(Math.abs(regular.offsetX - jittery.offsetX) < 1e-9)
})

check('negative and non-finite deltas run nothing rather than integrating backwards', () => {
  for (const dt of [-16, Number.NaN, Number.POSITIVE_INFINITY]) {
    const state = stepPlayer(createPlayerState(), { targetFraction: 0.9, active: true }, dt)

    assert.equal(state.offsetX, 0)
    assert.equal(state.vx, 0)
  }
})

check('stepPlayer is pure -- it never mutates the state it was handed', () => {
  const before = createPlayerState()
  const snapshot = { ...before }

  stepPlayer(before, { targetFraction: 0.9, active: true }, 250)
  assert.deepEqual({ ...before }, snapshot)
})

console.log('the input conversion')

check('the centre of the frame is the centreline, and the conversion is symmetric', () => {
  assert.equal(halfWidthsAtLane(0.5), 0)
  assert.ok(Math.abs(halfWidthsAtLane(0.9) + halfWidthsAtLane(0.1)) < 1e-12)
  assert.ok(halfWidthsAtLane(0.9) > 0, 'the right of the frame must be the right of the road')
})

check('halfWidthsAtLane and playerScreenFraction are inverses', () => {
  // `playerScreenFraction` is what the camera's lean is fed, so a round trip that did not close
  // would lean the camera towards somewhere the snail is not.
  for (const fraction of [0.05, 0.25, 0.5, 0.75, 0.95]) {
    const round = playerScreenFraction(halfWidthsAtLane(fraction))

    assert.ok(Math.abs(round - fraction) < 1e-12, `${fraction} round-tripped to ${round}`)
  }
})

check('the whole road is reachable from inside the frame', () => {
  // If the asphalt's edge sat outside `[0, 1]` of screen fraction, part of the road would be
  // unreachable by any finger position -- the lane would be narrower than the road without
  // anything saying so.
  const edge = playerScreenFraction(ROAD_EDGE)

  assert.ok(edge < 1 && edge > 0.5, `the road's edge is at screen fraction ${edge.toFixed(3)}`)
  console.log(`    the asphalt's edge (offsetX ${ROAD_EDGE}) sits at ${(edge * 100).toFixed(1)}% across the frame`)
})

console.log('the spring')

check('it is a spring, not a teleport', () => {
  const one = stepPlayer(createPlayerState(), { targetFraction: 0.95, active: true }, FIXED_STEP_MS)

  assert.ok(Math.abs(one.offsetX) < Math.abs(halfWidthsAtLane(0.95)) * 0.1, 'one frame closed the gap -- that is a cursor')
  assert.ok(one.vx !== 0, 'but it must have started moving')
})

check('it converges without diverging, and the overshoot stays inside 20%', () => {
  const target = halfWidthsAtLane(0.85)
  let state = createPlayerState()
  const peaks = []
  let crossed = false
  let excursion = 0

  for (let i = 0; i < 240; i++) {
    state = stepPlayer(state, { targetFraction: 0.85, active: true }, FIXED_STEP_MS)

    const past = state.offsetX - target

    if (past > 0) {
      crossed = true
      excursion = Math.max(excursion, past)
    } else if (crossed) {
      peaks.push(excursion)
      crossed = false
      excursion = 0
    }
  }
  if (excursion > 0) peaks.push(excursion)

  for (const [i, peak] of peaks.entries()) {
    assert.ok(peak <= target * 0.2, `overshoot ${i} was ${((peak / target) * 100).toFixed(1)}% of the approach`)
    if (i > 0) assert.ok(peak < peaks[i - 1], 'an overshoot failed to shrink -- that is divergence')
  }
  assert.ok(Math.abs(state.offsetX - target) < target * 0.02, 'it never settled on the target')
  console.log(
    `    overshoot: ${peaks.length === 0 ? 'none' : peaks.map((p) => `${((p / target) * 100).toFixed(1)}%`).join(', ')}`,
  )
})

check('the steady-state lag matches playerResponse().lagPerPointerSpeed', () => {
  // The formula in `constants.ts` is what the two spring constants are meant to be tuned through,
  // so it has to describe the integrator that actually runs -- in this space, not the old one.
  const DRAG = 0.9 // half-widths per second, a brisk sweep across the road
  let state = createPlayerState()
  let target = 0
  let gap = 0
  let gapEarlier = 0
  const TICKS = 600

  for (let i = 0; i < TICKS; i++) {
    target += DRAG * (FIXED_STEP_MS / 1000)
    gap = target - state.offsetX
    if (i === Math.round(TICKS * 0.75)) gapEarlier = gap
    // Straight into the spring rather than through a screen fraction: this drag runs far past the
    // road's edge, and the point is the *unclamped* response.
    state = stepPlayer(state, { targetOffsetX: target, active: true }, FIXED_STEP_MS, { clamp: false })
  }

  const predicted = playerResponse().lagPerPointerSpeed * DRAG

  assert.ok(Math.abs(gap - gapEarlier) < gap * 1e-3, 'the drag had not settled')
  assert.ok(
    Math.abs(gap - predicted) <= predicted * 0.05,
    `measured lag ${gap.toFixed(4)} vs predicted ${predicted.toFixed(4)} half-widths`,
  )
  console.log(`    a ${DRAG}/s drag trails by ${gap.toFixed(4)} half-widths; the formula says ${predicted.toFixed(4)}`)
})

check('playerResponse describes the same spring the integrator runs', () => {
  const shipped = playerResponse()

  assert.equal(shipped.oscillates, shipped.dampingRatio < 1)
  assert.equal(shipped.lagPerPointerSpeed, shipped.decayRate / PLAYER_STIFFNESS)
  assert.ok(playerResponse(12).dampingRatio > 1, 'an overdamped spring must still be identified as one')

  const remainingAfter = (seconds) => {
    const target = halfWidthsAtLane(0.9)

    return Math.abs(target - hold(0.9, seconds * 1000).offsetX) / Math.abs(target)
  }

  assert.ok(remainingAfter(shipped.timeConstantSec) < 0.45, 'one time constant must close most of the gap')
  assert.ok(remainingAfter(shipped.timeConstantSec / 3) > 0.45, 'a third of one must not -- tau would be meaningless')
  console.log(
    `    k=${PLAYER_STIFFNESS} d=${PLAYER_DAMPING}: zeta=${shipped.dampingRatio.toFixed(2)} tau=${shipped.timeConstantSec.toFixed(2)}s`,
  )
})

check('releasing the input coasts back to the centreline without snapping', () => {
  const held = hold(0.95, 1500)
  let released = held

  for (let i = 0; i < 4; i++) released = stepPlayer(released, { targetFraction: 0.5, active: false }, FIXED_STEP_MS)

  assert.ok(Math.abs(released.offsetX) < Math.abs(held.offsetX), 'it did not start coming back')
  assert.ok(Math.abs(released.offsetX) > Math.abs(held.offsetX) * 0.8, 'it snapped rather than coasted')

  // Stepped tick by tick rather than by one 5000ms delta: `runFixedSteps` caps a single call at
  // `MAX_SUB_STEPS` and drops the backlog, which is the right behaviour for a backgrounded tab and
  // the wrong way to fast-forward a test. (Caught exactly that way — the first version of this
  // check ran five ticks and reported the snail parked out at 0.64.)
  let settled = released

  for (let i = 0; i < 300; i++) settled = stepPlayer(settled, { targetFraction: 0.5, active: false }, FIXED_STEP_MS)

  assert.ok(Math.abs(settled.offsetX) < 0.01, `it settled at ${settled.offsetX} instead of the centreline`)
})

console.log('the walls')

check('no input can push the snail past the hard limit', () => {
  // Including targets far outside the frame, which a finger dragged off the edge produces.
  for (const fraction of [-8, -1, 0, 0.5, 1, 2, 40]) {
    const state = hold(fraction, 4000)

    assert.ok(
      Math.abs(state.offsetX) <= OFFROAD_LIMIT + 1e-9,
      `a target at ${fraction} reached offsetX ${state.offsetX}, past the limit of ${OFFROAD_LIMIT}`,
    )
  }
})

check('velocity does not wind up against the wall', () => {
  // The defect this prevents: the spring keeps accumulating while the snail is pinned, and it
  // lurches away the instant the target comes back inside.
  const pinned = hold(40, 3000)

  assert.ok(Math.abs(pinned.vx) < 1e-6, `pinned against the wall with ${pinned.vx} of stored velocity`)

  const back = stepPlayer(pinned, { targetFraction: 0.5, active: true }, FIXED_STEP_MS)

  assert.ok(Math.abs(back.offsetX - pinned.offsetX) < 0.02, 'it lurched off the wall')
})

check('the verge is reachable, and is where off-road begins', () => {
  // **Two edges, not one.** The asphalt ends at `ROAD_EDGE` and the ground at `OFFROAD_LIMIT`;
  // between them the snail is on the verge, which is passable and costs speed. A single hard
  // clamp at the asphalt would make "leaning on the wall" read as the input having stuck.
  assert.ok(OFFROAD_LIMIT > ROAD_EDGE, 'there is no verge to be on')
  // Both gaps are one snail-half wide, and both are computed rather than written down -- so the
  // comparison is against floating-point arithmetic, not against a decimal literal.
  assert.ok(Math.abs(OFFROAD_LIMIT - 1 - PLAYER_HALF_WIDTHS) < 1e-12)
  assert.ok(Math.abs(1 - ROAD_EDGE - PLAYER_HALF_WIDTHS) < 1e-12)

  assert.equal(isOffRoad(0), false)
  assert.equal(isOffRoad(ROAD_EDGE - 1e-9), false)
  assert.equal(isOffRoad(ROAD_EDGE + 1e-6), true)
  assert.equal(isOffRoad(-(ROAD_EDGE + 1e-6)), true, 'the left verge must count too')

  const far = hold(40, 4000)

  assert.ok(isOffRoad(far.offsetX), 'a finger held off the frame does not reach the verge at all')
})

console.log('the bend')

check('a bend moves the road under the snail, and the snail with it', () => {
  // **The property the whole fork is for.** `offsetX` is measured from the road's *own* projected
  // centre, so on a bend -- where that centre slides across the frame -- a still finger keeps the
  // snail at the same place on the asphalt. The screen-space spring the rail shooter used would
  // have fought the curvature instead: the ship would hold its column while the road left it.
  //
  // Proved against `billboardRectInto` rather than asserted in prose: a bend is exactly a
  // difference in the projected ground point, so the same `offsetX` is projected against two very
  // different ones and the *offset from the road's centre* has to come out identical.
  const rect = createBillboardRect()
  const width = 1920
  const height = 945
  const offsetX = 0.62

  const straightGround = projectInto(
    createScreenPoint(),
    { x: 0, y: 0, z: PLAYER_Z },
    0,
    CAMERA_HEIGHT,
    0,
    CAMERA_DEPTH,
    width,
    height,
    ROAD_WIDTH,
  )
  // The same row, with the track's accumulated curvature having pushed the centreline sideways --
  // which is exactly what `RoadMesh.render` hands the billboard pass on a bend. The camera-x it
  // passes is in world units (`playerX * ROAD_WIDTH - x`, where `x` is the integrated curvature),
  // so this is a bend that has carried the centreline 1.4 road-widths off the camera's axis.
  const bentGround = projectInto(
    createScreenPoint(),
    { x: 0, y: 0, z: PLAYER_Z },
    -1.4 * ROAD_WIDTH,
    CAMERA_HEIGHT,
    0,
    CAMERA_DEPTH,
    width,
    height,
    ROAD_WIDTH,
  )

  billboardRectInto(rect, straightGround, offsetX, 0, 40, 40, width, height)
  const onStraight = rect.x - straightGround.x

  billboardRectInto(rect, bentGround, offsetX, 0, 40, 40, width, height)
  const onBend = rect.x - bentGround.x

  assert.ok(
    Math.abs(straightGround.x - bentGround.x) > 100,
    'the two grounds are not far enough apart for this to be measuring anything',
  )
  assert.ok(
    Math.abs(onStraight - onBend) < 1e-9,
    `the snail sat ${onStraight.toFixed(2)}px off the centreline on the straight and ${onBend.toFixed(2)}px on the bend`,
  )
  console.log(
    `    the road's centre moved ${Math.abs(straightGround.x - bentGround.x).toFixed(0)}px across the frame; ` +
      `the snail stayed ${onStraight.toFixed(0)}px from it`,
  )
})

check('stepPlayer takes no track, so no bend can reach it', () => {
  // The structural half of the same claim: the horizontal spring is a function of the finger and
  // the previous state and *nothing else*. There is no track argument to pass, so there is no way
  // for curvature to enter -- which is what makes the check above a statement about the whole
  // system rather than about one call site.
  // `Function.length` counts the parameters before the first defaulted one, so this is
  // `(state, input, dtMs)` -- the options bag does not count, and neither would a track if it
  // were tacked on after one. That is fine for what this is guarding: a track would have to be
  // *required* to be useful, and a required parameter moves this number.
  assert.equal(stepPlayer.length, 3, 'stepPlayer grew a required argument -- if it is the track, the invariant is gone')
})

console.log(`${passed} checks passed`)
