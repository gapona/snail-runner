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
  acceptRow,
  FLIGHT_LENGTH_Z,
  OBSTACLE_HALF_WIDTHS,
  OBSTACLE_POOL_SIZE,
  createObstacle,
  hits,
  MAX_ATTAINABLE_SPEED,
  MIN_ROW_GAP_Z,
  obstacleRows,
  passableLine,
  placeObstacles,
  placeRunObstacles,
  provePassable,
} from '../src/run/obstacles.ts'
import { difficultyAt, difficultyProgress, DIFFICULTY_TAU_Z } from '../src/run/difficulty.ts'
import { distanceIndexOf, WORLD_LAYER, worldDepth } from '../src/run/worldDepth.ts'
import {
  INK,
  INK_LIGHTNESS,
  lightnessOf,
  OBSTACLE_MATERIALS,
  saturationOf,
  PICKUP_COLORS,
  SNAIL_BODY,
  SNAIL_SHELL,
} from '../src/run/artPalette.ts'
import {
  BLOCKING_HEAD_CLEARANCE,
  JUMP_APEX,
  OBSTACLE_BANDS,
  OBSTACLE_DEPTH,
  PLAYER_BODY_H,
  PLAYER_HALF_WIDTHS,
  HIT_INVULNERABLE_Z,
  PLAYER_Z,
  REACTION_MS,
  ROAD_EDGE,
  SPEED_CAP,
} from '../src/run/constants.ts'
import { DRAW_DISTANCE, billboardFog, CAMERA_DEPTH, MAX_BILLBOARD_FOG, SEGMENT_LENGTH } from '../src/road/constants.ts'
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

check('the two classes produce exactly the expected outcomes, from the bands alone', () => {
  const table = []

  for (const kind of Object.keys(OBSTACLE_BANDS)) {
    const obstacle = createObstacle({ id: 9, z: 0, offsetX: 0, halfWidths: 0.2, kind })

    table.push([kind, hits(GROUNDED, obstacle), hits(AT_APEX, obstacle)])
  }

  assert.deepEqual(table, [
    // kind        grounded  at apex
    ['low', true, false], //   jump it
    ['blocking', true, true], //   go around it -- a jump does not help
  ])
})

check('an unjumpable barrier is drawn taller than the snail ever gets', () => {
  // **⚠ The frame has to agree with the collision, and at 620 it did not.** A hit is the *feet*
  // being inside the band, so `blocking` stopped a jump correctly with its top at 620 — while the
  // snail's own top at the apex is `JUMP_APEX + PLAYER_BODY_H` = 740, i.e. the picture at the top
  // of a jump showed the creature a clear 120 units above the thing that had just stopped it.
  // Reported from a phone as the tall barrier looking jumpable. See `OBSTACLE_BANDS`.
  const reach = JUMP_APEX + PLAYER_BODY_H
  const top = OBSTACLE_BANDS.blocking.yHigh

  assert.ok(top > reach, `blocking reaches ${top} against a mascot that reaches ${reach}: a jump draws clear of it`)
  // Legible rather than merely present, which is the same rule the deleted `overhead` class kept
  // its daylight under — and it is derived from the mascot, so a re-sized snail moves it.
  assert.ok(
    top - reach >= PLAYER_BODY_H * BLOCKING_HEAD_CLEARANCE - 1,
    `the barrier clears the mascot's reach by ${(top - reach).toFixed(0)}, under the stated ${(PLAYER_BODY_H * BLOCKING_HEAD_CLEARANCE).toFixed(0)}`,
  )
  // And the class is still what it was: a jump has to fail against it, which is a statement about
  // the feet and is what the shipped 620 got right.
  assert.ok(top > JUMP_APEX, 'blocking no longer stops a jump at all')
  // **The control is the height that shipped**, so this cannot pass by measuring nothing.
  assert.ok(620 < reach, 'the shipped-before height clears the mascot, i.e. this check is vacuous')
  console.log(`    blocking ${top} against a mascot reaching ${reach} (${(top / PLAYER_BODY_H).toFixed(2)} body heights, was ${(620 / PLAYER_BODY_H).toFixed(2)})`)
})

