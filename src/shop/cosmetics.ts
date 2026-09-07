import * as Phaser from 'phaser'
import { AUTO_THEME_ID } from '../save/types'
import { DEFAULT_ROAD_THEME } from '../road/themes'
import { applyTheme } from '../road/applyTheme'
import { getState, mutate } from '../save/store'
import { skinIdFromItem, snailSkin } from '../run/snailSkins'
import { themeIdFromItem } from './themeCatalog'
import type { ShopItem } from './catalog'
import type { WorldView } from '../run/WorldView'
import type { PlayerView } from '../run/PlayerView'

/**
 * Applying a bought look, shared by every screen that can open the shop over a live world.
 *
 * ## ⚠ Two screens can open the shop now, and only one of them could apply what it sells
 *
 * `Shop` only offers a row as *selectable* when its opener handed it an `onSelect`; without one, an
 * owned cosmetic reads `Owned` and there is no control anywhere that wears it. That was correct
 * while `MainMenu` was the only door. The nav bar gave the garage the same door, and the garage
 * passed no callback — so from there the shop could take coins for a theme and then refuse to put
 * it on, which is exactly the Buy/Owned defect the garage's own action button exists to avoid.
 *
 * It lives here rather than being copied because the two screens hold the same two surfaces (a
 * `WorldView` and a `PlayerView`) and the *ordering* below is the part worth having in one place.
 */
export interface CosmeticSurfaces {
  world: WorldView
  mascot: PlayerView
}

/**
 * Whether a row is the look currently worn or driven.
 *
 * Asked per refresh rather than answered once, because the selection changes while the shop is
 * open — and asked of *both* id spaces, since the two catalogues share one row list.
 */
export function isCosmeticSelected(item: ShopItem): boolean {
  const skinId = skinIdFromItem(item.id)

  if (skinId !== null) return skinId === getState().selectedSnail

  const themeId = themeIdFromItem(item.id)

  return themeId !== null && themeId === getState().selectedTheme
}

/**
 * Applies a shop selection — a look for the road, or a look for the snail.
 *
 * **The two are told apart by their id prefix and nothing else**, which is what lets a third kind of
 * cosmetic land here without the shop scene learning about it: `skinIdFromItem` and `themeIdFromItem`
 * each answer `null` for anything that is not theirs.
 */
export function selectCosmetic(scene: Phaser.Scene, surfaces: CosmeticSurfaces, item: ShopItem): void {
  const skinId = skinIdFromItem(item.id)

  if (skinId !== null) {
    // Rejected rather than trusted: the row could name a skin this build no longer has.
    if (!snailSkin(skinId)) return

    // The mascot first, the save second — the frame behind the panel is the confirmation, and a
    // save written before the picture changed is a save that can outlive a failed texture build.
    surfaces.mascot.setSkin(scene, skinId)
    mutate((state) => {
      state.selectedSnail = skinId
    })

    return
  }

  const themeId = themeIdFromItem(item.id)

  if (!themeId) return

  const applied = themeId === AUTO_THEME_ID ? DEFAULT_ROAD_THEME : themeId

  // `applyTheme` swaps the pixels behind live texture keys, so it may only run while nothing is
  // drawing them. That precondition is not free here: the calling scene draws the world itself, and
  // it is paused (not stopped) while the shop is open — paused means its `update` does not run, so
  // no render of its can be in flight when this executes. That is why every caller must be an
  // opener that `launchOverlay` paused.
  if (!applyTheme(scene, applied)) return

  surfaces.world.refreshTheme(scene, scene.scale.width, scene.scale.height)
  surfaces.mascot.refreshTheme(scene)

  mutate((state) => {
    state.selectedTheme = themeId
  })
}
