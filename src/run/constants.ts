/**
 * Tuning for the endless runner — the snail, the ground it runs on, and the things standing in
 * its way.
 *
 * `phaser`-free: `src/run/runState.ts`, `playerMotion.ts` and `obstacles.ts` all depend on this
 * and run under plain Node for `npm run verify:run-speed`, `verify:player`, `verify:jump` and
 * `verify:obstacles`.
 *
 * **This file is the fork's centre of gravity.** The rail shooter kept its player in *screen*
 * coordinates — the ship was simply where the finger was — and every number below exists
 * because the runner cannot do that. "Did I clear that log?" is a comparison of world heights;
 * the same obstacle twenty segments out and at the moment of contact has wildly different screen
 * sizes, so a jump threshold measured in pixels would mean a different thing at every distance.
 * So the player carries `z` (fixed), `offsetX` (road half-widths) and `y` (world units), and
 * every constant here is in one of those three units or in milliseconds.
 */
import { FIXED_STEP_MS } from '../race/constants'
import { CAMERA_DEPTH, CAMERA_HEIGHT, HORIZON_Y, MAX_SPEED, ROAD_WIDTH, SEGMENT_LENGTH } from '../road/constants'

/* ------------------------------------------------------------------ *
 * Where the player is
 * ------------------------------------------------------------------ */

/**
 * Where the player is drawn down the frame, as a fraction of viewport height.
 *
 * Inherited unchanged from the rail shooter's `SHIP_REST_Y_FRACTION` — the centre of the bottom
 * third — because it is a good row for the same reason there and here: far enough up that the
 * ground under it still reads as ground, far enough down that the whole approach is visible
 * above it. **It is an input to `PLAYER_Z`, not a drawing constant.** Nothing positions the
 * player from it; the projection does that, from the world row it implies.
 */
export const PLAYER_REST_Y_FRACTION = 5 / 6

/**
 * The player's fixed distance ahead of the camera, in world units — the row the runner lives on.
 *
 * **Derived by solving `projectInto` for the ground row at `PLAYER_REST_Y_FRACTION`**, exactly as
 * the rail shooter's `SHIP_LANE_Z` was, and it comes out at 1966 units ≈ 9.8 segments ahead of
 * the camera. Two things follow, and both are the point of the fork:
 *
 * - The player is drawn by `billboardRectInto` on the segment nearest this `z`, like any piece of
 *   scenery. Visual and logic cannot drift apart, because they are the same numbers.
 * - The camera travels; the player does not, relative to it. `RunState.z` is the *camera's*
 *   distance, and the player is always `PLAYER_Z` ahead of it. An obstacle is met when the
 *   camera's `z` plus this constant crosses the obstacle's own `z`.
 */
export const PLAYER_Z = CAMERA_DEPTH / ((2 * (PLAYER_REST_Y_FRACTION - HORIZON_Y)) / CAMERA_HEIGHT)

/**
 * A screen fraction, read as road half-widths on the player's own row.
 *
 * Lifted verbatim from the rail shooter's `halfWidthsAtLane`, and it does more work here: there
 * it was a measurement aid that nothing drew with, here it is the **input conversion**. A finger
 * at 30% across the frame is a request to stand at `halfWidthsAtLane(0.3)` on the road, and
 * because the player's row is fixed this conversion is exact rather than approximate.
 *
 * Exact only at `PLAYER_Z` — which is the only row anything ever asks about.
 */
export function halfWidthsAtLane(screenFraction: number): number {
  const scale = CAMERA_DEPTH / PLAYER_Z

  return ((screenFraction - 0.5) * 2) / (scale * ROAD_WIDTH)
}

