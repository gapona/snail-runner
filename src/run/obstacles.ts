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
 * the class that was removed: an overhead was not "unjumpable", it was *hit by jumping*, which a
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
  MAX_ATTAINABLE_SPEED,
  JUMP_AIR_MS,
  JUMP_APEX,
  OBSTACLE_BANDS,
  OFFROAD_LIMIT,
  PLAYER_BODY_H,
  PLAYER_HALF_WIDTHS,
  PLAYER_WIDTH,
  REACTION_MS,
  REACHABLE_EDGE,
  ROAD_EDGE,
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
  /**
   * How far the body is rotated, in degrees. Absent or `0` for anything upright.
   *
   * **⚠ The drawn box stopped being the collision box the moment the ramp's spin was added, and
   * nothing said so.** `PlayerView` turns the sprite about its **bottom-centre** origin, so a
   * tumbling snail hangs below its own feet — at half a turn it is entirely below them — while
   * `hits` went on testing the upright band `[y, y + PLAYER_BODY_H]`. Measured over a real ramp
   * flight against a `blocking` barrier: the model is hittable for **31%** of the flight and the
   * *drawn* snail overlaps the barrier for **48%** of it, at worst **198 world units inside** one
   * the model says it cleared. Reported as tumbling off a ramp into a tall barrier and taking no
   * damage, which is exactly what those numbers are.
   */
  spinDegrees?: number
}

/**
 * The vertical band the body actually occupies, which is the band it is drawn in.
 *
 * At zero rotation this is exactly `[y, y + PLAYER_BODY_H]`, so an ordinary jump, `passableLine`
 * and the whole passability proof are untouched — they pass no rotation and get the old answer.
 *
 * **The lateral half-width deliberately does NOT rotate with it.** A snail turned on its side is
 * drawn narrower than one upright, and taking that literally would let a tumble slip through gaps a
 * grounded snail cannot — a hitbox that shrinks while the player is mid-air is far harder to read
 * than one that stays the size of the creature. The vertical extent is the half the spin genuinely
 * breaks, because the whole question a barrier asks is how high you are.
 *
 * ## ⚠ The tumble turns about the body's CENTRE, and turning it about the feet cost the ramp
 *
 * Reported: a tall barrier should be clearable off a ramp. It was not, and the reason is here
 * rather than in `ramp.ts`. `PlayerView` used to spin the sprite about its bottom-centre origin —
 * the point the projection puts on the ground — so the body swung through an arc **310 units below
 * its own feet**, and at half a turn it hung entirely below them. The collision agreed with the
 * drawing, which was the whole point of adding the rotation, and both were wrong about what a
 * tumbling object does: a thrown thing turns about its centre of mass, not about the end of it.
 *
 * Measured over a real ramp flight against `blocking` (802 units tall): the feet are above it for
 * **57.7%** of the flight and the foot-pivoted box cleared it for **12.7%** — so the snail was
 * drawn a body's height over the barrier and hit it anyway. About the centre the worst drop below
 * the feet is 139 units instead of 310, and **49.3%** of the flight clears. `PlayerView` pivots
 * the sprite the same way, so drawn and hit still cannot disagree.
 */
export function bodyBand(body: Body): { low: number; high: number } {
  const spin = body.spinDegrees ?? 0

  if (spin === 0) return { low: body.y, high: body.y + PLAYER_BODY_H }

  const radians = (spin * Math.PI) / 180
  // The half-extent of a rectangle turned about its own centre, which is one expression rather than
  // four corners: a `w x h` box at angle t is `|w sin t| + |h cos t|` tall. This runs per obstacle
  // per frame and the frame it matters on is the busiest one.
  const half = (Math.abs(PLAYER_WIDTH * Math.sin(radians)) + Math.abs(PLAYER_BODY_H * Math.cos(radians))) / 2
  const centre = body.y + PLAYER_BODY_H / 2

  return { low: centre - half, high: centre + half }
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

  const band = bodyBand(body)

  return band.low < obstacle.yHigh && obstacle.yLow < band.high
}


