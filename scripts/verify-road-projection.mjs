#!/usr/bin/env node
// Logic check for the pseudo-3D road's pure math -- src/road/project.ts (perspective
// projection and track-loop wrapping), src/road/track.ts (segment lookup) and the palette
// UV helper in src/road/constants.ts. None of those import phaser, which is exactly what
// makes them runnable here: a value import of phaser executes its init code, which reads
// `window`. Plain assertions, no framework, via the register-ts-loader.mjs +
// ts-extensionless-loader.mjs Node-native-TS setup -- same shape as verify-scroll-momentum.mjs.
import assert from 'node:assert/strict'

import {
  readsAsSame,
  tintFor,
  VARIATION,
  variationFor,
} from '../src/road/decorVariation.ts'
import { createScreenPoint, project, wrapZ } from '../src/road/project.ts'
import { createRungQuad, rungQuadInto } from '../src/road/surface.ts'
import {
  alignSegmentCount,
  buildStraightTrack,
  decorateTrack,
  easeInOut,
  findSegment,
  interpolate,
  segmentPercent,
  surfaceHeight,
  trackLengthOf,
  TrackBuilder,
} from '../src/road/track.ts'
import {
  billboardOnScreen,
  billboardRectInto,
  billboardVisibleFraction,
  createBillboardRect,
} from '../src/road/billboard.ts'
import { createRng, randomItem, randomRange } from '../src/race/rng.ts'
import { DECOR_KEYS as DECOR_KEYS_LIVE, DECOR_TEXTURES } from '../src/road/decorShapes.ts'
import {
  blendColor,
  DEFAULT_ROAD_THEME,
  getRoadTheme,
  getRoadThemeId,
  setRoadTheme,
  THEMES,
  themeIds,
  THREAT_COLOR,
  THREAT_LIGHTNESS_ESCAPE,
  THREAT_MIN_CHROMA,
  THREAT_MIN_HUE_DEGREES,
} from '../src/road/themes.ts'
import { chroma, contrastRatio, deltaE, fromOklab, hueDistance, multiplyTint, relativeLuminance, toOklab } from '../src/road/color.ts'
import { KIT } from '../src/ui/kitPalette.ts'

/**
 * How far, in OKLab hue degrees, anything hostile has to sit from the player's own craft.
 *
 * The same 30 the threat reservation uses, for the same reason: it is roughly where two colours
 * stop being confusable at a glance. The five clean themes are 122-169 away, so this is a floor
 * nobody is scraping.
 */
const MIN_HOSTILE_HUE_GAP = 30
import { quadWriteAction } from '../src/road/meshGuard.ts'
import { BIOMES, BIOME_IDS, biomeById, biomeForSegment, biomeIndexForSegment, biomeIndex, biomeRunSegments, MIN_BIOME_RUN_SEGMENTS, groundPairForTheme, MIN_GROUND_CONTRAST, GROUND_ALTERNATION, setBiomeLayout, skylineBiomeTint, SKYLINE_SEAM_BLEND_SEGMENTS, GROUND_SHADES_PER_BIOME, GROUND_SHADE_SPREAD, groundShadesForTheme, groundShadeFor, GROUND_PATCH_SEGMENTS, GROUND_PATCH_MIN_SEGMENTS, GROUND_PATCH_MAX_SEGMENTS } from '../src/road/biomes.ts'
import {
  SUN,
  sunCenterX,
  SUN_CORE_STOP,
  SUN_CORE_WHITEN,
  SUN_RIM_WHITEN,
  SUN_DISC_STOP,
  SUN_RAYS,
  sunRay,
  BIOME_SKYLINE_WEIGHT,
  CAMERA_DEPTH,
  CAMERA_HEIGHT,
  hasRung,
  DECOR,
  DECOR_TIERS,
  GROUND_EXTENT,
  PALETTE_INDEX,
  RUMBLE_WIDTH_FRACTION,
  TRACK_RUNG,
  ROAD_CURVE,
  ROAD_HILL,
  ROAD_LENGTH,
  ROAD_PALETTE,
  ROAD_WIDTH,
  RUMBLE_LENGTH,
  DRAW_DISTANCE,
  FOG_STEPS,
  PALETTE_COLUMNS,
  groundPaletteIndex,
  HORIZON_Y,
  fogStepFor,
  billboardFog,
  MAX_BILLBOARD_FOG,
  paletteV,
  SEGMENT_LENGTH,
  SPRITE_SCALE,
  TRACK_SEGMENT_COUNT,
  paletteU,
  SKYLINE_LAYER,
  SKYLINE_TEXTURE_SIZE,
} from '../src/road/constants.ts'
import { buildMenuCircuit, buildRunCircuit } from '../src/road/circuits.ts'
import { sweepEngagement } from '../src/road/sightline.ts'
import { MAX_ATTAINABLE_SPEED, SPEED_CAP } from '../src/run/constants.ts'

/**
 * How far ahead an obstacle is placed, in segments.
 *
 * The rail shooter took this from `WAVE_SPAWN_AHEAD_Z`, which died with the wave system. The
 * number is unchanged because what it measures is unchanged: how far down the track the sweep
 * puts a thing before asking how long the corner lets you look at it.
 */
const SPAWN_AHEAD_SEGMENTS = 200

/**
 * The least sightline the circuit must leave, in **world units**.
 *
 * **Restated from seconds into distance by the fork, and that is a correction rather than a
 * translation.** The rail shooter wrote this as "5 seconds at `RAIL_SPEED`", which is a claim
 * about the *track's geometry* wearing the units of the speed it happened to be driven at -- so
 * moving to the runner's slower `SPEED_CAP` silently inflated the floor by 67% and the negative
 * control below stopped rejecting the bend it was written to reject. 5s x 6000 units/s = 30000
 * units is the same statement with the speed divided back out, and it now says what it always
 * meant: **a corner may not hide more than 150 segments of the road from itself.**
 *
 * What it is *not* is a difficulty knob. The reading budget an obstacle needs is `REACTION_MS`,
 * measured against what is actually standing on the road -- see `verify:obstacles`.
 */
const MIN_SIGHTLINE_UNITS = 30000

/** The same floor in seconds, at whatever speed a sweep is run at. */
const minEngagementSeconds = (speed) => MIN_SIGHTLINE_UNITS / speed

import {
  ATMOSPHERE_ALPHA,
  BIOME_ATMOSPHERE,
  MOTE_LIFESPAN_MS,
  MOTE_POOL_SIZE,
  MOTE_SHAPES,
  atmosphereFor,
  usedMoteShapes,
} from '../src/road/particles.ts'
import {
  DECAL_DRAW_SEGMENTS,
  DECAL_HALF_WIDTH,
  DECAL_KINDS,
  DECAL_LENGTH_SEGMENTS,
  DECAL_MAX_OFFSET,
  DECAL_ROW_ALPHAS,
  DECAL_POOL_SIZE as MAX_DECALS,
  decalAt,
  decalFade,
  decalRowFor,
  decalsIn,
} from '../src/road/decals.ts'

let passed = 0
function check(name, fn) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

const WIDTH = 1024
const HEIGHT = 768
const CAMERA_Y = 1000

// project(point, cameraX, cameraY, cameraZ, cameraDepth, screenWidth, screenHeight, roadWidth)
function projectAhead(z, { x = 0, y = 0, cameraX = 0, cameraZ = 0 } = {}) {
  return project({ x, y, z }, cameraX, CAMERA_Y, cameraZ, CAMERA_DEPTH, WIDTH, HEIGHT, ROAD_WIDTH)
}

console.log('src/road/project.ts checks')

check('project: a point on the road centreline lands exactly on the horizontal centre of the screen', () => {
  const p = projectAhead(1000)
  assert.equal(p.x, WIDTH / 2)
  // ...and stays there at any distance -- the centreline IS the vanishing point.
  assert.equal(projectAhead(50).x, WIDTH / 2)
  assert.equal(projectAhead(100000).x, WIDTH / 2)
})

check('project: a point level with the camera lands exactly on HORIZON_Y, at any distance and any viewport', () => {
  // At the camera's own height the projected y is exactly the horizon row regardless of
  // distance -- that term is the whole vanishing point, and everything else scales away.
  const level = project({ x: 0, y: CAMERA_Y, z: 5000 }, 0, CAMERA_Y, 0, CAMERA_DEPTH, WIDTH, HEIGHT, ROAD_WIDTH)
  assert.equal(level.y, HEIGHT * HORIZON_Y)
  // Road-level points (y = 0) sit below it, and approach it as distance grows -- which is
  // what makes the vanishing point land dead centre of whatever viewport is passed in.
  const near = projectAhead(1000)
  const far = projectAhead(100000)
  assert.ok(near.y > HEIGHT * HORIZON_Y, `near y ${near.y} should be below the horizon`)
  assert.ok(far.y > HEIGHT * HORIZON_Y && far.y < near.y, `far y ${far.y} should be between the horizon and ${near.y}`)

  // Every viewport, portrait included: the horizon is a *fraction*, so it must not drift with
  // aspect. Sub-pixel exactness, not a tolerance -- the term is a plain multiplication and any
  // error here would mean something else had crept into it.
  for (const [w, h] of [[1920, 1080], [390, 844], [844, 390], [2560, 1080], [768, 1024]]) {
    const atInfinity = project({ x: 0, y: CAMERA_Y, z: 1e9 }, 0, CAMERA_Y, 0, CAMERA_DEPTH, w, h, ROAD_WIDTH)
    assert.equal(atInfinity.y, h * HORIZON_Y, `horizon drifted at ${w}x${h}`)
  }
})

check('HORIZON_Y leaves the ground a real share of the frame, and the sky more than it', () => {
  // The point of raising it: the far field is where everything happens, and it was being given
  // a third of the screen while flat near ground took the rest. Guards against a later edit
  // quietly pushing it back toward centre (or past the point where there is any ground at all).
  assert.ok(HORIZON_Y > 0.5, `HORIZON_Y ${HORIZON_Y} gives the sky less than half the frame`)
  assert.ok(HORIZON_Y < 0.8, `HORIZON_Y ${HORIZON_Y} leaves too little ground to read speed on`)
})

check('project: doubling the distance halves both scale and projected road width', () => {
  const near = projectAhead(1000)
  const far = projectAhead(2000)
  assert.ok(Math.abs(far.scale - near.scale / 2) < 1e-12, `${far.scale} vs ${near.scale / 2}`)
  assert.ok(Math.abs(far.w - near.w / 2) < 1e-9, `${far.w} vs ${near.w / 2}`)
  // The perspective divide is the only thing at work: scale is exactly cameraDepth / distance.
  assert.ok(Math.abs(near.scale - CAMERA_DEPTH / 1000) < 1e-15)
})

check('project: the camera position is subtracted, not ignored -- z is relative', () => {
  const absolute = projectAhead(3000, { cameraZ: 2000 })
  const relative = projectAhead(1000, { cameraZ: 0 })
  assert.equal(absolute.scale, relative.scale)
  assert.equal(absolute.y, relative.y)
  // Off-centre camera shifts the point the opposite way on screen.
  const offset = projectAhead(1000, { cameraX: ROAD_WIDTH / 2 })
  assert.ok(offset.x < WIDTH / 2, `camera moved right, so the centreline must project left of centre (got ${offset.x})`)
})

check('project: a point behind the camera yields a negative scale', () => {
  const behind = projectAhead(500, { cameraZ: 1000 })
  assert.ok(behind.scale < 0, `expected a negative scale, got ${behind.scale}`)
  assert.ok(behind.w < 0)
})

check('project: a point exactly on the camera plane yields a non-finite scale, not a negative one', () => {
  // The renderer's cull must test finiteness as well as sign: this case is reachable on the
  // very first frame, where cameraZ is 0 and the base segment's near edge is also 0. A naive
  // `scale > 0` test passes here and writes NaN coordinates into the vertex buffer.
  const onPlane = projectAhead(1000, { cameraZ: 1000 })
  assert.ok(!Number.isFinite(onPlane.scale), `expected a non-finite scale, got ${onPlane.scale}`)
  assert.ok(onPlane.scale > 0, 'and it is positive infinity, so a sign-only cull would let it through')
})

check('project: screen size is a pure input -- the vanishing point tracks the viewport, no fixed logical resolution', () => {
  for (const [w, h] of [[1920, 1080], [390, 844], [844, 390]]) {
    const p = project({ x: 0, y: 0, z: 4000 }, 0, CAMERA_Y, 0, CAMERA_DEPTH, w, h, ROAD_WIDTH)
    assert.equal(p.x, w / 2, `vanishing point off-centre at ${w}x${h}`)
    assert.ok(p.y > h * HORIZON_Y && p.y < h, `road at ${w}x${h} should project between the horizon and the bottom edge, got ${p.y}`)
  }
})

console.log('wrapZ checks')

check('wrapZ: values already inside the track are returned unchanged', () => {
  assert.equal(wrapZ(0, 1000), 0)
  assert.equal(wrapZ(1, 1000), 1)
  assert.equal(wrapZ(999.5, 1000), 999.5)
})

check('wrapZ: values past the end wrap around, including several laps past it', () => {
  assert.equal(wrapZ(1000, 1000), 0)
  assert.equal(wrapZ(1250, 1000), 250)
  assert.equal(wrapZ(7250, 1000), 250)
})

check('wrapZ: negative values wrap to the END of the track, not to zero', () => {
  assert.equal(wrapZ(-1, 1000), 999)
  assert.equal(wrapZ(-1000, 1000), 0)
  assert.equal(wrapZ(-2500, 1000), 500)
  // -0 must normalise to +0: assert.equal is strict, and Object.is(-0, 0) is false.
  assert.equal(wrapZ(-0, 1000), 0)
})

check('wrapZ: works at a realistic full-track length, not just round numbers', () => {
  const trackLength = trackLengthOf(500) // 100000
  assert.equal(wrapZ(trackLength, trackLength), 0)
  assert.equal(wrapZ(trackLength + 0.5, trackLength), 0.5)
  assert.equal(wrapZ(-0.5, trackLength), trackLength - 0.5)
})

check('wrapZ: a zero or negative track length is defended against rather than producing NaN', () => {
  assert.equal(wrapZ(123, 0), 0)
  assert.equal(wrapZ(123, -1), 0)
})

console.log('src/road/track.ts checks')

check('buildStraightTrack: segments are contiguous, indexed from zero, and flat', () => {
  const track = buildStraightTrack(12)
  assert.equal(track.length, 12)
  for (let i = 0; i < track.length; i++) {
    assert.equal(track[i].index, i)
    assert.equal(track[i].p1.z, i * SEGMENT_LENGTH)
    assert.equal(track[i].p2.z, (i + 1) * SEGMENT_LENGTH)
    assert.equal(track[i].p1.x, 0)
    assert.equal(track[i].p1.y, 0)
    assert.equal(track[i].p2.y, 0)
    if (i > 0) assert.equal(track[i].p1.z, track[i - 1].p2.z, 'no gap between segments')
  }
})

check('buildStraightTrack: alternate flips every RUMBLE_LENGTH segments, starting true', () => {
  const track = buildStraightTrack(12)
  assert.equal(track[0].alternate, true)
  assert.equal(track[2].alternate, true)
  assert.equal(track[3].alternate, false)
  assert.equal(track[5].alternate, false)
  assert.equal(track[6].alternate, true)
})

check('the rumble band pattern tiles across the loop seam -- no stripe-rhythm stutter once per lap', () => {
  // The band running into the seam must be a different colour from the one leaving it, or
  // the stripes visibly stutter each lap. That holds only when the segment count is a whole
  // number of light/dark cycles, which is what alignSegmentCount guarantees.
  const cycle = RUMBLE_LENGTH * 2
  assert.equal(alignSegmentCount(500), 504)
  assert.equal(alignSegmentCount(504), 504, 'already-aligned counts are left alone')
  assert.equal(alignSegmentCount(1), cycle)

  const track = buildStraightTrack(TRACK_SEGMENT_COUNT)
  assert.equal(track.length % cycle, 0, 'a built track is always a whole number of rumble cycles')
  assert.notEqual(
    track[track.length - 1].alternate,
    track[0].alternate,
    'the last and first segments must not share a band colour -- that is the seam stutter',
  )

  // And the pattern is genuinely periodic: every segment matches the one a full cycle back.
  for (let i = cycle; i < track.length; i++) {
    assert.equal(track[i].alternate, track[i - cycle].alternate, `band pattern broke at segment ${i}`)
  }
})

check('findSegment: returns the segment whose [p1.z, p2.z) range contains z, boundaries included', () => {
  const track = buildStraightTrack(500)
  for (const segment of [track[0], track[1], track[137], track[track.length - 1]]) {
    assert.equal(findSegment(track, segment.p1.z).index, segment.index, 'lower boundary belongs to this segment')
    assert.equal(findSegment(track, segment.p1.z + SEGMENT_LENGTH / 2).index, segment.index, 'midpoint')
    assert.equal(findSegment(track, segment.p2.z - 1e-6).index, segment.index, 'just short of the upper boundary')
    // The upper boundary belongs to the NEXT segment -- ranges are half-open, so no z ever
    // matches two segments.
    assert.equal(findSegment(track, segment.p2.z).index, (segment.index + 1) % track.length)
  }
})

check('findSegment: wraps rather than running off either end of the array', () => {
  const track = buildStraightTrack(500)
  const trackLength = trackLengthOf(track.length)
  assert.equal(findSegment(track, trackLength).index, 0)
  assert.equal(findSegment(track, trackLength + SEGMENT_LENGTH).index, 1)
  const last = track.length - 1
  assert.equal(findSegment(track, -1).index, last)
  assert.equal(findSegment(track, -SEGMENT_LENGTH).index, last)
  // Every z across two full laps must resolve to a real segment.
  for (let z = -trackLength; z < trackLength * 2; z += SEGMENT_LENGTH / 3) {
    const segment = findSegment(track, z)
    assert.ok(segment, `no segment for z=${z}`)
    const wrapped = wrapZ(z, trackLength)
    assert.ok(
      wrapped >= segment.p1.z && wrapped < segment.p2.z,
      `z=${z} (wrapped ${wrapped}) resolved to segment ${segment.index} spanning [${segment.p1.z}, ${segment.p2.z})`,
    )
  }
})

console.log('easing checks')

