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
import { createLookBack, glanceBack, LOOK_BACK, lookBackTurn, stepLookBack } from '../src/run/lookBack.ts'
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
  MAX_DESCENT_DROP,
  PLAYER_BODY_H,
  PLAYER_REST_Y_FRACTION,
  PLAYER_WIDTH,
  PLAYER_Z,
  REACHABLE_EDGE,
  ROAD_EDGE,
  STEER_REACH,
  STEER_REACH_MARGIN,
  FEVER_SPEED_FACTOR,
  HIT_INVULNERABLE_Z,
  MAX_ATTAINABLE_SPEED,
  SPEED_BASE,
  SPEED_CAP,
  halfWidthsAtLane,
  playerResponse,
  steerTarget,
  STEER_EDGE_MARGIN,
} from '../src/run/constants.ts'
import { FIXED_STEP_MS } from '../src/race/constants.ts'
import { RELATIVE_SENSITIVITY_DEFAULT, STEER_PRESETS, SWIPE_CROSS_SHARE, dragScale, getSteerTuning, relativeTarget } from '../src/run/steerTuning.ts'
import { JOYSTICK, createJoystick, joystickRadius, moveJoystick, pressJoystick, releaseJoystick, settleJoystick } from '../src/platform/joystick.ts'
import { readFileSync } from 'node:fs'
import { createSteerProbe, steerReport, stepSteerProbe } from '../src/run/steerProbe.ts'
import { billboardRectInto, createBillboardRect } from '../src/road/billboard.ts'
import { groundPointInto } from '../src/run/groundProjection.ts'
import {
  slimeFade,
  slimeIntensity,
  slimeSwell,
  slimeGlint,
  SLIME_SWELL,
  SLIME_GLINT,
  SLIME_HALF_WIDTH,
  SLIME_MAX_POINTS,
  SLIME_NEAR_CULL_Z,
  SLIME_SPACING_Z,
  stepSlime,
} from '../src/run/slime.ts'
import { createScreenPoint, projectInto } from '../src/road/project.ts'
import { buildRunCircuit } from '../src/road/circuits.ts'
import { WORLD_LAYER } from '../src/run/worldDepth.ts'
import {
  DEATH_FLASH_MS,
  DEATH_SPIN_DEGREES,
  DEATH_SWELL,
  NOT_DEAD,
  PLAYER_DEATH_MS,
  createPlayerDeath,
  deathComplete,
  deathFlash,
  deathSpin,
  hasDied,
  hullBurstProgress,
  hullFade,
  hullSwell,
  isDying,
  startPlayerDeath,
} from '../src/run/playerDeath.ts'
import { addShield, canTakeShield, createRunState, takeHit } from '../src/run/runState.ts'
import { MAX_SHIELDS, RUN_LIVES } from '../src/run/constants.ts'
import { groundYAt, trackLengthOf } from '../src/road/track.ts'
import { PICKUP_OFFSET } from '../src/run/pickups.ts'

/**
 * How far in from the frame's edge the furthest thing the player must reach has to sit.
 *
 * A thumb held against the bezel is not a position anyone can hold, and the outer strip of a phone
 * screen belongs to the system's own edge gestures. 24px is about a finger's own width of margin —
 * a regression threshold measured on 2026-09-06, not a derived one.
 */
const MIN_EDGE_REACH_PX = 24
import { RAMP_MAX_OFFSET } from '../src/run/ramp.ts'
import { PASSABILITY_OFFSETS } from '../src/run/obstacles.ts'
import { HORIZON_Y } from '../src/road/constants.ts'
import { CAMERA_DEPTH, CAMERA_HEIGHT, ROAD_WIDTH, SEGMENT_LENGTH, SPRITE_SCALE } from '../src/road/constants.ts'
import {
  SHIELD_BREATH,
  SHIELD_BUBBLE_SPAN,
  SHIELD_POP,
  shieldBreathAlpha,
  shieldBreathScale,
  shieldPopAlpha,
  shieldPopScale,
} from '../src/run/shield.ts'

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

check('⚠ what a finger can reach is what the passability proof samples', () => {
  // **⚠ The whole road used to be reachable and is not any more, deliberately.** `STEER_REACH_MARGIN`
  // crossed 1 to buy the mascot a quantum of size, so a finger at the very edge of the frame asks
  // for `STEER_REACH` and the last sliver of asphalt cannot be steered to.
  //
  // What that makes load-bearing is that the *proof* follows the reach: `provePassable` certifies a
  // row at `OFFSETS`, and a line through ground nobody can steer to is not a line. This is the
  // assertion that keeps the two together.
  const edge = playerScreenFraction(REACHABLE_EDGE)

  assert.ok(edge <= 1 + 1e-9 && edge > 0.5, `the reachable edge is at screen fraction ${edge.toFixed(3)}`)
  assert.ok(
    Math.abs(STEER_REACH - halfWidthsAtLane(1)) < 1e-12,
    'STEER_REACH is not what a finger at the frame edge actually asks for',
  )
  assert.equal(REACHABLE_EDGE, Math.min(ROAD_EDGE, STEER_REACH), 'the reachable edge is not the narrower of the two facts')
  // The proof's own samples, read back from the module that makes them rather than restated here.
  const widest = Math.max(...PASSABILITY_OFFSETS)

  assert.ok(
    Math.abs(widest - REACHABLE_EDGE) < 1e-9,
    `the passability proof samples out to ${widest.toFixed(4)} against a reach of ${REACHABLE_EDGE.toFixed(4)}`,
  )

  // **Everything the player is required to reach has to be inside it.** Obstacles are not: a thing
  // to avoid may stand anywhere, and that asymmetry is the whole reason `REACHABLE_EDGE` is only
  // the authority for the proof.
  assert.ok(PICKUP_OFFSET.max < REACHABLE_EDGE, `a pickup can be laid at ${PICKUP_OFFSET.max.toFixed(3)}, past the reach`)
  assert.ok(RAMP_MAX_OFFSET < REACHABLE_EDGE, `a ramp can be laid at ${RAMP_MAX_OFFSET.toFixed(3)}, past the reach`)

  // **The control is the arrangement this replaces**: sampling the asphalt while the reach is
  // narrower than it, which is what would certify a row nobody can pass.
  assert.ok(ROAD_EDGE > REACHABLE_EDGE, 'the reach covers the whole road, so this check is measuring nothing')
  console.log(
    `    a finger at the frame's edge reaches offsetX ${STEER_REACH.toFixed(4)} of a ${ROAD_EDGE.toFixed(4)} road` +
      ` — the outer ${(((ROAD_EDGE - STEER_REACH) / ROAD_EDGE) * 100).toFixed(1)}% is spent, and the proof samples the rest`,
  )
  console.log(
    `    inside it: pickups to ${PICKUP_OFFSET.max.toFixed(3)}, ramps to ${RAMP_MAX_OFFSET.toFixed(3)}`,
  )
})

check('⚠ the outermost pickup can be reached without a finger on the bezel', () => {
  // **This is the report**: on a phone the snail could not be steered to the very edge, and that is
  // where coins and fruit are laid. Both halves are the same number — the pointer used to map
  // linearly across the *whole* frame, so full lock was at 100% of it and the outermost pickup at
  // 97.7%, i.e. **nine pixels from the edge of a 383px screen**. A thumb cannot hold that, and on
  // most phones the strip belongs to the system's own edge gestures.
  const at = (target) => {
    let lo = 0.5
    let hi = 1

    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2

      if (steerTarget(mid) < target) lo = mid
      else hi = mid
    }

    return (lo + hi) / 2
  }
  // The mapping is what it always was, with the ends brought in off the glass: same maximum, same
  // `REACHABLE_EDGE`, same passability proof. Asserted, because a deadzone that quietly narrowed
  // the reach would be a row nobody can pass wearing an ergonomics fix.
  assert.ok(Math.abs(steerTarget(1) - STEER_REACH) < 1e-9, 'the deadzone moved the reach itself')
  assert.ok(Math.abs(steerTarget(0) + STEER_REACH) < 1e-9, 'the deadzone is not symmetric')
  assert.ok(Math.abs(steerTarget(0.5)) < 1e-9, 'the centre of the frame is no longer the centreline')
  for (let i = 1; i <= 40; i++) {
    assert.ok(steerTarget(i / 40) >= steerTarget((i - 1) / 40) - 1e-12, 'the mapping is not monotonic')
  }

  const rows = []
  const failedBefore = []

  for (const width of [320, 375, 383, 844, 1280]) {
    const pickupPx = (1 - at(PICKUP_OFFSET.max)) * width
    const lockPx = (1 - at(REACHABLE_EDGE)) * width
    // The old mapping, as the control: the bare projection, which is what shipped.
    const wasPx = (1 - (0.5 + (0.5 * PICKUP_OFFSET.max) / STEER_REACH)) * width

    assert.ok(pickupPx >= MIN_EDGE_REACH_PX, `the outer pickup is ${pickupPx.toFixed(0)}px from the edge at ${width}px`)
    failedBefore.push(wasPx < MIN_EDGE_REACH_PX)
    rows.push(`${width}px: pickup ${pickupPx.toFixed(0)}px in (was ${wasPx.toFixed(0)}), full lock ${lockPx.toFixed(0)}px in`)
  }
  // **The control is the mapping that shipped, and it is asserted on the frames the report came
  // from.** It clears the floor on a desktop — 29px at 1280 — which is why this was a mobile
  // report and not a general one: the same 2.3% of the frame is nine pixels on a phone.
  assert.ok(failedBefore.filter(Boolean).length >= 3, 'the shipped-before mapping cleared the floor everywhere, so this measures nothing')
  for (const row of rows) console.log(`    ${row}`)
  console.log(`    the outer ${(STEER_EDGE_MARGIN * 100).toFixed(0)}% of each side is full lock`)
})


