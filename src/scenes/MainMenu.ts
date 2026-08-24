import * as Phaser from 'phaser'
import { AUTO_THEME_ID } from '../save/types'
import { DEFAULT_ROAD_THEME } from '../road/themes'
import { bindAction } from '../platform/input'
import { gameReady } from '../platform/yt'
import { t } from '../i18n/strings'
import type { ShopItem } from '../shop/catalog'
import { themeIdFromItem } from '../shop/themeCatalog'
import { applyTheme } from '../road/applyTheme'
import { getRoadThemeId } from '../road/themes'
import { getState, mutate } from '../save/store'
import { bindLayout } from '../ui/layout'
import { kitButton, type KitButton } from '../ui/kit'
import { toCssColor } from '../ui/theme'
import { getDisplayFontStack } from '../ui/font'
import { uiScale } from '../ui/uiScale'
import { buttonBand, titleBand } from '../ui/menuLayout'
import { ContrastProbe } from '../ui/contrastProbe'
import { ensureScrimTexture, SCRIM_TEXTURE } from '../ui/scrimTexture'
import { WorldView } from '../run/WorldView'
import { SPEED_BASE } from '../run/constants'

/** Base font sizes, scaled by `uiScale(width)` and by the button band's own fit. */
const TITLE_FONT_SIZE = 64
const PLAY_FONT_SIZE = 30
const SECONDARY_FONT_SIZE = 20

/** How fast the menu's world travels, as a fraction of the run's speed. */
const MENU_SPEED_FRACTION = 0.55

/** The title's left edge, as a fraction of width. */
const TITLE_LEFT_FRACTION = 0.08

/**
 * How much of the title band the wordmark may fill, and how much of the frame's width.
 *
 * **Both are fits, not preferences, and the height one is the reason this exists.** `uiScale`
 * scales on *width*, so at 844x390 — a landscape phone — it returns 1 and the title kept its full
 * 64px while the band it has to live in is 55px tall. Measured: the wordmark ran from y=70 to
 * y=140 there, i.e. through the HUD's rows *and* into `ENEMY_BAND`, breaking the one rule the
 * whole layout is built on. Every element that is sized in points and placed in a band needs the
 * same second pass the button stack already had.
 */
const TITLE_BAND_FILL = 0.72
const TITLE_MAX_WIDTH_FRACTION = 0.84

/** Gaps inside the button stack, in unscaled pixels. */
const PLAY_MIN_WIDTH = 220
const BUTTON_GAP = 18
const SECONDARY_GAP = 22

/** How close the secondary row may come to the edges of the frame. */
const SIDE_MARGIN = 16

/** The entry cascade, in milliseconds. Delays are from scene create; see the redesign's table. */
const ENTRY = {
  title: { delay: 120, duration: 320, rise: 16 },
  play: { delay: 240, duration: 260 },
  secondary: { delay: 340, duration: 220 },
} as const

/** The exit: interface out, world up to speed, then the handover. */
const EXIT = { fadeMs: 180, accelerateMs: 600 } as const

/** The idle pulse on the primary action. */
const PLAY_PULSE = { scale: 1.03, periodMs: 2000 } as const

/**
 * The front screen: the game's own world, running, with an interface laid over the rows a run
 * leaves empty.
 *
 * **It renders the real thing rather than a picture of it** — `WorldView` is the same class
 * `RunScene` builds its world from, on the same circuit machinery, at a little over half the
 * run's speed. What that replaced, back in the rail shooter, was a static illustration of a
 * highway with white text on a pale sky measuring well under 3:1; the argument survives the
 * genre change untouched, and so does the code.
 *
 * **Nothing here occupies a row that means something in a run.** The title sits high on clear
 * sky, the buttons sit on the near ground a run deliberately leaves empty, and the HUD's own rows
 * at the top of the frame are left blank so that the distance, the lives and the boost meter
 * appear *into* empty space rather than pushing the eye somewhere new. That is what lets the
 * transition into play be nothing but a fade of the interface: the world does not have to move,
 * so it does not have to be hidden while it moves. See `ui/menuLayout.ts`.
 *
 * **The snail is not here yet.** The rail shooter flew its own ship across this screen on a
 * script, through the real spring; the mascot's menu appearance is chunk 7's, and `update` marks
 * where it goes.
 *
 * **Text legibility is measured, not chosen.** Seven themes over a world that is a different
 * colour at every point of the track cannot be served by one text colour and one plate alpha —
 * see `ui/contrastProbe.ts` for what is sampled and `ui/scrim.ts` for what is solved from it.
 */
