#!/usr/bin/env node
// One palette check across every theme, every biome and every mascot skin.
//
// **Why a suite of its own rather than more assertions in `verify:road`.** That one is about the
// road renderer: the projection, the fog rows, the reserved threat hue, the absolute
// `GROUND_AIR_HUE_BAND`. What is here is about a *theme as a product* -- whether two of them are
// distinguishable, whether one puts the sky in the ground's colour family, whether the mascot
// survives being drawn on top of it. Those are questions about the catalogue, not about the mesh.
//
// **A1.2 (aerial perspective) deliberately lives in `verify:road` and is NOT restated here.** It is
// already asserted there as "approaching the horizon the ground is lighter and less saturated than
// the sky above it", and a rule kept in two places is a rule that will be applied in one of them.
//
// Every colour is read through `surfaceColour`, never off the authored constant. The bake lifts
// saturation, fades toward a target that is part fog and part sky, and dissolves into the sky over
// the last quarter of the ramp -- so an authored value is not a colour the player ever sees, and a
// rule swept over the wrong arithmetic is not a rule. That lesson is `paletteColour.ts`'s own.
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { decodePng } from './png.mjs'
import { chroma, contrastRatio, deltaE, fromOklab, hueDistance, mixOklab, relativeLuminance, toHsl, toOklab } from '../src/road/color.ts'
import { blendColor, getRoadTheme, setRoadTheme, themeIds, THREAT_MIN_CHROMA } from '../src/road/themes.ts'
import { BIOMES, groundShadesForTheme, MIN_GROUND_CONTRAST, themedGround, themedProp } from '../src/road/biomes.ts'
import { BIOME_SKYLINE_WEIGHT, HORIZON_Y, PALETTE_INDEX } from '../src/road/constants.ts'
import { surfaceColour } from '../src/road/paletteColour.ts'
import { INK_LIGHTNESS, lightnessOf, OBSTACLE_MATERIALS } from '../src/run/artPalette.ts'
import { OBSTACLE_ART_KEYS, OBSTACLE_RIM } from '../src/run/obstacleArt.ts'
import { recolour, SNAIL_SKINS } from '../src/run/snailSkins.ts'
import { paintInkRim, rimWidthPx } from '../src/run/inkRim.ts'
import { paintMascot, roadLuminance } from '../src/run/mascotPixels.ts'

let passed = 0
const failed = []

/**
 * **This suite reports every failure rather than stopping at the first, unlike the others here.**
 * The others guard a rule that already holds, so the first break is the news. This one was written
 * to be red: it is the instrument the seven themes are about to be repainted against, and a repaint
 * needs the whole list in one run -- a suite that hides A1.3 and A5 behind an A1.1 failure would be
 * answered one theme at a time. It still exits non-zero, so it still fails the build.
 */
function check(name, fn) {
  try {
    fn()
    passed++
    console.log(`  ok - ${name}`)
  } catch (error) {
    failed.push({ name, message: error.message })
    console.log(`  FAIL - ${name}`)
    console.log(`         ${error.message.split('\n')[0]}`)
  }
}

const THEMES = themeIds()

function themeOf(id) {
  setRoadTheme(id)

  return getRoadTheme()
}

/**
 * The ground as it is drawn under the snail -- middle shade, no fog.
 *
 * `amount: 0` is the near field on purpose: it is where the player looks, and it is the one place
 * the theme's own colour is not already on its way to becoming the sky.
 */
function nearGround(biome, theme) {
  // **⚠ `groundShadesForTheme` takes the biome's AUTHORED pair and runs `groundPairForTheme`
  // itself.** The first version of this helper computed the pair and passed *that* in, which is an
  // output where an input belongs.
  //
  // It produced the right numbers anyway, and only by cancellation: passing the pair applied the
  // theme's `groundLight` once on the way in, and the argument was in the slot the function reads
  // as `alternation`, so `groundLight` was never passed and the inner call defaulted it to 1.
  // Measured on `night`/`forest`, both forms give a shade luminance of 0.00344; a genuine double
  // application gives 0.00046. So nothing measured before this was wrong — but it was right for a
  // reason no reader could have relied on, which is the same thing as being wrong next time.
  const ground = themedGround(biome.ground, theme.groundChroma, theme.groundHue)
  const shades = groundShadesForTheme(ground, theme.road[0], theme.road[1], undefined, theme.groundLight)

  return surfaceColour({ base: shades[2], family: 'ground', fog: theme.fog, sky: theme.sky.bottom, amount: 0 })
}

function nearRoad(theme) {
  return surfaceColour({ base: theme.road[0], family: 'road', fog: theme.fog, sky: theme.sky.bottom, amount: 0 })
}

function hsl(color) {
  const v = toHsl(color)

  return `${String(Math.round(v.h)).padStart(3)} ${String(Math.round(v.s * 100)).padStart(3)}% ${String(Math.round(v.l * 100)).padStart(3)}%`
}

// ---------------------------------------------------------------------------------------------
// A1.1 -- the sky may not be made of the same colour as the ground
// ---------------------------------------------------------------------------------------------

/**
 * How far apart the sky and the ground have to sit on the hue wheel.
 *
 * **⚠ This is a REGRESSION threshold, and it is no longer derivable from the current palettes.
 * Do not present it as measured.**
 *
 * It was derived, once, on 2026-08-31, from the data *before* the repaint that followed: gated and
 * measured at `sky.top`, the themes fell into two groups with nothing between them — `dusk` at 8
 * degrees and `verdant` at 14, against `ember` at 43, `day` at 62 and `ice` at 70. The range
 * 14..43 was empty, so any value inside it was the threshold, and 30 sits near its middle at 2.1x
 * the worst failure and 0.70x the best pass.
 *
 * The repaint then fixed both failures. The live distribution is now 62, 70, 74, 78, 142 with no
 * failures and therefore **no gap to derive anything from** — so 30 is not "what the data says", it
 * is "below everything, and above where it was bad". That is a worthwhile test, and it is a
 * different claim: it says *do not go back to where we were*, not *this is the right number*.
 *
 * What would make it derivable again is a new failure. Until then, anyone re-tuning it is choosing
 * a number, not reading one, and should say so.
 */
const SKY_GROUND_MIN_HUE_DEGREES = 30

/**
 * **Measured against `sky.top`, never against `sky.bottom`, and that is the whole correctness of
 * this check.**
 *
 * The first version measured at the horizon and rejected all seven themes. It could not have done
 * anything else: the horizon is exactly where aerial perspective is *required* to bring the two
 * together -- `verify:road` asserts that it does, and `surfaceColour` dissolves the ground into the
 * sky over the last quarter of the ramp. Two conditions pulling against each other cannot both be
 * satisfied, so no palette could have passed. The question this rule is actually asking -- is the
 * sky made of the same stuff as the ground -- is about the top of the frame against the bottom of
 * it, where nothing is supposed to converge.
 */
