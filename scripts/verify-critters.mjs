#!/usr/bin/env node
// Logic check for src/run/critters.ts -- the bugs that run at you. Plain assertions, no framework,
// via the register-ts-loader.mjs + ts-extensionless-loader.mjs Node-native-TS setup.
//
// **Three things are worth a suite here and the third is the reason the module exists.** That they
// run in a straight line, which is a fairness claim and is asserted structurally rather than by
// watching a number move. That the sweep cannot be stepped over, because a bug and the player close
// at up to 6340 units a second against a 200-unit crossing and a dropped frame covers the whole of
// it. And that a critter can never make a stretch of road impassable -- which is not a hope about
// the placer but an arithmetic consequence of one constant, `GROUND_MAX_BAND.yHigh < JUMP_APEX`, and
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
  GROUND_MAX_BAND,
  CRITTER_DEPTH,
  CRITTER_DESPAWN_BEHIND_Z,
  CRITTER_FIRST_Z,
  CRITTER_GAP_Z,
  GROUND_MAX_HALF_WIDTHS,
  CRITTER_JUMP_WINDOW,
  GROUND_MAX_OFFSET,
  GROUND_ROAD_SHARE,
  CRITTER_SPAWN_AHEAD_Z,
  CRITTER_BASE_SPEED,
  GROUND_MAX_WIDTH,
  MAX_CRITTERS,
  CRITTER_AIR_POSES,
  CRITTER_WINGS,
  CRITTER_GROUND_ANCHOR,
  tuckOffset,
} from '../src/run/critters.ts'
import {
  CRITTER_AIR_KINDS,
  CRITTER_CANVAS,
  CRITTER_WING_KINDS,
  CRITTER_FRAMES,
  CRITTER_STEP_UNITS,
  createCritterTextures,
} from '../src/run/critterArt.ts'
import { CROUCH_MS, HOP_CYCLE_MS, HOP_FLIGHT_MS, hopPose } from '../src/run/critterJump.ts'
import { VAULT_CLEARANCE, signedGap, vaultPose, vaultTarget } from '../src/run/critterVault.ts'
import { rotatedSpan, wingAngle, WING_BEATS_PER_SECOND } from '../src/run/critterWings.ts'
import { shadowClipFade } from '../src/run/shadows.ts'
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
function lone(z, kind = CRITTER_KIND_IDS[0]) {
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


// ── ⚠ The flying half of the bestiary is temporarily absent, and its rules are NOT ─────────────
//
// Five of the six kinds were removed: they were 3D renders and five had no contour at all, so
// bringing them to the frog's line would have been a restyle rather than a normalisation. Wasps,
// bees and mosquitoes are coming back as drawings.
//
// A check that merely iterates `FLYING()` therefore passes by having nothing to iterate, which is
// the worst outcome available: the safety argument for a kind that punishes jumping would be
// silently unguarded on the day one lands. So every flying rule below is held against a STAND-IN
// built from the constants a returning flyer will actually use -- `BEE_BAND`, `BEE_ROAD_SHARE`,
// `BEE_SPEED` -- and `hits` is the game's own, so this is a spec under test rather than a
// reimplementation of one.
const RETURNING_FLYER = {
  offsetX: 0,
  halfWidths: ROAD_EDGE * BEE_ROAD_SHARE - PLAYER_HALF_WIDTHS,
  ...BEE_BAND,
}

/** `clearedAt`'s own arithmetic, against a spec instead of a kind in the table. */
const clearedBySpec = (y, spec) => !hits({ offsetX: 0, y }, spec)

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
      `    ${name.padEnd(11)} closing ${(speed + CRITTER_BASE_SPEED).toFixed(0)} u/s, ` +
        `${(warning / 1000).toFixed(1)}s of warning (floor ${REACTION_MS}ms)`,
    )
  }

  // **The control**: the same measure over a bug born one segment out rejects it, so the check is
  // shown to be measuring the spawn distance rather than a property of the arithmetic.
  const near = (SEGMENT_LENGTH / (MAX_ATTAINABLE_SPEED + CRITTER_BASE_SPEED)) * 1000

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
  assert.ok(Math.abs(GROUND_MAX_HEIGHT - JUMP_APEX * (1 - CRITTER_JUMP_WINDOW ** 2)) < 1e-9)
  assert.ok(
    Math.abs(GROUND_MAX_HALF_WIDTHS + PLAYER_HALF_WIDTHS - ROAD_EDGE * GROUND_ROAD_SHARE) < 1e-9,
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
    `    ${(measured * 100).toFixed(0)}% of a ${(airborne * DT).toFixed(0)}ms flight is above ${GROUND_MAX_HEIGHT.toFixed(0)} ` +
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
  const lanes = Array.from({ length: 21 }, (_, i) => -GROUND_MAX_OFFSET + (2 * GROUND_MAX_OFFSET * i) / 20)
  const offsets = Array.from({ length: 161 }, (_, i) => -ROAD_EDGE + (2 * ROAD_EDGE * i) / 160)
  let combinations = 0
  let groundLost = 0

  for (const row of rows) {
    for (const lane of lanes) {
      const bug = boxOf(CRITTER_KIND_IDS[0], lane)
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
  // `GROUND_MAX_HALF_WIDTHS` is checked against the thing that actually decides a collision.
  // **⚠ Asserted as a BOUND over every ground kind, not as an equality on one.** It used to compare
  // the widest kind against `GROUND_ROAD_SHARE` exactly -- which was right while the beetle existed,
  // because the beetle WAS that bound. With the beetle gone the same check failed at 33.3% against
  // 60% on a frog that is perfectly legal: it was asserting that some kind is the maximum rather
  // than that none exceeds it. The bound is the rule; being at it is not.
  const offsets = Array.from({ length: 4001 }, (_, i) => -ROAD_EDGE + (2 * ROAD_EDGE * i) / 4000)
  const shares = GROUND().map((kind) => {
    const bug = boxOf(kind)

    return [kind, offsets.filter((offsetX) => hits(body(offsetX), bug)).length / offsets.length]
  })
  const blocked = Math.max(...shares.map(([, v]) => v))

  for (const [kind, share] of shares) {
    assert.ok(
      share <= GROUND_ROAD_SHARE + 0.01,
      `a ${kind} blocks ${(share * 100).toFixed(1)}% of the road, past the ${(GROUND_ROAD_SHARE * 100).toFixed(0)}% a ground kind may take`,
    )
  }
  console.log(`    ${shares.map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`).join(', ')}`)
  // **⚠ This ceiling is a DESIGN one, not a safety one, and the earlier version of this check had it
  // wrong.** It asserted a half on the reasoning that past a half a bug could close the road — which
  // is false: the jump answers a bug at any width, because the band never reaches the apex, and a
  // row that forces a lateral gap is met on the ground where the bug is dodged instead. What a wider
  // bug costs is *choice*, measured by the check above as the share of encounters where the ground
  // line survives. What it may not reach is 1, where a bug stops being a hazard to dodge and becomes
  // a wall to jump on a timer.
  assert.ok(GROUND_ROAD_SHARE < 1, `a bug claims ${(GROUND_ROAD_SHARE * 100).toFixed(0)}% of the road — it is a wall`)
  console.log(
    `    the ceiling is ${GROUND_MAX_WIDTH.toFixed(0)} units wide; the widest kind shipped blocks ` +
      `${(blocked * 100).toFixed(0)}% of the drivable road once the snail's own width is added — and it ` +
      `can never run near the verge, so road is left on both sides`,
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
    const closes = ((MAX_ATTAINABLE_SPEED + CRITTER_BASE_SPEED) * dt) / 1000
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

// ── they go over what is in front of them, and it is drawing only ──────────────────────────────

const VAULT_TRACK = 1434 * SEGMENT_LENGTH

/** Walks one creature past one obstacle and reports what the DRAWN base did. */
function driveVault(kind, obstacle, offsetX = obstacle.offsetX) {
  const spec = CRITTER_KINDS[kind]
  const body = {
    trackZ: 0,
    offsetX,
    halfWidths: spec.halfWidths,
    yLow: spec.band.yLow,
    yHigh: spec.band.yHigh,
    speed: spec.speed,
  }
  const samples = []
  // A whole approach and departure, a frame at a time at 60Hz.
  for (let frame = 0; frame < 400; frame++) {
    const trackZ = obstacle.z + 4 * SEGMENT_LENGTH - (spec.speed / 60) * frame
    const posed = vaultPose({ ...body, trackZ }, [obstacle], VAULT_TRACK)
    samples.push({
      gap: signedGap(trackZ, obstacle.z + SEGMENT_LENGTH / 2, VAULT_TRACK),
      base: spec.band.yLow + (posed ? posed.y : 0),
      airborne: posed ? posed.airborne : false,
    })
  }
  return samples
}

check('a bug goes OVER what stands in its lane rather than through it', () => {
  const barrier = createObstacle({ id: 1, z: 6 * SEGMENT_LENGTH, offsetX: 0, halfWidths: 0.2, kind: 'blocking' })
  const rows = []

  for (const kind of CRITTER_KIND_IDS) {
    const spec = CRITTER_KINDS[kind]
    const samples = driveVault(kind, barrier)
    // What matters is the frame it is actually over the thing: the drawn base has to be above its
    // top, which is the whole of "it does not go through it".
    const crossing = samples.reduce((best, s) => (Math.abs(s.gap) < Math.abs(best.gap) ? s : best))
    const clearance = crossing.base - barrier.yHigh
    const apex = Math.max(...samples.map((s) => s.base))

    rows.push(
      `    ${kind.padEnd(9)} base ${crossing.base.toFixed(0).padStart(4)} over a top of ` +
        `${barrier.yHigh} — clears by ${clearance.toFixed(0).padStart(3)}u, apex ${apex.toFixed(0)}`,
    )
    assert.ok(
      clearance > 0,
      `${kind} is drawn at ${crossing.base.toFixed(0)} while crossing a barrier ${barrier.yHigh} tall`,
    )
    // The daylight is the constant's, not a coincidence of the arithmetic.
    assert.ok(
      clearance >= VAULT_CLEARANCE * (spec.band.yHigh - spec.band.yLow) * 0.9,
      `${kind} grazes the barrier: ${clearance.toFixed(0)}u of daylight`,
    )
  }

  console.log(rows.join('\n'))
})

check('nothing vaults an obstacle in another lane, or one it already passes over', () => {
  const barrier = createObstacle({ id: 1, z: 6 * SEGMENT_LENGTH, offsetX: 0, halfWidths: 0.2, kind: 'blocking' })
  const low = createObstacle({ id: 2, z: 6 * SEGMENT_LENGTH, offsetX: 0, halfWidths: 0.2, kind: 'low' })

  // Two roads apart: the lanes cannot overlap at any width in the table.
  for (const kind of CRITTER_KIND_IDS) {
    const wide = driveVault(kind, barrier, barrier.offsetX + 2)
    assert.ok(
      wide.every((s) => s.base === CRITTER_KINDS[kind].band.yLow),
      `${kind} vaulted an obstacle it was never going to meet`,
    )
  }

  // A flyer's band starts above every `low` block in the game, so it has nothing to clear.
  for (const kind of CRITTER_KIND_IDS.filter((k) => CRITTER_KINDS[k].flying)) {
    const over = driveVault(kind, low)
    assert.ok(
      over.every((s) => s.base === CRITTER_KINDS[kind].band.yLow),
      `${kind} climbed over a ${low.yHigh}-unit block its band already clears`,
    )
  }

  const ground = CRITTER_KIND_IDS.filter((k) => !CRITTER_KINDS[k].flying)
  console.log(
    `    ${ground.length} ground kind(s) clear a low block, ` +
      `${CRITTER_KIND_IDS.length - ground.length} flyers are already above it`,
  )
})

check('a vault changes what the creature LOOKS like and never what it can do', () => {
  const barrier = createObstacle({ id: 1, z: 6 * SEGMENT_LENGTH, offsetX: 0, halfWidths: 0.2, kind: 'blocking' })
  const spec = CRITTER_KINDS[CRITTER_KIND_IDS[0]]
  const samples = driveVault(CRITTER_KIND_IDS[0], barrier)
  const airborne = samples.filter((s) => s.airborne).length

  assert.ok(airborne > 0, 'the drive never left the ground, so the check measures nothing')

  // The band a bug is hit in comes from the table and nothing in the vault reaches it: the whole
  // arc is a `y` handed to the projection, exactly as the hop's is.
  const field = createCritterField(1)
  const critter = {
    id: 1,
    kind: CRITTER_KIND_IDS[0],
    z: 0,
    offsetX: 0,
    halfWidths: spec.halfWidths,
    yLow: spec.band.yLow,
    yHigh: spec.band.yHigh,
    bornZ: 0,
    resolved: false,
  }
  const before = [critter.yLow, critter.yHigh]
  driveVault(CRITTER_KIND_IDS[0], barrier)
  assert.deepEqual([critter.yLow, critter.yHigh], before, 'the vault moved a collision band')
  console.log(
    `    airborne on ${airborne} of ${samples.length} frames, band still [${critter.yLow}, ${critter.yHigh}]`,
  )
})

check('the arc is solved from the obstacle, so a taller one is cleared by a higher hop', () => {
  const kind = CRITTER_KIND_IDS[0]
  const low = createObstacle({ id: 1, z: 6 * SEGMENT_LENGTH, offsetX: 0, halfWidths: 0.2, kind: 'low' })
  const tall = createObstacle({ id: 2, z: 6 * SEGMENT_LENGTH, offsetX: 0, halfWidths: 0.2, kind: 'blocking' })
  const apexOf = (o) => Math.max(...driveVault(kind, o).map((s) => s.base))
  const lowApex = apexOf(low)
  const tallApex = apexOf(tall)

  assert.ok(
    tallApex > lowApex,
    `a ${tall.yHigh}-unit panel drew a lower hop (${tallApex.toFixed(0)}) than a ${low.yHigh}-unit block (${lowApex.toFixed(0)})`,
  )
  // Nothing in the module names a kind or a band: the height is the obstacle's.
  const target = vaultTarget(
    {
      trackZ: tall.z + 2 * SEGMENT_LENGTH,
      offsetX: 0,
      halfWidths: CRITTER_KINDS[kind].halfWidths,
      yLow: CRITTER_KINDS[kind].band.yLow,
      yHigh: CRITTER_KINDS[kind].band.yHigh,
      speed: CRITTER_KINDS[kind].speed,
    },
    [tall],
    VAULT_TRACK,
  )
  assert.equal(target?.top, tall.yHigh, 'the vault aimed at something other than the obstacle top')
  console.log(
    `    ${kind}: ${low.yHigh}u block -> apex ${lowApex.toFixed(0)}, ` +
      `${tall.yHigh}u panel -> apex ${tallApex.toFixed(0)}`,
  )
})

check('a wing is hidden by the hill its own blade is behind, not by where it is pinned', () => {
  // ⚠ Reported three times as seeing the wings through the textures. The body is CROPPED against
  // `clipY` and a rotated wing cannot be -- a crop is applied in the frame's own pixels, before the
  // rotation -- so it fades instead. The first version faded on the HINGE, which is the one point
  // of a wing that is never the part behind the hill: the blade sweeps well below it, so a flyer
  // whose body had been cropped to a sliver still drew both wings at full alpha.
  const rows = []

  for (const kind of CRITTER_KIND_IDS) {
    const wings = CRITTER_WINGS[kind]

    if (!wings) continue

    // One readable flyer: a 200px assembled box, which is what one looks like a few segments out.
    const boxHeight = 200
    const bodyHeight = boxHeight * wings.bodyHeight
    const bodyWidth = bodyHeight * wings.bodyAspect
    const w = bodyWidth * wings.wingOverBody
    const h = w / wings.wingAspect
    const bodyTop = 0
    const bodyBase = bodyTop + bodyHeight
    const hingeY = bodyTop + wings.hingeInBody[1] * bodyHeight
    const angle = wingAngle(kind, 0, wings.restDeg, 0)
    const span = rotatedSpan(w, h, wings.pivot[0], wings.pivot[1], angle)
    const blade = hingeY + span.bottom

    // The hill exactly at the hinge: everything the blade reaches below it is behind the ridge,
    // and that is precisely the case the hinge-only form cannot see.
    const fade = shadowClipFade(blade, span.height * 2, hingeY)
    const hingeOnly = shadowClipFade(hingeY, h, hingeY)

    rows.push(
      `    ${kind.padEnd(9)} blade reaches ${(blade - hingeY).toFixed(0)}px below the hinge ` +
        `(body ${bodyHeight.toFixed(0)}px) -- alpha ${fade.toFixed(2)} against ${hingeOnly.toFixed(2)} on the hinge alone`,
    )
    assert.ok(
      span.bottom > 0,
      `${kind}'s wing is drawn entirely above its own hinge, so this check measures nothing`,
    )
    assert.ok(fade < 1, `${kind}'s wing draws solid with its blade behind the ridge`)
    // A line at the top of its span hides it outright.
    assert.equal(
      shadowClipFade(blade, span.height * 2, blade - span.height),
      0,
      `${kind}'s wing still draws with its whole span behind the hill`,
    )
    // The control: the shipped-before form is shown to miss exactly this case.
    assert.equal(hingeOnly, 1, `${kind}'s hinge-only fade no longer misses the blade -- the control has gone stale`)
  }

  console.log(rows.join('\n'))
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

check('a wing is drawn to its own box, and a flyer reads as go-around rather than jump', () => {
  for (const kind of CRITTER_WING_KINDS) {
    const spec = CRITTER_KINDS[kind]
    const wings = CRITTER_WINGS[kind]

    assert.ok(wings, `${kind} ships a wing and has no geometry for it`)
    assert.ok(spec.flying, `${kind} has wings and does not fly`)

    const png = readFileSync(`public/assets/critter/critter-${kind}-wing.png`)
    const aspect = png.readUInt32BE(16) / png.readUInt32BE(20)
    // The wing is drawn at its own proportion, never stretched onto a box -- so the target is
    // simply the number the normalizer measured off the delivered sprite.
    const target = wings.wingAspect

    assert.ok(
      Math.abs(aspect / target - 1) < 0.02,
      `${kind}'s wing is ${aspect.toFixed(3)}:1 against a box of ${target.toFixed(3)}:1`,
    )

    // **The band says "go around" and the silhouette has to say it too.** A flyer that is taller
    // than it is wide reads as something to duck under or hop over, and neither is available: its
    // band starts over a standing snail and reaches past the top of a jump.
    const boxAspect = (spec.halfWidths * 2 * ROAD_WIDTH) / (spec.band.yHigh - spec.band.yLow)

    assert.ok(boxAspect > 1.5, `a ${kind} is ${boxAspect.toFixed(2)}:1 -- not wide enough to read as go-around`)
    console.log(
      `    ${kind.padEnd(9)} ${(spec.halfWidths * 2 * ROAD_WIDTH).toFixed(0)}x${(spec.band.yHigh - spec.band.yLow).toFixed(0)} ` +
        `(${boxAspect.toFixed(2)}:1), wing ${aspect.toFixed(2)}:1, ${WING_BEATS_PER_SECOND[kind]} beats/s`,
    )
  }
})

check('a tucked pose is drawn to its OWN box, so one kind cannot stretch itself', () => {
  // A second pose is a second aspect. Reusing the ground pose's box for it would stretch a 1.33:1
  // drawing onto a 1.94:1 frame -- the `obstacle-low-0` distortion arriving from inside one kind
  // rather than from a kit.
  for (const kind of CRITTER_AIR_KINDS) {
    const air = CRITTER_AIR_POSES[kind]

    assert.ok(air, `${kind} is listed as having an air pose and has no box for it`)

    const png = readFileSync(`public/assets/critter/critter-${kind}-air.png`)
    const aspect = png.readUInt32BE(16) / png.readUInt32BE(20)
    const target = air.width / air.height

    assert.ok(
      Math.abs(aspect / target - 1) < 0.02,
      `critter-${kind}-air.png is ${aspect.toFixed(3)}:1 against a box of ${target.toFixed(3)}:1`,
    )
    console.log(`    ${kind} air ${aspect.toFixed(3)}:1 against ${target.toFixed(3)}:1`)
  }
})

check('the pose swap is continuous: both poses put the creature in the same place', () => {
  // **⚠ This is the acceptance for the swap, and it is the one a screenshot cannot give.** If the
  // two poses are anchored on different points the creature jumps at the instant of the swap, and
  // at 60Hz that reads as a click rather than as an animation.
  //
  // The measure is the DISCONTINUITY, not the frame-to-frame step. The first version compared the
  // step across the swap against the median step elsewhere and failed at 8.14 against 6.19 -- which
  // was measuring the sampling rather than the animation: at 60Hz the crossing falls between two
  // samples, so that one frame carries a little more ordinary motion than typical. What matters is
  // whether the two poses, evaluated at the SAME instant, put the anchor in the same place.
  for (const kind of CRITTER_AIR_KINDS) {
    const spec = CRITTER_KINDS[kind]
    const air = CRITTER_AIR_POSES[kind]
    const groundAnchor = CRITTER_GROUND_ANCHOR[kind]
    const offset = tuckOffset(kind)
    const groundHeight = spec.band.yHigh - spec.band.yLow

    const at = (ms) => hopPose((ms / 1000) * spec.speed, spec.speed, 0, offset)
    const anchorAs = (p, tucked) => {
      const base = p.y - (tucked ? offset * p.scaleY : 0)
      const height = (tucked ? air.height : groundHeight) * p.scaleY

      return base + (tucked ? air.anchorFromBottom : groundAnchor) * height
    }

    // Walk finely enough to land on the crossing, then read both poses there.
    let crossing = -1

    for (let ms = 0; ms < HOP_CYCLE_MS; ms += 0.25) {
      if (at(ms).tucked) {
        crossing = ms
        break
      }
    }
    assert.ok(crossing >= 0, `${kind} never reached its tucked pose`)

    const p = at(crossing)
    const jump = Math.abs(anchorAs(p, true) - anchorAs(p, false))

    assert.ok(
      jump < 1,
      `${kind}'s pose swap moves the anchor ${jump.toFixed(3)} world units -- the two poses are ` +
        `anchored on different points`,
    )

    // And it is never drawn under the road: the tucked drawing's feet hang below its body, so the
    // swap waits until the hop has lifted the creature by exactly the offset that puts its base on
    // the ground. Below zero here is feet through the asphalt.
    let lowest = 0
    let tuckedSamples = 0

    for (let ms = 0; ms < HOP_CYCLE_MS; ms += 0.25) {
      const q = at(ms)
      const base = q.y - (q.tucked ? offset * q.scaleY : 0)

      lowest = Math.min(lowest, base)
      if (q.tucked) tuckedSamples++
    }
    assert.ok(lowest >= -0.001, `${kind} is drawn ${(-lowest).toFixed(2)} units under the road`)

    const share = (tuckedSamples * 0.25) / HOP_CYCLE_MS

    // It has to be worth having: a tuck that covered a couple of frames would be a flicker.
    assert.ok(share > 0.15, `${kind} is tucked for only ${(share * 100).toFixed(0)}% of its hop`)
    console.log(
      `    ${kind}: swap moves the anchor ${jump.toFixed(3)}u, lowest base ${lowest.toFixed(2)}u, ` +
        `tucked ${(share * 100).toFixed(0)}% of the hop`,
    )
  }
})

check('the landing is the punchiest moment of a hop, and not by a multiple', () => {
  // **⚠ The landing used to be a snap, and the cause was that it had no RISE.** The flight ends
  // fully stretched and the landing began at full compression with nothing between -- a change of
  // 0.50 in the vertical scale in zero time, which moved the creature's centre of mass 74 units in
  // one 60Hz frame against a flight that never moves it more than 17. Reported as too sharp.
  //
  // The measure is a RATIO rather than a limit in units, because the honest question is not "is the
  // landing a large movement" -- it should be the largest -- but "is it out of scale with the
  // animation it belongs to". Both ends are asserted: under 1 the landing has stopped being the
  // hardest moment of the hop, which is a different defect from the one being fixed.
  const spec = CRITTER_KINDS.frog
  const groundAnchor = CRITTER_GROUND_ANCHOR.frog
  const height = spec.band.yHigh - spec.band.yLow
  const step = 1000 / 60

  const anchorAt = (ms) => {
    const p = hopPose((ms / 1000) * spec.speed, spec.speed)

    return p.y + groundAnchor * height * p.scaleY
  }

  const flight = []
  const landing = []
  const launch = []

  for (let ms = 0; ms + step < HOP_CYCLE_MS; ms += step) {
    const moved = Math.abs(anchorAt(ms + step) - anchorAt(ms))
    const from = ms
    const to = ms + step
    const flightEnd = CROUCH_MS + HOP_FLIGHT_MS

    if (from >= CROUCH_MS && to <= flightEnd) flight.push(moved)
    else if (from < CROUCH_MS && to >= CROUCH_MS) launch.push(moved)
    else if (to > flightEnd) landing.push(moved)
  }

  const flightMax = Math.max(...flight)
  const landMax = Math.max(...landing)
  const ratio = landMax / flightMax

  assert.ok(ratio >= 1, `the landing moves ${landMax.toFixed(1)}u against a flight that moves ` +
    `${flightMax.toFixed(1)}u -- there is no impact left in it`)
  assert.ok(ratio <= 2, `the landing moves ${ratio.toFixed(2)}x what the flight does, which is a ` +
    `snap rather than an impact`)

  // The LAUNCH is deliberately left as a snap and is printed rather than asserted: a frog's
  // extension really is explosive, and one frame is what it takes. It is stated here so the number
  // is visible next to the landing's rather than discovered later.
  console.log(
    `    flight ${flightMax.toFixed(1)}u/frame, landing ${landMax.toFixed(1)}u (${ratio.toFixed(2)}x), ` +
      `launch ${Math.max(...launch).toFixed(1)}u (deliberate)`,
  )
})

check('a hop changes what the creature LOOKS like and never what it can do', () => {
  // The band is what `hits` reads, and it is `CRITTER_KINDS`'. Nothing in the hop reaches it --
  // asserted structurally, because a hitbox that rose with the animation would move while the
  // player is committing to a lane, and no amount of watching it would reveal that.
  for (const kind of CRITTER_AIR_KINDS) {
    const before = JSON.stringify(CRITTER_KINDS[kind].band)

    for (let ms = 0; ms < HOP_CYCLE_MS; ms += 7) {
      hopPose((ms / 1000) * CRITTER_KINDS[kind].speed, CRITTER_KINDS[kind].speed, 0, tuckOffset(kind))
    }
    assert.equal(JSON.stringify(CRITTER_KINDS[kind].band), before, `${kind}'s band moved with its hop`)
  }
  console.log('    the collision band is untouched across a whole hop cycle')
})

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
    const wings = CRITTER_WINGS[kind]
    const boxW = spec.halfWidths * 2 * ROAD_WIDTH
    const boxH = spec.band.yHigh - spec.band.yLow
    // ⚠ A flyer's world box is its ASSEMBLED span, so the BODY sprite is held to the body's own
    // share of it, not to the whole thing. Compared against the whole box the bee reads 0.583:1
    // against 2.044:1 -- a correct sprite failed for being measured against the wings as well.
    const target = wings ? wings.bodyAspect : boxW / boxH

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

  // ⚠ ASPECT NO LONGER SEPARATES THE SET, AND THAT IS A FINDING RATHER THAN A FAILURE.
  //
  // The rule was written when there were two kinds -- a 4.7:1 beetle against a 2.3:1 bee -- and it
  // read "type reads by aspect before it reads by contour, so the kind a jump answers and the kind
  // a jump runs into may not be one silhouette at two sizes". With four kinds boxed on their own
  // art the aspects are frog 1.94, mosquito 1.84, bee 2.04, hornet 2.22: a spread of 1.21x, and the
  // frog sits BETWEEN two flyers.
  //
  // Asserting 1.5x here would demand that the drawings be redrawn to fit a proxy. What the rule is
  // actually about is whether two creatures can be told apart at the size they are met, and that is
  // measured directly -- rasterised at 32px and scored on shared silhouette -- by
  // `scripts/silhouette-sheet.py`. This prints the aspects so the proxy stays visible and asserts
  // only the part that is still true of it: no two kinds are the SAME proportion.
  const sorted = [...aspects].sort((a, b) => a - b)
  const closest = Math.min(...sorted.slice(1).map((v, i) => v / sorted[i]))

  assert.ok(closest > 1.02, `two kinds are within ${((closest - 1) * 100).toFixed(1)}% on aspect`)
  console.log(
    `    aspects ${CRITTER_KIND_IDS.map((k, i) => `${k} ${aspects[i].toFixed(2)}`).join(', ')} ` +
      `— spread ${(Math.max(...aspects) / Math.min(...aspects)).toFixed(2)}x, so aspect alone does ` +
      `not separate them; see scripts/silhouette-sheet.py`,
  )
})

check('the gait is two poses and it advances with the bug, not with a clock', () => {
  assert.equal(CRITTER_FRAMES, 2, 'an alternating tripod has exactly two poses')

  const rates = GROUND().map((kind) => [kind, CRITTER_KINDS[kind].speed / CRITTER_STEP_UNITS[kind]])

  for (const [kind, rate] of rates) {
    assert.ok(
      rate > 4 && rate < 16,
      `a ${kind} steps ${rate.toFixed(1)} times a second, which reads as ${rate < 4 ? 'trudging' : 'a blur'}`,
    )
  }
  // **A wingbeat the eye can count is a bird**, so a flyer's is deliberately past what any frame
  // rate resolves — the opposite requirement to a gait. This assertion replaced one that held the
  // flying set EMPTY, so that the day a flyer returned the suite would fail and say the rule was
  // live and untested. It did exactly that.
  for (const kind of FLYING()) {
    const beats = WING_BEATS_PER_SECOND[kind]

    assert.ok(beats, `${kind} flies and has no wingbeat rate`)
    assert.ok(beats > 30, `a ${kind} beats its wings ${beats} times a second, which is countable`)
  }

  // The three flyers differ in danger, and the beat is one of the two cues that says so at a
  // distance. The ordering is asserted rather than left to three numbers that look plausible.
  const byBeat = FLYING().slice().sort((a, b) => CRITTER_KINDS[a].speed - CRITTER_KINDS[b].speed)
  const beatOrder = byBeat.map((k) => WING_BEATS_PER_SECOND[k])

  for (let i = 1; i < beatOrder.length; i++) {
    assert.ok(
      beatOrder[i] > beatOrder[i - 1],
      `${byBeat[i]} is faster than ${byBeat[i - 1]} and does not beat its wings faster`,
    )
  }
  console.log(
    `    ${rates.map(([k, r]) => `${k} ${r.toFixed(1)} steps/s`).join(', ')}; ` +
      `wings ${byBeat.map((k) => `${k} ${WING_BEATS_PER_SECOND[k]}/s`).join(' < ')}`,
  )
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
  for (const spec of [RETURNING_FLYER, ...FLYING().map((k) => ({ offsetX: 0, halfWidths: CRITTER_KINDS[k].halfWidths, ...CRITTER_KINDS[k].band }))]) {
    assert.ok(
      spec.yLow > PLAYER_BODY_H,
      `a flyer starts at ${spec.yLow.toFixed(0)} against a standing snail of ${PLAYER_BODY_H}`,
    )
    assert.ok(clearedBySpec(0, spec), 'a flyer hits a snail standing on the road')
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
    if (!clearedBySpec(player.y, RETURNING_FLYER)) caught++
  }

  const share = caught / airborne

  assert.ok(!clearedBySpec(JUMP_APEX, RETURNING_FLYER), 'a flyer misses a snail at the top of its own jump')
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
  assert.ok(
    RETURNING_FLYER.halfWidths + PLAYER_HALF_WIDTHS < ROAD_EDGE,
    'a flyer spans the road, so there is no lane left in the air',
  )
  console.log(
    `    ${rows} rows, ${jumpOnly} of them jump-only, none carrying a blocking obstacle; ` +
      `the air is ${(tightest * 100).toFixed(0)}% clear at its tightest, against a returning flyer's own box`,
  )
})

check('the flyers are the faster and rarer half, and every kind still gets its warning', () => {
  const total = CRITTER_KIND_IDS.reduce((sum, k) => sum + CRITTER_KINDS[k].weight, 0)
  const flyerShare = FLYING().reduce((sum, k) => sum + CRITTER_KINDS[k].weight, 0) / total

  // ⚠ Both halves of this are about the RELATIONSHIP between two populations, so with one of them
  // empty they cannot be asserted -- and passing quietly would be the worst outcome, because what
  // they guard is the one rule that makes a flyer legible ("the thing about to cost you a jump is
  // the thing arriving fastest"). Stated out loud instead, so the state is visible in the output
  // and the assertions come back the moment a flyer does.
  if (FLYING().length === 0) {
    console.log('    ⚠ no flying kind ships: the faster-and-rarer rules are DORMANT, not satisfied')
  } else {
    const slowestFlyer = Math.min(...FLYING().map((k) => CRITTER_KINDS[k].speed))
    const fastestGround = Math.max(...GROUND().map((k) => CRITTER_KINDS[k].speed))

    // Two hazards closing at the same rate are told apart only by their pictures, and the ones about
    // to cost a jump should be the ones arriving faster.
    assert.ok(slowestFlyer > fastestGround, 'a ground kind closes faster than a flyer')
    // The kinds that punish a jump are the minority: they are the exception the player learns, and a
    // road where half of everything forbids jumping is a road where the jump is simply gone.
    assert.ok(flyerShare > 0.15 && flyerShare < 0.45, `${(flyerShare * 100).toFixed(0)}% of critters fly`)
  }

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
  const bug = { offsetX: 0, halfWidths: GROUND_MAX_HALF_WIDTHS, ...GROUND_MAX_BAND }
  const rock = createObstacle({ id: 0, z: 0, offsetX: 0, halfWidths: GROUND_MAX_HALF_WIDTHS, kind: 'low' })
  const edge = GROUND_MAX_HALF_WIDTHS + PLAYER_HALF_WIDTHS

  assert.equal(hits(body(edge * 0.99), bug), hits(body(edge * 0.99), rock))
  assert.equal(hits(body(edge * 1.01), bug), false)
  // And the band is what separates them, not the name: a snail whose feet are above a bug misses it
  // while the same snail at the same height is still inside a `blocking` barrier.
  assert.ok(!hits(body(0, JUMP_APEX), bug))
  assert.ok(hits(body(0, JUMP_APEX), createObstacle({ id: 1, z: 0, offsetX: 0, halfWidths: 0.2, kind: 'blocking' })))
})

console.log(`\n${passed} checks passed`)
