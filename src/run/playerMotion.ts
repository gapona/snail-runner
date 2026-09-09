/**
 * How the snail moves — a damped spring towards wherever the player is pointing, in **road
 * half-widths**.
 *
 * **Rule: this file never imports `phaser`.** It is loaded directly under plain Node by
 * `scripts/verify-player.mjs` and `scripts/verify-jump.mjs`.
 *
 * **This is `rail/shipMotion.ts` with its state space replaced, and nothing else.** The spring is
 * the same one, at the same constants, integrated by the same `runFixedSteps`; what changed is
 * what the numbers mean. The rail shooter's ship lived in *screen* coordinates — "it is simply
 * where the finger is" — and paid for that with `ram.ts`, a whole module written because "flying
 * into something is a question the projection cannot answer, since the ship has no world
 * position, only a column."
 *
 * A runner cannot pay that price: clearing an obstacle is a comparison of world heights, and the
 * same obstacle projects to a different screen size at every distance. So `offsetX` is a position
 * on the road, `0` at the centreline and `±1` at the edges of the asphalt, and three things
 * follow that a screen-space version could not have:
 *
 * - **A bend cannot drag the snail off the road.** The road's projected centre slides across the
 *   frame on a curve; a screen-space spring would hold its column while the asphalt left it,
 *   whereas an `offsetX` is measured *from* that centre. `verify:player` proves this against
 *   `billboardRectInto` rather than asserting it.
 * - **Leaving the road means something.** `ROAD_EDGE` and `OFFROAD_LIMIT` are world facts, so the
 *   verge can be a passable place that costs speed instead of an invisible wall.
 * - **Collisions are arithmetic.** `obstacles.ts` compares intervals; nothing has to be projected
 *   to find out whether something was hit.
 *
 * The vertical (`y`, `vy`, `grounded`, `jump`) shares this module and this tick — see "The jump"
 * below for why the two axes cannot be split across two integrators.
 */
import { runFixedSteps } from '../race/fixedStep'
import {
  JUMP_GRAVITY,
  JUMP_LAUNCH_V,
  OFFROAD_LIMIT,
  PLAYER_DAMPING,
  PLAYER_STIFFNESS,
  PLAYER_Z,
  ROAD_EDGE,
  steerTarget,
} from './constants'
import { CAMERA_DEPTH, ROAD_WIDTH } from '../road/constants'

export interface PlayerState {
  /** Position across the road, in half-widths. `0` centreline, `±1` the edges of the asphalt. */
  offsetX: number
  /** Lateral velocity, in half-widths per second. */
  vx: number
  /** Height above the road, in world units. `0` is on the ground. */
  y: number
  /** Vertical velocity, in world units per second. */
  vy: number
  /** Whether the snail is on the ground right now. */
  grounded: boolean
  /**
   * The vertical velocity this flight began with, in world units per second. `0` on the ground.
   *
   * Kept because the spin is a function of **how far through the flight** the snail is, and that
   * fraction is `(flightV0 - vy) / (2 * flightV0)` — exact at every tick, because the velocity
   * update is exact. Without it the only way to know the progress would be a stored clock, which
   * is a second thing to keep in step with the integrator.
   */
  flightV0: number
  /** How many full turns this flight makes. `0` for an ordinary jump — see `ramp.ts`. */
  flightSpins: number
  /**
   * How much of the lateral spring answers while airborne, `0..1`. `1` for an ordinary jump.
   *
   * A ramp weakens it rather than switching it off: **full control makes a ramp an ordinary jump
   * with a bigger number on it, and no control makes it a cut-scene.** Applied to the stiffness, so
   * the snail still goes where it is asked and takes longer about it, rather than being unable to
   * ask.
   */
  airControl: number
  /**
   * Simulated time owed but not yet stepped, in milliseconds — always `< FIXED_STEP_MS`.
   *
   * The fixed timestep only produces identical results at different frame rates if the leftover
   * fraction of a tick survives into the next call, and `stepPlayer` is pure, so the accumulator
   * has to live in the state. Callers treat it as opaque.
   */
  stepRemainderMs: number
}

