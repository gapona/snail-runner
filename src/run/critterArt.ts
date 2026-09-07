/**
 * The bug, head-on, in two frames.
 *
 * **Head-on because that is the only view of it there is.** A critter runs straight down the road at
 * the camera, so the player never sees its flank — the same fact that settled the mascot's own
 * vantage after four rounds of the model drifting to profile, arriving here for free because this
 * one is drawn rather than generated.
 *
 * **Two frames, and they are the insect's real gait.** A beetle walks on an alternating tripod:
 * front and rear legs on one side move with the middle leg of the other, then the mirror. That is
 * exactly two poses, so the cheapest animation there is happens to be the correct one — and it is
 * what separates a bug from a sliding decal at the sizes this is met at. The cycle is advanced by
 * the critter's **own travel** rather than by a clock, the rule the glide cycle and the slime trail
 * are already under; unlike the snail's, its speed is constant, so the cadence is too.
 *
 * **Not themed, unlike the obstacles.** `applyTheme` regenerates every texture whose pixels are a
 * function of the light, and the mascot is deliberately not one of them: a creature keeps its own
 * colours through a change of weather. A bug is a creature, so this module stays off that seam
 * entirely — which is also what keeps `src/road/` untouched, the fork's one hard rule.
 *
 * Same swap rule as everything else generated here: **if the key already exists, nothing is drawn**,
 * so dropping real art in under these keys is the whole change.
 */
import type * as Phaser from 'phaser'
import { BEE_COLORS, CRITTER_COLORS, INK } from './artPalette'
import { CRITTER_KINDS, CRITTER_KIND_IDS, type CritterKind } from './critters'

/** The two poses of the tripod gait. */
export const CRITTER_FRAMES = 2

/**
 * How far a critter travels per frame of its cycle, in world units, per kind.
 *
 * 60 units at the beetle's walk is 9.7 poses a second — nearly five gait cycles — which is
 * scurrying rather than trudging, and a ladybird shares it. **Wings are a blur rather than a gait**,
 * so a flyer's step is a fifth of that: far past what any frame rate resolves, which is exactly
 * right, because a wingbeat the eye can count is a bird.
 *
 * The two odd ones out are the two that move unlike an insect: a spider's step is shorter because it
 * scuttles, and a frog's is much longer because it lollops. The only thing any of them can be wrong
 * about is cadence.
 */
export const CRITTER_STEP_UNITS: Record<CritterKind, number> = {
  frog: 90,
  // A flyer's body does not step: both of its frames are the same drawing and the motion is in the
  // wings, which `critterWings.ts` rotates. The number is here because the table is keyed by kind
  // and a gap would be a lookup that returns undefined; it is never read for a flyer.
  bee: 1,
  hornet: 1,
  mosquito: 1,
}

/** The texture key for one pose of one kind. */
export function critterFrameKey(kind: CritterKind, index: number): string {
  return `critter-${kind}-${((index % CRITTER_FRAMES) + CRITTER_FRAMES) % CRITTER_FRAMES}`
}

/** Every key this module owns, for a loader or a camera list that wants the set. */
/**
 * The key a kind's second, tucked drawing lands under, for the top of a hop.
 *
 * **⚠ There is no procedural fallback for it, and that is deliberate.** Every other critter texture
 * is drawn by `createCritterTextures` when the PNG fails to load; a tucked pose is a supplied
 * drawing with no geometry behind it, so inventing one would put a shape on screen that nobody has
 * seen. `CritterSprites` checks the texture exists and stays on the deformed ground pose when it
 * does not — the hop still reads, it just stops being tucked at the top.
 */
export function critterAirKey(kind: CritterKind): string {
  return `critter-${kind}-air`
}

/** The kinds that ship one. Only the frog so far — see `CRITTER_AIR_POSES`. */
export const CRITTER_AIR_KINDS: readonly CritterKind[] = ['frog']

/** The key a flyer's single wing drawing lands under. Mirrored and rotated in the engine. */
export function critterWingKey(kind: CritterKind): string {
  return `critter-${kind}-wing`
}

/** The kinds that ship one — the three flyers. */
export const CRITTER_WING_KINDS: readonly CritterKind[] = ['bee', 'hornet', 'mosquito']

