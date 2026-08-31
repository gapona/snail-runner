/**
 * Pickups in chains rather than one at a time — which is what turns collecting into a *route*.
 *
 * **Rule: this file never imports `phaser`** — `npm run verify:formations` loads it under Node.
 *
 * The placer used to draw one pickup every `PICKUP_SPACING_Z` and roll its kind independently. That
 * is a road with things on it; it is not a line the player can see from a distance and decide to
 * take. A chain is a decision made once, at range, and then held — which is the same shape as an
 * obstacle row, and for the same reason: what the player reads ahead is what the game is about.
 *
 * | kind   | shape                                        | where                                 |
 * |--------|----------------------------------------------|---------------------------------------|
 * | `line` | straight, one lane, on the ground             | anywhere                              |
 * | `wave` | a sine across the road, 8–12 pickups a period | anywhere — it is the one that steers  |
 * | `arc`  | the snail's own flight path                   | only off a launch (see below)         |
 *
 * ## ⚠ The arc is computed by the flight solver, never drawn by eye
 *
 * `arcChain` calls `flightHeight` out of `playerMotion.ts` — the closed form of the arc the fixed
 * tick integrates. That is not tidiness: an arc laid by hand is an arc the player can see, aim at,
 * hit the launch perfectly, and still miss, and there is no way for them to learn what they did
 * wrong. Laid by the solver, hitting the launch collects the chain by construction, and the chain
 * teaches what launches are for without a word of text.
 *
 * **It is the same argument as the recording driver calling the game's own solver** rather than
 * reimplementing its rules: two copies of one law disagree the first time either is tuned.
 *
 * ## ⚠ And the vertical window is lopsided the opposite way from the obvious guess
 *
 * The snail's body occupies `[y, y + PLAYER_BODY_H]`, so `reaches` collects a pickup up to 180 units
 * **above** the feet and only `PICKUP_REACH_UNDERFOOT` (16) below them. The first version of this
 * file had that the wrong way round and laid the arc 45 units *under* the trajectory as a safety
 * margin — which is a fifth of a body height, looks like nothing, and collected **0 of 3**.
 *
 * So the arc is laid at `flightHeight + PICKUP_HEIGHT`: the height of the body's *centre*, which is
 * exactly where a ground pickup sits relative to a grounded snail. One offset for both cases, and
 * the tolerance becomes symmetric at ±90 units instead of +180/−16 — which is what the arc actually
 * needs, because the speed it is flown at is not the speed it was laid for.
 *
 * ## Spacing is stated in milliseconds
 *
 * The same rule the obstacle rows follow: a gap the player experiences is a gap in *time*, and the
 * run's speed changes by a factor of four over a run. It is converted at `MAX_ATTAINABLE_SPEED`, so
 * a chain is never tighter than its stated rhythm — erring toward spread out rather than bunched,
 * because a bunched chain reads as one blob and the whole point is that it reads as a line.
 */
import { SEGMENT_LENGTH } from '../road/constants'
import { wrapZ } from '../road/project'
import { MAX_ATTAINABLE_SPEED, PLAYER_HALF_WIDTHS, SPEED_CAP } from './constants'
import { RAMP_DEPTH } from './ramp'
import type { Obstacle } from './obstacles'
import { flightDuration, flightHeight } from './playerMotion'

/**
 * One place a chain may arc off — a ramp, and everything about it a chain needs.
 *
 * Named rather than written inline on `FormationOptions`, because `flightSpans` answers a question
 * about the same list and two structural types describing one thing drift apart the first time one
 * of them gains a field.
 */
export interface Launch {
  id: number
  z: number
  offsetX: number
  launchV: number
}
import {
  PICKUP_HALF_WIDTHS,
  PICKUP_HEIGHT,
  PICKUP_OFFSET,
  sideAwayFrom,
  type Pickup,
  type PickupKind,
} from './pickups'

export type FormationKind = 'line' | 'wave' | 'arc'

/**
 * How long a chain of each kind is, and how far apart its pickups are in time.
 *
 * **A fruit chain is shorter than a coin chain, and that is the fruit being worth more.** Eight
 * fruit fill the Fever gauge, so a chain of eight would be a whole Fever handed over for one
 * decision; four is a quarter of one, which is a stretch of road being worth something rather than
 * being the answer. `shield` has no chain at all — a row of shields is a row of the same absorbed
 * hit, and the pickup that is worth the most in the moment is the one that has to stay a moment.
 */
