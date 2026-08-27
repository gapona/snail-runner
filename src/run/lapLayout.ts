/**
 * The lap's contents, handed over one segment at a time **behind the camera**.
 *
 * **Rule: this file never imports `phaser`** — `npm run verify:layout` loads it under Node.
 *
 * ## ⚠ The defect this exists to fix
 *
 * The scene used to regenerate the whole lap the frame the run wrapped: `placeRunObstacles`,
 * `placeRamps` and `placeFormations` all rebuilt, and every segment bucket replaced at once. The
 * renderer and the collision both index by *segment*, so that is correct about the ground — one
 * layout per place — and completely wrong about the moment, because **the road is drawn 300
 * segments ahead and a lap is 1434**. A fifth of the visible road was rewritten under the player.
 *
 * Measured on the shipped placer, over the 300 segments visible at the seam: lap N holds 24
 * obstacles there, lap N+1 holds a different set, and **69 obstacle slots change**. Not one segment
 * holds a row in both laps, so the rows do not merely change shape — they move. Reported as
 * barriers appearing in view that the player then hits, and as walls whose blocks change on the fly.
 *
 * **⚠ It reads as happening "at the biome seam", and the obvious explanation for that is wrong.**
 * Segment 0 is *not* a biome boundary — the boundaries fall at 159, 318 … 1431, and both segment
 * 1433 and segment 0 are biome 0. What is true is that 1434 does not divide by 9, so the last
 * stretch is the three-segment remainder: the biome changes at 1431 and the lap wraps at 0, **104ms
 * apart at `MAX_ATTAINABLE_SPEED`** against 50 seconds between wraps. Two events a tenth of a second
 * apart are one event to everything except a clock.
 *
 * ## The rule
 *
 * **Nothing already on screen is ever rewritten.** A segment's contents may only be replaced while
 * that segment is behind the camera, which is to say after the player has passed it and before it
 * can be seen again a whole lap later.
 *
 * So the handover is a cursor that trails the camera by `HANDOVER_MARGIN` segments. Each frame it
 * advances to wherever the camera has got to, and every segment it passes is given the *next* lap's
 * contents. By the time the camera reaches the seam, the road in front of it already holds the new
 * lap — written a lap ago, out of sight — and nothing changes at the moment of the wrap at all.
 *
 * The generation itself is unchanged and still whole-lap: the row spacing, the passability proof and
 * `sideAwayFrom` all reason about a lap as a unit. What changed is only when each segment is allowed
 * to take delivery.
 */
import { SEGMENT_LENGTH } from '../road/constants'
import type { Obstacle } from './obstacles'
import type { Pickup } from './pickups'
import type { Ramp } from './ramp'

/**
 * How far behind the camera a segment must be before it may be rewritten, in segments.
 *
 * Two rather than one: the camera sits *inside* its own base segment, so that one is half in view,
 * and at `MAX_ATTAINABLE_SPEED` a single frame covers about half a segment. Two is the first value
 * that is behind the camera at every speed and on every frame length.
 */
export const HANDOVER_MARGIN = 2

/** Everything one lap puts on the ground. */
export interface LapContent {
  obstacles: Obstacle[]
  pickups: Pickup[]
  ramps: Ramp[]
}

export interface LapLayoutOptions {
  trackLength: number
  segmentCount: number
  /** Builds a lap's contents. Called once per lap, at the moment the cursor enters it. */
  build: (lapOffset: number) => LapContent
}

/** Groups anything with a `z` by the segment index it stands on. */
export function indexBySegment<T extends { z: number }>(items: readonly T[], segmentCount: number): Map<number, T[]> {
  const map = new Map<number, T[]>()

  for (const item of items) {
    const index = ((Math.floor(item.z / SEGMENT_LENGTH) % segmentCount) + segmentCount) % segmentCount
    const here = map.get(index)

    if (here) here.push(item)
    else map.set(index, [item])
  }

  return map
}

/**
 * The live layout, and the cursor that rolls the next lap into it.
 *
 * A class rather than a pure function because it *is* mutable state — a map per kind, rewritten a
 * segment at a time — and threading three maps and a cursor through a pure step would be the same
 * state with more ceremony. It imports no Phaser and holds no scene, which is the line that matters.
 */
export class LapLayout {
  /** The live buckets. These are what the renderer and the collision walk. */
  readonly obstacles = new Map<number, Obstacle[]>()
  readonly pickups = new Map<number, Pickup[]>()
  readonly ramps = new Map<number, Ramp[]>()

  /** How many segments have been handed over since the last reset — for the DEV report. */
  handedOver = 0

