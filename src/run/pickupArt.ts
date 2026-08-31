/**
 * The three pickup icons, drawn rather than loaded.
 *
 * **A pickup is a reward, so it is lit like one.** The obstacles are aimed at the scenery's own
 * measured tone (lightness 111, saturation 5% — see "The Art" in CLAUDE.md) because a rock belongs
 * to the picture. A pickup does not: it is a thing the player is meant to *want*, and it sits in
 * the same bright, saturated family as the snail. That is the whole colour rule in this game —
 * everything is muted except the creature you steer and the things you are steering it towards.
 *
 * **Three silhouettes a player can name at a glance, and shape is what does it.** The rail shooter
 * rasterised its five icons at 24px and measured them for confusion; three is a much easier
 * problem, solved the same way — one directional, one closed and symmetrical, one with a hole:
 *
 * - `fruit` — a round berry with a leaf. The only shape with something growing off it.
 * - `shield` — a rounded plate. The only closed symmetrical outline.
 * - `coin` — a struck gold disc. The only metal, and the only warm one.
 *
 * **Fruit ships as four rendered PNGs and falls back to one drawing.** The four are grapes, a
 * banana, a melon and a pear — different objects rather than four colours of the same one, so a
 * stretch of road with three fruit on it does not read as a repeated stamp. Which one a pickup
 * wears is derived from its id, so a lap deals the same fruit twice and a screenshot is
 * reproducible. The fallback is one berry under all four keys: it exists for the frame before the
 * loader finishes, and four hand-drawn fruits would be four things to keep in step for a case
 * nobody sees.
 *
 * Colour is the second cue, never the first: cyan, green and gold are three easy hues, but a
 * colour-blind eye reading the three outlines gets the same answer. The binding size is a 390px
 * portrait phone, where a pickup lands at about **13px** — which is why each shape is drawn bold
 * and open rather than detailed.
 *
 * Same rule as everything else generated here: **if the key already exists, nothing is drawn.**
 */
import type * as Phaser from 'phaser'
import { INK, PICKUP_COLORS } from './artPalette'
import type { PickupKind } from './pickups'

/**
 * The four fruit renders, in the order `pickupTexture` walks them.
 *
 * Kept as a list rather than a fifth kind each: they are one *product* — a step toward Fever —
 * and splitting them into kinds would put four rows in the weight table for one decision.
 */
export const FRUIT_TEXTURES = [
  'pickup-fruit-grapes',
  'pickup-fruit-banana',
  'pickup-fruit-melon',
  'pickup-fruit-pear',
] as const

/** Every key a kind can wear. `fruit` has four; the other two have one apiece. */
export const PICKUP_TEXTURES: Record<PickupKind, readonly string[]> = {
  fruit: FRUIT_TEXTURES,
  shield: ['pickup-shield'],
  coin: ['pickup-coin'],
}

/**
 * Which texture this pickup draws with.
 *
 * **Derived from the id rather than rolled**, so the same lap deals the same fruit every time it
 * is laid — a placer that is seeded end to end and then picks its art from `Math.random` is a
 * placer whose screenshots cannot be compared.
 */
export function pickupTexture(pickup: { kind: PickupKind; id: number }): string {
  const keys = PICKUP_TEXTURES[pickup.kind]

  return keys[((pickup.id % keys.length) + keys.length) % keys.length]
}

/**
 * The drawing canvas. Square, so the world box the sprite is scaled to decides the aspect.
 *
 * 128 rather than the delivered 13–65px, for the reason the snail's is 224: downscaling a clean
 * drawing through the projection's own filtering is what keeps the edge smooth at every viewport.
 */
export const PICKUP_CANVAS = 128

/** Ink weight, as a fraction of the canvas — heavier than the snail's, because these are smaller. */
const INK_WEIGHT = 0.03

type Scale = (f: number) => number

export function createPickupTextures(scene: Phaser.Scene): void {
  for (const kind of Object.keys(PICKUP_TEXTURES) as PickupKind[]) {
    for (const key of PICKUP_TEXTURES[kind]) {
      if (scene.textures.exists(key)) continue

      drawPickup(scene, kind, key)
    }
  }
}

function drawPickup(scene: Phaser.Scene, kind: PickupKind, key: string): void {
  {

    const size = PICKUP_CANVAS
    const g = scene.make.graphics({ x: 0, y: 0 }, false)
    const s: Scale = (f) => size * f
    const ink = Math.max(2, size * INK_WEIGHT)
    const colors = PICKUP_COLORS[kind]

    // **⚠ The shared backing disc is gone, and it was the last copy of a device the shipped art
    // dropped a round ago.** It was argued for correctly -- a pickup has to separate from grey
    // road, green grass and pale sand alike, and the nine biomes make every one of those the
    // background at some point -- and it was reported the first time it was seen on a real frame:
    // at the size a pickup is read, a plate under the icon IS most of what is there. `build-sprites`
    // removed it from the renders and left it here, so the fallback and the art disagreed about
    // whether a pickup has something behind it. What carries the separation is what the object
    // already has: its own contour, its saturation, and the ellipse on the ground under it.

    if (kind === 'fruit') drawFruit(g, s, ink, colors)
    else if (kind === 'shield') drawShield(g, s, ink, colors)
    else drawCoin(g, s, ink, colors)

    g.generateTexture(key, size, size)
    g.destroy()
  }
}