/** Re-exported so the placer's own floor and the suites read it from one place. */
export { MAX_ATTAINABLE_SPEED }

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

  // **⚠ `REACHABLE_EDGE`, not `ROAD_EDGE`, and the difference is what makes a proof a proof.** These
  // are the offsets `provePassable` certifies a row at, so they have to be offsets the player can
  // actually *steer* to — a line through the last sliver of asphalt is not a line if a finger at the
  // edge of the frame cannot ask for it. It was `ROAD_EDGE` and was correct by accident: the reach
  // used to be 1.1x the asphalt, so sampling the asphalt was conservative. See
  // `STEER_REACH_MARGIN`, which crossed 1 to buy the mascot its size.
  for (let i = 0; i < LINE_SAMPLES; i++) {
    offsets.push(-REACHABLE_EDGE + (2 * REACHABLE_EDGE * i) / (LINE_SAMPLES - 1))
  }

  return offsets
}

/**
 * The offsets `passableLine` certifies a row at, exported so a check can read the array the proof
 * actually uses rather than rebuild it — the difference between measuring the rule and measuring a
 * copy of it. See `sampleOffsets` for why it spans the *reachable* edge.
 */
export const PASSABILITY_OFFSETS: readonly number[] = sampleOffsets()

const OFFSETS = PASSABILITY_OFFSETS

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
 * inside that flight has to be clearable *from the air*: something free on the ground and sealed
 * in the air is a hit the player had no way to avoid, however carefully they played. So the walk
 * carries the commitment forward — a jump-only row demands that every row within one flight of it
 * is air-passable too.
 *
 * **⚠ That loop cannot fire today, and it is kept anyway.** It was written for the deleted
 * `overhead` class, whose band started above the road; with `low` and `blocking` both reaching
 * `y = 0` the offsets blocked at the apex are a *subset* of those blocked on the ground, so a row
 * with a ground line always has an air line. It stays because it becomes load-bearing again the
 * instant any band starts above the road, and `verify:obstacles` asserts that none does — so the
 * day one is added, the check fails and says the flight proof is live and untested rather than
 * letting it be rediscovered by a player.
 *
 * It does **not** try to be exact about where the jump starts. The snail can jump early or late,
 * and modelling that would need the speed at that moment, which the placer does not know. Assuming
 * the worst case (the flight covers the full `FLIGHT_LENGTH_Z` after the row) is a strictly
 * stronger condition, so a layout that passes is passable at every speed — which is the property
 * worth having.
 *
 * **⚠ Nothing in the game calls this any more, and it is not dead.** The placer accepts rows through
 * `acceptRow`, which is this function restricted to what appending can break; what still runs this
 * one is `verify:obstacles`, as the **control** that `acceptRow` is measured against row for row.
 * Delete it and the incremental form is left proving itself. That is the one shape an uncalled
 * export is allowed to have here — see the six times this project has found authored state doing
 * nothing, every one of which had no such caller.
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

/** A row already proved, reduced to the two facts appending another row can ask about. */
export interface ProvedRow {
  readonly z: number
  /** Whether the only line through it is in the air, i.e. whether it commits the snail to a flight. */
  readonly jumpOnly: boolean
}

/**
 * `provePassable([...placed, ...row])`, restricted to what appending can actually break.
 *
 * ## ⚠ The walk re-proved the whole lap for every row, and every redraw of every row
 *
 * `placeObstacles` called `provePassable([...placed, ...row])` once per attempt — so row 37 copied
 * and re-proved all thirty-six rows in front of it, each at 81 samples, and a rejected row paid the
 * same. Quadratic in a placer that runs on **one frame, once per lap**, and invisible on a desktop
 * where that frame has 16ms to lose. Measured: `placeRunObstacles` is ~1.0ms of a ~2.9ms build.
 *
 * What appending cannot do is take away a line that was already there. Rows are laid at strictly
 * increasing `z` and `obstacleRows` groups by exact `z`, so a new row is a new group at the end and
 * every earlier group is untouched — their own lines were proved when they were added. The only
 * obligation appending creates is the mirror of the flight loop read backwards: **an earlier
 * jump-only row whose flight now reaches this one**, which is a window of `FLIGHT_LENGTH_Z` and
 * therefore about two rows rather than the lap.
 *
 * Returns the row's own record so the caller does not solve its line twice; `null` means refuse it.
 * `verify:obstacles` asserts the two agree row for row over the real placer, with the whole-lap
 * `provePassable` as its control.
 */
export function acceptRow(placed: readonly ProvedRow[], row: readonly Obstacle[]): ProvedRow | null {
  const line = passableLine(row)

  if (!line) return null

  const z = row[0].z
  // Backwards from the end, because `placed` is ascending in `z` and the window is at the near end
  // of it: the first row out of reach is where every earlier row also is.
  let committed = false

  for (let i = placed.length - 1; i >= 0 && placed[i].z + FLIGHT_LENGTH_Z >= z; i--) {
    if (placed[i].jumpOnly) {
      committed = true
      break
    }
  }

  if (committed && !passableInAir(row)) return null

  return { z, jumpOnly: line.mode !== 'ground' }
}

