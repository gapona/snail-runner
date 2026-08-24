/**
 * The three obstacle silhouettes, generated per theme.
 *
 * **This module is also a named seam.** `road/applyTheme.ts` tears down and regenerates every
 * texture whose pixels are a function of the theme, and it has to be handed *the list*. The rail
 * shooter pointed it at `enemyArt.ts`; that back-reference from the untouchable `src/road/` layer
 * into the genre layer is the one thing about the fork that could not simply be deleted, so the
 * seam kept its shape and this is what stands behind it now.
 *
 * **These are aimed at the scenery's measured tone, and the snail is aimed away from it.** Run
 * `node scripts/measure-art.mjs` and the 49 verge props come back at lightness 111, saturation 5%,
 * ink 34%. An obstacle has to belong to that picture — it is a rock or a fallen tree, not a
 * hazard marker — so the palettes below are muted and heavily inked to land in the same place. What
 * separates an obstacle from the verge is not tone: it is that it stands *on the asphalt*, which is
 * flat grey, and that the one thing which does jump out of the frame is the snail.
 *
 * **Silhouette carries the read; colour is a second cue.** `verify:obstacles` measures how big each
 * class is `REACTION_MS` before impact — 9px for a low rock, 27px for a boulder, 23px for a branch
 * on a landscape phone — and that margin is only worth anything if the shapes differ in *outline*:
 *
 * - **low** — a wide, flat cluster of lumps. All mass at the bottom, nothing above the waist.
 * - **blocking** — a tall standing slab with a straight vertical face. Reads as a wall.
 * - **overhead** — a bar hanging in the air with **empty road drawn under it**. The gap is the
 *   whole message, and it is the one silhouette with daylight at its bottom edge.
 *
 * Same swap rule as everything else generated here: **if the key already exists, nothing is
 * drawn**, so dropping real art in under these keys is the entire change.
 */
import type * as Phaser from 'phaser'
import { getRoadTheme } from '../road/themes'
import { OBSTACLE_BANDS, type ObstacleKind } from './constants'
import { INK, OBSTACLE_MATERIALS } from './artPalette'

/**
 * How many shape variants each class is drawn in.
 *
 * **`low` has three because a wall is made of nothing else.** `obstacles.ts` lays low rocks edge to
 * edge to build the one row a jump is required for, and with a single texture that came out as a
 * picket fence — the same triangular lump repeated fourteen times across the road, which reads as
 * tiling rather than as rubble. Three silhouettes and a horizontal flip give six distinct rocks,
 * which is enough that no two neighbours match.
 *
 * `blocking` gets two because two of them occasionally share a row; an `overhead` spans the whole
 * road on its own and never has a neighbour to match.
 */
export const OBSTACLE_VARIANTS: Record<ObstacleKind, number> = { low: 3, blocking: 2, overhead: 1 }

/**
 * The texture key for one obstacle.
 *
 * `seed` is the obstacle's own id, so a rock keeps its shape for as long as it exists rather than
 * changing as the pool reassigns slots — the same reason `RoadSprites` derives scenery variation
 * from the coordinate instead of rolling it per frame.
 */
export function obstacleTextureKey(kind: ObstacleKind, seed: number): string {
  const variants = OBSTACLE_VARIANTS[kind]

  return `obstacle-${kind}-${((seed % variants) + variants) % variants}`
}

/**
 * The drawing canvas for each class, in pixels.
 *
 * **Not a size in the game** — `ObstacleSprites` scales every one of these to the world box the
 * obstacle actually occupies, exactly as `PlayerView` does for the snail. What has to be right here
 * is the *aspect*, so the scaling never distorts: each is 256 wide by whatever its band's height
 * comes to at the same units-per-pixel.
 */
const CANVAS_WIDTH = 256

function canvasFor(kind: ObstacleKind): { width: number; height: number } {
  const band = OBSTACLE_BANDS[kind]
  // The placer varies each obstacle's width, so the canvas uses the middle of that range and lets
  // the scale do the rest. What matters is that a class's own aspect is stable.
  const worldWidth = 0.17 * 2 * 2000
  const worldHeight = band.yHigh - band.yLow

  return { width: CANVAS_WIDTH, height: Math.max(24, Math.round((CANVAS_WIDTH * worldHeight) / worldWidth)) }
}