check('easeInOut: bit-exact at both ends, and the midpoint to within floating-point noise', () => {
  // The ends are exact, and that is the property the loop-closing assert depends on:
  // Math.cos(Math.PI) is exactly -1, so the ease factor is exactly 1 and `a + (b - a)`
  // cancels to exactly b.
  assert.equal(easeInOut(0, 100, 0), 0)
  assert.equal(easeInOut(0, 100, 1), 100)
  assert.equal(easeInOut(-7331.5, 0, 1), 0)
  assert.equal(easeInOut(1234.567, 1234.567, 1), 1234.567)

  // The midpoint cannot be bit-exact: Math.cos(Math.PI / 2) is 6.1e-17 rather than 0, so the
  // factor lands one ulp under 0.5. Nothing depends on exactness here, unlike at the ends.
  assert.ok(Math.abs(easeInOut(0, 100, 0.5) - 50) < 1e-12, `midpoint was ${easeInOut(0, 100, 0.5)}`)
})

check('easeInOut: symmetric about the midpoint', () => {
  for (const p of [0.1, 0.25, 0.4, 0.49]) {
    const below = easeInOut(0, 100, p)
    const above = easeInOut(0, 100, 1 - p)
    assert.ok(Math.abs(below + above - 100) < 1e-12, `${below} and ${above} should sum to 100`)
  }
})

check('easeInOut: the derivative vanishes at both ends -- this is what makes a hill a hill, not a crease', () => {
  // A linear ramp would meet the flat road either side with a discontinuous slope, which
  // renders as a visible crease at the section boundary. The ease must arrive flat.
  const slopeAtStart = (h) => (easeInOut(0, 100, h) - easeInOut(0, 100, 0)) / h
  const slopeAtEnd = (h) => (easeInOut(0, 100, 1) - easeInOut(0, 100, 1 - h)) / h

  const h = 1e-4
  const middle = (easeInOut(0, 100, 0.5 + h) - easeInOut(0, 100, 0.5 - h)) / (2 * h)

  // Negligible against the section's own steepest slope (pi/2 * 100 ~ 157) rather than
  // against an absolute epsilon -- "flat" only means anything relative to the rest.
  assert.ok(middle > 150, `mid slope ${middle} should be the steepest part of the ease`)
  assert.ok(Math.abs(slopeAtStart(h)) < middle / 1000, `start slope ${slopeAtStart(h)} is not negligible vs ${middle}`)
  assert.ok(Math.abs(slopeAtEnd(h)) < middle / 1000, `end slope ${slopeAtEnd(h)} is not negligible vs ${middle}`)

  // The decisive check: a *forward difference* at a genuinely zero derivative is O(h), so
  // halving h must halve the measured slope. A small-but-nonzero derivative would instead
  // converge on a constant, and no single fixed epsilon could tell the two apart.
  for (const [coarse, fine] of [[h, h / 2], [h / 2, h / 4]]) {
    assert.ok(
      Math.abs(slopeAtStart(fine) / slopeAtStart(coarse) - 0.5) < 0.01,
      `start slope did not halve with h: ${slopeAtStart(coarse)} -> ${slopeAtStart(fine)}`,
    )
    assert.ok(
      Math.abs(slopeAtEnd(fine) / slopeAtEnd(coarse) - 0.5) < 0.01,
      `end slope did not halve with h: ${slopeAtEnd(coarse)} -> ${slopeAtEnd(fine)}`,
    )
  }
})

check('interpolate / segmentPercent / surfaceHeight', () => {
  assert.equal(interpolate(10, 20, 0), 10)
  assert.equal(interpolate(10, 20, 1), 20)
  assert.equal(interpolate(10, 20, 0.25), 12.5)

  assert.equal(segmentPercent(0), 0)
  assert.equal(segmentPercent(SEGMENT_LENGTH / 2), 0.5)
  assert.equal(segmentPercent(SEGMENT_LENGTH), 0)
  assert.equal(segmentPercent(SEGMENT_LENGTH * 3.25), 0.25)
  // Negative z must wrap into the segment, not produce a negative percent -- a negative
  // percent would place the camera below the road surface.
  assert.equal(segmentPercent(-SEGMENT_LENGTH / 4), 0.75)

  const segment = { p1: { x: 0, y: 100, z: 0 }, p2: { x: 0, y: 300, z: SEGMENT_LENGTH } }
  assert.equal(surfaceHeight(segment, 0), 100)
  assert.equal(surfaceHeight(segment, 1), 300)
  assert.equal(surfaceHeight(segment, 0.5), 200)
})

console.log('TrackBuilder checks')

// Every combination below must produce a loopable track. Kept as a table so a new section
// type only needs one row here.
const SECTION_COMBINATIONS = [
  ['straight only', (b) => b.addStraight(ROAD_LENGTH.LONG)],
  ['single curve', (b) => b.addCurve(ROAD_LENGTH.MEDIUM, ROAD_CURVE.HARD)],
  ['single hill, never brought back down by hand', (b) => b.addHill(ROAD_LENGTH.MEDIUM, ROAD_HILL.HIGH)],
  ['single downhill', (b) => b.addHill(ROAD_LENGTH.MEDIUM, -ROAD_HILL.MEDIUM)],
  ['curve with a hill on it', (b) => b.addCurve(ROAD_LENGTH.LONG, -ROAD_CURVE.MEDIUM, ROAD_HILL.LOW)],
  ['s-curve', (b) => b.addSCurve()],
  ['low rolling hills', (b) => b.addLowRollingHills()],
  ['the RailScene circuit', (b) => b.addStraight(ROAD_LENGTH.LONG).addCurve(ROAD_LENGTH.MEDIUM, ROAD_CURVE.HARD).addLowRollingHills().addSCurve()],
  ['hills stacked without any straight between them', (b) => b.addHill(ROAD_LENGTH.SHORT, ROAD_HILL.LOW).addHill(ROAD_LENGTH.SHORT, ROAD_HILL.LOW).addHill(ROAD_LENGTH.SHORT, ROAD_HILL.HIGH)],
]

check('build(): every section combination closes back to height zero at the loop seam', () => {
  for (const [name, compose] of SECTION_COMBINATIONS) {
    const track = compose(new TrackBuilder()).build()
    const last = track[track.length - 1]
    // The assert build() makes internally, restated here so a regression names the case.
    assert.ok(Math.abs(last.p2.y) < 0.01, `"${name}" ends at y=${last.p2.y}, expected ~0`)
    assert.equal(track[0].p1.y, 0, `"${name}" does not start at y=0`)
  }
})

check('build(): segment indices are contiguous from zero and z is gapless', () => {
  for (const [name, compose] of SECTION_COMBINATIONS) {
    const track = compose(new TrackBuilder()).build()
    for (let i = 0; i < track.length; i++) {
      assert.equal(track[i].index, i, `"${name}" index broke at ${i}`)
      assert.equal(track[i].p1.z, i * SEGMENT_LENGTH, `"${name}" p1.z broke at ${i}`)
      assert.equal(track[i].p2.z, (i + 1) * SEGMENT_LENGTH, `"${name}" p2.z broke at ${i}`)
    }
  }
})

check('build(): the road surface is continuous -- every segment starts where the last one ended', () => {
  for (const [name, compose] of SECTION_COMBINATIONS) {
    const track = compose(new TrackBuilder()).build()
    for (let i = 1; i < track.length; i++) {
      assert.equal(track[i].p1.y, track[i - 1].p2.y, `"${name}" has a vertical step at segment ${i}`)
    }
    // ...including across the loop seam itself, which is the whole point of closing to zero.
    assert.equal(track[track.length - 1].p2.y, track[0].p1.y, `"${name}" steps vertically at the seam`)
  }
})

check('build(): every track is still a whole number of rumble cycles', () => {
  const cycle = RUMBLE_LENGTH * 2
  for (const [name, compose] of SECTION_COMBINATIONS) {
    const track = compose(new TrackBuilder()).build()
    assert.equal(track.length % cycle, 0, `"${name}" is ${track.length} segments, not a whole cycle`)
    assert.notEqual(track[track.length - 1].alternate, track[0].alternate, `"${name}" stutters the rumble band at the seam`)
  }
})

check('build(): the closing section is only added when the sections actually left the road off zero', () => {
  // A self-closing composition must not be padded with a whole spurious closing section --
  // only up to the next rumble cycle.
  const rolling = new TrackBuilder().addLowRollingHills(ROAD_LENGTH.SHORT * 3, ROAD_HILL.LOW).build()
  assert.equal(rolling.length, alignSegmentCount(ROAD_LENGTH.SHORT * 3 * 6))

  // ...whereas an unclosed hill must be, and by enough segments to keep the descent gentle.
  const hill = new TrackBuilder().addHill(ROAD_LENGTH.MEDIUM, ROAD_HILL.HIGH).build()
  assert.ok(hill.length > ROAD_LENGTH.MEDIUM + ROAD_HILL.HIGH, `expected a real closing section, got ${hill.length} segments total`)
})

check('build(): curve is stored on the segment verbatim, and never baked into x', () => {
  const track = new TrackBuilder()
    .addStraight(ROAD_LENGTH.SHORT)
    .addCurve(ROAD_LENGTH.SHORT, ROAD_CURVE.HARD)
    .addCurve(ROAD_LENGTH.SHORT, -ROAD_CURVE.EASY)
    .build()

  for (let i = 0; i < ROAD_LENGTH.SHORT; i++) assert.equal(track[i].curve, ROAD_CURVE.NONE)
  for (let i = ROAD_LENGTH.SHORT; i < ROAD_LENGTH.SHORT * 2; i++) assert.equal(track[i].curve, ROAD_CURVE.HARD)
  for (let i = ROAD_LENGTH.SHORT * 2; i < ROAD_LENGTH.SHORT * 3; i++) assert.equal(track[i].curve, -ROAD_CURVE.EASY)

  // x stays zero on every segment: lateral shape is integrated at render time, not authored.
  for (const segment of track) {
    assert.equal(segment.p1.x, 0)
    assert.equal(segment.p2.x, 0)
  }
})

check('build(): a hill rises smoothly, with no step bigger than the steepest eased step', () => {
  const length = ROAD_LENGTH.MEDIUM * 3
  const height = ROAD_HILL.MEDIUM
  const track = new TrackBuilder().addHill(length, height).build()

  const rise = height * SEGMENT_LENGTH
  // The cosine ease peaks at pi/2 times the mean step; allow a hair over for rounding.
  const steepestAllowed = ((rise / length) * Math.PI) / 2 + 1e-6

  let peak = 0
  for (let i = 0; i < length; i++) {
    const step = track[i].p2.y - track[i].p1.y
    assert.ok(step >= -1e-9, `hill dipped at segment ${i} (step ${step})`)
    assert.ok(step <= steepestAllowed, `step ${step} at segment ${i} exceeds the eased maximum ${steepestAllowed}`)
    peak = Math.max(peak, track[i].p2.y)
  }
  assert.ok(Math.abs(peak - rise) < 1e-6, `hill peaked at ${peak}, expected ${rise}`)
})

check('build(): rejects an empty track instead of returning one that crashes findSegment later', () => {
  assert.throws(() => new TrackBuilder().build(), /empty/)
})

console.log('palette UV checks')

check('paletteU: samples the exact centre of texel i, never an edge', () => {
  // The strip is the road's own colours followed by two ground shades per biome, so the count is
  // derived from both. Asserted rather than assumed: a mismatch here samples a quad off the end
  // of the texture, which reads as scenery-coloured asphalt rather than as an error.
  const count = PALETTE_COLUMNS

  assert.equal(
    count,
    ROAD_PALETTE.length + BIOMES.length * GROUND_SHADES_PER_BIOME,
    'PALETTE_COLUMNS does not cover road plus biome ground',
  )
  // **Deliberately not a literal.** This was `17`, and adding two biomes broke a test that was
  // measuring nothing except how many biomes there were when it was written — the line above
  // already asserts the only relationship that matters. What is worth pinning is that the strip
  // stays inside a texture width no renderer will balk at and that it is not empty; the exact
  // number is data, and a test that has to be edited every time the data changes trains whoever
  // edits it to change the number rather than to ask why it moved.
  assert.ok(count > ROAD_PALETTE.length && count <= 64, `palette strip is ${count} columns wide`)

  // Every theme must supply a colour for every *road* texel; the ground texels come from BIOMES.
  for (const id of themeIds()) {
    assert.equal(
      THEMES[id].road.length,
      ROAD_PALETTE.length,
      `${id} has ${THEMES[id].road.length} road colours against ${ROAD_PALETTE.length}`,
    )
  }

  // Ground columns land where `groundPaletteIndex` says, inside the strip, and no two biomes
  // share one -- two biomes on one column would make them the same place.
  const seen = new Set()

  for (let biome = 0; biome < BIOMES.length; biome++) {
    for (let shade = 0; shade < GROUND_SHADES_PER_BIOME; shade++) {
      const column = groundPaletteIndex(biome, shade)

      assert.ok(column >= ROAD_PALETTE.length && column < count, `biome ${biome} ground column ${column} is outside the strip`)
      assert.ok(!seen.has(column), `biome ${biome} shares palette column ${column}`)
      seen.add(column)
    }
  }
  assert.equal(seen.size, BIOMES.length * GROUND_SHADES_PER_BIOME)

  for (let i = 0; i < count; i++) {
    const u = paletteU(i)
    // A texel spans [i/count, (i+1)/count). The centre is equidistant from both edges --
    // this is what keeps NEAREST sampling off the boundary where rounding could pick up the
    // neighbouring colour and make the rumble stripes swim.
    assert.ok(Math.abs(u - i / count - (0.5 / count)) < 1e-12, `paletteU(${i}) = ${u} is not the texel centre`)
    assert.ok(Math.floor(u * count) === i, `paletteU(${i}) = ${u} does not sample texel ${i}`)
    assert.ok(u > i / count && u < (i + 1) / count, `paletteU(${i}) = ${u} sits on a texel boundary`)
  }
})

console.log('src/race/rng.ts')

check('the same seed produces the same sequence, a different seed does not', () => {
  const a = createRng(1234)
  const b = createRng(1234)
  const other = createRng(1235)

  let differs = false
  for (let i = 0; i < 500; i++) {
    const value = a()
    assert.equal(value, b(), `sequences diverged at draw ${i}`)
    if (value !== other()) differs = true
    assert.ok(value >= 0 && value < 1, `draw ${i} left [0, 1): ${value}`)
  }
  assert.ok(differs, 'two different seeds produced an identical sequence')
})

check('randomRange stays in range and randomItem stays in bounds', () => {
  const rng = createRng(7)
  const items = ['a', 'b', 'c']

  for (let i = 0; i < 1000; i++) {
    const value = randomRange(rng, -3, 5)
    assert.ok(value >= -3 && value < 5, `randomRange escaped: ${value}`)
    assert.ok(items.includes(randomItem(rng, items)), 'randomItem returned something not in the list')
  }
  assert.throws(() => randomItem(rng, []), /empty/)
})

console.log('src/road/track.ts -- decorateTrack')

const DECOR_KEYS = ['spire', 'boulder', 'ridge', 'frond', 'bramble', 'pylon']

function decorated(seed) {
  const track = buildStraightTrack(600)
  decorateTrack(track, DECOR_KEYS, { seed })

  return track
}

function spritesOf(track) {
  return track.flatMap((segment) => segment.sprites.map((sprite) => ({ index: segment.index, ...sprite })))
}

check('the same seed decorates identically, twice over and across tracks', () => {
  assert.deepEqual(spritesOf(decorated(42)), spritesOf(decorated(42)), 'two tracks from one seed differ')
  assert.notDeepEqual(spritesOf(decorated(42)), spritesOf(decorated(43)), 'two seeds produced identical scenery')
})

check('decorating twice replaces the scenery rather than doubling it', () => {
  // Idempotence, not append: a scene restart re-runs create() over a track that may already
  // be decorated, and scenery that accumulated per restart would quietly grow the frame cost.
  const track = buildStraightTrack(600)
  decorateTrack(track, DECOR_KEYS, { seed: 9 })
  const once = spritesOf(track)
  decorateTrack(track, DECOR_KEYS, { seed: 9 })

  assert.deepEqual(spritesOf(track), once)
})

check('scenery keeps off the ground strip and inside the configured band', () => {
  const track = decorated(DECOR.SEED)
  const sprites = spritesOf(track)

  assert.ok(sprites.length > 0, 'nothing was placed at all')
  for (const sprite of sprites) {
    const magnitude = Math.abs(sprite.offsetX)
    assert.ok(magnitude >= DECOR.MIN_OFFSET, `|offsetX| ${magnitude} is on the ground strip`)
    // The far tier reaches past the middle tier's band on purpose, so the bound is the widest
    // tier rather than the one the verge uses.
    assert.ok(magnitude < DECOR_TIERS.far.maxOffset, `|offsetX| ${magnitude} is past every configured band`)
    assert.ok(DECOR_KEYS.includes(sprite.key), `unknown texture key ${sprite.key}`)
    assert.equal(sprite.height, 0, 'ground scenery must sit on the ground')
  }

  // **Nothing may be placed past the end of the ground it stands on.** This was a comment on
  // `GROUND_EXTENT` saying it sat "comfortably past DECOR.MAX_OFFSET (4.5)", and widening the
  // scatter to 18 to fill the sides of the frame walked straight through it — every far-placed
  // prop would have been drawn standing on sky. A comment cannot fail a build; this can.
  // **The relationship that went stale twice.** It is checked against the widest tier, not against
  // the verge's band: the far tier reaches 34 half-widths, and ground that stopped short of it
  // would leave every far silhouette standing on sky.
  assert.ok(
    GROUND_EXTENT > DECOR_TIERS.far.maxOffset,
    `scenery reaches ${DECOR_TIERS.far.maxOffset} half-widths but the ground stops at ${GROUND_EXTENT}`,
  )
  // The decal field joined this relationship when it stopped being a strip down the middle of the
  // road: a mark past the end of the ground is drawn on sky exactly as a prop would be.
  assert.ok(
    GROUND_EXTENT > DECAL_MAX_OFFSET,
    `marks reach ${DECAL_MAX_OFFSET} half-widths but the ground stops at ${GROUND_EXTENT}`,
  )

  // The near verge must not be thinned by the wider band — see `DECOR.OFFSET_BIAS`. Measured as
  // the share of placements still inside the band that used to hold all of them, **over the middle
  // tier alone**: that is the tier the bias governs, and counting the far tier's own placements
  // against it would report the verge as emptying every time the horizon got busier.
  const verge = sprites.filter((sprite) => sprite.tierScale === DECOR_TIERS.mid.scale)
  const near = verge.filter((sprite) => Math.abs(sprite.offsetX) <= 4.5).length
  const nearShare = near / verge.length

  assert.ok(nearShare > 0.3, `only ${(nearShare * 100).toFixed(0)}% of scenery is near the road -- the verge reads empty`)
  console.log(
    `    scatter: ${sprites.length} objects over ${DECOR.MIN_OFFSET}..${DECOR.MAX_OFFSET} half-widths, ` +
      `${(nearShare * 100).toFixed(0)}% within the old 4.5 band`,
  )
})

