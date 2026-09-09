#!/usr/bin/env node
// STEP 0 of the mobile-controls investigation: an instrument, not a change.
//
// **Nothing in this file alters the game.** It drives the shipped modules -- `stepPlayer`'s
// spring, `placeRunObstacles`' road, `hits`' collision, `steerTarget`'s screen-to-road mapping --
// under a *simulated player*, and reports the four numbers the redesign has to be argued from:
//
//   1. how far the finger is from the snail on screen, in CSS pixels;
//   2. how long from the finger asking to the snail starting, and to the snail arriving;
//   3. overshoots -- how often the snail sails past the gap and has to come back;
//   4. hits split into "asked in time, snail did not arrive" vs "had not asked yet".
//
// **Why a simulated player rather than ten runs by hand.** A run played here would be a run played
// with a mouse on a desktop, which is the one device the report is not about; and a single human
// run is one sample of a distribution three times as wide as anything worth measuring -- the same
// correction `verify:formations` and `verify:quests` have both already had to make. What is
// simulated is the *player*, and every number below the player is the game's own.
//
// The player model is three lags in series, and each has a source:
//
//   - PERCEPTION_MS: a trained visual-motor response, the same 250ms `REACTION_MS`'s own docstring
//     cites when it budgets 450ms as "roughly two reaction times";
//   - THUMB_SPEED_PX: how fast a thumb slews across glass, and it is *absolute pixels*, which is
//     what makes this a mobile question at all -- the road is a fraction of the frame and the thumb
//     is not;
//   - FINGER_SIGMA_PX: a thumb cannot be placed more precisely than its own contact patch.
//
// Run: node --import ./scripts/register-ts-loader.mjs scripts/measure-steering.mjs
import { createPlayerState, jump, playerScreenFraction, stepPlayer } from '../src/run/playerMotion.ts'
import { createRunState, stepRun } from '../src/run/runState.ts'
import {
  PLAYER_DAMPING,
  PLAYER_HALF_WIDTHS,
  PLAYER_STIFFNESS,
  HIT_INVULNERABLE_Z,
  PLAYER_BODY_H,
  PLAYER_REST_Y_FRACTION,
  JUMP_AIR_MS,
  OBSTACLE_DEPTH,
  PLAYER_WIDTH,
  PLAYER_Z,
  REACHABLE_EDGE,
  REACTION_MS,
  STEER_EDGE_MARGIN,
  playerResponse,
  steerTarget,
} from '../src/run/constants.ts'
import { PASSABILITY_OFFSETS, hits, obstacleRows, placeRunObstacles } from '../src/run/obstacles.ts'
import { CAMERA_DEPTH, DRAW_DISTANCE, ROAD_WIDTH, SEGMENT_LENGTH } from '../src/road/constants.ts'
import { buildRunCircuit } from '../src/road/circuits.ts'

const track = buildRunCircuit()
const TRACK_LENGTH = track.length * SEGMENT_LENGTH
const SNAIL_HALF = PLAYER_WIDTH / (2 * ROAD_WIDTH)

/* ------------------------------------------------------------------ *
 * The frames the report is about
 * ------------------------------------------------------------------ */

// CSS px per inch, roughly, for the shapes a phone is held in. A 375-wide portrait frame is about
// 2.7 inches across; an 844-wide landscape one is about 5.8. That ratio is what turns a fraction of
// the road into a distance a thumb has to actually travel.
const FRAMES = [
  { name: 'phone portrait', w: 375, h: 667, dpi: 139 },
  { name: 'phone landscape', w: 844, h: 390, dpi: 146 },
  { name: 'small portrait', w: 320, h: 568, dpi: 139 },
  { name: 'desktop', w: 1920, h: 945, dpi: 82 },
]

/** Half the road's projected width at the player's own row, in CSS px. */
function roadHalfPx(frameW) {
  const scale = CAMERA_DEPTH / PLAYER_Z

  return (scale * ROAD_WIDTH * frameW) / 4
}

/** How wide the snail is drawn, in CSS px. */
function snailWidthPx(frameW) {
  return SNAIL_HALF * 2 * roadHalfPx(frameW)
}