export const OBSTACLE_CANVAS: Record<ObstacleKind, { width: number; height: number }> = {
  low: canvasFor('low'),
  blocking: canvasFor('blocking'),
  overhead: canvasFor('overhead'),
}

/**
 * Ink weight, as a fraction of the canvas's **geometric mean**, not of its width.
 *
 * **⚠ A fraction of width is wrong the moment two canvases have different aspects.** The three
 * classes are 256px wide but 56, 162 and 139 tall, so a width-derived outline put a 5.6px ring on a
 * 56px-tall rock — a sixth of its height. Measured: the low cluster came back at 60% ink against
 * the scenery's 34%, i.e. mostly outline. The geometric mean tracks the shape's actual size, and
 * gives 2.6px, 4.5px and 4.2px — proportionate on all three.
 *
 * Heavier than the snail's 1.6% because these are read at a third of its size and against a road
 * rather than against sky.
 */
const INK_WEIGHT = 0.022

/** Every obstacle texture key, across every variant. */
export const OBSTACLE_TEXTURE_KEYS: readonly string[] = (
  Object.keys(OBSTACLE_VARIANTS) as ObstacleKind[]
).flatMap((kind) => Array.from({ length: OBSTACLE_VARIANTS[kind] }, (_, i) => obstacleTextureKey(kind, i)))

/** Which of the keys above this module drew itself, as opposed to the loader having filled them. */
const generated = new Set<string>()

/**
 * Keys this module actually generated, for `applyTheme` to remove before regenerating.
 *
 * **Only generated keys, never every declared key** — the rule inherited from `decor.ts`: a slot
 * showing *loaded* art has nothing to regenerate from, so removing it would blank that slot for
 * the rest of the session. Art-backed obstacles are themed by tint at draw time instead.
 */
export function generatedObstacleKeys(): readonly string[] {
  return OBSTACLE_TEXTURE_KEYS.filter((key) => generated.has(key))
}

type Scale = (f: number) => number

interface Palette {
  light: number
  mid: number
  dark: number
  ink: number
  weight: number
}

/**
 * Draws whatever obstacle art the current theme needs and is missing.
 *
 * Idempotent: a key that already exists is left alone, which is what lets `applyTheme` call this
 * unconditionally after removing the previous theme's set.
 */
export function createObstacleTextures(scene: Phaser.Scene): void {
  const tint = getRoadTheme().decorTint

  for (const kind of Object.keys(OBSTACLE_VARIANTS) as ObstacleKind[]) {
    for (let variant = 0; variant < OBSTACLE_VARIANTS[kind]; variant++) {
      const key = obstacleTextureKey(kind, variant)

      if (scene.textures.exists(key)) continue

      const { width, height } = OBSTACLE_CANVAS[kind]
      const g = scene.make.graphics({ x: 0, y: 0 }, false)
      const material = OBSTACLE_MATERIALS[kind]
      const palette: Palette = {
        light: multiply(material.light, tint),
        mid: multiply(material.mid, tint),
        dark: multiply(material.dark, tint),
        ink: multiply(INK, tint),
        weight: Math.max(1.5, Math.sqrt(width * height) * INK_WEIGHT),
      }
      const w: Scale = (f) => width * f
      const h: Scale = (f) => height * f

      if (kind === 'low') drawLow(g, w, h, palette, variant)
      else if (kind === 'blocking') drawBlocking(g, w, h, palette, variant)
      else drawOverhead(g, w, h, palette)

      g.generateTexture(key, width, height)
      g.destroy()
      generated.add(key)
    }
  }
}

/** Fills a closed polygon and inks its outline. The shape language of the whole file. */
function shape(g: Phaser.GameObjects.Graphics, points: number[][], fill: number, palette: Palette): void {
  const trace = (): void => {
    g.beginPath()
    g.moveTo(points[0][0], points[0][1])
    for (const [x, y] of points.slice(1)) g.lineTo(x, y)
    g.closePath()
  }

  g.fillStyle(fill, 1)
  trace()
  g.fillPath()
  g.lineStyle(palette.weight, palette.ink, 1)
  trace()
  g.strokePath()
}

