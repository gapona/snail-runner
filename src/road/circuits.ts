/**
 * The tracks this game rides, as named circuits rather than as builder calls inlined in a scene.
 *
 * **Rule: this file never imports `phaser`** — it is `TrackBuilder` and nothing else, and
 * `npm run verify:road` loads it directly under Node.
 *
 * There are two because there are two places the world is drawn, and they want opposite things
 * from a track: the run wants corners and crests to fly through, the menu wants a stretch that
 * never surprises anybody standing in front of it reading a button. Keeping them here rather
 * than one in each scene is what stops the second one from being written as "the first one, but
 * I changed a couple of numbers" and then drifting.
 */
import { ROAD_CURVE, ROAD_HILL, ROAD_LENGTH } from './constants'
import { TrackBuilder, type Segment } from './track'

/**
 * How long each arm of the run's S is, matching `addSCurve`'s own `SECTION_PHASES`-long arms.
 *
 * Written out rather than taken from the preset because the run does not use the preset any more —
 * see `buildRunCircuit`. Keeping the *length* identical is what holds the lap at 1434 segments, and
 * therefore holds `BIOME_RUN_SEGMENTS * 8 = 1432` and the "a lap reaches every biome" check.
 */
const S_ARM = ROAD_LENGTH.MEDIUM * 3

/**
 * `addLowRollingHills`' own default length, written out because the run passes it a height.
 *
 * Spelled out rather than left to the default so the *length* is visibly unchanged while the height
 * halves — the lap is 1434 segments and a great deal downstream is divided by that.
 */
const ROLLING_LENGTH = ROAD_LENGTH.SHORT * 3

/**
 * The run's circuit: a run-up, one hard bend, a rolling stretch, then a long gentle S.
 *
 * **⚠ It used to end with `addSCurve()`, and that made one stretch of the lap nearly unfightable.**
 * The preset's arms reach `ROAD_CURVE.MEDIUM` and run three sections long, which is long enough for
 * the whole 300-segment view to sit inside one bend — so the road ahead swings off the side of the
 * frame and takes the wave with it. Measured with `road/sightline.ts`: at the worst point **93 of
 * the 200 segments** a wave is fought across were outside the viewport, and a target was engageable
 * for **3.6s against a 6.4s baseline**. Reported by a player as a corner where you cannot manage to
 * kill anything, which is exactly what a 44% cut in the shooting window feels like.
 *
 * The arms are now `ROAD_CURVE.EASY` throughout, same length and same hills. Re-measured: worst
 * **5.5s**, and the binding point moves to the standalone hard bend, which is short enough that the
 * view is never wholly inside it. `verify:road` asserts the floor so a future track edit is measured
 * rather than play-tested.
 *
 * **The single hard bend stays.** It is one section long, not three, and it measured clean — the
 * lesson is about how long a bend lasts relative to the draw distance, not about how tight it is.
 *
 * ## ⚠ The hills are half what they were, and the reason is the mascot
 *
 * **A descent drops the ground out from under the player, and past a point off the bottom of the
 * frame.** The snail stands `PLAYER_Z` ahead of the camera on the road's own surface, so on a
 * downhill it is drawn below its flat row by `CAMERA_DEPTH * gradient / 2` of the frame's height —
 * a figure that does *not* depend on how far ahead it stands, because the distance cancels. At the
 * old heights that was **17.6% of the frame**, and the mascot went out of sight on the steepest
 * crest. Reported with a screenshot of a hill.
 *
 * That number is the only thing bounding how near the camera the snail may stand, and standing it
 * nearer is the one way to draw it bigger without touching a hitbox — see `PLAYER_REST_Y_FRACTION`.
 * So the run's own hills are halved: `ROAD_HILL.MEDIUM` becomes `LOW` on the S-arms and the rolling
 * stretch is given half its default height. Peak gradient **0.419 -> 0.209**, drop **17.6% -> 8.8%**,
 * and the mascot goes from 44px to 54px on a 375px frame with the collision box untouched.
 *
 * **⚠ Halving the arms was not enough on its own, and the thing that was left is not a hill.** With
 * the arms at `LOW` the steepest descent on the lap became `TrackBuilder.build()`'s own **closing
 * section** — the run-back-to-zero it appends when the composed sections do not end level, whose
 * length is `4` segments per height unit however steep that makes it. At a net of `+20` that is 80
 * segments for 4000 units of drop: gradient **0.393**, i.e. almost exactly what had just been taken
 * out. So the arms are composed to **sum to zero**, there is no closing section at all, and the
 * steepest thing on the lap is a hill somebody chose.
 *
 * **The lap is 1452 segments rather than 1434**, and the opening straight is what makes it so.
 * Dropping the closing section took 84 segments off, which left the lap at 1350 — nine biomes of
 * exactly 150 against a floor of exactly 150, i.e. a lap sitting on a limit with no headroom at
 * all. The run-up is `ROAD_LENGTH.LONG * 2` instead, which puts the biomes back at 161 each and
 * spends the extra road on the one stretch of the circuit that has nothing to do with hills.
 * `verify:road` re-measures the biome division and the sightline over the new shape.
 *
 * **`addLowRollingHills` itself is untouched**, and passing it a height rather than editing the
 * preset is why: the menu circuit uses the same preset, has no player standing on it, and has no
 * reason to be flattened.
 *
 * ⚠ This is an edit inside `src/road/`, which the fork does not modify. The three reasons that rule
 * gives are the projection, the depth budget and billboards agreeing with the ground — a circuit's
 * *composition* touches none of them, and `verify:road`'s 93 checks (loop closure, the sightline
 * floor, the biome division) are what make that safe rather than merely arguable. Same standing as
 * the `themes.ts` palette change.
 *
 * `build()` appends whatever closing section is needed to bring the road back to height zero and
 * pads to a whole rumble cycle — see `TrackBuilder.build()`.
 */