export interface PlacementOptions {
  /** Seeded generator. Nothing here uses `Math.random` — a run has to be reproducible. */
  rng: () => number
  /** The stretch to fill, in world units. */
  fromZ: number
  toZ: number
  /** How busy the road is, `0..1`. Scales how often a row appears, not how big it is. */
  density: number
  /** What share of obstacles are `blocking`. The rest are `low`. */
  blockingShare: number
  /**
   * How often a row is a wall of `low` obstacles across the whole road — passable only by jumping.
   *
   * Defaults to `0`, which is what the fixture rows in `verify:obstacles` want. See
   * `difficulty.ts`'s own note for why the shipped curve never sets it there.
   */
  wallShare?: number
  /**
   * The first id this call may use, so ids stay unique across a lap's several bands.
   *
   * See `placeObstacles` for the 66% of a lap that could not hit the player while every band
   * restarted at zero.
   */
  firstId?: number
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
export const OBSTACLE_HALF_WIDTHS = { min: 0.12, max: 0.22 } as const

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
  // **⚠ Ids must be unique across the whole lap, and starting every band at zero meant they were
  // not.** `placeRunObstacles` calls this once per difficulty band, so band 1's first obstacle got
  // id 0 again — and `RunScene.resolvedOnLap` is keyed by id, marking an obstacle settled *for the
  // lap* as soon as the sweep passes it. Every later obstacle sharing that id was therefore
  // disarmed before the player reached it. Measured on the shipped placer: 164 obstacles, 56
  // distinct ids, and **108 of them — 66% of the lap — could not hit the player at all.**
  //
  // That is very likely most of what "some obstacles deal no damage" always was. An earlier round
  // attributed the report to the `overhead` class not touching a grounded snail, which is true and
  // was also worth fixing; this is the larger half and had nothing to do with the art.
  let id = options.firstId ?? 0
  let z = fromZ + MIN_ROW_GAP_Z
  // Maintained beside `placed` rather than re-derived: see `acceptRow` for why the whole lap was
  // being re-proved for every row, and what it cost the one frame a lap build lands on.
  const rows: ProvedRow[] = []

  while (z < toZ) {
    // Density scales the *spacing*, never the floor: at density 1 rows sit at the reaction gap,
    // at 0 they are five times further apart. A denser road is a busier one, not an unfair one.
    const spacing = MIN_ROW_GAP_Z * (1 + (1 - clamp01(density)) * 4)
    const row = drawRow(options, z, () => id++)

    const proved = row.length > 0 ? acceptRow(rows, row) : null

    if (proved) {
      placed.push(...row)
      rows.push(proved)
    }

    // **The jitter only ever adds distance.** Scaling the whole spacing by `0.85 + rng() * 0.3`
    // reads as more natural and quietly breaks the one guarantee this file makes: it put two rows
    // 6.9 segments apart against an 8.1-segment floor, i.e. inside the reaction budget. A floor
    // that a random multiplier can dip below is not a floor.
    z += spacing * (1 + rng() * 0.35)
  }

  return placed
}

/**
 * How many obstacles may be drawn at once.
 *
 * **⚠ This was 48, and the demand it was sized against was never measured.** Its own note reasoned
 * that "the 300-segment draw distance holds 37 rows" at three obstacles a row — which is 111, not
 * 48 — and then assumed the far ones would be culled. Measured over five saturated laps of the real
 * placer, the peak inside the draw distance is **90**, and a wall is fourteen obstacles in a single
 * row, so the assumption fails exactly where the road is busiest.
 *
 * What a short obstacle pool costs is worse than what a short pickup pool costs: the pool is filled
 * near to far, so what goes undrawn is the far end — which is the reaction budget. A hazard that is
 * not drawn until it is nearer than `REACTION_MS` is a hazard the player was never shown, and
 * `ObstacleSprites.refusedIds` exists to catch precisely that.
 *
 * 112 covers the row arithmetic above rather than only the measurement, since the measurement is a
 * sample of seeds and the arithmetic is a bound. Declared here rather than in `ObstacleSprites` so
 * `verify:obstacles` can hold it against the placer's own output.
 */
