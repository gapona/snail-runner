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
import { readFileSync } from 'node:fs'
import { decodePng } from './png.mjs'
import { chroma, contrastRatio, hueDistance, relativeLuminance, toHsl } from '../src/road/color.ts'
import { getRoadTheme, setRoadTheme, themeIds, THREAT_MIN_CHROMA } from '../src/road/themes.ts'
import { BIOMES, groundPairForTheme, groundShadesForTheme, MIN_GROUND_CONTRAST } from '../src/road/biomes.ts'
import { surfaceColour } from '../src/road/paletteColour.ts'
import { recolour, SNAIL_SKINS } from '../src/run/snailSkins.ts'

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
  const pair = groundPairForTheme(biome.ground, theme.road[0], theme.road[1], MIN_GROUND_CONTRAST, theme.groundLight)
  const shades = groundShadesForTheme(pair, theme.road[0], theme.road[1], MIN_GROUND_CONTRAST)

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
 * **Derived from the live data rather than carried over from anywhere.** Measured at the point
 * below, the seven themes fall into two groups with nothing between them: `dusk` at 8 degrees and
 * `verdant` at 14, against `ember` at 43, `day` at 62 and `ice` at 70. The gap 14..43 is empty, so
 * the threshold is any value inside it; 30 sits near its middle, at 2.1x the worst failure and
 * 0.70x the best pass. If a repaint ever closes that gap the number stops being derivable and has
 * to be argued for instead.
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

  if (chroma(sky) < THREAT_MIN_CHROMA) return null

  let worst = null

  for (const biome of BIOMES) {
    const ground = nearGround(biome, theme)

    if (chroma(ground) < THREAT_MIN_CHROMA) continue

    const distance = hueDistance(sky, ground)

    if (worst === null || distance < worst.distance) worst = { distance, biome: biome.id }
  }

  return worst
}

console.log('A1.1 - the sky is not made of the same colour as the ground')