export const CHAIN: Record<PickupKind, { min: number; max: number; gapMs: number }> = {
  coin: { min: 6, max: 12, gapMs: 150 },
  fruit: { min: 3, max: 5, gapMs: 260 },
  shield: { min: 1, max: 1, gapMs: 0 },
}

/** How far apart chains are laid, in world units, before the per-chain jitter. */
export const CHAIN_SPACING_Z = SEGMENT_LENGTH * 26

/**
 * How wide the `wave` swings, in half-widths, and how many pickups make one period.
 *
 * The amplitude plus the centre has to stay inside `PICKUP_OFFSET`, which `waveChain` enforces by
 * shrinking the amplitude rather than by clamping each pickup: a clamped sine flattens at both ends
 * and stops being the thing the player is reading.
 */
export const WAVE = { amplitude: 0.55, periodMin: 8, periodMax: 12 } as const

/**
 * The speed an arc's horizontal spacing is laid for, in world units per second.
 *
 * **⚠ An arc in world space is a function of the run's speed, and the placer cannot know it.** The
 * heights come from the flight solver and the *positions* those heights sit at come from how far
 * the run travels while airborne — which is `speed * flightDuration`. Laid for one speed and flown
 * at another, the chain is still on the trajectory in time and off it in space.
 *
 * `SPEED_CAP` is the reference because it is where a run settles and spends most of itself.
 * `verify:formations` sweeps the whole speed range and prints how much of a chain survives at each,
 * rather than asserting only the reference case — a tolerance nobody has measured is not one.
 */
export const ARC_REFERENCE_SPEED = SPEED_CAP

/** How many times a chain is redrawn elsewhere before it is dropped. Same shape as `ROW_ATTEMPTS`. */
export const CHAIN_ATTEMPTS = 6

/**
 * How many pickups an arc off one launch carries.
 *
 * Five, sampled evenly in time across the flight with both ends left off — enough that the chain
 * reads as a curve rather than as three dots, and few enough that a missed one is a miss rather
 * than most of the reward.
 */
export const ARC_COUNT = 5

/**
 * How far ahead of a ramp its arc is re-laid for the run's real speed, in world units.
 *
 * 90 segments — under two seconds of road at the cap, which is well inside `SPEED_ACCEL`'s
 * 5.9-second time constant, so the speed then is within a couple of percent of the speed at the
 * ramp. Far enough out that nothing is seen moving; near enough that the number used is the number
 * that matters. See `RunScene.relayArcs`.
 */
export const ARC_RELAY_Z = SEGMENT_LENGTH * 90

/**
 * How close a ramp may get before its arc stops being re-laid, in world units.
 *
 * 40 segments — beyond the far end of the chain itself, which reaches `speed * flightDuration` =
 * 21 to 34 segments past the ramp. Inside this the player is lining up on the chain and coins
 * sliding under that approach would be worse than coins laid for a speed a second out of date; the
 * launch itself is what puts it right, at the one instant the flight's speed is a fact rather than
 * a prediction.
 */
export const ARC_RELAY_NEAR_Z = SEGMENT_LENGTH * 40

/** Milliseconds of chain rhythm, in world units at the fastest the game can go. */
export function chainSpacingZ(gapMs: number): number {
  return (gapMs / 1000) * MAX_ATTAINABLE_SPEED
}

export interface ChainSpec {
  kind: FormationKind
  pickup: PickupKind
  count: number
  /** Where the chain begins, in world units. */
  fromZ: number
  /** The lane a `line` sits in, or the centre a `wave` swings about, in half-widths. */
  offsetX: number
  /** `wave` only: how many pickups make one full swing. */
  period?: number
  /** `arc` only: the launch velocity the chain was thrown at. */
  launchV?: number
  /** `arc` only: the speed its horizontal spacing was laid for. */
  speed?: number
}

/**
 * The pickups a spec describes, as offsets from its own start — pure geometry, no ids and no rng.
 *
 * Split out from the placer so `verify:formations` can ask what a chain *is* without also asking
 * where the placer chose to put it.
 *
 * **⚠ What comes out of here is what ships, with nothing clamped afterwards.** The first version
 * ran the points through a `clampOffset` at `ROAD_EDGE` *after* the obstacle check — a second,
 * stricter idea of where the road ends than `PICKUP_OFFSET`'s — so twelve of 2065 pickups were
 * checked in one place and laid in another, inside an obstacle. `PICKUP_OFFSET` is the one rule.
 */