/**
 * Where the player is pointing.
 *
 * `targetFraction` is a position across the *frame*, `0..1`, which is what a pointer gives you;
 * `targetOffsetX` is the same request already in road half-widths, which is what a test or a
 * scripted mover has. Exactly one of them is expected — `targetOffsetX` wins if both are present.
 *
 * `active` is whether the player is pointing at all. Letting go does not freeze the snail or snap
 * it anywhere: it retargets the spring at wherever the snail already is, so it coasts to a stop on
 * the line it was steered onto. See `targetFor` for why holding beats returning to the centre.
 */
export interface PlayerInput {
  targetFraction?: number
  targetOffsetX?: number
  active: boolean
}

export interface PlayerStepOptions {
  /**
   * The spring to integrate, defaulting to the shipped `PLAYER_STIFFNESS`/`PLAYER_DAMPING`.
   *
   * **Parameters rather than a module read, so the pair can be changed while a run is going** —
   * see `steerTuning.ts` for why the shipped values are inherited from a different game and have
   * never been measured against this one. Every existing caller passes neither and is byte-for-byte
   * unchanged; `verify:player` asserts that the defaults are the constants themselves, so a
   * silently different default could not ship.
   */
  stiffness?: number
  damping?: number
  /**
   * Whether to hold the snail inside `±OFFROAD_LIMIT`. Defaults to `true`.
   *
   * The one caller that passes `false` is `verify:player`'s steady-state lag measurement, which
   * needs the spring's *unclamped* response — a wall would cap the lag and the measurement would
   * be of the wall instead of of the spring.
   */
  clamp?: boolean
}

/** A snail on the centreline, on the ground, standing still. */
export function createPlayerState(): PlayerState {
  return { offsetX: 0, vx: 0, y: 0, vy: 0, grounded: true, flightV0: 0, flightSpins: 0, airControl: 1, stepRemainderMs: 0 }
}

/**
 * Whether any part of the snail is off the asphalt.
 *
 * The width is already in `ROAD_EDGE` (`1 - PLAYER_HALF_WIDTHS`), so this is a comparison of the
 * *centre*, not of an edge — which is what keeps the caller from having to know the snail's size.
 */
export function isOffRoad(offsetX: number): boolean {
  return Math.abs(offsetX) > ROAD_EDGE
}

/**
 * Where an `offsetX` sits across the frame, `0..1` — the inverse of `halfWidthsAtLane`.
 *
 * Exact on the player's own row and nowhere else, which is the only row anything asks about. Two
 * callers: the camera's lean, which follows the snail across the frame, and the tests.
 */
export function playerScreenFraction(offsetX: number): number {
  const scale = CAMERA_DEPTH / PLAYER_Z

  return (offsetX * scale * ROAD_WIDTH) / 2 + 0.5
}

/** Mutable working copy of the parts of `PlayerState` a tick integrates. */
interface Kinematics {
  offsetX: number
  vx: number
  y: number
  vy: number
  grounded: boolean
}

/**
 * Confines the snail to the ground, killing the velocity component that pushed into the wall.
 *
 * Zeroing the velocity matters as much as clamping the position: without it the spring keeps
 * winding up while the snail is pinned, and it lurches away the moment the target moves back
 * inside. `verify:player` holds both halves.
 */
function clampInPlace(s: Kinematics): void {
  if (s.offsetX < -OFFROAD_LIMIT) {
    s.offsetX = -OFFROAD_LIMIT
    if (s.vx < 0) s.vx = 0
  } else if (s.offsetX > OFFROAD_LIMIT) {
    s.offsetX = OFFROAD_LIMIT
    if (s.vx > 0) s.vx = 0
  }
}

