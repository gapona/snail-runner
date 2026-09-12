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
 * **⚠ The two axes are not independent, because the drawn box IS the collision box.** Widening one
 * without the other left a footprint of 420x180 — 2.33:1 against the art's 1.61:1 — and was
 * reported at once as the snail looking flat. So this is the ONLY size decision the mascot has:
 * `PLAYER_WIDTH` and `PLAYER_HALF_WIDTHS` are both solved from it, and a stretched sprite is not a
 * thing that can be typed here any more.
 *
 * **⚠ 340, raised from 261, and it is the only lever there is.** Reported on a 375px phone as the
 * mascot being too small. Everything on this road is scaled by the frame's WIDTH — which is what
 * keeps an object the same size relative to the road at every aspect — so a phone is a fifth of a
 * desktop and there is no way to grow the snail *only* there:
 *
 * - a camera zoom cannot: the player's own lane already fills 78% of the frame at every aspect, so
 *   anything past about 1.25x pushes the snail off the edge at full lock;
 * - a viewport-dependent field of view cannot: `PLAYER_Z` is *solved* from `CAMERA_DEPTH`, so the
 *   snail's world position — and with it every collision time, the arc geometry and the slime
 *   trail — would depend on the device;
 * - a viewport-dependent *collision* width cannot: `ROAD_EDGE` would move on a rotation and a lap
 *   would have been proved passable against a half-width the run is no longer using;
 * - and drawing it bigger than its box is the pancake bug in the other direction — the player
 *   clips a rock and takes nothing, which reads as a dropped hit.
 *
 * So the mascot is bigger everywhere — and **this is only half of the size it gained.** The other
 * half is `PLAYER_REST_Y_FRACTION`, which stands the snail nearer the camera and costs nothing at
 * all; between them the mascot went from **34px to 54px** on a 375px frame.
 *
 * **What THIS half costs is lane width, and that is the number to watch rather than the size.**
 * `hits` adds the half-width to the obstacle's own and `ROAD_EDGE` shrinks with it, so a wider snail
 * threads a tighter gap. Measured over 2681 generated rows as the widest gap a row leaves, in units
 * of the snail's own width:
 *
 * ```
 * PLAYER_BODY_H   mean lane gap
 *           261     2.40 snail widths
 *           340     1.65   <- shipped
 *           380     1.39
 *           460     1.01   <- a row leaves exactly one snail of room
 * ```
 *
 * The *difficulty table* — density, the unjumpable share, rows per 90k, the reaction budget — does
 * not move at any of them, because the placer re-proves every row against whatever these numbers
 * are and pays a wider hitbox in rows redrawn rather than in rows nobody can pass. What moves is
 * the precision a dodge needs, which is why the gap is measured rather than the table trusted — and
 * why the size gained since is taken from the row rather than from here.
 */
