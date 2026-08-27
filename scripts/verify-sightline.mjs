#!/usr/bin/env node
// Logic check for how a billboard comes out from behind a crest -- src/road/billboard.ts's
// clipping against the running horizon the mesh publishes as `RoadMesh.clipY`. Plain assertions,
// no framework, through the same Node-native-TS loader every other verify script uses.
//
// **This exists because "props pop out of a hill whole" is a claim about a sequence of frames,
// and every check this project had asked about one.** `billboardVisibleFraction` is unit-tested
// against hand-made rectangles and is correct; what nothing measured is whether the clip it is
// handed varies smoothly as the camera moves, which is the only thing that decides whether a
// crown emerges or a whole tree appears.
import assert from 'node:assert/strict'

import {
  CAMERA_DEPTH,
  CAMERA_HEIGHT,
  DECOR_SINK_FRACTION,
  DRAW_DISTANCE,
  ROAD_HILL,
  ROAD_LENGTH,
  ROAD_WIDTH,
  SEGMENT_LENGTH,
  SPRITE_SCALE,
} from '../src/road/constants.ts'
import { SPEED_CAP } from '../src/run/constants.ts'
import { createScreenPoint, projectInto } from '../src/road/project.ts'
import { findSegment, segmentPercent, surfaceHeight, TrackBuilder } from '../src/road/track.ts'
import { billboardRectInto, billboardVisibleFraction, createBillboardRect } from '../src/road/billboard.ts'

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`  ok - ${name}`)
}

const SCREEN = { width: 1568, height: 772 }

/**
 * One frame of the mesh's own walk, far enough to answer what a billboard is clipped by.
 *
 * **A reimplementation, and it has to be one**: `RoadMesh` imports phaser, so nothing that runs
 * under Node can call it. Every line here is the same arithmetic in the same order -- the ride on
 * the surface, the curvature accumulation started at minus the spent fraction, the running `maxY`
 * recorded *before* the cull. If the two ever disagree this check is measuring a road nobody
 * drives on, which is why the check below compares its own ground points against `projectInto`
 * rather than trusting them.
 */
function walk(track, cameraZ) {
  const base = findSegment(track, cameraZ)
  const basePercent = segmentPercent(cameraZ)
  const cameraY = surfaceHeight(base, basePercent) + CAMERA_HEIGHT
  const trackLength = track.length * SEGMENT_LENGTH

  let x = 0
  let dx = -(base.curve * basePercent)
  let maxY = SCREEN.height

  const clipY = new Array(DRAW_DISTANCE).fill(SCREEN.height)
  const ground = new Array(DRAW_DISTANCE).fill(null)

  for (let n = 0; n < DRAW_DISTANCE; n++) {
    const segment = track[(base.index + n) % track.length]
    const looped = segment.index < base.index
    const relativeCameraZ = looped ? cameraZ - trackLength : cameraZ

    const s1 = projectInto(
      createScreenPoint(),
      segment.p1,
      -x,
      cameraY,
      relativeCameraZ,
      CAMERA_DEPTH,
      SCREEN.width,
      SCREEN.height,
      ROAD_WIDTH,
    )
    const s2 = projectInto(
      createScreenPoint(),
      segment.p2,
      -x - dx,
      cameraY,
      relativeCameraZ,
      CAMERA_DEPTH,
      SCREEN.width,
      SCREEN.height,
      ROAD_WIDTH,
    )

    x += dx
    dx += segment.curve

    // Recorded for EVERY segment and BEFORE the cull, which is the whole point of the channel: a
    // culled segment is precisely the interesting case, because it is culled by the hill that
    // must also hide whatever stands on it.
    clipY[n] = maxY
    ground[n] = s1

    if (!Number.isFinite(s1.scale) || s1.scale <= 0 || s2.y >= s1.y || s2.y >= maxY) continue

    maxY = s2.y
  }

  return { base, clipY, ground }
}

