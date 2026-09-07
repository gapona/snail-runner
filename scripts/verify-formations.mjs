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
  ARC_RELAY_NEAR_Z,
  ARC_RELAY_Z,
  CHAIN,
  flightSpans,
  CHAIN_ATTEMPTS,
  chainPoints,
  chainSpacingZ,
  clearOfObstacles,
  placeFormations,
  WAVE,
} from '../src/run/formations.ts'
import {
  PICKUP_POOL_SIZE, PICKUP_HEIGHT, PICKUP_OFFSET, PICKUP_REACH_UNDERFOOT, reaches,
  PICKUP_KINDS, PICKUP_WEIGHTS, createKindDeck,
} from '../src/run/pickups.ts'
import { createPlayerState, flightDuration, flightHeight, jump, stepPlayer } from '../src/run/playerMotion.ts'
import { placeRunObstacles } from '../src/run/obstacles.ts'
import { speedAfter } from '../src/run/runState.ts'
import {
  JUMP_AIR_MS,
  JUMP_LAUNCH_V,
  MAX_ATTAINABLE_SPEED,
  PLAYER_BODY_H,
  SPEED_BASE,
  SPEED_CAP,
} from '../src/run/constants.ts'
import { DRAW_DISTANCE, SEGMENT_LENGTH } from '../src/road/constants.ts'
import { createRng } from '../src/race/rng.ts'
import { placeRamps, RAMP_LAUNCH_V } from '../src/run/ramp.ts'

let passed = 0

function check(name, fn) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

const TRACK = 286800
const DT = 1000 / 60

console.log('the flight solver is one function')

check('\u26a0 a kind arrives on a schedule, not in clusters with droughts between them', () => {
  // **This is the report**: *the medkits come four almost in a row and then there are none at all --
  // can it be even, especially in endless?* An independent weighted draw does exactly that: `heal`
  // is an eighth of the chains, and an eighth of ~33 chains rolled per chain clusters and droughts
  // by construction. A lap is the only sample anybody plays, so the rate being right in the limit is
  // not the same as the lap being right.
  const total = PICKUP_KINDS.reduce((sum, kind) => sum + PICKUP_WEIGHTS[kind], 0)
  const chains = 4000
  const deal = createKindDeck(createRng(7))
  const dealt = []

  for (let i = 0; i < chains; i++) dealt.push(deal())

  // The control: the i.i.d. draw this replaces, on the same weights and the same stream.
  const iid = createRng(7)
  const drawn = []

  for (let i = 0; i < chains; i++) {
    let roll = iid() * total
    let kind = PICKUP_KINDS[PICKUP_KINDS.length - 1]

    for (const candidate of PICKUP_KINDS) {
      roll -= PICKUP_WEIGHTS[candidate]
      if (roll <= 0) {
        kind = candidate
        break
      }
    }
    drawn.push(kind)
  }

  const worstGap = (list, kind) => {
    let last = -1
    let worst = 0

    list.forEach((entry, i) => {
      if (entry !== kind) return
      if (last >= 0) worst = Math.max(worst, i - last)
      last = i
    })

    return worst
  }
  const longestRun = (list, kind) => {
    let run = 0
    let worst = 0

    for (const entry of list) {
      run = entry === kind ? run + 1 : 0
      worst = Math.max(worst, run)
    }

    return worst
  }
  const rows = []

  for (const kind of PICKUP_KINDS) {
    const spacing = total / PICKUP_WEIGHTS[kind]
    const gap = worstGap(dealt, kind)
    const run = longestRun(dealt, kind)

    // **The gap is bounded by the schedule rather than by luck.** A weighted round-robin puts a kind
    // at most one full cycle apart -- `total / weight` chains, rounded up -- and never two of the
    // same kind back to back unless its weight is more than half the deck.
    assert.ok(gap <= Math.ceil(spacing) + 1, `${kind} goes ${gap} chains between appearances against a cycle of ${spacing.toFixed(1)}`)
    // **A rare kind never repeats at all; a common one may deal twice.** The bound is a property of
    // the scheduler rather than a taste: a kind holding close to half the deck (`coin` is 8 of 17)
    // is owed another turn almost immediately, and forbidding that would mean forbidding the
    // weights. What the report is about is the rare end, and there the rule is absolute.
    assert.ok(run <= (PICKUP_WEIGHTS[kind] * 4 <= total ? 1 : 2), `${kind} deals ${run} in a row`)
    // The counts are still the table's, or this has quietly re-weighted the lap.
    const share = dealt.filter((entry) => entry === kind).length / chains

    assert.ok(Math.abs(share - PICKUP_WEIGHTS[kind] / total) < 0.01, `${kind} is ${(share * 100).toFixed(1)}% of chains against ${((PICKUP_WEIGHTS[kind] / total) * 100).toFixed(1)}%`)
    rows.push(`${kind} every ${spacing.toFixed(1)} chains: worst gap ${gap}, longest run ${run} (drawn i.i.d. it was ${worstGap(drawn, kind)} and ${longestRun(drawn, kind)})`)
  }

  // And the control has to be visibly worse somewhere, or this check is measuring nothing.
  const iidWorst = Math.max(...PICKUP_KINDS.map((kind) => worstGap(drawn, kind) - Math.ceil(total / PICKUP_WEIGHTS[kind])))

  assert.ok(iidWorst > 3, `the i.i.d. draw never overshoots its own cycle by more than ${iidWorst} chains`)
  for (const row of rows) console.log(`    ${row}`)
})

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