export const CRITTER_TEXTURE_KEYS: readonly string[] = [
  ...CRITTER_KIND_IDS.flatMap((kind) =>
    Array.from({ length: CRITTER_FRAMES }, (_, i) => critterFrameKey(kind, i)),
  ),
  ...CRITTER_AIR_KINDS.map(critterAirKey),
  ...CRITTER_WING_KINDS.map(critterWingKey),
]

/**
 * The drawing canvas, in pixels.
 *
 * **Not a size in the game** — `CritterSprites` scales this onto the world box a critter occupies,
 * exactly as `ObstacleSprites` and `PlayerView` do. What has to be right is the *aspect*, because
 * the drawn box IS the collision box and a canvas at another proportion is a sprite stretched onto
 * one. Taken from the two constants that decide the hitbox rather than typed in beside them, so a
 * re-sized bug re-shapes its own canvas.
 */
const CANVAS_WIDTH = 384

/**
 * One canvas per kind, each at its own collision box's aspect.
 *
 * The two are very different shapes — a beetle is 4.7:1 and a bee 2.3:1 — and that is deliberate
 * rather than incidental: **type reads by aspect before it reads by contour**, so the kind that is
 * answered by jumping and the kind that punishes it should not be the same silhouette at two sizes.
 */
export const CRITTER_CANVAS: Record<CritterKind, { width: number; height: number }> = Object.fromEntries(
  CRITTER_KIND_IDS.map((kind) => {
    const spec = CRITTER_KINDS[kind]
    const worldWidth = spec.halfWidths * 2 * 2000
    const worldHeight = spec.band.yHigh - spec.band.yLow

    return [kind, { width: CANVAS_WIDTH, height: Math.round((CANVAS_WIDTH * worldHeight) / worldWidth) }]
  }),
) as Record<CritterKind, { width: number; height: number }>

/**
 * Ink weight, as a fraction of the canvas's geometric mean.
 *
 * The obstacles' 0.022, and for their reason rather than the mascot's: this is read against the
 * road at a third of the snail's size, where an outline is most of what survives. A fraction of the
 * *width* would be wrong here as it was there — this canvas is twice as wide as it is tall.
 */
const INK_WEIGHT = 0.022

type Scale = (f: number) => number

/**
 * Where each of the six feet sits, per pose, as fractions of the canvas.
 *
 * Three legs a side, indexed front to back. The tripod is legs `L0 L2 R1` against `R0 R2 L1`: the
 * planted set is drawn tucked in and the swinging set reaching out, which is the whole of the
 * animation. Listed rather than computed because six positions read at a glance and a formula that
 * produced them would not.
 */
const FEET: readonly { hip: [number, number]; out: [number, number]; in: [number, number] }[] = [
  { hip: [0.38, 0.36], out: [0.03, 0.5], in: [0.14, 0.58] },
  { hip: [0.36, 0.56], out: [0.02, 0.8], in: [0.13, 0.84] },
  { hip: [0.38, 0.72], out: [0.09, 0.98], in: [0.19, 0.93] },
]

/**
 * How close to the canvas edge a leg may reach, as a fraction of the width.
 *
 * **A leg past the edge is not an error, which is why this is a clamp and not an assertion.**
 * `generateTexture` crops silently, so an over-reaching knee ships as a bug with five legs and
 * nothing anywhere says so — `verify:critters` found exactly that on its first run, at x -4.8 on a
 * 192px canvas. The margin covers half the ink stroke as well as the point itself.
 */
const EDGE_MARGIN = 0.025

/**
 * Draws both poses, if they are not already there.
 *
 * Idempotent, so it can be called from the pool's constructor without asking who else has.
 */
export function createCritterTextures(scene: Phaser.Scene): void {
  for (const kind of CRITTER_KIND_IDS) {
    const { width, height } = CRITTER_CANVAS[kind]

    for (let frame = 0; frame < CRITTER_FRAMES; frame++) {
      const key = critterFrameKey(kind, frame)

      if (scene.textures.exists(key)) continue

      const g = scene.make.graphics({ x: 0, y: 0 }, false)
      const w: Scale = (f) => width * f
      const h: Scale = (f) => height * f
      const ink = Math.max(1.5, Math.sqrt(width * height) * INK_WEIGHT)

      // **The fallback is a silhouette of the right CLASS, not of the right species**, and that is
      // the honest thing for it to be. Four of the six ship as models (see `ART-SOURCES.md`); this
      // path only runs when a PNG failed to load, and at that point what the player needs is
      // something that reads as "the kind you jump" or "the kind you duck under" at the right size.
      // Drawing six species procedurally would be six drawings nobody ever sees.
      if (CRITTER_KINDS[kind].flying) drawBee(g, w, h, ink, frame)
      else drawCritter(g, w, h, ink, frame)

      g.generateTexture(key, width, height)
      g.destroy()
    }
  }
}

