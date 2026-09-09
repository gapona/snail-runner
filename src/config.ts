import * as Phaser from 'phaser'
import { Boot } from './scenes/Boot'
import { Preloader } from './scenes/Preloader'
import { MainMenu } from './scenes/MainMenu'
import { RunScene } from './scenes/RunScene'
import { RunOver } from './scenes/RunOver'
import { Settings } from './scenes/Settings'
import { Shop } from './scenes/Shop'
import { Garage } from './scenes/Garage'
import { SteerTuner } from './scenes/SteerTuner'
import { Records } from './scenes/Records'
import { RunPause } from './scenes/RunPause'

export const GameConfig: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  backgroundColor: '#028af8',
  scale: {
    parent: 'app',
    mode: Phaser.Scale.RESIZE,
    width: '100%',
    height: '100%',
  },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 0 },
      debug: false,
    },
  },
  /**
   * **⚠ Order is render order, and overlays have to come last.** `SceneManager.render` walks this
   * array forward, so a scene registered later is painted over every scene before it — which has
   * nothing to do with which scene launched which. `Garage` sat after `Settings` and `Shop` and
   * therefore drew its whole world *over* either of them; see `ui/overlay.ts` for what that looked
   * like. The places come first, the drawers after them.
   *
   * The guarantee is `launchOverlay`'s `bringToTop`, not this line — a rule kept only by an array
   * literal is a rule the next scene added in the wrong place breaks silently. This order is what
   * the list should say anyway.
   */
  scene: [
    Boot, Preloader, MainMenu, Garage, RunScene, RunOver, RunPause, Settings, Shop, Records,
    // **A static import whose only reference is inside a DEV branch, which is what tree-shakes.**
    // Gating the *call* leaves the module in the bundle -- the finding `perfReport.ts` exists for --
    // and `check-bundle.mjs` greps the built output for `__steer` so "we gated it" and "it is gone"
    // stay separate claims.
    ...(import.meta.env.DEV ? [SteerTuner] : []),
  ],
}
