import * as Phaser from 'phaser'
import { YTEvents, isAudioEnabled } from '../platform/yt'
import { getState, mutate } from '../save/store'
import { teardownDelayMs } from './synth'
import { clampVolume, isSilent, musicGainFor, soundGainFor } from './volume'

/**
 * Sound/music manager sitting on top of Phaser's SoundManager. Scenes must go through
 * this module (playSfx/playMusic/stopMusic/setSound/setMusic) instead of touching
 * `this.sound` directly, so audibility always reflects both the user's two independent
 * flags (SaveState.settings.sound/music) and the platform's audio-enabled state.
 *
 * audible = platformAudioEnabled && userFlag
 *
 * The platform mute is a transient runtime override — it's never written to SaveState.
 * Only setSound()/setMusic() (user-triggered, via the Settings overlay) touch the save.
 */

// Phaser 4's BaseSound.d.ts omits setMute()/mute/seek, even though every concrete backend
// (WebAudio, HTML5, NoAudio — see the audio-and-sound skill) implements them identically.
interface MutableSound extends Phaser.Sound.BaseSound {
  setMute(value: boolean): this
  seek: number
  volume: number
}

let soundManager: Phaser.Sound.BaseSoundManager | null = null
let platformAudioEnabled = true
/**
 * Whether the platform currently has the game suspended.
 *
 * Tracked here rather than read from `yt.ts` because `isPlatformPaused()` is also `true` while an
 * ad is showing (`adGate` shares that channel on purpose), and that is exactly the case this wants
 * to cover: an ad is a moment the game must be silent under.
 */
let platformPaused = false
let currentMusicKey: string | null = null
let currentMusic: MutableSound | null = null
/** Sound keys already reported as undecoded — one line each, not one per play. See `playSfx`. */
const missingReported = new Set<string>()
let pausedMusicSeek = 0

function userSoundOn(): boolean {
  return getState().settings.sound
}

function userMusicOn(): boolean {
  return getState().settings.music
}

/**
 * Audible means three things now, not two: the platform allows sound, the player's switch is on,
 * and their slider is above zero.
 *
 * **The slider at the bottom counts as off rather than as very quiet**, and that is deliberate: a
 * curve that only approaches zero leaves a faint sound at the setting the player chose in order to
 * silence something. See `volume.ts`.
 */
function effectiveSound(): boolean {
  return platformAudioEnabled && userSoundOn() && !isSilent(getState().settings.soundVolume)
}

function effectiveMusic(): boolean {
  return platformAudioEnabled && userMusicOn() && !isSilent(getState().settings.musicVolume)
}

/**
 * Re-states everything the platform decides, from scratch.
 *
 * ## ⚠ A mute set while the AudioContext is suspended is a mute that never happened
 *
 * `WebAudioSoundManager.mute` is not a boolean. Its setter is
 * `masterMuteNode.gain.setValueAtTime(...)` and its getter is `masterMuteNode.gain.value === 0` —
 * i.e. both ends of it are an `AudioParam`, scheduled on and read back from the audio thread. **A
 * suspended context has no audio thread running**, so a value written there does not land and the
 * getter goes on reporting the old one. Measured in the running game: after emitting the platform's
 * own `PAUSE`, which sets `mute = true` as its first statement, `game.sound.mute` reads **false**.
 *
 * That window is not an edge case on the platform this game ships to. **On Android the context is
 * suspended from boot until the player's first touch** — Chrome's autoplay policy — and Phaser
 * reports it as `sound.locked`. Everything this module decides before that first tap is decided
 * into a context that cannot hear it: the boot value of the YouTube mute button, the menu track's
 * own mute, its volume. `Phaser.Sound.Events.UNLOCKED` is emitted on the step after
 * `context.resume()` succeeds, and is therefore the one moment at which any of it can be made true.
 *
 * ## One function, because a blanket mute set in three places is one of them disagreeing
 *
 * `RESUME` used to set `soundManager.mute = false` unconditionally — so a pause/resume cycle
 * unmuted the manager whether or not YouTube's own mute was on. Nothing audible leaked, because
 * `effectiveSound()` gates every play and the music instance carries its own mute; but the blanket
 * flag then said the opposite of what the platform had asked for, and a flag that lies is the thing
 * the next reader believes. The manager's mute answers to the **platform** alone — the player's own
 * two switches are per channel and must not be flattened into one.
 */
