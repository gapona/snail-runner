#!/usr/bin/env node
// Logic check for the on-device perf overlay's pure half -- src/perf/frameStats.ts (the rolling
// window, the percentiles, the warm-up discard, the long-frame counts and the GC detection) and
// src/perf/perfFlags.ts (what `?perf=1` and `?msaa=0` mean, and the reload that flips the latter).
//
// The DOM half -- src/perf/perfOverlay.ts -- is checked in the browser and by the build: a
// production `npm run build` has to come out without the overlay's element id in it, which
// check-bundle.mjs greps for. What is held here is that the numbers the overlay prints are the
// numbers a phone's frames actually had; a wrong percentile is worse than none, because it sends
// the next perf round at the wrong figure with the confidence of a measurement.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  DROPPED_FRAME_MS,
  FRAME_WINDOW,
  FrameStats,
  GC_DROP_BYTES,
  LONG_FRAME_MS,
  STALL_MS,
  WARMUP_FRAMES,
  percentile,
  summarise,
} from '../src/perf/frameStats.ts'
import { MSAA_FLAG, PERF_FLAG, msaaDisabled, perfRequested, toggledMsaaSearch } from '../src/perf/perfFlags.ts'

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`ok - ${name}`)
}

/** A stats object past its warm-up, so a check about the window is not also a check about the discard. */
function warmed(window = FRAME_WINDOW) {
  const stats = new FrameStats(window)
  for (let i = 0; i < WARMUP_FRAMES; i += 1) stats.push(16.7, 1)
  return stats
}

check('nearest-rank percentiles return a value a frame actually had, never an interpolation', () => {
  const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  assert.equal(percentile(sorted, 0.5), 5)
  assert.equal(percentile(sorted, 0.9), 9)
  assert.equal(percentile(sorted, 0.99), 10)
  assert.equal(percentile(sorted, 1), 10)
  assert.equal(percentile(sorted, 0), 1)
  assert.equal(percentile([], 0.5), 0)

  // Two hitches in a hundred are the whole p99 and none of the p90 -- which is what makes the p99
  // the number to read for a hitch, and what an interpolating definition blurs. ONE hitch in a
  // hundred is the max and not the p99: nearest-rank p99 of 100 samples is the 99th, and a tail
  // one frame long is what `max` is for.
  const hundred = Array.from({ length: 100 }, (_, i) => (i >= 98 ? 50 : 16))
  const s = summarise(hundred)
  assert.equal(s.p50, 16)
  assert.equal(s.p90, 16)
  assert.equal(s.p99, 50)
  assert.equal(s.max, 50)
  assert.equal(s.n, 100)
  const one = summarise(Array.from({ length: 100 }, (_, i) => (i === 99 ? 50 : 16)))
  assert.equal(one.p99, 16)
  assert.equal(one.max, 50)

  // `summarise` sorts a copy -- the ring buffer it is handed must not come back sorted.
  const ring = Float64Array.from([3, 1, 2])
  summarise(ring)
  assert.deepEqual(Array.from(ring), [3, 1, 2])
})

check('the first WARMUP_FRAMES after a mount or a reset are discarded, and the discard is reported', () => {
  const stats = new FrameStats()
  for (let i = 0; i < WARMUP_FRAMES; i += 1) stats.push(100, 90)
  let s = stats.snapshot()
  assert.equal(s.frames, 0, 'a warm-up frame counted')
  assert.equal(s.skipped, WARMUP_FRAMES)
  assert.equal(s.wall.n, 0)

  stats.push(16, 2)
  s = stats.snapshot()
  assert.equal(s.frames, 1)
  assert.equal(s.wall.max, 16, 'the 100ms warm-up frames reached the percentiles')

  stats.reset()
  stats.push(100, 90)
  s = stats.snapshot()
  assert.equal(s.frames, 0, 'a reset did not restart the warm-up')
  assert.equal(s.skipped, 1)
})

check('a stall is not a frame: a backgrounded tab cannot put a five-second delta at the top of the tail', () => {
  const stats = warmed()
  stats.push(16, 2)
  stats.push(STALL_MS + 1, 3)
  stats.push(NaN, 2)
  stats.push(16, Infinity)
  const s = stats.snapshot()
  assert.equal(s.frames, 1)
  assert.equal(s.skipped, WARMUP_FRAMES + 3)
  assert.equal(s.wall.max, 16)
  assert.equal(s.long, 0, 'a stall was counted as a long frame')
})

check('long and dropped frames are counted by the wall clock against the two vsync thresholds', () => {
  assert.ok(LONG_FRAME_MS > 1000 / 60, 'the long threshold sits below one 60Hz frame, so jitter counts as long')
  assert.ok(LONG_FRAME_MS < 2000 / 60, 'the long threshold sits past two frames, so a single missed vsync is not long')
  assert.ok(DROPPED_FRAME_MS > LONG_FRAME_MS)
  assert.ok(STALL_MS > DROPPED_FRAME_MS)

  const stats = warmed()
  stats.push(16.7, 1)
  stats.push(LONG_FRAME_MS + 0.1, 1)
  stats.push(DROPPED_FRAME_MS + 0.1, 1)
  stats.push(LONG_FRAME_MS, 1) // at the threshold, not past it
  const s = stats.snapshot()
  assert.equal(s.frames, 4)
  assert.equal(s.long, 2)
  assert.equal(s.dropped, 1)
})

