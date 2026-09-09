import * as Phaser from 'phaser'

/**
 * A `Graphics` readout drawn once into a texture and then blitted, instead of replayed per frame.
 *
 * **⚠ A `Graphics` is re-tessellated and re-submitted on every frame it is *visible*, not on every
 * frame it is redrawn**, and this project has now been caught by that twice. The first round found
 * the HUD's three readouts rebuilding their command buffers sixty times a second and guarded the
 * *rebuild* with a signature — which was right and only half the cost. Measured on the running
 * game at 375x667 afterwards, with the rebuild firing on 0.117 of frames for the life row and on
 * **none at all** for the fruit tank:
 *
 * ```
 *                 command buffer   rebuilt per frame   cost per frame
 * life row                  1326               0.117          0.143ms
 * fruit tank                1096               0.000          0.107ms
 * ```
 *
 * A quarter of a millisecond of a 1.1ms frame, for two pictures that change a handful of times in
 * a run. The same shape as the shadows, which were four pools of `Ellipse`s running `Earcut` every
 * frame for marks that never change shape: **the fix is to stop asking the renderer to draw
 * something whose answer nobody has changed.**
 *
 * So the `Graphics` here is off the display list — it is an *author*, not an object in the scene —
 * and what the scene draws is an `Image` of a `DynamicTexture` it has painted. `DynamicTexture`
 * suits this exactly: `draw()` only queues, and `render()` returns immediately when nothing has
 * been queued, so a readout at rest costs one quad and no tessellation at all.
 *
 * **The caller draws in texture-local coordinates**, with `(0, 0)` at the texture's top-left, and
 * hands `redraw` the screen point that corner belongs at. That is what keeps the pad honest: a
 * readout that bleeds outside its own box — a halo, a flash, an element still flying in — draws at
 * negative coordinates against its box and positive ones against the texture, so the pad is a
 * number the caller derives once from the constants that create the bleed rather than a margin
 * somebody eyeballed. Content past the texture is silently clipped, which is why the two callers
 * state their bleed as a function in a pure module and `verify:ui` holds the pad to it.
 */
export class BakedGraphics {
  /** What the scene draws. Belongs in the owner's `gameObjects()` for the camera ignore lists. */
  readonly image: Phaser.GameObjects.Image

  private readonly graphics: Phaser.GameObjects.Graphics
  private readonly texture: Phaser.Textures.DynamicTexture
  private width = 0
  private height = 0

  constructor(
    private readonly scene: Phaser.Scene,
    /** Texture key. Must be unique per instance — it is a real entry in the texture manager. */
    private readonly key: string,
  ) {
    // `false` keeps it off the display list: nothing iterates it, no camera has to ignore it, and
    // it is never drawn except by the texture that asks for it.
    this.graphics = scene.make.graphics({}, false)
    // **Removed first, then added** — the same ordering `applyTheme` is under, and for the same
    // reason: a texture key is global, a scene is rebuilt on every restart, and `addDynamicTexture`
    // refuses a key it already holds rather than replacing it. Without this a second run would get
    // no texture at all and the readout would draw as whatever the key still pointed at.
    if (scene.textures.exists(key)) scene.textures.remove(key)

    this.texture = scene.textures.addDynamicTexture(key, 1, 1) as Phaser.Textures.DynamicTexture
    this.image = scene.add.image(0, 0, key).setOrigin(0, 0).setVisible(false)
  }

  /**
   * Repaints the texture and puts it on screen with its top-left corner at `(x, y)`.
   *
   * Call only when the picture would differ — that is the whole point. `paint` draws in
   * texture-local coordinates.
   */
  redraw(x: number, y: number, width: number, height: number, paint: (g: Phaser.GameObjects.Graphics) => void): void {
    const w = Math.max(1, Math.ceil(width))
    const h = Math.max(1, Math.ceil(height))

    if (w !== this.width || h !== this.height) {
      this.width = w
      this.height = h
      this.texture.setSize(w, h)
      // The frame's size changed under a texture the image is already holding, so the image has to
      // be told: `setTexture` with the same key re-reads the frame rather than being a no-op.
      this.image.setTexture(this.key)
    }

    this.graphics.clear()
    paint(this.graphics)
    this.texture.clear()
    this.texture.draw(this.graphics)
    // **`draw` only queues; nothing in Phaser flushes a `DynamicTexture` for you.** Its own class
    // docs say so and it is easy to miss — the image comes up empty with no error anywhere, which
    // is exactly how this was found.
    this.texture.render()
    this.image.setPosition(x, y).setVisible(true)
  }

  /** Takes the readout off screen without discarding what it holds. */
  hide(): void {
    this.image.setVisible(false)
  }

  /**
   * The whole readout's opacity.
   *
   * On the image rather than in the paint, which is what lets the fruit tank yield to the mascot
   * without a repaint: alpha is a property of the object and not of its geometry.
   */
  setAlpha(alpha: number): void {
    this.image.setAlpha(alpha)
  }

  setDepth(depth: number): void {
    this.image.setDepth(depth)
  }

  destroy(): void {
    this.image.destroy()
    this.graphics.destroy()
    this.scene.textures.remove(this.key)
  }
}