/**
 * The frames the mascot's size is accepted at, narrowest first, and the render it is drawn from.
 *
 * The texture size is an external fact — the shipped `snail-0.png` — exactly as `MASCOT_ASPECT` is,
 * and the contour's drawn width is a function of it.
 */
const MASCOT_FRAMES = [
  [320, 568],
  [375, 667],
  [1080, 1920],
  [844, 390],
  [1920, 945],
]
/** What the mascot is, as a share of the frame's width, at every one of them. */
const MASCOT_WIDTH_SHARE = 0.145

/** The mascot's drawn box, through the game's own projection and billboard. */
function mascotDrawnBox(width, height, z = PLAYER_Z) {
  const ground = projectInto(
    createScreenPoint(),
    { x: 0, y: 0, z },
    0,
    CAMERA_HEIGHT,
    0,
    CAMERA_DEPTH,
    width,
    height,
    ROAD_WIDTH,
  )
  const rect = billboardRectInto(
    createBillboardRect(),
    ground,
    0,
    0,
    PLAYER_WIDTH / SPRITE_SCALE,
    PLAYER_BODY_H / SPRITE_SCALE,
    width,
    height,
  )

  return { w: rect.w, h: rect.h, feet: rect.y }
}

/** `PLAYER_Z` for a rest row, which is `PLAYER_REST_Y_FRACTION`'s own solve read backwards. */
function zForRestRow(rest) {
  return CAMERA_DEPTH / ((2 * (rest - HORIZON_Y)) / CAMERA_HEIGHT)
}

/**
 * `PLAYER_Z_SOLVED`'s own snap: the row is quantised to quarter-segments so the depth sort has a
 * stable tiebreak, which is why a bound only matters through the quantum it permits.
 */
function snapZ(raw) {
  return (Math.ceil(raw / SEGMENT_LENGTH - 0.25) + 0.25) * SEGMENT_LENGTH
}

/** The `offsetX` a finger at the very edge of the screen asks for, at that distance. */
function edgeReach(z) {
  return 1 / ((CAMERA_DEPTH / z) * ROAD_WIDTH)
}

check('⚠ how much of a frame the mascot is, and what every lever that could change it is worth', () => {
  // **Written before the constant moves, which is the whole point of it.** Reported: the snail is
  // about 5% of a portrait frame's height and gets lost against the road, with the instruction to
  // grow it *in portrait* via the camera or `PLAYER_Z` rather than by scaling the sprite. This
  // measures what is actually there and what each lever would buy, so the decision is taken against
  // numbers rather than against an impression — and so that a later attempt starts from a floor.
  const rows = []

  for (const [w, h] of MASCOT_FRAMES) {
    const box = mascotDrawnBox(w, h)

    // **The one invariant, and it is the answer to "small in portrait".** Everything on this road is
    // scaled by the frame's WIDTH, so the mascot is the same share of it at every viewport; what
    // differs is the share of the *height*, because a portrait frame is tall. That is a property of
    // the projection rather than of any constant.
    assert.ok(
      Math.abs(box.w / w - MASCOT_WIDTH_SHARE) < 1e-3,
      `the mascot is ${((box.w / w) * 100).toFixed(1)}% of the width at ${w}x${h}, not ${(MASCOT_WIDTH_SHARE * 100).toFixed(1)}%`,
    )
    rows.push(
      `${String(w).padStart(4)}x${String(h).padEnd(4)} ${box.w.toFixed(0).padStart(4)}x${box.h.toFixed(0).padStart(3)}px` +
        `  ${((box.w / w) * 100).toFixed(1)}% of width  ${((box.h / h) * 100).toFixed(1)}% of height`,
    )
  }

  const steering = HORIZON_Y + CAMERA_HEIGHT / (2 * ROAD_WIDTH * ROAD_EDGE * STEER_REACH_MARGIN)
  const descent = 1 - MAX_DESCENT_DROP
  const headroom = Math.min(steering, descent) - PLAYER_REST_Y_FRACTION

  // **The rest row is at its bound**, which is what closes the one lever that costs nothing: the
  // snap to `PLAYER_SEGMENT_PHASE` has already spent what the bounds left.
  assert.ok(headroom >= 0, `the rest row is ${(-headroom).toFixed(4)} past its own bound`)
  assert.ok(
    headroom < 0.02,
    `the rest row has ${headroom.toFixed(4)} of headroom left, i.e. the mascot could be grown for free and is not`,
  )

  // **⚠ The steering lever has been spent, and this is the assertion that says there is nothing
  // left.** `PLAYER_SEGMENT_PHASE` snaps the row to quarter-segments, so the bounds only matter
  // through *which quantum they permit* — and the row now sits on the same quantum the descent
  // bound permits, which is the last one either bound allows. Standing the snail as near as the
  // descent rule alone would is worth exactly zero further pixels.
  const [narrowW, narrowH] = MASCOT_FRAMES[0]
  const now = mascotDrawnBox(narrowW, narrowH)
  const atDescent = mascotDrawnBox(narrowW, narrowH, snapZ(zForRestRow(descent)))

  assert.ok(
    atDescent.w <= now.w + 1e-6,
    `the descent bound would give a further ${(atDescent.w - now.w).toFixed(1)}px, i.e. the row has not reached its quantum`,
  )
  // ...and the next quantum in is genuinely past both bounds, so this is a wall rather than a
  // rounding. One quarter-segment nearer is what the snap would take if either bound allowed it.
  const nextIn = PLAYER_Z - SEGMENT_LENGTH
  const restNextIn = HORIZON_Y + (CAMERA_DEPTH * CAMERA_HEIGHT) / (2 * nextIn)

  assert.ok(
    restNextIn > Math.min(steering, descent),
    `a quarter-segment nearer is still inside the bounds at rest ${restNextIn.toFixed(4)}, i.e. the row is not at its wall`,
  )

  for (const row of rows) console.log(`    ${row}`)
  console.log(`    bounds: steering ${steering.toFixed(4)}, descent ${descent.toFixed(4)}, shipped ${PLAYER_REST_Y_FRACTION.toFixed(4)} (${headroom.toFixed(5)} left)`)
  console.log(
    `    the row is on the last quantum both bounds allow: one segment nearer needs rest ${restNextIn.toFixed(4)}` +
      ` against a bound of ${Math.min(steering, descent).toFixed(4)}, and the mascot is ${now.w.toFixed(0)}px at ${narrowW}x${narrowH}`,
  )
})

