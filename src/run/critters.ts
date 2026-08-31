/**
 * The bugs: the one hazard in this game that comes *at* the player rather than waiting for them.
 *
 * **Rule: this file never imports `phaser`.** It is loaded directly under plain Node by
 * `scripts/verify-critters.mjs`. The Phaser half is `CritterSprites.ts` — the same split
 * `obstacles.ts` and `ObstacleSprites.ts` have, and for the same reason.
 *
 * ## Why they are not obstacles with a velocity bolted on
 *
 * An obstacle belongs to a *piece of road*: it is laid a lap at a time, filed under the segment it
 * stands on, and handed to the live layout only once that segment is behind the camera
 * (`lapLayout.ts`). All three of those are false of something that moves. A critter crosses a
 * segment boundary several times a second, so a segment index is a lie about where it is; it has no
 * lap, because it is gone within seconds of being made; and it can never be "rewritten in view"
 * because it is never written down. So it is a **population**, spawned ahead of wherever the camera
 * has got to and retired behind it — the shape the rail shooter's waves had, for the same reason.
 *
 * ## Positions here are ABSOLUTE, and that is why this module is simple
 *
 * Everything else in the run works in track space, where `z` wraps at `trackLength` — right for
 * something bolted to the road, and a trap for two things closing on each other, because "is it
 * behind me yet" becomes a case analysis about the seam. A critter's `z` is instead the run's own
 * unwrapped odometer: the player stands at `run.distance + PLAYER_Z` and a critter at some larger
 * number that only ever falls. `z - playerZ` is then a plain subtraction that is correct at the lap
 * seam by construction, and the *track* position — the only thing the renderer wants — is one
 * `wrapZ` at the moment of drawing.
 *
 * ## Two kinds, and the second one exists to make the jump cost something
 *
 * A **beetle** runs on the road: its band starts at zero, so it is dodged sideways or jumped.
 * A **bee** flies: its band starts *above* a standing snail, so it is run under on the ground and
 * **hit by jumping into it.**
 *
 * That second one is the class this game deleted. `OBSTACLE_BANDS` carries the argument at length —
 * `overhead` was `[362, 560]`, it was the only thing that punished being airborne, and losing it
 * means "a jump taken when none was needed is free". **What killed it was that it could not be
 * drawn**: the sprite's canvas IS the collision band, so a band starting 362 units up draws floating
 * with nothing beneath it, and legs are unavailable because the player passes underneath at every
 * `offsetX`. A fallen log, a banded boom arm and a hazard board were each reported as "a thing
 * hanging in the air".
 *
 * **A bee is the object that answers that, and it is the only one.** A flying creature is *supposed*
 * to hang in the air; the floating that was a bug for a log is the whole read for a bee. It also
 * gets the cue the log could never have: a shadow on the road underneath it, which is this game's
 * one mark meaning "something is above this spot".
 *
 * ## They run in a straight line, and that is a fairness decision rather than a shortcut
 *
 * `offsetX` is set when a critter is made and is never written again — `stepCritters` takes no
 * steering, no target and no player lane, which `verify:critters` asserts structurally rather than
 * by watching a number. A hazard that *chases* cannot be answered by moving, only by out-timing it,
 * so the player learns to ignore where it is and jump on reflex; one that holds its line can be read
 * at range and gone round, which is the same decision every obstacle row asks for and most of why
 * the road is legible at all.
 */
import { createRng } from '../race/rng'
import { DRAW_DISTANCE, ROAD_WIDTH, SEGMENT_LENGTH } from '../road/constants'
import { hits, type Body } from './obstacles'
import {
  JUMP_APEX,
  OBSTACLE_DEPTH,
  PLAYER_BODY_H,
  PLAYER_HALF_WIDTHS,
  REACTION_MS,
  ROAD_EDGE,
  SPEED_BASE,
} from './constants'

/**
 * How fast a bug runs at you, in world units per second.
 *
 * **Set against the road's own scroll rather than picked.** What has to read from a distance is
 * that this one object is not merely arriving like the scenery — it is *coming*. At 35% of the
 * speed a run starts at, a critter closes 35% faster than the ground does at the beginning of a run
 * and 16% faster at the cap: a difference the eye catches without the bug becoming the fastest
 * thing in the frame.
 *
 * The other end is bounded by the reaction budget, and cheaply: the closing speed is
 * `runSpeed + this`, so at `MAX_ATTAINABLE_SPEED` it adds a tenth to how fast the road arrives. A
 * critter therefore cannot eat the warning every obstacle row in the game is spaced against — see
 * `critterWarningMs`, which measures what it actually leaves.
 */
