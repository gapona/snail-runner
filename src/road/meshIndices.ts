/**
 * The ordered index list a `Mesh2D` is submitted through, and how to submit only part of it.
 *
 * **Rule: this file never imports `phaser`.** Same split as `project.ts`, `surface.ts` and
 * `spans.ts` — the layout is what the truncation rests on, so it lives where `verify:road` can
 * assert it rather than where it can only be read.
 *
 * `SubmitterMeshToQuad.run` walks `indicesOrdered` in strides of eight and transforms four vertices
 * per quad it walks, so **the quads that cost anything are exactly the ones in the list** — not the
 * ones that are visible, and not the ones that are non-degenerate. Both meshes in this renderer
 * used to hand over their whole list every frame and collapse the slack onto a point: the road's
 * far field was 1800 quads to paint 253 pixels, and the decal mesh submits 96 to draw **nothing at
 * all**, because `DECAL_DENSITY` is 0 and has been since a dark patch on the ground came to mean
 * one thing only. Measured, that is 0.043ms a frame for an empty mesh.
 *
 * So a mesh writes its used quads into a contiguous prefix and hands over a view of just those.
 *
 * **⚠ Built here rather than by `Mesh2D.buildOrderedIndices`, and that is what makes the
 * truncation correct.** Shortening the list only drops the unused tail if quad `i` provably
 * occupies entries `i * 8 ..`; Phaser's own builder happens to produce that order for a topology
 * whose quads share no vertices, but a property of somebody else's optimiser is not a thing to
 * build a render loop on. `verify:road` asserts the layout against this function.
 */

/** Index-buffer entries one quad occupies: two triangles of `a, b, c, page`. */
export const INDICES_PER_QUAD = 8

/** Vertices one quad owns. They are never shared, which is why the pairing above is forced. */
export const VERTICES_PER_QUAD = 4

/**
 * The ordered index list for `quadCount` quads, in slot order.
 *
 * `Uint32Array` rather than `number[]` because the per-frame truncation is a `subarray`, which is a
 * view rather than a copy. Phaser types `indicesOrdered` as `number[]` and the renderer only ever
 * reads `ordered[i]` and `ordered.length`, both of which a typed array answers identically.
 */
export function orderedQuadIndices(quadCount: number): Uint32Array {
  const ordered = new Uint32Array(quadCount * INDICES_PER_QUAD)

  for (let quad = 0; quad < quadCount; quad++) {
    const v = quad * VERTICES_PER_QUAD
    const i = quad * INDICES_PER_QUAD

    // v0 far-left, v1 near-left, v2 far-right, v3 near-right — the winding both meshes write, and
    // the one the submitter reads as TL, BL, TR, BR. The two triangles share the v1-v2 edge, which
    // is what lets a pair be submitted as one quad rather than as two padded ones.
    ordered[i] = v
    ordered[i + 1] = v + 1
    ordered[i + 2] = v + 2
    ordered[i + 3] = 0

    ordered[i + 4] = v + 1
    ordered[i + 5] = v + 2
    ordered[i + 6] = v + 3
    ordered[i + 7] = 0
  }

  return ordered
}

/**
 * An ordered index list plus a truncated view of it per quad count.
 *
 * `subarray` is cheap but not free and the count changes on almost every frame; there are at most
 * `quadCount + 1` distinct answers, so each is made once and kept. That is what makes the
 * per-frame cost of submitting less a property lookup rather than an allocation.
 */
export class OrderedQuads {
  readonly all: Uint32Array

  private readonly views: (Uint32Array | undefined)[]

  constructor(quadCount: number) {
    this.all = orderedQuadIndices(quadCount)
    this.views = new Array<Uint32Array | undefined>(quadCount + 1)
  }

  /** The list truncated to the first `quads` of them. */
  first(quads: number): Uint32Array {
    const cached = this.views[quads]

    if (cached) return cached

    const view = this.all.subarray(0, quads * INDICES_PER_QUAD)

    this.views[quads] = view

    return view
  }
}
