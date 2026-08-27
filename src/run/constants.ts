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
 * The mascot's own proportion, measured off the shipped render.
 *
 * `snail-0.png` is 224x139. **This is an external fact, not a choice**, and it is what the drawn box
 * has to be — a box of a different shape stretches the sprite into it, which is the "flat snail" a
 * player reported after a round widened the box and left the height alone.
 */
export const MASCOT_ASPECT = 224 / 139


/**
 * How tall the snail's body is, in world units — the band `[y, y + PLAYER_BODY_H]` that `hits`
 * tests against, and the drawn height `PlayerView` uses.
 *
 * **⚠ Raised from 180 with `PLAYER_HALF_WIDTHS`, and the round that raised only the width was
 * wrong.** Widening the box without the height left a drawn footprint of 420x180 — **2.33:1 against
 * the art's 1.61:1, a 45% horizontal stretch** — and it was reported immediately as the snail
 * looking flat. The drawn box IS the collision box here, so the two axes are not independent: the
 * mascot can only get bigger by getting bigger in both, which means moving the band a grounded
 * snail has to pass under.
 *
 * 261 is `PLAYER_WIDTH / 1.61`, i.e. the art's own proportion. `OBSTACLE_BANDS.overhead.yLow` moved
 * with it to keep the same 39% of a body height of daylight underneath, and `verify:jump` holds the
 * three-class inequalities that fall out — a grounded snail clears an overhead, an airborne one
 * does not, and neither of those is a flag anywhere.
 */
export const PLAYER_BODY_H = 261

/**
 * The snail's drawn footprint in world units, **solved from the height and the art's proportion.**
 *
 * Derived rather than chosen so the two can never disagree: a stretched sprite is not a thing that
 * can be typed here any more.
 */
export const PLAYER_WIDTH = PLAYER_BODY_H * MASCOT_ASPECT

/**
 * Half the snail's width, in road half-widths — **derived from the drawn width, not the other way
 * round.**
 *
 * The rule is unchanged and only its direction moved: the collision width and the drawn width are
 * the same number, enforced rather than remembered. What changed is which of them is typed. The
 * first version of this let the texture's own pixel size decide how wide the snail looked (via
 * `SPRITE_SCALE`) and the two promptly disagreed by a factor of two and a half: a snail 720 units
 * wide on screen and 180 tall by the collision model, i.e. a pancake that got hit by things it
 * visibly cleared. The second version typed the half-width and left the height, which stretched the
 * sprite the other way. Solving both from one height and one measured aspect ends the argument.
 *
 * At 0.075 the snail is about a thirteenth of the road, so a row of three obstacles still leaves
 * lanes, which is what keeps an obstacle a choice rather than a reflex test.
 */
export const PLAYER_HALF_WIDTHS = PLAYER_WIDTH / (2 * ROAD_WIDTH)


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
 * Fever: how much faster it goes, how long it lasts, and how long it takes to land.
 *
 * A multiplier on the *cap* rather than an impulse on the speed, so a Fever entered at a standstill
 * — just after a hit, which is when the gauge is most likely to fill — is worth the same as one
 * entered at full tilt.
 *
 * **`FEVER_SPEED_FACTOR` is 1.6 because that is what the boost pickup it replaces was**, and every
 * row of obstacles in the game is spaced against `MAX_ATTAINABLE_SPEED` below. Raising it would
 * tighten the reaction budget on every stretch at once, which is a difficulty change wearing a
 * feature's clothes; if it is ever raised, `verify:obstacles` is what has to be re-run, not this
 * comment.
 *
 * **`FEVER_EASE_MS` is a full second, and it is a safety device rather than a flourish.** The guard
 * stays up through it (`feverInvulnerable`), so this is the time the run has to shed 60% of its
 * speed *before* the player can be hit again. Shortening it shortens exactly that.
 */
export const FEVER_SPEED_FACTOR = 1.6
export const FEVER_MS = 6000
export const FEVER_EASE_MS = 1000