check('scenery does not place the same prop over and over in one spot', () => {
  // The "ten identical rocks in a clump" artefact. Neighbouring segments are 200 world units
  // apart, so a run of the same key reads as a cluster of clones rather than as scenery. Measured
  // as the longest run of one key on one side, against a decorator that picked independently.
  const track = decorated(DECOR.SEED)
  const runs = { '-1': { key: null, run: 0, worst: 0 }, 1: { key: null, run: 0, worst: 0 } }

  for (const segment of track) {
    for (const sprite of segment.sprites) {
      const side = sprite.offsetX < 0 ? '-1' : 1
      const state = runs[side]

      state.run = sprite.key === state.key ? state.run + 1 : 1
      state.key = sprite.key
      state.worst = Math.max(state.worst, state.run)
    }
  }

  const worst = Math.max(runs['-1'].worst, runs[1].worst)

  // The window cannot promise more than the data allows: `coast` offers four distinct props, so a
  // repeat is reachable once the window has cycled. What must not happen is a long run.
  assert.ok(worst <= DECOR.NO_REPEAT_WINDOW + 1, `one prop repeated ${worst} times in a row on one side`)
  console.log(`    longest same-prop run on one side: ${worst}`)
})

check('density is honoured on both sides and no segment carries more than one per side', () => {
  const track = decorated(DECOR.SEED)
  const sprites = spritesOf(track)
  const left = sprites.filter((sprite) => sprite.offsetX < 0).length
  const right = sprites.length - left
  const rate = sprites.length / (track.length * 2)

  // **Measured against the middle tier alone**, which is what `DECOR.DENSITY` describes: the far
  // and near tiers add their own small chances on top and are counted separately below.
  const midRate = sprites.filter((sprite) => sprite.tierScale === DECOR_TIERS.mid.scale).length / (track.length * 2)

  assert.ok(Math.abs(midRate - DECOR.DENSITY) < DECOR.DENSITY * 0.35, `placement rate ${midRate.toFixed(3)} is far from DECOR.DENSITY ${DECOR.DENSITY}`)
  assert.ok(left > 0 && right > 0, `scenery landed on one side only (${left} left, ${right} right)`)
  for (const segment of track) {
    // Two from the middle tier (one per side) plus at most one each from the far and near tiers.
    assert.ok(segment.sprites.length <= 4, `segment ${segment.index} carries ${segment.sprites.length} objects`)
  }
  console.log(`    ${sprites.length} objects over ${track.length} segments (${left} left / ${right} right)`)
})

check('no keys means no scenery, and an already-decorated track is cleared', () => {
  const track = decorated(DECOR.SEED)
  assert.ok(spritesOf(track).length > 0)
  decorateTrack(track, [])
  assert.equal(spritesOf(track).length, 0)
})

console.log('src/road/billboard.ts')

// A ground point as RoadMesh would leave it: 4000 world units ahead, on a 1920x1080 viewport.
const SCREEN = { w: 1920, h: 1080 }
function groundAt(distance, screen = SCREEN) {
  const point = project({ x: 0, y: 0, z: distance }, 0, 0, 0, CAMERA_DEPTH, screen.w, screen.h, ROAD_WIDTH)

  return point
}

check('a billboard sits on the ground its segment projected, offset by whole road half-widths', () => {
  const ground = groundAt(4000)
  const rect = billboardRectInto(createBillboardRect(), ground, 1, 0, 40, 180, SCREEN.w, SCREEN.h)

  // offsetX = 1 is exactly the edge of the ground strip, i.e. one projected half-width out.
  assert.ok(Math.abs(rect.x - (ground.x + ground.w)) < 1e-9, `offsetX=1 did not land on the strip edge: ${rect.x} vs ${ground.x + ground.w}`)
  // height = 0 means standing on the ground, so the base is the segment's own screen y.
  assert.equal(rect.y, ground.y)
})

check('SPRITE_SCALE is world units per texture pixel -- size stays fixed against the road', () => {
  // The property that makes the constant tunable: an object's size relative to the road is
  // the same at every distance, and equals (texture pixels * SPRITE_SCALE) world units.
  for (const distance of [1000, 4000, 20_000, 60_000]) {
    const ground = groundAt(distance)
    const rect = billboardRectInto(createBillboardRect(), ground, 0, 0, 40, 180, SCREEN.w, SCREEN.h)
    const worldWidth = (rect.w / ground.w) * ROAD_WIDTH

    assert.ok(Math.abs(worldWidth - 40 * SPRITE_SCALE) < 1e-6, `at z=${distance} the object measured ${worldWidth} world units, not ${40 * SPRITE_SCALE}`)
    assert.ok(Math.abs(rect.h / rect.w - 180 / 40) < 1e-9, 'the texture aspect ratio was not preserved')
  }
})

check('a billboard keeps its size relative to the road at any viewport aspect', () => {
  // Both dimensions scale with screenWidth on purpose -- see billboardRectInto. Were the
  // height scaled by screenHeight instead, this ratio would swing with the aspect ratio and
  // every object would stretch in portrait.
  const ratios = [{ w: 1920, h: 1080 }, { w: 390, h: 844 }, { w: 844, h: 390 }].map((screen) => {
    const ground = groundAt(4000, screen)
    const rect = billboardRectInto(createBillboardRect(), ground, 0, 0, 40, 180, screen.w, screen.h)

    return { ...screen, widthRatio: rect.w / ground.w, aspect: rect.h / rect.w }
  })

  for (const ratio of ratios) {
    assert.ok(Math.abs(ratio.widthRatio - ratios[0].widthRatio) < 1e-9, `${ratio.w}x${ratio.h} sized the object differently against the road`)
    assert.ok(Math.abs(ratio.aspect - 4.5) < 1e-9, `${ratio.w}x${ratio.h} distorted the texture aspect`)
  }
})

check('height lifts the base off the ground, using the vertical scale project() itself uses', () => {
  const ground = groundAt(4000)
  const standing = billboardRectInto(createBillboardRect(), ground, 0, 0, 40, 180, SCREEN.w, SCREEN.h)
  const floating = billboardRectInto(createBillboardRect(), ground, 0, 500, 40, 180, SCREEN.w, SCREEN.h)
  // The same 500 world units, put through the road's own projection.
  const projected = project({ x: 0, y: 500, z: 4000 }, 0, 0, 0, CAMERA_DEPTH, SCREEN.w, SCREEN.h, ROAD_WIDTH)

  assert.ok(floating.y < standing.y, 'a positive height must raise the base up the screen')
  assert.ok(Math.abs(floating.y - projected.y) < 1e-9, `lifted base ${floating.y} disagrees with project() ${projected.y}`)
})

check('the hill clip hides a billboard from the bottom up, and drops it entirely once buried', () => {
  const rect = { x: 500, y: 400, w: 60, h: 200 } // spans y 200..400

  assert.equal(billboardVisibleFraction(rect, 400), 1, 'a clip exactly at the base must hide nothing')
  assert.equal(billboardVisibleFraction(rect, 600), 1, 'a clip below the base must hide nothing')
  assert.equal(billboardVisibleFraction(rect, 300), 0.5, 'half buried should read as half visible')
  assert.equal(billboardVisibleFraction(rect, 200), 0, 'a clip at the top means fully hidden')
  assert.equal(billboardVisibleFraction(rect, 100), 0, 'a clip above the top means fully hidden')
  assert.equal(billboardVisibleFraction({ ...rect, h: 0 }, 300), 0, 'a zero-height billboard is not visible')
})

check('a billboard behind a crest is culled, not drawn through the hillside', () => {
  // The regression this whole clipY channel exists for: on a track that crests and dips, the
  // clip for a segment in the dip sits well above the ground there.
  const track = new TrackBuilder().addHill(ROAD_LENGTH.MEDIUM * 3, ROAD_HILL.HIGH).addStraight(ROAD_LENGTH.LONG).build()
  const crestSegment = track[Math.round(ROAD_LENGTH.MEDIUM * 3)]
  const ground = createScreenPoint()

  ground.x = 960
  ground.y = 700
  ground.w = 300
  ground.scale = 0.0002
  assert.ok(crestSegment.p2.y > 0, 'sanity: the track is meant to have climbed by here')

  const rect = billboardRectInto(createBillboardRect(), ground, 2, 0, 40, 180, SCREEN.w, SCREEN.h)
  const hidden = billboardVisibleFraction(rect, rect.y - rect.h)

  assert.equal(hidden, 0)
  assert.equal(billboardOnScreen(rect, hidden, SCREEN.w, SCREEN.h), false, 'a fully hidden billboard must not claim a pool slot')
})

check('off-screen billboards are rejected before they can claim a pool slot', () => {
  const onScreen = { x: 960, y: 600, w: 100, h: 300 }

  assert.equal(billboardOnScreen(onScreen, 1, SCREEN.w, SCREEN.h), true)
  assert.equal(billboardOnScreen({ ...onScreen, x: -200 }, 1, SCREEN.w, SCREEN.h), false, 'wholly off the left edge')
  assert.equal(billboardOnScreen({ ...onScreen, x: SCREEN.w + 200 }, 1, SCREEN.w, SCREEN.h), false, 'wholly off the right edge')
  assert.equal(billboardOnScreen({ ...onScreen, x: -49 }, 1, SCREEN.w, SCREEN.h), true, 'a half-visible edge object must still draw')
  assert.equal(billboardOnScreen({ ...onScreen, y: -1 }, 1, SCREEN.w, SCREEN.h), false, 'wholly above the top edge')
  assert.equal(billboardOnScreen({ ...onScreen, y: SCREEN.h + 400 }, 1, SCREEN.w, SCREEN.h), false, 'wholly below the bottom edge')

  // A tall object rising off the top of the screen, buried up to the neck by a hill: the
  // whole rectangle overlaps the viewport, but the part still visible does not. The visible
  // part is what has to be tested, or this claims a pool slot to draw nothing.
  const tall = { x: 960, y: 500, w: 100, h: 2000 }
  assert.equal(billboardOnScreen(tall, 1, SCREEN.w, SCREEN.h), true, 'unclipped, it is very much on screen')
  assert.equal(billboardOnScreen(tall, 0.5, SCREEN.w, SCREEN.h), false, 'clipped to its top half, it is entirely above the viewport')
  assert.equal(billboardOnScreen(tall, 0, SCREEN.w, SCREEN.h), false)
})

console.log('src/road/constants.ts -- distance fog')

check('fog rows are sampled at their centres, never on a boundary', () => {
  // Exactly the same requirement as paletteU, and for the same reason: paired with NEAREST
  // filtering, a boundary sample lets a quad pick up the neighbouring fog step along its edges,
  // which reads as the far road shimmering between two shades.
  for (let step = 0; step < FOG_STEPS; step++) {
    const v = paletteV(step)

    assert.ok(Math.abs(v - step / FOG_STEPS - 0.5 / FOG_STEPS) < 1e-12, `paletteV(${step}) = ${v} is not the row centre`)
    assert.ok(Math.floor(v * FOG_STEPS) === step, `paletteV(${step}) samples the wrong row`)
    assert.ok(v > step / FOG_STEPS && v < (step + 1) / FOG_STEPS, `paletteV(${step}) sits on a row boundary`)
  }
})

check('paletteV clamps rather than reading off the end of the texture', () => {
  assert.equal(paletteV(-5), paletteV(0))
  assert.equal(paletteV(FOG_STEPS + 99), paletteV(FOG_STEPS - 1))
})

check('fog builds with distance, never reverses, and saturates at the draw distance', () => {
  assert.equal(fogStepFor(0), 0, 'the segment under the camera must be unfogged')
  assert.equal(fogStepFor(DRAW_DISTANCE), FOG_STEPS - 1)
  assert.equal(fogStepFor(DRAW_DISTANCE * 3), FOG_STEPS - 1, 'past the draw distance must clamp')
  assert.equal(fogStepFor(-10), 0)

  let previous = -1
  for (let n = 0; n <= DRAW_DISTANCE; n++) {
    const step = fogStepFor(n)

    assert.ok(step >= previous, `fog went backwards at ${n}`)
    assert.ok(step >= 0 && step < FOG_STEPS, `fog step ${step} is outside the texture`)
    previous = step
  }

  // Front-loaded on purpose: perspective compresses the far half of the draw distance into a
  // few pixels, so a linear ramp would spend most of its steps where nobody can see them.
  assert.ok(fogStepFor(DRAW_DISTANCE / 2) > (FOG_STEPS - 1) / 2, 'the fog ramp is linear or slower — most steps are wasted')
})

check('every fog row is reachable, so none of the texture is dead weight', () => {
  const seen = new Set()

  for (let n = 0; n <= DRAW_DISTANCE; n++) seen.add(fogStepFor(n))
  assert.equal(seen.size, FOG_STEPS, `only ${seen.size} of ${FOG_STEPS} rows are ever sampled`)
})

console.log('src/road/themes.ts')

check('a theme is only colour — every one carries the same fields', () => {
  const reference = Object.keys(THEMES[DEFAULT_ROAD_THEME]).sort()

  assert.ok(themeIds().length >= 2, 'a theme system with one theme proves nothing')
  for (const id of themeIds()) {
    const theme = THEMES[id]

    assert.deepEqual(Object.keys(theme).sort(), reference, `theme ${id} has a different shape`)
    assert.equal(theme.id, id, `theme ${id} disagrees with its own key`)
    assert.equal(
      theme.road.length,
      ROAD_PALETTE.length,
      `theme ${id} has ${theme.road.length} road colours against a ${ROAD_PALETTE.length}-texel palette`,
    )
    for (const colour of theme.road) assert.ok(colour >= 0 && colour <= 0xffffff, `theme ${id} has a colour outside 24-bit RGB`)
  }
})

check('switching themes takes effect, and switching to the same one or an unknown one does not', () => {
  const original = getRoadThemeId()

  assert.equal(setRoadTheme(original), false, 'switching to the active theme must be a no-op')
  assert.equal(setRoadTheme('no-such-theme'), false)
  assert.equal(getRoadThemeId(), original, 'a refused switch must not change anything')

  const other = themeIds().find((id) => id !== original)

  assert.equal(setRoadTheme(other), true)
  assert.equal(getRoadTheme().id, other)
  setRoadTheme(original)
  assert.equal(getRoadTheme().id, original)
})

check('blendColor hits both endpoints exactly and stays in range', () => {
  assert.equal(blendColor(0x112233, 0xaabbcc, 0), 0x112233)
  assert.equal(blendColor(0x112233, 0xaabbcc, 1), 0xaabbcc)
  assert.equal(blendColor(0x000000, 0xffffff, 0.5), 0x808080)
  // Clamped, so a caller that computes an amount slightly outside 0..1 cannot wrap a channel.
  assert.equal(blendColor(0x112233, 0xaabbcc, -1), 0x112233)
  assert.equal(blendColor(0x112233, 0xaabbcc, 2), 0xaabbcc)

  for (let i = 0; i <= 20; i++) {
    const mixed = blendColor(0x2040ff, 0xffcc00, i / 20)

    assert.ok(mixed >= 0 && mixed <= 0xffffff, `blend ${i} left 24-bit range`)
  }
})

check('a fog ramp never leaves 24-bit range and ends exactly on the fog colour', () => {
  // The palette rows are built by exactly this loop -- see createRoadPalette.
  for (const id of themeIds()) {
    const theme = THEMES[id]

    for (let row = 0; row < FOG_STEPS; row++) {
      const amount = row / (FOG_STEPS - 1)

      for (const colour of theme.road) {
        const faded = blendColor(colour, theme.fog, amount)

        assert.ok(faded >= 0 && faded <= 0xffffff, `${id} row ${row} produced ${faded}`)
      }
    }
    for (const colour of theme.road) {
      assert.equal(blendColor(colour, theme.fog, 1), theme.fog, `${id} does not reach its own fog colour`)
    }
  }
})

check('every decor shape a theme can place is actually declared', () => {
  // The decorator is handed a key list and will happily scatter a name that no generator
  // knows; the failure then shows up as a missing texture at render time, far from the cause.
  const declared = DECOR_TEXTURES.map((texture) => texture.key)

  assert.equal(new Set(declared).size, declared.length, 'two decor textures share a key')
  assert.deepEqual(DECOR_KEYS_LIVE, declared, 'DECOR_KEYS must list exactly the declared textures')
  for (const texture of DECOR_TEXTURES) {
    assert.ok(texture.width > 0 && texture.height > 0, `${texture.key} has no size`)
    // Silhouette is the acceptance: at 24px on the long side the shape must still have both
    // dimensions, or it degenerates to a line and stops reading as anything.
    const scale = 24 / Math.max(texture.width, texture.height)
    assert.ok(Math.round(texture.height * scale) >= 3, `${texture.key} collapses to ${Math.round(texture.height * scale)}px tall at range`)
    assert.ok(Math.round(texture.width * scale) >= 3, `${texture.key} collapses to ${Math.round(texture.width * scale)}px wide at range`)
  }
})

check('the decor set spans clearly tall and clearly wide, not one proportion six times', () => {
  // What this defends is that the far field does not read as one shape repeated: at a few pixels
  // tall, contour is gone and proportion is most of what is left.
  //
  // **The assertion changed shape when real art replaced the polygons, and deliberately did not
  // just get a smaller number.** It used to demand a 4x span between the widest and narrowest
  // piece, which hand-authored outlines could meet by being arbitrarily extreme — the old pylon
  // was 36x200 (0.18) because nothing stopped it. Drawn scenery has the proportions the thing
  // actually has; a conifer is 0.48, not 0.18, and no amount of test will make it otherwise.
  // Lowering the threshold until the set passed would have been fitting the standard to the
  // result, so the property is stated directly instead: the set must contain a piece that is
  // unmistakably taller than wide *and* one unmistakably wider than tall.
  //
  // The per-piece "does not collapse to a line at 24px" check above is unchanged and still does
  // the other half of the work.
  const ratios = DECOR_TEXTURES.map((t) => t.width / t.height)

  assert.ok(ratios.some((r) => r <= 0.7), `nothing in the decor set is clearly tall (min ${Math.min(...ratios).toFixed(2)})`)
  assert.ok(ratios.some((r) => r >= 1.4), `nothing in the decor set is clearly wide (max ${Math.max(...ratios).toFixed(2)})`)
})