export const BEETLE_SPEED = SPEED_BASE * 0.35

/**
 * How much of a jump still clears a bug, as a fraction of the flight.
 *
 * **This is the constant the height is solved FROM, and the arithmetic is exact.** The flight is a
 * symmetric parabola, `y(t) = 4 * JUMP_APEX * t * (1 - t)` over `t` in `0..1`, so `y > h` between
 * the roots of `4 * apex * t(1 - t) = h` — and the distance between those roots comes out as
 * **`sqrt(1 - h / apex)`**, with the flight's own duration cancelling entirely. Inverted, the
 * height a given window buys is `apex * (1 - window^2)`.
 *
 * So the question "how tall may a bug be" has one honest answer and it is a decision about *timing
 * tolerance*, not about size. 0.45 of a flight is 315ms of window against a human timing precision
 * nearer 60ms, and against a bug the player has been watching approach for between nine and
 * twenty-seven seconds — the jump is planned long before it is taken, and this is only how much
 * slack there is in landing it.
 *
 * **⚠ THIS IS THE CEILING ON HOW TALL A BUG CAN EVER BE, and it is arithmetic rather than taste.**
 * Asked twice to make the bugs bigger, this is the number that stopped giving: below about 0.45 a
 * jump is no longer a window to aim at but an instant to hit, and the one guarantee the whole
 * feature rests on — that a jump always answers a bug — is what goes. Growth past here has to come
 * out of the width, and the width is why a bug is now the flattest thing on the road.
 */
export const CRITTER_JUMP_WINDOW = 0.45

/**
 * How much of the drivable road one bug may claim, at most.
 *
 * **The other bound, and the one that decides the width.** A bug's lateral reach is its own
 * half-width *plus the snail's* — a hit is edge meeting edge — so the share of road it takes is
 * `(critterHalfWidths + playerHalfWidths) / ROAD_EDGE`, and solving that backwards is what sets the
 * size rather than a multiplier picked to look right.
 *
 * **⚠ This was 0.5 with a note claiming that past a half a bug could close the road, and that note
 * was wrong twice over.** The jump answers a bug at *any* width, because the band never reaches the
 * apex; and a row that forces a lateral gap is met on the ground, where the bug is dodged instead.
 *
 * **What is actually true is more surprising, and it is measured rather than argued.** Widening a
 * bug barely costs the road at all, because `BEETLE_MAX_OFFSET` shrinks with it — a wider bug
 * cannot run near the verge, so it always straddles the middle and leaves asphalt on both sides.
 * Over a real lap's 48 rows against 21 lanes:
 *
 * ```
 * share   width   ground line survives
 *   40%     901          73%
 *   50%    1251          72%
 *   60%    1601          72%   <- shipped
 *   70%    1951          71%
 *   80%    2301          68%
 * ```
 *
 * So the road share is **not** what bounds the width, and pretending it is would be a made-up
 * constraint. What bounds it is the **aspect**: at 0.6 a bug is already 4.7:1, flatter than any
 * barrier in the game, and this project's own finding is that type reads by aspect before contour.
 * Past here it stops reading as a creature and starts reading as a bar laid across the road.
 */
export const BEETLE_ROAD_SHARE = 0.6

/**
 * How big a bug is, in world units — **solved from those two bounds, not picked.**
 *
 * **⚠ This is the third size it has had, and the first two were both reported.** It shipped at
 * 400 x 200 against a mascot of 500 x 310 and came back as microscopic; it went to the mascot's own
 * 500 x 248 and came back as needing to be two or three times that again. What the second round got
 * wrong is worth keeping: *"comparable to the snail" in world units is not comparable on screen*,
 * because the snail sits at a fixed `PLAYER_Z` and a bug spends nearly all of its visible life
 * between 50 and 300 segments out, where the same object draws three to thirty times smaller. A
 * hazard has to read while it is approaching, not at the instant it arrives.
 *
 * So the size is whatever the two bounds allow, which is now **1601 x 343 — three and a fifth times
 * the mascot across and slightly taller than it.** Neither number is a taste decision: shrink
 * a bound and the bug shrinks with it, raise one and the thing it names is what gives way. The
 * height is at its ceiling and cannot go further at all; see `CRITTER_JUMP_WINDOW`.
 *
 * **⚠ That makes it the flattest thing on the road at 4.7:1**, against `low` at 3.0:1 and `blocking`
 * at 1.1:1 — and type reads by aspect before it reads by contour, so a bug is no longer told apart
 * from the barrier family by *being small*. What tells it apart is what always did the work: it is
 * the darkest thing on the road (57 lightness against 134 and 120), it has legs and two pale eyes,
 * and it is the only object in the frame moving against the road rather than with it.
 */
