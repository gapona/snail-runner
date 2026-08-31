#!/usr/bin/env node
// Logic check for src/run/critters.ts -- the bugs that run at you. Plain assertions, no framework,
// via the register-ts-loader.mjs + ts-extensionless-loader.mjs Node-native-TS setup.
//
// **Three things are worth a suite here and the third is the reason the module exists.** That they
// run in a straight line, which is a fairness claim and is asserted structurally rather than by
// watching a number move. That the sweep cannot be stepped over, because a bug and the player close
// at up to 6340 units a second against a 200-unit crossing and a dropped frame covers the whole of
// it. And that a critter can never make a stretch of road impassable -- which is not a hope about
// the placer but an arithmetic consequence of one constant, `BEETLE_BAND.yHigh < JUMP_APEX`, and
// is checked from both ends here.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  BEE_BAND,
  BEE_CLEARANCE,
  BEE_ROAD_SHARE,
  BEE_SPEED,
  GROUND_MAX_HEIGHT,
  chooseCritterKind,
  CRITTER_KINDS,
  CRITTER_KIND_IDS,
  critterTravel,
  clearedAt,
  createCritterField,
  critterWarningMs,
  resolveCritters,
  stepCritters,
  BEETLE_BAND,
  CRITTER_DEPTH,
  CRITTER_DESPAWN_BEHIND_Z,
  CRITTER_FIRST_Z,
  CRITTER_GAP_Z,
  BEETLE_HALF_WIDTHS,
  BEETLE_HEIGHT,
  CRITTER_JUMP_WINDOW,
  BEETLE_MAX_OFFSET,
  BEETLE_ROAD_SHARE,
  CRITTER_SPAWN_AHEAD_Z,
  BEETLE_SPEED,
  BEETLE_WIDTH,
  MAX_CRITTERS,
} from '../src/run/critters.ts'
import { CRITTER_CANVAS, CRITTER_FRAMES, CRITTER_STEP_UNITS, createCritterTextures } from '../src/run/critterArt.ts'
import { createObstacle, hits, obstacleRows, placeRunObstacles } from '../src/run/obstacles.ts'
import {
  JUMP_APEX,
  MAX_ATTAINABLE_SPEED,
  OBSTACLE_BANDS,
  PLAYER_BODY_H,
  PLAYER_HALF_WIDTHS,
  PLAYER_WIDTH,
  REACTION_MS,
  ROAD_EDGE,
  SPEED_BASE,
  SPEED_CAP,
} from '../src/run/constants.ts'
import { createPlayerState, jump, stepPlayer } from '../src/run/playerMotion.ts'
import {
  BEE_COLORS,
  CRITTER_COLORS,
  INK_LIGHTNESS,
  OBSTACLE_MATERIALS,
  SNAIL_SHELL,
  lightnessOf,
  saturationOf,
} from '../src/run/artPalette.ts'
import { WORLD_LAYER } from '../src/run/worldDepth.ts'
import { DRAW_DISTANCE, ROAD_WIDTH, SEGMENT_LENGTH } from '../src/road/constants.ts'

let passed = 0

function check(name, fn) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

const TRACK = 286800
const DT = 1000 / 60
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length

const GROUND = () => CRITTER_KIND_IDS.filter((kind) => !CRITTER_KINDS[kind].flying)
const FLYING = () => CRITTER_KIND_IDS.filter((kind) => CRITTER_KINDS[kind].flying)

/** The box `hits` reads for one kind, in a given lane. */
const boxOf = (kind, lane = 0) => ({
  offsetX: lane,
  halfWidths: CRITTER_KINDS[kind].halfWidths,
  ...CRITTER_KINDS[kind].band,
})

/** A body at a lane and a height, in the shape `hits` wants. */
const body = (offsetX, y = 0) => ({ offsetX, y })

/** Drives a field forward `seconds` at `runSpeed`, returning the population's history. */
function drive(field, runSpeed, seconds, dt = DT) {
  let playerZ = 0
  let peak = 0
  const seen = new Set()

  for (let elapsed = 0; elapsed < seconds * 1000; elapsed += dt) {
    playerZ += (runSpeed * dt) / 1000
    stepCritters(field, playerZ, dt)
    peak = Math.max(peak, field.critters.length)
    for (const critter of field.critters) seen.add(critter.id)
  }

  return { peak, made: seen.size, playerZ }
}

/**
 * A stand-in for `Phaser.GameObjects.Graphics` that records where it was asked to draw.
 *
 * Only the calls `critterArt.ts` actually makes, and deliberately no more: a stub that answers
 * everything would go on passing after the drawing started using something it does not model.
 */
function record() {
  const frames = []
  const shells = []
  let points = null
  const at = (x, y) => points.push([x, y])
  const g = {
    fillStyle: () => g,
    lineStyle: () => g,
    beginPath: () => g,
    closePath: () => g,
    strokePath: () => g,
    fillPath: () => g,
    moveTo: (x, y) => (at(x, y), g),
    lineTo: (x, y) => (at(x, y), g),
    fillRect: (x, y, w, h) => (at(x, y), at(x + w, y + h), g),
    fillCircle: (x, y, r) => (at(x - r, y - r), at(x + r, y + r), g),
    fillEllipse: (x, y, w, h) => {
      at(x - w / 2, y - h / 2)
      at(x + w / 2, y + h / 2)
      // The largest filled ellipse is the carapace; kept so the mass can be measured and not only
      // the silhouette's span.
      if (!shells[0] || w * h > shells[0].w * shells[0].h) shells[0] = { w, h }

      return g
    },
    strokeEllipse: (x, y, w, h) => (at(x - w / 2, y - h / 2), at(x + w / 2, y + h / 2), g),
    generateTexture: () => (frames.push(points), g),
    destroy: () => g,
  }

  return {
    frames,
    shells,
    scene: {
      textures: { exists: () => false },
      make: {
        graphics: () => {
          points = []

          return g
        },
      },
    },
  }
}

