import { PLAYER_HALF_WIDTHS, REACTION_MS } from './constants'

/**
 * What a close pass is worth, and the streak it builds.
 *
 * **Rule: this file never imports `phaser`** — covered by `npm run verify:scoring`.
 *
 * ## ⚠ The game had no reward for skill, only a punishment for failure
 *
 * An obstacle could take a life and could do nothing else. Dodge it and *nothing happened* — so the
 * optimal line was the middle of the widest gap, held for the whole run, and every decision the
 * placer worked to offer was one the player was better off declining. A runner whose only feedback
 * is damage is a runner that teaches avoidance.
 *
 * So a pass close enough to have been a decision pays, and a run of them multiplies. That changes
 * the sentence the game is about from *do not touch* to *go near*, which is the same set of
 * obstacles read the other way round.
 *
 * ## What is paid for is the DECISION, not the object
 *
 * There is deliberately no table of per-kind values. A constant per kind is a ladder somebody has
 * to keep in step with the speeds, and it goes out of step the first time `SPEED_CAP` moves. What
 * is measured instead is how little room the manoeuvre left, in the two ways a manoeuvre can be
 * tight, and the ladder falls out of the arithmetic:
 *
 * | | urgency | commitment | worth | so it pays |
 * |---|---|---|---|---|
 * | squeezed past a rock | 1 | 1 | 1.00 | least |
 * | hopped a barrier | 1 | half a jump | 1.78 | more |
 * | hopped an oncoming bug | the closing ratio | half a jump | 2.29 | more again |
 * | rode a ramp over something | 1 | half a flight, at 0.4 control | 3.08 | most |
 * | one hop over three things | 1 | half a jump, x3 | 5.34 | most of all |
 *
 * Nobody chose that order. It is what the three terms compute, which is the point: re-tune the
 * jump, the ramp or the critters' speed and the ladder re-sorts itself.
 */

/**
 * How much daylight still counts as a close pass, in road half-widths.
 *
 * **⚠ Derived from the renderer's residual error, not chosen.** A reward that depends on a gap
 * cannot stand on a projection whose error is a large fraction of the gap — and it was: obstacles
 * were drawn from their segment's near edge while their collision box sat at their own `z`, which
 * put the drawn lateral position out by up to **0.109 half-widths at the road's edge, 0.87 of the
 * snail's own half-width**. Interpolating the ground point (see `groundProjection.ts`) takes that
 * to **0.00304**, a 36x improvement.
 *
 * This is `NEAR_MISS_SAFETY` times what is left. The multiple is not arbitrary either: the payout
 * is *graded* by how tight the pass was, so what the residual actually costs is a wobble in the
 * grade of `1 / NEAR_MISS_SAFETY` of the base value — at 20 that is 5%, which is under a single
 * coin at any base worth awarding. Widen the threshold and the reward stops meaning "close";
 * tighten it and the grade starts reporting the renderer instead of the player.
 *
 * 0.061 half-widths is 122 world units — about a quarter of the mascot's own width of daylight.
 */
export const NEAR_MISS_RESIDUAL = 0.00304
export const NEAR_MISS_SAFETY = 20
export const NEAR_MISS_GAP = NEAR_MISS_RESIDUAL * NEAR_MISS_SAFETY

/**
 * The most a short window may multiply a payout by.
 *
 * **⚠ Urgency is the CLOSING RATIO, not the window measured against `REACTION_MS`** — and the first
 * version was the latter, which measured nothing. Every row in this game is spaced so that it is
 * readable for `REACTION_MS` at `MAX_ATTAINABLE_SPEED`, so a standing obstacle gives the player the
 * *same* window whatever the run's speed: the placer already compensates. Comparing a window to
 * `REACTION_MS` therefore returned 1 for a rock and 1 for an oncoming flier, and the rung above the
 * hop collapsed onto it.
 *
 * What genuinely shortens the window is the object coming the other way, and the ratio of the
 * closing speed to the run's own speed is exactly how much shorter — one number, and the caller has
 * both halves of it already. A rock closes at the run's speed and scores 1; a wasp at 1039 u/s met
 * at `SPEED_CAP` closes at 1.29x and its window is 1.29x shorter.
 *
 * Capped, because an uncapped ratio makes one alignment worth more than a minute of play.
 */
export const URGENCY_CAP = 3

/**
 * What a pass at the very edge of the threshold is worth, before any of the terms.
 *
 * Small on purpose: this is paid many times a lap, and its job is to be *felt* as a rhythm rather
 * than to compete with what a pickup is worth. The streak is where the numbers get large.
 */
export const NEAR_MISS_BASE = 12

/** How much each unbroken pass adds to the multiplier, and where it stops. */
export const STREAK_STEP = 0.25
export const STREAK_MAX = 5

/**
 * How long a streak survives without a pass, in world units of travel.
 *
 * **A distance, never a duration** — the rule every window in this game is under. A streak measured
 * in seconds would be easier to hold at the start of a run than at the cap, i.e. easiest exactly
 * when the player is doing least.
 *
 * **⚠ 9000 was a guess and it was under the real rate, so the multiplier never happened.** Driven in
 * the running game with an autopilot aiming at every obstacle it could reach, scoring passes came
 * **9261 world units apart at the median** — so more than half of them lapsed the streak, it peaked
 * at 3 over 2231 metres, and the 3.89x the economy simulation credited to a long run was worth
 * nothing on a real road. The simulation could not have caught it: it assumed a scoring pass on
 * *every row*, where the real rate is one per two and a half rows even when the player is trying.
 *
 * This forgives **one** missed opportunity and lapses on two, which is what a streak is for — 20000
 * against that measured median. It is deliberately not derived from the row spacing: what sets the
 * rate is how often a player can *reach* a close line, not how often the placer offers one.
 */