export const PLAYER_BODY_H = 310

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
 * At 0.136 the snail is about a seventh of the road's full width, so a row of three obstacles
 * still leaves lanes, which is what keeps an obstacle a choice rather than a reflex test — and
 * `provePassable` proves that per row rather than trusting this sentence.
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
 * What share of the road's edge a finger at the edge of the screen must be able to ask for.
 *
 * One of the two bounds on how big the mascot can be drawn — see `PLAYER_REST_Y_FRACTION`.
 *
 * ## ⚠ It was 1.1 and is 0.98, which is the one number in this file that crossed 1
 *
 * At 1.1 a finger at the frame's edge could ask for **1.1 x `ROAD_EDGE`** — past the asphalt and out
 * onto the verge — and that slack was the binding bound on how near the camera the snail could
 * stand, i.e. on how big it is drawn. Reported: the mascot is about 5% of a portrait frame's height
 * and gets lost against the road. Every other lever is closed (`PLAYER_BODY_H` lists them, and
 * `verify:player` measures each), so this was the only one with anything in it, and spending it was
 * the call taken.
 *
 * **What it buys is one quantum, not a proportion, and that is why 0.98 rather than 1.0.** The rest
 * row is snapped to quarter-segments by `PLAYER_SEGMENT_PHASE`, so the bounds only matter through
 * *which quantum they permit*: at 1.10, 1.00 and 0.99 the row lands on the same `PLAYER_Z` of 1650
 * and the mascot is the same 41px on a 320x568 frame. 0.98 is the first value that reaches 1450 —
 * **46px, +13.8%**, and 244px to 278px on a desktop.
 *
 * **What it costs is stated rather than rounded off: the outer 1.3% of the asphalt.** A finger at
 * the very edge of the frame now asks for `offsetX 0.864` against a `ROAD_EDGE` of 0.875, so the
 * last sliver of road cannot be *steered* to. Two things follow, and the first is not optional:
 *
 * - **The passability proof samples what the player can reach**, not what the asphalt measures —
 *   see `REACHABLE_EDGE` and `sampleOffsets`. Without that, `provePassable` could certify a row
 *   whose only gap is in the sliver, i.e. prove a row passable that nobody can pass. Today it is
 *   *more* correct than it was: at 1.1 the samples were conservative by accident.
 * - **The verge is now somewhere you slide, not somewhere you park.** The spring is underdamped by
 *   design (6.6% overshoot), so a hard flick still carries the snail past `ROAD_EDGE` and
 *   `OFFROAD_DRAG` still bites — it is a consequence of overshooting rather than a place to steer
 *   to, which is arguably what a penalty zone should be.
 *
 * Pickups and ramps were checked against the new reach rather than assumed safe: `PICKUP_OFFSET.max`
 * is 0.825 and `RAMP_MAX_OFFSET` 0.545, both comfortably inside 0.864.
 */
export const STEER_REACH_MARGIN = 0.98

/**
 * How far the ground at the player's own row falls below its flat position on the steepest descent
 * the run's circuit contains, as a fraction of frame height.
 *
 * **Measured off `buildRunCircuit`, an external fact rather than a choice** — the same standing as
 * `MASCOT_ASPECT`, and `verify:player` re-measures it against the real track so a re-composed
 * circuit moves it rather than silently invalidating the row solved from it.
 *
 * **It does not depend on `PLAYER_Z`, which is what makes it a usable bound.** The drop is
 * `scale * gradient * PLAYER_Z * height / 2` and `scale` is `CAMERA_DEPTH / PLAYER_Z`, so the
 * distance cancels and what is left is `CAMERA_DEPTH * gradient / 2` — a property of the steepest
 * hill and the field of view, identical wherever the player stands. Standing the snail nearer the
 * camera therefore buys size without changing how far the road drops out from under it, and the
 * only thing that reduces this number is a gentler circuit.
 *
 * The steepest gradient on the shipped lap is **0.209**. It was **0.419** — `ROAD_HILL.MEDIUM` over
 * an `S_ARM`, `addLowRollingHills`'s own crests, and `build()`'s closing section, all reaching the
 * same slope — and at that figure the mascot went out of sight on the steepest crest, which a
 * player reported with a screenshot. `buildRunCircuit` was re-composed for this constant rather
 * than the constant being written down around the circuit; see its docstring.
 *
 * **The bound it feeds is strict: the snail's feet never leave the frame.** A softer rule was tried
 * first — feet allowed a little past the bottom edge, since the mascot is drawn *upward* from them
 * and half a snail is still a snail — and the frame it produced was a sliver of shell along the
 * bottom of the screen, which is the report again in a smaller size. What the player has to be able
 * to do is see the thing they are steering, and there is no fraction of that worth trading.
 */
export const MAX_DESCENT_DROP = 0.088

