#!/usr/bin/env node
// Logic check for src/run/formations.ts -- pickups laid in chains rather than one at a time. Plain
// assertions, no framework, via the register-ts-loader.mjs + ts-extensionless-loader.mjs
// Node-native-TS setup.
//
// **Two things here are worth a suite and the rest is scaffolding round them.**
//
// 1. *The arc is the flight solver's, not a drawing of it.* A chain of coins whose heights were
//    worked out independently of `playerMotion` is a chain the player can see, aim at, hit the
//    launch perfectly and still miss -- and there is no way for them to learn what they did wrong,
//    so it reads as the game lying. The check drives the REAL `stepPlayer` through a real jump and
//    asserts every pickup in the arc is inside the collection window at the moment the snail
//    crosses it. It is shown failing against an arc drawn as a parabola of its own.
// 2. *No chain crosses an obstacle.* A coin a hair in front of a boulder is an invitation to drive
//    into the boulder, which is not a decision.
import assert from 'node:assert/strict'
import {
  ARC_REFERENCE_SPEED,
  CHAIN,
  CHAIN_ATTEMPTS,
  chainPoints,
  chainSpacingZ,
  clearOfObstacles,
  placeFormations,
  WAVE,
} from '../src/run/formations.ts'
import { PICKUP_HEIGHT, PICKUP_OFFSET, PICKUP_REACH_UNDERFOOT, reaches } from '../src/run/pickups.ts'
import { createPlayerState, flightDuration, flightHeight, jump, stepPlayer } from '../src/run/playerMotion.ts'
import { placeRunObstacles } from '../src/run/obstacles.ts'
import {
  JUMP_AIR_MS,
  JUMP_LAUNCH_V,
  MAX_ATTAINABLE_SPEED,
  PLAYER_BODY_H,
  SPEED_BASE,
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
const DT = 1000 / 60

console.log('the flight solver is one function')

check('the closed form is exactly what the fixed tick integrates', () => {
  // The whole arc rests on this. If `flightHeight` and `stepPlayer` disagree, the chain is laid on
  // a trajectory the snail does not fly, and every other assertion here is measuring a fiction.
  let player = jump(createPlayerState())
  let ms = 0
  let worst = 0

  while (!player.grounded && ms < 5000) {
    player = stepPlayer(player, { targetFraction: 0.5, active: false }, DT)
    ms += DT
    if (!player.grounded) worst = Math.max(worst, Math.abs(player.y - flightHeight(JUMP_LAUNCH_V, ms / 1000)))
  }

  assert.ok(worst < 1e-6, `the two forms drifted by ${worst.toFixed(6)} units`)
  assert.ok(
    Math.abs(flightDuration(JUMP_LAUNCH_V) * 1000 - JUMP_AIR_MS) < 1e-6,
    'flightDuration disagrees with JUMP_AIR_MS',
  )
  console.log(`    stepped and solved agree to ${worst.toExponential(1)} units over a ${JUMP_AIR_MS}ms flight`)
})

console.log('the arc')

/**
 * Flies a real flight through a chain and reports which of its pickups were collected.
 *
 * `launchV` defaults to the ordinary jump's. It is a parameter because the trampoline chunk will
 * launch harder, and an arc that only works at one launch strength is an arc tuned to today.
 */
function flyThrough(points, speed, launchV = JUMP_LAUNCH_V) {
  // `jump()` hardcodes `JUMP_LAUNCH_V` by design -- there is no variable-height jump in this game --
  // so a stronger launch is expressed by setting the velocity the same way a trampoline will.
  let player = { ...jump(createPlayerState()), vy: launchV }
  let z = 0
  let ms = 0
  const taken = new Set()

  while (!player.grounded && ms < 5000) {
    const before = z

    player = stepPlayer(player, { targetFraction: 0.5, active: false }, DT)
    ms += DT
    z += (speed * DT) / 1000

    for (let i = 0; i < points.length; i++) {
      if (taken.has(i)) continue
      // The scene's own sweep: a pickup is tested on the frame the run crosses its z.
      if (points[i].z < before || points[i].z > z) continue
      if (reaches({ offsetX: 0, y: player.y }, { ...points[i], taken: false })) taken.add(i)
    }
  }

  return taken
}

check('every pickup in an arc is collected by the flight it was laid from', () => {
  const rng = createRng(7)
  let worstOffset = 0
  let chains = 0

  for (let i = 0; i < 200; i++) {
    // A spread of launch strengths, because the trampoline chunk will supply its own and the arc
    // must not be tuned to the ordinary jump's number alone.
    const launchV = JUMP_LAUNCH_V * (0.7 + rng() * 0.9)
    const count = 3 + Math.floor(rng() * 5)
    const points = chainPoints({
      kind: 'arc',
      pickup: 'coin',
      count,
      fromZ: 0,
      offsetX: 0,
      launchV,
      speed: ARC_REFERENCE_SPEED,
    })
    const taken = flyThrough(points, ARC_REFERENCE_SPEED, launchV)

    assert.equal(taken.size, points.length, `chain ${i} at launchV ${launchV.toFixed(0)}: ${taken.size}/${points.length}`)

    for (const point of points) {
      const t = (point.z - 0) / ARC_REFERENCE_SPEED
      // Measured against the body's centre, which is where the pickup is deliberately laid.
      worstOffset = Math.max(worstOffset, Math.abs(point.y - PICKUP_HEIGHT - flightHeight(launchV, t)))
    }
    chains++
  }

  // The plan's own bound: within half the collection reach of the trajectory. `ARC_SAG` is the
  // deliberate part of that offset and it is well inside the window on the side that works.
  const half = (PLAYER_BODY_H + PICKUP_REACH_UNDERFOOT) / 2

  assert.ok(worstOffset <= half, `worst offset from the trajectory ${worstOffset.toFixed(0)} against ${half.toFixed(0)}`)
  console.log(`    ${chains} chains, all collected; furthest from the trajectory ${worstOffset.toFixed(0)} units`)
})

check('two ways of drawing the arc by hand are both rejected', () => {
  // The negative control the house rule asks for, and both halves of it are mistakes somebody
  // actually makes.
  const launchV = JUMP_LAUNCH_V
  const duration = flightDuration(launchV)
  const count = 5
  const sample = (f) => {
    const points = []

    for (let i = 0; i < count; i++) {
      const t = (duration * (i + 1)) / (count + 1)

      points.push({ z: ARC_REFERENCE_SPEED * t, offsetX: 0, y: f(t, t / duration) })
    }

    return points
  }

  // (a) Laid a little UNDER the trajectory — the first version of this module did exactly that, on
  // a reading of the collection window that had it lopsided the wrong way round. 45 units of sag is
  // a fifth of a body height and looks like nothing; the window reaches only 16 units below the
  // feet, so it collects nothing at all.
  const sagged = sample((t) => flightHeight(launchV, t) - 45)
  // (b) Drawn as a parabola of its own with the apex eyeballed half again too high.
  const apex = flightHeight(launchV, duration / 2) * 1.5
  const eyeballed = sample((t, u) => apex * 4 * u * (1 - u) + PICKUP_HEIGHT)

  const takenSag = flyThrough(sagged, ARC_REFERENCE_SPEED).size
  const takenEye = flyThrough(eyeballed, ARC_REFERENCE_SPEED).size

  assert.ok(takenSag < count, `a 45-unit sag still collected all ${count}`)
  assert.ok(takenEye < count, `an eyeballed arc collected all ${count} — the check proves nothing`)
  console.log(`    45 units low: ${takenSag}/${count} collected; apex 50% high: ${takenEye}/${count}`)
})

check('the speed band an arc survives is measured rather than assumed', () => {
  // **⚠ An arc in world space is a function of the run speed and the placer cannot know it.** The
  // heights are right in TIME and the positions are laid for one speed, so flying it faster or
  // slower slides the snail along its own arc relative to the chain. This does not assert a band —
  // it prints one, because the trampoline chunk is what gets to decide whether the speed at a
  // launch is pinned, and it needs this number to decide with.
  const points = chainPoints({
    kind: 'arc',
    pickup: 'coin',
    count: 5,
    fromZ: 0,
    offsetX: 0,
    launchV: JUMP_LAUNCH_V,
    speed: ARC_REFERENCE_SPEED,
  })
  const rows = []

  for (const speed of [SPEED_BASE, SPEED_CAP * 0.75, SPEED_CAP, SPEED_CAP * 1.25, MAX_ATTAINABLE_SPEED]) {
    rows.push(`${speed.toFixed(0)}u/s ${flyThrough(points, speed).size}/${points.length}`)
  }
  console.log(`    collected by speed: ${rows.join(', ')}`)

  assert.equal(flyThrough(points, ARC_REFERENCE_SPEED).size, points.length, 'the reference speed itself failed')
})

console.log('lines and waves')

check('a chain is homogeneous, and a fruit chain is shorter than a coin one', () => {
  assert.ok(CHAIN.fruit.max < CHAIN.coin.min, 'a fruit chain can be as long as a coin one')
  assert.equal(CHAIN.shield.max, 1, 'shields come in chains')

  const obstacles = placeRunObstacles(4242, TRACK, 0)
  const pickups = placeFormations({
    rng: createRng(11),
    fromZ: 0,
    toZ: TRACK,
    trackLength: TRACK,
    obstacles,
  })

  // Walk the lap in order and cut it into runs of consecutive pickups that are close enough
  // together to be one chain; every run must be one kind.
  const sorted = [...pickups].sort((a, b) => a.z - b.z)
  const bound = chainSpacingZ(CHAIN.fruit.gapMs) * 1.5
  let runKind = null
  let runLength = 0
  const lengths = { coin: [], fruit: [], shield: [] }

  for (let i = 0; i < sorted.length; i++) {
    const near = i > 0 && sorted[i].z - sorted[i - 1].z <= bound

    if (near) {
      assert.equal(sorted[i].kind, runKind, `a chain at z ${sorted[i].z.toFixed(0)} mixed kinds`)
      runLength++
    } else {
      if (runKind) lengths[runKind].push(runLength)
      runKind = sorted[i].kind
      runLength = 1
    }
  }
  if (runKind) lengths[runKind].push(runLength)

  const longest = (kind) => Math.max(...lengths[kind], 0)

  assert.ok(longest('fruit') <= CHAIN.fruit.max, `a fruit chain reached ${longest('fruit')}`)
  assert.ok(longest('coin') <= CHAIN.coin.max, `a coin chain reached ${longest('coin')}`)
  console.log(
    `    ${pickups.length} pickups on the lap; longest chain coin ${longest('coin')}, fruit ${longest('fruit')}, shield ${longest('shield')}`,
  )
})

check('no chain crosses an obstacle, over 20 laps', () => {
  let inside = 0
  let total = 0

  for (let seed = 0; seed < 20; seed++) {
    const obstacles = placeRunObstacles(seed * 977 + 3, TRACK, 0)
    const pickups = placeFormations({
      rng: createRng(seed * 31 + 5),
      fromZ: 0,
      toZ: TRACK,
      trackLength: TRACK,
      obstacles,
    })

    for (const pickup of pickups) {
      total++
      if (!clearOfObstacles(pickup, obstacles, TRACK)) inside++
    }
  }

  assert.equal(inside, 0, `${inside} of ${total} pickups were laid inside an obstacle`)
  console.log(`    ${total} pickups over 20 laps, ${inside} inside an obstacle`)
})

check('the placer is shown to reject something, so the rule is not decorative', () => {
  // A road with an obstacle every two segments, wall to wall. Nothing can be laid, and the placer
  // has to drop chains rather than lay them into rock. Without `clearOfObstacles` this returns a
  // full lap of pickups, which is exactly the defect.
  const wall = []

  for (let i = 0; i < 400; i++) {
    wall.push({ id: i, z: i * 400, offsetX: 0, halfWidths: 1.2, yLow: 0, yHigh: 400, kind: 'blocking', cleared: false })
  }

  const pickups = placeFormations({
    rng: createRng(3),
    fromZ: 0,
    toZ: 160000,
    trackLength: TRACK,
    obstacles: wall,
  })

  assert.equal(pickups.length, 0, `${pickups.length} pickups were laid through a solid wall of obstacles`)
  console.log(`    a road with no gap in it takes ${pickups.length} pickups, after ${CHAIN_ATTEMPTS} attempts each`)
})

check('a wave actually swings, and stays on the road', () => {
  const points = chainPoints({
    kind: 'wave',
    pickup: 'coin',
    count: 12,
    fromZ: 0,
    offsetX: 0.2,
    period: WAVE.periodMin,
  })
  const offsets = points.map((p) => p.offsetX)
  const swing = Math.max(...offsets) - Math.min(...offsets)

  assert.ok(swing > 0.5, `the wave only swung ${swing.toFixed(2)} half-widths`)
  for (const offsetX of offsets) {
    assert.ok(Math.abs(offsetX) <= PICKUP_OFFSET.max + 1e-9, `a wave reached ${offsetX.toFixed(2)}, off the road`)
  }
  // Not clamped: a clamped sine goes flat at both extremes, which is where the player is being
  // asked to commit to a direction. Count how many distinct extremes it actually reaches.
  const flat = offsets.filter((o) => Math.abs(Math.abs(o) - PICKUP_OFFSET.max) < 1e-9).length

  assert.ok(flat <= 1, `${flat} of the wave's points sat exactly on the clamp — it is flattening`)
  console.log(`    swing ${swing.toFixed(2)} half-widths over a ${WAVE.periodMin}-pickup period`)
})

check('spacing is stated in milliseconds and converted at the worst case', () => {
  // Same rule as the obstacle rows: what the player experiences is a rhythm in time, and the run's
  // speed changes by a factor of four over a run.
  assert.ok(Math.abs(chainSpacingZ(1000) - MAX_ATTAINABLE_SPEED) < 1e-9)

  const gap = chainSpacingZ(CHAIN.coin.gapMs)

  console.log(
    `    a coin chain is ${CHAIN.coin.gapMs}ms apart = ${gap.toFixed(0)} units; ` +
      `${((gap / SPEED_CAP) * 1000).toFixed(0)}ms at the cap, ${((gap / SPEED_BASE) * 1000).toFixed(0)}ms at the start`,
  )
})

check('a line and a wave sit on the ground; only an arc leaves it', () => {
  for (const kind of ['line', 'wave']) {
    const points = chainPoints({ kind, pickup: 'coin', count: 6, fromZ: 0, offsetX: 0.3, period: 8 })

    for (const point of points) assert.equal(point.y, PICKUP_HEIGHT, `a ${kind} left the ground`)
  }

  const arc = chainPoints({
    kind: 'arc',
    pickup: 'coin',
    count: 5,
    fromZ: 0,
    offsetX: 0,
    launchV: JUMP_LAUNCH_V,
    speed: ARC_REFERENCE_SPEED,
  })

  assert.ok(Math.max(...arc.map((p) => p.y)) > PICKUP_HEIGHT * 2, 'the arc never left the ground')
})

check('arcs are laid only where there is a launch, and there are none yet', () => {
  // The trampoline is the next chunk. Until it exists the launch list is empty and no arc is
  // placed -- an arc over flat road is a chain hanging in the air, which is the failure the whole
  // module is about. Asserted rather than left to a comment, so the day launches arrive the check
  // is what notices.
  const obstacles = placeRunObstacles(5, TRACK, 0)
  const without = placeFormations({ rng: createRng(2), fromZ: 0, toZ: TRACK, trackLength: TRACK, obstacles })

  assert.ok(
    without.every((p) => p.y === PICKUP_HEIGHT),
    'an arc was laid with no launch to arc off',
  )

  const withLaunch = placeFormations({
    rng: createRng(2),
    fromZ: 0,
    toZ: TRACK,
    trackLength: TRACK,
    obstacles,
    launches: [{ z: 40000, launchV: JUMP_LAUNCH_V }],
  })

  assert.ok(withLaunch.some((p) => p.y > PICKUP_HEIGHT), 'a launch produced no arc')
  console.log(`    no launches: ${without.length} pickups, all grounded; one launch: ${withLaunch.length}`)
})

console.log(`${passed} checks passed`)