/** Where an offsetX lands on the frame, in CSS px. */
function snailPx(offsetX, frameW) {
  return playerScreenFraction(offsetX) * frameW
}

/** Where a finger at `px` is asking to stand, in half-widths -- the shipped input path. */
function askAt(px, frameW) {
  return steerTarget(px / frameW)
}

/**
 * The inverse of `steerTarget`: the finger column that asks for `offsetX`.
 *
 * Built from `playerScreenFraction` (which inverts the bare projection) with the input path's own
 * 6% edge margin folded back on, so it is the exact inverse of what the game reads rather than an
 * approximation of it.
 */
function fingerFor(offsetX, frameW) {
  const usable = 1 - 2 * STEER_EDGE_MARGIN
  const bare = playerScreenFraction(offsetX)

  return (STEER_EDGE_MARGIN + bare * usable) * frameW
}

/* ------------------------------------------------------------------ *
 * The player model
 * ------------------------------------------------------------------ */

// How far ahead of a row the player commits to a line. **This is the swept parameter and the
// whole point of the experiment**: it is the warning the control law is being asked to fit into,
// and `REACTION_MS` (450) is the game's own claim about how much of it there always is.
const COMMIT_LEAD_MS = 900
const THUMB_SPEED_PX = 1400
const FINGER_SIGMA_PX = 14
/**
 * A relative drag's error is a fraction of the movement, not a number of pixels.
 *
 * **That is the entire difference between the two schemes and the reason both are simulated.** An
 * absolute control asks the thumb to *arrive* at a column, so its error is a placement error in
 * screen pixels -- and the road is a fraction of the frame while the thumb is not, which is why the
 * same law measures differently on a phone and on a desktop. A relative control asks the thumb to
 * *travel* a distance, so its error scales with the distance asked for and the frame's size drops
 * out of it. 8% is a generous reading of how well a thumb repeats a short push.
 */
const RELATIVE_ERROR = 0.08
// A jump is committed with a human's timing error on it -- the flight has to cover the row.
const JUMP_TIMING_SIGMA_MS = 60
// How long the player takes to see where the snail actually got to, before correcting.
const PERCEPTION_MS = 250
// How often a correcting player looks and nudges.
const CORRECTION_INTERVAL_MS = 120

/**
 * Two players, and the difference between them is the whole question.
 *
 * **`patient`** places the thumb where the snail should end up and *waits* for it. That is the
 * correct strategy for an absolute control and it is what a player eventually learns.
 *
 * **`chasing`** watches the snail, sees it lagging behind the thumb, and pushes the thumb further
 * -- which is what everybody does for the first hour, and what an absolute control with a spring
 * on it punishes. A human closing a loop around a lag is the textbook way to make a stable system
 * oscillate, and if the report is about anything mechanical this is it.
 */
const PROFILES = [
  { name: 'patient', gain: 0 },
  { name: 'chasing', gain: 0.7 },
]

