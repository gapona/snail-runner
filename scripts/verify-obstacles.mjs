#!/usr/bin/env node
// Logic check for src/run/obstacles.ts -- the three classes, the one collision rule, and the
// proof that a generated stretch of road can actually be got through. Plain assertions, no
// framework, via the register-ts-loader.mjs + ts-extensionless-loader.mjs Node-native-TS setup.
//
// **Three claims, in the order they matter.**
//
// 1. *One rule.* A hit is two interval overlaps -- across the road and up the body -- and nothing
//    anywhere branches on what kind of obstacle it is. The three classes fall out of the numbers.
// 2. *A layout is passable, and that is proved rather than hoped.* The placer searches for a line
//    through every stretch it generates and throws the stretch away if there is not one. A runner
//    that occasionally deals an impossible hand is a runner nobody trusts.
// 3. *Everything is readable for at least `REACTION_MS` before it arrives, at `SPEED_CAP`.* The
//    jump window is wide (verify:jump measures 441ms); the thing that is actually scarce is time
//    to *see* the obstacle. If this floor ever fails, the difficulty curve is what moves, never
//    the floor -- see `REACTION_MS`'s own docstring.
import assert from 'node:assert/strict'
import {
  createObstacle,
  hits,
  obstacleRows,
  passableLine,
  placeObstacles,
  provePassable,
} from '../src/run/obstacles.ts'
import {
  JUMP_APEX,
  OBSTACLE_BANDS,
  OBSTACLE_DEPTH,
  PLAYER_BODY_H,
  PLAYER_HALF_WIDTHS,
  REACTION_MS,
  ROAD_EDGE,
  SPEED_CAP,
} from '../src/run/constants.ts'
import { CAMERA_DEPTH, SEGMENT_LENGTH } from '../src/road/constants.ts'
import { createRng } from '../src/race/rng.ts'

let passed = 0
function check(name, fn) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

const GROUNDED = { offsetX: 0, y: 0 }
const AT_APEX = { offsetX: 0, y: JUMP_APEX }

console.log('src/run/obstacles.ts -- one rule')

check('a hit is an overlap across the road AND up the body, with no third condition', () => {
  const rock = createObstacle({ id: 1, z: 0, offsetX: 0, halfWidths: 0.2, kind: 'low' })

  assert.equal(hits(GROUNDED, rock), true, 'a grounded snail must hit a rock in its lane')
  assert.equal(hits(AT_APEX, rock), false, 'a jumping snail must clear it')
  // Same obstacle, moved out of the lane: no hit at any height.
  const aside = createObstacle({ id: 2, z: 0, offsetX: 0.7, halfWidths: 0.2, kind: 'low' })

  assert.equal(hits(GROUNDED, aside), false)
  assert.equal(hits(AT_APEX, aside), false)
})

check('the lateral test accounts for both half-widths, not just the obstacle', () => {
  // Touching exactly is not a hit; overlapping by a hair is. The boundary is where the snail's
  // edge meets the obstacle's, so both widths have to be in it.
  const gap = PLAYER_HALF_WIDTHS + 0.2

  assert.equal(hits(GROUNDED, createObstacle({ id: 3, z: 0, offsetX: gap + 1e-6, halfWidths: 0.2, kind: 'low' })), false)
  assert.equal(hits(GROUNDED, createObstacle({ id: 4, z: 0, offsetX: gap - 1e-3, halfWidths: 0.2, kind: 'low' })), true)
})

check('the three classes produce exactly the expected outcomes, from the bands alone', () => {
  const table = []

  for (const kind of Object.keys(OBSTACLE_BANDS)) {
    const obstacle = createObstacle({ id: 9, z: 0, offsetX: 0, halfWidths: 0.2, kind })

    table.push([kind, hits(GROUNDED, obstacle), hits(AT_APEX, obstacle)])
  }

  assert.deepEqual(table, [
    // kind        grounded  at apex
    ['low', true, false], //   jump it
    ['blocking', true, true], //   go around it -- a jump does not help
    ['overhead', false, true], //   run under it -- a jump kills you
  ])
})

check('an obstacle carries its band rather than a flag naming its behaviour', () => {
  const branch = createObstacle({ id: 5, z: 0, offsetX: 0, halfWidths: 0.2, kind: 'overhead' })

  assert.equal(branch.yLow, OBSTACLE_BANDS.overhead.yLow)
  assert.equal(branch.yHigh, OBSTACLE_BANDS.overhead.yHigh)
  // The kind is kept for *art*, and the collision must not consult it: an obstacle with a
  // hand-written band behaves according to the band.
  const custom = { ...branch, yLow: 0, yHigh: 40 }

  assert.equal(hits(GROUNDED, custom), true)
  assert.equal(hits(AT_APEX, custom), false)
})

console.log('the passability proof')

