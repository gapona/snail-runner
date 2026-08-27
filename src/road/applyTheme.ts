import * as Phaser from 'phaser'
import { createDecorTextures, generatedDecorKeys } from './decor'
import {
  ensureSkyTextures,
  ensureCloudTexture,
  ensureSunTexture,
  ensureVignetteTexture,
  removeSkyTextures,
  removeCloudTexture,
  removeSunTexture,
  removeVignetteTexture,
} from './Backdrop'
import { createObstacleTextures, generatedObstacleKeys } from '../run/obstacleArt'
import { getRoadThemeId, setRoadTheme, THEMES } from './themes'

/**
 * Every texture whose pixels are a function of the theme.
 *
 * The road palette is not here: `createRoadPalette` removes and rebuilds its own key, because
 * the mesh holds a reference to the texture object and has to be handed the new one.
 *
 * **Both lists contribute only the keys they generated**, not every declared key. A slot showing
 * loaded art has nothing to regenerate from, so removing it would blank that slot for the rest
 * of the session — see `generatedDecorKeys` / `generatedObstacleKeys`. Art-backed scenery and
 * obstacles are themed by tint at draw time instead of by redrawing their pixels.
 */
function themedTextureKeys(): string[] {
  return [
    ...generatedDecorKeys(),
    ...generatedObstacleKeys(),
  ]
}

/**
 * Scenes that hold sprites pointing at themed textures and cannot survive a swap on their own.
 *
 * Removing a texture out from under a live `Image` leaves it holding a destroyed frame; the next
 * render throws inside Phaser on `frame.realWidth`, or in the mesh's case on `glTexture` of null.
 *
 * **`MainMenu` is deliberately not on this list, and it used to be the reason the list worked.**
 * The old menu was a static illustration, so "no scene is drawing themed textures" was true for
 * free whenever the theme picker ran. The menu now renders the game's own world, i.e. it holds
 * every themed texture there is — so instead of being warned about, it *absorbs* the swap:
 * `WorldView.refreshTheme` re-points the palette, clears the pools' cached keys and re-lays the
 * backdrop, immediately after this returns. `RunScene` has no such path and must not be running.
 */
const TEXTURE_HOLDING_SCENES = ['RunScene']

/**
 * Materialises a theme: drops the previous theme's textures and generates the new ones.
 *
 * **Precondition: no scene may currently be drawing themed textures.** This swaps the pixels
 * behind live texture keys, which is safe only while nothing holds them. In DEV that
 * precondition is checked and complained about rather than left to produce a crash three
 * frames later with a stack inside Phaser.
 *
 * **Only one theme's textures ever exist**, which is the property the plan asks for. With
 * generated art the "load" is canvas work rather than a download — there is no file to fetch
 * and nothing to lazy-load in the usual sense — but the memory shape is the same: switching
 * pays for the new set on demand and the old set goes. When real art replaces the generators,
 * the per-theme `load.image` calls go exactly here, and nothing else has to change.
 *
 * Returns `false` if the theme was already active or unknown, in which case nothing is touched.
 */
export function applyTheme(scene: Phaser.Scene, id: string): boolean {
  const previous = getRoadThemeId()

  if (!THEMES[id] || !setRoadTheme(id)) return false

  if (import.meta.env.DEV) {
    const live = scene.scene.manager
      .getScenes(true)
      .map((active) => active.scene.key)
      .filter((key) => TEXTURE_HOLDING_SCENES.includes(key))

    if (live.length > 0) {
      console.warn(`[theme] applyTheme ran while ${live.join(', ')} is active — its sprites now hold destroyed textures`)
    }
  }

  // Removed *before* the new set is generated: the generators skip a key that already exists,
  // so leaving the old ones in place would silently keep the previous theme's pixels.
  for (const key of themedTextureKeys()) {
    if (scene.textures.exists(key)) scene.textures.remove(key)
  }
  removeSkyTextures(scene, previous)
  // The vignette is per theme for the same reason the sky is -- its colour is -- so it is torn
  // down on the same beat. Missing this leaves the old theme's tint hanging over the new one.
  removeVignetteTexture(scene, previous)
  removeSunTexture(scene, previous)
  removeCloudTexture(scene, previous)

  createDecorTextures(scene)
  createObstacleTextures(scene)
  ensureSkyTextures(scene)
  ensureVignetteTexture(scene)
  ensureSunTexture(scene)
  ensureCloudTexture(scene)

  return true
}

/** Generates the active theme's textures without switching, for first-time scene setup. */
export function ensureThemeTextures(scene: Phaser.Scene): void {
  createDecorTextures(scene)
  createObstacleTextures(scene)
  ensureSkyTextures(scene)
}