/** A field holding exactly one critter of `kind` at `z`, with nothing further ever scheduled. */
function lone(z, kind = 'beetle') {
  const field = createCritterField(1, 0)

  // Rolled until the wanted kind comes up, rather than hand-built: the fixture then carries whatever
  // the shipped spawn actually produces, so a change to the kind table reaches these checks.
  for (let attempt = 0; attempt < 200 && field.critters[0]?.kind !== kind; attempt++) {
    field.critters.length = 0
    field.nextSpawnZ = 0
    stepCritters(field, 0, 1)
  }
  assert.equal(field.critters[0]?.kind, kind, `could not spawn a ${kind}`)
  field.critters.length = 1
  field.critters[0].z = z
  field.critters[0].resolved = false
  // The schedule is switched off, so what the tests below count is one bug and not the population
  // that would otherwise keep arriving behind it.
  field.nextSpawnZ = Infinity

  return field
}

console.log('they run in a straight line')

check('stepCritters is told nothing about the player except where they are', () => {
  // **Structural, and that is the point.** A hazard that chases cannot be answered by moving, only
  // by out-timing it, so the player learns to ignore where it is. The guarantee worth having is not
  // "the lane happens not to change today" but "there is nothing in scope that could change it":
  // the step takes a field, the player's position along the road, and a delta. No lane, no body, no
  // steering. A future argument added to make a bug home in would fail here first.
  assert.equal(stepCritters.length, 3, 'stepCritters grew an argument — is something steering the bugs?')
})

check('a lane is set once and holds for the whole life of a bug', () => {
  const field = createCritterField(7, 0)

  stepCritters(field, 0, DT)

  const critter = field.critters[0]
  const lane = critter.offsetX

  assert.ok(critter, 'nothing spawned at the first step')
  for (let i = 0; i < 4000; i++) {
    // The player weaves the whole width of the road underneath it; the bug must not notice.
    stepCritters(field, i * 40, DT)
    if (field.critters.includes(critter)) assert.equal(critter.offsetX, lane, 'a bug changed lane')
  }
})

check('every bug is laid fully on the road', () => {
  const field = createCritterField(11, 0)

  drive(field, SPEED_CAP, 120)
  assert.ok(field.nextId > 20, 'not enough bugs were made to say anything')
  // The same rule the obstacle placer follows: a hazard hanging off the verge is invisible *and*
  // free, which reads as the game having forgotten to place it. Per kind, because a bee is narrower
  // than a beetle and may therefore run closer to the edge.
  for (const kind of CRITTER_KIND_IDS) {
    const spec = CRITTER_KINDS[kind]

    assert.ok(spec.maxOffset + spec.halfWidths <= ROAD_EDGE + 1e-9, `a ${kind} can hang off the verge`)
  }
  for (const critter of field.critters) {
    const spec = CRITTER_KINDS[critter.kind]

    assert.ok(Math.abs(critter.offsetX) <= spec.maxOffset + 1e-9, `a ${critter.kind} was laid off the road`)
  }
})

console.log('\nthe motion is frame-rate invariant')

check('a second of travel covers the same ground at 30, 60 and 144Hz, for both kinds', () => {
  for (const kind of CRITTER_KIND_IDS) {
    const at = (hz) => {
      const field = lone(0, kind)
      const critter = field.critters[0]
      const from = critter.z

      // Exactly `hz` ticks, so the three rates cover exactly a second each and the comparison is
      // about the integration rather than about where a loop condition happened to land.
      for (let tick = 0; tick < hz; tick++) stepCritters(field, -1e12, 1000 / hz)

      return from - critter.z
    }
    const speed = CRITTER_KINDS[kind].speed

    for (const travelled of [30, 60, 144].map(at)) {
      assert.ok(Math.abs(travelled - speed) < 1e-9, `${kind} covered ${travelled.toFixed(3)} in a second`)
    }
    console.log(`    ${kind.padEnd(7)} ${speed.toFixed(0)} u/s, identical at 30, 60 and 144Hz`)
  }
})

console.log('\nnothing is ever seen appearing, and the warning is measured')

check('a bug is born at or beyond the last segment the frame draws', () => {
  // The rule `lapLayout.ts` states for the road, applied to the one system with no lap to hand
  // over: a creature must not come into existence on a piece of road the player is looking at.
  assert.ok(
    CRITTER_SPAWN_AHEAD_Z >= DRAW_DISTANCE * SEGMENT_LENGTH,
    `spawned ${(CRITTER_SPAWN_AHEAD_Z / SEGMENT_LENGTH).toFixed(0)} segments out against a ${DRAW_DISTANCE}-segment road`,
  )
})

check('the warning clears REACTION_MS at every speed a run can reach', () => {
  const speeds = [
    ['SPEED_BASE', SPEED_BASE],
    ['SPEED_CAP', SPEED_CAP],
    ['a Fever', MAX_ATTAINABLE_SPEED],
  ]

  for (const [name, speed] of speeds) {
    const warning = critterWarningMs(speed)

    assert.ok(warning > REACTION_MS, `${name} leaves only ${warning.toFixed(0)}ms`)
    console.log(
      `    ${name.padEnd(11)} closing ${(speed + BEETLE_SPEED).toFixed(0)} u/s, ` +
        `${(warning / 1000).toFixed(1)}s of warning (floor ${REACTION_MS}ms)`,
    )
  }

  // **The control**: the same measure over a bug born one segment out rejects it, so the check is
  // shown to be measuring the spawn distance rather than a property of the arithmetic.
  const near = (SEGMENT_LENGTH / (MAX_ATTAINABLE_SPEED + BEETLE_SPEED)) * 1000

  assert.ok(near < REACTION_MS, 'the control passes, so this check proves nothing')
  console.log(`    control: born one segment out leaves ${near.toFixed(0)}ms and is rejected`)
})

console.log('\na jump always clears a bug, and that is the whole safety argument')