export class MainMenu extends Phaser.Scene {
  private world!: WorldView
  private uiCamera!: Phaser.Cameras.Scene2D.Camera

  private title!: Phaser.GameObjects.Text
  private titleScrim!: Phaser.GameObjects.Image
  private buttonScrim!: Phaser.GameObjects.Image
  private playButton!: KitButton
  private shopButton!: KitButton
  private settingsButton!: KitButton

  private contrast!: ContrastProbe
  private elapsedMs = 0
  private leaving = false
  private playPulse?: Phaser.Tweens.Tween

  constructor() {
    super('MainMenu')
  }

  create() {
    this.elapsedMs = 0
    this.leaving = false

    // Built exactly as the play scene builds it, on the menu's own circuit and at a little over
    // half its speed — see `road/circuits.ts` for why the menu gets a different one.
    this.world = new WorldView(this, {
      circuit: 'menu',
      speed: SPEED_BASE * MENU_SPEED_FRACTION,
      decorSeed: 4242,
    })

    ensureScrimTexture(this)
    // Created before the text so the display list puts them behind it; both are positioned and
    // sized in `layout` and left invisible until the probe has measured what is under them.
    this.titleScrim = this.add.image(0, 0, SCRIM_TEXTURE).setAlpha(0)
    this.buttonScrim = this.add.image(0, 0, SCRIM_TEXTURE).setAlpha(0)

    this.title = this.add
      .text(0, 0, t('gameTitle'), {
        fontFamily: getDisplayFontStack(),
        fontSize: TITLE_FONT_SIZE,
        color: '#ffffff',
      })
      .setOrigin(0, 0.5)

    // The front screen's three buttons are the same widgets `Settings` and `Shop` are built from
    // (`ui/kit.ts`), which is the point: the menu, the overlays and the HUD now share one palette
    // instead of the menu showing the world and the overlays showing the template's neon demo.
    this.playButton = kitButton(this, t('play'), {
      primary: true,
      fontSize: PLAY_FONT_SIZE,
      fontFamily: getDisplayFontStack(),
    })
    this.shopButton = kitButton(this, t('shop'), { fontSize: SECONDARY_FONT_SIZE })
    this.settingsButton = kitButton(this, t('settings'), { fontSize: SECONDARY_FONT_SIZE })

    // World/UI split, same contract as `RailScene`: `uiCamera` draws the interface 1:1 and must
    // not draw the world, and `cameras.main` must not draw the interface.
    this.uiCamera = this.cameras.add(0, 0, this.scale.width, this.scale.height)
    // Built after the camera, because it hides that camera for the frame it captures — see
    // `ContrastProbe`.
    this.contrast = new ContrastProbe(this, this.uiCamera)
    this.uiCamera.ignore(this.worldObjects())
    this.cameras.main.ignore(this.uiObjects())

    this.bindActions()
    bindLayout(this, (width, height) => this.layout(width, height))
    this.playEntry()

    this.exposeForTesting()

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      // **Tweens are killed explicitly.** `Systems.shutdown()` does not stop them, and this scene
      // is re-entered every time a run ends — without this, a second visit runs two copies of the
      // idle pulse on the same button, at whatever phase each happened to be at.
      this.tweens.killAll()
      this.playPulse = undefined
      this.contrast.destroy()
      this.world.destroy()
    })

    // The world is up, the interface is interactable, the preloader is gone.
    gameReady()
  }

  /**
   * The DEV-only handle the menu's acceptance is measured through.
   *
   * Every claim the redesign asks for is a number taken from the running scene — the contrast of
   * each text block on each theme, which rows each element occupies at each viewport, how many
   * tweens are alive after a second visit. None of those can be read from outside: the theme, the
   * probe and the tween manager are all module or scene state, and a test script that imported
   * the modules itself would get its own disconnected copies (see CLAUDE.md "Audio Layer").
   *
   * Gated like every other hook in this project, and `__menu` is registered in
   * `check-bundle.mjs` so that "we gated it" can be checked against "it is gone" — which is
   * exactly the check that caught the first version of this method.
   *
   * **The guard is inside the method, not at the call site, and that is the whole trick.**
   * Gating the *call* removes the call and leaves the method on the class, unreferenced, with
   * its string literals intact — `check-bundle` found `__menu` in the production bundle that
   * way. An early return on `import.meta.env.DEV` makes the body itself dead code, which is
   * what the minifier can actually drop. Same shape as `ContrastProbe.reportForDev`.
   */
  private exposeForTesting(): void {
    if (!import.meta.env.DEV) return

    ;(window as unknown as Record<string, unknown>).__menu = {
      contrast: () => ({ title: this.contrast.titleResult, buttons: this.contrast.buttonResult }),
      setTheme: (id: string) => {
        if (!applyTheme(this, id)) return false
        this.refreshAfterThemeChange()

        return true
      },
      bounds: () => ({
        viewport: { width: this.scale.width, height: this.scale.height },
        title: rectOf(this.title.getBounds()),
        play: rectOf(this.playButton.container.getBounds()),
        shop: rectOf(this.shopButton.container.getBounds()),
        settings: rectOf(this.settingsButton.container.getBounds()),
      }),
      tweens: () => this.tweens.getTweens().length,
      leave: () => this.leave(),
    }
  }

  private worldObjects(): Phaser.GameObjects.GameObject[] {
    return [...this.world.gameObjects]
  }

  private uiObjects(): Phaser.GameObjects.GameObject[] {
    return this.uiAlphaTargets()
  }

  /**
   * The secondary buttons, left to right, as one list.
   *
   * **⚠ There were two lists and they disagreed, which is how the third button shipped invisible.**
   * `playEntry` sets every `uiAlphaTargets()` object to alpha 0 and then fades in an *explicitly
   * named* set; adding `Loadout` to the first list and not the second left it correctly positioned,
   * correctly sized, interactive, and drawn at alpha 0 — a button that measures as present at every
   * viewport and cannot be seen. Every consumer now reads this one accessor: the entry cascade, the
   * exit fade, the layout, the scrim and the contrast probe's regions.
   */
  private secondaryButtons(): KitButton[] {
    return [this.shopButton, this.settingsButton]
  }

  /** The same objects, typed as things that have an alpha — for the entry and exit tweens. */
  private uiAlphaTargets(): (Phaser.GameObjects.Image | Phaser.GameObjects.Text | Phaser.GameObjects.Container)[] {
    return [
      this.titleScrim,
      this.buttonScrim,
      this.title,
      this.playButton.container,
      ...this.secondaryButtons().map((button) => button.container),
    ]
  }

  private bindActions(): void {
    // 'primary' must fire at most once — starting the same scene twice mid-transition is unsafe,
    // and the exit here runs for `EXIT.accelerateMs` before the handover, which is a long window.
    // **Play starts the run.** The rail shooter's Play opened a level list, which was the honest
    // shape once it had levels; an endless runner has exactly one place to go, and a menu that
    // costs a tap to reach it is a menu that has forgotten what it is for.
    bindAction(this, 'primary', { pointer: this.playButton.container, keys: ['SPACE', 'ENTER'] }, () => {
      if (this.leaving) return
      this.leave()
    })

    bindAction(this, 'openSettings', { pointer: this.settingsButton.container, keys: ['ESC'] }, () => {
      this.scene.pause()
      this.scene.launch('Settings', { opener: 'MainMenu' })
    })

    bindAction(this, 'openShop', { pointer: this.shopButton.container }, () => {
      this.scene.pause()
      this.scene.launch('Shop', {
        opener: 'MainMenu',
        // Themes are the only thing this game sells: the rail shooter's weapons, hulls and
        // loadout slots went with the combat layer, and a runner's shop is cosmetics plus the
        // coins that buy them.
        onSelect: (item: ShopItem) => this.selectItem(item),
        // Themes compare against the *saved selection*, not against the theme currently on screen:
        // `auto` is a selection and not a theme, so it has no road theme to be equal to, and while
        // it is chosen the menu still renders in some real theme.
        isSelected: (item: ShopItem) => themeIdFromItem(item.id) !== null && themeIdFromItem(item.id) === getState().selectedTheme,
      })
    })
  }

  /** Applies a shop selection. Every item in this game's catalogue is a theme. */
  private selectItem(item: ShopItem): void {
    const themeId = themeIdFromItem(item.id)

    if (!themeId) return

    // `auto` is the absence of an override. The rail shooter's levels each carried their own
    // authored light for it to defer to; an endless run has one continuous track, so `auto`
    // resolves to the default theme and the biomes do the varying.
    const applied = themeId === AUTO_THEME_ID ? DEFAULT_ROAD_THEME : themeId

    // `applyTheme` swaps the pixels behind live texture keys, so it may only run while nothing
    // is drawing them. **That precondition is not free**: this scene draws the world itself, and
    // it is paused (not stopped) while the shop is open — paused means its `update` does not run,
    // so no render of ours can be in flight when this executes.
    if (!applyTheme(this, applied)) return

    this.refreshAfterThemeChange()

    mutate((state) => {
      state.selectedTheme = themeId
    })
    // The world's colours are read through getters, but the two scrims were solved against the
    // *old* theme's sky. Re-measure rather than keep a plate tuned for a palette that is gone.
    this.contrast.restart()
  }

  /**
   * Rebuilds everything a theme swap invalidated, and re-measures the text against the new sky.
   *
   * The world half is `WorldView.refreshTheme` — see it for what `applyTheme` leaves dangling.
   * The measurement half is not optional either: both plates were solved against the *previous*
   * theme's colours, and a plate tuned for a palette that is gone is worse than no plate at all,
   * because it is dark where nothing needed darkening.
   */
  private refreshAfterThemeChange(): void {
    this.world.refreshTheme(this, this.scale.width, this.scale.height)
    this.contrast.restart()
  }

  /** The entry cascade. The world is already running, so it has no entrance of its own. */
  private playEntry(): void {
    for (const object of this.uiAlphaTargets()) object.setAlpha(0)

    this.tweens.add({
      targets: this.title,
      alpha: 1,
      delay: ENTRY.title.delay,
      duration: ENTRY.title.duration,
      ease: 'Cubic.easeOut',
    })
    this.tweens.add({
      targets: this.title,
      y: { from: this.title.y + ENTRY.title.rise, to: this.title.y },
      delay: ENTRY.title.delay,
      duration: ENTRY.title.duration,
      ease: 'Cubic.easeOut',
    })
    this.tweens.add({
      targets: this.playButton.container,
      alpha: 1,
      scale: { from: 0.92, to: 1 },
      delay: ENTRY.play.delay,
      duration: ENTRY.play.duration,
      ease: 'Back.easeOut',
      onComplete: () => this.startPlayPulse(),
    })
    this.tweens.add({
      // The accessor, never a hand-written pair — see `secondaryButtons`.
      targets: this.secondaryButtons().map((button) => button.container),
      alpha: 1,
      delay: ENTRY.secondary.delay,
      duration: ENTRY.secondary.duration,
      ease: 'Cubic.easeOut',
    })
    // The scrims fade with whatever they back, but only once the probe has decided how dark they
    // need to be — see `applyContrast`.
  }

  /**
   * The idle pulse on the primary action, which stops the moment the pointer is on it.
   *
   * A pulse is an invitation, and an invitation the player has already accepted is noise — worse,
   * a button that keeps moving under the cursor is a button that is harder to hit.
   */
  private startPlayPulse(): void {
    this.playPulse = this.tweens.add({
      targets: this.playButton.container,
      scale: PLAY_PULSE.scale,
      duration: PLAY_PULSE.periodMs / 2,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    })

    this.playButton.container.on(Phaser.Input.Events.POINTER_OVER, () => {
      this.playPulse?.pause()
      this.playButton.container.setScale(1)
    })
    this.playButton.container.on(Phaser.Input.Events.POINTER_OUT, () => this.playPulse?.resume())
  }

  /**
   * Hands over to the run **without a fade to black**, which is the whole point of the redesign.
   *
   * The interface leaves, the world speeds up to the run's own rail speed, and only then does the
   * scene change. Nothing is hidden during the change because nothing has to move: the horizon,
   * the palette and the fog are the same numbers on both sides of it.
   */
  private leave(): void {
    if (this.leaving) return
    this.leaving = true

    this.playPulse?.stop()
    // **The entry cascade has to be killed first, or it wins.** Play is clickable from the frame
    // it appears, which is well before the secondary row's own fade-in has finished — and a
    // still-running entry tween keeps writing alpha 1 over the exit tween's fade. Seen exactly
    // that way: the title and Play faded out on cue and the Shop/Settings row sat there at full
    // alpha over an accelerating road.
    this.tweens.killTweensOf(this.uiAlphaTargets())
    this.tweens.add({
      targets: this.uiAlphaTargets(),
      alpha: 0,
      duration: EXIT.fadeMs,
      ease: 'Cubic.easeIn',
    })
    this.tweens.add({
      targets: this.world,
      speed: SPEED_BASE,
      duration: EXIT.accelerateMs,
      ease: 'Cubic.easeIn',
      onComplete: () => this.scene.start('RunScene'),
    })
  }

  update(_time: number, delta: number): void {
    const width = this.scale.width
    const height = this.scale.height

    this.elapsedMs += delta

    // Nothing is being followed, so the camera looks straight down the track. The menu's world is
    // the run's world at a little over half speed and with no snail on it yet — the mascot's
    // menu appearance is chunk 7's, and it goes here.
    this.world.advance(delta, 0.5)
    this.world.render(width, height)

    // One framebuffer read per frame at most, and only while a measurement is outstanding.
    this.contrast.update(() => this.applyContrast())
  }

  /**
   * Applies what the probe measured: the text colour, and how dark each plate has to be.
   *
   * Both scrims fade in rather than appearing, because the measurement finishes somewhere inside
   * the entry cascade and a plate that popped would be the one part of the screen that did.
   */
  private applyContrast(): void {
    const title = this.contrast.titleResult
    const buttons = this.contrast.buttonResult

    if (!title || !buttons) return

    this.title.setColor(toCssColor(title.textColor))
    this.titleScrim.setTint(this.contrast.scrimColor)
    this.buttonScrim.setTint(this.contrast.scrimColor)

    for (const [scrim, alpha] of [
      [this.titleScrim, title.alpha],
      [this.buttonScrim, buttons.alpha],
    ] as const) {
      if (alpha <= 0) {
        scrim.setAlpha(0)
        continue
      }
      this.tweens.add({ targets: scrim, alpha, duration: ENTRY.title.duration, ease: 'Cubic.easeOut' })
    }
  }

  layout(width: number, height: number): void {
    const scale = uiScale(width)

    this.uiCamera.setViewport(0, 0, width, height)
    this.world.layout(width, height)

    this.layoutTitle(width, height, scale)

    this.layoutButtons(width, height, scale)

    // Sized around what they back, after both have their final size and position.
    layoutScrim(this.titleScrim, this.title.getBounds())
    layoutScrim(
      this.buttonScrim,
      rectAround([this.playButton.container, ...this.secondaryButtons().map((button) => button.container)]),
    )

    // The probe samples where the text ended up, so it has to be told after every layout — a
    // resize can move a block from clear sky onto a hillside.
    this.contrast.setRegions({
      title: this.title.getBounds(),
      // The *leftmost* secondary, taken from the accessor rather than named: the probe measures the
      // band the block actually occupies, and a region that stops short of a button solves the
      // plate against a background that button is not sitting on.
      buttons: rectAround([this.playButton.container, this.secondaryButtons()[0].container]),
    })
  }

  /**
   * Sets the wordmark inside the title band, shrinking it to fit that band's height and the
   * frame's width.
   *
   * Measured off the drawn text rather than the nominal font size, and applied in a second pass:
   * a `Text` object's height is a property of the font's metrics, not of the size asked for, so
   * the only honest way to know whether it fits is to set it and look.
   */
  private layoutTitle(width: number, height: number, scale: number): void {
    const band = titleBand(height)

    this.title.setFontSize(TITLE_FONT_SIZE * scale)

    const fit = Math.min(
      1,
      (band.height * TITLE_BAND_FILL) / this.title.height,
      (width * TITLE_MAX_WIDTH_FRACTION) / this.title.width,
    )

    if (fit < 1) this.title.setFontSize(TITLE_FONT_SIZE * scale * fit)

    // Left-aligned at a fraction of the width rather than centred: the mascot gets the right of
    // the frame (chunk 7), so the two sit on a diagonal and the vanishing point stays clear.
    this.title.setPosition(width * TITLE_LEFT_FRACTION, band.centre)
  }

  /**
   * Stacks the three buttons inside the button band, shrinking them if the band is shorter than
   * the stack.
   *
   * The second pass is not optional. At 844x390 the band is 86px tall and the stack at its
   * nominal sizes is 96px — every element inside the frame, and the last one 10px below the safe
   * line. `uiScale` cannot catch that: it scales on *width*, and 844 is a wide viewport.
   */
  private layoutButtons(width: number, height: number, scale: number): void {
    const band = buttonBand(height)
    const secondaries = this.secondaryButtons()
    const apply = (factor: number) => {
      this.playButton.setFontSize(PLAY_FONT_SIZE * scale * factor)
      this.playButton.setMinWidth(PLAY_MIN_WIDTH * scale * factor)
      for (const button of secondaries) button.setFontSize(SECONDARY_FONT_SIZE * scale * factor)
    }
    const secondaryHeight = () => Math.max(...secondaries.map((button) => button.height))
    const secondaryWidth = (factor: number) =>
      secondaries.reduce((total, button) => total + button.width, 0) + SECONDARY_GAP * scale * factor * 2

    apply(1)

    let gap = BUTTON_GAP * scale
    let stack = this.playButton.height + gap + secondaryHeight()
    // **Two fits, not one, because the row grew a third button.** The height fit has always been
    // needed — `uiScale` scales on *width*, so a landscape phone keeps a full-size stack in an 86px
    // band. The width fit is new: three secondaries at their nominal size are 259px on a 390px
    // frame with the margins the rest of the screen is laid out to, and the first thing that
    // overflows is the one furthest from the centre. Both are the same lever, so the smaller wins.
    const available = width - SIDE_MARGIN * 2 * scale
    const fit = Math.min(
      stack > band.height ? band.height / stack : 1,
      secondaryWidth(1) > available ? available / secondaryWidth(1) : 1,
    )

    if (fit < 1) {
      apply(fit)
      gap *= fit
      stack = this.playButton.height + gap + secondaryHeight()
    }

    const top = band.centre - stack / 2
    const playY = top + this.playButton.height / 2
    const secondaryY = top + stack - secondaryHeight() / 2
    const spacing = SECONDARY_GAP * scale * fit
    const rowWidth = secondaryWidth(fit)

    this.playButton.container.setPosition(width / 2, playY)

    let cursor = width / 2 - rowWidth / 2

    for (const button of secondaries) {
      button.container.setPosition(cursor + button.width / 2, secondaryY)
      cursor += button.width + spacing
    }

    // No `ensureMinHitArea` call here, and that is not an omission: `neonButton` floors its own
    // core box *and* its hit area at `MIN_TOUCH_TARGET` on every `setFontSize`, with the
    // Container-origin correction that helper cannot do (see CLAUDE.md "UI Kit"). Calling it on
    // a Container would build the hit area in the wrong frame and move every tap target by half
    // a button. The floor is asserted per viewport in the menu's own acceptance instead.
  }
}

/** How far past the text a plate spreads, as a multiple of the block's own size. */
const SCRIM_PADDING = { x: 1.3, y: 2.1 } as const

/** Sizes and centres one scrim on the block it backs. */
function layoutScrim(scrim: Phaser.GameObjects.Image, bounds: Phaser.Geom.Rectangle): void {
  scrim.setPosition(bounds.centerX, bounds.centerY)
  scrim.setDisplaySize(bounds.width * SCRIM_PADDING.x, bounds.height * SCRIM_PADDING.y)
}

/** A `Rectangle` as plain numbers, for the DEV hook to hand out. */
function rectOf(rect: Phaser.Geom.Rectangle): { x: number; y: number; width: number; height: number } {
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
}

/** The rectangle enclosing several game objects, in screen pixels. */
function rectAround(objects: readonly Phaser.GameObjects.Container[]): Phaser.Geom.Rectangle {
  const rect = objects[0].getBounds()

  for (const object of objects.slice(1)) Phaser.Geom.Rectangle.Union(rect, object.getBounds(), rect)

  return rect
}

