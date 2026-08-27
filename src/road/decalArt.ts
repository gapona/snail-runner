import * as Phaser from 'phaser'
import { createRng } from '../race/rng'
import { DECAL_KINDS, DECAL_ROW_ALPHAS } from './decals'

export const DECAL_ATLAS_KEY = 'road-decals'

/**
 * One cell per kind across, one row per opacity down — see `DECAL_ROW_ALPHAS`.
 *
 * So the atlas is `CELL * kinds` wide and `CELL * rows` tall, and a quad picks both which mark it
 * is and how strongly it is drawn out of its own UVs. That is the road palette's trick applied to
 * a second problem: a `Mesh2D` has one object-wide tint and no per-vertex colour, so anything that
 * has to vary per quad has to vary through the texture.
 */
export const DECAL_CELL = 128

/**
 * A margin of empty pixels inside every cell.
 *
 * **Not optional.** The atlas is sampled with linear filtering, so a mark drawn to the edge of its
 * cell bleeds into the neighbouring one along the seam — which on a mesh that stretches a cell
 * across a whole trapezoid is a stripe of the wrong decal down one side of every mark. Costs a few
 * pixels of resolution and removes a class of artefact that is very hard to recognise for what it
 * is once it is on screen.
 */
const CELL_PADDING = 6

/** Fixed, so the same marks are drawn every session and a screenshot can be compared with one. */
const DECAL_SEED = 20887

/**
 * The four ground marks, drawn once into one atlas.
 *
 * **Greyscale with the shape in the alpha, and black underneath.** The mesh draws them with a
 * multiply blend, so a pixel's alpha is how much light it takes *out* of whatever ground it lies
 * on: alpha 0 leaves the ground exactly as it was, and the mark takes the biome's own colour for
 * free. That is what makes one texture serve nine biomes and seven themes without a palette, a
 * per-biome variant, or the object-wide tint a `Mesh2D` is limited to.
 *
 * **Procedural rather than generated art, and it costs zero bytes.** These are stains and cracks —
 * noise with a shape, which is what a canvas is good at and what a diffusion model would be an odd
 * choice for. The whole 400KB the plan budgets for this stays unspent.
 *
 * Idempotent like every other texture factory here: the texture manager is game-scoped and
 * outlives a scene, so a restart reuses rather than redraws.
 */
export function createDecalAtlas(scene: Phaser.Scene): string {
  if (scene.textures.exists(DECAL_ATLAS_KEY)) return DECAL_ATLAS_KEY

  const width = DECAL_CELL * DECAL_KINDS.length
  const height = DECAL_CELL * DECAL_ROW_ALPHAS.length
  const canvasTexture = scene.textures.createCanvas(DECAL_ATLAS_KEY, width, height)

  if (!canvasTexture) throw new Error(`createDecalAtlas: could not create canvas texture "${DECAL_ATLAS_KEY}"`)

  const context = canvasTexture.context

  context.clearRect(0, 0, width, height)

  for (const [row, alpha] of DECAL_ROW_ALPHAS.entries()) {
    for (const [index, kind] of DECAL_KINDS.entries()) {
      // **The same seed per row, so the rows are the same mark at different strengths** rather than
      // different marks that happen to share a name. A decal changing shape as it faded into the
      // distance would read as the ground crawling.
      const rng = createRng(DECAL_SEED + index)
      const inner = DECAL_CELL - CELL_PADDING * 2

      context.save()
      context.globalAlpha = alpha
      context.translate(index * DECAL_CELL + CELL_PADDING, row * DECAL_CELL + CELL_PADDING)

      if (kind === 'stain') drawStain(context, inner, rng)
      else if (kind === 'crack') drawCrack(context, inner, rng)
      else if (kind === 'skid') drawSkid(context, inner, rng)
      else if (kind === 'stones') drawStones(context, inner, rng)
      else if (kind === 'tuft') drawTuft(context, inner, rng)
      else if (kind === 'puddle') drawPuddle(context, inner, rng)
      else drawScatter(context, inner, rng)

      context.restore()
    }
  }

  canvasTexture.refresh()

  return DECAL_ATLAS_KEY
}

