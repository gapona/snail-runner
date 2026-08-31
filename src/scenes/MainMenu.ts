import * as Phaser from 'phaser'
import { AUTO_THEME_ID } from '../save/types'
import { DEFAULT_ROAD_THEME } from '../road/themes'
import { bindAction } from '../platform/input'
import { gameReady } from '../platform/yt'
import { t } from '../i18n/strings'
import { getCatalog, type ShopItem } from '../shop/catalog'
import { themeIdFromItem } from '../shop/themeCatalog'
import { resolveSelectedSnail, skinIdFromItem, snailSkin } from '../run/snailSkins'
import { hasPurchased } from '../shop/coins'
import { applyTheme } from '../road/applyTheme'
import { getState, mutate } from '../save/store'
import { bindLayout } from '../ui/layout'
import { formatCount } from '../ui/format'
import { kitButton, type KitButton } from '../ui/kit'
import { KIT } from '../ui/kitPalette'
import { toCssColor } from '../ui/theme'
import { getDisplayFontStack } from '../ui/font'
import { uiScale } from '../ui/uiScale'
import { buttonBand, MENU_ENTRY as ENTRY, titleBand, titleRow } from '../ui/menuLayout'
import { WorldView } from '../run/WorldView'
import { biomeIndexForSegment } from '../road/biomes'
import { PlayerView } from '../run/PlayerView'
import { createPlayerState } from '../run/playerMotion'
import { PLAYER_REST_Y_FRACTION, PLAYER_WIDTH, PLAYER_Z, readableScale, SPEED_BASE } from '../run/constants'
import { CAMERA_HEIGHT, HORIZON_Y } from '../road/constants'
import { themeAccent } from '../road/themes'
import { INK } from '../run/artPalette'

/** Base font sizes, scaled by `uiScale(width)` and by each band's own fit. */
const TITLE_FONT_SIZE = 112
const PLAY_FONT_SIZE = 38
const ICON_FONT_SIZE = 24
const RECORD_FONT_SIZE = 24

/**
 * The wordmark's outline and shadow, as fractions of its own font size.
 *
 * **⚠ These replace a measured translucent plate, and the swap is the point.** The menu used to
 * solve a scrim alpha per theme from a framebuffer read (`ui/contrastProbe.ts`), because white text
 * on a pale sky measures well under 3:1 — and what that bought was a grey smear behind the title on
 * every bright theme. An outline is the same guarantee obtained differently: the letter is dark-
 * edged against *whatever* is behind it, so the contrast stops being a property of the sky at all
 * and the probe stops having anything to measure.
 *
 * Stated as fractions rather than pixels because the title shrinks to fit — a 14px stroke on a 74px
 * face is a logo, and the same 14px on the 34px the narrowest frame gets is a blob.
 */
const TITLE_INK = { stroke: 0.19, shadowY: 0.13, tiltDegrees: -3 } as const

/** How much of the title band the wordmark may fill, and how much of the frame's width. */
const TITLE_BAND_FILL = 0.78
const TITLE_MAX_WIDTH_FRACTION = 0.88

/**
 * The primary action's own geometry, in unscaled pixels.
 *
 * **A share of the frame between a floor and a ceiling, not a fixed width.** A 264px button is
 * two thirds of a 320px phone and an eighth of a desktop — the same object reading as "the thing to
 * press" on one and as a chip on the other. The floor is what keeps it thumb-sized on the narrowest
 * supported frame; the ceiling is what stops a wide desktop turning it into a banner.
 */
const PLAY_WIDTH = { fraction: 0.4, min: 264, max: 380 }
const RECORD_GAP = 10

/** How close anything may come to the edges of the frame. */
const SIDE_MARGIN = 16

/**
 * How heavily the record line is outlined, as a fraction of its own face.
 *
 * **⚠ There is no strip under the buttons any more, and this is what replaced it.** The band was
 * the last plate on the front screen — a soft dark wash so the row never had to argue with whatever
 * biome the near ground was showing — and it was reported as exactly what it is: a dark slab lying
 * across the road, in a picture whose whole subject is the road.
 *
 * The rule that removes it is the one this screen already reached for the title: **a thick dark
 * outline is the same guarantee obtained differently.** The letter is dark-edged against *whatever*
 * is behind it, so the contrast stops being a property of the ground and there is nothing left to
 * plate over. The Play button needs none of it — it is the one solid shape on the screen — so the
 * record is the only thing the strip was actually protecting.
 *
 * Stated as a fraction of the face, for `TITLE_INK`'s reason: this text shrinks to fit, and a
 * 4px stroke is a rim on a 20px face and a blob on the 13px the narrowest frame gets.
 */
