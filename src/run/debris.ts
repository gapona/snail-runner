/**
 * Debris: the chunks thrown out when something dies.
 *
 * **Rule: this file never imports `phaser`** — covered by `npm run verify:effects`.
 *
 * Screen-space particles, like everything else the player's fire touches. They are spawned at
 * the dying enemy's projected position and thereafter have nothing to do with the world: a
 * chunk is not a thing in the track, it is a mark on the screen that fades. Keeping them out
 * of world space means no projection, no ground clipping and no draw-order question.
 */
import { DEBRIS_GRAVITY, DEBRIS_LIFE_MS, DEBRIS_SPEED_FRACTION } from './constants'

export interface DebrisChunk {
  x: number
  y: number
  /** Screen velocity, in pixels per second. */
  vx: number
  vy: number
  /** Half-size in pixels, and how fast it tumbles, in radians per second. */
  size: number
  spin: number
  angle: number
  bornAt: number
  dieAt: number
}

/**
 * Throws `count` chunks out from `(x, y)`, appending to `out` up to `capacity`.
 *
 * Directions are drawn from `rng` rather than spaced evenly: an even fan reads as a mechanism,
 * a scatter reads as something breaking. Deterministic in the generator handed in, so a replay
 * of the same run produces the same debris — same rule as scenery and waves.
 *
 * Silently stops at `capacity`. A pool that grows on a busy frame is exactly the allocation
 * spike the scenery pool's own ceiling exists to avoid, and this is the busiest frame there is.
 */
export function spawnDebris(
  out: DebrisChunk[],
  x: number,
  y: number,
  count: number,
  now: number,
  viewportWidth: number,
  rng: () => number,
  capacity: number,
): number {
  const speed = viewportWidth * DEBRIS_SPEED_FRACTION
  let spawned = 0

  for (let i = 0; i < count; i++) {
    if (out.length >= capacity) break

    const angle = rng() * Math.PI * 2
    // Biased upwards: chunks thrown down are hidden behind the ground almost immediately.
    const speedScale = 0.45 + rng() * 0.55

    out.push({
      x,
      y,
      vx: Math.cos(angle) * speed * speedScale,
      vy: Math.sin(angle) * speed * speedScale - speed * 0.35,
      size: viewportWidth * (0.002 + rng() * 0.004),
      spin: (rng() - 0.5) * 14,
      angle: rng() * Math.PI * 2,
      bornAt: now,
      dieAt: now + DEBRIS_LIFE_MS * (0.7 + rng() * 0.6),
    })
    spawned++
  }

  return spawned
}

/**
 * Advances every chunk and drops the expired ones, in place.
 *
 * Mutates rather than returning a new array: this runs on the frame where eight enemies just
 * died, which is the worst possible moment to be allocating. Returns how many are still alive.
 */
export function stepDebris(chunks: DebrisChunk[], dtMs: number, now: number, viewportHeight: number): number {
  const dt = Math.max(0, Math.min(100, dtMs)) / 1000
  const gravity = viewportHeight * DEBRIS_GRAVITY
  let alive = 0

  for (const chunk of chunks) {
    if (now >= chunk.dieAt) continue

    chunk.vy += gravity * dt
    chunk.x += chunk.vx * dt
    chunk.y += chunk.vy * dt
    chunk.angle += chunk.spin * dt

    // Compacted in place: the survivors move down to fill the gaps the dead left.
    chunks[alive++] = chunk
  }

  chunks.length = alive

  return alive
}

/** How opaque a chunk is right now, `0..1`. Fades over its own lifetime, not a shared one. */
export function debrisAlpha(chunk: DebrisChunk, now: number): number {
  const span = chunk.dieAt - chunk.bornAt

  if (!(span > 0)) return 0

  return Math.max(0, Math.min(1, 1 - (now - chunk.bornAt) / span))
}
