import * as Phaser from 'phaser'
import { GameConfig } from './config'
import { waitForPlatformReady, bindPlatformEvents } from './platform/yt'
import { bindGameplayPause } from './platform/lifecycle'
import { initHealthMonitoring, getRecentErrors } from './platform/health'
import { showInterstitial, showRewarded } from './platform/adGate'
import { init as initSaveStore, bindAutosave } from './save/store'
import { init as initAudio } from './audio/audio'
import { initLocale } from './i18n/strings'
import { setCatalog } from './shop/catalog'
import { buildThemeCatalog, resolveSelectedTheme } from './shop/themeCatalog'
import { setRoadTheme } from './road/themes'
import { UI_THEME_COLORS } from './ui/kitPalette'
import { setTheme } from './ui/theme'
import { getState } from './save/store'

// Before new Phaser.Game(...): a synchronous throw during game construction itself
// should still land in the ring buffer/health ping, not just errors after boot.
initHealthMonitoring()

await waitForPlatformReady()
await initSaveStore()
// Must resolve before the first scene renders any t() string — a scene's create() can run
// synchronously in the same tick as Boot/Preloader (see yt.ts's gameReady()-queuing note for
// an instant/asset-less Preloader).
await initLocale()

// The real catalogue, registered unconditionally — the template's DEV-gated demo items existed
// only because the bare template had nothing to sell.
//
// **Themes are the whole catalogue now.** The rail shooter sold weapons, upgrade steps, hulls and
// a fourth loadout slot alongside them; all four went with the combat layer, and none of them had
// an equivalent in a runner whose only verb is "keep going". What is left is the one kind of item
// that was always a pure `'unlock'` — a look for the road.
setCatalog(buildThemeCatalog())

// The interface palette, before any scene creates a widget: every factory in `ui/theme.ts` reads
// `getTheme()` at *creation* time, so a widget already on screen never retints itself. The
// template's own default put the HUD's shields in a colour 15.4 degrees from `THREAT_COLOR` — see
// `ui/kitPalette.ts` for the measurement and why that is a rule violation rather than a taste one.
setTheme({ colors: { ...UI_THEME_COLORS } })
// Applied before `new Phaser.Game(...)`, so the first scene that builds a texture already
// builds it in the right colours. `resolveSelectedTheme` never trusts the saved id: a save can
// outlive a theme, and a hand-edited one must not unlock anything.
setRoadTheme(resolveSelectedTheme(getState().selectedTheme, getState().purchases))

const game = new Phaser.Game(GameConfig)
bindPlatformEvents(game)
bindGameplayPause(game)
bindAutosave(game)
initAudio(game)

declare global {
  interface Window {
    // Dev/debug hook: lets manual testing emit platform events (YTEvents.PAUSE/RESUME/
    // AUDIO_ENABLED_CHANGE) on game.events without a real ytgame SDK to drive them.
    __game?: Phaser.Game
    // Dev/debug hook: exposes health.ts's ring buffer for the dev console and tests --
    // a raw dynamic import() from a test script resolves to a different module instance
    // than the one initHealthMonitoring() above wired up (see CLAUDE.md's "dual module
    // instance" gotcha), so this is the only reliable way to inspect the live one.
    __getRecentErrors?: typeof getRecentErrors
    // Dev/debug hook: exposes adGate.ts's functions bound to this page's actual yt.ts
    // instance (same dual-module-instance reason as above -- adGate's isPlatformPaused()
    // check would read from a disconnected, always-false state on a freshly re-imported
    // yt.ts instance otherwise).
    __adGate?: { showInterstitial: typeof showInterstitial; showRewarded: typeof showRewarded }
  }
}
// DEV only. These are a testing surface, not a feature: they hand a page anything it asks for,
// including the ad calls. Shipping them would put a working `__adGate.showRewarded` on the
// global object of a submitted game. The guard is `import.meta.env.DEV`, so Vite eliminates the
// whole block from `vite build` output as dead code — which `check-bundle.mjs` then verifies by
// grepping the built bundle, because "we gated it" and "it is gone" are different claims.
if (import.meta.env.DEV) {
  window.__game = game
  window.__getRecentErrors = getRecentErrors
  window.__adGate = { showInterstitial, showRewarded }
}
