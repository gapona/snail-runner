#!/usr/bin/env node
// Logic check for src/ui/menuLayout.ts -- the front screen's zones and its entry budget. Plain
// assertions, no framework, via the register-ts-loader.mjs + ts-extensionless-loader.mjs
// Node-native-TS setup.
//
// **What is worth checking here is the composition, not the drawing.** Where a block of text ends
// up is a property of the frame and of five constants, and the two failures this screen has
// actually had were both of that kind: a title that fitted at every size anybody looked at and
// overflowed the one nobody did, and a button row that shrank the primary action along with the
// decoration. Neither is visible in a screenshot of the viewport it happens to be taken at.
import assert from 'node:assert/strict'
import { HORIZON_Y } from '../src/road/constants.ts'
import { SUN, sunCenterX, sunSize } from '../src/road/constants.ts'
import { PLAYER_REST_Y_FRACTION } from '../src/run/constants.ts'
import {
  buttonBand,
  intersects,
  mascotFeetRow,
  mascotLift,
  MENU_ENTRY,
  MENU_ZONES,
  obstacleBand,
  titleBand,
  titleRow,
} from '../src/ui/menuLayout.ts'

let passed = 0

function check(name, fn) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

/** The viewports the menu is accepted at, narrowest first. */
const VIEWPORTS = [
  [320, 568],
  [375, 667],
  [390, 844],
  [844, 390],
  [1080, 1920],
  [1920, 1080],
]

console.log('the entry budget')

check('every element is on screen inside the budget, and the budget is what the brief asked for', () => {
  // **⚠ The failure this catches is a delay creeping past a duration.** The cascade is three tweens
  // and the last one starts last; adding 40ms to its delay "to let the button land first" is the
  // most natural edit in the world and it is the one that pushes the screen past the budget.
  const steps = Object.entries(MENU_ENTRY).filter(([key]) => key !== 'budgetMs')

  for (const [name, step] of steps) {
    const ends = step.delay + step.duration

    assert.ok(
      ends <= MENU_ENTRY.budgetMs,
      `${name} finishes at ${ends}ms, past the ${MENU_ENTRY.budgetMs}ms budget`,
    )
  }

  assert.equal(MENU_ENTRY.budgetMs, 400)
  console.log(
    `    ${steps.map(([name, step]) => `${name} ${step.delay}+${step.duration}=${step.delay + step.duration}ms`).join(', ')}` +
      ` against a ${MENU_ENTRY.budgetMs}ms budget`,
  )
})

check('the primary action is not the thing that waits longest', () => {
  // Play is what the screen is for. A cascade that lands it last is one where the player watches
  // the decoration arrive before the button they came to press.
  assert.ok(MENU_ENTRY.play.delay < MENU_ENTRY.corner.delay, 'the corner icons arrive before Play')
})

console.log('the zones')

check('the bands are ordered, disjoint and inside the frame', () => {
  const z = MENU_ZONES

  assert.ok(z.HUD_BOTTOM <= z.TITLE_TOP, 'the title starts above the HUD rows it must clear')
  assert.ok(z.TITLE_TOP < z.TITLE_BOTTOM, 'the title band is empty or inverted')
  assert.ok(z.TITLE_BOTTOM <= z.BAND_TOP, 'the title reaches into the obstacle band')
  assert.ok(z.BAND_BOTTOM <= z.BUTTONS_TOP, 'the buttons reach into the obstacle band')
  assert.ok(z.BUTTONS_TOP < z.SAFE_BOTTOM, 'the button band is empty or inverted')
  assert.ok(z.SAFE_BOTTOM < 1, 'the button band runs off the bottom of the frame')
})

check('⚠ nothing is laid on the vanishing point', () => {
  // **Every line in the frame converges at `HORIZON_Y`** — the road's two edges, the rumble
  // stripes, the centre marking and the verge — so text there is read against more edges than
  // anywhere else on screen. The title band ends above it and the button band starts below it, and
  // the check is stated against the projection's own constant rather than against a copy of it.
  assert.ok(MENU_ZONES.TITLE_BOTTOM < HORIZON_Y, 'the title band reaches the horizon')
  assert.ok(MENU_ZONES.BUTTONS_TOP > HORIZON_Y, 'the button band reaches the horizon')

  const clearance = Math.min(HORIZON_Y - MENU_ZONES.TITLE_BOTTOM, MENU_ZONES.BUTTONS_TOP - HORIZON_Y)

  assert.ok(clearance >= 0.15, `only ${(clearance * 100).toFixed(0)}% of the frame clears the horizon`)
  console.log(`    horizon ${HORIZON_Y}, title ends ${MENU_ZONES.TITLE_BOTTOM}, buttons start ${MENU_ZONES.BUTTONS_TOP}`)
})

check('the title band is the largest of the three, because it is the only empty part of a run', () => {
  // The brief's own instruction, stated as arithmetic: use the empty upper part of the frame. If a
  // future edit gives the buttons more room by taking it from the title, this is what says so.
  const height = 1000
  const title = titleBand(height).height
  const buttons = buttonBand(height).height

  assert.ok(title > buttons, `the title band is ${title} against the buttons' ${buttons}`)
})