const RECORD_INK = { stroke: 0.2, shadowY: 0.16 } as const

/**
 * The mascot's place in the picture.
 *
 * `offsetX` is in road half-widths, so the snail rides the road through a bend exactly as it does
 * in a run; `scale` is the one place in the game the drawn box is allowed to exceed the collision
 * box, and it may be, because the menu has no collision — see `PlayerView`'s own note.
 *
 * **⚠ `zScale` is what keeps the mascot out of the buttons, and it is a composition tool rather
 * than a cheat.** The snail's row on screen is fixed by `PLAYER_Z`: at the run's own distance its
 * feet land at 0.80 of the frame, which is inside the button band, and no amount of scaling moves
 * that — scaling about a bottom-centre origin grows a sprite UPWARDS from the same row. Standing it
 * further up the road raises the row (the offset from the horizon goes as 1/z) and shrinks it, and
 * `scale` buys the size back. Net: the same big mascot, a band higher, with nothing to argue with.
 */
const MASCOT = { offsetX: 0.58, widthFraction: 0.2, zScale: 1.55 } as const

/**
 * The multiplier that puts the front screen's mascot at `MASCOT.widthFraction` of the frame.
 *
 * **⚠ It was a bare `scale: 3.4`, and that made the menu's composition a function of the run's
 * hitbox.** The run's mascot is `PLAYER_WIDTH * scale(PLAYER_REST_Y_FRACTION)` of the frame's
 * width, and a round that grew either of those grew the front screen by the same factor without
 * anybody deciding to — measured, the hero snail went from 20% of a desktop frame to 32% of one as
 * a side effect of making the *in-run* snail readable on a phone.
 *
 * So the size the picture wants is stated, and the multiplier is solved from it. Nothing about the
 * run can move it now: if `PLAYER_BODY_H` or the rest row changes, this changes with them and the
 * front screen looks the same.
 *
 * `zScale` is in it because standing the mascot further up the road shrinks it by exactly that
 * factor — see `MASCOT.zScale`.
 */
function mascotScale(): number {
  const runFraction = (PLAYER_WIDTH * 2 * (PLAYER_REST_Y_FRACTION - HORIZON_Y)) / CAMERA_HEIGHT / 2

  return (MASCOT.widthFraction / runFraction) * MASCOT.zScale
}

/**
 * The idle cycle: a slow breath, a slower sway, and a rarer glance back.
 *
 * **⚠ There is no blink and no eye turn, and that is an art fact rather than an omission.** The
 * shipped mascot is a REAR view — shell to the camera, head and both stalks going away, which
 * CLAUDE.md records as the pick that fixed the model's drift to profile. There are no eyes facing
 * the player to blink or to turn, and drawing some would be new art.
 *
 * What is available is the same one scalar the jump uses (`squash.ts`: `> 1` taller and narrower,
 * `< 1` flatter and wider, volume-preserving) plus a rotation. So: `breath` is the creature
 * breathing, `sway` is its weight shifting, and `glance` is an occasional quick rise-and-tilt that
 * reads as looking back over the shell. Three periods that share no common multiple under a
 * minute, so the cycle never visibly repeats — the same trick the sun's corona uses.
 */
const IDLE = {
  breath: { amount: 0.055, periodMs: 2600 },
  sway: { degrees: 2.4, periodMs: 4100 },
  glance: { periodMs: 9400, durationMs: 620, degrees: 7, rise: 0.09 },
} as const

/** The exit: interface out, world up to speed, then the handover. */
const EXIT = { fadeMs: 180, accelerateMs: 600 } as const

/** How loud the corner icons are against the primary. Secondary means quieter, not just smaller. */
const CORNER_ALPHA = 0.78

/** The idle pulse on the primary action. */
const PLAY_PULSE = { scale: 1.035, periodMs: 1900 } as const

