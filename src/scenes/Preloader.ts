import * as Phaser from 'phaser'
import { SFX_FILES, renderSfxUris } from '../audio/sfx'
import { ensureSkyTextures, skyPlateKey, SKYLINE_TEXTURE, skyTextureKey } from '../road/Backdrop'
import { BIOMES, groundPairForTheme } from '../road/biomes'
import { getRoadTheme } from '../road/themes'
import { DECOR_TEXTURES } from '../road/decorShapes'
import { themeIds } from '../road/themes'
import { t } from '../i18n/strings'
import { OBSTACLE_ART_KEYS } from '../run/obstacleArt'
import { UI_MASTER_KEYS } from '../ui/uiSprites'
import { CRITTER_TEXTURE_KEYS } from '../run/critterArt'
import { PICKUP_TEXTURES } from '../run/pickupArt'
import { SNAIL_FRAMES, SNAIL_TEXTURE, SNAIL_TEXTURE_SIZE, snailFrameKey } from '../run/snailArt'
import { INK } from '../run/artPalette'
import { bindLayout } from '../ui/layout'
import { getDisplayFontStack, isDisplayFontReady } from '../ui/font'
import { kitButton, type KitButton } from '../ui/kit'
import { KIT } from '../ui/kitPalette'
import { toCssColor } from '../ui/theme'
import { uiScale } from '../ui/uiScale'

/** The bar's geometry, in unscaled pixels. */
const BAR = { maxWidth: 420, height: 16, radius: 8, margin: 28, drop: 14 } as const

/**
 * Where the block sits, as fractions of viewport height.
 *
 * **⚠ The title was under the bar and the whole screen was one line across the middle**, with an
 * empty half above it and an empty half below. The wordmark is the thing the player is looking at
 * while they wait, so it goes in the sky where the front screen puts it; the ground line is the
 * bar's, and everything else is arranged around that one horizon.
 */
const ROWS = { bar: 0.68 } as const

/**
 * How much of the frame the mountain range fills, from its feet on the horizon upward.
 *
 * Named because the wordmark is placed against it: the title is centred in the sky *above* the
 * range rather than on a row of its own, so on a short landscape frame — where the horizon is only
 * 265px down and the range reaches to 148 — it cannot end up drawn over the peaks. A fixed row
 * cleared them by nine pixels at 844x390, which is not a clearance, it is a coincidence.
 */
const SKYLINE_HEIGHT_FRACTION = 0.3

/** The mascot's drawn width, as a fraction of the bar's own length. */
const SNAIL_WIDTH_FRACTION = 0.34

/** How fast the glide cycle runs while the snail is crawling, in frames per second. */
const GLIDE_FPS = 7

const TITLE_FONT_SIZE = 44
const TITLE_INK = { stroke: 0.17, shadowY: 0.11 } as const

/**
 * The slime the snail leaves behind it, which is what fills the bar.
 *
 * The trail's own two colours, lifted from `SlimeTrail` rather than invented, so the loading
 * screen's one piece of colour is the same green the game draws behind the mascot all run.
 */
const SLIME = { body: 0x9fc24a, core: 0xe8f7a6 } as const

/**
 * The loading screen.
 *
 * **⚠ IT IS JUDGED BY HOW FAST IT DISAPPEARS.** There is no minimum display time, no intro to sit
 * through and nothing that has to finish before `MainMenu` may start — if the whole load is in
 * cache, this scene is one frame long and that is the best outcome, not a bug. Everything below is
 * arranged so that being fast is free: the background is a canvas gradient, the bar is `Graphics`,
 * and the only file it waits on is one 22KB mascot frame that `Boot` fetched ahead of it.
 *
 * **The progress is the loader's own.** `this.load.on('progress')` and nothing else — no timer, no
 * eased catch-up, no "hold at 90%". A fake bar lies in one direction on a fast connection and in
 * the other on a slow one, and the player finds out which at exactly the moment they care.
 *
 * **The bar IS the character.** The snail crawls along it as the fraction rises and its slime fills
 * the part it has passed, so the scale is not a widget next to a mascot — it is what the mascot is
 * doing. Same sprite, same six-frame cycle, no new art.
 */