check('⚠ laid for the speed it is flown at, an arc is collected whole at every speed', () => {
  // **An arc in world space is a function of the run speed, and no placer can know it.** The heights
  // are right in TIME; the positions those heights sit at are `speed * t`. Laid at one speed and
  // flown at another, the snail slides along its own arc relative to the chain.
  //
  // Reported as coins not always being collected off a ramp, with Fever correctly guessed as the
  // cause: a Fever entered between the approach and the ramp changes the speed by 60%. The scene
  // therefore lays the chain again AT THE MOMENT OF LAUNCH, where the speed is a fact rather than a
  // prediction -- which is what this asserts, and the mismatch below is what it is worth.
  const rows = []
  const mismatched = []

  for (const speed of [SPEED_BASE, SPEED_CAP * 0.75, SPEED_CAP, SPEED_CAP * 1.25, MAX_ATTAINABLE_SPEED]) {
    const spec = { kind: 'arc', pickup: 'coin', count: 5, fromZ: 0, offsetX: 0, launchV: JUMP_LAUNCH_V, speed }
    const matched = flyThrough(chainPoints(spec), speed).size
    // The same chain laid for the reference speed and flown at this one -- the arrangement before
    // the launch-time relay, kept as the control.
    const laidElsewhere = chainPoints({ ...spec, speed: ARC_REFERENCE_SPEED })

    rows.push(`${speed.toFixed(0)}u/s ${matched}/5`)
    mismatched.push(flyThrough(laidElsewhere, speed).size)
    assert.equal(matched, 5, `an arc laid for ${speed.toFixed(0)}u/s and flown at it collected ${matched}/5`)
  }

  console.log(`    laid for the speed it is flown at: ${rows.join(', ')}`)
  console.log(`    laid for ${ARC_REFERENCE_SPEED}u/s and flown at each: ${mismatched.map((n) => n + '/5').join(', ')}`)
  assert.ok(
    Math.min(...mismatched) < 5,
    'a chain laid for the wrong speed collected everything, so this check is measuring nothing',
  )
})

console.log('lines and waves')