check('every kind is solved from a bound rather than picked', () => {
  // **⚠ Three sizes were reported before this settled, and the last report changed the method.**
  // The beetle's box is *solved* — half the road across, the jump's ceiling tall — and its 4.67:1 is
  // a consequence no creature has, which is why it must be geometry. Every other kind is the other
  // way round: the game picks the height from the rule that kind lives under, and the MODEL's own
  // aspect decides the width. That inversion is what made more than two creatures affordable.
  assert.ok(Math.abs(BEETLE_HEIGHT - JUMP_APEX * (1 - CRITTER_JUMP_WINDOW ** 2)) < 1e-9)
  assert.ok(
    Math.abs(BEETLE_HALF_WIDTHS + PLAYER_HALF_WIDTHS - ROAD_EDGE * BEETLE_ROAD_SHARE) < 1e-9,
    'the beetle stopped being solved from the share of road it may claim',
  )

  for (const kind of CRITTER_KIND_IDS) {
    const spec = CRITTER_KINDS[kind]
    const width = spec.halfWidths * 2 * ROAD_WIDTH
    const height = spec.band.yHigh - spec.band.yLow

    // Nothing may span the road: a lane free of it has to exist, which is the bee's whole safety
    // argument and is no less true of the others.
    assert.ok(spec.halfWidths + PLAYER_HALF_WIDTHS < ROAD_EDGE, `a ${kind} spans the road`)
    // And nothing may be a speck: the reason there are creatures here at all is that they read.
    assert.ok(width > PLAYER_WIDTH * 0.5, `a ${kind} is ${width.toFixed(0)} units wide against a mascot of ${PLAYER_WIDTH.toFixed(0)}`)
    console.log(
      `    ${kind.padEnd(9)} ${width.toFixed(0).padStart(4)}x${height.toFixed(0).padEnd(3)} ` +
        `${(width / height).toFixed(2)}:1  ${((spec.halfWidths + PLAYER_HALF_WIDTHS) / ROAD_EDGE * 100).toFixed(0)}% of the road  ` +
        `${spec.speed.toFixed(0)} u/s  ${spec.flying ? 'flies' : 'runs'}`,
    )
  }
})

check('every GROUND kind is cleared by a jump, and none is a barrier in disguise', () => {
  for (const kind of GROUND()) {
    const spec = CRITTER_KINDS[kind]

    assert.equal(spec.band.yLow, 0, `a ${kind} runs on the road, so its band must start there`)
    assert.ok(spec.band.yHigh <= GROUND_MAX_HEIGHT + 1e-9, `a ${kind} reaches ${spec.band.yHigh.toFixed(0)}, past the jump's ceiling`)
    assert.ok(clearedAt(JUMP_APEX, kind), `a ${kind} hits a snail at the top of its own jump`)
    assert.ok(!clearedAt(0, kind), `a ${kind} does not hit a grounded snail — it is not a hazard at all`)
  }
  // Stated as the ordering rather than as a ratio, because the ordering IS the distinction: the apex
  // sits strictly between a ground kind and the barrier that cannot be jumped.
  assert.ok(GROUND_MAX_HEIGHT < JUMP_APEX && JUMP_APEX < OBSTACLE_BANDS.blocking.yHigh)
  console.log(`    ${GROUND().length} ground kinds, tallest ${GROUND_MAX_HEIGHT.toFixed(0)} against an apex of ${JUMP_APEX}`)
})

check('the flight the game integrates agrees with the closed form the height was solved from', () => {
  // **The height comes out of `sqrt(1 - h / apex)`, which is algebra about an idealised parabola.**
  // If the tick the game actually runs disagrees with it then every number in this file is measuring
  // a fiction — the same reason `verify:formations` makes the arc's stepped and closed forms agree
  // before it asserts anything else about them.
  let player = jump(createPlayerState())
  let airborne = 0
  let cleared = 0

  while (!player.grounded) {
    player = stepPlayer(player, { targetFraction: 0.5, active: false }, DT)
    airborne++
    if (clearedAt(player.y)) cleared++
  }

  const measured = cleared / airborne

  // Within a tick of the flight: the stepped count is quantised to 1/42 of it.
  assert.ok(
    Math.abs(measured - CRITTER_JUMP_WINDOW) < 0.03,
    `the real flight clears the band for ${(measured * 100).toFixed(0)}% against a solved ${CRITTER_JUMP_WINDOW * 100}%`,
  )
  // **And the constant itself has a floor.** Below about half a flight the jump stops being a window
  // and becomes an instant to hit — which is where the one guarantee this feature rests on would go.
  assert.ok(CRITTER_JUMP_WINDOW >= 0.45, `only ${(CRITTER_JUMP_WINDOW * 100).toFixed(0)}% of a jump clears a bug`)
  console.log(
    `    ${(measured * 100).toFixed(0)}% of a ${(airborne * DT).toFixed(0)}ms flight is above ${BEETLE_HEIGHT.toFixed(0)} ` +
      `(${(cleared * DT).toFixed(0)}ms of window, against a timing precision nearer 60ms)`,
  )
})

check('a bug never takes away a line an obstacle row left open in the air', () => {
  // The property that makes the whole feature safe: `provePassable` guarantees a way through every
  // row the placer ships, and a critter must not be able to close it. In the air it cannot close
  // *anything* — the band does not reach — so the set of offsets a row blocks at the apex is
  // identical with and without a bug standing anywhere in it.
  const lap = placeRunObstacles(4242, TRACK)
  const rows = obstacleRows(lap)
  const offsets = Array.from({ length: 81 }, (_, i) => -ROAD_EDGE + (2 * ROAD_EDGE * i) / 80)
  let checked = 0

  assert.ok(rows.length > 30, 'the lap is too thin to say anything')
  for (const row of rows) {
    for (const kind of GROUND()) {
      const lane = CRITTER_KINDS[kind].maxOffset
      const bug = boxOf(kind, lane)
      const without = offsets.filter((offsetX) => !row.obstacles.some((o) => hits(body(offsetX, JUMP_APEX), o)))
      const with_ = without.filter((offsetX) => !hits(body(offsetX, JUMP_APEX), bug))

      assert.deepEqual(with_, without, 'a bug closed an air line through a row')
      checked++
    }
  }
  console.log(`    ${rows.length} rows x ${GROUND().length} ground kinds = ${checked} combinations, no air line lost`)
})

