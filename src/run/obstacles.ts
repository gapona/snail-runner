/**
 * The things in the road: what one is, whether it was hit, and how a stretch of them is laid out
 * so that there is always a way through.
 *
 * **Rule: this file never imports `phaser`.** It is loaded directly under plain Node by
 * `scripts/verify-obstacles.mjs`. The Phaser half — the sprite pool that draws these — is
 * `ObstacleSprites.ts`, exactly the split `rail/enemy.ts` and `rail/Enemies.ts` had.
 *
 * **One rule, not three flags.** An obstacle is a box in world space: an interval across the road
 * (`offsetX ± halfWidths`) and an interval up from it (`[yLow, yHigh]`). The snail is the same
 * shape (`offsetX ± PLAYER_HALF_WIDTHS`, `[y, y + PLAYER_BODY_H]`). A hit is the two boxes
 * overlapping, and **nothing anywhere asks what kind of obstacle it is.** The three classes in
 * `OBSTACLE_BANDS` are three sets of numbers, and the behaviours players will name — jump it, go
 * round it, duck under it — are consequences of those numbers meeting `JUMP_APEX` and
 * `PLAYER_BODY_H`. `verify:jump` and `verify:obstacles` both assert the resulting table.
 *
 * That matters more than it looks. The obvious design is a `jumpable: boolean`, and it fails on
 * the third class: an overhead is not "unjumpable", it is *hit by jumping*, which a boolean cannot
 * say. Without that class the optimal play is to hold the jump button and the mechanic evaporates.
 *
 * **A layout is proved passable before it ships.** `placeObstacles` searches for a line through
 * every stretch it generates and discards the stretch if there is not one — the same
 * generate-and-check shape a puzzle game uses to guarantee a unique solution. A runner that
 * occasionally deals an impossible hand teaches the player that deaths are not their fault, which
 * is the one thing an endless game cannot afford.
 */
import { createRng } from '../race/rng'
import { SEGMENT_LENGTH } from '../road/constants'
import { difficultyAt, DIFFICULTY_TAU_Z } from './difficulty'
import {
  BOOST_FACTOR,
  JUMP_AIR_MS,
  JUMP_APEX,
  OBSTACLE_BANDS,
  PLAYER_BODY_H,
  PLAYER_HALF_WIDTHS,
  REACTION_MS,
  ROAD_EDGE,
  SPEED_CAP,
  type ObstacleKind,
} from './constants'

export interface Obstacle {
  id: number
  /** Position along the track, in world units. Unwrapped — the placer works in a linear range. */
  z: number
  /** Centre across the road, in half-widths. */
  offsetX: number
  /** Half its width, in half-widths. */
  halfWidths: number
  /** The height band it occupies, in world units. */
  yLow: number
  yHigh: number
  /**
   * Which of the three it is — **for art and for the placer's ratios only.**
   *
   * The collision never reads this. `verify:obstacles` proves that by hand-editing a branch's band
   * and checking it behaves as the band says rather than as the name does.
   */
  kind: ObstacleKind
}

/** Anything with a lane and a height — the snail, or a hypothetical one the placer is testing. */
export interface Body {
  offsetX: number
  y: number
}

/** Builds an obstacle, taking its band from its kind. */
export function createObstacle(spec: {
  id: number
  z: number
  offsetX: number
  halfWidths: number
  kind: ObstacleKind
}): Obstacle {
  const band = OBSTACLE_BANDS[spec.kind]

  return { ...spec, yLow: band.yLow, yHigh: band.yHigh }
}

/**
 * Whether `body` is inside `obstacle` — the whole collision model.
 *
 * Both intervals are half-open in the same direction, so *touching* is not a hit and overlapping
 * by any amount is. The lateral test carries both half-widths because a hit is edge meeting edge,
 * not centre entering box.
 */
export function hits(body: Body, obstacle: Pick<Obstacle, 'offsetX' | 'halfWidths' | 'yLow' | 'yHigh'>): boolean {
  const lateral = Math.abs(body.offsetX - obstacle.offsetX) < obstacle.halfWidths + PLAYER_HALF_WIDTHS

  if (!lateral) return false

  return body.y < obstacle.yHigh && obstacle.yLow < body.y + PLAYER_BODY_H
}

