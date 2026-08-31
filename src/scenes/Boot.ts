import * as Phaser from 'phaser'
import { firstFrameReady } from '../platform/yt'
import { SNAIL_TEXTURE } from '../run/snailArt'

/**
 * Stage one: the one file the loading screen itself draws.
 *
 * **A loading screen cannot show art it is still loading**, so whatever it needs has to arrive
 * before it does — and everything else has to arrive after, or the screen is late by the size of
 * the game. `Preloader` builds its own background from a `createLinearGradient` canvas and its bar
 * from `Graphics`, both of which cost nothing; the mascot is the only part of it that is a file.
 *
 * **One frame, not six.** The glide cycle is six 22KB PNGs and the loading screen needs a snail, not
 * an animation: `snail-0` is 22KB, which is under half a second on a throttled 3G connection, and
 * the other five arrive in `Preloader`'s own queue and start the cycle when they do. Loading all six
 * here would put 131KB in front of the first screen to animate a sprite nobody is looking at yet.
 */
export class Boot extends Phaser.Scene {
  constructor() {
    super('Boot')
  }

  preload() {
    // **⚠ Do not add a `load.image` for a file that is not there yet.** In dev, Vite answers a
    // missing path under `public/` with `index.html` rather than a 404, so Phaser *loads* it fine
    // and then fails to *process* it — `FILE_LOAD_ERROR` never fires and the boot chain stalls on
    // this scene with two console errors and a black screen. Found exactly that way when the old
    // branding files were deleted.
    this.load.image(SNAIL_TEXTURE, `assets/snail/${SNAIL_TEXTURE}.png`)

    // **A failure here must not stall the boot**, which is what it did before anything handled it.
    // The mascot is decoration on this screen; `Preloader` draws without it and its own error
    // handling covers the files that actually matter.
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      console.warn(`[boot] ${file.key} failed to load; the loading screen will run without it`)
    })
  }

  create() {
    this.game.events.once(Phaser.Core.Events.POST_RENDER, () => {
      firstFrameReady()
    })

    this.scene.start('Preloader')
  }
}
