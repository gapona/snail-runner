#!/usr/bin/env node
// Logic check for src/run/nearMiss.ts -- what a close pass is worth, the streak it builds, and the
// rung of the ladder it lands on. Imports no phaser, which is what makes it runnable here.
//
// The one thing this suite exists to hold: **the ladder is not a table**. Nothing in the payout
// branches on what kind of object was passed; the order falls out of three measured terms, and if
// it ever stops falling out the printed table below goes out of order and the check fails.
import assert from 'node:assert/strict'
import {
  breakStreak,
  createStreak,
  lateralGap,
  NEAR_MISS_BASE,
  NEAR_MISS_GAP,
  NEAR_MISS_RESIDUAL,
  NEAR_MISS_SAFETY,
  nearMissTier,
  scoreNearMiss,
  STREAK_MAX,
  STREAK_MEMORY_Z,
  STREAK_STEP,
  streakMultiplier,
  TIER_COUNT,
  URGENCY_CAP,
} from '../src/run/nearMiss.ts'
import {
  JUMP_AIR_MS,
  MAX_ATTAINABLE_SPEED,
  PLAYER_HALF_WIDTHS,
  REACTION_MS,
  SPEED_CAP,
} from '../src/run/constants.ts'
import { RAMP_AIR_CONTROL, RAMP_AIR_MS } from '../src/run/ramp.ts'
import { CRITTER_GAP_Z, CRITTER_KINDS } from '../src/run/critters.ts'
import {
  announce,
  createPlaque,
  MILESTONE_COINS,
  MILESTONE_FLASH_MS,
  milestoneCrossed,
  milestoneFlash,
  milestoneLength,
  milestoneProgress,
  PLAQUE_FADE_MS,
  PLAQUE_LIFE_MS,
  PLAQUE_MERGE_MS,
  PLAQUE_PUNCH_MS,
  plaqueAlpha,
  plaquePunch,
} from '../src/run/rewards.ts'
import { BIOMES, biomeIndexForSegment, biomeRunSegments } from '../src/road/biomes.ts'
import { obstacleRows, passableLine, placeRunObstacles } from '../src/run/obstacles.ts'
import { buildRunCircuit } from '../src/road/circuits.ts'
import { SEGMENT_LENGTH } from '../src/road/constants.ts'
import { ROAD_WIDTH } from '../src/road/constants.ts'

// The run's own lap, in world units — the same circuit a run actually builds.
const TRACK = buildRunCircuit().length * SEGMENT_LENGTH

let passed = 0

function check(name, fn) {
  fn()
  passed += 1
  console.log(`  ok  ${name}`)
}

console.log('near misses -- what a decision is worth')

check('the threshold is derived from the renderer residual, not chosen', () => {
  // **⚠ This is the check the whole mechanic rests on.** A reward graded by a gap cannot stand on a
  // projection whose error is a large fraction of that gap. Before `groundProjection.ts` was applied
  // to obstacles the drawn lateral position was out by up to 0.109 half-widths -- 0.87 of the
  // snail's own half-width, i.e. most of any threshold worth calling "close". It is 0.00304 now.
  assert.equal(NEAR_MISS_GAP, NEAR_MISS_RESIDUAL * NEAR_MISS_SAFETY, 'the threshold stopped being derived')
  assert.ok(NEAR_MISS_SAFETY >= 10, 'the safety factor is too small for the grade to mean anything')

  // What the residual actually costs is a wobble in the *grade*, and this is that number: the
  // payout can be wrong by at most one part in `NEAR_MISS_SAFETY` because of the renderer.
  const wobble = 1 / NEAR_MISS_SAFETY

  assert.ok(wobble <= 0.05, `the renderer can move the payout by ${(wobble * 100).toFixed(0)}%`)
  console.log(
    `      gap ${NEAR_MISS_GAP.toFixed(4)} half-widths = ${(NEAR_MISS_GAP * ROAD_WIDTH).toFixed(0)} world units ` +
      `= ${(NEAR_MISS_GAP / PLAYER_HALF_WIDTHS).toFixed(2)} of the snail's half-width; ` +
      `renderer moves the grade by at most ${(wobble * 100).toFixed(0)}%`,
  )

  // And the old error has to be shown to fail it, or the fix bought nothing measurable.
  const before = 0.109

  assert.ok(before > NEAR_MISS_GAP * 0.5, 'the pre-fix error would have been safe, so the fix was unnecessary')
})

