/**
 * Things lying on the road that the snail can go out of its way to collect.
 *
 * **Rule: this file never imports `phaser`.** The Phaser half is `PickupSprites.ts`.
 *
 * **Three kinds, and the docstring the rail shooter left behind is why it is three.** That game
 * cut its set twice — seven to five — on a rule about *meaning*: what survived was what a player
 * can predict from the icon without being told. Its final five were more health, more shields, a
 * different gun, more speed and more points; the last three of those have no equivalent here (no
 * guns, no multiplier), and "more health" and "more shields" collapse into one thing once a hit
 * costs speed rather than health.
 *
 * So: **speed, a hit absorbed, and money.**
 *
 * | kind     | what it does                | why it is in the set                                  |
 * |----------|-----------------------------|-------------------------------------------------------|
 * | `boost`  | raises the ceiling for 3s   | the reward is the currency the run is scored in        |
 * | `shield` | absorbs the next hit's life | the only way to buy back a mistake you have not made yet |
 * | `coin`   | one coin, banked on death   | the only thing that leaves the run                     |
 *
 * **A fourth would have to answer a question the first three do not**, and there is not one: a
 * runner has exactly two verbs (steer, jump) and one resource (speed). Anything else — a magnet, a
 * doubler, a slow-motion — is a number on a gauge the frame can only report as text, which is
 * precisely what the rail shooter cut in its own second round.
 *
 * **The placement is the feature, and it fights the obstacles.** A coin lying in the gap the player
 * was already going to thread is not a decision. `sideAwayFrom` — kept from the rail shooter,
 * weights and all — puts a pickup on the side the obstacles are *not*, out near the verge, so
 * taking it means leaving the line that was working and paying for it if you overshoot.
 */
import { SEGMENT_LENGTH } from '../road/constants'
import { wrapZ } from '../road/project'
import { PLAYER_BODY_H, PLAYER_HALF_WIDTHS, ROAD_EDGE } from './constants'
import type { Obstacle } from './obstacles'

export type PickupKind = 'boost' | 'shield' | 'coin'

/** Every kind, in the order the art and the tests walk them. */
export const PICKUP_KINDS: readonly PickupKind[] = ['boost', 'shield', 'coin']

/**
 * How often each kind is laid down, as relative weights.
 *
 * `coin` is the common one because it is the only thing that survives the run, and a run that
 * produced nothing to keep is a run with no reason to be repeated. `shield` is the rare one: it is
 * worth the most in the moment and asks the least of the player to use.
 */
export const PICKUP_WEIGHTS: Record<PickupKind, number> = {
  boost: 3,
  shield: 2,
  coin: 8,
}

/**
 * How high off the road a pickup floats, in world units.
 *
 * Inside the snail's own body band (`[0, PLAYER_BODY_H]`), so it is collected by *driving through
 * it* and not by jumping — a pickup that needed a jump would fight the obstacle model, which
 * spends the jump on something else.
 */
export const PICKUP_HEIGHT = 90

/**
 * How wide a pickup's collection box is, in half-widths.
 *
 * **Deliberately wider than the icon is drawn**, which is the one place in this game where the
 * collision box and the sprite are allowed to disagree — and the direction matters: it is only ever
 * *more* generous. An obstacle that hits you from further away than it looks is a lie; a coin that
 * you catch from slightly further than it looks is a game that is not fighting you. 0.16 half-widths
 * is 640 world units of catchment against a 160-unit icon.
 */
export const PICKUP_HALF_WIDTHS = 0.16

/**
 * How big the icon is drawn, in world units — a little under the snail's own height.
 *
 * Sized against the snail rather than against the catchment, because what the player reads is
 * "something the size of a thing I could pick up". The first version drew it at the *catchment*
 * width and put a 640-unit coin on the road: four snails wide, and it read as a piece of scenery
 * that had landed in the wrong game.
 */
export const PICKUP_DRAW_SIZE = 160

/** How far apart pickups are laid, in world units. */
export const PICKUP_SPACING_Z = SEGMENT_LENGTH * 14

/**
 * How far out a pickup sits, in half-widths.
 *
 * Near the verge on purpose — the whole cost of a pickup is the position it takes you out of, and
 * one on the centreline has no cost at all. Kept inside `ROAD_EDGE` so collecting it never
 * *requires* going off the road; the player can choose to overshoot, and pay the drag.
 */