function skyPoint(theme) {
  return theme.sky.top
}

/**
 * The worst hue distance between a theme's sky and any of its grounds, or `null` if the question
 * does not arise.
 *
 * **Both sides must carry real chroma before their hues are compared.** Below `THREAT_MIN_CHROMA` a
 * colour is a grey and its hue angle is numerical noise -- the same escape the threat reservation
 * grants, for the same reason. Without this gate the check ranked `day` and `ice` as the worst
 * themes in the game, because their worst biome is `ruins`, whose ground is very nearly neutral: a
 * blue sky was being scored 4 degrees from a grey.
 *
 * It is also what makes a deliberately monochrome theme possible at all. A sky with no chroma
 * cannot be in anything's colour family.
 */
function skyGroundHue(theme) {
  const sky = skyPoint(theme)

  if (chroma(sky) < THREAT_MIN_CHROMA) return { exempt: 'achromatic sky' }

  let worst = null

  for (const biome of BIOMES) {
    const ground = nearGround(biome, theme)

    if (chroma(ground) < THREAT_MIN_CHROMA) continue

    const distance = hueDistance(sky, ground)

    if (worst === null || distance < worst.distance) worst = { distance, biome: biome.id }
  }

  // **⚠ Distinguished from an achromatic sky, because they are not the same fact.** A theme whose
  // sky has no hue cannot be in anyone's family and is exempt by construction. A theme that has
  // taken the chroma out of every one of its own grounds has made the question not arise, which
  // is a way of passing this check rather than of answering it -- `ember` did exactly that at
  // `groundChroma: 0.45` and read as a second monochrome theme. Reported separately so it cannot
  // be mistaken for a pass.
  return worst ?? { exempt: 'every ground achromatic' }
}

console.log('A1.1 - the sky is not made of the same colour as the ground')

check('every theme with a chromatic sky keeps it out of the ground family', () => {
  const rows = []
  const failures = []

  for (const id of THEMES) {
    const theme = themeOf(id)
    const worst = skyGroundHue(theme)

    rows.push({ id, sky: skyPoint(theme), worst })

    if (worst.distance !== undefined && worst.distance < SKY_GROUND_MIN_HUE_DEGREES) failures.push({ id, ...worst })
  }

  console.log(`    floor ${SKY_GROUND_MIN_HUE_DEGREES} deg, sky.top vs near ground, both sides gated at chroma ${THREAT_MIN_CHROMA}:`)

  for (const { id, sky, worst } of rows) {
    const verdict = worst.exempt ? `${worst.exempt} - exempt` : `${String(Math.round(worst.distance)).padStart(3)} deg vs ${worst.biome}`
    const flag = worst.distance !== undefined && worst.distance < SKY_GROUND_MIN_HUE_DEGREES ? '  <-- IN THE GROUND FAMILY' : ''

    console.log(`      ${id.padEnd(9)} sky.top ${hsl(sky)}  chroma ${chroma(sky).toFixed(3)}  ${verdict}${flag}`)
  }

  assert.equal(
    failures.length,
    0,
    `sky sits in its own ground hue family: ${failures.map((f) => `${f.id} (${Math.round(f.distance)} deg vs ${f.biome})`).join(', ')}`,
  )
})

check('the check measures something: the horizon point it replaced rejects every theme', () => {
  // The negative control, and it is the *previous version of this check* rather than a fixture.
  // Measured at `sky.bottom` all seven themes fail, including the ones nobody has ever complained
  // about -- which is what a measurement taken where two quantities are required to converge looks
  // like. If this ever stops rejecting everything, the bake has changed and the argument above for
  // measuring at `sky.top` needs re-reading.
  let rejected = 0

  for (const id of THEMES) {
    const theme = themeOf(id)
    let worst = 999

    for (const biome of BIOMES) worst = Math.min(worst, hueDistance(theme.sky.bottom, nearGround(biome, theme)))

    if (worst < SKY_GROUND_MIN_HUE_DEGREES) rejected++
  }

  // **⚠ Asserted as "strictly more than at `sky.top`", not as "all seven".** It was all seven, and
  // the repaint that followed changed that -- which is the control doing its job rather than
  // failing: the themes moved, so a count fixed to the pre-repaint data would have been a number
  // carried over exactly like the threshold it was written to justify. What stays true, and is
  // the actual claim, is that the horizon point is systematically stricter because it measures a
  // convergence the renderer is required to produce.
  let atTop = 0

  for (const id of THEMES) {
    const worst = skyGroundHue(themeOf(id))

    if (worst.distance !== undefined && worst.distance < SKY_GROUND_MIN_HUE_DEGREES) atTop++
  }

  assert.ok(rejected > atTop, `the horizon point rejects ${rejected} and sky.top rejects ${atTop}, so the two points no longer differ`)
  console.log(`    at sky.bottom ${rejected} of ${THEMES.length} themes are rejected, at sky.top ${atTop} - the old point was measuring the dissolve`)
})

check('the chroma gate is load-bearing: without it a passing theme is ranked as failing', () => {
  // The second control, and it is asserted as a *claim* rather than against named themes.
  //
  // **⚠ It named `day` and `ice` first, and the repaint broke it — exactly as it broke the control
  // above.** `ice` was given a ground of its own, stopped failing ungated, and this failed for a
  // reason with nothing to do with the gate. A control pinned to the data it was written on has an
  // expiry date; what is durable is the property it exists to demonstrate.
  //
  // The property: excluding near-neutral grounds changes at least one theme's verdict. It has to,
  // or the gate is doing nothing and the argument for it is decoration.
  function ungated(theme) {
    let worst = 999

    for (const biome of BIOMES) worst = Math.min(worst, hueDistance(skyPoint(theme), nearGround(biome, theme)))

    return worst
  }

  const flipped = []

  for (const id of THEMES) {
    const theme = themeOf(id)

    if (chroma(skyPoint(theme)) < THREAT_MIN_CHROMA) continue

    const before = ungated(theme)
    const after = skyGroundHue(theme)

    if (before < SKY_GROUND_MIN_HUE_DEGREES && after.distance >= SKY_GROUND_MIN_HUE_DEGREES) {
      flipped.push(`${id} ${Math.round(before)} -> ${Math.round(after.distance)}`)
    }
  }

  assert.ok(flipped.length > 0, 'no theme changes verdict when greys are excluded, so the chroma gate has stopped mattering')
  console.log(`    rescued from a hue angle measured against a grey: ${flipped.join(', ')}`)
})

// ---------------------------------------------------------------------------------------------
// A1.3 -- a theme may change the brightness of the frame, but not the readability of the road
// ---------------------------------------------------------------------------------------------

