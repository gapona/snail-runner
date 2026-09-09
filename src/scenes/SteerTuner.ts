import * as Phaser from 'phaser'
import { bindAction } from '../platform/input'
import { bindLayout } from '../ui/layout'
import { kitButton, kitSlider, kitTitle, plate, type KitButton, type KitSlider, type Plate } from '../ui/kit'
import { KIT } from '../ui/kitPalette'
import { playerResponse } from '../run/constants'
import {
  STEER_PRESETS,
  applySteerPreset,
  getSteerTuning,
  setSteerTuning,
  steerPresetName,
  type SteerMode,
  type SteerPresetName,
} from '../run/steerTuning'
import { toCssColor } from '../ui/theme'
import { uiScale } from '../ui/uiScale'

/**
 * The DEV steering panel: three presets, two sliders, and the two ways a thumb can make a request.
 *
 * **This is an instrument, not a feature, and it is `import.meta.env.DEV`-gated at its one entry
 * point** (`RunScene`'s `T` binding) exactly as the shop's demo button and `window.__marks` are.
 * The scene is registered unconditionally, which costs the bundle its own size and nothing else —
 * `check-bundle.mjs` is what would notice if that ever stopped being true.
 *
 * **Why a panel over a paused run rather than sliders on the HUD.** Steering reads `pointer.x`
 * anywhere on the canvas, so a slider dragged during a run would steer the snail while it was being
 * adjusted — the control and the thing it controls would be the same gesture. `launchOverlay`
 * pauses the run, which makes that unrepresentable rather than merely unlikely, and the preset keys
 * bound in the run itself are what covers "change it without stopping".
 *
 * **The readout is the point of the whole screen.** Two numbers a player can feel are `zeta` (below
 * 1 the snail overshoots the gap and has to come back) and `tau` (how long it takes to get there),
 * and they are solved through `playerResponse()` — the same closed form `verify:player` asserts
 * against the real integrator, so what is printed here is what the tick actually does rather than a
 * second opinion about it.
 */

const BACKDROP_DEPTH = -20
const PANEL_WIDTH = 380
const MARGIN = 16
const ROW = 34

/** The two ends of each slider, so a 0..1 track means something a player can read. */
const STIFFNESS_RANGE = { min: 20, max: 140 }
const DAMPING_RANGE = { min: 0.7, max: 0.95 }
const SENSITIVITY_RANGE = { min: 0.5, max: 3.5 }

const lerp = (range: { min: number; max: number }, value: number) => range.min + (range.max - range.min) * value
const unlerp = (range: { min: number; max: number }, value: number) =>
  Math.min(1, Math.max(0, (value - range.min) / (range.max - range.min)))

const PRESET_NAMES: readonly SteerPresetName[] = ['viscous', 'current', 'snappy']
const MODES: readonly SteerMode[] = ['absolute', 'relative']

export class SteerTuner extends Phaser.Scene {
  private backdrop!: Phaser.GameObjects.Rectangle
  private panel!: Plate
  private title!: Phaser.GameObjects.Text
  private presetButtons: KitButton[] = []
  private modeButtons: KitButton[] = []
  private stiffness!: KitSlider
  private damping!: KitSlider
  private sensitivity!: KitSlider
  private readout!: Phaser.GameObjects.Text
  private closeButton!: KitButton

  constructor() {
    super('SteerTuner')
  }

  create(): void {
    // Reset every list `create` builds, in `create`. `Shop` crashed the second time it was opened
    // because it reset its rows here and not its tabs, and the throw came out of the text renderer
    // looking exactly like a destroyed-texture bug.
    this.presetButtons = []
    this.modeButtons = []

    const tuning = getSteerTuning()

    this.backdrop = this.add.rectangle(0, 0, 0, 0, 0x000000, 0.55).setOrigin(0, 0).setDepth(BACKDROP_DEPTH)
    this.panel = plate(this)
    this.title = kitTitle(this, 'Steering', 22)

    for (const name of PRESET_NAMES) {
      const button = kitButton(this, name, { fontSize: 15 })

      bindAction(this, `preset-${name}`, { pointer: button.container }, () => {
        applySteerPreset(name)
        this.refresh()
      })
      this.presetButtons.push(button)
    }

    for (const mode of MODES) {
      const button = kitButton(this, mode, { fontSize: 15 })

      bindAction(this, `mode-${mode}`, { pointer: button.container }, () => {
        setSteerTuning({ mode })
        this.refresh()
      })
      this.modeButtons.push(button)
    }

    this.stiffness = kitSlider(this, 'stiffness', unlerp(STIFFNESS_RANGE, tuning.stiffness), (value) => {
      setSteerTuning({ stiffness: Math.round(lerp(STIFFNESS_RANGE, value)) })
      this.refresh()
    })
    this.damping = kitSlider(this, 'damping', unlerp(DAMPING_RANGE, tuning.damping), (value) => {
      setSteerTuning({ damping: Math.round(lerp(DAMPING_RANGE, value) * 200) / 200 })
      this.refresh()
    })
    this.sensitivity = kitSlider(this, 'sensitivity', unlerp(SENSITIVITY_RANGE, tuning.sensitivity), (value) => {
      setSteerTuning({ sensitivity: Math.round(lerp(SENSITIVITY_RANGE, value) * 100) / 100 })
      this.refresh()
    })

    this.readout = this.add
      .text(0, 0, '', { fontFamily: 'monospace', fontSize: 13, color: toCssColor(KIT.muted), align: 'left' })
      .setOrigin(0, 0.5)

    this.closeButton = kitButton(this, 'Play', { solid: true, fontSize: 18 })
    bindAction(this, 'close', { pointer: [this.closeButton.container, this.backdrop], keys: ['ESC', 'T', 'ENTER'] }, () =>
      this.close(),
    )

    bindLayout(this, (width, height) => this.layout(width, height))
    this.refresh()
  }