function mulberry(seed) {
  let a = seed >>> 0

  return () => {
    a += 0x6d2b79f5
    let t = a

    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function gaussian(rng) {
  const u = Math.max(1e-9, rng())

  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng())
}

/**
 * Every contiguous stretch of the road this row lets through on the ground, over the placer's own
 * `PASSABILITY_OFFSETS` -- the same 81 samples `provePassable` certifies against.
 */
function groundGaps(row) {
  const gaps = []
  let open = null

  for (const offsetX of PASSABILITY_OFFSETS) {
    const safe = !row.some((obstacle) => hits({ offsetX, y: 0 }, obstacle))

    if (safe && open === null) open = { from: offsetX, to: offsetX }
    else if (safe) open.to = offsetX
    else if (open) {
      gaps.push(open)
      open = null
    }
  }
  if (open) gaps.push(open)

  return gaps
}

/**
 * Where to stand for a row.
 *
 * **Deliberately not `passableLine`.** That scans left to right and returns the leftmost line,
 * which is right for a proof that a line *exists* and is a model of a player who crosses the whole
 * road every time. A human takes the *nearest* gap and aims at the *middle* of it -- and aiming at
 * the middle is not a nicety, it is the whole reason a thumb's own imprecision matters: aiming at
 * the near edge of a gap makes every millimetre of placement error a hit, which would measure the
 * model rather than the game.
 */
function planFor(row, from) {
  const gaps = groundGaps(row)

  if (!gaps.length) return { offsetX: from, jump: true, room: 0 }

  let best = gaps[0]
  let bestDistance = Infinity

  for (const gap of gaps) {
    const nearest = Math.min(gap.to, Math.max(gap.from, from))
    const distance = Math.abs(nearest - from)

    if (distance < bestDistance) {
      bestDistance = distance
      best = gap
    }
  }

  const middle = (best.from + best.to) / 2
  const room = (best.to - best.from) / 2

  return { offsetX: middle, jump: false, room }
}

/* ------------------------------------------------------------------ *
 * One run
 * ------------------------------------------------------------------ */

function simulate(options) {
  const {
    seed,
    frame,
    fingerSigma = FINGER_SIGMA_PX,
    thumbSpeed = THUMB_SPEED_PX,
    commitLeadMs = COMMIT_LEAD_MS,
    gain = 0,
    mode = 'absolute',
    maxMs = 90_000,
  } = options
  const rng = mulberry(seed)
  const frameW = frame.w

  let run = createRunState()
  let player = createPlayerState()

  const rows = obstacleRows(placeRunObstacles(seed, TRACK_LENGTH, 0))

  let fingerPx = fingerFor(0, frameW)
  let fingerGoalPx = fingerPx
  let cursor = 0
  let committed = -1
  let jumpAtZ = null
  let invulnerableUntil = -1
  let wantOffset = 0
  let lastCorrectionAt = -Infinity
  const seen = []

  const dt = 1000 / 60
  let t = 0

  const gapPx = []
  const settleMs = []
  const startMs = []
  const overshoots = []
  const travelPx = []
  const roomHalf = []

  let hitsShort = 0
  let hitsMissed = 0
  let hitsJump = 0
  let hitsTotal = 0
  let decisions = 0

  let decisionStart = -1
  let decisionTravel = 0
  let decisionFrom = 0
  let decisionWant = 0
  let sawMotion = false
  let arrived = false
  let crossed = 0
  let lastSign = 0

  const closeDecision = () => {
    if (decisionStart < 0) return
    overshoots.push(crossed)
    decisionStart = -1
  }

  while (t < maxMs) {
    run = stepRun(run, dt, { trackLength: TRACK_LENGTH })

    const playerZ = run.distance + PLAYER_Z
    const fromZ = playerZ - (run.speed * dt) / 1000

    while (cursor < rows.length && rows[cursor].z + OBSTACLE_DEPTH < playerZ) cursor++
    if (cursor >= rows.length) break

    const row = rows[cursor]
    const leadMs = ((row.z - playerZ) / Math.max(1, run.speed)) * 1000

    // --- decision: committed `commitLeadMs` before the row arrives ---
    if (committed !== cursor && leadMs <= commitLeadMs) {
      const plan = planFor(row.obstacles, player.offsetX)

      committed = cursor
      decisions++
      closeDecision()

      if (plan.jump) {
        // Aim the flight so its middle lands on the row, with a human's timing error.
        const flightZ = (JUMP_AIR_MS / 1000) * run.speed

        jumpAtZ = row.z - flightZ / 2 + gaussian(rng) * ((JUMP_TIMING_SIGMA_MS / 1000) * run.speed)
      } else {
        const wanted = Math.max(-REACHABLE_EDGE, Math.min(REACHABLE_EDGE, plan.offsetX))
        // Absolute: the thumb has to *land on* the column, and misses it by a number of pixels.
        // Relative: the thumb *pushes* from where it is, and misses by a share of the push.
        const aim =
          mode === 'relative'
            ? fingerPx + (fingerFor(wanted, frameW) - fingerPx) * (1 + gaussian(rng) * RELATIVE_ERROR)
            : fingerFor(wanted, frameW) + gaussian(rng) * fingerSigma

        wantOffset = wanted
        roomHalf.push(plan.room)
        travelPx.push(Math.abs(aim - fingerPx))
        fingerGoalPx = Math.max(0, Math.min(frameW, aim))
        decisionStart = t
        decisionTravel = Math.abs(aim - fingerPx)
        decisionFrom = player.offsetX
        decisionWant = askAt(fingerGoalPx, frameW)
        sawMotion = false
        arrived = false
        crossed = 0
        lastSign = Math.sign(player.offsetX - decisionWant) || 1
      }
    }

    // --- the correcting player: look at where the snail got to, and push the thumb further ---
    seen.push(player.offsetX)
    if (seen.length > Math.round(PERCEPTION_MS / dt)) seen.shift()

    if (gain > 0 && committed === cursor && t - lastCorrectionAt >= CORRECTION_INTERVAL_MS) {
      lastCorrectionAt = t

      const observed = seen[0]
      const error = wantOffset - observed

      fingerGoalPx = Math.max(0, Math.min(frameW, fingerGoalPx + gain * (fingerFor(error, frameW) - fingerFor(0, frameW))))
    }

    if (jumpAtZ !== null && playerZ >= jumpAtZ) {
      player = jump(player)
      jumpAtZ = null
    }

    // --- motor: the thumb slews toward its goal at a finite rate ---
    const step = (thumbSpeed * dt) / 1000
    const dx = fingerGoalPx - fingerPx

    if (Math.abs(dx) <= step) fingerPx = fingerGoalPx
    else fingerPx += Math.sign(dx) * step

    // --- the game's own spring, unmodified ---
    player = stepPlayer(player, { targetFraction: fingerPx / frameW, active: true }, dt)

    gapPx.push(Math.abs(snailPx(player.offsetX, frameW) - fingerPx))

    if (decisionStart >= 0) {
      const err = player.offsetX - decisionWant
      const sign = Math.sign(err) || lastSign

      if (!sawMotion && Math.abs(snailPx(player.offsetX, frameW) - snailPx(decisionFrom, frameW)) >= 1) {
        sawMotion = true
        startMs.push(t - decisionStart)
      }
      if (!arrived && Math.abs(err) <= SNAIL_HALF) {
        arrived = true
        settleMs.push({ travel: decisionTravel, ms: t - decisionStart })
      }
      // **A crossing only counts once it is visible.** Sign flips inside a quarter of a snail
      // width are the spring settling in float noise, not the player watching their creature
      // sail past the gap -- counted, they made every single decision an "overshoot".
      if (arrived && Math.abs(err) > SNAIL_HALF * 0.5 && sign !== lastSign) {
        crossed++
        lastSign = sign
      }
      if (t - decisionStart > 2000) closeDecision()
    }

    // --- collision, through the shipped test, with the game's own grace window ---
    if (playerZ >= invulnerableUntil) {
      for (const obstacle of row.obstacles) {
        if (playerZ < obstacle.z || fromZ > obstacle.z + OBSTACLE_DEPTH) continue
        if (!hits({ offsetX: player.offsetX, y: player.y }, obstacle)) continue

        hitsTotal++
        invulnerableUntil = playerZ + HIT_INVULNERABLE_Z

        // **The split this whole step exists for.** Where was the *finger* at the moment of
        // contact? A finger already inside the gap means the player asked correctly and the snail
        // had not arrived; a finger still outside it means they had not asked yet.
        const asked = askAt(fingerPx, frameW)
        // **A jump-only row is not a steering failure and may not be counted as one.** It has no
        // ground line at all, so *every* thumb position "hits" and the classifier below would
        // blame the steering for a mistimed hop. Its own bucket, reported separately.
        if (!groundGaps(row.obstacles).length) {
          hitsJump++
          break
        }

        const askedSafe = !row.obstacles.some((other) => hits({ offsetX: asked, y: 0 }, other))

        if (askedSafe) hitsShort++
        else hitsMissed++
        break
      }
    }

    t += dt
  }

  return {
    gapPx,
    settleMs,
    startMs,
    overshoots,
    travelPx,
    roomHalf,
    hitsTotal,
    hitsShort,
    hitsMissed,
    hitsJump,
    decisions,
    distance: run.distance,
  }
}

/* ------------------------------------------------------------------ *
 * Reporting
 * ------------------------------------------------------------------ */

function pct(arr, p) {
  if (!arr.length) return 0
  const s = [...arr].sort((a, b) => a - b)

  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]
}

