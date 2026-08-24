/**
 * The snail: six frames of glide, drawn rather than loaded.
 *
 * **The mascot is the only full-colour object in the game, and that is a decision rather than a
 * description.** Everything else — the verge, the obstacles, the road — is aimed at the scenery's
 * own measured tone (lightness 111, saturation 5%, ink 34%, via `node scripts/measure-art.mjs`).
 * The snail is aimed deliberately away from it, bright and saturated, because it is the one thing
 * the player's eye must never have to search for. The rail shooter learned the same lesson from the
 * other end: bought props that measured 1.29x as bright and 2.66x as saturated as their neighbours
 * jumped forward off the verge and read as pasted in. Here that effect is the point, applied to
 * exactly one object.
 *
 * **The project renders smoothed, not pixel-doubled** — `config.ts` sets neither `pixelArt` nor
 * `roundPixels`, so WebGL antialiasing is on and every sprite is scaled continuously by the road's
 * projection. That settles the question once for the whole game: full-colour art with soft edges,
 * never pixel art. The two cannot share a frame — a pixel grid only reads as intentional when
 * nothing beside it is being resampled, and this projection resamples everything by definition.
 *
 * **Why a snail is the cheapest possible mascot.** A runner with legs needs a walk cycle, a run
 * cycle, a launch pose, an airborne pose and a landing pose. A snail has no legs and no gait: it
 * glides, and the only thing that moves is a wave travelling along its foot. Six frames of that
 * wave is the entire character animation, and `squash.ts`'s procedural deformation rides on top of
 * it for the jump — see "The Jump" in CLAUDE.md.
 *
 * Same swap rule as every generated texture here: **if the key already exists, nothing is drawn**,
 * so dropping real art in under `snail-0` … `snail-5` replaces this with no code change.
 */
import * as Phaser from 'phaser'
import { INK, SNAIL_BODY as BODY, SNAIL_SHELL as SHELL } from './artPalette'

/** How many frames the glide cycle has. */
export const SNAIL_FRAMES = 6

/** Texture key for frame `index`, wrapping in both directions. */
export function snailFrameKey(index: number): string {
  return `snail-${((index % SNAIL_FRAMES) + SNAIL_FRAMES) % SNAIL_FRAMES}`
}

/** The first frame, for anything needing a key before it has a distance to derive one from. */
export const SNAIL_TEXTURE = snailFrameKey(0)

/**
 * The drawing canvas, in pixels.
 *
 * **Not a size in the game** — `PlayerView` scales this to `PLAYER_WIDTH` x `PLAYER_BODY_H`. What
 * has to be right is the *aspect*: 224x144 is the same 1.56:1 as 280x180 world units, so the
 * scaling never distorts.
 *
 * Drawn well above its delivered size on purpose. The snail lands around 102px across at 1920 wide
 * and around 21px on a 390px phone; downscaling a clean 224px drawing through the projection's own
 * filtering is what keeps the edge smooth at both, where authoring at 21px would fall apart the
 * moment anyone opened it on a desktop.
 */
export const SNAIL_TEXTURE_SIZE = { width: 224, height: 144 } as const

/**
 * Ink weight, as a fraction of the canvas width.
 *
 * **Derived from the delivered size, not the drawing's.** The rail shooter shipped a prop with no
 * visible outline at all because its ink was set in supersample pixels and then survived two
 * downscales — a 6px ring arrived as half a pixel. 1.6% of 224px is 3.6px here, which is a third of
 * a pixel at the 21px a phone delivers: thin, but present, and it thickens with the sprite rather
 * than vanishing.
 */
const INK_WEIGHT = 0.016

/**
 * Draws all six frames, if they are not already there.
 *
 * Origin is the bottom centre, matching every other billboard in the game: a billboard is
 * positioned by the point where it meets the ground, which is what the projection gives us.
 */