export const BEETLE_HALF_WIDTHS = ROAD_EDGE * BEETLE_ROAD_SHARE - PLAYER_HALF_WIDTHS
export const BEETLE_WIDTH = BEETLE_HALF_WIDTHS * 2 * ROAD_WIDTH
export const BEETLE_HEIGHT = JUMP_APEX * (1 - CRITTER_JUMP_WINDOW ** 2)

/**
 * The height band a bug occupies, in world units.
 *
 * **The one number that makes a critter always survivable is `yHigh < JUMP_APEX`,** and it is not a
 * comfort margin — it is the whole safety argument. A jump clears a critter at *every* lane, and
 * jumping costs the player no lateral option (air control is unchanged), so a stretch that was
 * passable without a bug in it is still passable with one. `verify:critters` asserts that from both
 * ends: nothing hits at the apex, and the offsets an obstacle row blocks in the air are the same set
 * with a critter added.
 *
 * **⚠ It is taller than `OBSTACLE_BANDS.low` (343 against 230) and taller than the snail, both of
 * which earlier versions of this file were written to avoid, and neither matters.** What matters is
 * *which* barrier it could be mistaken for: a low block and a bug are answered by the same action,
 * so confusing them costs nothing — and the bug being the taller of the two means a jump that clears
 * a bug clears a block, never the reverse. The confusion that would cost a life is with `blocking`,
 * which cannot be jumped at all, and 343 against 620 is not one anybody makes. Being taller than the
 * mascot costs nothing either: the snail's separation was never carried by height, it is carried by
 * being the only saturated thing in the frame.
 */
export const BEETLE_BAND = { yLow: 0, yHigh: BEETLE_HEIGHT } as const

/**
 * How deep along the track a bug is, in world units.
 *
 * `OBSTACLE_DEPTH` rather than a number of its own: the crossing is the same event, and at the
 * closing speed it lasts 48ms at the cap and 32ms in a Fever — two or three frames — which is why
 * the resolve below keeps testing for the whole of it instead of once at the near edge. That is the
 * defect `resolveObstacles` documents, arriving here from a faster direction.
 */
export const CRITTER_DEPTH = OBSTACLE_DEPTH

/**
 * How far ahead of the player a bug is made, in world units.
 *
 * **Exactly the draw distance, so nothing is ever seen appearing.** A critter is born on the last
 * segment the frame draws, where `billboardAppear` is still fading everything in, and walks forward
 * out of the haze. Spawning any nearer would put a creature into existence in front of a player who
 * was looking at that piece of road a moment earlier — the same complaint `lapLayout.ts` exists to
 * answer, arriving from the one system with no lap to hand over.
 */
export const CRITTER_SPAWN_AHEAD_Z = DRAW_DISTANCE * SEGMENT_LENGTH

/** How far behind the player a bug is retired, in world units. Four segments is off the frame. */
export const CRITTER_DESPAWN_BEHIND_Z = SEGMENT_LENGTH * 4

/**
 * How much road the run covers between one bug and the next, in world units.
 *
 * **Stated as a distance, never as an interval in seconds** — the rule the slime trail, the glide
 * cycle and the whole difficulty curve are already under. A time-spaced population thins out exactly
 * when the run gets fast, so the road would grow *emptier* the better the player was doing.
 *
 * **⚠ It was 60 to 130 segments and was reported as too rare.** That spacing put one bug every 3.3
 * to 7.2 seconds at `SPEED_CAP`, and it was chosen on the reasoning that "meeting one is an event" —
 * which is the right shape for a *boss* and the wrong one for the only thing on this road that
 * moves. A hazard the player meets twice a minute is one they never learn to read.
 *
 * 26 to 62 segments is **one every 1.5 to 3.4 seconds at the cap**, so a bug is a condition of the
 * road rather than an interruption of it. Measured over five-minute runs it leaves seven or eight
 * alive at a time, which is what `MAX_CRITTERS` is sized against.
 */
