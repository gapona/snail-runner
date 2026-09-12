import type * as Phaser from 'phaser'
import { JOYSTICK, joystickRadius, type Joystick } from '../platform/joystick'
import { HUD_DEPTH } from './hudDepth'

/**
 * The thumbstick, drawn where the finger is — see `platform/joystick.ts` for what it does.
 *
 * **Two `Image`s on generated textures, never a `Graphics`.** A circle in a `Graphics` is an arc,
 * and Phaser 4 tessellates every arc at a hundred points and replays the whole command buffer on
 * every frame it is visible — the cost the Fever tank and the life row were both taken off for.
 * This is on screen for as long as a thumb is down, which in a run is most of the time.
 *
 * **Under the HUD and over the world**, on `uiCamera`: it is a screen-space control, and a finger
 * on the verge must not put the stick under the scenery it is steering past.
 */
const BASE_TEXTURE = 'joystick-base'
const KNOB_TEXTURE = 'joystick-knob'
const BASE_SIZE = 256
const KNOB_SIZE = 128

/** How visible the stick is. It sits over the road the player is reading, so it is a shape, not a panel. */
const BASE_ALPHA = 0.55
const KNOB_ALPHA = 0.8

function ensureTextures(scene: Phaser.Scene): void {
  if (!scene.textures.exists(BASE_TEXTURE)) {
    const texture = scene.textures.createCanvas(BASE_TEXTURE, BASE_SIZE, BASE_SIZE)

    if (texture) {
      const c = texture.context
      const mid = BASE_SIZE / 2
      const ring = BASE_SIZE * 0.035

      c.clearRect(0, 0, BASE_SIZE, BASE_SIZE)
      // A faint dark disc, so the ring reads on the pale flagstone road as well as on a dark verge.
      c.fillStyle = 'rgba(16, 20, 28, 0.28)'
      c.beginPath()
      c.arc(mid, mid, mid - ring, 0, Math.PI * 2)
      c.fill()
      // Two strokes, dark under light: the same bracketing the obstacles' contour uses, for the
      // same reason — one tone cannot read against every ground this is drawn over.
      c.lineWidth = ring * 1.8
      c.strokeStyle = 'rgba(16, 20, 28, 0.45)'
      c.stroke()
      c.lineWidth = ring
      c.strokeStyle = 'rgba(255, 255, 255, 0.85)'
      c.stroke()

      // **The chevron at the top is the only instruction the stick carries**: up is a direction,
      // and it is the one that jumps. Left and right need no mark — the snail moving says so.
      const tip = BASE_SIZE * 0.14
      const arm = BASE_SIZE * 0.1

      c.lineCap = 'round'
      c.lineJoin = 'round'
      for (const [width, colour] of [[ring * 2.2, 'rgba(16, 20, 28, 0.45)'], [ring * 1.2, 'rgba(255, 255, 255, 0.9)']] as const) {
        c.lineWidth = width
        c.strokeStyle = colour
        c.beginPath()
        c.moveTo(mid - arm, tip + arm * 0.9)
        c.lineTo(mid, tip)
        c.lineTo(mid + arm, tip + arm * 0.9)
        c.stroke()
      }
      texture.refresh()
    }
  }

  if (!scene.textures.exists(KNOB_TEXTURE)) {
    const texture = scene.textures.createCanvas(KNOB_TEXTURE, KNOB_SIZE, KNOB_SIZE)

    if (texture) {
      const c = texture.context
      const mid = KNOB_SIZE / 2
      const rim = KNOB_SIZE * 0.06

      c.clearRect(0, 0, KNOB_SIZE, KNOB_SIZE)
      c.fillStyle = 'rgba(255, 255, 255, 0.9)'
      c.strokeStyle = 'rgba(16, 20, 28, 0.55)'
      c.lineWidth = rim
      c.beginPath()
      c.arc(mid, mid, mid - rim, 0, Math.PI * 2)
      c.fill()
      c.stroke()
      texture.refresh()
    }
  }
}

export class JoystickView {
  readonly gameObjects: readonly Phaser.GameObjects.GameObject[]

  private readonly base: Phaser.GameObjects.Image
  private readonly knob: Phaser.GameObjects.Image

  constructor(scene: Phaser.Scene) {
    ensureTextures(scene)
    this.base = scene.add.image(0, 0, BASE_TEXTURE).setDepth(HUD_DEPTH - 2).setAlpha(BASE_ALPHA).setVisible(false)
    this.knob = scene.add.image(0, 0, KNOB_TEXTURE).setDepth(HUD_DEPTH - 2).setAlpha(KNOB_ALPHA).setVisible(false)
    this.gameObjects = [this.base, this.knob]
  }

  /** Follows the stick. `shown` is false whenever the touch scheme is not the live one. */
  update(stick: Readonly<Joystick>, shown: boolean, width: number, height: number): void {
    const visible = shown && stick.active

    this.base.setVisible(visible)
    this.knob.setVisible(visible)

    if (!visible) return

    const radius = joystickRadius(width, height)

    this.base.setPosition(stick.baseX, stick.baseY).setDisplaySize(radius * 2, radius * 2)
    this.knob.setPosition(stick.knobX, stick.knobY).setDisplaySize(radius * 2 * JOYSTICK.knobShare, radius * 2 * JOYSTICK.knobShare)
  }

  destroy(): void {
    this.base.destroy()
    this.knob.destroy()
  }
}
