import * as Phaser from 'phaser'
import { isJumpTap, isTap, TAP_SLOP_PX } from '../ui/scrollList'
import { axisFrom, HeldSourceSet } from './heldSources'

export interface ActionSources {
  /** Game object(s) that trigger the action on `pointerdown` — Phaser unifies mouse and
   * touch into one Pointer API, so this covers both with no "what kind of device is this"
   * branch needed. The object(s) must already be `.setInteractive()`'d elsewhere (see
   * `src/ui/uiScale.ts`'s `ensureMinHitArea` for the touch-target sizing side of that). */
  pointer?: Phaser.GameObjects.GameObject | Phaser.GameObjects.GameObject[]
  /** Phaser keyboard key names (e.g. `'SPACE'`, `'ENTER'`, `'ESC'`) that trigger the same action. */
  keys?: string[]
  /**
   * Fire on release-without-having-moved instead of on press.
   *
   * **For any pointer target that is also the handle of a scrollable list.** Such a target has
   * no choice about being grabbed — the rows *are* what the player drags — so firing on the
   * press means the first flick through a catalogue buys whatever was under the finger. That is
   * a real purchase the player did not make.
   *
   * Off by default, because it is strictly worse everywhere else: a button that waits for the
   * release feels slower, and Phaser's own `GAMEOBJECT_POINTER_UP` only fires when the release
   * lands back on the object, so a tap that drifts off the edge is silently lost. Pay that only
   * where a drag has to be possible.
   */
  tap?: boolean
  /**
   * A tap anywhere on the canvas — press and release without the pointer having moved.
   *
   * **For an action whose target is the whole screen rather than a widget.** The runner's jump is
   * the case: there is no button, the road is not an object, and inventing an invisible
   * full-screen rectangle to `setInteractive()` would put a click-swallowing object over
   * everything (the same argument `bindHeldAction`'s `screenBand` makes).
   *
   * **⚠ What lets this share a pointer with steering on a finger is HOW LONG the press lasted, and
   * borrowing the scrolling list's distance rule instead is what broke the jump on every phone.**
   * A touch steer is a *hold* — steering is absolute here, the snail goes where the thumb is — so
   * the thumb is travelling almost whenever the player is playing, and a 12px bound threw the jump
   * away. Measured with real touch pointers: a tap that slid 21px did not jump. See `isJumpTap`.
   *
   * **⚠ A mouse fires on the PRESS, and the reason is `bindSteering`'s own rule.** A mouse steers by
   * where it *is* — hovering is the input, the button plays no part — so a mouse press has nothing
   * to be ambiguous with, and waiting for the release was pure latency. Reported as the left button
   * responding worse than the space bar, which understates it: the release also had to land within
   * `TAP_SLOP_PX` of the press, and on a desktop the mouse is *moving*, because moving it is how
   * the snail is steered. So a click taken mid-dodge — the moment a jump is most wanted — did not
   * merely arrive late, it did not arrive at all.
   */
  screenTap?: boolean
}

/**
 * Maps one abstract game action to as many input sources as needed, all firing the same
 * callback — gameplay/UI code binds to "what the player wants to do" once, never to a
 * specific device's raw event. Mouse, touch, and keyboard all work at the same time; there
 * is no "detect device type" branch anywhere in this module or its callers.
 *
 * Every source is guarded to only fire while `scene` is the active (non-paused) scene.
 * Pointer targets are already physically shielded by whatever overlay paused this scene
 * (e.g. `Settings`' full-screen backdrop swallows the click before it reaches anything
 * underneath) — but a paused scene's own `input.keyboard` listeners keep firing regardless
 * (Phaser doesn't suspend a scene's Input Plugin on pause, only its `update()`/render), so
 * without this guard a backgrounded scene's key binding would fire right alongside the
 * overlay's for the same keypress. See CLAUDE.md "Input Actions".
 *
 * Cleans up all listeners on scene `SHUTDOWN`/`DESTROY`, mirroring `src/ui/layout.ts`'s
 * `bindLayout`.
 */
