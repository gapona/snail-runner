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
import { ROAD_WIDTH, SEGMENT_LENGTH } from '../road/constants'
import { wrapZ } from '../road/project'
import { PLAYER_BODY_H, PLAYER_HALF_WIDTHS, readableScale, ROAD_EDGE } from './constants'
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
 *
 * **Derived, because it means the body's CENTRE and nothing else.** `formations.ts` lays an arc at
 * `flightHeight + PICKUP_HEIGHT` precisely so an airborne chain sits where a ground pickup sits
 * relative to a grounded snail, which makes the collection tolerance symmetric at
 * `±PLAYER_BODY_H / 2` instead of `+PLAYER_BODY_H / −PICKUP_REACH_UNDERFOOT`. Typed as a number it
 * was 130 against a body of 261 and stayed 130 when the body grew — a centre that had quietly
 * stopped being one.
 */
export const PICKUP_HEIGHT = PLAYER_BODY_H / 2

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

/**
 * How wide the collection box is, in world units — the same fact `PICKUP_HALF_WIDTHS` states, in
 * the units the icon is drawn in.
 */
export const PICKUP_CATCHMENT = PICKUP_HALF_WIDTHS * 2 * ROAD_WIDTH

/**
 * The most of its own catchment an icon may be drawn as.
 *
 * **⚠ `readableScale` had quietly re-created the failure `PICKUP_DRAW_SIZE` documents.** That
 * constant is authored at exactly half the catchment because the first version drew the icon at the
 * *whole* of it and put a 640-unit coin on the road — "four snails wide, and it read as a piece of
 * scenery that had landed in the wrong game". The narrow-frame boost then multiplied it by up to
 * 1.9 with nothing bounding the product: measured on a 375px phone, a coin was drawn at **608 units
 * — 95% of its catchment, and 44% wider than the mascot** — which is what a player was looking at
 * when they reported the snail as too small. On the same frame the icon was 49 screen pixels
 * against the snail's 34.
 *
 * Two thirds leaves the boost most of its range (up to 1.33x, so 26px becomes 34px on a phone
 * rather than 49px) while keeping the one rule that may not bend: the box is only ever MORE
 * generous than the icon, never less. The cap lives here rather than inside `readableScale` because
 * it is a statement about the catchment, and the catchment is this file's.
 */
export const PICKUP_MAX_ICON_SHARE = 2 / 3

/**
 * How wide the icon is actually drawn on a frame this wide, in world units.
 *
 * The narrow-frame boost, bounded by the catchment — see `PICKUP_MAX_ICON_SHARE`. Everything that
 * draws a pickup goes through this rather than through `PICKUP_DRAW_SIZE * readableScale(...)`, so
 * the bound cannot be applied in one place and forgotten in the next.
 */
/**
 * How many pickups may be drawn at once.
 *
 * **⚠ This was 24 against a measured peak of 47, and the pool had no demand counter at all** — so
 * for as long as pickups have existed roughly half of them were competing for slots and nothing in
 * the game could say so. `ObstacleSprites` counts past its capacity precisely so `wantedLastFrame`
 * stays honest; `PickupSprites` did not, which is the failure `DECOR_POOL_SIZE` already recorded in
 * the other direction: *a saturated pool reports its own ceiling rather than the demand.*
 *
 * **What it looked like from outside was coins changing number when you took off from a ramp.** The
 * pool is filled near to far, so which pickups get the scarce slots is a function of their order —
 * and `layArc` re-lays the whole chain at the moment of launch, moving every coin into a different
 * segment. Nothing was gained or lost; the *drawn set* was reshuffled, in view, on the one frame the
 * player is looking straight at it.
 *
 * **And it was reported on mobile because that is where it is worst.** `pickupDrawWidth` boosts the
 * icon by up to a third on a narrow frame, so distant coins that were sub-pixel on a desktop pass
 * `billboardOnScreen` there and take slots the near ones needed.
 *
 * 64 against a peak of 47 measured over five real laps — comfortably clear, and under the 2x
 * ceiling the decal pool's own check states, so the number still has to answer to a measurement.
 * It lives here rather than in `PickupSprites` so that `verify:formations` can hold it against one:
 * a pool size inside a Phaser module is a pool size no check can reach.
 */
export const PICKUP_POOL_SIZE = 64

export function pickupDrawWidth(screenWidth: number): number {
  return Math.min(PICKUP_DRAW_SIZE * readableScale(screenWidth), PICKUP_CATCHMENT * PICKUP_MAX_ICON_SHARE)
}

/**
 * How far a pickup rises and falls as it floats, in world units.
 *
 * In world units rather than screen pixels: a pixel bob would be a huge motion at the near end of
 * the road and invisible at the far end, where a world bob is the same distance everywhere and
 * shrinks with distance exactly as the icon does.
 */
export const PICKUP_BOB = 22

/**
 * The height band over which a pickup stops casting a shadow.
 *
 * **⚠ Only a pickup near the road casts one, and this is the rule that says so.**
 * `ObstacleSprites` has always made the same kind of decision for itself -- only an `overhead`
 * casts, because a mark under something already touching the road is a rim nobody can read -- and
 * pickups had no such rule, so an arc chain laid along a ramp flight put a row of ellipses on the
 * road with their coins more than a screen-height above them. See `shadowLinkFade` for what that
 * measured.
 *
 * `full` is the ordinary ground line plus its whole bob, so nothing laid on the road ever dims.
 * `gone` is one icon-height off the road: once a pickup is further from its own mark than the icon
 * is tall, the two are more than an object apart and stop reading as a pair. The lowest point of a
 * ramp arc sits at 5/9 of `RAMP_APEX` plus `PICKUP_HEIGHT` -- 797 units -- so the whole of an arc
 * is past `gone`, and the threshold is not a delicate call.
 *
 * Not a flag on the pickup and not a test for `kind`: the question is how high it is, which is the
 * thing that actually breaks the read, and it answers correctly for anything laid at any height
 * later without that placer having to know a shadow exists.
 */
export const PICKUP_SHADOW_LINK = { full: PICKUP_HEIGHT + PICKUP_BOB, gone: PICKUP_DRAW_SIZE } as const

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
  /**
   * Which launch's arc this belongs to, if any — see `formations.ts` and `RunScene.relayArc`.
   *
   * An arc's world positions depend on the speed the run is doing when it reaches the ramp, which
   * the placer cannot know. The scene re-lays the chain once, from the run's real speed, when the
   * ramp comes close enough that the speed is settled; this is how it finds the five pickups to
   * move. `undefined` for a `line` or a `wave`, which do not care.
   */
  arcOf?: number
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
