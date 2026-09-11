import * as Phaser from 'phaser'
import { getRoadTheme } from './themes'
import { hasArt } from '../art/atlas'
import { DECOR_TEXTURES, fallbackShapeFor, type DecorTexture, type Polygon } from './decorShapes'

export { DECOR_TEXTURES, DECOR_KEYS, type DecorTexture } from './decorShapes'

/**
 * The keys this module drew, as opposed to ones that arrived as loaded art.
 *
 * **`applyTheme` must only ever remove keys in here.** A generated texture is cheap to destroy
 * because the next `createDecorTextures` call draws it again from the new theme's colours; a
 * loaded PNG is not, because nothing re-runs the loader after boot — removing one would leave
 * that slot permanently blank from the first theme switch onward, and only from the *second*
 * theme onward, which is exactly the kind of bug that survives a quick look at the menu.
 *
 * Module-level rather than per-scene because the texture manager is game-scoped and outlives
 * any one scene, which is the same reason `createDecorTextures` is idempotent at all.
 */
const generatedKeys = new Set<string>()

/** Whether this slot is showing loaded art rather than a shape drawn from `DECOR_SHAPES`. */
export function isDecorArt(scene: Phaser.Scene, key: string): boolean {
  return hasArt(scene.textures, key) && !generatedKeys.has(key)
}

/** Every decor key currently backed by a texture this module drew. */
export function generatedDecorKeys(): readonly string[] {
  return [...generatedKeys]
}

/**
 * Creates the placeholder scenery textures, once per game.
 *
 * Canvas textures rather than loaded assets on purpose: the whole point of chunk 5 is to find
 * out whether billboards read at speed, and shipping three PNGs to answer that would put art
 * in `dist/` that chunk 11 then has to remember to remove. Nothing here touches
 * `public/assets/`.
 *
 * Idempotent for the same reason `createRoadPalette` is: the texture manager is game-scoped
 * and outlives the scene, so a scene restart must reuse rather than re-create.
 */
export function createDecorTextures(scene: Phaser.Scene): readonly DecorTexture[] {
  for (const { key, width, height } of DECOR_TEXTURES) {
    // Already present means either "we drew it and nothing has removed it" or "the loader
    // brought real art in under this key" — nothing to do in either case. The second is how a
    // shipped sprite takes over a slot without a single call site changing, and since the art
    // moved into the world sheet the question is asked through `hasArt`: a fallback drawn over a
    // key the sheet already carries would *win*, because a standalone texture takes precedence.
    if (hasArt(scene.textures, key)) continue

    const canvasTexture = scene.textures.createCanvas(key, width, height)

    if (!canvasTexture) {
      throw new Error(`createDecorTextures: could not create canvas texture "${key}"`)
    }

    drawSilhouette(canvasTexture.context, fallbackShapeFor(key), width, height)
    canvasTexture.refresh()
    generatedKeys.add(key)
  }

  return DECOR_TEXTURES
}

/**
 * Fills one outline as a flat silhouette with a lighter rim.
 *
 * The rim is not decoration: a flat `DECOR_COLORS.body` shape against a `SKY_COLOR` sky is
 * nearly invisible at the horizon, where a billboard is a handful of pixels tall and most of
 * its area is a single blended colour.
 */
function drawSilhouette(
  context: CanvasRenderingContext2D,
  shape: Polygon,
  width: number,
  height: number,
): void {
  const toCss = (color: number) => `#${color.toString(16).padStart(6, '0')}`

  context.clearRect(0, 0, width, height)
  context.beginPath()
  for (const [index, [x, y]] of shape.entries()) {
    const px = x * width
    const py = y * height
    if (index === 0) context.moveTo(px, py)
    else context.lineTo(px, py)
  }
  context.closePath()

  const colors = getRoadTheme().decor

  context.fillStyle = toCss(colors.body)
  context.fill()

  context.lineWidth = Math.max(1, Math.round(Math.min(width, height) * 0.06))
  context.strokeStyle = toCss(colors.rim)
  context.stroke()
}