  private readonly options: LapLayoutOptions
  /** The lap the cursor is writing, as a whole number of laps from the start. */
  private writerLap = 0
  /** The next lap's contents, indexed, waiting to be dealt out segment by segment. */
  private pending: { obstacles: Map<number, Obstacle[]>; pickups: Map<number, Pickup[]>; ramps: Map<number, Ramp[]> }
  /** How far the cursor has written to, in world units, unwrapped. */
  private writtenTo = 0

  constructor(options: LapLayoutOptions) {
    this.options = options

    const first = options.build(0)

    this.fill(first)
    // Lap 1 is built up front rather than at the first boundary: the cursor starts writing within
    // the first couple of segments of the run, and a build is the most expensive thing this class
    // does. Doing it here puts it in the scene's `create`, beside every other one.
    this.pending = this.index(options.build(options.trackLength))
    this.writerLap = 1
  }

  /**
   * Advances the cursor to `distance`, handing over every segment it passes.
   *
   * Returns how many segments were rewritten this call — zero on most frames, one or two on the
   * frames the camera crosses a boundary.
   */
  advance(distance: number): number {
    const { trackLength, segmentCount } = this.options
    const target = distance - HANDOVER_MARGIN * SEGMENT_LENGTH
    let written = 0

    while (this.writtenTo < target) {
      const index = ((Math.floor(this.writtenTo / SEGMENT_LENGTH) % segmentCount) + segmentCount) % segmentCount

      this.take(this.obstacles, this.pending.obstacles, index)
      this.take(this.pickups, this.pending.pickups, index)
      this.take(this.ramps, this.pending.ramps, index)

      this.writtenTo += SEGMENT_LENGTH
      written++
      this.handedOver++

      // The cursor has finished a lap: everything on the ground is now the lap it just wrote, and
      // the one after it has to be ready before the cursor reaches its first segment.
      if (this.writtenTo >= this.writerLap * trackLength) {
        this.writerLap++
        this.pending = this.index(this.options.build((this.writerLap - 1) * trackLength))
      }
    }

    return written
  }

  /** Every ramp currently on the ground. Small enough to gather on demand. */
  liveRamps(): Ramp[] {
    return [...this.ramps.values()].flat()
  }

  /** Every pickup currently on the ground. */
  livePickups(): Pickup[] {
    return [...this.pickups.values()].flat()
  }

  /** Every obstacle currently on the ground. */
  liveObstacles(): Obstacle[] {
    return [...this.obstacles.values()].flat()
  }

  /**
   * Moves one pickup between buckets, keeping the index it is filed under in step.
   *
   * A pickup moved without this is drawn in one place and collected in another — the magnet and the
   * arc relay both move them.
   */
  movePickup(pickup: Pickup, z: number, offsetX: number, y: number): void {
    const count = this.options.segmentCount
    const from = ((Math.floor(pickup.z / SEGMENT_LENGTH) % count) + count) % count
    const to = ((Math.floor(z / SEGMENT_LENGTH) % count) + count) % count

    if (from !== to) {
      const bucket = this.pickups.get(from)

      if (bucket) {
        const at = bucket.indexOf(pickup)

        if (at >= 0) bucket.splice(at, 1)
      }

      const target = this.pickups.get(to)

      if (target) target.push(pickup)
      else this.pickups.set(to, [pickup])
    }

    pickup.z = z
    pickup.offsetX = offsetX
    pickup.y = y
  }

  private take<T>(live: Map<number, T[]>, from: Map<number, T[]>, index: number): void {
    const next = from.get(index)

    if (next) live.set(index, next)
    else live.delete(index)
  }

  private fill(content: LapContent): void {
    const indexed = this.index(content)

    this.obstacles.clear()
    this.pickups.clear()
    this.ramps.clear()
    for (const [index, list] of indexed.obstacles) this.obstacles.set(index, list)
    for (const [index, list] of indexed.pickups) this.pickups.set(index, list)
    for (const [index, list] of indexed.ramps) this.ramps.set(index, list)
  }

  private index(content: LapContent): {
    obstacles: Map<number, Obstacle[]>
    pickups: Map<number, Pickup[]>
    ramps: Map<number, Ramp[]>
  } {
    const count = this.options.segmentCount

    return {
      obstacles: indexBySegment(content.obstacles, count),
      pickups: indexBySegment(content.pickups, count),
      ramps: indexBySegment(content.ramps, count),
    }
  }
}

/**
 * Whether `index` is inside the band the camera can see from `cameraSegment`.
 *
 * The one predicate the handover rule is stated in, exported so the check asks the same question the
 * scene does rather than a re-derived one.
 */
export function inView(index: number, cameraSegment: number, segmentCount: number, drawDistance: number): boolean {
  const ahead = ((index - cameraSegment) % segmentCount + segmentCount) % segmentCount

  return ahead < drawDistance
}
