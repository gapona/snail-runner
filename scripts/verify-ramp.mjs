#!/usr/bin/env node
// Logic check for src/run/ramp.ts -- the ramp, the flight it throws, and above all the spin. Plain
// assertions, no framework, via the register-ts-loader.mjs + ts-extensionless-loader.mjs
// Node-native-TS setup.
//
// **The one thing worth a suite is that the snail lands upright.** A spin driven by a fixed angular
// velocity lands at `omega * duration`, and the duration is whatever the launch happened to be: it
// can be made to land upright for one launch by tuning omega, and then every other launch is wrong,
// which is how a constant gets nudged forever. Driven by flight PROGRESS it lands upright by
// construction. Both are run here over the same 50 launches and the second is rejected.
import assert from 'node:assert/strict'
import {
  fixedRateLandingAngle,
  flightProgress,
  HIGHEST_BAND,
  placeRamps,
  rampIdStride,
  RAMP_AIR_CONTROL,
  RAMP_AIR_MS,
  RAMP_APEX,
  RAMP_HALF_WIDTHS,
  RAMP_HEIGHT,
  RAMP_LAUNCH_V,
  RAMP_MAX_OFFSET,
  RAMP_OVER_JUMP,
  RAMP_SPINS,
  clearOfObstacles,
  ridesOver,
  spinAngle,
} from '../src/run/ramp.ts'
import { createPlayerState, flightHeight, jump, launch, stepPlayer } from '../src/run/playerMotion.ts'
import { bodyBand, createObstacle, hits, placeRunObstacles } from '../src/run/obstacles.ts'
import { JUMP_APEX, JUMP_GRAVITY, JUMP_LAUNCH_V, OBSTACLE_BANDS, PLAYER_BODY_H, ROAD_EDGE } from '../src/run/constants.ts'
import { createRng } from '../src/race/rng.ts'
import { placeFormations } from '../src/run/formations.ts'

let passed = 0

function check(name, fn) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

const TRACK = 286800
const DT = 1000 / 60

console.log('the launch is solved, not picked')

check('RAMP_LAUNCH_V puts the apex exactly at RAMP_APEX, through the game\'s one gravity', () => {
  const apex = flightHeight(RAMP_LAUNCH_V, RAMP_LAUNCH_V / JUMP_GRAVITY)

  assert.ok(Math.abs(apex - RAMP_APEX) < 1e-6, `the solved apex is ${apex.toFixed(1)}, not ${RAMP_APEX}`)
  assert.ok(Math.abs((2 * RAMP_LAUNCH_V * 1000) / JUMP_GRAVITY - RAMP_AIR_MS) < 1e-6)
  // A second gravity would mean `flightHeight` no longer describes every flight in the game, and
  // `formations.ts`'s arc is built on there being exactly one.
  console.log(
    `    apex ${RAMP_APEX} (x${RAMP_OVER_JUMP.apex.toFixed(2)} of a jump), launch ${RAMP_LAUNCH_V.toFixed(0)}u/s ` +
      `(x${RAMP_OVER_JUMP.launch.toFixed(2)}), ${RAMP_AIR_MS.toFixed(0)}ms of air`,
  )
})

check('⚠ a tumbling snail is hittable where it is DRAWN, not where an upright one would be', () => {
  // **The drawn box stopped being the collision box the moment this spin was added.** `PlayerView`
  // turns the sprite about its bottom-centre origin, so a tumbling snail hangs below its own feet --
  // at half a turn, entirely below them -- while `hits` went on testing the upright band. Reported
  // as tumbling off a ramp into a tall barrier and taking no damage.
  const wall = createObstacle({ id: 1, z: 0, offsetX: 0, halfWidths: 0.2, kind: 'blocking' })
  const T = RAMP_AIR_MS / 1000
  let upright = 0
  let tumbling = 0
  const samples = 400

  for (let i = 0; i <= samples; i++) {
    const t = (i / samples) * T
    const y = flightHeight(RAMP_LAUNCH_V, t)
    const vy = RAMP_LAUNCH_V - JUMP_GRAVITY * t
    const spin = spinAngle({ y, vy, grounded: false, flightV0: RAMP_LAUNCH_V, flightSpins: RAMP_SPINS })

    if (hits({ offsetX: 0, y }, wall)) upright++
    if (hits({ offsetX: 0, y, spinDegrees: spin }, wall)) tumbling++
  }

  assert.ok(
    tumbling > upright,
    `the tumble is hittable for ${tumbling} samples against the upright band's ${upright} -- the spin is not reaching the collision`,
  )
  // At zero rotation the band has to be exactly what it always was, or every jump, `passableLine`
  // and the whole passability proof have quietly moved.
  const flat = bodyBand({ offsetX: 0, y: 100 })

  assert.equal(flat.low, 100)
  assert.equal(flat.high, 100 + PLAYER_BODY_H)
  // And half a turn hangs the whole body below the feet, which is what is drawn.
  const over = bodyBand({ offsetX: 0, y: 100, spinDegrees: 180 })

  assert.ok(Math.abs(over.high - 100) < 1e-9 && Math.abs(over.low - (100 - PLAYER_BODY_H)) < 1e-9)
  console.log(
    `    over a real flight: upright ${(upright / samples * 100).toFixed(0)}% hittable, tumbling ${(tumbling / samples * 100).toFixed(0)}%`,
  )
})