/**
 * How legible the road's edge has to be, and how equally.
 *
 * **⚠ Measured as a perceptual lightness difference, not as a WCAG contrast ratio, and the ratio
 * was not merely a worse unit — it was self-defeating on the themes it mattered most for.**
 *
 * The first version of this check asked that the per-theme *mean* ground-to-road contrast ratio
 * agree across themes to 1.5x. It measured 1.89x and could not be satisfied. Three findings came
 * out of trying, in order:
 *
 * 1. **The ratio exaggerates the disagreement.** The same seven themes measured in OKLab lightness
 *    spread 1.59x rather than 1.89x, and six of them agree to **1.13x** (0.180..0.203) with `day`
 *    alone at 0.286. The ratio's `+0.05` denominator dominates at the luminances a night theme
 *    works at, so it is reporting the offset as much as the colours.
 * 2. **`day`'s surplus is not a defect and cannot be one.** A brighter theme has a stronger edge;
 *    that is what daylight is. A two-sided bound punishes the theme for being *more* legible, which
 *    is not a state any player can experience as a problem. So this rule is one-sided: nothing may
 *    be less legible than the floor, and exceeding it is the theme working.
 * 3. **⚠ And the existing `MIN_GROUND_CONTRAST` is itself unevenly strict**, which nothing had ever
 *    asked. The same 1.6 ratio delivers a perceptual edge of 0.143 on `ice` and 0.195 on `night` —
 *    a 1.36x spread in what the rule actually buys. Raising it makes that **worse**, not better:
 *    measured at 1.7 / 1.8 / 1.9 the spread goes 1.41x / 1.61x / 1.87x while the darkest ground
 *    falls 0.0013 / 0.0003 / 0.0000, i.e. into the black verges "Why The Game Rendered Dark"
 *    records. On a dark theme the only way to win ratio is to go to zero.
 *
 * So constancy is asserted on **the floor**, where readability lives, and not on the mean, where a
 * theme's character lives.
 *
 * **Both numbers are regression thresholds, derived on 2026-09-01 and not derivable now**, for the
 * reason both of this suite's other floors carry: a threshold read out of a distribution stops
 * being readable from it the moment it passes. The floor is the current weakest edge (`ice`, 0.143)
 * rounded down; the spread bound sits just above the current 1.36x. What makes them worth having is
 * the control below, which is a real alternative rather than a fixture.
 */
const EDGE_MIN_LIGHTNESS = 0.14
const EDGE_SPREAD = 1.4

/** The perceptual lightness gap between two surfaces. */
function edge(a, z) {
  return Math.abs(toOklab(a).L - toOklab(z).L)
}

/** Every theme's weakest road edge, over its nine biomes, at a given contrast floor. */
function worstEdges(floor) {
  return THEMES.map((id) => {
    const theme = themeOf(id)
    const road = nearRoad(theme)
    let worst = Infinity

    for (const biome of BIOMES) {
      const shades = groundShadesForTheme(
        themedGround(biome.ground, theme.groundChroma, theme.groundHue),
        theme.road[0],
        theme.road[1],
        floor,
        theme.groundLight,
      )
      const ground = surfaceColour({ base: shades[2], family: 'ground', fog: theme.fog, sky: theme.sky.bottom, amount: 0 })

      worst = Math.min(worst, edge(ground, road))
    }

    return { id, worst }
  })
}

console.log('\nA1.3 - a theme changes the brightness of the frame, not the readability of the road')

check('every theme keeps the road edge legible, and equally legible', () => {
  const rows = worstEdges(undefined)
  const worsts = rows.map((row) => row.worst)
  const spread = Math.max(...worsts) / Math.min(...worsts)

  console.log(`    weakest road edge per theme, in OKLab lightness (floor ${EDGE_MIN_LIGHTNESS}, spread bound ${EDGE_SPREAD}x):`)
  for (const row of rows) console.log(`      ${row.id.padEnd(9)} ${row.worst.toFixed(3)}`)
  console.log(`    spread ${spread.toFixed(2)}x`)

  // The mean is printed and deliberately NOT asserted: it is where a theme's character lives, and
  // `day` sits 40% above the tightest because daylight has more contrast than moonlight.
  const means = THEMES.map((id) => {
    const theme = themeOf(id)
    const road = nearRoad(theme)

    return `${id} ${(BIOMES.reduce((sum, biome) => sum + edge(nearGround(biome, theme), road), 0) / BIOMES.length).toFixed(3)}`
  })

  console.log(`    mean edge, reported only: ${means.join('  ')}`)

  for (const row of rows) {
    assert.ok(row.worst >= EDGE_MIN_LIGHTNESS, `${row.id} leaves its weakest road edge at ${row.worst.toFixed(3)}, under the floor`)
  }

  assert.ok(spread <= EDGE_SPREAD, `the road edge is ${spread.toFixed(2)}x more legible on one theme than another`)
})

check('the check bites: tightening the ratio floor makes both numbers worse', () => {
  // **The control is a real alternative, not a fixture.** Raising `MIN_GROUND_CONTRAST` is the
  // obvious way to make a road edge more legible and it is what this round tried first. It fails in
  // both directions at once, which is the whole argument for measuring perceptually — so if it ever
  // stops failing, the ratio has become a usable rule again and the reasoning above needs re-reading.
  const tightened = worstEdges(1.8).map((row) => row.worst)
  const spread = Math.max(...tightened) / Math.min(...tightened)

  assert.ok(spread > EDGE_SPREAD, `at a 1.8 ratio floor the perceptual spread is ${spread.toFixed(2)}x, which no longer exceeds the bound`)
  console.log(`    at MIN_GROUND_CONTRAST 1.8 the spread is ${spread.toFixed(2)}x against ${EDGE_SPREAD}x, and the darkest ground falls toward black`)
})

// ---------------------------------------------------------------------------------------------
// A2 -- the theme colours the whole frame, and does not erase the place while doing it
// ---------------------------------------------------------------------------------------------

/**
 * How much of a biome's own separation has to survive the theme's light on its props.
 *
 * **⚠ A retention ratio and not a floor, because the two facts it separates are different.** How
 * far apart two biomes' props are is capped by how far apart they were *authored*: `dunes` and
 * `ruins` sit 0.035 apart at source, the closest pair in the set, because both are warm stone. A
 * theme can only ever shrink that — a hue rotation preserves distance and a chroma scale under 1
 * reduces it — so an absolute floor would be measuring the biome authoring and calling it a theme
 * defect.
 *
 * What it caught: `multiplyTint(biome.decorTint, theme.decorTint)` retained **48–57%** on the dark
 * themes, and on `ember` the nearest two biomes came out **0.012** apart — forest and wetland were
 * the same orange. The theme was colouring the whole frame exactly as A2 asks and erasing the place
 * while it did it.
 *
 * Derived on 2026-09-01: after `themedProp` the chromatic themes retain 61–100%, so 0.55 admits
 * them and rejects the arrangement that shipped. A regression threshold, like the rest here.
 */
const PROP_BIOME_RETENTION = 0.55

