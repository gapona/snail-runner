import * as Phaser from 'phaser'
import { getRoadTheme } from '../road/themes'
import { meanColor, scrimResultFor, worstSample, type ScrimResult } from './scrim'

/**
 * Measures what is actually behind the menu's text, so the scrim under it can be solved rather
 * than guessed. The Phaser half of `ui/scrim.ts`.
 *
 * **Why a measurement at all.** The menu is drawn over the live world, which is a different
 * colour on every theme, at every point of the track, and at every viewport. There is no text
 * colour that works on all of them (white measures under 3:1 on the `day` sky and the redesign
 * asks for 4.5:1) and no fixed plate alpha either — one dark enough for `day` is a black slab on
 * `night`. What the frame is is a fact, so it is read off the frame.
 *
 * **What it costs, stated plainly:** one `gl.readPixels` of one band per frame while a
 * measurement is outstanding, i.e. two frames per measurement, and a measurement happens on
 * scene entry, on every resize, and on a theme change. Nothing per frame after that.
 *
 * **The UI camera is hidden while sampling**, or the probe would measure the text it is trying
 * to make legible — and, once the scrim exists, its own plate, which converges on nothing. On
 * entry that is free: the interface is at alpha 0 for the first 120ms of the cascade anyway. On
 * a theme change it is a two-frame blink of the interface, which is the honest cost of not
 * having a way to ask the renderer what the world alone looks like.
 */

/** How coarsely a band is sampled. The image is downscaled to this grid, which averages for us. */
const GRID = { x: 24, y: 6 } as const

/** Text colours the probe chooses between. Neither is pure black or white — see `bestTextColor`. */
const TEXT_DARK = 0x0d1b2a
const TEXT_LIGHT = 0xf4f8ff

interface Region {
  key: string
  rect: Phaser.Geom.Rectangle
}

export class ContrastProbe {
  private readonly scene: Phaser.Scene
  /**
   * The camera the interface is drawn on, hidden for the single frame a band is captured.
   *
   * Passed in rather than found by index. The first version reached for `cameras.cameras[1]`,
   * which is true of both scenes today and is exactly the kind of thing that stops being true
   * the first time somebody adds a camera.
   */
  private readonly uiCamera: Phaser.Cameras.Scene2D.Camera
  private regions: Region[] = []
  /** Regions still to sample this round. Empty means the measurement is settled. */
  private pending: Region[] = []
  private results = new Map<string, ScrimResult>()
  /** True between requesting a snapshot and its callback, so only one is ever in flight. */
  private awaiting = false
  /** True while the interface is hidden for a capture — cleared on the very next `update`. */
  private hiding = false
  private canvas: HTMLCanvasElement | null = null

  constructor(scene: Phaser.Scene, uiCamera: Phaser.Cameras.Scene2D.Camera) {
    this.scene = scene
    this.uiCamera = uiCamera
  }

  /** The theme's own vignette colour, which is what the plates are painted with. */
  get scrimColor(): number {
    return getRoadTheme().vignette
  }

  /** What was solved for one named block, or `undefined` until it has been measured. */
  result(key: string): ScrimResult | undefined {
    return this.results.get(key)
  }

  get titleResult(): ScrimResult | undefined {
    return this.results.get('title')
  }

  get buttonResult(): ScrimResult | undefined {
    return this.results.get('buttons')
  }

  /**
   * Where the text blocks ended up. Restarts the measurement — a resize can move a block.
   *
   * Named blocks rather than a fixed pair: the menu measures a title and a button stack, the
   * combat HUD measures its top strip, and neither should have to describe itself in the other's
   * vocabulary.
   */
  setRegions(regions: Readonly<Record<string, Phaser.Geom.Rectangle>>): void {
    this.regions = Object.entries(regions).map(([key, rect]) => ({ key, rect: Phaser.Geom.Rectangle.Clone(rect) }))
    this.restart()
  }

  /** Re-measures against the current frame — after a theme change, or a new layout. */
  restart(): void {
    this.pending = [...this.regions]
  }