/**
 * A cluster of low lumps: all mass at the bottom, nothing above the waist. Jump it.
 *
 * Three overlapping rocks rather than one, because a single wedge reads as a ramp — something you
 * would drive *up* — and three lumps read as rubble, which is something you go over.
 *
 * **The three variants exist because a wall is made of nothing but these.** With one silhouette,
 * the jump-only row came out as the same triangular lump repeated across the whole road: a picket
 * fence, not rubble. The variants differ in where the mass sits — centre-heavy, left-heavy,
 * right-heavy — which is the difference that survives being 9px tall, unlike differences in detail.
 */
function drawLow(g: Phaser.GameObjects.Graphics, w: Scale, h: Scale, palette: Palette, variant: number): void {
  // Peak heights per lump, per variant. Everything else about the shape follows from these.
  const peaks = [
    [0.28, 0.06, 0.34],
    [0.1, 0.3, 0.46],
    [0.44, 0.24, 0.12],
  ][variant % 3]

  const lump = (from: number, to: number, peak: number, fill: number): void => {
    const mid = (from + to) / 2

    shape(
      g,
      [
        [w(from), h(1.0)],
        [w(from + 0.02), h(peak + 0.34)],
        [w(mid - 0.06), h(peak + 0.06)],
        [w(mid + 0.05), h(peak)],
        [w(to - 0.02), h(peak + 0.3)],
        [w(to), h(1.0)],
      ],
      fill,
      palette,
    )
    // The shaded half, cut down the middle. **This is where most of the ink comes from** — an
    // outline alone measured 18% against the scenery's 34%, and a rock lit from one side is what
    // the verge's own props look like.
    shape(
      g,
      [
        [w(to - 0.11), h(1.0)],
        [w(mid + 0.05), h(peak + 0.08)],
        [w(to - 0.02), h(peak + 0.3)],
        [w(to), h(1.0)],
      ],
      palette.dark,
      palette,
    )
  }

  // Flanks first, so the centre lump overlaps them and the cluster reads as having a front.
  lump(0.0, 0.38, peaks[0], palette.mid)
  lump(0.62, 1.0, peaks[2], palette.mid)
  lump(0.26, 0.76, peaks[1], palette.light)
}

/**
 * A standing slab with a straight vertical face. Reads as a wall; go around it.
 *
 * The vertical face is the whole silhouette — a boulder with a rounded top would read as a big
 * version of the low cluster, and those two must never be confused at 27px because one is jumpable
 * and the other is not.
 *
 * **Three vertical planes, not a gradient.** A lit face, a mid face and a shadow face meeting at
 * hard edges is what makes it read as stone with corners; it is also what carries the ink share,
 * since the shadow plane is dark enough to count as ink on its own.
 */
function drawBlocking(g: Phaser.GameObjects.Graphics, w: Scale, h: Scale, palette: Palette, variant: number): void {
  // The two variants lean opposite ways. A row holding both then has no repeated silhouette in it.
  const lean = variant % 2 === 0 ? 1 : -1
  const at = (x: number) => (lean > 0 ? x : 1 - x)
  const top = (x: number) => h(0.02 + Math.abs(at(x) - 0.4) * 0.18)

  shape(
    g,
    [
      [w(at(0.12)), h(1.0)],
      [w(at(0.08)), h(0.22)],
      [w(at(0.4)), h(0.02)],
      [w(at(0.9)), h(0.14)],
      [w(at(0.88)), h(1.0)],
    ],
    palette.mid,
    palette,
  )
  // The lit face.
  shape(
    g,
    [
      [w(at(0.12)), h(1.0)],
      [w(at(0.08)), h(0.22)],
      [w(at(0.4)), h(0.02)],
      [w(at(0.44)), h(0.16)],
      [w(at(0.42)), h(1.0)],
    ],
    palette.light,
    palette,
  )
  // The shadow face, taking the far third.
  shape(
    g,
    [
      [w(at(0.68)), h(1.0)],
      [w(at(0.7)), h(0.1)],
      [w(at(0.9)), h(0.14)],
      [w(at(0.88)), h(1.0)],
    ],
    palette.dark,
    palette,
  )
  // One fracture line down the mid face — enough to say "tall", which is the one thing this
  // silhouette must communicate that the low cluster does not.
  g.lineStyle(Math.max(1.5, palette.weight * 0.5), palette.ink, 0.45)
  g.beginPath()
  g.moveTo(w(at(0.56)), top(0.56))
  g.lineTo(w(at(0.52)), h(0.96))
  g.strokePath()
}