/** A soft patch: overlapping radial blobs, densest in the middle, ragged at the edge. */
function drawStain(context: CanvasRenderingContext2D, size: number, rng: () => number): void {
  for (let i = 0; i < 14; i++) {
    const radius = size * (0.12 + rng() * 0.22)
    const x = size * (0.5 + (rng() - 0.5) * 0.5)
    const y = size * (0.5 + (rng() - 0.5) * 0.5)
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius)

    // A hard-edged blob reads as a decal cut out of paper; the falloff is what makes it a stain.
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0.34)')
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)')
    context.fillStyle = gradient
    context.beginPath()
    context.arc(x, y, radius, 0, Math.PI * 2)
    context.fill()
  }
}

/** A branching split, drawn as strokes that thin as they fork. */
function drawCrack(context: CanvasRenderingContext2D, size: number, rng: () => number): void {
  context.lineCap = 'round'

  const walk = (x: number, y: number, angle: number, length: number, width: number, depth: number): void => {
    if (depth > 3 || length < size * 0.05) return

    const steps = 4
    let cx = x
    let cy = y

    context.strokeStyle = `rgba(0, 0, 0, ${(0.5 - depth * 0.09).toFixed(2)})`
    context.lineWidth = width
    context.beginPath()
    context.moveTo(cx, cy)

    let heading = angle

    for (let i = 0; i < steps; i++) {
      // Wandering rather than straight: a crack that runs true reads as a drawn line.
      heading += (rng() - 0.5) * 0.7
      cx += Math.cos(heading) * (length / steps)
      cy += Math.sin(heading) * (length / steps)
      context.lineTo(cx, cy)
    }
    context.stroke()

    if (rng() < 0.8) walk(cx, cy, heading + 0.6 + rng() * 0.5, length * 0.6, width * 0.6, depth + 1)
    if (rng() < 0.8) walk(cx, cy, heading - 0.6 - rng() * 0.5, length * 0.6, width * 0.6, depth + 1)
  }

  walk(size * 0.5, size * 0.06, Math.PI / 2, size * 0.5, Math.max(2, size * 0.035), 0)
}

/** Two parallel streaks, tapered at both ends — a mark something left behind it. */
function drawSkid(context: CanvasRenderingContext2D, size: number, rng: () => number): void {
  for (const lane of [0.34, 0.62]) {
    const x = size * (lane + (rng() - 0.5) * 0.05)
    const width = size * (0.1 + rng() * 0.05)
    const gradient = context.createLinearGradient(0, 0, 0, size)

    // Fading at both ends rather than stopping: a streak with square ends is a rectangle.
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0)')
    gradient.addColorStop(0.35, 'rgba(0, 0, 0, 0.46)')
    gradient.addColorStop(0.7, 'rgba(0, 0, 0, 0.4)')
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)')
    context.fillStyle = gradient
    context.fillRect(x - width / 2, 0, width, size)
  }
}

/** A handful of small stones, which is the one mark in the set with holes in it. */
function drawScatter(context: CanvasRenderingContext2D, size: number, rng: () => number): void {
  for (let i = 0; i < 22; i++) {
    const radius = size * (0.015 + rng() * 0.035)
    const x = size * (0.1 + rng() * 0.8)
    const y = size * (0.1 + rng() * 0.8)

    context.fillStyle = `rgba(0, 0, 0, ${(0.28 + rng() * 0.3).toFixed(2)})`
    context.beginPath()
    context.ellipse(x, y, radius * (0.8 + rng() * 0.6), radius, rng() * Math.PI, 0, Math.PI * 2)
    context.fill()
  }
}

/**
 * Loose stones: a few chunky blobs with a lighter crown, not the even sprinkle `scatter` is.
 *
 * **The crown is what makes it a stone rather than a hole.** These are drawn with a multiply
 * blend, so everything here removes light; a solid dark ellipse is a mark in the ground. Lifting
 * the alpha to near nothing across the upper part of each blob leaves the ground showing through
 * where a lit face would be, and the eye reads the pair as an object sitting on the surface.
 */