check('a pass wider than the threshold is not a near miss at all', () => {
  const streak = createStreak()

  assert.equal(scoreNearMiss(NEAR_MISS_GAP, 1, 0, 1, 1, streak, 0), null, 'a pass exactly at the threshold scored')
  assert.equal(scoreNearMiss(NEAR_MISS_GAP * 2, 1, 0, 1, 1, streak, 0), null, 'a wide pass scored')
  assert.equal(scoreNearMiss(-0.01, 1, 0, 1, 1, streak, 0), null, 'an overlap scored, i.e. a hit paid out')
  assert.ok(scoreNearMiss(NEAR_MISS_GAP * 0.99, 1, 0, 1, 1, streak, 0), 'a pass just inside the threshold did not score')
})

check('tighter always pays more, and nothing else moves', () => {
  const streak = createStreak()
  let previous = 0

  // From just inside the threshold to a graze; 20/20 is the threshold itself, which by
  // definition does not score.
  for (let i = 19; i >= 1; i--) {
    const gap = (i / 20) * NEAR_MISS_GAP
    const scored = scoreNearMiss(gap, 1, 0, 1, 1, streak, 0)

    assert.ok(scored, `a gap of ${gap.toFixed(4)} did not score`)
    assert.ok(scored.miss.points >= previous, 'a tighter pass paid less than a wider one')
    previous = scored.miss.points
  }
})

check('the ladder is not a table -- it falls out of the three terms', () => {
  // **The acceptance for the whole design.** Each row below is a real manoeuvre described only by
  // *how tight, how urgent and how committed* it was; none of them names an object. If the order
  // that comes out ever stops matching the order the design intends, this prints it out of order
  // and fails -- which is the only way a derived ladder can be held to anything.
  const streak = createStreak()
  const graze = NEAR_MISS_GAP * 0.1
  // Anything standing on the road closes at the run's own speed; a bug adds its own.
  const standing = 1
  const kinds = Object.entries(CRITTER_KINDS)
  const flier = kinds.find(([, spec]) => spec.band.yLow > 0)?.[1] ?? kinds[0][1]
  const oncoming = (SPEED_CAP + flier.speed) / SPEED_CAP

  const rungs = [
    ['squeezed past', graze, standing, 0, 1],
    ['hopped it', graze, standing, JUMP_AIR_MS / 2, 1],
    ['hopped an oncoming bug', graze, oncoming, JUMP_AIR_MS / 2, 1],
    ['rode a ramp over it', graze, standing, RAMP_AIR_MS / 2, 1, RAMP_AIR_CONTROL],
    ['one hop, three objects', graze, standing, JUMP_AIR_MS / 2, 3],
  ]

  console.log('      manoeuvre                 tight  urgency  commit  count   worth  points  tier')

  let previous = 0
  const tiers = new Set()

  for (const [name, gap, closing, commitMs, count, control] of rungs) {
    const scored = scoreNearMiss(gap, closing, commitMs, count, 1, streak, 0, control ?? 1)

    assert.ok(scored, `${name} did not score at all`)

    const { miss } = scored
    const tier = nearMissTier(miss)

    tiers.add(tier)
    console.log(
      `      ${name.padEnd(24)}${miss.tightness.toFixed(2).padStart(5)}  ${miss.urgency.toFixed(2).padStart(7)}  ` +
        `${miss.commitment.toFixed(2).padStart(6)}  ${String(miss.count).padStart(5)}  ` +
        `${(miss.urgency * miss.commitment * miss.count).toFixed(2).padStart(6)}  ${String(miss.points).padStart(6)}  ${tier}`,
    )
    assert.ok(miss.points > previous, `${name} did not pay more than the rung below it`)
    previous = miss.points
  }

  // Every rung has to be audibly its own, or the ladder stops being feedback.
  assert.equal(tiers.size, rungs.length, `the five manoeuvres landed on ${tiers.size} distinct tiers`)
  assert.ok(Math.max(...tiers) < TIER_COUNT, 'a manoeuvre landed past the last rung')
})

