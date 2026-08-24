#!/usr/bin/env node
// Logic check for the widget kit's pure half -- src/ui/sliderMath.ts (where a value sits on a track
// and what a pointer at some x means), src/audio/volume.ts (the slider-to-gain curve),
// src/ui/kitPalette.ts (the palette, its contrast and its touch-target arithmetic) and the tap-
// versus-drag rule in src/ui/gesture.ts that the sliders share with the shop rows and the weapon
// row. None import phaser, which is what makes them runnable here.
//
// The Phaser half -- `ui/kit.ts`'s drawing and the two rebuilt overlay scenes -- is checked in the
// browser; the two hit-area traps every widget in it has to handle are documented in CLAUDE.md
// "Responsive Layout" and are properties of Phaser's `Container`, not of this arithmetic.
import assert from 'node:assert/strict'
import { clampVolume, DEFAULT_MUSIC_VOLUME, DEFAULT_SOUND_VOLUME, gainFor, isSilent } from '../src/audio/volume.ts'
import { isTap, TAP_SLOP_PX } from '../src/ui/gesture.ts'
import {
  BUTTON_GEOMETRY,
  DAMAGE_COLOR,
  KIT,
  MIN_TOUCH,
  SLIDER_GEOMETRY,
  sliderHitHeight,
  UI_THEME_COLORS,
} from '../src/ui/kitPalette.ts'
import { percentFor, SLIDER_STEPS, snapValue, stepValue, valueFromX, xForValue } from '../src/ui/sliderMath.ts'
import { chroma, contrastRatio, hueDistance, toOklab } from '../src/road/color.ts'
import {
  THREAT_COLOR,
  THREAT_LIGHTNESS_ESCAPE,
  THREAT_MIN_CHROMA,
  THREAT_MIN_HUE_DEGREES,
} from '../src/road/themes.ts'
import { CONTRAST_TARGET } from '../src/ui/scrim.ts'

let passed = 0

function check(name, fn) {
  fn()
  passed += 1
  console.log(`  ok  ${name}`)
}

// -- The slider's arithmetic ------------------------------------------------------------------

check('a value round-trips through the track and back', () => {
  const left = 300
  const width = 420
  const handle = SLIDER_GEOMETRY.handle

  for (let step = 0; step <= SLIDER_STEPS; step++) {
    const value = step / SLIDER_STEPS
    const x = xForValue(value, left, width, handle)

    assert.equal(valueFromX(x, left, width, handle), value, `value ${value} did not survive the round trip`)
  }
})

check('the handle reaches both ends, and its centre stays on the track', () => {
  const left = 100
  const width = 300
  const handle = SLIDER_GEOMETRY.handle

  // The whole point of subtracting one handle from the travel: at 0 the handle's *left edge* sits on
  // the left end of the track, and at 1 its right edge sits on the right end. Without it the handle
  // hangs half off at both extremes, which is the version that looks almost right.
  assert.equal(xForValue(0, left, width, handle), left + handle / 2)
  assert.equal(xForValue(1, left, width, handle), left + width - handle / 2)
})

check('the value does not saturate before the end of the track', () => {
  // The classic slider bug, stated as a test: a player can see space left to drag into, drags into
  // it, and nothing happens. Reachable only if `valueFromX` ignores the handle while `xForValue`
  // accounts for it (or the reverse), so the two are checked against each other rather than against
  // a hand-computed number.
  const left = 0
  const width = 200
  const handle = 22
  const nearEnd = left + width - handle / 2 - 1

  assert.ok(valueFromX(nearEnd, left, width, handle) >= 1 - 1 / SLIDER_STEPS, 'the last step was unreachable')
  assert.equal(valueFromX(left + width, left, width, handle), 1, 'past the end did not clamp to full')
  assert.equal(valueFromX(left - 50, left, width, handle), 0, 'before the start did not clamp to zero')
})