function applyAudibility(): void {
  if (soundManager) soundManager.mute = !platformAudioEnabled || platformPaused

  // **⚠ A track the pause destroyed comes back the moment it is audible again, and it used to be
  // gone for the session.** `RESUME` restarts the music only `if (effectiveMusic())` — correct at
  // that instant and permanent afterwards, because everything else here only ever *mutes* an
  // instance that already exists. So: YouTube muted, the platform pauses (an ad, a backgrounded
  // app), it resumes with nothing restarted, the player unmutes — and `applyMusicAudibility` finds
  // no instance to unmute. **No music for the rest of the session, with the mute button off**,
  // which is the certification failure read from the other end. Measured in the running game before
  // this line existed: after that sequence the manager's sound list stayed empty.
  //
  // Not while paused: a pause is a reason to have no music, and starting one under it would be the
  // ad's own silence broken by the game.
  if (!platformPaused && currentMusicKey && !currentMusic && effectiveMusic()) {
    playMusic(currentMusicKey, pausedMusicSeek)

    return
  }

  applyMusicAudibility()
}

function applyMusicAudibility(): void {
  currentMusic?.setMute(!effectiveMusic())
  // Volume as well as mute: the mute is what the platform and the switch drive, the volume is what
  // the slider drives, and a track already playing has to answer to both without being restarted.
  if (currentMusic) currentMusic.volume = musicGainFor(getState().settings.musicVolume)
}

/**
 * Fire-and-forget one-shot sound effect. Doesn't even attempt to play when inaudible.
 *
 * `detune` is in cents and is how the lock tone climbs and how repeated impacts avoid being the
 * identical sample twice — see `sfx.ts`. One rendered sample plus a detune is one decode and one
 * cache entry; a pre-rendered scale would be one of each per step for a sound the player hears
 * as a single run.
 */
export function playSfx(key: string, options?: { detune?: number; volume?: number }): void {
  if (!soundManager || !effectiveSound()) {
    return
  }

  // **⚠ `SoundManager.play` THROWS on a key that is not decoded yet, and this is called from inside
  // gameplay.** The sounds are loaded in `Preloader`, so the cache is normally full long before a
  // run — but decoding is deferred while the `AudioContext` is locked, and the one place that
  // matters is the frame a run ends: `RunScene.crash` plays a sound and then starts the wreck, so a
  // throw there takes the whole run-over path with it and leaves the player on a frozen frame with
  // no panel. A missing sound is worth knowing about and is never worth ending a run over.
  if (!soundManager.game.cache.audio.exists(key)) {
    if (!missingReported.has(key)) {
      missingReported.add(key)
      console.warn(`[audio] no decoded sound for "${key}" — skipped`)
    }

    return
  }

  // The caller's own `volume` is a *relative* level for that one sound — the lock tone is quieter
  // than an impact by design — so the slider multiplies it rather than replacing it. A slider that
  // overwrote it would flatten the mix the sound design is built on.
  const config = {
    ...options,
    volume: (options?.volume ?? 1) * soundGainFor(getState().settings.soundVolume),
  }

  soundManager.play(key, config as Phaser.Types.Sound.SoundConfig)
}

/**
 * Starts (or restarts, for a different key) a looping music track, muted to match the
 * current flags. `seekSeconds` resumes from a specific position instead of the start —
 * used internally to continue (not restart) a track across a PAUSE/RESUME cycle.
 */
export function playMusic(key: string, seekSeconds = 0): void {
  if (!soundManager) {
    return
  }
  if (currentMusicKey === key && currentMusic?.isPlaying) {
    applyMusicAudibility()
    return
  }

  // destroy(), not stop(): a stopped-but-not-destroyed instance lingers in the
  // manager's sound list, and PAUSE/RESUME cycles would otherwise leak one per cycle.
  currentMusic?.destroy()
  currentMusicKey = key
  currentMusic = soundManager.add(key, {
    loop: true,
    seek: seekSeconds,
    volume: musicGainFor(getState().settings.musicVolume),
  }) as MutableSound
  currentMusic.play()
  applyMusicAudibility()
}

/**
 * Stops the current music track. Keeps the key remembered so RESUME can restart it.
 *
 * `fadeMs` ramps the volume down first; `0` (the default) destroys immediately, which is what
 * a platform PAUSE wants — there is nothing to hear a fade through.
 */
export function stopMusic(fadeMs = 0): void {
  const sound = currentMusic

  currentMusic = null

  if (!sound) return
  if (fadeMs <= 0) {
    sound.destroy()

    return
  }

  fadeOutAndDestroy(sound, fadeMs)
}

/**
 * Ramps a sound's volume to zero and destroys it **a safe margin after the ramp has landed**.
 *
 * **The margin is the point, and it is not padding.** WebAudio volume changes are `AudioParam`
 * automation scheduled on the audio thread; destroying the node in the same tick as a scheduled
 * change makes Chromium drop that change silently — no exception, no console warning, the sound
 * simply cuts instead of fading. Anything that mutes *and* tears down in one go is exposed to
 * it: a scene change, a pause, the end of a run.
 *
 * `FADE_TEARDOWN_GAP_MS` past the end of the ramp is comfortably clear of the ~10ms where the
 * loss is observable, and costs nothing but a slightly later `destroy`.
 */