export function bindAction(scene: Phaser.Scene, action: string, sources: ActionSources, callback: () => void): void {
  const guarded = () => {
    if (!scene.scene.isActive()) return
    console.debug(`[input] action "${action}" fired`)
    callback()
  }

  const cleanups: Array<() => void> = []

  if (sources.screenTap) {
    // Where each press landed, per pointer id — the same shape the per-object `tap` path uses,
    // and for the same reason: `pointer.downX/downY` belong to the pointer, so a press that began
    // during a scene that has since been replaced would still satisfy a distance test here.
    const pressedAt = new Map<number, { x: number; y: number; at: number }>()

    // **⚠ A press that landed on a widget is not a screen tap, and Phaser hands us the list.**
    // `POINTER_DOWN` is emitted with the objects the pointer was over, so a HUD button on this
    // screen no longer also fires the whole-screen action underneath it. Written down in this
    // project long before there was anything to catch: *"once a HUD exists a tap on a HUD button
    // will also move the ship unless the handler learns to ignore pointers already consumed by a
    // game object"*. The run's exit button is the first one, and without this a tap on it would
    // jump as well as leave.
    //
    // The *release* is filtered the same way rather than only the press: a finger that pressed on
    // open road and lifted on the button has still made a jump gesture, so what is tested is where
    // it went down — which is why the record is dropped rather than consulted.
    const overWidget = (over: Phaser.GameObjects.GameObject[] | undefined) => (over?.length ?? 0) > 0

    const onDown = (pointer: Phaser.Input.Pointer, currentlyOver?: Phaser.GameObjects.GameObject[]) => {
      if (overWidget(currentlyOver)) {
        pressedAt.delete(pointer.id)

        return
      }

      // **A mouse fires here and a finger fires on release**, which is the same split
      // `bindSteering` makes and for the same reason: a mouse steers by hovering, so its button is
      // free and a press means one thing only. A finger steers by being held, so every steer starts
      // with a press and only the release can tell a jump from a dodge. See `screenTap`.
      if (!pointer.wasTouch) {
        guarded()

        return
      }
      // The time is recorded with the place, because the duration is the test — see `isJumpTap`.
      // `pointer.downTime` would do for a real device and is not written by a synthetic event, so
      // the record owns its own clock and the harness and the phone measure the same thing.
      pressedAt.set(pointer.id, { x: pointer.x, y: pointer.y, at: performance.now() })
    }
    const onUp = (pointer: Phaser.Input.Pointer) => {
      const start = pressedAt.get(pointer.id)

      // Nothing is recorded for a mouse, so this cannot fire twice for one click.
      pressedAt.delete(pointer.id)
      if (!start) return

      // **The DOM event's own timestamps first, this handler's clock second.** `getDuration()` is
      // `upTime - downTime`, both taken from the browser event — so it measures the gesture rather
      // than how late a busy main thread got round to it, which on a stuttering frame is exactly
      // the difference between a jump and a lost one. A pointer that never carried a real
      // `downTime` (a synthetic event, which is the only way this can be driven under automation)
      // falls back to the wall clock recorded with the press.
      const held = pointer.downTime > 0 ? pointer.getDuration() : performance.now() - start.at

      if (isJumpTap(pointer.x - start.x, pointer.y - start.y, held)) guarded()
    }
    const onCancel = (pointer: Phaser.Input.Pointer) => pressedAt.delete(pointer.id)

    scene.input.on(Phaser.Input.Events.POINTER_DOWN, onDown)
    scene.input.on(Phaser.Input.Events.POINTER_UP, onUp)
    // A release outside the canvas is not a tap and must not become one when the finger comes
    // back; dropping the record is what makes that true.
    scene.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, onCancel)
    cleanups.push(() => {
      scene.input.off(Phaser.Input.Events.POINTER_DOWN, onDown)
      scene.input.off(Phaser.Input.Events.POINTER_UP, onUp)
      scene.input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, onCancel)
    })
  }

  const pointerTargets = sources.pointer ? (Array.isArray(sources.pointer) ? sources.pointer : [sources.pointer]) : []

  for (const target of pointerTargets) {
    if (!sources.tap) {
      target.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, guarded)
      cleanups.push(() => target.off(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, guarded))
      continue
    }

    // Where the press landed, per pointer id. Recorded here rather than read from the pointer's
    // own `downX/downY` at release time: those belong to the pointer, so a press that began on
    // some *other* object would still satisfy a distance test taken on this one, and the row
    // the finger happened to stop over would fire.
    const pressedAt = new Map<number, { x: number; y: number }>()

    const onDown = (pointer: Phaser.Input.Pointer) => {
      pressedAt.set(pointer.id, { x: pointer.x, y: pointer.y })
    }
    const onUp = (pointer: Phaser.Input.Pointer) => {
      const from = pressedAt.get(pointer.id)

      pressedAt.delete(pointer.id)

      if (!from) return
      if (!isTap(pointer.x - from.x, pointer.y - from.y, TAP_SLOP_PX)) return

      guarded()
    }
    // A release outside the object never reaches `GAMEOBJECT_POINTER_UP`, so without this the
    // entry would sit in the map until the same pointer id happened to press this object again —
    // at which point the stale entry is overwritten, but a release that drifted off and came back
    // would have been measured against the wrong press.
    const onGlobalUp = (pointer: Phaser.Input.Pointer) => pressedAt.delete(pointer.id)

    target.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, onDown)
    target.on(Phaser.Input.Events.GAMEOBJECT_POINTER_UP, onUp)
    scene.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, onGlobalUp)
    cleanups.push(() => {
      target.off(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, onDown)
      target.off(Phaser.Input.Events.GAMEOBJECT_POINTER_UP, onUp)
      scene.input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, onGlobalUp)
      pressedAt.clear()
    })
  }

  for (const key of sources.keys ?? []) {
    const eventName = `keydown-${key}`
    scene.input.keyboard?.on(eventName, guarded)
    cleanups.push(() => scene.input.keyboard?.off(eventName, guarded))
  }

  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => cleanups.forEach((fn) => fn()))
  scene.events.once(Phaser.Scenes.Events.DESTROY, () => cleanups.forEach((fn) => fn()))

  console.debug(
    `[input] bound action "${action}": ${pointerTargets.length} pointer target(s), keys [${(sources.keys ?? []).join(', ')}]`,
  )
}

