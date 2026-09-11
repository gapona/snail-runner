/**
 * The frame-time tail, kept as a value the overlay renders and a phone can hand back.
 *
 * **This exists because every perf round so far was measured on a desktop with a guess that a
 * phone is "four to six times slower", and nobody had ever checked the guess.** The browser harness
 * cannot: a tab driven by automation is hidden, rAF never fires, and a hand-stepped loop measures
 * GPU backpressure rather than work. The one place a phone's frame time is honest is on the phone,
 * in the shipped build, with the game running — so the instrument lives in the game and shows its
 * numbers on the screen, where a screenshot carries them off.
 *
 * Pure, and no `phaser` import: `verify:perf` holds the percentile arithmetic, the warm-up discard
 * and the GC detection here, because a wrong percentile is worse than none — it sends the next
 * round at the wrong number with the confidence of a measurement.
 *
 * Two clocks per frame, and the difference between them is the finding this is built to show:
 * - `wall` is the time between one frame's `PRE_STEP` and the next — the presentation cadence,
 *   which on a 60Hz phone is 16.7ms until a frame drops and then 33.
 * - `cpu` is `PRE_STEP` to `POST_RENDER` — what the game itself spent, update and render submission
 *   together, i.e. every number the previous rounds measured on a desktop.
 * `wall - cpu` is the browser, the GPU and idle. A wall tail with a flat cpu is a GPU-bound or
 * throttled device; a wall tail that tracks cpu is the game's own work, which is what those rounds
 * assumed and never showed.
 */

/** How many frames the rolling percentiles are taken over — about ten seconds at 60Hz. */
export const FRAME_WINDOW = 600

/**
 * A 60Hz frame longer than this has certainly missed a vsync.
 *
 * Not 16.7: rAF timestamps jitter by a millisecond or two around the true cadence, and a
 * threshold at the cadence itself would count half of a perfectly smooth run as long. 25 sits
 * between one vsync (16.7) and two (33.3), so a frame over it has definitely skipped one.
 */
export const LONG_FRAME_MS = 25

/** A frame this long has skipped at least two vsyncs — a visible hitch rather than a wobble. */
export const DROPPED_FRAME_MS = 33

/**
 * A delta past this is not a frame at all.
 *
 * A backgrounded tab hands back one multi-second delta on the frame it returns; counting it would
 * put a five-second "frame" at the top of every percentile for the next ten seconds of play. Same
 * clamp, same reason, as `MAX_SUN_STEP_MS` and `stepDebris`'s own.
 */
export const STALL_MS = 500

/**
 * Frames discarded after a mount or a reset, for `PERF_WARMUP_FRAMES`' reason: textures are still
 * uploading and every render path is cold, and a reading taken across a scene start once came back
 * at 4.7ms median against a true 1.3. A guard in the instrument cannot be forgotten.
 */
export const WARMUP_FRAMES = 60

/**
 * A heap reading that falls by more than this between two consecutive frames is a collection.
 *
 * `performance.memory.usedJSHeapSize` is too coarse to read an *allocation rate* off — the same
 * code measured 6.8 and 26 KB/frame in consecutive windows — but a collection is a drop of
 * megabytes in one frame, which no quantisation hides. What the count says is how often the
 * collector runs during play; what the frame that carries it says is how much it cost.
 */
export const GC_DROP_BYTES = 1_000_000

export interface Percentiles {
  p50: number
  p90: number
  p99: number
  max: number
  /** How many samples the percentiles were taken over — under `FRAME_WINDOW` until it fills. */
  n: number
}

export interface FrameStatsSnapshot {
  wall: Percentiles
  cpu: Percentiles
  /** Frames counted since the last reset, warm-up and stalls excluded. */
  frames: number
  /** Frames discarded: the warm-up after a reset plus any stall. */
  skipped: number
  long: number
  dropped: number
  /** Collections seen, by heap drop. `null` when the page cannot read its heap at all. */
  gcs: number | null
  /** The last heap reading in bytes, or `null` where unavailable. */
  heapBytes: number | null
  /** The largest heap reading since the last reset, or `null`. */
  heapPeakBytes: number | null
  /** The biggest single-frame heap drop seen, or `null`. */
  gcLargestDropBytes: number | null
  /** Where the long frames land against the overlay's own refresh cycle — see `PhaseHistogram`. */
  longPhase: { share: number; expected: number; total: number } | null
}

const EMPTY: Percentiles = { p50: 0, p90: 0, p99: 0, max: 0, n: 0 }

/**
 * Where in a repeating cycle the long frames land — the check that the instrument is not the
 * thing it is measuring.
 *
 * **The overlay updates a DOM text node every `REFRESH_EVERY_FRAMES` frames, and a DOM update is
 * a layout and a raster on the browser's own thread, between two of the game's frames.** The first
 * phone reading came back with 9.7% long frames against a refresh cadence that is 6.7% of frames,
 * which is close enough to be the same number. A long frame that pays for the overlay lands in the
 * one or two frames after a refresh; a long frame that is the game's own lands anywhere. So the
 * phase of every long frame is counted, and the share in the first `k` phases is printed beside
 * the `k / period` a uniform spread would give. A share far above it is the overlay's own cost and
 * has to be subtracted before any number here is believed.
 */
export class PhaseHistogram {
  readonly period: number
  readonly counts: Uint32Array
  private total = 0

  constructor(period: number) {
    this.period = period
    this.counts = new Uint32Array(period)
  }

