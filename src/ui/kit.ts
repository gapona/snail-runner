import * as Phaser from 'phaser'
import { t } from '../i18n/strings'
import { getDisplayFontStack } from './font'
import { isTap } from './gesture'
import { ensureScrimTexture, SCRIM_TEXTURE } from './scrimTexture'
import { percentFor, stepValue, valueFromX, xForValue } from './sliderMath'
import { BUTTON_GEOMETRY, KIT, MIN_TOUCH, SLIDER_GEOMETRY, sliderHitHeight } from './kitPalette'
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
      rim.fillRoundedRect(x - width / 2, y - height / 2, width, height, BUTTON.radius * 1.6)
      rim.lineStyle(thickness, KIT.rim, 0.5)
      rim.strokeRoundedRect(x - width / 2, y - height / 2, width, height, BUTTON.radius * 1.6)
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
  options?: { primary?: boolean; fontSize?: number; fontFamily?: string },
): KitButton {
  const label = scene.add
    .text(0, 0, text, {
      fontFamily: options?.fontFamily ?? 'Arial',
      fontSize: options?.fontSize ?? 20,
      color: css(KIT.rim),
    })
    .setOrigin(0.5)
  const background = scene.add.graphics()
  const container = scene.add.container(0, 0, [background, label])

  let primary = options?.primary ?? false
  let enabled = true
  let hovered = false
  let pressed = false
  let minWidth = 0
  let width = 0
  let height = 0

  function redraw(): void {
    const scale = uiScale(scene.scale.width)

    width = Math.max(label.width + BUTTON.padX * 2 * scale, MIN_TOUCH, minWidth)
    height = Math.max(label.height + BUTTON.padY * 2 * scale, MIN_TOUCH)

    const accent = !enabled ? KIT.disabled : primary ? KIT.active : KIT.rim
    const fill = primary && enabled ? KIT.active : KIT.plate
    const fillAlpha = primary && enabled ? (pressed ? 0.34 : hovered ? 0.24 : 0.16) : pressed ? 0.9 : 0.72
    const halfW = width / 2
    const halfH = height / 2

    background.clear()
    background.fillStyle(fill, fillAlpha)
    background.fillRoundedRect(-halfW, -halfH, width, height, BUTTON.radius * scale)
    background.lineStyle(Math.max(1.5, 2 * scale), accent, enabled ? (hovered || pressed ? 1 : 0.8) : 0.5)
    background.strokeRoundedRect(-halfW, -halfH, width, height, BUTTON.radius * scale)

    // The primary button carries one extra mark rather than a different shape: a diamond at each
    // end, which is the shields' own glyph and the kit's way of saying "this is the one".
    if (primary && enabled) {
      background.fillStyle(KIT.active, 0.9)
      for (const x of [-halfW + 10 * scale, halfW - 10 * scale]) {
        const size = 4 * scale

        background.fillTriangle(x, -size, x + size * 0.8, 0, x, size)
        background.fillTriangle(x, -size, x - size * 0.8, 0, x, size)
      }
    }

    label.setColor(css(enabled ? KIT.rim : KIT.muted))
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

      const labelWidth = Math.max(width * 0.3, label.width + 8 * scale)
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

  title.setShadow(0, 2, 'rgba(0,0,0,0.6)', 5, false, true)

  return title
}

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

  function stateLabel(value: RowState): string {
    if (override !== undefined) return override
    if (value === 'selected') return t('selected')
    if (value === 'owned') return t('select')

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