check('it is a different verb: the apex clears every obstacle band, a jump\'s does not', () => {
  assert.ok(RAMP_APEX > HIGHEST_BAND, `the ramp apex ${RAMP_APEX} does not clear ${HIGHEST_BAND}`)
  assert.ok(JUMP_APEX < HIGHEST_BAND, 'a plain jump already cleared everything — the ramp adds nothing')
  // **⚠ This used to require the wedge to be shorter than the shortest hazard**, on the reasoning
  // that a short thing cannot be mistaken for something you must clear. Measured in the running
  // game that produced 164 x 21 screen pixels of muted timber on a pale road -- unmistakable for an
  // obstacle because unmistakable for anything. What it may not do is look like the one class you
  // CANNOT jump, and it has to be big enough to line up on from range.
  assert.ok(RAMP_HEIGHT < OBSTACLE_BANDS.blocking.yHigh, 'the wedge is as tall as the class you cannot jump')
  assert.ok(RAMP_HEIGHT > PLAYER_BODY_H, 'the wedge is shorter than the snail — it will read as road dirt')
})

console.log('the spin')

check('it lands upright at 50 random launches — and a fixed rate does not', () => {
  const rng = createRng(17)
  let worst = 0
  const fixed = []
  // A fixed angular velocity, tuned so that the SHIPPED launch lands upright. That is the honest
  // form of the mistake: somebody sets it against the ramp in front of them and it is correct.
  const tuned = (RAMP_SPINS * 360) / (RAMP_AIR_MS / 1000)

  for (let i = 0; i < 50; i++) {
    const launchV = RAMP_LAUNCH_V * (0.6 + rng())
    // At touchdown the flight is exactly over, so `vy` is exactly `-v0` in the continuous model —
    // which is what the property is about. Tick quantisation is measured separately below.
    const landing = spinAngle({ vy: -launchV, grounded: false, flightV0: launchV, flightSpins: RAMP_SPINS })
    const off = Math.abs(((landing % 360) + 360) % 360)

    worst = Math.max(worst, Math.min(off, 360 - off))
    fixed.push(Math.abs(((fixedRateLandingAngle(launchV, tuned) % 360) + 360) % 360))
  }

  assert.ok(worst <= 2, `the worst landing was ${worst.toFixed(2)} degrees off upright`)

  const fixedWorst = Math.max(...fixed.map((a) => Math.min(a, 360 - a)))

  assert.ok(fixedWorst > 2, `a fixed rate landed within ${fixedWorst.toFixed(1)} degrees — the check proves nothing`)
  console.log(`    progress-driven: worst ${worst.toFixed(3)} degrees; fixed rate: worst ${fixedWorst.toFixed(0)} degrees`)
})

check('an ordinary jump does not spin at all', () => {
  // The ramp is the thing with the flourish. A jump that turned over would make the two verbs one.
  let player = jump(createPlayerState())

  for (let i = 0; i < 20; i++) {
    assert.equal(spinAngle(player), 0)
    player = stepPlayer(player, { targetFraction: 0.5, active: false }, DT)
  }
})