check('an oncoming object pays more than a standing one, because its window is shorter', () => {
  // The one place the closing speed enters, and it enters as *time*, which is what makes it right:
  // the same physical gap really is a shorter escape when the thing is coming at you.
  const streak = createStreak()
  const gap = NEAR_MISS_GAP * 0.2
  const still = scoreNearMiss(gap, 1, 0, 1, 1, streak, 0)

  for (const [id, kind] of Object.entries(CRITTER_KINDS)) {
    const closing = (SPEED_CAP + kind.speed) / SPEED_CAP
    const oncoming = scoreNearMiss(gap, closing, 0, 1, 1, streak, 0)

    assert.ok(oncoming.miss.points > still.miss.points, `passing a ${id} paid no more than a rock`)
    assert.ok(oncoming.miss.urgency > 1, 'the closing speed did not shorten the window')
  }

  // And it is bounded, or one alignment outweighs a minute of play.
  const absurd = scoreNearMiss(gap, 99, 0, 1, 1, streak, 0)

  assert.equal(absurd.miss.urgency, URGENCY_CAP, 'urgency is unbounded')
})

check('the streak grows, caps, lapses by distance, and dies on a hit', () => {
  let streak = createStreak()
  const gap = NEAR_MISS_GAP * 0.5

  assert.equal(streakMultiplier(0), 1)
  assert.equal(streakMultiplier(1), 1, 'the first pass already multiplied')
  assert.equal(streakMultiplier(2), 1 + STREAK_STEP)

  for (let i = 0; i < 40; i++) {
    const scored = scoreNearMiss(gap, 1, 0, 1, 1, streak, i * 100)

    streak = scored.streak
  }
  assert.equal(streakMultiplier(streak.count), STREAK_MAX, 'the multiplier did not reach its cap')

  // **A distance, never a duration.** A streak measured in seconds is easiest to hold at the speed
  // a run starts at, i.e. easiest exactly when the player is doing least.
  const far = scoreNearMiss(gap, 1, 0, 1, 1, streak, streak.lastZ + STREAK_MEMORY_Z + 1)

  assert.equal(far.streak.count, 1, 'a streak survived a stretch longer than its own memory')

  const near = scoreNearMiss(gap, 1, 0, 1, 1, streak, streak.lastZ + STREAK_MEMORY_Z - 1)

  assert.ok(near.streak.count > 1, 'a streak lapsed inside its own memory')

  // **The reset is the whole reason the streak is worth holding.** A multiplier that survived
  // damage would make a close pass a free upside on top of a mistake.
  assert.equal(breakStreak().count, 0, 'a hit did not break the streak')
  assert.equal(breakStreak().lastZ, -Infinity, 'a broken streak kept its place, so it can be resumed')
})

check('a Fever multiplies the rung rather than being one', () => {
  const streak = createStreak()
  const gap = NEAR_MISS_GAP * 0.3
  const plain = scoreNearMiss(gap, 1, 0, 1, 1, streak, 0)
  const fever = scoreNearMiss(gap, 1, 0, 1, 1.6, streak, 0)

  assert.ok(fever.miss.points > plain.miss.points, 'a Fever did not raise the payout')
  // It must not move the *rung*, or the ear would report a Fever as a different manoeuvre.
  assert.equal(nearMissTier(fever.miss), nearMissTier(plain.miss), 'a Fever changed which rung the pass landed on')
})

check('the lateral gap is the collision arithmetic read as a distance', () => {
  // Zero exactly where `hits` starts returning true, so the reward and the damage can never
  // disagree about what "close" meant.
  const other = { offsetX: 0.4, halfWidths: 0.1 }
  const touching = other.offsetX + other.halfWidths + PLAYER_HALF_WIDTHS

  assert.ok(Math.abs(lateralGap(touching, other.offsetX, other.halfWidths)) < 1e-9, 'the gap is not zero at contact')
  assert.ok(lateralGap(touching + 0.05, other.offsetX, other.halfWidths) > 0, 'a clear pass measured as an overlap')
  assert.ok(lateralGap(touching - 0.05, other.offsetX, other.halfWidths) < 0, 'an overlap measured as a clear pass')
})