check('when a bug closes the ground line, the jump is always still there', () => {
  // **The check that matters most now that a bug takes half the road.** `provePassable` guarantees a
  // line through every row the placer ships; a bug can take that line away *on the ground*, and the
  // whole feature rests on the jump then being available. Driven over a real lap: every row, every
  // lane a bug can run in, both answers counted.
  const lap = placeRunObstacles(4242, TRACK)
  const rows = obstacleRows(lap)
  const lanes = Array.from({ length: 21 }, (_, i) => -BEETLE_MAX_OFFSET + (2 * BEETLE_MAX_OFFSET * i) / 20)
  const offsets = Array.from({ length: 161 }, (_, i) => -ROAD_EDGE + (2 * ROAD_EDGE * i) / 160)
  let combinations = 0
  let groundLost = 0

  for (const row of rows) {
    for (const lane of lanes) {
      const bug = boxOf('beetle', lane)
      const ground = offsets.some(
        (offsetX) => !hits(body(offsetX), bug) && !row.obstacles.some((o) => hits(body(offsetX), o)),
      )
      const air = offsets.some((offsetX) => !row.obstacles.some((o) => hits(body(offsetX, JUMP_APEX), o)))

      combinations++
      if (!ground) groundLost++
      // The guarantee, asserted on every single combination rather than sampled: a bug may take the
      // ground away, but it may never leave the player with nothing.
      assert.ok(ground || air, 'a bug and a row between them left no line at all')
    }
  }

  // Printed rather than bounded, because this IS the difficulty the size buys: a row the player
  // could have walked through now sometimes has to be jumped. It is not zero and should not be.
  console.log(
    `    ${combinations} row-and-lane combinations: the ground line survives ` +
      `${(((combinations - groundLost) / combinations) * 100).toFixed(0)}%, the jump answers the other ` +
      `${((groundLost / combinations) * 100).toFixed(0)}%, and neither is ever absent`,
  )
})

check('a bug takes exactly the share of road it is solved to take', () => {
  // Measured through the real `hits` rather than recomputed from the constants, so the arithmetic in
  // `BEETLE_HALF_WIDTHS` is checked against the thing that actually decides a collision.
  const bug = boxOf('beetle')
  const offsets = Array.from({ length: 4001 }, (_, i) => -ROAD_EDGE + (2 * ROAD_EDGE * i) / 4000)
  const blocked = offsets.filter((offsetX) => hits(body(offsetX), bug)).length / offsets.length

  assert.ok(Math.abs(blocked - BEETLE_ROAD_SHARE) < 0.01, `${(blocked * 100).toFixed(1)}% blocked`)
  // **⚠ This ceiling is a DESIGN one, not a safety one, and the earlier version of this check had it
  // wrong.** It asserted a half on the reasoning that past a half a bug could close the road — which
  // is false: the jump answers a bug at any width, because the band never reaches the apex, and a
  // row that forces a lateral gap is met on the ground where the bug is dodged instead. What a wider
  // bug costs is *choice*, measured by the check above as the share of encounters where the ground
  // line survives. What it may not reach is 1, where a bug stops being a hazard to dodge and becomes
  // a wall to jump on a timer.
  assert.ok(BEETLE_ROAD_SHARE < 1, `a bug claims ${(BEETLE_ROAD_SHARE * 100).toFixed(0)}% of the road — it is a wall`)
  console.log(
    `    ${BEETLE_WIDTH.toFixed(0)} units wide, ${(blocked * 100).toFixed(0)}% of the drivable road once ` +
      `the snail's own width is added — and it can never run near the verge, so road is left on both sides`,
  )
})

console.log('\nthe crossing is swept, and it is live for all of it')

check('a head-on bug registers at every frame rate, and the point test does not', () => {
  // **Swept against unswept over the same 60 sub-frame phases**, because a single alignment proves
  // nothing either way: a point test catches a crossing whenever the frame happens to land inside
  // it, and at 60Hz it usually does. What separates the two is what happens on the long frames --
  // the ones a phone actually drops -- so the interesting column is the bottom row.
  const rows = []

  for (const hz of [60, 30, 15]) {
    const dt = 1000 / hz
    const closes = ((MAX_ATTAINABLE_SPEED + BEETLE_SPEED) * dt) / 1000
    let sweptMisses = 0
    let pointMisses = 0

    for (let phase = 0; phase < 60; phase++) {
      // The same encounter, started a fraction of a frame earlier each time.
      const start = CRITTER_SPAWN_AHEAD_Z + (closes * phase) / 60
      const swept = lone(start)
      const point = lone(start)
      let playerZ = 0
      let previous = 0
      let sweptHits = 0
      let pointHits = 0

      while (playerZ < CRITTER_SPAWN_AHEAD_Z * 2) {
        playerZ += (MAX_ATTAINABLE_SPEED * dt) / 1000
        stepCritters(point, playerZ, dt)

        stepCritters(swept, playerZ, dt)

        const gap = point.critters[0] ? point.critters[0].z - playerZ : 1

        if (resolveCritters(swept, body(swept.critters[0]?.offsetX ?? 0), previous, playerZ, dt)) sweptHits++
        if (gap <= 0 && gap >= -CRITTER_DEPTH) pointHits++
        previous = playerZ
      }

      if (sweptHits !== 1) sweptMisses++
      if (pointHits < 1) pointMisses++
    }

    assert.equal(sweptMisses, 0, `at ${hz}Hz the swept test missed ${sweptMisses} of 60 encounters`)
    rows.push([hz, closes, pointMisses])
  }

  // The control has to bite somewhere or the sweep is decoration. It bites where it should: on the
  // long frames, where one covers more ground than the crossing is deep.
  assert.ok(
    rows.some(([, , missed]) => missed > 0),
    'the point test caught every encounter, so the sweep is not what the check above measured',
  )
  for (const [hz, closes, missed] of rows) {
    console.log(
      `    ${String(hz).padStart(3)}Hz closes ${closes.toFixed(0).padStart(4)} units per frame against a ` +
        `${CRITTER_DEPTH}-unit crossing: swept 0/60 missed, point test ${missed}/60 missed`,
    )
  }
})