export function chainPoints(spec: ChainSpec): { z: number; offsetX: number; y: number }[] {
  if (spec.kind === 'arc') return arcPoints(spec)

  const gap = chainSpacingZ(CHAIN[spec.pickup].gapMs)
  const points: { z: number; offsetX: number; y: number }[] = []

  for (let i = 0; i < spec.count; i++) {
    points.push({
      z: spec.fromZ + i * gap,
      offsetX: spec.kind === 'wave' ? waveOffset(spec, i) : spec.offsetX,
      y: PICKUP_HEIGHT,
    })
  }

  return points
}

/**
 * Where the `i`th pickup of a wave sits across the road.
 *
 * The amplitude is shrunk to whatever fits either side of the centre rather than each point being
 * clamped: a clamped sine goes flat at both extremes, which is exactly where the player is being
 * asked to commit to a direction.
 */
function waveOffset(spec: ChainSpec, i: number): number {
  const period = spec.period ?? WAVE.periodMin
  const room = Math.min(PICKUP_OFFSET.max - spec.offsetX, spec.offsetX + PICKUP_OFFSET.max)
  const amplitude = Math.min(WAVE.amplitude, Math.max(0, room))

  return spec.offsetX + amplitude * Math.sin((i / period) * Math.PI * 2)
}

/**
 * The flight arc, sampled evenly in **time** and placed at where the run will be at that time.
 *
 * Sampled in time rather than in distance because the arc is a function of time — spacing the
 * samples evenly along `z` would crowd them at the apex, where the trajectory is flattest and a
 * chain says the least.
 */
function arcPoints(spec: ChainSpec): { z: number; offsetX: number; y: number }[] {
  const launchV = spec.launchV ?? 0
  const speed = spec.speed ?? ARC_REFERENCE_SPEED
  const duration = flightDuration(launchV)
  const points: { z: number; offsetX: number; y: number }[] = []

  for (let i = 0; i < spec.count; i++) {
    // Both ends are skipped: `t = 0` and `t = duration` are on the ground, where an arc's pickup is
    // indistinguishable from a line's and the launch itself is in the way.
    const t = (duration * (i + 1)) / (spec.count + 1)

    points.push({
      z: spec.fromZ + speed * t,
      offsetX: spec.offsetX,
      // The body's centre, not its feet — see the header for the 0-of-3 that established which
      // way the collection window is lopsided.
      y: flightHeight(launchV, t) + PICKUP_HEIGHT,
    })
  }

  return points
}

/** Whether a point would sit inside an obstacle — the one placement rule a chain may not break. */
export function clearOfObstacles(
  point: { z: number; offsetX: number },
  obstacles: readonly Obstacle[],
  trackLength: number,
): boolean {
  for (const obstacle of obstacles) {
    const ahead = wrapZ(point.z - obstacle.z, trackLength)

    // Longitudinally clear: the pickup is either before this obstacle or past its far edge.
    if (ahead > OBSTACLE_REACH_Z && ahead < trackLength - OBSTACLE_REACH_Z) continue
    // Laterally clear.
    if (Math.abs(point.offsetX - obstacle.offsetX) >= obstacle.halfWidths + PICKUP_HALF_WIDTHS + PLAYER_HALF_WIDTHS) {
      continue
    }

    return false
  }

  return true
}

/**
 * How much road either side of an obstacle a pickup has to stay out of, in world units.
 *
 * The obstacle's own depth plus a margin: a coin sitting a hair in front of a rock is a coin the
 * player is being invited to take by driving into the rock, which is not a decision, it is a trap.
 */
const OBSTACLE_REACH_Z = SEGMENT_LENGTH * 2

export interface FormationOptions {
  rng: () => number
  fromZ: number
  toZ: number
  trackLength: number
  /** The obstacles already laid, which the chains are placed against. */
  obstacles: readonly Obstacle[]
  /**
   * Launch points a chain may arc off — trampolines, once they exist.
   *
   * Empty today, and `arc` is therefore never placed: the machinery is here and tested, and the
   * chunk that adds the trampoline supplies the list. An arc laid anywhere else is a chain in the
   * air over flat road, which is the exact failure this module's header is about.
   */
  launches?: readonly Launch[]
}