check('the base is small enough that the streak is where the numbers come from', () => {
  const streak = createStreak()
  const one = scoreNearMiss(NEAR_MISS_GAP * 0.5, 1, 0, 1, 1, createStreak(), 0)
  let long = streak
  let total = 0

  for (let i = 0; i < 30; i++) {
    const scored = scoreNearMiss(NEAR_MISS_GAP * 0.5, 1, 0, 1, 1, long, i * 100)

    long = scored.streak
    total += scored.miss.points
  }

  assert.ok(NEAR_MISS_BASE <= 20, 'one close pass is worth as much as a pickup')
  console.log(`      one pass ${one.miss.points} points; a streak of 30 ${total} -- ${(total / (one.miss.points * 30)).toFixed(2)}x the flat rate`)
  assert.ok(total > one.miss.points * 30, 'a streak is worth no more than the same passes taken apart')
})

// -- The economy: does the ladder change what a player should do? -----------------------------

/**
 * One policy's expected score over a real lap's worth of road.
 *
 * **Modelled on the real placer, and deliberately assuming EQUAL SKILL.** The question is not
 * whether jumping is harder to execute — it is whether, executed as well, the cheap manoeuvre is
 * the one worth choosing. So every policy achieves the same tightness whenever it attempts a close
 * pass, and what differs is only which manoeuvre it picks, what that is worth, and what it costs.
 *
 * **⚠ The bugs are in the model, and leaving them out inverted the answer.** Without them "jump
 * everything" led by 4.06x, which is the same defect the check is written against wearing the other
 * hat: a blanket policy that never has to look at the road. It is wrong about the game, too —
 * a quarter of the critters *fly*, and the whole of their design is that they are answered by
 * **staying down**. A player holding the jump meets every one of them, and each is a hit: no score,
 * and the streak gone. That counterweight is already in the game; it was missing from the model.
 */
function simulatePolicy(rows, critters, policy, tightnessFraction) {
  let streak = createStreak()
  let total = 0
  let hits = 0
  const gap = NEAR_MISS_GAP * (1 - tightnessFraction)
  // One timeline, so a hit taken on a bug breaks the streak the rows are building.
  const events = [...rows.map((row) => ({ z: row.z, row })), ...critters].sort((a, b) => a.z - b.z)

  for (const event of events) {
    if (event.row) {
      const grounded = passableLine(event.row.obstacles) !== null
      // A wall has no ground line, so every policy jumps it — that is what walls are for.
      const jumping = !grounded || policy === 'jump' || (policy === 'mixed' && event.row.obstacles.length > 1)
      const count = jumping ? event.row.obstacles.length : Math.min(2, event.row.obstacles.length)
      const scored = scoreNearMiss(gap, 1, jumping ? JUMP_AIR_MS / 2 : 0, count, 1, streak, event.z)

      if (scored) {
        streak = scored.streak
        total += scored.miss.points
      }

      continue
    }

    // A bug. A flier is answered by staying down; a policy that jumps everything runs into it.
    const jumping = policy === 'jump' || (policy === 'mixed' && !event.flying)

    if (event.flying && jumping) {
      streak = breakStreak()
      hits++
      continue
    }

    const scored = scoreNearMiss(gap, event.closing, jumping ? JUMP_AIR_MS / 2 : 0, 1, 1, streak, event.z)

    if (scored) {
      streak = scored.streak
      total += scored.miss.points
    }
  }

  return { total, hits }
}

/** The bugs a lap meets, laid at the placer's own mean spacing and its own share of fliers. */
function lapCritters(track) {
  const kinds = Object.values(CRITTER_KINDS)
  const flying = kinds.filter((kind) => kind.flying)
  const ground = kinds.filter((kind) => !kind.flying)
  // The share that fly, taken from the table's own weights rather than a number typed here.
  const weight = (list) => list.reduce((sum, kind) => sum + kind.weight, 0)
  const flierShare = weight(flying) / weight(kinds)
  const spacing = (CRITTER_GAP_Z.min + CRITTER_GAP_Z.max) / 2
  const out = []

  for (let z = spacing, i = 0; z < track; z += spacing, i++) {
    // Dealt round-robin at the table's own share, so the mix is the design's and not a seed's.
    const isFlying = i % Math.round(1 / flierShare) === 0
    const kind = isFlying ? flying[i % flying.length] : ground[i % ground.length]

    out.push({ z, flying: isFlying, closing: (SPEED_CAP + kind.speed) / SPEED_CAP })
  }

  return out
}