check('billboard fog rises with distance and agrees with the ground it stands on', () => {
  // Monotonic, and pinned at both ends: no fog on the camera plane, full fog at the draw limit.
  assert.equal(billboardFog(0, 300), 0, 'something at the camera is already hazy')
  assert.equal(billboardFog(300, 300), 1, 'the far limit is not fully fogged')

  let previous = -1
  for (let n = 0; n <= 300; n++) {
    const fog = billboardFog(n, 300)
    assert.ok(fog >= previous, `fog fell between ${n - 1} and ${n}`)
    assert.ok(fog >= 0 && fog <= 1, `fog out of range at ${n}: ${fog}`)
    previous = fog
  }

  // Out of range in either direction is clamped, not extrapolated -- a caller handing over a
  // distance past the draw limit must get "fully fogged", never a value above 1 that would turn
  // into a negative alpha.
  assert.equal(billboardFog(-50, 300), 0, 'a negative distance is not clamped')
  assert.equal(billboardFog(9000, 300), 1, 'a distance past the limit is not clamped')
  assert.equal(billboardFog(10, 0), 0, 'a zero draw distance must not divide')

  // The whole reason it shares FOG_CURVE with the ground: scenery and the road it stands on
  // have to fade together. Checked against the *quantised* ground steps, since that is what the
  // road actually samples -- they should track within one step across the range.
  for (let n = 0; n <= 300; n += 10) {
    const groundStep = fogStepFor(n, 300) / (FOG_STEPS - 1)
    const spriteFog = billboardFog(n, 300)
    assert.ok(
      Math.abs(groundStep - spriteFog) <= 1 / (FOG_STEPS - 1),
      `scenery and ground disagree about fog at ${n}: ${spriteFog.toFixed(3)} vs ${groundStep.toFixed(3)}`,
    )
  }
})

check('the farthest scenery fades but never disappears', () => {
  // Fog is applied as transparency, so this constant is the only thing standing between "melts
  // into the horizon" and "pops out of existence at a fixed distance".
  assert.ok(MAX_BILLBOARD_FOG > 0, 'no fog is applied to scenery at all')
  assert.ok(MAX_BILLBOARD_FOG < 1, 'the farthest scenery becomes fully invisible')

  const faintest = 1 - billboardFog(DRAW_DISTANCE, DRAW_DISTANCE) * MAX_BILLBOARD_FOG
  assert.ok(faintest > 0.1, `the farthest scenery is effectively gone at alpha ${faintest.toFixed(3)}`)
})

check('the threat colour is one tone, and nothing else in any theme is allowed near it', () => {
  const threat = toOklab(THREAT_COLOR)

  for (const id of themeIds()) {
    const theme = THEMES[id]

    // One tone across every theme: a warning the player must re-learn per theme is not a warning.
    assert.equal(theme.enemy.telegraph, THREAT_COLOR, `${id} uses its own telegraph colour`)

    // Everything the player might mistake for a threat. `enemy.rim` and `enemyTint` are the
    // deliberate exemptions -- an enemy is *allowed* to look dangerous, and both are colours
    // applied only to enemies.
    const reserved = [
      ...theme.road.map((color, index) => [`road[${index}]`, color]),
      ['fog', theme.fog],
      ['sky.top', theme.sky.top],
      ['sky.bottom', theme.sky.bottom],
      ['sky.band', theme.sky.band],
      ['decor.body', theme.decor.body],
      ['decor.rim', theme.decor.rim],
      ['decorTint', theme.decorTint],
      ['glow.color', theme.glow.color],
    ]

    for (const [name, color] of reserved) {
      const hue = hueDistance(color, THREAT_COLOR)
      const saturation = chroma(color)
      const lightnessGap = Math.abs(toOklab(color).L - threat.L)
      const tooClose =
        hue < THREAT_MIN_HUE_DEGREES &&
        saturation >= THREAT_MIN_CHROMA &&
        lightnessGap < THREAT_LIGHTNESS_ESCAPE

      assert.ok(
        !tooClose,
        `${id}.${name} (0x${color.toString(16).padStart(6, '0')}) reads as the threat colour: ` +
          `hue ${hue.toFixed(0)}deg away, chroma ${saturation.toFixed(3)}, lightness gap ${lightnessGap.toFixed(3)}`,
      )
    }
  }
})

check('nothing hostile is drawn in the colour of the player\'s own craft', () => {
  // **The mirror of the threat reservation, and it caught two themes.** `enemy.rim` is what an
  // enemy *shot* is drawn in and what a generated enemy silhouette is outlined in -- so a theme
  // whose rim sits on the ship's hue paints the things trying to kill you in the player's own
  // colour. `dusk` measured **1.6 degrees** from the hull and `ember` **1.7**, against 122-169 for
  // the five that were fine, and nothing in the codebase could see it: the threat sweep asks how
  // close a colour is to danger, and this is the opposite question.
  //
  // Found by looking at a frame, not by reading the table -- and only because three new enemy
  // kinds ship on generated silhouettes, which put `enemy.rim` back on screen for the first time
  // since every kind became raster art.
  const shipHue = KIT.active

  for (const [id, theme] of Object.entries(THEMES)) {
    const gap = hueDistance(theme.enemy.rim, shipHue)

    assert.ok(
      gap >= MIN_HOSTILE_HUE_GAP,
      `${id}.enemy.rim (0x${theme.enemy.rim.toString(16).padStart(6, '0')}) is ${gap.toFixed(1)}deg from the ship's own hull`,
    )
  }

  // Shown to fail, like every other rule here: the two colours this check was written for.
  for (const [why, color] of [['dusk before the repaint', 0x66e0ff], ['ember before the repaint', 0x4dd8ff]]) {
    assert.ok(hueDistance(color, shipHue) < MIN_HOSTILE_HUE_GAP, `the rule stopped rejecting ${why}`)
  }

  console.log(
    `    enemy rim vs the ship's hull: ${Object.entries(THEMES)
      .map(([id, t]) => `${id} ${hueDistance(t.enemy.rim, shipHue).toFixed(0)}`)
      .join(', ')} degrees`,
  )
})

check('the perceptual threat metric actually rejects things -- shown, not assumed', () => {
  // A rule that has never refused anything is not evidence. These are the exact colours the
  // metric flagged when it replaced the RGB distance, and they must still fail.
  const shouldFail = [
    ['dusk sky band, 1deg from the threat hue', 0xa84a4a],
    ['dusk decor rim', 0x9c6a72],
    ['dusk decor tint, a salmon over scenery', 0xd89173],
    ['ember sky band', 0x8c2a08],
    ['the threat colour itself', THREAT_COLOR],
  ]
  const threat = toOklab(THREAT_COLOR)
  const rejects = (color) =>
    hueDistance(color, THREAT_COLOR) < THREAT_MIN_HUE_DEGREES &&
    chroma(color) >= THREAT_MIN_CHROMA &&
    Math.abs(toOklab(color).L - threat.L) < THREAT_LIGHTNESS_ESCAPE

  for (const [why, color] of shouldFail) {
    assert.ok(rejects(color), `the metric no longer rejects ${why} (0x${color.toString(16)})`)
  }

  // ...and it must not reject the things a warm theme is legitimately built from, or `dusk` and
  // `ember` become unshippable.
  const shouldPass = [
    ['ember glow, a clear orange at 44deg', 0xffa430],
    ['ember rim, too desaturated to read as a hue', 0x6b4a3a],
    ['ember sky bottom, far darker than the threat', 0x3d1206],
    ['a mid grey', 0x9e9e9e],
  ]

  for (const [why, color] of shouldPass) {
    assert.ok(!rejects(color), `the metric wrongly rejects ${why} (0x${color.toString(16)})`)
  }
})

check('no fog blend lands in the reserved zone -- the colours nobody declares', () => {
  // **The palette texture is 5 x FOG_STEPS blends, and none of them is a theme constant.** Every
  // slot can be legal while a blend between two of them is not: `dusk`'s amber stripe fading
  // into its purple fog passed through `0x7c533b` at step 10, a muddy red inside the guard band.
  // One texel, but a texel colours a whole band of road across the frame -- it was 1.46% of the
  // rendered image, more than every declared colour put together.
  const threat = toOklab(THREAT_COLOR)
  const rejects = (color) =>
    hueDistance(color, THREAT_COLOR) < THREAT_MIN_HUE_DEGREES &&
    chroma(color) >= THREAT_MIN_CHROMA &&
    Math.abs(toOklab(color).L - threat.L) < THREAT_LIGHTNESS_ESCAPE

  for (const id of themeIds()) {
    const theme = THEMES[id]

    for (let column = 0; column < theme.road.length; column++) {
      for (let row = 0; row < FOG_STEPS; row++) {
        // Exactly the blend `createRoadPalette` bakes into the texture.
        const amount = FOG_STEPS <= 1 ? 0 : row / (FOG_STEPS - 1)
        const faded = blendColor(theme.road[column], theme.fog, amount)

        assert.ok(
          !rejects(faded),
          `${id} road[${column}] at fog step ${row} blends to 0x${faded.toString(16).padStart(6, '0')}, inside the reserved zone`,
        )
      }
    }
  }
})

check('the additive glow over the road never sums into the reserved zone', () => {
  // **Two legal layers can composite into an illegal pixel, and only this catches it.** The glow
  // is drawn additively over the ground, so what the player sees is `road + glow * alpha` — a
  // colour that appears in no constant anywhere. `dusk`'s amber glow over its own dark purple
  // road produced 1.09% of the rendered frame inside the guard band while every declared colour
  // and every fog blend was clean.
  //
  // Modelled the way the renderer composites (`ADD`: destination plus source times its alpha),
  // swept over the glow's falloff rather than only its peak, since the band fades out and the
  // dangerous sum is usually part-way down.
  const threat = toOklab(THREAT_COLOR)
  const rejects = (color) =>
    hueDistance(color, THREAT_COLOR) < THREAT_MIN_HUE_DEGREES &&
    chroma(color) >= THREAT_MIN_CHROMA &&
    Math.abs(toOklab(color).L - threat.L) < THREAT_LIGHTNESS_ESCAPE
  const channels = (color) => [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff]
  const additive = (base, glow, alpha) => {
    const [br, bg, bb] = channels(base)
    const [gr, gg, gb] = channels(glow)

    return (
      (Math.min(255, Math.round(br + gr * alpha)) << 16) |
      (Math.min(255, Math.round(bg + gg * alpha)) << 8) |
      Math.min(255, Math.round(bb + gb * alpha))
    )
  }

  for (const id of themeIds()) {
    const theme = THEMES[id]

    for (let column = 0; column < theme.road.length; column++) {
      for (let row = 0; row < FOG_STEPS; row++) {
        const base = blendColor(theme.road[column], theme.fog, FOG_STEPS <= 1 ? 0 : row / (FOG_STEPS - 1))

        // 40 steps, not 10: at a coarse sweep a violation can sit between two samples, which is
        // exactly how one survived a passing run and reappeared the moment an alpha changed.
        for (let step = 0; step <= 40; step++) {
          const alpha = (theme.glow.alpha * step) / 40
          const lit = additive(base, theme.glow.color, alpha)

          assert.ok(
            !rejects(lit),
            `${id} road[${column}] at fog ${row} under ${(alpha * 100).toFixed(1)}% glow sums to ` +
              `0x${lit.toString(16).padStart(6, '0')}, inside the reserved zone`,
          )
        }
      }
    }
  }
})

check('the rumble stripe still reads as a road edge after being repainted', () => {
  // The threat reservation forced night's crimson stripe to a blue. The stripe's *job* is to
  // mark where the road ends, which is a lightness question, so the repaint has to be checked
  // against a different metric than the one that forced it -- otherwise satisfying one rule
  // silently breaks the other.
  for (const id of themeIds()) {
    const [asphaltDark, asphaltLight, rumbleDark, rumbleLight] = THEMES[id].road

    for (const [rumbleName, rumble] of [['dark', rumbleDark], ['light', rumbleLight]]) {
      for (const [asphaltName, asphalt] of [['dark', asphaltDark], ['light', asphaltLight]]) {
        const ratio = contrastRatio(rumble, asphalt)

        assert.ok(
          ratio >= 1.6,
          `${id}: the ${rumbleName} rumble is only ${ratio.toFixed(2)}:1 against the ${asphaltName} asphalt -- the edge stops reading`,
        )
      }
    }
  }
})

check('the vertex-buffer guard: DEV throws, production drops the write and reports once', () => {
  const STRIDE = 16
  const BUFFER = 16 * 10 // ten quads

  // In bounds in both environments -- including the very last slot, which an off-by-one in the
  // bound would reject and which is written on every full frame.
  for (const dev of [true, false]) {
    assert.equal(quadWriteAction(0, STRIDE, BUFFER, dev, false), 'write')
    assert.equal(quadWriteAction(9, STRIDE, BUFFER, dev, false), 'write')
  }

  // One past the end is the case that used to overwrite the next segment's vertices silently.
  assert.equal(quadWriteAction(10, STRIDE, BUFFER, true, false), 'throw', 'DEV must fail loudly at the first bad write')
  assert.equal(quadWriteAction(10, STRIDE, BUFFER, false, false), 'report', 'production must report the first overflow')
  assert.equal(quadWriteAction(10, STRIDE, BUFFER, false, true), 'skip', 'production must not report twice')

  // ...and neither environment may ever answer 'write' for an out-of-bounds quad, which is the
  // one answer that would put the silent corruption back.
  for (const quad of [10, 11, 500, -1, -100, NaN]) {
    for (const dev of [true, false]) {
      for (const reported of [true, false]) {
        assert.notEqual(
          quadWriteAction(quad, STRIDE, BUFFER, dev, reported),
          'write',
          `quad ${quad} was allowed through (dev=${dev}, reported=${reported})`,
        )
      }
    }
  }

  // A negative index is rejected rather than wrapping: `quad * stride` would be negative, which
  // writes nowhere useful and reads back as undefined.
  assert.equal(quadWriteAction(-1, STRIDE, BUFFER, true, false), 'throw')
  assert.equal(quadWriteAction(-1, STRIDE, BUFFER, false, false), 'report')

  // The production path reports exactly once across a long run, which is the whole point of the
  // latch -- a per-frame report would push the same signal into a rate-limited API 60x a second.
  let reported = false
  let reports = 0
  for (let frame = 0; frame < 600; frame++) {
    const action = quadWriteAction(10, STRIDE, BUFFER, false, reported)

    if (action === 'report') {
      reports++
      reported = true
    }
    assert.notEqual(action, 'write')
  }
  assert.equal(reports, 1, `600 overflowing frames produced ${reports} reports`)
})

check('biomes: ids are unique, every one has ground and props, and lookups never return undefined', () => {
  assert.ok(BIOMES.length >= 2, 'a biome system with one biome proves nothing')
  assert.equal(new Set(BIOME_IDS).size, BIOMES.length, 'two biomes share an id')

  for (const biome of BIOMES) {
    assert.equal(biome.ground.length, 2, `${biome.id} does not have an alternating ground pair`)
    for (const colour of biome.ground) {
      assert.ok(colour >= 0 && colour <= 0xffffff, `${biome.id} has a ground colour outside 24-bit RGB`)
    }
    assert.ok(biome.props.length >= 4, `${biome.id} has only ${biome.props.length} props -- a stretch will read as repeated`)
    assert.equal(biomeIndex(biome.id), BIOMES.indexOf(biome), `${biome.id} does not report its own index`)
    assert.equal(biomeById(biome.id).id, biome.id)
  }

  // An unknown id falls back rather than returning undefined: a bad lookup deep in the renderer
  // would surface as a crash inside Phaser, nowhere near whatever produced the bad id.
  assert.equal(biomeById('no-such-biome').id, BIOMES[0].id)
  assert.equal(biomeIndex('no-such-biome'), 0)
})

check('biomes: ground separates from its own theme road, and is checked where it actually lands', () => {
  // **This assertion used to read "ground stays UNDER the road", and that was the bug.** The road
  // was to remain the brightest surface in the lower frame; what the rule actually produced,
  // measured on the shipped palettes, was asphalt at 0.014-0.020 and all 48 biome/theme grounds
  // crushed to 0.007-0.008 -- verges that rendered black. The rule passed and the game looked
  // like a road in a void.
  //
  // What the road's edge needs is CONTRAST, not rank: grass beside a grey road is brighter than
  // the road in life and in every cartoon, and the only arrangement that must never happen is
  // grass at the same brightness as asphalt. Asserted on `groundPairForTheme`'s output, not on
  // the authored constant, because the authored value never reaches the screen.
  let pushed = 0
  let worstSeen = Infinity

  for (const biome of BIOMES) {
    const [dark, light] = biome.ground

    assert.notEqual(dark, light, `${biome.id}'s ground pair is one colour, so the ground will not read as moving`)
    assert.ok(
      relativeLuminance(light) > relativeLuminance(dark),
      `${biome.id}'s "light" ground shade is not lighter than its dark one`,
    )

    for (const id of themeIds()) {
      const [roadDark, roadLight] = THEMES[id].road
      const shown = groundPairForTheme(biome.ground, roadDark, roadLight)

      for (const shade of shown) {
        // Against BOTH road shades: the rumble rhythm alternates them, so a ground that clears
        // one and merges with the other is invisible on half the road.
        for (const road of [roadDark, roadLight]) {
          const ratio = contrastRatio(shade, road)

          worstSeen = Math.min(worstSeen, ratio)
          assert.ok(
            ratio >= MIN_GROUND_CONTRAST - 1e-6,
            `${biome.id} ground under ${id} is ${ratio.toFixed(2)}:1 against its road -- the verge merges with the asphalt`,
          )
        }
      }
      if (shown[0] !== dark || shown[1] !== light) pushed++

      // With `GROUND_ALTERNATION` at 0 the two shades are meant to be identical — the ground is
      // deliberately flat, see that constant. What is asserted here is that the correction does
      // not *introduce* a split, because scaling each shade independently would: the two would
      // land on different values and the flat ground would come back striped by the very rule
      // that is supposed to leave it alone.
      assert.equal(
        shown[0],
        shown[1],
        `${biome.id}'s ground came back as two shades under ${id} despite GROUND_ALTERNATION being ${GROUND_ALTERNATION}`,
      )
    }
  }

  // **A ground that is merely present is not the acceptance; a ground somebody can see is.** The
  // old rule was satisfied at a luminance of 0.007, so the floor is asserted directly rather than
  // left to follow from the contrast rule.
  for (const biome of BIOMES) {
    for (const id of themeIds()) {
      const [roadDark, roadLight] = THEMES[id].road
      for (const shade of groundPairForTheme(biome.ground, roadDark, roadLight)) {
        assert.ok(
          relativeLuminance(shade) > 0.02,
          `${biome.id} ground under ${id} is ${relativeLuminance(shade).toFixed(4)} -- present and invisible`,
        )
      }
    }
  }

  console.log(
    `    ${pushed} of ${BIOMES.length * themeIds().length} ground pairs needed pushing; ` +
      `worst ground/road contrast ${worstSeen.toFixed(2)}:1`,
  )
})