check('every band holds a 44px touch target at the narrowest supported frame', () => {
  // 320x568 is the floor the menu is accepted at, and the button band is where the only two things
  // that must be *pressed* live. A band shorter than a touch target is a band that cannot hold one.
  const [, height] = VIEWPORTS[0]

  assert.ok(buttonBand(height).height >= 44, `the button band is ${buttonBand(height).height.toFixed(0)}px at ${height}`)
  assert.ok(titleBand(height).height >= 44, `the title band is ${titleBand(height).height.toFixed(0)}px at ${height}`)
  console.log(
    `    at ${VIEWPORTS[0][0]}x${height}: title ${titleBand(height).height.toFixed(0)}px, buttons ${buttonBand(height).height.toFixed(0)}px`,
  )
})

console.log('the rule the bands exist for')

check('intersects reports a block that reaches into a band, and one that does not', () => {
  // **The layout puts things where they go and this asks afterwards whether anything ended up
  // somewhere it may not be.** The two halves are separate on purpose: a rule enforced only by the
  // code that follows it has no way to fail.
  const height = 1000
  const band = obstacleBand(height)

  assert.equal(intersects(band.top + 10, band.bottom - 10, band), true, 'a block inside the band is not reported')
  assert.equal(intersects(0, band.top - 1, band), false, 'a block above the band is reported')
  assert.equal(intersects(band.bottom + 1, height, band), false, 'a block below the band is reported')
  // Touching is not intersecting: a title whose last row is the band's first row is fine.
  assert.equal(intersects(0, band.top, band), false, 'a block ending exactly at the band is reported')
})

check('⚠ the shipped bands leave the obstacle rows to the obstacles', () => {
  // Shown against the values themselves rather than against a fixture, so a future edit to
  // `MENU_ZONES` is what fails rather than a copy of it drifting quietly.
  const height = 1000
  const band = obstacleBand(height)

  assert.equal(intersects(titleBand(height).top, titleBand(height).bottom, band), false, 'the title enters the band')
  assert.equal(intersects(buttonBand(height).top, buttonBand(height).bottom, band), false, 'the buttons enter the band')
})

check('⚠ the wordmark clears the sun on every frame, and stays inside its own band', () => {
  // Reported from an iPhone SE: the sun was drawn through the title. `SUN.y` is 0.2 of the frame's
  // height and `SUN.size` 0.3 of it, so the sun occupies 0.05..0.35 — very nearly the whole title
  // band (0.13..0.36). On a landscape frame the two never meet, because the title is left-aligned
  // and the sun sits at 0.76 of the width; on a portrait one the title is scaled to 88% of the
  // width and runs straight underneath it.
  //
  // Two things fix it and only together are they enough: `sunSize` bounds the sun by the frame's
  // *width*, and `titleRow` pushes the title down under what is left. Both are measured here, and
  // the second is measured with the first switched off, so neither can be credited with the other's
  // work.
  let pushedFrames = 0
  let worstClearance = Infinity

  for (const [width, height] of VIEWPORTS) {
    const band = titleBand(height)
    // The title as `MainMenu.layoutTitle` builds it: left-aligned at the side margin, scaled down
    // until it fits both the band's height and 88% of the frame's width.
    const face = Math.min(height * 0.155, width * 0.155)
    const title = { left: width * 0.04, width: Math.min(width * 0.88, face * 5.4), height: face }
    const row = titleRow(width, height, title)

    assert.ok(
      row - title.height / 2 >= band.top - 0.5 && row + title.height / 2 <= band.bottom + 0.5,
      `at ${width}x${height} the title runs ${(row - title.height / 2).toFixed(0)}..${(row + title.height / 2).toFixed(0)} outside its band ${band.top.toFixed(0)}..${band.bottom.toFixed(0)}`,
    )

    const half = sunSize(width, height) / 2
    const sunLeft = sunCenterX(width, height) - half
    const sunRight = sunCenterX(width, height) + half
    const sunBottom = height * SUN.y + half
    const apart = title.left + title.width <= sunLeft || title.left >= sunRight

    if (!apart) {
      pushedFrames += 1
      assert.ok(
        row > titleBand(height).centre - 0.5,
        `at ${width}x${height} the title was not moved out of the sun's way`,
      )
      const clearance = row - title.height / 2 - sunBottom

      assert.ok(clearance >= 0, `at ${width}x${height} the sun reaches ${(-clearance).toFixed(0)}px into the title`)
      worstClearance = Math.min(worstClearance, clearance)
    }
  }

  assert.ok(pushedFrames > 0, 'no supported frame puts the sun behind the title, so `titleRow` is untested')

  // **The negative control is the sun as it shipped** — sized off the height alone. It has to still
  // reach into the title on some frame, or the width bound is being credited for nothing.
  let unboundedOverlaps = 0

  for (const [width, height] of VIEWPORTS) {
    const band = titleBand(height)
    const face = Math.min(height * 0.155, width * 0.155)
    const bottom = height * SUN.y + (height * SUN.size) / 2

    if (bottom > band.bottom - face) unboundedOverlaps += 1
  }

  assert.ok(unboundedOverlaps > 0, 'the unbounded sun fits above every title, so this check measures nothing')
  console.log(
    `    ${pushedFrames} of ${VIEWPORTS.length} frames put the sun over the wordmark and are pushed clear by ` +
      `${worstClearance.toFixed(1)}px at the tightest; unbounded, ${unboundedOverlaps} of them leave the title no room at all`,
  )
})

