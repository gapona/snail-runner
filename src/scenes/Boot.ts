import * as Phaser from 'phaser'
import { firstFrameReady } from '../platform/yt'

export class Boot extends Phaser.Scene {
  constructor() {
    super('Boot')
  }

  preload() {
    // **Empty, and that is the current state rather than the design.** This scene exists to load
    // what the *loading screen itself* draws — `Preloader` builds its bar in `init()`, before its
    // own `preload()` has fetched anything, so an asset it needs cannot be one of the assets it is
    // loading. The rail shooter loaded a backdrop plate and an emblem here; both were that game's
    // branding and went with it. `createBrand` degrades to the theme's own colours, so the loading
    // screen is currently the wordmark on a flat plate, and chunk 7's art comes back here.
    //
    // **⚠ Do not add a `load.image` for a file that is not there yet.** In dev, Vite answers a
    // missing path under `public/` with `index.html` rather than a 404, so Phaser *loads* it fine
    // and then fails to *process* it — `FILE_LOAD_ERROR` never fires, the handler that used to sit
    // here never ran, and the boot chain stalled on `Boot` with two console errors and a black
    // screen. Found exactly that way when the old branding files were deleted.
  }

  create() {
    this.game.events.once(Phaser.Core.Events.POST_RENDER, () => {
      firstFrameReady()
    })

    this.scene.start('Preloader')
  }
}
