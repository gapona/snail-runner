/**
 * The three pickup icons, drawn rather than loaded.
 *
 * **Three silhouettes a player can name at a glance, and the shapes are what does it.** The rail
 * shooter rasterised its five icons and measured them for confusion; three is a much easier
 * problem, and it is solved the same way — one round, one angular, one flat:
 *
 * - `boost` — a chevron pointing forward. The only shape with a direction.
 * - `shield` — a rounded plate. The only closed, symmetrical outline.
 * - `coin` — a disc with a hole. The only shape with a hole in it.
 *
 * Colour is a *second* cue, as it is for obstacles: gold, cyan and amber are distinct, but a
 * colour-blind eye reading the three outlines gets the same answer.
 *
 * Same rule as everything else generated here: **if the key already exists, nothing is drawn.**
 */
import type * as Phaser from 'phaser'
import type { PickupKind } from './pickups'

export const PICKUP_TEXTURES: Record<PickupKind, string> = {
  boost: 'pickup-boost',
  shield: 'pickup-shield',
  coin: 'pickup-coin',
}

/** The drawing canvas. Square, so the world box the sprite is scaled to decides the aspect. */
export const PICKUP_CANVAS = 64

const COLORS: Record<PickupKind, { fill: number; rim: number }> = {
  boost: { fill: 0x39d7ff, rim: 0xdff6ff },
  shield: { fill: 0x7ee081, rim: 0xe8fbe9 },
  coin: { fill: 0xf5c33b, rim: 0xfff0c2 },
}

export function createPickupTextures(scene: Phaser.Scene): void {
  for (const kind of Object.keys(PICKUP_TEXTURES) as PickupKind[]) {
    const key = PICKUP_TEXTURES[kind]

    if (scene.textures.exists(key)) continue

    const size = PICKUP_CANVAS
    const g = scene.make.graphics({ x: 0, y: 0 }, false)
    const { fill, rim } = COLORS[kind]

    // A soft halo under every one of them: a pickup has to separate from a road that is grey, from
    // grass that is green and from sand that is pale, and one shared backing does that in every
    // biome without three per-biome variants.
    g.fillStyle(0x000000, 0.18)
    g.fillCircle(size / 2, size / 2, size * 0.46)

    if (kind === 'boost') {
      // Two stacked chevrons: one alone reads as a triangle, two read as motion.
      g.fillStyle(fill, 1)
      for (const dx of [-0.1, 0.14]) {
        g.beginPath()
        g.moveTo(size * (0.28 + dx), size * 0.2)
        g.lineTo(size * (0.58 + dx), size * 0.5)
        g.lineTo(size * (0.28 + dx), size * 0.8)
        g.lineTo(size * (0.4 + dx), size * 0.5)
        g.closePath()
        g.fillPath()
      }
      g.lineStyle(2, rim, 0.9)
      g.strokePath()
    } else if (kind === 'shield') {
      g.fillStyle(fill, 1)
      g.beginPath()
      g.moveTo(size * 0.5, size * 0.14)
      g.lineTo(size * 0.84, size * 0.3)
      g.lineTo(size * 0.78, size * 0.66)
      g.lineTo(size * 0.5, size * 0.87)
      g.lineTo(size * 0.22, size * 0.66)
      g.lineTo(size * 0.16, size * 0.3)
      g.closePath()
      g.fillPath()
      g.lineStyle(3, rim, 1)
      g.strokePath()
    } else {
      g.fillStyle(fill, 1)
      g.fillCircle(size / 2, size / 2, size * 0.34)
      g.lineStyle(3, rim, 1)
      g.strokeCircle(size / 2, size / 2, size * 0.34)
      // The hole. It is what makes this the only pickup with a gap in its middle, which is the
      // whole read at eight pixels.
      g.fillStyle(0x000000, 0)
      g.lineStyle(4, rim, 0.95)
      g.strokeCircle(size / 2, size / 2, size * 0.13)
    }

    g.generateTexture(key, size, size)
    g.destroy()
  }
}