export const PICKUP_OFFSET = { min: 0.45, max: ROAD_EDGE - 0.05 } as const

export interface Pickup {
  id: number
  z: number
  offsetX: number
  kind: PickupKind
  /** Set when collected, so the sprite pool can stop drawing it. Reset per lap by the scene. */
  taken: boolean
}

/**
 * Which side of the road has fewer obstacles ahead of `z`, as `-1` or `1`.
 *
 * **Kept from the rail shooter's `sideAwayFrom`, weights and all**, because the argument transfers
 * exactly: there it kept a pickup out of the line of fire so that collecting it was a decision
 * rather than a side effect of aiming; here it keeps one out of the gap the player was already
 * threading. Weighted by how close each obstacle is, because something about to arrive is what the
 * player's hand is on, and something twenty segments out is not.
 *
 * An empty stretch, or a perfectly balanced one, leaves the seeded side alone — the caller passes
 * it in as `fallback` so a quiet stretch does not put every pickup on the same side of the map.
 */
export function sideAwayFrom(
  obstacles: readonly Obstacle[],
  z: number,
  trackLength: number,
  fallback: number,
): number {
  const reach = SEGMENT_LENGTH * 60
  let weight = 0

  for (const obstacle of obstacles) {
    const ahead = wrapZ(obstacle.z - z, trackLength)

    if (ahead > reach) continue

    weight += obstacle.offsetX * (1 - ahead / reach)
  }

  if (weight === 0) return fallback >= 0 ? 1 : -1

  return weight > 0 ? -1 : 1
}

/** Picks a kind from `PICKUP_WEIGHTS`. */
export function chooseKind(rng: () => number): PickupKind {
  const total = PICKUP_KINDS.reduce((sum, kind) => sum + PICKUP_WEIGHTS[kind], 0)
  let roll = rng() * total

  for (const kind of PICKUP_KINDS) {
    roll -= PICKUP_WEIGHTS[kind]
    if (roll <= 0) return kind
  }

  return 'coin'
}

export interface PickupPlacementOptions {
  rng: () => number
  fromZ: number
  toZ: number
  trackLength: number
  /** The obstacles already laid, which the placement deliberately works against. */
  obstacles: readonly Obstacle[]
}

/**
 * Lays pickups along a stretch.
 *
 * **No passability proof, and that is not an omission.** A pickup cannot make a stretch
 * impassable — it has no collision, only a collection box — so there is nothing to prove. What
 * there *is* to get right is that it is never free, which is `sideAwayFrom`'s job.
 */
export function placePickups(options: PickupPlacementOptions): Pickup[] {
  const { rng, fromZ, toZ, trackLength, obstacles } = options
  const pickups: Pickup[] = []
  let id = 0
  let seededSide = rng() < 0.5 ? -1 : 1

  for (let z = fromZ; z < toZ; z += PICKUP_SPACING_Z * (0.8 + rng() * 0.6)) {
    const side = sideAwayFrom(obstacles, z, trackLength, seededSide)
    const reach = PICKUP_OFFSET.min + rng() * (PICKUP_OFFSET.max - PICKUP_OFFSET.min)

    seededSide = side
    pickups.push({ id: id++, z, offsetX: side * reach, kind: chooseKind(rng), taken: false })
  }

  return pickups
}

/**
 * Whether the snail is close enough to collect this pickup.
 *
 * Lateral only, plus the height band: the caller has already decided the snail crossed this `z`.
 * A pickup is collected in the air as well as on the ground, because `PICKUP_HEIGHT` sits inside
 * the body band and a jump over one would otherwise silently waste it.
 */
export function reaches(body: { offsetX: number; y: number }, pickup: Pickup): boolean {
  if (pickup.taken) return false
  if (Math.abs(body.offsetX - pickup.offsetX) >= PICKUP_HALF_WIDTHS + PLAYER_HALF_WIDTHS) return false

  return body.y < PICKUP_HEIGHT + PICKUP_HALF_WIDTHS * 100 && PICKUP_HEIGHT < body.y + PLAYER_BODY_H
}
