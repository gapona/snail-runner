#!/usr/bin/env node
// Logic check for the vertical half of src/run/playerMotion.ts -- the jump arc, and the claim the
// whole obstacle model rests on. Plain assertions, no framework, via the register-ts-loader.mjs +
// ts-extensionless-loader.mjs Node-native-TS setup.
//
// **The last section is the one that matters.** Everything before it is ordinary arc arithmetic:
// the apex is where `JUMP_APEX` says, the flight lasts `JUMP_AIR_MS`, neither depends on the frame
// rate. The last section checks that those numbers *separate the three obstacle classes by
// arithmetic alone* -- that a low rock is cleared, a boulder is not, and an overhead branch is hit
// only by a snail that jumped into it. If that fails, the fix is a constant, never a flag: the
// moment anything asks "is this obstacle jumpable?" the model has been replaced by a lookup table
// and the third class stops being free.
import assert from 'node:assert/strict'
import {
  SHADOW_APEX,
  SHADOW_GROUND_ALPHA,
  shadowAlpha,
  shadowInk,
  shadowScale,
} from '../src/run/shadows.ts'
import { createPlayerState, jump, stepPlayer } from '../src/run/playerMotion.ts'
import {
  JUMP_AIR_MS,
  JUMP_APEX,
  JUMP_GRAVITY,
  JUMP_LAUNCH_V,
  OBSTACLE_BANDS,
  PLAYER_BODY_H,
} from '../src/run/constants.ts'
import { FIXED_STEP_MS } from '../src/race/constants.ts'

let passed = 0
function check(name, fn) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

/**
 * Flies one jump at `hz` and reports it.
 *
 * Time is counted in *ticks* rather than in wall clock: the landing happens on whichever tick `y`
 * would have gone negative, so a 144Hz run and a 60Hz one land on the same tick and at slightly
 * different wall-clock instants. Ticks are the thing that has to agree.
 */
function fly(hz = 60, steer = { targetFraction: 0.5, active: false }) {
  const dt = 1000 / hz
  let state = jump(createPlayerState())
  let apex = 0
  let apexAtMs = 0
  let elapsed = 0
  let airMs = 0

  for (let i = 0; i < Math.round((hz * 5) / 1); i++) {
    state = stepPlayer(state, steer, dt)
    elapsed += dt
    if (state.y > apex) {
      apex = state.y
      apexAtMs = elapsed
    }
    if (state.grounded) {
      airMs = elapsed

      break
    }
  }

  return { apex, apexAtMs, airMs, state }
}

/** Whether two closed intervals overlap — the same test `obstacles.ts` will run. */
function overlaps(aLow, aHigh, bLow, bHigh) {
  return aLow < bHigh && bLow < aHigh
}

console.log('src/run/playerMotion.ts -- the arc')

check('gravity and launch velocity are solved from the air time and the apex, not tuned', () => {
  // The formulas in `constants.ts`, re-derived here rather than copied: if someone replaces the
  // derivation with a hand-picked number, this is what says so.
  const T = JUMP_AIR_MS / 1000

  assert.ok(Math.abs(JUMP_GRAVITY - (8 * JUMP_APEX) / (T * T)) < 1e-9, 'g is not 8h/T^2')
  assert.ok(Math.abs(JUMP_LAUNCH_V - (JUMP_GRAVITY * T) / 2) < 1e-9, 'v0 is not gT/2')
  // ...and the closed-form apex of that arc is the apex it was solved for.
  assert.ok(Math.abs((JUMP_LAUNCH_V * JUMP_LAUNCH_V) / (2 * JUMP_GRAVITY) - JUMP_APEX) < 1e-9)
  console.log(`    T=${JUMP_AIR_MS}ms h=${JUMP_APEX}u give g=${JUMP_GRAVITY.toFixed(0)}u/s^2 and v0=${JUMP_LAUNCH_V.toFixed(0)}u/s`)
})

check('the integrator reaches JUMP_APEX within 1%', () => {
  const { apex } = fly()

  assert.ok(
    Math.abs(apex - JUMP_APEX) <= JUMP_APEX * 0.01,
    `the arc peaked at ${apex.toFixed(1)}u against a target of ${JUMP_APEX}u`,
  )
  console.log(`    apex ${apex.toFixed(1)}u (${(((apex - JUMP_APEX) / JUMP_APEX) * 100).toFixed(2)}% off the closed form)`)
})

check('the flight lasts JUMP_AIR_MS, to within one tick', () => {
  const { airMs } = fly()

  assert.ok(
    Math.abs(airMs - JUMP_AIR_MS) <= FIXED_STEP_MS,
    `the snail was airborne for ${airMs.toFixed(1)}ms against ${JUMP_AIR_MS}ms`,
  )
  console.log(`    airborne ${airMs.toFixed(1)}ms, apex at ${fly().apexAtMs.toFixed(1)}ms (half of ${JUMP_AIR_MS} is ${JUMP_AIR_MS / 2})`)
})