/**
 * Lays chains along a stretch.
 *
 * **Generate and check, the same shape the obstacle placer uses.** A chain is drawn, tested against
 * the obstacles, and redrawn in a different lane if it fails — up to `CHAIN_ATTEMPTS`, then dropped.
 * Dropping is the right outcome for a pickup: a stretch with no coins on it is quiet, whereas a
 * stretch with a coin inside a boulder is the game asking the player to crash.
 */
export function placeFormations(options: FormationOptions): Pickup[] {
  const { rng, fromZ, toZ, trackLength, obstacles } = options
  const launches = options.launches ?? []
  const pickups: Pickup[] = []
  let id = 0
  let seededSide = rng() < 0.5 ? -1 : 1

  // **⚠ What the walk below must not lay into.** An arc is laid outside the walk, so the walk has
  // never known those stretches were taken — see `flightSpans`.
  const flights: { fromZ: number; toZ: number }[] = []

  for (const launch of launches) {
    // An arc belongs to its launch and is not subject to the spacing walk below — it is where the
    // trampoline is, or it is nowhere.
    const spec: ChainSpec = {
      kind: 'arc',
      pickup: 'coin',
      count: ARC_COUNT,
      fromZ: launch.z,
      // The ramp's own lane: the snail leaves it going straight, and a chain laid down the
      // centreline off a ramp by the verge would be a chain the launch cannot reach.
      offsetX: launch.offsetX,
      launchV: launch.launchV,
      speed: ARC_REFERENCE_SPEED,
    }

    const arc = chainPoints(spec)

    for (const point of arc) {
      pickups.push({
        id: id++,
        z: wrapZ(point.z, trackLength),
        offsetX: point.offsetX,
        y: point.y,
        kind: 'coin',
        arcOf: launch.id,
        taken: false,
      })
    }

    // The wedge itself is reserved along with the flight: a coin standing on a ramp is a coin the
    // player is driving *up*, and the launch takes them off it before they reach it.
    flights.push({ fromZ: launch.z - RAMP_DEPTH, toZ: arc[arc.length - 1].z })
  }

  // **⚠ The walk advances from the END of the chain just laid, not from its start.** A coin chain
  // of twelve spans 9504 units and the gap between chain starts is 4160 at its tightest, so
  // advancing by the gap alone overlapped one chain with the next — two kinds interleaved on one
  // stretch, which is the homogeneity rule broken by the placer rather than by the spec.
  let z = fromZ

  while (z < toZ) {
    // **⚠ Nothing is laid under a flight, and this is the third time the walk has overlapped
    // something it did not know about.** It already advances from the END of the chain just laid
    // rather than from its start, because advancing by the gap alone put two chains on one stretch;
    // the arc is the same bug from outside, because an arc is laid *before* the walk starts and the
    // walk was never told. Reported from the frame it produces: a ramp with a chain along the
    // flight and another chain on the ground beneath it, and the player able to take only one —
    // two rewards in one place, of which one is provably unreachable.
    //
    // Skipping past the flight rather than dropping the chain is what makes the answer "both": the
    // chain that would have gone under the arc is laid after the landing instead, so a player rides
    // up taking the ground line, takes the arc in the air, and lands on the next ground line. The
    // count of chains on the lap is unchanged; only the one place they could not all be had is.
    const flight = flights.find((span) => z >= span.fromZ && z <= span.toZ)

    if (flight) {
      z = flight.toZ + CHAIN_SPACING_Z * (0.8 + rng() * 0.6)
      continue
    }

    const pickup = chooseChainKind(rng)
    const shape: FormationKind = pickup === 'shield' || rng() < 0.45 ? 'line' : 'wave'
    const count = CHAIN[pickup].min + Math.floor(rng() * (CHAIN[pickup].max - CHAIN[pickup].min + 1))
    const side = sideAwayFrom(obstacles, z, trackLength, seededSide)

    seededSide = side

    let placed: { z: number; offsetX: number; y: number }[] | null = null

    for (let attempt = 0; attempt < CHAIN_ATTEMPTS && !placed; attempt++) {
      const reach = PICKUP_OFFSET.min + rng() * (PICKUP_OFFSET.max - PICKUP_OFFSET.min)
      const spec: ChainSpec = {
        kind: shape,
        pickup,
        count,
        fromZ: z,
        // A wave swings about its centre, so it is drawn nearer the middle than a line, which sits
        // in one lane out by the verge — the cost of a line is the lane it takes you into, and the
        // cost of a wave is the steering.
        offsetX: shape === 'wave' ? side * reach * 0.4 : side * reach,
        period: WAVE.periodMin + Math.floor(rng() * (WAVE.periodMax - WAVE.periodMin + 1)),
      }
      const points = chainPoints(spec)

      // **⚠ A chain may not cross the lap seam.** The scene relays the whole layout on every wrap,
      // so a chain whose tail wrapped round to z ≈ 0 would sit on the same ground as the next lap's
      // first chain — two chains in one place, and mixed kinds where they overlap, which is what
      // the homogeneity check reported before this existed. Same rule the obstacle placer follows
      // for the same reason: a layout longer than the lap puts two things on one piece of road.
      if (points[points.length - 1].z >= toZ) break

      // **A chain that starts clear can still run its tail into the flight ahead of it**, which is
      // the same overlap seen from the other end — and the answer is to CUT it there rather than to
      // give up on the stretch. Measured over 40 seeds, refusing the whole chain cost **12% of a
      // lap's ground pickups for 4.6% of the lap reserved**: the flight itself is small and what
      // was expensive was the chain-length of road in front of it that nothing would fit into.
      // Trimming spends only the ground the flight actually covers.
      const ahead = flights.find((span) => points[points.length - 1].z >= span.fromZ && z <= span.toZ)
      const fitted = ahead ? points.filter((point) => point.z < ahead.fromZ) : points

      // Below the kind's own minimum it stops being a chain and becomes a couple of strays, which
      // is the thing `CHAIN` states a minimum to prevent. Better nothing there than that.
      if (fitted.length < CHAIN[pickup].min) break
      if (fitted.every((point) => clearOfObstacles(point, obstacles, trackLength))) placed = fitted
    }

    if (!placed) {
      z += CHAIN_SPACING_Z * (0.8 + rng() * 0.6)
      continue
    }

    z = placed[placed.length - 1].z + CHAIN_SPACING_Z * (0.8 + rng() * 0.6)

    for (const point of placed) {
      pickups.push({
        id: id++,
        z: wrapZ(point.z, trackLength),
        offsetX: point.offsetX,
        y: point.y,
        kind: pickup,
        taken: false,
      })
    }
  }

  return pickups
}