check('no policy dominates -- the ladder has to change what the player does', () => {
  // **⚠ The failure this is written against: a policy that never has to look at the road.** At x5 a
  // squeeze past is worth 55 and a hop over an oncoming bug at streak 1 is worth 24, so if the
  // streak grows at the same rate whatever you do, "dodge everything and risk nothing" is the
  // optimal line and the ladder runs idle. The mirror is just as bad and is what the first run of
  // this actually found: "jump everything" leading by 4.06x.
  const rows = obstacleRows(placeRunObstacles(4242, TRACK, TRACK * 3))
  const critters = lapCritters(TRACK)
  const policies = ['dodge', 'jump', 'mixed']
  const table = []

  console.log(`      over one lap: ${rows.length} rows, ${critters.length} bugs (${critters.filter((c) => c.flying).length} of them fliers)`)
  console.log('      skill   dodge    jump   mixed   best    jump hits')

  for (const tightnessFraction of [0.3, 0.6, 0.9]) {
    const scores = policies.map((policy) => simulatePolicy(rows, critters, policy, tightnessFraction))
    const best = policies[scores.indexOf(scores.reduce((a, b) => (a.total >= b.total ? a : b)))]

    table.push({ tightnessFraction, scores, best })
    console.log(
      `      ${tightnessFraction.toFixed(1)}  ${scores.map((s) => String(s.total).padStart(7)).join(' ')}   ${best.padEnd(7)} ${scores[1].hits}`,
    )
  }

  // **⚠ What is asserted is that NEITHER blanket policy wins, not that the spread is small.** A
  // first version of this bounded the spread at 3x and failed at 3.41 — which was the check
  // forbidding the ladder from mattering: choosing by price *should* beat never risking anything by
  // a wide margin, and a bound that says otherwise is asserting the defect.
  const margins = []

  for (const { tightnessFraction, scores, best } of table) {
    assert.equal(
      best,
      'mixed',
      `at skill ${tightnessFraction} a blanket policy (${best}) scores best — ${scores.map((s) => s.total).join(' / ')}. ` +
        'The ladder is idle, and the fix belongs in the streak rather than in the rungs.',
    )

    // Thinking has to lead the better of the two blanket policies by enough to be worth doing,
    // rather than by a rounding.
    margins.push(scores[2].total / Math.max(scores[0].total, scores[1].total))
  }

  const worst = Math.min(...margins)

  assert.ok(worst > 1.5, `choosing by price leads the best blanket policy by only ${worst.toFixed(2)}x`)
  console.log(`      choosing by price leads the best blanket policy by ${worst.toFixed(2)}x at worst`)

  // And the counterweight has to be doing the work rather than being decorative: the jump-everything
  // policy is held back by meeting every flier, which is a mechanic the game already had.
  assert.ok(table[0].scores[1].hits > 0, 'jumping everything met no fliers, so nothing is holding it back')
})