/** Resolves an input to a target in half-widths, clamped to somewhere the snail may actually go. */
function targetFor(input: PlayerInput, clamp: boolean, current: number): number {
  const raw =
    input.targetOffsetX !== undefined
      ? input.targetOffsetX
      : input.targetFraction !== undefined
        ? steerTarget(input.targetFraction)
        : current

  // **Letting go holds the line; it does not return to the centre.** The rail shooter's ship
  // coasted back to a rest point, which is right for a craft you fly and let go of — and wrong
  // here, where the line you are on *is* the decision you just made. Aiming the spring at the
  // centreline meant that every time the player released an arrow key, or moved a mouse without
  // holding the button, the snail slid back to the middle of the road and undid the dodge it had
  // just been steered into. Reported as "it keeps pulling to the centre", and it was.
  //
  // Targeting the current position means the spring force is zero and only the damping is left, so
  // the snail decelerates and stops where it is — still with weight, never with a snap.
  if (!input.active) return current
  if (!clamp) return raw

  // **The target is clamped, and that is what makes the wall a wall rather than a stall.** A finger
  // held off the side of the screen is a spring pulling from far outside the road, which no
  // boundary can argue with — the snail would sit on the hard limit with the spring winding up
  // behind it. Clamped, the two agree, and letting go does not produce a lurch.
  return Math.min(OFFROAD_LIMIT, Math.max(-OFFROAD_LIMIT, raw))
}

/**
 * Starts a jump, if the snail is on the ground. Returns a new state; a no-op in the air.
 *
 * **No double jump, and no variable height by hold.** Both would make the arc a thing the player
 * negotiates mid-flight, and the whole obstacle model (see `OBSTACLE_BANDS`) is an assertion about
 * where a *fixed* apex sits relative to three fixed bands. A jump whose height depends on how long
 * a finger stayed down turns "can I clear this" into a question with no stable answer.
 */
export function jump(state: PlayerState): PlayerState {
  if (!state.grounded) return state

  return { ...state, vy: JUMP_LAUNCH_V, grounded: false, flightV0: JUMP_LAUNCH_V, flightSpins: 0, airControl: 1 }
}

/**
 * Throws the snail into a flight it did not ask for — what a ramp does.
 *
 * **Only from the ground**, exactly like `jump`: riding over a ramp in mid-air is flying over it,
 * and a launch that could fire in the air would be the double jump the jump's own docstring
 * refuses. The three flight fields are set together here because they are one decision: how hard,
 * how many turns, and how much say the player still has.
 */
export function launch(state: PlayerState, v0: number, spins: number, airControl: number): PlayerState {
  if (!state.grounded) return state

  return { ...state, vy: v0, grounded: false, flightV0: v0, flightSpins: spins, airControl }
}

/**
 * How high a flight launched at `launchV` is after `seconds`, in world units.
 *
 * **The closed form of the same constant-acceleration arc the tick integrates**, and it is exported
 * so that anything wanting to know where the snail *will be* asks this rather than working it out
 * again. `formations.ts` lays a pickup arc with it: a chain of coins whose heights were computed
 * independently of the flight is a chain the player can visibly aim at and cannot reach, which
 * reads as the game lying rather than as a miss.
 *
 * The tick applies `y += v*dt - g*dt^2/2` per step and this is that summed exactly, so the two
 * agree to floating point rather than approximately — `verify:formations` asserts it against the
 * real `stepPlayer` rather than trusting the algebra.
 */
export function flightHeight(launchV: number, seconds: number): number {
  return launchV * seconds - 0.5 * JUMP_GRAVITY * seconds * seconds
}

/** How long a flight launched at `launchV` lasts before it is back on the ground, in seconds. */
export function flightDuration(launchV: number): number {
  return (2 * launchV) / JUMP_GRAVITY
}