check('apex and air time are the same at 30, 60 and 144 Hz', () => {
  // The invariance that makes the obstacle tables mean anything: an arc that is higher on a
  // 144Hz phone clears things a 60Hz one does not, and no amount of tuning fixes that.
  const runs = [30, 60, 144].map((hz) => ({ hz, ...fly(hz) }))
  const [slow, normal, fast] = runs

  for (const run of runs) {
    assert.ok(
      Math.abs(run.apex - normal.apex) < JUMP_APEX * 0.02,
      `${run.hz}Hz peaked at ${run.apex.toFixed(1)} against 60Hz's ${normal.apex.toFixed(1)}`,
    )
    assert.ok(
      Math.abs(run.airMs - normal.airMs) <= 1000 / run.hz + FIXED_STEP_MS,
      `${run.hz}Hz flew for ${run.airMs.toFixed(1)}ms against 60Hz's ${normal.airMs.toFixed(1)}ms`,
    )
  }
  console.log(
    `    30Hz ${slow.apex.toFixed(1)}u/${slow.airMs.toFixed(0)}ms, 60Hz ${normal.apex.toFixed(1)}u/${normal.airMs.toFixed(0)}ms, 144Hz ${fast.apex.toFixed(1)}u/${fast.airMs.toFixed(0)}ms`,
  )
})

check('the landing pins y to exactly zero rather than leaving it under the road', () => {
  const { state } = fly()

  assert.equal(state.y, 0)
  assert.equal(state.vy, 0)
  assert.equal(state.grounded, true)
})

console.log('one jump, no more')

check('jump() in the air is a no-op -- there is no double jump', () => {
  let state = jump(createPlayerState())

  for (let i = 0; i < 12; i++) state = stepPlayer(state, { targetFraction: 0.5, active: false }, FIXED_STEP_MS)

  const midAir = { ...state }
  const again = jump(state)

  assert.deepEqual({ ...again }, midAir, 'a second jump changed the state mid-flight')
  assert.equal(again.vy, midAir.vy, 'the arc was re-launched')
})

check('jump() on the ground always launches, and always at the same velocity', () => {
  // A fixed arc is what makes the window predictable. Held-to-go-higher would turn "can I clear
  // this" into a question with no stable answer, which the three-band model cannot express.
  for (const from of [createPlayerState(), fly().state]) {
    assert.equal(jump(from).vy, JUMP_LAUNCH_V)
    assert.equal(jump(from).grounded, false)
  }
})

check('the jump does not disturb the steering', () => {
  // The two axes share a tick, so a bug in one integrating into the other is a real possibility --
  // and it would show up as the snail drifting sideways every time it left the ground.
  let grounded = createPlayerState()
  let airborne = jump(createPlayerState())

  for (let i = 0; i < 40; i++) {
    grounded = stepPlayer(grounded, { targetFraction: 0.8, active: true }, FIXED_STEP_MS)
    airborne = stepPlayer(airborne, { targetFraction: 0.8, active: true }, FIXED_STEP_MS)
  }

  assert.ok(
    Math.abs(grounded.offsetX - airborne.offsetX) < 1e-12,
    `steering differed in the air: ${airborne.offsetX} against ${grounded.offsetX} on the ground`,
  )
})

console.log('the three classes, by arithmetic')

check('the body band is [y, y + PLAYER_BODY_H] and nothing else decides a hit', () => {
  const { apex } = fly()
  const onGround = [0, PLAYER_BODY_H]
  const atApex = [apex, apex + PLAYER_BODY_H]

  // A low obstacle: hit on the ground, cleared at the apex. This is the only class a jump saves
  // you from, and if it ever stops being cleared the whole verb is gone.
  assert.equal(overlaps(...onGround, OBSTACLE_BANDS.low.yLow, OBSTACLE_BANDS.low.yHigh), true, 'a low obstacle misses a grounded snail')
  assert.equal(overlaps(...atApex, OBSTACLE_BANDS.low.yLow, OBSTACLE_BANDS.low.yHigh), false, 'a low obstacle is not cleared at the apex')

  // A blocking obstacle: hit on the ground *and* at the apex, so it can only be gone around. This
  // is what stops the optimal play from being "hold jump".
  assert.equal(overlaps(...onGround, OBSTACLE_BANDS.blocking.yLow, OBSTACLE_BANDS.blocking.yHigh), true)
  assert.equal(
    overlaps(...atApex, OBSTACLE_BANDS.blocking.yLow, OBSTACLE_BANDS.blocking.yHigh),
    true,
    'a blocking obstacle is jumpable -- it must not be',
  )

  // An overhead: missed on the ground, hit at the apex. The class that punishes being airborne,
  // and the reason the model needs three rows rather than two.
  assert.equal(
    overlaps(...onGround, OBSTACLE_BANDS.overhead.yLow, OBSTACLE_BANDS.overhead.yHigh),
    false,
    'an overhead hits a snail that is running underneath it',
  )
  assert.equal(
    overlaps(...atApex, OBSTACLE_BANDS.overhead.yLow, OBSTACLE_BANDS.overhead.yHigh),
    true,
    'an overhead does not punish jumping into it',
  )

  console.log(`    grounded [0, ${PLAYER_BODY_H}] / apex [${apex.toFixed(0)}, ${(apex + PLAYER_BODY_H).toFixed(0)}]`)
  for (const [kind, band] of Object.entries(OBSTACLE_BANDS)) {
    const g = overlaps(...onGround, band.yLow, band.yHigh) ? 'hit' : 'clear'
    const a = overlaps(...atApex, band.yLow, band.yHigh) ? 'hit' : 'clear'

    console.log(`      ${kind.padEnd(9)} [${band.yLow}, ${band.yHigh}]  grounded: ${g.padEnd(5)} apex: ${a}`)
  }
})