/**
 * Half the snail's width, in road half-widths — and, through `PLAYER_WIDTH` below, its **drawn**
 * width too.
 *
 * `offsetX` spans `[-1, 1]` across the asphalt, so `2 * ROAD_WIDTH` = 4000 world units is the
 * full carriageway and the snail is 280 of them across: 7% of the road. That leaves room for
 * three clearly separated lines through any obstacle without the road having to be marked into
 * lanes, which is what keeps an obstacle a choice rather than a reflex test.
 *
 * **The collision width and the drawn width are the same number, and that is enforced rather than
 * remembered** — see `PLAYER_WIDTH`. The first version of this let the texture's own pixel size
 * decide how wide the snail looked (via `SPRITE_SCALE`, which is world units per texture pixel),
 * and the two promptly disagreed by a factor of two and a half: a snail 720 units wide on screen
 * and 180 tall by the collision model, i.e. a pancake that got hit by things it visibly cleared.
 */
export const PLAYER_HALF_WIDTHS = 0.07

/**
 * The snail's drawn footprint in world units — width from `PLAYER_HALF_WIDTHS`, height from
 * `PLAYER_BODY_H`.
 *
 * **The drawing is derived from the collision box, never the other way round.** `PlayerView` hands
 * these to `billboardRectInto` (divided by `SPRITE_SCALE`, which is the unit that function's
 * texture-size arguments are in), so the sprite on screen is exactly the box the obstacle test
 * uses. Redrawing the art at a different pixel size changes nothing about how big the snail is;
 * only these two numbers do.
 */
export const PLAYER_WIDTH = PLAYER_HALF_WIDTHS * 2 * ROAD_WIDTH

/**
 * The last `offsetX` at which the snail is still entirely on the asphalt, and the hard limit
 * past it.
 *
 * **Two edges, not one, and the gap between them is a soft wall.** A single hard clamp at the
 * asphalt's edge reads as the input sticking — the player pushes and nothing answers, exactly the
 * defect the rail shooter's `LANE_SOFT_BAND` was written to fix. Here the fix is cheaper and more
 * honest, because unlike a screen-space lane this boundary is a *world* fact: past `ROAD_EDGE`
 * the snail is on the verge, which is passable and costs speed (`OFFROAD_DRAG`), and
 * `OFFROAD_LIMIT` is where it genuinely runs out of ground. Leaving the road is a decision with a
 * price, not a wall.
 */
export const ROAD_EDGE = 1 - PLAYER_HALF_WIDTHS
export const OFFROAD_LIMIT = 1 + PLAYER_HALF_WIDTHS

/**
 * Fraction of current speed shed per second while any part of the snail is off the asphalt.
 *
 * Sized against the acceleration curve rather than picked: the run gains speed as
 * `(cap - v) * SPEED_ACCEL`, which goes to zero at the ceiling, so *any* constant drag makes the
 * verge strictly slower than the road at every speed without needing a second case. 0.55/s costs
 * about a third of the player's speed over a second of hugging the edge — enough to feel, not
 * enough to end a run.
 */
export const OFFROAD_DRAG = 0.55

/* ------------------------------------------------------------------ *
 * How fast it goes
 * ------------------------------------------------------------------ */

/**
 * Starting speed, in world units per second — 7.2 segments a second.
 *
 * **A snail is slow, and that is the whole contrast the game is built on.** 12% of the road
 * renderer's `MAX_SPEED` is the low end of what still reads as motion at this field of view;
 * below it the ground stops selling speed at all and the game reads as a scrolling background.
 */
export const SPEED_BASE = MAX_SPEED * 0.12

/**
 * Speed ceiling, in world units per second — 18 segments a second.
 *
 * **Set by the reaction budget, not by feel.** `REACTION_MS` is the floor on how long an
 * obstacle must be readable before it arrives; at 18 segments a second an obstacle first
 * distinguishable at 10 segments out gives 555ms, which clears the floor with room. Raising this
 * without raising the distance obstacles become readable at is how a runner starts lying to the
 * player about what was avoidable.
 */
export const SPEED_CAP = MAX_SPEED * 0.3

/**
 * How hard the run pulls towards its ceiling, per second, as a fraction of the remaining gap.
 *
 * A saturating curve rather than a linear ramp: `v += (cap - v) * SPEED_ACCEL * dt`. Constant
 * acceleration would spend the whole run at the ceiling or never reach it depending on run
 * length, whereas this closes 63% of the gap in `1 / SPEED_ACCEL` = 5.9 seconds and asymptotes —
 * so a short run feels like acceleration and a long one feels like a settled top speed, from one
 * number.
 */
