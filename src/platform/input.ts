import * as Phaser from 'phaser'
import { isTap, TAP_SLOP_PX } from '../ui/scrollList'
import { HeldSourceSet } from './heldSources'

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
