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
  render: {
    // **⚠ No mipmaps, and that reverses the round that turned them on.** On a Mali-G57 under
    // Chrome's WebGL1 a distant coin drew as an opaque black square with a green line through it
    // and came right as it approached — i.e. the lower mip levels were wrong and level 0 was fine.
    // It is not the chain's *content*: the shipped sheet box-filtered offline keeps the coin frame
    // gold at every level down to 1x1. So `generateMipmap` itself produces garbage on that GPU, no
    // engine hole was found (Phaser uploads level 0 and regenerates in the right order), and the
    // only sampling correct on every device is level 0. Empty is Phaser's own "no mipmaps":
    // `resize` falls back to `LINEAR` and `generateMipmap` returns before touching GL. It also
    // removes the one start-of-run GPU cost a phone pays and a desktop does not, and ~10.7MB of
    // GPU memory. What it costs is minification shimmer at the horizon, which is what shipped
    // before the atlas. `?perf=1&mips=1` puts them back for a test; `verify:perf` holds this line.
    mipmapFilter: '',
  },
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