check('a bug stays live for the whole crossing, not just the frame contact begins', () => {
  // The correction `resolveObstacles` records for rocks, and it bites harder here: three frames of
  // overlap is time enough to slide sideways into something that is walking at you.
  const field = lone(400)
  const critter = field.critters[0]

  let playerZ = 0
  let previous = 0
  let struck = null
  let frames = 0

  while (!struck && frames < 60) {
    playerZ += (SPEED_CAP * DT) / 1000

    stepCritters(field, playerZ, DT)
    // Clear of it laterally to begin with, and steering into it partway through the crossing.
    const lane = frames < 4 ? critter.offsetX + 1 : critter.offsetX

    struck = resolveCritters(field, body(lane), previous, playerZ, DT)
    previous = playerZ
    frames++
  }

  assert.ok(struck, 'a bug entered clear of the snail was never live again')
})

check('one bug is worth at most one hit', () => {
  const field = lone(400)
  const critter = field.critters[0]

  let playerZ = 0
  let previous = 0
  let struck = 0

  for (let i = 0; i < 120; i++) {
    playerZ += (SPEED_BASE * DT) / 1000

    stepCritters(field, playerZ, DT)

    if (resolveCritters(field, body(critter.offsetX), previous, playerZ, DT)) struck++
    previous = playerZ
  }

  assert.equal(struck, 1, `one bug charged the player ${struck} times`)
})

console.log('\nthe population is bounded, and the lap seam is a non-event')

check('the field never exceeds MAX_CRITTERS, and the headroom is printed', () => {
  const runs = [
    ['SPEED_BASE', SPEED_BASE],
    ['SPEED_CAP', SPEED_CAP],
    ['a Fever throughout', MAX_ATTAINABLE_SPEED],
  ]

  let worst = 0

  for (const [name, speed] of runs) {
    const field = createCritterField(99, CRITTER_FIRST_Z)
    const { peak, made, playerZ } = drive(field, speed, 300)

    assert.ok(peak <= MAX_CRITTERS, `${name} reached ${peak} against a cap of ${MAX_CRITTERS}`)
    assert.ok(peak < MAX_CRITTERS, `${name} reached the cap itself, so bugs were being skipped`)
    worst = Math.max(worst, peak)
    console.log(
      `    ${name.padEnd(18)} ${made} bugs over ${(playerZ / 1000).toFixed(0)}km, ` +
        `peak ${peak} alive against a pool of ${MAX_CRITTERS}, one every ${(playerZ / made / SEGMENT_LENGTH).toFixed(0)} segments`,
    )
  }

  // The other end, and the rule `PICKUP_POOL_SIZE` was just re-sized against: a cap far past the
  // demand is a number nobody has to justify — and `CRITTER_POOL_SIZE` is derived from this one, so
  // the drawing pool inherits whatever slack is left here.
  assert.ok(MAX_CRITTERS < worst * 2, `the cap is ${MAX_CRITTERS} against a worst-case peak of ${worst}`)
})

check('the spacing is the one the constants state', () => {
  const field = createCritterField(5, 0)
  const gaps = []
  let previous = 0

  for (let i = 0; i < 200; i++) {
    const at = field.nextSpawnZ

    stepCritters(field, at, DT)
    if (i > 0) gaps.push(at - previous)
    previous = at
  }

  assert.ok(Math.min(...gaps) >= CRITTER_GAP_Z.min - 1e-6)
  assert.ok(Math.max(...gaps) <= CRITTER_GAP_Z.max + 1e-6)
  console.log(
    `    ${(mean(gaps) / SEGMENT_LENGTH).toFixed(0)} segments between bugs on average — ` +
      `${(mean(gaps) / SPEED_CAP).toFixed(1)}s at the cap, ${(mean(gaps) / SPEED_BASE).toFixed(1)}s at the start of a run`,
  )
})

check('a bug is retired once it is behind the player, and only then', () => {
  const field = lone(0)
  const critter = field.critters[0]

  stepCritters(field, CRITTER_DESPAWN_BEHIND_Z * 0.5, DT)
  assert.ok(field.critters.includes(critter), 'a bug just behind the snail was retired while still on screen')
  stepCritters(field, CRITTER_DESPAWN_BEHIND_Z * 2, DT)
  assert.ok(!field.critters.includes(critter), 'a bug well behind the snail was kept')
})

check('the lap seam is a non-event, because nothing here wraps', () => {
  // Positions are the run's own odometer, so crossing the track's seam is not a case at all — which
  // is the property `critters.ts` chose absolute coordinates for. Driven across two whole laps, a
  // head-on bug still resolves exactly once, at the same relative position.
  const field = lone(TRACK * 2 + CRITTER_SPAWN_AHEAD_Z)
  const critter = field.critters[0]
  let playerZ = TRACK * 2
  let previous = playerZ
  let struck = 0

  assert.ok(critter.z > TRACK * 2, 'a bug was made behind the player after two laps')
  while (playerZ < TRACK * 2 + CRITTER_SPAWN_AHEAD_Z * 2) {
    playerZ += (SPEED_CAP * DT) / 1000

    stepCritters(field, playerZ, DT)

    if (resolveCritters(field, body(critter.offsetX), previous, playerZ, DT)) struck++
    previous = playerZ
  }
  assert.equal(struck, 1)
})