/**
 * How much of the landing is spent at the ordinary ceiling before the guard comes off.
 *
 * **⚠ Not padding — a first-order lag arrives at the end of a ramp still above it, and the amount
 * is arithmetic rather than a rounding error.** The speed follows the ceiling with a time constant
 * of `1 / FEVER_SPEED_ACCEL`, so tracking a ramp that sheds 2160 u/s over a second leaves a steady
 * error of `tau * slope` = 360 u/s. Measured: with the ramp running the whole ease, the guard came
 * off at **3958 u/s against a 3600 u/s ceiling** — 10% over, which is the exact defect the ordering
 * exists to prevent, arriving through the back door.
 *
 * So the ramp finishes early and the rest of the landing is spent at factor 1, with the guard still
 * up, letting the lag decay. 400ms is 2.4 time constants, which takes the residual to under 1%.
 * `verify:fever` asserts the number that matters — the speed at the drop — rather than this one, so
 * re-tuning `FEVER_SPEED_ACCEL` cannot silently reintroduce it.
 */
export const FEVER_SETTLE_MS = 400

/**
 * The longest the guard may wait for the road to open after the ease, in milliseconds.
 *
 * **A ceiling, not a duration.** The hold ends the moment the nearest obstacle is more than
 * `REACTION_MS` away, which on the placer's own row spacing is almost always immediate — the floor
 * it lays rows against *is* `REACTION_MS`. This exists so that a stretch that somehow never offers a
 * gap cannot keep the player invulnerable, and it is longer than the tightest row spacing the
 * difficulty curve can produce so it is the road that ends the Fever rather than the clock.
 */
export const FEVER_HOLD_MAX_MS = 1400

/**
 * How much more than `REACTION_MS` of road the Fever guard waits for before dropping.
 *
 * **⚠ At exactly 1 the shipped arrangement measured 455ms against a 450ms floor** — one percent of
 * margin, which a single tick of granularity can eat: the guard drops on the tick the gap first
 * clears, and the run travels a little further before the next obstacle is measured. A floor that a
 * rounding can dip below is not a floor, which is the same lesson the row placer's own jitter
 * taught. 1.15 costs a fraction of a second of Fever and buys back the margin.
 */
export const FEVER_CLEAR_MARGIN = 1.15

/**
 * How many segments ahead the Fever hold looks for the nearest obstacle.
 *
 * The reaction distance at the ordinary ceiling is 8 segments; 40 is five times that, so the scan
 * is never the thing that decides the road is clear. It stops at the first obstacle it finds, so on
 * a busy stretch it costs one segment and on an empty one it costs forty.
 */
export const NEAREST_OBSTACLE_SCAN = 40

/**
 * How much bigger a small readable object is drawn on a narrow frame, given the frame's width.
 *
 * **⚠ This is allowed for pickups and forbidden for everything else, and the difference is the
 * rule.** A pickup's collection box is deliberately twice its icon — the one place in this game
 * where the box and the sprite may disagree, and only ever in the generous direction — so growing
 * the icon *toward* the box costs nothing and takes it back nowhere. An obstacle or the snail has
 * no such slack: their drawn size IS their box, and scaling one without the other is the pancake
 * bug `PLAYER_WIDTH` documents.
 *
 * Below the reference width everything on the road shrinks in proportion to the frame, because the
 * projection scales by width; at 390 pixels a pickup came out at **26px**. At the ceiling it is
 * 49px, which is under the 640-unit catchment it has to stay inside.
 */
export const READABLE_REFERENCE_WIDTH = 1280
export const READABLE_MAX_SCALE = 1.9

export function readableScale(screenWidth: number): number {
  if (!(screenWidth > 0)) return 1

  return Math.max(1, Math.min(READABLE_MAX_SCALE, READABLE_REFERENCE_WIDTH / screenWidth))
}

/**
 * How the speed tracks the Fever ceiling, as a fraction of the remaining gap closed per second.
 *
 * **Not `SPEED_ACCEL`, and that is the point.** The ordinary chase has a 5.9-second time constant,
 * which is right for a run settling into its top speed and useless for a one-second landing: over
 * `FEVER_EASE_MS` it would close a sixth of the gap, and the guard would come off with the run
 * still at Fever speed — the death the whole exit ordering exists to prevent. At 6 the time
 * constant is 167ms, so the speed sits on the ramp rather than lagging behind it.
 */
export const FEVER_SPEED_ACCEL = 6

/**
 * How many fruit fill the gauge.
 *
 * Pickups are laid every `PICKUP_SPACING_Z` and `fruit` is 5 of the table's 15 weight, so a fruit
 * arrives about every 3 pickups — eight of them is a couple of minutes of ordinary play and rather
 * less of good play, because the ones that are worth going for are the ones out near the verge.
 */
