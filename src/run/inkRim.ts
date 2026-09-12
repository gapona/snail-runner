/**
 * A constant two-tone contour: an edge that does not answer to what is behind it.
 *
 * **Worn by every obstacle (`OBSTACLE_RIM`), and by nothing else.** It was written for the mascot
 * and shared with the obstacles on the argument that it is one rule and a rule kept in two places
 * is a rule that will be applied in one of them. That is still why it is a module rather than a
 * block inside `obstacleArt.ts`; the mascot no longer wears one. See below.
 *
 * **Rule: this file never imports `phaser`** — it is a pass over a pixel buffer, covered by
 * `npm run verify:palettes`.
 *
 * ## ⚠ The mascot's contour is gone, and the argument for it was good every time
 *
 * The snail wore this for four rounds and it was reported in every one of them: it traced the
 * *pad* rather than the creature, then its pale band read as a white ring, then its tones were
 * chosen against a measured backdrop instead of bracketed — and then, on the frame, *remove it
 * entirely, not black, not white, none*. Each fix answered the report it was given and left the
 * line round the creature in place, and the line round the creature was the report.
 *
 * **Why it does not follow that the obstacles should lose theirs.** The two subjects are answering
 * different questions. An obstacle has to separate from a ground that changes nine times a lap
 * under seven lights, at the far end of a reaction distance, where it is a few dozen pixels tall
 * and its own colour has been taken away by the haze — and it is a made object among natural ones,
 * so an edge is part of what it *is*. The mascot is the one saturated thing in the frame, drawn
 * large, in the middle, with the player's eye already on it. It never needed the edge to be found;
 * what the edge did was change what it looked like.
 *
 * ## Why a rim rather than a repaint
 *
 * There is no colour left to reserve for obstacles: swept over every non-obstacle surface in the
 * game, every hue sector with usable chroma is occupied, the most isolated colour in sRGB is a
 * saturated magenta — and saturation in this game means *come and get it*, so a magenta boulder
 * reads as a reward. A contour answers every ground at once, including the ground of a theme that
 * has not been invented yet, where a colour rule is a constraint every future theme has to be
 * checked against.
 *
 * ## It is drawn INWARD, and that is what keeps the drawn box honest
 *
 * `build-sprites.py` trims each frame to its own alpha box, so a subject already touches the canvas
 * edges and there is no margin to grow into; a rim painted outside the silhouette would be clipped
 * on some frames and not others, and where it was not clipped it would enlarge the drawn box — and
 * for anything in this game the drawn box is the collision box.
 *
 * So the rim is the outermost band *of the existing silhouette*, repainted. Alpha is untouched, the
 * box is untouched, and `verify:mattes` measures the same shape it always did.
 *
 * ## Two tones, because one cannot bracket every ground
 *
 * A near-black contour has almost no contrast against a near-black ground, and a pale one has none
 * against a pale one; whatever single tone is chosen, some biome under some theme is that
 * brightness. The pair brackets the range instead, so for any backdrop at least one of the two is
 * far from it, and the guarantee stops depending on which seven palettes happen to exist. Over all
 * 693 surfaces the weakest an obstacle's contour ever gets is 3.06:1.
 */

/** The contour's width in pixels, for a frame of this size. */
export function rimWidthPx(width: number, height: number, spec: { widthFraction: number; minPx: number }): number {
  return Math.max(spec.minPx, Math.round(Math.sqrt(width * height) * spec.widthFraction))
}

/**
 * A pixel is on the rim when it is opaque and some pixel within `rim` of it is not, and which of
 * the two bands it lands in is its distance to the nearest transparent pixel. `pixels` is RGBA,
 * row-major, `width * height * 4` long — the shape `CanvasTexture.getData` returns.
 *
 * Euclidean rather than Chebyshev distance: a square neighbourhood puts a visibly thicker contour
 * on the diagonals, and on a shape made largely of curves that reads as a lumpy edge.
 */
export interface RimTones {
  color: number
  innerColor: number
  innerShare: number
}

/**
 * Repaints the outermost `rim` pixels of the silhouette as the two-tone contour, in place.
 *
 * Returns how many pixels were repainted, which is what lets a check assert the contour exists
 * rather than trust that it does.
 *
 * **⚠ Everything that made this a per-subject decision went with the mascot's contour**, and it is
 * recorded rather than left behind: a `subject` mask (the mascot's alpha is mostly its own foot, so
 * its contour had to be told what the creature was), a `behind` pair of measured luminances with a
 * `chooseRimTone` that picked one of the two bands per side, and a `retone` mode for supplied art
 * that already carried an outline. The one caller left passes none of them, and this project has
 * five separate write-ups of what an authored quantity nothing reads eventually does. Any of them
 * is recoverable from git if a second subject ever needs it.
 */