check('⚠ the row the player rests on is solved, and it is what sizes the mascot', () => {
  // **The only lever that makes the snail bigger without touching a hitbox.** Everything on this
  // road is scaled by the frame's width, so the mascot cannot be grown on a phone alone -- but
  // standing it nearer the camera grows it everywhere, and the collision box does not move. Two
  // things bound how near, and the row is the lower of them.
  //
  // **One: a finger at the edge of the screen must still be able to ask for the edge of the road**,
  // or the verge stops being somewhere the player can choose to go.
  const reach = halfWidthsAtLane(1)
  const steering = HORIZON_Y + CAMERA_HEIGHT / (2 * ROAD_WIDTH * ROAD_EDGE * STEER_REACH_MARGIN)

  assert.ok(
    reach >= ROAD_EDGE * STEER_REACH_MARGIN - 1e-9,
    `the screen's edge only asks for offsetX ${reach.toFixed(3)} against an asphalt edge at ${ROAD_EDGE.toFixed(3)}`,
  )

  // **Two: the road falls away on a descent, and the mascot must not fall off the frame with it.**
  // This is the bound the first version of the solve missed, and a player found it in one
  // screenshot going down a hill.
  const descent = 1 - MAX_DESCENT_DROP
  const bound = Math.min(steering, descent)

  assert.ok(
    PLAYER_REST_Y_FRACTION <= bound + 1e-9,
    `the rest row ${PLAYER_REST_Y_FRACTION.toFixed(4)} is past the bounds' ${bound.toFixed(4)}`,
  )

  // **Three: the snail must not sit on a segment boundary**, which is a rule about the painter's
  // order rather than about the picture — see `PLAYER_SEGMENT_PHASE`, and the check below that
  // measures the consequence. The snap only ever pushes the player further from the camera, so it
  // spends size the bounds had allowed rather than breaking them.
  const frac = (PLAYER_Z / SEGMENT_LENGTH) % 1
  const boundZ = CAMERA_DEPTH / ((2 * (bound - HORIZON_Y)) / CAMERA_HEIGHT)

  assert.ok(Math.abs(frac - 0.25) < 1e-9, `the player sits ${frac.toFixed(3)} into its segment, not on the phase`)
  assert.ok(PLAYER_Z >= boundZ - 1e-9, 'the snap moved the player nearer the camera, which the bounds forbid')
  assert.ok(PLAYER_Z - boundZ < SEGMENT_LENGTH, 'the snap gave away more than one segment of the size the bounds allowed')

  const at = (rest) => (PLAYER_WIDTH * (2 * (rest - HORIZON_Y))) / CAMERA_HEIGHT / 2

  console.log(
    `    steering allows ${steering.toFixed(4)}, the steepest descent allows ${descent.toFixed(4)} — ` +
      `the ${steering < descent ? 'steering' : 'descent'} binds at ${bound.toFixed(4)}, and the segment ` +
      `phase snaps it to ${PLAYER_REST_Y_FRACTION.toFixed(4)}`,
  )
  console.log(
    `    the mascot is ${(at(PLAYER_REST_Y_FRACTION) * 375).toFixed(0)}px wide on a 375px frame, against ` +
      `${(at(5 / 6) * 375).toFixed(0)}px on the rail shooter's inherited 5/6 row — the same collision box in both`,
  )

  // Both bounds shown to bite, because a bound that has never rejected anything is not a bound.
  const tooLow = HORIZON_Y + CAMERA_HEIGHT / (2 * ROAD_WIDTH * ROAD_EDGE * 0.95)

  assert.ok(
    CAMERA_HEIGHT / (2 * (tooLow - HORIZON_Y) * ROAD_WIDTH) < ROAD_EDGE,
    'the steering control row is reachable, so that half is measuring nothing',
  )
  assert.ok(descent < 1, 'the descent bound allows the whole frame, so that half is measuring nothing')
})

check('⚠ the snail is far enough into its segment for the depth order to come out right', () => {
  // **There is no depth buffer**: everything sorts on `worldDepth(distanceIndex, layer)` with the
  // layer as a sub-segment tiebreak, so the snail's fractional position IS what decides whether an
  // obstacle on its own segment paints over it. Asserted on the real layers rather than on the
  // 0.1 the constant's docstring quotes, so a re-ordered `WORLD_LAYER` fails here.
  const frac = (PLAYER_Z / SEGMENT_LENGTH) % 1
  const behind = WORLD_LAYER.player - WORLD_LAYER.obstacle
  const ahead = WORLD_LAYER.pickup - WORLD_LAYER.player

  assert.ok(frac > behind, `an obstacle on the snail's own segment draws behind it (${frac} <= ${behind})`)
  assert.ok(1 - frac > ahead, `a pickup one segment ahead draws over the snail (${1 - frac} <= ${ahead})`)

  // Shown to bite, on the row the bounds alone would have chosen: 0.077 into its segment, which is
  // what `verify:obstacles` rejected before the phase existed.
  assert.ok(0.077 <= behind, 'the control fraction is legal, so this check is measuring nothing')
  console.log(
    `    ${(PLAYER_Z / SEGMENT_LENGTH).toFixed(2)} segments out, ${(frac * 100).toFixed(0)}% into its own — ` +
      `legal window is ${(behind * 100).toFixed(0)}%..${((1 - ahead) * 100).toFixed(0)}%`,
  )
})

check('⚠ MAX_DESCENT_DROP is what the real circuit actually does, and the snail survives it', () => {
  // **Measured against the track rather than trusted.** The constant is a fact about
  // `buildRunCircuit`; a re-composed circuit moves it, and a rest row solved from a stale value
  // would put the mascot off the bottom of the frame on exactly the stretch nobody tests on.
  //
  // The drop does not depend on `PLAYER_Z`: it is `scale * gradient * PLAYER_Z * h / 2` with
  // `scale = CAMERA_DEPTH / PLAYER_Z`, so the distance cancels and `CAMERA_DEPTH * gradient / 2` is
  // left. That is why standing the snail nearer the camera buys size without making this worse.
  const track = buildRunCircuit()
  const length = trackLengthOf(track.length)
  const height = 667
  const width = 375
  const steps = 4000
  const flat = PLAYER_REST_Y_FRACTION
  let worstFeet = 0
  let worstHidden = 0

  const drawnPx = (PLAYER_BODY_H * (2 * (flat - HORIZON_Y)) * width) / CAMERA_HEIGHT / 2

  for (let i = 0; i < steps; i++) {
    const z = (i / steps) * length
    const cameraY = groundYAt(track, z) + CAMERA_HEIGHT
    const worldY = groundYAt(track, (z + PLAYER_Z) % length)
    const feet =
      projectInto(
        createScreenPoint(),
        { x: 0, y: worldY, z: PLAYER_Z },
        0,
        cameraY,
        0,
        CAMERA_DEPTH,
        width,
        height,
        ROAD_WIDTH,
      ).y / height

    worstFeet = Math.max(worstFeet, feet)
    worstHidden = Math.max(worstHidden, Math.min(1, Math.max(0, ((feet - 1) * height) / drawnPx)))
  }

  const measured = worstFeet - flat

  assert.ok(
    measured <= MAX_DESCENT_DROP + 1e-3,
    `the circuit drops ${(measured * 100).toFixed(1)}% of the frame against a stated ${(MAX_DESCENT_DROP * 100).toFixed(1)}%`,
  )
  // The property the constant exists for. **Strict**: a softer version of this passed while the
  // frame showed a sliver of shell along the bottom edge, which is the report again in a smaller
  // size. The player has to be able to see the thing they are steering.
  assert.equal(worstHidden, 0, `the steepest descent hides ${(worstHidden * 100).toFixed(0)}% of the mascot`)
  console.log(
    `    the steepest descent drops the ground ${(measured * 100).toFixed(1)}% of the frame; feet reach ` +
      `${(worstFeet * 100).toFixed(1)}% and at worst ${(worstHidden * 100).toFixed(0)}% of a ${drawnPx.toFixed(0)}px mascot is off the bottom`,
  )
})

console.log('the wreck')

check('⚠ the run does not end on the frame the last life goes', () => {
  // **The defect this exists for, and the fork shipped it twice.** `takeHit` went straight to
  // `scene.pause()` and the result panel: the snail was mid-stride, the road was still scrolling,
  // and the screen reporting the crash arrived over a frame in which no crash had been drawn.
  const death = createPlayerDeath()

  assert.equal(hasDied(death), false)
  assert.equal(deathComplete(death, 1000), false, 'a living player must not end the run')
  assert.equal(startPlayerDeath(death, 500), true, 'the killing hit did not start the wreck')
  assert.equal(isDying(death, 500), true)
  assert.equal(deathComplete(death, 500 + PLAYER_DEATH_MS - 1), false, 'the panel arrived mid-wreck')
  assert.equal(deathComplete(death, 500 + PLAYER_DEATH_MS), true, 'the wreck never finished')
  console.log(`    ${PLAYER_DEATH_MS}ms of wreck before the result screen`)
})

