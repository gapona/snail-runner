/**
 * How long a target standing on the track stays fightable, and where a circuit is worst at it.
 *
 * **Rule: this file never imports `phaser`** — `npm run verify:road` loads it under Node.
 *
 * **This exists because a corner made a wave unwinnable and nothing could see it.** The run's
 * circuit had an S-curve whose arms bent hard enough, for long enough, that the road ahead swung off
 * the side of the frame: at its worst, **93 of the 200 segments** a wave is fought across were
 * outside the viewport, and a target was engageable for **3.6s instead of 6.4s**. Every existing
 * check passed — the geometry was valid, the road drew correctly, the enemies projected onto it
 * exactly. What no check asked was whether the player could *see* them for long enough to shoot.
 *
 * The measurement deliberately ignores hills. A crest hides a target briefly and then reveals it,
 * which is a rhythm; a bend carries it off the side and never brings it back within the same pass,
 * which is a dead stretch of track. Measured on the ends of the enemy spread (`offsetX` reaches
 * ±0.85 road half-widths), because that is what leaves the frame first.
 */
import { CAMERA_DEPTH, CAMERA_HEIGHT, DRAW_DISTANCE, ROAD_WIDTH, SEGMENT_LENGTH, SPRITE_SCALE } from './constants'
import { projectInto, type ScreenPoint } from './project'
import { surfaceHeight, type Segment } from './track'

/** The widest an enemy is laid out at, in road half-widths — see `waves.ts`. */
const ENEMY_OFFSET = 0.85

/** How tall a sprite must draw before a player can be expected to act on it, in pixels. */
const MIN_VISIBLE_PX = 8

/** The nominal source height of an enemy texture, matching what `Enemies.render` scales. */
const ENEMY_TEXTURE_PX = 24

export interface SightlineOptions {
  screenWidth: number
  screenHeight: number
  /** How far ahead a wave is released — `WAVE_SPAWN_AHEAD_Z` in segments. */
  spawnAhead: number
  /** World units per second the camera travels, for turning segments into seconds. */
  speed: number
}

/**
 * Seconds for which a target at `targetSegment` is on screen and big enough to shoot.
 *
 * Walks the camera from the spawn distance in to the target, which is the honest direction: the
 * question is what the player gets *before* the thing reaches them, not what a static frame shows.
 */
export function engagementSeconds(track: readonly Segment[], targetSegment: number, options: SightlineOptions): number {
  const trackLength = track.length * SEGMENT_LENGTH
  const start = Math.min(options.spawnAhead, DRAW_DISTANCE - 1)
  const point: ScreenPoint = { x: 0, y: 0, w: 0, scale: 0 }
  let visible = 0

  for (let ahead = start; ahead >= 1; ahead--) {
    const cameraZ = (targetSegment - ahead) * SEGMENT_LENGTH
    const wrapped = ((cameraZ % trackLength) + trackLength) % trackLength
    const base = track[Math.floor(wrapped / SEGMENT_LENGTH) % track.length]
    const basePercent = (wrapped % SEGMENT_LENGTH) / SEGMENT_LENGTH
    const cameraY = surfaceHeight(base, basePercent) + CAMERA_HEIGHT

    // The same integration `RoadMesh.render` does, and it has to be redone from the camera for each
    // sample: `x` is an accumulation from wherever the camera is, not a property of a segment.
    let x = 0
    let dx = -(base.curve * basePercent)
    let row: ScreenPoint | null = null

    for (let n = 0; n <= ahead; n++) {
      const segment = track[(base.index + n) % track.length]
      const looped = segment.index < base.index

      projectInto(
        point,
        segment.p1,
        -x,
        cameraY,
        looped ? wrapped - trackLength : wrapped,
        CAMERA_DEPTH,
        options.screenWidth,
        options.screenHeight,
        ROAD_WIDTH,
      )

      if (n === ahead) row = { x: point.x, y: point.y, w: point.w, scale: point.scale }

      x += dx
      dx += segment.curve
    }

    if (!row) continue

    const drawn = row.scale * ENEMY_TEXTURE_PX * SPRITE_SCALE * options.screenWidth

    if (drawn < MIN_VISIBLE_PX) continue

    // Both ends of the spread, so a stretch that keeps only the inside of the bend does not count.
    const left = row.x - ENEMY_OFFSET * row.w
    const right = row.x + ENEMY_OFFSET * row.w

    if (left >= 0 && right <= options.screenWidth) visible += 1
  }

  return (visible * SEGMENT_LENGTH) / options.speed
}

/** The worst and mean engagement window over a whole circuit, sampled every `step` segments. */
export function sweepEngagement(
  track: readonly Segment[],
  options: SightlineOptions,
  step = 4,
): { worst: number; worstAt: number; mean: number } {
  let worst = Infinity
  let worstAt = 0
  let total = 0
  let count = 0

  for (let target = 0; target < track.length; target += step) {
    const seconds = engagementSeconds(track, target, options)

    total += seconds
    count += 1
    if (seconds < worst) {
      worst = seconds
      worstAt = target
    }
  }

  return { worst, worstAt, mean: total / count }
}