check('every term in the payout distinguishes something', () => {
  // **⚠ Two terms have shipped in this file that computed correctly and measured nothing.**
  // `urgency` was the decision window against `REACTION_MS`, which returns 1 for everything because
  // the placer already spaces rows to that floor at every speed; `commitment` was a duration alone,
  // which gave a ramp flight 2.30 against an oncoming hop's 2.29. Both had green tests: the formula
  // was right, the *quantity* was empty.
  //
  // So the class of defect is checked directly rather than left to whoever writes the next term. A
  // multiplier that takes one value across every manoeuvre the game can tell apart is not a
  // multiplier, it is a constant with an argument list.
  const graze = NEAR_MISS_GAP * 0.1
  const kinds = Object.entries(CRITTER_KINDS)
  const flier = kinds.find(([, spec]) => spec.band.yLow > 0)?.[1] ?? kinds[0][1]
  const oncoming = (SPEED_CAP + flier.speed) / SPEED_CAP
  const rungs = [
    [graze, 1, 0, 1, 1],
    [graze, 1, JUMP_AIR_MS / 2, 1, 1],
    [graze, oncoming, JUMP_AIR_MS / 2, 1, 1],
    [graze, 1, RAMP_AIR_MS / 2, 1, RAMP_AIR_CONTROL],
    [graze, 1, JUMP_AIR_MS / 2, 3, 1],
  ]
  const seen = { urgency: new Set(), commitment: new Set(), count: new Set() }

  for (const [gap, closing, commitMs, count, control] of rungs) {
    const { miss } = scoreNearMiss(gap, closing, commitMs, count, 1, createStreak(), 0, control)

    seen.urgency.add(miss.urgency.toFixed(4))
    seen.commitment.add(miss.commitment.toFixed(4))
    seen.count.add(miss.count)
  }

  for (const [term, values] of Object.entries(seen)) {
    assert.ok(
      values.size > 1,
      `${term} takes one value (${[...values][0]}) across every manoeuvre, i.e. it distinguishes nothing`,
    )
  }
  console.log(
    '      distinct values across the five rungs: ' +
      Object.entries(seen).map(([term, values]) => `${term} ${values.size}`).join(', '),
  )

  // Tightness is held constant in that table on purpose — it is the term the other checks sweep —
  // so it is confirmed separately rather than left unmeasured.
  const tights = new Set(
    [0.1, 0.5, 0.9].map((f) => scoreNearMiss(NEAR_MISS_GAP * f, 1, 0, 1, 1, createStreak(), 0).miss.tightness.toFixed(4)),
  )

  assert.equal(tights.size, 3, 'tightness takes one value across three different gaps')
})

// -- Where the reward is announced, and what marks the next milestone -------------------------

check('a streak updates one plaque rather than stacking them', () => {
  // **⚠ The failure this is written against: text filling the strip the road is read through.** A
  // streak on a dense stretch fires several times a second, and one plaque per reward would put six
  // numbers over the horizon at exactly the moment the player needs to see past them.
  let plaque = createPlaque()
  let now = 1000

  const first = announce(plaque, 11, 0, 1, now)

  plaque = first.plaque
  assert.ok(first.fresh, 'the first reward of a run was not a new announcement')
  assert.equal(plaque.points, 11)
  assert.equal(plaque.count, 1)

  // Everything inside the merge window folds in: the number grows, the count grows, and the
  // announcement stays the same announcement.
  for (let i = 0; i < 5; i++) {
    now += PLAQUE_MERGE_MS - 100
    const merged = announce(plaque, 10, i % 2, 1 + (i + 1) * 0.25, now)

    assert.ok(!merged.fresh, `reward ${i + 2} started a second plaque`)
    plaque = merged.plaque
  }
  assert.equal(plaque.count, 6, 'six rewards did not read as one run of six')
  // The live multiplier, not the highest seen: a plaque holding a stale one would advertise a
  // streak the run no longer has.
  assert.equal(plaque.multiplier, 1 + 5 * 0.25, 'the plaque is not showing the current multiplier')
  assert.equal(plaque.points, 61, 'the merged plaque lost points')
  assert.equal(plaque.bornAt, 1000, 'a merge restarted the announcement instead of extending it')

  // The dearest rung, not the latest: a plaque dropping back to a squeeze's weight after a ramp
  // would report the streak as having got cheaper when it has only got longer.
  const afterRamp = announce(plaque, 33, 3, 2, now + 10).plaque

  assert.equal(afterRamp.tier, 3)
  assert.equal(announce(afterRamp, 11, 0, 2, now + 20).plaque.tier, 3, 'the plaque forgot the dearest rung it had shown')

  // Past the window it is a new event, which is what a gap in a streak should look like.
  const later = announce(plaque, 11, 0, 1, now + PLAQUE_MERGE_MS + 1)

  assert.ok(later.fresh, 'a reward after a long gap merged into a stale plaque')
  assert.equal(later.plaque.count, 1, 'a new announcement inherited the old streak')
})

