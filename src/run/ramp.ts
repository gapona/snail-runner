/**
 * The ramp: a wedge on the road that throws the snail much higher than it can jump, spinning.
 *
 * **Rule: this file never imports `phaser`** — `npm run verify:ramp` loads it under Node. The
 * drawing is `RampSprites.ts`.
 *
 * ## ⚠ The spin is a function of flight *progress*, never of angular velocity
 *
 * `spinAngle` is `turns * 360 * t` with `t` the fraction of the flight already flown. That is the
 * only form under which the snail lands upright **at every launch strength and every approach
 * speed**, because `t` reaches exactly 1 at touchdown by definition.
 *
 * A fixed angular velocity is the obvious implementation and it lands sideways: the angle at
 * touchdown is `omega * duration`, and the duration is whatever the launch happened to be. It can
 * be made to land upright for one launch by tuning `omega`, and then every other launch is wrong —
 * which is how a constant ends up being nudged forever. `verify:ramp` runs both and rejects the
 * second.
 *
 * `t` is derived from the velocity rather than from a stored clock: `(v0 - vy) / (2 * v0)` is exact
 * at every tick, because the tick's velocity update is exact. A clock would be a second thing to
 * keep in step with the integrator, and the first frame the two disagreed the snail would land at
 * an angle nobody could explain.
 *
 * ## The height is solved, not picked
 *
 * `RAMP_APEX` is chosen and `RAMP_LAUNCH_V` follows from the game's one gravity — the same
 * discipline `JUMP_APEX` and `JUMP_LAUNCH_V` are under, and deliberately the *same* gravity: a
 * second `g` would mean `flightHeight` no longer describes every flight in the game, and
 * `formations.ts`'s arc is built on there being exactly one.
 *
 * ## There is no invulnerability flag, and that is not an omission
 *
 * A hit is two interval overlaps (see `obstacles.ts`), so a snail whose feet are above the tallest
 * band cannot be hit by anything — the existing rule already says so, and adding a flag would be a
 * second answer to a question that has one. What it does *not* mean is that a ramp is safe: the
 * ascent and the descent pass through the bands like any jump, and `verify:ramp` measures how much
 * of the flight is genuinely clear rather than asserting the whole of it is.
 */
import { SEGMENT_LENGTH } from '../road/constants'
import { createRng } from '../race/rng'
import { JUMP_APEX, JUMP_GRAVITY, JUMP_LAUNCH_V, OBSTACLE_BANDS, PLAYER_HALF_WIDTHS, ROAD_EDGE } from './constants'
import type { PlayerState } from './playerMotion'

/**
 * How high a ramp throws the snail, in world units.
 *
 * **2.8x `JUMP_APEX`, and the multiple is what makes it a different verb.** The tallest obstacle
 * band tops out at 620; a jump's 430 is under that, which is the whole reason `blocking` exists as
 * a class. 1200 is comfortably over everything, so the middle of a ramp flight is the one time in
 * the game the road below simply does not apply.
 */
export const RAMP_APEX = 1200

/**
 * Launch velocity and air time, **solved from `RAMP_APEX` and the game's one gravity.**
 *
 * `v = sqrt(2 g h)` and `T = 2 v / g`. Neither is tuned: picking the velocity by feel and letting
 * the apex fall out is the same mistake as tuning `JUMP_GRAVITY`, and it would put the apex
 * somewhere with no relationship to `OBSTACLE_BANDS`.
 */
export const RAMP_LAUNCH_V = Math.sqrt(2 * JUMP_GRAVITY * RAMP_APEX)
export const RAMP_AIR_MS = (2 * RAMP_LAUNCH_V * 1000) / JUMP_GRAVITY

/** How many full turns a ramp flight makes. One: two is a somersault nobody can read at speed. */
export const RAMP_SPINS = 1

/** How much of the lateral spring answers in a ramp flight — see `PlayerState.airControl`. */
export const RAMP_AIR_CONTROL = 0.4

/**
 * Half the ramp's width, in half-widths.
 *
 * The road is two half-widths across, so a third of it is 0.33 either side of centre. Wide enough
 * to be a thing you steer *onto* on purpose and narrow enough that the two lanes beside it are a
 * real choice — a ramp spanning the road would be a scripted event rather than a decision.
 */
export const RAMP_HALF_WIDTHS = 0.33

/** How deep the ramp is along the road, in world units. One segment, like an obstacle. */
export const RAMP_DEPTH = SEGMENT_LENGTH

/**
 * How tall the wedge is drawn, in world units.
 *
 * **⚠ 300, over `low.yHigh`, and the first version's 170 was the wrong rule applied confidently.**
 * That number came from "draw it shorter than the shortest thing that can hit you, so it cannot be
 * mistaken for a hazard" — which is sound reasoning about a *height* and wrong about what the
 * player actually reads. Measured in the running game at 25 segments out, a 170-unit ramp is
 * **164 x 21 screen pixels** of muted timber on a pale flagstone road: not mistakable for an
 * obstacle because it is not mistakable for anything.
 *
 * What separates a ramp from an obstacle is its **shape** — a sloped top edge, which nothing else
 * on this road has — and its markings. Neither needs it to be short, and both need it to be big
 * enough to see from far enough away to line up on.
 */
export const RAMP_HEIGHT = 300

/** How far apart ramps are laid, in world units, before the per-ramp jitter. */
export const RAMP_SPACING_Z = SEGMENT_LENGTH * 210

/** How far a ramp sits from the centreline at most, in half-widths. */
export const RAMP_MAX_OFFSET = ROAD_EDGE - RAMP_HALF_WIDTHS