function mean(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0
}

function f(n, d = 1) {
  return n.toFixed(d)
}

console.log('=== The geometry, before any player is simulated =======================')
console.log('')
console.log('frame              road half   snail   travel   snail as   thumb patch')
console.log('                       (px)    (px)     (px)    % travel   as % travel')
for (const frame of FRAMES) {
  const half = roadHalfPx(frame.w)
  const snail = snailWidthPx(frame.w)
  const travel = frame.w * (1 - 2 * STEER_EDGE_MARGIN)
  // A thumb's contact patch is about 11mm across -- 0.43in.
  const patch = 0.43 * frame.dpi

  console.log(
    `${frame.name.padEnd(17)} ${f(half).padStart(8)} ${f(snail).padStart(8)} ${f(travel).padStart(8)} ` +
      `${f((snail / travel) * 100).padStart(9)}% ${f((patch / travel) * 100).padStart(11)}%`,
  )
}

console.log('')
console.log('=== Where the thumb has to go, and what it covers ======================')
console.log('')
console.log('Steering reads `pointer.x` and nothing else, so the finger is free vertically -- but a')
console.log('thumb comes from the bottom edge and the snail sits at ' + f(PLAYER_REST_Y_FRACTION * 100) + '% down the frame, so')
console.log('the natural place to hold it is on the creature. This is the room there is not to.')
console.log('')
console.log('frame              feet row   snail top   room below feet   thumb patch')
for (const frame of FRAMES) {
  const feet = PLAYER_REST_Y_FRACTION * frame.h
  const drawnH = (PLAYER_BODY_H / PLAYER_WIDTH) * snailWidthPx(frame.w)
  const below = frame.h - feet
  const patch = 0.43 * frame.dpi

  console.log(
    `${frame.name.padEnd(17)} ${f(feet).padStart(7)}px ${f(feet - drawnH).padStart(9)}px ${f(below).padStart(15)}px ` +
      `${f(patch).padStart(11)}px${below < patch ? '   <- a thumb does not fit under it' : ''}`,
  )
}