console.log('\nthe art')

check('the SHIPPED art is its own collision box too, not just the fallback canvas', () => {
  // **⚠ The drawn canvas and the delivered PNG are two different things and only one of them ships.**
  // `critterArt.ts` skips a key the loader has already filled, so what a player sees is
  // `public/assets/critter/*.png` — and `CritterSprites` stretches whatever it is handed onto the
  // world box. A render at another proportion is distorted in every frame, which is exactly how the
  // kit-sourced obstacles shipped (4.17:1 into a box of 2.96:1) and why these are built as geometry
  // whose height is solved against the pitch until the CONTENT lands on the box. See
  // `dev-assets/cc0-3d/critter_render.py`.
  for (const kind of CRITTER_KIND_IDS) {
    const spec = CRITTER_KINDS[kind]
    const target = (spec.halfWidths * 2 * ROAD_WIDTH) / (spec.band.yHigh - spec.band.yLow)

    for (let pose = 0; pose < CRITTER_FRAMES; pose++) {
      const file = `public/assets/critter/critter-${kind}-${pose}.png`
      const png = readFileSync(file)
      // The IHDR width and height, big-endian at a fixed offset in every PNG.
      const width = png.readUInt32BE(16)
      const height = png.readUInt32BE(20)
      const aspect = width / height

      assert.ok(
        Math.abs(aspect / target - 1) < 0.02,
        `${file} is ${aspect.toFixed(3)}:1 against a box of ${target.toFixed(3)}:1`,
      )
      if (pose === 0) {
        console.log(`    ${kind.padEnd(7)} ${width}x${height} shipped, ${aspect.toFixed(3)}:1 against ${target.toFixed(3)}:1`)
      }
    }
  }
})

check('each kind\'s canvas is its own collision box, so no sprite is stretched onto one', () => {
  // The drawn box IS the collision box — the rule `PLAYER_WIDTH` documents, and the one the shipped
  // obstacle renders broke by 41% before anybody measured it. A canvas at another proportion is a
  // distorted critter in every frame.
  for (const kind of CRITTER_KIND_IDS) {
    const spec = CRITTER_KINDS[kind]
    const worldAspect = (spec.halfWidths * 2 * ROAD_WIDTH) / (spec.band.yHigh - spec.band.yLow)
    const canvas = CRITTER_CANVAS[kind]
    const canvasAspect = canvas.width / canvas.height

    assert.ok(
      Math.abs(canvasAspect - worldAspect) / worldAspect < 0.02,
      `${kind} canvas ${canvasAspect.toFixed(2)}:1 against a box of ${worldAspect.toFixed(2)}:1`,
    )
    console.log(`    ${kind.padEnd(7)} ${canvas.width}x${canvas.height} for a ${worldAspect.toFixed(2)}:1 box`)
  }

  // **And the two must not be the same shape.** Type reads by aspect before it reads by contour, so
  // the kind a jump answers and the kind a jump runs into may not be one silhouette at two sizes.
  const aspects = CRITTER_KIND_IDS.map((kind) => {
    const spec = CRITTER_KINDS[kind]

    return (spec.halfWidths * 2 * ROAD_WIDTH) / (spec.band.yHigh - spec.band.yLow)
  })

  assert.ok(Math.max(...aspects) / Math.min(...aspects) > 1.5, 'the two kinds are the same proportion')
})

check('the gait is two poses and it advances with the bug, not with a clock', () => {
  assert.equal(CRITTER_FRAMES, 2, 'an alternating tripod has exactly two poses')

  const beetle = BEETLE_SPEED / CRITTER_STEP_UNITS.beetle
  const bee = BEE_SPEED / CRITTER_STEP_UNITS.bee

  assert.ok(beetle > 4 && beetle < 16, `${beetle.toFixed(1)} poses a second reads as ${beetle < 4 ? 'trudging' : 'a blur'}`)
  // **A wingbeat the eye can count is a bird**, so the bee's is deliberately past what any frame
  // rate resolves — the opposite requirement to the beetle's gait.
  assert.ok(bee > 30, `a bee beats its wings ${bee.toFixed(0)} times a second, which is countable`)
  console.log(`    beetle ${beetle.toFixed(1)} poses a second (${(beetle / 2).toFixed(1)} gait cycles), bee ${bee.toFixed(0)}`)
})

check('a bug is told apart from the barriers by value, which is what the haze leaves', () => {
  // The rule the obstacle classes are already held to: at the sizes these are met at the distance
  // haze and the biome tint take hue away before they take brightness, so the separation that has
  // to hold is lightness. A critter is met at a `low` block's own size and must never read as one.
  const chitin = [CRITTER_COLORS.light, CRITTER_COLORS.mid, CRITTER_COLORS.dark]
  const critter = mean(chitin.map(lightnessOf))

  for (const [kind, material] of Object.entries(OBSTACLE_MATERIALS)) {
    const barrier = mean(Object.values(material).map(lightnessOf))

    assert.ok(barrier - critter >= 12, `a bug is only ${(barrier - critter).toFixed(0)} lighter than ${kind}`)
    console.log(`    against ${kind.padEnd(9)} ${barrier.toFixed(0)} vs ${critter.toFixed(0)} lightness`)
  }
  // Every `dark` band in this game is below the ink threshold, or the shaded half of an object
  // counts as body colour and the whole thing reads as a flat cut-out pasted onto the road.
  assert.ok(lightnessOf(CRITTER_COLORS.dark) < INK_LIGHTNESS)
  assert.ok(lightnessOf(CRITTER_COLORS.light) > lightnessOf(CRITTER_COLORS.mid))
  assert.ok(lightnessOf(CRITTER_COLORS.mid) > lightnessOf(CRITTER_COLORS.dark))
})