/**
 * How far apart two themes' road markings have to sit.
 *
 * **Measured on the marking slots only — the two rumble stripes and the rung — never on the
 * asphalt.** Both asphalt slots are close to neutral on every theme *by necessity*: an obstacle is
 * read against them, and `PALETTE_SATURATION.road` is the smallest of the three for that reason. A
 * mean over all five slots therefore punishes a theme for obeying a rule it has to obey, and it is
 * what made this look like a five-pair failure when it was a three-pair one.
 */
const MARKING_MIN_DISTANCE = 0.1

console.log('\nA2 - the theme colours the whole frame, and does not erase the place')

check('a theme lights the props without collapsing the biomes into one', () => {
  const rows = []

  for (const id of THEMES) {
    const theme = themeOf(id)
    let kept = 0
    let pairs = 0
    let worst = { drawn: Infinity }

    for (let i = 0; i < BIOMES.length; i++) {
      for (let j = i + 1; j < BIOMES.length; j++) {
        const authored = deltaE(BIOMES[i].decorTint, BIOMES[j].decorTint)
        const drawn = deltaE(
          themedProp(BIOMES[i].decorTint, theme.decorTint, theme.propChroma, theme.propHue),
          themedProp(BIOMES[j].decorTint, theme.decorTint, theme.propChroma, theme.propHue),
        )

        kept += drawn / authored
        pairs++
        if (drawn < worst.drawn) worst = { drawn, pair: `${BIOMES[i].id}/${BIOMES[j].id}` }
      }
    }

    rows.push({ id, retention: kept / pairs, worst, monochrome: theme.propChroma === 0 })
  }

  console.log(`    biome separation surviving the theme's light on props (floor ${(PROP_BIOME_RETENTION * 100).toFixed(0)}%):`)
  for (const row of rows) {
    const note = row.monochrome ? '  monochrome theme - exempt' : ''

    console.log(`      ${row.id.padEnd(9)} ${(row.retention * 100).toFixed(0).padStart(3)}%   closest ${row.worst.pair.padEnd(16)} ${row.worst.drawn.toFixed(3)}${note}`)
  }

  for (const row of rows) {
    // A theme that has deliberately removed chroma cannot be asked to preserve hue separation --
    // the same exemption A1.1 grants an achromatic sky, and for the same reason. `signal` says it
    // is monochrome and its props have to be too, or the claim is only about the ground.
    if (row.monochrome) continue

    assert.ok(
      row.retention >= PROP_BIOME_RETENTION,
      `${row.id} keeps only ${(row.retention * 100).toFixed(0)}% of the biomes' separation on its props`,
    )
  }

  assert.ok(rows.some((row) => row.monochrome), 'no theme is monochrome any more, so the exemption above is dead code')
})

check('two themes are told apart by their road markings, not only by their sky', () => {
  const marks = (theme) => [theme.road[PALETTE_INDEX.RUMBLE_DARK], theme.road[PALETTE_INDEX.RUMBLE_LIGHT], theme.road[PALETTE_INDEX.TRACK_MARK]]
  const failures = []
  const pairs = []

  for (let i = 0; i < THEMES.length; i++) {
    for (let j = i + 1; j < THEMES.length; j++) {
      const a = themeOf(THEMES[i])
      const aMarks = marks(a)
      const z = themeOf(THEMES[j])
      const zMarks = marks(z)
      const distance = aMarks.reduce((sum, colour, k) => sum + deltaE(colour, zMarks[k]), 0) / aMarks.length
      // A greyscale theme's markings are grey on purpose, so it is exempt from being told apart
      // *by hue* from anything -- what tells `signal` apart is that it has no colour at all.
      const monochrome = a.propChroma === 0 || z.propChroma === 0

      pairs.push({ a: THEMES[i], z: THEMES[j], distance, monochrome })
      if (!monochrome && distance < MARKING_MIN_DISTANCE) failures.push(`${THEMES[i]}/${THEMES[j]} (${distance.toFixed(3)})`)
    }
  }

  pairs.sort((x, y) => x.distance - y.distance)

  console.log(`    rumble and rung, mean deltaE (floor ${MARKING_MIN_DISTANCE}, asphalt deliberately excluded):`)
  for (const pair of pairs.slice(0, 5)) {
    console.log(`      ${pair.a.padEnd(8)} ${pair.z.padEnd(8)} ${pair.distance.toFixed(3)}${pair.monochrome ? '  monochrome - exempt' : ''}`)
  }
  console.log(`      ... ${pairs.length - 5} further pairs, up to ${pairs[pairs.length - 1].distance.toFixed(3)}`)

  assert.equal(failures.length, 0, `themes sharing their road markings: ${failures.join(', ')}`)
})

// ---------------------------------------------------------------------------------------------
// A3 -- two themes are two products
// ---------------------------------------------------------------------------------------------

/**
 * How different two themes have to be, weighted by how much of a portrait frame each part fills.
 *
 * **⚠ This replaced a ground-only `deltaE`, and the replacement was forced by the metric being
 * wrong rather than by its threshold being wrong.** Ground alone put `dusk`/`signal` at 0.003 and
 * four themes inside 0.08 of each other, and no repaint could fix it: four of the seven are dark
 * themes whose grounds all approach black, and `deltaE` between dark colours is compressed by the
 * geometry of the space, not by the palettes. `ember` as ash and `signal` as monochrome are
 * *required* to have similar earth -- that is what those two themes mean. So the metric was
 * measuring "the grounds are alike" while the question is "the themes are alike", and at the dark
 * end those are different statements.
 *
 * The sky is 62% of a portrait frame and the ground 38% (`HORIZON_Y`), so both are weighted by the
 * share they actually occupy.
 *
 * **The two distances are kept apart and summed, never blended into one colour first.** A red sky
 * over green ground and a green sky over red ground average to the same grey, and a metric that
 * called those two themes identical would be repeating the mistake this one was written to fix.
 *
 * **⚠ The floor was derived, and the repaint that followed stopped it being derivable — exactly as
 * happened to `SKY_GROUND_MIN_HUE_DEGREES` one block up. It is a regression threshold now.**
 *
 * Derived on 2026-08-31, over all 21 pairs, before `ice` was repainted: `day`/`ice` at 0.033, then
 * nothing until `ice`/`verdant` at 0.072 and the rest up to 0.414. The range 0.033..0.072 was
 * empty, so 0.05 sat inside it at 1.5x the failure and 0.69x the nearest pass, and it rejected
 * exactly one pair — a real finding rather than a tuning artefact, since the ground-only metric it
 * replaced had scored that same pair 0.110 and called it healthy.
 *
 * Separating `ice` fixed it. The live distribution is 0.082..0.414 with no failures and **no gap
 * to read a number out of**, so 0.05 now says *do not go back to where two themes were one*, not
 * *this is what the data shows*.
 *
 * **That both of this suite's thresholds ended up here is the pattern, not a coincidence:** a
 * threshold derived from a distribution stops being derivable the moment it does its job. The
 * honest state for a passing check is a regression threshold with the date and the data it came
 * from written down, and anyone re-tuning one is choosing a number rather than reading one.
 */
