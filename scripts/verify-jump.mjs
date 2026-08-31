#!/usr/bin/env node
// Logic check for the vertical half of src/run/playerMotion.ts -- the jump arc, and the claim the
// whole obstacle model rests on. Plain assertions, no framework, via the register-ts-loader.mjs +
// ts-extensionless-loader.mjs Node-native-TS setup.
//
// **The last section is the one that matters.** Everything before it is ordinary arc arithmetic:
// the apex is where `JUMP_APEX` says, the flight lasts `JUMP_AIR_MS`, neither depends on the frame
// rate. The last section checks that those numbers *separate the three obstacle classes by
// arithmetic alone* -- that a low barrier is cleared by a jump and a tall one is not, and that
// nothing hits an airborne snail alone. If that fails, the fix is a constant, never a flag: the
// moment anything asks "is this obstacle jumpable?" the model has been replaced by a lookup table
// and the third class stops being free.
import assert from 'node:assert/strict'
import {
  SHADOW_APEX,
  SHADOW_FOOTPRINT,
  SHADOW_GROUND_ALPHA,
  shadowAlpha,
  shadowClipFade,
  shadowInk,
  shadowLinkFade,
  shadowScale,
} from '../src/run/shadows.ts'
import { PICKUP_BOB, PICKUP_HEIGHT, PICKUP_SHADOW_LINK } from '../src/run/pickups.ts'
import { RAMP_APEX, RAMP_LAUNCH_V } from '../src/run/ramp.ts'
import { flightDuration, flightHeight } from '../src/run/playerMotion.ts'
import { createPlayerState, jump, stepPlayer } from '../src/run/playerMotion.ts'
import {
  JUMP_AIR_MS,
  JUMP_APEX,
  JUMP_GRAVITY,
  JUMP_LAUNCH_V,
  OBSTACLE_BANDS,
  MASCOT_ASPECT,
  PLAYER_BODY_H,
  PLAYER_HALF_WIDTHS,
  PLAYER_WIDTH,
} from '../src/run/constants.ts'
import { FIXED_STEP_MS } from '../src/race/constants.ts'
import { ROAD_WIDTH } from '../src/road/constants.ts'

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

console.log('the two classes, by arithmetic')

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

  // **⚠ THERE WAS A THIRD CLASS AND IT IS GONE, SO ASSERT WHAT REPLACED ITS JOB.** `overhead` was
  // `[362, 560]` — missed on the ground, hit at the apex — and it was what punished being airborne.
  // It was removed because it cannot be DRAWN: the sprite's canvas is the collision band, so a band
  // starting above the snail is drawn floating, and three attempts at making that acceptable were
  // all reported. See `OBSTACLE_BANDS`.
  //
  // What is left holding the jump honest is that `blocking` reaches past the apex, which the pair
  // of assertions above states. Nothing in the game now hits *only* an airborne snail, and the
  // check says so out loud rather than leaving it to be discovered:
  const airOnly = Object.values(OBSTACLE_BANDS).filter(
    (band) => !overlaps(...onGround, band.yLow, band.yHigh) && overlaps(...atApex, band.yLow, band.yHigh),
  )

  assert.equal(airOnly.length, 0, 'a class hits only an airborne snail — the model has three rows again')

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