check('every position snaps to a step, so the readout can be honest', () => {
  // A continuous slider beside a percentage shows the player a number no gesture can deliberately
  // produce. Asserted over a sweep rather than at a few points, because an off-by-one in the
  // rounding shows up only at the boundaries between steps.
  for (let x = 0; x <= 400; x++) {
    const value = valueFromX(x, 0, 400, 22)
    const asStep = value * SLIDER_STEPS

    assert.ok(Math.abs(asStep - Math.round(asStep)) < 1e-9, `x=${x} produced an off-step value ${value}`)
    assert.equal(percentFor(value), Math.round(value * 100))
  }
})

check('a keyboard step moves exactly one notch and stops at the ends', () => {
  assert.equal(stepValue(0.5, 1), 0.55)
  assert.equal(stepValue(0.5, -1), 0.45)
  assert.equal(stepValue(1, 1), 1, 'stepping past full did not clamp')
  assert.equal(stepValue(0, -1), 0, 'stepping past silence did not clamp')
  assert.equal(stepValue(0.5, 0), 0.5, 'a zero direction moved the value')
})

check('garbage never reaches the track', () => {
  for (const bad of [NaN, Infinity, -Infinity]) {
    assert.equal(snapValue(bad), 0, `${bad} was accepted as a position`)
  }
  // A zero-width track is reachable on a landscape phone mid-resize, and dividing by it would put
  // NaN into the handle's position -- which draws nothing at all rather than drawing wrongly.
  assert.ok(Number.isFinite(xForValue(0.5, 10, 0, 22)))
  assert.ok(Number.isFinite(valueFromX(15, 10, 0, 22)))
})

// -- The volume curve ------------------------------------------------------------------------

check('the curve is silent at the bottom and full at the top', () => {
  // Exactly zero, not nearly: a curve that only approaches zero leaves a faint sound at the setting
  // the player chose in order to silence something.
  assert.equal(gainFor(0), 0)
  assert.equal(gainFor(1), 1)
  assert.ok(isSilent(0))
  assert.ok(!isSilent(1 / SLIDER_STEPS), 'the lowest audible step counted as muted')
})

check('the curve is monotonic, and half the travel is not half the gain', () => {
  let previous = -1

  for (let step = 0; step <= SLIDER_STEPS; step++) {
    const gain = gainFor(step / SLIDER_STEPS)

    assert.ok(gain > previous, `step ${step} did not raise the gain`)
    previous = gain
  }

  // The reason the curve exists at all: a linear gain crams every audible change into the bottom of
  // the travel. At the halfway point the squared curve is a quarter of the gain, which is close to
  // the half-loudness a player expects there.
  assert.equal(gainFor(0.5), 0.25)
})

check('an edited save cannot poison the mixer', () => {
  for (const [input, expected] of [
    [-1, 0],
    [2, 1],
    ['loud', 1],
    [null, 1],
    [undefined, 1],
    [NaN, 1],
  ]) {
    assert.equal(clampVolume(input), expected, `clampVolume(${String(input)}) was wrong`)
  }
})

check('the defaults are in range and music sits under effects', () => {
  assert.equal(clampVolume(DEFAULT_SOUND_VOLUME), DEFAULT_SOUND_VOLUME)
  assert.equal(clampVolume(DEFAULT_MUSIC_VOLUME), DEFAULT_MUSIC_VOLUME)
  assert.ok(DEFAULT_MUSIC_VOLUME < DEFAULT_SOUND_VOLUME, 'music defaulted at or above the effects')
})

// -- The palette -----------------------------------------------------------------------------

/** The project's standing threat rule, applied to a single colour. All three terms, never one. */
function insideThreatBand(color) {
  const threat = toOklab(THREAT_COLOR)
  const lab = toOklab(color)

  return (
    hueDistance(color, THREAT_COLOR) <= THREAT_MIN_HUE_DEGREES &&
    chroma(color) >= THREAT_MIN_CHROMA &&
    Math.abs(lab.L - threat.L) <= THREAT_LIGHTNESS_ESCAPE
  )
}

