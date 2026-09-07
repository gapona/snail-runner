/**
 * The mascot's wardrobe, checked against the pixels rather than against the table.
 *
 * `src/run/snailSkins.ts` states two rules about colour — the snail may not wear the reserved
 * threat hue, and no two skins may be the same snail — plus the ordinary save-layer rules every
 * other cosmetic in this game obeys. Only the first of those can be got wrong invisibly, and it can
 * be got wrong in a way no amount of reading the constants would show: **a hue rotation at constant
 * chroma routinely leaves sRGB, and the clamp back moves the hue again.** `threat_guard.py` records
 * that failure exactly — its first pass left 1327 "corrected" pixels still illegal.
 *
 * So this decodes the real `snail-0.png`, runs the real `recolour` over every one of its pixels,
 * and measures the output. Nothing here trusts arithmetic that has a clamp on the end of it.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { decodePng } from './png.mjs'
import {
  DEFAULT_SNAIL_SKIN,
  SNAIL_BASE_HUES,
  SNAIL_HUE_SPLIT,
  SNAIL_HUE_SPREAD,
  SNAIL_SKINS,
  isSnailSkinFree,
  ownsSnailSkin,
  recolour,
  resolveSelectedSnail,
  skinIdFromItem,
  skinItemId,
  snailSkin,
  snailSkinIds,
  snailColourFamily,
} from '../src/run/snailSkins.ts'
import { chroma, hueAngle, hueDistance, toOklab, toHsl } from '../src/road/color.ts'
import {
  THREAT_COLOR,
  THREAT_LIGHTNESS_ESCAPE,
  THREAT_MIN_CHROMA,
  THREAT_MIN_HUE_DEGREES,
} from '../src/road/themes.ts'
import { themeIdFromItem, themeItemId } from '../src/shop/themeCatalog.ts'
import { buildSnailCatalog } from '../src/shop/snailCatalog.ts'
import { DEFAULT_SNAIL_ID } from '../src/save/types.ts'
import { OBSTACLE_MATERIALS } from '../src/run/artPalette.ts'
import { COINS_PER_LAP } from '../src/shop/coins.ts'
import { MASCOT_ASPECT } from '../src/run/constants.ts'

const hex = (n) => '#' + n.toString(16).padStart(6, '0')

let passed = 0

function check(name, fn) {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

/** Every opaque pixel of the shipped render, packed `0xRRGGBB`, with its own repeat count. */
function basePixels() {
  const png = decodePng(readFileSync('public/assets/snail/snail-0.png'))
  const counts = new Map()

  for (let i = 0; i < png.data.length; i += 4) {
    // The same floor `PlayerView` draws against: a pixel the eye cannot see is not a colour the
    // rule is about. Matches `verify:mattes`' own notion of what counts as the subject.
    if (png.data[i + 3] < 160) continue

    const packed = (png.data[i] << 16) | (png.data[i + 1] << 8) | png.data[i + 2]

    counts.set(packed, (counts.get(packed) ?? 0) + 1)
  }

  return counts
}

const BASE = basePixels()

/** Whether a packed colour belongs to the pad rather than to the creature. */
function isPad(packed) {
  return snailColourFamily(packed) === 'foot'
}
const TOTAL = [...BASE.values()].reduce((sum, n) => sum + n, 0)

/**
 * Whether a colour lands in the band `THREAT_COLOR` reserves — the project's standing rule, applied
 * here rather than reimplemented: all three terms, because one number cannot do it.
 */
function reserved(color) {
  if (chroma(color) < THREAT_MIN_CHROMA) return false
  if (Math.abs(toOklab(color).L - toOklab(THREAT_COLOR).L) > THREAT_LIGHTNESS_ESCAPE) return false

  return hueDistance(color, THREAT_COLOR) < THREAT_MIN_HUE_DEGREES
}

console.log('the render this is all measured from')