export const SPEED_ACCEL = 0.17

/**
 * The boost pickup: multiplier applied to the speed ceiling, and how long it lasts.
 *
 * A multiplier on the *cap* rather than an impulse on the speed, so a boost taken at a standstill
 * (just after a hit) is worth the same as one taken at full tilt — an impulse would make the
 * pickup nearly worthless in exactly the situation the player most needs it.
 */
export const BOOST_FACTOR = 1.6
export const BOOST_MS = 3000

/**
 * What a hit costs, in world units per second, and how long the run is unhittable afterwards.
 *
 * **A hit is a speed loss, not a death**, which is what makes speed the game's actual resource:
 * the punishment is measured in the same unit as the reward. Three hits end the run
 * (`RUN_LIVES`), so the ceiling on carelessness is still hard.
 */
export const HIT_SPEED_LOSS = MAX_SPEED * 0.1
export const HIT_INVULNERABLE_MS = 900
export const RUN_LIVES = 3

/* ------------------------------------------------------------------ *
 * The jump
 * ------------------------------------------------------------------ */

/**
 * How long the snail is off the ground, in milliseconds. **Assigned first; everything else about
 * the jump is solved from it.**
 *
 * 620ms covers 4.5 segments at `SPEED_BASE` and 11 at `SPEED_CAP`. That asymmetry is deliberate
 * and is the difficulty curve: the *window* in which a jump saves you is roughly the whole
 * flight, so the thing that gets hard at speed is not the jump, it is reading the obstacle in
 * time to start it. See `REACTION_MS`.
 */
export const JUMP_AIR_MS = 620

/** Apex height above the road, in world units. */
export const JUMP_APEX = 320

/**
 * Gravity and launch velocity — **solved from the two numbers above, never tuned directly.**
 *
 * For a symmetric ballistic arc of total air time `T` and apex `h`:
 *
 * ```
 * g  = 8h / T^2      // 6659 units/s^2 at h = 320, T = 0.62
 * v0 = gT / 2        // 2064 units/s
 * ```
 *
 * Tuning `g` by hand is how an arc drifts away from the air time the obstacle tables were laid
 * out against — and the whole three-class obstacle model (see `OBSTACLE_BANDS`) is an assertion
 * about where `JUMP_APEX` sits relative to those bands. Change `JUMP_AIR_MS` or `JUMP_APEX`; the
 * arc follows, and `npm run verify:jump` re-checks the apex against the real integrator.
 */
export const JUMP_GRAVITY = (8 * JUMP_APEX) / Math.pow(JUMP_AIR_MS / 1000, 2)
export const JUMP_LAUNCH_V = (JUMP_GRAVITY * (JUMP_AIR_MS / 1000)) / 2

/**
 * The snail's own height, in world units — its body occupies `[y, y + PLAYER_BODY_H]`.
 *
 * This is the *other* half of every collision: an obstacle carries a `[yLow, yHigh]` band and a
 * hit is those two intervals overlapping. 180 against a 320 apex means a grounded snail's back is
 * at 180 and an airborne one's foot clears 180 for most of the flight — which is what separates
 * the three obstacle classes arithmetically rather than by a flag.
 */
export const PLAYER_BODY_H = 180

/* ------------------------------------------------------------------ *
 * Obstacles
 * ------------------------------------------------------------------ */

/**
 * How deep along the track an obstacle is, in world units — one segment.
 *
 * At `SPEED_CAP` the player crosses it in 55ms, so an obstacle is very nearly an instant: there
 * is no "grinding along the side of it" state to model, which is what lets the collision be a
 * pure interval overlap with no contact resolution at all.
 */
export const OBSTACLE_DEPTH = SEGMENT_LENGTH