console.log('')
console.log('=== The spring, solved (no player in the loop) =========================')
const response = playerResponse()

console.log(`  stiffness ${PLAYER_STIFFNESS}, damping ${PLAYER_DAMPING}`)
console.log(`  damping ratio  ${f(response.dampingRatio, 3)}   (below 1 = it overshoots)`)
console.log(`  time constant  ${f(response.timeConstantSec * 1000, 0)} ms`)
console.log(`  lag per pointer speed  ${f(response.lagPerPointerSpeed, 4)} half-widths per (half-width/s)`)

console.log('')
const RUNS = 10

function runBatch(frame, profile, commitLeadMs, mode = 'absolute') {
  const gap = []
  const start = []
  const settle = []
  const over = []
  const travel = []
  const room = []
  const dist = []
  let hitsTotal = 0
  let short = 0
  let missed = 0
  let jumped = 0
  let decisions = 0

  for (let i = 0; i < RUNS; i++) {
    const out = simulate({ seed: 1000 + i * 7, frame, gain: profile.gain, commitLeadMs, mode })

    gap.push(...out.gapPx)
    room.push(...out.roomHalf)
    start.push(...out.startMs)
    settle.push(...out.settleMs)
    over.push(...out.overshoots)
    travel.push(...out.travelPx)
    dist.push(out.distance)
    hitsTotal += out.hitsTotal
    short += out.hitsShort
    missed += out.hitsMissed
    jumped += out.hitsJump
    decisions += out.decisions
  }

  return { gap, start, settle, over, travel, room, dist, hitsTotal, short, missed, jumped, decisions }
}

console.log('=== Ten 90-second runs, per frame, two players ==========================')
console.log('')
console.log('"patient" places the thumb and waits. "chasing" watches the snail lag and pushes the')
console.log('thumb further, which is what everyone does before they learn not to.')