check('the window keeps the last FRAME_WINDOW frames and nothing older', () => {
  const window = 8
  const stats = warmed(window)
  for (let i = 0; i < window; i += 1) stats.push(100, 1)
  for (let i = 0; i < window; i += 1) stats.push(10, 1)
  const s = stats.snapshot()
  assert.equal(s.wall.n, window)
  assert.equal(s.wall.max, 10, 'a frame older than the window is still in the percentiles')
  assert.equal(s.frames, 2 * window, 'the session count is the window, not the session')

  // Part-filled: the percentiles are over what has arrived, not over a buffer of zeros.
  const partial = warmed(window)
  partial.push(20, 1)
  partial.push(30, 1)
  const p = partial.snapshot()
  assert.equal(p.wall.n, 2)
  assert.equal(p.wall.p50, 20)
  assert.equal(p.wall.max, 30)
})

check('a heap drop of more than GC_DROP_BYTES in one frame is a collection, and a page with no heap reads n/a', () => {
  const stats = warmed()
  const MB = 1_000_000
  const heap = [40 * MB, 41 * MB, 42 * MB, 30 * MB, 31 * MB, 30.5 * MB, 20 * MB]
  for (const bytes of heap) stats.push(16, 1, bytes)
  const s = stats.snapshot()
  assert.equal(s.gcs, 2, 'two drops of 12MB and 10.5MB are two collections')
  assert.equal(s.gcLargestDropBytes, 12 * MB)
  assert.equal(s.heapPeakBytes, 42 * MB)
  assert.equal(s.heapBytes, 20 * MB)
  assert.ok(GC_DROP_BYTES >= 0.5 * MB, 'a drop under half a megabyte is quantisation, not a collection')

  // A drop smaller than the floor is not a collection: the counter is "how often the collector
  // ran", not "how often the reading wobbled".
  const quiet = warmed()
  quiet.push(16, 1, 40 * MB)
  quiet.push(16, 1, 40 * MB - GC_DROP_BYTES / 2)
  assert.equal(quiet.snapshot().gcs, 0)

  // No heap ever passed: every heap field is null rather than a zero somebody would read as "no
  // collections", which is a different claim from "could not look".
  const blind = warmed()
  blind.push(16, 1)
  const b = blind.snapshot()
  assert.equal(b.gcs, null)
  assert.equal(b.heapBytes, null)
  assert.equal(b.heapPeakBytes, null)
  assert.equal(b.gcLargestDropBytes, null)

  // A reset keeps the last reading, so the first frame after it cannot count a phantom drop
  // against a zero -- and the peak restarts from where the heap is, not from where it was.
  stats.reset()
  stats.push(16, 1, 20 * MB)
  const r = stats.snapshot()
  assert.equal(r.gcs, 0)
  assert.equal(r.heapPeakBytes, 20 * MB)
})

check('?perf=1 mounts and nothing else does; ?msaa=0 disables and the toggle flips it while keeping perf=1', () => {
  assert.equal(perfRequested('?perf=1'), true)
  assert.equal(perfRequested('?perf=true'), true)
  assert.equal(perfRequested('?perf=0'), false)
  assert.equal(perfRequested('?perf'), false)
  assert.equal(perfRequested(''), false)
  assert.equal(perfRequested('?msaa=0'), false)
  assert.equal(PERF_FLAG, 'perf')
  assert.equal(MSAA_FLAG, 'msaa')

  assert.equal(msaaDisabled('?perf=1&msaa=0'), true)
  assert.equal(msaaDisabled('?perf=1'), false)
  assert.equal(msaaDisabled('?msaa=1'), false)

  const off = toggledMsaaSearch('?perf=1')
  assert.equal(msaaDisabled(off), true)
  assert.equal(perfRequested(off), true, 'flipping MSAA dropped the flag that mounts the overlay')
  const on = toggledMsaaSearch(off)
  assert.equal(msaaDisabled(on), false)
  assert.equal(perfRequested(on), true)
  assert.equal(toggledMsaaSearch('?msaa=0'), '', 'the only flag removed leaves an empty search, not a bare ?')
})

check('the overlay is referenced from main.ts only inside the DEV-or-perf branch, and the build guard forbids its id', () => {
  // The module is what tree-shaking removes, and it only removes it if the sole reference is inside
  // a branch Vite can fold. `check-bundle.mjs` proves it on the built output; this is the shape.
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  const gate = "import.meta.env.DEV || import.meta.env.MODE === 'perf'"
  assert.ok(main.includes(gate), 'main.ts no longer gates the overlay on DEV-or-perf')
  const gateAt = main.indexOf(gate)
  for (const call of ['applyPerfRenderFlags(', 'mountPerfOverlay(', 'perfRequested(']) {
    const at = main.indexOf(call, main.indexOf('const game = new Phaser.Game') - 2000)
    assert.ok(at > gateAt, `${call} is called before the gate that makes it dead code in production`)
  }
  assert.ok(main.includes('if (perfOverlay) mountPerfOverlay(game)'), 'the mount is not conditional on the folded flag')

  const guard = readFileSync(new URL('./check-bundle.mjs', import.meta.url), 'utf8')
  assert.ok(guard.includes("'snail-perf-overlay'"), 'check-bundle.mjs does not forbid the overlay id')
  const overlay = readFileSync(new URL('../src/perf/perfOverlay.ts', import.meta.url), 'utf8')
  assert.ok(overlay.includes("OVERLAY_ID = 'snail-perf-overlay'"), 'the forbidden literal is no longer the element id')
  assert.ok(overlay.includes("import type * as Phaser from 'phaser'"), 'the overlay must not import phaser as a value')

  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.match(pkg.scripts['build:perf'], /--mode perf --outDir dist-perf/)
  assert.match(pkg.scripts['preview:perf'], /--outDir dist-perf/)
  assert.ok(!pkg.scripts['build:perf'].includes('check-bundle'), 'the perf build must not run the guard that forbids its own overlay')
})

console.log(`${passed} checks passed`)