check('biomes: the ground does not alternate, and the switch that turns it off still works', () => {
  // **The rippled screen.** The pair alternates on the rumble rhythm so a flat expanse does not
  // read as motionless -- but the ground is the largest surface in the frame, so a rhythm laid
  // across it reads as a moiré over the whole picture rather than as motion, which is what a
  // player reported. `GROUND_ALTERNATION` is 0 and the ground is flat.
  //
  // Asserted in **both** positions on purpose. Checking only that the shipped ground is flat
  // cannot tell "the effect is switched off" from "the effect never worked", and those need
  // different fixes if someone ever turns it back on.
  const roadPair = contrastRatio(ROAD_PALETTE[PALETTE_INDEX.ASPHALT_DARK], ROAD_PALETTE[PALETTE_INDEX.ASPHALT_LIGHT])

  assert.equal(GROUND_ALTERNATION, 0, 'the ground alternation is on -- this check describes it being off')

  for (const biome of BIOMES) {
    const [dark, light] = groundPairForTheme(biome.ground, ROAD_PALETTE[0], ROAD_PALETTE[1])

    assert.equal(dark, light, `${biome.id} ships an alternating ground while GROUND_ALTERNATION is 0`)

    // Turned fully on, the mechanism must produce the authored split and nothing wilder: the
    // authored pairs are held near the road's own asphalt ratio so that raising the knob gives a
    // cue rather than the zebra the first attempt at this shipped.
    const [onDark, onLight] = groundPairForTheme(biome.ground, ROAD_PALETTE[0], ROAD_PALETTE[1], undefined, 1, 1)

    assert.notEqual(onDark, onLight, `${biome.id} stays flat even with the alternation fully on -- the switch does nothing`)
    assert.ok(
      contrastRatio(onDark, onLight) <= roadPair * 1.35,
      `${biome.id} would alternate at ${contrastRatio(onDark, onLight).toFixed(3)} against the road's own ${roadPair.toFixed(3)}`,
    )
  }

  console.log(`    ground is flat; fully on it would alternate at most ${Math.max(
    ...BIOMES.map((b) => {
      const [d, l] = groundPairForTheme(b.ground, ROAD_PALETTE[0], ROAD_PALETTE[1], undefined, 1, 1)

      return contrastRatio(d, l)
    }),
  ).toFixed(3)} against the road's ${roadPair.toFixed(3)}`)
})

check('themes: a dark theme actually darkens the ground, without letting it merge with the road', () => {
  // A biome says what the place is; the theme says what light it is in. Those were one number
  // until the dimming rule was removed, and the first `night` screenshot afterwards showed bright
  // daylight sand under a black sky.
  const brightest = themeIds().reduce((a, b) => (THEMES[a].groundLight >= THEMES[b].groundLight ? a : b))
  const darkest = themeIds().reduce((a, b) => (THEMES[a].groundLight <= THEMES[b].groundLight ? a : b))

  assert.ok(THEMES[darkest].groundLight < THEMES[brightest].groundLight, 'every theme is in the same light')

  for (const biome of BIOMES) {
    const lit = (id) => {
      const [dark] = groundPairForTheme(
        biome.ground,
        THEMES[id].road[PALETTE_INDEX.ASPHALT_DARK],
        THEMES[id].road[PALETTE_INDEX.ASPHALT_LIGHT],
        undefined,
        THEMES[id].groundLight,
      )

      return relativeLuminance(dark)
    }

    assert.ok(
      lit(darkest) < lit(brightest),
      `${biome.id} is no darker under ${darkest} than under ${brightest} -- the light level is not reaching the palette`,
    )
  }

  for (const id of themeIds()) {
    assert.ok(THEMES[id].groundLight > 0 && THEMES[id].groundLight <= 1, `${id}.groundLight is outside 0..1`)
  }

  console.log(`    ground light spans ${THEMES[darkest].groundLight} (${darkest}) to ${THEMES[brightest].groundLight} (${brightest})`)
})

check('biomes: the separation rule actually pushes something -- shown, not assumed', () => {
  // The rule above fires on nothing today, because every authored pair already clears the road it
  // sits beside. A correction that has never corrected anything is not a correction, so it is
  // exercised here against a road deliberately painted at a biome's own brightness.
  const forest = BIOMES[0].ground
  const collidingRoad = forest[0]

  const [dark, light] = groundPairForTheme(forest, collidingRoad, collidingRoad)

  assert.notEqual(dark, forest[0], 'a ground the same colour as the road was returned unchanged')
  assert.ok(
    contrastRatio(dark, collidingRoad) >= MIN_GROUND_CONTRAST - 1e-6,
    'the pushed ground still merges with the road',
  )
  // With the alternation off the two shades are identical by design; what matters is that the
  // push moved them **together**, since scaling them independently would split a flat ground.
  assert.equal(light, dark, 'the push split a flat ground into two shades')
  // And it pushes AWAY rather than always down, which is the whole change: a bright ground beside
  // a dark road must get brighter, not be dragged under it.
  // **The ground must be pushed clear of BOTH road shades, and the fixture has to sit above both
  // of them for "lifted" to be the only correct answer.** The first version of this check used a
  // ground sandwiched between the two — brighter than the dark asphalt, darker than the light one
  // — where darkening clears the rule perfectly well, so it was asserting a preference the rule
  // never owed it. Compared against the pair's dark shade because the alternation is collapsed
  // onto that one before the push runs.
  const bright = groundPairForTheme([0xd0d0d0, 0xd8d8d8], 0xb8b8b8, 0xbcbcbc)

  assert.ok(
    relativeLuminance(bright[0]) > relativeLuminance(0xd0d0d0),
    'a ground brighter than both road shades was darkened instead of lifted',
  )
  assert.ok(
    contrastRatio(bright[0], 0xbcbcbc) >= MIN_GROUND_CONTRAST - 1e-6,
    'the lifted ground still merges with the brighter road shade',
  )
})

check('biomes: ground obeys the threat reservation like everything else', () => {
  // Ground is a large, always-present surface. If it drifted into the reserved band the whole
  // lower frame would read as danger, which is the loudest possible version of this failure.
  const threat = toOklab(THREAT_COLOR)
  const rejects = (colour) =>
    hueDistance(colour, THREAT_COLOR) < THREAT_MIN_HUE_DEGREES &&
    chroma(colour) >= THREAT_MIN_CHROMA &&
    Math.abs(toOklab(colour).L - threat.L) < THREAT_LIGHTNESS_ESCAPE

  for (const biome of BIOMES) {
    for (const colour of biome.ground) {
      assert.ok(!rejects(colour), `${biome.id} ground 0x${colour.toString(16).padStart(6, '0')} is in the reserved zone`)

      // ...and so does every fog blend of it, for the same reason the road's blends are checked.
      for (let row = 0; row < FOG_STEPS; row++) {
        for (const id of themeIds()) {
          const faded = blendColor(colour, THEMES[id].fog, FOG_STEPS <= 1 ? 0 : row / (FOG_STEPS - 1))

          assert.ok(!rejects(faded), `${biome.id} ground under ${id} fog step ${row} blends into the reserved zone`)
        }
      }
    }
  }
})

check('biomes: a run passes through several, and each stretch outlasts the draw distance', () => {
  const trackLength = TRACK_SEGMENT_COUNT

  // Long enough that a stretch reads as a place. Measured against the band that is actually
  // legible rather than against `DRAW_DISTANCE`, which is what the renderer considers, not what
  // the player can see -- a prop at 80 segments is ~25px and one at 300 is a few pixels.
  //
  // **The run length is derived now** (see `biomeRunSegments`), so this floor is what actually
  // binds: adding a biome shortens every stretch, and the tenth is where the lap can no longer
  // carry them. When it fails, the lever is the *track's* length, not a constant to re-tune.
  // Measured on the lap the cycling layout is actually flown on -- the endless circuit -- rather
  // than on this file's generic fixture length.
  const lap = buildRunCircuit().length
  const run = biomeRunSegments(lap)

  assert.ok(run >= MIN_BIOME_RUN_SEGMENTS, `a biome runs for only ${run} segments on a ${lap}-segment lap`)
  console.log(
    `    ${BIOMES.length} biomes over a ${lap}-segment lap = ${run} each ` +
      `(floor ${MIN_BIOME_RUN_SEGMENTS}; this lap carries at most ${Math.floor(lap / MIN_BIOME_RUN_SEGMENTS)})`,
  )

  // ...and the floor is shown to bite, on the count that is actually next. A floor that has never
  // rejected anything is not a floor -- the same discipline the threat and sightline rules are held
  // to, and the one this check went without for as long as its own value was set by hand.
  assert.ok(
    biomeRunSegments(lap, Math.floor(lap / MIN_BIOME_RUN_SEGMENTS) + 1) < MIN_BIOME_RUN_SEGMENTS,
    'one biome past what the lap can carry still clears the floor, so the floor measures nothing',
  )

  // ...and short enough that the shipped track passes through **all** of them. This is the half
  // that was wrong first: at 420 a 1434-segment lap reached four biomes of six, and the other two
  // existed only in the data.
  const shippedTrack = new TrackBuilder()
    .addStraight(ROAD_LENGTH.LONG)
    .addCurve(ROAD_LENGTH.MEDIUM, ROAD_CURVE.HARD)
    .addLowRollingHills()
    .addSCurve()
    .build()
  const onLap = new Set()

  for (let i = 0; i < shippedTrack.length; i++) onLap.add(biomeForSegment(i, shippedTrack.length).id)

  assert.equal(
    onLap.size,
    BIOMES.length,
    `a lap of the shipped ${shippedTrack.length}-segment track reaches ${onLap.size} of ${BIOMES.length} biomes`,
  )

  // Derived from the index, so it is stable, wraps with the track, and never returns undefined.
  const visited = new Set()
  for (let i = 0; i < trackLength; i++) visited.add(biomeForSegment(i, trackLength).id)

  assert.ok(visited.size >= 2, `a whole lap only passes through ${visited.size} biome(s)`)
  assert.equal(biomeForSegment(0, trackLength).id, biomeForSegment(trackLength, trackLength).id, 'the wrap is not stable')
  assert.equal(biomeForSegment(-1, trackLength).id, biomeForSegment(trackLength - 1, trackLength).id, 'a negative index does not wrap')
  assert.equal(biomeForSegment(5, 0).id, BIOMES[0].id, 'a zero-length track must not divide')
})

check('biomes: decorateTrack places a biome own props, and falls back rather than leaving bare ground', () => {
  const track = buildStraightTrack(TRACK_SEGMENT_COUNT)
  const everyProp = [...new Set(BIOMES.flatMap((biome) => biome.props))]

  decorateTrack(track, everyProp, { density: 1 })

  for (const segment of track) {
    const biome = biomeForSegment(segment.index, track.length)

    for (const sprite of segment.sprites) {
      assert.ok(
        biome.props.includes(sprite.key),
        `segment ${segment.index} is in ${biome.id} but carries "${sprite.key}", which belongs to another biome`,
      )
    }
  }

  // **The fallback is what lets biomes be authored ahead of their art.** Handed a key list that
  // contains none of the biome's own props, the decorator places what it has rather than leaving
  // a bare stretch -- and stops doing so on its own once the real assets exist.
  const legacy = buildStraightTrack(TRACK_SEGMENT_COUNT)

  decorateTrack(legacy, ['decor-spire', 'decor-boulder'], { density: 1 })

  const placed = legacy.flatMap((segment) => segment.sprites)

  assert.ok(placed.length > 0, 'the fallback left the whole track bare')
  for (const sprite of placed) {
    assert.ok(['decor-spire', 'decor-boulder'].includes(sprite.key), `the fallback placed "${sprite.key}", which was not offered`)
  }
})



console.log('src/road/surface.ts -- the surface rung')

check('the rung stays on the asphalt: inset from both rumble stripes, at every projected width', () => {
  // What this catches: a rung wide enough to touch the rumble stripes merges with them into one
  // bright band across the ribbon, and the road's edge -- the thing the stripes exist to mark --
  // stops being a separate thing at exactly the distances the near ground fills the frame.
  const rung = createRungQuad()
  let tightest = Infinity

  for (const w of [4, 12, 40, 120, 400, 1200]) {
    for (const dx of [0, w * 0.4, -w * 0.4]) {
      // A segment leaning through a corner: the far edge offset from the near one, and narrower.
      const s1 = { x: 100 + dx, y: 900, w, scale: 1 }
      const s2 = { x: 100, y: 700, w: w * 0.72, scale: 1 }

      rungQuadInto(rung, s1, s2)

      for (const [edgeLeft, edgeRight, centre, halfWidth] of [
        [rung.nearLeftX, rung.nearRightX, s1.x, s1.w],
        [rung.farLeftX, rung.farRightX, s1.x + (s2.x - s1.x) * TRACK_RUNG.DEPTH, s1.w + (s2.w - s1.w) * TRACK_RUNG.DEPTH],
      ]) {
        const gap = centre + halfWidth - edgeRight

        assert.ok(edgeLeft > centre - halfWidth, `rung crossed the left road edge at w=${w}`)
        assert.ok(edgeRight < centre + halfWidth, `rung crossed the right road edge at w=${w}`)
        // ...and clear of the rumble stripes, which sit outboard of the edge -- so the margin
        // that matters is measured against the road half-width, in the stripes' own units.
        tightest = Math.min(tightest, gap / halfWidth)
      }
    }
  }

  assert.ok(
    tightest > RUMBLE_WIDTH_FRACTION,
    `the rung leaves only ${tightest.toFixed(3)} of the half-width to the road edge, thinner than a rumble stripe (${RUMBLE_WIDTH_FRACTION})`,
  )
  console.log(`    rung spans ${(TRACK_RUNG.WIDTH * 200).toFixed(0)}% of the road, leaving ${(tightest * 100).toFixed(0)}% of the half-width clear at each edge`)
})

check('a rung leans and narrows with the segment it is painted on', () => {
  // A rung built from the near edge alone would stay square to the screen while the road bent
  // away underneath it -- which reads as the marking sliding off the surface through a corner.
  const rung = createRungQuad()
  const s1 = { x: 0, y: 900, w: 300, scale: 1 }
  const s2 = { x: 240, y: 700, w: 180, scale: 1 }

  rungQuadInto(rung, s1, s2)

  const nearCentre = (rung.nearLeftX + rung.nearRightX) / 2
  const farCentre = (rung.farLeftX + rung.farRightX) / 2
  const nearWidth = rung.nearRightX - rung.nearLeftX
  const farWidth = rung.farRightX - rung.farLeftX

  assert.ok(Math.abs(nearCentre - s1.x) < 1e-9, 'the near edge is not on the road centre')
  assert.ok(farCentre > nearCentre, 'the rung did not lean with the road')
  assert.ok(farWidth < nearWidth, 'the rung did not narrow with the road')
  // The far edge sits inside the segment, not past it: the rung is a bar, not a stripe running
  // the segment's whole length -- which is what the gap between rungs is made of.
  assert.ok(rung.farY > s2.y && rung.farY < s1.y, 'the rung is not inside its own segment')
  assert.ok(
    Math.abs((s1.y - rung.farY) / (s1.y - s2.y) - TRACK_RUNG.DEPTH) < 1e-9,
    'the rung does not occupy TRACK_RUNG.DEPTH of the segment',
  )
})

check('the rung sweeps its whole length down the frame, which a centre line did not', () => {
  // The reason the marking changed shape at all, stated as a measurement rather than as taste.
  // A longitudinal dash only moves the boundary between paint and no-paint down the screen; a
  // transverse bar moves every pixel of itself. Measured as painted area crossing one row.
  const rung = createRungQuad()
  const s1 = { x: 0, y: 900, w: 300, scale: 1 }
  const s2 = { x: 0, y: 700, w: 220, scale: 1 }

  rungQuadInto(rung, s1, s2)

  const rungWidth = rung.nearRightX - rung.nearLeftX
  // The old marking, for contrast: `LANE_WIDTH_FRACTION` was 0.012 of the road half-width.
  const oldLaneWidth = s1.w * 0.012 * 2

  assert.ok(
    rungWidth > oldLaneWidth * 10,
    `the rung is only ${(rungWidth / oldLaneWidth).toFixed(1)}x the old centre line -- that is not a different cue`,
  )
  console.log(`    a rung crossing one screen row paints ${(rungWidth / oldLaneWidth).toFixed(0)}x what the old centre line did`)
})

check('rungs are spaced a full rumble cycle apart, never adjacent', () => {
  // The defect this exists for shipped and was caught by looking at the game: riding the rumble
  // stripes' own `alternate` flag painted a rung on every segment of every *on* band, i.e. three
  // bars a fraction of a segment apart followed by a gap -- a pedestrian crossing laid down the
  // length of the road. Sparse and regular is the whole difference between a rung and a stripe.
  const painted = []

  for (let i = 0; i < TRACK_SEGMENT_COUNT; i++) if (hasRung(i)) painted.push(i)

  assert.ok(painted.length > 0, 'no segment carries a rung at all')
  for (let i = 1; i < painted.length; i++) {
    assert.equal(
      painted[i] - painted[i - 1],
      TRACK_RUNG.SPACING,
      `rungs at ${painted[i - 1]} and ${painted[i]} are not one full cycle apart`,
    )
  }
  assert.ok(TRACK_RUNG.SPACING >= RUMBLE_LENGTH * 2, 'a rung per rumble band or denser is a crossing, not a ladder')
  // The gap between rungs has to outrun the rung itself, or the pattern closes back up into a
  // continuous painted strip at the distances where perspective compresses it.
  assert.ok(TRACK_RUNG.DEPTH < TRACK_RUNG.SPACING / 2, 'the rungs cover more of the track than the gaps between them')
  console.log(`    one rung every ${TRACK_RUNG.SPACING} segments (${TRACK_RUNG.SPACING * SEGMENT_LENGTH} world units), covering ${(TRACK_RUNG.DEPTH * 100).toFixed(0)}% of its own segment`)
})

console.log('the near zone')