/**
 * Advances the snail by `dtMs` of wall-clock time and returns a new state.
 *
 * **A spring, not a teleport.** Snapping to the pointer every frame reads as a cursor; the spring
 * gives the snail mass, so the player is steering a creature towards a place rather than dragging
 * an icon. `PLAYER_STIFFNESS = 60` and `PLAYER_DAMPING = 0.85` are the rail shooter's own,
 * measured there against its dodge budget — see `playerResponse()` in `constants.ts`, which solves
 * this tick in closed form, and `npm run verify:player`, which asserts the formulas against this
 * integrator so the two cannot drift apart.
 *
 * **The jump is integrated in the same tick as the horizontal, and that is not a tidiness
 * preference.** Two integrators would each carry their own remainder, so the same wall-clock delta
 * could run three lateral ticks and two vertical ones — and "was I over the log when I crossed it"
 * is a question about both axes at one instant. One tick, one answer.
 *
 * Landing is detected here rather than by the caller: `grounded` flips exactly on the tick where
 * `y` would have gone negative, and `y` is pinned to `0` rather than left slightly under.
 */
export function stepPlayer(
  state: PlayerState,
  input: PlayerInput,
  dtMs: number,
  options: PlayerStepOptions = {},
): PlayerState {
  const clamp = options.clamp ?? true
  const springK = options.stiffness ?? PLAYER_STIFFNESS
  const springD = options.damping ?? PLAYER_DAMPING
  const target = targetFor(input, clamp, state.offsetX)

  const s: Kinematics = {
    offsetX: state.offsetX,
    vx: state.vx,
    y: state.y,
    vy: state.vy,
    grounded: state.grounded,
  }

  const remainder = runFixedSteps(state.stepRemainderMs, dtMs, (dtSec) => {
    // **The air-control multiplier is on the stiffness, and only while airborne.** Scaling the
    // damping instead would make the snail *drift* rather than answer slowly, and scaling the
    // target would make it answer fully to a smaller request — neither is "the controls are
    // heavier in the air", which is what a ramp is trading the player for its height.
    const stiffness = s.grounded ? springK : springK * state.airControl

    s.vx = (s.vx + (target - s.offsetX) * stiffness * dtSec) * springD
    s.offsetX += s.vx * dtSec

    if (clamp) clampInPlace(s)

    if (!s.grounded) {
      // **The exact integral over the tick, not `y += v * dt` after updating `v`.** Under constant
      // acceleration the position over one step is `v*dt - g*dt^2/2`, and the naive form drops
      // that second term on every tick. It is not a rounding difference: measured against the
      // shipped constants it peaked at **303 units instead of 320**, 5.3% low, which is enough to
      // stop clearing an obstacle the arc was solved to clear. `verify:jump` caught it on the
      // first run and holds the apex to 1%.
      //
      // Same lesson as `ui/scrollMomentum.ts`'s own note about integrating a decaying velocity —
      // a per-step position update has to be the integral, not a sample of the velocity.
      s.y += s.vy * dtSec - 0.5 * JUMP_GRAVITY * dtSec * dtSec
      s.vy -= JUMP_GRAVITY * dtSec

      if (s.y <= 0) {
        s.y = 0
        s.vy = 0
        s.grounded = true
      }
    }
  })

  // **`...state` first, so the flight fields survive.** `Kinematics` deliberately carries only what
  // the tick integrates; spreading it alone would drop `flightV0`, `flightSpins` and `airControl`
  // every frame and the spin would reset to nothing on the tick after it started.
  return {
    ...state,
    ...s,
    // Cleared on landing rather than left holding the last flight's numbers: a grounded snail with
    // a launch velocity on it is a state nothing reads and everything can be confused by.
    flightV0: s.grounded ? 0 : state.flightV0,
    flightSpins: s.grounded ? 0 : state.flightSpins,
    airControl: s.grounded ? 1 : state.airControl,
    stepRemainderMs: remainder,
  }
}