check('the two hue families are real, and the split falls in the gap between them', () => {
  const legible = [...BASE.entries()].filter(([color]) => chroma(color) >= THREAT_MIN_CHROMA)
  const families = { shell: [], foot: [] }

  for (const [color, n] of legible) {
    const hue = hueAngle(color)

    families[hue < SNAIL_HUE_SPLIT ? 'shell' : 'foot'].push({ hue, n })
  }

  for (const [name, pixels] of Object.entries(families)) {
    const hues = pixels.map((p) => p.hue)
    const weight = pixels.reduce((sum, p) => sum + p.n, 0)
    const mean = pixels.reduce((sum, p) => sum + p.hue * p.n, 0) / weight

    // The constants are measurements, so they have to keep matching the thing they measured: a
    // re-rendered mascot moves them, and a skin table left pointing at the old means would rotate
    // every family to the wrong place while every other check here still passed.
    assert.ok(
      Math.abs(mean - SNAIL_BASE_HUES[name]) < 2,
      `${name}'s measured mean is ${mean.toFixed(1)}, not the ${SNAIL_BASE_HUES[name]} in the table`,
    )
    // The spread is what makes a hue target legal or not — a family rotated to `T` occupies
    // `[T + spread.min, T + spread.max]`, and that arc is what has to clear the reservation. It is
    // a measurement like the mean, so it is held to the drawing like the mean.
    const spread = { min: Math.min(...hues) - mean, max: Math.max(...hues) - mean }

    assert.ok(
      Math.abs(spread.min - SNAIL_HUE_SPREAD[name].min) < 1 && Math.abs(spread.max - SNAIL_HUE_SPREAD[name].max) < 1,
      `${name}'s measured spread is ${spread.min.toFixed(1)}..${spread.max.toFixed(1)}, not the table's ` +
        `${SNAIL_HUE_SPREAD[name].min}..${SNAIL_HUE_SPREAD[name].max}`,
    )
    console.log(
      `    ${name.padEnd(5)} ${weight} px, hue ${Math.min(...hues).toFixed(1)}..${Math.max(...hues).toFixed(1)}, mean ${mean.toFixed(1)}`,
    )
  }

  // The gap is what makes a two-family split a fact about the drawing rather than a threshold
  // somebody picked: the shell's highest legible hue and the foot's lowest must straddle the line.
  const shellMax = Math.max(...families.shell.map((p) => p.hue))
  const footMin = Math.min(...families.foot.map((p) => p.hue))

  assert.ok(shellMax < SNAIL_HUE_SPLIT && footMin > SNAIL_HUE_SPLIT, 'the split cuts through a family')
  console.log(`    ${(footMin - shellMax).toFixed(1)} degrees of empty wheel between them, split at ${SNAIL_HUE_SPLIT}`)
})

check('the default skin reproduces the render exactly, so a save that predates skins changes nothing', () => {
  const skin = snailSkin(DEFAULT_SNAIL_SKIN)

  assert.ok(skin, 'the default skin is not in the table')

  let worst = 0

  for (const [color] of BASE) worst = Math.max(worst, Math.abs(recolour(color, skin) - color) === 0 ? 0 : 1)

  assert.equal(worst, 0, 'the default skin moved a pixel — it names the render\'s own measured hues')
})

console.log('the reserved colour')

check('⚠ no skin puts the mascot in the threat band — swept over the output, not the input', () => {
  const baseReserved = [...BASE.entries()].filter(([color]) => reserved(color)).reduce((n, [, c]) => n + c, 0)

  assert.equal(baseReserved, 0, 'the shipped render is already inside the reservation')

  for (const skin of SNAIL_SKINS) {
    let bad = 0
    let worst = 180

    for (const [color, n] of BASE) {
      const turned = recolour(color, skin)

      if (reserved(turned)) bad += n
      if (chroma(turned) >= THREAT_MIN_CHROMA) worst = Math.min(worst, hueDistance(turned, THREAT_COLOR))
    }

    assert.equal(bad, 0, `${skin.id} draws ${bad} of ${TOTAL} pixels inside the reserved band`)
    console.log(`    ${skin.id.padEnd(7)} closest legible pixel sits ${worst.toFixed(1)} degrees from the threat hue`)
  }
})