/**
 * Where the player is drawn down the frame, as a fraction of viewport height.
 *
 * **⚠ Solved from the steering reach, not inherited any more.** It was `5 / 6`, taken unchanged
 * from the rail shooter's `SHIP_REST_Y_FRACTION` — a good row there for reasons about a *ship in a
 * combat frame*, and this file said so while keeping the number. What it is here is the one lever
 * that makes the mascot bigger for free, and the only thing bounding it is a rule nobody had
 * written down:
 *
 * **a finger at the edge of the screen must still be able to ask for the edge of the road.**
 *
 * Everything on this road is scaled by the frame's width, so a snail cannot be grown on a phone
 * alone (see `PLAYER_BODY_H`) — but it *can* be grown by standing it nearer the camera, which is
 * exactly what lowering this row does: `PLAYER_Z` is solved from it, the drawn size goes as
 * `1 / PLAYER_Z`, and **the collision box does not move at all.** No hitbox, no passability, no
 * difficulty: the mascot is simply closer.
 *
 * What stops it is the same arithmetic from the other end. `halfWidthsAtLane` maps the screen to
 * the road at this row, and the nearer the player stands the more of the frame the road fills — so
 * past a point the screen's own edge maps to an `offsetX` **inside** the asphalt and the player can
 * no longer steer to the verge at all. Measured across the range:
 *
 * ```
 * rest    PLAYER_Z   snail at 375px   screen edge maps to offsetX
 * 0.833      1967          44px            1.17
 * 0.883      1554          55px            0.95     <- shipped
 * 0.900      1498          58px            0.89
 * 0.920      1398          62px            0.83     <- inside ROAD_EDGE: the asphalt's own edge
 *                                                      is unreachable by dragging
 * ```
 *
 * **⚠ And a second bound, which the first version missed and a player found in one screenshot: the
 * road falls away on a descent.** The mascot stands `PLAYER_Z` ahead of the camera, so on a
 * downhill the ground it is standing on is *below* the camera's eye line and it is drawn lower —
 * and past a point, off the bottom of the frame. Reported as the snail being almost invisible going
 * down a hill, and it is the row that causes it:
 *
 * ```
 * hills   rest    snail at 375px   worst feet row   fully hidden on
 * old     0.833            44px           100.9%             0.0% of the lap
 * old     0.883            54px           105.9%             3.1%            <- the report
 * new     0.883            54px            93.3%             0.0%            <- shipped
 * ```
 *
 * So the row is the **lower** of the two bounds. What made 0.883 shippable is not a smaller row but
 * a gentler circuit: halving the run's hills took the drop from 17.6% of the frame to 8.8%, which
 * moved the descent bound from 0.824 to 0.912 and handed the binding role back to the steering
 * rule. Both are stated, `verify:player` asserts each against the thing it is about — the projection
 * for one, the real circuit for the other — and each is shown to reject the row past it.
 *
 * **What it costs, stated rather than hidden.** A finger at the screen edge used to be able to ask
 * for `OFFROAD_LIMIT` itself; it now asks for about 10% into the verge instead of all of it. The
 * outermost sliver is still *reached*, by the spring's own overshoot — and it is never *needed*,
 * because `passableLine` only ever scans within `±ROAD_EDGE`, so no layout the placer ships
 * requires leaving the asphalt.
 *
 * **It is an input to `PLAYER_Z`, not a drawing constant.** Nothing positions the player from it;
 * the projection does that, from the world row it implies.
 */
const REST_Y_BOUND = Math.min(
  HORIZON_Y + CAMERA_HEIGHT / (2 * ROAD_WIDTH * ROAD_EDGE * STEER_REACH_MARGIN),
  1 - MAX_DESCENT_DROP,
)

