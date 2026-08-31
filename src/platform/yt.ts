import type * as Phaser from 'phaser'
import { READY_RETRY, readyAttempts } from './retry'

/**
 * Single point of contact with the YouTube Playables SDK (`ytgame`).
 * No other module may reference the `ytgame` global directly — see PLAYABLES-SDK.md.
 * Outside the Playables environment every call falls back to a local stub
 * (localStorage for save/load, no-op + console.debug for everything else),
 * so the game runs unmodified in `npm run dev`.
 */

export type YTContentType = 'VIDEO' | 'PLAYABLE'

interface YTGameSDK {
  IN_PLAYABLES_ENV: boolean
  game: {
    firstFrameReady(): void
    gameReady(): void
    saveData(data: string): Promise<void>
    loadData(): Promise<string>
  }
  system: {
    isAudioEnabled(): boolean
    onAudioEnabledChange(cb: (enabled: boolean) => void): () => void
    onPause(cb: () => void): () => void
    onResume(cb: () => void): () => void
    getLanguage(): Promise<string>
  }
  engagement: {
    sendScore(params: { value: number }): Promise<void>
    openYTContent(params: { id: string; contentType?: YTContentType }): Promise<void>
  }
  ads: {
    requestInterstitialAd(): Promise<void>
    requestRewardedAd(rewardId: string): Promise<boolean>
  }
  health: {
    logError(): void
    logWarning(): void
  }
}

declare global {
  // Attached to the global scope by the SDK's <script> tag (see index.html);
  // undefined outside the Playables environment.
  // eslint-disable-next-line no-var
  var ytgame: YTGameSDK | undefined
}

/** Phaser event names the wrapper emits on `game.events`; scenes subscribe to these, never to `ytgame`. */
export const YTEvents = {
  PAUSE: 'yt-pause',
  RESUME: 'yt-resume',
  AUDIO_ENABLED_CHANGE: 'yt-audio-enabled-change',
} as const

const LOCAL_SAVE_KEY = 'SAVE_DATA'

function getSdk(): YTGameSDK | null {
  return typeof ytgame !== 'undefined' && ytgame.IN_PLAYABLES_ENV ? ytgame : null
}

export function isPlayablesEnv(): boolean {
  return getSdk() !== null
}

function normalizeError(e: unknown): Error {
  if (e instanceof Error) return e
  return new Error(typeof e === 'string' ? e : 'Unknown ytgame SDK error')
}

const SDK_WAIT_TIMEOUT_MS = 2500

function waitForDocumentReady(): Promise<void> {
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    document.addEventListener('DOMContentLoaded', () => resolve(), { once: true })
  })
}

/**
 * Resolves once it's safe to construct `new Phaser.Game(...)`. The SDK <script> tag in
 * index.html is a normal (non-module) script, so it has already run — and attached
 * `ytgame` to the global scope, if present — by the time this deferred module executes.
 *
 * That wait is raced against `timeoutMs` so a slow SDK load can't delay the game
 * indefinitely: if neither the document nor `ytgame` is ready in time, we log a
 * warning and start in fallback mode (no cloud save/ads) instead of a black screen.
 *
 * Caveat: the SDK <script> tag is parser-blocking, as required by the certification
 * docs ("load the SDK before any game code"). If that specific network request stalls
 * outright, the browser won't reach this module's code at all — this guards against
 * slow-but-bounded failures once JS starts running, not a true stall at the
 * HTML-parsing level. The official phaserjs/template-youtube-playables has the same
 * limitation (its `boot()` waits for `window.load` with no timeout at all).
 */
export async function waitForPlatformReady(timeoutMs = SDK_WAIT_TIMEOUT_MS): Promise<void> {
  await Promise.race([waitForDocumentReady(), new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))])

  if (typeof ytgame === 'undefined') {
    console.warn(`[yt] Playables SDK not available after ${timeoutMs}ms — starting in fallback mode (no cloud save/ads)`)
    return
  }

  console.debug(isPlayablesEnv() ? '[yt] Playables SDK detected' : '[yt] SDK script loaded but not running in Playables — using local stubs')
}

// firstFrameReady() MUST fire before gameReady() (certification requirement). With an
// empty/instant Preloader, Boot -> Preloader -> MainMenu can run in a single synchronous
// tick, calling gameReady() before the first POST_RENDER — so gameReady() is deferred
// here until firstFrameReady() has actually fired, regardless of call order.
let firstFrameRequested = false
let gameReadyRequested = false

