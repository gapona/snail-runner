/**
 * The floating thumbstick a finger steers and jumps with.
 *
 * **Rule: this file never imports `phaser`.** It is the arithmetic of one gesture, covered by
 * `npm run verify:player`; `bindSteering` feeds it pointer positions.
 *
 * **⚠ It is not drawn.** It shipped as a visible floating stick — a ring with a chevron and a knob
 * under the thumb — and the report on the phone was *remove the circle, leave just the drag*. That
 * is also the genre's own convention: a runner that steers continuously uses drag-anywhere with no
 * control on screen, and a swipe up to jump. So the stick below is an instrument rather than a
 * picture: it is what tells a flick up from the arc of a thumb steering sideways, and nothing else.
 * The names stay `joystick`, because the arithmetic is exactly a floating stick's.
 *
 * ## Why a stick, and why it floats
 *
 * Reported from the phone: the controls are doubtful, make a circle zone that works like a joystick
 * — left, right, and up. `measure:steering` had already said where the doubt comes from: steering
 * was *absolute*, so the thumb had to land on the column the snail should occupy, and on a portrait
 * phone the gap a row leaves is 19.9px against a 60px thumb patch. Relative drag — the snail moves
 * by as much as the thumb moves, from wherever it pressed — took a patient player's hits from 44 to
 * 8 on the same road. That mode existed behind a DEV key, which is to say behind a keyboard, which
 * is to say never on a phone.
 *
 * So a finger steers relative, and this adds **the third direction**: a tap still jumps, and a
 * flick up jumps too, without lifting the thumb that is steering — the one thing a single finger
 * could not do before.
 *
 * The stick floats — it is centred wherever the thumb lands — because a flick is measured from the
 * thumb and not from any fixed place on the screen.
 *
 * ## The base follows the thumb past the rim
 *
 * A stick that clamps at the rim stops answering the moment the thumb goes further — the "input has
 * stuck" failure the soft wall at the verge exists to avoid. Dragged past the rim, the base is
 * pulled along behind it, so the knob stays on the rim and the steering (which reads the thumb's
 * movement, not the knob's) is unaffected.
 *
 * ## ⚠ And it drifts back under the thumb, or "up" means nothing after the first steer
 *
 * The first version measured up from a base that only moved when pulled past the rim. Driven in
 * the running game: a 96px steer to the right left the knob on the rim, 46px right of the base, and
 * a 30px push up from there — a clear flick — **did not jump**, because it was 26px up against 38px
 * sideways. So a push up worked from the centre of a fresh stick and nowhere else, which is to say
 * never in the middle of a run, where the thumb has always just been steering.
 *
 * `settleJoystick` eases the base toward the thumb every frame over `recenterMs`. That makes "up"
 * a *flick* rather than a *position*: a quick push leaves the base behind and reads as up, a slow
 * drift is followed and does not — which is also what keeps the arc of a thumb sweeping sideways
 * from ever reading as a jump. It is a high-pass filter on the thumb, shaped like a stick.
 */

export const JOYSTICK = {
  /** The base's radius as a share of the frame's short side, bounded by `minRadius`/`maxRadius`. */
  radiusFraction: 0.12,
  /** A thumb is about 44 CSS px across; a stick narrower than one is a stick it covers entirely. */
  minRadius: 44,
  /** And on a tablet or a desktop with touch, a stick the size of a plate is not a thumbstick. */
  maxRadius: 72,
  /**
   * How far up the knob has to get ahead of the base to jump, as a share of the radius.
   *
   * Set against `recenterMs` rather than alone, because what the base has not caught up with is
   * what counts: a 30px flick in 100ms leaves the knob 24px ahead of a 220ms base, which clears
   * 0.4 of a 46px stick, while the same 30px drifted over a second never gets 7px ahead.
   */
  jumpShare: 0.4,
  /**
   * How close the knob has to come back before it can jump again — the hysteresis that makes one
   * push one jump. Reached either by the thumb coming down or by the base catching up with a thumb
   * that stayed up, so a second flick does not need the thumb to be brought back first.
   */
  rearmShare: 0.2,
  /** How long the base takes to drift back under a still thumb (the time constant, not the whole of it). */
  recenterMs: 220,
} as const