/**
 * How far into its own segment the player must stand, as a fraction of one.
 *
 * **⚠ A third rule, and the only one of the three that is about the painter's order rather than
 * about the picture.** There is no depth buffer here: everything in the world sorts on
 * `worldDepth(distanceIndex, layer)`, where the layer is a sub-segment tiebreak. So an obstacle on
 * the snail's *own* segment — whose near edge is behind the snail, and which therefore has to paint
 * over it — only wins if the snail is further into that segment than the layers are apart:
 * `WORLD_LAYER.player - WORLD_LAYER.obstacle` = 0.1. The mirror bound is a pickup one segment ahead,
 * which must not paint over the snail: that needs `1 - frac > WORLD_LAYER.pickup -
 * WORLD_LAYER.player` = 0.1. So the legal window is `(0.1, 0.9)` and 0.25 sits inside it with room.
 *
 * **It has always been a constraint and was never written down.** At the rail shooter's inherited
 * row the snail stood 9.83 segments out — a fraction of 0.83, inside the window by luck and one
 * tenth from its top edge. Solving the row from the steering and descent rules landed it at
 * **8.077**, i.e. 0.077 into its segment and *outside* the window, and `verify:obstacles` caught it
 * as "an obstacle the snail has passed draws behind it" — which is exactly what it would have been.
 */
const PLAYER_SEGMENT_PHASE = 0.25

/**
 * Where the player is drawn down the frame, as a fraction of viewport height — solved backwards
 * from `PLAYER_Z`, which is the number the three rules actually constrain.
 *
 * See `REST_Y_BOUND` above for the two rules that bound it and `PLAYER_SEGMENT_PHASE` for the one
 * that snaps it. The snap only ever moves the player *further* from the camera, so it cannot break
 * either bound — it spends a little of the size the bounds allow on the depth order being right.
 */
export const PLAYER_REST_Y_FRACTION = HORIZON_Y + (CAMERA_DEPTH * CAMERA_HEIGHT) / (2 * PLAYER_Z_SOLVED())

function PLAYER_Z_SOLVED(): number {
  const bound = CAMERA_DEPTH / ((2 * (REST_Y_BOUND - HORIZON_Y)) / CAMERA_HEIGHT)

  return (
    (Math.ceil(bound / SEGMENT_LENGTH - PLAYER_SEGMENT_PHASE) + PLAYER_SEGMENT_PHASE) * SEGMENT_LENGTH
  )
}

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
export const PLAYER_Z = PLAYER_Z_SOLVED()

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
 * How much of each side of the frame already means full lock, as a fraction of its width.
 *
 * ## ⚠ The road's edge was at the screen's edge, and a finger cannot go there
 *
 * Reported from a phone: the snail cannot be steered to the very edge, and that is where coins and
 * fruit are. Both halves are one number. `halfWidthsAtLane` maps the pointer linearly across the
 * *whole* frame, so `REACHABLE_EDGE` sat at exactly 100% of it and the outermost pickup
 * (`PICKUP_OFFSET.max`, 0.825) at **97.7% — nine pixels from the edge of a 383px screen**. A thumb
 * cannot hold a position nine pixels from the bezel, and on most phones that strip belongs to the
 * system's own edge gestures anyway.
 *
 * **It is an input-ergonomics number, not a geometric one, which is why it is applied here and not
 * inside `halfWidthsAtLane`.** That function is the honest projection — a screen fraction read as
 * half-widths on the player's row — and `STEER_REACH` is still `halfWidthsAtLane(1)`. What changes
 * is only *where on the glass* the ends of that range are asked for: the outer 6% of each side
 * saturates, so full lock arrives at 94% of the frame and the outermost pickup at 92%, i.e. **23px
 * and 31px in** on the same 383px screen.
 *
 * Nothing else moves. `REACHABLE_EDGE` is unchanged, so `provePassable` samples exactly what it
 * sampled, no row is re-proved, and the mascot's size — which is bounded by `PLAYER_Z`, not by this
 * — is untouched. That is the whole reason to fix it here rather than by moving
 * `STEER_REACH_MARGIN` back over 1, which would take the size with it.
 *
 * **6% and not more**: the band is dead travel, and a player who has learned that the left third of
 * the screen means "left" should not find the outer sixth of it doing nothing. `verify:player`
 * prints what it delivers in pixels at every supported frame.
 */
