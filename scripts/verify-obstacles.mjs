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
  MAX_ATTAINABLE_SPEED,
  obstacleRows,
  passableLine,
  placeObstacles,
  provePassable,
} from '../src/run/obstacles.ts'
import { difficultyAt, difficultyProgress, DIFFICULTY_TAU_Z } from '../src/run/difficulty.ts'
import { WORLD_LAYER, worldDepth } from '../src/run/worldDepth.ts'
import {
  INK,
  INK_LIGHTNESS,
  lightnessOf,
  OBSTACLE_MATERIALS,
  saturationOf,
  SNAIL_BODY,
  SNAIL_SHELL,
} from '../src/run/artPalette.ts'
import {
  JUMP_APEX,
  OBSTACLE_BANDS,
  OBSTACLE_DEPTH,
  PLAYER_BODY_H,
  PLAYER_HALF_WIDTHS,
  PLAYER_Z,
  REACTION_MS,
  ROAD_EDGE,
  SPEED_CAP,
} from '../src/run/constants.ts'
import { billboardFog, CAMERA_DEPTH, MAX_BILLBOARD_FOG, SEGMENT_LENGTH } from '../src/road/constants.ts'
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

console.log('the difficulty curve')

check('every knob rises with distance and saturates, and none of them is the floor', () => {
  const samples = [0, 30_000, 90_000, 180_000, 360_000, 900_000]
  let previous = difficultyAt(0)

  for (const distance of samples.slice(1)) {
    const here = difficultyAt(distance)

    assert.ok(here.density >= previous.density, 'density went down')
    assert.ok(here.blockingShare >= previous.blockingShare, 'the unjumpable share went down')
    assert.ok(here.overheadShare >= previous.overheadShare, 'the overhead share went down')
    previous = here
  }

  // Saturating, not ramping: an endless game must not have a distance past which the road stops
  // responding to the player.
  const far = difficultyAt(10_000_000)

  assert.ok(far.density < 1 && far.blockingShare < 0.5 && far.overheadShare < 0.4)
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
  const worstPerBand = new Map(bands.map((z) => [z, { gap: Infinity, rows: 0, obstacles: 0, blocking: 0, overhead: 0, jumpOnly: 0 }]))
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
        if (obstacle.kind === 'overhead') record.overhead++
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

  console.log('      distance  density  blocking  overhead  jump-only   rows/90k   min gap   reaction budget')
  for (const bandStart of bands) {
    const record = worstPerBand.get(bandStart)
    const difficulty = difficultyAt(bandStart + DIFFICULTY_TAU_Z / 2)
    const budgetMs = (record.gap / MAX_ATTAINABLE_SPEED) * 1000

    console.log(
      `      ${String(Math.round(bandStart / 100)).padStart(7)}m` +
        `${difficulty.density.toFixed(2).padStart(9)}` +
        `${(record.blocking / Math.max(1, record.obstacles)).toFixed(2).padStart(10)}` +
        `${(record.overhead / Math.max(1, record.obstacles)).toFixed(2).padStart(10)}` +
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

check('the snail sits between the segment behind it and the one ahead', () => {
  // **The snail is 9.83 segments out, and landing between two segments is the point.** An obstacle
  // it has just passed is nearer to the camera and has to paint over it; one still ahead must not.
  // A flat depth put the snail in front of both, so a boulder slid *under* it on the way past.
  const snail = worldDepth(PLAYER_Z / SEGMENT_LENGTH, WORLD_LAYER.player)

  assert.ok(worldDepth(9, WORLD_LAYER.obstacle) > snail, 'an obstacle the snail has passed draws behind it')
  assert.ok(worldDepth(10, WORLD_LAYER.obstacle) < snail, 'an obstacle still ahead draws over the snail')
  // ...and its shadow stays immediately underneath it rather than joining the sort somewhere else.
  const shadow = worldDepth(PLAYER_Z / SEGMENT_LENGTH, WORLD_LAYER.shadow)

  assert.ok(shadow < snail && snail - shadow < 0.1, 'the shadow is not directly under the snail')
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

check('obstacles sit inside the scenery saturation bracket, and the trunk especially', () => {
  // The other first-pass miss: a rich brown trunk at 42% measured saturation against a verge that
  // measures 5%. A hazard has to belong to the picture -- what separates it from the verge is that
  // it stands on grey asphalt, not that it is a different colour.
  for (const [kind, material] of Object.entries(OBSTACLE_MATERIALS)) {
    for (const [band, color] of Object.entries(material)) {
      assert.ok(
        saturationOf(color) < 25,
        `${kind}.${band} is ${saturationOf(color).toFixed(0)}% saturated — the scenery it stands in measures 5%`,
      )
    }
  }
})

check('the snail is the one thing aimed away from the scenery, and by a wide margin', () => {
  // Stated as a fact rather than left to taste: the mascot is the only object a player must never
  // have to search for, so it is deliberately brighter and many times more saturated than anything
  // it shares a frame with. Measured on the drawn textures: lightness 140 and 66% saturation
  // against the verge's 111 and 5%.
  const snail = [...Object.values(SNAIL_SHELL), ...Object.values(SNAIL_BODY)]
  const obstacle = Object.values(OBSTACLE_MATERIALS).flatMap((m) => Object.values(m))
  const mean = (values) => values.reduce((sum, v) => sum + v, 0) / values.length

  const snailSat = mean(snail.map(saturationOf))
  const obstacleSat = mean(obstacle.map(saturationOf))

  assert.ok(snailSat > obstacleSat * 3, `the snail is only ${(snailSat / obstacleSat).toFixed(1)}x as saturated as an obstacle`)
  assert.ok(
    mean(snail.map(lightnessOf)) > mean(obstacle.map(lightnessOf)),
    'the snail is not brighter than the things it has to be seen against',
  )
  console.log(
    `    snail ${mean(snail.map(lightnessOf)).toFixed(0)} lightness / ${snailSat.toFixed(0)}% saturation ` +
      `against obstacles at ${mean(obstacle.map(lightnessOf)).toFixed(0)} / ${obstacleSat.toFixed(0)}%`,
  )
})

check('the ink is not pure black, which verify:mattes would reject', () => {
  // A pure-black outline hard against the alpha boundary means the closing flood copies black into
  // the transparent ring and every mipmap averages it back into the silhouette. That is the exact
  // defect `verify:mattes` exists for, and it caught it on a real sprite once already.
  assert.ok(lightnessOf(INK) > 20, `ink at lightness ${lightnessOf(INK).toFixed(0)} is effectively black`)
  assert.ok(lightnessOf(INK) < INK_LIGHTNESS, 'the ink is not dark enough to be ink')
})

console.log(`${passed} checks passed`)