check('a bug is not something the player wants, and its colour says so', () => {
  // Colour in this game means "come and get it" — the mascot and the pickups own it. A vivid hazard
  // would be the first thing on the road a player steers towards.
  const chitin = mean([CRITTER_COLORS.light, CRITTER_COLORS.mid, CRITTER_COLORS.dark].map(saturationOf))
  const barriers = mean(Object.values(OBSTACLE_MATERIALS).flatMap((m) => Object.values(m).map(saturationOf)))

  assert.ok(chitin <= barriers, `a bug is ${chitin.toFixed(0)}% saturated against barriers at ${barriers.toFixed(0)}%`)
  console.log(`    ${chitin.toFixed(0)}% saturation against the barrier family's ${barriers.toFixed(0)}%`)
})


console.log('\nand the bee is the mirror of it: the kind that punishes being airborne')

check('a bee never touches a grounded snail, and there is drawn daylight under it', () => {
  // **The class this game deleted, brought back by the one object that justifies it.**
  // `OBSTACLE_BANDS` carries the argument: `overhead` was the only thing that punished being
  // airborne, and losing it means a jump taken when none was needed is free. What killed it is that
  // it could not be *drawn* — a band starting above the road draws floating with nothing beneath it,
  // and it was reported as "a thing hanging in the air" three times. A bee is supposed to hang in
  // the air.
  for (const kind of FLYING()) {
    assert.ok(
      CRITTER_KINDS[kind].band.yLow > PLAYER_BODY_H,
      `a ${kind} starts at ${CRITTER_KINDS[kind].band.yLow.toFixed(0)} against a standing snail of ${PLAYER_BODY_H}`,
    )
    assert.ok(clearedAt(0, kind), `a ${kind} hits a snail standing on the road`)
  }
  // The daylight is the deleted class's own ratio, and it is what makes the gap legible rather than
  // merely present.
  assert.ok(Math.abs((BEE_BAND.yLow - PLAYER_BODY_H) / PLAYER_BODY_H - BEE_CLEARANCE) < 1e-9)
  console.log(
    `    band [${BEE_BAND.yLow.toFixed(0)}, ${BEE_BAND.yHigh.toFixed(0)}] over a standing snail of ${PLAYER_BODY_H} — ` +
      `${(BEE_BAND.yLow - PLAYER_BODY_H).toFixed(0)} units of daylight, ${(BEE_CLEARANCE * 100).toFixed(0)}% of a body`,
  )
})

check('a bee is what a jump runs into, and it is not a near miss', () => {
  // The mirror of the beetle's own measurement, over the same real flight.
  let player = jump(createPlayerState())
  let airborne = 0
  let caught = 0

  while (!player.grounded) {
    player = stepPlayer(player, { targetFraction: 0.5, active: false }, DT)
    airborne++
    if (!clearedAt(player.y, 'bee')) caught++
  }

  const share = caught / airborne

  for (const kind of FLYING()) {
    assert.ok(!clearedAt(JUMP_APEX, kind), `a ${kind} misses a snail at the top of its own jump`)
  }
  // **A hazard that catches a third of a flight is a coin toss, not a rule.** Jumping into a bee's
  // lane has to be a mistake rather than a risk, or the player never learns to stay down.
  assert.ok(share > 0.7, `a bee catches only ${(share * 100).toFixed(0)}% of a jump`)
  // The same closed form the beetle's height was solved from, read the other way round.
  const closed = Math.sqrt(1 - (BEE_BAND.yLow - PLAYER_BODY_H) / JUMP_APEX)

  assert.ok(Math.abs(share - closed) < 0.03, `measured ${share.toFixed(3)} against a solved ${closed.toFixed(3)}`)
  console.log(`    ${(share * 100).toFixed(0)}% of a ${(airborne * DT).toFixed(0)}ms flight is inside a bee's band`)
})

check('⚠ a bee can never seal a row the player was FORCED into the air by', () => {
  // ## The bee's whole safety argument, and it is provable rather than hopeful
  //
  // A beetle is answered by the jump. A bee is what the jump runs into — so the case that must not
  // exist is a row with no ground line (the player *has* to be airborne) whose air line a bee can
  // cover. The proof is in what forces a jump: only a wall, every wall is built by `drawWall` out of
  // `low` blocks, and a `low` block reaches 230 against an apex of 430 — so it obstructs nothing up
  // there. A bee narrower than the road therefore always leaves a lane.
  //
  // **The premise is what is asserted**, not the conclusion: if the placer ever produces a jump-only
  // row carrying a `blocking` obstacle, that row's air line is narrow and a bee could sit on it.
  const offsets = Array.from({ length: 321 }, (_, i) => -ROAD_EDGE + (2 * ROAD_EDGE * i) / 320)
  let rows = 0
  let jumpOnly = 0
  let tightest = 1

  for (const seed of [1, 4242, 777, 31337, 9001]) {
    for (const offset of [0, TRACK * 3]) {
      for (const row of obstacleRows(placeRunObstacles(seed, TRACK, offset))) {
        rows++

        const ground = offsets.some((o) => !row.obstacles.some((obstacle) => hits(body(o), obstacle)))

        if (ground) continue
        jumpOnly++
        assert.ok(
          !row.obstacles.some((obstacle) => obstacle.kind === 'blocking'),
          'a jump-only row carries a blocking obstacle, so its air line is narrow and a bee could seal it',
        )

        const air = offsets.filter((o) => !row.obstacles.some((obstacle) => hits(body(o, JUMP_APEX), obstacle)))

        tightest = Math.min(tightest, air.length / offsets.length)
        // And the conclusion, checked on every lane rather than argued: a line free of the row AND
        // of the bee.
        for (const kind of FLYING()) {
          for (const lane of [-CRITTER_KINDS[kind].maxOffset, 0, CRITTER_KINDS[kind].maxOffset]) {
            assert.ok(
              air.some((o) => !hits(body(o, JUMP_APEX), boxOf(kind, lane))),
              `a ${kind} sealed the only air line through a jump-only row`,
            )
          }
        }
      }
    }
  }

  assert.ok(jumpOnly > 50, `only ${jumpOnly} jump-only rows in the sample — not enough to say anything`)
  for (const kind of FLYING()) {
    assert.ok(
      CRITTER_KINDS[kind].halfWidths + PLAYER_HALF_WIDTHS < ROAD_EDGE,
      `a ${kind} spans the road, so there is no lane left in the air`,
    )
  }
  console.log(
    `    ${rows} rows, ${jumpOnly} of them jump-only, none carrying a blocking obstacle; ` +
      `the air is ${(tightest * 100).toFixed(0)}% clear at its tightest, against ${FLYING().length} flying kinds`,
  )
})

