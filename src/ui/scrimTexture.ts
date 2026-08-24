import * as Phaser from 'phaser'

/**
 * The soft plate that goes behind text drawn over the live world.
 *
 * Shared by the menu and the combat HUD because it is the same problem in both: the background
 * is a different colour on every theme and at every point of the track, so the text needs
 * *something* under it, and that something must not read as a panel. See `ui/scrim.ts` for how
 * dark it has to be, which is solved from a measurement rather than chosen.
 *
 * **A blurred rounded rectangle rather than a radial gradient.** A radial falloff behind a line
 * of text is at full strength at one point and has faded to nothing by the ends of the word, so
 * the letters at each end sit on almost no plate — which is exactly where the measurement said
 * they needed one. A rounded rectangle holds its centre across the whole block and still has no
 * edge for the eye to read, because the edge is what the blur removes.
 *
 * `filter = 'blur()'` is a 2D-canvas feature used at boot, not a render pass: nothing here
 * depends on which renderer `Phaser.AUTO` picked, which is the rule every effect in this project
 * follows.
 */
export const SCRIM_TEXTURE = 'ui-scrim'

const SIZE = { width: 256, height: 96 } as const
const SHAPE = { inset: 22, radius: 26, blur: 18 } as const

export function ensureScrimTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(SCRIM_TEXTURE)) return

  const canvasTexture = scene.textures.createCanvas(SCRIM_TEXTURE, SIZE.width, SIZE.height)

  if (!canvasTexture) return

  const context = canvasTexture.context

  context.clearRect(0, 0, SIZE.width, SIZE.height)
  context.filter = `blur(${SHAPE.blur}px)`
  // White, so `setTint` can paint it whatever the theme's scrim colour turns out to be — a tint
  // multiplies, and multiplying into a coloured texture would give a colour neither of them is.
  context.fillStyle = '#ffffff'
  context.beginPath()
  context.roundRect(
    SHAPE.inset,
    SHAPE.inset,
    SIZE.width - SHAPE.inset * 2,
    SIZE.height - SHAPE.inset * 2,
    SHAPE.radius,
  )
  context.fill()
  context.filter = 'none'
  canvasTexture.refresh()
}