export function buildRunCircuit(): Segment[] {
  return new TrackBuilder()
    .addStraight(ROAD_LENGTH.LONG * 2)
    .addCurve(ROAD_LENGTH.MEDIUM, ROAD_CURVE.HARD)
    .addLowRollingHills(ROLLING_LENGTH, ROAD_HILL.LOW / 2)
    .addCurve(S_ARM, -ROAD_CURVE.EASY, ROAD_HILL.NONE)
    .addCurve(S_ARM, ROAD_CURVE.EASY, ROAD_HILL.LOW)
    .addCurve(S_ARM, ROAD_CURVE.EASY, -ROAD_HILL.LOW)
    .addCurve(S_ARM, -ROAD_CURVE.EASY, ROAD_HILL.LOW)
    .addCurve(S_ARM, -ROAD_CURVE.EASY, -ROAD_HILL.LOW)
    .build()
}

/**
 * The menu's circuit: long easy bends and low hills, and **no S-curve**.
 *
 * The menu is a screen someone reads, and every corner is a lateral shove on everything in the
 * frame: the road slides, the scenery sweeps, the sky parallax follows. A hard bend under a
 * title is motion the eye tracks instead of the text, and an S-curve is two of them back to
 * back with a reversal in the middle. `ROAD_CURVE.EASY` over `ROAD_LENGTH.LONG` is a bend the
 * player feels as travel rather than as a turn.
 *
 * It is also longer between events than the run's circuit on purpose. Nobody stays on the menu
 * for one lap, so what matters is that no two seconds of it look like an incident.
 */
export function buildMenuCircuit(): Segment[] {
  return new TrackBuilder()
    .addStraight(ROAD_LENGTH.LONG)
    .addCurve(ROAD_LENGTH.LONG, ROAD_CURVE.EASY)
    .addStraight(ROAD_LENGTH.MEDIUM)
    .addLowRollingHills()
    .addCurve(ROAD_LENGTH.LONG, -ROAD_CURVE.EASY)
    .addStraight(ROAD_LENGTH.LONG)
    .build()
}

/**
 * A level's circuit, from a small spec rather than a hand-written builder chain.
 *
 * Eight levels want eight tracks that differ in *shape* — how often it bends, how hard, how hilly —
 * without eight copies of the same five lines drifting apart. The spec is deliberately thin: a
 * level is a place, and the thing that makes it a place is its biome and its light, not whether its
 * third corner goes left.
 *
 * **Every one of these must clear the sightline floor**, and `verify:road` sweeps all eight rather
 * than the one that happened to be looked at — see `road/sightline.ts` for what a bend that is too
 * long does to a fight, and `buildRunCircuit` for the corner that shipped that way.
 */
export interface CircuitSpec {
  /** How many bend/straight pairs the lap is made of. More is busier, not longer. */
  readonly bends: number
  /** Peak curvature, as a `ROAD_CURVE` value. */
  readonly curve: number
  /** Whether the lap carries rolling hills between its bends. */
  readonly hills: boolean
  /** Alternates the first bend's direction, so two levels at the same spec still differ. */
  readonly mirrored?: boolean
}

/**
 * The shortest a level's lap may be, in segments.
 *
 * **A lap shorter than this reads as a corridor rather than a place.** The draw distance is 300, so
 * a 384-segment lap — which two bends produce — puts the seam within sight of the player and repeats
 * every 12.8 seconds; a run lasts two to three minutes, so they would go round it a dozen times. At
 * 900 a lap is 30 seconds and a run sees it four or five times, which is the difference between a
 * place you travel through and a loop you notice. Measured, not guessed: `verify:levels` prints
 * every level's lap length and holds this floor.
 */
const MIN_LEVEL_SEGMENTS = 900

export function buildLevelCircuit(spec: CircuitSpec): Segment[] {
  const builder = new TrackBuilder().addStraight(ROAD_LENGTH.LONG)
  const direction = spec.mirrored ? -1 : 1

  for (let i = 0; i < spec.bends; i++) {
    // Alternating sign keeps a lap from drifting into one long turn, which is exactly the shape the
    // sightline floor rejects: a bend the whole draw distance fits inside carries the fight off the
    // side of the frame.
    const sign = direction * (i % 2 === 0 ? 1 : -1)

    builder.addCurve(ROAD_LENGTH.MEDIUM, sign * spec.curve, i % 2 === 0 ? ROAD_HILL.NONE : ROAD_HILL.LOW)
    if (spec.hills && i % 2 === 1) builder.addLowRollingHills()
    builder.addStraight(ROAD_LENGTH.MEDIUM)
  }

  // Padded with straight, not with more corners. A level's *character* is its bends, and adding them
  // to reach a length would make every early level as busy as the late ones — which is the one axis
  // the table ramps along. A long straight at noon in a forest is a good first level; a first level
  // with five corners is a fifth level.
  let track = builder.build()

  while (track.length < MIN_LEVEL_SEGMENTS) {
    builder.addStraight(ROAD_LENGTH.LONG)
    track = builder.build()
  }

  return track
}