/**
 * The stretches a ramp's flight owns, in world units — the wedge and the arc it throws.
 *
 * Exported so `verify:formations` can measure the overlap this reserves against rather than
 * recomputing it: a second expression of the span is a second thing that can disagree about where
 * the flight ends.
 */
export function flightSpans(
  launches: readonly Launch[],
  speed = ARC_REFERENCE_SPEED,
): { fromZ: number; toZ: number }[] {
  return launches.map((launch) => {
    const arc = chainPoints({
      kind: 'arc',
      pickup: 'coin',
      count: ARC_COUNT,
      fromZ: launch.z,
      offsetX: launch.offsetX,
      launchV: launch.launchV,
      speed,
    })

    return { fromZ: launch.z - RAMP_DEPTH, toZ: arc[arc.length - 1].z }
  })
}

/**
 * Which kind this chain is made of.
 *
 * **Rolled once per chain rather than once per pickup**, which is the whole of "a chain is
 * homogeneous": a line of coins with a fruit in it is not a fruit chain and not a coin chain, and
 * the player cannot decide whether it is worth leaving their lane for until they are alongside it.
 *
 * The weights are `PICKUP_WEIGHTS`' own ratios read as chains rather than as pickups, so what a lap
 * *contains* still leans the way that table says — and a chain of coins is longer than a chain of
 * fruit, which tilts the actual count further toward coins than the weights alone do. That is the
 * intent: coins are the thing a lap leaves behind.
 */
function chooseChainKind(rng: () => number): PickupKind {
  const roll = rng()

  if (roll < 0.5) return 'coin'
  if (roll < 0.85) return 'fruit'

  return 'shield'
}