export const FEVER_FRUIT_TARGET = 8

/**
 * How far ahead the Fever magnet reaches, in world units.
 *
 * Eight segments: far enough that a pickup visibly leaves its lane and comes to the snail — which
 * is the whole read, since a magnet that only collects is indistinguishable from a wider box — and
 * short enough that it does not sweep the entire visible road, which would remove the steering
 * from the reward.
 */
export const FEVER_MAGNET_Z = SEGMENT_LENGTH * 8

/**
 * How fast a magnetised pickup crosses to the snail's line, as a fraction of the gap per second.
 *
 * **⚠ Set against the time the pickup actually has, which is much less than it looks.** The window
 * is 1600 units and Fever speed is 5760 u/s, so a pickup spends **0.28 seconds** inside it — and
 * the pull is weighted by how close it is, so the effective rate is about half of this. At 5 a
 * pickup from the far verge arrived **0.59 half-widths off the line**, i.e. it visibly leaned
 * toward the snail and was then missed, which is worse than no magnet: it looks like the pickup
 * tried and the game refused it. At 20 the same crossing lands within 0.07.
 */
export const FEVER_MAGNET_RATE = 20

/**
 * What a hit costs, in world units per second.
 *
 * **A hit is a speed loss, not a death**, which is what makes speed the game's actual resource:
 * the punishment is measured in the same unit as the reward. Three hits end the run
 * (`RUN_LIVES`), so the ceiling on carelessness is still hard.
 */
export const HIT_SPEED_LOSS = MAX_SPEED * 0.1
export const RUN_LIVES = 3

/**
 * What each pickup adds to the score, on top of the metre-per-metre the distance itself gives.
 *
 * **Priced by what it costs to take, not by what it does.** A coin is on the verge and costs a lane
 * change; a fruit is the same trip and is also progress toward a Fever, so it is worth the same in
 * points and more in consequence; a shield is the rarest thing on the road and is worth more than
 * either. What none of them is worth is enough to make collecting beat surviving — a full lap of
 * perfect collection is a few hundred points against the thousands a long run banks in distance.
 */
export const SCORE_PER_COIN = 10
export const SCORE_PER_FRUIT = 10
export const SCORE_PER_SHIELD = 25

/**
 * The fastest the game can ever go, in world units per second.
 *
 * **`SPEED_CAP` is not that number**: Fever multiplies the ceiling, so the real top speed is 5760.
 * Anything that has to hold at every speed — the obstacle placer's row spacing, the jump's flight
 * window, the grace period below — is solved against this rather than against the plain cap.
 */
export const MAX_ATTAINABLE_SPEED = SPEED_CAP * FEVER_SPEED_FACTOR


/* ------------------------------------------------------------------ *
 * The jump
 * ------------------------------------------------------------------ */

/**
 * How long the snail is off the ground, in milliseconds. **Assigned first; everything else about
 * the jump is solved from it.**
 *
 * 700ms covers 5.1 segments at `SPEED_BASE` and 12.3 at `SPEED_CAP`. That asymmetry is deliberate
 * and is the difficulty curve: the *window* in which a jump saves you is roughly the whole
 * flight, so the thing that gets hard at speed is not the jump, it is reading the obstacle in
 * time to start it. See `REACTION_MS`.
 *
 * **Raised from 620 with `JUMP_APEX`, and raising it was not optional.** The arc is solved rather
 * than tuned — `JUMP_GRAVITY = 8h/T^2` — so lifting the apex from 320 to 430 at a fixed air time
 * would have raised gravity by 34% and delivered the extra height as a snap rather than as a
 * bigger jump. Taking the time up with it keeps gravity within 6% of what it was, which is what
 * makes the higher jump feel like the same jump.
 *
 * It lengthens `FLIGHT_LENGTH_Z` by the same 13%, and `provePassable` reads that directly — a
 * jump-only row commits the snail to the air for the whole flight, so everything inside it has to
 * be clearable from the air too. That check does the accounting; nothing here has to.
 */
export const JUMP_AIR_MS = 700

