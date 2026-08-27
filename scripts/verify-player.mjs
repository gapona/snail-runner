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
  FEVER_SPEED_FACTOR,
  SPEED_BASE,
  SPEED_CAP,
  halfWidthsAtLane,
  playerResponse,
} from '../src/run/constants.ts'
import { FIXED_STEP_MS } from '../src/race/constants.ts'
import { billboardRectInto, createBillboardRect } from '../src/road/billboard.ts'
import { playerGroundInto } from '../src/run/playerProjection.ts'
import {
  slimeFade,
  slimeIntensity,
  SLIME_MAX_POINTS,
  SLIME_NEAR_CULL_Z,
  SLIME_SPACING_Z,
  stepSlime,
} from '../src/run/slime.ts'
import { createScreenPoint, projectInto } from '../src/road/project.ts'
import { CAMERA_DEPTH, CAMERA_HEIGHT, ROAD_WIDTH, SEGMENT_LENGTH } from '../src/road/constants.ts'

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

/** A ground point at `distance` ahead of the camera, on a flat straight road. */
function groundAt(distance) {
  const scale = CAMERA_DEPTH / distance

  return { x: 960, y: 945 * 0.62 + scale * CAMERA_HEIGHT * 945 * 0.5, w: scale * ROAD_WIDTH * 960, scale }
}

/** The biggest frame-to-frame change in a series, as a percentage of `base`. */
function biggestJump(values, base) {
  let worst = 0

  for (let i = 1; i < values.length; i++) worst = Math.max(worst, Math.abs(values[i] - values[i - 1]))

  return (worst / base) * 100
}

/** A track long enough that nothing in the slime checks wraps by accident. */
const TRACK = 286_800

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

check('releasing the input holds the line rather than returning to the centre', () => {
  // **The defect this replaces was reported as "it keeps pulling to the centre", and it was.**
  // The rail shooter's ship coasted back to a rest point on release, which is right for a craft
  // you fly and let go of. Here the line you are on *is* the decision you just made, and aiming
  // the spring at the centreline undid it every time an arrow key came up or a mouse moved without
  // its button held.
  const held = hold(0.95, 1500)
  let released = held

  for (let i = 0; i < 300; i++) released = stepPlayer(released, { targetFraction: 0.5, active: false }, FIXED_STEP_MS)

  assert.ok(
    Math.abs(released.offsetX - held.offsetX) < 0.02,
    `released at ${held.offsetX.toFixed(3)} and drifted to ${released.offsetX.toFixed(3)}`,
  )
  // ...and it coasts to that stop rather than freezing on the frame the input stopped.
  const coasting = stepPlayer(
    stepPlayer(hold(0.2, 200), { targetFraction: 0.5, active: false }, FIXED_STEP_MS),
    { targetFraction: 0.5, active: false },
    FIXED_STEP_MS,
  )

  assert.ok(coasting.vx !== 0, 'the snail stopped dead on release instead of coasting')
})