check('the near ground is not one stretched segment, at any viewport', () => {
  // FRAME-FIX asked for this and it was never asserted: after the horizon moved up, the ground
  // is 38% of the frame, and if the nearest drawn segment covered most of that band the bottom
  // of the picture would be a single flat trapezoid with nothing crossing it.
  //
  // Reported as well as asserted, because the number is a consequence of CAMERA_HEIGHT, the FOV
  // and HORIZON_Y together -- three constants that are each tuned for something else.
  for (const [w, h] of [[1920, 1080], [390, 844], [844, 390]]) {
    const horizon = h * HORIZON_Y
    const groundBand = h - horizon
    let worst = 0
    let worstAt = 0
    let previousY = h

    for (let n = 1; n <= DRAW_DISTANCE; n++) {
      const point = project({ x: 0, y: 0, z: n * SEGMENT_LENGTH }, 0, CAMERA_HEIGHT, 0, CAMERA_DEPTH, w, h, ROAD_WIDTH)

      if (!Number.isFinite(point.scale) || point.scale <= 0) continue

      const y = Math.min(point.y, h)
      const covered = (previousY - y) / groundBand

      if (previousY <= horizon) break
      if (covered > worst) {
        worst = covered
        worstAt = n
      }
      previousY = y
    }

    assert.ok(
      worst < 0.35,
      `${w}x${h}: segment ${worstAt} covers ${(worst * 100).toFixed(0)}% of the ground band on its own`,
    )
    console.log(`    ${w}x${h}: the widest single segment is ${(worst * 100).toFixed(0)}% of the ground band (segment ${worstAt})`)
  }
})

console.log('the decor tint')

/** The dimmest a prop may end up after both multiplies, as relative luminance. */
const MIN_DECOR_LUMINANCE = 0.09

check('every biome x theme decor tint is outside the threat band and still visible', () => {
  // **The product is what reaches the screen, and only the product is worth checking.** Every biome
  // tint passes the reservation on its own -- the closest is `ashen` at 56.8 degrees against the 30
  // reserved -- and that proves nothing, because a Phaser tint multiplies and the theme multiplies
  // again. The first run of this sweep rejected `dusk` x `crystal`: a red-violet biome under a warm
  // sunset came out `#a36f65`, squarely inside the band. Crystal is blue-violet now because of it.
  const threat = toOklab(THREAT_COLOR)
  const reserved = (color) => {
    const lab = toOklab(color)

    return (
      hueDistance(color, THREAT_COLOR) <= THREAT_MIN_HUE_DEGREES &&
      chroma(color) >= THREAT_MIN_CHROMA &&
      Math.abs(lab.L - threat.L) <= THREAT_LIGHTNESS_ESCAPE
    )
  }

  const offenders = []
  let darkest = { luminance: 1, label: '' }

  for (const themeId of themeIds()) {
    const themeTint = THEMES[themeId].decorTint

    for (const biome of BIOMES) {
      const product = multiplyTint(biome.decorTint, themeTint)
      const luminance = relativeLuminance(product)
      const label = `${themeId}/${biome.id} #${product.toString(16).padStart(6, '0')}`

      if (reserved(product)) offenders.push(label)
      if (luminance < darkest.luminance) darkest = { luminance, label }
    }
  }

  assert.deepEqual(offenders, [], `decor tints inside the reserved threat band: ${offenders.join(', ')}`)
  assert.ok(
    darkest.luminance >= MIN_DECOR_LUMINANCE,
    `the darkest decor product is ${darkest.label} at luminance ${darkest.luminance.toFixed(3)}, under the ${MIN_DECOR_LUMINANCE} floor`,
  )
  console.log(
    `    ${BIOMES.length} biomes x ${themeIds().length} themes: none reserved, darkest ${darkest.label} at ${darkest.luminance.toFixed(3)}`,
  )

  // **And the sweep is shown to still reject the thing it was written for.**
  assert.ok(reserved(multiplyTint(0xc0a8e0, THEMES.dusk.decorTint)), 'the sweep stopped catching the tint it was added for')
})

check('every biome declares a decor tint, and none of them is a no-op', () => {
  // A biome whose tint is `0xffffff` is a biome back in the state this check exists to end: the art
  // ships at half saturation expecting a tint, and white is not one.
  for (const biome of BIOMES) {
    assert.equal(typeof biome.decorTint, 'number', `${biome.id} has no decorTint`)
    assert.notEqual(biome.decorTint, 0xffffff, `${biome.id}'s decor tint is white, i.e. no tint at all`)
  }

  // The renderer addresses its tint array by index; the two lookups must agree or a forest is drawn
  // in the dunes' sand. Walked over a synthetic lap of exactly one run per biome, so the arithmetic
  // is exercised at the boundary rather than wherever the shipped lap happens to fall.
  const RUN_PER_BIOME = biomeRunSegments(BIOMES.length * 200, BIOMES.length)

  for (let index = 0; index < BIOMES.length; index++) {
    const segment = index * RUN_PER_BIOME + 3

    assert.equal(
      biomeIndexForSegment(segment, BIOMES.length * RUN_PER_BIOME),
      index,
      `segment ${segment} resolves to the wrong biome index`,
    )
    assert.equal(
      biomeForSegment(segment, BIOMES.length * RUN_PER_BIOME).id,
      BIOMES[index].id,
      'the record lookup and the index lookup disagree',
    )
  }
})

console.log('the sightline')

check('every point of the run circuit leaves long enough to read, and the check can fail', () => {
  // **This is the check that did not exist when a corner shipped unfightable.** The road was
  // valid, things projected onto it correctly, and every other assertion passed; what nothing
  // asked was whether the player could see far enough down it. Measured by `road/sightline.ts` --
  // see `buildRunCircuit` for the numbers the old S-curve produced.
  const floor = minEngagementSeconds(SPEED_CAP)
  const options = {
    screenWidth: 1920,
    screenHeight: 945,
    spawnAhead: SPAWN_AHEAD_SEGMENTS,
    speed: SPEED_CAP,
  }
  const run = sweepEngagement(buildRunCircuit(), options)

  console.log(
    `    run circuit: worst ${run.worst.toFixed(1)}s engageable at segment ${run.worstAt}, mean ${run.mean.toFixed(1)}s`,
  )
  assert.ok(
    run.worst >= floor,
    `the road is visible for only ${run.worst.toFixed(1)}s at segment ${run.worstAt}, under the ${floor.toFixed(1)}s floor`,
  )

  // The menu's circuit carries nothing, but the same geometry rule applies to whether anything
  // standing on it would ever be seen -- so it is measured rather than assumed.
  const menu = sweepEngagement(buildMenuCircuit(), options)

  console.log(`    menu circuit: worst ${menu.worst.toFixed(1)}s, mean ${menu.mean.toFixed(1)}s`)

  // **And the measure is shown to be capable of failing**, on the shape that produced the bug: a
  // three-section arm at `ROAD_CURVE.MEDIUM` is long enough for the whole view to sit inside one
  // bend. A floor that has never rejected anything is not a floor.
  const tooTight = new TrackBuilder()
    .addStraight(ROAD_LENGTH.LONG)
    .addCurve(ROAD_LENGTH.MEDIUM * 3, ROAD_CURVE.MEDIUM)
    .addCurve(ROAD_LENGTH.MEDIUM * 3, -ROAD_CURVE.MEDIUM)
    .build()
  const rejected = sweepEngagement(tooTight, options)

  assert.ok(
    rejected.worst < floor,
    `the sightline floor accepted a circuit that leaves only ${rejected.worst.toFixed(1)}s -- it has stopped measuring anything`,
  )
  console.log(`    a MEDIUM-curve S over the same arms would leave ${rejected.worst.toFixed(1)}s, and is rejected`)
})

check('the biome has three tiers, and the near one is rare enough to stay an event', () => {
  // **The near tier is the speed cue, and its whole value is that it is rare.** One large object
  // passing close every few seconds reads as speed; a fence of them reads as a wall between the
  // player and the fight, and would also cover the band the targets live in.
  const track = buildStraightTrack(2000)

  decorateTrack(track, DECOR_KEYS, { seed: 77 })

  const counted = { far: 0, mid: 0, near: 0 }

  for (const segment of track) {
    for (const sprite of segment.sprites) {
      if (sprite.tierScale === DECOR_TIERS.far.scale) counted.far++
      else if (sprite.tierScale === DECOR_TIERS.near.scale) counted.near++
      else counted.mid++
    }
  }

  assert.ok(counted.far > 0 && counted.near > 0 && counted.mid > 0, 'a tier placed nothing at all')
  assert.ok(counted.near < counted.mid / 5, 'the near tier is not rare against the verge')
  assert.ok(counted.far < counted.mid / 2, 'the far tier is not rare against the verge')

  // At top speed a segment passes every `SEGMENT_LENGTH / SPEED_CAP` seconds, so the near tier's
  // rate is a number of seconds rather than a probability -- which is what the plan asks for.
  const secondsPerSegment = SEGMENT_LENGTH / SPEED_CAP
  const nearEvery = (track.length / Math.max(1, counted.near)) * secondsPerSegment

  assert.ok(nearEvery > 1.5, `a near-tier object passes every ${nearEvery.toFixed(1)}s, which is a fence`)
  console.log(
    `    per 2000 segments: ${counted.far} far, ${counted.mid} verge, ${counted.near} near ` +
      `(one close pass every ${nearEvery.toFixed(1)}s)`,
  )

  // The tiers differ in size by enough to read as distance rather than as noise.
  assert.ok(DECOR_TIERS.far.scale > DECOR_TIERS.near.scale && DECOR_TIERS.near.scale > DECOR_TIERS.mid.scale)
  // ...and the far tier stands beyond the corridor rather than in it.
  assert.ok(DECOR_TIERS.far.minOffset > DECOR.MAX_OFFSET, 'the far tier stands inside the verge band')
})

check('the skyline drifts slowly enough to read as a horizon', () => {
  // **The check that would have caught the value this shipped with.** `SKYLINE_LAYER.driftPixels`
  // multiplies `horizonDriftX`, which is the curvature integrated from the camera out to the draw
  // distance -- a WORLD quantity, and a large one. Guessing a factor for it beside the sky's own
  // 0.04-0.26 put the range at roughly twelve tile-widths a second, i.e. a blur; the sky survives
  // the identical quantity only because a gradient has no feature that can be seen moving.
  //
  // So the budget is stated in the units the player actually experiences, and measured off the
  // circuit the game builds rather than off an estimate.
  const MAX_DRIFT_PX_PER_SECOND = 70
  const track = buildRunCircuit()
  const drift = []

  for (let base = 0; base < track.length; base++) {
    // The mesh's own integration, and it has to be this one: `horizonDriftX` is where that loop
    // ends up, not something derivable from a segment's curve on its own.
    let x = 0
    let dx = 0

    for (let n = 0; n < DRAW_DISTANCE; n++) {
      x += dx
      dx += track[(base + n) % track.length].curve
    }

    drift.push(x)
  }

  // A second of travel at the fastest the game can go -- the boost included, for the same reason
  // the obstacle placer solves its spacing at `MAX_ATTAINABLE_SPEED` rather than at `SPEED_CAP`.
  const segmentsPerSecond = Math.round(MAX_ATTAINABLE_SPEED / SEGMENT_LENGTH)
  let worst = 0

  for (let i = 0; i < drift.length; i++) {
    worst = Math.max(worst, Math.abs(drift[(i + segmentsPerSecond) % drift.length] - drift[i]))
  }

  const pixelsPerSecond = worst * SKYLINE_LAYER.driftPixels

  assert.ok(
    pixelsPerSecond <= MAX_DRIFT_PX_PER_SECOND,
    `the range moves ${pixelsPerSecond.toFixed(0)}px a second, which reads as scrolling scenery`,
  )

  // Shown to reject the value it was written against, so it cannot pass by measuring nothing.
  assert.ok(worst * 0.55 > MAX_DRIFT_PX_PER_SECOND * 50, 'the check no longer rejects the value it was written for')

  // ...and the tile is wider than the frame at every aspect the game supports, so no frame ever
  // holds two copies of the same range. `2.4` below is the aspect at which that stops being true;
  // it is computed rather than written down.
  const span = drift.reduce((a, b) => Math.max(a, b)) - drift.reduce((a, b) => Math.min(a, b))
  let tightest = Infinity
  let tightestAt = ''

  for (const [w, h] of [
    [1920, 945],
    [1568, 772],
    [3440, 1440],
    [390, 844],
    [844, 390],
  ]) {
    const scale = (h * SKYLINE_LAYER.height) / SKYLINE_TEXTURE_SIZE.height
    const ratio = (SKYLINE_TEXTURE_SIZE.width * scale) / w

    if (ratio < tightest) {
      tightest = ratio
      tightestAt = `${w}x${h}`
    }
  }

  assert.ok(tightest >= 1, `the strip tiles ${(1 / tightest).toFixed(2)} times across a ${tightestAt} frame`)
  console.log(
    `    the range moves ${pixelsPerSecond.toFixed(0)}px/s at top speed and ` +
      `${(span * SKYLINE_LAYER.driftPixels).toFixed(0)}px over a whole lap; ` +
      `narrowest tile margin ${tightest.toFixed(2)}x of the frame at ${tightestAt}`,
  )
})

console.log('variety without files')

check('a 300-segment stretch does not repeat itself', () => {
  // **The acceptance the plan states, measured on the real placement.** Five props per biome over
  // 300 segments is what a lap actually shows; without variation every instance of a prop is the
  // same object, and the share of pairs that read alike is 100% within each prop.
  const track = buildStraightTrack(400)

  decorateTrack(track, DECOR_KEYS, { seed: 4242 })

  const instances = []

  for (const segment of track.slice(0, 300)) {
    for (const sprite of segment.sprites) {
      instances.push({
        propId: sprite.key,
        variation: variationFor(segment.index, Math.sign(sprite.offsetX), sprite.key),
      })
    }
  }

  assert.ok(instances.length > 60, `only ${instances.length} props over 300 segments`)

  let alike = 0
  let pairs = 0

  for (let i = 0; i < instances.length; i++) {
    for (let j = i + 1; j < instances.length; j++) {
      pairs++
      if (readsAsSame(instances[i], instances[j])) alike++
    }
  }

  const share = alike / pairs

  console.log(`    ${instances.length} props over 300 segments, ${(share * 100).toFixed(1)}% of pairs read alike`)
  assert.ok(share <= 0.08, `${(share * 100).toFixed(1)}% of pairs read as the same object`)

  // ...and the measure is shown to mean something: with the variation removed, every pair of the
  // same prop reads alike, which is the state this file exists to leave behind.
  const flat = instances.map((instance) => ({
    propId: instance.propId,
    variation: { ...instance.variation, flipX: false, hueShift: 0 },
  }))
  let flatAlike = 0

  for (let i = 0; i < flat.length; i++) {
    for (let j = i + 1; j < flat.length; j++) if (readsAsSame(flat[i], flat[j])) flatAlike++
  }

  assert.ok(flatAlike / pairs > share * 3, 'removing the variation changes nothing, so it is doing nothing')
  console.log(`    without it: ${((flatAlike / pairs) * 100).toFixed(1)}%`)
})

check('the same coordinate always looks the same, and neighbours do not', () => {
  // Derived from the coordinate rather than from the spawn: a prop must not change when the screen
  // rotates, when it lands in a different pool slot, or when the player comes round again.
  const a = variationFor(120, -1, 'for_fern')
  const b = variationFor(120, -1, 'for_fern')

  assert.deepEqual(a, b, 'the same instance came back different')
  assert.notDeepEqual(a, variationFor(121, -1, 'for_fern'), 'two neighbouring segments are identical')
  assert.notDeepEqual(a, variationFor(120, 1, 'for_fern'), 'the two sides of the road are identical')
  assert.notDeepEqual(a, variationFor(120, -1, 'for_pine'), 'two different props vary the same way')

  // Every axis stays inside the range it was authored with.
  for (let segment = 0; segment < 500; segment++) {
    const v = variationFor(segment, segment % 2 ? 1 : -1, 'wet_reed')

    assert.ok(v.scale >= VARIATION.scale.min && v.scale <= VARIATION.scale.max)
    assert.ok(Math.abs(v.hueShift) <= VARIATION.hueDegrees)
    assert.ok(v.satScale >= VARIATION.sat.min && v.satScale <= VARIATION.sat.max)
    assert.ok(v.lightScale >= VARIATION.light.min && v.lightScale <= VARIATION.light.max)
    assert.ok(Math.abs(v.tilt) <= VARIATION.tiltDegrees)
  }
})

check('rocks do not lean, and plants do', () => {
  // A rock at six degrees is a rock that has fallen over.
  for (const stone of ['dune_rock', 'rui_column', 'cry_slab', 'ash_slab', 'coa_stack']) {
    assert.equal(variationFor(7, -1, stone).tilt, 0, `${stone} leans`)
  }
  for (const plant of ['for_fern', 'wet_reeds', 'coa_kelp', 'fun_pair', 'dune_cactus', 'wet_cattail']) {
    assert.notEqual(variationFor(7, -1, plant).tilt, 0, `${plant} does not lean`)
  }
})

check('a shifted tint never carries a prop into the reserved band', () => {
  // **The sweep the biome tints already go through, now over the extremes of the shift.** A tint the
  // player sees is bound by the threat reservation however it was arrived at, and a hue rotation
  // that could reach the danger colour would put it on a bush.
  const themes = themeIds()
  let worst = 999
  let worstPair = ''
  let checked = 0

  for (const biome of BIOMES) {
    for (const themeId of themes) {
      const base = multiplyTint(biome.decorTint, getRoadTheme(themeId).decorTint)

      for (const hue of [-VARIATION.hueDegrees, 0, VARIATION.hueDegrees]) {
        for (const sat of [VARIATION.sat.min, VARIATION.sat.max]) {
          for (const light of [VARIATION.light.min, VARIATION.light.max]) {
            const tint = tintFor(base, { flipX: false, scale: 1, hueShift: hue, satScale: sat, lightScale: light, tilt: 0 })
            const distance = hueDistance(tint, THREAT_COLOR)
            const reserved =
              distance < THREAT_MIN_HUE_DEGREES &&
              chroma(tint) >= THREAT_MIN_CHROMA &&
              Math.abs(toOklab(tint).L - toOklab(THREAT_COLOR).L) < THREAT_LIGHTNESS_ESCAPE

            checked++
            assert.ok(!reserved, `${biome.id} x ${themeId} shifted ${hue} degrees lands ${distance.toFixed(1)} from the threat colour`)
            if (distance < worst) {
              worst = distance
              worstPair = `${biome.id} x ${themeId} ${hue > 0 ? '+' : ''}${hue}`
            }
          }
        }
      }
    }
  }

  console.log(`    ${checked} shifted tints swept; closest is ${worstPair} at ${worst.toFixed(1)} degrees`)
})