export interface HeldActionSources {
  /** Phaser key names (e.g. `'LEFT'`, `'A'`) that hold the action down while pressed. */
  keys?: string[]
  /**
   * A vertical band of the screen, as fractions of viewport width, that holds the action
   * down while a pointer is pressed inside it — `{ from: 0, to: 0.5 }` is the left half.
   *
   * Deliberately a screen region rather than a game object: a steering control has no
   * on-screen widget to attach to, and inventing an invisible full-height rectangle just to
   * have something to `setInteractive()` would put a click-swallowing object over the road.
   */
  screenBand?: { from: number; to: number }
}

export interface HeldAction {
  /** Whether any bound source is holding this action right now. */
  isActive(): boolean
  /** Force-releases every source. Called automatically on focus loss and scene pause. */
  clear(): void
}

/**
 * The continuous counterpart to `bindAction`: maps one abstract action to input sources that
 * are *held* rather than tapped, and reports whether it is currently down.
 *
 * Same contract as `bindAction` — gameplay code asks for an action, never for a device — and
 * the same `SHUTDOWN`/`DESTROY` cleanup. Three things differ, each because "held" has failure
 * modes that "tapped" does not:
 *
 * - **Sources are tracked in a `HeldSourceSet`, never a counter.** See that class for why: OS
 *   key auto-repeat would otherwise leave the action stuck on.
 * - **Only the press is gated on the scene being active; the release never is.** A key
 *   released while the scene is paused must still be released, or the action stays held for
 *   the rest of the session.
 * - **Focus loss clears everything.** Alt-tabbing away with a key down delivers no `keyup` at
 *   all, so without this the car would keep steering into the wall while the player is gone.
 */
