/**
 * Things lying on the road that the snail can go out of its way to collect.
 *
 * **Rule: this file never imports `phaser`.** The Phaser half is `PickupSprites.ts`.
 *
 * **Three kinds, and the set was cut to three rather than grown to four.** The rail shooter this
 * game forked from cut its own set twice — seven to five — on a rule about *meaning*: what survived
 * was what a player can predict from the icon without being told. This one shipped with `boost`,
 * `shield` and `coin`, and then Fever arrived and made `boost` the second answer to a question that
 * already had one.
 *
 * | kind     | what it does                | why it is in the set                                     |
 * |----------|-----------------------------|----------------------------------------------------------|
 * | `fruit`  | fills the Fever gauge       | all of the run's speed, in one place                      |
 * | `shield` | absorbs the next hit's life | the only way to buy back a mistake you have not made yet  |
 * | `coin`   | one coin, banked on death   | the only thing that leaves the run                        |
 *
 * ## ⚠ `boost` was deleted, and the reason is the same rule that keeps the set small
 *
 * It raised the ceiling by 60% for three seconds; Fever raises it by 60% for six. **Two products
 * that differ only in how much of the same thing they give are one product the player has to
 * memorise a table for**, and "a bit faster" versus "a lot faster" is not a distinction anyone
 * makes at speed. So the speed is all in the fruit now: a fruit is not fast, it is *progress
 * toward* fast, which is a different sentence rather than a smaller number.
 *
 * That also fixes something the old docstring was wrong about. It argued against a fourth kind on
 * the grounds that a magnet is "a number on a gauge the frame can only report as text" — true of a
 * magnet sold as a pickup of its own, and false of one that is part of what Fever *is*: the frame
 * reports it by visibly dragging every pickup on screen onto the snail's line.
 *
 * ## Weights
 *
 * `coin` stays the common one because it is the only thing that survives the run, and a run that
 * produced nothing to keep is a run with no reason to be repeated. `fruit` takes the middle share —
 * it has to arrive often enough that a Fever is something a run *reaches* rather than something it
 * hopes for, and rarely enough that the gauge is a gauge. `shield` stays rarest: it is worth the
 * most in the moment and asks the least of the player to use.
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

export type PickupKind = 'fruit' | 'shield' | 'coin'

/** Every kind, in the order the art and the tests walk them. */
export const PICKUP_KINDS: readonly PickupKind[] = ['fruit', 'shield', 'coin']

/**
 * How often each kind is laid down, as relative weights — see the header for the argument.
 *
 * Fruit at 5 of 15 is one pickup in three, so `FEVER_FRUIT_TARGET` fruit is roughly 24 pickups of
 * road. That is the number both halves of the pacing are tuned against, and moving either without
 * the other moves how often a Fever happens.
 */
export const PICKUP_WEIGHTS: Record<PickupKind, number> = {
  fruit: 5,
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
 * How big the icon is drawn, in world units.
 *
 * Sized against the snail rather than against the catchment, because what the player reads is
 * "something the size of a thing I could pick up". The first version drew it at the *catchment*
 * width and put a 640-unit coin on the road: four snails wide, and it read as a piece of scenery
 * that had landed in the wrong game.
 *
 * **⚠ 320 rather than 160, which makes it bigger than the snail rather than a little under it.**
 * That reverses the sizing above and is a deliberate call rather than a drift: at 160 the icons
 * read as small change lying on a wide road, and the thing the player is being asked to steer
 * towards has to be worth steering towards. It is still half the 640-unit catchment, so the one
 * rule that may not bend — the box is only ever MORE generous than the icon, never less — is
 * unchanged. What it costs is that a pickup no longer reads as smaller than the mascot; the
 * mascot keeps its separation by being the only saturated object in the frame instead.
 */
export const PICKUP_DRAW_SIZE = 320

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
  /**
   * How high off the road this one floats, in world units.
   *
   * **Per pickup rather than the constant it used to be, and `formations.ts` is why.** A `line` or
   * a `wave` sits at `PICKUP_HEIGHT` like everything always did; an `arc` follows the snail's own
   * flight, so every pickup in it is at a different height and there is no single number that could
   * describe the chain.
   */
  y: number
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

  return body.y < pickup.y + PICKUP_REACH_UNDERFOOT && pickup.y < body.y + PLAYER_BODY_H
}

/**
 * How far *below the snail's feet* a pickup may still be taken, in world units.
 *
 * **The vertical window is lopsided, and which way round it is lopsided is not obvious.** The
 * snail's body occupies `[y, y + PLAYER_BODY_H]`, so a pickup may sit anywhere up to 180 units
 * **above** its feet and be swept up by its shell — and only 16 below them, which is this. An arc
 * laid slightly high is therefore collected and one laid slightly low is missed, which is the
 * opposite of the first guess: `formations.ts` shipped a 45-unit safety sag on that guess and
 * `verify:formations` collected 0 of 3.
 *
 * `PICKUP_HEIGHT` is that centre — half of `PLAYER_BODY_H` — which is why a ground pickup and an
 * airborne one use the same offset and neither needed a constant of its own.
 */
export const PICKUP_REACH_UNDERFOOT = PICKUP_HALF_WIDTHS * 100