export const STREAK_MEMORY_Z = 20000

export interface NearMiss {
  /** How close it was, `0..1`, 1 being a graze. */
  tightness: number
  /** How much faster than the run the two closed, `1..URGENCY_CAP`. */
  urgency: number
  /** How long the manoeuvre was irrevocable for before it paid off, as a multiple of `REACTION_MS`. */
  commitment: number
  /** How many objects one manoeuvre covered. */
  count: number
  points: number
}

export interface StreakState {
  /** How many unbroken close passes, which is what the multiplier is built from. */
  count: number
  /** Where the last one happened, so the streak can lapse by distance rather than by clock. */
  lastZ: number
}

export function createStreak(): StreakState {
  return { count: 0, lastZ: -Infinity }
}

/** The multiplier a streak of `count` is currently worth. */
export function streakMultiplier(count: number): number {
  if (count <= 1) return 1

  return Math.min(STREAK_MAX, 1 + (count - 1) * STREAK_STEP)
}

/**
 * What one close pass is worth, and the streak it leaves behind.
 *
 * `gap` is the clearance in road half-widths at the tightest instant of the crossing — lateral for
 * a pass, vertical for a hop. `closingRatio` is how fast the two came together as a multiple of the
 * run's own speed: 1 for anything standing on the road, more for something walking at you.
 * `commitmentMs` is how long the manoeuvre had already been irrevocable when it paid off — zero for
 * a steer, the airborne time for a jump, the whole flight for a ramp. `airControl` is how much
 * steering authority the player still had while it ran: 1 for an ordinary jump, `RAMP_AIR_CONTROL`
 * for a ramp flight, and it is what separates those two.
 *
 * Returns `null` when the pass was not close enough to have been a decision, which is most of them.
 */
export function scoreNearMiss(
  gap: number,
  closingRatio: number,
  commitmentMs: number,
  count: number,
  feverFactor: number,
  streak: StreakState,
  z: number,
  airControl = 1,
): { miss: NearMiss; streak: StreakState } | null {
  if (!(gap >= 0) || gap >= NEAR_MISS_GAP) return null

  const tightness = 1 - gap / NEAR_MISS_GAP
  const urgency = Math.min(URGENCY_CAP, Math.max(1, closingRatio))
  // **⚠ Commitment is how long AND how irrevocably, and the second half is not decoration.** With
  // the duration alone a ramp flight scored 2.30 against an oncoming hop's 2.29 — two manoeuvres
  // the design wants a rung apart, landing on the same one, because a ramp's air time is only 1.29x
  // a jump's. What actually separates them is that a ramp takes the player's steering away:
  // `RAMP_AIR_CONTROL` is 0.4, so for most of that flight the decision cannot be revised at all.
  const commitment = 1 + (Math.max(0, commitmentMs) / REACTION_MS) * (2 - Math.min(1, Math.max(0, airControl)))
  // A streak lapses by distance, so a player who spends a quiet stretch on an empty road starts
  // again rather than banking the gap.
  const continued = z - streak.lastZ <= STREAK_MEMORY_Z ? streak.count : 0
  const next = { count: continued + 1, lastZ: z }
  const points = Math.max(
    1,
    Math.round(NEAR_MISS_BASE * tightness * urgency * commitment * Math.max(1, count) * feverFactor * streakMultiplier(next.count)),
  )

  return { miss: { tightness, urgency, commitment, count: Math.max(1, count), points }, streak: next }
}

/**
 * The streak after a hit: gone.
 *
 * **The reset is the whole reason the streak is worth holding.** A multiplier that survived damage
 * would make the close pass a free upside on top of a mistake, and the reward would stop being a
 * decision — which is the one thing this is for.
 */
export function breakStreak(): StreakState {
  return createStreak()
}

/**
 * Which rung of the ladder a pass landed on, `0..TIER_COUNT - 1`.
 *
 * **For the ear, not for the arithmetic.** Nothing about the payout branches on this — the points
 * come out of the three terms — but a sound has to be one of a countable set, and a rising run of
 * pitches is the feedback the player actually has at the moment they are looking at the road rather
 * than at a number. Derived from the payout so a rung can never disagree with what was scored.
 */
export function nearMissTier(miss: NearMiss): number {
  const worth = miss.urgency * miss.commitment * Math.max(1, miss.count)

  for (let tier = TIER_THRESHOLDS.length - 1; tier >= 0; tier--) {
    if (worth >= TIER_THRESHOLDS[tier]) return tier
  }

  return 0
}

/**
 * Where one rung ends and the next begins, in units of `urgency * commitment * count`.
 *
 * Five rungs because the set of manoeuvres this game can tell apart is five — a steer, a hop, a hop
 * over something coming at you, a ramp flight, and a manoeuvre that covered more than one thing.
 * A sixth would be a rung the ear cannot separate from its neighbour, which is what the rejected
 * "went through the one gap in a wall" case would have been: it is a hop, and it would have sounded
 * like one.
 */
export const TIER_THRESHOLDS = [0, 1.5, 2.05, 2.7, 4.5] as const
export const TIER_COUNT = TIER_THRESHOLDS.length

/**
 * The lateral clearance between the snail and something beside it, in half-widths.
 *
 * Zero when they are touching and negative when they overlap — the same arithmetic `hits` does,
 * read as a distance rather than as a boolean, so the reward and the damage can never disagree
 * about what "close" meant.
 */
export function lateralGap(playerOffsetX: number, otherOffsetX: number, otherHalfWidths: number): number {
  return Math.abs(playerOffsetX - otherOffsetX) - (otherHalfWidths + PLAYER_HALF_WIDTHS)
}