export interface Ramp {
  id: number
  /** Position along the track, in world units. */
  z: number
  /** Centre across the road, in half-widths. */
  offsetX: number
  /** Half its width, in half-widths. */
  halfWidths: number
}

/**
 * Whether the snail rides onto this ramp.
 *
 * **Grounded only.** Crossing a ramp in mid-air is flying over it, which is the honest reading and
 * also the one that keeps `launch` from being a double jump. Lateral overlap is edge-to-edge, the
 * same test `hits` uses, so a ramp caught with one edge of the foot still launches.
 */
export function ridesOver(body: Pick<PlayerState, 'offsetX' | 'grounded'>, ramp: Ramp): boolean {
  if (!body.grounded) return false

  return Math.abs(body.offsetX - ramp.offsetX) < ramp.halfWidths + PLAYER_HALF_WIDTHS
}

/**
 * How far through its flight the snail is, `0..1`. `0` on the ground.
 *
 * Exact at every tick — see the header for why this is derived from the velocity rather than from
 * a clock.
 */
export function flightProgress(state: Pick<PlayerState, 'vy' | 'grounded' | 'flightV0'>): number {
  if (state.grounded || state.flightV0 <= 0) return 0

  return Math.max(0, Math.min(1, (state.flightV0 - state.vy) / (2 * state.flightV0)))
}

/**
 * How far round the snail has turned, in degrees. `0` on the ground and `0` for an ordinary jump.
 *
 * Reaches exactly `360 * flightSpins` at touchdown, i.e. exactly upright, whatever the launch was.
 */
export function spinAngle(state: Pick<PlayerState, 'vy' | 'grounded' | 'flightV0' | 'flightSpins'>): number {
  if (state.flightSpins === 0) return 0

  return flightProgress(state) * 360 * state.flightSpins
}

/**
 * The angle a **fixed angular velocity** would land at, in degrees — the negative control.
 *
 * Kept in the shipped module rather than in the check, because what it demonstrates is a property
 * of the design and not of the test: tuned so one launch lands upright, every other launch does
 * not. `verify:ramp` runs it over the same 50 launches the real one is run over.
 */
export function fixedRateLandingAngle(launchV: number, degreesPerSecond: number): number {
  return ((2 * launchV) / JUMP_GRAVITY) * degreesPerSecond
}

/** The highest any obstacle band reaches, in world units — what a flight has to clear to be free. */
export const HIGHEST_BAND = Math.max(...Object.values(OBSTACLE_BANDS).map((band) => band.yHigh))

/**
 * Lays ramps along one lap.
 *
 * **Seeded, like every other placer here**, so the same lap is the same lap: a ramp that moved
 * between two runs would make two frame-cost readings incomparable and a bug report
 * unreproducible.
 *
 * The first stretch of the first lap is left clear for the same reason the obstacles' is — a player
 * dropped straight onto a ramp has been launched, not taught.
 */
export function placeRamps(
  seed: number,
  trackLength: number,
  lapOffset = 0,
  obstacles: readonly { z: number; offsetX: number; halfWidths: number }[] = [],
): Ramp[] {
  const rng = createRng(seed + Math.round(lapOffset / SEGMENT_LENGTH))
  const ramps: Ramp[] = []
  let id = 0

  const from = lapOffset === 0 ? SEGMENT_LENGTH * 60 : 0

  for (let z = from; z < trackLength; z += RAMP_SPACING_Z * (0.7 + rng() * 0.6)) {
    // **Redrawn if it lands on an obstacle, and dropped if it cannot be placed.** A ramp inside a
    // boulder charges the player a life for taking the launch, which is not a decision — the same
    // generate-and-check the obstacle rows and the pickup chains both use, and the same outcome
    // when it fails: nothing there is quieter than a trap.
    let placed: Ramp | null = null

    for (let attempt = 0; attempt < RAMP_ATTEMPTS && !placed; attempt++) {
      const candidate: Ramp = {
        id,
        z,
        offsetX: (rng() * 2 - 1) * RAMP_MAX_OFFSET,
        halfWidths: RAMP_HALF_WIDTHS,
      }

      if (clearOfObstacles(candidate, obstacles)) placed = candidate
    }

    if (!placed) continue

    id++
    ramps.push(placed)
  }

  return ramps
}

/** How many lanes a ramp tries before the slot is left empty. Same shape as `CHAIN_ATTEMPTS`. */
export const RAMP_ATTEMPTS = 8

/**
 * How much road either side of a ramp has to be free of obstacles, in world units.
 *
 * The ramp's own depth plus a margin ahead: the snail is still on the ground for the frame it
 * crosses the lip, so a rock parked immediately in front of one is hit before the launch has
 * lifted anything clear of it.
 */
export const RAMP_CLEARANCE_Z = SEGMENT_LENGTH * 3

/** Whether a ramp would sit on top of, or immediately in front of, an obstacle. */
export function clearOfObstacles(
  ramp: Ramp,
  obstacles: readonly { z: number; offsetX: number; halfWidths: number }[],
): boolean {
  for (const obstacle of obstacles) {
    if (Math.abs(obstacle.z - ramp.z) > RAMP_CLEARANCE_Z) continue
    if (Math.abs(obstacle.offsetX - ramp.offsetX) >= obstacle.halfWidths + ramp.halfWidths + PLAYER_HALF_WIDTHS) {
      continue
    }

    return false
  }

  return true
}

/** How much better a ramp is than a jump, as a ratio of apexes — printed by the check. */
export const RAMP_OVER_JUMP = { apex: RAMP_APEX / JUMP_APEX, launch: RAMP_LAUNCH_V / JUMP_LAUNCH_V }
