import * as Phaser from 'phaser'

/**
 * The one texture every ground shadow in this game is drawn from.
 *
 * **⚠ A shadow is an `Image`, never an `Ellipse`, and the reason is a per-frame cost nothing else
 * in the frame pays.** `Phaser.GameObjects.Ellipse.setSize()` calls `updateData()`, which walks
 * `geom.getPoints(smoothness)` — 64 freshly allocated `Point`s — flattens them into a path and runs
 * **`Earcut`** over it, every call. A shadow's size is a function of its owner's height, so it is
 * set every frame: measured in the running game at 375x667, **13 `updateData` calls a frame**, i.e.
 * ~830 short-lived objects and 13 triangulations a frame for marks that never change shape.
 *
 * Measured A/B on the shipped scene, with the tessellation stubbed out and put back as the control:
 * the pickup pass went **0.168ms -> 0.019ms** a frame and the player's own draw **0.042 -> 0.011**.
 * The allocations are the half that matters more on a phone, where the collector is what stutters.
 *
 * **This lesson was already in the project and was applied in one place.** The rail shooter's ship
 * shadow is a generated blob texture, with `fillEllipse`'s per-frame tessellation given as the
 * reason; the runner's three shadow pools never got it. Same class as the reset/restore lists and
 * the two depth origins — a rule obeyed where it was written and nowhere else.
 *
 * **The shape is unchanged and the shape is load-bearing.** `shadows.ts` reserves the hard-edged
 * ellipse for shadows and the soft irregular patch for `decals.ts`, because shadows lying near
 * decals were reported as shadows lying nowhere near their objects. So this is a *hard* ellipse
 * with one pixel of coverage antialiasing at its rim and nothing else — not the soft radial falloff
 * `scrimTexture.ts` and `shieldArt.ts` draw.
 *
 * **Black, and paired with `BlendModes.MULTIPLY` at the call site**, which is exactly what the
 * `Ellipse` was: premultiplied black at alpha `a` under a multiply blend leaves the ground at
 * `1 - a` of itself, and the fully transparent pixels outside the rim leave it untouched. Nothing
 * about what reaches the screen changed — only what it costs to ask for it.
 */
export const SHADOW_TEXTURE = 'run-shadow'

/**
 * The texture's own size, in pixels.
 *
 * Square, and stretched to whatever `width x height` the caller asks for — a shadow's aspect comes
 * from `SHADOW_FOOTPRINT` and from how high its owner is, so baking one in would be baking in a
 * height. 128 is comfortably over the widest a shadow is ever drawn (measured at ~150px across on a
 * desktop frame, and the stretch is along the axis a shadow is *shortest* on), so the rim stays a
 * rim rather than becoming a ramp.
 */
const SIZE = 128

/** Builds the shadow texture if it does not exist yet. Idempotent, like every other art factory. */
export function ensureShadowTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(SHADOW_TEXTURE)) return

  const canvasTexture = scene.textures.createCanvas(SHADOW_TEXTURE, SIZE, SIZE)

  if (!canvasTexture) return

  const context = canvasTexture.context
  const centre = SIZE / 2

  context.clearRect(0, 0, SIZE, SIZE)
  context.fillStyle = '#000000'
  context.beginPath()
  // Half a pixel in, so the rim's own antialiasing lands inside the canvas rather than being
  // clipped flat by it — a clipped edge is a straight line on a shape whose whole identity is that
  // it has none.
  context.ellipse(centre, centre, centre - 0.5, centre - 0.5, 0, 0, Math.PI * 2)
  context.fill()
  canvasTexture.refresh()
}

/**
 * Makes one pooled shadow, ready to be positioned and sized by its owner's slot.
 *
 * A factory rather than three copies of the same four calls: the blend mode and the origin are the
 * two things that make an `Image` behave as the `Ellipse` did, and a pool that forgot either would
 * draw a black box or a mark hanging off its own centre.
 */
export function createShadow(scene: Phaser.Scene): Phaser.GameObjects.Image {
  ensureShadowTexture(scene)

  return scene.add
    .image(0, 0, SHADOW_TEXTURE)
    .setBlendMode(Phaser.BlendModes.MULTIPLY)
    .setVisible(false)
}