/** What `RoadSprites` would draw for a prop of `height` texture pixels standing on segment `n`. */
function propAt(track, cameraZ, absoluteSegment, texturePx) {
  const { base, clipY, ground } = walk(track, cameraZ)
  const n = absoluteSegment - base.index

  if (n < 0 || n >= DRAW_DISTANCE) return null

  const point = ground[n]

  if (!point || !Number.isFinite(point.scale) || point.scale <= 0) return null

  const rect = billboardRectInto(
    createBillboardRect(),
    point,
    0.9,
    // The same one-directional bias `RoadSprites` applies, so the base sits where it is drawn.
    -texturePx * DECOR_SINK_FRACTION,
    texturePx,
    texturePx,
    SCREEN.width,
    SCREEN.height,
  )

  return {
    clip: clipY[n],
    /** Screen y of the base and of the crown. Smaller y is higher up the frame. */
    baseY: rect.y,
    topY: rect.y - rect.h,
    height: rect.h,
    visible: billboardVisibleFraction(rect, clipY[n]),
  }
}

/** A crest steep enough that things genuinely disappear behind it, then a flat run beyond. */
function hillTrack() {
  return new TrackBuilder()
    .addStraight(ROAD_LENGTH.SHORT)
    .addHill(ROAD_LENGTH.MEDIUM, ROAD_HILL.HIGH)
    .addStraight(ROAD_LENGTH.LONG)
    .build()
}

console.log('src/road/billboard.ts -- coming out from behind a crest')

check('a tall prop emerges crown first: there is a run of frames with its top visible and its base not', () => {
  // **The acceptance, stated as the sequence it is about rather than as one frame.** A prop whose
  // base is still behind the hill but whose crown has cleared it MUST be drawn, and drawn cropped
  // from the top. If that window is empty, the prop's first drawn frame is its whole self, which
  // is the "pops out" report.
  const track = hillTrack()
  const texturePx = 64
  const target = 140

  let crownOnly = 0
  let drawnInCrownOnly = 0
  let firstDrawnFraction = null
  const swept = []

  for (let z = 0; z < target * SEGMENT_LENGTH; z += SEGMENT_LENGTH / 8) {
    const prop = propAt(track, z, target, texturePx)

    if (!prop) continue

    const topClear = prop.topY < prop.clip
    const baseClear = prop.baseY < prop.clip

    if (topClear && !baseClear) {
      crownOnly += 1
      if (prop.visible > 0) drawnInCrownOnly += 1
    }
    swept.push({ z, visible: prop.visible })
    if (prop.visible > 0 && firstDrawnFraction === null) firstDrawnFraction = prop.visible
  }

  // The LAST time it goes from hidden to whole, not the first time it is drawn at all: the prop
  // is already in view long before the hill, disappears behind the crest as the camera closes, and
  // it is that re-emergence the report is about. Measuring from the first drawn frame instead
  // spans the whole approach and reports four seconds, which is a number about nothing.
  let emergeFrom = null
  let emergeTo = null

  for (let i = 1; i < swept.length; i++) {
    if (swept[i].visible > 0 && swept[i - 1].visible === 0) emergeFrom = swept[i].z
    if (emergeFrom !== null && emergeTo === null && swept[i].visible >= 0.95) emergeTo = swept[i].z
    if (swept[i].visible === 0) emergeTo = null
  }

  const units = emergeFrom !== null && emergeTo !== null ? emergeTo - emergeFrom : 0

  assert.ok(crownOnly > 0, 'the fixture never puts the crown clear of the crest while the base is behind it -- this hill is not steep enough to test anything')
  assert.equal(
    drawnInCrownOnly,
    crownOnly,
    `the prop is skipped in ${crownOnly - drawnInCrownOnly} of the ${crownOnly} frames where its crown is clear of the crest and its base is not`,
  )
  assert.ok(
    firstDrawnFraction < 0.5,
    `the first frame the prop is drawn in already shows ${(firstDrawnFraction * 100).toFixed(0)}% of it -- it appears rather than emerges`,
  )

  // **How long the whole emergence lasts, which is the number the report is actually about.** The
  // mechanism is correct and the window is short: a prop this far out is a few dozen pixels tall,
  // so the horizon sweeps its whole height in a fraction of a second. Printed rather than
  // asserted, because it is a property of the projection and the speed rather than a defect --
  // what it explains is why a correct crop still reads as a pop when nothing softens the arrival.


  console.log(
    `    ${crownOnly} of the swept frames show crown-but-not-base, all drawn; first drawn frame shows ${(firstDrawnFraction * 100).toFixed(1)}% of the prop`,
  )
  if (units > 0) {
    console.log(
      `    last emergence from hidden to 95% clear: ${units.toFixed(0)} world units = ${(units / SPEED_CAP).toFixed(2)}s at SPEED_CAP, i.e. ${Math.round((units / SPEED_CAP) * 60)} frames at 60Hz`,
    )
  }
})

