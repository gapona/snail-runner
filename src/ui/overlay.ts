import * as Phaser from 'phaser'

/**
 * Opens an overlay scene over the one that asked for it: pause the caller, launch the overlay,
 * and put the overlay on top.
 *
 * ## ⚠ Scenes render in registration order, and that made two overlays invisible from the garage
 *
 * `SceneManager.render` walks `this.scenes` forward and draws each running scene in turn, so a
 * scene registered *later* in `config.ts`'s array is painted **over** every scene before it. That
 * has nothing to do with which scene launched which, and nothing in `scene.launch` corrects it.
 *
 * Every overlay in this game was written and tested from `MainMenu`, which is third in the list, so
 * every overlay happened to sit after it and the ordering was invisible. `Garage` is a *place*
 * rather than a drawer — it draws the whole world and is `start`ed, not `launch`ed — and it was
 * registered after `Settings` and `Shop`. Opening either of those from the garage therefore paused
 * the garage and drew the panel **underneath the garage's own full-frame world**: no shop, no
 * settings, and a front screen that had stopped moving with no way out of it. Reported as not being
 * able to leave the garage.
 *
 * `bringToTop` moves the overlay to the end of the list, so the answer stops depending on where a
 * scene happens to sit in `config.ts` and no future screen can inherit the same defect by being
 * added in the wrong place. It is queued behind the launch by the scene manager's own op queue, so
 * the two arrive in the order they were asked for.
 *
 * The pause is here for the same reason: **an overlay that is drawn over a scene still running
 * underneath it is the defect this project has already recorded three times** (an ad over a live
 * game, a platform pause that froze nothing, a menu whose input kept firing under a panel). One
 * call is one rule; the overlay's own `close()` still owns the resume, because only it knows
 * whether a platform pause arrived while it was open.
 */
export function launchOverlay(scene: Phaser.Scene, key: string, data?: object): void {
  scene.scene.pause()
  scene.scene.launch(key, data)
  scene.scene.bringToTop(key)
}