/**
 * The front screen: the game itself, running, with the fewest controls that can start it.
 *
 * **It is an attract mode rather than a picture of one.** The same `WorldView` the play scene
 * builds, on the same circuit machinery, at the run's own `SPEED_BASE`, with the real `PlayerView`
 * on the road — biomes change, the verge streams past, the mascot glides. What it does *not* have
 * is the run: no obstacles, no pickups, no collision, no HUD. That costs nothing to draw and it is
 * the only thing on the screen that sells both the speed and the character.
 *
 * **The composition keeps off the vanishing point.** Every line in the frame converges at
 * `HORIZON_Y`; the title takes the empty sky above it, the mascot stands in the middle distance off
 * the centreline, and the controls sit on the near ground a run leaves blank. See `ui/menuLayout.ts`
 * for the bands and for why nothing may sit in the middle.
 *
 * **The hierarchy is one filled button and two icons.** Play is the only solid shape on the screen;
 * Shop and Settings are unlabelled glyphs in the corner at half its weight. That is the reverse of
 * what shipped: Play was a 16%-alpha outline and the two secondaries were near-opaque plates.
 */
export class MainMenu extends Phaser.Scene {
  private world!: WorldView
  private mascot!: PlayerView
  private mascotState = createPlayerState()
  private uiCamera!: Phaser.Cameras.Scene2D.Camera

  private title!: Phaser.GameObjects.Text
  private playButton!: KitButton
  private record!: Phaser.GameObjects.Text
  private shopButton!: KitButton
  private settingsButton!: KitButton
  private shopBadge!: Phaser.GameObjects.Graphics

  private elapsedMs = 0
  private leaving = false
  private playPulse?: Phaser.Tweens.Tween

  constructor() {
    super('MainMenu')
  }