check('the flyers are the faster and rarer half, and every kind still gets its warning', () => {
  const slowestFlyer = Math.min(...FLYING().map((k) => CRITTER_KINDS[k].speed))
  const fastestGround = Math.max(...GROUND().map((k) => CRITTER_KINDS[k].speed))

  // Two hazards closing at the same rate are told apart only by their pictures, and the ones about
  // to cost a jump should be the ones arriving faster.
  assert.ok(slowestFlyer > fastestGround, 'a ground kind closes faster than a flyer')

  const total = CRITTER_KIND_IDS.reduce((sum, k) => sum + CRITTER_KINDS[k].weight, 0)
  const flyerShare = FLYING().reduce((sum, k) => sum + CRITTER_KINDS[k].weight, 0) / total

  // The kinds that punish a jump are the minority: they are the exception the player learns, and a
  // road where half of everything forbids jumping is a road where the jump is simply gone.
  assert.ok(flyerShare > 0.15 && flyerShare < 0.45, `${(flyerShare * 100).toFixed(0)}% of critters fly`)

  for (const kind of CRITTER_KIND_IDS) {
    const warning = critterWarningMs(MAX_ATTAINABLE_SPEED, kind)

    assert.ok(warning > REACTION_MS, `a ${kind} leaves only ${warning.toFixed(0)}ms in a Fever`)
  }
  console.log(
    `    ${GROUND().length} run at ${GROUND().map((k) => CRITTER_KINDS[k].speed.toFixed(0)).join('/')} u/s, ` +
      `${FLYING().length} fly at ${FLYING().map((k) => CRITTER_KINDS[k].speed.toFixed(0)).join('/')}; ` +
      `${(flyerShare * 100).toFixed(0)}% of critters fly, tightest warning ` +
      `${(Math.min(...CRITTER_KIND_IDS.map((k) => critterWarningMs(MAX_ATTAINABLE_SPEED, k))) / 1000).toFixed(1)}s`,
  )
})

check('a bee wears the one pattern that means do not touch this, and it is not the threat colour', () => {
  // **⚠ It breaks the rule the beetle's palette states, and the exception is the point.** Colour
  // here means "come and get it", and a critter was drawn at 18% saturation so nobody would steer
  // towards one. A bee cannot be read from its position on the road, because it is not on the road —
  // its whole warning is its own surface, so it gets the banding.
  //
  // What that costs is that amber is the mascot's own shell hue, and the cost is measured rather
  // than waved at: what separates them is VALUE, which is what survives the distance haze.
  const band = lightnessOf(BEE_COLORS.band)
  const shell = lightnessOf(SNAIL_SHELL.mid)

  assert.ok(lightnessOf(BEE_COLORS.dark) < INK_LIGHTNESS, 'a bee\'s chitin is not dark enough to read as ink')
  assert.ok(band > lightnessOf(BEE_COLORS.dark) + 60, 'the banding does not separate from the chitin it lies on')
  console.log(
    `    band ${band.toFixed(0)} lightness on chitin at ${lightnessOf(BEE_COLORS.dark).toFixed(0)}, ` +
      `against the mascot's shell at ${shell.toFixed(0)}`,
  )
})

console.log('\nthe draw order')

check('a bug sorts above the barriers and below the snail, inside one segment', () => {
  // Every tiebreak is under 1 so distance always dominates; these only decide two things standing
  // on the same segment. A bug runs in front of the rocks on its own segment and behind the snail,
  // which is the one object the player is tracking.
  assert.ok(WORLD_LAYER.obstacle < WORLD_LAYER.critter)
  assert.ok(WORLD_LAYER.critter < WORLD_LAYER.player)
  assert.ok(WORLD_LAYER.critter < 1, 'a tiebreak of a whole segment would overrule distance itself')
  // **A slot of its own rather than sharing `obstacle`'s**, because two things at one depth fall
  // back to pool order — stable for two rocks and not stable at all for a creature walking past one.
  assert.notEqual(WORLD_LAYER.critter, WORLD_LAYER.obstacle)
})

console.log('\nand what a bug costs is what a rock costs')

check('the hit test is the obstacles\' own, with no second rule anywhere', () => {
  // `hits` is handed a critter directly: it carries the same four fields an obstacle does, so there
  // is one collision model in this game and a bug is a box at the instant it is asked about.
  const bug = { offsetX: 0, halfWidths: BEETLE_HALF_WIDTHS, ...BEETLE_BAND }
  const rock = createObstacle({ id: 0, z: 0, offsetX: 0, halfWidths: BEETLE_HALF_WIDTHS, kind: 'low' })
  const edge = BEETLE_HALF_WIDTHS + PLAYER_HALF_WIDTHS

  assert.equal(hits(body(edge * 0.99), bug), hits(body(edge * 0.99), rock))
  assert.equal(hits(body(edge * 1.01), bug), false)
  // And the band is what separates them, not the name: a snail whose feet are above a bug misses it
  // while the same snail at the same height is still inside a `blocking` barrier.
  assert.ok(!hits(body(0, JUMP_APEX), bug))
  assert.ok(hits(body(0, JUMP_APEX), createObstacle({ id: 1, z: 0, offsetX: 0, halfWidths: 0.2, kind: 'blocking' })))
})

console.log(`\n${passed} checks passed`)
