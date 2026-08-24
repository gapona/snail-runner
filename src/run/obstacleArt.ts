/**
 * The textures obstacles are drawn with, generated per theme.
 *
 * **This module is also a named seam.** `road/applyTheme.ts` tears down and regenerates every
 * texture whose pixels are a function of the theme, and it has to be handed *the list*. The rail
 * shooter pointed it at `enemyArt.ts`; that back-reference from the untouchable `src/road/` layer
 * into the genre layer is the one thing about the fork that could not simply be deleted, so the
 * seam kept its shape and this is what stands behind it now.
 *
 * **The three silhouettes are the mechanic, and they must be tellable apart in one glance at eight
 * pixels tall.** `verify:obstacles` measures how big each class is `REACTION_MS` before impact —
 * 15px for a low rock, 53px for a boulder, 95px for a branch on a landscape phone — and that
 * margin is only worth anything if the shapes differ in *outline*, not in colour or detail:
 *
 * - **low** — a wide, flat wedge sitting on the ground. Nothing above the waist.
 * - **blocking** — a tall mass with a straight vertical face. Reads as a wall.
 * - **overhead** — a bar hanging in the air with **empty road drawn under it**. The gap is the
 *   whole message, and it is the one silhouette with daylight at the bottom.
 *
 * Same rule as every other generated texture here (`decor.ts`, `snailArt.ts`): **if the key
 * already exists, nothing is drawn**, so dropping real art in under these keys is the entire swap.
 */
import type * as Phaser from 'phaser'
import { getRoadTheme } from '../road/themes'
import { OBSTACLE_BANDS, type ObstacleKind } from './constants'

export const OBSTACLE_TEXTURES: Record<ObstacleKind, string> = {
  low: 'obstacle-low',
  blocking: 'obstacle-blocking',
  overhead: 'obstacle-overhead',
}

/**
 * The drawing canvas for each class, in pixels.
 *
 * **Not a size in the game** — `ObstacleSprites` scales every one of these to the world box the
 * obstacle actually occupies, exactly as `PlayerView` does for the snail. What has to be right
 * here is the *aspect*, so the scaling never distorts: each is 128 wide by whatever its band's
 * height comes to at the same units-per-pixel.
 */
const CANVAS_WIDTH = 128

function canvasFor(kind: ObstacleKind): { width: number; height: number } {
  const band = OBSTACLE_BANDS[kind]
  // The world box is `halfWidths * 2 * ROAD_WIDTH` wide by `yHigh - yLow` tall; the placer varies
  // the width per obstacle, so the canvas uses the middle of that range and lets the scale do the
  // rest. What matters is that a class's own aspect is stable.
  const worldWidth = 0.23 * 2 * 2000
  const worldHeight = band.yHigh - band.yLow

  return { width: CANVAS_WIDTH, height: Math.round((CANVAS_WIDTH * worldHeight) / worldWidth) }
}

export const OBSTACLE_CANVAS: Record<ObstacleKind, { width: number; height: number }> = {
  low: canvasFor('low'),
  blocking: canvasFor('blocking'),
  overhead: canvasFor('overhead'),
}

/**
 * What each class is made of.
 *
 * A rock, a boulder and a fallen branch — earth tones rather than the road's own grey, so the
 * things the player must not touch never blend into the surface they are standing on.
 */
const MATERIALS: Record<ObstacleKind, { body: number; rim: number }> = {
  low: { body: 0x6b6257, rim: 0xa89b88 },
  blocking: { body: 0x4d5563, rim: 0x939cb0 },
  overhead: { body: 0x54402c, rim: 0x8f6f47 },
}

/** Every obstacle texture key. */
export const OBSTACLE_TEXTURE_KEYS: readonly string[] = Object.values(OBSTACLE_TEXTURES)

/** Which of the keys above this module drew itself, as opposed to the loader having filled them. */
const generated = new Set<string>()

/**
 * Keys this module actually generated, for `applyTheme` to remove before regenerating.
 *
 * **Only generated keys, never every declared key** — the rule inherited from `decor.ts`: a slot
 * showing *loaded* art has nothing to regenerate from, so removing it would blank that slot for
 * the rest of the session. Art-backed obstacles are themed by tint at draw time instead.
 */
export function generatedObstacleKeys(): readonly string[] {
  return OBSTACLE_TEXTURE_KEYS.filter((key) => generated.has(key))
}

/**
 * Draws whatever obstacle art the current theme needs and is missing.
 *
 * Idempotent: a key that already exists is left alone, which is what lets `applyTheme` call this
 * unconditionally after removing the previous theme's set.
 */