export const STEER_EDGE_MARGIN = 0.06

/**
 * A pointer's position across the frame, read as the `offsetX` it is asking for.
 *
 * `halfWidthsAtLane` with the ends of the travel brought in off the glass — see
 * `STEER_EDGE_MARGIN`. This is what the input path uses; the bare conversion is what geometry uses.
 */
export function steerTarget(screenFraction: number): number {
  const usable = 1 - 2 * STEER_EDGE_MARGIN
  const t = (screenFraction - STEER_EDGE_MARGIN) / usable

  return halfWidthsAtLane(Math.min(1, Math.max(0, t)))
}

/**
 * The furthest `offsetX` a finger at the very edge of the frame can ask for.
 *
 * A *consequence* of where the player stands rather than a constant: it falls out of `PLAYER_Z`,
 * which falls out of the two bounds. Stated so the rest of the game can ask the question rather
 * than each caller re-deriving it from the projection.
 */
export const STEER_REACH = halfWidthsAtLane(1)

/**
 * The furthest `offsetX` the player can actually *be* at, which is the narrower of two facts.
 *
 * **⚠ This is the authority for anything the player has to be able to steer to**, and until
 * `STEER_REACH_MARGIN` crossed 1 it was `ROAD_EDGE` by accident: the reach used to be 1.1x the
 * asphalt, so sampling the asphalt was conservative and nobody had to notice which of the two was
 * the real bound. It is the reach now, and the difference is 1.3% of the road.
 *
 * The one thing that must follow it is the passability proof — a row certified passable at an
 * offset nobody can steer to is a row the game says is fair and is not. Obstacles, critters and
 * scenery are deliberately *not* held to it: a thing to avoid may stand anywhere.
 */
export const REACHABLE_EDGE = Math.min(ROAD_EDGE, STEER_REACH)


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
 * Starting speed, in world units per second — 8.3 segments a second.
 *
 * **A snail is slow, and that is the whole contrast the game is built on.** The low end of what
 * still reads as motion at this field of view; below it the ground stops selling speed at all and
 * the game reads as a scrolling background.
 *
 * **⚠ It was 12% of `MAX_SPEED` and the first seconds of a run read as sluggish rather than as
 * slow**, which is a different thing and not the one the contrast is built on. 13.8% is that 15%
 * faster. What it costs is the *range*: the run climbs 2.17x to `SPEED_CAP` instead of 2.5x, so the
 * ramp is shallower — which is the trade, since the ceiling may not move with it. `SPEED_CAP` is
 * set by the reaction budget and `MAX_ATTAINABLE_SPEED` is what every row of obstacles in the game
 * is spaced against, so raising this end is a feel change and raising that one would be a
 * difficulty change wearing the same clothes.
 *
 * The HUD reads `speed / SPEED_BASE`, so a run still starts at `1.0x` by construction — the number
 * on screen is unchanged and what it counts from is faster.
 */
export const SPEED_BASE = MAX_SPEED * 0.138

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
 * **`FEVER_EASE_MS` is a full second because sixty percent of the run's speed cannot come off in a
 * frame.** It used to be described as a safety device — the window in which the run shed its speed
 * *before* the player could be hit again — and there is no guard to shed it behind any more (see
 * `fever.ts`). What it is now is the plain fact that the ceiling has to come down smoothly, or the
 * frame reads as the run hitting a wall.
 */
export const FEVER_SPEED_FACTOR = 1.6
export const FEVER_MS = 6000
export const FEVER_EASE_MS = 1000