interface Colors {
  light: number
  mid: number
  dark: number
}

/**
 * A round berry with a leaf off the top.
 *
 * **The leaf is what makes it a fruit rather than a ball**, and it is the only thing in the set
 * that breaks its own outline — which is what the 24px confusion test actually reads. Round, so it
 * cannot be confused with the shield's flat-topped plate; solid, so it cannot be confused with the
 * coin's hole.
 */
function drawFruit(g: Phaser.GameObjects.Graphics, s: Scale, ink: number, colors: Colors): void {
  g.fillStyle(INK, 1)
  g.fillCircle(s(0.5), s(0.58), s(0.31) + ink)

  g.fillStyle(colors.mid, 1)
  g.fillCircle(s(0.5), s(0.58), s(0.31))
  g.fillStyle(colors.dark, 1)
  g.fillCircle(s(0.58), s(0.66), s(0.22))
  g.fillStyle(colors.light, 1)
  g.fillCircle(s(0.4), s(0.48), s(0.12))

  // The stalk and the leaf, in ink and in the shield's own green — the one colour borrowed across
  // the set, because a leaf that is not green is not read as a leaf at any size.
  g.fillStyle(INK, 1)
  g.fillRect(s(0.47), s(0.16), Math.max(2, ink * 0.9), s(0.16))
  g.fillStyle(0x4fc663, 1)
  g.fillEllipse(s(0.63), s(0.2), s(0.26), s(0.13))
  g.fillStyle(INK, 1)
  g.fillEllipse(s(0.63), s(0.2), s(0.26), s(0.13))
  g.fillStyle(0x4fc663, 1)
  g.fillEllipse(s(0.63), s(0.2), s(0.26) - ink, s(0.13) - ink)
}

/**
 * A rounded plate.
 *
 * The one closed, symmetrical outline in the set — nothing else here is a solid blob, so at 13px
 * "filled lozenge" is enough to tell it from a ring and from a pair of arrows.
 */
function drawShield(g: Phaser.GameObjects.Graphics, s: Scale, ink: number, colors: Colors): void {
  const path = (): void => {
    g.beginPath()
    g.moveTo(s(0.5), s(0.12))
    g.lineTo(s(0.84), s(0.28))
    g.lineTo(s(0.78), s(0.64))
    g.lineTo(s(0.5), s(0.88))
    g.lineTo(s(0.22), s(0.64))
    g.lineTo(s(0.16), s(0.28))
    g.closePath()
  }

  g.fillStyle(colors.mid, 1)
  path()
  g.fillPath()
  g.lineStyle(ink, INK, 1)
  path()
  g.strokePath()

  // The lit half, cut down the middle — the same two-plane trick the obstacles use, and what stops
  // the plate reading as a flat sticker.
  g.fillStyle(colors.light, 1)
  g.beginPath()
  g.moveTo(s(0.5), s(0.12))
  g.lineTo(s(0.5), s(0.88))
  g.lineTo(s(0.22), s(0.64))
  g.lineTo(s(0.16), s(0.28))
  g.closePath()
  g.fillPath()
  g.lineStyle(ink, INK, 1)
  path()
  g.strokePath()
}

/**
 * A struck gold coin seen face-on: a rounded rim, a raised bezel, a recessed field.
 *
 * **⚠ This was a ring with a hole through it, and the hole was the set's identity rule.** The
 * argument was good — the only shape in the game with a gap in its middle is what survives being
 * 13px on a phone — and it was written when the set was three abstract glyphs. The fork's `fruit`
 * became four *rendered* objects, three of them round, so silhouette purity had already gone; what
 * the hole was still buying was that both the art and the drawing read as a **washer**, which is
 * exactly how the shipped render was reported. Colour separates a gold disc from a green melon and
 * a purple bunch at every size, and `dev-assets/cc0-3d/coin_render.py` carries the sheet the two
 * were compared on.
 *
 * Three rings rather than a flat fill, and they are the render's own profile flattened: deepest
 * gold at the rim, the lightest on the raised bezel, the field between them. That
 * dark/light/mid sequence outward from the centre is what the eye reads as struck metal instead of
 * as a yellow circle, and it is the one part of the object that survives to 13px.
 */
function drawCoin(g: Phaser.GameObjects.Graphics, s: Scale, ink: number, colors: Colors): void {
  const outer = s(0.42)

  g.fillStyle(INK, 1)
  g.fillCircle(s(0.5), s(0.5), outer + ink * 0.5)
  g.fillStyle(colors.dark, 1)
  g.fillCircle(s(0.5), s(0.5), outer)
  g.fillStyle(colors.light, 1)
  g.fillCircle(s(0.5), s(0.5), outer * 0.86)
  g.fillStyle(colors.mid, 1)
  g.fillCircle(s(0.5), s(0.5), outer * 0.7)

  // A lit crescent across the field, up and to the left, where the light in this game comes from.
  // It spills a little onto the bezel, which is the same colour, so the overlap cannot show.
  g.fillStyle(colors.light, 1)
  g.fillCircle(s(0.47), s(0.46), outer * 0.62)
  g.fillStyle(colors.mid, 1)
  g.fillCircle(s(0.53), s(0.55), outer * 0.6)
}