export function createObstacleTextures(scene: Phaser.Scene): void {
  const theme = getRoadTheme()

  for (const kind of Object.keys(OBSTACLE_TEXTURES) as ObstacleKind[]) {
    const key = OBSTACLE_TEXTURES[kind]

    if (scene.textures.exists(key)) continue

    const { width, height } = OBSTACLE_CANVAS[kind]
    const g = scene.make.graphics({ x: 0, y: 0 }, false)

    // **Colour is a second cue, never the first.** The silhouette has to carry the read on its own
    // — a player who can only tell a boulder from a rock by hue cannot tell them apart on a bright
    // sky, on a colour-blind eye, or in a screenshot — so the three shapes differ in outline
    // first. Given that, giving each class its own material costs nothing and helps: three
    // identically slate-grey masses read as one kind of thing repeated, which was exactly how the
    // first version looked in the frame.
    const palette = MATERIALS[kind]
    const body = multiply(palette.body, theme.decorTint)
    const rim = multiply(palette.rim, theme.decorTint)

    if (kind === 'low') drawLow(g, width, height, body, rim)
    else if (kind === 'blocking') drawBlocking(g, width, height, body, rim)
    else drawOverhead(g, width, height, body, rim)

    g.generateTexture(key, width, height)
    g.destroy()
    generated.add(key)
  }
}

/** A wide flat wedge: all mass at the bottom, nothing above the waist. Jump it. */
function drawLow(g: Phaser.GameObjects.Graphics, width: number, height: number, body: number, rim: number): void {
  g.fillStyle(body, 1)
  g.beginPath()
  g.moveTo(0, height)
  g.lineTo(width * 0.16, height * 0.28)
  g.lineTo(width * 0.55, height * 0.06)
  g.lineTo(width * 0.88, height * 0.34)
  g.lineTo(width, height)
  g.closePath()
  g.fillPath()
  g.lineStyle(Math.max(2, width * 0.02), rim, 1)
  g.strokePath()
  // A highlight along the top edge only: the eye reads "this is low and solid" from the profile,
  // and a lit top is what makes the profile a profile rather than a blob.
  g.lineStyle(Math.max(2, width * 0.025), rim, 0.9)
  g.beginPath()
  g.moveTo(width * 0.16, height * 0.28)
  g.lineTo(width * 0.55, height * 0.06)
  g.lineTo(width * 0.88, height * 0.34)
  g.strokePath()
}

/** A tall mass with a straight vertical face. Reads as a wall; go around it. */
function drawBlocking(g: Phaser.GameObjects.Graphics, width: number, height: number, body: number, rim: number): void {
  g.fillStyle(body, 1)
  g.beginPath()
  g.moveTo(width * 0.08, height)
  g.lineTo(width * 0.05, height * 0.22)
  g.lineTo(width * 0.42, 0)
  g.lineTo(width * 0.95, height * 0.14)
  g.lineTo(width * 0.92, height)
  g.closePath()
  g.fillPath()
  g.lineStyle(Math.max(2, width * 0.022), rim, 1)
  g.strokePath()
  // Two vertical creases. They do nothing but say "tall" — the one thing this silhouette has to
  // communicate that the low wedge does not.
  g.lineStyle(Math.max(1.5, width * 0.014), rim, 0.55)
  for (const x of [0.34, 0.66]) {
    g.beginPath()
    g.moveTo(width * x, height * 0.1)
    g.lineTo(width * x, height * 0.96)
    g.strokePath()
  }
}

/**
 * A bar hanging in the air.
 *
 * **The empty space under it is the drawing.** The canvas spans the obstacle's own band — which
 * starts at 260 world units, well above the road — so the sprite is positioned with that gap
 * already accounted for and what the player sees is a mass with daylight beneath it. That is the
 * only silhouette in the game with nothing touching the ground, which is exactly the read: duck.
 */
function drawOverhead(g: Phaser.GameObjects.Graphics, width: number, height: number, body: number, rim: number): void {
  // The bar occupies the bottom third of its own band; the rest is the trunk/canopy above it,
  // drawn thinner so the eye lands on the hanging edge rather than on the top.
  const barTop = height * 0.52
  const barBottom = height * 0.86

  g.fillStyle(body, 1)
  g.fillRect(0, barTop, width, barBottom - barTop)
  g.lineStyle(Math.max(2, width * 0.022), rim, 1)
  g.strokeRect(0, barTop, width, barBottom - barTop)

  // Hanging teeth along the underside: the single clearest "there is a ceiling here" cue, and the
  // thing that keeps the bar from reading as a distant horizontal wall.
  g.fillStyle(body, 1)
  for (let i = 0; i < 5; i++) {
    const x = width * (0.1 + i * 0.2)

    g.fillTriangle(x - width * 0.05, barBottom, x + width * 0.05, barBottom, x, barBottom + height * 0.12)
  }

  // A thin support above, so the bar has a reason to be in the air.
  g.fillStyle(body, 0.85)
  g.fillRect(width * 0.42, 0, width * 0.16, barTop)
  g.lineStyle(Math.max(1.5, width * 0.014), rim, 0.7)
  g.strokeRect(width * 0.42, 0, width * 0.16, barTop)
}

/** Channel-wise multiply, the same operation `road/color.ts` does for scenery tints. */
function multiply(color: number, tint: number): number {
  const r = (((color >> 16) & 0xff) * ((tint >> 16) & 0xff)) / 255
  const g = (((color >> 8) & 0xff) * ((tint >> 8) & 0xff)) / 255
  const b = ((color & 0xff) * (tint & 0xff)) / 255

  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b)
}