/**
 * The three height bands an obstacle can occupy, in world units.
 *
 * **One rule instead of three flags.** Nothing anywhere asks "is this jumpable?" — a hit is the
 * player's `[y, y + PLAYER_BODY_H]` overlapping the obstacle's `[yLow, yHigh]`, and the three
 * rows below simply fall out of that arithmetic against `JUMP_APEX = 320`:
 *
 * | band       | range        | outcome                                             |
 * |------------|--------------|-----------------------------------------------------|
 * | `low`      | `[0, 150]`   | cleared by a jump — the apex puts the foot at 320    |
 * | `blocking` | `[0, 430]`   | **cannot** be jumped; must be gone around           |
 * | `overhead` | `[250, 620]` | run under on the ground; **jumping into it hits**   |
 *
 * The third row is not decoration and must never be dropped for being fiddly: without something
 * that punishes being airborne, the optimal play is to hold jump forever and the whole mechanic
 * evaporates. It is also free — the same overlap test produces it.
 *
 * **The heights were cut once, by looking at them.** The first set (`blocking` to 520, `overhead`
 * to 1200) satisfied every constraint above and drew a road lined with grey slabs three to six
 * times the snail's own height — the frame read as an industrial estate rather than as something
 * a snail is running through. What actually binds is only this: `blocking` must reach above 320
 * (the apex) and `overhead` must start above 180 (the snail's back) and reach above 500 (the apex
 * plus the body). Everything past those is bulk, and bulk was costing the read.
 */
export const OBSTACLE_BANDS = {
  low: { yLow: 0, yHigh: 150 },
  blocking: { yLow: 0, yHigh: 430 },
  overhead: { yLow: 250, yHigh: 620 },
} as const

export type ObstacleKind = keyof typeof OBSTACLE_BANDS

/**
 * The least time an obstacle must be on screen and readable before it can be hit, in
 * milliseconds.
 *
 * **This is the real difficulty gate, and it is a floor rather than a target.** The flight arc
 * is wide enough that clearing an obstacle is never the hard part; noticing it is. Every
 * difficulty knob in `difficulty.ts` — density, the share of unjumpable obstacles, the share of
 * overheads — is allowed to move only while every generated layout still leaves this much
 * warning at the speed it will be met at. A curve that cannot hold it is a broken curve; the
 * floor is not the thing to lower.
 *
 * 450ms is roughly two reaction times (a trained visual-motor response is ~250ms) plus the time
 * to decide *which* of dodge-or-jump the obstacle wants.
 */
export const REACTION_MS = 450

/* ------------------------------------------------------------------ *
 * Feel: the spring, the camera, the hitstop
 * ------------------------------------------------------------------ */

/**
 * Spring constant pulling the snail towards where the finger is, in 1/s^2, and the velocity
 * retained per fixed tick.
 *
 * **Both values carried over unchanged from the rail shooter's `SHIP_STIFFNESS`/`SHIP_DAMPING`**,
 * where they were set by measuring how much of a dodge fits inside a telegraph rather than by
 * feel — see `playerResponse()` for what they produce. Only the *space* changed: the spring now
 * pulls `offsetX` in road half-widths instead of an x in pixels. That is the entire fork of
 * `shipMotion.ts`, and keeping the constants identical is what preserves the handling the rail
 * shooter spent a chunk measuring.
 *
 * `PLAYER_DAMPING` is per 60Hz tick, not per second — the tick rate is fixed, so this stays
 * frame-rate independent, and a per-second reading would leave the spring wildly underdamped.
 */
export const PLAYER_STIFFNESS = 60
export const PLAYER_DAMPING = 0.85

export interface PlayerResponse {
  /** Velocity decay rate `lambda`, in s^-1. */
  decayRate: number
  /** Steady trail behind a drag, in half-widths per half-width/s of pointer speed. */
  lagPerPointerSpeed: number
  /** Damping ratio `zeta`. Above 1 it never crosses the target; below 1 it overshoots. */
  dampingRatio: number
  /** Time constant `tau` of the slow pole, in seconds. */
  timeConstantSec: number
  /** Whether the response overshoots at all (`zeta < 1`). */
  oscillates: boolean
}