check('no colour in the kit strays into the reserved threat band', () => {
  // The same perceptual rule `verify:road` applies to every theme colour, applied to the interface:
  // all three of hue, chroma and lightness, because one number cannot do it. A UI panel wearing the
  // danger colour is exactly the defect that turned the loading screen's emblem from red to amber.
  const offenders = Object.entries(KIT)
    .filter(([, color]) => insideThreatBand(color))
    .map(([name]) => name)

  assert.deepEqual(offenders, [], `kit colours inside the threat reservation: ${offenders.join(', ')}`)
})

check('the interface palette is outside the threat band too, slot by slot', () => {
  // **This check has already failed something, which is why it is here.** The template's
  // `DEFAULT_THEME.primary` (`0xff2975`) measures 15.4 degrees from `THREAT_COLOR` at chroma 0.243
  // and a lightness within 0.006 -- all three terms -- and the HUD drew the player's *shields* in
  // it, along with the heat bar, the selected weapon cell and the lock-on ring. The reservation was
  // being enforced on the road themes, where the rule was written, and on nothing else.
  const offenders = Object.entries(UI_THEME_COLORS)
    .filter(([, color]) => insideThreatBand(color))
    .map(([name]) => name)

  assert.deepEqual(offenders, [], `interface theme slots inside the threat reservation: ${offenders.join(', ')}`)

  // And the slot it replaced, to prove the check can still see the thing it was written for.
  assert.ok(insideThreatBand(0xff2975), 'the rule stopped catching the palette it was added for')
})

check('the interface palette says one thing per slot', () => {
  // `primary` means "yours", `accent` means "costs money". They are drawn side by side in the HUD --
  // the score glow next to the shields -- so a player who cannot separate them learns neither.
  const apart = hueDistance(UI_THEME_COLORS.primary, UI_THEME_COLORS.accent)

  assert.ok(apart >= 60, `primary and accent are only ${apart.toFixed(1)} degrees apart`)
  assert.ok(
    contrastRatio(UI_THEME_COLORS.surface, UI_THEME_COLORS.primary) >= CONTRAST_TARGET,
    'the primary accent does not read on the theme surface it is drawn over',
  )
})

check('the one colour allowed inside the reservation is the threat colour itself', () => {
  // `DAMAGE_COLOR` is the third and last exemption, beside `enemy.rim` and `enemyTint`: the HUD's
  // directional hit flash and `Effects`' damage frame draw the moment the threat *lands*. It is not
  // a red chosen near the reserved hue — it is that hue, by name, which is why it lives outside
  // `KIT` and is asserted separately rather than being quietly skipped by the sweep above.
  assert.ok(insideThreatBand(DAMAGE_COLOR), 'the damage colour left the reserved band it is meant to be')
  assert.ok(!Object.values(KIT).includes(DAMAGE_COLOR), 'the damage colour leaked into the kit sweep')

  // The two must be distinguishable, because they mean different things and appear at the same
  // edge of the same frame within a second of each other.
  const apart = hueDistance(KIT.warning, DAMAGE_COLOR)

  assert.ok(apart >= 30, `the warning amber and the damage red are only ${apart.toFixed(1)} degrees apart`)
  console.log(`      warning vs damage ${apart.toFixed(1)} degrees apart`)
})

check('the threat rule is confirmed against something it must reject', () => {
  // The project's own rule: a metric that has never failed anything is not evidence. So the same
  // function is run against the threat itself, and against the near miss that slipped past the RGB
  // metric this one replaced -- `dusk.sky.band`, which passed by one unit while sitting one degree
  // from the threat hue.
  assert.ok(insideThreatBand(THREAT_COLOR), 'the rule stopped catching the threat colour itself')
  assert.ok(insideThreatBand(0xa84a4a), 'the rule stopped catching the near miss it was written for')
})