export const CRITTER_GAP_Z = { min: SEGMENT_LENGTH * 26, max: SEGMENT_LENGTH * 62 } as const

/**
 * How much road a run gets before the first bug, in world units.
 *
 * The obstacle placer leaves the first 30 segments of a lap clear for the same reason: a player
 * dropped straight into a hazard has been given a reaction test rather than a game. A bug takes
 * longer to learn than a rock, so it is longer — and it matters more now that they arrive twice as
 * often, because the first one is no longer a lone event the player can study.
 */
export const CRITTER_FIRST_Z = SEGMENT_LENGTH * 120

/**
 * The most bugs alive at once.
 *
 * Measured at every speed a run reaches, the field peaks at eight; fourteen is headroom rather than a
 * target, so the population cannot grow without bound if a frame is pathologically long. Kept under
 * twice the measured peak, which is the rule `PICKUP_POOL_SIZE` states from the other side: a pool
 * far past its demand is a number nobody has to justify. **The cap
 * skips a spawn, it does not defer one** — see `stepCritters`, where the schedule advances either
 * way, because a deferred spawn arrives as a burst the moment a slot frees up.
 */
export const MAX_CRITTERS = 14

/** The furthest from the centreline a bug may run, so the whole of it is on the road. */
export const BEETLE_MAX_OFFSET = ROAD_EDGE - BEETLE_HALF_WIDTHS


/* ------------------------------------------------------------------ *
 * The bee: the kind that punishes being airborne
 * ------------------------------------------------------------------ */

/**
 * How much daylight there is under a bee, as a fraction of the snail's own height.
 *
 * **The one number that makes a bee survivable, and it is the deleted `overhead` class's own.**
 * That band was `[362, 560]` against a body of 261 — 39% of a body height of clearance — and the
 * ratio is what a grounded snail passes under with room the player can see. Below it the daylight
 * closes and the object reads as something you should have dodged; the class is only legible at all
 * because the gap under it is drawn.
 */
export const BEE_CLEARANCE = 0.39

/**
 * The height band a bee occupies, in world units.
 *
 * **The rule is the mirror of the beetle's, and it is what makes the two one mechanic rather than
 * two:** a beetle's band reaches from the road to under the apex, so a jump clears it; a bee's
 * starts above a standing snail and reaches past the apex, so a jump *finds* it. Neither is a flag —
 * `hits` is the same interval overlap for both, and which behaviour a kind has falls out of where
 * its numbers sit against `PLAYER_BODY_H` and `JUMP_APEX`.
 *
 * Delivered `[431, 741]`:
 *
 * - a grounded snail is `[0, 310]` and **never touches it**, with 121 units of drawn daylight;
 * - at the apex the snail is `[430, 740]` and **is inside it**;
 * - the share of a jump spent inside it is `sqrt(1 - (yLow - PLAYER_BODY_H) / JUMP_APEX)` — the same
 *   closed form the beetle's height was solved from, read the other way round — which is **85% of
 *   the flight.** Jumping into a bee's lane is not a risk, it is a mistake.
 */
export const BEE_HEIGHT = PLAYER_BODY_H
export const BEE_BAND = {
  yLow: PLAYER_BODY_H * (1 + BEE_CLEARANCE),
  yHigh: PLAYER_BODY_H * (1 + BEE_CLEARANCE) + BEE_HEIGHT,
} as const

/**
 * How much of the road a bee may claim.
 *
 * **⚠ This is the bee's whole safety argument and it is a much harder bound than the beetle's.** A
 * beetle is answered by the jump; a bee is what the jump runs into, so when the player is *forced*
 * into the air there has to be a lane free of it.
 *
 * That is provable rather than hopeful, and the measurement is what makes it so: the only thing that
 * forces a jump is a row with no ground line, every one of those is a wall built by `drawWall` out
 * of `low` blocks, and a `low` block reaches 230 against an apex of 430 — **so it obstructs nothing
 * at the apex.** Measured over 598 rows of the real placer across ten laps: **168 are jump-only, 0
 * of them contain a `blocking` obstacle, and the air is 100% clear on every one.** A bee narrower
 * than the road therefore always leaves a lane, and `verify:critters` asserts both halves — the
 * clearance and the fact that no jump-only row carries a `blocking` obstacle, which is the premise
 * that would have to fail first.
 *
 * 0.35 rather than the beetle's 0.6, so the margin is wide rather than exact.
 */