  note(phase: number): void {
    if (!Number.isInteger(phase) || phase < 0 || phase >= this.period) return
    this.counts[phase] += 1
    this.total += 1
  }

  reset(): void {
    this.counts.fill(0)
    this.total = 0
  }

  /** The share of noted events in phases `0..k-1`, against the share a uniform spread gives. */
  report(k = 2): { share: number; expected: number; total: number } {
    const width = Math.min(k, this.period)
    let inHead = 0
    for (let i = 0; i < width; i += 1) inHead += this.counts[i]
    return {
      share: this.total === 0 ? 0 : inHead / this.total,
      expected: width / this.period,
      total: this.total,
    }
  }
}

/**
 * Nearest-rank percentile over an already sorted array: the smallest value such that at least
 * `p` of the samples are at or under it. On a small window this is the value a player actually
 * saw rather than an interpolation between two of them.
 */
export function percentile(sorted: ArrayLike<number>, p: number): number {
  const n = sorted.length
  if (n === 0) return 0
  const rank = Math.ceil(p * n)
  return sorted[Math.min(n - 1, Math.max(0, rank - 1))]
}

export function summarise(values: ArrayLike<number>): Percentiles {
  const n = values.length
  if (n === 0) return EMPTY
  const sorted = Float64Array.from(values).sort()
  return {
    p50: percentile(sorted, 0.5),
    p90: percentile(sorted, 0.9),
    p99: percentile(sorted, 0.99),
    max: sorted[n - 1],
    n,
  }
}

export class FrameStats {
  // Declared rather than a constructor parameter property: Node's strip-only TypeScript, which
  // `verify:perf` loads this through, refuses parameter properties.
  readonly window: number
  private readonly wall: Float64Array
  private readonly cpu: Float64Array
  private head = 0
  private filled = 0
  private warmupLeft = WARMUP_FRAMES

  private frames = 0
  private skipped = 0
  private long = 0
  private dropped = 0

  private heapSeen = false
  private lastHeap = -1
  private heapPeak = 0
  private gcs = 0
  private gcLargestDrop = 0
  private readonly longPhases: PhaseHistogram | null

  /**
   * `refreshPeriod` is the overlay's own text-update cadence in frames, or `0` for a caller with
   * no cycle to measure against; with it, every long frame's phase is counted.
   */
  constructor(window: number = FRAME_WINDOW, refreshPeriod = 0) {
    this.window = window
    this.wall = new Float64Array(window)
    this.cpu = new Float64Array(window)
    this.longPhases = refreshPeriod > 0 ? new PhaseHistogram(refreshPeriod) : null
  }

  /**
   * One frame. `wallMs` is the delta since the previous frame's start; `cpuMs` is this frame's
   * own step-to-render duration. `heapBytes` is optional and, where the page cannot read it,
   * simply never passed. `phase` is how many frames since the overlay last touched the DOM — `0`
   * for the frame whose wall interval contains that update.
   */
  push(wallMs: number, cpuMs: number, heapBytes?: number, phase?: number): void {
    // The heap is read on every frame the page can read it, warm-up included: a collection during
    // warm-up is still a collection, and the peak is a property of the whole session.
    if (heapBytes !== undefined) this.noteHeap(heapBytes)

    if (wallMs > STALL_MS || !Number.isFinite(wallMs) || !Number.isFinite(cpuMs)) {
      this.skipped += 1
      return
    }
    if (this.warmupLeft > 0) {
      this.warmupLeft -= 1
      this.skipped += 1
      return
    }

    this.wall[this.head] = wallMs
    this.cpu[this.head] = cpuMs
    this.head = (this.head + 1) % this.window
    if (this.filled < this.window) this.filled += 1

    this.frames += 1
    if (wallMs > LONG_FRAME_MS) {
      this.long += 1
      if (phase !== undefined) this.longPhases?.note(phase)
    }
    if (wallMs > DROPPED_FRAME_MS) this.dropped += 1
  }

  private noteHeap(bytes: number): void {
    this.heapSeen = true
    if (this.lastHeap >= 0) {
      const drop = this.lastHeap - bytes
      if (drop > GC_DROP_BYTES) {
        this.gcs += 1
        if (drop > this.gcLargestDrop) this.gcLargestDrop = drop
      }
    }
    this.lastHeap = bytes
    if (bytes > this.heapPeak) this.heapPeak = bytes
  }

  /** Back to an empty window and a fresh warm-up. The last heap reading is kept so the first frame after a reset cannot count a phantom collection. */
  reset(): void {
    this.head = 0
    this.filled = 0
    this.warmupLeft = WARMUP_FRAMES
    this.frames = 0
    this.skipped = 0
    this.long = 0
    this.dropped = 0
    this.heapPeak = this.lastHeap >= 0 ? this.lastHeap : 0
    this.gcs = 0
    this.gcLargestDrop = 0
    this.longPhases?.reset()
  }

  snapshot(): FrameStatsSnapshot {
    const wall = this.wall.subarray(0, this.filled)
    const cpu = this.cpu.subarray(0, this.filled)
    return {
      wall: summarise(wall),
      cpu: summarise(cpu),
      frames: this.frames,
      skipped: this.skipped,
      long: this.long,
      dropped: this.dropped,
      gcs: this.heapSeen ? this.gcs : null,
      heapBytes: this.heapSeen ? this.lastHeap : null,
      heapPeakBytes: this.heapSeen ? this.heapPeak : null,
      gcLargestDropBytes: this.heapSeen ? this.gcLargestDrop : null,
      longPhase: this.longPhases ? this.longPhases.report() : null,
    }
  }
}
