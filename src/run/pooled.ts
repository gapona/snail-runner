import * as Phaser from 'phaser'

/**
 * Showing and hiding a pooled object, without leaving the unused ones on the display list.
 *
 * **⚠ A hidden object is not a free object.** `CameraManager.render` builds its render list with
 * `children.filter(child => child.willRender(camera))` — a fresh array and a closure per camera per
 * frame, over *every* object the scene holds, whatever its `visible` flag says. Measured in the
 * running game at 375x667 by adding 600 hidden `Image`s and taking them away again: **0.155us each
 * per frame**, doubled by the world/UI camera split being two passes over the same list.
 *
 * That is what the pools were paying. They are sized against measured peaks — which is right, and
 * `DECOR_POOL_SIZE`'s own docstring explains why a pool that runs out is worse than a pool that is
 * generous — so on an ordinary frame most of them are slack: **476 of the scene's 645 objects were
 * hidden slots, 0.074ms a frame to skip.** The 112 obstacle shadows are the sharpest case, because
 * nothing in the game casts one today and every one of them was iterated twice a frame anyway.
 *
 * So a slot off duty comes off the list entirely, and `visible` is kept in step with that rather
 * than replaced by it: other code reads the flag, and a slot put back on the list while it still
 * said `false` would not draw.
 *
 * **What this does not weaken, and it is worth being explicit because it is the guard that took
 * four rounds to get right.** `assertWorldIsSingleCamera` asks whether anything on the display list
 * is drawn by both cameras, and an object off the list is drawn by neither — so the property still
 * holds for everything that can be drawn at all. What changes is that a hidden slot is not *seen*
 * by a guard that runs once at create, which is why that guard now walks the display list **and**
 * `worldObjects()`. The two halves cover each other: an object a pool forgot to list is also an
 * object the pool never hides, so it stays on the display list forever — where the guard looks.
 *
 * Camera membership is untouched by any of this: `cameraFilter` is a property of the object, not of
 * the list it is on, so a slot keeps its `ignore()` across every add and remove.
 */

/** What these need of an object: the display-list methods, plus the flag they keep in step. */
type Pooled = Phaser.GameObjects.GameObject & {
  visible: boolean
  setVisible(value: boolean): unknown
}

/**
 * Puts a slot on screen.
 *
 * The `displayList` test is not an optimisation of a cheap call: `addToDisplayList` asks
 * `List.exists`, which is an `indexOf` over every object in the scene, and this runs for every
 * drawn object every frame. Reading the object's own back-reference makes the common case — a slot
 * that was already in use last frame — free.
 */
export function showPooled(object: Pooled): void {
  object.setVisible(true)

  if (!object.displayList) object.addToDisplayList()
}

/**
 * Takes a slot off screen and off the list. Cheap when it is already off both.
 *
 * **A pool has to call this on the slots it creates, too.** `render` hides what it *stopped* using
 * by walking from `used` to last frame's count, so a slot that has never been used is on no walk at
 * all and would otherwise sit on the display list for the life of the scene — which is precisely
 * the 476 objects this module exists for, since most of a pool is never used.
 */
export function hidePooled(object: Pooled): void {
  if (!object.displayList) return

  object.setVisible(false)
  object.removeFromDisplayList()
}