check('the crop is a continuous function of depth: it slides, it does not step', () => {
  // **The second half of the report, and the one that needs a sweep rather than a frame.** The
  // clip a prop is measured against is the running horizon of the segments nearer than its own,
  // and it is sampled at the prop's own segment index -- so the worry is that crossing a segment
  // boundary swaps one step of a staircase for the next and the crop jumps.
  //
  // **⚠ The first version of this check measured the wrong thing and failed on correct code.** It
  // bounded the FIRST difference, and a prop emerging over a steep crest legitimately moves fast:
  // 28 screen pixels tall with the horizon sliding a pixel every six world units is 7% of its own
  // height per 12 units, which is emergence, not a step. What separates a ramp from a staircase is
  // the SECOND difference -- a straight ramp has none, a staircase spikes at every boundary.
  const track = hillTrack()
  const texturePx = 64
  const target = 140
  const step = SEGMENT_LENGTH / 16

  const samples = []

  for (let z = 0; z < target * SEGMENT_LENGTH; z += step) {
    const prop = propAt(track, z, target, texturePx)

    if (prop && prop.visible > 0 && prop.visible < 1) samples.push({ z, visible: prop.visible })
  }

  assert.ok(samples.length > 40, `only ${samples.length} partially-clipped samples -- nothing to measure`)

  const jerk = (series) => {
    let worst = 0
    let at = 0

    for (let i = 2; i < series.length; i++) {
      const second = Math.abs(series[i].visible - 2 * series[i - 1].visible + series[i - 2].visible)

      if (second > worst) {
        worst = second
        at = series[i].z
      }
    }

    return { worst, at }
  }

  const real = jerk(samples)
  // A staircase built from the same samples, quantised to one value per segment -- which is what
  // the clip would look like if it were sampled per segment rather than recomputed per frame.
  const stepped = jerk(
    samples.map((sample, i) => ({
      z: sample.z,
      visible: samples[Math.floor(i / 16) * 16].visible,
    })),
  )

  assert.ok(
    real.worst < stepped.worst / 4,
    `the crop's second difference is ${(real.worst * 100).toFixed(3)}% against ${(stepped.worst * 100).toFixed(3)}% for a per-segment staircase -- it is stepping`,
  )
  // And the control has to be a staircase, or the comparison above proves nothing.
  assert.ok(stepped.worst > 0.02, 'the synthetic staircase is not stepping, so this check is measuring nothing')

  console.log(
    `    worst second difference ${(real.worst * 100).toFixed(3)}% of the prop's height at z=${real.at.toFixed(0)}; a per-segment staircase over the same sweep gives ${(stepped.worst * 100).toFixed(2)}%`,
  )
})

check('a taller prop clears the crest earlier than a short one standing beside it', () => {
  // The property the report is really about: height has to buy visibility. If both appear at the
  // same camera position then the clip is being applied to the ground point rather than to the
  // billboard, and nothing about a prop's own size reaches the decision.
  const track = hillTrack()
  const target = 140

  const firstVisible = (texturePx) => {
    for (let z = 0; z < target * SEGMENT_LENGTH; z += SEGMENT_LENGTH / 8) {
      const prop = propAt(track, z, target, texturePx)

      if (prop && prop.visible > 0) return z
    }

    return Infinity
  }

  const tall = firstVisible(96)
  const short = firstVisible(24)

  assert.ok(Number.isFinite(tall) && Number.isFinite(short), 'one of the two props is never drawn at all')
  assert.ok(
    tall < short,
    `a 96px prop and a 24px prop both first appear at z=${tall.toFixed(0)} -- height buys no visibility, so the clip is being applied to the ground rather than to the billboard`,
  )

  console.log(
    `    a 96px prop clears the crest at z=${tall.toFixed(0)}, a 24px one at z=${short.toFixed(0)}: ${((short - tall) / SEGMENT_LENGTH).toFixed(1)} segments of head start`,
  )
})

console.log(`${passed} checks passed`)