/**
 * The fastest the game can ever go, in world units per second.
 *
 * **`SPEED_CAP` is not that number, and treating it as one was a real hole.** A boost multiplies
 * the ceiling by `BOOST_FACTOR`, so the actual top speed is 5760 units/s, not 3600. The first
 * version of the floor below was solved at `SPEED_CAP`, which meant that during a boost — a state
 * the player *chooses*, by taking a pickup — the reaction budget silently fell to 281ms against a
 * 450ms floor. The game would have been telling the truth about its difficulty curve and lying
 * about the one moment the player felt fastest.
 */
export const MAX_ATTAINABLE_SPEED = SPEED_CAP * BOOST_FACTOR

export interface ObstacleRow {
  z: number
  obstacles: Obstacle[]
}

/** Groups obstacles into rows by `z`, in ascending order. */
export function obstacleRows(obstacles: readonly Obstacle[]): ObstacleRow[] {
  const byZ = new Map<number, Obstacle[]>()

  for (const obstacle of obstacles) {
    const row = byZ.get(obstacle.z)

    if (row) row.push(obstacle)
    else byZ.set(obstacle.z, [obstacle])
  }

  return [...byZ.entries()].sort((a, b) => a[0] - b[0]).map(([z, list]) => ({ z, obstacles: list }))
}

/**
 * How finely the road is sampled when searching for a line through a row.
 *
 * **A sample count rather than a lane count, because there are no lanes.** The snail can stand
 * anywhere on a continuous road, so the search is a scan; 81 samples across the drivable width
 * puts them 0.02 half-widths (40 world units) apart, which is a seventh of the snail's own width —
 * fine enough that no gap it could actually fit through is missed.
 */
const LINE_SAMPLES = 81

/** Every `offsetX` the search considers, evenly spaced across the road the snail may use. */
function sampleOffsets(): number[] {
  const offsets: number[] = []

  for (let i = 0; i < LINE_SAMPLES; i++) {
    offsets.push(-ROAD_EDGE + (2 * ROAD_EDGE * i) / (LINE_SAMPLES - 1))
  }

  return offsets
}

const OFFSETS = sampleOffsets()

export interface Line {
  offsetX: number
  /** `'ground'` if the snail can simply drive through, `'air'` if it has to be jumping. */
  mode: 'ground' | 'air'
}

/**
 * Finds a way through one row, or returns `null` if there is not one.
 *
 * **Ground is tried first and that ordering is deliberate**, not an optimisation: a row that can be
 * driven through should be reported as such even when it could also be jumped, because a jump is a
 * commitment that constrains the next several segments (see `provePassable`). Reporting the
 * cheapest true answer keeps the proof from inventing constraints the player does not have.
 */
export function passableLine(row: readonly Obstacle[]): Line | null {
  for (const mode of ['ground', 'air'] as const) {
    const y = mode === 'ground' ? 0 : JUMP_APEX

    for (const offsetX of OFFSETS) {
      if (!row.some((obstacle) => hits({ offsetX, y }, obstacle))) return { offsetX, mode }
    }
  }

  return null
}

/**
 * How far the snail travels while airborne at top speed, in world units.
 *
 * The window a jump commits to. At `SPEED_BASE` it is 4.5 segments and at `MAX_ATTAINABLE_SPEED`
 * eighteen, and the proof has to assume the worst — a layout that only works slowly is a layout
 * that breaks the first time the player takes a boost.
 */
export const FLIGHT_LENGTH_Z = (JUMP_AIR_MS / 1000) * MAX_ATTAINABLE_SPEED