check('every theme with a chromatic sky keeps it out of the ground family', () => {
  const rows = []
  const failures = []

  for (const id of THEMES) {
    const theme = themeOf(id)
    const worst = skyGroundHue(theme)

    rows.push({ id, sky: skyPoint(theme), worst })

    if (worst && worst.distance < SKY_GROUND_MIN_HUE_DEGREES) failures.push({ id, ...worst })
  }

  console.log(`    floor ${SKY_GROUND_MIN_HUE_DEGREES} deg, sky.top vs near ground, both sides gated at chroma ${THREAT_MIN_CHROMA}:`)

  for (const { id, sky, worst } of rows) {
    const verdict = worst === null ? 'achromatic sky - exempt' : `${String(Math.round(worst.distance)).padStart(3)} deg vs ${worst.biome}`
    const flag = worst && worst.distance < SKY_GROUND_MIN_HUE_DEGREES ? '  <-- IN THE GROUND FAMILY' : ''

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

  assert.equal(rejected, THEMES.length, 'measured at the horizon the rule should reject everything, and no longer does')
  console.log(`    at sky.bottom: ${rejected} of ${THEMES.length} themes rejected, i.e. the old point was measuring the dissolve`)
})

check('the chroma gate is load-bearing: without it the two clearest themes rank worst', () => {
  // The second control. `day` and `ice` have the largest genuine separation in the set and scored 4
  // and 5 degrees ungated, because their worst biome's ground is a near-neutral whose hue angle
  // means nothing. A check that ranks the healthy themes worst is measuring noise.
  function ungated(theme) {
    let worst = 999

    for (const biome of BIOMES) worst = Math.min(worst, hueDistance(skyPoint(theme), nearGround(biome, theme)))

    return worst
  }

  const dayUngated = ungated(themeOf('day'))
  const iceUngated = ungated(themeOf('ice'))

  assert.ok(dayUngated < SKY_GROUND_MIN_HUE_DEGREES, 'day no longer fails ungated, so the gate has stopped mattering')
  assert.ok(iceUngated < SKY_GROUND_MIN_HUE_DEGREES, 'ice no longer fails ungated, so the gate has stopped mattering')

  const dayGated = skyGroundHue(themeOf('day'))
  const iceGated = skyGroundHue(themeOf('ice'))

  assert.ok(dayGated.distance >= SKY_GROUND_MIN_HUE_DEGREES && iceGated.distance >= SKY_GROUND_MIN_HUE_DEGREES)
  console.log(
    `    day ${Math.round(dayUngated)} -> ${Math.round(dayGated.distance)} deg, ice ${Math.round(iceUngated)} -> ${Math.round(iceGated.distance)} deg once greys are excluded`,
  )
})

// ---------------------------------------------------------------------------------------------
// A1.3 -- a theme may change the brightness of the frame, but not its readability
// ---------------------------------------------------------------------------------------------

/**
 * How far apart two themes' ground-to-road contrast may sit.
 *
 * **This is the contrast, NOT the absolute lightness, and the distinction is the whole rule.** Equal
 * near-field lightness across themes was proposed and is wrong here: it is a rule about *biomes*,
 * where the player crosses a seam mid-run and a step in overall brightness reads as an artefact. A
 * theme has no seam -- it is chosen before the run and held for all of it, so there is nothing to
 * compare it against, and absolute brightness stays an expressive tool. `night` carries
 * `groundLight` 0.34 for exactly that reason and must keep it. See `biomes.ts` for the biome half.
 *
 * What may not move between themes is how legible the road's edge is, which is a ratio.
 *
 * The bound is measured rather than picked: six of the seven themes sit between 1.73 and 2.28, a
 * spread of 1.32x, and `day` sits alone at 3.28. 1.5 admits the six and rejects the one.
 */
const THEME_CONTRAST_SPREAD = 1.5

console.log('\nA1.3 - a theme changes the brightness of the frame, not its readability')

check('every theme keeps the ground and the road the same distance apart', () => {
  const rows = THEMES.map((id) => {
    const theme = themeOf(id)
    const road = nearRoad(theme)
    const ratios = BIOMES.map((biome) => contrastRatio(nearGround(biome, theme), road))

    return { id, mean: ratios.reduce((sum, r) => sum + r, 0) / ratios.length, min: Math.min(...ratios) }
  })

  const means = rows.map((row) => row.mean)
  const spread = Math.max(...means) / Math.min(...means)

  console.log('    ground-vs-road contrast, mean over 9 biomes (absolute lightness deliberately not asserted):')
  for (const row of rows) console.log(`      ${row.id.padEnd(9)} ${row.mean.toFixed(2)}  (worst biome ${row.min.toFixed(2)})`)
  console.log(`    spread ${spread.toFixed(2)}x against a bound of ${THEME_CONTRAST_SPREAD}x`)

  for (const row of rows) {
    assert.ok(row.min >= MIN_GROUND_CONTRAST, `${row.id} puts a biome ground within ${row.min.toFixed(2)} of its road`)
  }

  assert.ok(
    spread <= THEME_CONTRAST_SPREAD,
    `themes disagree about how legible the road edge is by ${spread.toFixed(2)}x: ${rows.map((r) => `${r.id} ${r.mean.toFixed(2)}`).join(', ')}`,
  )
})

// ---------------------------------------------------------------------------------------------
// A5 -- the mascot is never the colour of what it is drawn on
// ---------------------------------------------------------------------------------------------

/** Below these two together, the mascot and its backdrop are one colour to a glancing eye. */
const MASCOT_MIN_HUE_DEGREES = 20
const MASCOT_MIN_LUMINANCE = 0.15

/** How much of the mascot may merge with any one backdrop. */
const MASCOT_MAX_MERGED = 0.1

/**
 * The slime trail's own two colours, from `SlimeTrail.ts`.
 *
 * **They are constants there, not theme colours, and that is the finding this check exists for.**
 * The trail is drawn in one fixed yellow-green whatever the theme, so a mascot in that hue merges
 * with its own trail on every theme identically -- and no repaint of any palette can reach it.
 * Measured: `fern` loses 36% of its silhouette to its own trail, on all seven.
 */
const SLIME = [0x9fc24a, 0xe8f7a6]

console.log('\nA5 - the mascot separates from everything it is drawn on')

check('no skin merges with the ground of any theme, or with its own trail', () => {
  const png = decodePng(readFileSync('public/assets/snail/snail-0.png'))
  const pixels = []

  for (let i = 0; i < png.data.length; i += 4) {
    if (png.data[i + 3] < 200) continue

    const color = (png.data[i] << 16) | (png.data[i + 1] << 8) | png.data[i + 2]

    // The ink, the eyes and the specular carry no hue, so they cannot merge with anything *by hue*
    // and they are not what "the colour of the snail" means.
    if (chroma(color) < THREAT_MIN_CHROMA) continue

    pixels.push(color)
  }

  assert.ok(pixels.length > 5000, 'the mascot render has stopped being readable as pixels')

  function merged(recoloured, backdrop) {
    let count = 0

    for (const pixel of recoloured) {
      if (hueDistance(pixel, backdrop) < MASCOT_MIN_HUE_DEGREES && Math.abs(relativeLuminance(pixel) - relativeLuminance(backdrop)) < MASCOT_MIN_LUMINANCE) count++
    }

    return count / recoloured.length
  }

  const failures = []

  console.log(`    share of the mascot merging with its worst backdrop (floor ${(MASCOT_MAX_MERGED * 100).toFixed(0)}%), ${pixels.length} chromatic pixels:`)
  console.log(`      skin      ${THEMES.map((id) => id.slice(0, 7).padEnd(8)).join('')}slime`)

  for (const skin of SNAIL_SKINS) {
    const recoloured = pixels.map((pixel) => recolour(pixel, skin))
    const cells = []

    for (const id of THEMES) {
      const theme = themeOf(id)
      const worst = Math.max(...BIOMES.map((biome) => merged(recoloured, nearGround(biome, theme))))

      cells.push(worst)
      if (worst > MASCOT_MAX_MERGED) failures.push(`${skin.id} on ${id} ground (${(worst * 100).toFixed(0)}%)`)
    }

    const slime = Math.max(...SLIME.map((color) => merged(recoloured, color)))

    if (slime > MASCOT_MAX_MERGED) failures.push(`${skin.id} on its own trail (${(slime * 100).toFixed(0)}%)`)

    const cell = (value) => `${(value * 100).toFixed(0)}%${value > MASCOT_MAX_MERGED ? '!' : ' '}`

    console.log(`      ${skin.id.padEnd(10)}${cells.map((v) => cell(v).padEnd(8)).join('')}${cell(slime)}`)
  }

  assert.equal(failures.length, 0, `the mascot disappears into its backdrop: ${failures.join(', ')}`)
})

if (failed.length > 0) {
  console.log(`\n${passed} checks passed, ${failed.length} FAILED:`)
  for (const failure of failed) console.log(`  - ${failure.name}\n      ${failure.message.split('\n')[0]}`)
  process.exitCode = 1
} else {
  console.log(`\n${passed} checks passed`)
}