check('passableLine finds the gap in a row that has one', () => {
  const row = [
    createObstacle({ id: 1, z: 0, offsetX: -0.7, halfWidths: 0.22, kind: 'blocking' }),
    createObstacle({ id: 2, z: 0, offsetX: 0.7, halfWidths: 0.22, kind: 'blocking' }),
  ]
  const line = passableLine(row)

  assert.notEqual(line, null, 'a row with a wide-open middle was called impassable')
  assert.equal(line.mode, 'ground')
  assert.ok(Math.abs(line.offsetX) < 0.4, `the found line at ${line.offsetX} is not in the gap`)
})

check('...and reports a row that only a jump gets through', () => {
  // A wall of low rocks: nothing to dodge into, but the whole row is under the apex.
  const row = [-0.8, -0.4, 0, 0.4, 0.8].map((offsetX, id) =>
    createObstacle({ id, z: 0, offsetX, halfWidths: 0.3, kind: 'low' }),
  )
  const line = passableLine(row)

  assert.notEqual(line, null)
  assert.equal(line.mode, 'air', 'a row of low rocks must be passable, and only in the air')
})

check('...and returns null for a row that genuinely cannot be got through', () => {
  // A wall of boulders is impassable on the ground and unjumpable. **A proof that never fails is
  // not a proof**, so this is the negative control the placer depends on.
  const row = [-0.9, -0.45, 0, 0.45, 0.9].map((offsetX, id) =>
    createObstacle({ id, z: 0, offsetX, halfWidths: 0.32, kind: 'blocking' }),
  )

  assert.equal(passableLine(row), null)
})

check('an overhead over the only ground gap is impassable, which is the trap the proof exists for', () => {
  // Boulders left and right leave a gap in the middle -- and an overhead sits in that gap. On the
  // ground you pass the overhead but hit nothing; in the air you clear nothing. This is passable,
  // and the proof has to say so: the overhead is only a hazard to a snail that jumped.
  const row = [
    createObstacle({ id: 1, z: 0, offsetX: -0.75, halfWidths: 0.22, kind: 'blocking' }),
    createObstacle({ id: 2, z: 0, offsetX: 0.75, halfWidths: 0.22, kind: 'blocking' }),
    createObstacle({ id: 3, z: 0, offsetX: 0, halfWidths: 0.3, kind: 'overhead' }),
  ]
  const line = passableLine(row)

  assert.notEqual(line, null)
  assert.equal(line.mode, 'ground', 'the way through is under the overhead, on the ground')

  // ...whereas the same row with the middle blocked at *both* heights is not. The middle boulder
  // has to be wide enough to actually meet the two flanking ones: at 0.3 half-widths it leaves a
  // 0.07-wide slot the snail fits through, and the first version of this check asserted `null` for
  // a row that was genuinely passable. The search found the slot; the test was wrong.
  const sealed = [...row, createObstacle({ id: 4, z: 0, offsetX: 0, halfWidths: 0.5, kind: 'blocking' })]

  assert.equal(passableLine(sealed), null)
})

check('a jump-only row followed too closely by an air-blocked row is rejected', () => {
  // **The constraint a per-row check cannot see.** Clearing a wall of low rocks puts the snail in
  // the air for up to eleven segments at `SPEED_CAP`, and anything inside that flight has to be
  // clearable *from the air*. An overhead placed there is a hit the player had no way to avoid,
  // and the layout is thrown away rather than shipped.
  const jumpOnly = [-0.8, -0.4, 0, 0.4, 0.8].map((offsetX, id) =>
    createObstacle({ id, z: 0, offsetX, halfWidths: 0.3, kind: 'low' }),
  )
  const overheadSoon = [createObstacle({ id: 10, z: SEGMENT_LENGTH * 3, offsetX: 0, halfWidths: 1.4, kind: 'overhead' })]
  const overheadLater = [createObstacle({ id: 11, z: SEGMENT_LENGTH * 40, offsetX: 0, halfWidths: 1.4, kind: 'overhead' })]

  assert.equal(provePassable([...jumpOnly, ...overheadSoon]), false, 'an unavoidable overhead was accepted')
  assert.equal(provePassable([...jumpOnly, ...overheadLater]), true, 'the same overhead well clear of the flight is fine')
})

check('obstacleRows groups by z and keeps them in order', () => {
  const list = [
    createObstacle({ id: 1, z: 400, offsetX: 0, halfWidths: 0.2, kind: 'low' }),
    createObstacle({ id: 2, z: 0, offsetX: 0, halfWidths: 0.2, kind: 'low' }),
    createObstacle({ id: 3, z: 400, offsetX: 0.5, halfWidths: 0.2, kind: 'low' }),
  ]
  const rows = obstacleRows(list)

  assert.equal(rows.length, 2)
  assert.equal(rows[0].z, 0)
  assert.equal(rows[1].obstacles.length, 2)
})

console.log('the placer')