/** Which mandatory signals the SDK has actually accepted. Read by the DEV hook and the check. */
const delivered = { firstFrame: false, gameReady: false }
let retryTimer: ReturnType<typeof setInterval> | null = null
let attemptsMade = 0

/**
 * What the platform has actually been told, as opposed to what has been asked for.
 *
 * **The distinction is the whole point of this file's retry.** `firstFrameReady()` returning does
 * not mean the SDK heard it; only `delivered.firstFrame` does.
 */
export function readySignalState(): { firstFrame: boolean; gameReady: boolean; attempts: number; pending: boolean } {
  return { ...delivered, attempts: attemptsMade, pending: retryTimer !== null }
}

/**
 * Delivers whatever has been requested and not yet accepted, if the SDK is there to take it.
 *
 * **⚠ THIS USED TO BE `getSdk()?.game.firstFrameReady()` AND THAT IS A SUBMISSION BLOCKER.** Both
 * signals are MUST-CALL — without `firstFrameReady()` the platform never shows the game — and an
 * optional chain against a global that has not attached yet does *nothing*, silently, once. The
 * old code then logged `[yt] firstFrameReady()` either way, so a platform 200ms late produced a
 * game that is never displayed and a console that says it is fine.
 *
 * The SDK is a parser-blocking script and is normally there long before the first frame; the case
 * this exists for is the one nobody can reproduce on a developer machine, which is exactly why it
 * has to be a retry rather than a belief.
 */
function pump(): void {
  const sdk = getSdk()

  attemptsMade++

  // **⚠ Outside Playables there is nothing to deliver, and retrying would report a false failure.**
  // `ytgame` present with `IN_PLAYABLES_ENV` false is the SDK telling us it is a no-op here — a
  // definite answer, unlike `ytgame` being undefined, which only means "not yet". Marking the
  // signals delivered on that answer is what keeps a local run, a `vite preview` and every
  // automated capture from spending eight seconds polling and then logging an error to the health
  // API. Found immediately: the first build of the retry did exactly that on localhost.
  if (!sdk && typeof ytgame !== 'undefined') {
    delivered.firstFrame = firstFrameRequested || delivered.firstFrame
    delivered.gameReady = gameReadyRequested || delivered.gameReady
  }

  if (sdk) {
    if (firstFrameRequested && !delivered.firstFrame) {
      sdk.game.firstFrameReady()
      delivered.firstFrame = true
      console.debug(`[yt] firstFrameReady() delivered on attempt ${attemptsMade}`)
    }
    // Ordering is not merely preserved, it is enforced: `gameReady` is only ever offered once the
    // SDK has taken `firstFrameReady`, whatever order the scenes asked in.
    if (gameReadyRequested && delivered.firstFrame && !delivered.gameReady) {
      sdk.game.gameReady()
      delivered.gameReady = true
      console.debug(`[yt] gameReady() delivered on attempt ${attemptsMade}`)
    }
  }

  const outstanding =
    (firstFrameRequested && !delivered.firstFrame) || (gameReadyRequested && !delivered.gameReady)

  if (!outstanding || attemptsMade >= readyAttempts()) {
    if (outstanding) {
      // Loud, and only ever printed when a mandatory call really was lost. A silent give-up is the
      // failure mode this whole mechanism exists to remove.
      console.error(`[yt] gave up delivering ready signals after ${attemptsMade} attempts`, { ...delivered })
      logError()
    }
    if (retryTimer !== null) {
      clearInterval(retryTimer)
      retryTimer = null
    }
  }
}

function requestSignal(): void {
  pump()

  const outstanding =
    (firstFrameRequested && !delivered.firstFrame) || (gameReadyRequested && !delivered.gameReady)

  if (outstanding && retryTimer === null) {
    retryTimer = setInterval(pump, READY_RETRY.intervalMs)
  }
}

export function firstFrameReady(): void {
  firstFrameRequested = true
  requestSignal()
}

export function gameReady(): void {
  gameReadyRequested = true
  if (!firstFrameRequested) {
    console.debug('[yt] gameReady() requested before firstFrameReady() — deferring until the first frame renders')
  }
  requestSignal()
}

export async function saveData(data: string): Promise<void> {
  const sdk = getSdk()
  if (sdk) {
    return sdk.game.saveData(data)
  }
  console.debug('[yt] saveData() stub -> localStorage')
  window.localStorage.setItem(LOCAL_SAVE_KEY, data)
}