check('the residual at the last airborne frame is measured, not assumed', () => {
  // The model lands upright exactly; the TICK lands upright to within one tick of progress, because
  // the snail crosses y = 0 partway through a step. The frame it touches down on is grounded and
  // therefore drawn at exactly 0 — this measures the frame before, which is the one that could show
  // a snail at an angle.
  const rows = []

  for (const hz of [30, 60, 144]) {
    let player = launch(createPlayerState(), RAMP_LAUNCH_V, RAMP_SPINS, RAMP_AIR_CONTROL)
    let last = 0

    while (!player.grounded) {
      last = spinAngle(player)
      player = stepPlayer(player, { targetFraction: 0.5, active: false }, 1000 / hz)
    }

    assert.equal(spinAngle(player), 0, `${hz}Hz drew the landing frame at an angle`)

    const off = 360 - last

    rows.push(`${hz}Hz ${off.toFixed(1)}deg`)
  }
  console.log(`    last airborne frame, short of upright by: ${rows.join(', ')}`)
})

console.log('what a flight is worth')

check('no invulnerability flag is needed — the band rule already covers the apex', () => {
  // The plan's claim, checked rather than believed. At the apex the snail's feet are above every
  // band's top, so `hits` returns false for all three by the rule that was already there.
  const atApex = { offsetX: 0, y: RAMP_APEX }

  for (const kind of Object.keys(OBSTACLE_BANDS)) {
    const obstacle = createObstacle({ id: 1, z: 0, offsetX: 0, halfWidths: 0.4, kind })

    assert.equal(hits(atApex, obstacle), false, `a ${kind} hit a snail at the ramp's apex`)
  }

  // ...and it is NOT a free pass: the ascent and the descent pass through the bands like any jump,
  // which is what stops a ramp being a way through a wall. Measured over the real flight.
  let player = launch(createPlayerState(), RAMP_LAUNCH_V, RAMP_SPINS, RAMP_AIR_CONTROL)
  let ticks = 0
  let clear = 0

  while (!player.grounded) {
    ticks++
    if (player.y >= HIGHEST_BAND) clear++
    player = stepPlayer(player, { targetFraction: 0.5, active: false }, DT)
  }

  const share = clear / ticks

  assert.ok(share > 0.5 && share < 0.95, `${(share * 100).toFixed(0)}% of the flight is above every band`)
  console.log(
    `    ${(share * 100).toFixed(0)}% of the flight clears every band; the other ${(((1 - share) * 100)).toFixed(0)}% can still be hit`,
  )
})

check('lateral control in the air is weakened, not switched off', () => {
  // Both extremes are failures with names: full control makes a ramp an ordinary jump with a bigger
  // number on it, and no control makes it a cut-scene.
  const travel = (state, ms) => {
    let player = state

    for (let i = 0; i < Math.round(ms / DT); i++) {
      player = stepPlayer(player, { targetOffsetX: 0.9, active: true }, DT)
    }

    return player.offsetX
  }

  const onGround = travel(createPlayerState(), 400)
  const inFlight = travel(launch(createPlayerState(), RAMP_LAUNCH_V, RAMP_SPINS, RAMP_AIR_CONTROL), 400)
  const share = inFlight / onGround

  assert.ok(inFlight > 0.02, 'the snail could not steer at all in the air')
  assert.ok(share < 0.8, `air control is ${(share * 100).toFixed(0)}% of ground control — barely weakened`)
  console.log(
    `    400ms toward the verge: ${onGround.toFixed(2)} on the ground, ${inFlight.toFixed(2)} in a ramp flight ` +
      `(${(share * 100).toFixed(0)}%, multiplier ${RAMP_AIR_CONTROL})`,
  )
})

check('an ordinary jump keeps full control — the weakening belongs to the ramp', () => {
  // Otherwise this chunk would have quietly changed how every obstacle in the game is dodged.
  const travel = (state) => {
    let player = state

    for (let i = 0; i < 24; i++) player = stepPlayer(player, { targetOffsetX: 0.9, active: true }, DT)

    return player.offsetX
  }

  const jumped = travel(jump(createPlayerState()))
  const grounded = travel(createPlayerState())

  assert.ok(Math.abs(jumped - grounded) < 1e-9, `a jump steered ${jumped.toFixed(3)} against ${grounded.toFixed(3)}`)
})

console.log('the ramp on the road')