export const BEE_ROAD_SHARE = 0.35

/**
 * How fast a bee flies at you, in world units per second.
 *
 * Half again the beetle's walk. **The difference is a read, not a stat**: two hazards that close at
 * the same rate are told apart only by their pictures, and the one that is about to cost the player
 * a jump should be the one arriving faster.
 */
export const BEE_SPEED = BEETLE_SPEED * 1.6

export type CritterKind = 'beetle' | 'ladybird' | 'spider' | 'frog' | 'bee' | 'wasp'

export interface CritterSpec {
  band: { yLow: number; yHigh: number }
  halfWidths: number
  speed: number
  /** How far from the centreline it may run, so the whole of it stays on the road. */
  maxOffset: number
  /** Relative frequency. The kinds that punish a jump are the rarer ones. */
  weight: number
  /** Whether its band leaves the road, i.e. whether it throws a mark on it. */
  flying: boolean
}

/**
 * A kind whose width comes from its MODEL's own proportion rather than from the road.
 *
 * **⚠ This is the inversion the bought models forced, and it is the whole reason there is more than
 * one creature here.** The beetle's box was *solved* — half the road across, the jump's ceiling tall
 * — and its 4.67:1 is a consequence nothing in nature has, which is why no model fits it and it has
 * to be geometry. Every other kind is the other way round: **the game picks the height, from the
 * rule that kind lives under, and the model's own aspect decides the width.**
 *
 * So a new creature is a download plus one number, and the two rules still hold by construction: a
 * ground kind's band starts at zero and ends under `JUMP_APEX`, a flying kind's starts above a
 * standing snail — and `verify:critters` asserts both over every kind rather than over two names.
 */
function fromModel(aspect: number, height: number, flying: boolean): Pick<CritterSpec, 'band' | 'halfWidths' | 'maxOffset'> {
  const yLow = flying ? BEE_BAND.yLow : 0
  const halfWidths = (height * aspect) / (2 * ROAD_WIDTH)

  return { band: { yLow, yHigh: yLow + height }, halfWidths, maxOffset: ROAD_EDGE - halfWidths }
}

/**
 * The tallest a kind that must be jumpable may be.
 *
 * The beetle's own height, and for the beetle's own reason: `CRITTER_JUMP_WINDOW` of a flight has to
 * still clear it. A ground kind may be shorter; none may be taller.
 */
export const GROUND_MAX_HEIGHT = BEETLE_HEIGHT

/**
 * Everything that differs between the kinds, in one table.
 *
 * **Nothing branches on the kind outside this object.** `hits` is handed a band; `stepCritters` reads
 * a speed; the pool reads a texture key and whether to draw a shadow. A kind is a name for a row
 * here, exactly as `ObstacleKind` is a name for a row in `OBSTACLE_BANDS` — the behaviours a player
 * will name are consequences of the numbers, not of a flag.
 *
 * **The aspects are the models' own**, measured by `poly_survey.py` and delivered by
 * `critter_render.py`; see `ART-SOURCES.md` for which model each is and under what licence.
 */