check('⚠ the drawn box is the proportion of the art, so the mascot cannot be stretched', () => {
  // **Nothing asserted this, and that is how it broke.** A round widened `PLAYER_HALF_WIDTHS` to
  // make the snail readable on a phone and left `PLAYER_BODY_H` alone: the box went to 420x180
  // against art that is 224x139, a **45% horizontal stretch**, and it was reported at once as the
  // snail looking flat. The three axes are solved from one height and one measured aspect now, so
  // the stretch is not a thing that can be typed — but a check is what says so out loud.
  const aspect = PLAYER_WIDTH / PLAYER_BODY_H

  assert.ok(
    Math.abs(aspect - MASCOT_ASPECT) < 1e-9,
    `the drawn box is ${aspect.toFixed(3)}:1 against art at ${MASCOT_ASPECT.toFixed(3)}:1`,
  )
  // And the collision half-width is that same box, not a number of its own -- the pancake bug in
  // the other direction is a box wider than the sprite, which gets you hit by things you cleared.
  assert.ok(Math.abs(PLAYER_HALF_WIDTHS * 2 * ROAD_WIDTH - PLAYER_WIDTH) < 1e-9)

  // Shown to reject: the pair that shipped for one round.
  assert.ok(Math.abs(420 / 180 - MASCOT_ASPECT) > 0.5, 'the stretched pair would pass this check')
  console.log(
    `    ${PLAYER_WIDTH.toFixed(0)}x${PLAYER_BODY_H} at ${aspect.toFixed(2)}:1, ` +
      `${(PLAYER_HALF_WIDTHS * 100).toFixed(1)}% of the road's full width (it spans two half-widths)`,
  )
})

check('⚠ a mark far from its object is not a shadow: an arc chain casts none', () => {
  // **The reported defect, and it is about distance rather than about pools.** Measured in the
  // running game over 38 344 drawn shadows there were **0 orphans** -- every mark had a live owner
  // -- and yet the worst case drew a coin 416px wide with a 597px ellipse **847px below it on a
  // 945px frame**. The object at the top of the screen, its mark at the bottom, nothing linking
  // them: the shadow of a thing visible where the thing is not.
  //
  // The gap, in the object's own drawn heights, measured over 33 185 draws:
  //   pickups on the ground line   0.17 - 0.23    reads as a pair
  //   overhead obstacles           0.90           reads as a pair
  //   pickups on a ramp arc        up to 2.06     reads as an orphan
  assert.equal(shadowLinkFade(0, PICKUP_SHADOW_LINK.full, PICKUP_SHADOW_LINK.gone), 1)
  assert.equal(shadowLinkFade(PICKUP_HEIGHT, PICKUP_SHADOW_LINK.full, PICKUP_SHADOW_LINK.gone), 1)
  // The bob may never dim a pickup lying on the ordinary ground line -- it would blink.
  assert.equal(shadowLinkFade(PICKUP_HEIGHT + PICKUP_BOB, PICKUP_SHADOW_LINK.full, PICKUP_SHADOW_LINK.gone), 1)

  // Monotone and continuous across the band, or two neighbours in one chain disagree visibly.
  let previous = 1

  for (let y = 0; y <= PICKUP_SHADOW_LINK.gone * 1.5; y += 4) {
    const now = shadowLinkFade(y, PICKUP_SHADOW_LINK.full, PICKUP_SHADOW_LINK.gone)

    assert.ok(now <= previous + 1e-12, `the link fade reverses at ${y}`)
    assert.ok(previous - now < 0.06, `the link fade steps by ${(previous - now).toFixed(3)} at ${y}`)
    previous = now
  }

  // **The arc is asked of the flight solver, not typed in.** `formations.ts` lays an arc at
  // `flightHeight(v0, t) + PICKUP_HEIGHT` and skips both ends, so the LOWEST member of the
  // shortest chain is what has to clear the band -- if that one still cast a mark the row would
  // be half shadowed and half not.
  const duration = flightDuration(RAMP_LAUNCH_V)
  const shortest = 3
  const lowest = flightHeight(RAMP_LAUNCH_V, duration / (shortest + 1)) + PICKUP_HEIGHT
  const apex = RAMP_APEX + PICKUP_HEIGHT

  assert.equal(
    shadowLinkFade(lowest, PICKUP_SHADOW_LINK.full, PICKUP_SHADOW_LINK.gone),
    0,
    `the lowest coin of a ramp arc sits at ${lowest.toFixed(0)}u and still casts a mark`,
  )
  assert.equal(shadowLinkFade(apex, PICKUP_SHADOW_LINK.full, PICKUP_SHADOW_LINK.gone), 0)

  // **Shown to reject a band that does not reach**, so the two assertions above cannot pass by
  // being asked of a threshold nothing could fail. A `gone` set just past the arc's apex leaves
  // every member of the chain marking the road, which is the arrangement that shipped.
  const unfaded = shadowLinkFade(lowest, PICKUP_SHADOW_LINK.full, apex * 4)

  assert.ok(
    unfaded > 0.8,
    `a band that never reaches is not being rejected (${unfaded.toFixed(2)}), so this is measuring nothing`,
  )

  console.log(
    `    full to ${PICKUP_SHADOW_LINK.full}u, gone by ${PICKUP_SHADOW_LINK.gone}u; ` +
      `ground pickup ${PICKUP_HEIGHT}u keeps 1.00, lowest arc coin ${lowest.toFixed(0)}u keeps 0.00, ` +
      `arc apex ${apex.toFixed(0)}u keeps 0.00 (a band that never reaches leaves it at ${unfaded.toFixed(2)})`,
  )
})