check('the plaque lives, fades and punches on its own clock', () => {
  const plaque = announce(createPlaque(), 11, 0, 1, 0).plaque

  assert.equal(plaqueAlpha(createPlaque(), 0), 0, 'an empty plaque is drawn')
  assert.equal(plaqueAlpha(plaque, 0), 1, 'the plaque did not arrive at full strength')
  assert.equal(plaqueAlpha(plaque, PLAQUE_LIFE_MS), 1, 'the plaque faded before its life was up')
  assert.equal(plaqueAlpha(plaque, PLAQUE_LIFE_MS + PLAQUE_FADE_MS), 0, 'the plaque never goes away')

  let previous = 1

  for (let i = 0; i <= 20; i++) {
    const alpha = plaqueAlpha(plaque, PLAQUE_LIFE_MS + (i / 20) * PLAQUE_FADE_MS)

    assert.ok(alpha <= previous + 1e-9, 'the plaque brightened while fading')
    previous = alpha
  }

  // The punch is what says *another one* when only the number has changed.
  assert.equal(plaquePunch(plaque, 0), 1, 'a merge did not punch')
  assert.equal(plaquePunch(plaque, PLAQUE_PUNCH_MS), 0, 'the punch never ends')
})

check('a milestone IS the biome change, not a counter beside one', () => {
  // **⚠ Two ladders would drift the moment the lap length or the biome count moved**, and the
  // player would be told they had arrived somewhere the world did not change — which is worse than
  // no milestone, because the world changing is the reward.
  const segments = buildRunCircuit().length

  assert.equal(
    milestoneLength(segments),
    biomeRunSegments(segments) * SEGMENT_LENGTH,
    'the milestone stopped being one biome stretch long',
  )

  // Every crossing the check finds has to be a biome boundary, and every boundary a crossing.
  let crossings = 0
  let boundaries = 0
  let previousBiome = biomeIndexForSegment(0, segments)

  for (let i = 1; i <= segments; i++) {
    const from = (i - 1) * SEGMENT_LENGTH
    const to = i * SEGMENT_LENGTH
    const biome = biomeIndexForSegment(i, segments)

    if (biome !== previousBiome) boundaries++
    if (milestoneCrossed(from, to, segments)) crossings++
    previousBiome = biome
  }

  assert.equal(crossings, boundaries, `${crossings} milestones against ${boundaries} biome boundaries`)
  assert.ok(boundaries >= BIOMES.length - 1, `a lap crosses only ${boundaries} boundaries`)
  console.log(
    `      one lap: ${boundaries} milestones, ${(milestoneLength(segments) / 100).toFixed(0)}m apart, ` +
      `worth ${MILESTONE_COINS} coins each`,
  )

  // The progress bar runs 0..1 across a stretch and never past it — including the short last
  // stretch of a lap that does not divide evenly, which a bar computed from distance would overrun.
  let previous = -1
  let resets = 0

  for (let i = 0; i < segments; i++) {
    const progress = milestoneProgress(i * SEGMENT_LENGTH, segments)

    assert.ok(progress >= 0 && progress <= 1, `progress left 0..1 at segment ${i}`)
    if (progress < previous) resets++
    previous = progress
  }
  assert.equal(resets, boundaries, `the bar reset ${resets} times against ${boundaries} boundaries`)
})

check('the milestone flash marks the boundary rather than celebrating it', () => {
  assert.equal(milestoneFlash(-1, 0), 0, 'a run that has crossed nothing is flashing')
  assert.equal(milestoneFlash(0, 0), 1, 'the flash did not start at full')
  assert.equal(milestoneFlash(0, MILESTONE_FLASH_MS), 0, 'the flash never ends')
  // Front-loaded, like every other flash in this game: what it says is *now*.
  assert.ok(milestoneFlash(0, MILESTONE_FLASH_MS / 2) < 0.35, 'the flash is not front-loaded')
  assert.ok(MILESTONE_FLASH_MS < PLAQUE_LIFE_MS, 'the flash outlives the plaque it arrives with')
})

console.log(`\n${passed} checks passed`)