export const OBSTACLE_POOL_SIZE = 112

/** How many times a row is redrawn before it is given up on. */
const ROW_ATTEMPTS = 12

/**
 * A wall: `low` obstacles laid edge to edge across the whole road.
 *
 * **The one row that requires the jump.** Built by construction rather than drawn and tested,
 * because the thing that makes it a wall is that it has *no* ground line — leaving that to chance
 * would mean generating hundreds of rows to find one. It is still handed to `passableLine` by the
 * caller like any other row, and `provePassable` still enforces the flight window after it.
 *
 * Overlapping by a third of a width on purpose: a wall with a hair-width seam in it is a wall the
 * player will find once, by accident, and then never again.
 */
export function drawWall(z: number, nextId: () => number): Obstacle[] {
  const halfWidths = OBSTACLE_HALF_WIDTHS.max
  const step = halfWidths * 1.3
  const row: Obstacle[] = []

  for (let offsetX = -OFFROAD_LIMIT; offsetX <= OFFROAD_LIMIT; offsetX += step) {
    row.push(createObstacle({ id: nextId(), z, offsetX, halfWidths, kind: 'low' }))
  }

  return row
}

/** Draws one row at `z`, retrying until it has a line through it or the attempts run out. */
function drawRow(options: PlacementOptions, z: number, nextId: () => number): Obstacle[] {
  const { rng, blockingShare } = options

  if (rng() < (options.wallShare ?? 0)) return drawWall(z, nextId)

  for (let attempt = 0; attempt < ROW_ATTEMPTS; attempt++) {
    const count = 1 + Math.floor(rng() * MAX_PER_ROW)
    const row: Obstacle[] = []

    for (let i = 0; i < count; i++) {
      const roll = rng()
      const kind: ObstacleKind = roll < blockingShare ? 'blocking' : 'low'
      const halfWidths =
        OBSTACLE_HALF_WIDTHS.min + rng() * (OBSTACLE_HALF_WIDTHS.max - OBSTACLE_HALF_WIDTHS.min)
      // Kept fully on the road: an obstacle hanging off the verge is invisible *and* free, which
      // reads as the game having forgotten to place it.
      const reach = Math.max(0, ROAD_EDGE - halfWidths)
      let placed = false

      // ⚠ Redrawn until it clears everything already in the row. Nothing checked this before, and
      // `passableLine` cannot: it asks whether a line exists THROUGH the row, which is just as true
      // of two obstacles standing inside each other. Measured on the shipped placer, 34% of rows
      // carried an overlapping pair and the worst had one obstacle 120% inside another -- reported
      // as a tall texture and a low one stuck together.
      for (let tries = 0; tries < SLOT_ATTEMPTS && !placed; tries++) {
        const offsetX = -reach + rng() * reach * 2

        if (row.some((other) => !slotClears(offsetX, halfWidths, other))) continue

        row.push(createObstacle({ id: nextId(), z, offsetX, halfWidths, kind }))
        placed = true
      }
    }

    if (row.length > 0 && passableLine(row)) return row
  }

  return []
}

/**
 * How much daylight two obstacles in one row must leave between them, in road half-widths.
 *
 * **Derived, and the derivation is the rule: a row is either edge to edge or wide enough to drive
 * through.** A wall is built edge to edge on purpose (`drawWall`), and its own note says a wall with
 * a hair-width seam is one the player finds once by accident and never again. Anything *between*
 * those two is exactly that seam — a gap that looks like a way through and is not — so the smallest
 * legal gap is the one the mascot actually fits in, which is its own full width.
 *
 * It is `PLAYER_HALF_WIDTHS * 2` rather than a number, so it follows the mascot: the round that
 * grew the snail 261 -> 340 -> 310 would otherwise have quietly turned honest gaps into seams.
 */
const ROW_CLEARANCE = PLAYER_HALF_WIDTHS * 2

/** How many offsets one obstacle may be offered before the row simply carries one fewer. */
const SLOT_ATTEMPTS = 8

/** Whether a candidate leaves `ROW_CLEARANCE` beside something already placed. */
function slotClears(offsetX: number, halfWidths: number, other: Obstacle): boolean {
  return Math.abs(offsetX - other.offsetX) >= halfWidths + other.halfWidths + ROW_CLEARANCE
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

    placed.push(...placeObstacles({ rng, fromZ, toZ, ...difficulty, firstId: placed.length }))
  }

  return placed
}