  /**
   * Takes at most one band per frame, and calls `onSettled` when the round finishes.
   *
   * One per frame because `snapshotArea` is one per frame by construction: the renderer holds a
   * single snapshot state and consumes it in `postRender`. Requesting two would silently keep
   * only the second.
   */
  update(onSettled: () => void): void {
    // **Restored here rather than in the callback, and that is a robustness decision.** The
    // capture happens in `postRender` of the frame the request was made in, so hiding for
    // exactly one frame is both correct and the shortest possible: by the time this runs again,
    // the snapshot has already been taken. Restoring in the callback instead would leave the
    // whole interface invisible for good if the callback never arrived — which is not
    // hypothetical, it is what a thrown error inside a stepped frame produced during testing.
    if (this.hiding) {
      this.uiCamera.setVisible(true)
      this.hiding = false
    }

    if (this.awaiting || this.pending.length === 0) return

    const region = this.pending[0]
    const rect = region.rect

    if (rect.width < 1 || rect.height < 1) {
      this.pending.shift()

      return
    }

    this.awaiting = true
    // Hidden for this frame only: the probe must see the world, not the interface standing on it.
    this.uiCamera.setVisible(false)
    this.hiding = true

    this.scene.renderer.snapshotArea(
      Math.max(0, Math.floor(rect.x)),
      Math.max(0, Math.floor(rect.y)),
      Math.max(1, Math.floor(rect.width)),
      Math.max(1, Math.floor(rect.height)),
      (image) => {
        this.awaiting = false
        this.pending.shift()

        // A `Color` arrives only from `snapshotPixel`; an area always yields an image, and this
        // narrows the union rather than asserting it away.
        if (image instanceof Phaser.Display.Color) return

        const samples = this.sample(image)

        if (samples.length === 0) return

        const mean = meanColor(samples)
        // The scrim is solved against the *worst* sample in the band rather than its mean: a
        // title half over bright sky and half over a dark hillside averages to a colour neither
        // half is, and the letters on the bright half are the ones nobody can read.
        const dark = scrimResultFor(worstSample(samples, TEXT_DARK), this.scrimColor, TEXT_DARK, TEXT_DARK)
        const light = scrimResultFor(worstSample(samples, TEXT_LIGHT), this.scrimColor, TEXT_LIGHT, TEXT_LIGHT)
        // Both candidate colours are solved for and the cheaper plate wins. Choosing the colour
        // first (on the mean) and then solving picks white over a sky that is bright *on average*
        // and then pays for it with an opaque slab; this asks which of the two the band actually
        // wants, which is the question.
        const chosen = light.alpha <= dark.alpha ? light : dark

        this.results.set(region.key, chosen)
        this.reportForDev(region.key, mean, chosen)

        if (this.pending.length === 0) onSettled()
      },
    )
  }

  destroy(): void {
    if (this.hiding) {
      this.uiCamera.setVisible(true)
      this.hiding = false
    }
    this.pending = []
    this.regions = []
    this.canvas = null
  }

  /** Downscales the captured band onto a small grid — the scaling is the averaging. */
  private sample(image: HTMLImageElement): number[] {
    if (!this.canvas) {
      this.canvas = document.createElement('canvas')
      this.canvas.width = GRID.x
      this.canvas.height = GRID.y
    }

    const context = this.canvas.getContext('2d', { willReadFrequently: true })

    if (!context) return []

    context.clearRect(0, 0, GRID.x, GRID.y)
    context.drawImage(image, 0, 0, GRID.x, GRID.y)

    const data = context.getImageData(0, 0, GRID.x, GRID.y).data
    const samples: number[] = []

    for (let i = 0; i < data.length; i += 4) {
      samples.push((data[i] << 16) | (data[i + 1] << 8) | data[i + 2])
    }

    return samples
  }

  /**
   * Publishes the numbers the acceptance asks for.
   *
   * The measurement has to be *reportable*, not just applied: "the text is legible" is a claim,
   * and the claim the redesign asks for is a contrast ratio per block per theme per viewport.
   * Gated to DEV like every other hook in this project, and the name is registered in
   * `check-bundle.mjs` so "we gated it" can be checked against "it is gone".
   */
  private reportForDev(key: string, background: number, result: ScrimResult): void {
    if (!import.meta.env.DEV) return

    const store = ((window as unknown as Record<string, unknown>).__menuContrast ??= {}) as Record<string, unknown>

    store[key] = {
      background: `#${background.toString(16).padStart(6, '0')}`,
      textColor: `#${result.textColor.toString(16).padStart(6, '0')}`,
      scrimAlpha: Number(result.alpha.toFixed(3)),
      contrast: Number(result.contrast.toFixed(2)),
      meetsTarget: result.meetsTarget,
    }
  }
}
