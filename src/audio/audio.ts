import * as Phaser from 'phaser'
import { YTEvents, isAudioEnabled } from '../platform/yt'
import { getState, mutate } from '../save/store'
import { teardownDelayMs } from './synth'
import { clampVolume, gainFor, isSilent } from './volume'

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
let currentMusicKey: string | null = null
let currentMusic: MutableSound | null = null
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

function applyMusicAudibility(): void {
  currentMusic?.setMute(!effectiveMusic())
  // Volume as well as mute: the mute is what the platform and the switch drive, the volume is what
  // the slider drives, and a track already playing has to answer to both without being restarted.
  if (currentMusic) currentMusic.volume = gainFor(getState().settings.musicVolume)
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

  // The caller's own `volume` is a *relative* level for that one sound — the lock tone is quieter
  // than an impact by design — so the slider multiplies it rather than replacing it. A slider that
  // overwrote it would flatten the mix the sound design is built on.
  const config = {
    ...options,
    volume: (options?.volume ?? 1) * gainFor(getState().settings.soundVolume),
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
    volume: gainFor(getState().settings.musicVolume),
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
  applyMusicAudibility()
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
  applyMusicAudibility()
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
  platformAudioEnabled = isAudioEnabled()

  game.events.on(YTEvents.AUDIO_ENABLED_CHANGE, (enabled: boolean) => {
    platformAudioEnabled = enabled
    applyMusicAudibility()
    console.debug('[audio] platform audio enabled ->', enabled)
  })

  game.events.on(YTEvents.PAUSE, () => {
    if (soundManager) {
      soundManager.mute = true
    }
    // stopMusic() destroys the instance (see its comment) — capture position first so
    // RESUME can continue the track instead of restarting it from 0.
    pausedMusicSeek = currentMusic?.seek ?? 0
    stopMusic()
  })

  game.events.on(YTEvents.RESUME, () => {
    if (soundManager) {
      soundManager.mute = false
    }
    if (currentMusicKey && effectiveMusic()) {
      playMusic(currentMusicKey, pausedMusicSeek)
    }
  })
}
