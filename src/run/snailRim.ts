/**
 * The mascot's ink contour: a constant edge that does not answer to what is behind it.
 *
 * **Rule: this file never imports `phaser`** — it is a pass over a pixel buffer, covered by
 * `npm run verify:palettes`.
 *
 * ## Why a rim rather than a repaint
 *
 * The skin-by-theme sweep was built to answer "does the snail drown in the active theme". It does,
 * a little — and the dominant term turned out to be somewhere no palette can reach. `SlimeTrail.ts`
 * draws in a fixed yellow-green that no theme tints, so `fern` loses **36% of its silhouette to its
 * own trail on every one of the seven themes**, and `amber` 16%. Repainting all seven palettes
 * would not move either number.
 *
 * A rim answers both backdrops at once, and it answers the ground of a theme that has not been
 * invented yet. That is the whole argument for it over a colour rule: a rule of the form "the
 * mascot's hue is excluded from the theme's palette" is a constraint every future theme has to be
 * checked against and every future skin re-checked across, i.e. a product of two growing sets. A
 * contour is one property of one object.
 *
 * ## It is drawn INWARD, and that is what keeps the collision box honest
 *
 * The drawn box *is* the collision box — see `PLAYER_WIDTH`, and the pancake bug its docstring
 * records. `build-sprites.py` trims each frame to its own alpha box, so the mascot already touches
 * the canvas edges and there is no margin to grow into; a rim painted outside the silhouette would
 * be clipped on some frames and not others, and where it was not clipped it would enlarge the
 * drawn box against a collision box that had not moved.
 *
 * So the rim is the outermost band *of the existing silhouette*, repainted. Alpha is untouched, the
 * box is untouched, `verify:mattes` measures the same shape it always did, and what the rim costs
 * is a couple of pixels of the mascot's own edge — which is where its colour was least legible
 * anyway.
 *
 * ## Two tones, because one cannot bracket every ground
 *
 * It shipped as ink alone first, on the argument that ink is what this art style is already drawn
 * with — every prop, every critter and the mascot itself carry a black contour — so thickening that
 * contour adds no new visual idea to the frame. That argument is still right and is why the
 * *outermost* pixel is ink.
 *
 * **It is not sufficient, and the check found the case rather than an eye.** A near-black contour
 * has almost no contrast against a near-black ground: `rose` on `ice`'s darkest biome measured 12%
 * of its interior merged with a rim of **1.49:1**, i.e. body and outline both sitting in the
 * ground's own luminance. No single tone can answer that — whatever it is, some ground is that
 * bright or that dark. The pale band inside the ink one brackets the range instead, so for any
 * backdrop at least one of the two is far from it, and the guarantee stops depending on which seven
 * palettes happen to exist.
 *
 * **The pale band is INSIDE, which is the difference from the halo this project already shipped
 * once.** The pickups' bright rim was painted *outside* the silhouette and was reported on sight as
 * "a white background around the icons"; here the mascot's outer edge is still ink and the pale
 * band reads as the lit edge of a rounded body, which is what the rest of this art draws by hand.
 *
 * **⚠ It has not been looked at on a frame.** Everything above is measured, and this project's
 * standing rule is that a contrast device is judged on a frame rather than on the argument for it —
 * paid for three times on one screen already. The numbers say the contour separates; whether the
 * pale band reads as rim light or as a scratch is the open question.
 */

/**
 * The contour's colour and weight.
 *
 * **`widthFraction` is a share of the canvas's geometric mean, never of its width.** That is this
 * project's standing rule for ink weight, paid for twice: a width-derived outline put a 5.6px ring
 * on a 56px-tall obstacle — a sixth of its height — and, from the other direction, an ink weight
 * set in supersample pixels survived two downscales and shipped a prop with no visible contour at
 * all. `sqrt(width * height)` tracks the shape rather than one of its axes.
 *
 * The colour is the same `26, 28, 26` the rest of the art is outlined in and deliberately not pure
 * black: `verify:mattes`' border-flood rule is written against that value.
 */
