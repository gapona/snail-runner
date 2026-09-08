/**
 * A rounded rectangle as a closed loop of points, at a resolution that suits its own radius.
 *
 * **Rule: this file never imports `phaser`** — `npm run verify:ui` loads it under Node.
 *
 * ## ⚠ Why this exists rather than `Graphics.fillRoundedRect`
 *
 * `fillRoundedRect` puts four `ARC` commands in the buffer, and the WebGL renderer walks each one
 * with **`iterStep = 0.01` hardcoded** (`GraphicsWebGLRenderer.js`) — a hundred path points per
 * corner, whatever the corner measures. A rounded rect is therefore **400 points**, and the buffer
 * is replayed on every frame the object is drawn, not only on the frames it is rebuilt.
 *
 * The Fever tank is up to 32 of them: **~12 800 path points a frame** for eight segments whose
 * corners are nine pixels across. Measured in the running game at 375x667 by swapping the same
 * eight segments to plain `fillRect`s, everything else identical: the renderer's own pass went
 * **3.30-3.43ms to 1.63ms**, with the rounded version put back as the control. That was the largest
 * single item left in the frame and none of it is drawing anybody can see — a nine-pixel corner is
 * round at six points and identical at a hundred.
 *
 * So the shape is authored here and handed to `fillPoints`/`strokePoints`, which cost one path
 * entry per point and let the *radius* decide how many there are.
 *
 * **Not a general replacement.** Anything drawn once — a panel, a card, a shop row — should go on
 * using `fillRoundedRect`, which is clearer and costs nothing when it is not replayed sixty times a
 * second. This is for the readouts that are on screen for a whole run.
 */

/** A point, in the shape `Graphics.fillPoints` reads. */
export interface RectPoint {
  x: number
  y: number
}

/**
 * How many segments one corner is drawn with, from how big that corner actually is.
 *
 * **Derived from the radius rather than fixed**, which is the whole correction: a fixed count is
 * what Phaser already does and is wrong at both ends — wasteful on a nine-pixel corner and visibly
 * faceted on a large one. Roughly one segment per 1.6px of arc, floored at 2 (below which a corner
 * stops being a corner) and capped at 12 (beyond which nothing on this screen can show a
 * difference).
 */
export function cornerSteps(radius: number): number {
  return Math.max(2, Math.min(12, Math.ceil(Math.abs(radius) * 0.62)))
}

/**
 * The outline of a rounded rectangle, clockwise from the top-left corner's own start.
 *
 * The radius is clamped to half the shorter side, exactly as a rounded rect must be: asked for more
 * than that the corners would cross and the outline would fold through itself, which `fillPoints`
 * renders as a bow tie rather than refusing.
 */
export function roundedRectPoints(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): RectPoint[] {
  const r = Math.max(0, Math.min(radius, Math.min(width, height) / 2))
  const points: RectPoint[] = []

  if (r <= 0) {
    return [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
    ]
  }

  const steps = cornerSteps(r)
  // Centre of each corner's arc, with the angle its sweep starts at. Clockwise on a screen whose y
  // grows downward, so the sweep always runs from `start` to `start + PI/2`.
  const corners: [number, number, number][] = [
    [x + width - r, y + r, -Math.PI / 2],
    [x + width - r, y + height - r, 0],
    [x + r, y + height - r, Math.PI / 2],
    [x + r, y + r, Math.PI],
  ]

  for (const [cx, cy, start] of corners) {
    for (let i = 0; i <= steps; i++) {
      const angle = start + (Math.PI / 2) * (i / steps)

      points.push({ x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r })
    }
  }

  return points
}