check('an obstacle carries its band rather than a flag naming its behaviour', () => {
  const branch = createObstacle({ id: 5, z: 0, offsetX: 0, halfWidths: 0.2, kind: 'blocking' })

  assert.equal(branch.yLow, OBSTACLE_BANDS.blocking.yLow)
  assert.equal(branch.yHigh, OBSTACLE_BANDS.blocking.yHigh)
  // The kind is kept for *art*, and the collision must not consult it: an obstacle with a
  // hand-written band behaves according to the band.
  const custom = { ...branch, yLow: 0, yHigh: 40 }

  assert.equal(hits(GROUNDED, custom), true)
  assert.equal(hits(AT_APEX, custom), false)
  // And the mirror: a band written above the snail is missed on the ground and met in the air,
  // whatever the kind says. This is the arithmetic the deleted `overhead` class rode on — the model
  // never needed a flag for it, which is why removing the class cost no code here.
  //
  // **⚠ It was written as the literal `[362, 560]` — the removed class's own band — and that made
  // it an accidental ceiling on the mascot.** 362 was `overhead.yLow` when the body was 261 tall;
  // grow the body past it and a *grounded* snail reaches into the fixture, so raising
  // `PLAYER_BODY_H` failed a check about flags-versus-bands for a reason that had nothing to do
  // with either. What the fixture means is "a band above the snail", so it says that.
  const above = { ...branch, yLow: PLAYER_BODY_H + 20, yHigh: PLAYER_BODY_H + 220 }

  assert.equal(hits(GROUNDED, above), false)
  assert.equal(hits(AT_APEX, above), true)
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

check('the whole layout is proved, not just each row', () => {
  const jumpOnly = [-0.8, -0.4, 0, 0.4, 0.8].map((offsetX, id) =>
    createObstacle({ id, z: 0, offsetX, halfWidths: 0.3, kind: 'low' }),
  )
  const sealed = [createObstacle({ id: 10, z: SEGMENT_LENGTH * 3, offsetX: 0, halfWidths: 1.4, kind: 'blocking' })]
  const withGap = [createObstacle({ id: 11, z: SEGMENT_LENGTH * 3, offsetX: -0.9, halfWidths: 0.3, kind: 'blocking' })]

  assert.equal(provePassable([...jumpOnly, ...sealed]), false, 'a sealed row was accepted')
  assert.equal(provePassable([...jumpOnly, ...withGap]), true, 'a row with a gap in it was rejected')
})

check('⚠ the flight proof is redundant TODAY, and this names the fact that makes it so', () => {
  // **`provePassable`'s flight loop was written for a class that no longer exists** — `overhead`,
  // whose band started above the road, so a row could be free on the ground and sealed in the air.
  // With `low` and `blocking` both reaching y=0, the offsets blocked at the apex are a SUBSET of
  // those blocked on the ground: a row with a ground line always has an air line, and the loop
  // cannot reject anything the per-row check does not.
  //
  // The loop is KEPT rather than deleted, and this check is the price of keeping it: it states the
  // property that makes it dead, so the day any band starts above the road the assertion fails and
  // whoever added that band is told the flight proof is load-bearing again.
  for (const [kind, band] of Object.entries(OBSTACLE_BANDS)) {
    assert.equal(band.yLow, 0, `${kind} starts at ${band.yLow} — the flight proof is live again, and untested`)
  }

  // Shown against the deleted class, so the property is demonstrated rather than asserted of
  // nothing: a band above the road is free on the ground and sealed in the air.
  const above = {
    ...createObstacle({ id: 1, z: 0, offsetX: 0, halfWidths: 0.3, kind: 'blocking' }),
    // Derived from the body rather than the removed class's literal 362 — see the fixture above.
    yLow: PLAYER_BODY_H + 20,
    yHigh: PLAYER_BODY_H + 220,
  }

  assert.equal(hits(GROUNDED, above), false)
  assert.equal(hits(AT_APEX, above), true)
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
  const counts = { low: 0, blocking: 0 }
  let total = 0

  for (let seed = 1; seed <= 200; seed++) {
    const density = 0.2 + (seed % 9) * 0.08

    const obstacles = placeObstacles({
      rng: createRng(seed),
      fromZ: 0,
      toZ: SEGMENT_LENGTH * 400,
      density,
      blockingShare: 0.15 + (seed % 5) * 0.07,
    })

    assert.ok(obstacles.length > 0, `seed ${seed} at density ${density.toFixed(2)} placed nothing at all`)
    assert.ok(provePassable(obstacles), `seed ${seed} produced a stretch with no line through it`)
    for (const obstacle of obstacles) counts[obstacle.kind]++
    total += obstacles.length
  }

  console.log(
    `    200 stretches, ${total} obstacles: ${counts.low} low, ${counts.blocking} blocking`,
  )
  assert.ok(counts.low > 0 && counts.blocking > 0, 'a whole class was never placed')
})

check('the same seed places the same stretch twice', () => {
  const options = { fromZ: 0, toZ: SEGMENT_LENGTH * 200, density: 0.5, blockingShare: 0.3 }
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
  })
  const rows = obstacleRows(obstacles)
  const minGap = (REACTION_MS / 1000) * MAX_ATTAINABLE_SPEED
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

check('the grace period after a hit always ends before the next row arrives', () => {
  // **⚠ This was a duration, and a duration is the wrong unit for it.** The road is laid out in
  // distance, so 900ms covered a different number of rows at every speed:
  //
  //   SPEED_BASE   6.5 segments   0.50 rows
  //   SPEED_CAP   16.2 segments   1.25 rows   <- the next row passed straight through you
  //   boosted     25.9 segments   2.00 rows   <- two of them did
  //
  // Reported as "some obstacles do not deal damage", and that is exactly what it looked like from
  // the outside. As a distance it is speed-independent by construction; this is the assertion that
  // keeps it inside the placer's own floor if either number is ever tuned.
  assert.ok(
    HIT_INVULNERABLE_Z < MIN_ROW_GAP_Z,
    `grace covers ${(HIT_INVULNERABLE_Z / MIN_ROW_GAP_Z).toFixed(2)} of a row gap — the next row would be a ghost`,
  )
  // ...and long enough to be worth having: a wall is eight rocks at one z, and the grace has to
  // outlast the rest of the row you just hit rather than charging you eight times for one mistake.
  assert.ok(HIT_INVULNERABLE_Z > OBSTACLE_DEPTH * 2, `grace of ${HIT_INVULNERABLE_Z.toFixed(0)} units barely outlasts one obstacle`)
  console.log(
    `    grace runs ${(HIT_INVULNERABLE_Z / SEGMENT_LENGTH).toFixed(1)} segments against a ${(MIN_ROW_GAP_Z / SEGMENT_LENGTH).toFixed(1)}-segment row gap ` +
      `— ${((HIT_INVULNERABLE_Z / MAX_ATTAINABLE_SPEED) * 1000).toFixed(0)}ms boosted, ${((HIT_INVULNERABLE_Z / SPEED_CAP) * 1000).toFixed(0)}ms at the plain cap`,
  )
})

console.log('readability')

check('every class is readable for at least REACTION_MS before impact, at the fastest the game goes', () => {
  // **Distance is never the binding constraint; apparent size is.** The draw distance is 300
  // segments, which even at boosted top speed is ten seconds of warning -- so what has to be
  // checked is whether the thing is big enough on the frame to be *seen* that far out, not whether
  // it is drawn at all. Measured through the projection itself, at the shortest viewport the game
  // supports, and at `MAX_ATTAINABLE_SPEED` rather than `SPEED_CAP`: a boosted player is further
  // from the obstacle when the budget starts, so this is the harder case.
  const screenHeight = 390 // a landscape phone: the least vertical resolution to read anything in
  const distance = (REACTION_MS / 1000) * MAX_ATTAINABLE_SPEED
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
  const crossingMs = (OBSTACLE_DEPTH / MAX_ATTAINABLE_SPEED) * 1000

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

console.log('the difficulty curve')

check('every knob rises with distance and saturates, and none of them is the floor', () => {
  const samples = [0, 30_000, 90_000, 180_000, 360_000, 900_000]
  let previous = difficultyAt(0)

  for (const distance of samples.slice(1)) {
    const here = difficultyAt(distance)

    assert.ok(here.density >= previous.density, 'density went down')
    assert.ok(here.blockingShare >= previous.blockingShare, 'the unjumpable share went down')
    previous = here
  }

  // Saturating, not ramping: an endless game must not have a distance past which the road stops
  // responding to the player.
  const far = difficultyAt(10_000_000)

  assert.ok(far.density < 1 && far.blockingShare < 0.5)
  assert.ok(difficultyProgress(DIFFICULTY_TAU_Z) > 0.62 && difficultyProgress(DIFFICULTY_TAU_Z) < 0.64)
})

check('500 simulated runs, and the reaction budget never falls below REACTION_MS', () => {
  // **The check the whole curve is bounded by.** Every knob is allowed to move; the time the player
  // gets to read a row is not. Measured at the fastest the game can actually go -- which is
  // `MAX_ATTAINABLE_SPEED`, not `SPEED_CAP`, because a boost is a state the player chooses.
  //
  // Printed as a table because the numbers are the point: a curve nobody can see is a curve nobody
  // can tune.
  const bands = [0, 45_000, 90_000, 180_000, 360_000, 720_000]
  const worstPerBand = new Map(bands.map((z) => [z, { gap: Infinity, rows: 0, obstacles: 0, blocking: 0, jumpOnly: 0 }]))
  const floorMs = REACTION_MS

  for (let seed = 1; seed <= 500; seed++) {
    for (const bandStart of bands) {
      const difficulty = difficultyAt(bandStart + DIFFICULTY_TAU_Z / 2)
      const obstacles = placeObstacles({
        rng: createRng(seed * 31 + bandStart),
        fromZ: bandStart,
        toZ: bandStart + DIFFICULTY_TAU_Z,
        ...difficulty,
      })
      const rows = obstacleRows(obstacles)
      const record = worstPerBand.get(bandStart)

      record.rows += rows.length
      record.obstacles += obstacles.length
      for (const obstacle of obstacles) {
        if (obstacle.kind === 'blocking') record.blocking++
      }
      for (const row of rows) {
        // **The row that makes the jump a verb rather than an option.** Counted here rather than
        // assumed from `wallShare`, because what matters is how many rows the *player* has no
        // ground line through — which is the placer's output, not the curve's input.
        if (passableLine(row.obstacles)?.mode === 'air') record.jumpOnly++
      }
      for (let i = 1; i < rows.length; i++) record.gap = Math.min(record.gap, rows[i].z - rows[i - 1].z)

      assert.ok(provePassable(obstacles), `seed ${seed} at ${bandStart} produced an impassable stretch`)
    }
  }

  console.log('      distance  density  blocking  jump-only   rows/90k   min gap   reaction budget')
  for (const bandStart of bands) {
    const record = worstPerBand.get(bandStart)
    const difficulty = difficultyAt(bandStart + DIFFICULTY_TAU_Z / 2)
    const budgetMs = (record.gap / MAX_ATTAINABLE_SPEED) * 1000

    console.log(
      `      ${String(Math.round(bandStart / 100)).padStart(7)}m` +
        `${difficulty.density.toFixed(2).padStart(9)}` +
        `${(record.blocking / Math.max(1, record.obstacles)).toFixed(2).padStart(10)}` +
        `${(record.jumpOnly / Math.max(1, record.rows)).toFixed(2).padStart(11)}` +
        `${(record.rows / 500).toFixed(1).padStart(11)}` +
        `${(record.gap / SEGMENT_LENGTH).toFixed(1).padStart(10)}seg` +
        `${budgetMs.toFixed(0).padStart(15)}ms`,
    )

    assert.ok(
      budgetMs >= floorMs,
      `at ${Math.round(bandStart / 100)}m the player gets ${budgetMs.toFixed(0)}ms to read a row, under the ${floorMs}ms floor`,
    )
  }

  // ...and the road really does get busier, which is the other half of the claim.
  const early = worstPerBand.get(bands[0])
  const late = worstPerBand.get(bands[bands.length - 1])

  assert.ok(late.rows > early.rows * 1.3, `the road barely got busier: ${early.rows} rows early, ${late.rows} late`)
  assert.ok(
    late.blocking / late.obstacles > early.blocking / early.obstacles,
    'the unjumpable share did not actually rise in the generated output',
  )

  // **The jump has to be required, not merely available.** A scripted 443m play-through of an
  // earlier build never left the ground once: every row had a line through it, so the jump button
  // was decoration. Walls are what fixed that, and this is what keeps it fixed — at both ends of
  // the curve, because a game that only requires the jump once you are good at it teaches nothing.
  for (const bandStart of bands) {
    const record = worstPerBand.get(bandStart)
    const share = record.jumpOnly / Math.max(1, record.rows)

    assert.ok(share > 0.1, `at ${Math.round(bandStart / 100)}m only ${(share * 100).toFixed(0)}% of rows require a jump`)
    assert.ok(share < 0.45, `at ${Math.round(bandStart / 100)}m ${(share * 100).toFixed(0)}% of rows are walls — one answer to everything`)
  }
})

console.log('draw order')

check('two obstacles in a row are edge to edge or a snail apart, never half inside each other', () => {
  // ⚠ Reported by pointing at a frame: a tall texture and a low one stuck together. `passableLine`
  // cannot see it -- it asks whether a line exists THROUGH the row, which is just as true of two
  // obstacles standing inside one another -- so nothing had ever asked.
  const measure = (rows) => {
    let overlapping = 0
    let worst = 0
    let mixed = 0

    for (const row of rows) {
      // A wall is edge to edge by construction and is the one arrangement that may be.
      if (row.length >= 6 && row.every((o) => o.kind === 'low')) continue

      let bad = false

      for (let i = 0; i < row.length; i++) {
        for (let j = i + 1; j < row.length; j++) {
          const gap =
            Math.abs(row[i].offsetX - row[j].offsetX) - (row[i].halfWidths + row[j].halfWidths)

          if (gap >= 0) continue
          bad = true
          if (row[i].kind !== row[j].kind) mixed++
          const share = -gap / (2 * Math.min(row[i].halfWidths, row[j].halfWidths))
          if (share > worst) worst = share
        }
      }
      if (bad) overlapping++
    }

    return { overlapping, worst, mixed, rows: rows.length }
  }

  const rowsOf = (obstacles) => {
    const byZ = new Map()

    for (const o of obstacles) {
      if (!byZ.has(o.z)) byZ.set(o.z, [])
      byZ.get(o.z).push(o)
    }

    return [...byZ.values()]
  }

  const shipped = []

  for (let seed = 1; seed <= 5; seed++) shipped.push(...rowsOf(placeRunObstacles(seed, 286800)))

  const now = measure(shipped)

  // The control is the arrangement that shipped: independent offsets with nothing rejected.
  const before = []
  const rng = createRng(4242)

  for (let i = 0; i < now.rows; i++) {
    const row = []
    const count = 1 + Math.floor(rng() * 3)

    for (let k = 0; k < count; k++) {
      const halfWidths =
        OBSTACLE_HALF_WIDTHS.min + rng() * (OBSTACLE_HALF_WIDTHS.max - OBSTACLE_HALF_WIDTHS.min)
      const reach = Math.max(0, ROAD_EDGE - halfWidths)

      row.push({
        kind: rng() < 0.11 ? 'blocking' : 'low',
        offsetX: -reach + rng() * reach * 2,
        halfWidths,
      })
    }
    before.push(row)
  }

  const control = measure(before)

  console.log(
    `    ${now.rows} rows: ${now.overlapping} carry an overlapping pair ` +
      `(was ${((control.overlapping / control.rows) * 100).toFixed(0)}%, worst ` +
      `${(control.worst * 100).toFixed(0)}% inside, ${control.mixed} of them a tall on a low)`,
  )
  assert.equal(now.overlapping, 0, `${now.overlapping} rows have two obstacles occupying one piece of road`)
  assert.ok(
    control.overlapping / control.rows > 0.2,
    'the unspaced placer no longer overlaps anything — the control has gone stale',
  )
})

check('nearer always paints over farther, whatever the two things are', () => {
  // **The defect this replaces was measured in the running game**: every obstacle and every pickup
  // shared one flat depth, so equal depth fell back to display-list order, which is pool-slot
  // order, which the render loop fills near-to-far — the farthest obstacle was added last and
  // painted last. Nearest at screen y 805 sat at list index 134; farthest at y 576 sat at 147.
  const layers = Object.values(WORLD_LAYER)

  for (const near of layers) {
    for (const far of layers) {
      // One whole segment apart is the smallest gap that must be decided by distance rather than
      // by category, and it is what every tiebreak below has to stay inside.
      assert.ok(
        worldDepth(9, near) > worldDepth(10, far),
        `something at 10 segments (layer ${far}) paints over something at 9 (layer ${near})`,
      )
    }
  }
})

check('every tiebreak is smaller than one segment, which is what keeps distance in charge', () => {
  // The property the check above rests on, stated on its own so a future layer added at 1.5
  // fails here rather than mysteriously reordering the world.
  for (const [name, layer] of Object.entries(WORLD_LAYER)) {
    assert.ok(layer >= 0 && layer < 1, `WORLD_LAYER.${name} is ${layer} — a tiebreak must be inside one segment`)
  }
})

check('on the same segment, a pickup is never lost behind the obstacle beside it', () => {
  assert.ok(worldDepth(20, WORLD_LAYER.pickup) > worldDepth(20, WORLD_LAYER.obstacle))
  assert.ok(worldDepth(20, WORLD_LAYER.obstacle) > worldDepth(20, WORLD_LAYER.scenery))
})

check('two things on the road are ordered by which is actually nearer, not by whose segment it is', () => {
  // ⚠ **The defect this was written for was reported three times as "the wings show through the
  // textures", and it is a units bug rather than an art one.** The obstacle, pickup and ramp pools
  // passed the bare segment index -- so an obstacle anywhere inside a segment sorted as though it
  // stood on that segment's near edge -- while the critter pool and `PlayerView` passed a
  // continuous index measured from the CAMERA, which stands some way into its own base segment.
  // Two errors compounding, both up to a whole segment, on a road where a segment is 200 units and
  // a flyer is 686-1050 wide.
  //
  // What is asserted is the property rather than either formula: of two things on the road, the
  // nearer one paints over the farther one -- everywhere except inside the layer tiebreak's own
  // window, which is what that tiebreak is for.
  const tie = (WORLD_LAYER.critter - WORLD_LAYER.obstacle) * SEGMENT_LENGTH
  const indexOf = (aheadOfCamera, intoBase) =>
    distanceIndexOf(
      Math.floor((aheadOfCamera + intoBase) / SEGMENT_LENGTH),
      aheadOfCamera + intoBase,
    )
  // The arrangement that shipped, kept so the check is shown to be measuring something.
  const shippedObstacleIndex = (aheadOfCamera, intoBase) =>
    Math.floor((aheadOfCamera + intoBase) / SEGMENT_LENGTH)
  const shippedCritterIndex = (aheadOfCamera) => aheadOfCamera / SEGMENT_LENGTH

  const sweep = (obstacleIndex, critterIndex) => {
    let worstBehind = 0
    let worstAhead = 0

    for (let intoBase = 0; intoBase < SEGMENT_LENGTH; intoBase += 5) {
      for (let obstacleAhead = 1000; obstacleAhead < 4000; obstacleAhead += 7) {
        const obstacleDepth = worldDepth(obstacleIndex(obstacleAhead, intoBase), WORLD_LAYER.obstacle)

        for (let d = -600; d <= 600; d += 1) {
          const critterAhead = obstacleAhead + d
          const inFront =
            worldDepth(critterIndex(critterAhead, intoBase), WORLD_LAYER.critter) > obstacleDepth

          if (inFront && d > worstBehind) worstBehind = d
          if (!inFront && -d > worstAhead) worstAhead = -d
        }
      }
    }

    return { worstBehind, worstAhead }
  }

  const now = sweep(indexOf, indexOf)
  const before = sweep(shippedObstacleIndex, shippedCritterIndex)

  console.log(
    `    drawn in front while behind: ${now.worstBehind}u (was ${before.worstBehind}u); ` +
      `drawn behind while in front: ${now.worstAhead}u (was ${before.worstAhead}u); ` +
      `tiebreak window ${tie}u`,
  )
  assert.ok(
    now.worstBehind <= tie + 1e-6,
    `a critter is drawn in front of an obstacle ${now.worstBehind} units behind it, past the ${tie}-unit tiebreak`,
  )
  assert.ok(now.worstAhead === 0, `a critter is drawn behind an obstacle ${now.worstAhead} units in front of it`)
  // The control has to keep failing, or this check has stopped measuring the thing it is about.
  assert.ok(
    before.worstBehind > SEGMENT_LENGTH || before.worstAhead > SEGMENT_LENGTH * 0.9,
    'the shipped-before arrangement no longer misorders anything — the control has gone stale',
  )
})

check('the snail sits between the segment behind it and the one ahead', () => {
  // **Landing between two segments is the point.** An obstacle the snail has just passed is nearer
  // to the camera and has to paint over it; one still ahead must not. A flat depth put the snail in
  // front of both, so a boulder slid *under* it on the way past.
  //
  // **⚠ The two segments are derived, and hardcoding them once cost a failing check for the wrong
  // reason.** They were written as 9 and 10 against a snail 9.83 segments out — true of the row the
  // player stood on then, and nothing to do with the property. `PLAYER_REST_Y_FRACTION` is solved
  // now (see its own note), so the row moves whenever the mascot's width does and the check has to
  // move with it or it is asserting where the snail used to be.
  const index = PLAYER_Z / SEGMENT_LENGTH
  const snail = worldDepth(index, WORLD_LAYER.player)

  assert.ok(!Number.isInteger(index), 'the snail sits exactly on a segment boundary — there is no behind and ahead')
  console.log(`    ${index.toFixed(2)} segments out, i.e. ${((index % 1) * 100).toFixed(0)}% through segment ${Math.floor(index)}`)
  assert.ok(worldDepth(Math.floor(index), WORLD_LAYER.obstacle) > snail, 'an obstacle the snail has passed draws behind it')
  assert.ok(worldDepth(Math.floor(index) + 1, WORLD_LAYER.obstacle) < snail, 'an obstacle still ahead draws over the snail')
  // ...and its shadow is under it.
  const shadow = worldDepth(PLAYER_Z / SEGMENT_LENGTH, WORLD_LAYER.shadow)

  assert.ok(shadow < snail, 'the snail is drawn under its own shadow')
})

check('the distance haze obstacles now share costs the reaction budget nothing', () => {
  // Obstacles were the one thing drawn at full contrast against faded scenery, which read as
  // pasted on. They fade with the verge now — but `REACTION_MS` is a floor, and this is the one
  // change that could quietly undercut it, so the fade at that distance is measured.
  const reactionSegments = ((REACTION_MS / 1000) * MAX_ATTAINABLE_SPEED) / SEGMENT_LENGTH
  const alpha = 1 - billboardFog(Math.round(reactionSegments)) * MAX_BILLBOARD_FOG

  assert.ok(alpha > 0.9, `an obstacle is at alpha ${alpha.toFixed(3)} when the player must first read it`)
  console.log(
    `    at ${reactionSegments.toFixed(1)} segments — where an obstacle must be readable — the haze leaves it at alpha ${alpha.toFixed(3)}`,
  )
})

console.log('the palette')

check('every obstacle shading band is dark enough to read as ink', () => {
  // **The first pass missed this by a hair and it cost the whole look.** Each `dark` band landed at
  // lightness 71-72 against a 70 threshold, so the shaded half of every rock counted as body
  // colour: the obstacles measured 10-18% ink where the scenery they stand beside measures 34%, and
  // they read as flat cut-outs pasted onto the road.
  for (const [kind, material] of Object.entries(OBSTACLE_MATERIALS)) {
    assert.ok(
      lightnessOf(material.dark) < INK_LIGHTNESS,
      `${kind}'s shadow band is at lightness ${lightnessOf(material.dark).toFixed(0)}, over the ${INK_LIGHTNESS} ink threshold`,
    )
    assert.ok(lightnessOf(material.light) > lightnessOf(material.mid), `${kind}'s bands are not ordered`)
    assert.ok(lightnessOf(material.mid) > lightnessOf(material.dark), `${kind}'s bands are not ordered`)
  }
})

check('the obstacle classes are told apart by value, not by hue', () => {
  // **⚠ THIS CHECK REPLACES A CEILING THAT WAS THE OLD ART DIRECTION WRITTEN AS AN ASSERTION.**
  // It used to require every band under 25% saturation, on the reasoning that a hazard has to
  // belong to the picture and the scenery it stands in measures 5%. That was true of the art it
  // was written for and is false of the art that shipped: the obstacles are made things now —
  // honey sandstone, golden straw, oak, bark — and every one of them is past 25% by design. See
  // `OBSTACLE_MATERIALS` for why the classes stopped being rocks.
  //
  // Deleting it outright would have left the family with no constraint at all, and the constraint
  // it was really standing in for is still live: **the classes are read at 9-27px on a moving
  // road, and at that size hue is the first thing perspective haze and the biome tint take away.**
  // So what is asserted now is the thing that survives — that the classes separate by LIGHTNESS,
  // with a gap wide enough to read after the distance fade.
  //
  // The value is `MIN_CLASS_VALUE_GAP` rather than a bare number so the failure message can say
  // what it is: 12 of 255 is roughly a 5% step, which is about twice what a 4.3% haze at the
  // reaction distance can eat (see "Draw Order" in CLAUDE.md for where that figure comes from).
  const MIN_CLASS_VALUE_GAP = 12
  const mean = (values) => values.reduce((sum, v) => sum + v, 0) / values.length
  const value = (material) => mean(Object.values(material).map(lightnessOf))

  const kinds = Object.entries(OBSTACLE_MATERIALS)
  for (const [kind, material] of kinds) {
    for (const [band, color] of Object.entries(material)) {
      // Still bounded, just an order of magnitude higher: past this a "stone block" is a neon
      // sign, and the one hue the game reserves is only 30 degrees wide.
      assert.ok(
        saturationOf(color) < 80,
        `${kind}.${band} is ${saturationOf(color).toFixed(0)}% saturated — past what a lit material reads as`,
      )
    }
  }

  for (let i = 0; i < kinds.length; i++) {
    for (let j = i + 1; j < kinds.length; j++) {
      const gap = Math.abs(value(kinds[i][1]) - value(kinds[j][1]))
      assert.ok(
        gap >= MIN_CLASS_VALUE_GAP,
        `${kinds[i][0]} and ${kinds[j][0]} are ${gap.toFixed(0)} lightness apart — under the ${MIN_CLASS_VALUE_GAP} a class needs to survive the distance fade`,
      )
    }
  }
  console.log(
    `    class values ${kinds.map(([k, m]) => `${k} ${value(m).toFixed(0)}`).join(', ')}`,
  )
})

check('the snail is the one thing aimed away from the scenery, and by a wide margin', () => {
  // Stated as a fact rather than left to taste: the mascot is the only object a player must never
  // have to search for, so it is deliberately brighter and more saturated than anything it shares
  // a frame with.
  //
  // **⚠ THIS IS NOW THE LOAD-BEARING PALETTE CHECK, AND IT WAS THE EASY ONE BEFORE.** It used to
  // pass on a 3x margin without effort, because the obstacles were pinned under a 25% saturation
  // ceiling that no longer exists — the mascot won by default. With the whole frame re-arted
  // brighter, this is the assertion that actually holds the mascot's separation, and the two
  // ceilings it used to be inferred from are gone. If a future round makes the obstacles louder,
  // this is what fails, and the fix is the obstacles rather than the threshold.
  const snail = [...Object.values(SNAIL_SHELL), ...Object.values(SNAIL_BODY)]
  const obstacle = Object.values(OBSTACLE_MATERIALS).flatMap((m) => Object.values(m))
  const mean = (values) => values.reduce((sum, v) => sum + v, 0) / values.length

  const snailSat = mean(snail.map(saturationOf))
  const obstacleSat = mean(obstacle.map(saturationOf))

  // **⚠ THE FLOOR MOVED FROM 3x TO 2x, AND THAT IS A LOOSENING — SO HERE IS ITS EVIDENCE.**
  //
  // 3x was never chosen as the point below which a mascot becomes hard to find. It was set under a
  // margin that already held for free: the obstacles were pinned beneath a 25% saturation ceiling
  // that expressed the rail shooter's muted art direction, so the mascot won by 5x without anyone
  // aiming for it. That ceiling is gone with the art it described.
  //
  // What the shipped art actually measures (`node scripts/measure-art.mjs` over the picked
  // renders) is snail **68% / 144 lightness** against obstacles at **44% / 120** — a 1.55x ratio.
  // The drawn fallback below is authored a little cooler than that, at 2.5x, because a weathered
  // material genuinely is less chromatic than a glossy render of it. 2x sits under the fallback
  // with room and above the raw art, which is the honest place for a floor that governs the
  // fallback: it must not be reachable only by the palette being unlike the sprites it stands in
  // for.
  //
  // Two things this deliberately does NOT do. It does not assert on the PNGs — nothing here
  // rasterises, and `measure-art.mjs` is where their own numbers are read. And it does not fall
  // back to a perceptual distance: `deltaE` between the mascot and the hazard set was measured
  // across three candidate palettes at 0.272 / 0.279 / 0.291 while their saturation ratios ran
  // 1.18x / 2.56x / 5.04x — i.e. it scored the failing palette and the passing one the same, and a
  // metric that cannot separate those is not a replacement for one that can.
  const MIN_MASCOT_SATURATION_MARGIN = 2

  assert.ok(
    snailSat > obstacleSat * MIN_MASCOT_SATURATION_MARGIN,
    `the snail is only ${(snailSat / obstacleSat).toFixed(1)}x as saturated as an obstacle`,
  )
  assert.ok(
    mean(snail.map(lightnessOf)) > mean(obstacle.map(lightnessOf)),
    'the snail is not brighter than the things it has to be seen against',
  )

  // **The negative control, because a floor that has never rejected anything is not a floor.** The
  // first draft of `OBSTACLE_MATERIALS` after the re-art was warm honey sandstone, rich oak and
  // bark, and it failed this check at 1.2x — which is the whole reason the shipped table is
  // weathered rather than candied. Keeping that palette here means the check is shown to bite on
  // every run rather than on the one day someone repeats the mistake.
  const CANDIED_OBSTACLES = [
    0xd9a961, 0xb07f38, 0x40301a, 0xc98f4f, 0x9a6733, 0x3a2917, 0xa87d4a, 0x7d5530, 0x33241a,
  ]
  assert.ok(
    snailSat <= mean(CANDIED_OBSTACLES.map(saturationOf)) * MIN_MASCOT_SATURATION_MARGIN,
    'the margin check no longer rejects the candied obstacle palette it was written for',
  )

  console.log(
    `    snail ${mean(snail.map(lightnessOf)).toFixed(0)} lightness / ${snailSat.toFixed(0)}% saturation ` +
      `against obstacles at ${mean(obstacle.map(lightnessOf)).toFixed(0)} / ${obstacleSat.toFixed(0)}% ` +
      `— ${(snailSat / obstacleSat).toFixed(1)}x, floor ${MIN_MASCOT_SATURATION_MARGIN}x`,
  )
})

check('a pickup is lit like the creature, not like the rock it is lying beside', () => {
  // **The whole colour rule of the game in one assertion.** Everything is aimed at the scenery's
  // muted tone except the snail and the things the player is steering it towards; a pickup that
  // measured like a rock would be a reward the eye has to hunt for.
  const mean = (values) => values.reduce((sum, v) => sum + v, 0) / values.length
  const pickups = Object.values(PICKUP_COLORS).flatMap((c) => Object.values(c))
  const obstacles = Object.values(OBSTACLE_MATERIALS).flatMap((m) => Object.values(m))

  // Same recalibration and the same reason as the mascot's margin directly above — this ratio
  // was measured against the identical obstacle set and inherited its 3x from the identical
  // vanished ceiling.
  assert.ok(
    mean(pickups.map(saturationOf)) > mean(obstacles.map(saturationOf)) * 2,
    'the pickups are not meaningfully more saturated than the obstacles',
  )
  // Each kind still has its own three ordered bands, like every other material here.
  for (const [kind, colors] of Object.entries(PICKUP_COLORS)) {
    assert.ok(lightnessOf(colors.light) > lightnessOf(colors.mid), `${kind}'s bands are not ordered`)
    assert.ok(lightnessOf(colors.mid) > lightnessOf(colors.dark), `${kind}'s bands are not ordered`)
  }
  console.log(`    pickups average ${mean(pickups.map(saturationOf)).toFixed(0)}% saturation against obstacles at ${mean(obstacles.map(saturationOf)).toFixed(0)}%`)
})

check('the ink is not pure black, which verify:mattes would reject', () => {
  // A pure-black outline hard against the alpha boundary means the closing flood copies black into
  // the transparent ring and every mipmap averages it back into the silhouette. That is the exact
  // defect `verify:mattes` exists for, and it caught it on a real sprite once already.
  assert.ok(lightnessOf(INK) > 20, `ink at lightness ${lightnessOf(INK).toFixed(0)} is effectively black`)
  assert.ok(lightnessOf(INK) < INK_LIGHTNESS, 'the ink is not dark enough to be ink')
})

check('a shadow lies on the ground, so everything solid paints over it', () => {
  // **⚠ This was 0.35 -- above `obstacle` -- and it was right while the only shadow in the game
  // belonged to the player and the only thing it had to sit under was the player.** Pickups and
  // pickups cast one. A shadow is a mark on the ground: anything standing on that
  // ground at the same distance has to be drawn over it, or a boulder gets a dark ellipse laid
  // across its foot. Asserted at one distance, because a tiebreak is what decides ties.
  for (const layer of ['obstacle', 'player', 'pickup']) {
    assert.ok(
      worldDepth(20, WORLD_LAYER.shadow) < worldDepth(20, WORLD_LAYER[layer]),
      `a shadow draws over ${layer} on the same segment`,
    )
  }

  // Above the ground itself, or there would be nothing to see: the mesh and its decals are far
  // below every one of these tiebreaks.
  assert.ok(WORLD_LAYER.shadow > 0, 'the shadow shares the ground mesh\'s own slot')

  // The one thing it is deliberately NOT under, stated rather than left as an accident: scenery
  // stands at the verge and a shadow is cast on the road, so the two overlap rarely, and a
  // multiply over a prop's foot is a better outcome than a shadow drawn on top of a solid object.
  assert.ok(WORLD_LAYER.shadow > WORLD_LAYER.scenery, 'the shadow ordering against scenery is no longer the documented one')
})

check('⚠ every obstacle on a lap has an id of its own', () => {
  const TRACK = 286800

  // **`RunScene.resolvedOnLap` is keyed by id and marks an obstacle settled FOR THE LAP as soon as
  // the sweep passes it**, so two obstacles sharing an id are one obstacle as far as collision is
  // concerned: passing the first disarms the second before the player reaches it.
  //
  // `placeRunObstacles` calls `placeObstacles` once per difficulty band and every band used to
  // start its counter at zero. Measured on the shipped placer before the fix: 164 obstacles, 56
  // distinct ids, **108 of them — 66% of the lap — could not hit the player at all.** That is very
  // likely most of what "some obstacles deal no damage" always was.
  for (const [seed, offset] of [[1234, 0], [1234, TRACK], [77, 0], [9001, TRACK * 3]]) {
    const list = placeRunObstacles(seed, TRACK, offset)
    const ids = new Set(list.map((o) => o.id))

    assert.equal(ids.size, list.length, `seed ${seed} lap ${offset / TRACK}: ${list.length} obstacles, ${ids.size} ids`)
  }

  // Shown to catch it: the per-band call with its counter reset is exactly what shipped.
  const bandA = placeObstacles({ rng: createRng(1), fromZ: 0, toZ: 60000, density: 0.8, blockingShare: 0.1, wallShare: 0.2 })
  const bandB = placeObstacles({ rng: createRng(2), fromZ: 60000, toZ: 120000, density: 0.8, blockingShare: 0.1, wallShare: 0.2 })
  const naive = new Set([...bandA, ...bandB].map((o) => o.id))

  assert.ok(
    naive.size < bandA.length + bandB.length,
    'two bands with no id offset came out unique, so this check would not have caught the defect',
  )
  console.log(`    a lap's ids are unique; two bands sharing a counter collide on ${bandA.length + bandB.length - naive.size} of them`)
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

check('every obstacle inside the draw distance can be drawn at once', () => {
  // **⚠ The pool was 48 and the demand it was sized against was never measured.** Its own note
  // reasoned that the draw distance holds 37 rows at three obstacles a row — which is 111 — and then
  // assumed the far ones would be culled. Measured on the real placer at saturated difficulty the
  // peak is far past 48, and a wall is fourteen obstacles in a single row, so the assumption fails
  // exactly where the road is busiest.
  //
  // A short obstacle pool costs more than a short pickup pool: the pool is filled near to far, so
  // what goes undrawn is the far end — which IS the reaction budget. A hazard not drawn until it is
  // nearer than `REACTION_MS` is a hazard the player was never shown.
  const TRACK = 286800
  let worst = 0

  for (const seed of [1, 4242, 777, 31337, 9001]) {
    // A late lap, so the difficulty curve is at its ceiling and the road is as busy as it ever gets.
    worst = Math.max(worst, peakInView(placeRunObstacles(seed, TRACK, TRACK * 3), TRACK))
  }

  assert.ok(OBSTACLE_POOL_SIZE > worst, `the pool is ${OBSTACLE_POOL_SIZE} against a peak demand of ${worst}`)
  console.log(`    pool ${OBSTACLE_POOL_SIZE} against a peak of ${worst} in the draw distance, over five saturated laps`)
})

check('the incremental row test agrees with the whole-lap proof, row for row', () => {
  const TRACK = 286800
  // **⚠ The walk re-proved the entire lap for every row and for every redraw of every row**, at 81
  // samples a row: quadratic, on the one frame per lap that builds the next one. `acceptRow` checks
  // only what appending can break -- this row's own line, and an earlier jump-only row whose flight
  // now reaches it. The control is the form it replaced: `provePassable` over the whole set, which
  // is what the answer has to keep being.
  let rowsSeen = 0
  let refused = 0
  let windowMax = 0

  for (let seed = 1; seed <= 25; seed++) {
    const obstacles = placeRunObstacles(seed, TRACK)
    const rows = obstacleRows(obstacles)
    const kept = []
    const proved = []

    for (const row of rows) {
      // Both forms are asked the same question about the same prefix, so a disagreement is a
      // disagreement about the rule and not about the order the placer happened to draw in.
      const incremental = acceptRow(proved, row.obstacles) !== null
      const whole = provePassable([...kept, ...row.obstacles])

      assert.equal(incremental, whole, `seed ${seed}, row at ${row.z}: ${incremental} against ${whole}`)
      rowsSeen++
      if (!whole) refused++
      else {
        kept.push(...row.obstacles)
        proved.push({ z: row.z, jumpOnly: passableLine(row.obstacles).mode !== 'ground' })
        // How far back the window actually has to look, printed rather than assumed: it is what
        // makes the incremental form constant-time rather than merely smaller.
        let back = 0

        for (let i = proved.length - 2; i >= 0 && proved[i].z + FLIGHT_LENGTH_Z >= row.z; i--) back++
        windowMax = Math.max(windowMax, back)
      }
    }
  }

  console.log(
    `    ${rowsSeen} rows over 25 laps, ${refused} of them refused by both, ` +
      `flight window at most ${windowMax} rows back against a lap of ~37`,
  )
})

check('and both forms refuse the same impassable row', () => {
  // **⚠ The comparison above only ever sees rows the placer ACCEPTED**, because it is handed the
  // placer's own output -- so it exercises one side of the answer and would pass on a form that
  // never refuses anything. A row walled edge to edge with no gap is the other side.
  const TRACK = 286800
  const kept = placeRunObstacles(3, TRACK)
  const rows = obstacleRows(kept)
  const at = rows[rows.length - 1].z + MIN_ROW_GAP_Z * 2
  const walled = []

  for (let offsetX = -1.2; offsetX <= 1.2; offsetX += 0.1) {
    walled.push(createObstacle({ id: 90000 + walled.length, z: at, offsetX, halfWidths: 0.22, kind: 'blocking' }))
  }

  const proved = rows.map((row) => ({ z: row.z, jumpOnly: passableLine(row.obstacles).mode !== 'ground' }))

  assert.equal(passableLine(walled), null, 'the fixture is not actually impassable')
  assert.equal(acceptRow(proved, walled), null, 'the incremental form accepted a row with no line')
  assert.equal(provePassable([...kept, ...walled]), false, 'the whole-lap form accepted it')
  console.log(`    a ${walled.length}-block barrier wall at ${at.toFixed(0)} is refused by both`)
})

console.log(`${passed} checks passed`)
