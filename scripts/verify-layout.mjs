#!/usr/bin/env node
// Logic check for src/run/lapLayout.ts -- the rule that nothing already on screen is ever rewritten.
// Plain assertions, no framework, via the register-ts-loader.mjs + ts-extensionless-loader.mjs
// Node-native-TS setup.
//
// **The whole suite is one rule and its negative control.** The scene used to rebuild the entire lap
// the frame the run wrapped, and the road is drawn 300 segments ahead of a 1434-segment lap — so a
// fifth of what the player was looking at changed under them. Reported as barriers appearing in view
// that they then hit, and as walls whose blocks change on the fly. It reads as happening at a biome
// seam because it does: the lap divides evenly into biomes, so segment 0 is always a boundary.
//
// The check drives a real run over several laps against the real placers and asserts that no segment
// inside the visible band is ever written. The old whole-lap swap is kept as the control and is
// shown to break it by 69 obstacle slots.
import assert from 'node:assert/strict'
import { HANDOVER_MARGIN, indexBySegment, inView, LapLayout } from '../src/run/lapLayout.ts'
import { placeRunObstacles } from '../src/run/obstacles.ts'
import { placeFormations } from '../src/run/formations.ts'
import { placeRamps, RAMP_LAUNCH_V } from '../src/run/ramp.ts'
import { DRAW_DISTANCE, SEGMENT_LENGTH } from '../src/road/constants.ts'
import { MAX_ATTAINABLE_SPEED, SPEED_BASE } from '../src/run/constants.ts'
import { createRng } from '../src/race/rng.ts'

let passed = 0

function check(name, fn) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

const TRACK = 286800
const SEGMENTS = TRACK / SEGMENT_LENGTH
const SEED = 1234

/** The scene's own `layLap`, lifted so the check builds exactly what the game builds. */
function buildLap(lapOffset) {
  const obstacles = placeRunObstacles(SEED, TRACK, lapOffset)
  const ramps = placeRamps(SEED ^ 0x2a17, TRACK, lapOffset, obstacles)
  const pickups = placeFormations({
    rng: createRng((SEED ^ 0x5eed) + Math.round(lapOffset / SEGMENT_LENGTH)),
    fromZ: lapOffset === 0 ? SEGMENT_LENGTH * 20 : 0,
    toZ: TRACK,
    trackLength: TRACK,
    obstacles,
    launches: ramps.map((ramp) => ({ id: ramp.id, z: ramp.z, offsetX: ramp.offsetX, launchV: RAMP_LAUNCH_V })),
  })

  return { obstacles, pickups, ramps }
}

console.log('the defect, measured on the real placer')

check('a whole-lap swap rewrites a fifth of the road, in view', () => {
  // The negative control, and it is the shipped placer rather than a fixture: this is what the game
  // did every 80 seconds.
  const a = indexBySegment(placeRunObstacles(SEED, TRACK, 0), SEGMENTS)
  const b = indexBySegment(placeRunObstacles(SEED, TRACK, TRACK), SEGMENTS)
  let rewritten = 0
  let visible = 0

  for (let i = 0; i < DRAW_DISTANCE; i++) {
    const here = a.get(i) ?? []
    const next = b.get(i) ?? []
    const key = (list) => list.map((o) => `${o.kind}:${o.offsetX.toFixed(3)}:${o.id}`).join('|')

    visible += here.length
    if (key(here) !== key(next)) rewritten += Math.max(here.length, next.length)
  }

  assert.ok(rewritten > 0, 'the two laps are identical, so this check is measuring nothing')
  console.log(
    `    the visible band is ${DRAW_DISTANCE} of ${SEGMENTS} segments (${((DRAW_DISTANCE / SEGMENTS) * 100).toFixed(0)}% of the lap); ` +
      `${visible} obstacles stand in it and a swap changes ${rewritten} slots`,
  )
})

console.log('the rule: nothing in view is rewritten')

/** Drives a run at `speed` for `laps`, asserting the invariant on every write. */
function drive(speed, laps, onWrite) {
  const layout = new LapLayout({ trackLength: TRACK, segmentCount: SEGMENTS, build: buildLap })
  const dt = 1000 / 60
  let distance = 0
  let writes = 0

  while (distance < TRACK * laps) {
    distance += (speed * dt) / 1000

    const cameraSegment = ((Math.floor(distance / SEGMENT_LENGTH) % SEGMENTS) + SEGMENTS) % SEGMENTS
    // What the layout held in the visible band before this frame's handover.
    const before = []

    for (let n = 0; n < DRAW_DISTANCE; n++) {
      const index = (cameraSegment + n) % SEGMENTS

      before.push((layout.obstacles.get(index) ?? []).map((o) => `${o.kind}:${o.id}`).join('|'))
    }

    writes += layout.advance(distance)

    for (let n = 0; n < DRAW_DISTANCE; n++) {
      const index = (cameraSegment + n) % SEGMENTS
      const after = (layout.obstacles.get(index) ?? []).map((o) => `${o.kind}:${o.id}`).join('|')

      if (after !== before[n]) {
        onWrite(index, cameraSegment, n)
      }
    }
  }

  return { layout, writes }
}