// ---------------------------------------------------------------------------------------------
// src/road/decals.ts -- the marks lying in the plane of the ribbon
// ---------------------------------------------------------------------------------------------
console.log('the ground carries marks of its own')

check('a mark is a pure function of where it is, on this lap and the next', () => {
  // The rule the whole file is built on: no decorate pass, nothing stored on a segment, so the
  // same stretch of road looks the same the second time round and at every screen size.
  for (const index of [0, 1, 7, 199, 1433, 90210]) {
    assert.deepEqual(decalAt(index), decalAt(index), `segment ${index} answers differently twice`)
  }

  // ...and different segments really do differ, or "deterministic" would be satisfied by a
  // constant. Counted over a lap rather than compared pairwise: what matters is the variety.
  const marks = []

  for (let index = 0; index < 1434; index++) {
    const decal = decalAt(index)

    if (decal) marks.push(decal)
  }

  assert.ok(marks.length > 0, 'a whole lap carries no marks at all')
  assert.equal(new Set(marks.map((mark) => mark.kind)).size, DECAL_KINDS.length, 'a lap never shows some kinds')
  assert.ok(new Set(marks.map((mark) => mark.offsetX.toFixed(3))).size > marks.length * 0.9)

  const perHundred = (marks.length / 1434) * 100

  console.log(
    `    ${marks.length} marks over a 1434-segment lap = ${perHundred.toFixed(1)} per 100 segments, ` +
      `${new Set(marks.map((mark) => mark.kind)).size} kinds`,
  )
})

check('every mark stays inside the bounds the renderer assumes', () => {
  for (let index = 0; index < 4000; index++) {
    const decal = decalAt(index)

    if (!decal) continue

    assert.ok(Math.abs(decal.offsetX) <= DECAL_MAX_OFFSET, `a mark sits ${decal.offsetX} half-widths out`)
    assert.ok(decal.halfWidth >= DECAL_HALF_WIDTH.min && decal.halfWidth <= DECAL_HALF_WIDTH.max)
    assert.ok(decal.lengthSegments >= DECAL_LENGTH_SEGMENTS.min && decal.lengthSegments <= DECAL_LENGTH_SEGMENTS.max)
    assert.ok(decal.strength > 0 && decal.strength < 1)
    assert.ok(decal.kindIndex >= 0 && decal.kindIndex < DECAL_KINDS.length)
    assert.equal(DECAL_KINDS[decal.kindIndex], decal.kind, 'the kind and its atlas cell disagree')
  }

  // The marks reach the verge as well as the road: a set that only ever painted the asphalt would
  // leave the ground either side exactly as empty as it was before any of this.
  const offsets = []

  for (let index = 0; index < 4000; index++) {
    const decal = decalAt(index)

    if (decal) offsets.push(Math.abs(decal.offsetX))
  }

  assert.ok(
    offsets.some((offset) => offset < 1) && offsets.some((offset) => offset > 1),
    'every mark is on the road, or every mark is off it',
  )
})

check('a mark fades with the ground it lies on, and is dropped once it is fainter than the faintest row', () => {
  // Descending, because the rows *are* the fade: a row that was brighter than the one before it
  // would make a mark jump darker as it receded.
  for (let row = 1; row < DECAL_ROW_ALPHAS.length; row++) {
    assert.ok(DECAL_ROW_ALPHAS[row] < DECAL_ROW_ALPHAS[row - 1])
  }

  // A strong mark up close reads at full strength; the same mark deep in the fog is not drawn.
  assert.equal(decalRowFor(1, 0), 0)
  assert.ok(decalRowFor(0.85, 0.5) > decalRowFor(0.85, 0), 'a mark does not fade with distance')
  assert.equal(decalRowFor(0.85, 1), -1, 'a mark at full fog is still drawn')
  assert.equal(decalFade(0), 0, 'a mark at the camera is already fading')
  assert.equal(decalFade(DECAL_DRAW_SEGMENTS), 1, 'the fade does not finish inside the band it is drawn in')
  assert.equal(decalRowFor(0.02, 0), -1, 'a mark fainter than the faintest row is still drawn')

  // Monotonic the whole way out, which is the property that keeps a receding mark from flickering
  // between two rows as it goes.
  let previous = -Infinity

  for (let fade = 0; fade <= 1.0001; fade += 0.02) {
    const row = decalRowFor(0.85, Math.min(1, fade))

    if (row < 0) break
    assert.ok(row >= previous, `the fade goes backwards at ${fade.toFixed(2)}`)
    previous = row
  }

  // Where the fade actually bites, reported rather than assumed -- it is what makes
  // DECAL_DRAW_SEGMENTS a ceiling rather than the working limit.
  const dropsAt = (strength) => {
    for (let n = 0; n < DECAL_DRAW_SEGMENTS; n++) {
      if (decalRowFor(strength, decalFade(n)) < 0) return n
    }

    return DECAL_DRAW_SEGMENTS
  }

  console.log(
    `    a mark fades out at segment ${dropsAt(0.35)} (faintest) to ${dropsAt(0.85)} (strongest) ` +
      `of a ${DECAL_DRAW_SEGMENTS}-segment band, so nothing winks out at its edge`,
  )
})

check('the pool holds the busiest stretch of the lap', () => {
  // **The relationship the decor pool got wrong twice**: a pool sized against a comment rather
  // than against a sweep reports its own ceiling as the demand. Swept over the whole lap.
  let peak = 0
  let peakAt = 0

  for (let base = 0; base < 1434; base++) {
    const wanted = decalsIn(base, DECAL_DRAW_SEGMENTS)

    if (wanted > peak) {
      peak = wanted
      peakAt = base
    }
  }

  console.log(`    peak demand ${peak} marks in the drawn band (at segment ${peakAt}) against a pool of ${MAX_DECALS}`)
  assert.ok(peak <= MAX_DECALS, `the busiest stretch wants ${peak} marks and the pool holds ${MAX_DECALS}`)
  // ...and the pool is not wildly oversized either, which is the other way to make the number
  // meaningless: a pool nothing can fill says nothing about what the game draws.
  assert.ok(peak > MAX_DECALS * 0.5, `the pool is ${MAX_DECALS} for a peak of ${peak}`)
})


// ---------------------------------------------------------------------------------------------
// src/road/particles.ts -- what hangs in the air over each biome
// ---------------------------------------------------------------------------------------------
console.log('every biome has air of its own')

check('the table and the biomes are the same set, in both directions', () => {
  const biomes = BIOMES.map((biome) => biome.id).sort()
  const air = Object.keys(BIOME_ATMOSPHERE).sort()

  assert.deepEqual(air, biomes, 'a biome has nothing in its air, or the table names one that is gone')

  // Every declared shape is asked for by something. A shape nothing uses is a texture generated at
  // boot that nobody ever sees -- the same waste as a prop no biome places.
  const used = usedMoteShapes()

  assert.equal(new Set(used).size, used.length)
  for (const shape of MOTE_SHAPES) {
    assert.ok(used.includes(shape), `no biome asks for the '${shape}' mote, so nothing draws it`)
  }
  console.log(`    ${biomes.length} biomes over ${MOTE_SHAPES.length} shapes: ${used.join(', ')}`)
})

check('the air is sparse enough to stay air', () => {
  // **A readability bound, not a taste one.** Motes drift across the whole frame, `ENEMY_BAND`
  // included, and atmosphere that competes with a wind-up ring has cost the player a shield. Two
  // things bound it: how many are alive at once, and how strongly any of them is drawn.
  assert.ok(ATMOSPHERE_ALPHA <= 0.4, `motes are drawn at ${ATMOSPHERE_ALPHA}, which is an object rather than air`)

  console.log(`    ${'biome'.padEnd(9)}${'shape'.padStart(7)}${'alive'.padStart(7)}${'fall %/s'.padStart(10)}`)

  for (const biome of BIOMES) {
    const air = atmosphereFor(biome.id)
    // What the emitter actually holds: a mote every `1000 / rate` ms, each living `MOTE_LIFESPAN_MS`.
    const alive = (air.rate * MOTE_LIFESPAN_MS) / 1000

    assert.ok(alive <= MOTE_POOL_SIZE, `${biome.id} wants ${alive.toFixed(0)} motes against a pool of ${MOTE_POOL_SIZE}`)
    assert.ok(alive >= 20, `${biome.id} keeps ${alive.toFixed(0)} motes in the air, which is not weather`)
    // ...and the pool is not so far above the demand that nothing can ever fill it, which is the
    // other way to make a ceiling meaningless. Derived from the table, so both hold by
    // construction -- and the check is what says the derivation is still the one being used.
    assert.ok(MOTE_POOL_SIZE <= alive * 3, `the mote pool is ${MOTE_POOL_SIZE} for a peak of ${alive.toFixed(0)}`)
    assert.ok(air.fall.min > 0 && air.fall.max > air.fall.min, `${biome.id}'s motes do not move`)
    assert.ok(air.scale.min > 0 && air.scale.max > air.scale.min)

    console.log(
      `    ${biome.id.padEnd(9)}${air.shape.padStart(7)}${alive.toFixed(0).padStart(7)}` +
        `${((air.fall.min + air.fall.max) * 50).toFixed(1).padStart(10)}`,
    )
  }
})

check('no mote is drawn in the reserved threat colour', () => {
  // A reservation enforced on one palette is not enforced -- the lesson the interface palette
  // taught by shipping the danger hue as the player's own accent. A mote drifts across the whole
  // frame, so it is exactly the kind of thing that must not wear it.
  const threat = toOklab(THREAT_COLOR)
  let worst = 180
  let worstId = ''

  for (const [id, air] of Object.entries(BIOME_ATMOSPHERE)) {
    const hue = hueDistance(air.tint, THREAT_COLOR)
    const inside =
      hue < THREAT_MIN_HUE_DEGREES &&
      chroma(air.tint) >= THREAT_MIN_CHROMA &&
      Math.abs(toOklab(air.tint).L - threat.L) < THREAT_LIGHTNESS_ESCAPE

    assert.ok(!inside, `${id}'s motes are inside the reserved threat band (0x${air.tint.toString(16)})`)
    if (hue < worst) {
      worst = hue
      worstId = id
    }
  }

  console.log(`    nearest mote hue to the threat colour: ${worstId} at ${worst.toFixed(1)} degrees`)
})


// ---------------------------------------------------------------------------------------------
// The skyline's tint: it belongs to the air, and it may not step.
// ---------------------------------------------------------------------------------------------

/** Exactly what `Backdrop.setSkylineTint` composes, so the check cannot drift from the layer. */
function skylineTintAt(index, trackLength, theme) {
  const steer = multiplyTint(skylineBiomeTint(index, trackLength), theme.decorTint)

  return blendColor(theme.sky.bottom, steer, BIOME_SKYLINE_WEIGHT)
}

/** The old arrangement, kept as the negative control: the ground family, stepped per segment. */
function groundFamilyTintAt(index, trackLength, theme) {
  const steer = multiplyTint(biomeForSegment(index, trackLength).decorTint, theme.decorTint)

  return blendColor(theme.sky.band, steer, 0.38)
}

const channels = (colour) => [(colour >> 16) & 0xff, (colour >> 8) & 0xff, colour & 0xff]
const worstChannel = (a, b) => Math.max(...channels(a).map((v, i) => Math.abs(v - channels(b)[i])))

check('the biome steers the skyline at no more than 0.3, and the rest is aerial perspective', () => {
  assert.ok(
    BIOME_SKYLINE_WEIGHT > 0,
    'a weight of 0 would make every biome look identical on the horizon -- the steer is meant to survive, only quietly',
  )
  assert.ok(
    BIOME_SKYLINE_WEIGHT <= 0.3,
    `the biome supplies ${BIOME_SKYLINE_WEIGHT} of the range's colour; past 0.3 the ground under the player is repainting the horizon`,
  )

  console.log(
    `    biome steer ${(BIOME_SKYLINE_WEIGHT * 100).toFixed(0)}%, aerial perspective ${((1 - BIOME_SKYLINE_WEIGHT) * 100).toFixed(0)}%`,
  )
})

check('the skyline never steps: a whole lap moves it by under a level a segment, on every theme', () => {
  // The strip has no `z`, so whatever it is handed lands across the full width of the frame in one
  // frame. A per-segment jump the eye can see IS the artefact -- there is no distance for it to
  // sweep along, which is the entire difference between this layer and the ground.
  const track = buildRunCircuit()
  const length = track.length // SEGMENTS, not world units -- biomeIndexForSegment counts segments
  const budget = 1

  let worstStep = 0
  let worstAt = ''

  for (const id of themeIds()) {
    const theme = THEMES[id]

    for (let i = 0; i < length; i += 1) {
      const step = worstChannel(skylineTintAt(i, length, theme), skylineTintAt(i + 1, length, theme))

      if (step > worstStep) {
        worstStep = step
        worstAt = `${id} at segment ${i}`
      }
    }
  }

  assert.ok(
    worstStep <= budget,
    `the skyline jumps ${worstStep} levels in one segment (${worstAt}); a whole-width tint change that big reads as a dropped texture`,
  )

  // A check that has never rejected anything is not evidence. The shipped arrangement is compared
  // against the one it replaced -- the ground family, stepped -- which must still be caught.
  const theme = THEMES[DEFAULT_ROAD_THEME]
  let oldWorst = 0

  for (let i = 0; i < length; i += 1) {
    oldWorst = Math.max(oldWorst, worstChannel(groundFamilyTintAt(i, length, theme), groundFamilyTintAt(i + 1, length, theme)))
  }

  assert.ok(
    oldWorst > budget,
    'the negative control is not being rejected, so this check is measuring nothing',
  )

  console.log(
    `    worst single-segment move: ${worstStep} of 255 (${worstAt}); the stepped ground-family version it replaced: ${oldWorst}`,
  )
})

check('ten segments either side of a biome seam are barely a different colour', () => {
  // The acceptance, stated as arithmetic rather than as a screenshot: the pair of frames a player
  // would compare across a boundary.
  const track = buildRunCircuit()
  const length = track.length // SEGMENTS, not world units -- biomeIndexForSegment counts segments
  const run = biomeRunSegments(length)
  const budget = 8

  let worst = 0
  let worstAt = ''

  for (const id of themeIds()) {
    const theme = THEMES[id]

    for (let seam = run; seam < length; seam += run) {
      const gap = worstChannel(skylineTintAt(seam - 10, length, theme), skylineTintAt(seam + 10, length, theme))

      if (gap > worst) {
        worst = gap
        worstAt = `${id} at the seam on segment ${seam}`
      }
    }
  }

  assert.ok(worst <= budget, `the range changes by ${worst} levels across a seam (${worstAt})`)
  console.log(`    widest colour gap across a seam, -10 to +10 segments: ${worst} of 255 (${worstAt})`)
})

check('the seam crossfade is centred on the seam, not trailing it', () => {
  // Half done at the boundary is what makes neither end of the move a surprise: approaching the
  // seam the horizon has already begun to change, and it finishes after the ground has.
  const track = buildRunCircuit()
  const length = track.length // SEGMENTS, not world units -- biomeIndexForSegment counts segments
  const run = biomeRunSegments(length)
  const half = SKYLINE_SEAM_BLEND_SEGMENTS / 2

  const before = biomeForSegment(run - 1, length).decorTint
  const after = biomeForSegment(run, length).decorTint

  assert.notEqual(before, after, 'the fixture is not a seam at all -- these two segments are the same biome')

  const atSeam = skylineBiomeTint(run, length)
  const midpoint = blendColor(before, after, 0.5)

  assert.ok(
    worstChannel(atSeam, midpoint) <= 2,
    'the crossfade is not half done at the seam, so it is trailing the boundary rather than straddling it',
  )
  // At the window's own edges the ease has all but closed -- "all but" rather than "exactly"
  // because the two branches straddle the boundary by half a segment each, which is the thing
  // that keeps them continuous across it.
  assert.ok(worstChannel(skylineBiomeTint(run - half, length), before) <= 1, 'the crossfade starts before the window opens')
  assert.ok(worstChannel(skylineBiomeTint(run + half, length), after) <= 1, 'the crossfade is still running after the window closes')

  console.log(
    `    crossfade spans ${SKYLINE_SEAM_BLEND_SEGMENTS} segments centred on the seam, against a biome run of ${run}`,
  )
})

check('a pinned biome has no seam to cross, and the crossfade does not invent one', () => {
  // A level is one biome for its whole track. Every lookup inside the blend returns the same
  // record there, so the interpolation runs between a colour and itself -- asserted rather than
  // assumed, because a hand-rolled neighbour index would quietly blend towards a biome that is
  // not on this track at all.
  const track = buildStraightTrack(500)
  const length = track.length // SEGMENTS, not world units -- biomeIndexForSegment counts segments

  setBiomeLayout({ kind: 'single', index: 3 })
  try {
    for (let i = 0; i < length; i += 7) {
      assert.equal(skylineBiomeTint(i, length), BIOMES[3].decorTint, `segment ${i} drifted off the pinned biome`)
    }
  } finally {
    setBiomeLayout({ kind: 'cycle' })
  }
})


// ---------------------------------------------------------------------------------------------
// The ground's five shades: they have to be five, and they have to be five on two axes.
// ---------------------------------------------------------------------------------------------