/**
 * A fallen trunk wedged in the air.
 *
 * **The empty space under it is the drawing.** The canvas spans the obstacle's own band, which
 * starts at 250 world units — well above the snail's back — so the sprite is positioned with that
 * gap already accounted for and what the player sees is a mass with daylight beneath it. It is the
 * only silhouette in the game with nothing touching the ground, and that is exactly the read: duck.
 */
function drawOverhead(g: Phaser.GameObjects.Graphics, w: Scale, h: Scale, palette: Palette): void {
  const top = h(0.34)
  const bottom = h(0.82)

  // The two props holding it up, drawn first and darker so the trunk reads in front of them. They
  // stop well short of the bottom edge — the gap under the trunk is the message.
  for (const x of [0.16, 0.82]) {
    shape(
      g,
      [
        [w(x - 0.05), h(0.86)],
        [w(x - 0.03), top],
        [w(x + 0.03), top],
        [w(x + 0.05), h(0.86)],
      ],
      palette.mid,
      palette,
    )
  }

  // The trunk: a long horizontal mass with slightly uneven ends, so it reads as a fallen tree
  // rather than as a fabricated bar.
  shape(
    g,
    [
      [w(0.0), h(0.46)],
      [w(0.08), top],
      [w(0.9), h(0.3)],
      [w(1.0), h(0.5)],
      [w(0.96), bottom],
      [w(0.08), h(0.86)],
    ],
    palette.mid,
    palette,
  )
  // The lit upper surface.
  shape(
    g,
    [
      [w(0.04), h(0.44)],
      [w(0.09), h(0.36)],
      [w(0.9), h(0.32)],
      [w(0.97), h(0.48)],
      [w(0.9), h(0.5)],
      [w(0.09), h(0.54)],
    ],
    palette.light,
    palette,
  )

  // The underside, in shadow across the trunk's whole width. It is what a thing hanging over you
  // actually looks like, and it is most of this silhouette's ink.
  shape(
    g,
    [
      [w(0.06), h(0.74)],
      [w(0.95), h(0.72)],
      [w(0.96), bottom],
      [w(0.08), h(0.86)],
    ],
    palette.dark,
    palette,
  )

  // Broken stubs along that underside — the clearest "there is a ceiling here" cue, and what keeps
  // the trunk from reading as a distant horizontal wall.
  g.fillStyle(palette.dark, 1)
  for (let i = 0; i < 4; i++) {
    const x = w(0.22 + i * 0.19)

    g.fillTriangle(x - w(0.035), bottom - h(0.04), x + w(0.035), bottom - h(0.04), x - w(0.01), bottom + h(0.16))
  }

  // Bark: three long strokes, low contrast, only visible when the trunk is close.
  g.lineStyle(Math.max(1.5, palette.weight * 0.55), palette.ink, 0.35)
  for (const y of [0.42, 0.56, 0.7]) {
    g.beginPath()
    g.moveTo(w(0.1), h(y))
    g.lineTo(w(0.92), h(y - 0.02))
    g.strokePath()
  }
}

/** Channel-wise multiply, the same operation `road/color.ts` does for scenery tints. */
function multiply(color: number, tint: number): number {
  const r = (((color >> 16) & 0xff) * ((tint >> 16) & 0xff)) / 255
  const g = (((color >> 8) & 0xff) * ((tint >> 8) & 0xff)) / 255
  const b = ((color & 0xff) * (tint & 0xff)) / 255

  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b)
}