check('...and comes to rest, rather than drifting on forever', () => {
  // The other half: zero spring force leaves only the damping, so the velocity has to die.
  let state = hold(0.95, 400)

  assert.ok(Math.abs(state.vx) > 0.01, 'the fixture never got moving')
  for (let i = 0; i < 600; i++) state = stepPlayer(state, { targetFraction: 0.5, active: false }, FIXED_STEP_MS)
  assert.ok(Math.abs(state.vx) < 1e-6, `still drifting at ${state.vx}`)
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

console.log('the projection under the snail')

check('reading the segment its near edge would strobe the snail 11% every segment', () => {
  // **The negative control, and the defect this section exists for.** The snail holds a fixed
  // distance ahead of the camera, so its true projected scale never changes at all -- but the
  // segment beneath it does, every `SEGMENT_LENGTH`. Reading `s1` therefore reports the distance
  // to the segment's *near edge*, which sweeps a whole segment's worth and snaps back.
  const scales = []

  for (let step = 0; step < 200; step++) {
    const cameraZ = step * 17.3 // an arbitrary, non-segment-aligned advance
    const segmentStart = Math.floor((cameraZ + PLAYER_Z) / SEGMENT_LENGTH) * SEGMENT_LENGTH

    scales.push(CAMERA_DEPTH / (segmentStart - cameraZ))
  }

  const swing = (Math.max(...scales) - Math.min(...scales)) / Math.min(...scales)

  assert.ok(swing > 0.1, `the near-edge read only swings ${(swing * 100).toFixed(1)}% -- this control has stopped measuring`)
  console.log(`    near-edge read: ${(swing * 100).toFixed(1)}% swing, ${biggestJump(scales, Math.min(...scales)).toFixed(1)}% in a single frame`)
})

check('interpolating across the segment holds the snail steady instead', () => {
  // The fix, measured the same way. What has to be true is not that the scale is *constant* -- a
  // linear interpolation of a reciprocal cannot be -- but that it never jumps: a smooth 1% drift
  // is invisible, an 11% snap is a strobe.
  const out = { x: 0, y: 0, w: 0, scale: 0 }
  const scales = []

  for (let step = 0; step < 200; step++) {
    const cameraZ = step * 17.3
    const worldZ = cameraZ + PLAYER_Z
    const segmentStart = Math.floor(worldZ / SEGMENT_LENGTH) * SEGMENT_LENGTH
    // The two edges as the mesh projects them, with no curvature so the scale is the only variable.
    const near = groundAt(segmentStart - cameraZ)
    const far = groundAt(segmentStart + SEGMENT_LENGTH - cameraZ)

    playerGroundInto(out, near, far, worldZ)
    scales.push(out.scale)
  }

  const base = Math.min(...scales)
  const swing = (Math.max(...scales) - base) / base
  const worstFrame = biggestJump(scales, base)

  assert.ok(swing < 0.03, `the interpolated scale still swings ${(swing * 100).toFixed(1)}%`)
  assert.ok(worstFrame < 0.5, `a single frame still moves it ${worstFrame.toFixed(1)}%`)
  console.log(`    interpolated:   ${(swing * 100).toFixed(1)}% swing, ${worstFrame.toFixed(2)}% in a single frame`)
})

check('the interpolation is continuous across a segment boundary, which is what removes the snap', () => {
  // The property that makes it work at all: `s2` of one segment is `s1` of the next, so the value
  // either side of a boundary is the same. Sampled a hair before and after one.
  const out = { x: 0, y: 0, w: 0, scale: 0 }
  const boundary = SEGMENT_LENGTH * 12
  const read = (worldZ) => {
    const cameraZ = worldZ - PLAYER_Z
    const segmentStart = Math.floor(worldZ / SEGMENT_LENGTH) * SEGMENT_LENGTH

    return playerGroundInto(
      out,
      groundAt(segmentStart - cameraZ),
      groundAt(segmentStart + SEGMENT_LENGTH - cameraZ),
      worldZ,
    ).scale
  }
  const before = read(boundary - 1e-6)
  const after = read(boundary + 1e-6)

  assert.ok(
    Math.abs(after - before) / before < 1e-6,
    `the scale jumps by ${(((after - before) / before) * 100).toFixed(2)}% across a segment boundary`,
  )
})

console.log('the slime trail')

check('slime is laid by distance travelled, not by frames', () => {
  // The same rule the glide cycle follows. A trail spaced by *time* would thin out exactly when
  // the run got fast, which is backwards for something whose job is to express speed.
  const points = []
  const lay = (steps, dz) => {
    for (let i = 0; i < steps; i++) {
      const distance = points.length === 0 ? i * dz : i * dz
      stepSlime(points, distance, i * dz, 0, SPEED_BASE, TRACK)
    }
  }

  lay(200, 15)
  // 200 steps of 15 units is 3000 travelled; at 60 units apart that is 50 points, minus whatever
  // the cull has taken. What must not happen is one per step.
  assert.ok(points.length < 60, `laid ${points.length} points over 3000 units — one per frame, not one per ${SLIME_SPACING_Z}`)
  assert.ok(points.length > 20, `laid only ${points.length} points over 3000 units`)
})

check('a long frame lays one point, not a burst', () => {
  // A stalled tab hands back a multi-second delta. Laying one blob per `SLIME_SPACING_Z` of the
  // *jump* would dump a dozen at once on the frame it recovers; comparing against the last laid
  // position rather than a stored timestamp is what prevents it.
  const points = []

  stepSlime(points, 0, 0, 0, SPEED_CAP, TRACK)
  stepSlime(points, 40_000, 40_000, 0, SPEED_CAP, TRACK)

  assert.equal(points.length, 1, `a 40 000-unit frame laid ${points.length} points`)
})

check('points are dropped once they pass the camera, so the trail is bounded', () => {
  const points = []

  for (let i = 0; i < 400; i++) stepSlime(points, i * 30, i * 30, 0, SPEED_CAP, TRACK)

  assert.ok(points.length <= SLIME_MAX_POINTS, `the trail grew to ${points.length} points`)
  // And what is left is the band between the camera and the snail — nothing behind.
  for (const point of points) {
    const ahead = point.z - (399 * 30)

    assert.ok(ahead > -1e-6 && ahead <= PLAYER_Z + SLIME_SPACING_Z + 1e-6, `a point sits ${ahead.toFixed(0)} ahead`)
  }
})

check('the trail records the line the player took, not the centreline', () => {
  // The whole reason it earns its place: everything else in the frame says what is coming, this is
  // the only thing that says what you just did.
  const points = []

  for (let i = 0; i < 40; i++) stepSlime(points, i * 60, i * 60, Math.sin(i / 4) * 0.6, SPEED_BASE, TRACK)

  const offsets = points.map((p) => p.offsetX)

  assert.ok(Math.max(...offsets) > 0.3 && Math.min(...offsets) < -0.3, 'the trail came out straight through a weave')
})

check('width and strength both rise with speed, and a boost pushes past the ceiling', () => {
  assert.equal(slimeIntensity(SPEED_BASE), 0)
  assert.ok(Math.abs(slimeIntensity(SPEED_CAP) - 1) < 1e-9)
  // Clamped *above* 1, not at it: the trail is the clearest place in the frame to show the player
  // going faster than the game's own cap.
  assert.ok(slimeIntensity(SPEED_CAP * FEVER_SPEED_FACTOR) > 1, 'Fever does not read as faster than the cap')
  assert.ok(slimeIntensity(SPEED_CAP * 10) <= 1.25, 'the intensity is unbounded')

  const slow = []
  const fast = []

  stepSlime(slow, 0, 0, 0, SPEED_BASE, TRACK)
  stepSlime(fast, 0, 0, 0, SPEED_CAP, TRACK)
  assert.ok(fast[0].halfWidth > slow[0].halfWidth * 1.5, 'the trail barely widens with speed')
  assert.ok(fast[0].strength > slow[0].strength * 1.5, 'the trail barely brightens with speed')
  console.log(
    `    at ${SPEED_BASE}u/s: ${slow[0].halfWidth.toFixed(3)} wide at ${slow[0].strength.toFixed(2)} strength; ` +
      `at ${SPEED_CAP}: ${fast[0].halfWidth.toFixed(3)} at ${fast[0].strength.toFixed(2)}`,
  )
})

check('the drying gradient falls across the band that is actually on screen', () => {
  // **The regression this replaces.** The first version ramped over the closest 55% of the trail --
  // and that band projects entirely *below the frame*, so it dimmed the part nobody sees and left
  // the visible ribbon flat. It read as painted road marking rather than as something wet.
  //
  // The visible band is roughly `ahead` 1100 to `PLAYER_Z`, so the gradient has to be measurable
  // across it.
  const atSnail = slimeFade(PLAYER_Z)
  const atFrameEdge = slimeFade(PLAYER_Z * 0.56)

  assert.ok(atSnail > 0.99, `the newest slime is only at ${atSnail.toFixed(2)} of its laid strength`)
  assert.ok(
    atFrameEdge < atSnail * 0.92,
    `across the visible band the fade only moves from ${atSnail.toFixed(2)} to ${atFrameEdge.toFixed(2)} — flat`,
  )
  console.log(`    on-screen fade: ${atSnail.toFixed(2)} under the snail to ${atFrameEdge.toFixed(2)} at the frame's edge`)
})

check('nothing is drawn nearer than the cull, where the projection blows up', () => {
  // Not a look decision: projected width goes as `1 / ahead`, and a point at `ahead = 164` measured
  // 668 pixels wide entirely below the frame. The fade reaching zero at the cull is what keeps it
  // from blinking out rather than fading out.
  assert.equal(slimeFade(SLIME_NEAR_CULL_Z), 0)
  assert.equal(slimeFade(SLIME_NEAR_CULL_Z - 1), 0)
  assert.equal(slimeFade(0), 0)
  assert.ok(slimeFade(SLIME_NEAR_CULL_Z + 1) > 0, 'the fade does not resume above the cull')
})

console.log(`${passed} checks passed`)