check('a second fatal hit neither restarts the wreck nor ends the run twice', () => {
  // Two obstacles in one row is ordinary, and the second must not stretch the death or fire
  // `endRun` again -- that call pauses the scene and launches the panel.
  const death = createPlayerDeath()

  assert.equal(startPlayerDeath(death, 100), true)
  assert.equal(startPlayerDeath(death, 140), false, 'a second hit restarted the wreck')
  assert.equal(death.startedAt, 100, 'the second hit moved the clock')
})

check('⚠ NOT_DEAD is not zero, so a death on the first frame is still a death', () => {
  // A scene's first frame can report `now === 0` -- this project's own stepping harness does
  // exactly that -- and a sentinel of 0 would make "died at once" indistinguishable from "alive".
  assert.ok(NOT_DEAD < 0, `NOT_DEAD is ${NOT_DEAD}, which a real timestamp can equal`)

  const death = createPlayerDeath()

  assert.equal(startPlayerDeath(death, 0), true)
  assert.equal(hasDied(death), true, 'a death on the first frame reads as alive')
})

check('the hull swells, fades and turns, and each lands on its endpoint', () => {
  let swell = 0
  let fade = 1
  let spin = -1

  for (let i = 0; i <= 100; i++) {
    const t = i / 100

    assert.ok(hullSwell(t) >= swell - 1e-9, 'the swell went back in')
    assert.ok(hullFade(t) <= fade + 1e-9, 'the hull became more solid')
    assert.ok(deathSpin(t) >= spin - 1e-9, 'the wreck turned back')
    swell = hullSwell(t)
    fade = hullFade(t)
    spin = deathSpin(t)
  }
  assert.ok(Math.abs(hullSwell(0) - 1) < 1e-9 && Math.abs(hullSwell(1) - DEATH_SWELL) < 1e-9)
  assert.ok(Math.abs(hullFade(0) - 1) < 1e-9 && Math.abs(hullFade(1)) < 1e-9, 'the wreck never finished fading')
  assert.ok(Math.abs(deathSpin(1) - DEATH_SPIN_DEGREES) < 1e-9)
  // Eased opposite ways, which is the whole read: most of the swell is spent early and the fade
  // holds for a beat. A pair that eased the same way would be a balloon deflating.
  assert.ok(hullSwell(0.5) > 1 + (DEATH_SWELL - 1) * 0.5, 'the swell is not front-loaded -- it reads as inflating')
  assert.ok(hullFade(0.5) > 0.5, 'the hull starts vanishing on the frame of impact')
  console.log(
    `    half way: ${((hullSwell(0.5) - 1) / (DEATH_SWELL - 1) * 100).toFixed(0)}% of the swell spent, ` +
      `${(hullFade(0.5) * 100).toFixed(0)}% of the hull left`,
  )
})

check('⚠ the flash is over well before the panel arrives', () => {
  // A frame flash that outlived the wreck would put the result panel behind a coloured frame
  // nobody asked for -- and it is the *reserved* colour, so it would read as an ongoing threat.
  assert.ok(DEATH_FLASH_MS < PLAYER_DEATH_MS, `the flash runs ${DEATH_FLASH_MS}ms of a ${PLAYER_DEATH_MS}ms wreck`)

  const death = createPlayerDeath()

  startPlayerDeath(death, 0)
  assert.equal(deathFlash(death, 0), 1, 'the flash is not loudest on the frame of impact')
  assert.equal(deathFlash(death, DEATH_FLASH_MS), 0)
  assert.equal(deathFlash(death, PLAYER_DEATH_MS), 0, 'the panel arrives under a lit frame')
  assert.equal(deathFlash(createPlayerDeath(), 500), 0, 'a living player flashes')
  // And the burst is shorter still, so the debris outlives the hull that threw it.
  assert.equal(hullBurstProgress(death, PLAYER_DEATH_MS), 1)
  console.log(`    flash ${DEATH_FLASH_MS}ms, hull burst ends inside a ${PLAYER_DEATH_MS}ms wreck`)
})

console.log('the spring')

check('it is a spring, not a teleport', () => {
  const one = stepPlayer(createPlayerState(), { targetFraction: 0.95, active: true }, FIXED_STEP_MS)

  assert.ok(Math.abs(one.offsetX) < Math.abs(halfWidthsAtLane(0.95)) * 0.1, 'one frame closed the gap -- that is a cursor')
  assert.ok(one.vx !== 0, 'but it must have started moving')
})

check('it converges without diverging, and the overshoot stays inside 20%', () => {
  // `steerTarget`, not `halfWidthsAtLane`: the input path brings the ends of the travel in off the
  // glass (`STEER_EDGE_MARGIN`), and a check that restates the bare projection here would be
  // measuring the spring against a target the spring was never given.
  const target = steerTarget(0.85)
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
  // **⚠ And the pointer path can no longer ASK for past the reach**, which is new: `steerTarget`
  // saturates at both ends, so a fraction outside the frame is full lock rather than a request to
  // stand further out. The wall below is therefore reached through `targetOffsetX`, which is the
  // path a scripted mover uses — see `PlayerInput`.
  for (const fraction of [-8, 2, 40]) {
    assert.ok(Math.abs(steerTarget(fraction)) <= STEER_REACH + 1e-9, `a fraction of ${fraction} asks for past the reach`)
  }
})