export class Preloader extends Phaser.Scene {
  private sky!: Phaser.GameObjects.Image
  private skyline?: Phaser.GameObjects.TileSprite
  /**
   * The ground the horizon stands on.
   *
   * **⚠ Without it the skyline stood on nothing.** The mountain strip is bottom-anchored to the
   * bar's row, so everything below that row was the sky gradient's pale bottom — a range of peaks
   * floating over open air, with the mascot crawling along the join. One filled band fixes it, and
   * it is the biome's own ground through the theme's own light, so the loading screen is the same
   * world the run opens in rather than a coloured rectangle that happens to be under a mountain.
   */
  private ground!: Phaser.GameObjects.Graphics
  private bar!: Phaser.GameObjects.Graphics
  private snail?: Phaser.GameObjects.Image
  private title?: Phaser.GameObjects.Text

  private failure?: { text: Phaser.GameObjects.Text; button: KitButton }

  private progress = 0
  private elapsedMs = 0
  private failed: string[] = []

  constructor() {
    super('Preloader')
  }

  init() {
    // **Built in `init`, not `create`**: `preload`'s `progress` events fire between the two, so
    // everything the bar needs has to exist before then or the first half of the load draws nothing.
    this.progress = 0
    this.elapsedMs = 0
    this.failed = []

    // Zero bytes and no theme file: `ensureSkyTextures` paints its gradient onto a canvas from the
    // active theme's own two sky colours. The road is deliberately not drawn — it is the expensive
    // half of the world and none of it is loaded yet.
    ensureSkyTextures(this)
    this.sky = this.add.image(0, 0, skyTextureKey(0)).setOrigin(0.5, 0)
    this.ground = this.add.graphics()
    this.bar = this.add.graphics()

    if (this.textures.exists(SNAIL_TEXTURE)) this.createSnail()
    // **⚠ And the range needs the same guard the mascot has.** Both are built from a
    // `filecomplete` event, which does not fire for a texture the manager already holds — so on
    // any entry where the strip is already loaded the horizon would have been drawn with nothing
    // standing on it. The snail carried this guard and the skyline did not.
    if (this.textures.exists(SKYLINE_TEXTURE)) this.createSkyline()

    // The mascot's remaining frames and the mountain strip both arrive during the load. Each is
    // picked up the moment it lands rather than waited for: the screen is already up.
    this.load.on(`filecomplete-image-${SNAIL_TEXTURE}`, () => this.createSnail())
    this.load.on(`filecomplete-image-${SKYLINE_TEXTURE}`, () => this.createSkyline())

    this.load.on('progress', (progress: number) => {
      this.progress = progress
    })
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      // Everything this screen loads is art the game cannot be played without, so any failure
      // here stops the handover. The one file whose absence is survivable is no longer on this
      // screen at all — see `audio/musicFile.ts`.
      this.failed.push(file.key)
    })

    bindLayout(this, (width, height) => this.layout(width, height))

    // See `tick` for why this is the game's clock and not the scene's.
    const tick = (time: number, delta: number): void => this.tick(time, delta)

    this.game.events.on(Phaser.Core.Events.STEP, tick)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.game.events.off(Phaser.Core.Events.STEP, tick))
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.game.events.off(Phaser.Core.Events.STEP, tick))
  }

  preload() {
    // Most of the game's sound effects are rendered here rather than shipped: a tone from
    // arithmetic is self-generated by construction, so there is no provenance row to keep and
    // nothing in `dist/`.
    for (const { key, uri } of renderSfxUris()) this.load.audio(key, uri)
    // **The two that are recordings**, because a waveform cannot sound like an object being struck
    // — see `SFX_FILES` for how each was picked and `AUDIO-SOURCES.md` for their CC0 rows. Loaded
    // through the same loader and under the same keys, so nothing downstream knows the difference.
    for (const [key, path] of Object.entries(SFX_FILES)) this.load.audio(key, `assets/${path}`)

    // First in the queue because it is the only remaining thing the loading screen itself shows.
    this.load.image(SKYLINE_TEXTURE, 'assets/sky/skyline.png')

    // The mascot's other five frames. `snail-0` came from `Boot`; asking again would be a second
    // request for a file already in the texture manager.
    for (let i = 1; i < SNAIL_FRAMES; i++) {
      this.load.image(snailFrameKey(i), `assets/snail/${snailFrameKey(i)}.png`)
    }

    // All seven sky plates, not just the active theme's: the set is ~330KB, so the lazy per-theme
    // path `applyTheme` was built to host would trade a runtime load and a "plate not ready" state
    // for a fraction of boot. That hook stays the right place if a theme grows a real sprite set.
    for (const theme of themeIds()) this.load.image(skyPlateKey(theme), `assets/sky/${theme}.png`)

    // Scenery, obstacles and pickups, under **exactly the keys the generators would have used**:
    // each of those modules draws a placeholder only when its key does not exist, so arriving first
    // is all a real sprite has to do. The keys are asked for through the modules that declare them
    // rather than spelled out — `OBSTACLE_VARIANTS` has changed twice, and a literal list here
    // would keep loading five of six files with nothing to say which one went missing.
    for (const { key } of DECOR_TEXTURES) {
      this.load.image(key, `assets/decor/${key.replace('decor-', '')}.png`)
    }
    for (const key of OBSTACLE_ART_KEYS) this.load.image(key, `assets/obstacle/${key}.png`)
    for (const key of CRITTER_TEXTURE_KEYS) this.load.image(key, `assets/critter/${key}.png`)
    // The interface's own masters. Greyscale value maps -- `ui/uiSprites.ts` colours them at
    // runtime, which is what lets the primary button take the active theme's accent.
    for (const key of UI_MASTER_KEYS) this.load.image(key, `assets/ui/${key}.png`)
    for (const key of Object.values(PICKUP_TEXTURES).flat()) {
      this.load.image(key, `assets/pickup/${key}.png`)
    }

    this.load.setPath('assets')
    this.load.audio('sfx', 'audio/blip.wav')
    // **⚠ The music is NOT loaded here, and that is the point.** It is 1.85MB against 4.95MB of
    // everything else, so **37% of this bar** was a two-minute stereo mp3 the front screen does not
    // need to exist — on a phone over mobile data, several seconds of a player looking at a
    // loading screen before anything they can touch. `MainMenu` asks for it once it is up; see
    // `audio/musicFile.ts`, which also owns the rendered fallback that used to live below.
  }

  create() {
    // **⚠ A failed file stops the handover rather than being ignored.** Before this the loader's
    // error event had no listener at all: a 404 left the bar frozen wherever it stopped, forever,
    // with nothing on screen to say why and nothing to press. The game is not startable with half
    // its art, so the honest outcome is a message and a retry.
    if (this.failed.length > 0) {
      this.showFailure()

      return
    }

    this.scene.start('MainMenu')
  }

  /**
   * The mascot, once its first frame exists.
   *
   * Created rather than shown, because `Boot` may still be fetching it when this scene starts — and
   * an `Image` built against a missing key is Phaser's green placeholder, which is worse than
   * nothing on the first screen of the game.
   */
  private createSnail(): void {
    if (this.snail) return

    this.snail = this.add.image(0, 0, SNAIL_TEXTURE).setOrigin(0.5, 1)
    this.layout(this.scale.width, this.scale.height)
  }

  private createSkyline(): void {
    if (this.skyline) return

    // A `TileSprite` for the same reason `Backdrop` uses one: the strip is authored to wrap, so a
    // frame wider than it repeats instead of stretching into spires.
    this.skyline = this.add.tileSprite(0, 0, 1, 1, SKYLINE_TEXTURE).setOrigin(0.5, 1)
    // Behind the bar and the mascot, in front of the sky.
    // Above the ground it stands on, below the bar the mascot crawls along.
    this.children.moveBelow(this.skyline, this.bar)
    this.layout(this.scale.width, this.scale.height)
  }

  /**
   * The wordmark, once the display face is in `document.fonts`.
   *
   * **The title is drawn when the face is there, never before.** A `Text` object does not repaint
   * when a web font arrives after it has already drawn, so setting it early and hoping is a
   * guaranteed flash of system sans on the first screen of the game. `main.ts` gives the face a
   * 200ms grace and then boots regardless, so this has to be able to happen late.
   *
   * **⚠ Polled from `update` rather than chained off the promise, and the promise version shipped
   * broken.** It was `whenDisplayFontReady().then(createTitle)` with an `isActive()` guard inside —
   * and on a warm cache the face is ready *before* `Preloader.init` runs, so the call happened
   * during `init`, where the scene's status is INIT rather than RUNNING, hit the guard and returned.
   * Nothing called again: the loading screen simply never had a title. A poll has no ordering to
   * get wrong and costs one boolean a frame.
   */
  private createTitle(): void {
    if (this.title) return

    this.title = this.add
      .text(0, 0, t('gameTitle'), {
        fontFamily: getDisplayFontStack(),
        fontSize: TITLE_FONT_SIZE,
        color: toCssColor(KIT.coin),
      })
      .setOrigin(0.5, 0.5)
    this.layout(this.scale.width, this.scale.height)
  }

  /**
   * What the player sees when a file did not arrive.
   *
   * A message and a button, rather than a bar that never fills. Retry is `scene.restart()`: the
   * loader keeps what it already has in the texture manager, so a retry re-requests only what is
   * missing — and the same error path catches it again if the file is still gone.
   */
  private showFailure(): void {
    const message = this.add
      .text(0, 0, t('loadFailed'), {
        fontFamily: getDisplayFontStack(),
        fontSize: 20,
        color: toCssColor(KIT.rim),
        align: 'center',
        wordWrap: { width: Math.max(200, this.scale.width - 80) },
      })
      .setOrigin(0.5)
      .setStroke(toCssColor(INK), 5)
    const button = kitButton(this, t('retry'), { primary: true, solid: true, fontSize: 24 })

    button.container.setInteractive()
    button.container.on(Phaser.Input.Events.POINTER_UP, () => this.scene.restart())

    // **The loading screen stops being a loading screen.** Leaving the bar and the mascot up under
    // an error message says the load is still going, which is the one thing that is no longer true.
    this.snail?.setVisible(false)
    this.title?.setVisible(false)
    this.failure = { text: message, button }
    console.error('[preload] assets failed to load', this.failed)
    this.layout(this.scale.width, this.scale.height)
  }

  /**
   * One frame of the loading screen.
   *
   * ## ⚠ It is driven by the GAME's clock, and `update` is not called while a scene is loading
   *
   * This was `update`, and `update` never ran: Phaser steps a scene only once it is RUNNING, and a
   * scene spends the whole of its own `preload` in LOADING. Measured in the running game —
   * `elapsedMs` stayed at **0 across 60 stepped frames** while the loader's progress went to 0.371.
   * So for the entire load the bar never filled, the mascot never took a step, and the title was
   * never created, because all three are decided here. What the player got was a still frame with
   * an empty bar on it, which is exactly how it was reported.
   *
   * `Phaser.Core.Events.STEP` fires on every frame the game takes whatever any scene's status is —
   * the same channel `Boot` already uses for `POST_RENDER` — so the screen animates from the first
   * frame of the load rather than from the last. Unbound on shutdown, or it keeps ticking a scene
   * that has handed over.
   */
  private tick(_time: number, delta: number): void {
    this.elapsedMs += delta

    // Not once the screen has failed: the wordmark's own row is the retry button's now, and a
    // title created after `showFailure` would be laid out by a branch that no longer runs.
    if (!this.title && !this.failure) this.createTitle()
    // **The face is upgraded in place rather than waited for.** A `Text` does not repaint when a
    // web font arrives after it has drawn — but it does when it is *told*, and `setFontFamily`
    // dirties it. So the title exists from the first frame in whatever stack is current, and
    // becomes Titan One the moment the file lands. The old gate waited for the real face and
    // therefore drew nothing at all on a boot where the font failed.
    if (this.title && isDisplayFontReady() && this.title.style.fontFamily !== getDisplayFontStack()) {
      this.title.setFontFamily(getDisplayFontStack())
      this.layout(this.scale.width, this.scale.height)
    }

    this.drawBar()
  }

  layout(width: number, height: number): void {
    const scale = uiScale(width)

    this.sky.setPosition(width / 2, 0)
    this.sky.setDisplaySize(width, height)

    // **The ground, drawn from the same pair the world's own first biome uses.** `groundPairForTheme`
    // is what the road mesh bakes its verge from, so the band under the horizon here is the colour
    // the player is about to be standing on rather than a guess at one.
    const theme = getRoadTheme()
    const [dark, light] = groundPairForTheme(BIOMES[0].ground, theme.road[0], theme.road[1], undefined, theme.groundLight)
    const horizon = height * ROWS.bar

    this.ground.clear()
    this.ground.fillStyle(dark, 1)
    this.ground.fillRect(0, horizon, width, height - horizon)
    // A lighter strip along the top of it, which is what stops a flat fill reading as a wall: the
    // ground nearest the horizon is the ground furthest away, and it is lighter for the same reason
    // every distant surface in this game is.
    this.ground.fillStyle(light, 1)
    this.ground.fillRect(0, horizon, width, Math.max(2, (height - horizon) * 0.12))

    if (this.skyline) {
      // Its own aspect in both axes — a mountain has shape in both, and scaling them apart is what
      // turns peaks into spires. See `SKYLINE_LAYER`.
      const tileScale = Math.max(0.25, (height * SKYLINE_HEIGHT_FRACTION) / this.skyline.texture.getSourceImage().height)

      this.skyline.setTileScale(tileScale, tileScale)
      this.skyline.setSize(width, height * SKYLINE_HEIGHT_FRACTION)
      this.skyline.setPosition(width / 2, horizon)
    }

    if (this.title && !this.failure) {
      const size = TITLE_FONT_SIZE * scale

      this.title.setFontSize(size)
      this.title.setStroke(toCssColor(INK), size * TITLE_INK.stroke)
      this.title.setShadow(0, size * TITLE_INK.shadowY, toCssColor(INK), 0, true, true)
      this.title.setPosition(width / 2, height * (ROWS.bar - SKYLINE_HEIGHT_FRACTION) * 0.5)
    }

    if (this.failure) {
      this.failure.text.setPosition(width / 2, height * (ROWS.bar - SKYLINE_HEIGHT_FRACTION) * 0.5)
      this.failure.text.setWordWrapWidth(Math.max(200, width - 80 * scale))
      this.failure.button.setFontSize(24 * scale)
      this.failure.button.container.setPosition(width / 2, height * ROWS.bar)
    }

    this.drawBar()
  }

  /** The bar's own box, so the bar, the fill and the snail cannot disagree about where it is. */
  private barRect(): { x: number; y: number; width: number; height: number } {
    const scale = uiScale(this.scale.width)
    const width = Math.min(BAR.maxWidth * scale, this.scale.width - BAR.margin * 2 * scale)
    const height = BAR.height * scale

    // **Below the horizon, not centred on it.** Centred, half the bar was in the sky and the mascot
    // crawled along the join between the two — with the ground under it the bar is a road *across*
    // the ground, which is what it is meant to read as, and the mountains behind it are standing on
    // something rather than on the bar itself.
    const y = this.scale.height * ROWS.bar + BAR.drop * uiScale(this.scale.width)

    return { x: this.scale.width / 2 - width / 2, y, width, height }
  }

  private drawBar(): void {
    const rect = this.barRect()
    const scale = uiScale(this.scale.width)
    const radius = BAR.radius * scale

    this.bar.clear()

    if (this.failure) return

    this.bar.fillStyle(KIT.plate, 0.55)
    this.bar.fillRoundedRect(rect.x, rect.y, rect.width, rect.height, radius)

    // The slime: the part the snail has already crawled over. Drawn as the trail's own two greens,
    // the darker body under a lighter core, which is what `SlimeTrail` puts on the road.
    const filled = rect.width * this.progress

    if (filled > radius) {
      this.bar.fillStyle(SLIME.body, 0.95)
      this.bar.fillRoundedRect(rect.x, rect.y, filled, rect.height, radius)
      this.bar.fillStyle(SLIME.core, 0.5)
      this.bar.fillRoundedRect(rect.x, rect.y + rect.height * 0.22, filled, rect.height * 0.34, radius * 0.5)
    }

    this.bar.lineStyle(Math.max(1.5, 2 * scale), KIT.rim, 0.55)
    this.bar.strokeRoundedRect(rect.x, rect.y, rect.width, rect.height, radius)

    if (!this.snail) return

    // **The snail rides the bar rather than sitting beside it.** Its foot is on the bar's own top
    // edge and its x is the progress fraction across the same rectangle the fill uses, so the front
    // of the slime is always exactly under it — the scale and the character are one object.
    const drawnWidth = rect.width * SNAIL_WIDTH_FRACTION
    const aspect = SNAIL_TEXTURE_SIZE.height / SNAIL_TEXTURE_SIZE.width

    this.snail.setDisplaySize(drawnWidth, drawnWidth * aspect)
    this.snail.setPosition(rect.x + filled, rect.y + rect.height * 0.55)
    this.snail.setTexture(this.glideFrame())
  }

  /**
   * Which glide frame to show.
   *
   * **On a clock rather than on distance, which is the one place this differs from the game.** In a
   * run the cycle advances with the ground travelled, because an animation that ripples at a fixed
   * rate while the world speeds up has come loose from it. Here there is no ground: what the player
   * should read is that the creature is alive and working, and that is a wall-clock cycle.
   *
   * Falls back to frame 0 for any frame that has not loaded yet, so the cycle starts as a still and
   * becomes an animation partway through the load rather than flickering into Phaser's placeholder.
   */
  private glideFrame(): string {
    const key = snailFrameKey(Math.floor((this.elapsedMs / 1000) * GLIDE_FPS))

    return this.textures.exists(key) ? key : SNAIL_TEXTURE
  }
}
