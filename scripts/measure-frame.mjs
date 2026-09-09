#!/usr/bin/env node
// Not a suite and it asserts nothing: it reports what the run's own per-frame work costs, and what
// the one-off work costs on the frames that do it.
//
// **This exists because the browser harness cannot measure a frame-time tail and this can.** A tab
// driven by automation is hidden, so rAF never fires and the loop has to be hand-stepped; big
// batches then saturate the GPU driver and `renderer.render` measures backpressure, while paced
// batches stall on the CDP round trip. What that instrument genuinely cannot give is an honest p99.
//
// What it can be replaced by, for everything except the draw, is Node: `stepRun`, `stepPlayer`,
// `stepCritters`, every collision, and the whole lap build are `phaser`-free by the rule the
// `verify:*` scripts are under. So the tail is measurable here, exactly, with nothing throttled.
import { performance } from 'node:perf_hooks'
import { placeRunObstacles } from '../src/run/obstacles.ts'
import { placeFormations } from '../src/run/formations.ts'
import { placeRamps, RAMP_LAUNCH_V } from '../src/run/ramp.ts'
import { createRng } from '../src/race/rng.ts'
import { SEGMENT_LENGTH } from '../src/road/constants.ts'
import { createRunState, stepRun } from '../src/run/runState.ts'
import { createPlayerState, stepPlayer } from '../src/run/playerMotion.ts'
import { createCritterField, stepCritters } from '../src/run/critters.ts'
import { stepSlime } from '../src/run/slime.ts'
import { HANDOVER_MARGIN, LapLayout } from '../src/run/lapLayout.ts'

const TRACK = 286800
const SEED = 1234

function buildLap(lapOffset) {
  const obstacles = placeRunObstacles(SEED, TRACK, lapOffset)
  const ramps = placeRamps(SEED ^ 0x2a17, TRACK, lapOffset, obstacles)
  const pickups = placeFormations({
    rng: createRng((SEED ^ 0x5eed) + Math.round(lapOffset / SEGMENT_LENGTH)),
    fromZ: lapOffset === 0 ? SEGMENT_LENGTH * 20 : 0,
    toZ: TRACK,
    trackLength: TRACK,
    obstacles,
    launches: ramps.map((r) => ({ id: r.id, z: r.z, offsetX: r.offsetX, launchV: RAMP_LAUNCH_V })),
  })

  return { obstacles, pickups, ramps }
}

function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b)
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]

  return {
    n: sorted.length,
    mean: samples.reduce((a, b) => a + b, 0) / samples.length,
    p50: at(0.5),
    p90: at(0.9),
    p99: at(0.99),
    max: sorted[sorted.length - 1],
  }
}

const ms = (v) => `${v.toFixed(3)}ms`
const row = (name, s) =>
  console.log(
    `  ${name.padEnd(26)} n=${String(s.n).padStart(5)}  mean ${ms(s.mean).padStart(9)}` +
      `  p50 ${ms(s.p50).padStart(9)}  p90 ${ms(s.p90).padStart(9)}` +
      `  p99 ${ms(s.p99).padStart(9)}  max ${ms(s.max).padStart(9)}`,
  )

// ------------------------------------------------------------------------------------------
console.log('\nthe one-off work: building a lap')
console.log('  This runs inside `LapLayout.advance`, on one frame, once per lap.\n')

// A warm-up, because a first call measures the JIT rather than the placer.
for (let i = 0; i < 3; i++) buildLap(i * TRACK)

const builds = []

for (let lap = 0; lap < 40; lap++) {
  const t = performance.now()

  buildLap(lap * TRACK)
  builds.push(performance.now() - t)
}
row('buildLap', stats(builds))

const parts = { obstacles: [], ramps: [], pickups: [] }

for (let lap = 0; lap < 40; lap++) {
  let t = performance.now()
  const obstacles = placeRunObstacles(SEED, TRACK, lap * TRACK)

  parts.obstacles.push(performance.now() - t)
  t = performance.now()
  const ramps = placeRamps(SEED ^ 0x2a17, TRACK, lap * TRACK, obstacles)

  parts.ramps.push(performance.now() - t)
  t = performance.now()
  placeFormations({
    rng: createRng((SEED ^ 0x5eed) + lap * (TRACK / SEGMENT_LENGTH)),
    fromZ: 0,
    toZ: TRACK,
    trackLength: TRACK,
    obstacles,
    launches: ramps.map((r) => ({ id: r.id, z: r.z, offsetX: r.offsetX, launchV: RAMP_LAUNCH_V })),
  })
  parts.pickups.push(performance.now() - t)
}
row('  placeRunObstacles', stats(parts.obstacles))
row('  placeRamps', stats(parts.ramps))
row('  placeFormations', stats(parts.pickups))

// ------------------------------------------------------------------------------------------
console.log('\nthe per-frame work: a real run, stepped')
console.log('  Everything `update` does before the draw. The draw is not here — see the header.\n')

const layout = new LapLayout({
  trackLength: TRACK,
  segmentCount: TRACK / SEGMENT_LENGTH,
  build: buildLap,
  startLap: 0,
})
let run = createRunState()
let player = createPlayerState()
const critters = createCritterField(SEED ^ 0x1b0d)
const slime = []
const frame = []
const advance = []
const FRAMES = 20000
const DT = 1000 / 60

for (let i = 0; i < FRAMES; i++) {
  const t = performance.now()

  player = stepPlayer(player, { targetFraction: 0.5 + Math.sin(i / 37) * 0.3, active: true }, DT)

  const a = performance.now()

  layout.advance(run.distance)
  advance.push(performance.now() - a)

  run = stepRun(run, DT, { trackLength: TRACK, drag: 0 })
  stepCritters(critters, run.distance + 1650, DT)
  stepSlime(slime, run.distance, run.z, player.offsetX, run.speed, TRACK)
  frame.push(performance.now() - t)
}
row('the whole step', stats(frame))
row('  of which lap.advance', stats(advance))

const overOne = frame.filter((v) => v > 1).length
const overFour = frame.filter((v) => v > 4).length

console.log(
  `\n  ${FRAMES} frames = ${(run.distance / 100).toFixed(0)}m, ${(run.distance / TRACK).toFixed(1)} laps` +
    `\n  frames over 1ms: ${overOne} (${((overOne / FRAMES) * 100).toFixed(2)}%)` +
    `   over 4ms: ${overFour} (${((overFour / FRAMES) * 100).toFixed(2)}%)\n`,
)