export function bindHeldAction(scene: Phaser.Scene, action: string, sources: HeldActionSources): HeldAction {
  const held = new HeldSourceSet()
  const cleanups: Array<() => void> = []

  for (const key of sources.keys ?? []) {
    const downEvent = `keydown-${key}`
    const upEvent = `keyup-${key}`
    const sourceId = `key:${key}`

    const onDown = () => {
      if (!scene.scene.isActive()) return
      held.press(sourceId)
    }
    // Never gated: see the docstring.
    const onUp = () => held.release(sourceId)

    scene.input.keyboard?.on(downEvent, onDown)
    scene.input.keyboard?.on(upEvent, onUp)
    cleanups.push(() => {
      scene.input.keyboard?.off(downEvent, onDown)
      scene.input.keyboard?.off(upEvent, onUp)
    })
  }

  const band = sources.screenBand
  if (band) {
    const sourceIdOf = (pointer: Phaser.Input.Pointer) => `pointer:${pointer.id}`
    const inBand = (pointer: Phaser.Input.Pointer) => {
      const fraction = pointer.x / scene.scale.width

      return fraction >= band.from && fraction < band.to
    }

    // Down and move share a handler so that sliding a finger across the midpoint hands the
    // hold over to the other half instead of latching wherever it first landed.
    const onDownOrMove = (pointer: Phaser.Input.Pointer) => {
      if (!pointer.isDown) return
      if (scene.scene.isActive() && inBand(pointer)) held.press(sourceIdOf(pointer))
      else held.release(sourceIdOf(pointer))
    }
    const onUp = (pointer: Phaser.Input.Pointer) => held.release(sourceIdOf(pointer))

    scene.input.on(Phaser.Input.Events.POINTER_DOWN, onDownOrMove)
    scene.input.on(Phaser.Input.Events.POINTER_MOVE, onDownOrMove)
    scene.input.on(Phaser.Input.Events.POINTER_UP, onUp)
    // A pointer released outside the canvas never fires POINTER_UP; without this the hold
    // would survive the release.
    scene.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, onUp)
    cleanups.push(() => {
      scene.input.off(Phaser.Input.Events.POINTER_DOWN, onDownOrMove)
      scene.input.off(Phaser.Input.Events.POINTER_MOVE, onDownOrMove)
      scene.input.off(Phaser.Input.Events.POINTER_UP, onUp)
      scene.input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, onUp)
    })
  }

  const clear = () => held.clear()

  // Focus loss and backgrounding deliver no release event for anything currently down.
  scene.game.events.on(Phaser.Core.Events.BLUR, clear)
  scene.game.events.on(Phaser.Core.Events.HIDDEN, clear)
  scene.events.on(Phaser.Scenes.Events.PAUSE, clear)
  cleanups.push(() => {
    scene.game.events.off(Phaser.Core.Events.BLUR, clear)
    scene.game.events.off(Phaser.Core.Events.HIDDEN, clear)
    scene.events.off(Phaser.Scenes.Events.PAUSE, clear)
  })

  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => cleanups.forEach((fn) => fn()))
  scene.events.once(Phaser.Scenes.Events.DESTROY, () => cleanups.forEach((fn) => fn()))

  console.debug(
    `[input] bound held action "${action}": keys [${(sources.keys ?? []).join(', ')}]${band ? `, screen band ${band.from}-${band.to}` : ''}`,
  )

  return { isActive: () => held.isHeld, clear }
}

export interface SteeringSources {
  /** Keys that push the virtual point left and right, e.g. `['LEFT', 'A']`. */
  leftKeys?: string[]
  rightKeys?: string[]
  /** How fast the keyboard's virtual point travels, in viewport widths per second. */
  keyboardSpeed?: number
}

export interface Steering {
  /**
   * Where the player is asking to be, as a fraction across the frame, and whether they are asking
   * at all. Advance by `dtMs` of wall clock — the keyboard's virtual point moves at a rate.
   */
  read(dtMs: number): { targetFraction: number; active: boolean }
  /** Force-releases every source. Called automatically on focus loss and scene pause. */
  clear(): void
}

/**
 * The *absolute* counterpart to `bindHeldAction`: one abstract steering axis fed by a pointer's
 * position and by a pair of key sets, reported as a fraction across the frame.
 *
 * **A third shape was needed because a runner steers to a place, not in a direction.** `bindAction`
 * answers "did they tap"; `bindHeldAction` answers "are they holding left". Neither can answer
 * "where is the finger", which is the only question a game whose player is dragged across a road
 * actually asks — and answering it by reading `scene.input.activePointer` at the call site is
 * exactly the raw-input coupling the whole module exists to prevent.
 *
 * Two sources, one answer, same as everywhere else here:
 *
 * - **A pointer, while it is down.** Absolute: the fraction *is* the request. Releasing sets
 *   `active` false rather than freezing the last value, so the caller's spring can coast back to
 *   the centre with its own weight instead of the axis inventing a rest position.
 * - **The keyboard, through a virtual point** that travels at `keyboardSpeed` while a key is held
 *   and stays where it was let go. A key cannot express an absolute position, so the point is what
 *   turns a direction back into one; it starts at the centre and is clamped to the frame.
 *
 * The pointer wins while it is down, because a player touching the screen has stopped using the
 * keyboard by definition. Same `SHUTDOWN`/`DESTROY`/focus-loss cleanup as the other two binders.
 */
