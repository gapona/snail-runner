import * as Phaser from 'phaser'
import { renderSfxUris } from '../audio/sfx'
import { skyPlateKey } from '../road/Backdrop'
import { DECOR_TEXTURES } from '../road/decorShapes'
import { themeIds } from '../road/themes'
import { bindLayout } from '../ui/layout'
import { createBrand, type Brand } from '../ui/brand'
import { getTheme, neonProgressBar, type NeonProgressBar } from '../ui/theme'
import { uiScale } from '../ui/uiScale'

const MAX_BAR_WIDTH = 468
const BAR_HEIGHT = 32
// Keeps the bar off the edges on narrow viewports (e.g. 390px wide) instead of
// overflowing them at a fixed 468px.
const BAR_MARGIN = 40

/** Where the wordmark's centre sits, and how far under it the bar hangs. See `layout`. */
const BRAND_CENTER_FRACTION = 0.42
const BAR_GAP = 54

export class Preloader extends Phaser.Scene {
  private brand!: Brand
  private bar!: NeonProgressBar
  private barWidth = MAX_BAR_WIDTH
  private barY = 0
  private progress = 0

  constructor() {
    super('Preloader')
  }

  init() {
    // Built in init(), not create(): preload()'s 'progress' events fire between init()
    // and create(), so the bar has to exist before that to have anything to update.
    //
    // The branding goes in first so it sits behind the bar in the display list. Its two textures
    // were loaded by `Boot` for exactly this moment — see that scene's own note on why the
    // loading screen cannot show art it is itself still loading.
    this.brand = createBrand(this)
    // The kit's own progress widget rather than two bare rectangles: the loading screen is the
    // one screen a certification reviewer is guaranteed to see, and it has no business being the
    // only part of the game drawn in a different visual language from everything else.
    this.bar = neonProgressBar(this)

    this.load.on('progress', (progress: number) => {
      this.progress = progress
      this.layoutBar()
    })

    bindLayout(this, (width, height) => this.layout(width, height))
  }

  preload() {
    // The game's sound effects are rendered here rather than shipped: they are self-generated
    // by construction, so there is no provenance row to keep in AUDIO-SOURCES.md and nothing
    // in dist/. Loaded as data URIs through the ordinary loader, which is what makes them work
    // on the HTML5 Audio backend as well as WebAudio — see src/audio/synth.ts.
    for (const { key, uri } of renderSfxUris()) this.load.audio(key, uri)

    // All six sky plates, not just the active theme's. The whole set is ~330KB, so the lazy
    // per-theme load `applyTheme` was built to host would trade a runtime load path and a
    // "plate not ready yet" state for 280KB of boot — not a trade worth making. That hook is
    // still the right place if a theme ever grows a real per-theme sprite set.
    for (const theme of themeIds()) this.load.image(skyPlateKey(theme), `assets/sky/${theme}.png`)

    // Scenery, loaded under **exactly the keys the generators would have used**. That is the
    // whole switch: `createDecorTextures` checks whether its key already exists and draws a
    // placeholder only when it does not, so arriving first is all a real sprite has to do to take
    // over. Nothing downstream branches on art vs drawn.
    for (const { key } of DECOR_TEXTURES) {
      this.load.image(key, `assets/decor/${key.replace('decor-', '')}.png`)
    }

    // The rail shooter's ship, enemy and weapon-effect sprites were loaded here. None of them
    // survived the genre change, and their PNGs are gone from `public/assets/` with them — the
    // snail and the three obstacle classes are chunk 7's, and until then both are drawn rather
    // than loaded, which is the same fallback every art lookup in this project already has.

    this.load.setPath('assets')
    this.load.audio('sfx', 'audio/blip.wav')
    this.load.audio('music', 'audio/blip.wav')
  }

  create() {
    this.scene.start('MainMenu')
  }

  layout(width: number, height: number): void {
    // The wordmark sits above the middle and the bar under it, so the two read as one screen
    // rather than as a logo with an unrelated widget beneath. `BRAND_CENTER_FRACTION` is above
    // 0.5 by a little because the bar and its own margin hang below the mark, and a block that is
    // *optically* centred sits slightly high of the geometric centre.
    this.brand.layout(width, height, height * BRAND_CENTER_FRACTION, uiScale(width))

    this.barWidth = Math.min(MAX_BAR_WIDTH, width - BAR_MARGIN * 2)
    this.barY = Math.min(height - BAR_MARGIN, this.brand.bottom + BAR_GAP)
    this.layoutBar()
  }

  private layoutBar(): void {
    // `neonProgressBar` owns no position state — the caller hands it fresh geometry on every
    // call, which is why the width and the row are fields on this scene rather than on it.
    this.bar.draw(
      this.scale.width / 2 - this.barWidth / 2,
      this.barY - BAR_HEIGHT / 2,
      this.barWidth,
      BAR_HEIGHT,
      this.progress,
      getTheme().colors.primary,
    )
  }
}
