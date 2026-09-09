import * as Phaser from 'phaser'
import { playMusic } from './audio'
import { MUSIC_KEY, renderMusicUri } from './music'

/**
 * Getting the music track, after the game is already playable.
 *
 * **⚠ It is 1.85MB — 27% of everything the game downloads, and 37% of what the loading bar
 * itself waited for — and it was on the blocking path.**
 * `Preloader` loaded it with the art, so the bar could not reach the end until a two-minute stereo
 * mp3 had arrived, and on a phone over mobile data that is several seconds of a player looking at a
 * loading screen before anything they can touch. Nothing on the front screen needs it: the menu
 * draws a world, and the track is something to hear while looking at it.
 *
 * So the menu asks for it once it is up, and plays it when it lands. **The only thing that must not
 * happen is asking for it before it is there**: `playMusic` calls `soundManager.add(key)`, which
 * throws on a key the cache does not hold, and that takes the front screen with it rather than
 * merely silencing it — which is the whole reason the rendered bed in `music.ts` exists.
 *
 * What it costs, stated: a player who presses Play in the first seconds takes the menu's loader
 * down with it, so their first run is silent and the track arrives when they come back. That is a
 * fair trade for three seconds off every boot, and it is why this retries on every entry rather
 * than giving up.
 */

/**
 * Where the file lives, from the document root.
 *
 * **⚠ Spelled out rather than relative, because a loader's base path belongs to its SCENE.**
 * `Preloader` calls `load.setPath('assets')` at the end of its own `preload` and this used to sit
 * under it — so moving the request to `MainMenu`, whose loader has no base path, asked for
 * `/audio/music.mp3` and got a 404. Measured live before it was fixed: the fallback fired and the
 * game came up on the 17.14s rendered loop instead of the track, with nothing on screen to say so.
 */
export const MUSIC_PATH = 'assets/audio/music.mp3'

/** Whether a request is in flight. Module-level: the menu is re-entered after every run. */
let loading = false

/** Whether the file has already failed once and the rendered bed was queued in its place. */
let fellBack = false

/**
 * Plays the music, fetching it first if this is the first time.
 *
 * Safe to call on every entry to the front screen: `playMusic` is idempotent on the key it is
 * already playing, and a request already in flight is not started twice.
 */
export function ensureMusic(scene: Phaser.Scene): void {
  if (scene.cache.audio.exists(MUSIC_KEY)) {
    playMusic(MUSIC_KEY)

    return
  }

  if (loading) return

  loading = true

  const settled = (): void => {
    loading = false

    if (scene.cache.audio.exists(MUSIC_KEY)) {
      playMusic(MUSIC_KEY)

      return
    }

    // **The rendered loop is the fallback, and it is queued here rather than shipped.** It is
    // arithmetic, so it costs no bytes until the moment the file is not there. A second failure
    // ends it: there is nothing else to try, and a retry loop over a data URI that cannot decode
    // would spin for the life of the session.
    if (fellBack) return

    fellBack = true
    console.warn('[audio] audio/music.mp3 did not load; falling back to the rendered loop')
    loading = true
    scene.load.audio(MUSIC_KEY, renderMusicUri())
    scene.load.once(Phaser.Loader.Events.COMPLETE, settled)
    scene.load.start()
  }

  scene.load.audio(MUSIC_KEY, MUSIC_PATH)
  scene.load.once(Phaser.Loader.Events.COMPLETE, settled)
  // **A scene that goes away mid-request has to let the next one ask again.** The loader belongs to
  // the scene, so starting a run aborts this — and without clearing the flag the track would never
  // be asked for again for the rest of the session.
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    loading = false
  })
  scene.load.start()
}