  create() {
    this.elapsedMs = 0
    this.leaving = false
    this.mascotState = createPlayerState()
    this.mascotState.offsetX = MASCOT.offsetX

    // **At the run's own speed, not a fraction of it.** The menu used to travel at 0.55 of
    // `SPEED_BASE` so the frame would sit still under a block of text; with the text out of the
    // middle of the picture there is nothing left for the motion to fight, and an attract mode that
    // moves slower than the game is an attract mode advertising the wrong game.
    this.world = new WorldView(this, { circuit: 'menu', speed: SPEED_BASE, decorSeed: 4242 })
    this.mascot = new PlayerView(this, {
      sizeScale: mascotScale(),
      // **The front screen is the skin's preview, and this is why it can be.** The shop's rows are
      // a glyph and a name; what a player is actually buying is the creature standing on the road
      // behind the panel, so the menu draws the skin they have chosen and changes it the moment
      // they choose another. `resolveSelectedSnail` rather than the raw field: a save can outlive a
      // skin id, and a hand-edited one must not unlock anything.
      skin: resolveSelectedSnail(getState().selectedSnail, getState().purchases),
    })


    this.title = this.add
      .text(0, 0, t('gameTitle'), {
        fontFamily: getDisplayFontStack(),
        fontSize: TITLE_FONT_SIZE,
        color: toCssColor(KIT.coin),
      })
      .setOrigin(0, 0.5)
      .setAngle(TITLE_INK.tiltDegrees)

    this.playButton = kitButton(this, t('play'), {
      primary: true,
      solid: true,
      fill: themeAccent(),
      fontSize: PLAY_FONT_SIZE,
      fontFamily: getDisplayFontStack(),
    })

    // The reason to come back, in the one place the eye is already going: beside the button.
    this.record = this.add
      .text(0, 0, this.recordText(), {
        fontFamily: getDisplayFontStack(),
        fontSize: RECORD_FONT_SIZE,
        color: toCssColor(KIT.coin),
      })
      .setOrigin(0.5, 0)
      .setStroke(toCssColor(INK), 4)

    // **Glyphs, not textures.** Two unlabelled icons is what "secondary" looks like, and the game
    // already sets emoji in `valueBadge` and the ad button — so this needs no new asset, which is
    // the constraint this whole round is under.
    this.shopButton = kitButton(this, '🛒', { fontSize: ICON_FONT_SIZE })
    this.settingsButton = kitButton(this, '⚙', { fontSize: ICON_FONT_SIZE })
    this.shopBadge = this.add.graphics()

    this.uiCamera = this.cameras.add(0, 0, this.scale.width, this.scale.height)
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
      this.mascot.destroy()
      this.world.destroy()
    })

    // The world is up, the interface is interactable, the preloader is gone.
    gameReady()
  }

  /** `BEST 1,240 · 🪙 87`, or just the coins on a save that has never finished a run. */
  private recordText(): string {
    const state = getState()
    const coins = `🪙 ${state.coins}`

    return state.bestScore > 0 ? `${t('best')} ${formatCount(state.bestScore)}   ${coins}` : coins
  }

  /**
   * Whether the shop has something the player can act on right now.
   *
   * **Affordable and unowned, which is a narrower question than "is there anything in there".** A
   * badge that is always lit is a badge nobody reads, so it is not "you have coins" and not "there
   * are themes" — it is that some specific row would succeed if tapped today.
   */
  private shopHasNews(): boolean {
    const state = getState()

    return getCatalog().some(
      (item) => item.priceCoins > 0 && item.priceCoins <= state.coins && !hasPurchased(state.purchases, item.id),
    )
  }

  /**
   * The DEV-only handle the menu's acceptance is measured through.
   *
   * Gated like every other hook in this project, and `__menu` is registered in `check-bundle.mjs`
   * so that "we gated it" can be checked against "it is gone". **The guard is inside the method,
   * not at the call site**: gating the *call* removes the call and leaves the method on the class,
   * unreferenced, with its string literals intact — which is exactly how the first version of this
   * shipped into a production bundle.
   */
  private exposeForTesting(): void {
    if (!import.meta.env.DEV) return

    ;(window as unknown as Record<string, unknown>).__menu = {
      setTheme: (id: string) => {
        if (!applyTheme(this, id)) return false
        this.world.refreshTheme(this, this.scale.width, this.scale.height)
    // The one control drawn over the sky takes its colour from the sky's own theme — so the accent
    // has to move with it, in the same handler, or the button advertises the previous palette.
    this.playButton.setFill(themeAccent())

        return true
      },
      bounds: () => ({
        viewport: { width: this.scale.width, height: this.scale.height },
        title: rectOf(this.title.getBounds()),
        // **⚠ Not `getBounds()`, which for a `Container` is the union of its CHILDREN.** A kit
        // button's box is drawn by a `Graphics`, which contributes nothing to that union, so the
        // first version of this hook reported the label's own size — a 76px "Play" and two icons
        // under the touch floor, none of which is what is on screen or what is tappable.
        play: boxOf(this.playButton),
        record: rectOf(this.record.getBounds()),
        shop: boxOf(this.shopButton),
        settings: boxOf(this.settingsButton),
        mascot: rectOf(this.mascot.sprite.getBounds()),
      }),
      alphas: () => ({
        title: this.title.alpha,
        play: this.playButton.container.alpha,
        shop: this.shopButton.container.alpha,
        settings: this.settingsButton.container.alpha,
      }),
      biome: () => biomeIndexForSegment(this.world.baseIndex, this.world.track.length),
      tweens: () => this.tweens.getTweens().length,
      leave: () => this.leave(),
    }
  }

  private worldObjects(): Phaser.GameObjects.GameObject[] {
    return [...this.world.gameObjects, ...this.mascot.gameObjects]
  }

  private uiObjects(): Phaser.GameObjects.GameObject[] {
    return [...this.uiAlphaTargets(), this.shopBadge]
  }

  /**
   * The corner icons, as one list.
   *
   * **⚠ There were two lists and they disagreed, which is how a third button once shipped
   * invisible.** `playEntry` sets every `uiAlphaTargets()` object to alpha 0 and then fades in an
   * explicitly named set; a button in the first list and not the second is correctly positioned,
   * correctly sized, interactive, and drawn at alpha 0 — present to every measurement and invisible
   * to the eye. Every consumer reads this one accessor.
   */
  private cornerButtons(): KitButton[] {
    return [this.shopButton, this.settingsButton]
  }

  /** The same objects, typed as things that have an alpha — for the entry and exit tweens. */
  private uiAlphaTargets(): (Phaser.GameObjects.Image | Phaser.GameObjects.Text | Phaser.GameObjects.Container)[] {
    return [
      this.title,
      this.record,
      this.playButton.container,
      ...this.cornerButtons().map((button) => button.container),
    ]
  }

  private bindActions(): void {
    // 'primary' must fire at most once — starting the same scene twice mid-transition is unsafe,
    // and the exit runs for `EXIT.accelerateMs` before the handover, which is a long window.
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
        onSelect: (item: ShopItem) => this.selectItem(item),
        isSelected: (item: ShopItem) => this.isSelected(item),
      })
    })

    // The shop can spend coins and buy a theme, so both readouts are stale the moment it closes.
    this.events.on(Phaser.Scenes.Events.RESUME, () => {
      this.record.setText(this.recordText())
      this.layout(this.scale.width, this.scale.height)
    })
  }

  /**
   * Whether a shop row is the one currently worn or driven.
   *
   * Asked per refresh rather than answered once, because the selection changes while the shop is
   * open — and asked of *both* id spaces, since the two catalogues share one row list. A predicate
   * that only knew about themes would leave every skin row reading `Select`, including the one the
   * player is looking at on the road behind the panel.
   */
  private isSelected(item: ShopItem): boolean {
    const skinId = skinIdFromItem(item.id)

    if (skinId !== null) return skinId === getState().selectedSnail

    const themeId = themeIdFromItem(item.id)

    return themeId !== null && themeId === getState().selectedTheme
  }

  /**
   * Applies a shop selection — a look for the road, or a look for the snail.
   *
   * **The two are told apart by their id prefix and nothing else**, which is what lets a third kind
   * of cosmetic land here without the shop scene learning about it: `skinIdFromItem` and
   * `themeIdFromItem` each answer `null` for anything that is not theirs.
   */
  private selectItem(item: ShopItem): void {
    const skinId = skinIdFromItem(item.id)

    if (skinId !== null) {
      // Rejected rather than trusted: the row could name a skin this build no longer has.
      if (!snailSkin(skinId)) return

      // The mascot first, the save second — the frame behind the panel is the confirmation, and a
      // save written before the picture changed is a save that can outlive a failed texture build.
      this.mascot.setSkin(this, skinId)
      mutate((state) => {
        state.selectedSnail = skinId
      })

      return
    }

    const themeId = themeIdFromItem(item.id)

    if (!themeId) return

    const applied = themeId === AUTO_THEME_ID ? DEFAULT_ROAD_THEME : themeId

    // `applyTheme` swaps the pixels behind live texture keys, so it may only run while nothing is
    // drawing them. That precondition is not free here: this scene draws the world itself, and it
    // is paused (not stopped) while the shop is open — paused means its `update` does not run, so
    // no render of ours can be in flight when this executes.
    if (!applyTheme(this, applied)) return

    this.world.refreshTheme(this, this.scale.width, this.scale.height)

    mutate((state) => {
      state.selectedTheme = themeId
    })
  }

  /** The entry cascade. The world is already running, so it has no entrance of its own. */
  private playEntry(): void {
    for (const object of this.uiAlphaTargets()) object.setAlpha(0)

    this.tweens.add({
      targets: [this.title],
      alpha: 1,
      delay: ENTRY.title.delay,
      duration: ENTRY.title.duration,
      ease: 'Cubic.easeOut',
    })
    this.tweens.add({
      targets: [this.playButton.container, this.record],
      alpha: 1,
      delay: ENTRY.play.delay,
      duration: ENTRY.play.duration,
      ease: 'Cubic.easeOut',
      onComplete: () => this.startPlayPulse(),
    })
    this.tweens.add({
      // The accessor, never a hand-written pair — see `cornerButtons`.
      targets: this.cornerButtons().map((button) => button.container),
      alpha: CORNER_ALPHA,
      delay: ENTRY.corner.delay,
      duration: ENTRY.corner.duration,
      ease: 'Cubic.easeOut',
    })
  }

  /**
   * The idle pulse on the primary action, which stops the moment the pointer is on it.
   *
   * A pulse is an invitation, and an invitation the player has already accepted is noise — worse, a
   * button that keeps moving under the cursor is a button that is harder to hit.
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
   * Hands over to the run **without a fade to black**.
   *
   * The interface leaves, the world is already at the run's speed, and only then does the scene
   * change. Nothing is hidden during the change because nothing has to move: the horizon, the
   * palette and the fog are the same numbers on both sides of it — and now so is the speed.
   */
  private leave(): void {
    if (this.leaving) return
    this.leaving = true

    this.playPulse?.stop()
    // **The entry cascade has to be killed first, or it wins.** Play is clickable from the frame it
    // appears, which is before the corner row's own fade-in has finished — and a still-running entry
    // tween keeps writing alpha 1 over the exit tween's fade.
    this.tweens.killTweensOf(this.uiAlphaTargets())
    this.tweens.add({
      targets: this.uiAlphaTargets(),
      alpha: 0,
      duration: EXIT.fadeMs,
      ease: 'Cubic.easeIn',
      onUpdate: () => this.shopBadge.setAlpha(this.shopButton.container.alpha),
    })
    this.time.delayedCall(EXIT.accelerateMs, () => this.scene.start('RunScene'))
  }

  update(_time: number, delta: number): void {
    const width = this.scale.width
    const height = this.scale.height

    this.elapsedMs += delta

    // The camera leans towards the mascot exactly as it does in a run, so the one object the
    // picture is about is also the one the frame is composed around.
    this.world.advance(delta, 0.5 + this.mascotState.offsetX * 0.5)
    this.world.render(width, height)

    // After the world, never before: it reads this frame's segment projections out of the mesh pass.
    this.mascot.render(
      this.mascotState,
      this.world.track,
      this.world.baseIndex,
      // Stood further up the road than a run stands it — see `MASCOT.zScale`. `PlayerView` adds
      // `PLAYER_Z` to whatever it is handed, so the extra distance goes in here rather than in a
      // second knob on a class that must not learn about menus.
      this.world.cameraZ + PLAYER_Z * (MASCOT.zScale - 1),
      width,
      height,
      this.idleSquash(),
      this.world.cameraZ,
    )
    this.mascot.sprite.setAngle(this.idleAngle())
  }

  /** The breath, plus the rise of a glance. One scalar, the same one the jump uses. */
  private idleSquash(): number {
    const breath = Math.sin((this.elapsedMs / IDLE.breath.periodMs) * Math.PI * 2) * IDLE.breath.amount

    return 1 + breath + this.glance() * IDLE.glance.rise
  }

  /** The sway, plus the tilt of a glance. */
  private idleAngle(): number {
    const sway = Math.sin((this.elapsedMs / IDLE.sway.periodMs) * Math.PI * 2) * IDLE.sway.degrees

    return sway + this.glance() * IDLE.glance.degrees
  }

  /**
   * `0..1` over the glance's own window, and exactly 0 outside it.
   *
   * A half-sine rather than a ramp, for the reason the sun's glint is one: a linear rise shows its
   * corners and reads as the sprite being switched rather than as the creature moving.
   */
  private glance(): number {
    const into = this.elapsedMs % IDLE.glance.periodMs

    return into < IDLE.glance.durationMs ? Math.sin((into / IDLE.glance.durationMs) * Math.PI) : 0
  }

  layout(width: number, height: number): void {
    const scale = uiScale(width)

    this.uiCamera.setViewport(0, 0, width, height)
    this.world.layout(width, height)

    // **The mascot is boosted on a narrow frame, and it is the one object here allowed to be.**
    // Everything on this road is sized off the frame's WIDTH — which is what keeps an object the
    // same size relative to the road at every aspect, and which makes the snail a fifth of its
    // desktop size on a phone. That is correct for a hitbox and wrong for the subject of a
    // picture, so the front screen borrows `readableScale`: the same rule, for the same reason, in
    // the only other place a sprite and a box need not agree.
    this.mascot.setSizeScale(mascotScale() * readableScale(width))

    this.layoutTitle(width, height, scale)
    this.layoutButtons(width, height, scale)
    this.layoutCorner(width, scale)
  }

  /**
   * Sets the wordmark inside the title band.
   *
   * **⚠ The title is what shrinks, and the Play button is what does not.** The band's fit is applied
   * here and `layoutButtons` has no fit of its own beyond the touch floor — if the frame is too
   * short for both, the thing the player came to press keeps its size and the decoration gives way.
   * That is the reverse of the old order, where a single stack fit shrank Play along with everything
   * else on a landscape phone.
   *
   * Measured off the drawn text rather than the nominal font size, in a second pass: a `Text`
   * object's height is a property of the font's metrics, not of the size asked for, so the only
   * honest way to know whether it fits is to set it and look.
   */
  private layoutTitle(width: number, height: number, scale: number): void {
    const band = titleBand(height)
    const setSize = (size: number): void => {
      this.title.setFontSize(size)
      // Both are fractions of the face, so a title shrunk to fit keeps its own proportions rather
      // than turning into a thin letter inside a fixed-width stroke.
      this.title.setStroke(toCssColor(INK), size * TITLE_INK.stroke)
      this.title.setShadow(0, size * TITLE_INK.shadowY, toCssColor(INK), 0, true, true)
    }

    setSize(TITLE_FONT_SIZE * scale)

    const fit = Math.min(
      1,
      (band.height * TITLE_BAND_FILL) / this.title.height,
      (width * TITLE_MAX_WIDTH_FRACTION) / this.title.width,
    )

    if (fit < 1) setSize(TITLE_FONT_SIZE * scale * fit)

    // Left-aligned rather than centred: the mascot has the right of the frame, so the two sit on a
    // diagonal and the vanishing point between them stays clear.
    const left = SIDE_MARGIN * scale + this.title.height * 0.1

    // **And pushed down where the sun is in the way**, which on a portrait phone it is — see
    // `titleRow`. On a landscape frame the two never overlap and this returns the band's centre.
    this.title.setPosition(left, titleRow(width, height, { left, width: this.title.width, height: this.title.height }))
  }

  /**
   * The primary action and the record, on the bare near ground.
   *
   * Both are centred: the button is the one thing on the screen the player is meant to hit, and the
   * centre of the near ground is the easiest place on a phone to hit with either thumb. The mascot
   * is what moves out of the way — it stands off the centreline in `MASCOT.offsetX` and, being in
   * the middle distance, sits a band above this one.
   */
  private layoutButtons(width: number, height: number, scale: number): void {
    const band = buttonBand(height)

    this.playButton.setFontSize(PLAY_FONT_SIZE * scale)
    this.playButton.setMinWidth(
      Math.min(
        Math.max(width * PLAY_WIDTH.fraction, PLAY_WIDTH.min * scale),
        PLAY_WIDTH.max,
        width - SIDE_MARGIN * 4 * scale,
      ),
    )
    const face = RECORD_FONT_SIZE * scale

    this.record.setFontSize(face)
    // The outline, and a shadow under it, are the whole of what keeps this legible now the strip is
    // gone — see `RECORD_INK`. Re-applied per layout because both are stated against the face.
    this.record.setStroke(toCssColor(INK), face * RECORD_INK.stroke)
    this.record.setShadow(0, face * RECORD_INK.shadowY, toCssColor(INK), 0, true, true)

    const stack = this.playButton.height + RECORD_GAP * scale + this.record.height
    const top = band.centre - stack / 2

    this.playButton.container.setPosition(width / 2, top + this.playButton.height / 2)
    this.record.setPosition(width / 2, top + this.playButton.height + RECORD_GAP * scale)
  }

  /**
   * The two icons, in the top-right corner, at half the primary's weight.
   *
   * The corner is the one part of the frame a run's HUD leaves to the *right* of its own gauge, and
   * it is as far from the primary action as the screen allows — which is the point: a secondary
   * control that shares a zone with the primary one is competing with it.
   */
  private layoutCorner(width: number, scale: number): void {
    const margin = SIDE_MARGIN * scale
    const gap = 8 * scale
    let right = width - margin

    for (const button of this.cornerButtons()) {
      button.setFontSize(ICON_FONT_SIZE * scale)
      button.container.setPosition(right - button.width / 2, margin + button.height / 2)
      right -= button.width + gap
    }

    // A dot on the shop, drawn rather than a texture, and only when the shop can actually do
    // something for the player right now — see `shopHasNews`.
    const shop = this.shopButton.container
    const radius = Math.max(4, 5 * scale)

    this.shopBadge.clear()
    this.shopBadge.setAlpha(shop.alpha)

    if (this.shopHasNews()) {
      this.shopBadge.fillStyle(KIT.plate, 1)
      this.shopBadge.fillCircle(shop.x + this.shopButton.width / 2, shop.y - this.shopButton.height / 2, radius * 1.5)
      this.shopBadge.fillStyle(KIT.coin, 1)
      this.shopBadge.fillCircle(shop.x + this.shopButton.width / 2, shop.y - this.shopButton.height / 2, radius)
    }
  }
}

/** A kit button's real drawn box, centred on its container. */
function boxOf(button: KitButton): { x: number; y: number; width: number; height: number } {
  return {
    x: button.container.x - button.width / 2,
    y: button.container.y - button.height / 2,
    width: button.width,
    height: button.height,
  }
}

/** A `Rectangle` as plain numbers, for the DEV hook to hand out. */
function rectOf(rect: Phaser.Geom.Rectangle): { x: number; y: number; width: number; height: number } {
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
}
