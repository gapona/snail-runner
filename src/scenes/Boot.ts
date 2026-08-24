import * as Phaser from 'phaser'
import { firstFrameReady } from '../platform/yt'
import { BRAND_TEXTURES } from '../ui/brand'

export class Boot extends Phaser.Scene {
  constructor() {
    super('Boot')
  }

  preload() {
    // Only what the loading screen itself has to draw — which is the whole reason this scene
    // exists, and the reason the branding is split across two scenes rather than loaded in one
    // place. `Preloader` builds its bar in `init()`, before its own `preload()` has fetched
    // anything, so an asset it needs cannot be one of the assets it is loading. The backdrop and
    // the emblem come from here; the two flanking robots are menu-only and are loaded by
    // `Preloader` along with everything else, where waiting for them costs nothing.
    //
    // Both are optional: `Boot` does not fail if they are missing, and `createBrand` degrades to
    // the theme's own colours — see `ui/brand.ts`.
    this.load.image(BRAND_TEXTURES.background, 'assets/brand/menu_bg.png')
    this.load.image(BRAND_TEXTURES.emblem, 'assets/brand/emblem.png')
    // A file that is not there yet must not take the loading screen down with it. Phaser keeps
    // loading the rest after a failed file, but it also emits an error the health monitor would
    // report as a real fault, so it is swallowed here deliberately and noted rather than logged.
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      console.debug(`[boot] optional branding asset missing: ${file.key}`)
    })
  }

  create() {
    this.game.events.once(Phaser.Core.Events.POST_RENDER, () => {
      firstFrameReady()
    })

    this.scene.start('Preloader')
  }
}