check('it launches only from the ground', () => {
  const ramp = { id: 0, z: 0, offsetX: 0, halfWidths: RAMP_HALF_WIDTHS }

  assert.equal(ridesOver({ offsetX: 0, grounded: true }, ramp), true)
  assert.equal(ridesOver({ offsetX: 0, grounded: false }, ramp), false, 'a ramp fired at a snail already in the air')
  assert.equal(ridesOver({ offsetX: 0.9, grounded: true }, ramp), false, 'a ramp fired from the other lane')

  // And `launch` refuses in the air even if something asked, so there is no double jump by the
  // back door — the same guard `jump` has and for the same reason.
  const airborne = jump(createPlayerState())
  const after = launch(airborne, RAMP_LAUNCH_V, RAMP_SPINS, RAMP_AIR_CONTROL)

  assert.equal(after.vy, airborne.vy, 'a launch fired at an airborne snail')
})

check('placement is seeded, on the road, spaced, and never on an obstacle', () => {
  const obstacles = placeRunObstacles(1234, TRACK, 0)
  const a = placeRamps(99, TRACK, 0, obstacles)
  const b = placeRamps(99, TRACK, 0, obstacles)

  for (const ramp of a) {
    assert.ok(clearOfObstacles(ramp, obstacles), `a ramp at z ${ramp.z.toFixed(0)} sat on an obstacle`)
  }

  // Shown to reject: a road walled end to end takes no ramps at all rather than laying them into
  // rock. A ramp inside a boulder charges the player a life for taking the launch.
  // The wall has to span the WHOLE lap: a shorter one leaves clear road past its end and three
  // ramps landed there legitimately, which is the fixture being wrong rather than the placer.
  const wall = Array.from({ length: Math.ceil(TRACK / 400) }, (_, i) => ({ z: i * 400, offsetX: 0, halfWidths: 1.2 }))

  assert.equal(placeRamps(99, TRACK, 0, wall).length, 0, 'ramps were laid through a solid wall')

  assert.deepEqual(a, b, 'two runs of the same seed laid different ramps')
  assert.ok(a.length >= 4, `only ${a.length} ramps on a lap`)

  for (const ramp of a) {
    assert.ok(Math.abs(ramp.offsetX) <= RAMP_MAX_OFFSET + 1e-9, `a ramp sat at ${ramp.offsetX.toFixed(2)}`)
    assert.ok(Math.abs(ramp.offsetX) + ramp.halfWidths <= ROAD_EDGE + 1e-9, 'a ramp hung off the road')
  }

  for (let i = 1; i < a.length; i++) {
    assert.ok(a[i].z > a[i - 1].z, 'ramps came out unordered')
  }
  console.log(`    ${a.length} ramps on a ${(TRACK / 200).toFixed(0)}-segment lap, ${((TRACK / a.length) / 200).toFixed(0)} segments apart`)
})

check('flight progress runs 0 to 1 and is exact at every tick', () => {
  let player = launch(createPlayerState(), RAMP_LAUNCH_V, RAMP_SPINS, RAMP_AIR_CONTROL)
  let previous = -1
  let ms = 0

  assert.equal(flightProgress(createPlayerState()), 0, 'a grounded snail reported progress')

  while (!player.grounded) {
    const t = flightProgress(player)

    assert.ok(t >= previous, 'progress went backwards')
    // The exact relationship the whole spin rests on: progress is elapsed time over the flight's
    // own duration, and the tick's velocity update is exact, so the two agree to floating point.
    assert.ok(Math.abs(t - ms / RAMP_AIR_MS) < 1e-9, `progress ${t} against ${(ms / RAMP_AIR_MS).toFixed(9)}`)
    previous = t
    player = stepPlayer(player, { targetFraction: 0.5, active: false }, DT)
    ms += DT
  }
  assert.ok(previous > 0.97, `the flight only reached ${previous.toFixed(3)} before landing`)
})

check('the flight fields survive the tick and are cleared on landing', () => {
  // `stepPlayer` returns a fresh object built from the kinematics it integrates; an earlier version
  // spread only those, which dropped the flight fields every frame and reset the spin to nothing on
  // the tick after it started.
  let player = launch(createPlayerState(), RAMP_LAUNCH_V, RAMP_SPINS, RAMP_AIR_CONTROL)

  player = stepPlayer(player, { targetFraction: 0.5, active: false }, DT)
  assert.equal(player.flightV0, RAMP_LAUNCH_V)
  assert.equal(player.flightSpins, RAMP_SPINS)
  assert.equal(player.airControl, RAMP_AIR_CONTROL)

  while (!player.grounded) player = stepPlayer(player, { targetFraction: 0.5, active: false }, DT)
  assert.equal(player.flightV0, 0, 'a grounded snail kept a launch velocity')
  assert.equal(player.flightSpins, 0)
  assert.equal(player.airControl, 1)
  assert.equal(spinAngle(player), 0)
})