/**
 * Apex height above the road, in world units.
 *
 * **⚠ THIS NUMBER CANNOT MOVE ON ITS OWN.** The whole three-class obstacle model is an assertion
 * about where the apex sits relative to `OBSTACLE_BANDS`, and `verify:obstacles` states it as a
 * table: `low` is cleared at the apex, `blocking` is not, `overhead` is hit only at the apex. In
 * inequalities, with `A` the apex:
 *
 *     low.yHigh  <  A  <  blocking.yHigh          and    overhead.yLow  >  PLAYER_BODY_H
 *     A + PLAYER_BODY_H  >  overhead.yLow          and    A  <  overhead.yHigh
 *
 * Raised from 320 to 430 because a snail that barely clears a barrel does not read as jumping.
 * Every band moved with it — see `OBSTACLE_BANDS` — so the inequalities hold with the same margins
 * they had before rather than by a hair.
 */
export const JUMP_APEX = 430

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
  low: { yLow: 0, yHigh: 230 },
  blocking: { yLow: 0, yHigh: 620 },
  // **⚠ [250, 560], down from [330, 900], because it read as a FLYING OBJECT rather than as a
  // barrier to duck under.** Two things were wrong at once and both are about size rather than
  // about the class:
  //
  //   the band was 570 UNITS TALL   and the sprite is scaled to fill it, so a log was drawn taller
  //                                 than the tallest obstacle in the game and twice the snail's
  //                                 body. At that size nothing reads as a log; it reads as a wall
  //                                 hanging in the sky.
  //   `yLow` was 330                which is 150 units of daylight under it — 83% of the snail's
  //                                 own height. Clear, and so clear that the thing had no visible
  //                                 relationship to the road at all.
  //
  // 250 leaves 70 units of headroom, 39% of the snail — comfortably past the 30% floor
  // `verify:jump` holds, and low enough that the gap reads as a gap to go through. The arithmetic
  // the three classes rest on is untouched: a grounded snail is [0, 180] and still clears it, an
  // airborne one is [430, 610] and still meets it.
  // **⚠ 362, up from 250 with `PLAYER_BODY_H`.** The number that matters is not this one but the
  // gap under it: a grounded snail is `[0, PLAYER_BODY_H]` and has to pass beneath, and what reads
  // as a gap is that clearance measured against the snail's own height. It was 70 units under a
  // 180-tall body (39%); it is 101 under a 261-tall one, which is the same 39%.
  overhead: { yLow: 362, yHigh: 560 },
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

/**
 * How far the run travels unhittable after a hit, in **world units**.
 *
 * **⚠ This was 900 milliseconds, and a duration is the wrong unit for it.** The road is laid out in
 * distance — rows sit at least `REACTION_MS` apart *at the top speed* — so a fixed number of
 * seconds covers a different number of rows depending on how fast the run happens to be going.
 * Measured against the shipped placer:
 *
 * ```
 * speed          travelled in 900ms   rows skipped
 * SPEED_BASE            6.5 segments          0.50
 * SPEED_CAP            16.2 segments          1.25   <- the next row passes through you
 * boosted              25.9 segments          2.00   <- two of them do
 * ```
 *
 * So after any hit at speed the next row or two were ghosts, which is exactly what "some obstacles
 * do not deal damage" looks like from the outside — and with no visual telling the player they were
 * invulnerable, it reads as a broken hitbox rather than as mercy.
 *
 * As a distance it is speed-independent by construction, and **55% of the tightest row gap** means
 * it always ends before the next row arrives, at every speed the game can reach.
 * `verify:obstacles` asserts that against the placer's own floor so the two cannot drift apart.
 *
 * What it is for is the rest of the row you just hit — a wall is eight rocks, and being charged
 * eight times for one mistake is not a difficulty setting.
 */
export const HIT_INVULNERABLE_Z = (REACTION_MS / 1000) * MAX_ATTAINABLE_SPEED * 0.55

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

/**
 * Where the air sits, in front of the whole world.
 *
 * **The only flat depth left.** Everything that stands *in* the world — scenery, obstacles,
 * pickups, the snail — sorts by distance through `worldDepth.ts`; motes hanging between the camera
 * and all of it are the one thing that is genuinely in front of everything, so they get a number
 * rather than a distance. The four flat depths that used to live here (`PLAYER_DEPTH`,
 * `SHADOW_DEPTH`, `OBSTACLE_DEPTH_ORDER`, `PICKUP_DEPTH`) are what let far obstacles paint over
 * near ones; see `worldDepth.ts` for the measurement.
 */
export const ATMOSPHERE_DEPTH = 1000