/**
 * How much of the landing is spent at the ordinary ceiling, at the end of the ease.
 *
 * **⚠ Not padding — a first-order lag arrives at the end of a ramp still above it, and the amount
 * is arithmetic rather than a rounding error.** The speed follows the ceiling with a time constant
 * of `1 / FEVER_SPEED_ACCEL`, so tracking a ramp that sheds 2160 u/s over a second leaves a steady
 * error of `tau * slope` = 360 u/s. Measured: with the ramp running the whole ease, the run left
 * Fever at **3958 u/s against a 3600 u/s ceiling** — 10% over.
 *
 * So the ramp finishes early and the rest of the landing is spent at factor 1, letting the lag
 * decay. 400ms is 2.4 time constants, which takes the residual to under 1%.
 *
 * **What that overshoot costs is now sharper than it was, not softer.** It used to end an
 * invulnerability a tenth above the ceiling; with no guard left it hands the player rows that were
 * spaced for a speed they are no longer travelling at. `verify:fever` asserts the speed the run
 * actually leaves at, so re-tuning `FEVER_SPEED_ACCEL` cannot quietly reintroduce it.
 */
export const FEVER_SETTLE_MS = 400

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
 * `readableScale` for the front screen's and the garage's mascot — on a portrait frame only.
 *
 * **⚠ A frame narrower than 1280 is a phone in portrait and a phone in landscape alike, and only one
 * of them is short of width.** The boost exists because everything on the road is sized off the
 * width and a portrait phone has little of it; a phone held sideways has plenty of width and very
 * little height. At the 828x300 a landscape webview leaves, the boost still read 1.55 and drew the
 * menu's snail over half the frame's height and the garage's across the arrows beside it —
 * reported as everything overlapping everything. Sideways, the width-sized mascot is already the
 * right share of the frame.
 */
