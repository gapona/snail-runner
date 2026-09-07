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


/**
 * The run's top-bar wash: a vertical fade from opaque white to nothing, stretched across the frame.
 *
 * **White, for `SCRIM_TEXTURE`'s reason** — a tint multiplies, so the colour is the caller's and
 * only the *shape* of the fade lives here.
 *
 * **A generated gradient rather than a stack of rectangles**, which is the lesson the vignette cost
 * three rounds: a quantised fade bands, and each round that raised the band count made the metric
 * quiet without removing the mechanism. One pixel wide, because a vertical fade has no horizontal
 * structure at all and stretching one column across 1920px costs the same as stretching 256.
 *
 * The falloff is **eased rather than linear**: a linear ramp leaves a visible shoulder where it
 * reaches zero, which is the bottom edge of a box drawn by a gradient that was trying not to be one.
 */
export const TOP_WASH_TEXTURE = 'ui-top-wash'

const WASH_HEIGHT = 128

/**
 * Transparent rows under the ramp.
 *
 * **⚠ The wash drew a 1px dark line across the sky at its own bottom edge**, measured at 11
 * luminance units on a column that is clean with the wash hidden. A gradient stretched to a
 * fractional height lands its last row on a half pixel, and what the sampler reaches for past the
 * end is the row it clamps or wraps to — which for a 1x128 texture is a row that is not
 * transparent. Two rows that are *certainly* zero, plus a whole-pixel display size at the call
 * site, leave nothing there to find. Same defect and same fix as the skyline strip's own foot pad.
 */
const WASH_PAD = 2

export function ensureTopWashTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(TOP_WASH_TEXTURE)) return

  const canvasTexture = scene.textures.createCanvas(TOP_WASH_TEXTURE, 1, WASH_HEIGHT + WASH_PAD)

  if (!canvasTexture) return

  const context = canvasTexture.context

  context.clearRect(0, 0, 1, WASH_HEIGHT + WASH_PAD)

  for (let y = 0; y < WASH_HEIGHT; y++) {
    const t = y / (WASH_HEIGHT - 1)
    // `(1 - t)^2` rather than `1 - t`: it leaves the top at full strength for longer and arrives at
    // zero flat, so there is no row at which the wash visibly stops.
    const alpha = (1 - t) * (1 - t)

    context.fillStyle = `rgba(255,255,255,${alpha.toFixed(4)})`
    context.fillRect(0, y, 1, 1)
  }
  canvasTexture.refresh()
}