check('velocity does not wind up against the wall', () => {
  // The defect this prevents: the spring keeps accumulating while the snail is pinned, and it
  // lurches away the instant the target comes back inside.
  // Driven by `targetOffsetX` rather than by a fraction: the pointer path saturates at the reach
  // now (`steerTarget`), and the reach is inside `OFFROAD_LIMIT`, so a fraction can no longer pin
  // the snail against the wall at all. What is under test is the wall, not the input.
  let pinned = createPlayerState()

  for (let i = 0; i < Math.round(3000 / FIXED_STEP_MS); i++) {
    pinned = stepPlayer(pinned, { targetOffsetX: OFFROAD_LIMIT * 3, active: true }, FIXED_STEP_MS)
  }

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

  // **⚠ The verge is reached by the spring's OVERSHOOT, not by holding a finger there**, and this
  // check used to say otherwise: it drove a fraction of 40 — a finger notionally forty frames off
  // the screen — which the old linear mapping extrapolated far past the road. That stopped being a
  // thing the input can produce when `STEER_REACH_MARGIN` crossed 1 (full lock is 0.864 against an
  // asphalt edge of 0.875) and cannot be produced at all now that `steerTarget` saturates. What is
  // true is what `STEER_REACH_MARGIN`'s own note says: a hard flick carries the snail out there.
  let flicked = hold(0, 2000)
  let peak = 0

  for (let i = 0; i < 120; i++) {
    flicked = stepPlayer(flicked, { targetFraction: 1, active: true }, FIXED_STEP_MS)
    peak = Math.max(peak, flicked.offsetX)
  }

  assert.ok(isOffRoad(peak), `a flick across the road peaks at ${peak.toFixed(3)}, which never leaves the asphalt`)
  assert.ok(!isOffRoad(STEER_REACH), 'full lock is already off the road, so the overshoot is not what puts it there')
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

    groundPointInto(out, near, far, worldZ)
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

    return groundPointInto(
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


check("⚠ the trail's edges swell, and the same point always swells the same way", () => {
  // **Two parallel edges are a road marking.** Slime is viscous and pools unevenly, so each side of
  // the ribbon bulges and pinches — and the two sides are drawn from different hashes, because
  // mirrored wobble reads as a shape rather than as a spill.
  //
  // Deterministic from the point's own `z`, for `decorVariation`'s reason: a point has to look the
  // same on the frame after it was laid, on the next lap and at every viewport. What that rules out
  // is an RNG stream, which can only be walked in order.
  const zs = Array.from({ length: 400 }, (_, i) => i * SLIME_SPACING_Z)
  const swells = zs.map((z) => slimeSwell(z))

  for (const z of zs) {
    const again = slimeSwell(z)
    const first = slimeSwell(z)

    assert.equal(again.left, first.left, 'the same point swells differently on two calls')
  }
  // Both sides move, and they are not each other.
  const sameCount = swells.filter((s2) => Math.abs(s2.left - s2.right) < 1e-9).length

  assert.equal(sameCount, 0, `${sameCount} points swell identically on both sides, i.e. the ribbon is mirrored`)
  const all = swells.flatMap((s2) => [s2.left, s2.right])
  const mean = all.reduce((a, b) => a + b, 0) / all.length

  assert.ok(Math.abs(mean - 1) < 0.03, `the swell means ${mean.toFixed(3)}, so the trail is not its own width on average`)
  assert.ok(Math.max(...all) <= 1 + SLIME_SWELL + 1e-9 && Math.min(...all) >= 1 - SLIME_SWELL - 1e-9, 'the swell leaves its own band')
  // It has to actually reach the band, or the constant is doing nothing.
  assert.ok(Math.max(...all) > 1 + SLIME_SWELL * 0.9, 'the swell never approaches its own ceiling')
  console.log(
    `    the edges swell ${Math.min(...all).toFixed(2)}..${Math.max(...all).toFixed(2)} of the trail's own width, mean ${mean.toFixed(3)}`,
  )
})

check('⚠ glints are laid in the world, on one side, and not on every point', () => {
  // A uniformly bright core is a painted stripe with a lighter stripe inside it; a wet surface
  // catches light in points. They are laid at world positions so they slide down the road with
  // everything else rather than shimmering in place.
  const zs = Array.from({ length: 2000 }, (_, i) => i * SLIME_SPACING_Z)
  const glints = zs.map((z) => slimeGlint(z))
  const lit = glints.filter((g) => g !== 0)
  const share = lit.length / glints.length

  assert.ok(Math.abs(share - SLIME_GLINT.chance) < 0.05, `${(share * 100).toFixed(0)}% of points glint against a stated ${(SLIME_GLINT.chance * 100).toFixed(0)}%`)
  assert.ok(lit.some((g) => g < 0) && lit.some((g) => g > 0), 'every glint is on the same side of the trail')
  assert.ok(lit.every((g) => Math.abs(g) >= 0.25), 'a glint sits on the centreline, where the core already is')
  assert.ok(lit.every((g) => Math.abs(g) <= 0.65 + 1e-9), 'a glint sits outside the trail')
  for (const z of zs.slice(0, 50)) assert.equal(slimeGlint(z), slimeGlint(z), 'a glint is not stable for its own point')
  // **⚠ Not a fixed period**, which would beat against the spacing and read as a dashed line.
  const gaps = []
  let last = -1

  glints.forEach((g, i) => {
    if (g === 0) return
    if (last >= 0) gaps.push(i - last)
    last = i
  })
  assert.ok(new Set(gaps).size > 3, 'the glints fall on a fixed period, i.e. the trail is dashed')
  console.log(`    ${(share * 100).toFixed(0)}% of points glint, at ${new Set(gaps).size} different spacings`)
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
  const boosted = []

  stepSlime(slow, 0, 0, 0, SPEED_BASE, TRACK)
  stepSlime(fast, 0, 0, 0, SPEED_CAP, TRACK)
  stepSlime(boosted, 0, 0, 0, SPEED_CAP * FEVER_SPEED_FACTOR, TRACK)
  assert.ok(fast[0].halfWidth > slow[0].halfWidth * 1.5, 'the trail barely widens with speed')
  assert.ok(fast[0].strength > slow[0].strength * 1.5, 'the trail barely brightens with speed')

  // **⚠ The headroom above 1 reached nothing for as long as it existed.** `slimeIntensity` clamps
  // at 1.25 with a docstring saying the trail is the clearest place in the frame to show the player
  // going faster than the game's own ceiling — and `stepSlime` then took `Math.min(1, intensity)`
  // for both the width and the strength, so a Fever and a run at `SPEED_CAP` laid *exactly the same
  // slime*. Fifth piece of authored state this project has found doing nothing.
  assert.ok(
    boosted[0].halfWidth > fast[0].halfWidth * 1.05,
    `a Fever lays a ${boosted[0].halfWidth.toFixed(4)} trail against the cap's ${fast[0].halfWidth.toFixed(4)}`,
  )
  assert.ok(boosted[0].strength >= fast[0].strength, 'a Fever lays a duller trail than the cap')
  assert.ok(boosted[0].strength <= 1, 'the strength is unbounded')
  // The control is the arithmetic that shipped: clamped at 1, the two are the same number.
  const clamped = (v) => SLIME_HALF_WIDTH.slow + (SLIME_HALF_WIDTH.fast - SLIME_HALF_WIDTH.slow) * Math.min(1, v)

  assert.equal(
    clamped(slimeIntensity(SPEED_CAP * FEVER_SPEED_FACTOR)),
    clamped(slimeIntensity(SPEED_CAP)),
    'the control does not flatten the headroom, i.e. this check measures nothing',
  )
  console.log(
    `    at the cap the trail is ${fast[0].halfWidth.toFixed(4)} wide; in a Fever ${boosted[0].halfWidth.toFixed(4)}` +
      ` (+${(((boosted[0].halfWidth / fast[0].halfWidth) - 1) * 100).toFixed(0)}%), where it used to be identical`,
  )
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

check('a shield the player cannot hold is never granted, and never laid in front of them', () => {
  // **⚠ `addShield` used to have no ceiling at all**, which is why the readout for it had to invent
  // one -- five pips and then a `+`, i.e. a count to read rather than a shape to glance at. The rule
  // belongs with the state, and the row is a length again because of it. See `MAX_SHIELDS`.
  let run = createRunState()

  assert.equal(run.shields, 0, 'a run starts holding a shield')
  assert.ok(canTakeShield(run), 'a fresh run could not take a shield')

  for (let i = 0; i < 6; i++) run = addShield(run)
  assert.equal(run.shields, MAX_SHIELDS, `six shields collected left ${run.shields} carried`)
  assert.ok(!canTakeShield(run), 'a full run still says it can take another shield')

  // One, because a shield is *the next mistake is free* and that sentence does not stack. Two would
  // be a second life bought at a pickup's price on top of the three the run already grants, and the
  // ceiling on carelessness is the one thing `RUN_LIVES` is for.
  assert.equal(MAX_SHIELDS, 1, 'the shield stopped being a single absorber')

  // And it is spent before a life, which is what makes the survivability row readable left to
  // right: the leftmost element is always the next one to go.
  const hit = takeHit(run)

  assert.equal(hit.shields, 0, 'the hit did not spend the shield')
  assert.equal(hit.lives, RUN_LIVES, 'the hit took a life while a shield was carried')
  assert.ok(canTakeShield(hit), 'spending the shield did not make room for another')
  assert.ok(hit.speed < run.speed, 'the shield absorbed the speed loss as well as the life')

  // **The whole point of `canTakeShield` being a question rather than a clamp**: a pickup the player
  // drives through and is given nothing for does not teach "you are full", it teaches "pickups are
  // unreliable". `RunScene.withholdShields` asks this before the shield is ever drawn.
  assert.equal(canTakeShield.length, 1, 'canTakeShield grew an argument that is not the run')
  assert.equal(addShield(run).shields, run.shields, 'a shield collected at the cap changed the run')
})

check('⚠ the shield is visible in all three of its moments, and the break outlives the shield', () => {
  // The defect this is about: a shield was a `◆` on the coin counter, and spending one looked and
  // sounded exactly like losing a life. See `shield.ts` for the three cues.

  // 1. Carried: the bubble breathes, so it cannot read as a decal painted onto the mascot.
  let minScale = Infinity
  let maxScale = -Infinity
  let minAlpha = Infinity
  let maxAlpha = -Infinity

  for (let ms = 0; ms < 60000; ms += 17) {
    minScale = Math.min(minScale, shieldBreathScale(ms))
    maxScale = Math.max(maxScale, shieldBreathScale(ms))
    minAlpha = Math.min(minAlpha, shieldBreathAlpha(ms))
    maxAlpha = Math.max(maxAlpha, shieldBreathAlpha(ms))
  }

  assert.ok(maxScale - minScale > 0.05, 'the carried bubble does not move, so it reads as part of the sprite')
  assert.ok(minAlpha > 0.3, `the bubble fades to ${minAlpha.toFixed(2)}, i.e. it disappears while still being carried`)

  // **Two incommensurate periods, so nothing a player sees repeats.** One sine and the eye finds
  // the period in about three cycles — the same argument `SUN_ANIM` is built on.
  const beat = (SHIELD_BREATH.sizePeriodMs * SHIELD_BREATH.alphaPeriodMs) / gcd(SHIELD_BREATH.sizePeriodMs, SHIELD_BREATH.alphaPeriodMs)

  assert.ok(beat > 20000, `the two breaths line up every ${(beat / 1000).toFixed(1)}s, which is a mechanism`)

  // 2. Broken: thrown outward and faded, and the two curves ease opposite ways so the burst is
  // still solid at the size it is worth seeing.
  assert.equal(shieldPopScale(0), 1)
  assert.ok(shieldPopScale(1) > 1.5, 'the break barely grows')
  assert.equal(shieldPopAlpha(1), 0)
  assert.ok(shieldPopAlpha(0.5) > shieldPopAlpha(1) + 0.2, 'the break has faded out before it is big')

  let previousScale = 0
  let previousAlpha = Infinity

  for (let t = 0; t <= 1.0001; t += 0.02) {
    assert.ok(shieldPopScale(t) >= previousScale, 'the break stops growing part way')
    assert.ok(shieldPopAlpha(t) <= previousAlpha, 'the break brightens part way')
    previousScale = shieldPopScale(t)
    previousAlpha = shieldPopAlpha(t)
  }

  // Half the expansion is spent well before half the window — a burst, not a balloon.
  assert.ok(
    shieldPopScale(0.33) - 1 > (shieldPopScale(1) - 1) * 0.6,
    'the break expands evenly, which reads as a balloon rather than as something coming apart',
  )

  // 3. **The window is well inside the grace a hit buys**, or a second hit would land while the
  // first shield was still visibly breaking — the player watching a shield they no longer have.
  const graceMs = (HIT_INVULNERABLE_Z / MAX_ATTAINABLE_SPEED) * 1000

  assert.ok(
    SHIELD_POP.durationMs < graceMs,
    `the break runs ${SHIELD_POP.durationMs}ms against ${graceMs.toFixed(0)}ms of grace at top speed`,
  )
  // And the bubble must reach past the mascot, or it is not around anything.
  assert.ok(SHIELD_BUBBLE_SPAN > 1.1, 'the bubble does not clear the snail it is drawn around')

  console.log(
    `    carried: scale ${minScale.toFixed(2)}..${maxScale.toFixed(2)} at alpha ${minAlpha.toFixed(2)}..${maxAlpha.toFixed(2)}, ` +
      `repeating every ${(beat / 1000).toFixed(0)}s; break: ${SHIELD_POP.durationMs}ms to ${shieldPopScale(1).toFixed(2)}x ` +
      `against ${graceMs.toFixed(0)}ms of grace at ${MAX_ATTAINABLE_SPEED} u/s`,
  )
})

function gcd(a, b) {
  return b === 0 ? a : gcd(b, a % b)
}


console.log('\nthe mascot glances back')

check('a glance starts, peaks in the middle and ends exactly on time', () => {
  const fixed = () => 0.5
  let state = createLookBack(0, fixed)

  assert.equal(lookBackTurn(state, 0), 0, 'a fresh mascot is already turning')

  state = glanceBack(state, 1000, fixed)

  assert.ok(lookBackTurn(state, 1000) < 0.01, 'the turn steps rather than easing in')
  assert.ok(lookBackTurn(state, 1000 + LOOK_BACK.durationMs / 2) > 0.99, 'the turn does not reach its extreme')
  assert.equal(lookBackTurn(state, 1000 + LOOK_BACK.durationMs), 0, 'the turn is still going when the window closes')

  // Off the end and before the start are both rest, for `progress01`'s reason: the stepping harness
  // hands back a clock that can run backwards, and an unclamped curve would extrapolate.
  assert.equal(lookBackTurn(state, 999), 0)
  assert.equal(lookBackTurn(state, 5000), 0)
})

check('an event mid-glance is absorbed, not restarted', () => {
  // Two pickups half a second apart would otherwise reset the curve mid-turn, which reads as a
  // stutter rather than as a second glance.
  const fixed = () => 0.5
  let state = glanceBack(createLookBack(0, fixed), 1000, fixed)
  const peak = lookBackTurn(state, 1000 + LOOK_BACK.durationMs / 2)

  state = glanceBack(state, 1000 + LOOK_BACK.durationMs / 2, fixed)

  assert.equal(lookBackTurn(state, 1000 + LOOK_BACK.durationMs / 2), peak, 'a second event restarted the turn')
})

check('the idle clock fires inside its own window and never twice at once', () => {
  const fixed = () => 0.5
  let state = createLookBack(0, fixed)
  const starts = []

  for (let now = 0; now <= 60000; now += 16) {
    const before = state.startedAt

    state = stepLookBack(state, now, fixed)
    if (state.startedAt >= 0 && state.startedAt !== before) starts.push(state.startedAt)
  }

  assert.ok(starts.length >= 5, `only ${starts.length} idle glances in a minute`)

  for (let i = 1; i < starts.length; i++) {
    const gap = starts[i] - starts[i - 1]

    assert.ok(
      gap >= LOOK_BACK.durationMs + LOOK_BACK.minGapMs - 32 && gap <= LOOK_BACK.durationMs + LOOK_BACK.maxGapMs + 32,
      `two glances ${gap}ms apart, outside the ${LOOK_BACK.minGapMs}..${LOOK_BACK.maxGapMs} window`,
    )
  }
})

/* ------------------------------------------------------------------ *
 * The steering tuning, and the probe that measures it
 *
 * Both exist because of a report that the controls are awkward on a phone -- see
 * `src/run/steerTuning.ts` and `scripts/measure-steering.mjs`. What is asserted here is only what
 * a check can hold: that switching nothing changes nothing, that the presets are the points they
 * are documented as, and that the two pure rules do what their docstrings claim.
 * ------------------------------------------------------------------ */

check('the spring defaults are the shipped constants, so nothing moved by existing', () => {
  const input = { targetOffsetX: 0.6, active: true }
  let bare = createPlayerState()
  let named = createPlayerState()

  for (let i = 0; i < 60; i++) {
    bare = stepPlayer(bare, input, 16.67)
    named = stepPlayer(named, input, 16.67, { stiffness: PLAYER_STIFFNESS, damping: PLAYER_DAMPING })
  }

  assert.equal(bare.offsetX, named.offsetX, 'passing the shipped constants explicitly is not a no-op')
})

check('the `current` preset is the shipped pair exactly, so the comparison carries its own control', () => {
  assert.equal(STEER_PRESETS.current.stiffness, PLAYER_STIFFNESS)
  assert.equal(STEER_PRESETS.current.damping, PLAYER_DAMPING)
})

check('all three presets are stable, and `snappy` beats `current` on every axis at once', () => {
  const solved = {}

  for (const [name, preset] of Object.entries(STEER_PRESETS)) {
    const response = playerResponse(preset.stiffness, preset.damping)

    assert.ok(Number.isFinite(response.timeConstantSec), `${name} diverges`)
    assert.ok(response.timeConstantSec > 0, `${name} does not settle`)
    solved[name] = response

    // ...and the closed form has to agree with the integrator it claims to solve, or every number
    // printed on the panel is a measurement of a fiction.
    let state = createPlayerState()
    const options = { stiffness: preset.stiffness, damping: preset.damping, clamp: false }
    let worst = 0

    for (let i = 0; i < 240; i++) {
      state = stepPlayer(state, { targetOffsetX: 1, active: true }, 16.67, options)
      worst = Math.max(worst, Math.abs(state.offsetX - 1))
    }
    assert.ok(Math.abs(state.offsetX - 1) < 0.01, `${name} does not reach its target (${state.offsetX.toFixed(3)})`)
    assert.ok(worst < 2, `${name} diverges under the real tick (worst ${worst.toFixed(2)})`)
  }

  assert.ok(solved.viscous.dampingRatio > 1, 'viscous overshoots, so it is not the viscous one')
  assert.ok(solved.snappy.timeConstantSec < solved.current.timeConstantSec, 'snappy is not faster')
  assert.ok(solved.snappy.dampingRatio > solved.current.dampingRatio, 'snappy overshoots more, not less')
  assert.ok(solved.snappy.lagPerPointerSpeed < solved.current.lagPerPointerSpeed, 'snappy trails a drag more')

  console.log(
    `    viscous zeta ${solved.viscous.dampingRatio.toFixed(2)} tau ${(solved.viscous.timeConstantSec * 1000).toFixed(0)}ms | ` +
      `current ${solved.current.dampingRatio.toFixed(2)} ${(solved.current.timeConstantSec * 1000).toFixed(0)}ms | ` +
      `snappy ${solved.snappy.dampingRatio.toFixed(2)} ${(solved.snappy.timeConstantSec * 1000).toFixed(0)}ms`,
  )
})

check('a relative drag integrates the request, and does not read the snail back', () => {
  // Three arguments and none of them is a position: `relativeTarget` cannot see where the snail
  // got to, so the spring's own lag cannot feed back into the request. Asserted as the arity, the
  // same way `stepCritters` is held to being unable to steer.
  assert.equal(relativeTarget.length, 3, 'relativeTarget takes something other than (previous, delta, sensitivity)')

  const sensitivity = 1.75
  let target = 0

  for (let i = 0; i < 10; i++) target = relativeTarget(target, 0.05, sensitivity)

  assert.ok(
    Math.abs(target - 10 * 0.05 * sensitivity) < 1e-9,
    `ten equal pushes did not sum (${target.toFixed(4)})`,
  )
  assert.equal(relativeTarget(0.4, 0, sensitivity), 0.4, 'a still finger moved the request')
})

check('the probe files a gesture, not a frame, and only counts visible overshoots', () => {
  const snailHalf = PLAYER_HALF_WIDTHS
  const dt = 16.67

  /** Drives the probe: the thumb slides to `to` over `frames`, then holds while the snail settles. */
  const gesture = (to, snailAt) => {
    const probe = createSteerProbe()
    let want = 0
    let now = 0

    for (let i = 0; i < 12; i++) {
      want += to / 12
      stepSteerProbe(probe, { want, active: true, at: snailAt(now), gapPx: 0, snailHalf, now })
      now += dt
    }
    for (let i = 0; i < 90; i++) {
      stepSteerProbe(probe, { want, active: true, at: snailAt(now), gapPx: 0, snailHalf, now })
      now += dt
    }
    stepSteerProbe(probe, { want, active: false, at: snailAt(now), gapPx: 0, snailHalf, now })

    return probe
  }

  // **A thumb sliding for twelve frames is one ask, not twelve.** This is the rule the first
  // version of the probe got wrong: it opened a request per movement, filed 35 of them for one
  // drag, and reported that 34 never arrived because each was superseded by the next.
  const sliding = gesture(0.6, () => 0.6)

  assert.equal(sliding.requests.length, 1, `one slide filed ${sliding.requests.length} gestures`)

  // The arrival clock starts when the thumb *stops*, so a snail already there arrives at once.
  assert.equal(sliding.requests[0].arriveMs, 0, 'a snail already on the target reported a settling time')

  // A snail that never gets there reports no arrival rather than a wrong one.
  const missed = gesture(0.6, () => 0)

  assert.equal(missed.requests[0].arriveMs, null, 'a snail that never arrived reported a time anyway')
  assert.ok(missed.requests[0].travel > 0.5, 'the gesture did not record how far it asked')

  // A settle inside the noise is not an overshoot; a full crossing past the target is.
  const settled = gesture(0.6, (now) => (now < 12 * dt ? 0 : 0.6 + 0.02 * Math.sign(Math.sin(now))))
  // Approaches from below, *through* the request, out the far side, and back — one overshoot. It
  // has to pass through: a snail that teleports past without ever arriving has not overshot, it has
  // been somewhere else, and the counter deliberately says nothing until the request was met once.
  const swung = gesture(0.6, (now) => (now < 12 * dt ? 0 : now < 20 * dt ? 0.6 : now < 45 * dt ? 0.9 : 0.6))

  assert.equal(settled.requests[0].overshoots, 0, 'settling noise was counted as an overshoot')
  assert.ok(swung.requests[0].overshoots >= 1, 'a full crossing past the request was not counted')

  const report = steerReport(swung, snailHalf)

  assert.equal(report.requests, 1)
  assert.ok(report.arriveMsMean !== null, 'a gesture that arrived reported no arrival time')
})

check('the thumbstick is a thumb wide on a phone and not a plate on a tablet', () => {
  // A stick narrower than a thumb is one the thumb covers entirely; a stick sized off a tablet's
  // short side is a dinner plate. Both ends are bounds rather than tastes.
  const rows = [[320, 568], [384, 744], [844, 390], [1280, 720], [1920, 945]].map(([w, h]) => [w, h, joystickRadius(w, h)])

  for (const [w, h, r] of rows) {
    assert.ok(r >= JOYSTICK.minRadius && r <= JOYSTICK.maxRadius, `${w}x${h}: radius ${r}`)
  }
  assert.equal(joystickRadius(320, 568), JOYSTICK.minRadius, 'the narrowest phone should be held at the floor')
  assert.equal(joystickRadius(1920, 945), JOYSTICK.maxRadius, 'a desktop frame should be held at the ceiling')
  console.log(`    radius: ${rows.map(([w, h, r]) => `${w}x${h} ${r.toFixed(0)}px`).join(', ')}`)
})

check('the stick appears under the thumb, follows it past the rim, and never clamps', () => {
  const stick = createJoystick()
  const r = 50

  assert.equal(moveJoystick(stick, 10, 10, r), false, 'an inactive stick answered a move')
  pressJoystick(stick, 200, 600)
  assert.deepEqual([stick.baseX, stick.baseY, stick.knobX, stick.knobY, stick.armed], [200, 600, 200, 600, true])

  // Inside the rim the base stays where the thumb landed.
  moveJoystick(stick, 230, 600, r)
  assert.deepEqual([stick.baseX, stick.baseY], [200, 600])

  // Past it, the base is pulled along so the knob sits exactly on the rim, in the thumb's direction.
  moveJoystick(stick, 330, 600, r)
  assert.equal(stick.knobX, 330, 'the knob is not under the thumb')
  assert.ok(Math.abs(Math.hypot(stick.knobX - stick.baseX, stick.knobY - stick.baseY) - r) < 1e-9, 'the knob left the rim')
  assert.equal(stick.baseX, 280, 'the base did not follow the thumb past the rim')

  releaseJoystick(stick)
  assert.equal(stick.active, false)
  assert.equal(moveJoystick(stick, 330, 500, r), false, 'a released stick jumped')
})

check('a press that flicked is remembered through its release and forgotten by the next press', () => {
  // The tap on the release of a flick is the second jump of one gesture; the scene asks this flag
  // at exactly that moment, so it has to survive the release and die with the next press.
  const r = 46
  const stick = createJoystick()

  pressJoystick(stick, 200, 600)
  assert.equal(moveJoystick(stick, 200, 600 - r, r), true)
  releaseJoystick(stick)
  assert.equal(stick.flicked, true, 'the release forgot the flick before the tap could ask')
  pressJoystick(stick, 200, 600)
  assert.equal(stick.flicked, false, 'a new press inherited the flick of the last one, and its tap would be swallowed')
})

check('a push up jumps once, and only once, until the stick comes back down', () => {
  const stick = createJoystick()
  const r = 50
  const jumps = []

  pressJoystick(stick, 200, 600)
  // Straight up, in the small steps a pointer reports: exactly one jump, on the crossing.
  for (let y = 600; y >= 520; y -= 4) jumps.push(moveJoystick(stick, 200, y, r))
  assert.equal(jumps.filter(Boolean).length, 1, `${jumps.filter(Boolean).length} jumps for one push`)
  const crossedAt = 600 - 4 * jumps.indexOf(true)
  assert.ok(600 - crossedAt >= JOYSTICK.jumpShare * r, `it jumped ${600 - crossedAt}px up, before the threshold`)

  // Held up there, nothing more; back down past the re-arm line and up again, a second jump.
  assert.equal(moveJoystick(stick, 200, stick.baseY - r, r), false, 'a held push jumped again')
  moveJoystick(stick, 200, stick.baseY - JOYSTICK.rearmShare * r * 0.5, r)
  assert.equal(stick.armed, true, 'coming back down did not re-arm it')
  assert.equal(moveJoystick(stick, 200, stick.baseY - r * 0.8, r), true, 'the second push did not jump')
})

check('a flick up jumps from wherever the thumb has been steering, not only from a fresh stick', () => {
  // **⚠ Driven in the running game, the first version did not.** A 96px steer right left the knob
  // on the rim, and a 30px push up from there was 26px up against 38px sideways — no jump. The base
  // drifts back under the thumb now, so what counts is how far a push got ahead of it.
  const r = 46
  const frame = 1000 / 60
  const steerThenFlick = (settle) => {
    const stick = createJoystick()
    let jumped = 0

    pressJoystick(stick, 150, 620)
    for (let i = 1; i <= 12; i++) {
      moveJoystick(stick, 150 + 8 * i, 620, r)
      if (settle) settleJoystick(stick, frame, r)
    }
    // Held still for 300ms, which is a player lining up.
    for (let i = 0; i < 18; i++) if (settle) settleJoystick(stick, frame, r)
    // A 30px flick up over 100ms, one pointer event a frame.
    for (let i = 1; i <= 6; i++) {
      if (moveJoystick(stick, 246, 620 - 5 * i, r)) jumped++
      if (settle) settleJoystick(stick, frame, r)
    }

    return jumped
  }

  assert.equal(steerThenFlick(true), 1, 'a flick after a steer did not jump exactly once')
  assert.equal(steerThenFlick(false), 0, 'the control jumped: without the drift a flick after a steer is sideways, which is the report')
})

check('a slow drift up is followed rather than read as a jump, at 60Hz and at 144Hz alike', () => {
  const r = 46

  for (const hz of [60, 144]) {
    const stick = createJoystick()
    const frame = 1000 / hz
    let jumped = 0

    pressJoystick(stick, 200, 620)
    // 30px over a second: a thumb creeping, not flicking.
    for (let i = 1; i <= hz; i++) {
      if (moveJoystick(stick, 200, 620 - (30 * i) / hz, r)) jumped++
      settleJoystick(stick, frame, r)
    }
    assert.equal(jumped, 0, `${hz}Hz: a slow drift jumped`)
  }

  // The drift itself is frame-rate invariant: where the base has got to after 200ms of a still
  // thumb does not depend on how many frames that was.
  // Frame counts that make exactly 200ms each, so the comparison is of the drift and not of a
  // rounded duration.
  const settled = (frames) => {
    const stick = createJoystick()

    pressJoystick(stick, 0, 0)
    moveJoystick(stick, 40, 0, r)
    for (let i = 0; i < frames; i++) settleJoystick(stick, 200 / frames, r)

    return stick.baseX
  }

  assert.ok(Math.abs(settled(12) - settled(29)) < 1e-9, `the base drifts ${settled(12).toFixed(3)} at 60Hz and ${settled(29).toFixed(3)} at 144Hz`)
})

check('a thumb that stays up re-arms once the base catches it, so a second flick needs no reset', () => {
  const r = 46
  const frame = 1000 / 60
  const stick = createJoystick()
  let jumps = 0
  let y = 620

  pressJoystick(stick, 200, y)
  for (let i = 0; i < 6; i++) {
    y -= 5
    if (moveJoystick(stick, 200, y, r)) jumps++
    settleJoystick(stick, frame, r)
  }
  assert.equal(jumps, 1)
  for (let i = 0; i < 40; i++) settleJoystick(stick, frame, r)
  assert.equal(stick.armed, true, 'a thumb held up never re-armed')
  for (let i = 0; i < 6; i++) {
    y -= 5
    if (moveJoystick(stick, 200, y, r)) jumps++
    settleJoystick(stick, frame, r)
  }
  assert.equal(jumps, 2, 'the second flick did not jump')
})

check('steering sideways with a thumb that arcs is not a jump', () => {
  // **The failure to be afraid of is a jump nobody asked for**, and the gesture that produces it is
  // the ordinary one: a thumb swept across the screen draws an arc, rising in the middle. Up has to
  // be the dominant direction as well as far enough, measured after the base has followed.
  const r = 50

  for (const rise of [0.3, 0.6, 1.2]) {
    const stick = createJoystick()
    let jumped = 0

    pressJoystick(stick, 60, 650)
    for (let i = 0; i <= 60; i++) {
      const t = i / 60
      const x = 60 + 260 * t
      const y = 650 - r * rise * Math.sin(Math.PI * t)

      if (moveJoystick(stick, x, y, r)) jumped++
      settleJoystick(stick, 1000 / 60, r)
    }
    assert.equal(jumped, 0, `a sideways sweep rising ${rise}R jumped ${jumped} times`)
  }

  // And a push that goes further sideways than up, however far up it goes, is steering.
  const stick = createJoystick()

  pressJoystick(stick, 200, 600)
  assert.equal(moveJoystick(stick, 200 + r * 0.7, 600 - r * 0.6, r), false, 'a diagonal leaning sideways jumped')
  // The control: the same height straight up does jump, so the test above is not passing by the
  // threshold never being reached.
  const straight = createJoystick()

  pressJoystick(straight, 200, 600)
  assert.equal(moveJoystick(straight, 200, 600 - r * 0.6, r), true, 'the control did not jump')
})

check('one swipe crosses the whole road, in portrait and in landscape', () => {
  // **⚠ Reported from the phone: one gesture should go from edge to edge, and a swipe across the
  // screen fell a little short.** The sensitivity was a whole frame WIDTH per road, and a thumb
  // starts and stops a finger's width in from each edge. What is asserted is a swipe a thumb can
  // actually make — the frame minus 12% at each end, i.e. about 45px in on a phone — measured in the
  // same units `RunScene` hands `relativeTarget`.
  const road = 2 * REACHABLE_EDGE
  const swipeCovers = (w, h, sensitivity, share) => {
    let target = -REACHABLE_EDGE

    // The swipe arrives as a string of pointer moves, which is how the scene sees it.
    for (let i = 0; i < 20; i++) target = relativeTarget(target, (share / 20) * dragScale(w, h), sensitivity)

    return (target + REACHABLE_EDGE) / road
  }
  const rows = []

  for (const [w, h] of [[320, 568], [384, 744], [844, 390], [744, 384]]) {
    // A thumb's swipe is a physical length: three quarters of the short side, whichever way up.
    const thumbOfWidth = (0.76 * Math.min(w, h)) / w
    const shipped = swipeCovers(w, h, RELATIVE_SENSITIVITY_DEFAULT, thumbOfWidth)
    // The control is the shipped-before arrangement: a whole frame WIDTH of drag per road.
    const old = thumbOfWidth

    rows.push(`${w}x${h} ${(shipped * 100).toFixed(0)}% (was ${(old * 100).toFixed(0)}%)`)
    assert.ok(shipped >= 1.1, `${w}x${h}: a thumb-length swipe crosses ${(shipped * 100).toFixed(0)}% of the road`)
    assert.ok(old < 1, `${w}x${h}: the control crossed the road, so it is not the reported arrangement`)
  }

  // And exactly `SWIPE_CROSS_SHARE` of the short side is exactly one road, in either orientation.
  for (const [w, h] of [[384, 744], [844, 390]]) {
    const one = swipeCovers(w, h, RELATIVE_SENSITIVITY_DEFAULT, (SWIPE_CROSS_SHARE * Math.min(w, h)) / w)

    assert.ok(Math.abs(one - 1) < 1e-9, `${w}x${h}: the stated swipe crosses ${one} roads`)
  }
  console.log(`    a swipe of 76% of the short side crosses: ${rows.join(', ')}`)
})

check('a finger steers relative with the stick, and a mouse and the keys stay absolute', () => {
  // **⚠ Relative steering existed for a round behind a DEV key, which is to say never on a phone.**
  // It ships as the finger's scheme now; the mode is read only for a touch, so a desktop is exactly
  // what it was. Read from the source for the scene half, because `RunScene` imports phaser.
  assert.equal(getSteerTuning().mode, 'relative', 'a finger no longer steers relative by default')

  const scene = readFileSync(new URL('../src/scenes/RunScene.ts', import.meta.url), 'utf8')

  assert.ok(scene.includes("const mode: SteerMode = steer.touch ? tuning.mode : 'absolute'"), 'the mode is no longer the finger alone')
  // An over-long swipe must stop at the road the finger can reach, not park the snail on the verge.
  assert.match(scene, /this\.relativeTarget = Math\.min\(\s*REACHABLE_EDGE,\s*Math\.max\(\s*-REACHABLE_EDGE,/, 'the relative request is clamped somewhere other than the reachable road')
  assert.ok(scene.includes("enabled: () => getSteerTuning().mode === 'relative'"), 'the stick is no longer tied to the relative scheme')
  assert.ok(scene.includes("if (source === 'screenTap' && this.steering.joystick.flicked) return"), 'the release of a flick can jump a second time')

  const input = readFileSync(new URL('../src/platform/input.ts', import.meta.url), 'utf8')

  assert.ok(input.includes('pointer.wasTouch && (currentlyOver?.length ?? 0) === 0 && sources.joystick?.enabled()'), 'the stick can appear for a mouse, or under a widget')
})

console.log(`${passed} checks passed`)