  /** Repaints every control from the live tuning, so the panel can never disagree with the run. */
  private refresh(): void {
    const tuning = getSteerTuning()
    const active = steerPresetName(tuning)
    const response = playerResponse(tuning.stiffness, tuning.damping)

    for (let i = 0; i < PRESET_NAMES.length; i++) this.presetButtons[i].setPrimary(PRESET_NAMES[i] === active)
    for (let i = 0; i < MODES.length; i++) this.modeButtons[i].setPrimary(MODES[i] === tuning.mode)

    // The sliders are set from the tuning rather than trusted to be it, so a preset button moves
    // both tracks and neither can drift from the value the run is actually integrating.
    this.stiffness.setValue(unlerp(STIFFNESS_RANGE, tuning.stiffness))
    this.damping.setValue(unlerp(DAMPING_RANGE, tuning.damping))
    this.sensitivity.setValue(unlerp(SENSITIVITY_RANGE, tuning.sensitivity))
    // Sensitivity is the relative mode's own knob and means nothing in absolute, where the mapping
    // is the projection's. A control that cannot do anything says so by being disabled.
    this.sensitivity.setEnabled(tuning.mode === 'relative')

    this.readout.setText(
      [
        `k ${tuning.stiffness.toFixed(0).padStart(3)}   d ${tuning.damping.toFixed(3)}`,
        `zeta ${response.dampingRatio.toFixed(2)}  ${response.oscillates ? '(overshoots)' : '(never overshoots)'}`,
        `tau  ${(response.timeConstantSec * 1000).toFixed(0)} ms   lag ${response.lagPerPointerSpeed.toFixed(3)}`,
        `mode ${tuning.mode}   sens ${tuning.sensitivity.toFixed(2)}`,
      ].join('\n'),
    )
  }

  private close(): void {
    this.scene.stop()
    this.scene.resume('RunScene')
  }

  layout(width: number, height: number): void {
    this.backdrop.setSize(width, height)
    if (!this.backdrop.input) this.backdrop.setInteractive()
    else this.backdrop.input.hitArea.setTo(0, 0, width, height)

    const scale = Math.min(uiScale(width), height / 480)
    const panelWidth = Math.min(PANEL_WIDTH * scale, width - MARGIN * 2)
    const content = panelWidth - MARGIN * 2 * scale
    const rows = ROW * scale

    // **Every face is set before the panel is sized, not after.** `Text.height` is whatever the
    // last `setFontSize` left it at, so measuring the readout first and scaling it second sizes the
    // plate for a block of text that is no longer there — which drew the last line of the readout
    // under the Play button. The same measure-then-fit ordering every stacked panel here needs.
    this.title.setFontSize(22 * scale)
    this.readout.setFontSize(13 * scale)
    this.closeButton.setFontSize(18 * scale)
    for (const button of [...this.presetButtons, ...this.modeButtons]) button.setFontSize(15 * scale)

    const panelHeight = Math.min(
      height - MARGIN * 2,
      rows * 8 + this.readout.height + this.closeButton.height,
    )

    this.panel.draw(width / 2, height / 2, panelWidth, panelHeight)

    const left = width / 2 - content / 2
    let y = height / 2 - panelHeight / 2 + rows * 0.7

    this.title.setPosition(width / 2, y)
    y += rows

    this.layoutRow(this.presetButtons, left, y, content, scale)
    y += rows
    this.layoutRow(this.modeButtons, left, y, content, scale)
    y += rows * 1.1

    for (const slider of [this.stiffness, this.damping, this.sensitivity]) {
      slider.layout(width / 2, y, content, scale)
      y += rows
    }

    this.readout.setPosition(left, y + this.readout.height / 2)
    // A kit button draws a glow past its own `height`, so the gap has to clear the glow rather than
    // the core — measured, at 0.4 of a row the readout's last line sat 7px inside the Play button.
    y += this.readout.height + rows * 0.8

    this.closeButton.setMinWidth(content)
    this.closeButton.container.setPosition(width / 2, y + this.closeButton.height / 2)
  }

  /** Lays a row of buttons across the content width, evenly, each taking its own share. */
  private layoutRow(buttons: KitButton[], left: number, y: number, content: number, scale: number): void {
    const gap = 8 * scale
    const each = (content - gap * (buttons.length - 1)) / buttons.length

    for (let i = 0; i < buttons.length; i++) {
      buttons[i].setMinWidth(each)
      buttons[i].container.setPosition(left + each / 2 + i * (each + gap), y)
    }
  }
}