check('a chain is homogeneous, and a fruit chain is shorter than a coin one', () => {
  assert.ok(CHAIN.fruit.max < CHAIN.coin.min, 'a fruit chain can be as long as a coin one')
  assert.equal(CHAIN.shield.max, 1, 'shields come in chains')
  // **⚠ And the medkit for the same reason, which is worth asserting rather than assuming**: a row
  // of the same restored life is not a row, and the second of a pair would be a pickup worth
  // nothing at the instant it is driven through — the state `canTakeHeal` keeps off the road.
  assert.equal(CHAIN.heal.max, 1, 'medkits come in chains')

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
  // Keyed off the kind table rather than written out, so a new kind is counted rather than
  // crashing the walk — which is how `heal` announced itself.
  const lengths = Object.fromEntries(PICKUP_KINDS.map((kind) => [kind, []]))

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

  for (const kind of PICKUP_KINDS) {
    assert.ok(longest(kind) <= CHAIN[kind].max, `a ${kind} chain reached ${longest(kind)} against a max of ${CHAIN[kind].max}`)
  }
  console.log(
    `    ${pickups.length} pickups on the lap; longest chain ${PICKUP_KINDS.map((k) => `${k} ${longest(k)}`).join(', ')}`,
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

check('arcs are laid only where there is a launch', () => {
  // An arc over flat road is a chain hanging in the air, which is the failure the whole module is
  // about. The launches come from `placeRamps` now -- what is asserted here is the rule itself,
  // over a call with none and a call with one, so neither half can quietly stop being true.
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

check('⚠ the arc is relaid once, far out, and for the speed the ramp will be reached at', () => {
  // `RunScene.relayArcs` re-lays a ramp's chain for the speed the run is doing, in a band 40 to 90
  // segments ahead. Its own comment said the band is "far enough away that nothing is seen moving"
  // -- and the road is drawn 300 segments ahead, so ALL of it is in view. Running it every frame
  // therefore slid the chain continuously, the whole time the player was looking at it, because the
  // run accelerates every frame. Reported as coins changing position with the speed.
  //
  // The scene cannot be driven from here -- it imports phaser -- so the quantities are computed
  // from `speedAfter`, which is the run's own integration, and the same `flightDuration` the chain
  // is laid with.
  const flight = flightDuration(JUMP_LAUNCH_V)
  const band = ARC_RELAY_Z - ARC_RELAY_NEAR_Z
  // The chain's far end sits at `speed * flightDuration`, so a difference in the speed it was laid
  // for is a displacement of its tail.
  const segments = (dv) => (Math.abs(dv) * flight) / SEGMENT_LENGTH

  let worstSlide = 0
  let worstPlacement = 0
  let worstResidual = 0

  for (const start of [SPEED_BASE, SPEED_BASE * 1.4, SPEED_CAP * 0.8]) {
    const atRamp = speedAfter(start, ARC_RELAY_Z)

    // What shipped: re-laid every frame across the band, so the tail tracked the speed the whole way.
    worstSlide = Math.max(worstSlide, segments(speedAfter(start, band) - start))
    // What one relay is for: the chain as the placer left it, at `ARC_REFERENCE_SPEED`.
    worstPlacement = Math.max(worstPlacement, segments(ARC_REFERENCE_SPEED - start))
    // What the launch is left to correct, now that the one relay predicts forward to the ramp.
    worstResidual = Math.max(worstResidual, segments(atRamp - speedAfter(start, ARC_RELAY_Z)))
  }

  assert.ok(
    worstSlide > 1,
    `re-laying every frame moved the tail only ${worstSlide.toFixed(2)} segments, so this is measuring nothing`,
  )
  assert.ok(
    worstPlacement > worstSlide,
    'the correction the one relay makes is smaller than the sliding it replaces, so it should not be made far out',
  )
  // Predicting forward is what makes ONE relay enough: laid for the speed here it would be short by
  // everything the run accelerates through on the way, and that correction would land at the launch.
  assert.ok(
    worstResidual < 0.01,
    `the launch is left to move the tail ${worstResidual.toFixed(2)} segments, i.e. the prediction is not being used`,
  )

  const naive = Math.max(
    ...[SPEED_BASE, SPEED_BASE * 1.4, SPEED_CAP * 0.8].map((v) => segments(speedAfter(v, ARC_RELAY_Z) - v)),
  )

  assert.ok(naive > 1, 'laying for the speed here costs nothing, so the prediction is measuring nothing')
  console.log(
    `    band ${(band / SEGMENT_LENGTH).toFixed(0)} segments, all inside a 300-segment draw distance: ` +
      `re-laid every frame the tail slid up to ${worstSlide.toFixed(2)} segments in view. Laid once at the far edge ` +
      `it corrects up to ${worstPlacement.toFixed(2)}, and predicting to the ramp leaves the launch ` +
      `${worstResidual.toFixed(2)} against ${naive.toFixed(2)} without the prediction`,
  )
})

check('⚠ nothing is laid on the ground under a flight, so a ramp is not two rewards and one pass', () => {
  // **Reported from the frame it produces:** a ramp with a chain of coins along the flight and
  // another chain lying on the road beneath it. The player can be airborne or grounded and not
  // both, so one of the two was always unreachable — two rewards in one place, of which one is a
  // promise the game cannot keep.
  //
  // The cause is the third instance of one bug in this walk. It already advances from the END of a
  // chain rather than from its start, because advancing by the gap alone overlapped one chain with
  // the next; the arc is the same overlap from outside, because an arc is laid *before* the walk
  // runs and the walk was never told those stretches were taken.
  const obstacles = placeRunObstacles(1234, TRACK, 0)
  const launches = [
    { id: 1, z: SEGMENT_LENGTH * 200, offsetX: 0, launchV: JUMP_LAUNCH_V * 2 },
    { id: 2, z: SEGMENT_LENGTH * 600, offsetX: 0.4, launchV: JUMP_LAUNCH_V * 2 },
    { id: 3, z: SEGMENT_LENGTH * 1000, offsetX: -0.35, launchV: JUMP_LAUNCH_V * 2 },
  ]
  const lay = (withLaunches, seed) =>
    placeFormations({
      rng: createRng(seed),
      fromZ: 0,
      toZ: TRACK,
      trackLength: TRACK,
      obstacles,
      launches: withLaunches,
    })

  // The spans come from the module rather than being recomputed here: a second expression of where
  // a flight ends is a second thing that can disagree with the placer about it.
  const spans = flightSpans(launches)
  const underFlight = (pickups) =>
    pickups.filter(
      (pickup) => pickup.arcOf === undefined && spans.some((span) => pickup.z >= span.fromZ && pickup.z <= span.toZ),
    )

  // **Swept over forty seeds rather than checked on one**, because skipping a chain changes every
  // later roll: two laps from the same seed with and without the reservation are two different
  // layouts, and a single-seed count difference is mostly that divergence rather than the cost.
  let stranded = 0
  let control = 0
  let withReservation = 0
  let without = 0
  const shippedByKind = Object.fromEntries(PICKUP_KINDS.map((kind) => [kind, 0]))

  for (let seed = 1; seed <= 40; seed++) {
    const shipped = lay(launches, seed).filter((pickup) => pickup.arcOf === undefined)
    const bare = lay([], seed)

    stranded += underFlight(shipped).length
    control += underFlight(bare).length
    withReservation += shipped.length
    without += bare.length
    for (const pickup of shipped) shippedByKind[pickup.kind]++
  }

  assert.equal(stranded, 0, `${stranded} ground pickups still lie under a flight`)

  // **The negative control is the same walk with no launches**, measured against the spans those
  // launches would have had. It has to still strand something, or this is measuring a seed.
  assert.ok(control > 0, 'the walk lays nothing under those spans even without the reservation')

  // **And the answer is "both", not "fewer".** A chain whose tail would reach a flight is CUT at
  // it rather than abandoned, so the ground in front of a ramp keeps its coins — refusing the whole
  // chain instead cost 12% of a lap's pickups for 4.6% of the lap reserved, i.e. nearly three times
  // the ground the flight actually covers.
  //
  // **⚠ The bound went from 1.6 to 2.6 of the reserved ground when `PICKUP_WEIGHTS` went live, and
  // what moved is the DENOMINATOR rather than the player's lap.** `without` is a counterfactual — a
  // lap with no ramps at all — and the medkit's singles are zero-length chains, so the walk fits
  // *more* chains into a lap that has no flights to skip: 96.5 pickups before, 99.7 now. Measured
  // on the lap that actually ships, coins are unchanged (56.4 -> 56.9) and fruit falls 29.6 -> 25.8
  // as the medkit takes chain slots, which is the cost of the fourth kind and is stated in
  // `PICKUP_WEIGHTS`. The per-kind counts are printed for that reason: a ratio against a lap nobody
  // plays is the wrong thing to read this off.
  const reserved = spans.reduce((total, span) => total + (span.toZ - span.fromZ), 0) / TRACK
  const lost = 1 - withReservation / without

  assert.ok(
    lost < reserved * 2.6,
    `the reservation costs ${(lost * 100).toFixed(1)}% of the lap's ground pickups for ${(reserved * 100).toFixed(1)}% of its ground`,
  )
  console.log(
    `    ${(control / 40).toFixed(1)} ground pickups a lap used to lie under the ${spans.length} flights and 0 do now; ` +
      `${(reserved * 100).toFixed(1)}% of the lap reserved costs ${(lost * 100).toFixed(1)}% of its ground pickups`,
  )
  console.log(
    `    the lap that ships: ${PICKUP_KINDS.map((kind) => `${kind} ${(shippedByKind[kind] / 40).toFixed(1)}`).join(', ')}`,
  )
})


/**
 * The most of `items` that ever fall inside the draw distance at once, over a whole lap.
 *
 * **An upper bound on what a pool is asked for, not the pool's real demand** — the renderer culls
 * what projects off screen before it takes a slot, and reproducing that needs the mesh's own walk.
 * The bound is the right thing to size against anyway: it is what the pool must survive on the
 * frame where nothing happens to be culled.
 */
function peakInView(items, trackLength) {
  const count = Math.round(trackLength / SEGMENT_LENGTH)
  const perSegment = new Array(count).fill(0)

  for (const item of items) perSegment[Math.floor(item.z / SEGMENT_LENGTH) % count]++

  let window = 0

  for (let i = 0; i < DRAW_DISTANCE; i++) window += perSegment[i]

  let peak = window

  for (let base = 1; base < count; base++) {
    window += perSegment[(base + DRAW_DISTANCE - 1) % count] - perSegment[base - 1]
    if (window > peak) peak = window
  }

  return peak
}

console.log('the pool is sized against what the placer actually produces')

check('every pickup a lap lays can be drawn at once', () => {
  // **⚠ The pool was 24 against a peak of 47 and had no demand counter at all**, so for as long as
  // pickups have existed roughly half of them were competing for slots and nothing could say so.
  // It is filled near to far, so *which* ones get the slots is a function of their order along the
  // road — and `layArc` re-lays a whole chain at the moment of launch, moving every coin into a
  // different segment. Reported as **the number of coins changing when you take off from a ramp**,
  // and that is exactly what it was: nothing gained or lost, the drawn set reshuffled in view.
  //
  // Worse on a phone, which is where it was reported: `pickupDrawWidth` boosts the icon by up to a
  // third on a narrow frame, so distant coins that are sub-pixel on a desktop pass the on-screen
  // cull there and take slots the near ones needed.
  let worst = 0

  for (const seed of [1, 4242, 777, 31337, 9001]) {
    const obstacles = placeRunObstacles(seed, TRACK)
    const ramps = placeRamps(seed ^ 0x2a17, TRACK, 0, obstacles)
    const pickups = placeFormations({
      rng: createRng(seed ^ 0x5eed),
      fromZ: SEGMENT_LENGTH * 20,
      toZ: TRACK,
      trackLength: TRACK,
      obstacles,
      launches: ramps.map((ramp) => ({ id: ramp.id, z: ramp.z, offsetX: ramp.offsetX, launchV: RAMP_LAUNCH_V })),
    })

    worst = Math.max(worst, peakInView(pickups, TRACK))
  }

  assert.ok(PICKUP_POOL_SIZE > worst, `the pool is ${PICKUP_POOL_SIZE} against a peak demand of ${worst}`)
  // The other end, which is the rule the decal pool's own check states: a pool far past its demand
  // is a number nobody has to justify, and it stops being answerable to a measurement.
  assert.ok(PICKUP_POOL_SIZE < worst * 2, `the pool is ${PICKUP_POOL_SIZE} against a demand of only ${worst}`)
  console.log(`    pool ${PICKUP_POOL_SIZE} against a peak of ${worst} in the draw distance, over five laps`)
})

console.log(`${passed} checks passed`)