/**
 * Whether a whole stretch can be got through.
 *
 * **The per-row check is not enough, and the gap between the two is the interesting part.** A row
 * that only a jump clears puts the snail in the air for up to `FLIGHT_LENGTH_Z`, and everything
 * inside that flight has to be clearable *from the air* — an overhead placed there is a hit the
 * player had no way to avoid, however carefully they played. So the walk carries the commitment
 * forward: a jump-only row demands that every row within one flight of it is air-passable too.
 *
 * It does **not** try to be exact about where the jump starts. The snail can jump early or late,
 * and modelling that would need the speed at that moment, which the placer does not know. Assuming
 * the worst case (the flight covers the full `FLIGHT_LENGTH_Z` after the row) is a strictly
 * stronger condition, so a layout that passes is passable at every speed — which is the property
 * worth having.
 */
export function provePassable(obstacles: readonly Obstacle[]): boolean {
  const rows = obstacleRows(obstacles)

  for (const [index, row] of rows.entries()) {
    const line = passableLine(row.obstacles)

    if (!line) return false
    if (line.mode === 'ground') continue

    // Jump-only: everything the flight overlaps has to be clearable from the air as well.
    for (let next = index + 1; next < rows.length && rows[next].z <= row.z + FLIGHT_LENGTH_Z; next++) {
      if (!passableInAir(rows[next].obstacles)) return false
    }
  }

  return true
}

/** Whether some line through this row clears it at the apex. */
function passableInAir(row: readonly Obstacle[]): boolean {
  return OFFSETS.some((offsetX) => !row.some((obstacle) => hits({ offsetX, y: JUMP_APEX }, obstacle)))
}

export interface PlacementOptions {
  /** Seeded generator. Nothing here uses `Math.random` — a run has to be reproducible. */
  rng: () => number
  /** The stretch to fill, in world units. */
  fromZ: number
  toZ: number
  /** How busy the road is, `0..1`. Scales how often a row appears, not how big it is. */
  density: number
  /** What share of obstacles are `blocking`, and what share `overhead`. The rest are `low`. */
  blockingShare: number
  overheadShare: number
}


/**
 * The least distance between two rows, in world units.
 *
 * **`REACTION_MS` at the fastest the game can go**, which is `MAX_ATTAINABLE_SPEED` and not
 * `SPEED_CAP` — see above. Two rows closer together than the time it takes to read one are not two
 * decisions, they are one decision the player was not shown. Everything the difficulty curve is
 * allowed to raise (density, the share of each class) leaves this alone — see `REACTION_MS`, and
 * `difficulty.ts` for the curve that is bounded by it.
 */
export const MIN_ROW_GAP_Z = (REACTION_MS / 1000) * MAX_ATTAINABLE_SPEED

/** How many obstacles one row may hold. More than three cannot leave a gap on this road. */
const MAX_PER_ROW = 3

/**
 * How wide one obstacle is, in half-widths.
 *
 * 0.12 to 0.22 is 480 to 880 world units — between 1.7 and 3.1 snails wide. Narrow enough that two
 * of them still leave a line on a 4000-unit road, wide enough that dodging one is a real move
 * rather than a nudge. Also cut by looking: at the original 0.16–0.3 a three-obstacle row filled
 * most of the carriageway and the road read as walled rather than as obstructed.
 */
const OBSTACLE_HALF_WIDTHS = { min: 0.12, max: 0.22 } as const

/**
 * Lays obstacles along a stretch, and proves the result can be got through.
 *
 * **Generate and check, with the check able to fail.** Each row is drawn, then tested; a row with
 * no line through it is redrawn, up to `ROW_ATTEMPTS` times, and if it still cannot be made
 * passable it is dropped entirely rather than shipped. The same is done for the flight constraint
 * `provePassable` enforces across rows. That is the puzzle-generator shape: it is much easier to
 * throw away a bad layout than to construct only good ones, and the discard is what makes the
 * guarantee real rather than aspirational.
 */