console.log('the mascot stands as far up the road as it has to, and no further')

/**
 * The lift's own constants, restated because they live on `MainMenu`'s `MASCOT` — which imports
 * `phaser` as a value and is therefore unreachable from here. Same reason `verify:ui` restates
 * `uiScale`.
 */
const LIFT = { minZ: 2.4, maxZ: 6, clearance: 14 }

/**
 * Roughly where the Play stack's top lands, for a frame — the row the mascot has to clear.
 *
 * The real one is `MainMenu.stackTop`: the button band's centre, clamped hard above the nav bar.
 * What is restated here is the clamped branch, which is the one that binds on every frame narrow
 * enough for this check to be about.
 */
function stackTopFor(height, scale) {
  const stack = (66 + 10 + 44) * scale

  return Math.min(buttonBand(height).centre - stack / 2, height - 61 * scale - 10 * scale - stack)
}

check('⚠ the lift is solved per frame, and a roomy frame keeps the composition it had', () => {
  let lifted = 0
  let unlifted = 0

  for (const [width, height] of VIEWPORTS) {
    const scale = Math.min(1, Math.max(0.8, width / 400))
    const top = stackTopFor(height, scale)
    const lift = mascotLift({
      height,
      stackTop: top,
      clearance: LIFT.clearance * scale,
      horizon: HORIZON_Y,
      rest: PLAYER_REST_Y_FRACTION,
      minZ: LIFT.minZ,
      maxZ: LIFT.maxZ,
    })

    assert.ok(lift.z >= LIFT.minZ, `${width}x${height}: the lift went under its own floor`)
    assert.ok(lift.z <= LIFT.maxZ, `${width}x${height}: the lift went over its own ceiling`)

    if (lift.z > LIFT.minZ) lifted += 1
    else unlifted += 1

    if (!lift.clears) continue

    // The feet land exactly where they were asked to, i.e. `clearance` above the stack.
    const feet = mascotFeetRow(height, HORIZON_Y, PLAYER_REST_Y_FRACTION, lift.z)

    assert.ok(
      feet <= top - LIFT.clearance * scale + 0.5,
      `${width}x${height}: the feet land at ${feet.toFixed(1)} against a stack top of ${top.toFixed(1)}`,
    )
    // And never past the horizon, which is the asymptote rather than a rule anybody enforces.
    assert.ok(feet > height * HORIZON_Y, `${width}x${height}: the feet passed the vanishing point`)
  }

  assert.ok(lifted > 0, 'no supported frame needs a lift, so the derivation is doing nothing')
  assert.ok(unlifted > 0, 'every frame is lifted, so the floor is doing nothing')
  console.log(`    ${lifted} of ${VIEWPORTS.length} frames are lifted; the other ${unlifted} keep the floor`)
})

check('⚠ ONE lift cannot serve every frame, which is what the derivation replaced', () => {
  // The control is the constant this shipped as: 3.6, picked to clear the button on the frame it
  // was reported from. Measured live at 320x568 it left a **0px** gap — the pad touching the
  // button's rim — which is what a constant does at the narrow end of a range it was tuned at the
  // middle of.
  const CONSTANT = 3.6
  let touching = 0
  let overshot = 0

  for (const [width, height] of VIEWPORTS) {
    const scale = Math.min(1, Math.max(0.8, width / 400))
    const top = stackTopFor(height, scale)
    const feet = mascotFeetRow(height, HORIZON_Y, PLAYER_REST_Y_FRACTION, CONSTANT)
    const gap = top - feet
    const solved = mascotLift({
      height,
      stackTop: top,
      clearance: LIFT.clearance * scale,
      horizon: HORIZON_Y,
      rest: PLAYER_REST_Y_FRACTION,
      minZ: LIFT.minZ,
      maxZ: LIFT.maxZ,
    })

    if (gap < LIFT.clearance * scale) touching += 1
    // A frame the solve leaves at its floor is one the constant was pushing up the road for nothing.
    if (solved.z <= LIFT.minZ && CONSTANT > LIFT.minZ) overshot += 1
  }

  assert.ok(touching > 0, 'the constant clears every frame, so the derivation bought nothing at the narrow end')
  assert.ok(overshot > 0, 'the constant is needed on every frame, so it costs nothing at the wide end')
  console.log(
    `    a constant ${CONSTANT} leaves ${touching} of ${VIEWPORTS.length} frames inside the clearance and ` +
      `lifts ${overshot} that did not need it at all`,
  )
})

console.log(`${passed} checks passed`)