check('⚠ and the check bites: a skin rotated onto the threat hue is rejected', () => {
  // The negative control this project insists on — a reservation that has never rejected anything
  // is not a reservation. A shell rotated to the danger hue is exactly the mistake the rule exists
  // to catch, and it must fail here rather than on the day somebody makes it.
  const red = { id: 'danger', titleKey: '', priceCoins: 0, icon: '', shellHue: hueAngle(THREAT_COLOR), footHue: 127 }
  let bad = 0

  for (const [color, n] of BASE) if (reserved(recolour(color, red))) bad += n

  assert.ok(bad > TOTAL * 0.1, `a snail rotated onto the threat hue drew only ${bad} reserved pixels`)
  console.log(`    a shell rotated onto ${THREAT_COLOR.toString(16)} paints ${((bad / TOTAL) * 100).toFixed(0)}% of the mascot illegal`)
})

console.log('the mascot is still the mascot')

check('every skin keeps the saturation that separates the snail from the scenery', () => {
  // **The floor is the render's own measurement, not a number.** `verify:obstacles` owns the
  // question of whether the *base* mascot is separated enough from the frame it stands in — it
  // measures the palette and holds a 2x margin there. What is this file's business is narrower and
  // exactly checkable: a recolour must not spend that separation. So each skin is measured against
  // the shipped render's own saturation rather than against an absolute, and the only thing that
  // can cost it anything is the sRGB clamp on the end of the rotation.
  const saturation = (skin) => {
    let sum = 0

    for (const [color, n] of BASE) sum += toHsl(skin ? recolour(color, skin) : color).s * n

    return sum / TOTAL
  }

  const base = saturation(null)
  const obstacles = Object.values(OBSTACLE_MATERIALS).flatMap((material) => Object.values(material))
  const scenery = obstacles.reduce((sum, color) => sum + toHsl(color).s, 0) / obstacles.length

  console.log(
    `    the shipped render measures ${(base * 100).toFixed(0)}% saturation against the obstacle palette's ` +
      `${(scenery * 100).toFixed(0)}% — ${(base / scenery).toFixed(2)}x`,
  )

  for (const skin of SNAIL_SKINS) {
    const measured = saturation(skin)
    const kept = measured / base

    // The project's own floor, applied to the same quantity on the recoloured pixels:
    // `verify:obstacles` holds the palette at twice the scenery's saturation, and a skin that fell
    // under that would be selling a mascot the player has to look for.
    assert.ok(
      measured > scenery * 2,
      `${skin.id} is only ${(measured / scenery).toFixed(1)}x as saturated as an obstacle`,
    )
    // And a separate, looser bound on the *rotation itself*. sRGB is narrower in magenta than in
    // cyan at these lightnesses, so some of every rotation is eaten by the clamp — that is the
    // colour space rather than a defect, and the sweep behind `rose`'s 302 is written up on
    // `SNAIL_SKINS`. What this catches is a hue where the clamp takes so much that the skin is a
    // visibly duller animal, and the fix for it is the hue and never this number.
    assert.ok(
      kept >= 0.85,
      `${skin.id} keeps only ${(kept * 100).toFixed(0)}% of the render's saturation — pick a hue with more gamut`,
    )
    console.log(`    ${skin.id.padEnd(7)} ${(measured * 100).toFixed(0)}% saturation, ${(kept * 100).toFixed(0)}% of the render's`)
  }
})