export interface Joystick {
  active: boolean
  baseX: number
  baseY: number
  knobX: number
  knobY: number
  /** Whether the next push up is a jump. False from the moment one fires until the knob comes back down. */
  armed: boolean
  /**
   * Whether this press has jumped by flick. **Kept through the release and cleared by the next
   * press**, because the release is exactly when the question is asked: a flick is short and small,
   * so it is also a tap by `isJumpTap`'s test, and the tap fires on the release — one push would
   * ask to jump twice. Harmless in the air (there is no double jump); not harmless on a tutorial
   * card, where the second would acknowledge the next one.
   */
  flicked: boolean
}

export function createJoystick(): Joystick {
  return { active: false, baseX: 0, baseY: 0, knobX: 0, knobY: 0, armed: false, flicked: false }
}

/** The base's radius for a frame of this size. */
export function joystickRadius(width: number, height: number): number {
  return Math.min(JOYSTICK.maxRadius, Math.max(JOYSTICK.minRadius, Math.min(width, height) * JOYSTICK.radiusFraction))
}

/** A finger lands: the stick appears under it, centred, and armed. */
export function pressJoystick(stick: Joystick, x: number, y: number): void {
  stick.active = true
  stick.baseX = x
  stick.baseY = y
  stick.knobX = x
  stick.knobY = y
  stick.armed = true
  stick.flicked = false
}

/**
 * The finger moves. Returns `true` on the one event a push up becomes a jump.
 *
 * In place rather than returning a new record: it runs on every pointer move of every touch, and a
 * record per event is garbage on the one device this exists for.
 *
 * **Up has to be the dominant direction as well as far enough**, because a thumb steering hard to
 * one side drags the base along with it and draws an arc while it does. Measured against the knob
 * *after* the base has followed, so a long sideways drag leaves the knob on the rim pointing
 * sideways and cannot be read as a push up however far it went.
 */
export function moveJoystick(stick: Joystick, x: number, y: number, radius: number): boolean {
  if (!stick.active) return false

  const dx = x - stick.baseX
  const dy = y - stick.baseY
  const distance = Math.hypot(dx, dy)

  if (distance > radius) {
    const pull = (distance - radius) / distance

    stick.baseX += dx * pull
    stick.baseY += dy * pull
  }

  stick.knobX = x
  stick.knobY = y

  if (!stick.armed) {
    rearm(stick, radius)

    return false
  }

  const up = stick.baseY - stick.knobY
  const side = Math.abs(stick.knobX - stick.baseX)

  if (up >= JOYSTICK.jumpShare * radius && up >= side) {
    stick.armed = false
    stick.flicked = true

    return true
  }

  return false
}

function rearm(stick: Joystick, radius: number): void {
  if (stick.baseY - stick.knobY <= JOYSTICK.rearmShare * radius) stick.armed = true
}

/**
 * A frame passes: the base drifts toward the thumb. See the module docstring for why it has to.
 *
 * Frame-rate invariant — the exponential over the real delta — for the reason every other time
 * constant in this game is: a 144Hz phone must not have a stiffer stick than a 60Hz one.
 */
export function settleJoystick(stick: Joystick, dtMs: number, radius: number): void {
  if (!stick.active || !(dtMs > 0)) return

  const k = 1 - Math.exp(-dtMs / JOYSTICK.recenterMs)

  stick.baseX += (stick.knobX - stick.baseX) * k
  stick.baseY += (stick.knobY - stick.baseY) * k

  if (!stick.armed) rearm(stick, radius)
}

/** The finger lifts, leaves the canvas, or the scene loses focus: the stick goes. */
export function releaseJoystick(stick: Joystick): void {
  stick.active = false
  stick.armed = false
}