check('over three laps at top speed, no visible segment ever changes', () => {
  const violations = []

  const { writes } = drive(MAX_ATTAINABLE_SPEED, 3, (index, cameraSegment, ahead) => {
    violations.push(`segment ${index}, ${ahead} ahead of the camera at ${cameraSegment}`)
  })

  assert.equal(violations.length, 0, `${violations.length} rewrites landed in view: ${violations.slice(0, 3).join('; ')}`)
  console.log(`    ${writes} segments handed over across three laps, none of them in view`)
})

check('and at the slowest the run ever goes, where a frame covers a fraction of a segment', () => {
  // The other end of the range: at `SPEED_BASE` many frames pass without the cursor moving at all,
  // and the failure mode there is a cursor that never advances rather than one that overshoots.
  const violations = []
  const { writes } = drive(SPEED_BASE, 1, (index) => violations.push(index))

  assert.equal(violations.length, 0, `${violations.length} rewrites landed in view`)
  assert.ok(writes >= SEGMENTS - 4, `only ${writes} of ${SEGMENTS} segments were handed over in a lap`)
})

check('the margin is what makes it true, and one segment is not enough', () => {
  // Shown to bite: the camera sits INSIDE its own base segment, so that segment is half in view. A
  // margin of one writes it while its near half is still on screen.
  assert.ok(HANDOVER_MARGIN >= 2, `a margin of ${HANDOVER_MARGIN} writes the segment the camera is standing in`)

  // The predicate the rule is stated in, checked in both directions so the sweep above cannot pass
  // by asking the wrong question.
  assert.equal(inView(10, 10, SEGMENTS, DRAW_DISTANCE), true, 'the camera cannot see its own segment')
  assert.equal(inView(10 + DRAW_DISTANCE - 1, 10, SEGMENTS, DRAW_DISTANCE), true)
  assert.equal(inView(10 + DRAW_DISTANCE, 10, SEGMENTS, DRAW_DISTANCE), false)
  assert.equal(inView(9, 10, SEGMENTS, DRAW_DISTANCE), false, 'the segment just behind counted as visible')
  // Across the seam, which is the case the whole defect lived in.
  assert.equal(inView(5, SEGMENTS - 5, SEGMENTS, DRAW_DISTANCE), true, 'the band does not wrap')
})

console.log('what the handover delivers')

check('a full lap of handover leaves exactly the next lap on the ground', () => {
  // The rolling delivery has to arrive at the same place the whole-lap swap did, or it is a
  // different game rather than the same game without the flicker.
  const { layout } = drive(MAX_ATTAINABLE_SPEED, 1, () => {})
  const expected = indexBySegment(buildLap(TRACK).obstacles, SEGMENTS)
  let mismatched = 0

  for (let i = 0; i < SEGMENTS; i++) {
    const live = (layout.obstacles.get(i) ?? []).map((o) => `${o.kind}:${o.id}`).join('|')
    const want = (expected.get(i) ?? []).map((o) => `${o.kind}:${o.id}`).join('|')

    if (live !== want) mismatched++
  }

  // The last couple of segments are still the previous lap's: the cursor trails by the margin, which
  // is the whole point. Anything more than that is a delivery that lost content.
  assert.ok(mismatched <= HANDOVER_MARGIN + 1, `${mismatched} segments do not hold the lap that was handed over`)
  console.log(`    after one lap, ${SEGMENTS - mismatched} of ${SEGMENTS} segments hold the new lap; the rest are the cursor's own trail`)
})

check('a segment is handed over once per lap, not repeatedly', () => {
  // A cursor that re-wrote what it had already written would put the flicker back where it started,
  // just more often.
  const layout = new LapLayout({ trackLength: TRACK, segmentCount: SEGMENTS, build: buildLap })
  const dt = 1000 / 60
  let distance = 0
  let writes = 0

  while (distance < TRACK) {
    distance += (MAX_ATTAINABLE_SPEED * dt) / 1000
    writes += layout.advance(distance)
  }

  assert.ok(writes <= SEGMENTS, `${writes} handovers in a ${SEGMENTS}-segment lap`)
  assert.ok(writes >= SEGMENTS - 4, `only ${writes} handovers in a lap — segments are being skipped`)
})

check('pickups moved by the magnet stay filed under the segment they moved to', () => {
  const layout = new LapLayout({ trackLength: TRACK, segmentCount: SEGMENTS, build: buildLap })
  const pickup = layout.livePickups()[0]
  const from = Math.floor(pickup.z / SEGMENT_LENGTH) % SEGMENTS
  const toZ = pickup.z + SEGMENT_LENGTH * 3.5
  const to = Math.floor(toZ / SEGMENT_LENGTH) % SEGMENTS

  layout.movePickup(pickup, toZ, 0.1, pickup.y)

  assert.ok(!(layout.pickups.get(from) ?? []).includes(pickup), 'it is still filed under the segment it left')
  assert.ok((layout.pickups.get(to) ?? []).includes(pickup), 'it is not filed under the segment it moved to')
  assert.equal(pickup.z, toZ)
})

console.log(`${passed} checks passed`)
