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
import { readFileSync } from 'node:fs'
import { DirtyValues } from '../src/ui/dirtyValues.ts'
import { cornerSteps, roundedRectPoints } from '../src/ui/roundedRect.ts'
import { isJumpTap, isTap as isTapBy, JUMP_TAP_MS, JUMP_TAP_SLOP_PX, TAP_SLOP_PX as LIST_TAP_SLOP_PX } from '../src/ui/scrollList.ts'
import {
  FRUIT_GAUGE_PIPS,
  FRUIT_SEGMENT,
  fruitColumnSize,
  fruitGaugeBox,
  FULL_PULSE,
  fullPulse,
  fillPulse,
  gaugeYield,
  YIELD_ALPHA,
  MAX_COLUMN_HEIGHT_FRACTION,
  pipFills,
  segmentOffsetY,
  gaugeBleed,
  GAUGE_HALO_FRACTION,
  FULL_MARK,
} from '../src/ui/fruitGauge.ts'
import {
  LIFE_ENTRY_MS,
  LIFE_PIP,
  HEART_COLOR,
  LIFE_SPEND_MS,
  entryBounce,
  entryOffset,
  lifeRowBox,
  lifeRowSize,
  lifeRowSlots,
  progressIn,
  slideEase,
  slotCentreX,
  spendFlash,
  spendSquash,
  lifeRowBleed,
  LIFE_PIP_MAX_STRETCH,
  LIFE_PIP_STROKE_FRACTION,
} from '../src/ui/lifeRow.ts'
import {
  FEVER_FRUIT_TARGET,
  HIT_INVULNERABLE_Z,
  MAX_ATTAINABLE_SPEED,
  MAX_SHIELDS,
  OFFROAD_LIMIT,
  ROAD_EDGE,
  STEER_REACH_MARGIN,
  PLAYER_BODY_H,
  PLAYER_REST_Y_FRACTION,
  PLAYER_WIDTH,
  PLAYER_Z,
  RUN_LIVES,
} from '../src/run/constants.ts'
import { CAMERA_DEPTH, CAMERA_HEIGHT, ROAD_WIDTH, SPRITE_SCALE } from '../src/road/constants.ts'
import { createScreenPoint, projectInto } from '../src/road/project.ts'
import { billboardRectInto, createBillboardRect } from '../src/road/billboard.ts'
import { clampVolume, DEFAULT_MUSIC_VOLUME, DEFAULT_SOUND_VOLUME, gainFor, isSilent, LEGACY_DEFAULT_MUSIC_VOLUME, MASTER_GAIN_CEILING, migratedMusicVolume, MUSIC_GAIN_CEILING, musicGainFor, soundGainFor } from '../src/audio/volume.ts'
import { isTap, TAP_SLOP_PX } from '../src/ui/gesture.ts'
import { exitButtonBox } from '../src/ui/exitButton.ts'
import { EXIT_SAFE, exitIsClearOfThumb, TOP_BAR, topBarHeight, topBarLayout } from '../src/ui/topBar.ts'
import { NAV_BAR, NAV_SURFACE, navBarBoxes, navBarHeight } from '../src/ui/navLayout.ts'
import {
  QUEST_BAR_SEGMENTS,
  QUEST_CHIP,
  QUEST_PANEL,
  QUEST_ROW,
  questBarBox,
  questBoardHeight,
  questChipSize,
  questPanelHeightFor,
  questPanelSize,
  questRowColumns,
  questSegmentBox,
  questWindowHeight,
  QUEST_WINDOW_PEEK,
} from '../src/ui/questLayout.ts'
import { secondaryMaxWidth } from '../src/ui/menuLayout.ts'
import { titleBand } from '../src/ui/menuLayout.ts'
import { PICKUP_COLORS } from '../src/run/artPalette.ts'
import {
  BUTTON_GEOMETRY,
  DAMAGE_COLOR,
  HUD_SCALE,
  hudScale,
  KIT,
  MIN_TOUCH,
  SLIDER_GEOMETRY,
  sliderHitHeight,
  UI_THEME_COLORS,
} from '../src/ui/kitPalette.ts'
import { percentFor, SLIDER_STEPS, snapValue, stepValue, valueFromX, xForValue } from '../src/ui/sliderMath.ts'
import { GARAGE_LAYOUT, wardrobeStack, wardrobeStripHeight } from '../src/ui/garageLayout.ts'
import { readableScale } from '../src/run/constants.ts'
import { EXIT_ALPHA, EXIT_GLYPH, EXIT_PLATED_ALPHA } from '../src/ui/exitButton.ts'
import { chroma, contrastRatio, hueDistance, relativeLuminance, toOklab } from '../src/road/color.ts'
import {
  accentBackdrop,
  accentContrast,
  THEMES,
  THREAT_COLOR,
  THREAT_LIGHTNESS_ESCAPE,
  THREAT_MIN_CHROMA,
  THREAT_MIN_HUE_DEGREES,
} from '../src/road/themes.ts'

/**
 * How far a fixed interface face may sit from the theme's own accent before it reads as foreign.
 *
 * A regression threshold rather than a derived value, and it is used as a *control*: the front
 * screen's two controls are both painted in the accent now, so what this says is how far the kit's
 * own slate was from it when the mode chip wore that slate and was reported for it.
 */
const FOREIGN_FACE_HUE_DRIFT = 12

const hex = (n) => '#' + n.toString(16).padStart(6, '0')
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