export function mascotReadableScale(screenWidth: number, screenHeight: number): number {
  return screenHeight >= screenWidth ? readableScale(screenWidth) : 1
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
 * How many shields the player may carry at once.
 *
 * **⚠ There was no cap at all, and `addShield` simply incremented.** The readout that stood for it
 * therefore had to guess a ceiling of its own — five pips and then a `+` — which is a count to read
 * rather than a shape to glance at, i.e. the exact failure the lives are pips to avoid.
 *
 * One, because a shield is *the next mistake is free* and that sentence does not stack. Two shields
 * is a second life bought at a pickup's price, on top of the three the run already grants, and the
 * ceiling on carelessness is the one thing `RUN_LIVES` is for. It also makes the survivability row
 * a fixed four elements at its longest, which is what lets that row be read as a length rather than
 * counted — see `ui/lifeRow.ts`.
 *
 * **A shield the player cannot hold must never be laid on the road**: collecting one that does
 * nothing is worse than there being none, because the player learns the pickup is unreliable rather
 * than that they are full. A pickup the run has no room for is drawn dimmed and left where it is —
 * see `UNAVAILABLE_ALPHA`.
 * See `shieldWithheld` there and the check in `verify:player`.
 */
export const MAX_SHIELDS = 1


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
 * 700ms covers 5.8 segments at `SPEED_BASE` and 12.3 at `SPEED_CAP`. That asymmetry is deliberate
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
 *
 * **Raised again, 700 -> 800, with the apex 430 -> 560, for the same reason and by the same rule.**
 * Gravity comes out at 7000 against 7020, i.e. the same jump taken higher rather than a snappier
 * one — and, the half that matters most, the ramp's own flight is solved through this gravity, so
 * holding it holds the ramp to within a third of a percent.
 */
export const JUMP_AIR_MS = 800

/**
 * Apex height above the road, in world units.
 *
 * **⚠ THIS NUMBER CANNOT MOVE ON ITS OWN.** The whole obstacle model is an assertion
 * about where the apex sits relative to `OBSTACLE_BANDS`, and `verify:obstacles` states it as a
 * table: `low` is cleared at the apex and `blocking` is not. In inequalities, with `A` the apex:
 *
 *     low.yHigh  <  A  <  blocking.yHigh
 *
 * Raised from 320 to 430 because a snail that barely clears a barrel does not read as jumping.
 * Every band moved with it — see `OBSTACLE_BANDS` — so the inequalities hold with the same margins
 * they had before rather than by a hair.
 *
 * **⚠ And raised again, 430 -> 560, off a phone held sideways: the snail should jump higher than
 * it visually does.** Once heights were drawn on the sprite's own scale (`lift.ts`) the apex read
 * as what it is on every frame — 1.39 snail heights — and the thing a player jumps most often, the
 * frog, stands 343 tall: the feet cleared it by 87 units, 0.28 of a body, which is "almost catches"
 * exactly. At 560 the apex is 1.81 heights and the frog is cleared by 0.69 of one. `blocking` is
 * derived from this and grew with it (802 -> 932) so a jump still cannot *draw* clear of the tall
 * barrier; the frog kept its size — see `CRITTER_JUMP_WINDOW`, which widened instead.
 */
export const JUMP_APEX = 560

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
 * **One rule instead of a flag.** Nothing anywhere asks "is this jumpable?" — a hit is the
 * player's `[y, y + PLAYER_BODY_H]` overlapping the obstacle's `[yLow, yHigh]`, and the two rows
 * below simply fall out of that arithmetic against `JUMP_APEX`:
 *
 * | band       | range        | outcome                                             |
 * |------------|--------------|-----------------------------------------------------|
 * | `low`      | `[0, 230]`   | cleared by a jump — the apex puts the foot at 560    |
 * | `blocking` | `[0, 932]`   | **cannot** be jumped; must be gone around           |
 *
 * (932 since the apex went to 560; the history below speaks of 802, which was 430 + 372.)
 *
 * ## ⚠ `blocking` is taller than the snail ever gets, and 620 was not
 *
 * Reported from a phone: the tall barrier *looks* jumpable. It was, in the only sense a picture can
 * be read — **at the apex the snail's own top is at `JUMP_APEX + PLAYER_BODY_H` = 740, and the
 * barrier reached 620**, so the frame at the top of a jump showed the creature a clear 120 units
 * above the thing it had just been stopped by. The collision was right (the *feet* are at 430,
 * inside `[0, 620]`) and the frame said the opposite, which is the same class of defect as a hazard
 * that hits from further away than it looks.
 *
 * So the height is derived rather than chosen: **above the highest the mascot ever reaches**, plus
 * `BLOCKING_HEAD_CLEARANCE` of a body so the gap is legible rather than merely present — the same
 * shape as the daylight the deleted `overhead` class kept under itself. That makes it 2.6 body
 * heights where it was 2.0, and it is now impossible for a jump to *draw* clear of one.
 *
 * **What it costs is the note below, and this overrules it.** The heights were cut once for reading
 * as an industrial estate, at `blocking` 520 against a body of 261 — the same 2.0 ratio the 620 had
 * against today's 310. That was a call about bulk with no report behind it; this is a report about
 * a rule the player cannot see obeyed, and a rule that cannot be read is not doing its job.
 *
 * **The art follows, it is not stretched.** `ObstacleSprites` maps the texture onto the world box,
 * so the two renders were regenerated at the new proportion by `dev-assets/cc0-3d/barrier_render.py`
 * — whose own `TARGETS` is this arithmetic restated. A 45% taller box under the old 1.10:1 panel is
 * exactly the 41%-too-wide distortion that file exists to have fixed.
 *
 * **⚠ THERE WAS A THIRD CLASS AND IT WAS REMOVED, AND THIS NOTE IS THE ARGUMENT IT LOST.**
 * `overhead` was `[362, 560]`: run under on the ground, hit by jumping into it. The docstring here
 * used to say it "must never be dropped for being fiddly", because without something that punishes
 * being airborne the optimal play is to jump at everything. That reasoning stands and is what this
 * change costs.
 *
 * What it lost on is that the class **cannot be drawn**. The sprite's canvas IS the collision band,
 * so an obstacle starting 362 units up is drawn 362 units up — floating, necessarily, with nothing
 * under it. Legs are not available: the player passes beneath at *every* `offsetX`, so a drawn post
 * is one the snail drives through, which is the "sprite claims ground the model does not" failure
 * that `PLAYER_WIDTH` documents. It was drawn as a fallen log, then as a banded arm, then as a
 * hazard board hung from a rail, and reported as a thing hanging in the air all three times.
 *
 * **What is left of the cost, measured rather than waved away**: jumping is not free, because
 * `blocking` reaches 620 and an airborne body is `[430, 691]` — you cannot jump a boulder, and
 * `provePassable` still has to prove a jump-only row's whole flight is survivable. What is gone is
 * anything that hits *only* an airborne snail, so a jump taken when none was needed now costs
 * nothing.
 *
 * **The heights were cut once, by looking at them.** The first set (`blocking` to 520) satisfied
 * every constraint above and drew a road lined with grey slabs three to six times the snail's own
 * height — the frame read as an industrial estate rather than as something a snail is running
 * through. What actually binds is only this: `blocking` must reach above the apex. Everything past
 * that is bulk, and bulk was costing the read.
 */
export const BLOCKING_HEAD_CLEARANCE = 0.2

export const OBSTACLE_BANDS = {
  low: { yLow: 0, yHigh: 230 },
  blocking: { yLow: 0, yHigh: Math.round(JUMP_APEX + PLAYER_BODY_H * (1 + BLOCKING_HEAD_CLEARANCE)) },
} as const

export type ObstacleKind = keyof typeof OBSTACLE_BANDS

/**
 * The least time an obstacle must be on screen and readable before it can be hit, in
 * milliseconds.
 *
 * **This is the real difficulty gate, and it is a floor rather than a target.** The flight arc
 * is wide enough that clearing an obstacle is never the hard part; noticing it is. Every
 * difficulty knob in `difficulty.ts` — density, the share of unjumpable obstacles, how often a row
 * is a wall — is allowed to move only while every generated layout still leaves this much
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

/**
 * How many lives a rewarded continue hands back, and how much road it hands them back on.
 *
 * **One life, not three.** A continue that restored the full set would double the length of every
 * run for the price of one ad, which makes the ad the way the game is played rather than a thing a
 * player may do — and it would put the leaderboard out of reach of anyone who does not watch them.
 * What the offer is for is the one mistake that just ended the run, and one life is exactly that
 * mistake given back.
 *
 * **The grace is four times an ordinary hit's**, and it is not generosity either: the snail comes
 * back on the piece of road that killed it, at whatever speed the run was doing, with the rest of
 * that row still standing. `HIT_INVULNERABLE_Z` covers a row; this has to cover the row *and* leave
 * `REACTION_MS` of clear sight after it, or the continue is spent on a crash the player could not
 * have answered — which is the exit-from-Fever failure read from a third direction.
 */
export const CONTINUE_LIVES = 1
export const CONTINUE_GRACE_Z = HIT_INVULNERABLE_Z * 4

/**
 * How long a stage run coasts past its finish line before the result panel arrives.
 *
 * **A duration rather than a distance, which is the one place in this file that is the right unit.**
 * Every window in this game is stated in world units precisely because a duration means a different
 * number of *rows* at different speeds — but nothing is being spaced against this one. What it is
 * about is how long the player looks at the line going past, which is a fact about watching rather
 * than about the road, and a distance would make the moment shorter the faster the run was going.
 *
 * Set at the same 1000ms `PLAYER_DEATH_MS` is, because the two are one beat read from opposite ends:
 * a crash and an arrival both need long enough to be seen and short enough that the panel does not
 * feel late. Spelled out rather than imported — `playerDeath.ts` imports this file, so reading it
 * back would be a cycle, and the same reason `DEFAULT_WEAPON_ID` was duplicated once before.
 */
export const FINISH_HOLD_MS = 1000

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