export function createSnailTexture(scene: Phaser.Scene): void {
  for (let frame = 0; frame < SNAIL_FRAMES; frame++) {
    const key = snailFrameKey(frame)

    if (scene.textures.exists(key)) continue

    drawSnail(scene, key, frame / SNAIL_FRAMES)
  }
}

type Scale = (f: number) => number

/** One frame. `phase` is `0..1` through the glide cycle. */
function drawSnail(scene: Phaser.Scene, key: string, phase: number): void {
  const { width, height } = SNAIL_TEXTURE_SIZE
  const g = scene.make.graphics({ x: 0, y: 0 }, false)
  const w: Scale = (f) => width * f
  const h: Scale = (f) => height * f
  const ink = Math.max(2, width * INK_WEIGHT)
  const turn = phase * Math.PI * 2

  // **The whole animation is one wave.** A snail's foot moves by pulses travelling along its
  // underside, so the silhouette's bottom edge ripples and nothing else has to. What little else
  // moves — the shell's bob, the stalks' sway — is the same phase scaled down, so the frames cannot
  // drift out of step with one another.
  const bob = Math.sin(turn) * h(0.012)
  const sway = Math.cos(turn) * w(0.008)

  drawFoot(g, w, h, ink, turn)
  drawStalks(g, w, h, ink, sway, bob)
  drawHead(g, w, h, ink, bob)
  drawShell(g, w, h, ink, bob)

  g.generateTexture(key, width, height)
  g.destroy()
}

/**
 * The foot: a flattened lozenge whose underside carries the glide wave.
 *
 * An explicit path rather than an ellipse, so the bottom edge can ripple. The top edge stays
 * smooth — a foot that waved on both sides would read as a caterpillar.
 */
function drawFoot(g: Phaser.GameObjects.Graphics, w: Scale, h: Scale, ink: number, turn: number): void {
  const left = w(0.04)
  const right = w(0.9)
  const top = h(0.78)
  const base = h(0.95)
  const steps = 24

  const path = (): void => {
    g.beginPath()
    g.moveTo(left, top + h(0.03))
    g.lineTo(w(0.14), top)
    g.lineTo(w(0.78), top)
    g.lineTo(right, top + h(0.04))
    // The rippling underside, back to front. Three wavelengths along the foot: enough to read as
    // travelling, few enough that each crest survives being three pixels wide on a phone.
    for (let i = steps; i >= 0; i--) {
      const t = i / steps
      const x = left + (right - left) * t
      const wave = Math.sin(t * Math.PI * 3 - turn) * h(0.022)

      g.lineTo(x, base + wave)
    }
    g.closePath()
  }

  g.fillStyle(BODY.dark, 1)
  path()
  g.fillPath()
  g.lineStyle(ink, INK, 1)
  path()
  g.strokePath()

  // The lit upper surface, inset so the dark fill reads as the shaded underside rather than as a
  // second colour.
  g.fillStyle(BODY.mid, 1)
  g.beginPath()
  g.moveTo(w(0.09), top + h(0.02))
  g.lineTo(w(0.78), top + h(0.01))
  g.lineTo(w(0.85), top + h(0.05))
  g.lineTo(w(0.1), top + h(0.06))
  g.closePath()
  g.fillPath()
}

/**
 * The eye stalks: the only vertical lines in the whole shape.
 *
 * **They are what makes the silhouette legible at 21px.** Everything else about a snail is round
 * lumps; two thin verticals with dots on top is what a player reads as "creature" before they read
 * anything else. Drawn thick enough to survive the downscale and splayed apart so they never merge
 * into one stroke.
 *
 * Ink is stroked first and wider, then the body colour over it — much cheaper than building a
 * closed path around a stem four pixels across, and it leaves an outline on both sides for free.
 */