export function fadeOutAndDestroy(sound: MutableSound, fadeMs: number): void {
  const scene = soundManager?.game?.scene?.getScenes(true)[0]

  sound.volume = sound.volume ?? 1

  if (scene) {
    scene.tweens.add({ targets: sound, volume: 0, duration: fadeMs, ease: 'Linear' })
  } else {
    sound.volume = 0
  }

  // Not `scene.time.delayedCall`: a scene shutting down takes its clock with it, and this has to
  // outlive exactly that case.
  window.setTimeout(() => sound.destroy(), teardownDelayMs(fadeMs))
}

/** User-triggered: persists the SFX flag and takes effect on the next playSfx() call. */
/**
 * Sets a channel's volume, `0..1`, and writes it to the save.
 *
 * **Applied to whatever is already playing**, which is the whole reason this is not just a save
 * write: music is a single retained instance, so a slider that only wrote the value would take
 * effect on the next track — i.e. minutes later, or never. Effects need no such treatment, because
 * each one reads the level at the moment it plays.
 *
 * The switch is left alone. A slider dragged to zero silences the channel and dragging it back up
 * restores it; that is a quieter statement than flipping the player's own switch under them, and it
 * keeps "off" meaning the thing they chose rather than a side effect of a gesture.
 */
export function setSoundVolume(volume: number): void {
  mutate((state) => {
    state.settings.soundVolume = clampVolume(volume)
  })
}

export function setMusicVolume(volume: number): void {
  mutate((state) => {
    state.settings.musicVolume = clampVolume(volume)
  })
  // `applyAudibility`, not `applyMusicAudibility`: a slider dragged back up off zero is the player
  // asking for music, and if a pause destroyed the instance while they were silent there is nothing
  // to unmute. Same for the switch below.
  applyAudibility()
}

/** The slider positions, for the Settings screen to draw. */
export function getSoundVolume(): number {
  return clampVolume(getState().settings.soundVolume)
}

export function getMusicVolume(): number {
  return clampVolume(getState().settings.musicVolume)
}

export function setSound(on: boolean): void {
  mutate((s) => {
    s.settings.sound = on
  })
}

/** User-triggered: persists the music flag and immediately (re)mutes the current track. */
export function setMusic(on: boolean): void {
  mutate((s) => {
    s.settings.music = on
  })
  applyAudibility()
}

export function isSoundOn(): boolean {
  return userSoundOn()
}

export function isMusicOn(): boolean {
  return userMusicOn()
}

/**
 * Wires the sound manager to the game instance and to the platform's audio/lifecycle
 * events (see ../platform/yt.ts). Call once, from main.ts, before scenes start.
 */
export function init(game: Phaser.Game): void {
  soundManager = game.sound
  // **The boot value is a starting point, never the answer.** On Android a Playable can be opened
  // from a muted feed, so this is routinely `false` at boot and becomes `true` the moment the
  // player unmutes — which is what `AUDIO_ENABLED_CHANGE` is for. A game that reads this once and
  // bakes it is a game that is silent for the whole session, which is the certification failure
  // this contract exists to avoid.
  platformAudioEnabled = isAudioEnabled()
  applyAudibility()

  game.events.on(YTEvents.AUDIO_ENABLED_CHANGE, (enabled: boolean) => {
    platformAudioEnabled = enabled
    applyAudibility()
    console.debug('[audio] platform audio enabled ->', enabled)
  })

  // **⚠ The one moment anything set before the player's first touch can be made true.** See
  // `applyAudibility`: until the context resumes, every mute and every volume this module writes
  // goes to an `AudioParam` nothing is reading. Phaser emits this on the step after the unlock, so
  // the whole platform state is simply re-stated there rather than hoped to have survived.
  //
  // `on` rather than `once`: iOS can put a context back into `interrupted` and unlock it again, and
  // re-stating a state that is already correct costs two property writes.
  game.sound.on(Phaser.Sound.Events.UNLOCKED, () => {
    applyAudibility()
    console.debug('[audio] sound manager unlocked -> audibility re-applied')
  })

  game.events.on(YTEvents.PAUSE, () => {
    platformPaused = true
    applyAudibility()
    // stopMusic() destroys the instance (see its comment) — capture position first so
    // RESUME can continue the track instead of restarting it from 0.
    pausedMusicSeek = currentMusic?.seek ?? 0
    stopMusic()
  })

  game.events.on(YTEvents.RESUME, () => {
    platformPaused = false
    // The restart lives in `applyAudibility` now, so there is one path back to a playing track
    // rather than one here and a mute everywhere else — see its own note for what the second path
    // cost. It continues from `pausedMusicSeek` rather than restarting the loop.
    applyAudibility()
  })
}
