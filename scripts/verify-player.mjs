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
  ROAD_EDGE,
  STEER_REACH_MARGIN,
  FEVER_SPEED_FACTOR,
  HIT_INVULNERABLE_Z,
  MAX_ATTAINABLE_SPEED,
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
import { groundYAt, trackLengthOf } from '../src/road/track.ts'
import { HORIZON_Y } from '../src/road/constants.ts'
import { CAMERA_DEPTH, CAMERA_HEIGHT, ROAD_WIDTH, SEGMENT_LENGTH } from '../src/road/constants.ts'
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

check('the whole road is reachable from inside the frame', () => {
  // If the asphalt's edge sat outside `[0, 1]` of screen fraction, part of the road would be
  // unreachable by any finger position -- the lane would be narrower than the road without
  // anything saying so.
  const edge = playerScreenFraction(ROAD_EDGE)

  assert.ok(edge < 1 && edge > 0.5, `the road's edge is at screen fraction ${edge.toFixed(3)}`)
  console.log(`    the asphalt's edge (offsetX ${ROAD_EDGE.toFixed(3)}) sits at ${(edge * 100).toFixed(1)}% across the frame`)
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

console.log(`${passed} checks passed`)