export function bindSteering(scene: Phaser.Scene, action: string, sources: SteeringSources = {}): Steering {
  // One set per direction rather than one shared set: `axisFrom` needs to know which side is
  // down, and holding both has to cancel rather than latch whichever arrived first.
  const heldLeft = new HeldSourceSet()
  const heldRight = new HeldSourceSet()
  const cleanups: Array<() => void> = []
  const speed = sources.keyboardSpeed ?? 0.9

  let pointerFraction: number | null = null
  let keyboardPoint = 0.5

  const bindKeys = (keys: string[] | undefined, held: HeldSourceSet, id: string) => {
    for (const key of keys ?? []) {
      const downEvent = `keydown-${key}`
      const upEvent = `keyup-${key}`
      const sourceId = `${id}:${key}`
      const onDown = () => {
        if (!scene.scene.isActive()) return
        held.press(sourceId)
      }
      // Never gated on the scene being active: a key released while paused must still release,
      // or the snail steers into the verge for the rest of the run. Same rule as `bindHeldAction`.
      const onUp = () => held.release(sourceId)

      scene.input.keyboard?.on(downEvent, onDown)
      scene.input.keyboard?.on(upEvent, onUp)
      cleanups.push(() => {
        scene.input.keyboard?.off(downEvent, onDown)
        scene.input.keyboard?.off(upEvent, onUp)
      })
    }
  }

  bindKeys(sources.leftKeys, heldLeft, 'left')
  bindKeys(sources.rightKeys, heldRight, 'right')

  const onPointer = (pointer: Phaser.Input.Pointer) => {
    // **A mouse steers by where it is; a finger steers by where it is pressed.** Requiring the
    // button on both is what a touch-first implementation looks like ported carelessly to a
    // desktop: the player moves the mouse, nothing happens, and the snail sits in the middle of
    // the road. There is nothing else on this screen a mouse could be doing, so hovering *is* the
    // input. A touch pointer has no hover state at all, which is why the two cannot share a rule.
    const engaged = pointer.isDown || !pointer.wasTouch

    if (!scene.scene.isActive() || !engaged) {
      pointerFraction = null

      return
    }
    pointerFraction = Math.min(1, Math.max(0, pointer.x / scene.scale.width))
  }
  // A mouse button coming up does not end mouse steering — the cursor is still there, and still
  // the input. A finger coming up does, because there is nothing left to point with.
  const onUp = (pointer: Phaser.Input.Pointer) => {
    if (pointer.wasTouch) pointerFraction = null
  }
  // Leaving the canvas ends it for either kind: there is no position to steer to any more.
  const onLeave = () => {
    pointerFraction = null
  }

  scene.input.on(Phaser.Input.Events.POINTER_DOWN, onPointer)
  scene.input.on(Phaser.Input.Events.POINTER_MOVE, onPointer)
  scene.input.on(Phaser.Input.Events.POINTER_UP, onUp)
  // A pointer released outside the canvas never fires POINTER_UP; without this the snail would
  // keep steering towards wherever the finger left the frame.
  scene.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, onLeave)
  scene.input.on(Phaser.Input.Events.GAME_OUT, onLeave)
  cleanups.push(() => {
    scene.input.off(Phaser.Input.Events.POINTER_DOWN, onPointer)
    scene.input.off(Phaser.Input.Events.POINTER_MOVE, onPointer)
    scene.input.off(Phaser.Input.Events.POINTER_UP, onUp)
    scene.input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, onLeave)
    scene.input.off(Phaser.Input.Events.GAME_OUT, onLeave)
  })

  const clear = () => {
    heldLeft.clear()
    heldRight.clear()
    pointerFraction = null
  }

  scene.game.events.on(Phaser.Core.Events.BLUR, clear)
  scene.game.events.on(Phaser.Core.Events.HIDDEN, clear)
  scene.events.on(Phaser.Scenes.Events.PAUSE, clear)
  cleanups.push(() => {
    scene.game.events.off(Phaser.Core.Events.BLUR, clear)
    scene.game.events.off(Phaser.Core.Events.HIDDEN, clear)
    scene.events.off(Phaser.Scenes.Events.PAUSE, clear)
  })

  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => cleanups.forEach((fn) => fn()))
  scene.events.once(Phaser.Scenes.Events.DESTROY, () => cleanups.forEach((fn) => fn()))

  console.debug(`[input] bound steering "${action}": pointer + keys`)

  return {
    read(dtMs: number) {
      if (pointerFraction !== null) {
        // The virtual point follows the finger, so switching back to the keyboard resumes from
        // where the snail actually is rather than from wherever the point was left.
        keyboardPoint = pointerFraction

        return { targetFraction: pointerFraction, active: true }
      }

      const axis = axisFrom(heldLeft.isHeld, heldRight.isHeld)

      if (axis === 0) return { targetFraction: keyboardPoint, active: false }

      const dtSec = Number.isFinite(dtMs) && dtMs > 0 ? dtMs / 1000 : 0

      keyboardPoint = Math.min(1, Math.max(0, keyboardPoint + axis * speed * dtSec))

      return { targetFraction: keyboardPoint, active: true }
    },
    clear,
  }
}