/**
 * A bee, head-on, wings up or down.
 *
 * **Its whole job is to be recognised as a thing you must not fly into**, and it has one frame of a
 * player's attention to do it while they are deciding whether to jump. Three marks carry that, in
 * the order they survive being small: the **banding**, which means "do not touch this" outside any
 * game; the **wings**, which are the only translucent-reading shape in the set and the only thing
 * saying it is up there because it flies rather than because it was put there; and the round body,
 * which is nothing like the beetle's flat shell.
 *
 * **The wings are drawn behind the body and swap between poses.** Up and down rather than a blur,
 * because two extremes read as motion at a distance where an interpolated smear reads as dirt.
 */
function drawBee(g: Phaser.GameObjects.Graphics, w: Scale, h: Scale, ink: number, frame: number): void {
  const up = frame === 0

  // Wings first, so the body paints over their roots.
  for (const side of [-1, 1]) {
    const mirror = (f: number): number => 0.5 + side * (f - 0.5)
    const tipY = up ? 0.06 : 0.52

    g.fillStyle(BEE_COLORS.wing, 1)
    g.fillEllipse(w(mirror(0.24)), h((0.3 + tipY) / 2), w(0.3), h(0.34))
    g.lineStyle(Math.max(1, ink * 0.6), INK, 1)
    g.strokeEllipse(w(mirror(0.24)), h((0.3 + tipY) / 2), w(0.3), h(0.34))
  }

  // The body: a round thorax and abdomen in one mass, banded.
  blob(g, w(0.5), h(0.52), w(0.56), h(0.8), BEE_COLORS.dark, ink)
  // Three bands across it. Clipped to the body by being narrower than it at the edges, which is
  // cheaper than a mask and is the one thing `Graphics` will not do for us.
  g.fillStyle(BEE_COLORS.band, 1)
  for (const [y, halfWidth] of [[0.34, 0.25], [0.55, 0.27], [0.74, 0.21]]) {
    g.fillRect(w(0.5 - halfWidth), h(y), w(halfWidth * 2), h(0.1))
  }

  // The head, at the near end, with the eyes that make it a creature.
  blob(g, w(0.5), h(0.94), w(0.3), h(0.3), BEE_COLORS.dark, ink)
  g.fillStyle(BEE_COLORS.eye, 1)
  g.fillCircle(w(0.43), h(0.87), Math.max(1.2, w(0.035)))
  g.fillCircle(w(0.57), h(0.87), Math.max(1.2, w(0.035)))

  // Antennae, short and forward.
  g.lineStyle(Math.max(1, ink * 0.6), INK, 1)
  g.beginPath()
  g.moveTo(w(0.45), h(0.84))
  g.lineTo(w(0.36), h(0.66))
  g.moveTo(w(0.55), h(0.84))
  g.lineTo(w(0.64), h(0.66))
  g.strokePath()
}

