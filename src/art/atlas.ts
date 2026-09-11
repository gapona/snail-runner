import type * as Phaser from 'phaser'

/**
 * The one seam between a texture *key* and where its pixels actually live.
 *
 * The world's sprites — scenery, obstacles, critters, pickups — ship packed into a single
 * power-of-two sheet (`scripts/build-atlas.py`, loaded by `Preloader` under `ATLAS_KEY`), and each
 * frame in it is named by the texture key the game has always used. Every consumer used to ask the
 * texture manager for that key directly, which is right for a standalone texture and wrong for a
 * frame; this module answers both the same way, so the pools, the fallback drawers and the pixel
 * readers need to know nothing about which arrangement a key is in.
 *
 * **Precedence is standalone first.** A key that exists as its own texture — a procedural fallback
 * drawn because the atlas failed to load, a test fixture, a canvas somebody generated under a base
 * key — wins over the same name inside the sheet. That keeps every `createXTextures` guard honest:
 * they draw a placeholder only when `hasArt` says there is nothing, and once drawn it is what is
 * used.
 *
 * **Why a sheet.** Phaser 4's quad batch holds 16 textures and flushes on the seventeenth; the run
 * drew from about forty distinct ones interleaved by depth, which was most of its remaining draw
 * calls. And a power-of-two sheet is the only thing this renderer generates mipmaps for — every
 * trimmed NPOT sprite was sampled from its full-size texture at a few pixels wide, which is both
 * the shimmer at the horizon and a cache miss per texel on a phone.
 *
 * **⚠ The mipmaps are switched off again** (`config.ts`): a Mali phone drew distant coins as black
 * squares from the lower levels. The sheet stays power-of-two and padded, so the day a chain that
 * is correct on every device returns, nothing here has to move.
 */
export const ATLAS_KEY = 'world'

/** Where `Preloader` finds the sheet and its frame table, relative to the site root. */
export const ATLAS_IMAGE_PATH = 'assets/atlas/world.png'
export const ATLAS_JSON_PATH = 'assets/atlas/world.json'

export type ArtRef = readonly [texture: string, frame?: string]

function inAtlas(textures: Phaser.Textures.TextureManager, key: string): boolean {
  return textures.exists(ATLAS_KEY) && textures.get(ATLAS_KEY).has(key)
}

/** Is there a picture for this key at all — its own texture, or a frame in the sheet? */
export function hasArt(textures: Phaser.Textures.TextureManager, key: string): boolean {
  return textures.exists(key) || inAtlas(textures, key)
}

/**
 * What to hand `setTexture` for a key. `null` when nothing carries it, which a caller should treat
 * as "draw nothing" rather than fall through to a bare `setTexture(key)` — that logs a Phaser
 * warning and paints the missing-texture checkerboard.
 */
export function artRef(textures: Phaser.Textures.TextureManager, key: string): ArtRef | null {
  if (textures.exists(key)) return [key]
  if (inAtlas(textures, key)) return [ATLAS_KEY, key]
  return null
}

/**
 * Points an image at a key, wherever the key's pixels live. The pools call this in the one place
 * they used to call `setTexture`, and their own "skip when the key has not changed" caches stay
 * valid because the key is still the identity.
 */
export function setArt(image: Phaser.GameObjects.Image, key: string): void {
  const ref = artRef(image.scene.textures, key)

  if (ref) image.setTexture(ref[0], ref[1])
}

/** A frame's pixels: the element to draw from and the rectangle of it that is this key. */
export interface ArtPixels {
  image: HTMLImageElement | HTMLCanvasElement
  x: number
  y: number
  width: number
  height: number
}

/**
 * For the readers that need the bytes rather than a sprite — the obstacles' contour pass, and
 * anything else that copies a key into a canvas. `getSourceImage()` on an atlas frame would hand
 * back the whole sheet; this hands back the sheet *and* the frame's cut, so `drawImage`'s
 * nine-argument form lands the right pixels.
 */
export function artPixels(textures: Phaser.Textures.TextureManager, key: string): ArtPixels | null {
  const ref = artRef(textures, key)

  if (!ref) return null

  const frame = textures.getFrame(ref[0], ref[1])
  const image = frame.source.image

  if (!(image instanceof HTMLImageElement) && !(image instanceof HTMLCanvasElement)) return null

  return { image, x: frame.cutX, y: frame.cutY, width: frame.cutWidth, height: frame.cutHeight }
}