check('a ramp flight is long enough to be a thing that happens to you', () => {
  // Not a feel assertion: `PLAYER_BODY_H` of clearance over the tallest band for most of a second
  // is what makes the arc chain reachable and the landing readable. If this ever drops below a
  // jump's own air time the ramp has stopped being a different verb.
  assert.ok(RAMP_AIR_MS > 900, `a ramp flight is only ${RAMP_AIR_MS.toFixed(0)}ms`)
  assert.ok(RAMP_APEX > HIGHEST_BAND + PLAYER_BODY_H, 'the whole body does not clear the tallest band at the apex')
})


console.log('a ramp id is a name, and two laps may not share one')

check('ramp ids are unique across laps, so an arc chain cannot claim another lap\'s coins', () => {
  // ## ⚠ The defect this check exists for
  //
  // `placeRamps` opened with `let id = 0`, so every lap numbered its ramps from zero — and
  // `RunScene.layArc` finds a ramp's arc by `pickup.arcOf === ramp.id` over *every live pickup*.
  // The lap is handed over a segment at a time, so **two laps' contents are on the ground at all
  // times**, and a ramp therefore matched its own arc *and* the next lap's ramp of the same id.
  //
  // Reported twice, as the number of coins changing when you take off from a ramp. Measured on the
  // shipped placer: 6 of 6 ids collided and every 5-coin chain became a 10-coin one — five coins
  // teleported in from elsewhere on the track, the player's own five re-spaced for a chain twice as
  // long. Third time this project has been bitten by ids that restart, after `placeObstacles`'
  // difficulty bands and `arcRelaid`.
  const laps = [0, 1, 2, 3].map((lap) => {
    const offset = TRACK * lap
    const obstacles = placeRunObstacles(4242, TRACK, offset)
    const ramps = placeRamps(4242 ^ 0x2a17, TRACK, offset, obstacles)
    const pickups = placeFormations({
      rng: createRng((4242 ^ 0x5eed) + Math.round(offset / 200)),
      fromZ: 0,
      toZ: TRACK,
      trackLength: TRACK,
      obstacles,
      launches: ramps.map((ramp) => ({ id: ramp.id, z: ramp.z, offsetX: ramp.offsetX, launchV: RAMP_LAUNCH_V })),
    })

    return { ramps, arcs: pickups.filter((pickup) => pickup.arcOf !== undefined) }
  })
  const ids = laps.flatMap((lap) => lap.ramps.map((ramp) => ramp.id))

  assert.equal(new Set(ids).size, ids.length, `${ids.length} ramps over four laps share ${new Set(ids).size} ids`)

  // The consequence, measured the way the scene measures it: `layArc`'s own filter over everything
  // live must pick up exactly this ramp's own chain and nothing else.
  const live = laps.flatMap((lap) => lap.arcs)
  let foreign = 0

  for (const lap of laps) {
    for (const ramp of lap.ramps) {
      const matched = live.filter((pickup) => pickup.arcOf === ramp.id).length
      const own = lap.arcs.filter((pickup) => pickup.arcOf === ramp.id).length

      if (matched !== own) foreign++
    }
  }
  assert.equal(foreign, 0, `${foreign} ramps grab coins belonging to another lap`)

  // **The control: the old numbering, which is what shipped.** A check that has never rejected
  // anything is not a check.
  const restarting = laps.map((lap) => lap.ramps.map((_, index) => index))
  const collisions = restarting[0].filter((id) => restarting[1].includes(id)).length

  assert.ok(collisions > 0, 'the control does not collide, so this check proves nothing')
  console.log(
    `    ${ids.length} ramps over four laps, ${new Set(ids).size} distinct ids, stride ${rampIdStride(TRACK)}; ` +
      `the old numbering collided on ${collisions} of ${restarting[0].length}`,
  )
})

console.log(`${passed} checks passed`)