function drawCritter(g: Phaser.GameObjects.Graphics, w: Scale, h: Scale, ink: number, frame: number): void {
  // **Legs first, so the body paints over the hips.** A leg drawn on top of the carapace reads as a
  // line across the shell rather than as a limb coming out from under it.
  for (const [index, leg] of FEET.entries()) {
    // The tripod: on pose 0 the left front and rear swing with the right middle, then the mirror.
    const leftSwings = (index === 1) === (frame === 1)

    drawLeg(g, w, h, ink, leg, -1, leftSwings)
    drawLeg(g, w, h, ink, leg, 1, !leftSwings)
  }

  // **The shell is a chunky dome and the LEGS are what fill the box**, which is the whole of drawing
  // a 3.9:1 creature. Stretching the carapace across the canvas would draw a bar, and a wide dark
  // bar on this road is a `low` barrier; a dome with six long legs spread out from under it is a big
  // insect seen head-on, which is what the box now holds.
  //
  // The hitbox stays honest because a leg is a *visible* thing: a player clipped by one has been
  // clipped by something they can see, which is the rule `PLAYER_WIDTH` states. What may not happen
  // — and did, at the first size — is the whole silhouette sitting small inside the box.
  //
  // One dome and not a thorax plus an abdomen: two shapes read as two objects at the sizes this is
  // met at.
  blob(g, w(0.5), h(0.4), w(0.52), h(0.78), CRITTER_COLORS.mid, ink)
  // The lit top, which is the only thing saying the shell is domed rather than a flat disc.
  g.fillStyle(CRITTER_COLORS.light, 1)
  g.fillEllipse(w(0.5), h(0.26), w(0.4), h(0.36))
  // The elytra seam. Two wing cases meeting down the middle is the single mark that says "beetle",
  // and at the smallest size a phone delivers it is the last interior detail still resolving.
  g.fillStyle(CRITTER_COLORS.dark, 1)
  g.fillRect(w(0.5) - ink * 0.5, h(0.05), ink, h(0.68))

  // Antennae, out of the head and swept wide — on a creature this flat they are most of what says
  // the near end is a head rather than the end of a log.
  g.lineStyle(Math.max(1, ink * 0.7), CRITTER_COLORS.dark, 1)
  g.beginPath()
  g.moveTo(w(0.45), h(0.76))
  g.lineTo(w(0.24), h(0.3))
  g.moveTo(w(0.55), h(0.76))
  g.lineTo(w(0.76), h(0.3))
  g.strokePath()

  // The head, in front of and below the shell — the near end of the animal, since it is running at
  // the camera.
  blob(g, w(0.5), h(0.83), w(0.3), h(0.34), CRITTER_COLORS.mid, ink)

  // **The eyes, and they are the whole "this is alive" read.** Two pale dots on a dark head is what
  // a player resolves once the legs have gone to a blur, and it is the cue that separates a critter
  // from a rock at every size below the one the silhouette works at.
  g.fillStyle(CRITTER_COLORS.eye, 1)
  g.fillCircle(w(0.455), h(0.8), Math.max(1.2, w(0.026)))
  g.fillCircle(w(0.545), h(0.8), Math.max(1.2, w(0.026)))
  g.fillStyle(INK, 1)
  g.fillCircle(w(0.457), h(0.815), Math.max(0.8, w(0.013)))
  g.fillCircle(w(0.543), h(0.815), Math.max(0.8, w(0.013)))
}

/** One leg: hip to foot, in two strokes so it has a knee rather than being a straight spike. */
function drawLeg(
  g: Phaser.GameObjects.Graphics,
  w: Scale,
  h: Scale,
  ink: number,
  leg: (typeof FEET)[number],
  side: -1 | 1,
  swinging: boolean,
): void {
  const mirror = (f: number): number => 0.5 + side * (f - 0.5)
  const foot = swinging ? leg.out : leg.in
  const hipX = mirror(leg.hip[0])
  // Feet and knees both, since either can reach past the edge once the table is re-tuned.
  const footX = clamp(mirror(foot[0]), EDGE_MARGIN, 1 - EDGE_MARGIN)
  // The knee sits outboard of the midpoint, which is what gives the leg the outward crook an insect
  // has instead of the sag a drawn curve would give it.
  const kneeX = clamp(mirror(leg.hip[0] - (leg.hip[0] - foot[0]) * 1.15), EDGE_MARGIN, 1 - EDGE_MARGIN)
  const kneeY = (leg.hip[1] + foot[1]) / 2 - 0.06

  g.lineStyle(Math.max(1.5, ink * 1.15), CRITTER_COLORS.mid, 1)
  g.beginPath()
  g.moveTo(w(hipX), h(leg.hip[1]))
  g.lineTo(w(kneeX), h(kneeY))
  g.lineTo(w(footX), h(foot[1]))
  g.strokePath()
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

/**
 * An ellipse, filled and inked — the shape language `obstacleArt.ts` established, for a body that
 * has no straight edges anywhere on it.
 *
 * `Graphics` has no "outline what was just filled", so the four numbers go to both calls from one
 * place rather than being written out twice at each site and drifting apart.
 */
function blob(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  width: number,
  height: number,
  fill: number,
  ink: number,
): void {
  g.fillStyle(fill, 1)
  g.fillEllipse(x, y, width, height)
  g.lineStyle(ink, INK, 1)
  g.strokeEllipse(x, y, width, height)
}