check('⚠ the hill clips the mark as well as the object', () => {
  // **A shadow lies in the ground plane, so a crest covers it like anything else on that segment
  // -- and nothing was clipping it.** `billboardVisibleFraction` was applied to the sprite only,
  // so the pools cropped the object against the ridge and drew its mark straight through the
  // hillside. Measured live over 63 758 on-screen draws: 6 271 (10.6%) drawn with their ground
  // point behind a crest, 1 171 (1.8%) drawn while the object above them was under 35% visible.
  //
  // It is the crest's ordering that makes this the visible half: a hill hides a billboard from the
  // bottom up, so the object's top emerges first and its mark last. The mark is exactly the part
  // that should still be hidden.
  const markHeight = 8

  // **⚠ On flat road `clipY` IS the segment's own ground row**, so a mark centred on the ground
  // straddles it. Anything measured against the mark's EXTENT therefore reports every shadow in
  // the game as half hidden -- which is what the first version of this check did. The test is the
  // centre, and on the flat that has to come out at exactly full strength.
  assert.equal(shadowClipFade(500, markHeight, 500), 1, 'a mark on flat road is being clipped')
  assert.equal(shadowClipFade(500, markHeight, 520), 1, 'a mark clear of the crest is being clipped')

  // Past the crest it goes, and it is gone by the time the ridge has crossed the mark itself.
  assert.equal(shadowClipFade(500 + markHeight / 2, markHeight, 500), 0)
  assert.equal(shadowClipFade(500 + markHeight, markHeight, 500), 0)
  assert.ok(shadowClipFade(500 + markHeight / 4, markHeight, 500) < 1)

  // Monotone and continuous across the band, or the mark blinks as the crest crosses it.
  let previous = 1

  for (let hidden = 0; hidden <= markHeight; hidden += markHeight / 40) {
    const now = shadowClipFade(500 + hidden, markHeight, 500)

    assert.ok(now <= previous + 1e-12, `the clip fade reverses at ${hidden}`)
    previous = now
  }

  // **The case that was reported, stated as arithmetic.** An overhead 21px past the clip line was
  // drawn at full strength with 1% of the obstacle above it visible; with the fade it draws at 0.
  assert.equal(shadowClipFade(500 + 21, 59 * (SHADOW_FOOTPRINT.height / SHADOW_FOOTPRINT.width), 500), 0)

  // Shown to reject the arrangement that shipped: no clip term at all is a constant 1.
  assert.ok(1 > shadowClipFade(500 + markHeight, markHeight, 500), 'an unclipped mark is not being rejected')

  console.log(
    `    flat road keeps 1.00; a mark ${markHeight / 4}px past the crest keeps ` +
      `${shadowClipFade(500 + markHeight / 4, markHeight, 500).toFixed(2)}, one half a mark past it keeps 0.00`,
  )
})

console.log(`${passed} checks passed`)
