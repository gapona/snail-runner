import * as Phaser from 'phaser'
import { t } from '../i18n/strings'
import { getDisplayFontStack } from './font'
import { isTap } from './gesture'
import { ensureScrimTexture, SCRIM_TEXTURE } from './scrimTexture'
import { percentFor, stepValue, valueFromX, xForValue } from './sliderMath'
import { BUTTON_GEOMETRY, KIT, MIN_TOUCH, SLIDER_GEOMETRY, sliderHitHeight } from './kitPalette'
import { bakeUiSprite, UI_CHEEK, UI_RADIUS, UI_SINK, UI_SLICE } from './uiSprites'
import { uiScale } from './uiScale'

/**
 * The game's own widget kit: panels, buttons, rows, badges and sliders, built out of Phaser core
 * game objects and drawn in the visual language the rest of this game already speaks.
 *
 * **Why this exists beside `ui/theme.ts`.** That file is the template's kit — neon pink on near
 * black, three strokes standing in for a glow — and it was right for the template's own dark demo.
 * This game is a bright outdoor scene: a daylight sky, sand, asphalt, a cyan ship. Laying neon over
 * it is the mismatch CLAUDE.md has been carrying as an open item ever since the menu started
 * rendering the world, and the two screens that show the most interface, `Settings` and `Shop`, are
 * where it read worst.
 *
 * **The vocabulary is taken from the game rather than invented**, so nothing here is a new idea the
 * player has to learn:
 *
 * - **Soft plates, not panels.** The same blurred rounded rectangle the menu and the HUD use for
 *   their scrims (`ui/scrimTexture.ts`) — it has no edge to read as a box sitting on top of the
 *   world. A hard-stroked panel is the one thing that makes an overlay look bolted on.
 * - **A thin cool rim and a warm accent.** The rim is the HUD's own near-white; the accent is the
 *   coin/currency warm sand. Two colours, each with a job, neither of them near the reserved threat
 *   hue — `verify:ui` holds that mechanically.
 * - **Diamonds and rungs.** A slider's handle is the shields' diamond and its track carries the
 *   road's rungs as tick marks; a selected row is marked with the same diamond. The player has been
 *   reading those two shapes since the first frame of the first run.
 *
 * Everything is a `Container` of `Graphics` and `Text`, positioned by the caller in `layout()`,
 * exactly like the template's kit — see "Responsive Layout" in CLAUDE.md for the two hit-area traps
 * every interactive widget here has to handle, and which each of them does.
 */

/**
 * The pale outer rim the engine strokes around every sprite, in pixels.
 *
 * Measured on the references at ~3 px on a 46 px button; kept absolute rather than scaled, for the
 * same reason the contour and the lip are: a nine-slice never scales its corners, so every fixed
 * feature of this language is a fixed number of pixels at any drawn size.
 */
const RIM_STROKE = 3

/** The label's dark stroke, as a fraction of its own face -- see `TITLE_INK`'s argument. */
const LABEL_INK = 0.17

/** Plate opacity, and the rim's thickness as a fraction of the smaller viewport axis. */
const PLATE_ALPHA = 0.9
const RIM_WIDTH = 0.0022

const BUTTON = BUTTON_GEOMETRY
const SLIDER = SLIDER_GEOMETRY