export async function loadData(): Promise<string> {
  const sdk = getSdk()
  if (sdk) {
    return sdk.game.loadData()
  }
  console.debug('[yt] loadData() stub -> localStorage')
  return window.localStorage.getItem(LOCAL_SAVE_KEY) ?? ''
}

export function isAudioEnabled(): boolean {
  const sdk = getSdk()
  if (sdk) {
    return sdk.system.isAudioEnabled()
  }
  console.debug('[yt] isAudioEnabled() stub -> true')
  return true
}

export async function getLanguage(): Promise<string> {
  const sdk = getSdk()
  if (sdk) {
    return sdk.system.getLanguage()
  }
  console.debug('[yt] getLanguage() stub -> navigator.language')
  return navigator.language || 'en-US'
}

export async function sendScore(value: number): Promise<void> {
  // The SDK rejects non-integer values; gameplay code (e.g. combo multipliers) can easily
  // produce a float, so round here rather than requiring every call site to remember to.
  const rounded = Math.round(value)
  const sdk = getSdk()
  if (sdk) {
    return sdk.engagement.sendScore({ value: rounded })
  }
  console.debug(`[yt] sendScore(${rounded}) stub -> no-op`)
}

export async function openYTContent(id: string, contentType: YTContentType = 'VIDEO'): Promise<void> {
  const sdk = getSdk()
  if (sdk) {
    return sdk.engagement.openYTContent({ id, contentType })
  }
  console.debug(`[yt] openYTContent(${id}, ${contentType}) stub -> no-op`)
}

export async function requestInterstitialAd(): Promise<void> {
  const sdk = getSdk()
  if (!sdk) {
    console.debug('[yt] requestInterstitialAd() stub -> no-op')
    return
  }
  try {
    await sdk.ads.requestInterstitialAd()
  } catch (e) {
    throw normalizeError(e)
  }
}

export async function requestRewardedAd(rewardId: string): Promise<boolean> {
  const sdk = getSdk()
  if (!sdk) {
    console.debug(`[yt] requestRewardedAd(${rewardId}) stub -> true`)
    return true
  }
  try {
    return await sdk.ads.requestRewardedAd(rewardId)
  } catch (e) {
    throw normalizeError(e)
  }
}

export function logError(): void {
  const sdk = getSdk()
  if (sdk) {
    sdk.health.logError()
    return
  }
  console.debug('[yt] logError() stub -> no-op')
}

export function logWarning(): void {
  const sdk = getSdk()
  if (sdk) {
    sdk.health.logWarning()
    return
  }
  console.debug('[yt] logWarning() stub -> no-op')
}

let platformPausedState = false

/**
 * Whether a platform-level pause (YTEvents.PAUSE) is currently active, i.e. no matching
 * YTEvents.RESUME has fired yet. Tracked off `game.events` itself (not the raw SDK
 * callback) so it stays correct under manual event emission too (dev/testing, where
 * there's no real `ytgame` to drive it) — see "resume race" note on Settings.close().
 */
export function isPlatformPaused(): boolean {
  return platformPausedState
}

/**
 * Subscribes to the SDK's onPause/onResume/onAudioEnabledChange and relays them as
 * events on `game.events`, so scenes can `this.game.events.on(YTEvents.PAUSE, ...)`
 * without ever importing this module's `ytgame`-facing internals.
 */
export function bindPlatformEvents(game: Phaser.Game): void {
  // Registered unconditionally (even with no real SDK) so isPlatformPaused() reflects
  // manually-emitted PAUSE/RESUME too, not just the real relay wired in below.
  game.events.on(YTEvents.PAUSE, () => {
    platformPausedState = true
  })
  game.events.on(YTEvents.RESUME, () => {
    platformPausedState = false
  })

  const sdk = getSdk()
  if (!sdk) {
    console.debug('[yt] bindPlatformEvents() stub -> no platform events to bind')
    return
  }

  sdk.system.onPause(() => {
    console.debug('[yt] onPause -> emitting', YTEvents.PAUSE)
    game.events.emit(YTEvents.PAUSE)
  })

  sdk.system.onResume(() => {
    console.debug('[yt] onResume -> emitting', YTEvents.RESUME)
    game.events.emit(YTEvents.RESUME)
  })

  sdk.system.onAudioEnabledChange((enabled) => {
    console.debug('[yt] onAudioEnabledChange -> emitting', YTEvents.AUDIO_ENABLED_CHANGE, enabled)
    game.events.emit(YTEvents.AUDIO_ENABLED_CHANGE, enabled)
  })

  console.debug('[yt] bound onPause/onResume/onAudioEnabledChange to game.events')
}