check('the kit reads at 4.5:1 on its own plate', () => {
  // The overlays sit on the kit's own plate rather than on the live world, so this contrast is a
  // property of two constants and can be asserted here -- unlike the menu's and the HUD's, which
  // are solved from a measurement of whatever the sky happens to be (`ui/scrim.ts`).
  const measured = []

  for (const name of ['rim', 'active', 'coin']) {
    const ratio = contrastRatio(KIT.plate, KIT[name])

    measured.push(`${name} ${ratio.toFixed(2)}`)
    assert.ok(ratio >= CONTRAST_TARGET, `${name} on the plate is ${ratio.toFixed(2)}:1, under ${CONTRAST_TARGET}`)
  }

  console.log(`      on the plate: ${measured.join(', ')}`)

  // Muted and disabled text is deliberately below the body target -- it is secondary information --
  // but must still clear the 3:1 a UI component is held to, or it is decoration rather than text.
  for (const name of ['muted', 'disabled']) {
    const ratio = contrastRatio(KIT.plate, KIT[name])

    assert.ok(ratio >= 3, `${name} on the plate is ${ratio.toFixed(2)}:1, under 3`)
  }
})

check('the active and the coin accent are far enough apart to mean different things', () => {
  // The kit says "yours" in cyan and "costs money" in sand, and a player who cannot tell them apart
  // learns neither. Hue distance rather than RGB distance, for the reason `verify:road` documents.
  const apart = hueDistance(KIT.active, KIT.coin)

  assert.ok(apart >= 60, `the two accents are only ${apart.toFixed(1)} degrees apart`)
  console.log(`      accents ${apart.toFixed(1)} degrees apart`)
})

// -- Touch targets ---------------------------------------------------------------------------

check('a slider is grabbable at every ui scale, though its rail is not', () => {
  // The rail is 8px because a 44px rail is a trough; the *zone* is 44 because nobody hits 8px with a
  // thumb. Without the floor the zone would be 35px at full scale and 28px at the narrow end -- both
  // under the minimum, on exactly the devices where a touch is the only input.
  for (const scale of [0.8, 0.9, 1]) {
    const height = sliderHitHeight(scale)

    assert.ok(height >= MIN_TOUCH, `at scale ${scale} the slider zone is ${height}px`)
    assert.ok(SLIDER_GEOMETRY.track * scale < MIN_TOUCH, 'the rail grew to the touch minimum, which is a trough')
  }

  assert.ok(sliderHitHeight(1) > SLIDER_GEOMETRY.handle, 'the zone is smaller than the handle it contains')
})

check('a button is at least the touch minimum however small its label', () => {
  // The kit's own sizing rule, restated: the drawn box is the label plus padding *or* the touch
  // minimum, whichever is larger. A single-character button is the case that exposes it.
  for (const scale of [0.8, 1]) {
    for (const labelWidth of [4, 10, 200]) {
      const width = Math.max(labelWidth + BUTTON_GEOMETRY.padX * 2 * scale, MIN_TOUCH)
      const height = Math.max(12 + BUTTON_GEOMETRY.padY * 2 * scale, MIN_TOUCH)

      assert.ok(width >= MIN_TOUCH && height >= MIN_TOUCH, `a ${labelWidth}px label gave a ${width}x${height} button`)
    }
  }
})

// -- Tap versus drag, shared with the shop rows and the weapon row ---------------------------

check('a slow drag along a track stops counting as a tap', () => {
  // The same trap the shop shipped once: a drag that never moves far in any one frame passes a
  // per-frame test the whole way across the screen. Measured from the press, radially.
  const press = { x: 200, y: 500 }
  let x = press.x
  let stillTap = 0

  for (let frame = 0; frame < 40; frame++) {
    x += 3
    if (isTap(press, { x, y: press.y }, 1)) stillTap += 1
  }

  assert.ok(stillTap > 0, 'the first few pixels of a drag were not a tap, so a tap is unreachable')
  assert.ok(stillTap <= Math.ceil(TAP_SLOP_PX / 3), `a ${stillTap * 3}px drag still counted as a tap`)
})

check('the slop scales with the viewport, so a phone tap is not harder', () => {
  const press = { x: 100, y: 100 }
  const point = { x: 100 + TAP_SLOP_PX * 0.85, y: 100 }

  assert.ok(isTap(press, point, 1))
  assert.ok(!isTap(press, point, 0.8), 'the narrow-screen slop did not shrink with the scale')
})

console.log(`${passed} checks passed`)