check('the music ceiling lowers the top without moving the bottom', () => {
  // The point of the ceiling: the loudest the music can be is under the loudest an effect can be.
  assert.ok(MUSIC_GAIN_CEILING < 1, 'a ceiling of 1 is no ceiling')
  assert.equal(musicGainFor(1), MUSIC_GAIN_CEILING * MASTER_GAIN_CEILING)
  assert.ok(musicGainFor(1) < soundGainFor(1), 'music at full is not under effects at full')

  // Silence has to survive it, or the slider stops being able to switch the channel off - which is
  // why this is a factor on the gain rather than a rescale of the slider.
  assert.equal(musicGainFor(0), 0)
  assert.ok(isSilent(0), 'the bottom of the travel stopped counting as off')

  // Every step still moves, so the ceiling costs headroom and not resolution.
  let previous = -1

  for (let step = 0; step <= SLIDER_STEPS; step++) {
    const gain = musicGainFor(step / SLIDER_STEPS)

    assert.ok(gain > previous, `step ${step} did not raise the music gain`)
    previous = gain
  }
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

check('both sliders default to full, and at full the music still sits under the effects', () => {
  // **The mix is carried by the gain now, not by the slider position.** Music used to default to
  // 70% so that it sat under the effects; a slider reading 70% on a fresh install reads as something
  // turned down for no reason. What sits it under the effects is `MUSIC_GAIN_CEILING`.
  assert.equal(DEFAULT_SOUND_VOLUME, 1)
  assert.equal(DEFAULT_MUSIC_VOLUME, 1)
  assert.ok(musicGainFor(DEFAULT_MUSIC_VOLUME) < soundGainFor(DEFAULT_SOUND_VOLUME), 'music at its default is at or above the effects')
})

check('the whole game is 15% quieter at its defaults and at its top, and the mix did not move', () => {
  // Asked for after playing: the maximum should be about 15% less deafening. The control is the
  // shipped-before arrangement, written as its own arithmetic: effects at a gain of 1, music at
  // 0.7² under a ceiling of 0.8.
  const before = { sound: 1, music: 0.7 ** 2 * 0.8 }
  const after = { sound: soundGainFor(DEFAULT_SOUND_VOLUME), music: musicGainFor(DEFAULT_MUSIC_VOLUME) }

  assert.equal(MASTER_GAIN_CEILING, 0.85)
  assert.ok(Math.abs(after.sound / before.sound - 0.85) < 1e-12, `effects at default are ${after.sound} of before`)
  assert.ok(Math.abs(after.music / before.music - 0.85) < 1e-12, `music at default is ${after.music / before.music} of before`)
  assert.ok(Math.abs(after.music / after.sound - before.music / before.sound) < 1e-12, 'the balance between music and effects moved')
  assert.ok(soundGainFor(1) < gainFor(1), 'the effects top is not under the old top')

  // And the silence at the bottom survives the ceiling on both channels.
  assert.equal(soundGainFor(0), 0)
  assert.equal(musicGainFor(0), 0)
})

check('a saved music slider is re-expressed on the new scale, keeping what the player hears', () => {
  // The old default lands on the new one, which is the case the migration exists for.
  assert.equal(migratedMusicVolume(LEGACY_DEFAULT_MUSIC_VOLUME), 1)
  assert.equal(migratedMusicVolume(0), 0, 'a muted slider came back audible')
  assert.equal(migratedMusicVolume(0.35), 0.5)
  assert.equal(migratedMusicVolume(1), 1, 'a slider above the old default went past the top')

  // Below the old default the loudness is kept to within a 5% slider step, less the master ceiling.
  for (const old of [0.1, 0.2, 0.35, 0.5, 0.6, 0.7]) {
    const was = gainFor(old) * 0.8
    const now = musicGainFor(migratedMusicVolume(old))

    assert.ok(Math.abs(now / (was * MASTER_GAIN_CEILING) - 1) < 0.16, `a slider at ${old} now plays at ${(now / was).toFixed(2)} of what it did`)
  }
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

check('⚠ every button face is one blue, and the tiers differ by weight rather than by hue', () => {
  // **Reported off the result panel: the buttons are different colours, they should all be one
  // blue.** The instructive part is that the shipped slates were already in the right *hue* — 8 to
  // 12 degrees off the navigation blue — and read as greys anyway, because what makes a colour
  // legible as a colour is chroma and theirs was under a third of the blue's.
  //
  // **⚠ Measured on the face as PAINTED.** The first version of this check composited each face
  // over the plate at `kitButton`'s `fillAlpha`, which is real and belongs to the *fallback*
  // drawing; the shipped look is `bakeUiSprite` and paints the face opaque. Sampling the running
  // frame is what caught it. The alphas are not restated here at all — there is nothing to restate.
  const tiers = [
    ['btnFace', KIT.btnFace],
    ['btnMuted', KIT.btnMuted],
    ['disabled', KIT.disabled],
  ].map(([name, colour]) => ({ name, colour, hue: hueDistance(colour, KIT.btnFace), chroma: chroma(colour) }))

  for (const tier of tiers) {
    assert.ok(tier.hue <= 12, `${tier.name} is ${tier.hue.toFixed(1)} degrees off the navigation blue`)
  }

  // **The tiers are told apart by chroma, and the ladder is the assertion.** Equal chroma is three
  // identical faces; a tier louder than the one above it inverts the hierarchy.
  for (let i = 1; i < tiers.length; i += 1) {
    assert.ok(
      tiers[i].chroma < tiers[i - 1].chroma * 0.9,
      `${tiers[i].name} is not visibly quieter than ${tiers[i - 1].name} (${tiers[i].chroma.toFixed(3)} against ${tiers[i - 1].chroma.toFixed(3)})`,
    )
  }

  // **And every tier has to carry enough chroma to read as a colour at all** — the half a hue test
  // cannot see, and the half that was actually wrong. Held as a share of `btnFace`'s own, so the
  // floor follows the family rather than being a number to keep in step with it.
  const floor = chroma(KIT.btnFace) / 4

  for (const tier of tiers) {
    assert.ok(tier.chroma >= floor, `${tier.name} is at chroma ${tier.chroma.toFixed(3)}, under the family floor of ${floor.toFixed(3)}`)
  }

  // The negative control: the two hexes that shipped. Both pass the hue test and the greyer of them
  // fails the floor, which is the whole finding — a check on hue alone would have called this clean.
  const shipped = [0x5a6b80, 0x6b7a8a]

  assert.ok(
    shipped.every((colour) => hueDistance(colour, KIT.btnFace) <= 13),
    'the shipped slates were not in the blue family after all, so this control proves nothing',
  )
  assert.ok(
    shipped.some((colour) => chroma(colour) < floor),
    'the shipped slates now clear the chroma floor, i.e. this check no longer rejects what it was written for',
  )

  for (const tier of tiers) {
    console.log(`      ${tier.name.padEnd(9)} chroma ${tier.chroma.toFixed(3)}  ${tier.hue.toFixed(1)} degrees off the blue`)
  }
  console.log(
    `      floor ${floor.toFixed(3)}; the shipped slates were ${shipped.map((colour) => chroma(colour).toFixed(3)).join(' and ')}`,
  )
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

// -- The two corner readouts ------------------------------------------------------------------

/**
 * Where the mascot is actually drawn, in screen pixels, on flat road at a given lateral offset.
 *
 * Built out of the game's own projection and its own billboard maths rather than from a remembered
 * pixel size, because that is the only version of it that stays true when `PLAYER_BODY_H`, the
 * field of view or the rest row moves. `verify:sightline` reimplements the mesh's walk for the same
 * reason and records the same caveat: a reimplementation is only evidence for the code it mirrors.
 */
/**
 * The life row as the HUD actually draws it: `lifeRowBox`, pushed below the mascot's feet.
 *
 * Mirrors `Hud`'s own `clearOfFeet`, and carries the same caveat every reimplementation in these
 * scripts carries — `Hud.ts` imports phaser, so the clamp cannot be reached from here, and this is
 * only evidence for the code it mirrors. What makes it honest is that both read the same two
 * constants and neither invents a number.
 */
function rowBoxAsDrawn(width, height, scale) {
  const box = lifeRowBox(width, height, scale, MAX_ROW_SLOTS)
  const feet = height * PLAYER_REST_Y_FRACTION
  const floor = height - FEET_CLEARANCE * scale - box.h

  return { ...box, y: Math.min(Math.max(box.y, feet + FEET_CLEARANCE * scale), Math.max(0, floor)) }
}

/** `Hud`'s own `FEET_CLEARANCE`, restated for the reason above. */
const FEET_CLEARANCE = 4

function mascotBox(width, height, offsetX) {
  const ground = projectInto(
    createScreenPoint(),
    { x: 0, y: 0, z: PLAYER_Z },
    0,
    CAMERA_HEIGHT,
    0,
    CAMERA_DEPTH,
    width,
    height,
    ROAD_WIDTH,
  )
  const rect = billboardRectInto(
    createBillboardRect(),
    ground,
    offsetX,
    0,
    PLAYER_WIDTH / SPRITE_SCALE,
    PLAYER_BODY_H / SPRITE_SCALE,
    width,
    height,
  )

  // Bottom-centre origin: the sprite is drawn upward from its feet.
  return { left: rect.x - rect.w / 2, right: rect.x + rect.w / 2, top: rect.y - rect.h, bottom: rect.y }
}

/** Every viewport this HUD is accepted at, narrowest first. */
const VIEWPORTS = [
  [320, 568, 0.8],
  [375, 667, 0.8],
  [844, 390, 1],
  [1280, 720, 1],
  [1920, 945, 1],
]

/** The longest the row ever is: every shield the run can carry plus every life. */
const MAX_ROW_SLOTS = MAX_SHIELDS + RUN_LIVES

check('the two corner readouts cannot be given a world position', () => {
  // **The check a report asked for, in the strongest form available: there is nothing to test.**
  // The gauge was once reported as standing on the horizon between the rocks and the road. Measured
  // in the running game it was on `uiCamera` the whole time with an identity transform -- what put
  // it there was its *anchor*, which was the mascot's projected head, and the snail is drawn just
  // under the vanishing point.
  //
  // So the anchor is gone, and this is what says so: both boxes are solved from numbers about the
  // frame, and a function never handed a camera, a projection or a distance has no branch that
  // could return a world position. The arity is asserted rather than the output, because an output
  // can be right on the day it is measured where an argument list cannot grow by accident.
  assert.equal(fruitGaugeBox.length, 3, 'fruitGaugeBox took an argument that is not the frame')
  assert.equal(lifeRowBox.length, 4, 'lifeRowBox took an argument that is not the frame or the count')
  assert.equal(fruitColumnSize.length, 2)
  assert.equal(lifeRowSize.length, 2)
  assert.equal(slotCentreX.length, 2)
  assert.equal(segmentOffsetY.length, 2)

  // And the consequence, driven rather than argued: the same frame gives the same boxes however far
  // the run has travelled, because there is no way to tell either of them how far that is.
  const gauge = fruitGaugeBox(1920, 945, 1)
  const row = lifeRowBox(1920, 945, 1, MAX_ROW_SLOTS)

  for (const _distance of [0, 1000, 250000, 9999999]) {
    assert.deepEqual(fruitGaugeBox(1920, 945, 1), gauge, 'the tank moved between two identical frames')
    assert.deepEqual(lifeRowBox(1920, 945, 1, MAX_ROW_SLOTS), row, 'the row moved between two identical frames')
  }
})

check('both readouts stay inside the frame, at every supported viewport', () => {
  for (const [w, h, scale] of VIEWPORTS) {
    const gauge = fruitGaugeBox(w, h, scale)
    const row = rowBoxAsDrawn(w, h, scale)

    for (const [name, box] of [
      ['tank', gauge],
      ['row', row],
    ]) {
      assert.ok(box.x >= 0 && box.x + box.w <= w + 1e-9, `the ${name} left a ${w}x${h} frame sideways`)
      assert.ok(box.y >= 0 && box.y + box.h <= h + 1e-9, `the ${name} left a ${w}x${h} frame vertically`)
    }

    // The top third carries the distance and the coins and nothing else, so neither bottom-corner
    // readout may reach into it. The tank is the one that can, being upright.
    assert.ok(
      gauge.h <= h * MAX_COLUMN_HEIGHT_FRACTION + 1e-9,
      `the tank is ${Math.round((gauge.h / h) * 100)}% of a ${h}px frame tall`,
    )
    assert.ok(gauge.y > h / 3, `the tank reaches y ${Math.round(gauge.y)} of ${h}, into the top third`)
    assert.ok(row.y > h / 3, `the row reaches y ${Math.round(row.y)} of ${h}, into the top third`)
    // Two readouts in two corners: they must not meet in the middle on the narrowest frame.
    assert.ok(row.x + row.w < gauge.x, `the row and the tank overlap on a ${w}x${h} frame`)
  }

  const tank = fruitGaugeBox(320, 568, hudScale(320, 568))
  const row = lifeRowBox(320, 568, hudScale(320, 568), MAX_ROW_SLOTS)

  console.log(
    `    320x568: row ${Math.round(row.w)}x${Math.round(row.h)} bottom-left, ` +
      `tank ${Math.round(tank.w)}x${Math.round(tank.h)} bottom-right`,
  )
})

check('the row is never drawn over the mascot, at any viewport or any lock', () => {
  // **This is the check the placement rests on, and the corner it puts the row in has been reported
  // once before.** A block carrying the fruit gauge and the lives sat in the bottom-left and covered
  // the snail on a portrait phone -- *we cannot be seen behind this panel*.
  //
  // What made the row safe was the axis rather than a smaller margin: it sat **below the mascot's
  // feet**, in a band no amount of steering enters.
  //
  // **⚠ That nearly stopped being true when the snail came nearer for its size.**
  // `STEER_REACH_MARGIN` crossed 1 to buy a quantum of `PLAYER_Z`, which moved the feet from 87.4%
  // of the frame to 90.9% — and on a 844x390 landscape phone that leaves 35px under them for a 26px
  // row plus a 20px margin. Measured here at full left lock: a 7px overlap. The rule is kept rather
  // than traded for a yield (a wide row barely dims for a corner touch, which is worse than either
  // clearing or dimming properly): the row is pushed **down** to clear the feet, and the box this
  // measures is the one the HUD draws after that push.
  let tightest = { gap: Infinity, where: '' }

  for (const [w, h, scale] of VIEWPORTS) {
    const row = rowBoxAsDrawn(w, h, scale)

    for (let i = 0; i <= 200; i++) {
      const offsetX = -OFFROAD_LIMIT + (2 * OFFROAD_LIMIT * i) / 200
      const snail = mascotBox(w, h, offsetX)
      // Overlap is only overlap on both axes; the row relies on the vertical one.
      const vertical = row.y - snail.bottom
      const horizontal = Math.max(snail.left - (row.x + row.w), row.x - snail.right)
      const gap = Math.max(vertical, horizontal)

      assert.ok(
        gap > 0,
        `the row overlaps the mascot at ${w}x${h}, offset ${offsetX.toFixed(2)}: ` +
          `row ${Math.round(row.x)}..${Math.round(row.x + row.w)} x ` +
          `${Math.round(row.y)}..${Math.round(row.y + row.h)}, snail ` +
          `${Math.round(snail.left)}..${Math.round(snail.right)} x ` +
          `${Math.round(snail.top)}..${Math.round(snail.bottom)}`,
      )

      if (gap < tightest.gap) tightest = { gap, where: `${w}x${h} at offset ${offsetX.toFixed(2)}` }
    }
  }

  console.log(`    tightest row clearance ${tightest.gap.toFixed(1)}px -- ${tightest.where}`)

  // **Shown to reject the arrangement it replaced.** The block that was reported was about 100px
  // tall in the same corner, so a row that height must fail the same measurement -- otherwise this
  // check would pass anything put in the bottom-left and would be evidence for nothing.
  const slab = { ...lifeRowBox(320, 568, hudScale(320, 568), MAX_ROW_SLOTS), h: 100 }
  const snail = mascotBox(320, 568, -OFFROAD_LIMIT)

  slab.y = 568 - 16 * 0.8 - slab.h
  assert.ok(
    slab.y - snail.bottom <= 0 && snail.left - (slab.x + slab.w) <= 0,
    'the 100px block this replaced would pass the clearance check, so the check proves nothing',
  )
})

check('the tank cannot clear the mascot, so it yields to it instead', () => {
  // **⚠ The bottom-right corner is not clearable, and that is arithmetic rather than a bad margin.**
  // `PLAYER_Z` is solved so a finger at the screen's edge can still ask for the road's edge
  // (`STEER_REACH_MARGIN`), which puts the asphalt's own edge just off screen: the road measures
  // **102% of the frame** at the player's row. So the mascot's drawn box reaches the frame's right
  // edge at full lock and crosses anything standing on it.
  //
  // The row escapes this by clearing *vertically* -- it lives under the feet. A tank tall enough to
  // hold eight readable segments does not fit in that band on a short landscape frame (33px at
  // 844x390), so it cannot buy its clearance the same way and has to yield instead.
  //
  // This asserts the fact rather than working around it silently, so nobody spends another round
  // trying to solve it with a narrower column.
  const meetings = []

  for (const [w, h, scale] of VIEWPORTS) {
    const tank = fruitGaugeBox(w, h, scale)
    let met = null

    for (let i = 0; i <= 2000 && met === null; i++) {
      const offsetX = (i / 2000) * OFFROAD_LIMIT
      const snail = mascotBox(w, h, offsetX)

      if (snail.right > tank.x && snail.bottom > tank.y && snail.top < tank.y + tank.h) met = offsetX
    }

    assert.ok(met !== null, `the tank clears the mascot at ${w}x${h}, so the yield is dead code`)
    meetings.push(`${w}x${h} ${met.toFixed(2)}`)

    // And no width would have fixed it: clearing at maximum steer needs a left edge off the frame.
    const atMaxSteer = mascotBox(w, h, ROAD_EDGE * STEER_REACH_MARGIN)

    assert.ok(atMaxSteer.right > w, `the mascot stays inside a ${w}x${h} frame at full lock`)
  }

  console.log(`    the mascot meets the tank at |offsetX| ${meetings.join(', ')} (road edge ${ROAD_EDGE.toFixed(2)})`)

  // The yield itself: clear means untouched, covered means dimmed but never gone. A readout that
  // vanished would be indistinguishable from one that had broken.
  const tank = fruitGaugeBox(320, 568, hudScale(320, 568))

  assert.equal(gaugeYield(tank, mascotBox(320, 568, 0)), 1, 'the tank dimmed with the mascot nowhere near it')
  assert.equal(gaugeYield(tank, mascotBox(320, 568, -OFFROAD_LIMIT)), 1, 'the tank dimmed for the far side')

  // Swept rather than sampled at the extreme: past the road's edge the snail is off the frame
  // entirely, so the *most* covered the tank ever is happens in the middle of the verge.
  const swept = Array.from({ length: 401 }, (_, i) => gaugeYield(tank, mascotBox(320, 568, (i / 400) * OFFROAD_LIMIT)))
  const covered = Math.min(...swept)

  assert.ok(covered < 1, 'the tank never yields, i.e. the mascot never actually reaches it')
  assert.ok(covered >= YIELD_ALPHA - 1e-9, 'the tank faded past its own floor, i.e. it can vanish')
  assert.ok(covered <= YIELD_ALPHA + 0.02, `the tank only ever dims to ${covered.toFixed(2)}, which is not a yield`)

  // Ramped rather than switched: a snail sliding along the right edge dims the tank smoothly and
  // brings it back the same way. A readout that flickers on and off with the steering is worse
  // than one that is covered.
  for (let i = 1; i < swept.length; i++) {
    assert.ok(Math.abs(swept[i] - swept[i - 1]) < 0.2, 'the yield steps rather than ramping')
  }
  assert.equal(swept[0], 1, 'the tank was already dimmed with the mascot at rest')
  assert.equal(swept[swept.length - 1], 1, 'the tank stayed dimmed after the mascot had passed it')

  console.log(`    the tank dims to ${covered.toFixed(2)} at its worst, and is at full strength at rest`)
})

// -- The survivability row -------------------------------------------------------------------

check('shields and lives are one row, in the order they are spent', () => {
  // **The whole point of the readout: the length of the lit run is the answer.** Two counters meant
  // finding both and adding them up, which is not a thing a player does mid-dodge.
  const slots = lifeRowSlots(1, 3, RUN_LIVES)

  assert.equal(slots.length, MAX_ROW_SLOTS, 'a full set is not one element per hit survived')
  assert.equal(slots[0].kind, 'shield', 'the shield is not first, so the leftmost element is not the next to go')
  assert.ok(
    slots.every((s) => s.filled),
    'a full set had something already spent',
  )

  // Spent left to right: the shield goes first, then the hearts, and what is left is always a
  // prefix of gaps followed by a suffix of lit elements. A row with a hole in it would have no
  // direction, and the direction is what teaches the shield's mechanic without a word of text.
  for (const [shields, lives] of [
    [1, 3],
    [0, 3],
    [0, 2],
    [0, 1],
    [0, 0],
  ]) {
    const row = lifeRowSlots(shields, lives, RUN_LIVES)
    const lit = row.filter((s) => s.filled).length

    assert.equal(lit, shields + lives, `${shields}+${lives} did not light ${shields + lives} elements`)

    let seenGap = false

    for (const slot of row) {
      if (!slot.filled) seenGap = true
      else assert.ok(!seenGap, `${shields}+${lives} lit an element after a spent one`)
    }
  }

  // A life is a slot and a shield is carried, which is the asymmetry the row is built on: spending
  // a life leaves a socket that says what was lost, spending the shield shortens the row again.
  assert.equal(lifeRowSlots(0, 1, RUN_LIVES).length, RUN_LIVES, 'a spent life stopped leaving a socket')
  assert.equal(lifeRowSlots(0, 3, RUN_LIVES).length, RUN_LIVES, 'an empty shield section left a socket behind')
})

check('the heart is red, and it is the one red the threat reservation allows', () => {
  // **⚠ Every ordinary heart colour is inside the reserved band.** `THREAT_COLOR` is the warm red
  // that means *something has landed on you*, and the reservation covers 30 degrees of hue round
  // it -- `f2617a` measures 10.2 degrees away, `ff6b81` 9.1, a deep crimson 3.5. A heart cannot be
  // any of those without the frame saying "damage" with the same colour it says "life".
  //
  // The rule has three terms and a colour clears it by defeating any one of them. This red keeps
  // the hue -- it is *supposed* to look red -- and escapes on **lightness**, which is what this
  // asserts: if someone darkens it toward a richer red it walks straight into the reservation, and
  // the check fails before the frame does.
  const hue = hueDistance(HEART_COLOR, THREAT_COLOR)
  const light = Math.abs(relativeLuminance(HEART_COLOR) - relativeLuminance(THREAT_COLOR))
  const reserved = hue < THREAT_MIN_HUE_DEGREES && chroma(HEART_COLOR) >= THREAT_MIN_CHROMA && light < THREAT_LIGHTNESS_ESCAPE

  assert.ok(!reserved, `the heart is inside the reserved threat band: ${hue.toFixed(1)} deg, dL ${light.toFixed(3)}`)
  assert.ok(hue < THREAT_MIN_HUE_DEGREES, `the heart is ${hue.toFixed(1)} degrees off the threat hue, i.e. it is not red any more`)
  assert.ok(light >= THREAT_LIGHTNESS_ESCAPE, 'the heart no longer escapes on lightness, which is the only escape it has')
  console.log(`    heart #${HEART_COLOR.toString(16)}: ${hue.toFixed(1)} deg from the threat hue, escaping on lightness at dL ${light.toFixed(3)}`)

  // A heart and a shield are told apart by silhouette *and* colour, so the two may never converge.
  assert.ok(
    hueDistance(HEART_COLOR, PICKUP_COLORS.shield.mid) > 60,
    'the heart and the shield have drifted into one hue family',
  )

  // And it has to be readable on the one plate the interface draws readouts against.
  assert.ok(contrastRatio(HEART_COLOR, KIT.plate) >= 4.5, 'the heart does not read on the interface plate')

  // Shown to reject the colour that was asked for first -- a saturated mid red, which is the whole
  // reason this check exists rather than a comment.
  const naive = 0xf2617a
  const naiveReserved =
    hueDistance(naive, THREAT_COLOR) < THREAT_MIN_HUE_DEGREES &&
    chroma(naive) >= THREAT_MIN_CHROMA &&
    Math.abs(relativeLuminance(naive) - relativeLuminance(THREAT_COLOR)) < THREAT_LIGHTNESS_ESCAPE

  assert.ok(naiveReserved, 'an ordinary mid red no longer trips the reservation, so this proves nothing')
})

check('every element is the same size on the same centre line', () => {
  // **The two kinds differ in silhouette and colour and in nothing else.** A bigger or a raised
  // shield reads as a badge standing next to a counter, which is the arrangement being replaced --
  // so there is deliberately only one radius and one pitch in the whole module, and this is what
  // says a second one has not appeared.
  const scale = 0.8
  const d = LIFE_PIP.radius * 2 * scale

  for (let i = 1; i < MAX_ROW_SLOTS; i++) {
    const gap = slotCentreX(i, scale) - slotCentreX(i - 1, scale) - d

    assert.ok(Math.abs(gap - LIFE_PIP.gap * scale) < 1e-9, 'the elements are not evenly spaced')
    assert.ok(gap > 2, `the elements are ${gap.toFixed(1)}px apart, which reads as one bar`)
  }

  const size = lifeRowSize(MAX_ROW_SLOTS, scale)

  assert.ok(Math.abs(size.h - d) < 1e-9, 'the row is taller than one element, i.e. something is off the line')
  assert.ok(
    Math.abs(slotCentreX(MAX_ROW_SLOTS - 1, scale) + d / 2 - size.w) < 1e-9,
    'the last element does not end where the row does',
  )
})

check('an element goes out inside the grace the hit bought', () => {
  // `HIT_INVULNERABLE_Z` is a *distance*, so what it is worth in milliseconds depends on how fast
  // the run is going -- and the fast end is the one that matters, because an element still visibly
  // dying when the player can be hit again is a readout showing them a life they no longer have at
  // exactly the moment the count has to be right. Same bound, and the same reasoning, as
  // `SHIELD_POP`'s own.
  const graceMs = (HIT_INVULNERABLE_Z / MAX_ATTAINABLE_SPEED) * 1000

  assert.ok(
    LIFE_SPEND_MS < graceMs,
    `an element takes ${LIFE_SPEND_MS}ms to go out against ${graceMs.toFixed(0)}ms of grace at top speed`,
  )
  console.log(`    spend ${LIFE_SPEND_MS}ms against ${graceMs.toFixed(0)}ms of grace at top speed`)

  // The squash is a squash rather than a shrink: it flattens before it collapses, which is the one
  // deformation that reads as being *spent* rather than as fading out.
  const mid = spendSquash(0.2)

  assert.ok(mid.x > mid.y, 'the dying element is taller than it is wide, i.e. it shrinks rather than squashes')
  assert.deepEqual(spendSquash(0), { x: 1, y: 1 }, 'the element was already deformed on the frame it was spent')
  assert.ok(spendSquash(1).x <= 1e-9 && spendSquash(1).y <= 1e-9, 'the element was still there when its window ended')

  // The flash is what says *now*, so it is front-loaded and finishes well inside the squash.
  assert.equal(spendFlash(0), 1)
  assert.equal(spendFlash(1), 0)
  assert.equal(spendFlash(0.6), 0, 'the flash outlived the squash, i.e. the element glows rather than being struck')
})

check('an arriving element bounces in, and the row eases open rather than jumping', () => {
  // A back-out overshoot: it grows past its size and settles, which is what reads as *landing*.
  assert.ok(Math.abs(entryBounce(0)) < 1e-9, 'the arriving element started at full size')
  assert.ok(Math.abs(entryBounce(1) - 1) < 1e-9, 'the arriving element did not land at its own size')
  assert.ok(
    Math.max(...Array.from({ length: 40 }, (_, i) => entryBounce(i / 39))) > 1.05,
    'the entry never overshoots, i.e. it eases in rather than bouncing',
  )

  // It flies in from before the row's start -- the spend order read backwards, because the thing
  // arriving is going to the front of the queue and the front of the queue goes first.
  assert.ok(Math.abs(entryOffset(0) - 1) < 1e-9, 'the arriving element started at home')
  assert.ok(Math.abs(entryOffset(1)) < 1e-9, 'the arriving element never got home')

  // The hearts slide rather than teleport, monotonically and landing exactly.
  let previous = -1

  for (let i = 0; i <= 40; i++) {
    const slid = slideEase(i / 40)

    assert.ok(slid >= previous, 'the slide went backwards')
    previous = slid
  }
  assert.ok(Math.abs(slideEase(0)) < 1e-9 && Math.abs(slideEase(1) - 1) < 1e-9, 'the slide does not land')
  assert.ok(LIFE_ENTRY_MS > LIFE_SPEND_MS, 'an arrival is quicker than a spend, i.e. the urgent one is the slow one')

  // `-1` is "has always been there", and it has to read as finished rather than as just starting:
  // the first frame of a run draws a full row and none of it is animated in.
  assert.equal(progressIn(-1, 0, LIFE_ENTRY_MS), 1, 'an element with no birth time animated in')
  assert.equal(progressIn(0, 0, LIFE_ENTRY_MS), 0, 'an element born this frame was already home')
})

// -- The Fever tank --------------------------------------------------------------------------

check('the tank fills bottom-up, one segment per fruit', () => {
  // **The axis is the feature.** Index 0 is the bottom segment, and a caller drawing it at the top
  // would have built a tank that empties as it fills -- which is why this is asserted here rather
  // than left to the one place that reads it.
  assert.equal(segmentOffsetY(0, 1), 0, 'the first segment is not at the bottom of the tank')

  let previous = -1

  for (let i = 0; i < FRUIT_GAUGE_PIPS; i++) {
    const offset = segmentOffsetY(i, 1)

    assert.ok(offset > previous, `segment ${i} is not above segment ${i - 1}`)
    previous = offset
  }

  const size = fruitColumnSize(FRUIT_GAUGE_PIPS, 1)

  assert.ok(
    Math.abs(segmentOffsetY(FRUIT_GAUGE_PIPS - 1, 1) + FRUIT_SEGMENT.height - size.h) < 1e-9,
    'the last segment does not end where the tank does',
  )
  assert.ok(size.h > size.w * 2, 'the tank is not visibly upright, i.e. it reads as a bar rather than a tank')
})

check('one segment per fruit, and the tank says how many are still needed', () => {
  // **The tank is the statement of the target**, which is the half a plain bar could not make:
  // every segment is on screen from the first frame whether or not it is lit.
  assert.equal(FRUIT_GAUGE_PIPS, FEVER_FRUIT_TARGET, 'the tank stopped being one segment per fruit')

  // Banking fruit is quantised, so every segment is exactly on or off and the boundary between them
  // is a hard edge rather than a level to estimate.
  for (let banked = 0; banked <= FEVER_FRUIT_TARGET; banked++) {
    const fills = pipFills(banked / FEVER_FRUIT_TARGET, FRUIT_GAUGE_PIPS)

    assert.equal(fills.filter((f) => f === 1).length, banked, `${banked} fruit lit the wrong number of segments`)
    assert.equal(fills.filter((f) => f > 0 && f < 1).length, 0, 'a banked fruit lit a segment only partly')
  }
})

check('the tank fills one way, empties the same way, and never goes backwards', () => {
  for (let i = 0; i <= 100; i++) {
    const fills = pipFills(i / 100, FRUIT_GAUGE_PIPS)

    assert.equal(fills.length, FRUIT_GAUGE_PIPS)
    for (const fill of fills) assert.ok(fill >= 0 && fill <= 1, 'a segment was filled past its own bounds')

    // Lit segments are a prefix: a tank with a gap in it has no direction, and direction is one of
    // the three things the shape this replaced could not say.
    for (let p = 1; p < fills.length; p++) {
      assert.ok(fills[p] <= fills[p - 1] + 1e-9, 'a segment lit before the one below it')
    }
  }

  assert.deepEqual(pipFills(0, FRUIT_GAUGE_PIPS), new Array(FRUIT_GAUGE_PIPS).fill(0), 'an empty tank lit something')
  assert.deepEqual(pipFills(1, FRUIT_GAUGE_PIPS), new Array(FRUIT_GAUGE_PIPS).fill(1), 'a full tank left a segment dark')
  // A Fever drains continuously, and the one segment caught mid-way is what says the tank is
  // emptying rather than sitting still.
  const mid = pipFills(0.5 + 0.5 / FRUIT_GAUGE_PIPS, FRUIT_GAUGE_PIPS)

  assert.equal(mid.filter((f) => f > 0 && f < 1).length, 1, 'a draining tank had no boundary segment')
})

check('the tank pulses on the fruit and goes on pulsing when it is full', () => {
  // **One pulse per fruit, not a continuous throb.** A readout that is always moving is one the eye
  // stops catching, which is the finding the last shield pip and the sun's corona are both under --
  // so this fires on the event and decays to nothing.
  assert.ok(Math.abs(fillPulse(0)) < 1e-9, 'the fruit pulse was already going before the fruit went in')
  assert.ok(Math.abs(fillPulse(1)) < 1e-9, 'the fruit pulse never ends')
  assert.ok(Math.max(...Array.from({ length: 40 }, (_, i) => fillPulse(i / 39))) > 0.4, 'the fruit pulse is invisible')

  // A full tank is the exception, and the exception is the point: it is a state to act on rather
  // than an event that has passed, so it goes on saying so until it is spent.
  const samples = Array.from({ length: 600 }, (_, i) => fullPulse(i * 16))

  assert.ok(Math.min(...samples) < 0.2 && Math.max(...samples) > 0.8, 'the full-tank pulse barely moves')
  for (const value of samples) assert.ok(value >= -1e-9 && value <= 1 + 1e-9, 'the full-tank pulse left 0..1')

  // Two incommensurate periods, for `SUN_ANIM`'s reason: on a single sine the eye finds the period
  // in about three cycles and the thing starts reading as a mechanism rather than as ready to go.
  assert.ok(
    Math.abs(fullPulse(0) - fullPulse(FULL_PULSE.fastMs)) > 1e-6,
    'the full-tank pulse repeats on its own fast period, i.e. it is a single sine',
  )
})

check('the run has a way out, and it clears everything else on the frame', () => {
  // **⚠ The defect this is about is an absence, so the first assertion is that the corner exists.**
  // `RunScene` bound its `close` action to ESC and to nothing else, which on the platform this game
  // ships to meant a run could only be left by dying. See `ui/exitButton.ts`.
  assert.equal(exitButtonBox.length, 2, 'exitButtonBox grew a required argument that is not the frame')

  const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  const gaps = []

  for (const [w, h, scale] of VIEWPORTS) {
    const exit = exitButtonBox(w, scale)
    const gauge = fruitGaugeBox(w, h, scale)
    const row = rowBoxAsDrawn(w, h, scale)

    // A target, not type: `uiScale` shrinks the label on a narrow frame and this box may not follow
    // it down. The floor is the kit's own, so the two cannot drift apart.
    assert.ok(exit.w >= MIN_TOUCH && exit.h >= MIN_TOUCH, `the exit is ${exit.w}x${exit.h} at ${w}x${h}, under the touch floor`)
    assert.ok(exit.x >= 0 && exit.y >= 0 && exit.x + exit.w <= w && exit.y + exit.h <= h, `the exit is outside a ${w}x${h} frame`)
    // Three corners were already claimed — distance top-left, lives bottom-left, tank bottom-right —
    // and this takes the fourth. Asserted rather than assumed, because "three corners" is a
    // statement about three functions that each answer for themselves.
    assert.ok(!overlaps(exit, gauge), `the exit lands on the fruit tank at ${w}x${h}`)
    assert.ok(!overlaps(exit, row), `the exit lands on the life row at ${w}x${h}`)
    // **The floor is not the size it draws at**, so the corner is swept across every plausible one
    // rather than checked at the smallest: `kitButton` sizes itself from its label plus padding and
    // the shipped glyph measures 62x48 on a desktop frame. What has to stay true is that the corner
    // is clear however wide the control turns out to be.
    for (const drawn of [{ w: MIN_TOUCH, h: MIN_TOUCH }, { w: 62, h: 48 }, { w: 88, h: 66 }]) {
      const grown = exitButtonBox(w, scale, drawn)

      assert.ok(grown.x >= 0 && grown.y + grown.h <= h, `a ${drawn.w}x${drawn.h} exit leaves the ${w}x${h} frame`)
      assert.ok(!overlaps(grown, gauge), `a ${drawn.w}x${drawn.h} exit lands on the fruit tank at ${w}x${h}`)
      assert.ok(!overlaps(grown, row), `a ${drawn.w}x${drawn.h} exit lands on the life row at ${w}x${h}`)
    }
    gaps.push(`${w}x${h}: ${Math.round(exit.x)},${Math.round(exit.y)} ${exit.w}x${exit.h}`)
  }

  console.log(`    the exit corner at every accepted frame: ${gaps.join('  |  ')}`)
})

check('the nav bar gear is centred in its own cell and inset like a corner control', () => {
  // **Both halves of one report: the settings control had neither a sensible inset nor a centre.**
  // Vertically it was hung from the tabs' icon baseline, which is the top of a block whose other
  // half is a label the gear does not have — so it sat a fifth of the bar above centre. Horizontally
  // its cell was a flat 16% of the bar, which is 59px on a phone (right) and **305px on a desktop**
  // (a void with the glyph adrift in it). See `ui/navLayout.ts`.
  const TAB_COUNT = 3
  // What "a corner control" means here, in unscaled pixels: near enough the edge to read as one,
  // never so near it that a thumb hits the frame instead.
  const INSET = { min: 18, max: 56 }
  const delivered = []

  for (const [w, h, scale] of VIEWPORTS) {
    const boxes = navBarBoxes(w, h, scale, TAB_COUNT)
    const { bar, gear, divider } = boxes

    assert.ok(bar.x >= 0 && bar.x + bar.w <= w + 1e-9, `the bar left a ${w}x${h} frame sideways`)
    assert.ok(bar.y >= 0 && bar.y + bar.h <= h + 1e-9, `the bar left a ${w}x${h} frame vertically`)
    assert.ok(Math.abs(navBarHeight(scale) - (bar.h + NAV_BAR.margin * 2 * scale)) < 1e-9, 'the reserved height is not the drawn one')

    // The centring, stated as the thing the eye actually reads: the gear's centre is the bar's.
    assert.ok(Math.abs(gear.cy - bar.cy) < 1e-9, `the gear is ${(gear.cy - bar.cy).toFixed(1)}px off the bar's centre at ${w}x${h}`)
    // **Width only, and that is not a weakened floor.** The bar itself is 40px tall at the narrow
    // end, so no cell in it can be 44 — the vertical guarantee comes from `ensureMinHitArea` on the
    // glyph, which pads the target past the plate it is drawn on. What the cell has to own is the
    // horizontal room, because that is what a neighbouring target could take away.
    assert.ok(gear.w >= MIN_TOUCH, `the gear cell is ${gear.w.toFixed(0)}px wide at ${w}x${h}, under the touch floor`)

    const inset = w - gear.cx

    assert.ok(
      inset >= INSET.min * scale && inset <= INSET.max * scale,
      `the gear sits ${inset.toFixed(0)}px from the right edge at ${w}x${h}, outside ${INSET.min}..${INSET.max}`,
    )

    // The tabs tile the rest of the bar exactly, and the rule sits on the seam rather than near it.
    const tabs = boxes.tabs

    assert.equal(tabs.length, TAB_COUNT, 'the bar did not lay out every tab')
    assert.ok(Math.abs(tabs[0].x - bar.x) < 1e-9, `the first tab does not start at the bar's edge at ${w}x${h}`)
    for (let i = 1; i < tabs.length; i++) {
      assert.ok(Math.abs(tabs[i].x - (tabs[i - 1].x + tabs[i - 1].w)) < 1e-9, `tab ${i} does not meet its neighbour at ${w}x${h}`)
      assert.ok(Math.abs(tabs[i].w - tabs[0].w) < 1e-9, `the tabs are not equal at ${w}x${h}`)
    }
    assert.ok(Math.abs(divider.x - gear.x) < 1e-9, `the rule is not on the seam at ${w}x${h}`)
    assert.ok(
      Math.abs(tabs[tabs.length - 1].x + tabs[tabs.length - 1].w - gear.x) < 1e-9,
      `the tabs and the gear disagree about where the bar is divided at ${w}x${h}`,
    )
    assert.ok(tabs[tabs.length - 1].cx + MIN_TOUCH / 2 <= gear.cx - MIN_TOUCH / 2, `the last tab's target reaches the gear's at ${w}x${h}`)

    delivered.push(`${w}x${h}: cell ${gear.w.toFixed(0)}px, ${inset.toFixed(0)}px in`)
  }

  // **The negative control is the arrangement that shipped**, so the band is shown to reject
  // something on every run rather than on the day somebody re-widens the cell.
  const wide = VIEWPORTS.map(([w, h, scale]) => {
    const bar = navBarBoxes(w, h, scale, TAB_COUNT).bar
    const cell = bar.w * NAV_BAR.gearFraction

    return { w, inset: w - (bar.x + bar.w - cell / 2) }
  })
  const rejected = wide.filter(({ w, inset }) => inset > INSET.max * (w >= 400 ? 1 : 0.8))

  assert.ok(rejected.length > 0, 'the unbounded gear fraction passes the inset band, i.e. the band measures nothing')
  console.log(`    the gear at every accepted frame: ${delivered.join('  |  ')}`)
  console.log(
    `    control, the unbounded fraction: ${wide.map(({ w, inset }) => `${w}:${inset.toFixed(0)}px`).join(' ')}` +
      ` (${rejected.length} of ${wide.length} rejected)`,
  )
})

console.log('the run\'s top band')

check('⚠ the top band is one row on one baseline, inside one pair of insets', () => {
  // **The top of the frame was four things at three heights**: the distance at the margin, the
  // milestone bar floating at 0.6 of it, the exit in the corner, and the coins on a *second row*
  // under the exit — where on a portrait frame they landed on the sun. Reported as a pile.
  //
  // The guarantee is the signature first: the band is a function of the frame and the exit's own
  // drawn box, so nothing in it can be positioned by the text it happens to be showing — which is
  // exactly what the old milestone bar was, sized from whatever the two corners measured.
  assert.equal(topBarLayout.length, 3, 'topBarLayout grew an argument, i.e. the band can depend on its own contents')

  const rows = []

  for (const [w, h] of VIEWPORTS) {
    const scale = hudScale(w, h)
    const exit = { w: MIN_TOUCH, h: MIN_TOUCH }
    const bar = topBarLayout(w, scale, exit)

    // One baseline: the exit is centred on it, and so is everything else the HUD puts in the row.
    assert.ok(
      Math.abs(bar.exit.y + bar.exit.h / 2 - bar.baseline) < 1e-9,
      `the exit is off the band's baseline at ${w}x${h}`,
    )
    // Equal insets, left and right.
    const leftInset = bar.left
    const rightInset = w - bar.right

    assert.ok(Math.abs(leftInset - rightInset) < 1e-9, `the band's insets differ by ${Math.abs(leftInset - rightInset).toFixed(1)}px at ${w}x${h}`)
    assert.ok(Math.abs(leftInset - TOP_BAR.padX * scale) < 1e-9, `the band's inset is not its own constant at ${w}x${h}`)
    // The rule shares them, which is what makes it part of the band rather than a fourth element.
    assert.ok(Math.abs(bar.rule.x - bar.left) < 1e-9 && Math.abs(bar.rule.x + bar.rule.w - bar.right) < 1e-9, `the rule does not span the band at ${w}x${h}`)
    assert.ok(bar.rule.y >= bar.content.y + bar.content.h, `the rule overlaps the content row at ${w}x${h}`)
    assert.ok(
      Math.abs(bar.rule.y + bar.rule.h - topBarHeight(scale, exit.h)) < 1e-9,
      `the rule is not the band's last row at ${w}x${h}`,
    )
    // **⚠ Nothing lands in the frame's first rows**, which is the only thing this game can do about
    // a camera cutout: there is no `viewport-fit=cover` and no `env()` read anywhere in it.
    assert.ok(bar.content.y >= TOP_BAR.padTop * scale - 1e-9, `the content starts at ${bar.content.y.toFixed(0)}px at ${w}x${h}`)
    assert.ok(bar.exit.y > 0, `the exit touches the frame's top edge at ${w}x${h}`)
    // The wash starts at the frame's edge and outlives the band, or its falloff is a bottom edge.
    assert.equal(bar.wash.y, 0, 'the wash leaves a lit strip above itself')
    assert.ok(bar.wash.h > topBarHeight(scale, exit.h), 'the wash ends inside the band it is behind')

    rows.push(
      `${w}x${h}: inset ${leftInset.toFixed(0)}px, baseline ${bar.baseline.toFixed(0)}, band ${topBarHeight(scale, exit.h).toFixed(0)}px, wash ${bar.wash.h.toFixed(0)}px`,
    )
  }

  // **The control is the arrangement that shipped**: three different heights for four elements.
  // Written as the old arithmetic rather than pointed at deleted fields, so it keeps measuring
  // something. The coins sat a whole exit-height below the distance's own row.
  const scale = hudScale(320, 568)
  const margin = 16 * scale
  const shippedRows = new Set([margin, margin * 0.6, margin + MIN_TOUCH + 6 * scale].map((y) => y.toFixed(1)))

  assert.ok(shippedRows.size >= 3, 'the control does not put its elements at different heights, i.e. this measures nothing')
  for (const row of rows) console.log(`    ${row}`)
  console.log(`    control, the arrangement that shipped: ${shippedRows.size} different top rows for four elements`)
})

check('⚠ the way out is in the corner, out of reach of a steering thumb, and quiet', () => {
  // **An accidental exit is the worst mistake this game can make** — a run is the whole product and
  // there is no undo — so the corner is a measured claim rather than a habit. The snail is dragged
  // along the bottom of the frame, which is where a thumb rests.
  const rows = []

  for (const [w, h] of VIEWPORTS) {
    const scale = hudScale(w, h)
    const bar = topBarLayout(w, scale, { w: MIN_TOUCH, h: MIN_TOUCH })

    assert.ok(
      exitIsClearOfThumb(bar.exit, w, h),
      `the exit reaches ${(((bar.exit.y + bar.exit.h) / h) * 100).toFixed(0)}% down and ${((1 - bar.exit.x / w) * 100).toFixed(0)}% in at ${w}x${h}`,
    )
    // It is still a target, however small it is drawn: the glyph shrinks, the floor does not.
    assert.ok(bar.exit.w >= MIN_TOUCH && bar.exit.h >= MIN_TOUCH, `the exit is under the touch floor at ${w}x${h}`)
    // And it is the outermost thing in the row, with the coins inside it rather than under it.
    assert.ok(bar.coinRight <= bar.exit.x, `the coins overlap the exit at ${w}x${h}`)
    assert.ok(bar.exit.x + bar.exit.w <= bar.right + 1e-9, `the exit runs past the band at ${w}x${h}`)
    rows.push(`${w}x${h}: exit ${bar.exit.x.toFixed(0)},${bar.exit.y.toFixed(0)} ${bar.exit.w}x${bar.exit.h}, coins end ${bar.coinRight.toFixed(0)}`)
  }

  // **The control is the middle of the frame**, which is where a steering thumb actually is. A
  // bound that a centred box passes is not a bound.
  const [w0, h0] = VIEWPORTS[0]
  const centred = { x: w0 / 2 - MIN_TOUCH / 2, y: h0 / 2, w: MIN_TOUCH, h: MIN_TOUCH }

  assert.equal(exitIsClearOfThumb(centred, w0, h0), false, 'a control in the middle of the frame passes the thumb test')
  // ...and so is the corner one row too far down, which is the near miss rather than the absurd one.
  const low = { x: w0 - MIN_TOUCH, y: h0 * EXIT_SAFE.topFraction, w: MIN_TOUCH, h: MIN_TOUCH }

  assert.equal(exitIsClearOfThumb(low, w0, h0), false, 'the top bound does not bite just past itself')
  for (const row of rows) console.log(`    ${row}`)
  console.log(`    the exit stays inside the top ${(EXIT_SAFE.topFraction * 100).toFixed(0)}% and the outer ${(EXIT_SAFE.sideFraction * 100).toFixed(0)}% of the frame`)
})

console.log('the quest board')

/**
 * A rough width for a string set in Arial at `size`, for a check with no browser in it.
 *
 * Calibrated against the one measurement this project already took through Phaser: `13/14` is 38px
 * of 15px Arial, i.e. ~0.507 of the face per character over five characters. Erring **wide** is the
 * safe direction — every claim below is that some column is big enough for its content.
 */
const textWidth = (text, size) => text.length * size * 0.56

check('a quest row is four columns, and every one of them is a function of the row alone', () => {
  // **The guarantee is the signature, not a sample.** The bar used to be laid inwards from the right
  // edge *past the count* — a constant length whose left edge moved by however wide `5/9` or `13/14`
  // happened to draw — so three rows of one board read as three different bars. What this asserts is
  // that the geometry has no way to know: it is handed the row's box and nothing else.
  assert.equal(questRowColumns.length, 4, 'questRowColumns grew an argument, i.e. a column can depend on something other than its row')
  assert.equal(questBarBox.length, 4, 'questBarBox grew an argument')

  const shown = []

  for (const [w, , scale] of VIEWPORTS) {
    // The board's real content width at this frame, and two narrower ones — the invariance the
    // first assertion is about holds at any width, and the column bounds below are about the
    // widths the panel is actually drawn at.
    const real = questPanelSize(3, scale, w, 16 * scale).w - QUEST_PANEL.padX * 2 * scale

    for (const width of [real, real * 0.9, real * 0.8]) {
      const x = 20
      const first = questRowColumns(x, 0, width, scale)
      const later = questRowColumns(x, questBoardHeight(1, scale) + QUEST_ROW.gap * scale, width, scale)

      for (const key of ['icon', 'label', 'bar', 'action']) {
        assert.ok(
          Math.abs(first[key].x - later[key].x) < 1e-9 && Math.abs(first[key].w - later[key].w) < 1e-9,
          `two rows of one board disagree about the ${key} column`,
        )
        assert.ok(first[key].w > 0, `the ${key} column is empty at ${width}px`)
      }

      // Reading order, left to right, with a gutter between each pair and nothing overlapping.
      const order = [first.icon, first.label, first.bar, first.action]

      for (let i = 1; i < order.length; i++) {
        assert.ok(
          order[i].x >= order[i - 1].x + order[i - 1].w - 1e-9,
          `columns ${i - 1} and ${i} overlap at ${width}px`,
        )
      }
      assert.ok(first.action.x + first.action.w <= x + width + 1e-9, `the row runs past its own box at ${width}px`)

      shown.push(`${Math.round(width)}@${scale}: label ${first.label.w.toFixed(0)} track ${first.bar.w.toFixed(0)} action ${first.action.w.toFixed(0)}`)
    }

    // **The fits are asked of the width the panel is actually drawn at**, never of the hypothetical
    // narrower ones above: those exist to show the columns are invariant, and a column bound
    // measured on a board nobody draws would be a bound on a fiction.
    const columns = questRowColumns(20, 0, real, scale)
    // The action column holds the larger of the two things it ever shows: the count while a quest
    // is running, and the collect button once it is done. The pill it is drawn on is capped at the
    // column, so the *text* is what has to fit.
    const collect = textWidth('COLLECT', 12 * scale) + 8 * scale
    // And the label column holds the longest verb the board can deal, which is what stops a row
    // saying its target twice — see `questBoard.ts`'s own note on the labels.
    const label = textWidth('Close passes', 15 * scale)

    assert.ok(
      columns.action.w >= collect,
      `the action column is ${columns.action.w.toFixed(0)}px at ${w}, under the ${collect.toFixed(0)}px COLLECT needs`,
    )
    assert.ok(
      columns.label.w >= label,
      `the label column is ${columns.label.w.toFixed(0)}px at ${w}, under the ${label.toFixed(0)}px the longest label needs`,
    )
  }

  // **The control is the arrangement that shipped**: the same track laid past the count moves with
  // it, which is the defect in one number.
  const shipped = (countWidth, width, scale) => width + 20 - width * QUEST_ROW.barFraction - countWidth - 10 * scale
  const narrow = shipped(24, 380, 1)
  const wide = shipped(41, 380, 1)

  assert.ok(Math.abs(narrow - wide) > 8, 'the control does not move, i.e. this check is measuring nothing')
  console.log(`    ${shown[0]}  |  the control moves the track ${Math.abs(narrow - wide).toFixed(0)}px between a 2- and a 5-character count`)
})

check('⚠ a quest track is the Fever gauge laid on its side', () => {
  // **One visual language, asserted rather than resembled.** The bars were a shape used nowhere
  // else in the game; they are the tank's own segments now, filled by the tank's own function.
  assert.equal(
    QUEST_BAR_SEGMENTS,
    FRUIT_GAUGE_PIPS,
    'the track and the Fever tank are cut into different numbers of segments, i.e. they are two readouts',
  )

  const widths = []

  for (const [w, , scale] of VIEWPORTS) {
    const bar = questBarBox(20, 0, QUEST_PANEL.maxWidth * scale, scale)
    const segments = Array.from({ length: QUEST_BAR_SEGMENTS }, (_, i) => questSegmentBox(i, bar, QUEST_BAR_SEGMENTS, scale))

    // The gaps come out of the track rather than being added to it, so the segments tile it exactly.
    assert.ok(Math.abs(segments[0].x - bar.x) < 1e-9, 'the first segment does not start at the track')
    const last = segments[QUEST_BAR_SEGMENTS - 1]

    assert.ok(Math.abs(last.x + last.w - (bar.x + bar.w)) < 1e-6, `the segments do not fill the track at ${w}`)
    for (let i = 1; i < segments.length; i++) {
      const gap = segments[i].x - (segments[i - 1].x + segments[i - 1].w)

      assert.ok(Math.abs(gap - QUEST_ROW.segmentGap * scale) < 1e-6, `segment ${i} sits at the wrong gap at ${w}`)
    }
    // A segment thinner than its own gap is a hatched line rather than a count — the failure a
    // one-segment-per-unit track has at a target of 14 on a phone, and the reason this is 8.
    assert.ok(
      segments[0].w >= QUEST_ROW.segmentGap * scale * 2,
      `a segment is ${segments[0].w.toFixed(1)}px against a ${(QUEST_ROW.segmentGap * scale).toFixed(1)}px gap at ${w}`,
    )
    widths.push(`${w}: ${segments[0].w.toFixed(1)}px`)
  }

  // The fill is `pipFills` — the tank's own, so the two cannot drift into two shapes.
  assert.deepEqual(pipFills(0, QUEST_BAR_SEGMENTS), Array.from({ length: QUEST_BAR_SEGMENTS }, () => 0))
  assert.deepEqual(pipFills(1, QUEST_BAR_SEGMENTS), Array.from({ length: QUEST_BAR_SEGMENTS }, () => 1))
  console.log(`    segment width at every accepted frame: ${widths.join('  |  ')}`)
})

check('⚠ the board is a chip until it is asked for, and the open panel always has somewhere to go', () => {
  // **⚠ Three rows plus a heading plus Play do not fit a 320x568 portrait**, which is what the
  // collapse is for. The chip is what the front screen shows unasked; the panel is what a tap
  // opens. Both are measured here, and the panel where it is tightest.
  const rows = []
  // 1080x1920 is one of the two frames this round is accepted on and is not in the shared list,
  // which is sized for the widgets rather than for the front screen.
  const FRAMES = [...VIEWPORTS, [1080, 1920, 1]]

  for (const [w, h, scale] of FRAMES) {
    const margin = 16 * scale
    const panel = questPanelSize(3, scale, w, margin)
    const chip = questChipSize(textWidth('Quests 1/3', 15 * scale), scale)

    assert.ok(chip.h <= panel.h * 0.4, `the chip is ${chip.h.toFixed(0)}px against a ${panel.h.toFixed(0)}px panel at ${w}x${h}`)
    assert.ok(chip.w <= panel.w * 0.6, `the chip is ${chip.w.toFixed(0)}px wide against a ${panel.w.toFixed(0)}px panel at ${w}x${h}`)
    assert.ok(chip.h >= 26, `the chip is ${chip.h.toFixed(0)}px tall at ${w}x${h}, under anything a thumb can find`)
    assert.ok(panel.w <= w - margin * 2 + 1e-9, `the panel runs off the frame at ${w}x${h}`)

    // The band the open panel has to live in: under the wordmark, over the Play stack and the bar.
    // The title's drawn height is approximated exactly as `verify:menu` approximates it, and the
    // exact figures are confirmed in the running game — this is the shape of the budget, not a
    // second opinion about a `Text` object's metrics.
    const face = Math.min(h * 0.155, w * 0.155)
    const top = titleBand(h).centre + face / 2 + 18 * scale
    // The tallest the stack ever is: Play plus the `New run` button under it, which exists only
    // while a run is suspended. Measured at its tallest because that is the case the panel has to
    // fit above — a screen with nothing to resume has more room, not less.
    const stack = Math.max(38 * scale * 1.3 + 24 * scale, 44) + 10 * scale + Math.max(19 * scale * 1.3 + 24 * scale, 44)
    const floor = h - navBarHeight(scale) - 10 * scale - stack - 18 * scale
    // **Either the panel fits above the Play stack, or it takes the stack's room and the stack is
    // hidden while it is open** — see `layoutQuests`. What may never happen is a control that opens
    // onto nothing, which is what a 25px band between the wordmark and the button would have given.
    const roomy = top + panel.h <= floor
    const covered = h - navBarHeight(scale)

    assert.ok(
      roomy || top + panel.h <= covered,
      `the open panel does not fit at ${w}x${h} even with the Play stack out of the way`,
    )
    rows.push(
      `${w}x${h}: chip ${chip.w.toFixed(0)}x${chip.h.toFixed(0)}, panel ${panel.w.toFixed(0)}x${panel.h.toFixed(0)}` +
        ` in ${(floor - top).toFixed(0)}px${roomy ? '' : ` — covers the stack, ${(covered - top).toFixed(0)}px`}`,
    )
  }

  // **The control is the board as it shipped**: three bare rows in the same band. Collapsing has to
  // buy back a real amount of the picture, or it is a control with nothing behind it.
  const [w0, , s0] = VIEWPORTS[0]
  const chipOnly = questChipSize(textWidth('Quests 1/3', 15 * s0), s0).h
  const open = questPanelSize(3, s0, w0, 16 * s0).h

  assert.ok(open > chipOnly * 2.5, 'the open panel is barely taller than the chip, i.e. collapsing buys nothing')
  for (const row of rows) console.log(`    ${row}`)
  console.log(`    collapsed the board is ${chipOnly.toFixed(0)}px of the frame against ${open.toFixed(0)}px open`)
})

check('⚠ the open quest panel scrolls its rows rather than dropping them', () => {
  // **The rows were dropped against the floor, and on a phone held sideways that left one of three
  // on screen and the other two nowhere** — reported twice. Every row is laid out now and the
  // window over them is what fits the room; this holds the window's own arithmetic.
  const pitch = QUEST_ROW.height + QUEST_ROW.gap
  const rowH = QUEST_ROW.height
  const all = questBoardHeight(3, 1)
  const lines = []

  for (let room = 0; room <= all + 40; room += 0.5) {
    const h = questWindowHeight(3, room, 1)

    if (all <= room) {
      assert.equal(h, all, `room ${room}: every row fits and the window is not their height`)
      continue
    }
    // Scrolling: never less than one whole row, never taller than the rows, and never over the room
    // unless one row is all it could be.
    assert.ok(h >= rowH - 1e-9, `room ${room}: the window is ${h}px, under one row`)
    assert.ok(h < all, `room ${room}: a window as tall as the rows does not scroll`)
    assert.ok(h <= Math.max(room, rowH) + 1e-9, `room ${room}: the window runs past its room`)
    // **Never cut at a row boundary**: a window ending between two rows says the list has ended.
    if (room >= pitch + QUEST_WINDOW_PEEK * rowH) {
      const into = h % pitch

      assert.ok(Math.abs(into - QUEST_WINDOW_PEEK * rowH) < 1e-6, `room ${room}: the window ends ${into}px into a row`)
    }
  }

  // The control is the shipped-before rule — rows that fit, the rest dropped — at the rooms a
  // sideways phone leaves: it reaches fewer rows than the window does at every one of them.
  for (const room of [40, 60, 90]) {
    const dropped = Math.max(1, [1, 2, 3].filter((n) => questBoardHeight(n, 1) <= room).length)
    const window = questWindowHeight(3, room, 1)

    assert.ok(dropped < 3, `room ${room}: the control drops nothing, so it measures nothing`)
    lines.push(`room ${room}px: ${dropped} of 3 rows reachable before, 3 of 3 through a ${window.toFixed(1)}px window`)
  }

  assert.equal(questPanelHeightFor(all, 1), questPanelSize(3, 1, 1000, 16).h, 'the panel around three rows is not the three-row panel')
  for (const line of lines) console.log(`    ${line}`)
})

check("⚠ the front screen's one control colour is fixed, and its LABEL reads on it", () => {
  // **The Play button and the mode chip under it are painted in one colour, and it is the kit's.**
  // They used to take the active theme's own rung -- the transverse road marking -- on the argument
  // that `kitPalette.ts`'s fixed-palette rule is about readouts on a plate and does not cover a
  // control drawn straight over the world. It was reported on sight: on `day` the rung is a cream,
  // and both controls carry pale type, so the whole thing went pale-on-pale.
  //
  // **⚠ And the check that stood here passed it**, which is the finding. It measured the FILL
  // against the ROAD -- `day`'s cream scored 1.47:1 over a 1.4 floor -- and nothing measured the
  // LABEL against the FILL, which is the pair a player reads. A proxy that has never been checked
  // against the thing it stands for is not a measurement of it.
  const accent = KIT.active
  const legal =
    hueDistance(accent, THREAT_COLOR) > THREAT_MIN_HUE_DEGREES ||
    chroma(accent) < THREAT_MIN_CHROMA ||
    Math.abs(toOklab(accent).L - toOklab(THREAT_COLOR).L) > THREAT_LIGHTNESS_ESCAPE

  assert.ok(legal, `the button accent ${hex(accent)} is inside the reserved threat band`)

  // **What carries a label on a bright fill is its INK, not its face.** Both controls set their
  // type in white or in `KIT.rim` and stroke it in `KIT.plate` -- the same arrangement the wordmark
  // uses over the sky, and for the same reason: a stroke is a guarantee against *whatever* is
  // behind it, where a face is a bet on it. So the face is printed and the ink is asserted.
  const ink = contrastRatio(KIT.plate, accent)
  const face = contrastRatio(0xffffff, accent)

  assert.ok(ink >= 4.5, `the label's ink is ${ink.toFixed(2)}:1 on the fill, i.e. the glyph has no edge`)
  // The control: `day`'s own rung, which is what shipped and what was reported. Its ink is fine --
  // dark on cream always is -- and its FACE is where it fails, which is why the old check could not
  // see it.
  const cream = THEMES.day.road[4]
  const creamFace = contrastRatio(0xffffff, cream)

  assert.ok(
    face > creamFace,
    `the fixed accent is no better under a white label than day's cream: ${face.toFixed(2)} against ${creamFace.toFixed(2)}`,
  )
  console.log(`    accent ${hex(accent)}: ink ${ink.toFixed(2)}:1, white face ${face.toFixed(2)}:1 (day's cream rung was ${creamFace.toFixed(2)}:1)`)

  // The fill against each theme's near road, printed rather than asserted: the button is a filled
  // shape with a pale rim and a hard shadow under it, so this ratio is not what makes it findable --
  // and a floor on it is exactly what passed an unreadable control one round ago.
  const rows = Object.entries(THEMES).map(
    ([id, theme]) => `${id} ${accentContrast(accent, accentBackdrop(theme)).toFixed(2)}`,
  )

  console.log(`    the same fill on every theme's near road: ${rows.join(', ')}`)
})

console.log('the secondary action')

check('⚠ the New run button is narrower than Play, and still a touch target', () => {
  // **Width is the whole hierarchy here, which is why it has to be a rule.** Both controls are the
  // same colour — the chip that used to sit in this band wore a quieter face until it was reported
  // for not matching Play — so if the secondary one could grow past the primary, nothing at all
  // would say which of the two starts a run.
  //
  // **⚠ This band held a mode selector and now holds one button.** The chip named which of six
  // things Play would start; with the stage mode removed a selector with one option is a control
  // that opens a list with one row, so what stands here instead is the only thing resuming does not
  // do. See `run/suspend.ts`.
  const rows = []

  for (const [w, h, scale] of VIEWPORTS) {
    // Play as `measureStack` sizes it, and the secondary at its own face.
    const play = Math.min(Math.max(w * 0.4, 264 * scale), 380, w - 16 * 4 * scale)
    const max = secondaryMaxWidth(play)
    const label = textWidth('New run', 19 * scale)
    // `kitButton`'s own box: the label plus its padding, floored at the touch minimum.
    const drawn = Math.max(label + 24 * scale, MIN_TOUCH)
    const height = Math.max(19 * scale * 1.3 + 24 * scale, MIN_TOUCH)

    assert.ok(max < play, `the secondary may be as wide as Play at ${w}x${h}`)
    assert.ok(height >= MIN_TOUCH, `the secondary is under the touch floor at ${w}x${h}`)
    assert.ok(Math.min(drawn, max) >= MIN_TOUCH, `bounding the secondary took it under the touch floor at ${w}x${h}`)
    rows.push(`${w}x${h}: play ${play.toFixed(0)}, ceiling ${max.toFixed(0)}, drawn ${drawn.toFixed(0)}`)
  }

  // **The ceiling does not bite today, and this says so rather than pretending otherwise.** `New
  // run` is much shorter than Play is wide on every supported frame; the rule is the guard for a
  // translation that is not, and the control that proves it can bite is the label that would.
  const overlong = VIEWPORTS.filter(([w, , scale]) => {
    const play = Math.min(Math.max(w * 0.4, 264 * scale), 380, w - 16 * 4 * scale)

    return textWidth('Comenzar una partida nueva', 19 * scale) + 24 * scale > secondaryMaxWidth(play)
  })

  assert.ok(overlong.length > 0, 'a label the length of a sentence still fits everywhere, i.e. the ceiling is untested')
  for (const row of rows) console.log(`    ${row}`)
  console.log(`    the ceiling binds on 0 of ${VIEWPORTS.length} frames today, and on ${overlong.length} for a label the length of a sentence`)
})

check('the HUD is drawn bigger in the hand and unchanged on a desk', () => {
  // **⚠ `uiScale` goes the wrong way for a readout that owns a corner**, and it took the HUD to
  // 0.94 on a 375px phone — the same pixel count as a desktop, on a frame spreading about 140 CSS
  // pixels to the inch against a monitor's 82. The identical pip is 4.7mm in the hand and 8mm on
  // the desk. See `kitPalette.ts`.
  const delivered = []

  for (const [w, h] of VIEWPORTS) {
    const s = hudScale(w, h)
    const phone = Math.min(w, h) < HUD_SCALE.reference

    assert.ok(s >= 1 && s <= HUD_SCALE.max, `hudScale is ${s} at ${w}x${h}, outside 1..${HUD_SCALE.max}`)
    assert.ok(phone ? s > 1 : s === 1, `hudScale is ${s} at ${w}x${h}, which ${phone ? 'is' : 'is not'} a hand-held frame`)
    delivered.push(`${w}x${h}: ${s.toFixed(2)}`)
  }

  // **Keyed on the short side, and this is the assertion that says so.** A landscape phone is 844
  // wide and 390 tall: on width alone it is a desktop and its HUD stays at 1, which is the frame
  // this rule most needs to reach.
  assert.ok(hudScale(844, 390) > 1, 'a landscape phone is treated as a desktop, i.e. the scale is keyed on width')
  assert.ok(Math.abs(hudScale(844, 390) - hudScale(390, 844)) < 1e-9, 'the same phone rotated is scaled differently')
  // **⚠ Except where the landscape frame has no height to give.** A phone sideways in a webview is
  // about 828x300, and keyed on the short side alone it drew the biggest HUD in the game over a road
  // squeezed into the bottom third. Capped by the height there — and the control is the uncapped
  // rule, which gives that frame the full 1.35.
  assert.equal(hudScale(828, 300), 1, 'a short landscape frame still gets a HUD bigger than a desktop one')
  assert.ok(Math.min(HUD_SCALE.max, HUD_SCALE.reference / 300) > 1.3, 'the control no longer reproduces the reported HUD')
  // Monotonic, and capped rather than unbounded: a 240px frame must not get a HUD twice the size.
  assert.ok(hudScale(320, 568) >= hudScale(375, 667), 'a narrower frame is scaled smaller')
  assert.equal(hudScale(120, 200), HUD_SCALE.max, 'the cap does not hold on an absurdly small frame')
  assert.equal(hudScale(0, 0), 1, 'a zero frame does not fall back to 1')

  console.log(`    the HUD scale at every accepted frame: ${delivered.join('  |  ')}`)
})

check('⚠ the loading screen animates from the GAME clock, not from a scene update', () => {
  // **A scene is stepped only once it is RUNNING, and it spends its whole `preload` in LOADING** —
  // so `Preloader.update` never ran while the load it exists to show was happening. Measured in the
  // running game before this was fixed: `elapsedMs` stayed at **0 across 60 stepped frames** while
  // the loader's own progress reached 0.371. The bar never filled, the mascot never took a step and
  // the title was never created, because all three are decided per frame.
  //
  // Asserted by reading the source, for the reason the music fallback's own guard is: none of this
  // is reachable from Node — `Preloader` imports `phaser` as a value — and what has to stay true is
  // *which clock it is on*, which is one line.
  const pre = readFileSync('src/scenes/Preloader.ts', 'utf8')

  assert.ok(
    /game\.events\.on\(Phaser\.Core\.Events\.STEP/.test(pre),
    'the loading screen is not driven by the game clock, so nothing on it will move while it loads',
  )
  // Bound means unbound: a hook on the game's own emitter outlives the scene that made it.
  assert.ok(/game\.events\.off\(Phaser\.Core\.Events\.STEP/.test(pre), 'the loading screen never unbinds its tick')
  // The title is created unconditionally and its face upgraded when the real one lands — the gate
  // it replaces drew nothing at all on a boot where the font failed.
  assert.ok(/if \(!this\.title && !this\.failure\) this\.createTitle\(\)/.test(pre), 'the title is gated on something again')
  assert.ok(/setFontFamily\(getDisplayFontStack\(\)\)/.test(pre), 'the title never takes the display face once it lands')
  // And the horizon it is composed around: a skyline standing on nothing was the other half of the
  // report, so the ground under it is drawn from the world's own palette rather than picked.
  assert.ok(/groundPairForTheme\(BIOMES\[0\]\.ground/.test(pre), 'the loading screen draws no ground for its skyline to stand on')
})

check('⚠ the corner darkening is off, and it is off by a knob rather than by deletion', () => {
  // **Reported by pointing at the front screen: take the darkening out of the corners.** A vignette
  // is a lens's own artefact, and this game is drawn in flat cel bands under a cartoon sun — on a
  // bright daylight theme it read as the picture being dirty at the edges rather than as focus.
  // Same objection that removed the measured scrim, the button strip and the pickups' bright rim.
  //
  // A source-grep for `Preloader`'s reason: `Backdrop` imports `phaser` as a value, so neither the
  // constant nor the draw is reachable from Node. What has to stay true is that the shipped value
  // is 0 **and** that the draw is skipped rather than merely transparent — a full-frame image at
  // alpha 0 is still a texture per theme and a draw call per frame for nothing.
  const backdrop = readFileSync('src/road/Backdrop.ts', 'utf8')

  assert.ok(/const VIGNETTE_MAX_ALPHA = 0$/m.test(backdrop), 'the vignette is drawing again')
  assert.ok(
    /if \(VIGNETTE_MAX_ALPHA <= 0\) return/.test(backdrop),
    'the vignette is off but still generated and drawn, which costs a texture per theme for nothing',
  )
  // The generator stays, and that is the point of a knob over a deletion: a theme that wants its
  // own corners back is one number rather than a rebuilt per-theme lifecycle.
  assert.ok(/createRadialGradient/.test(backdrop), 'the vignette generator was deleted rather than switched off')
})

check('⚠ the moon is bitten out of the SUN, not out of the vignette', () => {
  // **⚠ The block sat in `ensureVignetteTexture`**, one function up, where it did two wrong things
  // at once on the one theme that reads it: it punched a transparent hole in the corner darkening
  // and it left the moon a full disc. Neither is visible to any check — the sun is generated, so
  // nothing measures its pixels, and a hole in a vignette is a *brighter* corner, which reads as
  // the effect simply being weak.
  const backdrop = readFileSync('src/road/Backdrop.ts', 'utf8')
  const sun = backdrop.slice(backdrop.indexOf('export function ensureSunTexture'))
  const vignette = backdrop.slice(
    backdrop.indexOf('export function ensureVignetteTexture'),
    backdrop.indexOf('export function ensureSunTexture'),
  )

  // The *operation* rather than the name: `MOON_BITE`'s own declaration sits between the two
  // functions, so a name test would report the constant and not what is done with it.
  assert.ok(
    /destination-out/.test(sun) && /MOON_BITE/.test(sun),
    'the moon is not cut out of the sun, so a night theme draws a full disc',
  )
  assert.ok(!/destination-out/.test(vignette), 'the vignette is having a hole punched in it again')
})

console.log('the wardrobe')

/**
 * The mascot's drawn box on a frame of this size, as the garage stands it.
 *
 * A restatement of the projection rather than a call into it, for `hudScale`'s reason: the modules
 * that own it import `phaser` as a value and cannot be reached from here. What matters is only that
 * the box is roughly where the screen puts it — the claims below are about the *relationship*
 * between the box and the stack, not about either one's absolute position.
 */
function garageMascot(width, height) {
  // `PLAYER_REST_Y_FRACTION` is 0.883 and `HORIZON_Y` 0.62; the offset from the horizon goes as
  // `1 / z`, so standing the mascot at `GARAGE.zScale` = 2.7 puts its feet here.
  const feet = 0.62 + (0.883 - 0.62) / 2.7
  // **⚠ The share is `readableScale`'s, and leaving it flat is the whole of the arrows report.**
  // Everything on this road is sized off the frame's WIDTH, so a bare share makes the creature the
  // same fraction of every viewport while an arrow is floored at an absolute `MIN_TOUCH` — which is
  // a sixth of the mascot on a desktop and half of it on a phone. 0.263 is measured off the running
  // game at 383px (191.3px drawn, against a `readableScale` of 1.9 there).
  const drawnWidth = width * 0.263 * readableScale(width)

  return {
    left: width / 2 - drawnWidth / 2,
    right: width / 2 + drawnWidth / 2,
    top: height * feet - drawnWidth / 1.61,
    bottom: height * feet,
  }
}

/**
 * What a `kitButton` chevron actually measures, which is not `MIN_TOUCH`.
 *
 * The kit sizes a button from its own label and *floors* the box at the touch minimum, so the
 * delivered control is wider than the floor — **55.1px measured in the running game** for the
 * shipped 26px glyph at 383px wide. Everything that insets or stands off from it has to use this
 * rather than the floor, which is the correction `exitButtonBox` already carries for the close
 * button. Rounded up, because a fixture that under-states the control is a bound that does not
 * bind.
 */
const ARROW_BOX = 56

check('⚠ the wardrobe caption is never drawn over the mascot', () => {
  // **This is the report**, and the defect it replaces is one line: the stack was placed at
  // `feet + gap` and then clamped upward with `Math.min` so it would clear the bottom bar, so on
  // any frame where the band is shorter than the stack the clamp put the caption on the shell.
  const rows = []

  for (const [w, h, scale] of VIEWPORTS) {
    const mascot = garageMascot(w, h)
    const barTop = h - 58 * scale
    const sizes = { name: 34 * scale, action: 48, arrow: ARROW_BOX }
    const boxes = wardrobeStack(w, h, scale, mascot, barTop, sizes)
    const top = boxes.name.y - (sizes.name * boxes.fit) / 2

    if (boxes.side) {
      // Beside, so "under the feet" is vacuous — what has to hold there is that the stack and the
      // creature do not share horizontal space at all.
      const clear = boxes.name.x < mascot.left || boxes.name.x > mascot.right

      assert.ok(clear, `the side stack is over the mascot at ${w}x${h}`)
      // **⚠ And the dot strip has its row between the caption and the button**, which the side
      // branch left out: measured at 828x300, the dots were drawn behind the button's top edge.
      const captionBottom = boxes.name.y + sizes.name / 2
      const buttonTop = boxes.action.y - sizes.action / 2
      assert.ok(
        buttonTop - captionBottom >= wardrobeStripHeight(scale) - 1e-9,
        `the side stack leaves ${(buttonTop - captionBottom).toFixed(1)}px for a ${wardrobeStripHeight(scale).toFixed(1)}px strip at ${w}x${h}`,
      )
    } else {
      assert.ok(top >= mascot.bottom, `the caption is ${(mascot.bottom - top).toFixed(0)}px over the mascot at ${w}x${h}`)
      assert.ok(
        boxes.action.y + (sizes.action * boxes.fit) / 2 <= barTop,
        `the action button reaches into the nav bar at ${w}x${h}`,
      )
    }
    rows.push(
      `${w}x${h}: ${boxes.side ? 'beside' : 'under'}, fit ${boxes.fit.toFixed(2)}, caption top ` +
        `${top.toFixed(0)} against feet ${mascot.bottom.toFixed(0)}`,
    )
  }

  // The fit has to bite somewhere or it is not a fit, and the side layout has to be reachable or it
  // is code nobody runs — both are properties of the shipped frames rather than of one of them.
  const boxes = VIEWPORTS.map(([w, h, scale]) =>
    wardrobeStack(w, h, scale, garageMascot(w, h), h - 58 * scale, { name: 34 * scale, action: 48, arrow: ARROW_BOX }),
  )

  assert.ok(boxes.some((box) => box.side || box.fit < 1), 'no supported frame is tight, i.e. neither the fit nor the side layout is tested')
  for (const row of rows) console.log(`    ${row}`)
})

check('⚠ the wardrobe arrows are beside the mascot, not on a fraction of the frame', () => {
  // They page the creature, so they belong next to the creature — they sat on a fixed 0.55 of the
  // frame's height and came out level with the mountains, which is how it was reported.
  const overlapped = []

  for (const [w, h, scale] of VIEWPORTS) {
    const mascot = garageMascot(w, h)
    const boxes = wardrobeStack(w, h, scale, mascot, h - 58 * scale, { name: 34 * scale, action: 48, arrow: ARROW_BOX })
    const middle = (mascot.top + mascot.bottom) / 2

    assert.ok(Math.abs(boxes.arrows.y - middle) < 1, `the arrows are ${(boxes.arrows.y - middle).toFixed(0)}px off the mascot's middle at ${w}x${h}`)
    // Outside the creature on both sides, and inside the frame with a whole target to spare.
    assert.ok(boxes.arrows.leftX < boxes.arrows.rightX, `the arrows crossed over at ${w}x${h}`)
    // **⚠ Bounded by the arrow's own half-width, not by the touch floor.** At the delivered 48px a
    // control placed `MIN_TOUCH / 2` from the edge hangs 2px off it, and at the 59px this screen
    // shipped with it hung 9px off — the same class of defect the close button was reported for.
    assert.ok(boxes.arrows.leftX >= ARROW_BOX / 2, `the left arrow is off the frame at ${w}x${h}`)
    assert.ok(boxes.arrows.rightX <= w - ARROW_BOX / 2, `the right arrow is off the frame at ${w}x${h}`)
    // **And they stand off the creature's EDGE rather than reaching over it.** The standoff used to
    // be applied to the arrow's centre, so the control overlapped the mascot by half of itself —
    // invisible while the mascot was small on a phone, and reported the moment it grew.
    assert.ok(
      boxes.arrows.leftX + ARROW_BOX / 2 <= mascot.left + 1,
      `the left arrow overlaps the mascot by ${(boxes.arrows.leftX + ARROW_BOX / 2 - mascot.left).toFixed(0)}px at ${w}x${h}`,
    )
    assert.ok(
      boxes.arrows.rightX - ARROW_BOX / 2 >= mascot.right - 1,
      `the right arrow overlaps the mascot by ${(mascot.right - boxes.arrows.rightX + ARROW_BOX / 2).toFixed(0)}px at ${w}x${h}`,
    )
    // The control: the same solve with the standoff on the centre, which is what shipped. It is
    // collected rather than asserted per frame — on a wide frame the creature is wide enough that
    // even the old arithmetic cleared it by a pixel, and what has to be shown is that this check
    // rejects something, not that every frame was broken.
    const wasLeft = Math.max(GARAGE_LAYOUT.arrowMargin * scale + MIN_TOUCH / 2, mascot.left - w * GARAGE_LAYOUT.arrowStandoff)

    overlapped.push({ w, h, by: wasLeft + ARROW_BOX / 2 - mascot.left })
    // The old arrangement, as the control: a flat 0.32 of the width either side of the centre, on a
    // row 0.55 down the frame. It has to sit visibly further from the creature than this does.
    const wasY = h * 0.55
    const isY = boxes.arrows.y

    console.log(
      `    ${w}x${h}: arrows at y ${isY.toFixed(0)} against the mascot's middle ${middle.toFixed(0)}` +
        ` (the old fixed row was ${wasY.toFixed(0)}, ${Math.abs(wasY - middle).toFixed(0)}px off);` +
        ` standoff ${(mascot.left - boxes.arrows.leftX - ARROW_BOX / 2).toFixed(0)}px of clear air`,
    )
  }

  const worst = overlapped.reduce((a, b) => (b.by > a.by ? b : a))

  assert.ok(worst.by > 0, 'the old centre-standoff arithmetic overlaps nothing, so this check measures nothing')
  console.log(`    the shipped-before standoff put the arrow ${worst.by.toFixed(0)}px over the mascot at ${worst.w}x${worst.h}`)
})

check('the way out is small type in a full-size target, and is louder only where it has a plate', () => {
  // One set of numbers for the run's HUD and the garage. They were module-private in `Hud.ts`, so
  // the garage had no way to match without copying them — and it did not: it shipped a solid
  // `kitButton` larger than the arrows the screen is actually for, which is how it was reported.
  //
  // **⚠ Then the opposite was reported: at `EXIT_ALPHA` over open sky nobody could find it.** Both
  // reports are about the same glyph and neither is wrong, so what is asserted is the *pair*: what
  // stays quiet on both screens is the type against the target, and what differs is the ink — and
  // it may only differ because one of the two is standing on the bottom bar's own plate.
  assert.ok(EXIT_GLYPH < MIN_TOUCH, 'the exit glyph is as big as its own touch target, i.e. it is not a quiet glyph')
  assert.ok(EXIT_ALPHA < 1, 'the bare exit is drawn at full strength, over a picture, with nothing behind it')
  assert.ok(
    EXIT_PLATED_ALPHA > EXIT_ALPHA,
    'the plated exit is no louder than the bare one, i.e. the plate bought the report nothing',
  )
  // And the plate has to be a surface rather than a tint, or a full-strength glyph on it is back to
  // being ink over the sky — which is the state that was reported.
  assert.ok(NAV_SURFACE.fillAlpha >= 0.8, 'the bar surface is too transparent to read a glyph against')
  console.log(
    `    ${EXIT_GLYPH}px of glyph inside a ${MIN_TOUCH}px target, at alpha ${EXIT_ALPHA} bare` +
      ` and ${EXIT_PLATED_ALPHA} on a plate of ${NAV_SURFACE.fillAlpha}`,
  )
})

check('⚠ every button the result panel does not always build is cleared before it builds any', () => {
  // **⚠ The panel stopped appearing at all, and the road stayed frozen on the wreck.** Phaser reuses
  // a scene instance across every `launch`, so a field holding a widget from a previous `create`
  // survives the shutdown that destroyed it. `RunOver` knew that and cleared two of its three
  // optional buttons; `doubleButton` — built only when the run banked something — was the one that
  // was not. A panel that had shown `Double coins`, followed by one that did not rebuild it, put the
  // destroyed widget into `actions`, bound a pointer to its dead container and resized it, and
  // `NineSlice.setTexture` threw on a game object whose scene is gone. The throw comes out of
  // `bindLayout` inside `create`, so the panel never finishes building and the loop dies with it.
  //
  // **The route there is a suspend**, which is why it was reported as a Continue bug: a suspend
  // banks, so a resumed run hands this screen the *difference* — zero, for a run that picked
  // nothing up — and zero is the one case that skips the doubler.
  //
  // Asserted by reading the source, for `Preloader`'s reason: `RunOver` imports `phaser` as a value.
  // What has to stay true is that the two sets agree — every optional button field is cleared —
  // which is precisely the list somebody had to remember to extend, and did not.
  const src = readFileSync('src/scenes/RunOver.ts', 'utf8')
  const declared = [...src.matchAll(/^\s*private (\w+): KitButton \| null = null$/gm)].map((m) => m[1])
  const cleared = [...src.matchAll(/^\s*this\.(\w+) = null$/gm)].map((m) => m[1])

  // A field typed `?` is one that reads as absent rather than as stale, which is how the third came
  // to be missed — so the shape itself is asserted, not only the clearing.
  assert.ok(!/^\s*private \w+\?: KitButton$/m.test(src), 'an optional button is typed `?`, so nothing says it has to be cleared')
  assert.ok(declared.length >= 3, `expected the panel's optional buttons to be declared \`| null\`, found ${declared.length}`)
  assert.ok(/this\.clearOptionalButtons\(\)/.test(src), 'create no longer clears the optional buttons')

  for (const field of declared) {
    assert.ok(cleared.includes(field), `${field} is built conditionally and never cleared — a second panel will resize the destroyed one`)
  }
  console.log(`    ${declared.length} optional buttons, all cleared: ${declared.join(', ')}`)
})


// --- src/ui/roundedRect.ts ------------------------------------------------------------------
//
// The gauge and the milestone rule are on screen for a whole run and are replayed by the renderer
// every frame, and `Graphics.fillRoundedRect` tessellates every arc at a hardcoded 100 points per
// corner whatever the corner measures. What these hold is that the replacement is the same shape at
// a resolution the radius chooses.

check('a corner is drawn with fewer points than Phaser would, and never fewer than two', () => {
  const PHASER_POINTS_PER_ARC = 100
  const rows = []

  for (const radius of [1, 3, 7.12, 12, 20, 60]) {
    const steps = cornerSteps(radius)

    assert.ok(steps >= 2, `a ${radius}px corner drawn with ${steps} segments is not a corner`)
    assert.ok(steps < PHASER_POINTS_PER_ARC, `a ${radius}px corner still costs ${steps} points`)
    rows.push(`${radius}px -> ${steps}`)
  }

  // The Fever tank's own radius, which is what the round was measured on.
  assert.equal(cornerSteps(7.12), 5)
  console.log(`    corner segments by radius: ${rows.join(', ')} (Phaser: ${PHASER_POINTS_PER_ARC} at every one)`)
  const tank = roundedRectPoints(0, 0, 28.16, 22.24, 7.12).length

  console.log(`    one tank segment: ${tank} points against Phaser's ${PHASER_POINTS_PER_ARC * 4}`)
  assert.ok(tank * 8 < PHASER_POINTS_PER_ARC * 4, "the whole tank should cost less than one of Phaser's rounded rects")
})

check('the outline is the rectangle it was asked for, and stays inside it', () => {
  const [x, y, w, h, r] = [12, 30, 90, 40, 9]
  const points = roundedRectPoints(x, y, w, h, r)
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)

  // Every corner arc reaches its own tangent points, so the extremes are the box's own edges.
  assert.ok(Math.abs(Math.min(...xs) - x) < 1e-9, 'the left edge is not where it was asked for')
  assert.ok(Math.abs(Math.max(...xs) - (x + w)) < 1e-9, 'the right edge is not where it was asked for')
  assert.ok(Math.abs(Math.min(...ys) - y) < 1e-9, 'the top edge is not where it was asked for')
  assert.ok(Math.abs(Math.max(...ys) - (y + h)) < 1e-9, 'the bottom edge is not where it was asked for')

  for (const p of points) {
    assert.ok(p.x >= x - 1e-9 && p.x <= x + w + 1e-9, 'a point escaped the box sideways')
    assert.ok(p.y >= y - 1e-9 && p.y <= y + h + 1e-9, 'a point escaped the box vertically')
  }

  // The four corners are actually cut: a point at the box's own corner would mean a plain rect.
  for (const [cx, cy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) {
    const nearest = Math.min(...points.map((p) => Math.hypot(p.x - cx, p.y - cy)))

    assert.ok(nearest > r * 0.2, `the corner at ${cx},${cy} was not rounded (nearest point ${nearest.toFixed(2)})`)
  }
  console.log(`    ${points.length} points, all inside the box, all four corners cut`)
})

check('an over-large radius is clamped rather than folding the outline through itself', () => {
  // Asked for more than half the shorter side the corners would cross, and `fillPoints` draws a bow
  // tie rather than refusing — the same class as a clamped slider that saturates early.
  const points = roundedRectPoints(0, 0, 20, 10, 40)

  for (const p of points) {
    assert.ok(p.x >= -1e-9 && p.x <= 20 + 1e-9 && p.y >= -1e-9 && p.y <= 10 + 1e-9, 'the outline folded outside its box')
  }

  // The winding stays monotone around the shape: a folded outline reverses direction.
  let area = 0

  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]

    area += a.x * b.y - b.x * a.y
  }
  assert.ok(Math.abs(area / 2) > 20 * 10 * 0.6, `a clamped stadium should still cover most of its box, covered ${Math.abs(area / 2).toFixed(1)}`)
  console.log(`    radius 40 on a 20x10 box: clamped to a stadium of ${Math.abs(area / 2).toFixed(1)}px^2`)
})

check('a zero radius is a plain rectangle, drawn with four points', () => {
  assert.deepEqual(roundedRectPoints(0, 0, 10, 6, 0), [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 6 },
    { x: 0, y: 6 },
  ])
})


// --- the jump's own tap rule, src/ui/scrollList.ts --------------------------------------------
//
// The runner's jump shares one finger with an ABSOLUTE steer — the snail goes where the thumb is —
// so the thumb is travelling whenever the player is playing. Borrowing the scrolling list's 12px
// rule threw the jump away: measured in the running game with real touch pointers, a tap that slid
// 21px did not jump, and "tapping does not clear the obstacle, it hits it 100% of the time" is
// exactly what that is. What tells a jump from a steer is how LONG the press lasted.
//
// These live here because `platform/input.ts` imports phaser as a value and cannot be loaded under
// Node — and because the browser harness steps the game clock synchronously, so wall-clock time
// barely advances there and the duration bound is the one half a live test cannot exercise.

check('a quick tap jumps however much the thumb slid, up to one touch target', () => {
  const quick = 80

  for (const slide of [0, 12, 21, 30, 43]) {
    assert.ok(isJumpTap(slide, 0, quick), `a ${slide}px tap should jump; 21 is what a phone measured and lost`)
  }
  // The bound the list uses is far too tight for this gesture, and that is the whole defect.
  assert.ok(!isTapBy(21, 0, LIST_TAP_SLOP_PX), 'the scrolling list would still call a 21px slide a drag, which is right for a list')
  assert.ok(isJumpTap(21, 0, quick), 'and wrong for the jump')
  console.log(`    a ${quick}ms tap jumps up to ${JUMP_TAP_SLOP_PX}px of slide; the list's own bound is ${LIST_TAP_SLOP_PX}px`)
})

check('a held press is a steer, not a jump, however still the thumb was', () => {
  assert.ok(!isJumpTap(0, 0, JUMP_TAP_MS + 1), 'a press held past the window is somebody positioning the snail')
  assert.ok(!isJumpTap(0, 0, 500), 'half a second of holding is a steer')
  assert.ok(isJumpTap(0, 0, JUMP_TAP_MS), 'the bound itself is a tap')
  console.log(`    held over ${JUMP_TAP_MS}ms it is a steer, at or under it a jump`)
})

check('a fast flick across the road is a steer, which is what the distance backstop is for', () => {
  // Either bound alone admits the other gesture: a slow small drag is a steer that did not go far,
  // and a fast flick is a steer that happened to be quick. Both, or the rule leaks one way.
  assert.ok(!isJumpTap(200, 0, 100), 'a 200px flick in 100ms is a dodge, not a jump')
  assert.ok(!isJumpTap(120, 0, 333), 'a held 120px steer is not a jump either')
  assert.ok(!isJumpTap(0, JUMP_TAP_SLOP_PX + 1, 50), 'the backstop applies on both axes')
})

// ---------------------------------------------------------------------------------------------
// The two baked readouts: how far outside its own box each one draws. See src/ui/bakedGraphics.ts.
// ---------------------------------------------------------------------------------------------

check('the fruit tank bleed covers everything it draws outside its box', () => {
  // Three widths, from the narrowest phone to a desktop.
  for (const w of [18, 28, 46]) {
    const bleed = gaugeBleed(w)
    const over = w * FULL_MARK.overhang
    const thickness = Math.max(2, w * FULL_MARK.thickness)
    const halo = Math.max(2, w * GAUGE_HALO_FRACTION)

    // Recomputed from the exported constants rather than read off the function, so that moving
    // `FULL_MARK` or the halo without moving the bleed is a failed check rather than a clipped
    // halo on somebody's phone. The texture crops silently — that is the whole reason this exists.
    assert.ok(bleed.x >= over - 1e-9, `w=${w}: the full mark overhangs ${over} and the pad is ${bleed.x}`)
    assert.ok(bleed.x >= over * 0.5 + halo / 2 - 1e-9, `w=${w}: the halo reaches past the pad sideways`)
    assert.ok(
      bleed.y >= thickness + FULL_MARK.standoff * w + 2 + halo / 2 - 1e-9,
      `w=${w}: the mark and its halo reach past the pad above the tank`,
    )
    assert.ok(bleed.y >= 4 + halo / 2 - 1e-9, `w=${w}: the halo reaches past the pad below the tank`)
  }

  console.log(
    `    tank pad ${gaugeBleed(28).x.toFixed(1)}px sideways and ${gaugeBleed(28).y.toFixed(1)}px above, at w=28`,
  )
})

check('the life row bleed covers a slot in flight, and one pitch alone does not', () => {
  // The worst an element is drawn at, sampled from the curves rather than restated: `entryBounce`
  // overshoots on arrival, `spendSquash` flattens on the way out, and the flash sits at 1.12 of
  // the radius on top of whichever is running.
  let stretch = 1

  for (let i = 0; i <= 200; i++) {
    const t = i / 200
    const squash = spendSquash(t)

    stretch = Math.max(stretch, entryBounce(t), squash.x, squash.y)
  }
  stretch *= 1.12

  assert.ok(
    LIFE_PIP_MAX_STRETCH >= stretch - 1e-9,
    `the stated stretch ${LIFE_PIP_MAX_STRETCH.toFixed(3)} is under the measured ${stretch.toFixed(3)}`,
  )

  for (const scale of [0.8, 1, 1.35]) {
    const r = LIFE_PIP.radius * scale
    const pitch = r * 2 + LIFE_PIP.gap * scale

    for (const slide of [0, 1, -3]) {
      const bleed = lifeRowBleed(scale, slide)
      // An arriving element is a whole slot to the left of home (`entryOffset` reaches 1) *and*
      // the hearts may be sliding by `slide` slots at the same time, and it is drawn `stretch` of
      // its radius where the box allows it one.
      const outline = Math.max(1.5, r * LIFE_PIP_STROKE_FRACTION) / 2
      const worst = pitch * (1 + Math.abs(slide)) + r * stretch - r + outline

      assert.ok(
        bleed.x >= worst - 1e-9,
        `scale ${scale}, slide ${slide}: pad ${bleed.x.toFixed(1)} under the ${worst.toFixed(1)} it has to cover`,
      )
      // Vertically the row does not travel, so the pad only has to cover a stretched element.
      assert.ok(bleed.y >= r * stretch - r + outline - 1e-9, `scale ${scale}: the vertical pad clips a struck element`)
      // The control: one pitch is the obvious pad and it is not enough — an element can be a slot
      // from home while the row slides under it, and it is drawn bigger than its slot as it lands.
      if (slide !== 0) assert.ok(pitch < worst, `scale ${scale}, slide ${slide}: one pitch would have been enough, so this check proves nothing`)
    }
  }

  console.log(
    `    row pad ${lifeRowBleed(1, 0).x.toFixed(1)}x${lifeRowBleed(1, 0).y.toFixed(1)}px at rest, ` +
      `${lifeRowBleed(1, -3).x.toFixed(1)}x${lifeRowBleed(1, -3).y.toFixed(1)}px mid-slide (scale 1)`,
  )
})

// ---------------------------------------------------------------------------------------------
// A blend mode is a batch boundary -- see src/run/shadowArt.ts.
// ---------------------------------------------------------------------------------------------

check('shadows are drawn with the NORMAL blend, and an empty decal mesh is hidden', () => {
  // Source-greps, because both files import `phaser` as a value. What they guard is invisible on
  // every frame: `ListCompositor` clones a `DrawingContext` and flushes the batch at every blend
  // change between consecutive display-list objects, and shadows sort by distance *between* the
  // sprites they sit under -- measured at up to 25 transitions and 40 draw calls a frame for ~170
  // objects, and byte-identical on `NORMAL` because the texture is black (see the docstring).
  const shadow = readFileSync('src/run/shadowArt.ts', 'utf8')
  const shadowCode = shadow.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

  assert.ok(shadowCode.includes('BlendModes.NORMAL'), 'shadowArt.ts: the shadow image must be NORMAL-blended')
  assert.ok(!shadowCode.includes('BlendModes.MULTIPLY'), 'shadowArt.ts: MULTIPLY on a black texture buys nothing and costs a batch flush per shadow')
  assert.match(
    shadow,
    /fillStyle = '#000000'/,
    'shadowArt.ts: the identity between NORMAL and MULTIPLY holds only for a BLACK texture',
  )

  // The decal mesh keeps its multiply -- it darkens whatever it lies on -- so what it may not do
  // is stay on the render list while it has nothing to draw.
  const decal = readFileSync('src/road/DecalMesh.ts', 'utf8')

  assert.ok(decal.includes('this.gameObject.setVisible(used > 0)'), 'DecalMesh.ts: an empty mesh must hide itself')
})

// ---------------------------------------------------------------------------------------------
// The pools keep their slack off the display list -- see src/run/pooled.ts.
// ---------------------------------------------------------------------------------------------

check('every pool shows and hides through `pooled.ts`, including the slots it creates', () => {
  // A source-grep for `Preloader`'s reason: every one of these imports `phaser` as a value, so no
  // logic suite can reach them. What it guards is a silent no-op — a pool that keeps calling
  // `setVisible(false)` on its slack leaves it on the display list, where it is iterated twice a
  // frame for nothing, and *nothing about the frame looks wrong*.
  const pools = [
    'src/road/RoadSprites.ts',
    'src/run/ObstacleSprites.ts',
    'src/run/PickupSprites.ts',
    'src/run/CritterSprites.ts',
    'src/run/RampSprites.ts',
  ]

  for (const path of pools) {
    const src = readFileSync(path, 'utf8')

    assert.match(src, /from '\.[./]*(?:run\/)?pooled'/, `${path}: does not import the pooled helpers`)
    assert.ok(src.includes('showPooled('), `${path}: never shows a slot through the helper`)
    assert.ok(src.includes('hidePooled('), `${path}: never hides a slot through the helper`)

    // The constructor case is the one worth asserting separately: `render` only hides what it
    // *stopped* using, so a slot that has never been used is on no walk at all and would sit on
    // the list for the life of the scene. Which is most of a pool.
    const built = src.slice(0, src.indexOf('this.gameObjects ='))

    assert.ok(
      src.slice(built.length, built.length + 900).includes('hidePooled('),
      `${path}: does not take its freshly built slots off the display list`,
    )
  }
})

check('the camera guard walks the pools as well as the display list', () => {
  // With the slack off the list, a guard that runs once at create and reads only `children.list`
  // sees no pooled object at all — every slot starts hidden. The union is what keeps it as strong
  // as it was, and this is the check that stops it being "simplified" back.
  const src = readFileSync('src/scenes/RunScene.ts', 'utf8')
  const guard = src.slice(src.indexOf('private assertWorldIsSingleCamera'))
  const body = guard.slice(0, guard.indexOf('\n  }\n'))

  assert.ok(body.includes('this.children.list'), 'the guard must still ask the display list')
  assert.ok(body.includes('this.worldObjects()'), 'the guard must also cover the pooled slack')
  assert.ok(body.includes('new Set'), 'the two halves have to be a union, or an object is checked twice')

  // The control: the shipped-before guard read the display list alone, which is exactly the shape
  // that would go quiet now.
  const control = 'const both = this.children.list.filter('

  assert.ok(!body.includes(control), 'the display-list-only guard is the arrangement this replaced')
})

// ---------------------------------------------------------------------------------------------
// The HUD's dirty check -- see src/ui/dirtyValues.ts.
// ---------------------------------------------------------------------------------------------

check('a dirty check reports a change once and then stops, and allocates nothing', () => {
  const d = new DirtyValues()
  const set = (a, b, c) => {
    d.begin()
    d.add(a)
    d.addFlag(b)
    d.addQuantised(c)

    return d.changed()
  }

  assert.equal(set(1, true, 0.5), true, 'the first set is always a change')
  assert.equal(set(1, true, 0.5), false, 'the same set twice is not')
  assert.equal(set(2, true, 0.5), true, 'a changed number is')
  assert.equal(set(2, true, 0.5), false, 'and then it is not')
  assert.equal(set(2, false, 0.5), true, 'a changed flag is')
  assert.equal(set(2, false, 0.5), false, 'and then it is not')

  // The quantisation is what `toFixed(3)` used to buy: fine enough that a pulse runs at full
  // rate, coarse enough that a resting readout costs one pass of compares.
  assert.equal(set(2, false, 0.5001), false, 'a change under the quantum is not a change')
  assert.equal(set(2, false, 0.5010), true, 'a change of one quantum is')

  d.reset()
  assert.equal(set(2, false, 0.501), true, 'reset makes the next set a change whatever it holds')
})

check('a dirty check handles a set that gets shorter, which a string signature did for free', () => {
  // **⚠ The one case the string version could not get wrong.** Comparing in place against a stored
  // array means a shorter set leaves stale trailing values, and without truncating them every
  // later frame reports a change for ever — a readout that redraws on every frame, i.e. exactly
  // the cost this exists to remove, arrived at from the other side.
  const d = new DirtyValues()
  const set = (values) => {
    d.begin()
    for (const v of values) d.add(v)

    return d.changed()
  }

  assert.equal(set([1, 2, 3, 4]), true, 'first set')
  assert.equal(set([1, 2, 3, 4]), false, 'unchanged')
  assert.equal(set([1, 2]), true, 'a shorter set is a change')
  assert.equal(set([1, 2]), false, 'and the same short set afterwards is not')
  assert.equal(set([1, 2, 3]), true, 'a longer set is a change')
  assert.equal(set([1, 2, 3]), false, 'and then it is not')
  assert.equal(set([]), true, 'an empty set is a change')
  assert.equal(set([]), false, 'and an empty set again is not')
})

check('the HUD guards its three readouts with it rather than with a string', () => {
  // A source-grep for `Preloader`'s reason: `Hud.ts` imports `phaser` as a value. What it guards is
  // a measurement rather than a style -- composing a signature out of `toFixed` and `join` cost
  // **0.087ms a frame** against a `paintRow` of 0.012, i.e. seven times what it was guarding.
  const src = readFileSync('src/run/Hud.ts', 'utf8')
  // Comments stripped, or the check reads the write-up of the thing it forbids and fails on it —
  // which it did on its first run.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '')

  assert.ok(src.includes("from '../ui/dirtyValues'"), 'Hud does not use the dirty check')
  assert.ok(!/signature\s*=/.test(code), 'a string signature is the arrangement this replaced')
  assert.ok(!/toFixed\(3\)/.test(code), '`toFixed` in a per-frame guard is the sharpest edge of it')
})

console.log(`${passed} checks passed`)