export function placeObstacles(options: PlacementOptions): Obstacle[] {
  const { rng, fromZ, toZ, density } = options
  const placed: Obstacle[] = []
  let id = 0
  let z = fromZ + MIN_ROW_GAP_Z

  while (z < toZ) {
    // Density scales the *spacing*, never the floor: at density 1 rows sit at the reaction gap,
    // at 0 they are five times further apart. A denser road is a busier one, not an unfair one.
    const spacing = MIN_ROW_GAP_Z * (1 + (1 - clamp01(density)) * 4)
    const row = drawRow(options, z, () => id++)

    if (row.length > 0 && provePassable([...placed, ...row])) placed.push(...row)

    // **The jitter only ever adds distance.** Scaling the whole spacing by `0.85 + rng() * 0.3`
    // reads as more natural and quietly breaks the one guarantee this file makes: it put two rows
    // 6.9 segments apart against an 8.1-segment floor, i.e. inside the reaction budget. A floor
    // that a random multiplier can dip below is not a floor.
    z += spacing * (1 + rng() * 0.35)
  }

  return placed
}

/** How many times a row is redrawn before it is given up on. */
const ROW_ATTEMPTS = 12

/** Draws one row at `z`, retrying until it has a line through it or the attempts run out. */
function drawRow(options: PlacementOptions, z: number, nextId: () => number): Obstacle[] {
  const { rng, blockingShare, overheadShare } = options

  for (let attempt = 0; attempt < ROW_ATTEMPTS; attempt++) {
    const count = 1 + Math.floor(rng() * MAX_PER_ROW)
    const row: Obstacle[] = []

    for (let i = 0; i < count; i++) {
      const roll = rng()
      const kind: ObstacleKind = roll < blockingShare ? 'blocking' : roll < blockingShare + overheadShare ? 'overhead' : 'low'
      const halfWidths =
        OBSTACLE_HALF_WIDTHS.min + rng() * (OBSTACLE_HALF_WIDTHS.max - OBSTACLE_HALF_WIDTHS.min)
      // Kept fully on the road: an obstacle hanging off the verge is invisible *and* free, which
      // reads as the game having forgotten to place it.
      const reach = Math.max(0, ROAD_EDGE - halfWidths)
      const offsetX = -reach + rng() * reach * 2

      row.push(createObstacle({ id: nextId(), z, offsetX, halfWidths, kind }))
    }

    if (passableLine(row)) return row
  }

  return []
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/**
 * One lap's worth of obstacles, with the difficulty rising along it.
 *
 * **The track loops and the difficulty does not, and that is the whole problem this solves.** The
 * obvious version — lay obstacles across the *distance* the run will travel — puts two of them on
 * the same piece of ground the moment the distance passes the lap length, because the renderer and
 * the collision both index by segment. So a lap is generated at a time, in bands, and the scene
 * regenerates when the run wraps (`lapOffset` is how far the run had already come at the start of
 * this lap).
 *
 * That the whole curve fits inside one lap is what makes this work rather than merely function:
 * `DIFFICULTY_TAU_Z` is 90 000 units against a 286 800-unit lap, so a run is at 96% of the
 * ceiling by the time it first wraps and every later lap is generated at the saturated end. The
 * seam is not a difficulty step because there is nothing left to step to.
 */
export function placeRunObstacles(seed: number, trackLength: number, lapOffset = 0): Obstacle[] {
  const rng = createRng(seed + Math.round(lapOffset / SEGMENT_LENGTH))
  const placed: Obstacle[] = []
  const bandCount = Math.max(1, Math.ceil(trackLength / DIFFICULTY_TAU_Z))
  const bandLength = trackLength / bandCount

  for (let band = 0; band < bandCount; band++) {
    // The first stretch of the very first lap is left clear: a player dropped straight into a row
    // has been given a reaction test, not a game.
    const fromZ = band === 0 && lapOffset === 0 ? SEGMENT_LENGTH * 30 : band * bandLength
    const toZ = (band + 1) * bandLength
    // Sampled at the *middle* of the band, so a band is neither uniformly at its start's
    // difficulty nor at its end's — sampling at an edge would make every boundary a visible step.
    const difficulty = difficultyAt(lapOffset + (fromZ + toZ) / 2)

    placed.push(...placeObstacles({ rng, fromZ, toZ, ...difficulty }))
  }

  return placed
}