export const SNAIL_RIM = {
  widthFraction: 0.016,
  /** Never thinner than this, or the contour disappears at the size a phone draws the mascot. */
  minPx: 2,
  color: 0x1a1c1a,
  /**
   * The pale band immediately inside the ink one.
   *
   * **⚠ Ink alone cannot carry the guarantee, and the check found where.** A near-black contour has
   * almost no contrast against a near-black ground: `rose` on `ice`'s darkest biome measured 12% of
   * its interior merged with a rim of **1.49:1**, i.e. both the body and its outline sitting in the
   * ground's own luminance. No single tone can answer that — whatever it is, some ground is that
   * bright or that dark.
   *
   * Two bracket it instead. Ink and this are 0.01 and 0.63 relative luminance, so for *any*
   * backdrop at least one of them is far away, and the contour's separation stops being a property
   * of the palettes at all.
   *
   * **It is INSIDE the ink band, and that is what keeps it from being the halo this project has
   * already shipped once.** The pickups' bright rim was painted outside the silhouette and was
   * reported on sight as "a white background around the icons"; here the outermost pixel of the
   * mascot is still ink, and the pale band is read as the lit edge of a rounded body — which is
   * what the rest of this art already draws by hand.
   */
  innerColor: 0xd8e0d4,
  /** Share of the contour given to the pale band. The outer ink band keeps the rest. */
  innerShare: 0.4,
} as const

/** The contour's width in pixels, for a frame of this size. */
export function rimWidthPx(width: number, height: number): number {
  return Math.max(SNAIL_RIM.minPx, Math.round(Math.sqrt(width * height) * SNAIL_RIM.widthFraction))
}

/**
 * Repaints the outermost `rim` pixels of the silhouette as the two-tone contour, in place.
 *
 * `pixels` is RGBA, row-major, `width * height * 4` long — the shape `CanvasTexture.getData`
 * returns. Returns how many pixels were repainted, which is what lets a check assert the contour
 * exists rather than trust that it does.
 *
 * A pixel is on the rim when it is opaque and some pixel within `rim` of it is not, and which band
 * it lands in is its distance to the nearest transparent pixel. The test is on **alpha alone**, so
 * it is identical for every skin — the recolour rotates hue and cannot move a silhouette, which is
 * what makes the contour a property of the mascot rather than of the skin.
 *
 * Euclidean rather than Chebyshev distance: a square neighbourhood puts a visibly thicker contour
 * on the diagonals, and on a shape made almost entirely of curves that reads as a lumpy edge.
 */
export function paintInkRim(pixels: Uint8ClampedArray | Uint8Array, width: number, height: number, rim: number): number {
  if (rim <= 0) return 0

  const opaque = (x: number, y: number) => {
    // Outside the canvas counts as transparent: the trim leaves the mascot touching the frame, so
    // treating the outside as opaque would leave those edges with no contour at all.
    if (x < 0 || y < 0 || x >= width || y >= height) return false

    return pixels[(y * width + x) * 4 + 3] > 0
  }

  // The offsets inside the radius, computed once rather than per pixel.
  const offsets: number[] = []

  for (let dy = -rim; dy <= rim; dy++) {
    for (let dx = -rim; dx <= rim; dx++) {
      if (dx === 0 && dy === 0) continue
      if (dx * dx + dy * dy <= rim * rim) offsets.push(dx, dy)
    }
  }

  // **Marked first, painted second.** Painting as it goes would test later pixels against edges
  // this pass had just created, and the contour would creep inward by its own width on every row.
  //
  // 1 is the outer ink band, 2 the pale one inside it. The distance is measured once, in the same
  // sweep, so the two bands cannot disagree about where the edge is.
  const inner = Math.max(1, Math.round(rim * SNAIL_RIM.innerShare))
  const outer = Math.max(1, rim - inner)
  const mark = new Uint8Array(width * height)
  let painted = 0

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!opaque(x, y)) continue

      let nearest = Infinity

      for (let i = 0; i < offsets.length; i += 2) {
        if (opaque(x + offsets[i], y + offsets[i + 1])) continue

        const dx = offsets[i]
        const dy = offsets[i + 1]

        nearest = Math.min(nearest, Math.sqrt(dx * dx + dy * dy))
      }

      if (nearest === Infinity) continue

      mark[y * width + x] = nearest <= outer ? 1 : 2
      painted++
    }
  }

  const band = (color: number) => [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff]
  const ink = band(SNAIL_RIM.color)
  const lit = band(SNAIL_RIM.innerColor)

  for (let i = 0; i < mark.length; i++) {
    if (!mark[i]) continue

    const [r, g, b] = mark[i] === 1 ? ink : lit

    pixels[i * 4] = r
    pixels[i * 4 + 1] = g
    pixels[i * 4 + 2] = b
  }

  return painted
}