check('every biome delivers five ground shades that differ on BOTH lightness and chroma', () => {
  // **The failure this exists for is not "wrong colours", it is "five that read as one".** A set
  // spread along a single axis collapses under the eye's own ordering -- five brightnesses is a
  // gradient, five saturations is a gradient. So both axes are measured separately and both have
  // to carry a real range; passing one and failing the other is exactly the defect.
  const minLightnessRange = 0.05
  const minChromaRange = 0.012

  let worstL = Infinity
  let worstC = Infinity
  let worstLAt = ''
  let worstCAt = ''

  for (const id of themeIds()) {
    const theme = THEMES[id]

    for (const biome of BIOMES) {
      const shades = groundShadesForTheme(
        biome.ground,
        theme.road[PALETTE_INDEX.ASPHALT_DARK],
        theme.road[PALETTE_INDEX.ASPHALT_LIGHT],
        undefined,
        theme.groundLight,
      )

      assert.equal(shades.length, GROUND_SHADES_PER_BIOME, `${id}/${biome.id} delivered ${shades.length} shades`)
      assert.equal(new Set(shades).size, GROUND_SHADES_PER_BIOME, `${id}/${biome.id} has two shades of the same colour`)

      const lightness = shades.map((c) => toOklab(c).L)
      const chromas = shades.map((c) => chroma(c))
      const lRange = Math.max(...lightness) - Math.min(...lightness)
      const cRange = Math.max(...chromas) - Math.min(...chromas)

      if (lRange < worstL) { worstL = lRange; worstLAt = `${id}/${biome.id}` }
      if (cRange < worstC) { worstC = cRange; worstCAt = `${id}/${biome.id}` }
    }
  }

  assert.ok(worstL >= minLightnessRange, `${worstLAt} spreads its five shades over only ${worstL.toFixed(4)} of lightness`)
  assert.ok(worstC >= minChromaRange, `${worstCAt} spreads its five shades over only ${worstC.toFixed(4)} of chroma`)

  // A check that has never rejected anything is not evidence: a spread that moves lightness alone
  // -- the obvious way to write this table, and the one that reads as a gradient -- must fail the
  // chroma half while sailing through the lightness half.
  const flat = GROUND_SHADE_SPREAD.map((offset) => ({ lightness: offset.lightness, chroma: 0 }))
  const theme = THEMES[DEFAULT_ROAD_THEME]
  const pair = groundPairForTheme(
    BIOMES[0].ground,
    theme.road[PALETTE_INDEX.ASPHALT_DARK],
    theme.road[PALETTE_INDEX.ASPHALT_LIGHT],
    undefined,
    theme.groundLight,
  )
  const flatChromas = flat.map((offset) => {
    const lab = toOklab(pair[0])

    return chroma(fromOklab({ L: Math.min(1, Math.max(0, lab.L + offset.lightness)), a: lab.a, b: lab.b }))
  })

  assert.ok(
    Math.max(...flatChromas) - Math.min(...flatChromas) < minChromaRange,
    'a lightness-only spread is not being rejected, so the chroma half of this check is measuring nothing',
  )

  console.log(
    `    tightest spread across the 63 biome/theme pairs: ${worstL.toFixed(4)} lightness (${worstLAt}), ${worstC.toFixed(4)} chroma (${worstCAt})`,
  )
})

check('every ground shade still clears the asphalt, so five columns cannot hide a merged one', () => {
  // `MIN_GROUND_CONTRAST` used to be asked of one colour per biome. There are five now, and the
  // spread moves lightness -- so the shade nearest the road is not the one the pair was checked
  // on, and a set that passes on its middle can still have an end that has merged with the road.
  let worst = Infinity
  let worstAt = ''

  for (const id of themeIds()) {
    const theme = THEMES[id]
    // `contrastRatio` takes COLOURS and relativeLuminance-es them itself. Handing it two
    // luminances instead returns 1.00 for everything, which reads exactly like a ground that has
    // merged with the road -- this check's first run "found" that on day/forest and the defect
    // was here.
    const dark = theme.road[PALETTE_INDEX.ASPHALT_DARK]
    const light = theme.road[PALETTE_INDEX.ASPHALT_LIGHT]
    const roadLo = relativeLuminance(dark) <= relativeLuminance(light) ? dark : light
    const roadHi = roadLo === dark ? light : dark

    for (const biome of BIOMES) {
      for (const shade of groundShadesForTheme(
        biome.ground,
        theme.road[PALETTE_INDEX.ASPHALT_DARK],
        theme.road[PALETTE_INDEX.ASPHALT_LIGHT],
        undefined,
        theme.groundLight,
      )) {
        const near = contrastRatio(shade, roadLo) < contrastRatio(shade, roadHi) ? roadLo : roadHi
        const ratio = contrastRatio(shade, near)

        if (ratio < worst) { worst = ratio; worstAt = `${id}/${biome.id}` }
      }
    }
  }

  assert.ok(worst >= MIN_GROUND_CONTRAST, `${worstAt} has a ground shade at ${worst.toFixed(2)}:1 against the asphalt`)
  console.log(`    worst ground shade against its own asphalt: ${worst.toFixed(2)}:1 (${worstAt}), floor ${MIN_GROUND_CONTRAST}`)
})

check('the ground is drawn in patches, not in per-segment ripple', () => {
  // Deterministic: the same segment answers the same on the next lap and at every viewport.
  for (const index of [0, 1, 7, 158, 159, 1433, 99999]) {
    assert.equal(groundShadeFor(index), groundShadeFor(index), `segment ${index} is not deterministic`)
  }

  const sample = 40000
  const counts = new Array(GROUND_SHADES_PER_BIOME).fill(0)
  const runs = []
  let run = 1

  for (let i = 0; i < sample; i++) {
    const shade = groundShadeFor(i)

    assert.ok(Number.isInteger(shade) && shade >= 0 && shade < GROUND_SHADES_PER_BIOME, `segment ${i} chose shade ${shade}`)
    counts[shade] += 1

    if (i > 0 && shade === groundShadeFor(i - 1)) run += 1
    else if (i > 0) { runs.push(run); run = 1 }
  }

  // Every column is actually drawn -- a column nobody ever sees is a column that is not there --
  // and the middle three carry more of the ground than the two ends. That second half is not a
  // preference expressed anywhere in the code: it falls out of the noise, which concentrates
  // towards the middle of its range, and it is asserted here so that if the noise is ever
  // replaced by something uniform the ground quietly becoming five equal materials is caught.
  for (const [shade, n] of counts.entries()) {
    assert.ok(n > sample * 0.08, `shade ${shade} covers ${n} of ${sample} segments -- effectively unused`)
  }
  assert.ok(
    Math.min(counts[1], counts[2], counts[3]) > Math.max(counts[0], counts[4]),
    `the ends of the spread are as common as its middle (${counts.join('/')}) -- the ground reads as five materials, not one`,
  )

  // **The acceptance for this step, and the thing the previous one failed.** A per-segment hash
  // gives a mean run of ~1.25 segments, which at this projection is horizontal ripple across the
  // verge; patches have to be long enough to read as ground and short enough to still be patches.
  const mean = runs.reduce((sum, r) => sum + r, 0) / runs.length

  assert.ok(
    mean >= GROUND_PATCH_MIN_SEGMENTS && mean <= GROUND_PATCH_MAX_SEGMENTS,
    `patches average ${mean.toFixed(1)} segments, outside ${GROUND_PATCH_MIN_SEGMENTS}..${GROUND_PATCH_MAX_SEGMENTS}`,
  )

  // Varied, not a metronome: patches all of one length would be a stripe pattern with extra steps.
  const spread = Math.sqrt(runs.reduce((sum, r) => sum + (r - mean) ** 2, 0) / runs.length)

  assert.ok(spread > 1, `every patch is ${mean.toFixed(1)} segments long (spread ${spread.toFixed(2)}) -- that is a pattern, not noise`)

  // **No periodicity at the lattice spacing.** The noise repeats its *scale* every
  // `GROUND_PATCH_SEGMENTS`; if it repeated its *values* there, the ground would be one patch
  // stamped down the whole track. Sampled at multiples of the spacing, agreement must stay near
  // what independent draws give.
  const chance = counts.reduce((sum, n) => sum + (n / sample) ** 2, 0)

  for (let k = 1; k <= 5; k++) {
    const lag = k * GROUND_PATCH_SEGMENTS
    let same = 0

    for (let i = 0; i < sample; i++) if (groundShadeFor(i) === groundShadeFor(i + lag)) same += 1

    const rate = same / sample

    assert.ok(rate < chance * 1.6, `the ground repeats itself every ${lag} segments on ${(rate * 100).toFixed(1)}% of them, against ${(chance * 100).toFixed(0)}% by chance`)
  }

  // Shown to reject both failure modes it sits between: the per-segment hash this replaced, and
  // a modulo. Neither can produce a patch.
  const hashed = (i) => {
    let h = Math.trunc(i) | 0
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
    return ((h ^ (h >>> 16)) >>> 0) % GROUND_SHADES_PER_BIOME
  }

  for (const [name, fn] of [['a per-segment hash', hashed], ['a modulo', (i) => i % GROUND_SHADES_PER_BIOME]]) {
    let control = 1
    const controlRuns = []

    for (let i = 1; i < 4000; i++) {
      if (fn(i) === fn(i - 1)) control += 1
      else { controlRuns.push(control); control = 1 }
    }

    const controlMean = controlRuns.reduce((sum, r) => sum + r, 0) / controlRuns.length

    assert.ok(
      controlMean < GROUND_PATCH_MIN_SEGMENTS,
      `${name} averages ${controlMean.toFixed(2)}-segment runs, which this check is failing to reject`,
    )
  }

  // The figure `GROUND_PATCH_SEGMENTS` was actually tuned on: a one- or two-segment patch is a
  // horizontal band across the verge, i.e. the ripple, so what matters is how little ground is
  // in one -- not the mean, which a few very long patches flatter.
  const sliverShare = runs.filter((r) => r <= 2).reduce((sum, r) => sum + r, 0) / sample
  const sorted = [...runs].sort((a, b) => a - b)

  assert.ok(sliverShare < 0.05, `${(sliverShare * 100).toFixed(1)}% of the ground sits in patches under three segments`)

  console.log(
    `    patches: median ${sorted[sorted.length >> 1]}, mean ${mean.toFixed(1)}, longest ${Math.max(...runs)} segments; ${(sliverShare * 100).toFixed(1)}% of ground in slivers; coverage ${counts.map((n) => `${((100 * n) / sample).toFixed(0)}%`).join('/')}`,
  )
})


check('a mark only ever lands on ground that could have made it', () => {
  // A puddle in the dunes is the same failure a palm tree on a glacier is, and it became possible
  // the moment the field left the asphalt. Every biome names its own set; nothing may draw from
  // outside it.
  for (const biome of BIOMES) {
    assert.ok(biome.decals.length >= 3, `${biome.id} names only ${biome.decals.length} marks`)
    for (const kind of biome.decals) {
      assert.ok(DECAL_KINDS.includes(kind), `${biome.id} names a mark "${kind}" that does not exist`)
    }
  }

  const track = buildRunCircuit()
  const length = track.length
  const used = new Map()

  for (let i = 0; i < length; i++) {
    const decal = decalAt(i, length)

    if (!decal) continue

    const biome = biomeForSegment(i, length)

    assert.ok(
      biome.decals.includes(decal.kind),
      `segment ${i} is ${biome.id} and carries a ${decal.kind}, which ${biome.id} does not have`,
    )
    used.set(biome.id, (used.get(biome.id) ?? new Set()).add(decal.kind))
  }

  // And every biome actually uses the set it names -- a list that never reaches the ground is a
  // list nobody can tell is wrong.
  for (const biome of BIOMES) {
    const seen = used.get(biome.id) ?? new Set()

    assert.ok(seen.size >= 3, `${biome.id} only ever drew ${seen.size} of its ${biome.decals.length} marks over a whole lap`)
  }

  // Shown to bite: without the biome argument the placer falls back to the whole vocabulary, and
  // that has to be visibly a different answer or this check is measuring nothing.
  let wrongForBiome = 0

  for (let i = 0; i < length; i++) {
    const anywhere = decalAt(i, 0)

    if (anywhere && !biomeForSegment(i, length).decals.includes(anywhere.kind)) wrongForBiome += 1
  }
  assert.ok(wrongForBiome > 0, 'the unrestricted placer never picks a mark the biome lacks, so the restriction is untested')

  console.log(`    marks drawn per biome: ${BIOMES.map((b) => `${b.id} ${(used.get(b.id) ?? new Set()).size}/${b.decals.length}`).join(', ')}`)
})

check('the marks reach across the verge but still crowd the band the player reads', () => {
  // Widening the field is the point of the step; leaving the offsets uniform across it would make
  // the near verge -- the only part read at speed -- six times emptier than it was. Same trade,
  // and the same fix, as `DECOR.OFFSET_BIAS`.
  const track = buildRunCircuit()
  const length = track.length
  const offsets = []

  for (let i = 0; i < length; i++) {
    const decal = decalAt(i, length)

    if (decal) offsets.push(Math.abs(decal.offsetX))
  }

  const near = offsets.filter((o) => o <= 2.2).length / offsets.length
  const wide = offsets.filter((o) => o > 6).length / offsets.length

  assert.ok(near > 0.25, `only ${(near * 100).toFixed(0)}% of marks are inside the old 2.2 band -- the road has been emptied to fill the verge`)
  assert.ok(wide > 0.05, `only ${(wide * 100).toFixed(0)}% of marks are past 6 half-widths -- the field did not actually widen`)
  assert.ok(Math.max(...offsets) > DECAL_MAX_OFFSET * 0.8, 'nothing gets near the edge of the field, so its width is nominal')

  console.log(
    `    ${offsets.length} marks: ${(near * 100).toFixed(0)}% inside the old 2.2 band, ${(wide * 100).toFixed(0)}% past 6, widest ${Math.max(...offsets).toFixed(1)} of ${DECAL_MAX_OFFSET}`,
  )
})


check('the sun is a drawn object: even rays, roots under the disc, nothing outside the texture', () => {
  // Every one of these is a way the sun stops reading as drawn and starts reading as an artefact,
  // and none of them is visible from the constants without doing the arithmetic.
  assert.equal(SUN_RAYS.count % 2, 0, `${SUN_RAYS.count} rays cannot alternate: the ring closes with two long ones adjacent`)

  const spacing = (Math.PI * 2) / SUN_RAYS.count
  const angles = []

  for (let i = 0; i < SUN_RAYS.count; i++) {
    const ray = sunRay(i)

    angles.push(ray.angle)
    assert.ok(
      ray.length === SUN_RAYS.longLength || ray.length === SUN_RAYS.shortLength,
      `ray ${i} is ${ray.length} long, which is neither of the two lengths`,
    )
    assert.notEqual(ray.length, sunRay(i + 1).length, `rays ${i} and ${i + 1} are the same length`)
    // Wrapping is what makes "alternating" a property of the ring rather than of the list.
    assert.equal(sunRay(i).length, sunRay(i + SUN_RAYS.count).length, `ray ${i} does not wrap`)
  }

  for (let i = 1; i < angles.length; i++) {
    assert.ok(Math.abs(angles[i] - angles[i - 1] - spacing) < 1e-12, `rays ${i - 1} and ${i} are not evenly spaced`)
  }

  // A ray whose root sits outside the disc shows its own base as a hard edge floating off the sun.
  assert.ok(
    SUN_RAYS.innerRadius < SUN_DISC_STOP,
    `rays start at ${SUN_RAYS.innerRadius} but the disc ends at ${SUN_DISC_STOP}, so every root is drawn in open sky`,
  )
  // And one that reaches past the texture is cropped square by the canvas.
  assert.ok(SUN_RAYS.longLength <= 1, `the longest ray reaches ${SUN_RAYS.longLength} of the texture radius and is cut off by its edge`)

  // The spikes have to stay separate or they merge into a collar around the disc.
  const gap = spacing - SUN_RAYS.halfAngle * 2

  assert.ok(gap > SUN_RAYS.halfAngle, `only ${((gap * 180) / Math.PI).toFixed(1)} degrees between rays ${((SUN_RAYS.halfAngle * 360) / Math.PI).toFixed(1)} degrees wide`)

  // Shown to reject the arrangement it is written against: twice the rays at the same width close
  // the gap completely.
  assert.ok(
    (Math.PI * 2) / (SUN_RAYS.count * 2) - SUN_RAYS.halfAngle * 2 <= SUN_RAYS.halfAngle,
    'doubling the ray count is not being rejected, so the spacing rule is measuring nothing',
  )

  // The hot centre has to end inside the disc, or "core" and "disc" are the same stop and the
  // gradient across the disc -- the thing that makes it drawn rather than photographed -- is gone.
  assert.ok(
    SUN_CORE_STOP < SUN_DISC_STOP,
    `the hot centre reaches ${SUN_CORE_STOP} and the disc ends at ${SUN_DISC_STOP}, so the disc has no colour of its own`,
  )
  assert.ok(SUN_CORE_WHITEN > SUN_RIM_WHITEN, 'the disc is not hotter in the middle than at its rim')

  // A blunt tip is what separates a drawn ray from a lens flare; a needle is the failure.
  assert.ok(SUN_RAYS.tipTaper > 0.15, `a tip ${SUN_RAYS.tipTaper} of the base reads as a flare, not as a drawing`)

  console.log(
    `    ${SUN_RAYS.count} rays, ${((SUN_RAYS.halfAngle * 360) / Math.PI).toFixed(0)} degrees wide with ${((gap * 180) / Math.PI).toFixed(0)} between; ${SUN_RAYS.longLength}/${SUN_RAYS.shortLength} long from a disc ending at ${SUN_DISC_STOP}`,
  )
})

check('the sun stays inside the frame at every supported aspect, and out of the HUD rows', () => {
  // Sized off the frame's HEIGHT: measured off the width it is a pinhead on an ultrawide frame
  // and half the sky on a portrait phone. This check is what makes that claim testable, since the
  // failure only shows at an aspect nobody happened to open.
  const viewports = [[1920, 1080], [1568, 772], [3440, 1440], [844, 390], [390, 844]]
  let worstTop = 1
  let offFrameWithoutClamp = 0

  for (const [width, height] of viewports) {
    const drawn = height * SUN.size
    const left = sunCenterX(width, height) - drawn / 2
    const right = sunCenterX(width, height) + drawn / 2
    const top = height * SUN.y - drawn / 2
    const bottom = height * SUN.y + drawn / 2

    assert.ok(left > 0 && right < width, `at ${width}x${height} the sun runs from ${left.toFixed(0)} to ${right.toFixed(0)}`)
    // Shown to bite: the unclamped fraction is what put the sun off a portrait frame's edge.
    if (width * SUN.x + drawn / 2 > width) offFrameWithoutClamp += 1
    assert.ok(top > 0, `at ${width}x${height} the sun's top edge is at ${top.toFixed(0)}`)
    // The horizon is where the ground starts; a sun crossing it is a sun behind the road.
    assert.ok(bottom < height * HORIZON_Y, `at ${width}x${height} the sun reaches ${bottom.toFixed(0)} against a horizon at ${(height * HORIZON_Y).toFixed(0)}`)
    worstTop = Math.min(worstTop, top / height)
  }

  assert.ok(offFrameWithoutClamp > 0, 'no supported aspect needs the clamp, so `sunCenterX` is untested')
  console.log(
    `    sun spans ${(SUN.size * 100).toFixed(0)}% of frame height; ${offFrameWithoutClamp} of ${viewports.length} aspects would put it off the edge unclamped; closest its top edge comes is ${(worstTop * 100).toFixed(1)}%`,
  )
})

console.log(`${passed} checks passed`)
