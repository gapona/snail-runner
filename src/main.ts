import * as Phaser from 'phaser'
import { GameConfig } from './config'
import { waitForPlatformReady, bindPlatformEvents } from './platform/yt'
import { bindGameplayPause } from './platform/lifecycle'
import { initHealthMonitoring, getRecentErrors } from './platform/health'
import { showInterstitial, showRewarded } from './platform/adGate'
import { init as initSaveStore, bindAutosave } from './save/store'
import { init as initAudio } from './audio/audio'
import { initLocale } from './i18n/strings'
import { initDisplayFont, whenDisplayFontReady } from './ui/font'

/**
 * How long boot waits for the display face before starting without it.
 *
 * Long enough that a warm cache is always inside it — the file is 10.7KB — and short enough that a
 * cold 3G connection does not hold the first frame hostage to a typeface.
 */
const DISPLAY_FONT_GRACE_MS = 200
import { setCatalog } from './shop/catalog'
import { buildThemeCatalog, resolveSelectedTheme } from './shop/themeCatalog'
import { buildSnailCatalog } from './shop/snailCatalog'
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
// **Awaited here for the same reason `initLocale` is**: a Canvas/WebGL `Text` does not repaint
// when a web font arrives after it has already drawn with a fallback, so the face has to be in
// `document.fonts` before the first scene creates its first label.
//
// **A local file, never a CDN link.** Playables is offline-only and its CSP blocks the request;
// `ui/font.ts` uses the `FontFace` API against a file under `public/assets/` for exactly that.
// Titan One is OFL — see ART-SOURCES.md — and is the one face in the game with enough weight to
// hold the title's outline. Never blocks boot: `initDisplayFont` swallows its own failures.
// **⚠ RACED, NOT AWAITED, AND THE 200ms IS THE WHOLE POINT.** This used to be a bare `await`, which
// put a font file in front of `new Phaser.Game(...)` — i.e. in front of the loading screen itself.
// A loading screen is judged by how fast it appears; a face that has not arrived in 200ms is one
// the first screen draws its title *without*, and `Preloader` adds the title the moment
// `whenDisplayFontReady()` resolves. The promise is kept inside `ui/font.ts`, so nothing is lost by
// not awaiting it here.
void initDisplayFont({ family: 'Titan One', url: 'assets/fonts/titan-one.woff2' })
await Promise.race([whenDisplayFontReady(), new Promise((resolve) => setTimeout(resolve, DISPLAY_FONT_GRACE_MS))])

// The real catalogue, registered unconditionally — the template's DEV-gated demo items existed
// only because the bare template had nothing to sell.
//
// **Two kinds of look, and that is the whole catalogue.** The rail shooter sold weapons, upgrade
// steps, hulls and a fourth loadout slot alongside the themes; all four went with the combat layer,
// and none of them had an equivalent in a runner whose only verb is "keep going". What is left is
// the kind of item that was always a pure `'unlock'`: a look for the road, and a look for the snail
// running down it.
//
// **The snails come first, and the order is the tab order** — `Shop.ts` groups by first appearance
// rather than having an opinion of its own. A player looks at the character before they look at the
// scenery, and the free skin standing in row one is what says the tab is a wardrobe rather than a
// paywall.
// **⚠ The skins are not in the shop any more, and that is the point of the garage.** Two places to
// buy one thing is two places to keep in step, and the shop's row could never do the job anyway:
// what sells a mascot is the mascot, at full height, which is a screen rather than a list entry.
// `buildSnailCatalog` is kept — it is what would put them back if the garage ever went away.
setCatalog([...buildThemeCatalog()])

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