function css(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`
}

/** A soft plate: the panel every overlay in this game sits on. */
export interface Plate {
  readonly gameObjects: readonly Phaser.GameObjects.GameObject[]
  /** Draws the plate centred on `(x, y)`. Stateless, like `roundedPanel` — call it every layout. */
  draw(x: number, y: number, width: number, height: number): void
  clear(): void
  destroy(): void
}

/**
 * `depth` is the depth the plate's *contents* sit at — the plate itself is placed below it.
 *
 * **Below, not above, and this bit was a real defect.** The first version put the rim at `depth + 1`
 * on the reasoning that the outline is the topmost part of the panel; it is, of the panel, but the
 * panel is the bottommost part of the *screen*. With a near-opaque fill it drew over the title, the
 * coin badge and the Close button — a shop whose own chrome was behind its own background. Found by
 * screenshot, one step after the fill was raised to fix the opposite problem.
 */
export function plate(scene: Phaser.Scene, depth = 0): Plate {
  ensureScrimTexture(scene)

  const wash = scene.add.image(0, 0, SCRIM_TEXTURE).setTint(KIT.plate).setAlpha(0).setDepth(depth - 2)
  const rim = scene.add.graphics().setDepth(depth - 1)

  return {
    gameObjects: [wash, rim],
    draw(x, y, width, height) {
      // The wash is stretched past the rim so its soft edge falls *outside* the drawn outline: the
      // outline then reads as the panel's edge and the blur as the shadow under it, rather than as
      // two competing edges a few pixels apart.
      wash.setPosition(x, y)
      wash.setDisplaySize(width * 1.08, height * 1.14)
      wash.setAlpha(PLATE_ALPHA)

      const thickness = Math.max(1, Math.min(width, height) * RIM_WIDTH * 4)

      rim.clear()
      // **Near-opaque, not translucent.** The first version filled at 0.55 and the paused menu
      // underneath read straight through the panel — the words `Play`, `Shop` and `Settings` were
      // legible *over* the shop's own rows, which is exactly the "an overlay looks bolted on"
      // failure the soft plate exists to avoid, arrived at from the other direction. Found by
      // screenshot; the panel now carries the world's colour rather than the world's content, and
      // `verify:ui`'s 4.5:1 measurement against `KIT.plate` becomes an honest one rather than an
      // approximation of whatever happened to be behind it.
      rim.fillStyle(KIT.plate, 0.94)
      rim.fillRoundedRect(x - width / 2, y - height / 2, width, height, BUTTON.radius * PANEL_RIM.radius)
      // **⚠ A warm rim at full strength, not a thin cool one at half.** The panels read as a
      // dark-blue dashboard beside a warm cartoon, and the border was most of why: `KIT.rim` is the
      // neutral, and at 0.5 alpha it is a hairline that says "chrome". The coin's sand is the
      // interface palette's own warm accent and is what the menu's record line is already drawn in,
      // so the panel borrows a colour the player has been reading since the front screen.
      rim.lineStyle(thickness * PANEL_RIM.weight, KIT.coin, PANEL_RIM.alpha)
      rim.strokeRoundedRect(x - width / 2, y - height / 2, width, height, BUTTON.radius * PANEL_RIM.radius)
    },
    clear() {
      wash.setAlpha(0)
      rim.clear()
    },
    destroy() {
      wash.destroy()
      rim.destroy()
    },
  }
}

/** A button. One shape, three states: normal, primary, disabled. */
/** How far a solid button's shadow sits below it, in unscaled pixels. */
const SOLID_SHADOW = 5

export interface KitButton {
  readonly container: Phaser.GameObjects.Container
  readonly label: Phaser.GameObjects.Text
  readonly width: number
  readonly height: number
  setText(text: string): void
  setFontSize(size: number): void
  setPrimary(primary: boolean): void
  setEnabled(enabled: boolean): void
  setMinWidth(width: number): void
}

export function kitButton(
  scene: Phaser.Scene,
  text: string,
  options?: { primary?: boolean; muted?: boolean; fontSize?: number; fontFamily?: string; solid?: boolean },
): KitButton {
  const label = scene.add
    .text(0, 0, text, {
      fontFamily: options?.fontFamily ?? 'Arial',
      fontSize: options?.fontSize ?? 20,
      color: css(KIT.rim),
    })
    .setOrigin(0.5)
  // Three layers, in this order: the engine's pale rim, the sprite, the label.
  //
  // **The rim is a stroke and not pixels**, which is `ART-STYLE.md`'s one deliberate omission from
  // the generated art: it is the thinnest feature on the object and the first thing any renderer
  // smears, and the engine knows the exact box and radius so it can draw it perfectly even. It goes
  // UNDER the sprite so the sprite's own contour covers the inner half of the stroke and what is
  // left is a clean outer edge.
  const rim = scene.add.graphics()
  const background = scene.add.graphics()
  const container = scene.add.container(0, 0, [rim, background, label])
  let sprite: Phaser.GameObjects.NineSlice | null = null

  // Tracked rather than read back off the Text: Phaser stores `style.fontSize` as a CSS string, so
  // the stroke width -- a fraction of the face -- cannot be computed from it without parsing.
  let fontSize = options?.fontSize ?? 20

  let primary = options?.primary ?? false
  /**
   * A filled button rather than an outlined one, with a hard drop shadow under it.
   *
   * **⚠ The kit's `primary` is a 16%-alpha wash, and that is a hierarchy the front screen had
   * upside down**: Play was the most transparent thing on the menu while Shop and Settings were
   * near-opaque plates. `solid` is the one control on a screen that should read as a *button*
   * rather than as a frame — the label goes dark because the fill is the accent, and the shadow is
   * a second rounded rect offset down rather than a blur, because `Graphics` has no blur and the
   * game's whole idiom is hard-edged anyway.
   */
  const solid = options?.solid ?? false
  /**
   * What a `solid` or `primary` button is painted in, and it is **fixed**.
   *
   * **⚠ It used to be a caller's override, and `MainMenu` lent it the active theme's rung.** The
   * argument was that this is the one control drawn straight over the world rather than on a plate,
   * so it should belong to the world — and on `day` that made the Play button and the mode chip a
   * pale cream under a near-white label, reported as unreadable. What the check of the day measured
   * was the *fill against the road*, which the cream passed at 1.47:1; **nothing measured the label
   * against the fill**, and that is what a player reads. The accent is the interface's own cyan on
   * every theme now, and only the world behind it changes.
   */
  const fill = KIT.active
  /**
   * The third tier, and the kit had only two.
   *
   * **A screen with two actions can say which is which by making one of them primary; a screen with
   * three cannot.** The result panel is the case: `Again`, `Double coins` and `Menu` were an
   * accent-outlined button and two identical ones, so the only thing separating the last two was
   * their labels. `ui/theme.ts`'s `neonButton` had exactly this option and the kit lost it in the
   * restyle.
   *
   * It is dimmer rather than smaller: a tertiary action still has to clear the 44px touch floor, so
   * the weight has to come out of the ink and not out of the box.
   */
  const muted = options?.muted ?? false
  let enabled = true
  let hovered = false
  let pressed = false
  let minWidth = 0
  let width = 0
  let height = 0

  /**
   * The face a tier is painted in.
   *
   * The four tiers the kit already had map onto `ART-STYLE.md`'s four button classes without any
   * call site changing: `solid`/`primary` is the accent, `muted` is the tertiary slate, disabled is
   * the refusing grey, and everything else is the navigation blue. **None of them is a caller's to
   * choose** — see `fill` for the round in which one of them was and what it cost.
   */
  function faceColour(): number {
    if (!enabled) return KIT.disabled
    if (solid || primary) return fill
    if (muted) return KIT.btnMuted
    return KIT.btnFace
  }

  /**
   * The shipped look: one nine-slice, the engine's rim under it, the label on top.
   *
   * Returns false when the masters have not loaded, which is not hypothetical — `Preloader` draws
   * its own retry button, and a scene forced to start early under the stepping harness gets the
   * same. The caller then falls back to the kit's original drawing rather than to nothing.
   *
   * **The sink is a position, not a repaint.** The pressed master is `UI_SINK` px shorter and is
   * placed with its bottom edge where the resting one's was, so the button visibly sits down onto
   * its own lip. That is the half of "pressed" a tint cannot reach, and it is why the pressed state
   * is a second sprite rather than a darker draw — see ART-STYLE.md.
   */
  function drawSprite(): boolean {
    const sunk = pressed && enabled
    const key = bakeUiSprite(scene, 'btn', sunk, faceColour())

    if (!key) return false

    const sink = sunk ? UI_SINK : 0
    const boxHeight = Math.max(height - sink, MIN_TOUCH - sink)

    if (!sprite) {
      sprite = scene.add.nineslice(
        0, 0, key, undefined, width, boxHeight, UI_SLICE, UI_SLICE, UI_SLICE, UI_SLICE,
      )
      container.addAt(sprite, 1)
    } else {
      sprite.setTexture(key)
      sprite.setSlices(width, boxHeight, UI_SLICE, UI_SLICE, UI_SLICE, UI_SLICE)
    }
    sprite.setPosition(0, sink / 2)

    rim.clear()
    rim.lineStyle(RIM_STROKE, KIT.rim, enabled ? 0.85 : 0.4)
    rim.strokeRoundedRect(-width / 2, -height / 2 + sink, width, boxHeight, UI_RADIUS)

    // **Centred on the FACE, not on the sprite.** The lip is the bottom `UI_CHEEK` px of a resting
    // button, so a label centred in the whole box sits low by half of it. Pressed, the face's own
    // centre has moved down by exactly the sink, which is what carries the label with the shape.
    label.setY(sunk ? (UI_SINK - (UI_CHEEK - UI_SINK)) / 2 : -UI_CHEEK / 2)
    return true
  }

  function redraw(): void {
    const scale = uiScale(scene.scale.width)

    width = Math.max(label.width + BUTTON.padX * 2 * scale, MIN_TOUCH, minWidth)
    height = Math.max(label.height + BUTTON.padY * 2 * scale, MIN_TOUCH)

    // The sprite path is the shipped look; the graphics below it is what a scene drawing before
    // `Preloader` has finished falls back to. **Both have to reach the hit-area block at the end**,
    // which is why this is a flag rather than an early return — the first version returned here and
    // took a fully sized, fully visible button's own input with it.
    const drewSprite = drawSprite()

    const accent = !enabled ? KIT.disabled : primary ? KIT.active : muted ? KIT.muted : KIT.rim
    // **⚠ This used to be called `fill`, which shadowed the solid variant's own colour and drew an
    // invisible button.** The outer `fill` is what a `solid` button is painted in; this one is the
    // wash behind an *outlined* button,
    // and for anything not `primary` that wash is `KIT.plate` — the panel's own colour. With the two
    // sharing a name, `solid` read the wash: a plate-coloured fill on a plate, under a label already
    // drawn in `KIT.plate` because the solid variant expects a bright fill behind it. The result was
    // a correctly sized, correctly positioned, fully clickable rectangle with nothing visible in it,
    // which is exactly how the result screen's `Again` was reported. It survived because the only
    // other two `solid` callers pass `primary: true` as well, and `primary` is the one case where
    // the shadowed value happens to equal the real one.
    const wash = primary && enabled ? KIT.active : KIT.plate
    const fillAlpha = primary && enabled ? (pressed ? 0.34 : hovered ? 0.24 : 0.16) : muted ? (pressed ? 0.6 : 0.32) : pressed ? 0.9 : 0.72
    const halfW = width / 2
    const halfH = height / 2
    const radius = BUTTON.radius * scale

    background.clear()

    if (drewSprite) {
      // Nothing more to paint. The label still has to be coloured and the hit area still has to be
      // recomputed, so the common tail below runs either way.
    } else if (solid && enabled) {
      const drop = SOLID_SHADOW * scale
      // Pressed sinks onto its own shadow, which is the whole travel a flat button has.
      const sink = pressed ? drop : 0

      background.fillStyle(KIT.plate, 0.85)
      background.fillRoundedRect(-halfW, -halfH + drop, width, height, radius)
      background.fillStyle(fill, hovered ? 1 : 0.94)
      background.fillRoundedRect(-halfW, -halfH + sink, width, height, radius)
      background.lineStyle(Math.max(1.5, 2 * scale), KIT.plate, 0.55)
      background.strokeRoundedRect(-halfW, -halfH + sink, width, height, radius)
      label.setY(sink)
    } else {
      background.fillStyle(wash, fillAlpha)
      background.fillRoundedRect(-halfW, -halfH, width, height, radius)
      background.lineStyle(
        Math.max(1.5, 2 * scale),
        accent,
        enabled ? (hovered || pressed ? 1 : muted ? 0.45 : 0.8) : 0.5,
      )
      background.strokeRoundedRect(-halfW, -halfH, width, height, radius)
    }

    // The primary button carries one extra mark rather than a different shape: a diamond at each
    // end, which is the shields' own glyph and the kit's way of saying "this is the one".
    // Only on the fallback: on the sprite path the tier is said by the face colour and the lip,
    // and a diamond on top of that would be a third statement of the same thing.
    if (primary && enabled && !solid && !drewSprite) {
      background.fillStyle(KIT.active, 0.9)
      for (const x of [-halfW + 10 * scale, halfW - 10 * scale]) {
        const size = 4 * scale

        background.fillTriangle(x, -size, x + size * 0.8, 0, x, size)
        background.fillTriangle(x, -size, x - size * 0.8, 0, x, size)
      }
    }

    if (drewSprite) {
      // **White with a dark stroke, on every tier and every face.** The primary button's face
      // comes from the theme, so no fixed label colour can be guaranteed to read on it — a stroke
      // is legible against whatever is behind it, which is the same argument the front screen's
      // wordmark is under and the reason the measured scrim was deleted there.
      label.setColor('#ffffff')
      label.setStroke(css(KIT.plate), Math.max(2, fontSize * LABEL_INK))
      label.setAlpha(enabled ? 1 : 0.65)
    } else {
      label.setColor(css(!enabled ? KIT.muted : solid ? KIT.plate : muted && !hovered ? KIT.muted : KIT.rim))
    }
    container.setSize(width, height)

    // Both hit-area traps, in the one branch the whole kit shares: a `Container`'s origin is fixed
    // at 0.5, so `setSize` shifts its display origin and the hit test adds that offset to the local
    // point — a hitArea built around (0, 0) therefore has to *start* at (0, 0), not at (-halfW,
    // -halfH). And a second `setInteractive()` never recomputes the area, so a resize mutates it.
    if (!container.input) {
      container.setInteractive({
        hitArea: new Phaser.Geom.Rectangle(0, 0, width, height),
        hitAreaCallback: Phaser.Geom.Rectangle.Contains,
        useHandCursor: true,
      })
    } else {
      ;(container.input.hitArea as Phaser.Geom.Rectangle).setTo(0, 0, width, height)
    }
    // **⚠ A disabled button must not accept the press, and dimming it was never enough.**
    // `setEnabled(false)` only ever changed the drawing, so every binder on this container went on
    // firing — and `bindAction` takes a bare `GameObject`, so there is nowhere else this could be
    // decided. What the player got was a control that looks refused, accepts the tap, and does
    // nothing at all: reported against the result panel's `Continue · 45` with a purse that could
    // not pay for it, which is exactly the state this is for.
    //
    // Taking the input off the object rather than guarding each callback is what makes it true for
    // *every* binder, including any added later, and it is also what makes the tap fall through to
    // whatever is behind — which on the result panel is the plate, i.e. nothing.
    if (container.input) container.input.enabled = enabled
  }

  container.on(Phaser.Input.Events.POINTER_OVER, () => {
    hovered = true
    redraw()
  })
  container.on(Phaser.Input.Events.POINTER_OUT, () => {
    hovered = false
    pressed = false
    redraw()
  })
  container.on(Phaser.Input.Events.POINTER_DOWN, () => {
    pressed = true
    redraw()
  })
  container.on(Phaser.Input.Events.POINTER_UP, () => {
    pressed = false
    redraw()
  })

  redraw()


  return {
    container,
    label,
    get width() {
      return width
    },
    get height() {
      return height
    },
    setText(next) {
      label.setText(next)
      redraw()
    },
    setFontSize(size) {
      fontSize = size
      label.setFontSize(size)
      redraw()
    },
    setPrimary(next) {
      primary = next
      redraw()
    },
    setEnabled(next) {
      enabled = next
      redraw()
    },
    setMinWidth(next) {
      minWidth = next
      redraw()
    },
  }
}

/**
 * A labelled slider with a percentage readout.
 *
 * **Drag *and* tap, and the difference is the reason `ui/gesture.ts` is shared.** A drag along the
 * track sets the value continuously; a tap on it jumps there. Both are wanted — a finger drags, a
 * mouse clicks — and neither may be mistaken for the other, because this control lives on an
 * overlay above a game whose own verb is a drag.
 */
export interface KitSlider {
  readonly gameObjects: readonly Phaser.GameObjects.GameObject[]
  /** Positions the whole row: label left, readout right, track between them. */
  layout(centreX: number, y: number, width: number, scale: number): void
  setValue(value: number): void
  value(): number
  setEnabled(enabled: boolean): void
  destroy(): void
}

export function kitSlider(
  scene: Phaser.Scene,
  labelText: string,
  initial: number,
  onChange: (value: number) => void,
  depth = 0,
): KitSlider {
  const label = scene.add
    .text(0, 0, labelText, { fontFamily: 'Arial', fontSize: 18, color: css(KIT.rim) })
    .setOrigin(0, 0.5)
    .setDepth(depth + 1)
  const readout = scene.add
    .text(0, 0, t('percent', { n: percentFor(initial) }), { fontFamily: 'Arial', fontSize: 18, color: css(KIT.muted) })
    .setOrigin(1, 0.5)
    .setDepth(depth + 1)
  const track = scene.add.graphics().setDepth(depth)
  const hit = scene.add.zone(0, 0, 10, 10).setOrigin(0.5, 0.5)

  let value = initial
  let enabled = true
  let trackLeft = 0
  let trackWidth = 0
  let trackY = 0
  let scale = 1
  let pressAt: { x: number; y: number } | null = null
  let dragging = false

  function redraw(): void {
    const handle = SLIDER.handle * scale
    const height = SLIDER.track * scale
    const filledTo = xForValue(value, trackLeft, trackWidth, handle)

    track.clear()

    // The rail, with the road's own rungs as ticks: the same rhythm the ground is marked with, so
    // the control reads as part of this game rather than as a browser input.
    track.fillStyle(KIT.plate, 0.85)
    track.fillRoundedRect(trackLeft, trackY - height / 2, trackWidth, height, height / 2)
    track.fillStyle(enabled ? KIT.active : KIT.disabled, 0.85)
    track.fillRoundedRect(trackLeft, trackY - height / 2, Math.max(height, filledTo - trackLeft), height, height / 2)

    for (let i = 0; i <= SLIDER.ticks; i++) {
      const x = trackLeft + (trackWidth * i) / SLIDER.ticks

      track.fillStyle(KIT.rim, 0.28)
      track.fillRect(x - 1, trackY + height * 0.9, 2, height * 0.7)
    }

    // The handle is the shields' diamond, not a circle.
    const size = handle / 2

    track.fillStyle(enabled ? KIT.rim : KIT.muted, 1)
    track.fillTriangle(filledTo, trackY - size, filledTo + size * 0.8, trackY, filledTo, trackY + size)
    track.fillTriangle(filledTo, trackY - size, filledTo - size * 0.8, trackY, filledTo, trackY + size)
    track.lineStyle(Math.max(1, 1.5 * scale), enabled ? KIT.active : KIT.disabled, 0.9)
    track.strokeCircle(filledTo, trackY, size * 0.55)

    readout.setText(t('percent', { n: percentFor(value) }))
    // The label dims with the rail, not just the readout: a bright name over a grey control reads
    // as a control that is merely quiet rather than one that is switched off.
    label.setColor(css(enabled ? KIT.rim : KIT.muted))
    readout.setColor(css(enabled ? KIT.rim : KIT.muted))
  }

  function apply(x: number): void {
    if (!enabled) return

    const next = valueFromX(x, trackLeft, trackWidth, SLIDER.handle * scale)

    if (next === value) return

    value = next
    redraw()
    onChange(value)
  }

  hit.setInteractive({ useHandCursor: true })
  hit.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
    pressAt = { x: pointer.x, y: pointer.y }
    dragging = true
    apply(pointer.x)
  })
  scene.input.on(Phaser.Input.Events.POINTER_MOVE, (pointer: Phaser.Input.Pointer) => {
    if (!dragging || !pointer.isDown) return
    // Past the tap slop it is a drag, and a drag tracks the finger even when it leaves the track's
    // own box — a slider that stopped responding the moment the finger drifted off the rail would
    // be unusable with a thumb.
    if (pressAt && !isTap(pressAt, pointer, scale)) apply(pointer.x)
  })
  const release = () => {
    dragging = false
    pressAt = null
  }

  scene.input.on(Phaser.Input.Events.POINTER_UP, release)
  scene.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, release)

  return {
    gameObjects: [track, label, readout, hit],
    layout(centreX, y, width, nextScale) {
      scale = nextScale
      label.setFontSize(18 * scale)
      readout.setFontSize(18 * scale)

      // **An empty label reserves nothing, and that is what lets a slider be a whole row.** The
      // settings panel names its channel on the line above, so a second "Volume" beside the track
      // said nothing and cost 30% of the row — on a phone that is the difference between a rail a
      // thumb can aim at and one it cannot.
      const labelWidth = labelText === '' ? 0 : Math.max(width * 0.3, label.width + 8 * scale)
      const readoutWidth = Math.max(width * 0.14, readout.width + 8 * scale)

      label.setPosition(centreX - width / 2, y)
      readout.setPosition(centreX + width / 2, y)
      trackLeft = centreX - width / 2 + labelWidth
      trackWidth = Math.max(40 * scale, width - labelWidth - readoutWidth)
      trackY = y

      // The hit zone is the track padded to the touch minimum in height: the rail itself is 8px,
      // which nobody can hit with a thumb, and a control that needs precision to *start* using is
      // one the player never discovers is draggable.
      hit.setPosition(trackLeft + trackWidth / 2, trackY)
      hit.setSize(trackWidth + SLIDER.handle * scale, sliderHitHeight(scale))
      if (hit.input) (hit.input.hitArea as Phaser.Geom.Rectangle).setTo(0, 0, hit.width, hit.height)
      redraw()
    },
    setValue(next) {
      value = next
      redraw()
    },
    value() {
      return value
    },
    setEnabled(next) {
      enabled = next
      redraw()
    },
    destroy() {
      scene.input.off(Phaser.Input.Events.POINTER_UP, release)
      scene.input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, release)
      for (const object of [track, label, readout, hit]) object.destroy()
    },
  }
}

/**
 * A switch: the on/off control beside a slider.
 *
 * Two diamonds and a rail rather than a word, because it sits next to a percentage and a row of
 * words all saying `ON`/`OFF` is a screen the eye cannot skim. The state is the *position* of the
 * diamond, which is a shape difference rather than a colour one.
 */
export interface KitToggle {
  readonly container: Phaser.GameObjects.Container
  readonly width: number
  readonly height: number
  /**
   * Flips the switch and reports the new state.
   *
   * **The widget binds no pointer handler of its own**, which is the one place this kit differs
   * from the template's: a toggle has to be reachable from a key as well as from a tap (`S` and
   * `M` in Settings), and this project's standing rule is that a scene binds one named *action* to
   * every source that can trigger it rather than letting each source find its own way in. A widget
   * that also handled its own `pointerdown` would fire twice for one tap the moment the scene did
   * the right thing. So the scene owns the binding and calls this.
   */
  toggle(): void
  setValue(on: boolean): void
  value(): boolean
  layout(scale: number): void
}

export function kitToggle(scene: Phaser.Scene, initial: boolean, onChange: (on: boolean) => void): KitToggle {
  const graphics = scene.add.graphics()
  const container = scene.add.container(0, 0, [graphics])

  let on = initial
  let width = 0
  let height = 0
  let scale = 1

  function redraw(): void {
    width = Math.max(46 * scale, MIN_TOUCH)
    height = Math.max(26 * scale, MIN_TOUCH * 0.6)

    const halfW = width / 2
    const halfH = height / 2
    const knob = xForValue(on ? 1 : 0, -halfW + halfH, width - height, 0)

    graphics.clear()
    graphics.fillStyle(on ? KIT.active : KIT.plate, on ? 0.28 : 0.8)
    graphics.fillRoundedRect(-halfW, -halfH, width, height, halfH)
    graphics.lineStyle(Math.max(1.5, 2 * scale), on ? KIT.active : KIT.muted, 0.9)
    graphics.strokeRoundedRect(-halfW, -halfH, width, height, halfH)

    const size = halfH * 0.72

    graphics.fillStyle(on ? KIT.rim : KIT.muted, 1)
    graphics.fillTriangle(knob, -size, knob + size * 0.8, 0, knob, size)
    graphics.fillTriangle(knob, -size, knob - size * 0.8, 0, knob, size)

    container.setSize(width, height)
    if (!container.input) {
      container.setInteractive({
        hitArea: new Phaser.Geom.Rectangle(0, 0, Math.max(width, MIN_TOUCH), Math.max(height, MIN_TOUCH)),
        hitAreaCallback: Phaser.Geom.Rectangle.Contains,
        useHandCursor: true,
      })
    } else {
      ;(container.input.hitArea as Phaser.Geom.Rectangle).setTo(
        0,
        0,
        Math.max(width, MIN_TOUCH),
        Math.max(height, MIN_TOUCH),
      )
    }
  }

  redraw()

  return {
    container,
    get width() {
      return width
    },
    get height() {
      return height
    },
    toggle() {
      on = !on
      redraw()
      onChange(on)
    },
    setValue(next) {
      on = next
      redraw()
    },
    value() {
      return on
    },
    layout(nextScale) {
      scale = nextScale
      redraw()
    },
  }
}

/** A title, in the display font, with the kit's rim colour. */
export function kitTitle(scene: Phaser.Scene, text: string, fontSize = 26): Phaser.GameObjects.Text {
  const title = scene.add
    .text(0, 0, text, { fontFamily: getDisplayFontStack(), fontSize, color: css(KIT.rim) })
    .setOrigin(0.5)

  applyPanelInk(title, fontSize)

  return title
}

/**
 * The menu's own ink treatment, applied to a panel's title.
 *
 * **⚠ The panels and the menu were two different games to look at, and the panels were the ones in
 * the wrong one.** The world and the front screen are a warm cartoon whose type is heavy and
 * outlined; the shop and the result screen were a dark-blue dashboard with thin rims and a plain
 * drop shadow. Reported as exactly that mismatch, with the instruction that the panels come to the
 * menu rather than the other way round -- which is the right direction, because the menu's language
 * is the one the *game* is drawn in and a panel is the guest.
 *
 * The stroke is a **fraction of the face**, not a pixel count, for `TITLE_INK`'s reason: these
 * titles shrink to fit a narrow frame, and a 4px rim on a 26px face is a blob on the 14px one.
 */
export function applyPanelInk(text: Phaser.GameObjects.Text, fontSize: number): void {
  text.setStroke(css(KIT.plate), Math.max(2, fontSize * PANEL_INK.stroke))
  text.setShadow(0, Math.max(2, fontSize * PANEL_INK.shadowY), 'rgba(0,0,0,0.55)', 0, false, true)
}

/** The menu's `TITLE_INK`, at the weight a panel's smaller type carries. */
const PANEL_INK = { stroke: 0.16, shadowY: 0.1 } as const

/**
 * The panel's border, brought to the menu's language.
 *
 * `radius` stays a multiple of the Play button's own so the two cannot drift: the brief asks for
 * "rounding like the Play button", and the only way to keep that true is to say it in terms of it.
 */
const PANEL_RIM = { weight: 1.8, alpha: 0.85, radius: 1.6 } as const

/** A `[icon value]` readout — coins, and anything else counted. */
export interface KitBadge {
  readonly container: Phaser.GameObjects.Container
  readonly width: number
  setValue(value: number | string): void
  layout(scale: number): void
}

export function kitBadge(scene: Phaser.Scene, icon: string, value: number | string): KitBadge {
  const label = scene.add
    .text(0, 0, `${icon} ${value}`, { fontFamily: 'Arial', fontSize: 18, color: css(KIT.coin) })
    .setOrigin(0.5)
  const background = scene.add.graphics()
  const container = scene.add.container(0, 0, [background, label])

  let width = 0
  let current = String(value)

  function redraw(scale = 1): void {
    label.setFontSize(18 * scale)
    label.setText(`${icon} ${current}`)
    width = label.width + 20 * scale

    const height = label.height + 10 * scale

    background.clear()
    background.fillStyle(KIT.plate, 0.75)
    background.fillRoundedRect(-width / 2, -height / 2, width, height, height / 2)
    background.lineStyle(Math.max(1, 1.5 * scale), KIT.coin, 0.7)
    background.strokeRoundedRect(-width / 2, -height / 2, width, height, height / 2)
    container.setSize(width, height)
  }

  redraw()

  return {
    container,
    get width() {
      return width
    },
    setValue(next) {
      current = String(next)
      redraw()
    },
    layout(scale) {
      redraw(scale)
    },
  }
}

/** What a catalogue row is currently offering. */
export type RowState = 'buy' | 'locked' | 'owned' | 'selected'

/**
 * A catalogue row: name, price, and one state mark.
 *
 * **One row shape for four states, distinguished by mark and dimming rather than by colour alone.**
 * A shop where "owned", "in use", "buy" and "cannot afford" differ only in the tint of the same
 * label is a shop the player has to read word by word; the diamond marks the one in use, the rim
 * brightens the ones they can act on, and the rest recede.
 */
/**
 * A hairline rule, for grouping a panel's content.
 *
 * **A panel with two jobs needs to say where one ends**, and the alternative — spacing alone — is
 * what made the result screen read as four things floating at even intervals rather than as a
 * readout and a set of actions. Stateless like `plate`: it is drawn at the point it is given every
 * `layout()`, so it owns no position of its own.
 */
export interface KitDivider {
  readonly graphics: Phaser.GameObjects.Graphics
  draw(centreX: number, y: number, width: number, scale: number): void
}

export function kitDivider(scene: Phaser.Scene, depth = 0): KitDivider {
  const graphics = scene.add.graphics().setDepth(depth)

  return {
    graphics,
    draw(centreX, y, width, scale) {
      const line = Math.max(1.5, 1.5 * scale)

      graphics.clear()
      // Two lines rather than one: the kit's whole idiom is a lit edge over a dark one, and a
      // single stroke on a dark plate reads as a scratch. **⚠ At one pixel and 0.16 alpha the first
      // version was invisible on a real frame** — a rule has to be seen to group anything, and a
      // divider nobody can see is whitespace with a draw call.
      graphics.fillStyle(KIT.plate, 0.95)
      graphics.fillRect(centreX - width / 2, y, width, line)
      graphics.fillStyle(KIT.rim, 0.35)
      graphics.fillRect(centreX - width / 2, y - line, width, line)
    },
  }
}

export interface KitRow {
  readonly container: Phaser.GameObjects.Container
  readonly height: number
  /**
   * `actionLabel` overrides what the right-hand column says.
   *
   * There because `'owned'` means two different things depending on the caller: a permanent
   * capability the player has bought and will never touch again, and a cosmetic they own but are
   * not currently using. The row cannot tell those apart — only the scene knows whether there is
   * anything to select — so the default reads as the selectable case and a caller with no selector
   * says so. Getting this wrong shows the player a `Select` that does nothing.
   *
   * **⚠ The state column is about 76px wide at scale 1** — it is right-aligned 12px from the row's
   * edge and the price is right-aligned 88px from it — so a long override draws straight through
   * the price. Every state this widget ships with fits (`Buy`, `Owned`, `Select`, `In use`,
   * `Locked`); a caller wanting to say more than two words belongs in the *title*, which is
   * left-aligned and has the rest of the row. Found by looking at a frame of the stage picker,
   * because nothing here measures a column against its own text.
   */
  setContent(title: string, price: string, state: RowState, actionLabel?: string): void
  layout(width: number, height: number, scale: number): void
}

export function kitRow(scene: Phaser.Scene, title: string, price: string, state: RowState): KitRow {
  const background = scene.add.graphics()
  const titleText = scene.add.text(0, 0, title, { fontFamily: 'Arial', fontSize: 17, color: css(KIT.rim) }).setOrigin(0, 0.5)
  const priceText = scene.add.text(0, 0, price, { fontFamily: 'Arial', fontSize: 16, color: css(KIT.coin) }).setOrigin(1, 0.5)
  const stateText = scene.add.text(0, 0, '', { fontFamily: 'Arial', fontSize: 15, color: css(KIT.muted) }).setOrigin(1, 0.5)
  const container = scene.add.container(0, 0, [background, titleText, priceText, stateText])

  let width = 0
  let height = 0
  let scale = 1
  let current: RowState = state
  let override: string | undefined

  /**
   * What the right-hand column reads for each state.
   *
   * **⚠ `'locked'` fell through to `Buy` for as long as this widget has existed.** `RowState` has
   * four values and this handled three, so a locked row invited the player to buy the thing it was
   * refusing. It was invisible because every caller until now passed an `override` for exactly that
   * state — the shop says `Locked`, the level list named the level that opens it — so the default
   * was never reached. Found the first time a caller left it to the widget.
   *
   * The general form is one this project keeps meeting: **a default nothing has ever taken is a
   * default nobody has ever checked.**
   */
  function stateLabel(value: RowState): string {
    if (override !== undefined) return override
    if (value === 'selected') return t('selected')
    if (value === 'owned') return t('select')
    if (value === 'locked') return t('shopLocked')

    return t('buy')
  }

  function redraw(): void {
    // Nothing to draw before the first `layout()`: a zero-width row would also create its hit area
    // at zero size, and a `Container`'s hit area is only *recomputed* by the resize branch — so an
    // interactive object built at 0x0 here would work, but only because layout fixes it a moment
    // later. Skipping the draw makes that not a thing to reason about.
    if (width <= 0 || height <= 0) return

    const halfW = width / 2
    const halfH = height / 2
    const actionable = current === 'buy' || current === 'owned'
    const accent = current === 'selected' ? KIT.active : actionable ? KIT.rim : KIT.disabled

    background.clear()
    background.fillStyle(KIT.plate, current === 'selected' ? 0.85 : 0.6)
    background.fillRoundedRect(-halfW, -halfH, width, height, BUTTON.radius * scale)
    background.lineStyle(Math.max(1, 1.5 * scale), accent, current === 'selected' ? 1 : actionable ? 0.7 : 0.35)
    background.strokeRoundedRect(-halfW, -halfH, width, height, BUTTON.radius * scale)

    // The in-use row carries the diamond, on the left where the eye starts.
    if (current === 'selected') {
      const size = 5 * scale
      const x = -halfW + 12 * scale

      background.fillStyle(KIT.active, 1)
      background.fillTriangle(x, -size, x + size * 0.8, 0, x, size)
      background.fillTriangle(x, -size, x - size * 0.8, 0, x, size)
    }

    titleText.setFontSize(17 * scale)
    priceText.setFontSize(16 * scale)
    stateText.setFontSize(15 * scale)
    titleText.setPosition(-halfW + (current === 'selected' ? 26 : 14) * scale, 0)
    priceText.setPosition(halfW - 88 * scale, 0)
    stateText.setPosition(halfW - 12 * scale, 0)
    stateText.setText(stateLabel(current))
    titleText.setColor(css(actionable || current === 'selected' ? KIT.rim : KIT.muted))
    priceText.setColor(css(current === 'buy' ? KIT.coin : KIT.muted))
    stateText.setColor(css(current === 'selected' ? KIT.active : actionable ? KIT.rim : KIT.muted))

    container.setSize(width, height)
    if (!container.input) {
      container.setInteractive({
        hitArea: new Phaser.Geom.Rectangle(0, 0, width, height),
        hitAreaCallback: Phaser.Geom.Rectangle.Contains,
        useHandCursor: true,
      })
    } else {
      ;(container.input.hitArea as Phaser.Geom.Rectangle).setTo(0, 0, width, height)
    }
  }

  return {
    container,
    get height() {
      return height
    },
    setContent(nextTitle, nextPrice, nextState, actionLabel) {
      titleText.setText(nextTitle)
      priceText.setText(nextPrice)
      current = nextState
      override = actionLabel
      redraw()
    },
    layout(nextWidth, nextHeight, nextScale) {
      width = nextWidth
      height = nextHeight
      scale = nextScale
      redraw()
    },
  }
}

/**
 * Re-exported so a scene needs one import: the palette lives in `ui/kitPalette.ts` because it has
 * to be reachable from Node (see that file), and `stepValue` beside it for a keyboard binding.
 */
export { KIT, stepValue }
