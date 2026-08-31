import * as Phaser from 'phaser'

/**
 * The shield bubble's ring, generated once at boot.
 *
 * **Zero bytes, like every other generated texture here**, and white so `setTint` can paint it —
 * a tint multiplies, and multiplying into a coloured texture gives a colour neither of them is.
 * That is the same rule `ui/scrimTexture.ts` follows and for the same reason.
 *
 * **⚠ Transparent through the middle, which is the whole design.** A filled disc over the mascot is
 * a wash, and an additive wash takes *saturation* out of what is under it — the exact cost
 * `FEVER_WASH_ALPHA` was pulled back for, on the one object in this game allowed to be saturated.
 * A ring leaves the snail untouched and puts the state on the air around it.
 *
 * Two stops close together rather than one long falloff, for the sun's reason: a single ramp draws
 * a fuzzy ball with no edge, and what says "bubble" is that there *is* a surface. The inner edge is
 * softer than the outer one so the ring reads as looking *through* a shell rather than as a hoop
 * lying flat around the snail's feet.
 */
export const SHIELD_TEXTURE = 'run-shield-bubble'

const SIZE = 192
/** Where the shell sits, as fractions of the radius: clear inside, the band, and gone by the edge. */
const RING = { inner: 0.60, peak: 0.86, outer: 1.0 } as const

export function ensureShieldTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(SHIELD_TEXTURE)) return

  const canvasTexture = scene.textures.createCanvas(SHIELD_TEXTURE, SIZE, SIZE)

  if (!canvasTexture) return

  const context = canvasTexture.context
  const centre = SIZE / 2
  const gradient = context.createRadialGradient(centre, centre, 0, centre, centre, centre)

  gradient.addColorStop(0, 'rgba(255,255,255,0)')
  gradient.addColorStop(RING.inner, 'rgba(255,255,255,0)')
  // A little fill just inside the shell, so the bubble has a body and not only an outline.
  gradient.addColorStop((RING.inner + RING.peak) / 2, 'rgba(255,255,255,0.30)')
  gradient.addColorStop(RING.peak, 'rgba(255,255,255,1)')
  gradient.addColorStop(RING.outer, 'rgba(255,255,255,0)')

  context.clearRect(0, 0, SIZE, SIZE)
  context.fillStyle = gradient
  context.fillRect(0, 0, SIZE, SIZE)
  canvasTexture.refresh()
}