check('a low obstacle is cleared for a usable slice of the flight, not just at the peak', () => {
  // **The window is the mechanic.** An apex that only just clears would mean the jump had to be
  // frame-perfect, which is a different (and worse) game. Measured as the fraction of the flight
  // during which the body band is above a low obstacle.
  let state = jump(createPlayerState())
  let ticks = 0
  let clearTicks = 0

  while (!state.grounded && ticks < 600) {
    state = stepPlayer(state, { targetFraction: 0.5, active: false }, FIXED_STEP_MS)
    ticks++
    if (!overlaps(state.y, state.y + PLAYER_BODY_H, OBSTACLE_BANDS.low.yLow, OBSTACLE_BANDS.low.yHigh)) clearTicks++
  }

  const fraction = clearTicks / ticks

  assert.ok(fraction > 0.5, `only ${(fraction * 100).toFixed(0)}% of the flight clears a low obstacle`)
  console.log(
    `    ${(fraction * 100).toFixed(0)}% of a ${JUMP_AIR_MS}ms flight clears a low obstacle — a ${((fraction * JUMP_AIR_MS) / 1).toFixed(0)}ms window`,
  )
})

check('the overhead is not so low that a grounded snail grazes it', () => {
  // The gap between the snail's back and the overhead's underside is the margin that keeps the
  // third class readable as "run under this" rather than "sometimes run under this".
  const clearance = OBSTACLE_BANDS.overhead.yLow - PLAYER_BODY_H

  assert.ok(clearance > 0, 'the overhead band starts inside the snail')
  assert.ok(clearance >= PLAYER_BODY_H * 0.3, `only ${clearance}u of headroom under an overhead`)
  console.log(`    ${clearance}u of headroom (${((clearance / PLAYER_BODY_H) * 100).toFixed(0)}% of the snail's own height)`)
})

check('the shadow reports height: it spreads as it fades, and never fades to nothing', () => {
  // **⚠ This project has already shipped the invisible version of this shadow once.** That one
  // shrank AND faded with height: the two multiply, so at the apex it was 41px wide at alpha 0.18
  // on grey asphalt -- gone at the one moment its whole job is to say how high the snail is. The
  // rule is reversed now, spreading while fading, and the reversal is only safe because the two
  // terms pull against each other. That is arithmetic, and it is invisible in any single frame,
  // which is why it is asserted here rather than looked at.
  assert.ok(shadowScale(0) < shadowScale(JUMP_APEX), 'the shadow does not spread with height')
  assert.ok(shadowAlpha(0) > shadowAlpha(JUMP_APEX), 'the shadow does not weaken with height')

  // Both monotone across the arc, or the same size would mean two different heights.
  for (let y = 0; y < JUMP_APEX; y += JUMP_APEX / 40) {
    const next = y + JUMP_APEX / 40

    assert.ok(shadowScale(next) >= shadowScale(y), `the spread reverses between ${y} and ${next}`)
    assert.ok(shadowAlpha(next) <= shadowAlpha(y), `the fade reverses between ${y} and ${next}`)
  }

  // The one that matters: total ink on the ground must not collapse.
  const ground = shadowInk(0)
  const apex = shadowInk(JUMP_APEX)

  assert.ok(
    apex >= ground * 0.8,
    `the apex shadow carries ${(apex / ground).toFixed(2)} of the ground one's ink -- wide and weak has become gone`,
  )

  // Shown to reject the arrangement it replaced: shrinking and fading together.
  const shrunk = (1 / (1 + JUMP_APEX / 260)) ** 2 * (SHADOW_GROUND_ALPHA * SHADOW_APEX.alphaKept)

  assert.ok(
    shrunk < ground * 0.8,
    'shrink-and-fade is not being rejected, so this check is measuring nothing',
  )

  // And the height has to be *readable*, not merely different: a spread the eye cannot separate
  // from the ground ellipse is a gauge with one mark on it.
  assert.ok(
    shadowScale(JUMP_APEX) / shadowScale(0) > 1.4,
    `the apex ellipse is only ${shadowScale(JUMP_APEX).toFixed(2)}x the ground one -- too close to tell apart`,
  )

  console.log(
    `    ground: scale ${shadowScale(0).toFixed(2)} alpha ${shadowAlpha(0).toFixed(3)}; apex: scale ${shadowScale(JUMP_APEX).toFixed(2)} alpha ${shadowAlpha(JUMP_APEX).toFixed(3)}; ink ${ground.toFixed(2)} -> ${apex.toFixed(2)} (shrink-and-fade would give ${shrunk.toFixed(2)})`,
  )
})

console.log(`${passed} checks passed`)