for (const frame of FRAMES) {
  const snailW = snailWidthPx(frame.w)

  console.log('')
  console.log(`--- ${frame.name} (${frame.w}x${frame.h}), commit ${COMMIT_LEAD_MS}ms before the row ---`)

  for (const profile of PROFILES) {
    const b = runBatch(frame, profile, COMMIT_LEAD_MS)
    const real = b.settle.filter((entry) => entry.travel >= snailW)
    const realMs = real.map((entry) => entry.ms)
    const overshooting = b.over.filter((n) => n > 0).length

    console.log(`  ${profile.name}`)
    console.log(`     distance per run              ${f(mean(b.dist) / 100, 0)} m`)
    console.log(`     finger to snail on screen     median ${f(pct(b.gap, 50))} px  p95 ${f(pct(b.gap, 95))} px` +
      `   (= ${f(pct(b.gap, 50) / snailW, 2)}x / ${f(pct(b.gap, 95) / snailW, 2)}x the snail)`)
    console.log(`     ask -> snail starts moving    ${f(mean(b.start), 0)} ms mean, p95 ${f(pct(b.start, 95), 0)} ms`)
    console.log(`     ask -> snail arrives          ${f(mean(realMs), 0)} ms mean, p95 ${f(pct(realMs, 95), 0)} ms` +
      `   (moves of a snail width or more, n=${realMs.length})`)
    console.log(`     decisions that overshoot      ${f((overshooting / Math.max(1, b.over.length)) * 100)}%  (mean ${f(mean(b.over), 2)} crossings back)`)
    console.log(`     thumb travel per decision     median ${f(pct(b.travel, 50))} px, p95 ${f(pct(b.travel, 95))} px`)
    console.log(`     room in the gap aimed at      median ${f(pct(b.room, 50) / SNAIL_HALF, 2)}x the snail's half-width, worst 5% under ${f(pct(b.room, 5) / SNAIL_HALF, 2)}x`)
    console.log(`     ... that room, on screen      median ${f((pct(b.room, 50) / SNAIL_HALF) * snailW * 0.5)} px against a thumb patch of ${f(0.43 * frame.dpi)} px`)
    console.log(`     hits ${b.hitsTotal} over ${RUNS} runs:  steering-late ${b.short}   not-asked ${b.missed}   mistimed jump ${b.jumped}`)
  }
}

console.log('')
console.log('=== How much warning the control law needs =============================')
console.log('')
console.log('The commit lead is how long before a row the player decides. `REACTION_MS` is 450 and')
console.log('is what the game itself claims every row carries at top speed.')
console.log('')
console.log('lead     patient: hits / of which late      chasing: hits / of which late')
for (const lead of [1500, 900, 600, 450, 300]) {
  const cells = PROFILES.map((profile) => {
    const b = runBatch(FRAMES[0], profile, lead)

    return `${String(b.hitsTotal).padStart(4)} / ${String(b.short).padStart(3)} late, ${String(b.missed).padStart(3)} not asked`
  })

  console.log(`${String(lead).padStart(4)}ms   ${cells.join('    ')}`)
}

console.log('')
console.log('=== STEP 2 candidate: absolute placement against relative drag =========')
console.log('')
console.log('Same road, same spring, same players. The only change is what the thumb is asked to do:')
console.log('land on a column, or push from wherever it already is.')
console.log('')
console.log('frame              player     absolute hits    relative hits')
for (const frame of FRAMES) {
  for (const profile of PROFILES) {
    const a = runBatch(frame, profile, COMMIT_LEAD_MS, 'absolute')
    const r = runBatch(frame, profile, COMMIT_LEAD_MS, 'relative')

    console.log(
      `${frame.name.padEnd(17)} ${profile.name.padEnd(9)} ${String(a.hitsTotal).padStart(10)}` +
        `${String(r.hitsTotal).padStart(17)}   (${f(((r.hitsTotal - a.hitsTotal) / Math.max(1, a.hitsTotal)) * 100, 0)}%)`,
    )
  }
}