function drawStalks(g: Phaser.GameObjects.Graphics, w: Scale, h: Scale, ink: number, sway: number, bob: number): void {
  const stalks = [
    { from: [w(0.19), h(0.62)], to: [w(0.1) + sway, h(0.16) + bob], eye: w(0.032) },
    { from: [w(0.3), h(0.6)], to: [w(0.27) - sway, h(0.08) + bob], eye: w(0.034) },
  ]

  for (const stalk of stalks) {
    for (const [weight, color] of [
      [w(0.055) + ink, INK],
      [w(0.055), BODY.mid],
    ] as const) {
      g.lineStyle(weight, color, 1)
      g.beginPath()
      g.moveTo(stalk.from[0], stalk.from[1])
      g.lineTo(stalk.to[0], stalk.to[1])
      g.strokePath()
    }

    g.fillStyle(INK, 1)
    g.fillCircle(stalk.to[0], stalk.to[1], stalk.eye + ink * 0.5)
    g.fillStyle(BODY.light, 1)
    g.fillCircle(stalk.to[0], stalk.to[1], stalk.eye)
    g.fillStyle(INK, 1)
    g.fillCircle(stalk.to[0], stalk.to[1] - h(0.004), stalk.eye * 0.5)
  }
}

/** The head: a bulge under the stalks, forward of the shell and off the centreline. */
function drawHead(g: Phaser.GameObjects.Graphics, w: Scale, h: Scale, ink: number, bob: number): void {
  g.fillStyle(INK, 1)
  g.fillEllipse(w(0.24), h(0.68) + bob, w(0.34) + ink, h(0.42) + ink)
  g.fillStyle(BODY.mid, 1)
  g.fillEllipse(w(0.24), h(0.68) + bob, w(0.34), h(0.42))
  // Lit from above and in front, which is where the sky is in this projection.
  g.fillStyle(BODY.light, 1)
  g.fillEllipse(w(0.22), h(0.62) + bob, w(0.22), h(0.2))
  // One stroke for a mouth, and the only thing that gives the head a front.
  g.lineStyle(Math.max(1.5, ink * 0.7), INK, 0.75)
  g.beginPath()
  g.moveTo(w(0.09), h(0.74) + bob)
  g.lineTo(w(0.16), h(0.76) + bob)
  g.strokePath()
}

/**
 * The shell: the read at any distance.
 *
 * Concentric bands *and* a spiral, doing different jobs — the bands are what survives the downscale
 * to a phone, the spiral is what makes it a shell rather than a target when the snail is 100px
 * across on a desktop. Only the spiral gives a blob at 21px; only the bands give a bullseye at
 * 100px.
 */
function drawShell(g: Phaser.GameObjects.Graphics, w: Scale, h: Scale, ink: number, bob: number): void {
  const cx = w(0.64)
  const cy = h(0.44) + bob
  const r = Math.min(w(0.35), h(0.45))

  g.fillStyle(INK, 1)
  g.fillCircle(cx, cy, r + ink * 0.6)
  g.fillStyle(SHELL.dark, 1)
  g.fillCircle(cx, cy, r)
  // Two bands, offset up and to the left: the light in this game comes from above the horizon.
  g.fillStyle(SHELL.mid, 1)
  g.fillCircle(cx - r * 0.06, cy - r * 0.08, r * 0.86)
  g.fillStyle(SHELL.light, 1)
  g.fillCircle(cx - r * 0.12, cy - r * 0.16, r * 0.5)

  // The spiral, outside in. Ink at partial alpha rather than full, so at small sizes it averages
  // into the band beneath it instead of scribbling over it.
  g.lineStyle(Math.max(1.5, ink * 0.8), INK, 0.55)
  g.beginPath()

  const turns = 2.4
  const steps = 72

  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const angle = t * turns * Math.PI * 2
    const radius = r * (0.94 - t * 0.82)
    const x = cx + Math.cos(angle) * radius
    const y = cy + Math.sin(angle) * radius * 0.96

    if (i === 0) g.moveTo(x, y)
    else g.lineTo(x, y)
  }
  g.strokePath()

  // A specular nick, top-left — the one pure highlight on the whole creature.
  g.fillStyle(0xfff0d0, 0.75)
  g.fillEllipse(cx - r * 0.42, cy - r * 0.46, r * 0.3, r * 0.2)
}