/**
 * Solves the player's spring for the numbers above — the rail shooter's `shipResponse()`, kept
 * because the tick it solves is unchanged.
 *
 * `stepPlayer`'s tick is `v = (v + k*(target - x)*dt) * d; x += v*dt`, so with `dt = 1/60`:
 * `lambda = (1 - d) / (d * dt)` (the *discrete* rate — the continuous `-ln(d) * 60` reading
 * under-predicts the trail by 8.6%), and `zeta`/`tau` come off the tick matrix's eigenvalues.
 *
 * At the shipped `k = 60`, `d = 0.85`: `zeta = 0.66`, `tau = 0.21s`, overshoots a step by 6.6%
 * once and settles. `npm run verify:player` asserts these against the real integrator so the
 * formulas cannot silently drift from the code.
 */
export function playerResponse(stiffness = PLAYER_STIFFNESS, damping = PLAYER_DAMPING): PlayerResponse {
  const dt = FIXED_STEP_MS / 1000
  const decayRate = (1 - damping) / (damping * dt)

  const trace = 1 + damping - damping * stiffness * dt * dt
  const determinant = damping
  const discriminant = trace * trace - 4 * determinant

  let slowPoleRe: number
  let dampingRatio: number

  if (discriminant >= 0) {
    const root = Math.sqrt(discriminant)
    const muSlow = (trace + root) / 2
    const muFast = (trace - root) / 2

    if (!(muFast > 0) || !(muSlow > 0)) {
      return {
        decayRate,
        lagPerPointerSpeed: decayRate / stiffness,
        dampingRatio: 0,
        timeConstantSec: Infinity,
        oscillates: true,
      }
    }

    const sSlow = Math.log(muSlow) / dt
    const sFast = Math.log(muFast) / dt

    slowPoleRe = sSlow
    dampingRatio = -(sSlow + sFast) / (2 * Math.sqrt(sSlow * sFast))
  } else {
    const re = Math.log(Math.sqrt(determinant)) / dt
    const im = Math.atan2(Math.sqrt(-discriminant) / 2, trace / 2) / dt

    slowPoleRe = re
    dampingRatio = -re / Math.hypot(re, im)
  }

  return {
    decayRate,
    lagPerPointerSpeed: decayRate / stiffness,
    dampingRatio,
    timeConstantSec: -1 / slowPoleRe,
    oscillates: dampingRatio < 1,
  }
}

/** How fast the keyboard's virtual input point travels, in viewport widths per second. */
export const KEYBOARD_POINT_SPEED = 0.9

/**
 * How far the camera leans towards the snail, in road half-widths per half-viewport of offset,
 * and the fraction of the remaining lean error closed per 60Hz frame.
 *
 * Both inherited from the rail shooter, and both stay small for the same reason: full following
 * would turn this back into a chase camera, and the fixed horizon is what sells the road.
 */
export const CAMERA_LEAN = 0.25
export const CAMERA_LEAN_SMOOTHING = 0.08

/**
 * How long a hit freezes **the player**, in milliseconds — never the world, never `timeScale`.
 *
 * Per-entity hitstop via `hitstop.ts`'s `frozenUntil`, inherited from the rail shooter along with
 * the module. A global pause on a runner would stop the ground too, which reads as a dropped
 * frame rather than as an impact.
 */
export const HITSTOP_MS = 80
export const LANDING_HITSTOP_MS = 45

/** Debris thrown by a hit: how they move, and the pool ceiling. Inherited with `debris.ts`. */
export const DEBRIS_PER_HIT = 7
export const MAX_DEBRIS = 96
/** Initial speed, as a fraction of viewport width per second. */
export const DEBRIS_SPEED_FRACTION = 0.22
/** Downward pull, in viewport heights per second squared. */
export const DEBRIS_GRAVITY = 2.2
export const DEBRIS_LIFE_MS = 520

/** Draw order for the things the run adds on top of the world. */
export const PLAYER_DEPTH = 1000
export const SHADOW_DEPTH = PLAYER_DEPTH - 2
export const OBSTACLE_DEPTH_ORDER = PLAYER_DEPTH - 1
export const PICKUP_DEPTH = PLAYER_DEPTH - 1