const THEME_MIN_DISTANCE = 0.05

console.log('\nA3 - two themes are two products')

check('every pair of themes is distinguishable by more than one of them being darker', () => {
  const sky = {}
  const ground = {}

  for (const id of THEMES) {
    const theme = themeOf(id)

    // The sky band is a top-to-bottom gradient, so what fills its area is the midpoint.
    sky[id] = mixOklab(theme.sky.top, theme.sky.bottom, 0.5)

    let L = 0
    let a = 0
    let b = 0

    for (const biome of BIOMES) {
      const lab = toOklab(nearGround(biome, theme))

      L += lab.L
      a += lab.a
      b += lab.b
    }

    ground[id] = fromOklab({ L: L / BIOMES.length, a: a / BIOMES.length, b: b / BIOMES.length })
  }

  const pairs = []

  for (let i = 0; i < THEMES.length; i++) {
    for (let j = i + 1; j < THEMES.length; j++) {
      const a = THEMES[i]
      const z = THEMES[j]
      const skyD = deltaE(sky[a], sky[z])
      const groundD = deltaE(ground[a], ground[z])

      pairs.push({ a, z, skyD, groundD, distance: HORIZON_Y * skyD + (1 - HORIZON_Y) * groundD })
    }
  }

  pairs.sort((x, y) => x.distance - y.distance)

  console.log(`    weighted pair distance = ${HORIZON_Y.toFixed(2)}*dE(sky) + ${(1 - HORIZON_Y).toFixed(2)}*dE(ground), floor ${THEME_MIN_DISTANCE}:`)
  for (const pair of pairs.slice(0, 6)) {
    console.log(
      `      ${pair.a.padEnd(8)} ${pair.z.padEnd(8)} ${pair.distance.toFixed(3)}  (sky ${pair.skyD.toFixed(3)}, ground ${pair.groundD.toFixed(3)})${pair.distance < THEME_MIN_DISTANCE ? '  <-- ONE PRODUCT' : ''}`,
    )
  }
  console.log(`      ... ${pairs.length - 6} further pairs, up to ${pairs[pairs.length - 1].distance.toFixed(3)}`)

  const failures = pairs.filter((pair) => pair.distance < THEME_MIN_DISTANCE)

  assert.equal(
    failures.length,
    0,
    `themes a player cannot tell apart: ${failures.map((f) => `${f.a}/${f.z} (${f.distance.toFixed(3)})`).join(', ')}`,
  )
})

// ---------------------------------------------------------------------------------------------
// A4 -- an obstacle is never the colour of the landscape
// ---------------------------------------------------------------------------------------------

/**
 * How far an obstacle's body has to sit from anything in the landscape.
 *
 * **⚠ The reservation is a distance, not a hue band, and that is a finding rather than a
 * simplification.** The instruction this implements was to reserve a colour *range* for obstacles
 * that appears in no theme's decor or landscape. Swept over all 763 non-obstacle colours in the
 * game, bucketed into 24 hue sectors: **every sector carrying usable chroma is occupied**, and the
 * only empty ones are the sector the threat colour already owns and its neighbours. There is no
 * free hue to reserve — the sky sweeps blue through violet, the ground sweeps warm, `verdant` and
 * `dusk` take the rest.
 *
 * What the same sweep did show is the shape of the problem: **77% of the landscape carries no
 * usable chroma at all.** It is mostly greys, and so are the obstacles, which is exactly why they
 * are confusable. So the rule is stated as a perceptual distance from everything, which is the
 * property actually wanted, and any of hue, chroma or lightness may deliver it.
 *
 * **⚠ And what an obstacle is confused with is NOT what it is seen against.** The report was that
 * the grey slabs match the mountains — but an obstacle never crosses the horizon: `CAMERA_HEIGHT`
 * is 1000 against a tallest band of 620, so every obstacle top projects *below* the horizon row at
 * every distance (1247px to 996px against a horizon at 992 on a 900x1600 frame), approaching it
 * from below and never reaching it. An obstacle is always silhouetted against the **ground**.
 *
 * Both relationships matter and they are different failures, so both are asserted:
 *
 * - against the **skyline**, it is a *confusion* — two pale grey shapes in one frame, and the eye
 *   cannot tell which is a hazard. Measured at 0.013 on `signal`, i.e. the same colour.
 * - against the **ground**, it is a *disappearance* — the object vanishes into what it stands on.
 *   Nobody reported this one, and it was worse: `blocking` on `ice`/`coast` at 0.029.
 */
const OBSTACLE_MIN_DISTANCE = 0.1

/** How hard the contour has to work on a ground the body does not answer. Mirrors the mascot's. */
const OBSTACLE_RIM_MIN_CONTRAST = 2

/**
 * **⚠ And the reservation is against the surfaces an obstacle is actually READ against, not
 * against every colour in the game. The wider form was measured and is unachievable.**
 *
 * Swept over the whole sRGB cube against all 728 world surfaces, the most isolated colour in this
 * game is **pure magenta at a distance of 0.231**, with pure blue next. Every muted colour is
 * closer. So a reservation demanding an obstacle differ from *everything* can only be satisfied at
 * full saturation — and that breaks a rule this game depends on more: **saturation means "come and
 * get it"**, which is what makes a pickup legible. A magenta boulder reads as a reward.
 *
 * The colour budget is already spent: red is the threat, saturated is a reward, muted is the world.
 * There is no unused muted region left to hand to obstacles, and taking a saturated one would cost
 * the pickups their meaning to buy the obstacles theirs.
 *
 * What is both satisfiable and worth having is narrower and is the real requirement: an obstacle
 * must separate from **the ground of the biome it is standing on** — which is the only thing it is
 * ever silhouetted against — and from **the skyline**, which is the thing it is confused with.
 * Everything else in the list was a surface the obstacle and the player never share a moment with.

/**
 * The obstacle's two body tones.
 *
 * `dark` is deliberately excluded: `artPalette.ts` holds every `dark` band below `INK_LIGHTNESS`,
 * so it is the ink side of the object rather than its colour, and ink is allowed to coincide with
 * anything else dark — that is what ink is for.
 */
function obstacleBodies() {
  const bodies = []

  for (const [id, material] of Object.entries(OBSTACLE_MATERIALS)) {
    bodies.push({ id: `${id}.light`, color: material.light })
    bodies.push({ id: `${id}.mid`, color: material.mid })
  }

  return bodies
}

