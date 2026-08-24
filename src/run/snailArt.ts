/**
 * The snail, drawn rather than loaded.
 *
 * **A placeholder that has to survive being seen.** Chunk 7 makes the mascot properly — it is the
 * single full-colour foreground object in the whole game and the one thing a player will look at
 * for a whole run. Until then this draws a shape that reads as a snail from a distance and from
 * the one angle the game ever shows it: three-quarters from behind and slightly above, which is
 * where `PLAYER_Z` puts the camera relative to it.
 *
 * It follows the same rule every other generated texture here does (`decor.ts`, `obstacleArt.ts`):
 * **if the key already exists, nothing is drawn.** So dropping a real `snail.png` into
 * `public/assets/` and loading it under this key in `Preloader` is the entire swap — nothing
 * downstream branches on art-versus-drawn.
 */
import * as Phaser from 'phaser'

export const SNAIL_TEXTURE = 'snail'

/**
 * The drawing canvas, in pixels. **Not a size in the game** — how big the snail is on screen comes
 * from `PLAYER_WIDTH` and `PLAYER_BODY_H`, and `PlayerView` scales this image to it. What this
 * does have to match is the *aspect*: 112x72 is the same 1.56:1 as 280x180 world units, so the
 * scaling never distorts. Draw at whatever resolution the art wants; keep the ratio.
 */
export const SNAIL_TEXTURE_SIZE = { width: 112, height: 72 } as const

const SHELL = { fill: 0xd98032, band: 0xf2ae5c, rim: 0x7a4318 }
const BODY = { fill: 0xc8d94f, shade: 0x9bb032, rim: 0x5f7016 }

/**
 * Draws the snail if it is not already there.
 *
 * Origin is the bottom centre, matching every other billboard in the game: a billboard is
 * positioned by the point where it meets the ground, which is what the projection gives us.
 */
export function createSnailTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(SNAIL_TEXTURE)) return

  const { width, height } = SNAIL_TEXTURE_SIZE
  const g = scene.make.graphics({ x: 0, y: 0 }, false)
  // Everything below is a fraction of the canvas, so the drawing survives being redrawn at a
  // different resolution — which is the whole point of the canvas not being a size in the game.
  const w = (f: number) => width * f
  const h = (f: number) => height * f

  // The foot, flat on the ground and wider than the shell — it is what the shadow lines up with.
  g.fillStyle(BODY.shade, 1)
  g.fillEllipse(w(0.5), h(0.9), w(0.92), h(0.2))
  g.fillStyle(BODY.fill, 1)
  g.fillEllipse(w(0.5), h(0.87), w(0.86), h(0.17))

  // The head, forward and left of centre, so the silhouette is not bilaterally symmetrical — a
  // symmetrical blob reads as an object rather than as a creature.
  g.fillStyle(BODY.fill, 1)
  g.fillEllipse(w(0.22), h(0.7), w(0.3), h(0.36))
  g.fillStyle(BODY.shade, 1)
  g.fillEllipse(w(0.22), h(0.78), w(0.27), h(0.2))

  // Eye stalks. Thin, and the only vertical lines in the shape, which is what keeps the
  // silhouette legible at the few pixels the snail occupies on a phone in landscape.
  g.lineStyle(Math.max(2, w(0.03)), BODY.fill, 1)
  g.beginPath()
  g.moveTo(w(0.18), h(0.6))
  g.lineTo(w(0.11), h(0.16))
  g.moveTo(w(0.29), h(0.58))
  g.lineTo(w(0.27), h(0.1))
  g.strokePath()
  g.fillStyle(0x1b2016, 1)
  g.fillCircle(w(0.11), h(0.14), w(0.035))
  g.fillCircle(w(0.27), h(0.08), w(0.035))

  // The shell: the read at any distance. Concentric circles rather than a spiral path, because a
  // real spiral collapses into one blob the moment the sprite is under ~20px on screen.
  const cx = w(0.63)
  const cy = h(0.5)
  const r = Math.min(w(0.34), h(0.46))

  g.fillStyle(SHELL.rim, 1)
  g.fillCircle(cx, cy, r)
  g.fillStyle(SHELL.fill, 1)
  g.fillCircle(cx, cy, r * 0.9)
  g.fillStyle(SHELL.band, 1)
  g.fillCircle(cx + r * 0.09, cy - r * 0.09, r * 0.6)
  g.fillStyle(SHELL.fill, 1)
  g.fillCircle(cx + r * 0.14, cy - r * 0.14, r * 0.34)
  g.fillStyle(SHELL.band, 1)
  g.fillCircle(cx + r * 0.18, cy - r * 0.18, r * 0.13)

  g.lineStyle(Math.max(1.5, w(0.018)), BODY.rim, 0.9)
  g.strokeEllipse(w(0.5), h(0.87), w(0.86), h(0.17))

  g.generateTexture(SNAIL_TEXTURE, width, height)
  g.destroy()
}