export const CRITTER_KINDS: Record<CritterKind, CritterSpec> = {
  // Geometry, not a model: 4.67:1 is not a proportion any creature has. The big one.
  beetle: {
    band: BEETLE_BAND,
    halfWidths: BEETLE_HALF_WIDTHS,
    speed: BEETLE_SPEED,
    maxOffset: BEETLE_MAX_OFFSET,
    weight: 3,
    flying: false,
  },
  // A ladybird trundles: the slowest thing on the road, and the most common of the models.
  ladybird: { ...fromModel(2.64, 260, false), speed: BEETLE_SPEED * 0.85, weight: 2, flying: false },
  // A spider scuttles — wide, because its legs are, and the quickest of the ground kinds.
  spider: { ...fromModel(3.05, 300, false), speed: BEETLE_SPEED * 1.4, weight: 2, flying: false },
  // A frog is the chunkiest ground kind: full height, and it comes at you in a straight line.
  frog: { ...fromModel(2.33, GROUND_MAX_HEIGHT, false), speed: BEETLE_SPEED * 1.1, weight: 2, flying: false },
  bee: { ...fromModel(2.28, BEE_HEIGHT, true), speed: BEE_SPEED, weight: 2, flying: true },
  // A wasp is the fastest thing in the frame — the sharpest version of "do not jump".
  //
  // **⚠ Its height is its own rather than the bee's, and the contact sheet is why.** At 0.96:1 a
  // wasp is nearly as tall as it is wide, so sharing the bee's 310 made it **298 units across — the
  // smallest thing on the road, 29px on a phone** — and the kind that costs a jump cannot be the one
  // hardest to see. Nothing bounds a flyer's height from above (its band's top is over the player's
  // head at every jump), so the height is what gives, and the width follows the model as always.
  wasp: { ...fromModel(0.96, BEE_HEIGHT * 1.8, true), speed: BEE_SPEED * 1.12, weight: 1, flying: true },
}

export const CRITTER_KIND_IDS = Object.keys(CRITTER_KINDS) as CritterKind[]

/** Picks a kind by weight, from the field's own seeded generator. */
export function chooseCritterKind(rng: () => number): CritterKind {
  const total = CRITTER_KIND_IDS.reduce((sum, kind) => sum + CRITTER_KINDS[kind].weight, 0)
  let roll = rng() * total

  for (const kind of CRITTER_KIND_IDS) {
    roll -= CRITTER_KINDS[kind].weight
    if (roll <= 0) return kind
  }

  return 'beetle'
}

/**
 * One bug.
 *
 * Carries the same four fields `hits` reads off an obstacle — a lane interval and a height band — so
 * the collision is literally the same function. Nothing about a critter's motion reaches the hit
 * test: at the instant it is asked, a bug is a box, exactly as a boulder is.
 */
export interface Critter {
  id: number
  /** Which of the two it is — **for art and for its own numbers, never for the collision.** */
  readonly kind: CritterKind
  /** Absolute position on the run's odometer, in world units. Falls every tick. See above. */
  z: number
  /** Lane, in half-widths. **Set once and never written again** — that is the straight line. */
  readonly offsetX: number
  halfWidths: number
  yLow: number
  yHigh: number
  /** Where it was born, so its own travel — and with it its leg cycle — is a derived quantity. */
  readonly bornZ: number
  /** Whether it has already been settled against the player. */
  resolved: boolean
}

/** The live population, and the schedule that adds to it. */
export interface CritterField {
  critters: Critter[]
  /** The run distance at which the next bug is made. */
  nextSpawnZ: number
  nextId: number
  rng: () => number
}

/**
 * A field seeded from one number, with the first bug scheduled at `firstZ`.
 *
 * Seeded rather than `Math.random`, so a run stays reproducible from the one number the rest of the
 * scene already draws from — the rule the scenery, the obstacle placer and the formations follow.
 */
export function createCritterField(seed: number, firstZ = CRITTER_FIRST_Z): CritterField {
  return { critters: [], nextSpawnZ: firstZ, nextId: 1, rng: createRng(seed) }
}

/**
 * Advances every bug and makes any the schedule is due.
 *
 * **Nothing is returned and no critter stores where it was.** The resolve below recomputes each
 * one's travel from its own kind and the same delta, so there is no previous-position field that a
 * caller could forget to keep in step — the failure `movePickup` exists to prevent, avoided by not
 * having the state at all.
 *
 * `playerZ` is the player's own absolute position, `run.distance + PLAYER_Z`.
 */