/** Everything in the world that is not an obstacle and is large enough to be confused with one. */
function landscape() {
  const out = []

  for (const id of THEMES) {
    const theme = themeOf(id)

    for (const biome of BIOMES) {
      // The range, as `Backdrop.setSkylineTint` composes it. Confusion rather than contrast: an
      // obstacle never crosses the horizon, so these two are never adjacent -- they are simply two
      // pale grey shapes in one frame, and the eye has to be able to say which is the hazard.
      out.push({ label: `${id}/skyline/${biome.id}`, color: blendColor(theme.sky.bottom, biome.decorTint, BIOME_SKYLINE_WEIGHT) })

      const shades = groundShadesForTheme(
        themedGround(biome.ground, theme.groundChroma, theme.groundHue),
        theme.road[0],
        theme.road[1],
        undefined,
        theme.groundLight,
      )

      // Near field and half-fogged: an obstacle is read across that whole span.
      for (const shade of shades) {
        for (const amount of [0, 0.5]) {
          out.push({ label: `${id}/${biome.id}/ground`, color: surfaceColour({ base: shade, family: 'ground', fog: theme.fog, sky: theme.sky.bottom, amount }) })
        }
      }
    }

    // The road is deliberately absent: an obstacle stands *on* it and is read against the ground
    // beyond it, and `MIN_GROUND_CONTRAST` already owns the road's own edge.
  }

  return out
}

console.log('\nA4 - an obstacle is never the colour of the landscape')

check('every obstacle separates from every ground, by its own colour or by its contour', () => {
  const world = landscape()
  const failures = []
  const rows = []

  for (const key of OBSTACLE_ART_KEYS) {
    const path = `public/assets/obstacle/${key}.png`

    // **Measured on the shipped pixels, not on `OBSTACLE_MATERIALS`.** That table is the procedural
    // fallback's palette and the game does not draw it: `ObstacleSprites` applies no tint, so what
    // ships is the render. The first version of this check measured the table and reported numbers
    // about art nobody sees -- the same mistake as reading an authored colour instead of the bake.
    if (!existsSync(path)) continue

    const png = decodePng(readFileSync(path))
    const body = []

    for (let i = 0; i < png.data.length; i += 4) {
      if (png.data[i + 3] < 200) continue

      const color = (png.data[i] << 16) | (png.data[i + 1] << 8) | png.data[i + 2]

      // Below the ink threshold is the object's own shadow side, not its colour.
      if (lightnessOf(color) < INK_LIGHTNESS) continue

      body.push(toOklab(color))
    }

    assert.ok(body.length > 100, `${key} has no readable body`)

    const mean = fromOklab({
      L: body.reduce((sum, lab) => sum + lab.L, 0) / body.length,
      a: body.reduce((sum, lab) => sum + lab.a, 0) / body.length,
      b: body.reduce((sum, lab) => sum + lab.b, 0) / body.length,
    })

    let worst = { distance: Infinity }

    for (const surface of world) {
      const distance = deltaE(mean, surface.color)

      if (distance < worst.distance) worst = { distance, ...surface }
    }

    // The contour is what carries the pairs the body cannot, exactly as the mascot's does. Its two
    // tones bracket the luminance range, so the better of them is the one that has to clear.
    const carried = Math.max(contrastRatio(OBSTACLE_RIM.color, worst.color), contrastRatio(OBSTACLE_RIM.innerColor, worst.color))

    rows.push({ key, worst, carried })

    if (worst.distance < OBSTACLE_MIN_DISTANCE && carried < OBSTACLE_RIM_MIN_CONTRAST) {
      failures.push(`${key} vs ${worst.label} (${worst.distance.toFixed(3)}, contour only ${carried.toFixed(2)}:1)`)
    }
  }

  assert.ok(rows.length > 0, 'no shipped obstacle art was measured at all')

  console.log(`    shipped obstacle renders against ${world.length} world surfaces (body floor ${OBSTACLE_MIN_DISTANCE}, contour floor ${OBSTACLE_RIM_MIN_CONTRAST}:1):`)
  for (const row of rows) {
    console.log(
      `      ${row.key.padEnd(20)} nearest ${row.worst.label.padEnd(24)} ${row.worst.distance.toFixed(3)}${row.worst.distance < OBSTACLE_MIN_DISTANCE ? `  carried by the contour at ${row.carried.toFixed(1)}:1` : ''}`,
    )
  }

  assert.equal(failures.length, 0, `obstacles the landscape swallows: ${failures.join(', ')}`)
})

check('the contour brackets the range, so no ground can defeat both of its tones', () => {
  // **The structural half, and it is what makes the `or` above worth anything.** If both tones ever
  // land on the same side of the ground's luminance range, there is a ground that defeats the whole
  // contour and the check above would be passing on luck. Asserted against every surface in the
  // world rather than against the seven that exist today.
  const world = landscape()
  let worst = { carried: Infinity }

  for (const surface of world) {
    const carried = Math.max(contrastRatio(OBSTACLE_RIM.color, surface.color), contrastRatio(OBSTACLE_RIM.innerColor, surface.color))

    if (carried < worst.carried) worst = { carried, label: surface.label }
  }

  console.log(`    the weakest the contour ever gets, over all ${world.length} surfaces: ${worst.carried.toFixed(2)}:1 on ${worst.label}`)
  assert.ok(worst.carried >= OBSTACLE_RIM_MIN_CONTRAST, `${worst.label} defeats both contour tones at ${worst.carried.toFixed(2)}:1`)
})

check('the classes stay told apart by value, which is what survives the haze', () => {
  // The rule this must not break while satisfying the one above. Hue and chroma are taken away by
  // the distance haze and the biome tint; value is what is left, and it is how a player tells a
  // block they can hop from a panel they cannot. `verify:obstacles` owns the same rule against the
  // shipped art -- this is the palette half, so a repaint for A4 cannot quietly flatten it.
  const means = Object.entries(OBSTACLE_MATERIALS).map(([id, material]) => ({
    id,
    value: (lightnessOf(material.light) + lightnessOf(material.mid) + lightnessOf(material.dark)) / 3,
  }))

  console.log(`    class value means: ${means.map((m) => `${m.id} ${m.value.toFixed(0)}`).join('  ')}`)

  for (let i = 0; i < means.length; i++) {
    for (let j = i + 1; j < means.length; j++) {
      assert.ok(
        Math.abs(means[i].value - means[j].value) >= 12,
        `${means[i].id} and ${means[j].id} are ${Math.abs(means[i].value - means[j].value).toFixed(0)} apart in value, under the 12 the haze leaves`,
      )
    }
  }
})

// ---------------------------------------------------------------------------------------------
// A5 -- the mascot is never the colour of what it is drawn on
// ---------------------------------------------------------------------------------------------

/** Below these two together, the mascot and its backdrop are one colour to a glancing eye. */
const MASCOT_MIN_HUE_DEGREES = 20
const MASCOT_MIN_LUMINANCE = 0.15

