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
 * - **low** — a wide, flat barrier block. All mass at the bottom, nothing above the waist.
 * - **blocking** — a tall upright panel, a near-square. Reads as a wall.
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
 * `blocking` gets two because two of them occasionally share a row.
 */
export const OBSTACLE_VARIANTS: Record<ObstacleKind, number> = { low: 3, blocking: 2 }

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

/**
 * Keys whose rendered art is pulled, and which therefore ship no PNG.
 *
 * **Empty, and the mechanism is kept rather than deleted.** It held `obstacle-overhead-0` while
 * that class existed: the render was a hollow log whose squared-off bore read as a crate with a
 * doorway, so it was pulled, and the procedural fallback that replaced it was a log floating on two
 * stubs. The class itself is gone now — see `OBSTACLE_BANDS` for why a thing drawn inside a band
 * that starts above the snail cannot be drawn touching the ground.
 *
 * `Preloader` iterates `OBSTACLE_ART_KEYS` rather than every key, so a pulled render is not a
 * 404 on every boot — a loader error is a real signal and must not be spent on a deliberate gap.
 */
const PULLED_ART = new Set<string>()

/** The keys that actually have a PNG to load. */
export const OBSTACLE_ART_KEYS: readonly string[] = OBSTACLE_TEXTURE_KEYS.filter(
  (key) => !PULLED_ART.has(key),
)

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
      else drawBlocking(g, w, h, palette, variant)

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

/** A rectangle, filled and inked. Every barrier in this file is built out of these. */
function board(
  g: Phaser.GameObjects.Graphics,
  w: Scale,
  h: Scale,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  fill: number,
  palette: Palette,
): void {
  shape(g, [[w(x0), h(y0)], [w(x1), h(y0)], [w(x1), h(y1)], [w(x0), h(y1)]], fill, palette)
}

/**
 * A low barrier block: solid, flat-topped, hop it.
 *
 * **⚠ This was a cluster of three rocks, and the whole family it belonged to is gone.** The three
 * classes used to be a rubble pile, a leaning slab and a fallen trunk — three natural objects with
 * no vocabulary between them, standing on a made road, which is what was reported. They are one
 * made object at three heights now; see `dev-assets/cc0-3d/barrier_render.py`, which builds the
 * shipped renders, for the argument. This is that object flattened to two dimensions.
 *
 * The lit strip along the top is the whole of the shading and it is not decoration: it is the only
 * thing that says the block has a top face rather than being a painted rectangle on the road, and
 * it is the part that survives being 9px tall.
 *
 * **The three variants differ in the FACE and never in the height.** `drawWall` lays these edge to
 * edge to build the one row a jump is required for, and a wall is read from its top edge — blocks
 * at three heights are a fence with gaps in it, which invites trying to get *through* the row.
 */
function drawLow(g: Phaser.GameObjects.Graphics, w: Scale, h: Scale, palette: Palette, variant: number): void {
  const cap = 0.3

  if (variant === 1) {
    // Two courses, the joint off centre so a pair of them does not read as a mirror.
    board(g, w, h, 0.0, 1.0, cap, 0.52, palette.mid, palette)
    board(g, w, h, 0.02, 0.98, 0.56, 1.0, palette.mid, palette)
    board(g, w, h, 0.0, 1.0, 0.0, cap, palette.light, palette)
  } else if (variant === 2) {
    // A capping stone that overhangs, which is what a kerb does and what puts a second lit edge
    // across the top of the silhouette.
    board(g, w, h, 0.05, 0.95, cap, 1.0, palette.mid, palette)
    board(g, w, h, 0.0, 1.0, 0.0, cap, palette.light, palette)
  } else {
    board(g, w, h, 0.0, 1.0, cap, 1.0, palette.mid, palette)
    board(g, w, h, 0.0, 1.0, 0.0, cap, palette.light, palette)
  }
}

/**
 * A tall barrier panel: solid, full height, go around it.
 *
 * **Solid rather than a frame with daylight in it**, which is the one thing this class may not
 * look like: it means "there is no way through", and a panel you can see between says the opposite
 * at exactly the distance the decision is taken at.
 *
 * The two variants divide the face VERTICALLY — boarded, or framed — and that is deliberate: `low`
 * is read as a horizontal band and this is read as an upright, so dividing this one the same way
 * would make the two classes the same picture at two sizes.
 */
function drawBlocking(g: Phaser.GameObjects.Graphics, w: Scale, h: Scale, palette: Palette, variant: number): void {
  board(g, w, h, 0.0, 1.0, 0.0, 1.0, palette.mid, palette)
  board(g, w, h, 0.0, 1.0, 0.0, 0.11, palette.light, palette)

  if (variant === 0) {
    // Boarded: five uprights proud of the panel.
    for (let i = 0; i < 5; i++) {
      board(g, w, h, 0.02 + i * 0.196, 0.02 + i * 0.196 + 0.156, 0.11, 0.97, palette.mid, palette)
    }
  } else {
    // Framed: two posts, a head rail, a mid rail and an upright through the middle.
    //
    // **⚠ The middle members are not decoration.** A rectangle inside a rectangle is a DOORWAY, and
    // this is the class that means there is no way through — a barred opening says the opposite of
    // the mechanic at exactly the distance the player decides at.
    board(g, w, h, 0.12, 0.88, 0.24, 0.9, palette.dark, palette)
    board(g, w, h, 0.0, 0.14, 0.0, 1.0, palette.mid, palette)
    board(g, w, h, 0.86, 1.0, 0.0, 1.0, palette.mid, palette)
    board(g, w, h, 0.0, 1.0, 0.06, 0.24, palette.mid, palette)
    board(g, w, h, 0.0, 1.0, 0.48, 0.62, palette.mid, palette)
    board(g, w, h, 0.42, 0.58, 0.24, 1.0, palette.mid, palette)
  }
}

/** Channel-wise multiply, the same operation `road/color.ts` does for scenery tints. */
function multiply(color: number, tint: number): number {
  const r = (((color >> 16) & 0xff) * ((tint >> 16) & 0xff)) / 255
  const g = (((color >> 8) & 0xff) * ((tint >> 8) & 0xff)) / 255
  const b = ((color & 0xff) * (tint & 0xff)) / 255

  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b)
}