check('200 generated stretches are every one of them passable', () => {
  // The claim the placer makes, checked against the proof rather than against itself: every
  // layout it hands back has a line through it, at every difficulty it can be asked for.
  const counts = { low: 0, blocking: 0, overhead: 0 }
  let total = 0

  for (let seed = 1; seed <= 200; seed++) {
    const density = 0.2 + (seed % 9) * 0.08

    const obstacles = placeObstacles({
      rng: createRng(seed),
      fromZ: 0,
      toZ: SEGMENT_LENGTH * 400,
      density,
      blockingShare: 0.15 + (seed % 5) * 0.07,
      overheadShare: 0.1 + (seed % 4) * 0.05,
    })

    assert.ok(obstacles.length > 0, `seed ${seed} at density ${density.toFixed(2)} placed nothing at all`)
    assert.ok(provePassable(obstacles), `seed ${seed} produced a stretch with no line through it`)
    for (const obstacle of obstacles) counts[obstacle.kind]++
    total += obstacles.length
  }

  console.log(
    `    200 stretches, ${total} obstacles: ${counts.low} low, ${counts.blocking} blocking, ${counts.overhead} overhead`,
  )
  assert.ok(counts.low > 0 && counts.blocking > 0 && counts.overhead > 0, 'a whole class was never placed')
})

check('the same seed places the same stretch twice', () => {
  const options = { fromZ: 0, toZ: SEGMENT_LENGTH * 200, density: 0.5, blockingShare: 0.3, overheadShare: 0.2 }
  const a = placeObstacles({ ...options, rng: createRng(4242) })
  const b = placeObstacles({ ...options, rng: createRng(4242) })

  assert.deepEqual(a, b, 'the placer is not deterministic -- a bug report cannot be reproduced')
})

check('rows are never closer together than the reaction budget allows', () => {
  const obstacles = placeObstacles({
    rng: createRng(7),
    fromZ: 0,
    toZ: SEGMENT_LENGTH * 600,
    density: 1,
    blockingShare: 0.35,
    overheadShare: 0.25,
  })
  const rows = obstacleRows(obstacles)
  const minGap = (REACTION_MS / 1000) * SPEED_CAP
  let worst = Infinity

  for (let i = 1; i < rows.length; i++) worst = Math.min(worst, rows[i].z - rows[i - 1].z)

  assert.ok(
    worst >= minGap,
    `two rows are ${(worst / SEGMENT_LENGTH).toFixed(1)} segments apart; the floor is ${(minGap / SEGMENT_LENGTH).toFixed(1)}`,
  )
  console.log(
    `    at maximum density the closest two rows are ${(worst / SEGMENT_LENGTH).toFixed(1)} segments (${((worst / SPEED_CAP) * 1000).toFixed(0)}ms at top speed)`,
  )
})

console.log('readability')

check('every class is readable for at least REACTION_MS before impact at SPEED_CAP', () => {
  // **Distance is never the binding constraint; apparent size is.** The draw distance is 300
  // segments, which at top speed is 16.7 seconds of warning -- so what has to be checked is
  // whether the thing is big enough on the frame to be *seen* that far out, not whether it is
  // drawn at all. Measured through the projection itself, at the shortest viewport the game
  // supports.
  const screenHeight = 390 // a landscape phone: the least vertical resolution to read anything in
  const distance = (REACTION_MS / 1000) * SPEED_CAP
  const scale = CAMERA_DEPTH / distance
  const MIN_READABLE_PX = 8

  for (const [kind, band] of Object.entries(OBSTACLE_BANDS)) {
    const worldHeight = band.yHigh - band.yLow
    const pixels = (scale * worldHeight * screenHeight) / 2

    assert.ok(
      pixels >= MIN_READABLE_PX,
      `a ${kind} is ${pixels.toFixed(1)}px tall ${REACTION_MS}ms before impact -- under the ${MIN_READABLE_PX}px floor`,
    )
    console.log(`    ${kind.padEnd(9)} ${pixels.toFixed(0)}px tall at ${(distance / SEGMENT_LENGTH).toFixed(1)} segments out`)
  }
})

check('an obstacle is one segment deep, so crossing it is an instant rather than a state', () => {
  const crossingMs = (OBSTACLE_DEPTH / SPEED_CAP) * 1000

  assert.equal(OBSTACLE_DEPTH, SEGMENT_LENGTH)
  assert.ok(crossingMs < 100, `crossing takes ${crossingMs.toFixed(0)}ms — long enough to need contact resolution`)
  console.log(`    ${crossingMs.toFixed(0)}ms to cross at top speed`)
})

check('nothing is ever placed where the snail cannot reach it or avoid it', () => {
  const obstacles = placeObstacles({
    rng: createRng(99),
    fromZ: 0,
    toZ: SEGMENT_LENGTH * 300,
    density: 0.7,
    blockingShare: 0.3,
    overheadShare: 0.2,
  })

  for (const obstacle of obstacles) {
    assert.ok(
      Math.abs(obstacle.offsetX) - obstacle.halfWidths <= ROAD_EDGE + 1e-9,
      `an obstacle at ${obstacle.offsetX} is entirely off the road — invisible, and free`,
    )
    assert.ok(obstacle.yHigh > obstacle.yLow, 'an obstacle with no height')
    assert.ok(obstacle.yLow < PLAYER_BODY_H + JUMP_APEX, 'an obstacle above anything the snail can reach')
  }
})

console.log(`${passed} checks passed`)