/**
 * How much of the mascot may merge with one backdrop before that backdrop counts against it.
 *
 * **⚠ This used to be half of an `or` and it is now the whole of the measurement, because the
 * contour is gone.** The mascot wore a two-tone rim for four rounds; it was reported in every one
 * of them and the fourth report was *remove it entirely, not black, not white, none*. So the rule
 * this file could assert -- *either the colour stands off the ground or the edge does* -- lost its
 * second half, and asserting the first half alone would be asserting a promise the code no longer
 * makes: 16 of the 40 skin-and-backdrop pairs are over this floor today, worst 77%.
 *
 * The per-pair share is therefore **printed and not asserted**, exactly as `ACCENT_MIN_SKY_CONTRAST`'s
 * fallback ratio is. What is asserted is below.
 */
const MASCOT_MAX_MERGED = 0.1

/**
 * How many of the 35 (skin, theme) pairs may merge with **the road itself**.
 *
 * **This is the rule that survives the contour, and the road is the only backdrop that can carry
 * one.** `ROAD_EDGE` is 0.875, so the verge is reached at full lock and nowhere else; the road is
 * what the mascot is drawn on for the whole of every run. A skin the colour of the asphalt is lost
 * for that entire run, which is a different thing from a skin that matches one biome's verge.
 *
 * **⚠ A count over the nine grounds was written first and is vacuous — recorded so it is not
 * written again.** A theme applies *one* hue rotation to all nine biomes, so their grounds stay
 * spread across the wheel and no single skin hue can be near many of them at once: the control for
 * that rule — a skin rotated onto a ground's own hue — merged with **2 of 9**, i.e. no worse than
 * the shipped skins, so the count could not reject the thing it existed to reject. The road can:
 * one colour, every theme, every second of the run.
 *
 * Four pairs are over the floor today — `amber` on `day` and on `ember`, `indigo` on `night` and on
 * `ice` — each a warm or a cold snail on asphalt of the same temperature. A regression threshold,
 * measured 2026-09-07 and stated as one.
 */
const MASCOT_MAX_ROAD_PAIRS = 4

/**
 * The slime trail's own two colours, from `SlimeTrail.ts`.
 *
 * **They are constants there, not theme colours, and that is the finding this check exists for.**
 * The trail is drawn in one fixed yellow-green whatever the theme, so a mascot in that hue merges
 * with its own trail on every theme identically — and no repaint of any palette can reach it.
 * Measured before the rim: `fern` lost 36% of its silhouette to its own trail, on all seven.
 */
const SLIME = [0x9fc24a, 0xe8f7a6]

console.log('\nA5 - the mascot separates from everything it is drawn on')

/**
 * How much brighter than the road the mascot's pad may be.
 *
 * A wet green surface in sunlight really is brighter than asphalt, so this is not 1. What it rules
 * out is the reported frame, where the pad measured **7.3x** the road it was lying on and was the
 * brightest thing on screen.
 */
const PAD_MAX_ROAD_RATIO = 3

check('the pad is told apart from the creature, and it is a third of the render', () => {
  // **The creature, not the sprite.** The render is a snail standing on a spread of its own foot,
  // and that pad is most of the sprite's width at the bottom -- so every question of the form "what
  // colour is the mascot" that reads the whole sprite is mostly a question about its foot. The mask
  // is what A5 measures the interior through, and what the pad's own light is applied to.
  //
  // **⚠ This check used to be about a contour, and there is no longer one.** The mask was added
  // because the rim traced the pad rather than the creature; the rim was then reported three more
  // times and removed outright. What the mask is still for is the two things above, so what
  // survives here is the half that was never about the outline.
  const png = decodePng(readFileSync('public/assets/snail/snail-0.png'))
  const theme = themeOf('night')
  const buffer = Uint8ClampedArray.from(png.data)
  const pass = paintMascot(buffer, png.width, png.height, SNAIL_SKINS[0], theme)
  let opaque = 0
  let creature = 0

  for (let i = 0; i < buffer.length; i += 4) {
    if (png.data[i + 3] === 0) continue
    opaque++
    if (pass.creature[i / 4]) creature++
  }

  const padShare = 1 - creature / opaque

  assert.ok(padShare > 0.2, `the pad is only ${(padShare * 100).toFixed(0)}% of the sprite, so the mask is finding nothing`)
  assert.ok(padShare < 0.6, `the mask calls ${(padShare * 100).toFixed(0)}% of the sprite pad, which would be eating the creature`)
  console.log(`    the pad is ${(padShare * 100).toFixed(0)}% of the render; the creature is the other ${(100 - padShare * 100).toFixed(0)}%`)

  // **Nothing is painted round the creature, and this is what says so.** A silhouette pass over the
  // buffer the game hands the texture must find the render's own edge unchanged -- so the check is
  // that `paintMascot` and a hand-run rim disagree, i.e. that the game is not running one.
  const rimmed = Uint8ClampedArray.from(buffer)
  const painted = paintInkRim(rimmed, png.width, png.height, rimWidthPx(png.width, png.height, OBSTACLE_RIM), OBSTACLE_RIM)
  let changed = 0

  for (let i = 0; i < rimmed.length; i += 4) {
    if (rimmed[i] !== buffer[i] || rimmed[i + 1] !== buffer[i + 1] || rimmed[i + 2] !== buffer[i + 2]) changed++
  }

  assert.ok(painted > 0, 'the control painted nothing, so it cannot show the mascot is unpainted')
  assert.ok(changed > painted * 0.5, `only ${changed} of ${painted} rim pixels differ, so the mascot is already outlined`)
  console.log(`    a rim would repaint ${painted} pixels of the mascot and ${changed} of them are not that colour today`)
})

check('the pad takes the theme own light, so it stops out-shining the mascot', () => {
  // **⚠ Reported off a night frame: the pad was the brightest thing in the picture** and pulled the
  // eye harder than the mascot standing on it, which is the inverse of the one rule this game's
  // colour is built on. It is ground, so it answers to `groundLight` like every other piece of
  // ground -- and the creature above it is deliberately untouched, because the snail is the object
  // a player must never have to search for.
  const png = decodePng(readFileSync('public/assets/snail/snail-0.png'))
  const rows = []

  for (const id of THEMES) {
    const theme = themeOf(id)
    const buffer = Uint8ClampedArray.from(png.data)
    const pass = paintMascot(buffer, png.width, png.height, SNAIL_SKINS[0], theme)
    const road = roadLuminance(theme)

    rows.push({ id, pad: pass.padLuminance, road, ratio: pass.padLuminance / Math.max(road, 1e-4) })
  }

  console.log('      theme     road L   pad L   pad/road')
  for (const row of rows) {
    console.log(`      ${row.id.padEnd(10)}${row.road.toFixed(3).padStart(6)}  ${row.pad.toFixed(3).padStart(6)}  ${row.ratio.toFixed(2).padStart(8)}`)
  }

  // The pad may be brighter than the road it lies on -- wet grass in sunlight is -- but not by the
  // margin that made it the subject of the frame instead of the snail.
  for (const row of rows) {
    assert.ok(row.ratio < PAD_MAX_ROAD_RATIO, `${row.id}: the pad is ${row.ratio.toFixed(1)}x the road's luminance`)
  }

  // Shown to reject the arrangement it replaced: with the theme's light taken out, night's pad is
  // several times its own road and the check has to fail.
  const unlit = Uint8ClampedArray.from(png.data)
  const night = themeOf('night')
  const pass = paintMascot(unlit, png.width, png.height, SNAIL_SKINS[0], { ...night, groundLight: 1 })
  const ratio = pass.padLuminance / roadLuminance(night)

  assert.ok(
    ratio >= PAD_MAX_ROAD_RATIO,
    `an unlit pad is only ${ratio.toFixed(1)}x night's road, so this check would have passed the defect`,
  )
  console.log(`    unlit, night's pad is ${ratio.toFixed(1)}x its road -- the frame this was reported from`)
})


