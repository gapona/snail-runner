import * as Phaser from 'phaser'
import { bindAction } from '../platform/input'
import { bindLayout } from '../ui/layout'
import { WorldView } from '../run/WorldView'
import { SPEED_BASE } from '../run/constants'

/**
 * The run.
 *
 * **Right now it is deliberately nothing but a world.** This is the rail shooter's `RailScene`
 * after the combat layer came out: the ground, the scenery, the sky and a camera moving through
 * them, and no rules at all. Everything that made it a game — the ship, the enemies, the waves,
 * the weapons, the boss — is gone, and what replaces it (the snail, the obstacles, the jump, the
 * speed economy) arrives one chunk at a time on top of this.
 *
 * The two-camera split is set up now rather than when there is something to put on it, because it
 * is the part that is expensive to retrofit: `uiCamera` renders screen-space furniture 1:1 while
 * `cameras.main` carries the world, and every world object has to be `uiCamera.ignore()`-ed or it
 * is drawn twice at two different transforms. `assertWorldIsSingleCamera` checks that in DEV, so
 * the mistake is reported rather than merely visible.
 */
export class RunScene extends Phaser.Scene {
  private world!: WorldView
  private uiCamera!: Phaser.Cameras.Scene2D.Camera

  constructor() {
    super('RunScene')
  }

  create() {
    // The ground, the scenery, the sky and the camera that rides through them — all of it in
    // `WorldView`, which `MainMenu` builds the same way. Two scenes drawing the same world from
    // one class cannot disagree about the horizon, the palette or the fog.
    this.world = new WorldView(this, { speed: SPEED_BASE })

    // World/UI split per CLAUDE.md "Responsive Layout". Created empty: nothing screen-space
    // exists yet, and creating it now is what keeps the `ignore()` contract in one place.
    this.uiCamera = this.cameras.add(0, 0, this.scale.width, this.scale.height)
    this.uiCamera.ignore(this.world.gameObjects)

    bindAction(this, 'close', { keys: ['ESC'] }, () => {
      this.scene.start('MainMenu')
    })

    bindLayout(this, (width, height) => this.layout(width, height))

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.world.destroy()
    })

    if (import.meta.env.DEV) this.assertWorldIsSingleCamera()
  }

  /**
   * A missed `ignore()` draws the object twice — once per camera, at different transforms — which
   * on a road that is mostly one colour looks like a rendering artefact rather than a wiring
   * mistake. Cheap to check once at start-up, impossible to spot by eye later.
   */
  private assertWorldIsSingleCamera(): void {
    const leaked = this.world.gameObjects.filter((object) => (object.cameraFilter & this.uiCamera.id) === 0)

    if (leaked.length > 0) {
      console.warn(`[run] ${leaked.length} world object(s) are not ignored by uiCamera and will be drawn twice`)
    }
  }

  layout(width: number, height: number): void {
    // cameras.main is deliberately left alone — no zoom, no centerOn. The road's own projection
    // is the camera model; a Phaser zoom on top of it would fight the horizon.
    this.uiCamera.setViewport(0, 0, width, height)
    this.world.layout(width, height)
  }

  update(_time: number, delta: number): void {
    const width = this.scale.width
    const height = this.scale.height

    // Nothing to follow yet, so the camera is told to look straight ahead (`0.5` = the centre of
    // the frame). Chunk 2 passes the snail's own screen fraction here.
    this.world.advance(delta, 0.5)
    this.world.render(width, height)
  }
}