check('no two skins are the same snail', () => {
  // Shell rather than foot: the shell is 61% of the legible pixels and the part a player names the
  // skin by. Two rows in a shop that cannot be told apart are one product with two prices.
  const FLOOR = 40
  let worst = 360

  for (let i = 0; i < SNAIL_SKINS.length; i++) {
    for (let j = i + 1; j < SNAIL_SKINS.length; j++) {
      const a = SNAIL_SKINS[i]
      const b = SNAIL_SKINS[j]
      const gap = Math.abs(((a.shellHue - b.shellHue + 540) % 360) - 180)

      assert.ok(gap >= FLOOR, `${a.id} and ${b.id} are ${gap.toFixed(0)} degrees apart`)
      worst = Math.min(worst, gap)
    }
  }

  console.log(`    ${SNAIL_SKINS.length} skins, closest pair ${worst.toFixed(0)} degrees apart against a floor of ${FLOOR}`)
})

console.log('the shop and the save')

check('the two id spaces cannot claim each other\'s ids', () => {
  // They share one `purchases` array, so an id both could parse is a purchase that grants two
  // things. Same assertion the rail shooter's four id spaces were held to.
  for (const id of snailSkinIds()) assert.equal(themeIdFromItem(skinItemId(id)), null, `${id} parses as a theme`)
  for (const id of ['day', 'night', 'auto']) assert.equal(skinIdFromItem(themeItemId(id)), null, `${id} parses as a skin`)
  assert.equal(skinIdFromItem('theme-day'), null)
})

check('the free skin is owned without a purchase, and a paid one is not', () => {
  assert.ok(isSnailSkinFree(DEFAULT_SNAIL_SKIN), 'the starting skin costs money')
  assert.ok(ownsSnailSkin([], DEFAULT_SNAIL_SKIN), 'a player who has bought nothing owns nothing')
  // Recording a purchase that never happened would make `purchases` a lie the first time anything
  // else reads it — the rule `themeCatalog.ts` states for the free themes.
  const paid = SNAIL_SKINS.filter((skin) => skin.priceCoins > 0)

  assert.ok(paid.length >= 3, 'a wardrobe of one paid skin is a wardrobe nobody browses')
  for (const skin of paid) {
    assert.equal(ownsSnailSkin([], skin.id), false, `${skin.id} is free to everybody`)
    assert.equal(ownsSnailSkin([skinItemId(skin.id)], skin.id), true, `${skin.id} cannot be bought`)
  }
})

check('a saved skin is never trusted on its own', () => {
  // A save can outlive a skin id, be written by a newer build, or be edited by hand. Each of those
  // has to degrade to the free skin rather than to a missing texture or to a free unlock.
  assert.equal(resolveSelectedSnail('rose', []), DEFAULT_SNAIL_SKIN, 'an unowned skin was worn anyway')
  assert.equal(resolveSelectedSnail('nonesuch', [skinItemId('nonesuch')]), DEFAULT_SNAIL_SKIN, 'an unknown id was worn')
  assert.equal(resolveSelectedSnail('rose', [skinItemId('rose')]), 'rose', 'a bought skin was refused')
  assert.equal(DEFAULT_SNAIL_ID, DEFAULT_SNAIL_SKIN, 'the save layer and the art layer disagree about the default')
})

check('the catalogue lists every skin, free one included', () => {
  // Not a tidiness check. `themeCatalog.ts` records what filtering the free rows out cost there:
  // buying one paid theme took the free ones away permanently, because the list had stopped being
  // a list of purchases and become the only place a look can be chosen.
  const rows = buildSnailCatalog()

  assert.deepEqual(rows.map((row) => row.id), snailSkinIds().map(skinItemId))
  for (const row of rows) {
    assert.equal(row.kind, 'unlock')
    assert.notEqual(row.selectable, false, 'an owned skin row must stay a Select / In use control')
    assert.ok(row.icon.length > 0, `${row.id} has no glyph`)
  }
  console.log(`    ${rows.length} rows, ${rows.filter((r) => r.priceCoins === 0).length} free, dearest ${Math.max(...rows.map((r) => r.priceCoins))} coins`)
})



console.log(`${passed} checks passed`)