function drawStones(context: CanvasRenderingContext2D, size: number, rng: () => number): void {
  for (let i = 0; i < 7; i++) {
    const radius = size * (0.06 + rng() * 0.09)
    const x = size * (0.12 + rng() * 0.76)
    const y = size * (0.15 + rng() * 0.7)
    const tilt = rng() * Math.PI

    context.fillStyle = `rgba(0, 0, 0, ${(0.45 + rng() * 0.3).toFixed(2)})`
    context.beginPath()
    context.ellipse(x, y, radius * (1 + rng() * 0.5), radius, tilt, 0, Math.PI * 2)
    context.fill()

    // The lit face: drawn back out of the mark rather than added over it, since a multiply blend
    // has no way to put light back.
    context.save()
    context.globalCompositeOperation = 'destination-out'
    context.fillStyle = 'rgba(0, 0, 0, 0.75)'
    context.beginPath()
    context.ellipse(x, y - radius * 0.34, radius * 0.72, radius * 0.42, tilt, 0, Math.PI * 2)
    context.fill()
    context.restore()
  }
}

/**
 * A tuft of growth: blades from a common root, thinning as they rise.
 *
 * Drawn as tapering strokes rather than filled shapes -- a blade is a line, and the taper is what
 * keeps it from reading as a crack, which is the one other mark in the set made of thin dark
 * strokes. Cracks branch and wander; these all leave one point and stay straight.
 */
function drawTuft(context: CanvasRenderingContext2D, size: number, rng: () => number): void {
  for (let clump = 0; clump < 3; clump++) {
    const rootX = size * (0.2 + rng() * 0.6)
    const rootY = size * (0.62 + rng() * 0.3)

    for (let blade = 0; blade < 7; blade++) {
      const lean = (rng() - 0.5) * size * 0.3
      const height = size * (0.16 + rng() * 0.2)

      context.strokeStyle = `rgba(0, 0, 0, ${(0.4 + rng() * 0.35).toFixed(2)})`
      context.lineWidth = size * (0.012 + rng() * 0.014)
      context.lineCap = 'round'
      context.beginPath()
      context.moveTo(rootX, rootY)
      context.quadraticCurveTo(rootX + lean * 0.4, rootY - height * 0.6, rootX + lean, rootY - height)
      context.stroke()
    }
  }
}

/**
 * Standing water: one soft body with a bright rim.
 *
 * **The rim is the whole read, and it is subtractive like the stone's crown.** Water is darker
 * than the ground it lies in and its edge catches the sky; with only the dark body this is a
 * stain, which is already in the set. Taking the alpha back out around the perimeter is what
 * separates the two.
 */
function drawPuddle(context: CanvasRenderingContext2D, size: number, rng: () => number): void {
  const cx = size * 0.5
  const cy = size * 0.5
  const rx = size * (0.26 + rng() * 0.12)
  const ry = size * (0.17 + rng() * 0.1)

  context.fillStyle = 'rgba(0, 0, 0, 0.62)'
  context.beginPath()
  // A lobed outline rather than an ellipse: standing water takes the shape of the ground under
  // it, and a perfect ellipse reads as a printed dot.
  for (let step = 0; step <= 28; step++) {
    const angle = (step / 28) * Math.PI * 2
    const wobble = 0.82 + Math.sin(angle * 3 + rng() * 0.01) * 0.12 + rng() * 0.06
    const x = cx + Math.cos(angle) * rx * wobble
    const y = cy + Math.sin(angle) * ry * wobble

    if (step === 0) context.moveTo(x, y)
    else context.lineTo(x, y)
  }
  context.closePath()
  context.fill()

  context.save()
  context.globalCompositeOperation = 'destination-out'
  context.strokeStyle = 'rgba(0, 0, 0, 0.8)'
  context.lineWidth = size * 0.022
  context.beginPath()
  context.ellipse(cx, cy, rx * 0.78, ry * 0.74, 0, 0, Math.PI * 2)
  context.stroke()
  context.restore()
}

/**
 * The UV rectangle of one atlas cell, as `u0, u1`.
 *
 * The cell's own padding is included deliberately: the mark was drawn inside it, so sampling the
 * whole cell is what puts the empty margin around the mark rather than cropping it away.
 */
export function decalCellU(kindIndex: number): { u0: number; u1: number } {
  const cells = DECAL_KINDS.length

  return { u0: kindIndex / cells, u1: (kindIndex + 1) / cells }
}

/** The V rectangle of one strength row, as `v0, v1`. */
export function decalCellV(row: number): { v0: number; v1: number } {
  const rows = DECAL_ROW_ALPHAS.length

  return { v0: row / rows, v1: (row + 1) / rows }
}