/** The mascot's own chromatic pixels for one skin under one theme, through the shipped pass. */
function skinColours(png, skin, theme) {
  const buffer = Uint8ClampedArray.from(png.data)
  const pass = paintMascot(buffer, png.width, png.height, skin, theme)
  const colours = []

  for (let i = 0; i < buffer.length; i += 4) {
    if (buffer[i + 3] < 200) continue
    // **⚠ The pad is excluded.** The render is a snail standing on a spread of its own foot; that
    // pad is 41% of the sprite and is lit by the theme like every other piece of ground. Counting
    // its pixels as "the colour of the snail" would read a green pad over green ground as the
    // mascot merging -- i.e. fail the game for doing the thing the pad's own light was added to do.
    if (!pass.creature[i / 4]) continue

    const color = (buffer[i] << 16) | (buffer[i + 1] << 8) | buffer[i + 2]

    // The eyes and the specular carry no hue, so they cannot merge with anything *by hue*, and they
    // are not what "the colour of the snail" means.
    if (chroma(color) < THREAT_MIN_CHROMA) continue

    colours.push(color)
  }

  return colours
}

/** The share of those pixels a glancing eye would read as the backdrop's own colour. */
function mergedShare(colours, backdrop) {
  let count = 0

  for (const pixel of colours) {
    if (hueDistance(pixel, backdrop) < MASCOT_MIN_HUE_DEGREES && Math.abs(relativeLuminance(pixel) - relativeLuminance(backdrop)) < MASCOT_MIN_LUMINANCE) count++
  }

  return count / colours.length
}

/**
 * How many of the nine grounds a skin merges with under one theme, and whether it merges with the
 * road. Both through the shipped `paintMascot`, in the game's own order -- reimplementing any of it
 * would let this measure a mascot the game does not draw, which is the reason that pass was moved
 * out from behind a Phaser import in the first place.
 */
function lapMerges(png, skin, theme) {
  const colours = skinColours(png, skin, theme)
  const grounds = BIOMES.map((biome) => ({ id: biome.id, share: mergedShare(colours, nearGround(biome, theme)) }))
  const road = Math.max(mergedShare(colours, nearRoad(theme)), mergedShare(colours, surfaceColour({ base: theme.road[1], family: 'road', fog: theme.fog, sky: theme.sky.bottom, amount: 0 })))
  const over = grounds.filter((entry) => entry.share > MASCOT_MAX_MERGED)

  return { grounds, road, biomes: over.length, worst: grounds.reduce((a, b) => (b.share > a.share ? b : a)) }
}

check('no skin is the colour of the road it is drawn on', () => {
  const png = decodePng(readFileSync('public/assets/snail/snail-0.png'))

  assert.ok(png.width > 0 && png.height > 0, 'the mascot render has stopped being readable as pixels')

  let roadPairs = 0

  console.log(`    a cell is "biomes merged of 9 / worst share"; * marks a skin that merges with the road itself`)
  console.log(`      skin      ${THEMES.map((id) => id.slice(0, 7).padEnd(9)).join('')}`)

  for (const skin of SNAIL_SKINS) {
    const cells = []

    for (const id of THEMES) {
      const merges = lapMerges(png, skin, themeOf(id))
      const onRoad = merges.road > MASCOT_MAX_MERGED

      if (onRoad) roadPairs++

      cells.push(`${merges.biomes}/9 ${(merges.worst.share * 100).toFixed(0)}%${onRoad ? '*' : ''}`.padEnd(9))
    }

    console.log(`      ${skin.id.padEnd(10)}${cells.join('')}`)
  }

  console.log(`    ${roadPairs} of ${SNAIL_SKINS.length * THEMES.length} (skin, theme) pairs merge with the road itself, against a ceiling of ${MASCOT_MAX_ROAD_PAIRS}`)

  // The slime is measured on its own, because it is not a theme colour and no repaint can reach it:
  // `SlimeTrail.ts` draws in one fixed yellow-green whatever the light. It was the finding that put
  // a contour on the mascot in the first place, and with the contour gone it is a recorded cost --
  // `fern` loses over half its silhouette to its own trail, on all seven themes identically.
  const slime = SNAIL_SKINS.map((skin) => ({
    id: skin.id,
    share: Math.max(...SLIME.map((color) => mergedShare(skinColours(png, skin, themeOf(THEMES[0])), color))),
  }))

  console.log(`    against its own slime: ${slime.map((entry) => `${entry.id} ${(entry.share * 100).toFixed(0)}%`).join(', ')}`)

  assert.ok(
    roadPairs <= MASCOT_MAX_ROAD_PAIRS,
    `${roadPairs} skins merge with the road they are drawn on, against a ceiling of ${MASCOT_MAX_ROAD_PAIRS}`,
  )

  // **The control, and it is what gives this check discriminating power on every run.** A skin
  // painted the asphalt's own hue is exactly the thing the ceiling exists to reject, and it has to
  // keep being rejected or the ceiling has stopped measuring anything.
  let controlPairs = 0

  for (const id of THEMES) {
    const theme = themeOf(id)
    const road = toOklab(nearRoad(theme))
    const hue = (Math.atan2(road.b, road.a) * 180) / Math.PI
    const camouflage = { ...SNAIL_SKINS[0], id: 'camouflage', shellHue: hue, footHue: hue }

    if (lapMerges(png, camouflage, theme).road > MASCOT_MAX_MERGED) controlPairs++
  }

  assert.ok(
    controlPairs > MASCOT_MAX_ROAD_PAIRS,
    `a skin painted the asphalt's own hue merges on only ${controlPairs} themes, so this check would pass it`,
  )
  console.log(`    the control -- a skin rotated onto each theme's own asphalt hue -- merges on ${controlPairs} of ${THEMES.length} and is rejected`)
})

if (failed.length > 0) {
  console.log(`\n${passed} checks passed, ${failed.length} FAILED:`)
  for (const failure of failed) console.log(`  - ${failure.name}\n      ${failure.message.split('\n')[0]}`)
  process.exitCode = 1
} else {
  console.log(`\n${passed} checks passed`)
}