export function stepCritters(field: CritterField, playerZ: number, deltaMs: number): void {
  // **Each by its own speed, so the two kinds cannot be told apart by a shared constant.** A bee
  // flies half again as fast as a beetle walks, and that difference is a read rather than a stat.
  for (const critter of field.critters) critter.z -= critterTravel(critter, deltaMs)

  // Retired from behind, compacted in place: the population is a handful and this runs once a frame.
  let kept = 0

  for (const critter of field.critters) {
    if (critter.z > playerZ - CRITTER_DESPAWN_BEHIND_Z) field.critters[kept++] = critter
  }
  field.critters.length = kept

  while (playerZ >= field.nextSpawnZ) {
    // **The schedule advances whether or not the spawn happens.** Holding a skipped spawn back would
    // deliver it the moment a slot freed up, i.e. as a pair arriving together — the one arrangement
    // of two bugs the player cannot answer by choosing a lane.
    if (field.critters.length < MAX_CRITTERS) {
      const z = field.nextSpawnZ + CRITTER_SPAWN_AHEAD_Z
      // **The kind is rolled before the lane, because the lane depends on it**: a bee is narrower
      // than a beetle and may therefore run closer to the verge.
      const kind = chooseCritterKind(field.rng)
      const spec = CRITTER_KINDS[kind]

      field.critters.push({
        id: field.nextId++,
        kind,
        z,
        offsetX: (field.rng() * 2 - 1) * spec.maxOffset,
        halfWidths: spec.halfWidths,
        yLow: spec.band.yLow,
        yHigh: spec.band.yHigh,
        bornZ: z,
        resolved: false,
      })
    }

    field.nextSpawnZ += CRITTER_GAP_Z.min + field.rng() * (CRITTER_GAP_Z.max - CRITTER_GAP_Z.min)
  }
}

/** How far one critter moves in `deltaMs`, from its own kind's speed. */
export function critterTravel(critter: Pick<Critter, 'kind'>, deltaMs: number): number {
  return (CRITTER_KINDS[critter.kind].speed * deltaMs) / 1000
}

/**
 * Settles every bug the player crossed this frame, and returns the first one that landed on them.
 *
 * **Swept in the gap between the two, not sampled at either end.** The player and the bug close at
 * up to 6340 units a second against a 200-unit crossing, so a 15Hz frame covers twice the whole of it
 * and a point test would find nothing at all — and the frame that does that is the frame a phone
 * drops, i.e. one the player is already unhappy about. The gap `z - playerZ` falls monotonically
 * (the bug walks back, the run walks forward), so the whole test is whether the interval it swept
 * this frame reached the overlap band.
 *
 * **A bug stays live for the whole crossing.** It is settled only once it is fully past, which is
 * the correction `resolveObstacles` records for rocks: three frames of overlap is time enough to
 * slide sideways into something, and being inside it at any point is what the player sees.
 */
export function resolveCritters(
  field: CritterField,
  body: Body,
  playerFrom: number,
  playerTo: number,
  deltaMs: number,
): Critter | null {
  for (const critter of field.critters) {
    if (critter.resolved) continue

    const gapAfter = critter.z - playerTo
    const gapBefore = critter.z + critterTravel(critter, deltaMs) - playerFrom

    // Still ahead at the end of the frame, and the gap only falls: not this frame.
    if (gapAfter > 0) continue

    // Already behind at the *start* of the frame, so nothing was crossed.
    if (gapBefore < -CRITTER_DEPTH) {
      critter.resolved = true
      continue
    }

    if (!hits(body, critter)) continue

    critter.resolved = true

    return critter
  }

  return null
}

/**
 * How long a bug is on the road before it reaches the player, in milliseconds.
 *
 * The warning the player actually gets, and the reason `CRITTER_SPAWN_AHEAD_Z` is the draw distance
 * rather than something nearer: a critter is *drawn* from the moment it exists, so its whole life is
 * warning. `verify:critters` holds this against `REACTION_MS` at every speed the run can reach,
 * including a Fever, which is where the closing speed is highest.
 */
export function critterWarningMs(runSpeed: number, kind: CritterKind = 'beetle'): number {
  return (CRITTER_SPAWN_AHEAD_Z / (runSpeed + CRITTER_KINDS[kind].speed)) * 1000
}

/**
 * Whether a critter of `kind` is cleared by a body at height `y`, in its own lane.
 *
 * **The two kinds answer this in opposite directions and that is the whole design**: a beetle is
 * cleared by going up, a bee by staying down. Neither is a flag — both are the same interval
 * overlap against different numbers.
 */
export function clearedAt(y: number, kind: CritterKind = 'beetle'): boolean {
  const spec = CRITTER_KINDS[kind]

  return !hits({ offsetX: 0, y }, { offsetX: 0, halfWidths: spec.halfWidths, ...spec.band })
}

/** Re-exported so the check reads the floors it compares against from one place. */
export { JUMP_APEX, PLAYER_BODY_H, REACTION_MS }
