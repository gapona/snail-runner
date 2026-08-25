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
 * - `boost` — a stack of chevrons. **The only shape with a direction.**
 * - `shield` — a rounded plate. The only closed symmetrical outline.
 * - `coin` — a ring. The only shape with a hole in it.
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

export const PICKUP_TEXTURES: Record<PickupKind, string> = {
  boost: 'pickup-boost',
  shield: 'pickup-shield',
  coin: 'pickup-coin',
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
    const key = PICKUP_TEXTURES[kind]

    if (scene.textures.exists(key)) continue

    const size = PICKUP_CANVAS
    const g = scene.make.graphics({ x: 0, y: 0 }, false)
    const s: Scale = (f) => size * f
    const ink = Math.max(2, size * INK_WEIGHT)
    const colors = PICKUP_COLORS[kind]

    // **One shared backing under all three.** A pickup has to separate from a road that is grey,
    // grass that is green and sand that is pale, and the eight biomes make every one of those the
    // background at some point. A soft dark disc does that everywhere with one shape, where three
    // per-biome variants would be three things to keep in step.
    g.fillStyle(0x0d1410, 0.22)
    g.fillCircle(s(0.5), s(0.52), s(0.47))
    g.fillStyle(0x0d1410, 0.16)
    g.fillCircle(s(0.5), s(0.54), s(0.42))

    if (kind === 'boost') drawBoost(g, s, ink, colors)
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
 * Two stacked chevrons pointing forward.
 *
 * **Two, because one is a triangle.** A single chevron reads as an arrowhead or as a piece of
 * scenery; two of the same shape offset along their own axis read as motion, which is what the
 * pickup does. Drawn upward-forward rather than flat-right so it never looks like a road sign.
 */
function drawBoost(g: Phaser.GameObjects.Graphics, s: Scale, ink: number, colors: Colors): void {
  const chevron = (dy: number, fill: number): void => {
    const path = (): void => {
      g.beginPath()
      g.moveTo(s(0.2), s(0.56 + dy))
      g.lineTo(s(0.5), s(0.22 + dy))
      g.lineTo(s(0.8), s(0.56 + dy))
      g.lineTo(s(0.66), s(0.56 + dy))
      g.lineTo(s(0.5), s(0.38 + dy))
      g.lineTo(s(0.34), s(0.56 + dy))
      g.closePath()
    }

    g.fillStyle(fill, 1)
    path()
    g.fillPath()
    g.lineStyle(ink, INK, 1)
    path()
    g.strokePath()
  }

  // The trailing one first and duller, so the leading one overlaps it and the pair has a front.
  chevron(0.26, colors.mid)
  chevron(0.06, colors.light)
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
 * A ring seen face-on.
 *
 * **The hole is the entire read.** It is the only shape in the game with a gap in its middle, which
 * is what survives being 13px on a phone — so the ring is drawn thick and the hole generously wide
 * rather than as a coin with a detail punched in it.
 */
function drawCoin(g: Phaser.GameObjects.Graphics, s: Scale, ink: number, colors: Colors): void {
  const outer = s(0.36)
  const inner = s(0.15)

  g.fillStyle(INK, 1)
  g.fillCircle(s(0.5), s(0.5), outer + ink * 0.5)
  g.fillStyle(colors.mid, 1)
  g.fillCircle(s(0.5), s(0.5), outer)
  // A lit crescent, up and to the left, where the light in this game comes from.
  g.fillStyle(colors.light, 1)
  g.fillCircle(s(0.47), s(0.46), outer * 0.82)
  g.fillStyle(colors.mid, 1)
  g.fillCircle(s(0.53), s(0.55), outer * 0.72)

  // The hole, punched by drawing the backing colour through it rather than by an erase — Graphics
  // has no cut-out, and the backing disc under every pickup is what makes this work.
  g.fillStyle(INK, 1)
  g.fillCircle(s(0.5), s(0.5), inner + ink * 0.5)
  g.fillStyle(colors.dark, 1)
  g.fillCircle(s(0.5), s(0.5), inner)
}