export function paintInkRim(
  pixels: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  rim: number,
  tones: RimTones,
): number {
  if (rim <= 0) return 0

  const size = width * height
  const solid = new Uint8Array(size)

  for (let i = 0; i < size; i++) solid[i] = pixels[i * 4 + 3] > 0 ? 1 : 0

  // Outside the canvas counts as transparent: the trim leaves a subject touching the frame, so
  // treating the outside as opaque would leave those edges with no contour at all.
  const opaque = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < width && y < height && solid[y * width + x] === 1

  // The offsets inside the radius, computed once rather than per pixel.
  const offsets: number[] = []
  const rim2 = rim * rim

  for (let dy = -rim; dy <= rim; dy++) {
    for (let dx = -rim; dx <= rim; dx++) {
      if (dx === 0 && dy === 0) continue
      if (dx * dx + dy * dy <= rim2) offsets.push(dx, dy)
    }
  }

  // **⚠ Stamped outward from the edge, never searched inward from every pixel — and it was the
  // latter for as long as this pass existed.** The obvious form asks, of every opaque pixel, "is any
  // pixel within `rim` of me transparent?", which walks the whole disc for every pixel of the
  // interior only to answer "no". Measured at 230ms for the five obstacles on a desktop, on the
  // first run of every session — i.e. well over a second of the frame frozen on a phone, at the
  // exact moment the player pressed Play.
  //
  // The answer is identical, and it is a fact about the lattice rather than an approximation: the
  // nearest transparent pixel `q` to an opaque pixel `p` always has an OPAQUE 4-neighbour, because
  // one step from `q` toward `p` along the dominant axis is strictly closer to `p` and therefore not
  // transparent. So only transparent pixels that touch the silhouette — including the one-pixel
  // ring outside the canvas, for the same reason — can ever be anybody's nearest, and stamping the
  // disc from each of those visits the perimeter instead of the area. `verify:palettes` holds the
  // output to the old form byte for byte on every shipped obstacle.
  const nearest2 = new Int32Array(size).fill(rim2 + 1)
  const stamp = (sx: number, sy: number): void => {
    for (let i = 0; i < offsets.length; i += 2) {
      const x = sx + offsets[i]
      const y = sy + offsets[i + 1]

      if (x < 0 || y < 0 || x >= width || y >= height) continue

      const at = y * width + x

      if (solid[at] === 0) continue

      const d2 = offsets[i] * offsets[i] + offsets[i + 1] * offsets[i + 1]

      if (d2 < nearest2[at]) nearest2[at] = d2
    }
  }

  for (let y = -1; y <= height; y++) {
    for (let x = -1; x <= width; x++) {
      if (opaque(x, y)) continue
      if (opaque(x - 1, y) || opaque(x + 1, y) || opaque(x, y - 1) || opaque(x, y + 1)) stamp(x, y)
    }
  }

  // **Marked first, painted second.** Painting as it goes would test later pixels against edges
  // this pass had just created, and the contour would creep inward by its own width on every row.
  //
  // 1 is the outer ink band, 2 the pale one inside it. The distance is measured once, in the same
  // sweep, so the two bands cannot disagree about where the edge is. `innerShare` of 0 means one
  // band, and `Math.max(1, ...)` on the inner one would force a pixel of it back on at every width.
  const inner = tones.innerShare <= 0 ? 0 : Math.max(1, Math.round(rim * tones.innerShare))
  const outer = Math.max(1, rim - inner)
  const mark = new Uint8Array(size)
  let painted = 0

  for (let i = 0; i < size; i++) {
    if (solid[i] === 0 || nearest2[i] > rim2) continue

    mark[i] = Math.sqrt(nearest2[i]) <= outer ? 1 : 2
    painted++
  }

  const band = (color: number) => [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff]
  const ink = band(tones.color)
  const lit = band(tones.innerColor)

  for (let i = 0; i < mark.length; i++) {
    if (!mark[i]) continue

    const [r, g, b] = mark[i] === 1 ? ink : lit

    pixels[i * 4] = r
    pixels[i * 4 + 1] = g
    pixels[i * 4 + 2] = b
  }

  return painted
}
