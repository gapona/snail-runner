import * as Phaser from 'phaser'
import { createRng } from '../race/rng'
import { MOTE_SHAPES, type MoteShape } from './particles'

/** One texture per shape, keyed `mote-<shape>`. */
export function moteTextureKey(shape: MoteShape): string {
  return `mote-${shape}`
}

/** Drawn at the size a mote is largest on screen, so it is never scaled up past its own pixels. */
export const MOTE_TEXTURE_SIZE = 32

/** Fixed, so the same motes are drawn every session. */
const MOTE_SEED = 5501

/**
 * The four motes, drawn white so the biome's own tint decides their colour.
 *
 * **White and procedural, for the same two reasons everything else generated here is.** White,
 * because a tint multiplies — a mote drawn in any colour of its own would be that colour times the
 * biome's, and nine biomes would need nine textures. Procedural, because these are a dot, a
 * six-sided flake, a smear and a four-point star at 32 pixels: shapes a canvas draws exactly and a
 * diffusion model would draw approximately, for a file each.
 *
 * Idempotent like every other texture factory here — the texture manager is game-scoped and
 * outlives a scene, so a restart reuses rather than redraws.
 */
export function createMoteTextures(scene: Phaser.Scene): void {
  for (const shape of MOTE_SHAPES) {
    const key = moteTextureKey(shape)

    if (scene.textures.exists(key)) continue

    const canvasTexture = scene.textures.createCanvas(key, MOTE_TEXTURE_SIZE, MOTE_TEXTURE_SIZE)

    if (!canvasTexture) throw new Error(`createMoteTextures: could not create canvas texture "${key}"`)

    const context = canvasTexture.context
    const size = MOTE_TEXTURE_SIZE

    context.clearRect(0, 0, size, size)

    if (shape === 'speck') drawSpeck(context, size)
    else if (shape === 'flake') drawFlake(context, size)
    else if (shape === 'mote') drawMote(context, size)
    else drawGlint(context, size)

    canvasTexture.refresh()
  }
}

/** A soft round dot. The falloff is what stops it reading as a pixel stuck to the screen. */
function drawSpeck(context: CanvasRenderingContext2D, size: number): void {
  const half = size / 2
  const gradient = context.createRadialGradient(half, half, 0, half, half, half)

  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)')
  gradient.addColorStop(0.45, 'rgba(255, 255, 255, 0.55)')
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, size, size)
}

/** Six arms from a centre: the one shape in the set that reads as *falling* rather than hanging. */
function drawFlake(context: CanvasRenderingContext2D, size: number): void {
  const half = size / 2

  context.strokeStyle = 'rgba(255, 255, 255, 0.9)'
  context.lineWidth = Math.max(1, size * 0.07)
  context.lineCap = 'round'

  for (let arm = 0; arm < 6; arm++) {
    const angle = (arm / 6) * Math.PI * 2

    context.beginPath()
    context.moveTo(half, half)
    context.lineTo(half + Math.cos(angle) * half * 0.82, half + Math.sin(angle) * half * 0.82)
    context.stroke()
  }
}

/** A short smear, leaning: something being carried rather than something drifting. */
function drawMote(context: CanvasRenderingContext2D, size: number): void {
  const half = size / 2

  context.save()
  context.translate(half, half)
  context.rotate(-0.5)

  const gradient = context.createLinearGradient(-half, 0, half, 0)

  gradient.addColorStop(0, 'rgba(255, 255, 255, 0)')
  gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.95)')
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)')
  context.fillStyle = gradient
  context.beginPath()
  context.ellipse(0, 0, half * 0.9, size * 0.09, 0, 0, Math.PI * 2)
  context.fill()
  context.restore()
}

/** A four-point star, with a few sparks around it so a crystal field is not four identical ones. */
function drawGlint(context: CanvasRenderingContext2D, size: number): void {
  const half = size / 2
  const rng = createRng(MOTE_SEED)

  context.fillStyle = 'rgba(255, 255, 255, 0.95)'
  context.beginPath()
  context.moveTo(half, 0)
  context.lineTo(half + size * 0.09, half - size * 0.09)
  context.lineTo(size, half)
  context.lineTo(half + size * 0.09, half + size * 0.09)
  context.lineTo(half, size)
  context.lineTo(half - size * 0.09, half + size * 0.09)
  context.lineTo(0, half)
  context.lineTo(half - size * 0.09, half - size * 0.09)
  context.closePath()
  context.fill()

  for (let i = 0; i < 3; i++) {
    context.fillStyle = `rgba(255, 255, 255, ${(0.3 + rng() * 0.3).toFixed(2)})`
    context.beginPath()
    context.arc(size * (0.2 + rng() * 0.6), size * (0.2 + rng() * 0.6), size * 0.03, 0, Math.PI * 2)
    context.fill()
  }
}
