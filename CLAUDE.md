# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## The Fork: This Was A Rail Shooter

**Snail Runner is a fork of SKYLOCK**, the rail shooter this repository used to be, and most of
this document is still that game's. Read this section before anything below it, because it decides
which of the rest is law and which is history.

**What changed is the verb.** SKYLOCK's player marked targets and fired; this one runs, dodges and
jumps. What did *not* change is the world it happens in — the pseudo-3D road, its projection, its
track builder, its biomes, its themes, its scenery pools and its sky. That renderer is the most
measured thing in the repository (`npm run verify:road`, 93 checks) and it is entirely
genre-neutral: it draws a road with things standing on it and has no opinion about what those
things are.

### `src/road/` is untouchable

**Rule: the fork does not modify `src/road/`.** Not to make an obstacle easier to place, not to add
a field to `Segment`, not to "just adjust" the horizon. Three reasons, in order of how expensive
they are to relearn:

1. **It is already correct at a level nothing else here is.** The projection, the fog curve, the
   quad topology, the hill clip and the palette were each debugged against a screenshot and then
   pinned by an assertion. `verify:road` fails on changes whose defect is invisible by eye — the
   near-tier decor rate, the biome contrast floor, the UV row for a fog step.
2. **Depth is paid for.** There is no real 3D here and none is coming: the road is one `Mesh2D`,
   everything else is a billboard reusing that mesh's own projection of the segment it stands on.
   Introducing Three.js, or a second projection, would buy nothing the billboards do not already do
   and would immediately let the visual and the logical drift apart.
3. **A game object that draws itself through `billboardRectInto` cannot disagree with the ground.**
   That is the whole reason the player is a world-space entity in this fork (see below) — and it
   only holds while there is exactly one projection.

Two edits to `src/road/` were unavoidable and are the only ones: `applyTheme.ts` and
`Atmosphere.ts` each held a *back-reference into the genre layer* (`rail/enemyArt`,
`rail/constants`). Both now point at `src/run/` (`obstacleArt.ts`, `constants.ts`) through the same
seam, which is why `src/run/obstacleArt.ts` exists before it has anything to draw.

### The player lives in road space, not screen space

**This is the deliberate reversal of SKYLOCK's central rule, and it is the fork's main design
decision.** The rail shooter kept the ship in *screen* coordinates — "it is simply where the finger
is" — and `src/rail/constants.ts` said so plainly, which is also why `ram.ts` had to exist: "flying
into something is a question the projection cannot answer, because the ship has no world position,
only a column."

A runner cannot accept that answer. "Did I clear that log?" is a comparison of **world heights**: an
obstacle twenty segments out and the same obstacle at the moment of contact project to wildly
different screen sizes, so a jump threshold in pixels would mean a different thing at every
distance. So the snail carries:

| field     | unit                  | meaning                                                     |
|-----------|-----------------------|-------------------------------------------------------------|
| `z`       | world units           | the constant `PLAYER_Z`, solved from the projection like `SHIP_LANE_Z` was |
| `offsetX` | road half-widths      | `0` centreline, `±1` the edges of the asphalt                 |
| `y`       | world units           | height above the road, `0` on the ground                      |

What that buys, free: the player draws through the same `billboardRectInto` as any prop, so visual
and logic cannot diverge; on a bend the road slides across the screen and the snail at a fixed
`offsetX` stays on it (a screen-space spring would fight the curvature); `|offsetX| > 1` is a
*world* fact, so running onto the verge can cost speed and mean something; and every collision is
plain TypeScript with no Phaser in it, testable under Node.

**The feel is not reinvented.** `PLAYER_STIFFNESS = 60` and `PLAYER_DAMPING = 0.85` are SKYLOCK's
`SHIP_STIFFNESS`/`SHIP_DAMPING` unchanged, integrated through the same `runFixedSteps`. Only the
state space moved.

### An obstacle is a vertical band, not a flag

One rule instead of three. An obstacle carries `[yLow, yHigh]` in world units, the player's body is
`[y, y + PLAYER_BODY_H]`, and a hit is those two intervals overlapping **and** the `offsetX`
intervals overlapping. Nothing anywhere asks "is this jumpable?" — see `OBSTACLE_BANDS` in
`src/run/constants.ts` for the three rows that fall out of the arithmetic, and for why the third
(`overhead`, which punishes being airborne) is mandatory rather than decorative.

### What was cut, and where the rest went

Deleted with the combat layer: `weapons`, `weaponCatalog`, `weaponPrices`, `WeaponRow`,
`weaponRowLayout`, `volley*`, `lockon`, `LockOnView`, `boss`, `BossView`, `upgrades`, `loadout*`,
`waves`, `WaveBanner`, `enemy*`, `Enemies`, `enemyShots`, `ShotSprites`, `ram`, `telegraph`,
`TelegraphView`, `Ship`, `menuFlyby`, `LaneEdges`, `Effects`, `FxSprites`, `Hud`, `run`, `trail`,
`fx`, `skyClearance`, the whole of `src/game/` (levels, ships, trackMap), the `Hangar`, `Loadout`
and `LevelSelect` scenes, and their `scripts/verify-*.mjs` suites.

`src/rail/` no longer exists. What survived moved to **`src/run/`**: `WorldView.ts`, `hitstop.ts`,
`debris.ts`, `playerDeath.ts`, `perfReport.ts`, `hudDepth.ts` — plus a new `constants.ts` that
carries over the numbers worth keeping (the spring, the camera lean, the debris, the hitstop) and
derives the runner's own from them.

`RailScene.ts` became `RunScene.ts`, cut back to a scene that builds the track and draws the road
and nothing else. `MainMenu` kept its world, its layout bands and its measured contrast, and lost
the flying ship, the level picker and the weapon/hull/slot shop tabs — **themes are the whole
catalogue now.** The sound vocabulary was re-cut for the runner in `src/audio/sfx.ts`; the lock
ladder survived as the coin-streak ladder, because "how many did I just get, without looking away"
is the same question in both games.

### Reading the rest of this document

**The runner's own chapters are the fifteen between "## UI Kit" and "## Road Renderer"** — The Run,
The Snail, The Jump, The Ramp, Obstacles, Draw Order, Pickups, The Handover, Chains, Fever, The
Slime Trail, The Art, The Difficulty Curve, The End Of A Run, The HUD. "Four Things From One
Screenshot" collects a round of player reports across several of them. Those describe this game.

Below them, everything about the road, the billboards, the biomes, the themes, the interface kit,
the save layer, the platform layer, the build guards and the scroll patterns is **current and
binding**. Everything about ships, weapons, enemies, waves, the boss, lock-on, the volley, upgrades,
the loadout, hulls and levels is **history**: the code is gone, and those sections are kept because
they record *why* numbers that are still here were chosen (the dodge budget that set the spring
constant, the sightline that shaped the circuit, the OKLab threat rule the palette still obeys).
Do not restore behaviour from them, and do not take a "⚠" in one of them as a live warning.

## Commands

- `npm run dev` — start Vite dev server (http://localhost:8080, auto-opens browser)
- `npm run build` — typecheck (`tsc`, no emit), production bundle to `dist/`, then
  `scripts/verify-mattes.mjs` and `scripts/check-bundle.mjs` (size/content guards — see "Build
  Guards & Asset Policy")
- `npm run bundle` — `npm run build`, then `scripts/make-bundle.mjs` zips `dist/` into
  `build/<app-id>-<version>.zip` for Playables submission
- `npm run preview` — serve the built `dist/` bundle locally. **Point the Playables Test
  Suite at this, never at `npm run dev`** — see "Build Guards & Asset Policy" for why dev
  mode's load order isn't representative of the shipped artifact.
- `npm run verify:road` — plain-Node logic check (via `scripts/register-ts-loader.mjs`'s
  Node-native-TS + extensionless-import loader hook, no bundler/browser involved) covering the road
  renderer's pure math: `src/road/project.ts`, `src/road/track.ts` (including `decorateTrack`),
  `src/road/billboard.ts`, `src/race/rng.ts`, `paletteU` in `src/road/constants.ts`,
  `src/road/decals.ts`, `src/road/particles.ts`, and `src/road/sightline.ts` — see "Road Renderer",
  "Billboards & Scenery" and "The Sightline". **The sightline floor is now stated in world units
  rather than seconds** (`MIN_SIGHTLINE_UNITS`): it is a claim about the circuit's geometry, and
  writing it in seconds silently rescaled it when the fork's speeds changed.
- `npm run verify:run-speed` — the run's own clock: `src/run/runState.ts`'s distance integration is
  frame-rate invariant, and `wrapZ` on a negative `z` returns to the end of the track rather than to
  zero. See "The Run".
- `npm run verify:player` — `src/run/playerMotion.ts`'s horizontal spring: frame-rate invariance,
  the soft wall at the road's edge, and no drift on a `ROAD_CURVE.HARD` section under a still
  finger. See "The Snail".
- `npm run verify:jump` — the same module's vertical: air time and apex invariant to frame rate,
  the apex within 1% of `JUMP_APEX`, and **the three obstacle classes separated by arithmetic
  rather than by a flag**. See "The Jump".
- `npm run verify:formations` — `src/run/formations.ts`: pickups laid in chains. **The arc is the
  flight solver's** — the closed form and the stepped tick are asserted to agree — a chain is
  homogeneous, nothing is laid inside an obstacle (shown rejecting a road with no gap in it), and
  the speed band an arc survives is printed rather than assumed. See "Chains, Not Scatter".
- `npm run verify:ramp` — `src/run/ramp.ts`: the launch is solved from the apex through the game's
  one gravity, **the spin lands upright at 50 random launches where a fixed angular velocity lands
  172 degrees off**, the band rule already covers the apex with no invulnerability flag (and 31% of
  the flight is still hittable, measured), and air control is weakened without being switched off.
  See "The Ramp, And Landing On Your Feet".
- `npm run verify:fever` — `src/run/fever.ts`: the gauge does not drain, the guard outlives the
  speed, and **in 200 simulated exits over the real placer's output the first obstacle a player can
  be hit by arrives no sooner than `REACTION_MS`** — shown failing first against the same simulation
  with the road-clearing removed. See "Fever, And The Second In Which It Ends".
- `npm run verify:layout` — `src/run/lapLayout.ts`: **nothing already on screen is ever
  rewritten.** Drives a real run over three laps against the real placers and asserts no segment
  inside the visible band ever changes; carries the shipped whole-lap swap as its negative
  control, which rewrites 69 obstacle slots in view. See "Nothing Already On Screen Is Ever
  Rewritten".
- `npm run verify:obstacles` — `src/run/obstacles.ts`: a passable line exists through every
  generated stretch, the three classes produce exactly the expected outcomes on the ground and at
  the apex, and every obstacle is readable for at least `REACTION_MS` at `SPEED_CAP`. See
  "Obstacles".
- `npm run verify:sightline` — how a billboard comes out from behind a crest: that the crop is
  measured from the top, that it slides rather than steps as the camera moves, and that a taller
  prop clears the ridge earlier than a short one. Reimplements the mesh's own walk under Node,
  because `RoadMesh` imports phaser. See "Coming Out From Behind A Crest".
- `npm run verify:scroll` — `src/ui/scrollMomentum.ts` and `src/ui/scrollList.ts` (the row-list
  arithmetic and the tap-versus-drag decision) — see "Scroll Patterns" and "The Shop Scrolls".
- `npm run verify:audio` — `src/audio/synth.ts` (WAV rendering and the fade teardown gap) and
  `src/audio/sfx.ts` (the streak scale, the repeat policy) — see "Sound".
- `npm run verify:ui` — `src/ui/sliderMath.ts`, `src/audio/volume.ts` (the slider-to-gain curve),
  `src/ui/kitPalette.ts` (the interface palette, its contrast, its touch-target arithmetic and the
  OKLab threat rule applied to it) and the shared tap-versus-drag rule — see "The Interface Kit".
- `py -3.11 scripts/build-sprites.py [--only snail,obstacles,pickups,decor]` — turns the picked
  renders in `dev-assets/sprites/` into the files under `public/assets/`, reading which variant
  won from `dev-assets/picks.json`. Run by hand when the picks change; the output is committed, so
  `npm run build` never needs Python. It also bakes the mascot's six glide frames out of its one
  render and composites the pickups' shared backing disc — see "The Regeneration: A Glossy World".
- `node scripts/measure-art.mjs [dir-or-file ...]` — not a suite either, and it asserts nothing: it
  reports each sprite's lightness, saturation and ink share, which is the instrument the art is
  aimed with. Defaults to `public/assets/decor`. **Its old reading of that directory — 111 / 5% /
  34% — is no longer the target**: those props were replaced, and what the numbers are now compared
  against is stated in "The Regeneration: A Glossy World".
- `npm run verify:mattes` — not a logic suite: it reads every RGBA sprite in `public/assets/` and
  checks the two things a matte can be wrong about independently of what is drawn (alpha under the
  floor, colour flooded under the transparency). Runs inside `npm run build` — see "The Matte That
  Was Not Broken".

There is no linter or formatter configured yet, and no test runner: the `npm run verify:*` scripts
above are plain-Node assertion scripts, and they are the only automated logic tests that exist.
**Any new pure-logic module belongs in one of them (or a new `scripts/verify-*.mjs` of the same
shape), which means it must not import `phaser`** — a value import of Phaser executes its init
code, which reads `window` and crashes under Node.

## Architecture

Phaser 4 game client bundled with Vite. `tsconfig.json` uses `noEmit: true` — TypeScript is only used for typechecking; Vite/esbuild does the actual transpilation. `tsconfig.json`'s `"types": ["vite/client"]` is what makes `import.meta.env.DEV` typecheck at all (`ImportMeta` has no `env` property without it) — needed for every `import.meta.env.DEV`-gated block in this codebase (see "Shop Layer" for the current example). `vite.config.ts` sets `build.target: 'es2022'` — required for the top-level `await` in `main.ts` (esbuild's default target predates it) — and `base: './'`, required because Playables does not host games at the domain root (see "Build Guards & Asset Policy" and "Known Issues Fixed").

- `src/main.ts` — entry point. Calls `initHealthMonitoring()` **first**, before anything else (see
  "Health Monitoring"), then `await waitForPlatformReady()`, `await` the save store's `init()`, `await
  initLocale()` (i18n/strings.ts — see "Localization"; must resolve before the first scene renders any
  `t()` string), then constructs `new Phaser.Game(GameConfig)`, then `bindPlatformEvents(game)`,
  `bindGameplayPause(game)`, `bindAutosave(game)`, and `initAudio(game)`. A game that also wants a custom
  display font calls `ui/font.ts`'s `initDisplayFont({ family, url })` here too, before `new
  Phaser.Game(...)` for the same reason — see "UI Kit". Also sets three dev/debug hooks (not used by game code):
  `window.__game` (lets manual testing emit `YTEvents.PAUSE`/`RESUME`/`AUDIO_ENABLED_CHANGE` on
  `game.events` without a real `ytgame` SDK), `window.__getRecentErrors` (health.ts's ring buffer), and
  `window.__adGate` (adGate.ts's `showInterstitial`/`showRewarded`, bound to this page's real `game` and
  `yt.ts` state) — the latter two exist specifically because a raw dynamic `import()` from a test script
  gets its own disconnected module instance (see "Audio Layer"'s dual-module-instance gotcha), so this is
  the only reliable way to reach the live one. See "YouTube Playables Wrapper", "Save Layer", and "Audio
  Layer" below.
- `src/config.ts` — the single `Phaser.Types.Core.GameConfig` object (renderer type, resolution, scale mode, arcade physics, registered scene list). Renderer is `Phaser.AUTO` (WebGL with Canvas fallback).
- `src/scenes/` — one file per `Phaser.Scene`, wired together via `this.scene.start('SceneName')`, not imports of each other:
  - `Boot` → loads only what the `Preloader` screen itself needs; on the first `Phaser.Core.Events.POST_RENDER` calls `firstFrameReady()`; then starts `Preloader`.
  - `Preloader` → shows a progress bar (on the standard `layout()` pattern — see "Responsive Layout"),
    loads all real game assets here, then starts `MainMenu`.
  - `MainMenu` → **renders the game's own world** through `WorldView`, with the title, the Play
    button and two secondary buttons (Shop, Settings) laid over the rows a run leaves empty; calls
    `gameReady()`, and hands over to `RunScene` on `'primary'` with no fade. See "The Menu Is The
    Game" — the argument survived the genre change; only the ship flying across it did not.
  - `RunScene` → **the gameplay scene**. Owns nothing but the wiring: the world (`WorldView`), the
    run's clock (`runState.ts`), the snail (`playerMotion.ts` + `PlayerView`), the obstacles and
    pickups and their pools, and the HUD. Every rule it applies lives in a `phaser`-free module
    under `src/run/`. See "The Run", "The Snail", "The Jump", "Obstacles" and "Pickups".
  - `RunOver` → the result overlay, and **the only place in the game an ad may appear**. See
    "The End Of A Run".
  - `Settings` → overlay scene, built entirely from the `src/ui/theme.ts` widget kit
    (`roundedPanel` + `neonButton`) and `t()` strings — see "Audio Layer" below and "UI Kit" for
    the widgets themselves.
  - `LevelSelect` → the fourth overlay: which of the eight levels to fly. Opened by the menu's
    Play button, and it *picks* rather than starting — see "Levels".
  - `Loadout` → the third overlay, on the same pattern: choosing which three of the owned weapons
    a run carries, and which of them it starts armed with. See "The Loadout Screen".
  - `Shop` → the same overlay pattern as `Settings`, demoing `src/shop/`'s coin/catalog
    mechanism. Registered in `config.ts` like any other scene, but its only entry point in this
    template (`MainMenu`'s Shop button) is DEV-gated — see "Shop Layer" below.

  New scenes must be added to the `scene: [...]` array in `src/config.ts` to be registered with Phaser.
- `src/platform/yt.ts` — YouTube Playables SDK wrapper. See "YouTube Playables Wrapper" below.
- `src/platform/input.ts` — abstract input-action mapping (mouse/touch/keyboard → one callback per action).
  See "Input Actions" below.
- `src/platform/lifecycle.ts` — `bindGameplayPause(game)` freezes/unfreezes gameplay scenes on
  `YTEvents.PAUSE`/`RESUME`, arbitrating with `Settings`'/`Shop`'s own pause ownership. See "YouTube
  Playables Wrapper" below.
- `src/platform/health.ts` — global error capture with dedup and a ring buffer. See "Health Monitoring"
  below.
- `src/platform/adGate.ts` — the only allowed entry point for showing ads. See "Ad Gate" below.
- `src/road/` — the pseudo-3D (segmented, OutRun-style) road renderer behind `RailScene`:
  `constants.ts` (tuning numbers + palette + section presets), `project.ts` (pure perspective
  math), `track.ts` (segment data and the `TrackBuilder` authoring DSL), `palette.ts` (the
  colour texture), `RoadMesh.ts` (the single `Mesh2D` the whole road is drawn with). See
  "Road Renderer" below. Scenery lives here too — `billboard.ts` (pure billboard projection and
  hill clipping), `decor.ts` (the placeholder silhouette textures), `RoadSprites.ts` (the fixed
  sprite pool) — see "Billboards & Scenery".
- `src/road/decals.ts` + `decalArt.ts` + `DecalMesh.ts` — the marks lying in the plane of the
  ribbon; `particles.ts` + `particleArt.ts` + `Atmosphere.ts` — what hangs in the air over each
  biome. Both procedural, both zero bytes — see "Marks On The Ground, Air In The Frame".
- `src/rail/` — the rail shooter's player and everything shooting at it: `WorldView.ts` (the
  world without any rules — the class both scenes build their ground, scenery and sky from, see
  "The Menu Is The Game"), `menuFlyby.ts` (the enemies that cross the front screen); `constants.ts` (ship,
  camera and enemy tuning), `shipMotion.ts` (the pure spring model), `Ship.ts` (state + input +
  placeholder body) — see "Player Ship"; plus `enemy.ts` (the pure attack state machine),
  `waves.ts` (seeded layout and spawning), `enemyShots.ts` (the pure flight/shield model),
  `Enemies.ts` + `ShotSprites.ts` (the pools that draw them) and `enemyArt.ts` (placeholder
  silhouettes) and `ram.ts` (flying into one, pure) — see "Enemies"; plus `lockon.ts` +
  `volley.ts` (the player's own verb, pure)
  and `LockOnView.ts` + `VolleySprites.ts` (the gesture and what it fires) — see "Lock-On and
  the Volley"; plus `hitstop.ts` + `debris.ts` (pure) and `Effects.ts` (the layers a hit draws)
  — see "Combat Feedback"; plus `fx.ts` (pure) and `FxSprites.ts` (the muzzle flash and the
  impact burst) — see "The Attack Animation"; plus `run.ts` + `boss.ts` (pure) and `BossView.ts`
  + `Hud.ts` — see "The Run, the Boss and the HUD".
- `src/race/` — **all that survives of the racer this game used to be**: the fixed timestep
  (`constants.ts` + `fixedStep.ts`) and the seeded RNG (`rng.ts`), both genre-neutral and both
  reused by `src/rail/` and `src/road/`. Nothing racing-specific is left in it; the name is
  history, not meaning.
- `src/ui/` — a themeable, palette-driven widget kit (buttons, rows, badges, panels, layout
  helpers, image previews, font loading). See "UI Kit" below. `scrim.ts` + `contrastProbe.ts` +
  `menuLayout.ts` are the front screen's own trio — solving a text plate from a measured
  background, taking that measurement, and the zones the menu may occupy — see "The Menu Is The
  Game". `scrollRegion.ts`/
  `scrollMomentum.ts` are a separate, self-contained pair for building a scrollable
  list/strip — see "Scroll Patterns" below.
- `src/i18n/` — the `t()`/`getLocale()` localization framework (generic keys only — a game adds
  its own strings on top). See "Localization" below.
- `src/shop/` — the coin-balance + catalog mechanism behind the `Shop` scene (no real product
  data — a game supplies its own catalog). See "Shop Layer" below.
- `public/assets/` — static game assets (images, audio, tilemaps), served at `/assets/...` and referenced via `this.load.setPath('assets')` in `Preloader`.
- `index.html` — loads the Playables SDK via a parser-blocking `<script src="https://www.youtube.com/game_api/v1">` tag, before the `type="module"` entry script, per certification requirements. That SDK `<script>` lives in `<head>`, not `<body>` — see "Build Guards & Asset Policy" for why the source file's body placement doesn't survive `vite build`. This file's `<script type="module" src="/src/main.ts">` is what dev mode actually serves; the production build rewrites it entirely (see `vite.config.ts`'s `inlineModuleLoader` plugin, also in "Build Guards & Asset Policy").

## Phaser 4 Skills

Official Phaser 4 skills are in `.claude/skills/` (28 skills covering every subsystem, pulled from
the `skills` folder of the [phaserjs/phaser](https://github.com/phaserjs/phaser) repo). Claude Code
auto-discovers them each session and should consult the relevant one before writing Phaser code —
no manual setup needed. To force a specific one, invoke it like a slash command, e.g.
`/scenes how do I pause the Game scene?` or `/audio-and-sound add background music to MainMenu`.

Key ones for this project: `scale-and-responsive` (portrait/landscape UI),
`input-keyboard-mouse-touch` (PC+mobile controls), `audio-and-sound`,
`scenes`, `loading-assets`, `v4-new-features`.

All 28: `actions-and-utilities`, `animations`, `audio-and-sound`, `cameras`, `curves-and-paths`,
`data-manager`, `events-system`, `filters-and-postfx`, `game-object-components`,
`game-setup-and-config`, `geometry-and-math`, `graphics-and-shapes`, `groups-and-containers`,
`input-keyboard-mouse-touch`, `loading-assets`, `particles`, `physics-arcade`, `physics-matter`,
`render-textures`, `scale-and-responsive`, `scenes`, `sprites-and-images`, `text-and-bitmaptext`,
`tilemaps`, `time-and-timers`, `tweens`, `v3-to-v4-migration`, `v4-new-features`.

To refresh from upstream: `git clone --depth 1 --filter=blob:none --sparse
https://github.com/phaserjs/phaser.git /tmp/phaser-skills && git -C /tmp/phaser-skills
sparse-checkout set skills && cp -r /tmp/phaser-skills/skills/* .claude/skills/`

See PLAYABLES-SDK.md for the full YouTube Playables SDK reference — consult it for all ytgame integration work.

## YouTube Playables Wrapper

`src/platform/yt.ts` is the only module allowed to touch the `ytgame` global — everything else
(scenes, future save/audio/ads code) imports primitives from it. Key behavior:

- `firstFrameReady()` (called from `Boot`) and `gameReady()` (called from `MainMenu.create()`) enforce
  their required call order internally: if `gameReady()` fires first (happens whenever `Preloader` has
  no real assets to load, since the whole Boot→Preloader→MainMenu chain then runs synchronously in one
  tick, before the first `POST_RENDER`), it's queued and only actually sent once `firstFrameReady()` has
  fired. Don't "fix" an apparent bad log order here without checking this queuing logic first.
- `waitForPlatformReady()` in `main.ts` (before `new Phaser.Game(...)`) races the SDK's readiness against
  a `2500ms` timeout, falling back to non-Playables mode with a `console.warn` instead of hanging forever.
  This only guards *after* JS starts running — if the SDK `<script>` tag in `index.html` (a parser-blocking
  classic script, required by the certification docs) stalls on the network before that, no JS-side
  timeout can help; this is a known, accepted limitation shared by the official
  `phaserjs/template-youtube-playables` reference, not something introduced here.

- **`isPlatformPaused()` means "some source in the platform-pause *class* is currently active," not
  specifically "YouTube itself paused the game."** It reflects whether `YTEvents.PAUSE` has fired without a
  matching `YTEvents.RESUME` yet, tracked by listening on `game.events` itself inside `bindPlatformEvents()`
  (registered unconditionally, even with no real SDK) rather than inside the raw `sdk.system.onPause`
  callback — so it stays correct under manually-emitted test events too. `adGate.ts` deliberately emits the
  same `YTEvents.PAUSE`/`RESUME` for ad display (see "Ad Gate"), so **while an ad is showing,
  `isPlatformPaused()` reads `true` too** — any code that reads this flag and assumes it means
  specifically "backgrounded in YouTube" will be misled during an ad. Used by `Settings.close()` (see
  "Audio Layer") to avoid resuming a scene out from under an active pause of either kind — which happens
  to be exactly the right behavior if Settings is somehow closed mid-ad (its resume correctly defers to
  the ad's own `RESUME`), but that correctness is incidental to `Settings.close()` predating `adGate.ts`,
  not something it was written to account for. Any *new* code with the same "is something else holding a
  pause on us" question should use this flag the same way; code that specifically needs to know "did
  YouTube itself pause us" (as opposed to an ad) doesn't have a way to ask that today.
- **`YTEvents.PAUSE`/`RESUME` actually freeze/unfreeze gameplay**, via `src/platform/lifecycle.ts`'s
  `bindGameplayPause(game)`. **Overlay-exclusion design, not a gameplay whitelist**: on `PAUSE`, it pauses
  *every currently active scene* (`game.scene.getScenes(true)`) except the ones listed in
  `OVERLAY_SCENES` (`'Settings'` and `'Shop'`) — not "pause `MainMenu`/`Game` specifically." This was
  originally a whitelist of exactly those two scene keys; inverted before the template freeze so a new
  gameplay scene added later is frozen by default without anyone needing to remember to register it —
  only new *overlay* scenes (menus/dialogs meant to stay interactive during a pause) need to be added to
  the exclusion list. A scene already paused because an overlay is open over it isn't in
  `getScenes(true)`'s result, so the loop correctly no-ops on it (nothing to do, already frozen). On
  `RESUME`, `scene.resume()` on whatever it paused, *unless* any `OVERLAY_SCENES` member is currently
  active, in which case that overlay's own `close()` owns the resume instead (its own
  `isPlatformPaused()` check already handles that correctly — untouched by this module; this check reads
  the `OVERLAY_SCENES` set itself, not one hardcoded scene key, so `Shop` needed no separate carve-out
  here beyond joining the set). Every `OVERLAY_SCENES` member is deliberately never paused this way: its
  Close button must stay clickable during a platform pause for that same deferred-resume path to ever
  run. Before this existed, `audio.ts` muted sound and `store.ts` flushed the save on `PAUSE`, but nothing
  ever called `scene.pause()` — `Game`'s `update()` loop kept running underneath a "paused" game the
  whole time. See "Known Issues Fixed".
- `sendScore(value)` rounds to the nearest integer before sending — the SDK rejects non-integer scores,
  and gameplay code (combo multipliers, etc.) can easily produce a float.
- **Localization**: `getLanguage()` feeds `i18n/strings.ts`'s `initLocale()` (called from `main.ts`,
  before `new Phaser.Game(...)`) — see "Localization" below. `index.html` is still `<html lang="en">`
  (a static attribute, unrelated to in-game `t()` string resolution) and `MainMenu`'s own start text is
  still a hardcoded English literal, not yet ported to `t()` — the localization *framework* is template
  scaffolding, wiring actual scene strings through it is a per-game task.

**Known testing gap:** verification so far is dev-mode only (Playwright against `npm run dev`, where
`ytgame` is either absent or loaded with `IN_PLAYABLES_ENV: false` — i.e. wrapper stub paths only). The
real Playables call ordering (signed-in/signed-out saves, ad flows, audio mute) is unverified. Run the
official Test Suite (https://developers.google.com/youtube/gaming/playables/test_suite, pointed at
`npm run dev`'s `http://localhost:8080`) right after the save/audio chunks land — not at the end — since
that's where signed-in/signed-out and mute-state edge cases are most likely to surface.

## Health Monitoring

`src/platform/health.ts`'s `initHealthMonitoring()` (called once from `main.ts`, **before**
`new Phaser.Game(...)` — so a synchronous throw during game construction itself is still caught) wires
`window.onerror`/`onunhandledrejection` into a local recorder:

- **Dedup by signature** (`message` + first stack *frame*, not literally the first line of `.stack` — for
  a standard V8 `Error`, that first line is just `"${name}: ${message}"`, which duplicates `message` and
  would give the signature no more discriminating power than `message` alone; the first real `"at ..."`
  frame is what actually distinguishes two errors that share a message but were thrown from different call
  sites). Each unique signature calls `logError()` **once per session**, not once per occurrence — the
  platform's health API is rate-limited, and a cascade of the same error firing every frame (e.g. from
  inside a scene's `update()`) must not burn through that budget reporting the same bug dozens of times.
- **Local ring buffer** of the last 20 errors (`getRecentErrors()`, read-only snapshot) for the dev console
  and future tests. Nothing here is ever sent anywhere except the single `logError()` ping per unique
  signature — Playables is an offline-only environment (its CSP blocks external network calls), so there's
  nowhere to send a detailed error payload even if this module wanted to.

## Ad Gate

**Rule: game code calls only `src/platform/adGate.ts`'s `showInterstitial(game)` /
`showRewarded(game, rewardId)` — never `yt.ts`'s `requestInterstitialAd()`/`requestRewardedAd()` directly.**
`adGate.ts` pauses gameplay for the ad's duration by emitting the *same* `YTEvents.PAUSE`/`RESUME` that a
real platform pause uses, rather than pausing scenes/muting audio/flushing the save itself — those already
happen via `lifecycle.ts`, `audio.ts`, and `store.ts`'s existing listeners on that channel, so calling
`requestInterstitialAd()` directly would show an ad with the game still fully running underneath it.

- The `RESUME` emit happens in a `finally`, so it runs regardless of whether the ad request
  resolved, rejected, or the SDK call threw — gameplay never stays stuck paused because an ad
  failed. `showRewarded()` returns the SDK's boolean (reward earned or not) unmodified; `adGate`
  only wraps the pause/resume lifecycle around the call, it never inspects the result.
- **Arbitration with a real platform pause arriving mid-ad** doesn't work the same way as
  `Settings.close()`'s `isPlatformPaused()` check, and deliberately isn't implemented that way:
  `adGate`'s own `PAUSE` emit right before requesting the ad already makes `isPlatformPaused()` read
  `true`, so checking it again in `finally` would *always* be true regardless of whether anything real
  happened, and gameplay would never resume after an ad. Instead, `adGate` snapshots
  `isPlatformPaused()` *before* its own emit (catches the ad being requested while already
  platform-paused) and separately watches for any *additional* `PAUSE` after its own (registered only
  after its emit completes, so it can't catch its own) — that can only be the real SDK relay from
  `bindPlatformEvents()`. If either is true when the ad settles, `adGate` skips its own `RESUME`: the
  platform is still genuinely suspended, and the eventual real `RESUME` will unfreeze things correctly
  via the same listeners everything else already uses. See the `isPlatformPaused()` bullet in "YouTube
  Playables Wrapper" for the broader consequence of sharing this channel: while an ad is showing, that
  flag reads `true` for *any* code checking it, not just `adGate`'s own logic.
- **The "extra PAUSE" listener is always unsubscribed** (`game.events.off(YTEvents.PAUSE, onExtraPause)`,
  unconditionally, first thing in `finally`, before the resume decision) — verified with 10 consecutive
  `showInterstitial()` calls leaving `game.events.listenerCount(YTEvents.PAUSE)` unchanged. Skipping this
  would leak one listener per ad shown, the same class of bug the `keydown-*` listener leak in
  `src/platform/input.ts` would have been without `bindAction`'s `SHUTDOWN`/`DESTROY` cleanup (see "Input
  Actions") — anything that does `game.events.on(...)` for a *temporary* purpose has to explicitly
  `.off()` it somewhere, since nothing does that automatically.

## Responsive Layout

The game uses `Phaser.Scale.RESIZE` (`src/config.ts`) so the canvas always fills its parent 1:1 at
whatever size the browser window is — from 9:16 portrait to 16:9 landscape and everything between —
instead of letterboxing the whole page to a fixed aspect ratio.

- **Rule: a new UI object's position is set in `layout()`, never via `setPosition`/coordinates in
  `create()`.** Any scene with on-screen UI creates its game objects once in `create()` (position
  doesn't matter yet — `add.text(0, 0, ...)`, not a real coordinate) and defines a
  `layout(width: number, height: number): void` method that does *all* positioning, sizing, and
  hit-area recalculation via `src/ui/anchors.ts` helpers (`anchorTopLeft`/`TopCenter`/`TopRight`/
  `CenterLeft`/`Center`/`CenterRight`/`BottomLeft`/`BottomCenter`/`BottomRight`). Each anchor helper
  reads the object's *current* viewport off `obj.scene.scale` itself, so `anchorTopRight(gearButton,
  20, 20)` stays correct after any resize without the caller re-deriving width/height. `MainMenu`,
  `Game`, and `Settings` all follow this pattern. **Why this matters more than it looks**: a
  positioning bug confined to `layout()` is invisible until the *next* resize/orientation change —
  it won't show up on first load if `create()` happened to leave things in a plausible spot. Two bugs
  of exactly this shape were caught only by testing an actual resize, not just initial render (below).
- `src/ui/layout.ts`'s `bindLayout(scene, layout)` calls `layout()` once immediately (using the
  scene's current scale) and again on every `Phaser.Scale.Events.RESIZE`, unbinding on scene
  `SHUTDOWN`/`DESTROY` so a stopped scene doesn't keep reacting.
- A full-bleed element (e.g. `Settings`'s dimming backdrop) isn't "anchored" in the corner/center
  sense — it's sized directly from `layout()`'s `width`/`height` params (`setSize(width, height)`),
  since it's meant to track the viewport exactly, not sit at a fixed offset from an edge.
- **Gotcha #1: `setInteractive()` on a 0x0 object silently creates no `.input` at all.** Phaser's
  default hit-area derivation (`setHitAreaFromTexture`) reads the object's current `width`/`height` and
  explicitly skips creating `.input` if either is `0` — so `rect(0,0,0,0).setInteractive()` (as `Settings`'s
  backdrop was, before `layout()` gives it a real size) leaves `.input === null`, not an `.input` with a
  zero-size hit area. `Settings` doesn't call `setInteractive()` on the backdrop in `create()` at all;
  `layout()` calls it there for the first time, once `setSize(width, height)` has already run.
- **Gotcha #2: resizing an already-interactive object does not resize its hit area.** Per Phaser's own
  `GameObject.setInteractive()` docs, calling `setInteractive()` again on an object that already has
  `.input` just re-enables it — it does **not** recompute the hit area from the object's new size.
  `setSize()`/`setFontSize()` on an already-interactive object silently leaves clicks testing against the
  *old* geometry. Fix: mutate `obj.input.hitArea` (a `Phaser.Geom.Rectangle` by default) directly via
  `.setTo(x, y, w, h)` inside `layout()`. Put together, both gotchas mean every interactive, resizable
  object's `layout()` needs an `if (!obj.input) { obj.setInteractive(...) } else { hitArea.setTo(...) }`
  branch — `Settings.layout()` does this inline for the backdrop, and `src/ui/uiScale.ts`'s
  `ensureMinHitArea()` does it for buttons/toggles (see below), which never hit gotcha #1 since text
  objects have nonzero size from the moment they're created.
- **Narrow-screen UI scale**: `src/ui/uiScale.ts`'s `uiScale(width)` returns a multiplier — `1` at/above
  a 400px-wide reference, floored at `0.8` below it — applied to font sizes (`setFontSize(BASE * uiScale(width))`)
  so text/buttons shrink gracefully instead of overflowing a narrow portrait screen, but never collapse
  below a readable floor. `ensureMinHitArea(obj, minSize = 44)` then pads that (possibly shrunk) object's
  hit area back out to at least 44 CSS px square, centered on its bounds — the visible glyph can be
  smaller than 44px, but the tap target never is. Call it every `layout()`, not just once — it internally
  branches on whether `.input` exists yet (create vs. resize) to work around the hit-area gotcha above.
- **Game field vs. UI — two-camera split.** `Game` renders both a fixed-logical-resolution game world
  and screen-space UI (currently just the gear button) in the same scene, which need opposite behavior
  under resize: UI must ignore zoom/pan, world content must not. `Game` splits this across two cameras:
  `cameras.main` is zoomed/`centerOn`-ed on a fixed logical resolution (`LOGICAL_WIDTH x LOGICAL_HEIGHT`,
  currently `960x540` — a placeholder until real gameplay picks a real value) every `layout()`, using
  `zoom = min(width / LOGICAL_WIDTH, height / LOGICAL_HEIGHT)` so the whole logical area always fits
  without cropping (letterboxed on whichever axis has slack). A second `uiCamera` (`this.cameras.add(...)`,
  resized to the full viewport every `layout()`, zoom always `1`) renders UI at an identity screen-pixel
  mapping regardless of what the world camera is doing. `cameras.main.ignore(gearButton)` (set once, in
  `create()`) keeps the world camera from also drawing the UI at the wrong zoom/position. **Contract for
  future gameplay**: game objects live in logical coordinates (`0..LOGICAL_WIDTH`, `0..LOGICAL_HEIGHT`) —
  screen/pixel coordinates are never valid for them. Any new UI/HUD object must be added to `uiCamera`'s
  default render set and excluded from `cameras.main` (mirror the `ignore()` call above); any new world
  object is the reverse — left on `cameras.main` and excluded from `uiCamera` once `uiCamera` stops being
  empty of world content. `Game.layout()`'s zoom/`centerOn` block is currently unexercised (no real
  gameplay content yet) but is the required scaffold for whenever that content is added — don't recompute
  this from scratch, and don't skip it because the scene "looks empty."
- **⚠ `RailScene` deliberately does NOT follow the fixed-logical-resolution half of that contract.**
  The `960x540` above was flagged as "a placeholder until real gameplay picks a real value"; the value
  this game picked is *no fixed logical resolution at all*. `RailScene` leaves `cameras.main.zoom` at
  `1` and never calls `centerOn` — the road's own perspective projection reads the real
  `this.scale.width/height` and places the vanishing point at the exact centre of whatever viewport it
  is handed. Two reasons: a perspective projection already *is* a camera, so a second camera's zoom
  scales the rendered image rather than the field of view; and letterboxing a 16:9 logical box into a
  9:16 portrait viewport would add black bars and strand the horizon inside the letterbox instead of on
  the screen. **The two-camera split itself is kept exactly as above** — `uiCamera` is created up front
  (empty until the HUD lands in chunk 7) and every world object is `uiCamera.ignore(...)`-ed. Do not
  "restore" the zoom/`centerOn` block in `RailScene` by pattern-matching against `Game.ts`; the omission
  is the design. Verified at 1920x1080, 390x844 and 844x390, and across live resizes between them.
- `Boot` is not on this pattern — it has no visual content. `Preloader` **is** on it (fixed
  after initially shipping without it — a fixed 468px-wide bar overflowed a 390px viewport,
  the one scene a certification reviewer is guaranteed to see): `layout()` clamps the bar to
  `min(468, width - 80)` so it never touches the screen edges, called from `bindLayout()`
  inside `init()` rather than `create()` — `preload()`'s `'progress'` events fire between
  `init()` and `create()`, so the bar has to exist and already be laid out before that, not
  after. The fill bar uses origin `(0, 0.5)` (not the default `0.5, 0.5`) so growing its
  `.width` extends rightward from a fixed left edge instead of symmetrically from a center
  point — the pre-fix version had the same fixed-position "grow from center" issue.

## UI Kit

`src/ui/theme.ts` is a themeable, palette-driven widget kit shared by every scene — buttons, rows,
badges, panels, progress bars, and full-bleed backgrounds all built from one visual language (a dark
fill, a crisp colored stroke, and — where noted — two wider/fainter strokes standing in for a glow, no
shader/Bloom postFX pass, so it works identically under the Canvas fallback). `Settings.ts` is the
reference consumer — read it alongside this section for the intended call pattern.

- **Theming**: `getTheme()`/`setTheme(overrides)` hold one module-level `ThemeConfig` — `colors: {
  primary, secondary, accent, backgroundTop, backgroundBottom, surface }` plus a canonical `radius`.
  `DEFAULT_THEME` ships with a usable neon palette so the template looks intentional out of the box, but
  nothing in `theme.ts` hardcodes those hex values into a function body — every factory either takes
  `color` as a required/optional param or falls back to a `getTheme().colors.*` read at *creation* time
  (not reactively — a widget already on screen won't retint if the theme changes later). A new game
  reskins the whole kit with one `setTheme({ colors: { primary: 0x..., ... } })` call, ideally in
  `main.ts` before any scene creates its first widget. `accent` is a convention, not an enforced rule:
  it's the palette slot meant for reward/currency iconography (`valueBadge()` defaults to it) — reusing
  it for plain UI chrome makes "does this color mean something" ambiguous everywhere else it's used.
- **Widgets** (`src/ui/theme.ts`): `neonButton(scene, text, color, fontSize?, options?)` — the base
  button, auto-sized to its label (read `.width`/`.height` off the returned `NeonButton` for the
  current solid-core footprint, e.g. to size a backdrop panel around it — these track any later
  `setText()`/`setFontSize()`/`setMinWidth()` call, they're not a one-time snapshot).
  `NeonButtonOptions.muted`/`.hoverColor` cover a secondary/de-emphasized variant and a "brightens on
  engage" variant respectively; `.noGlow` keeps the border at full alpha but drops just the glow halo
  (for sitting flush in a shared-height row next to non-glowing neighbors, where `muted`'s dimmer
  border would look wrong); `.gradientFill` (`{ top, bottom }`) swaps the usual flat-fill-plus-stroke
  for a top-to-bottom color fill plus a thin white rim, for the one loudest CTA on a screen that should
  read as filled/solid rather than outlined; `.textShadow` adds a drop-shadow behind the label, mainly
  useful paired with `.gradientFill` (a busy gradient can wash out a plain white label); `.fontFamily`
  overrides the label font (defaults to plain Arial like every other widget here) for a button that
  should use the game's own display font (`ui/font.ts`). `setMinWidth(width)` grows the button's core
  box past its own label-driven auto-size (never shrinks below it) — for a button that must visibly
  read as wider than some other element measured only at `layout()` time. `rowButton(scene, leftLabel, resultLabel,
  accentLabel, columns, initialColor, fontSize?)` — a full-width tappable row (list/settings-row shape),
  its three text columns positioned as **fractions of the row's own width** (`RowColumns`, a 4-tuple —
  column 2 is reserved, unrendered, for a caller's own object) so every row built from the same columns
  array lines up regardless of content length. `pillBadge(scene, icon, earned, max, color, fontSize?,
  suffix?)` — a compact `[icon current/max]` stat chip. `valueBadge(scene, icon, value, color?,
  fontSize?)` — a simpler `[icon value]` readout (a generalization of a "stars/currency total" badge —
  no earned/max distinction), defaults to `getTheme().colors.accent`. `roundedPanel(scene)` /
  `neonProgressBar(scene)` — stateless drawing helpers (`.draw(x, y, w, h, ...)` every call, no owned
  position) for modal panels and thin progress bars. `circleBackButton(scene, color?, size?)` — the
  circular back affordance; its `'←'` glyph carries a small measured offset
  (`ARROW_OFFSET_X/Y_FRACTION`) to correct for the glyph's own ink not being centered in its font
  metrics box — re-derive this by pixel-mass centroid, not by eye, if it's ever revisited.
  `neonText(scene, text, color, fontSize, originX?, originY?)` — a glow-halo header/title text (uses
  `ui/font.ts`'s `getDisplayFontStack()`) with a one-shot `.pulse()`. `createSceneBackground(scene,
  textureKey, gradientTop?, gradientBottom?, tint?)` — texture-if-loaded-else-gradient full-bleed
  background, "cover" fit. `scanlineOverlay(scene)` — an optional static (not shader) CRT-scanline
  texture tile; skip it entirely for a non-retro aesthetic. `toCssColor(color)` — `0xRRGGBB` ->
  `'#rrggbb'`, for `Text` styles.
- **The recurring Container-hit-area gotcha**: every interactive widget above (`neonButton`, `rowButton`,
  `circleBackButton`) hits the same non-obvious Phaser fact and fixes it the same way — `Container`'s
  `originX/Y` are hardcoded to `0.5`, so `container.setSize(w, h)` shifts `displayOriginX/Y` to `(w/2,
  h/2)`, and `pointWithinHitArea` unconditionally adds that offset to the local hit-test point before
  calling `hitAreaCallback`. A hitArea built in the natural `(-halfW..halfW)` frame therefore tests
  against a point already shifted by `(+halfW, +halfH)` — center clicks work by accident, only off-center
  taps expose it. Fix (see any of the three widgets' own `redraw()`): build the hitArea starting near
  `(0, 0)` instead of `(-halfW, -halfH)`. Any *new* interactive `Container`-based widget added to this
  file needs the same correction — it is not a one-off bug, it's a property of `Container` hit-testing
  itself.
- **Layout helpers** (`src/ui/anchors.ts`, `layout.ts`, `uiScale.ts`) are unchanged from the template's
  original responsive-layout system — see "Responsive Layout" above; the widget kit is built on top of
  them, not a replacement for them.
- **`src/ui/preview.ts`** — `makePreview(scene, imageKey, width, height, fit?)` /
  `setPreviewTexture(image, imageKey)` / `applyPreviewFit(image, width, height, fit?)`: whole-image
  contain/cover-fit preview helpers. Always pass through these (never a raw `add.image()`/`setTexture()`
  with no frame argument) for a whole-picture preview — they explicitly use Phaser's own `'__BASE'` frame
  name, which becomes load-bearing the moment a texture ever gets custom frames added to it elsewhere
  (a sprite-sheet slicer that repoints `firstFrame`, for instance) — a preview with no explicit frame
  after that silently renders a fragment, not the whole image. `'cover'` fit uses `Image.setCrop()`
  rather than a mask (this Phaser build errors on masking an `Image` directly under WebGL), with the crop
  origin always `(0, 0)` — a real Phaser rendering bug misplaces the visible region for a non-zero crop
  offset.
- **`src/ui/font.ts`** — `initDisplayFont({ family, url, weight? })` loads a font via the browser
  `FontFace` API (not a CDN `<link>`, which an offline-CSP platform like Playables would block) and makes
  `getDisplayFontStack()` return it from then on; `neonText()` reads that getter internally. **Ships with
  no font baked in** — `getDisplayFontStack()` defaults to a plain system-sans stack until a game calls
  `initDisplayFont()` with its own choice (font file under `public/assets/fonts/...`). Must be awaited
  before `new Phaser.Game(...)`, same timing reason as `initLocale()` — a Canvas/WebGL `Text` object does
  not retroactively repaint when a web font finishes loading async after it already drew with a fallback
  face.
- **`src/ui/format.ts`** / **`src/ui/fit.ts`** — trivial generic helpers with no theme/game coupling:
  `formatTime(elapsedSec)` (`"M:SS"`), `titleCase(id)` (`'retro-tech'` -> `'Retro Tech'`),
  `fitContain(sourceW, sourceH, maxW, maxH)` (largest non-distorting fit inside a box — `preview.ts`'s
  own `'contain'` branch is built on this).

## The Run

`src/run/runState.ts` is the whole run as a value: where it is, how fast, how far, how much left.
`RunScene` holds one and replaces it every frame; every rule that changes it is a pure function in
this module, which is what makes `npm run verify:run-speed` able to test the game without a browser.

- **`z` versus `distance` is the distinction the module exists to hold.** They advance by the same
  amount every tick and are not the same number: `z` is a position on the closed circuit and wraps,
  `distance` is how far the run has come and never does. `distance` is the score, and it is what the
  difficulty curve reads. The rail shooter had no equivalent of the second — it scored kills, and
  its lap was scenery.
- **Speed is a saturating chase towards a ceiling, not a ramp**: `v += (cap - v) * SPEED_ACCEL * dt`,
  which closes 63% of the remaining gap in `1 / SPEED_ACCEL` = 5.9s and asymptotes. Constant
  acceleration would either pin the run at the ceiling or never reach it, depending on how long the
  run happened to last. The same curve runs in *both* directions, which is what makes the boost's
  expiry work with no second code path.
- **The boost is state ticked down inside the fixed step, not a `Date.now()` deadline.** A wall-clock
  deadline expires while a backgrounded tab draws nothing, and gives a 144Hz phone a different number
  of boosted frames than a 60Hz one.
- **⚠ The grace period after a hit is measured in world units, not milliseconds.** It was 900ms,
  and a duration is the wrong unit for something the road is laid out against: rows sit at least
  `REACTION_MS` apart *at top speed*, so a fixed number of seconds covers a different number of
  rows depending on how fast the run is going.

  ```
  speed          travelled in 900ms   rows skipped
  SPEED_BASE            6.5 segments          0.50
  SPEED_CAP            16.2 segments          1.25   <- the next row passes through you
  boosted              25.9 segments          2.00   <- two of them do
  ```

  Reported as "some obstacles do not deal damage", and from the outside that is exactly what it
  was. `HIT_INVULNERABLE_Z` is 55% of the tightest row gap, so it always ends before the next row
  arrives at every speed the game can reach — `verify:obstacles` asserts that against the placer's
  own floor. What it is *for* is the rest of the row you just hit: a wall is eight rocks, and being
  charged eight times for one mistake is not a difficulty setting.
- **⚠ And grace the player cannot see is indistinguishable from a broken hitbox.** The snail looked
  identical whether it could be hit or not, which is half of why the above read as a bug rather
  than as mercy. It now blinks (`PlayerView`, 110ms, down to alpha 0.35 and never to zero — it is
  the thing being steered), and the shadow blinks with it so the pair does not read as the sprite
  failing to draw.
- **A hit costs speed *and* a life, in that order**, and a shield is spent instead of the life but
  never instead of the speed. That is the economy: the reward for playing well and the punishment for
  playing badly are denominated in the same unit, so a run is one currency rather than a score with a
  health bar bolted to it. A shield that absorbed everything would be the only pickup worth having.
- **`RunScene` tells the world where the camera *is*, never how fast to go.** `WorldView.advance`
  integrates a speed of its own — right for the menu, which rides on a script — and letting it do so
  here would give two answers to "how far have we come", with the score reading one and the road
  drawing the other. `setSpeed(0)` plus a direct `cameraZ` write; `advance` is still called with the
  real delta because it also eases the camera's lean, which is dt-corrected.

## The Snail

`src/run/playerMotion.ts` is `rail/shipMotion.ts` with its state space replaced and **nothing else**
— same spring, same `PLAYER_STIFFNESS`/`PLAYER_DAMPING` (the rail shooter's `SHIP_*` values, set
there by measuring a dodge against a telegraph), same `runFixedSteps`. See "The Fork" at the top of
this file for why the space had to change; what follows is what that bought.

- **A bend cannot drag the snail off the road.** `offsetX` is measured from the road's *own*
  projected centre, so on a curve — where that centre slides across the frame — a still finger keeps
  the snail on the same piece of asphalt. `verify:player` proves this against `billboardRectInto`
  (the road's centre moves 1147px across the frame; the snail stays exactly 508px from it) and
  separately asserts, structurally, that `stepPlayer` takes no track argument at all.
- **Two edges, not one.** `ROAD_EDGE` is where the asphalt runs out and `OFFROAD_LIMIT` is where the
  ground does; between them the snail is on the verge, which is passable and costs `OFFROAD_DRAG`.
  A single hard clamp reads as the input having stuck — the defect the rail shooter's `LANE_SOFT_BAND`
  existed to fix, solved here more cheaply because this boundary is a *world* fact.
- **The drawn footprint is derived from the collision box, never from the art.** `PLAYER_WIDTH` comes
  from `PLAYER_HALF_WIDTHS`; `PlayerView` divides it by `SPRITE_SCALE` to get the units
  `billboardRectInto` wants. The first version let the texture's pixel size decide and the two
  disagreed by 2.5x — a snail 720 units wide on screen against a 180-unit body, a pancake that got hit
  by things it visibly cleared.
- **Steering is an *absolute* axis**, which is why `platform/input.ts` grew a third binder.
  `bindAction` answers "did they tap"; `bindHeldAction` answers "are they holding left"; neither can
  answer "where is the finger", which is the only question a game whose player is dragged across a
  road actually asks. `bindSteering` does, from a pointer (absolute) or a keyboard virtual point
  (a rate), and reading `scene.input.activePointer` at the call site instead would be exactly the
  raw-input coupling that module exists to prevent.
- **⚠ Letting go holds the line; it does not return to the centre.** The rail shooter's ship coasted
  back to a rest point, which is right for a craft you fly and let go of, and `targetFor` inherited
  it — so releasing an arrow key, or moving a mouse without its button held, slid the snail back to
  the middle of the road and undid the dodge it had just been steered into. Reported as "it keeps
  pulling to the centre", and it was. An inactive input now targets the snail's *current* offset, so
  the spring force is zero and only the damping is left: it coasts to a stop where it is.
- **⚠ A mouse steers by where it is; a finger steers by where it is pressed.** `bindSteering`
  originally required `pointer.isDown` for both, which is a touch-first rule ported carelessly to a
  desktop — the player moved the mouse and nothing happened. There is nothing else on this screen a
  mouse could be doing, so hovering *is* the input; a touch pointer has no hover state, which is why
  the two cannot share a rule (`pointer.wasTouch` is the branch). A mouse button coming up does not
  end steering either; leaving the canvas does, for both.

### Why the snail is projected differently from everything else

**`src/run/playerProjection.ts` exists because the snail is the one object not attached to the
ground it is over**, and getting that wrong strobed it.

A tree stands at a segment's near edge, so `Segment.s1` *is* its ground point and `RoadSprites` can
read it directly. The snail holds a fixed `PLAYER_Z` ahead of the camera: its true distance never
changes at all, but the segment beneath it changes every `SEGMENT_LENGTH`. Read off `s1`, its
projected scale therefore reports the distance to that segment's *near edge*, which sweeps a whole
segment's worth and snaps back — **an 11.3% jump in size and screen row, 7 times a second at
`SPEED_BASE` and 18 at `SPEED_CAP`.**

Reported as the snail juddering when moving sideways. It was juddering when running straight too;
sideways motion is simply where the eye could catch it.

The fix is to interpolate between the segment's two edges by how far into it the snail actually is.
`s2` of one segment is `s1` of the next, so the value is continuous across a boundary, and both
edges already carry the curvature and hill offsets the mesh integrated this frame — which is why
this reads them rather than projecting a point of its own. Measured, before and after:

```
near-edge read:  11.2% swing, 10.4% in a single frame
interpolated:     0.3% swing,  0.09% in a single frame
```

`verify:player` holds both halves — the negative control has to keep failing, or the check has
stopped measuring anything. **Anything else that is ever given a fixed `z` relative to the camera
needs the same treatment**; anything that stands on the road does not.

## The Jump

The vertical shares `playerMotion.ts`'s module *and its tick*, and that is not tidiness: two
integrators would each carry their own remainder, so the same wall-clock delta could run three
lateral ticks and two vertical ones — and "was I over the log when I crossed it" is a question about
both axes at one instant.

- **The arc is solved, never tuned.** `JUMP_AIR_MS` is assigned first; `JUMP_GRAVITY = 8h/T^2` and
  `JUMP_LAUNCH_V = gT/2` follow. Tuning `g` by hand is how an arc drifts away from the air time the
  obstacle bands were laid out against.
- **⚠ The position step must be the exact integral over the tick**, `y += v*dt - g*dt^2/2`, not
  `y += v*dt` after updating `v`. The naive form drops that second term every tick: measured against
  the shipped constants it peaked at **303 units instead of 320**, 5.3% low — enough to stop clearing
  an obstacle the arc was solved to clear. `verify:jump` caught it on its first run and holds the apex
  to 1%. Same lesson `ui/scrollMomentum.ts` records for its own decaying velocity.
- **No double jump and no hold-to-go-higher.** The three-band obstacle model is an assertion about
  where a *fixed* apex sits; a negotiable arc turns "can I clear this" into a question with no stable
  answer.
- **The shadow is part of the mechanic, not polish.** On a pseudo-3D road there is no other height
  cue — a snail at `y = 300` and one standing on a rise both draw higher up the frame. The ellipse
  stays on the ground at the snail's own `offsetX` and **shrinks without fading**, which is the
  load-bearing half: the first version scaled size *and* alpha, the two multiplied, and at the apex it
  was 41px wide at alpha 0.18 on grey asphalt — invisible at exactly the moment its whole job is to
  say how high you are. Found by looking at the frame.
- **`squash.ts` is the entire animation system**: one volume-preserving scalar. A snail has no legs
  and no gait, so effort is expressed by deforming one blob — which is a large part of why the mascot
  is a snail at all. Chunk 7's slide cycle sits *underneath* this, not instead of it.
- Landing costs `LANDING_HITSTOP_MS` of **per-entity** hitstop on the snail (`run/hitstop.ts`,
  inherited whole). Never `timeScale`, never a global pause: the road has to keep scrolling through a
  landing, or the moment reads as a dropped frame rather than as weight.

## Obstacles

`src/run/obstacles.ts` is the model, `ObstacleSprites.ts` the pool — exactly the split `rail/enemy.ts`
and `rail/Enemies.ts` had, and for the same reason: the model runs under Node.

- **One rule.** A hit is two interval overlaps, across the road and up the body. `Obstacle.kind`
  exists for *art* and for the placer's ratios, and the collision never reads it —
  `verify:obstacles` proves that by hand-editing a branch's band and checking it behaves as the band
  says rather than as the name does. The obvious design is a `jumpable: boolean`, and it fails on the
  third class: an overhead is not "unjumpable", it is *hit by jumping*, which a boolean cannot say.
- **A layout is proved passable before it ships.** `passableLine` scans 81 samples across the road,
  on the ground first and then at the apex; `provePassable` adds the constraint a per-row check
  cannot see — a jump-only row commits the snail to the air for up to `FLIGHT_LENGTH_Z`, so
  everything inside that flight has to be clearable *from the air* too. A row that fails is redrawn
  up to `ROW_ATTEMPTS` times and then dropped. Generate-and-check, the same shape a puzzle generator
  uses; a runner that occasionally deals an impossible hand teaches the player that deaths are not
  their fault, which is the one thing an endless game cannot afford.
- **Collisions are swept, not sampled.** At top speed a frame covers 60 units against a 200-deep
  obstacle, so a point test works right up until the frame a phone drops. Resolution is keyed by
  `(id, lap)` because the track loops — a boolean would disarm every obstacle after one lap.
- **⚠ An obstacle stays live for the whole crossing, not just the frame contact begins.** The first
  version marked one resolved as soon as the sweep touched its near edge and never looked again —
  one instant, at the moment of contact. But 200 units is 55ms of crossing at the cap, and the snail
  can slide sideways into a rock during it. Measured by driving deliberately into 28 rows: **four
  registered nothing with the snail visibly inside them.** Being inside it at any point while
  passing is what the player sees, so that is what the test is; an obstacle is only marked resolved
  once the sweep is past its far edge.
- **⚠ The grace period after a hit is a distance, not a duration.** See "The Run".
- **⚠ `MAX_ATTAINABLE_SPEED`, not `SPEED_CAP`.** Both the row-spacing floor and the flight window are
  solved at the fastest the game can actually go, which is `SPEED_CAP * BOOST_FACTOR`. Solved at
  `SPEED_CAP` — as the first version was — the reaction budget silently fell to 281ms against a 450ms
  floor *during a boost*, i.e. at the one moment the player chose to feel fastest.
- **⚠ Row spacing jitter may only ever add distance.** Scaling the whole spacing by
  `0.85 + rng() * 0.3` reads as more natural and put two rows 6.9 segments apart against an
  8.1-segment floor. A floor a random multiplier can dip below is not a floor.
- **⚠ Walls are what make the jump a verb.** An ordinary row is three obstacles at most on a road
  seven of them wide, so the placer was quietly guaranteeing that dodging always worked — a scripted
  play-through covered 443 metres without leaving the ground once. `drawWall` lays `low` obstacles
  edge to edge with a third of a width of overlap (a wall with a hair-width seam is a wall the
  player finds once by accident and never again), built by construction rather than drawn and
  tested, because what makes it a wall is having *no* ground line. `verify:obstacles` measures the
  share of rows with no ground line from the placer's own output and holds it between 10% and 45%.
- **The bands were cut by looking at the frame.** The first set (`blocking` to 520, `overhead` to
  1200) satisfied every constraint and drew a road lined with grey slabs three to six times the
  snail's height — the game read as an industrial estate. What actually binds is only that `blocking`
  reaches above the apex and `overhead` starts above the snail's back and reaches above the apex plus
  its body. Everything past those was bulk, and bulk was costing the read.

## Draw Order

**There is no depth buffer in this renderer.** The whole thing is painter's-order — what is drawn
last is on top — and the only lever is `GameObject.depth`. `src/run/worldDepth.ts` is the single
scale everything standing in the world sorts on: distance from the camera in segments, negated,
plus a per-category tiebreak below 1.

**⚠ A depth set once in a constructor is the bug this exists to prevent.** `RoadSprites` has always
got it right — `setDepth(-distanceIndex)` every frame — but the obstacle and pickup pools each set
one flat number for every slot at construction. Equal depth falls back to display-list order, which
is pool-slot order, which the render loop fills **near to far**: so the farthest object was added
last and painted last, over everything nearer than it. Both pools used the *same* flat number too,
so a coin fifty segments out drew over a boulder about to arrive.

Measured in the running game before the fix: every obstacle at depth 999, the nearest (screen y 805)
at display-list index 134 and the farthest (y 576) at 147. Reported as the textures riding over each
other, and that is exactly what it was. After: −5.7 for the nearest, −195.7 for the farthest, depth
rising monotonically with nearness.

- **Every tiebreak in `WORLD_LAYER` is smaller than one segment**, which is what keeps distance in
  charge; the tiebreak only decides two things on the *same* segment, where the answer is genuinely
  arbitrary but must be stable or they flicker against each other as the pool reorders. The order
  encodes what should win: pickup over snail over obstacle over scenery.
- **The snail's distance index is 9.83, and it landing between two segments is the point.** An
  obstacle it has just passed is *nearer to the camera* and has to paint over it as it goes by; one
  still ahead must not. The old flat depth put the snail in front of both, so a boulder slid under
  it on the way past.
- **Obstacles and pickups now take the same distance haze the verge does.** They were the only
  things in the frame drawn at full contrast against faded scenery, which read as pasted on rather
  than as standing there. At the reaction distance that is a 4.3% fade — measured rather than
  assumed, because `REACTION_MS` is a floor and this is the one change that could quietly undercut
  it.
- `ATMOSPHERE_DEPTH` is the only flat depth left, and it is honest: motes hang between the camera
  and the whole world, so they are not sorting against anything.

**Anything new that draws in the world gets a `worldDepth` call, per object, per frame.** Anything
that draws on the *screen* (the HUD) is on `uiCamera` and does not enter this sort at all.

## Pickups

`src/run/pickups.ts`. **Three kinds — fruit, shield, coin — and the rail shooter's own docstring is
the argument for three.** That game cut its set twice, seven to five, on a rule about *meaning*: what
survived was what a player can predict from the icon. Of its final five, three have no equivalent
here (no guns, no multiplier) and two collapse into one once a hit costs speed rather than health.

**⚠ `boost` was deleted rather than kept alongside Fever, and the rule that deleted it is that same
one.** It raised the ceiling by 60% for three seconds; Fever raises it by 60% for six. Two products
that differ only in *how much of the same thing* they give are one product with a table to memorise,
and "a bit faster" against "a lot faster" is not a distinction anybody makes at speed. All of the
run's speed lives in the fruit now, and a fruit is not fast — it is **progress toward** fast, which
is a different sentence rather than a smaller number.

That also corrects something the old docstring got wrong. It argued against a fourth kind partly on
the grounds that a magnet would be "a number on a gauge the frame can only report as text" — true of
a magnet sold as a pickup of its own, and false of one that is part of what Fever *is*: the frame
reports it by visibly dragging every pickup on screen onto the snail's line.

**Fruit ships as four rendered PNGs under one kind** — grapes, banana, melon, pear — chosen by
`pickupTexture` from the pickup's own id, so a lap deals the same fruit twice and a screenshot is
reproducible. Four *kinds* would have put four rows in the weight table for one decision.

## Four Things From One Screenshot

All four came from a player pointing at frames, and three of them are the same lesson in different
clothes: **a rule this project already wrote down was applied in one place and not in the next.**

### ⚠ The scenery had no tiebreak, and the near tier made it visible

Reported as "the barriers across the road change which is in front and which is behind as we move".

They are not barriers. The grey slabs spanning the bottom of that frame are `DECOR_TIERS.near` —
scenery passing close to the camera at 1.9x scale — and `RoadSprites` set their depth with a bare
`-distanceIndex`. So **every prop on one segment tied**, and equal depth falls back to display-list
order, which is pool-slot order, which changes as the visible set changes. Measured in the running
game: a pair of `wet_cattail` both at depth **-29**, spanning most of the road between them.

That is the exact defect `worldDepth.ts` exists for, left unfixed in the one pool it never touched.
It went unnoticed while scenery was small things along the verge and became unmissable the moment
the near tier started drawing props two hundred pixels wide.

`sceneryDepth` gives each prop a sub-segment term from **`|offsetX|`**, and that is the physically
true answer rather than an arbitrary stable one: the camera rides the centreline, so of two props on
one segment the one further out really is further away. The list index only separates the mirror
case — two props the same distance either side — and is a hundredth of the lateral term, so it can
never overrule it.

### ⚠ Two thirds of every lap could not hit the player

Found while writing a fixture for something else, which is the only reason it was found at all.

`RunScene.resolvedOnLap` is keyed by obstacle id and marks an obstacle settled **for the lap** as
soon as the sweep passes it — correct, because the track is a ring and "already hit" cannot be a
boolean. But `placeRunObstacles` calls `placeObstacles` once per difficulty band and **every band
started its id counter at zero**. Two obstacles sharing an id are one obstacle as far as collision
is concerned: passing the first disarms the second before the player reaches it.

Measured on the shipped placer: **164 obstacles, 56 distinct ids, 108 of them — 66% of the lap —
could not hit the player at all.**

This is very likely most of what "some obstacles deal no damage" always was. An earlier round
attributed that report to the `overhead` class not touching a grounded snail, which is true, was
worth fixing, and is the smaller half. `verify:obstacles` now asserts a lap's ids are unique and
carries the per-band counter as its control: two bands sharing one collide on 30 ids.

### ⚠ Fever deleted the road instead of waiting for it

Reported as "things on the road disappear earlier than they should while flying under fruit".

The exit ordering cleared every obstacle inside `speed * (FEVER_EASE_MS + REACTION_MS)` — **8352
units, 42 segments** — so the guard could come off onto empty road. The budget it bought was real
(1031ms against a 450ms floor). What it cost was that the road is drawn **300** segments ahead, so
the whole window was in view and the player watched rocks vanish in front of them. It also broke,
flatly, the rule `lapLayout.ts` states without qualification: nothing already on screen is ever
rewritten.

The guard **waits** now. A fourth phase, `holding`, keeps it up after the ease until the nearest
obstacle is more than `REACTION_MS * FEVER_CLEAR_MARGIN` away, with `FEVER_HOLD_MAX_MS` as a ceiling
so a stretch that never opens cannot leave the player invulnerable. Nothing is removed, and the
sentence the player can read off the screen is "the Fever held until the road opened", where "some
of the rocks went away" is not a sentence at all.

- Measured over the same 200 exits: **min 506ms, 5th percentile 549ms, median 1229ms**, against
  **13ms** for the same simulation with the hold taken out.
- **⚠ At `FEVER_CLEAR_MARGIN = 1` it measured 455ms against the 450ms floor** — one percent, which a
  single tick of granularity eats. A floor a rounding can dip below is not a floor, which is the
  lesson the row placer's own jitter already taught this project once.
- `Obstacle.cleared` is gone rather than left unset: dead state is worse than no state, and
  `verify:fever` asserts the field does not exist so it cannot come back quietly.

### The HUD says five things instead of three

Rebuilt against a reference the player supplied. What it is now:

| where | readout |
|---|---|
| top left | `SCORE: 12,450`, stroked rather than plated |
| under it | the distance, in metres and then kilometres |
| under that | lives, as pips |
| top right | the fruit gauge, drawn as a **leaf** |
| under it | coins |
| bottom left | `SPEED: 2.4x` on a rounded badge |

- **Score and distance are two numbers on purpose.** They used to be one — distance *was* the score
  — and they answer different questions: how far you got, and how much you were willing to leave
  your line for. `runScore` is metres plus what the pickups paid, so a player who takes nothing sees
  the two agree, which is the clearest possible statement of what the pickups are worth. The save
  and the result screen still keep their record on `distance`; nothing about the economy moved.
- **`RunState.bonus` is stored and the score is derived.** Distance is already an exact number the
  fixed step maintains, so a second accumulator for the same quantity would be a second thing that
  can drift from it. What cannot be derived is what the player picked up.
- **The speed is a multiple, not a number of units.** 5760 means nothing; `2.4x` is the same fact in
  the unit the player experiences, and it is what makes a Fever legible as a number as well as as a
  wash.
- **⚠ The leaf's fill is a truncated polygon, not a mask.** `setMask(geometryMask)` is a silent
  no-op under this renderer — it warns and returns without assigning `.mask` — which this codebase
  has now hit in four separate places. `ui/leafGauge.ts` returns the leaf *shortened*, and is pure
  so `verify:ui` can assert the gauge fills monotonically, is empty when empty (a hair of fill draws
  nothing rather than a hairline at the tip), and is **fattest in the middle** — below that the shape
  would read as nearly full long before it is, which is the wrong direction for a gauge to lie in.
- **One leaf rather than the two bars it replaces.** The gauge fills with fruit and empties as the
  Fever runs, and those are the same object at two moments; the pair of bars asked the player to
  read a colour to find out which question was being answered. The colour still changes, and it is
  confirmation now rather than the whole signal.
- **The badge's chrome is drawn in `update`, not in `layout`**, because its width follows its text
  and the text is not written until there is a run to read. Laying it out to a fixed width is how a
  badge ends up with its own label hanging off the end of it — which the first version did.

## ⚠ Nothing Already On Screen Is Ever Rewritten

**The rule, and it is a hard one: a segment's contents may be replaced only while that segment is
behind the camera.** Not at a convenient moment, not with a crossfade, not "usually" — the player is
looking at the road ahead and deciding what to do with it, and a decision that is invalidated after
it is taken reads as the game cheating.

`src/run/lapLayout.ts` (pure, `npm run verify:layout`).

### The defect, measured on the shipped placer

`RunScene.layLap` regenerated the entire lap on the frame the run wrapped — `placeRunObstacles`,
`placeRamps` and `placeFormations` all rebuilt, every segment bucket replaced at once. That is
correct about the *ground*: the renderer and the collision both index by segment, so a layout longer
than the lap would put two obstacles on one piece of road. It is completely wrong about the *moment*:

```
the lap                    1434 segments
drawn ahead of the camera   300 segments   = 21% of the lap
obstacles standing in that band, lap N       24
obstacle slots that change when lap N+1 lands 69
segments holding a row in BOTH laps            0
```

Not one segment holds a row in both laps, so the rows do not merely change shape — **they move**.
Reported as two things that are one thing: barriers appearing in view that the player then hits, and
walls whose blocks change on the fly while the wall stays.

**⚠ It reads as happening "at a biome seam", and the first explanation written here for that was
wrong.** This section claimed segment 0 is a biome boundary by construction. Measured, it is not:
the boundaries fall at 159, 318 … 1431, and both segment 1433 and segment 0 are biome 0 — the lap
seam sits *inside* a biome, exactly as `biomeRunSegments`' own note says it should.

What is true is sharper. 1434 does not divide by 9, so the last stretch is the **remainder: three
segments**, 1431–1433. The genuine biome change at 1431 and the lap seam at 0 are therefore
**167ms apart at `SPEED_CAP` and 104ms at `MAX_ATTAINABLE_SPEED`** — a tenth of a second, against 50
seconds between one wrap and the next. The player sees the ground change colour and the road ahead
rearrange as a single event, because for any purpose except a clock they are one.

### The fix is a delivery cursor, not a different generator

Generation is unchanged and still whole-lap: the row spacing, the passability proof and
`sideAwayFrom` all reason about a lap as a unit. What changed is when each segment takes delivery.

A cursor trails the camera by `HANDOVER_MARGIN` segments. Every segment it passes is given the
*next* lap's contents — one at a time, always just after the segment leaves view. By the time the
camera reaches the seam the road in front of it already holds the new lap, written a lap earlier and
out of sight, and **nothing changes at the wrap at all**.

- **`HANDOVER_MARGIN` is 2, and one is not enough.** The camera sits *inside* its own base segment,
  so that segment is half in view, and at `MAX_ATTAINABLE_SPEED` one frame covers about half a
  segment. Two is the first value that is behind the camera at every speed and every frame length.
- **The build moves but does not grow.** One `buildLap` per lap, as before; it now happens when the
  cursor enters a lap rather than when the camera wraps out of one.
- **The flat lists are gone.** `RunScene` held `obstacles`, `pickups` and `ramps` alongside the
  segment maps, and a rolling rewrite would have to keep four things in step. The maps are the only
  truth; `liveObstacles()`, `livePickups()` and `liveRamps()` gather on demand for the handful of
  callers that genuinely need everything (Fever's road-clearing, the magnet, the arc relay).
- **`arcRelaid` became a `WeakSet` of ramp objects.** Ids restart at zero every lap and there is no
  longer a lap boundary at which to clear a set of them, so keyed by id a stale entry would leave the
  next lap's arc laid for the previous lap's speed. Keyed by identity it clears itself.

### What the check asserts, and the control it carries

`verify:layout` drives a real run over three laps at `MAX_ATTAINABLE_SPEED` and again over one lap at
`SPEED_BASE`, against the real placers, and asserts that **no segment inside the 300-segment visible
band ever changes**: 4301 handovers across three laps, zero in view. It also asserts the delivery
arrives — after one lap, 1434 of 1434 segments hold the new lap — and that each segment is handed
over once rather than repeatedly.

**The negative control is the shipped placer itself**, not a fixture: the same 69-slot measurement
above runs as a check, so the suite is shown to be measuring something on every run.

Confirmed in the running game: driven across the lap seam twice at top speed over 4000 frames, 1408
segments handed over, **0 rewrites in view**, zero errors, 252 obstacles / 129 pickups / 7 ramps
live throughout.

### What this rule now covers, and what it does not

It covers everything the `LapLayout` owns — obstacles, pickups and ramps. It does **not** cover the
scenery: `decorateTrack` fills `Segment.sprites` once at track build and is never regenerated, so the
verge cannot change under the player and never could. And it does not cover a *theme* switch, which
deliberately replaces every texture at once — that is only reachable from the menu, where there is no
run to invalidate.

## Chains, Not Scatter

`src/run/formations.ts` (pure, `npm run verify:formations`). The placer used to draw one pickup
every `PICKUP_SPACING_Z` and roll its kind independently — a road with things on it, not a line the
player can see from a distance and decide to take. **A chain is a decision made once, at range, and
then held**, which is the same shape an obstacle row already had and for the same reason: what the
player reads ahead is what the game is about.

Three shapes: `line` (one lane, on the ground), `wave` (a sine across the road, 8–12 pickups a
period — the one that actually steers), and `arc` (the snail's own flight path, off a launch).

### ⚠ The arc is computed by the flight solver, and that is the whole of it

`playerMotion.ts` now exports `flightHeight`/`flightDuration` — the closed form of the arc the fixed
tick integrates — and `arcPoints` calls it. **An arc laid by hand is an arc the player can see, aim
at, hit the launch perfectly and still miss**, with no way to learn what they did wrong, so it reads
as the game lying. Laid by the solver, hitting the launch collects the chain by construction, and
the chain teaches what a launch is for without a word of text. Same argument as a recording driver
calling the game's own solver rather than reimplementing its rules.

`verify:formations` asserts the two forms agree — the stepped `stepPlayer` and the closed form come
out **7.6e-13 units apart over a 700ms flight** — rather than trusting the algebra, because if they
ever drift every other assertion in the file is measuring a fiction.

### ⚠ The collection window is lopsided the opposite way from the obvious guess

The snail's body is `[y, y + PLAYER_BODY_H]`, so `reaches` takes a pickup up to **180 units above**
the feet and only `PICKUP_REACH_UNDERFOOT` (16) below them. The first version had that backwards and
laid the arc 45 units *under* the trajectory as a safety margin — a fifth of a body height, looks
like nothing, and collected **0 of 3**.

The arc is laid at `flightHeight + PICKUP_HEIGHT`: the body's **centre**, which is exactly where a
ground pickup sits relative to a grounded snail. One offset for both cases, and the tolerance becomes
symmetric at ±90 units instead of +180/−16 — which is what the arc needs, because the speed it is
flown at is not the speed it was laid for.

### ⚠ An arc in world space is a function of the run speed, and the placer cannot know it

The heights are right in **time**; the positions those heights sit at are `speed * t`. Laid for one
speed and flown at another, the chain is on the trajectory in time and off it in space. Measured
over the shipped arc, laid at `ARC_REFERENCE_SPEED = SPEED_CAP`:

| speed | collected |
|---|---|
| 1440 (`SPEED_BASE`) | 0 of 5 |
| 2700 | 3 of 5 |
| 3600 (`SPEED_CAP`) | **5 of 5** |
| 4500 | 4 of 5 |
| 5760 (`MAX_ATTAINABLE_SPEED`) | 3 of 5 |

**This is printed rather than asserted, and it is the number the trampoline chunk has to decide
with.** Its options are to pin the horizontal speed through the flight, or to generate the arc when
the launch is actually hit — which costs the player being able to see the chain and commit to it in
advance, i.e. costs the thing the arc is for. Recorded here so that decision is taken against a
measurement instead of a guess.

`arc` is never placed today: `placeFormations` takes a `launches` list, it is empty until the
trampoline exists, and `verify:formations` asserts both halves — nothing leaves the ground without a
launch, and a launch produces an arc. **An arc over flat road is a chain hanging in the air**, which
is the failure the whole module is about.

### Three defects the suite found in the placer itself

- **A chain that crossed the lap seam.** The scene relays the whole layout on every wrap, so a
  wrapped tail sat on the same ground as the next lap's first chain — two chains in one place, mixed
  kinds where they overlapped. The walk now stops rather than laying a chain that would not fit,
  which is the rule the obstacle placer already follows.
- **Chains that overlapped each other.** A twelve-coin chain spans 9504 units and the gap between
  chain *starts* was 4160 at its tightest. The walk advances from the **end** of the chain just
  laid, not from its start.
- **Two ideas of where the road ends.** The points were checked against the obstacles and then run
  through a `clampOffset` at `ROAD_EDGE` — stricter than `PICKUP_OFFSET` — so **12 of 2065** pickups
  were checked in one place and laid in another, inside an obstacle. The clamp is gone;
  `PICKUP_OFFSET` is the one rule, and what `chainPoints` returns is what ships.

### The rules a chain obeys

- **Homogeneous.** The kind is rolled once per chain, not per pickup: a line of coins with a fruit
  in it is neither, and the player cannot decide whether it is worth leaving their lane for until
  they are alongside it.
- **A fruit chain is shorter than a coin chain** (3–5 against 6–12). Eight fruit are a whole Fever,
  so a chain of eight would hand one over for a single decision; four is a quarter of one.
  `shield` has no chain at all — a row of the same absorbed hit is not a row.
- **Nothing is laid inside an obstacle**, and the check is shown to bite: a road with a wall every
  two segments takes **0** pickups after `CHAIN_ATTEMPTS` redraws each, where without the rule it
  would take a full lap of them. A coin a hair in front of a boulder is an invitation to drive into
  the boulder, which is not a decision.
- **Spacing is stated in milliseconds** and converted at `MAX_ATTAINABLE_SPEED`, the same rule the
  obstacle rows follow. A coin chain's 150ms is 864 units — 240ms at the cap and 600ms at the start
  of a run. Erring toward spread out rather than bunched, because a bunched chain reads as one blob
  and the point is that it reads as a line.
- **A wave shrinks its amplitude to fit rather than clamping each point.** A clamped sine goes flat
  at both extremes, which is exactly where the player is being asked to commit to a direction.

Live on `forest`: a seven-coin wave running −0.28 → 0.26 → −0.76 across the road, evenly spaced four
to five segments apart, with the next chain visible behind it. 109 pickups on the lap against the
old placer's ~100, in chains instead of singles.

## The Ramp, And Landing On Your Feet

`src/run/ramp.ts` (pure, `npm run verify:ramp`), `RampSprites.ts`, `Dust.ts`. A wedge a third of the
road wide that throws the snail 2.8 times as high as it can jump, turning over once on the way.

### The launch is solved from the apex, through the game's one gravity

`RAMP_APEX = 1200` is chosen and `RAMP_LAUNCH_V = sqrt(2 g h)` and `RAMP_AIR_MS = 2v/g` follow —
the same discipline `JUMP_APEX` is under, and deliberately the **same `g`**: a second gravity would
mean `flightHeight` no longer describes every flight in the game, and `formations.ts`'s arc chain is
built on there being exactly one. Delivered: **4105 u/s, 1169ms of air, 2.79x a jump's apex.**

The multiple is what makes it a different verb rather than a bigger number. The tallest obstacle
band tops out at 620 and a jump's apex is 430 — under it, which is the entire reason `blocking`
exists as a class. 1200 is over everything.

### ⚠ The spin is a function of flight progress, never of angular velocity

`spinAngle` is `turns * 360 * t`, with `t` the fraction of the flight already flown. That is the
only form under which the snail lands upright **at every launch strength**, because `t` reaches
exactly 1 at touchdown by definition.

A fixed angular velocity is the obvious implementation and it lands sideways: the angle at touchdown
is `omega * duration`, and the duration is whatever the launch happened to be. It can be tuned to
land upright for one launch, and then every other launch is wrong — which is how a constant ends up
being nudged forever. Both are run over the same 50 random launches:

| | worst landing angle |
|---|---|
| progress-driven | **0.000 degrees** |
| fixed rate, tuned for the shipped launch | **172 degrees** |

`t` is derived from the velocity — `(v0 - vy) / (2 v0)` — rather than from a stored clock, because
the tick's velocity update is exact and a clock would be a second thing to keep in step with the
integrator. `verify:ramp` asserts progress equals elapsed-time-over-duration to 1e-9 at every tick.

- **The residual is one tick, and it is measured rather than assumed.** The frame the snail touches
  down on is `grounded` and therefore drawn at exactly 0; the frame *before* it is short of upright
  by **0.8 degrees**, identically at 30, 60 and 144Hz — identically because `runFixedSteps` runs the
  same 60Hz tick whatever the frame rate, which is the whole point of the fixed timestep.
- **The shadow does not turn.** It is a mark on the ground, and the ground is not rotating; it grows
  and fades with height and nothing else. Rotating it would read as the world tipping.
- **An ordinary jump does not spin at all**, asserted — a jump that turned over would make the two
  verbs one.

### There is no invulnerability flag, and the check is what says the rule already covers it

A hit is two interval overlaps, so a snail whose feet are above the tallest band cannot be hit by
anything: `verify:ramp` puts a snail at the apex and asserts all three classes miss. Adding a flag
would be a second answer to a question that has one.

**What that does not mean is that a ramp is safe**, and the check measures rather than claims it:
**69% of the flight clears every band and the other 31% can still be hit**, on the ascent and the
descent like any jump. That is what stops a ramp being a way through a wall. Confirmed live — a run
launched off a real ramp took a hit on the way down.

### Lateral control is weakened, not switched off

`RAMP_AIR_CONTROL = 0.4`, applied to the **stiffness** and only while airborne. Both extremes are
failures with names: full control makes a ramp an ordinary jump with a bigger number on it, and no
control makes it a cut-scene. Measured over 400ms of steering toward the verge: **0.90 half-widths
on the ground against 0.50 in a ramp flight**, i.e. 56% — the spring is not linear in the multiplier,
which is why this is measured rather than assumed to be 40%.

**An ordinary jump keeps full control**, asserted separately, because otherwise this chunk would
have quietly changed how every obstacle in the game is dodged.

### ⚠ The flight fields nearly vanished every frame

`stepPlayer` returned `{ ...kinematics, stepRemainderMs }`, and `Kinematics` deliberately carries
only what the tick integrates. Spreading it alone dropped `flightV0`, `flightSpins` and `airControl`
on every tick, so the spin would have reset to nothing on the frame after it started. It spreads the
whole state first now, and clears the three on landing rather than leaving a grounded snail holding
a launch velocity nothing reads.

### ⚠ It was drawn in profile, which is wrong by ninety degrees

A wedge whose slope rises left to right is a ramp seen **from the side**, and the player is never to
the side: they are directly behind it, running at it. What that put on screen was a ramp lying across
the road, which is a thing you hit rather than a thing you ride. Reported by pointing at a frame.

It is drawn receding now — **near edge wide and on the road, far edge narrower and raised** — with a
darker lip capping the far end and rails down both sides giving the eye two converging lines to read
the recession off. The perspective inside the billboard has to be *painted*, because the projection
only scales the whole quad.

The chevrons point away up the surface and narrow with it, so they lie on the ramp rather than
floating over it. They are the only saturated thing on the object: the body stays in the obstacle
family's muted stone because a ramp is not a reward, and the *marking* borrows the coin's own gold
because the road already carries paint and the player already reads that colour as "go for this".

**And the first recoloured version read as a hole in the road.** `blocking`'s greys are what an
upright mass is read against the *sky* in; a ramp is read against the *road*, which is pale warm
flagstone, and a mid grey on it is a hole. It is `low`'s sun-bleached sandstone now, with the ink
ring cut from 0.02 of the canvas to 0.007 and the rails halved — on a billboard this flat there is
very little interior left after a border, so the border has to be a hairline.

### ⚠ The wedge was invisible, and the rule that made it invisible was the wrong rule

`RAMP_HEIGHT` was 170 on the reasoning that a ramp drawn shorter than the shortest thing that *can*
hit you cannot be mistaken for a hazard. Sound about a height, and wrong about what a player reads:
measured in the running game at 25 segments out, that is **164 x 21 screen pixels of muted timber on
a pale flagstone road** — not mistakable for an obstacle because not mistakable for anything.

What separates a ramp from an obstacle is its **shape**, a sloped top edge that nothing else on this
road has, and its **markings**. Neither needs it short. It is 300 now — under `blocking.yHigh`, which
is the one class it must never look like — with two gold chevrons climbing the slope.

**The chevrons are the only saturated thing on it**, and that is the game's colour rule being obeyed
rather than bent: the body stays in the obstacle family's muted timber because a ramp is not a
reward, and the *marking* borrows the coin's own gold because the road already carries paint and the
player already reads that colour as "go for this". `verify:ramp`'s height assertion was rewritten
with the old reasoning kept on it, so the next person to shrink it finds out why it grew.

### The rest

- **Never laid on an obstacle.** `placeRamps` takes the lap's obstacles and redraws up to
  `RAMP_ATTEMPTS` times, then drops the slot — a ramp inside a boulder charges the player a life for
  taking the launch. Shown to bite: a road walled end to end takes **0** ramps.
  ⚠ The first fixture only walled 160 000 of a 286 800-unit lap and three ramps landed past its end,
  which was the fixture being wrong rather than the placer.
- **Landing is squash, per-entity hitstop through `frozenUntil`, and dust** — never `timeScale`.
  `Dust.ts` reuses `debris.ts` unchanged (no per-frame allocation, a hard pool ceiling, a clamped
  delta) and only differs in being drawn as pale round motes that grow as they fade. The puff is
  thrown from the point `PlayerView` already projected the snail's feet to, so it cannot disagree
  with the shadow about where the ground is.
- **The arc chains are live now.** `placeRamps` runs before `placeFormations` and feeds it the
  launches, so C-B's `arc` finally has somewhere to be.

### ⚠ And the arc's speed problem is answered here, with the number C-B measured

`verify:formations` measured that an arc laid at `SPEED_CAP` is collected 5 of 5 at the cap, 3 of 5
at Fever speed and **0 of 5** at the speed a run starts at — because the heights are right in *time*
and the positions are `speed * t`.

**⚠ And re-laying it once on the approach was not enough, which a player found.** Reported as coins
not always being collected off a ramp, with Fever correctly guessed as the reason: a Fever entered
between the approach and the ramp raises the speed by 60% in a fraction of a second, and nothing
had re-laid the chain since.

So it is laid **twice**. Once on the approach — every frame while the ramp is between
`ARC_RELAY_NEAR_Z` and `ARC_RELAY_Z`, far enough out that nothing is seen moving and near enough
that the speed is settled — and then again **at the moment of launch**, where the flight's speed is
a fact rather than a prediction. Inside `ARC_RELAY_NEAR_Z` the chain is left alone: the player is
lining up on it, and coins sliding under that approach are worse than coins laid for a speed a
second out of date.

Measured, over the whole speed range:

| flown at | laid for the same speed | laid for `SPEED_CAP` |
|---|---|---|
| 1440 (`SPEED_BASE`) | **5 of 5** | 0 of 5 |
| 2700 | **5 of 5** | 3 of 5 |
| 3600 (`SPEED_CAP`) | **5 of 5** | 5 of 5 |
| 4500 | **5 of 5** | 4 of 5 |
| 5760 (`MAX_ATTAINABLE_SPEED`) | **5 of 5** | 3 of 5 |

The right-hand column is the arrangement that shipped and is kept as the check's control, so the
assertion is shown to be measuring something. Live: a ramp taken at Fever speed now collects all
five where it collected three.

The alternative — pinning the horizontal speed through the flight — would have let the ramp overrule
the run's whole speed economy for a second, and would have read as the ramp slowing you down in the
one moment you are fastest.

`movePickup` keeps the segment index in step when a pickup moves; a pickup moved without it is drawn
in one place and collected in another, which is the same class of defect as `formations.ts`'s own
clamp-after-check.

Verified live on `forest`: rode a real ramp at 3600 u/s, `flightV0` 4105 with one spin and control
0.4, **four of the five arc coins collected in the air**, and the landing frame drawn at exactly
0 degrees with the flight fields cleared.

## Fever, And The Second In Which It Ends

`src/run/fever.ts` (pure, `npm run verify:fever`), `FeverView.ts`, and two bars in the HUD. Eight
fruit fill a gauge, the gauge buys six seconds of 1.6x speed with the hitbox switched off and every
pickup on screen dragged onto the snail's line, and then it has to *stop* — which is the only part
of this that is difficult.

### ⚠ The exit is an ordering, and getting it wrong kills the player at the best moment of the run

Leaving Fever at Fever speed is a guaranteed hit. The player has spent six seconds flying through
obstacles, the guard comes off, and the next row arrives sooner than anyone can answer it — so the
best moment of the run ends in a death they cannot explain, and they blame the game, correctly.
Three steps, and none of them is optional:

1. **the speed comes back first**, over `FEVER_EASE_MS`, while the guard is still up;
2. **only then does the guard come off** — `feverInvulnerable` covers `active` *and* `easing`, which
   is why `easing` is a phase rather than a flag on `active`;
3. **and the guard then WAITS for the road**, in a fourth phase, until the nearest obstacle is more
   than `REACTION_MS * FEVER_CLEAR_MARGIN` away.

Measured over the real placer, 200 exits: the first obstacle a player can be hit by arrives at
**minimum 506ms, 5th percentile 549ms, median 1229ms** against a 450ms floor. **The same simulation
without the hold gives a minimum of 13ms**, which is the reported class of bug and is the negative
control the check carries, because a floor that has never rejected anything is not a floor.

- **⚠ Step 3 used to DELETE the obstacles instead, and that shipped and was reported.** See "Four
  Things From One Screenshot": the window is 42 segments against a road drawn 300 ahead, so the
  player watched rocks vanish in front of them, and it broke the rule that nothing already on screen
  is ever rewritten. Holding the guard removes nothing.

### ⚠ Two ways the speed failed to actually come back, both found by the check

- **The ordinary chase cannot land a Fever.** `SPEED_ACCEL` has a 5.9-second time constant, so over
  a one-second ease it sheds a sixth of the speed. `FEVER_SPEED_ACCEL = 6` (167ms) is used for the
  whole of Fever, entry included.
- **A first-order lag arrives at the end of a ramp still above it, by `tau * slope`.** Measured: the
  guard came off at **3958 u/s against a 3600 u/s ceiling**, 10% over — the exact defect the ordering
  exists to prevent, through the back door. `FEVER_SETTLE_MS = 400` finishes the ramp early and
  spends the rest of the landing at factor 1 with the guard still up.
- **⚠ And the first fix made it worse — 4146 u/s — because the accel was keyed on the factor.**
  Through the settle the factor is exactly 1, so a `factor > 1` test handed the one stretch whose
  only job is shedding the lag back to the slow chase. It is keyed on the **phase**. Live, the guard
  drops at **3639 u/s**, 1.1% over.

### The gauge does not drain, and it is spent on entry

A slow leak punishes the player for playing a stretch the placer put no fruit on, and reads as the
game taking something back. It only ever empties into a Fever. Spent on *entry* rather than on exit,
so fruit taken during a Fever — and the magnet means there is a lot of it — counts toward the next
one instead of being discarded.

**Two bars, and collapsing them into one would be wrong in both directions.** The gauge fills and the
Fever meter empties, they are true at the same time, and a single bar that changed meaning halfway
would ask the player to read its colour to find out which question it is currently answering. The
gauge is drawn even when empty, unlike the boost meter it replaced: that one was hidden because a
permanently empty gauge is a permanent question, which is true of something that is either running or
not and false of *progress* — a bar the player is filling has to be visible while they fill it. They
are separated by a whole bar's height, because at 4px they read as one two-tone bar, which is the
single readout the pair exists not to be.

### The magnet moves the pickup, it does not widen the box

A magnet drawn as a bigger invisible catchment is a pickup that vanishes off to one side. Pulling the
pickup onto the snail's line leaves the ordinary `reaches` test doing the collecting, so there is one
rule for what counts as touching something.

- **⚠ `FEVER_MAGNET_RATE` is set against the time a pickup actually has, which is much less than it
  looks.** The window is 1600 units and Fever speed is 5760 u/s, so a pickup spends **0.28 seconds**
  inside it, and the pull is weighted by distance so the effective rate is half of the constant. At 5
  a pickup from the far verge arrived **0.59 half-widths off the line** — it visibly leaned toward
  the snail and was then missed, which is worse than no magnet. At 20 the same crossing lands within
  0.07.

### Fever is a visible event, and the wash is the part that had to be pulled back

A Fever that is only a number is a Fever the player plays through defensively: they are invulnerable
for six seconds and the only way to find out is to be told. `FeverView` is a warm additive wash and a
field of speed lines radiating from the vanishing point, both on `uiCamera`.

- **The palette shift is done over the finished frame rather than in the road's palette**, because
  rebaking the palette texture is the one thing `applyTheme` is documented as unsafe to do while the
  world is drawing — and a Fever is when it is drawing hardest.
- **The strength follows `feverSpeedFactor` rather than the phase**, so the frame calms down over the
  same second the run slows down in.
- **⚠ `WASH_ALPHA` came down 0.55 → 0.38 after looking at a live frame.** Additive light washes
  *saturation* out of everything under it, and the snail is the one object in this game allowed to be
  saturated — thirteen times the chroma of anything it shares a frame with, precisely so the player
  never has to search for it. At 0.55 the mascot went from orange to pale gold: the effect was
  spending the mascot's own separation on itself.
- The lines leave `INNER_HOLE` of the frame around the vanishing point empty. That is the strip the
  player reads obstacles out of, and the guard comes off while the wash is still up.
- **The trail is not in this file at all** — it comes free, because `slimeIntensity` is a function of
  speed and clamps above 1 precisely so that going faster than the run's own ceiling has somewhere to
  show.

### `MAX_ATTAINABLE_SPEED` is unchanged, and that is deliberate

`FEVER_SPEED_FACTOR` is 1.6 because that is what the boost pickup it replaces was, so every row of
obstacles in the game is still spaced against the same top speed. Raising it would tighten the
reaction budget on every stretch at once — a difficulty change wearing a feature's clothes.

### Harness note: `scene.start('RunScene')` over a live `MainMenu` throws

`Cannot read properties of undefined (reading 'glTexture')` inside the `Mesh2D` submitter — the
documented signature of `applyTheme`'s precondition being violated, and nothing to do with themes.
The menu renders the same world, so starting the run directly leaves its mesh holding a palette
texture the new scene has just removed. `scene.stop('MainMenu')` first, then start, and it is clean.
The real player path does not hit this because the menu's own handover owns the ordering.

## The Slime Trail

`src/run/slime.ts` holds the world-space points; `SlimeTrail.ts` draws them. **It is the only thing
in the frame that tells the player what they just did** — everything else is about what is coming —
and it is also the speed gauge that is not in the HUD.

- **It records the line, not the centreline.** Slime is laid at the snail's own `offsetX`, so on a
  bend it curves with the road and a clean line through a row of obstacles is visible behind them
  as a clean line.
- **Laid by distance, not by time** — the same rule the glide cycle follows. A time-spaced trail
  thins out exactly when the run gets fast, which is backwards for something whose job is speed.
- **Width and strength both rise with speed**, and `slimeIntensity` clamps *above* 1 rather than at
  it: a boost pushes past `SPEED_CAP`, and this is the clearest place in the frame to show the
  player going faster than the game's own ceiling. Measured: 0.028 wide at 0.32 strength at
  `SPEED_BASE` against 0.060 at 0.82 at `SPEED_CAP`.
- **Where it sits on screen is a consequence of the geometry, and a lucky one.** The camera is
  `PLAYER_Z` *behind* the snail, so slime flows towards the viewer and passes the camera about a
  second later — occupying the near band under the snail, which a run deliberately leaves empty.

### ⚠ A ribbon of quads, not a pool of billboards

A trail made of billboarded blobs is a row of vertical stamps: each faces the camera, so it reads
as stickers standing on the tarmac rather than as a mark *on* it. Filling a quad between each pair
of consecutive points means the near end is genuinely wider than the far end, because both edges
come out of the road's own projection — the same thing `DecalMesh` does for the track's baked
marks. It is also cheaper: one `Graphics` and ~54 quads against 40 pooled `Image`s.

Depth is flat at `ROAD_MESH_DEPTH + 0.5`: a mark on the ground is under anything standing on the
ground at *every* distance, so unlike obstacles and pickups this does **not** join `worldDepth`'s
distance sort.

### ⚠ Two ramps, because two questions — and the first version only had one

`slimeFade` was written as a single "slime dries" gradient over the closest 55% of the trail. Then
the projected widths were measured, and that band turned out to be **entirely below the frame**:
everything nearer than about 1100 units projects off the bottom. So the ramp dimmed the part nobody
sees and left the visible ribbon flat, which read as painted road marking rather than as something
wet.

It is now two ramps with different jobs:

- **`drying`** scaled against the whole of `PLAYER_Z`, so the gradient falls across the band that is
  actually on screen: 1.00 under the snail to 0.78 at the frame's edge.
- **`cullRamp`**, a guard rather than a look. Projected width goes as `1 / ahead`, so a point at
  `ahead = 164` measured **668 pixels wide** — entirely below the frame, and pure wasted fill.
  `SLIME_NEAR_CULL_Z` drops them at 150 and the ramp takes them out over the next 300 so they fade
  rather than blink.

The strengths were raised in the same pass (0.22/0.72 to 0.32/0.82) for the same reason: they are
the numbers for the part the player can see, not for the whole trail.

## The Art

**⚠ EVERYTHING BELOW THIS LINE UNTIL "## The Difficulty Curve" DESCRIBES ART THAT NO LONGER
SHIPS.** The whole set — the mascot, the three obstacle classes, the pickups, all nine biomes of
roadside props and the road's own palette — was regenerated against a glossy casual-mobile brief.
See **"The Regeneration: A Glossy World"** below for what shipped and why. What is kept here is the
*reasoning*: the aspect-versus-collision-box rule, the ink-weight lesson, the readability sizes and
the silhouette-class rule all survived the change and are still binding. The one thing that
inverted is the tone target, and it is called out where it appears.


**One decision for the whole project: full-colour, smoothed, never pixel art.** `config.ts` sets
neither `pixelArt` nor `roundPixels`, so WebGL antialiasing is on and every sprite is scaled
continuously by the road's projection. The two styles cannot share a frame — a pixel grid only
reads as intentional when nothing beside it is being resampled, and this projection resamples
everything by definition. The 49 inherited verge props are diffusion-style art, and everything
drawn since matches them.

### The tone target, and how to aim at it

**⚠ THIS TARGET IS HISTORY. The art it describes has been replaced; see "The Regeneration: A
Glossy World".** It is kept because the *method* is still how art is aimed here, and because the
replacement was argued against these numbers rather than in ignorance of them.

`node scripts/measure-art.mjs` walks the sprites and reports three numbers over their opaque
pixels: **lightness, saturation, and what share reads as ink** (below lightness 70). The verge
came back at **111 / 5% / 34%**, and that triple was the target — the rail shooter established
that *tone*, not line style, is what makes a prop belong to a frame: bought props measuring 1.29x
as bright and 2.66x as saturated as their neighbours jumped forward off the roadside, and no amount
of redrawing fixed it until the numbers moved.

So the rule has two halves, and they point opposite ways:

- **Obstacles aim at the verge's numbers.** They measure 93–105 lightness, 10–12% saturation,
  34–43% ink. A rock is part of the picture; what separates it from the scenery is that it stands
  on grey asphalt, not that it is a different colour.
- **The snail aims away from them, and it is the only thing that does.** 140 lightness and 66%
  saturation against the verge's 111 and 5% — thirteen times the saturation of anything it shares a
  frame with. It is the one object a player must never have to search for.

`verify:obstacles` pins both halves against `src/run/artPalette.ts`, because both mistakes made
while drawing this were mistakes about numbers and are catchable without a rasteriser:

- **⚠ Every `dark` band must be below `INK_LIGHTNESS`.** The first pass landed them at 71–72
  against a threshold of 70, so the shaded half of every rock counted as body colour: the obstacles
  measured 10–18% ink beside a verge at 34% and read as flat cut-outs pasted onto the road.
- **⚠ A rich brown is not a muted brown.** The trunk shipped at 42% saturation against the verge's
  5%.
- **Ink is `26,28,26`, never pure black** — `verify:mattes`'s border-flood rule.

### ⚠ Ink weight is a fraction of the canvas's geometric mean, not of its width

The three obstacle canvases are all 256 wide and 56, 162 and 139 tall. A width-derived outline put
a 5.6px ring on a 56px-tall rock — a sixth of its height — and the low cluster measured 60% ink,
i.e. mostly outline. `sqrt(width * height)` tracks the shape's actual size and gives 2.6px, 4.5px
and 4.2px.

This is the second time this project has got ink weight wrong in the opposite direction: the rail
shooter shipped a prop with *no* visible outline because its ink was set in supersample pixels and
survived two downscales. **Ink weight is always derived from the delivered size.**

### The snail

Six frames of glide (`snail-0` … `snail-5`), and **the whole character animation is one wave
travelling along the foot**. That is why the mascot is a snail at all: a runner with legs needs a
walk cycle, a run cycle, a launch pose, an airborne pose and a landing pose, where a snail has no
gait and its silhouette's bottom edge rippling is the entire read. `squash.ts`'s procedural
deformation rides on top for the jump.

- **The cycle advances with distance, not with time** — one segment per frame, so the ripple runs
  at 7.2 frames a second at `SPEED_BASE` and 18 at `SPEED_CAP`. A wall-clock cycle would ripple at
  the same rate whether the run was crawling or flat out, which reads as the animation having come
  loose from the game.
- **The eye stalks are what make it legible small.** Everything else about a snail is round lumps;
  two thin verticals with dots on top is what a player reads as "creature" first. Measured at
  390x844 — the narrowest viewport this game supports — the snail is **23x15px** and still reads.
- **The shell carries bands *and* a spiral**, doing different jobs: the bands survive the downscale
  to a phone, the spiral is what makes it a shell rather than a target at 100px on a desktop.

### The pickups

**A pickup is a thing the player is meant to want, so it is lit like the creature and not like the
rock.** That is the whole colour rule of this game: everything is aimed at the scenery's muted tone
except the snail and the things you steer it towards. Measured, the pickups average **69%
saturation against the obstacles' 13%** — squarely in the snail's family.

Three silhouettes, because colour is always the second cue: a **stack of chevrons** (the only shape
with a direction), a **plate** (the only closed symmetrical outline), a **ring** (the only shape
with a hole). Checked at the sizes the game delivers — 13px on a portrait phone, 26px mid, 64px on
a desktop — and the coin's hole survives the smallest of them, which was the one at risk.

All three sit on **one shared dark backing disc**. A pickup has to separate from grey road, green
grass and pale sand, and the eight biomes make every one of those the background at some point; one
shape does that everywhere, where three per-biome variants would be three things to keep in step.

### The obstacles

Three silhouettes that must be told apart at the 9–27px `verify:obstacles` measures them at, so
they differ in **outline** first and colour second: a wide flat cluster of lumps, a tall slab with
a straight vertical face, and a trunk hanging in the air with daylight drawn under it.

**⚠ `low` has three shape variants because a wall is made of nothing else.** `drawWall` lays low
rocks edge to edge to build the one row a jump is required for, and with a single texture that came
out as a picket fence — the same triangular lump repeated fourteen times across the road. Three
silhouettes (centre-, left- and right-heavy) plus a horizontal flip keyed off the obstacle's id
give six distinct rocks, which is enough that no two neighbours match. `blocking` has two, leaning
opposite ways; an `overhead` spans the road alone and never has a neighbour.

Variation is **flip and shape only, never scale** — the drawn size is the collision box (see "The
Snail" on `PLAYER_WIDTH`), and a scale jitter would break that.

## The Regeneration: A Glossy World

The game shipped its fork wearing SKYLOCK's clothes: 49 muted verge props, seven sky plates and a
dark grey asphalt road, all authored for a rail shooter. This round replaced the lot against a
reference set of glossy casual-mobile screenshots — high chroma, soft studio light, creamy
speculars, chunky rounded forms, no black contour.

**The pipeline is the sibling Remotion project's, and three new modules drive it:**
`snail_prompts.py` (63 slots, one CLIP budget), `gen_snail_art.py` (the Modal driver) and
`snail_roughs.py` (the mascot's img2img init). Everything else — `key_cutout` / `rembg_cutout`, the
unmix against the measured background, the trim, `sprite_metrics`, the QA strip, the sidecar writer
— is imported from `gen_rail_sprites.py` rather than copied. Delivery into the game is
`scripts/build-sprites.py`, reading `dev-assets/picks.json`.

**Nothing about the game's rendering changed, and there is no 3D in it.** These are flat RGBA PNGs
that happen to be lit like renders. Each lands under a texture key the generators already declare,
and every one of `snailArt.ts`, `obstacleArt.ts`, `pickupArt.ts` and `decor.ts` skips its own
drawing when the key exists — so the swap is an asset drop with no code change downstream.

### ⚠ The tone rule inverted, and the check that caught the overshoot was right

`artPalette.ts` used to state the rail shooter's rule: the verge measures 111 / 5% / 34% and every
obstacle aims at it. That is a *muted* target, and aiming at it now means drawing the one object in
the frame still in the old game's idiom, on the road, where it is most visible.

What did **not** change is the reason the rule existed, and separating the two is the whole of the
rewrite: an obstacle must belong to the picture and still separate from the scenery, and the snail
must never have to be searched for. The first is now done by being a MADE thing among natural ones;
the second is unchanged and got *harder*, because everything around the mascot got brighter.

**The first draft of the new obstacle palette overshot and `verify:obstacles` failed it at 1.2x
against a 3x floor.** That was not a stale threshold — it was two real defects at once: the mascot's
shell is amber, so a honey-and-oak hazard family sits in the same hue as the one object the player
must never hunt for; and *the reference does not do that either*. Its stone, its crates and its
architecture are low-chroma, and what carries the chroma is the characters and the collectibles.
"Candy-coloured stone" was a misreading of the thing being copied.

The shipped table is weathered instead (32% / 16% / 37% mean saturation against the mascot's 70%),
and two checks moved with it, both with their evidence written into the source:

- **`obstacles sit inside the scenery saturation bracket` is gone**, replaced by
  `the three obstacle classes are told apart by value` — a ≥12-lightness gap between class means,
  which is what survives the distance haze and the biome tint when hue does not. Current spread
  134 / 110 / 91.
- **The mascot's margin fell from 3x to 2x, which is a loosening.** 3x was never chosen as a
  readability floor; it was set under a margin that held for free while the obstacles were pinned
  under a 25% ceiling. Measured on the shipped art, the mascot wins by **1.55x**; the drawn fallback
  is authored cooler, at 2.5x. A **negative control** now keeps the candied palette in the check, so
  it is shown to reject something on every run rather than on the day someone repeats the mistake.
  A perceptual `deltaE` was tried as a replacement and rejected on measurement: it scored the
  failing palette and the passing one at 0.272 against 0.291.

### ⚠ The road is a garden path, and `src/road/` was touched to do it

The fork's own rule is that `src/road/` is not modified. Its three reasons are the projection, the
depth budget and billboards agreeing with the ground — and a palette touches none of them, which is
why `themes.ts`'s `day.road` moved and nothing else did. `verify:road`'s 93 checks are what make
that safe rather than merely arguable, and they stayed green through it.

The surface was `0x44484f`/`0x4e525a`, a dark grey road with white kerbstones. It is now warm pale
flagstone with deep brown stripes. **A dark strip down the middle of a bright world is the one thing
in the frame that re-arting the props around it cannot fix** — it is the largest single surface on
screen. Three relationships had to survive and each is asserted: the alternation ratio near 1.092,
the rumble stripe at ≥1.6:1 against the surface (which forced the stripes to *invert* from near-white
to dark, since their job is lightness and not hue), and every biome ground still clearing
`MIN_GROUND_CONTRAST` — which `groundForTheme` handles by itself, pushing each pair further in
whichever direction it already leaned.

### The mascot: one render, six frames, and four rounds to get the vantage

Sixteen renders. **The style landed on the first probe and the vantage took four rounds**, which is
this project's standing finding paid for again: naming a camera angle does nothing, so
`snail_roughs.py` supplies it as geometry. Three things had to be discovered in the rough itself,
and each is written up on the code that fixes it:

- **A circle in a 1.56:1 box is not a shape given equal fractions of both axes.** The first shell
  spanned 0.85 of the width and 0.78 of the height and delivered a **1.7:1 oval** — which is what a
  spiral seen in *profile* looks like, i.e. the exact vantage the file exists to prevent.
- **The lily pad was a composition problem, not a foot-width problem.** Eight renders across two
  rounds came back standing in a flat green pool, and `lily pad, plate, disc, puddle` in the
  negative moved none of them. The shell is a circle and can only fill 0.48 of a 1.56:1 box;
  something has to occupy the rest, and a snail spreads sideways into slime. Giving the width to a
  HEAD LOBE instead removed the pool on the first try.
- **img2img returns this subject ~15% squarer than the box it is handed**, measured across twelve
  renders. The rough is therefore drawn at 1.80 to deliver the 1.56 the collision box needs. Padding
  either axis instead is the pancake bug from `PLAYER_WIDTH`'s own docstring, in two directions:
  pad the sides and the snail is hit by things it visibly cleared, pad the top and an `overhead`
  lands on a snail whose drawn top is well below it.

**The six glide frames are derived from the one picked render** by `build_snail`, as a per-row
horizontal shear falling to zero by `WAVE_REACH`. Six independent renders would be six different
snails, and this is the one object whose identity is the entire product.

**⚠ The model kept drifting to profile, and this file used to say it was right. It was not.** The
argument was that the procedural fallback is a profile (`drawFoot` runs the foot horizontally, stalks
at x 0.19/0.30, head left), that the 1.56:1 aspect is a profile proportion, and that the direction is
arbitrary "since the snail runs away from the camera". The last clause is the answer contradicting
its own premise: if the snail runs away from the camera then the player is looking at its **back**,
and a profile is a creature travelling across the screen while the road travels into it.

Reported by a player pointing at a frame. The pick is **`snail_hero_v2`**, the one render of sixteen
taken at that vantage — shell to the camera, head and both stalks going away, foot spread wide
underneath — and it is **not mirrored**, because a back has no facing to agree with. Its 1.62:1 is
within four points of the collision box's 1.56:1, so nothing about `PLAYER_WIDTH` moved. Checked at
120, 46 and 23 pixels over magenta and mid grey: it still reads as a creature at the narrowest
viewport the game supports.

**What this leaves open, stated rather than hidden**: the procedural fallback in `snailArt.ts` is
still a profile, so art and fallback no longer agree. That only shows if a PNG fails to load — and
the fix is a rear-view fallback, not a mirrored render.

### ⚠ The obstacles are made things now, and it took three rounds to find out why

Two rounds asked for glossy candy-coloured stone and failed in opposite directions:

- **round 1** — "a low wide cluster of boulders" at 4.57:1 returned a **seamless pebble field** six
  times of nine, `canvasEdgeOpaquePct` 25–53% against a 0.5% gate. A 4.57:1 cluster is not an object
  this checkpoint has a prior for; a pebble texture is. The parent project had already recorded this
  on `rid_lichen` — *a rock described by its surface is one prompt from being a material swatch* —
  and that lesson was in one slot's negative and not in the family's.
- **round 2** — the fields went and **wet plastic** replaced them: glossy blue and violet blobs
  reading as resin. `glossy`, `smooth` and `polished` are the style head's own words and they are
  right for a shell, a leaf and a mushroom cap; on a featureless mass they produce liquid.

**The two best renders of either round were both wooden logs**, and that is the finding: wood has
structure the model can hold on to. The classes are now a sandstone block course, hay bales,
barrels, crates, a stone pillar and a fallen trunk. That they are artificial is a readability win
rather than a compromise — an obstacle's whole job is to separate instantly from the scenery, the
scenery is nine biomes of natural props, and the reference is a world built almost entirely of
exactly these objects.

**The cast shadow was fixed by the matte, not by the prompt.** Three negative terms failed to remove
it (`drop shadow`, then `cast shadow` and `studio backdrop`). `rembg` is semantic — it segments the
object, and a shadow is not one — and these are solid masses with no thin outlying structure, i.e.
the case where the semantic matte gives up nothing.

### ⚠ This checkpoint draws objects, not symbols

Three rounds and nine renders asked for an arrow for the boost pickup. "Two stacked chevrons"
scattered them across the frame; "one bold chevron pointing up" delivered one pointing LEFT and one
pointing DOWN; the third round returned a gem, a dollar sign and **a phone with a face on it**. The
same failure struck glyphs into the coin — a "0", a monogram, a pair of eyes.

It is one failure: **a shape that means something by convention rather than by being a thing has no
prior here.** A lightning bolt is a thing, and it landed on the first render. It keeps everything the
arrow was chosen for — the only shape in the set with a direction and a diagonal axis — and
`pickupArt.ts` draws the same bolt so the two paths do not drift.

The related half: `text, letters, numbers` had been cut from `COMMON_NEG` on the reasoning that
`glyphSuspectPct` was measured meaningless in the parent project and that nothing here asks for a
sign. Both halves were true and the conclusion was still wrong — a **coin** is the one subject whose
defining feature is that something is struck into its face. It lives in `PICKUP_NEG` now.

### ⚠ A pickup now carries nothing behind it, and two contrast devices were removed to get there

Both were argued for correctly and both were reported by a player the first time they were seen on a
real frame. The argument each time was the same and it is a good one: a pickup has to separate from
grey road, green grass and pale sand alike, and the eight biomes make every one of those the
background at some point.

- **A shared dark disc** was the first answer. Its first values were fixed by looking at the running
  game — at alpha 205 under a 0.72 glyph fit a coin read as a dark hole in the road with something
  small inside it — and even corrected it was a plate under every icon.
- **A bright rim** replaced it: dilate the alpha, subtract the original, paint the ring near-white.
  A morphological outline rather than a stroke, so it follows a bunch of grapes as exactly as it
  follows a disc. On a bright world it does something worse than the disc did — it puts a **white
  halo** round every pickup, and at the size one is actually read the halo is most of what is there.
  Reported as "there is a white background around the icons".

What carries the separation now is what the object already has: **its own ink contour** from the
render, **its saturation** (the pickups average 69% against the obstacles' 13%, and only the mascot
and the rewards are allowed to be saturated at all), and **the hard-edged ellipse shadow** under it,
which is the one mark on the ground that means "something is above this spot". `GLYPH_FIT` went to
0.98, since there is no longer a ring to leave room for.

**The standing rule, paid for twice in one round: a contrast device is judged on a frame, not on the
argument for it.**

### ⚠ Two boundary bugs, both caught by checks that already existed

- **`verify:mattes` failed six of the first sixteen built files** at 11–62 px under the alpha floor.
  The build cleared `byte < round(0.06 * 255)` = 15 while the check fails `byte / 255 < 0.06`, i.e.
  15.3 — so **exactly one alpha value survived the build and failed the check**, and it did so on
  some files and not others, which reads exactly like a defect in the sprites. Compared as floats
  against the same constant now.
- **Starting `RunScene` before the loader finishes silently replaces every PNG with a placeholder.**
  The generators guard on `textures.exists(key)`, which is correct; force-starting the scene early
  under the stepping harness means the key does not exist yet, the placeholder is drawn, and the
  arriving image is skipped. Diagnosed by reading `texture.source[0].source.constructor.name` —
  `HTMLCanvasElement` versus `HTMLImageElement` is the only thing that tells the two apart, since
  the placeholder is drawn in the same palette as the art. **A harness artefact, not a game bug**,
  but the check is worth knowing: it is the only way to prove art actually reached the frame.

### ⚠ A dozen sprites shipped with the render's own plate still attached

Found on the finished set, on mid grey, **after every number in the pipeline had passed** —
`canvasEdgeOpaquePct` was 0.0% on most of them, because that metric asks whether the SUBJECT
touches the frame and the plate is what the generator's matte left inside the alpha box. Over a
bright sky it reads as a translucent rectangle around the object, which is exactly how a player
reported it in the parent project.

`strip_plate` is ported from that project and removes it: a flood of bright, near-neutral pixels
**connected to the frame edge**. Border-connected is the whole safety argument — a white highlight
inside the subject is enclosed by it and unreachable, so it survives. It runs **before the trim**,
which is the one thing this port had to get right that the original did not face: the trim crops to
the alpha box, and the plate is opaque, so trimming first crops to the plate rather than to the
subject.

It removed 3 to 33,000 pixels per sprite, and numbers that size have to be looked at rather than
trusted — a flood can eat the thing it is cleaning around. Checked on the contact sheet: the willow
kept its whole canopy, the tumbleweed its whole tangle. What it correctly does **not** take is
`for_mushroom`'s violet ground pool, which is a coloured cast shadow and outside a near-neutral
test.

**Never run on the pickups.** They are composited onto a bright rim over a dark disc, and "bright
and near-neutral connected to the edge" is a description of that rim.

### ⚠ Four things a player reported after the round shipped

**Props floated, and the cause was an ordering bug in this build step.** `trim()` crops to the
alpha box and ran on the raw matte, where a soft cast shadow survives at a few percent alpha — so
the crop box INCLUDED it. `floor_alpha` then cleared those pixels, leaving genuinely empty rows
along the bottom of a canvas already sized to hold them. A billboard is bottom-anchored, so the
game planted the empty band on the ground and the prop hovered. Measured: **9 of 52 decor sprites
carried up to 12 empty rows, 9.9% of their own height.** Fixed by trimming a second time *after*
the floor; 0 of 52 now.

**The plate test had no upper bound, and it ate the `ruins` biome.** Widening `strip_plate` to
catch the two residues the magenta sheet showed — a pale halo and a dark cast-shadow ellipse — was
written as `value >= key_v - drop`, which is *every neutral pixel brighter than a threshold*. On a
biome whose whole brief is cream marble the flood walked out of the plate and into the subject:
`rui_column`, `rui_obelisk` and `rui_statue` all came back eaten. It is an **interval** around the
sprite's own measured plate colour now — bounded both ways, so marble at value ~210 against a plate
at 162 is outside it while the plate's own drift across the set (#838280 to #a3a3ab) is inside.

Two things make the widened test safe, and neither is the threshold: it is keyed off the
`keyColor` the generator **measured** from that render's own border ring and wrote into its
sidecar, so it is per sprite rather than per guess; and it is still border-connected, so a subject
that does not touch the frame edge cannot be reached however neutral it is.

**"Some textures don't damage" is not a collision bug, and the measurement is what says so.** A
scripted run down the centreline was instrumented to count every obstacle whose interval actually
overlapped the snail's body and compare that to damage events: **3 overlaps, 3 damage events, dead.
Nothing was missed.** What the report is about is the `overhead` class, which by design does not
touch a grounded snail — you run under it — and the art had stopped saying so. `overhead.yLow` went
250 -> 330, which is what puts visible daylight back underneath it.

**Scenery read as see-through, and `MAX_BILLBOARD_FOG` was the reason.** 0.30 was set against a
near-black palette, where taking 30% of a prop's alpha away over a dark ground changes very little.
Over a pale flagstone road and a bright sky the same 30% is the sky showing through a mushroom. Now
0.12. The build's own `DESATURATE` went to 0 in the same pass: the parent desaturated so a multiply
tint had authority over art authored muted, and this art is authored vivid on purpose — every step
of it was throwing away the thing the render was made for.

### ⚠ A mountain range cannot be a billboard at all

Three rounds, and the first two failed in **opposite** directions, which is what finally named the
real property.

The skyline shipped as the far tier of `DECOR_TIERS` — the same machinery as a tree, at 20-34
half-widths and 2.6x scale. Reported: mountains pile up incoherently at the edges of the frame and
then a whole one vanishes at once.

- **Round 1 measured the cull and found it innocent.** Instrumented in the running game over 900
  frames, every genuine off-screen exit happened with a **median of 1% and a maximum of 2%** of the
  sprite's width still inside the frame. (Five *simultaneous* disappearances in the same capture
  were the run ending, not the renderer; a probe that tracks instances has to be able to tell those
  apart.) Nothing was disappearing early. What was wrong is that the object arrived at all: **a
  lateral offset decides the nearest distance at which something is still inside the frame**, so at
  20-34 half-widths a range was only ever in view while it was also the largest thing on screen
  (871px of a 1568px frame for `mtn_crags` at its exit) and then slid out.
- **Round 2 pulled the offsets IN and faded the range out before it could grow** — confined to
  `n` in `[170, 300]` with a crossfade at each end. `verify:road` proved it: the skyline left the
  frame at **alpha 0.000** against **1.00** for the old offsets, and it was still wrong. Reported
  immediately, and correctly: *now even the one dead ahead disappears.* Of course it does — a fade
  removes an object where the player is looking at it, which is worse than removing it at the edge.
- **Round 3: there is no arrangement that works, because the premise is wrong.** Everything standing
  on the ground in this projection eventually arrives at the camera. The property a horizon needs is
  that it does not approach, and no billboard has it.

So the range is a **fourth `TileSprite` layer in `Backdrop`** (`SKYLINE_LAYER`), beside the three
sky layers that have worked this way since the plates landed: the parallax is a texture offset, so
a strip that has scrolled a thousand pixels costs what one that has not costs. It never approaches,
never grows, never has to be culled and never has to be faded. `src/road/track.ts`'s far tier goes
back to drawing the verge's own props 2.6x bigger, which is what it was before mountains existed.

- **The strip is composited once, at build time**, by `build_skyline` in `scripts/build-sprites.py`
  from the same three renders, into a 2048x384 texture that wraps horizontally — each peak is also
  drawn a strip-width either side, which is what makes the tile actually wrap rather than merely
  look symmetrical. Three rows, each smaller and hazier than the one in front: **aerial perspective
  is why there is more than one row**, since a single row of silhouettes is a cardboard cut-out.
- **⚠ `tileScaleX` and `tileScaleY` are the same number, and that is the whole difference between
  this layer and a sky plate.** A plate is horizontal structure only, so the sky layers stretch it
  vertically to fill the frame for free. A mountain has shape in both axes: scale the two apart and
  the peaks come out as spires — exactly the defect that got `day_v5`'s clouds re-picked. The strip
  keeps its aspect and repeats horizontally as many times as the frame needs.
- **⚠ The sprite is exactly one vertical repeat tall, and that is what put a line across the sky.**
  A `TileSprite` tiles in **both** axes, so the filter samples across the wrap at the top edge and
  blends the texture's last row into its first — and the last row is the range's feet. It drew as a
  faint dark rule right across the sky a couple of hundred pixels above the horizon. Fixed in the
  texture (`SKYLINE_FOOT_PAD` clears the bottom rows) rather than in the layer, so the blend is
  transparent against transparent. Found by looking at a frame; no number in the pipeline sees it.
- **⚠ The biome's own colour is the wrong colour for a horizon**, and the first strip proved it: at
  full tint the forest's green turned the range into a hedgerow. `SKYLINE_TINT_MIX` pulls it 62%
  back towards the theme's own horizon band — aerial perspective again, which is why distant hills
  read blue-grey whatever they are made of. The biome still steers the hue, and the haze wins.
- **The first strip was also a hedge for a second reason: 54 peaks.** At the band's scale each came
  out about 45px wide on a 1568 frame. 31 peaks, and a band 0.30 of the frame tall rather than 0.19.
- The feet are buried under the horizon (`sink`), because a range whose bases are all *drawn* at one
  row reads as a row of standing objects rather than as terrain. The layer therefore does **not**
  answer to camera height either: the sky's vertical term is a texture offset inside a full-height
  sprite and can never expose an edge, while lifting this one by a hill's worth of camera height
  would lift those feet into view.
- **⚠ And then it ran, because the parallax factor was a guess about a quantity nobody had
  measured.** `tilePositionX = driftX * 0.55` was written beside the sky's own 0.04-0.26, on the
  reasoning that a range is nearer than the sky and must lead it. The reasoning is fine and the
  units are not: `horizonDriftX` is the curvature integrated out to the draw distance, in **world**
  units — it swings **±90 000** over a lap and changes by **45 400 per second** at
  `MAX_ATTAINABLE_SPEED` on the worst bend. At 0.55 that scrolled the strip about twelve
  tile-widths a second. Reported as the mountains running, and running faster the faster you drive,
  which is exactly what a factor on a speed-proportional quantity does.
  - **The sky survives the identical quantity at 0.26 only because a gradient has no feature that
    can be seen moving.** That is why nothing had ever caught it, and why copying the sky's number
    was the wrong instinct: the constant is safe there for a reason that does not transfer.
  - `SKYLINE_LAYER.driftPixels` is now stated as **screen pixels per world unit of drift** and
    divided by the tile scale in `update`, because `tilePositionX` is in texture pixels — a bare
    factor meant one thing at one viewport height and another at the next, which is half of how the
    first value went unnoticed. At 0.0012 the worst bend moves the range **54px a second** and a
    whole lap shifts it **218px**, about an eighth of a frame. Measured live at 6px/s on an ordinary
    stretch.
  - `verify:road` holds it to a budget measured off the real circuit, at the boosted speed rather
    than at `SPEED_CAP` — "it goes faster the faster I drive" is the report, so the check has to
    ask about the fastest the game gets. It is shown to reject 0.55, at fifty times the budget.
  - **The strip went 2048 → 3072 wide in the same pass**, because at 2048 the tile came out ~1240
    screen px against a 1568px frame: the frame held one whole copy plus a quarter of the next, and
    that quarter is the same peaks again. The check asserts the tile is wider than the frame at
    every supported aspect and prints the tightest (1.00x at 3440x1440, which is the limit — the
    arrangement holds up to an aspect of 2.4).
- **What it gives up, stated rather than hidden:** the range answers to the track's curvature and to
  nothing else, so cresting a hill does not move it. The sky has always had that limitation and
  nobody has ever reported it.
- 331KB, quantised like the sky plates and for the same reason — 2048x384 of flat cel bands is
  nearly all palette, and it saves at 391KB untouched.

### The sun, why it does not move, and what about it does

`SUN` and `ensureSunTexture` in `Backdrop.ts`. A generated radial-gradient canvas, per theme, on the
same lifecycle as the vignette — `applyTheme` removes the previous theme's and builds the new one,
and `layout()` re-points the `Image` every pass so a theme swap self-heals rather than leaving it
holding a destroyed texture. **Zero bytes**, and verified live across all seven themes with exactly
**one** `sun-*` texture alive at the end.

- **⚠ It is pinned to the frame, and that is a property of the projection rather than a
  simplification.** `projectInto` puts a point at `screenWidth / 2 + scale * (x - cameraX) *
  screenWidth / 2` and `scale` goes to zero with distance — so **every** infinitely distant point
  projects to the exact centre of the frame, at every camera position. This projection has no way to
  represent a *direction*, only a position. Two consequences: an object at infinity cannot drift when
  the road bends, and its place in the frame cannot be derived from an azimuth, so `SUN.x`/`SUN.y`
  are a composition decision and are written as one. (This is also why the sky layers scroll at all
  — they stand in for haze at a finite distance, not for anything at infinity.)
- **Drawn in the theme's own `glow.color`, not in a colour of its own**, which is why it needed no
  new palette entry and passes the threat sweep for free: the glow *is* the horizon bloom, i.e. the
  light this sun is the source of, so the two cannot disagree. A cool night glow makes the same
  object a moon with nothing branching on it — confirmed by screenshot on `night`.
- **Two gradient stops close together, not one long ramp.** A sun is an object with an edge and a
  single falloff draws a fuzzy ball with none; the first version was exactly that, a pale dot. The
  core is also pushed towards white (`SUN_CORE_WHITEN`) because a sun's disc is white-hot and its
  *halo* carries the colour — flat-tinted, the whole thing reads as a sticker. The gap between the
  two stops is what "cartoon" means here mechanically: wide is an airbrushed glow, narrow is a
  drawn shape, and it was tightened to 0.32..0.35 for exactly that.
- Sized off the frame's **height**, because the sky is a share of the height: measured off the width
  it would be a pinhead on an ultrawide frame and half the sky on a portrait phone. Placed off-centre
  and high for what is around it — the distance readout is centred at the top, the shield pips sit
  top-left, and the range tops out around 0.32 of the frame.
- **It has rays now, and they are the one part of it that is a shape rather than a gradient.**
  `SUN_RAYS`: twelve spikes, alternating long and short, drawn as tapering trapezoids under the
  disc. Four things about them are arithmetic rather than taste, and `verify:road` holds each:
  - **The count is even.** The lengths alternate, so an odd count puts two long rays next to each
    other where the ring closes.
  - **Every root starts inside `SUN_DISC_STOP`** and the disc is painted over them. A ray that
    began outside would show its own base as a hard edge floating just off the sun, which reads as
    a crack rather than as light.
  - **`tipTaper` is 0.46, not 0.** A ray that comes to a point reads as a lens flare — an artefact
    of a camera, which this world does not have — and a blunt one reads as drawn. Paired with an
    alpha held near full to 0.72 of the ray's length: a gradient that falls away from the root
    makes every spike taper to nothing whatever its width says, which is the starburst the
    trapezoid was chosen to avoid.
  - **The spikes have to stay separate**, so the half-angle is checked against the spacing rather
    than trusted. 19 degrees wide with 11 between, and the check is shown to reject twice the rays
    at the same width.
- **⚠ Two whiten constants, because one of them made the disc white and a white disc is not a
  cartoon sun.** Pushed to 0.72 everywhere the sun came out bright and colourless — brighter, which
  was the ask, and reading as a bare bulb with the rays the only warm thing left in it.
  `SUN_CORE_WHITEN` (0.84) keeps the hot centre and `SUN_RIM_WHITEN` (0.34) leaves the disc's own
  rim most of the theme's colour, so it is yellow with a white core. That gradient across the disc
  is what a drawn sun has and a photographed one does not.
- **⚠ Growing the sun pushed it off the edge of a portrait frame, and nothing but a sweep would
  have found it.** `SUN.x` is a fraction of the WIDTH and `SUN.size` a fraction of the HEIGHT; at
  390x844 the drawn image is 253px against a 390px frame, so a centre at 0.76 of the width put its
  right edge 33px outside. It fit before only because the sun was smaller. `sunCenterX` clamps the
  centre rather than shrinking the sun or moving `x` inwards for everyone — both of those pay for
  the narrowest frame on every other one — and `verify:road` asserts that at least one supported
  aspect still needs the clamp, so it cannot go dormant unnoticed.

#### ⚠ It moves now, and the disc is the half that does not

`SUN_ANIM` and `sunShimmer` (pure, `verify:road`). The sun was one baked texture and read as a
sticker; it is two, and the split is the whole feature. **Turning the disc does nothing** — it is
radially symmetric — and **breathing it is a sun that changes size, which reads as one that is
approaching**, and this one is at infinity by the projection's own arithmetic. What may move is the
*light*: the corona sweeps, lengthens and flares, and the body it comes out of holds still.

So `sun-<theme>` is the disc and its halo, and `sun-rays-<theme>` is the corona, drawn behind it at
`SKY_DEPTH + 0.45`. Compositing is unchanged: the single canvas painted the rays and then filled the
gradient over them with source-over, and two images stacked in that order is the same operation —
which is also what keeps the roots hidden under the opaque core.

Three motions, and each is a different kind so no one of them carries it:

- **A slow turn**, 5 degrees a second. The rays alternate long and short, so the pattern repeats
  every 60 degrees — 12 seconds — and what the eye catches is a sweep rather than a rotation.
- **A breath**, on **two incommensurate periods rather than one**. A single sine is a mechanism: the
  eye finds the period in about three cycles and the sun starts reading as a pulsing lamp instead of
  a burning thing. 4300 and 6700 have a common multiple of **288 seconds**, so nothing a player sees
  repeats — asserted, rather than trusted to the two numbers looking unrelated.
- **A glint**, one every 7.9s for 520ms, peaking 17% over the resting corona. It is **a surge of the
  light, never a star or a streak**: a four-point sparkle is a lens flare, i.e. an artefact of a
  camera, and this world does not have one — the same rule that made the rays blunt trapezoids
  rather than points. A half-sine over its own window, so there is no step into it or out of it; a
  linear ramp shows its corners and reads as a light being switched.

Measured over 90 seconds at 60Hz: corona **0.94..1.20** of its size, alpha **0.77..1.00**, disc
within **1.2%**, and the turn never steps more than half a degree in a frame.

- **⚠ The clock is accumulated frame time, not a wall clock**, and it is clamped at
  `MAX_SUN_STEP_MS`. A backgrounded tab hands back a multi-second delta; on `Date.now()` the corona
  would jump a quarter turn on the frame it comes back, which is the one frame the player is taking
  in the whole picture at once. Same clamp and the same reason as `stepDebris`'s.
- **It is advanced from `WorldView.advance`, not from `render`.** A paused scene renders and does not
  advance, which is what stops the sun turning behind a result panel.
- **⚠ And every scene flared in its own first half-second until `glintOffsetMs` existed.** The clock
  is per-backdrop and a run builds its own, so the menu's handover — deliberately a fade of the
  interface over a world that does not cut — would have had the sun flaring on the frame the run
  began, which is the single discontinuity that handover exists to avoid. The first glint is 3.9s
  in, and `verify:road` asserts a scene does not flare inside its first two seconds.
- `sunShimmer(0)` is exactly at rest and negative time returns the same thing, so a clock running
  backwards under the stepping harness cannot extrapolate the animation — the clamp `progress01`
  carries for the HUD, for the same reason.

- **Known and accepted: on `night` this stops reading as a moon.** Rays are a sun's mark, so the
  cool blue orb the old soft ball gave that theme is now a radiant star. Nothing branches on the
  theme and nothing should — the alternative is deriving ray length from the glow's own luminance,
  which is a mechanism for a look nobody has asked for. Recorded rather than hidden.
- Depth sits between sky layer 0 and layer 1, so the haze bands pass in **front** of it. A sun with
  the haze behind it is a lamp stuck on the glass.

### ⚠ Every hollow-log render has now been pulled, and the bore is what fails

Reported by pointing at it, three times, at three different assets. The Kenney model (`log_large`)
is hollow and the render squares the bore off into a dark rectangle in the end face, so at the size
one of these is read the object is a brown box with a black doorway in it — a crate or a pipe.

**`decor-coa_drift` was kept the first time on the reasoning that a *hexagonal* bore reads as a log
where a square one does not. That was wrong, and a player settled it.** The third rejection was
`obstacle-overhead-0`, which is the same render standing across the road as the class you run
under; the report was a photograph of two of them.

All three are gone: no PNG, and for the two decor keys no entry in `DECOR_TEXTURES` and no place in
a biome's prop list either. **`obstacle-overhead-0` keeps its key** — `overhead` is a mandatory
class and its procedural silhouette carries the whole read anyway, a bar in the air with empty road
drawn under it — and `Preloader` iterates `OBSTACLE_ART_KEYS` rather than every key, because a
deliberate gap must not spend a loader 404 on every boot. See `PULLED_ART`.

**The rule this leaves: the fix is a solid end face, not a different bore shape.** Anything
re-rendered from a hollow model needs the bore capped before it is picked, whatever polygon it is.

### What the numeric gates still cannot see

Every failure above was found by looking. `canvasEdgeOpaquePct` passed the jewellery ring, the
wrong-way arrow, the snail on a lily pad and the wet-plastic boulders; `deltaE` scored a failing
palette and a passing one the same. The standing rule holds and is now paid for a fifth time:
**measure what is measurable — alpha, footprint, aspect, reserved pixels, confusion — and look for
what is not, on a background that hides neither dark paint nor a pale plate.**


## The Difficulty Curve

`src/run/difficulty.ts` — a pure function of **distance, never of time**. A time-driven curve
punishes the player for going slowly, which in this game means punishing them for having been hit on
top of the speed they already lost. Four knobs (density, the unjumpable share, the overhead share, and how often
a row is a wall), all rising, all saturating exponentially: a ramp would need a distance past which the road stops
responding, and any such number is a promise an endless mode cannot keep.

**What does not move is `REACTION_MS`.** The placer's row spacing is floored against it at
`MAX_ATTAINABLE_SPEED`, so no setting the knobs can take produces a row the player was not shown in
time. If the curve ever wants something the floor forbids, the curve is what changes.
`verify:obstacles` simulates 500 runs across six distance bands and prints the table:

```
   distance  density  blocking  overhead  jump-only   rows/90k   min gap   reaction budget
         0m     0.53      0.10      0.06       0.23       10.5      37.2seg           1293ms
       450m     0.68      0.11      0.07       0.24       13.1      29.3seg           1018ms
       900m     0.78      0.12      0.08       0.27       15.7      24.5seg            851ms
      1800m     0.87      0.12      0.09       0.29       19.2      19.8seg            689ms
      3600m     0.91      0.12      0.09       0.30       21.8      17.5seg            607ms
      7200m     0.92      0.13      0.09       0.29       22.2      17.1seg            594ms
```

(`blocking`/`overhead` are shares of all obstacles, so walls — which are made of `low` — dilute
them; the share of *non-wall* obstacles that are unjumpable is roughly three times those figures.)

**⚠ Layouts are generated one lap at a time and *handed over* a segment at a time.** The renderer
and the collision both index by *segment*, so a layout laid across a distance longer than the lap
puts two obstacles on the same piece of ground — but regenerating on the wrap, which is what this
used to say, rewrote a fifth of the road in view. See "Nothing Already On Screen Is Ever Rewritten". The whole curve fits inside one lap (`DIFFICULTY_TAU_Z` is
90 000 units against a 286 800-unit lap), so a run is at 96% of the ceiling by the time it first
wraps and every later lap is generated at the saturated end — the seam is not a difficulty step
because there is nothing left to step to.

The biomes do the rest for free: the run circuit cycles through eight of them along the track, so a
long run *looks* like progress without the difficulty having to carry that job as well.

## The End Of A Run

`src/scenes/RunOver.ts`, launched over the paused run — the same overlay shape `Settings` and `Shop`
use, and registered in `platform/lifecycle.ts`'s `OVERLAY_SCENES` for the same reason.

- **Paused, not stopped.** The panel is drawn over a frozen road rather than over black: the world is
  what the player was just in, and cutting to an empty background makes the run feel deleted rather
  than finished.
- **The score and the coins are banked first, before anything else can go wrong.** They are the only
  things a run produces, and an ad or a scene change between earning and saving them is a run played
  for nothing.
- **This is the only place an ad may appear.** An interstitial mid-run in a game whose whole subject
  is momentum is the worst possible interruption, and a rewarded ad offered mid-run would make the
  reward a reason to die. `platform/adPolicy.ts` limits it further by session count, gap and a
  first-run grace period, and the policy state is `static` because a scene is rebuilt every run while
  the session is not.
- **Every rewarded offer has a non-ad alternative.** The coin-doubler's alternative is the run itself:
  the coins are already banked, and the ad doubles them. A player who never watches one is slower,
  never blocked.

## The HUD

`src/run/Hud.ts` — **five readouts, rebuilt against a reference the player supplied; see "Four
Things From One Screenshot" for what each is and why.** Three, against the rail shooter's eleven. That game's HUD carried shields,
score, a multiplier, a wave banner, a lock counter, a boss bar and a weapon row, and every one existed
because the fight had a state the frame could not show. A runner's state is almost all visible: speed
is the ground moving, position is the snail, what is coming is on screen. What is *not* visible is the
number the run is scored in, how much carelessness is left, and whether the boost is still running.

- **Distance is shown in metres, a hundred world units to one.** The raw number climbs by 3600 a
  second at top speed, and a counter whose last three digits are a blur is a counter nobody reads.
- Lives are pips rather than a count: a number is something to read, a shape is something to glance
  at, and glancing is all the player can afford mid-run.
- The boost meter is hidden when there is no boost. A permanently empty gauge is a permanent question.
- Everything sits in the top band `ui/menuLayout.ts` reserves, so it appears into rows the menu
  deliberately leaves empty — which is what lets the handover from menu to run be nothing but a fade.

## Road Renderer

`src/road/` draws the pseudo-3D ground strip. There is no real 3D geometry: the surface is a band of
projected trapezoids, and everything else (from chunk 5 onward) is billboard sprites.

**The game changed genre after chunk 3, from a racer to a rail shooter.** `src/road/` was written
for the racer and survived the change essentially untouched — the "road" is now just "the ground",
which is a palette question, not a geometry one. **RAILS-PLAN.md supersedes RACER-CHUNKS.md from
chunk 4 onward**; RACER-PLAN.md remains the record of how chunks 1-3 were built.

- **⚠ `Mesh2D` exists in Phaser 4.2.0, despite what the bundled skill says.**
  `.claude/skills/v4-new-features/SKILL.md` states that `Mesh` and `Plane` were "Removed" in Phaser
  4. That file predates 4.2.0 and is wrong for this project: `Phaser.GameObjects.Mesh2D` and the
  `this.add.mesh2d(x, y, texture, vertices, indices, flipV?)` factory both exist (confirmed in
  `node_modules/phaser/types/phaser.d.ts` and `node_modules/phaser/src/gameobjects/mesh2d/`). Do not
  "fix" the road by falling back to `Graphics` on the strength of that skill file.
- **Buffer formats.** `vertices` is flat with a stride of **4** (`x, y, u, v`); `indices` is flat with
  a stride of **4** (`a, b, c, page`, `page` always `0`). One quad is therefore 4 vertices (16 numbers)
  and 2 triangles (8 index entries).
- **Topology is built once; only vertex positions move.** `RoadMesh`'s constructor allocates
  `DRAW_DISTANCE * 3` quads (asphalt + two rumble stripes per segment), fills `indices`, and calls
  `buildOrderedIndices(2, true)`. `render()` writes only into `mesh.vertices`. **The second argument to
  `buildOrderedIndices` is load-bearing**: `useOrderedIndices` defaults to `false`, so building the
  ordered list without setting it leaves the mesh silently submitting one degenerate quad per triangle
  instead of one quad per quad. `renderAsTriangles` stays `false` so the mesh batches with ordinary
  sprites — which matters from chunk 4, when billboards arrive.
- **Quad winding.** Vertices per quad are `v0` far-left, `v1` near-left, `v2` far-right, `v3` near-right,
  with triangles `(v0,v1,v2)` and `(v1,v2,v3)` sharing the `v1-v2` edge. `buildOrderedIndices` detects
  that shared edge and emits `p,q,r,s = v0,v1,v2,v3`, which the renderer consumes as TL, BL, TR, BR. Any
  new quad added to the mesh must use the same winding or it will not pair into a single quad.
- **A culled segment must be degenerated, never skipped.** The index list has a fixed length, so a
  skipped segment does not shift anything — it just leaves last frame's geometry on screen. Culled
  segments collapse all four vertices onto one point and the rasteriser drops the zero-area triangles.
- **Cull on `!Number.isFinite(scale) || scale <= 0`, not on sign alone.** When a segment's near edge sits
  exactly on the camera plane, `scale` is `+Infinity`, which passes a `> 0` test and writes `NaN`
  coordinates into the buffer. This is reachable on the very first frame, where `cameraZ` is `0` and the
  base segment's `p1.z` is also `0` — not a theoretical edge case.
- **Colour and distance fog both travel through one texture, not a tint.** `Mesh2D` has no per-vertex tint component (it has a
  single object-wide `tint`), so `palette.ts` bakes `ROAD_PALETTE` into an `N x 1` `CanvasTexture` and each
  quad selects its colour by UV. Two requirements, both mandatory: the texture is `FilterMode.NEAREST`, and
  `paletteU(i)` samples the **centre** of texel `i` (`(i + 0.5) / N`), never an edge. Without them a quad's
  colour can pick up its neighbour's along the edges, and the rumble stripes appear to swim — which looks
  like a projection bug but is purely texture sampling. Verified against real framebuffer readback: every
  quad's interior is an exact palette colour; the only blended pixels are 1px-tall MSAA seams between
  adjacent quads (the WebGL context has `antialias: true`) plus the far-field band just under the horizon,
  where many segments compress below one pixel each.
- **Authoring a track: `TrackBuilder` only.** `new TrackBuilder().addStraight(...).addCurve(...)
  .addLowRollingHills().addSCurve().build()`. Nothing else may construct a `Segment` by hand —
  `build()` is where the two loop-safety properties are established, and neither is something an
  individual section can do for itself:
  - **Height is returned to zero**, by appending a closing section if the composed sections did not
    already end level, then *asserted* (`|last.p2.y| < 0.01`). The track wraps in `z`, so a non-zero
    final height teleports the camera vertically by the whole accumulated height in one frame, once
    per lap. Curvature needs no equivalent — it is integrated forward from the camera every frame and
    never carries across the seam.
  - **The segment count is padded to a whole rumble cycle** (`RUMBLE_LENGTH * 2`), so
    `buildStraightTrack(500)` returns 504. Without it the band entering the seam and the band leaving
    it share a colour and the stripe rhythm visibly stutters once per lap. Padding runs *after*
    closing, so the added segments are flat and cannot reopen the height gap.
- **`ROAD_HILL` values are in units of `SEGMENT_LENGTH`, not world units** — `ROAD_HILL.MEDIUM` is a
  rise of 8000, not 40. A section's gradient is therefore `height / lengthInSegments`; keep a section
  at least ~4x its height in segments or the road becomes a wall. The composite presets spend
  `SECTION_PHASES` (3) `ROAD_LENGTH` presets per section for exactly this reason, which is why
  `addSCurve()`'s default arm is `ROAD_LENGTH.MEDIUM * 3` rather than `ROAD_LENGTH.MEDIUM`.
- **Hills are baked geometry; curves are not.** `p1.y`/`p2.y` are real world heights resolved at build
  time by `easeInOut` — whose *zero derivative at both ends* is the point: a linear ramp would meet the
  flat road either side with a discontinuous slope and render as a visible crease. `p1.x`/`p2.x` stay
  zero forever; a segment's `curve` is stored verbatim and integrated at render time instead.
- **Curvature integration lives in `RoadMesh.render`**, as `x += dx; dx += segment.curve`, with the near
  and far edges of each segment projected at *different* camera-x values (`-x` and `-x - dx`) — that
  difference is the bend. Two things are easy to get wrong here: `dx` must start at
  `-(base.curve * basePercent)` so the road does not jolt sideways as the camera crosses a segment
  boundary, and the accumulation must run for **every** segment before any culling, or the far half of a
  curve straightens out the moment its near half falls off the bottom of the screen.
- **The camera rides the road surface**: `cameraY = surfaceHeight(base, basePercent) + CAMERA_HEIGHT`.
  Holding a fixed height instead makes the camera plough through the inside of a hill and float over a
  dip. Verified as exactly `CAMERA_HEIGHT` of clearance at every point of a full lap.
- **Hills need a third cull condition: `s2.y >= s1.y`** (the far edge projected *below* the near one, so
  the segment is inside-out on screen). Unreachable on a flat track, reachable just past every crest
  once hills exist, and it renders as a bow-tie if drawn.
- **Pure vs. Phaser-touching.** `project.ts`, `track.ts`, `billboard.ts` and `constants.ts` import no
  `phaser` and are covered by `npm run verify:road`; `palette.ts`, `decor.ts`, `RoadMesh.ts`,
  `RoadSprites.ts` and `RailScene.ts` do and are not. Keep new pure logic on the testable side of
  that line.
- **`groundYAt(track, z)`** gives the ground height at any track-space `z`, wrapping the loop. The
  renderer already interpolates this internally to keep the camera on the surface; the exported
  version is for anything that has to *stand on* the ground. From chunk 6 that is every enemy —
  their world `y` is this plus their own height, and without it they sit at a fixed altitude and
  sink into every hill.
- **The perf harness discards its own first 60 frames, by construction.** `PERF_WARMUP_FRAMES`
  in `RailScene.recordRenderCost`, reset on scene start *and* in `layout()` so a resize restarts
  it too. This is not caution: a measurement taken across a scene start read **4.7ms median /
  45.8ms p95** against a true 1.3/2.7, because textures were still uploading and every render
  path was cold. That reading was correctly thrown away by hand — which is exactly the problem,
  since the next person to measure has to remember the same thing. A guard that lives in the
  harness cannot be forgotten; one that lives in a habit will be.
- **Measuring `render()` cost.** `RailScene` has a DEV-only reporter (`window.__roadPerf` and
  `window.__decorPerf`, also logged) that prints after 300 frames. **Compare `batchedPerFrameMs` across
  chunks, not `medianMs`**: `performance.now()` is clamped to ~100us in a page that is not cross-origin
  isolated, which is coarser than a single `render()` call, so the per-frame percentiles are quantised
  to 0.1ms and only bound the cost from above. Never substitute an fps counter — a backgrounded Chrome
  tab throttles rAF (and in a fully hidden tab suspends it outright), so the number would say nothing
  about render cost.
  - **Driving the game by hand is how these get measured under automation.** A tab opened by browser
    automation usually reports `document.visibilityState === 'hidden'`, so rAF never fires and the
    frame-count-triggered report never prints, however long the script waits. Stepping the loop
    directly (`window.__game.loop.step(t)` in a loop, with a synthetic 60Hz `t`) runs real frames
    regardless. Note also that the automation harness evaluates JS in an *isolated world*, so
    `window.__game` is invisible to it — inject a `<script>` element and hand results back through a
    DOM attribute.

## Billboards & Scenery

`src/road/billboard.ts` + `decor.ts` + `RoadSprites.ts` draw everything standing on the ground.
There is no second 3D pipeline: a billboard reuses the road's own projection of the segment it
stands on, so scenery cannot drift away from the ground under it — they are literally the same
numbers. Chunk 6's enemies get their own class with the same shape (a different lifecycle, so
they must not share this pool) but the same projection.

- **`RoadSprites.render` must run after `RoadMesh.render`, in the same frame.** It reads two
  things straight out of that pass: each segment's `s1` (already carrying the integrated
  curvature — recomputing it would mean redoing a stateful accumulation and getting a subtly
  different road) and `RoadMesh.clipY`.
- **`RoadMesh.clipY` is a deliberate leak of the mesh's internals. Do not tidy it away.** It is
  the per-segment screen y below which nothing on that segment is visible — the mesh's own
  running horizon clip, recorded for *every* segment before the cull, precisely because a culled
  segment is the interesting case (it is culled because a hill hides it, and a billboard standing
  on it must be hidden by that same hill). There is no depth buffer to ask instead; the renderer
  is painter's-order throughout. Documented in both files.
- **Occlusion crops, it does not squash.** `billboardVisibleFraction` returns how much of the
  height survives, and `RoadSprites` applies it with `Image.setCrop(0, 0, w, h * f)` — shrinking
  `displayHeight` instead would slide the object down the hillside rather than sinking it behind
  it. The crop offset is `(0, 0)`, which is the one case Phaser positions correctly (same finding
  as `ui/preview.ts`'s `'cover'` fit) and the only one needed, since a hill always hides a
  billboard from the bottom up. A slot's crop must be cleared before its texture changes — crop
  rectangles are in the frame's own pixels.
- **`SPRITE_SCALE` is world units per texture pixel** (10). Both `destW` *and* `destH` are scaled
  by `screenWidth`, never `screenHeight`: that is what keeps an object the same size relative to
  the road at every viewport aspect (the road's own half-width scales the same way) and keeps the
  texture's aspect square. Using `screenHeight` for the vertical would stretch everything in
  portrait. `height` (base above the ground) is the exception — a world-space height, so it uses
  the vertical scale `project()` itself uses.
- **The pool never grows.** `RoadSprites` allocates `DECOR_POOL_SIZE` images once; a frame wanting
  more simply draws fewer. Growing on demand would turn a busy moment into an allocation spike and
  a texture-upload stall exactly when the frame is already most expensive, and would make the frame
  budget unmeasurable. Candidates are gathered **near-to-far**, so what goes undrawn is the
  farthest scenery (a few pixels tall) rather than the object about to pass the camera. Demand is
  reported (`__decorPerf`'s `peakWanted`/`framesOverCapacity`), not assumed: sweeping a whole lap
  peaks at 58 objects and barely moves with the viewport (52 at 390x844 … 58 at 3440x1440), because
  what bounds it is how many decorated segments fall in the visible band. Pool is 72.
- **Draw order is depth, and depth is the whole depth test.** Ground at `ROAD_MESH_DEPTH`
  (`-(DRAW_DISTANCE + 1)`), each billboard at `-n` for its distance index (so the nearest is 0),
  ship at `SHIP_DEPTH`. Anything new in the world picks a slot in that ordering.
- **Placement is seeded, never `Math.random()`.** `decorateTrack(track, keys, { seed })` fills
  `Segment.sprites` from `src/race/rng.ts`, and is idempotent — it rebuilds each segment's list, so
  a scene restart re-decorating an already-decorated track does not double the scenery. Reshuffled
  scenery would make two frame-cost readings incomparable and a bug report unreproducible; chunk 6's
  waves seed the same way.
- **Verified after wiring**: every world object (mesh + whole pool + ship) carries `uiCamera`'s id
  in its `cameraFilter`, i.e. nothing is drawn twice — checked mechanically at scene create under
  `import.meta.env.DEV`, since a missed `ignore()` shows up as a faint duplicate rather than an
  error. Over a full-lap sweep, 74% of placements draw whole and the rest are genuinely
  hill-clipped (7% >90% visible, 11% at 50–90%, 7% at 10–50%, 1% under 10%).
- **Cost** (1920x945, batched to clear the timer clamp): road alone 0.02ms median / 0.03ms p95;
  road + scenery 0.03ms / 0.04ms. CPU only — this says nothing about the extra draw calls, which
  is why `renderAsTriangles` stays `false` on the mesh so it can batch with these sprites.

## Player Ship

`src/rail/` is the player's ship and the input that drives it. `RailScene` owns one `Ship`,
which owns its own `ShipState`.

**The camera and the player are two separate things, and keeping them apart is the whole point
of the genre.** In the racer they were one object: the camera *was* the car, and `playerX` fed
straight into the projection. Here the camera travels the rail at a constant `RAIL_SPEED`, is
steered laterally only by the track's own curvature, and merely *leans* towards the ship
(`CAMERA_LEAN`, dt-corrected smoothing). The ship moves freely inside a box in **screen**
coordinates and cannot drive. Do not reconnect them: full following turns this back into a
racing camera.

- **`src/rail/shipMotion.ts` never imports `phaser`**, same rule and reason as
  `src/road/project.ts`. Covered by `npm run verify:ship`.
  - It is named `shipMotion.ts`, not `ship.ts`, because `Ship.ts` already claims that name on a
    case-insensitive filesystem — Windows and macOS both are, and the two files silently become
    one. (This bit during chunk 4: writing `ship.ts` overwrote the class.)
- **The ship is a damped spring towards the input point, not a teleport.** Snapping to the
  pointer reads as a cursor; the spring gives it mass. `SHIP_STIFFNESS = 60` with
  `SHIP_DAMPING = 0.85` **per fixed tick** is slightly underdamped (`zeta = 0.66`): `tau = 0.21s`,
  a 6.6% overshoot on a step, and an 85px trail behind a pointer sweeping at 480px/s.
  - **Tune them through `shipResponse()` in `src/rail/constants.ts`, never by eye.** It solves
    the shipped tick in closed form for the trail behind a drag (`lag = lambda * v / k`), the
    damping ratio and the time constant, takes hypothetical constants as arguments
    (`shipResponse(120)` answers "what would a stiffer ship give me" without touching the shipped
    value), and `verify:ship` asserts every one of those formulas against the real integrator.
  - **`lambda` is `(1 - d) / (d * dt) = 10.59`, not the `-ln(d) * 60 = 9.75` a continuous reading
    of the damping suggests.** The continuous rate is how an *undriven* velocity decays; the
    steady-state lag is set by how much velocity one tick's spring impulse must replace, which is
    the discrete rate. Using the continuous one under-predicts the trail by 7.9% (78px vs the
    real 85px at 480px/s) — small, but it is the number the constants get tuned by, and
    `verify:ship` holds the formula to 5%.
  - **`verify:ship` forbids divergence, not overshoot.** The criterion is: no excursion past the
    target exceeds 20% of the approach, and each is smaller than the last. Monotonic convergence
    (the original test) only holds while `zeta > 1`, i.e. it would have vetoed any stiffness above
    ~24 — including the shipped 60. A small overshoot is *wanted* in an action game: it reads as a
    snap rather than as mush. The test proves it still catches a genuinely runaway spring, and
    reports where the ceiling actually bites (`k = 125` at the shipped damping).
  - **`SHIP_STIFFNESS` was set by the dodge budget, not by feel — chunk 6, and it is why it is
    60 rather than the 12 chunks 4–5 shipped.** `TELEGRAPH_MS` is the player's whole window for
    leaving a line of fire, and at `k = 12` a 300px dodge was 43.2% covered when the shot landed:
    dodging was not hard, it was impossible. Measured coverage within 550ms: `k=12` 43.2%,
    `k=36` 90.6%, `k=60` 106.6%, `k=120` 99.9% (the fraction is independent of the dodge distance
    — the spring is linear). `verify:enemies` asserts the ≥80% requirement so neither constant can
    drift away from the other. Prefer raising `k` over stretching the telegraph: a slow wind-up
    makes enemies limp. The ship's two roles do pull opposite ways — weight helps it as chunk 7's
    lock-on "pencil" and hurts it as a target — but chunk 7 hit-tests along the *pointer* path,
    not the ship's, so the target role is the one that actually pays for the choice.
- **The box is fractions of the viewport** (`0.12..0.88` wide, `0.35..0.85` tall — the top of the
  frame belongs to sky and distant targets). Clamping also zeroes the velocity component pushing
  into the wall, or the spring winds up while pinned and the ship lurches when the target moves
  back inside.
  - **A resize needs `clampShipToBounds`, not a zero-length `stepShip`.** The clamp runs inside a
    tick and a zero delta runs no ticks, so stepping by zero clamps nothing. `verify:ship` pins
    both halves of that down.
- **The fixed timestep is inherited from the racer, not rewritten** — `src/race/fixedStep.ts`'s
  `runFixedSteps`, lifted out of the deleted `physics.ts`. Everything that steps per frame should
  use it. Its three hard-won details (carried remainder, `TICK_EPSILON_MS`, dropped backlog past
  `MAX_SUB_STEPS`) are documented on the function; none of them are decorative.
  - **`stepRemainderMs` is why `ShipState` has a fifth field.** The accumulator must survive
    between calls or two 8.3ms frames would each do nothing. Callers treat it as opaque.
- **Held input goes through `bindHeldAction`, not `bindAction`.** `bindAction` is for taps.
  - **Sources live in a `HeldSourceSet` (`src/platform/heldSources.ts`), never a counter.** OS
    key auto-repeat delivers a burst of `keydown` with no `keyup` between them; a counter climbs
    and the single release leaves it positive, so the input sticks on. Keying by source id makes
    a repeat idempotent. Verified with a 25-event burst followed by one release.
  - **Only the press is gated on the scene being active; the release never is.** A key released
    while paused must still release, or the action is held for the rest of the session.
  - **Focus loss clears every source** (`Phaser.Core.Events.BLUR` / `HIDDEN`, and scene `PAUSE`).
    Alt-tabbing with a key down delivers no `keyup` at all.
  - Opposed directions are two independent actions combined by `axisFrom`, so holding both
    cancels and releasing one immediately yields the other with no re-press. **"Engaged" means a
    key is down, not that the axis is non-zero** — otherwise holding left+right cancels to zero
    and the ship drifts home while the player is still holding the controls.
- **Touch and mouse are deliberately different.** A finger only points while it is down, so
  lifting it releases the ship back to rest — which is also the drag gesture chunk 7 builds
  lock-on on. A mouse keeps pointing where it was left, so hovering steers. **Chunk 9 caveat:**
  these are scene-level pointer listeners, so once a HUD exists a tap on a HUD button will also
  move the ship unless the handler learns to ignore pointers already consumed by a game object.

## Enemies

`src/rail/enemy.ts` + `waves.ts` + `enemyShots.ts` (pure, `npm run verify:enemies`) and
`Enemies.ts` + `ShotSprites.ts` + `enemyArt.ts` (Phaser). Enemies are the mirror image of the
ship: the ship lives in screen coordinates because it is where the finger is, an enemy carries
world coordinates (`z`, `offsetX` in road half-widths, `height` in road half-widths above the
ground) and is projected by the same maths as the ground it stands on.

- **Aim is committed when the wind-up *starts*, not when the shot leaves.** `EnemyContext` has
  two callbacks for exactly this: `onTelegraph` (the scene records where the ship is) and
  `onFire` (the scene builds a projectile flying to that recorded point). Aiming at the moment
  of the shot is the obvious reading of "a shot aimed at the ship's position" and it makes the
  telegraph decorative — the enemy simply re-aims at wherever the dodge took you. **This was
  measured, not reasoned about:** with aim-at-fire, a ship that had travelled 320px of a 300px
  dodge was still hit, 21px from an aim point that had followed it. With aim-at-telegraph the
  same dodge lands 299px away against an 86px hit radius.
- **The attack token is released when `firing` ends, not when the shot leaves.** Freeing it at
  the shot lets the next enemy enter its telegraph in the same frame, so two volleys arrive
  together — the count never exceeds `MAX_ATTACKERS`, and the game is still unreadable.
  `verify:enemies` pins this down with the attacker limit forced to 1.
- **`MAX_ATTACKERS = 2` is a readability limit, not a difficulty one.** A third simultaneous
  wind-up cannot be tracked, so the player stops reading telegraphs and starts guessing.
  Verified every single step of a 10 000-step run with 20 enemies, not sampled — and the test
  also asserts the limit is actually *reached*, so it cannot pass on a build that never attacks.
- **Enemies beyond the draw distance are not stepped at all**, and resuming is the part that has
  to be right. The weaver's sway is *derived* from `(id, now)` rather than integrated, so time
  passing while asleep costs nothing; the charger's approach is the one integrated motion and so
  genuinely pauses (an enemy that closed the gap while invisible would arrive from nowhere).
- **`distanceAhead` and `distanceBehind` are separate functions on purpose.** On a loop they are
  the same measurement read from opposite ends — something 100 units behind is also
  `trackLength - 100` ahead — and deriving one from the other at a call site is exactly how the
  despawn test ends up removing the entire track. `isBehindCamera`'s `trackLength / 2` bound is
  what keeps "far behind" from also matching "far ahead"; it was written without it first.
- **Enemies are projected from the segment's own two projected edges, interpolated**, not
  re-projected from `groundYAt`. Both would be "correct"; only this one is guaranteed to agree
  with the ground actually on screen, because the road quad's edges are straight lines between
  `s1` and `s2`. Re-projecting would also need the camera's integrated lateral drift at that `z`,
  which lives inside the mesh's render loop — the accurate-looking option is both more work and
  slightly wrong. Verified against the mesh's own vertex buffer: over 276 placements on a hilly
  stretch (162 on climbs, 114 on descents) every enemy's base fell inside its segment's asphalt
  quad, worst offset 0px.
- **Its own pool, not the scenery pool** (`Enemies` vs `RoadSprites`), though they project
  identically and share the `-n` depth scale so they interleave by distance correctly. Scenery is
  laid out once and never changes; an enemy spawns, is aimed at, takes damage and dies. One class
  owning both lifecycles would give every "can this slot be reused?" question two answers.
- **`ShotSprites.ts` is named that way because `enemyShots.ts` already exists** — on a
  case-insensitive filesystem `EnemyShots.ts` and `enemyShots.ts` are one file. Same trap as
  `Ship.ts` vs `shipMotion.ts`.
- **Waves are laid out once from a seed** (`buildWaves`), and `WaveDirector` tracks what has
  spawned separately from the layout, because the track loops and everything must be spawnable
  again next lap — a lap boundary shows up as the camera position jumping backwards.
- **Measured**: `Enemies.render` + `ShotSprites.render` cost 0.0ms median / 0.1ms p95 at
  1920x945 with a peak of 5 drawn, 6 live and 2 shots in the air (pools are 24 and 8). Dodging on
  the wind-up misses cleanly in 4 of 4 trials; standing still took 6 hits in the same span.
- **`damageEnemy` frees the attack token as it kills.** Losing the token with the enemy leaks
  one of the `MAX_ATTACKERS` slots per kill, and after two kills nothing ever attacks again —
  silently, because the count never exceeds its limit and every survivor simply waits forever.
- **The wind-up is drawn as a ring and a tracer, not as a colour on the enemy.**
  `src/rail/telegraph.ts` (pure, `verify:enemies`) + `TelegraphView.ts`. It used to repaint the
  whole body solid yellow, which turned an enemy into a blob the size and shape of a bush — the
  opposite of standing out. Now a ring closes from `RING_START_SCALE` onto the target's own
  radius over `TELEGRAPH_MS` (so its size *is* the time remaining), and a line runs to the
  committed impact point with a pip travelling along it.
  - **The tracer is the half that did not exist, and its absence is why dodging was guesswork.**
    The aim point has been committed at the *start* of the wind-up since chunk 6 — the
    information was always there, it was simply never drawn, so the player could see that
    something was about to fire but not whether they were standing in it.
  - **The ring eases *in* (`t * t`), not out.** The mirrored curve looks almost right and reads
    as a ring that has stopped moving before the shot lands; `verify:enemies` compares the two
    halves of the travel for exactly that.
  - `RING_START_SCALE` is held at 2.6 because `MAX_ATTACKERS` is 2: at 3.4 the two rings
    intersected at the moment they both opened, and two overlapping circles read as one shape.
  - **No timing lives in either file.** A warning that changed *when* the shot lands would be a
    balance change wearing a readability costume.
- **Damage feedback is the ship's alpha blink and nothing else** — the red frame, the shake and
  the flash are chunk 8's, and a hit with *no* feedback at all cannot be play-tested. Enemy death
  is likewise instant; chunk 8 owns the animation, and a placeholder now would be thrown away.

## Lock-On and the Volley

`src/rail/lockon.ts` + `volley.ts` (pure, `npm run verify:lockon`) and `LockOnView.ts` +
`VolleySprites.ts` (Phaser). The player presses, drags a stroke across whatever they want dead,
and releases; one homing shot leaves per mark. This is the verb of the game.

- **Everything resolves in screen space.** The drag is tested against the *projected* enemy
  rectangles — literally the ones the sprites were drawn at, taken from `Enemies.targets` — so
  the visual hit and the logical hit cannot drift apart. `LockOnView.update` therefore runs
  **after** the enemy render in the frame, not before it.
- **The hit test is the segment between consecutive pointer samples, never the samples.** A
  pointer reports positions tens of pixels apart, so a point test skips over exactly the small
  targets the player most clearly struck through — and does so more often the faster the drag.
  `segmentRectEntry` is Liang–Barsky and returns the *entry parameter*, which is what lets an
  over-subscribed stroke keep the targets it met first rather than whichever the list held.
  A zero-length segment degenerates into a point-in-rect test, which is exactly what a tap is.
- **Target rectangles are inflated to a 44px minimum before testing** (`inflateRect`, never
  shrinks). Measured live: a 17px-wide charger at the horizon, with the stroke passing 8px
  *outside* its real box, marks and takes the hit — without the inflation it is unhittable
  however precisely the player drags, and that reads as the game ignoring input.
- **A lock persists once taken.** The target moving out from under the finger does not release
  it, or a weaver would be impossible to hold. Locks are dropped only by `pruneLocks`, against
  the live enemy list — not against the visible list, which would drop anything that merely went
  off screen.
- **Locking requires the pointer to be down, on mouse as well as touch.** The ship steers on a
  bare mouse hover (see "Player Ship"), so following the same rule here would mark everything the
  cursor ever crossed. Press-drag-release is then one gesture on both devices.
- **Each shot's curve is rebuilt every frame against its target's current position** — a
  quadratic Bézier from the muzzle through a fanned control point. That is what makes a shot
  visibly lead a moving enemy, and it is why nothing is integrated: there is no stored trajectory
  that could disagree with where the hit lands. **Arrival is the only hit**; there is no
  collision test on the way, because the target was chosen when the lock was taken.
- **The fan is symmetric by construction** (`fanFactor`: shot `i` and shot `count-1-i` are exact
  negatives) and perpendicular to each shot's own flight line, scaled by its length — so the
  spread stays proportional whether the targets are at the horizon or in your face. Measured: a
  volley of 8 spreads 256px at mid-flight in the unit test and 585px in the live scene, always
  converging to exactly 0 on arrival.
- **`VOLLEY_COOLDOWN_MS` is enforced at the *start* of a stroke, not the end.** Blocking the
  release instead would let the player accumulate marks during the cooldown and dump them the
  instant it expired, which is the continuous-fire problem with an extra step. A stroke that
  marked nothing costs no cooldown at all.
- **`LockOnView.ts` is named that way because `LockOn.ts` and `lockon.ts` are the same file** on
  a case-insensitive filesystem — writing the view as `LockOn.ts` silently overwrote the pure
  module mid-chunk. That is the **third** time this project has hit that trap (`Ship.ts` vs
  `shipMotion.ts`, `ShotSprites.ts` vs `enemyShots.ts`). Any new Phaser class paired with a pure
  module of the same concept needs a distinct word in its name, not just a different case.
  `FxSprites.ts` beside `fx.ts` is that rule applied rather than rediscovered.
- **Measured**: a full 8-lock volley in flight costs 0.05ms median / 0.21ms p95 at 1920x945 for
  the whole world pass (road + scenery + enemies + lock-on + volley), batched to clear the timer
  clamp. A live drag across 5 on-screen enemies marked 4 in crossing order, fired 4, and killed 2
  (the survivors being the multi-HP charger and turret).

## Combat Feedback

`src/rail/hitstop.ts` + `debris.ts` (pure, `npm run verify:effects`) and `Effects.ts` (the
layers), plus the hit flash and death animation which live in `Enemies.render` because they are
properties of a sprite that is already being drawn. Every effect is individually switchable via
the **mutable** `EFFECTS` object in `rail/constants.ts` — mutable because the acceptance for
this work is a measured with/without table, which needs runtime toggling, and because a device
that cannot afford one of them should be able to drop exactly that one.

- **Hitstop is per entity. Never `timeScale`, never `physics.world.pause()`.** A volley strikes
  eight targets across half a second; eight global stops in a row is not impact, it is a
  slideshow — and it would freeze the ship the player is trying to fly at the same moment.
  Each enemy carries its own `frozenUntil` and `stepEnemies` skips it; everything else runs.
- **The deadline contract: anything that freezes and holds a timestamp must shift that timestamp
  by the frozen duration.** Otherwise an enemy caught mid-wind-up fires having shown less warning
  than `TELEGRAPH_MS` promises, and the harder the player shoots it the worse the promise gets.
  `addFreeze` returns the amount added precisely so the caller can do the shift (`freezeEnemy`).
  **The shift is applied when the freeze starts, not when it ends.** The plan called for an
  `onThaw(frozenMs)`; this is the same arithmetic moved to the one moment it cannot be missed,
  because a frozen entity is skipped by its own step function and there is nobody running its
  code at the instant it thaws. Verified: 200 hitstops landed inside one wind-up stretched it to
  16.6s of wall clock while the wind-up itself stayed 566ms of game time against a 550ms
  `TELEGRAPH_MS` (within two ticks).
- **Freezes compose.** A second hit mid-freeze adds another full duration rather than restarting
  or being swallowed, so two hits always cost two hitstops' worth of held time.
- **A kill freezes *before* the death plays.** `damageEnemy` sets the death deadline first and
  freezes second, so the freeze pushes the death out rather than eating it; `deathProgress`
  counts back from that deadline, so a corpse caught by a later hitstop pauses mid-disintegration
  instead of skipping through it. `isDeathComplete` refuses to remove anything still frozen —
  otherwise the frame meant to hold still is the frame the target vanishes.
- **Effects are graphics layers, not filters.** A filter is a shader pass and `Phaser.AUTO`
  decides per device whether there is a pipeline at all; a layer costs and looks the same under
  the Canvas fallback. The one exception is the shake, which is a camera transform.
- **The damage frame lives on `uiCamera`** — the first thing to do so. A full-bleed frame drawn
  on a camera that is shaking drags its own edges into view, showing black gaps at exactly the
  busiest moment. It needs the mirror `cameras.main.ignore(...)`, which is where that half of the
  two-camera contract finally gets used.
- **Known, quantified inconsistency: a shake offsets what you see from what you can hit.** Lock-on
  rectangles come from the projection, untransformed, while the sprites are drawn through the
  shaking camera — so for the ~140ms of a shake the two differ by up to `SHAKE_MAX * width`
  (17px at 1920). That is well inside the 44px hit-area inflation, so it cannot make a visually
  crossed target unhittable; it is recorded here because the arithmetic is not obvious and the
  next person to raise `SHAKE_MAX` should know what it trades against.
- **Debris allocates nothing per frame**: `stepDebris` compacts survivors in place, the pool has
  a hard `MAX_DEBRIS` ceiling, and the chunks are drawn as two `fillTriangle` calls rather than
  `fillPoints`, which takes `Vector2`s and would allocate four per chunk per frame — 384
  short-lived objects on the busiest frame in the game. The step also clamps its delta, or a
  backgrounded tab's multi-second delta would put every chunk several screens away on the first
  frame back, which reads as them simply vanishing.
- **Cost, measured on the real scene at 1920x889, worst case (8 locks, 8 kills, ~56 live debris
  chunks).** World logic pass, batched to clear the ~100us timer clamp — differences are near the
  resolution limit (~0.0125ms per sample), so read the ends, not the middle:

  | configuration | median | p95 |
  |---|---|---|
  | all effects on | 0.088ms | 0.338ms |
  | without hitstop | 0.063ms | 0.275ms |
  | without hitFlash | 0.063ms | 0.225ms |
  | without screenShake | 0.075ms | 0.338ms |
  | without debris | 0.063ms | 0.338ms |
  | without deathAnimation | 0.063ms | 0.238ms |
  | without playerDamageFrame | 0.050ms | 0.238ms |
  | all effects off | 0.050ms | 0.225ms |

  Whole frame (`loop.step`: update plus render submission), same worst case: **1.0ms median,
  4.0ms p95, 6.8ms max with every effect on** against a 16ms budget; 0.8ms / 2.3ms with them all
  off. So the six effects together cost roughly 0.2ms median and 1.6ms p95 of frame time, and the
  frame sits at a quarter of budget at its loudest.

## The Run, the Boss and the HUD

`src/rail/run.ts` + `boss.ts` (pure, `npm run verify:run`) and `BossView.ts` + `Hud.ts`. A run is
five waves separated by breathers, then a boss, then a result — start to restart.

- **A wave is a section of the run, not a stretch of track.** Chunk 6 released waves when the
  camera came within range of a fixed spot; chunk 9 spawns them *ahead of wherever the camera
  is* and calls one finished when everything it spawned is gone. That is what lets a breather be
  a fixed number of seconds rather than a fixed number of metres, and it is why `WaveDirector`
  tracks `currentWaveIds` instead of a set of already-visited places.
  - "Gone" means killed **or** left behind, deliberately: a wave that one unreachable drifter
    could stall forever would make the run unfinishable through no fault of the player's.
- **`sendScore` fires on every cleared wave**, not only at the result — most Playables sessions
  never reach a result screen, so a score sent only there is a score mostly never sent.
  - **It has to hang off the transition, not the condition.** "The wave is empty" stays true for
    as long as it is empty, so reporting on the condition sends the same wave outward on every
    frame until the breather starts. Caught live — the first run submitted wave 1 twice — and
    fixed by comparing `wavesCleared` before and after `completeWave`. `sendScore` is a
    rate-limited platform call, so this is not a cosmetic duplicate.
- **The volley multiplier is the whole economic argument of the game.** `x1` for a single mark
  rising to `x3` at `MAX_LOCKS`, applied to every kill from that stroke. With a flat score the
  cheapest play is to pick targets off one at a time and never risk a long drag, and the verb the
  game is built around becomes optional. Measured: eight drifters are worth 800 taken singly and
  2400 taken in one stroke.
- **The boss rides the rail at the camera's own speed** rather than approaching, so the fight
  lasts as long as the fight lasts. Its phases advance **on HP, never on time** — a timed phase
  would let a player who is landing everything wait out a phase they had already beaten, and move
  the goalposts on one who is still working on the first zone.
- **The boss's vulnerable zone *is* its lock-on target.** `bossZoneRect` is computed once and
  handed both to `BossView` and to the target list, so a stroke across its armoured bulk marks
  nothing and there is no way for the drawn weak point and the hittable one to disagree. Between
  phases the zone shuts and is drawn crossed out — an invulnerable window nobody can see reads as
  the game dropping hits, which is the same argument as the attack telegraph.
  - It joins the list under `BOSS_ID = -1`, negative so it can never collide with an enemy id
    (those come from a counter that starts at 1 and only rises — asserted in `verify:run`).
- **HUD depth is explicit (`HUD_DEPTH = 5000`) and that is load-bearing.** The damage frame also
  lives on `uiCamera` and draws at an *effect's* depth, so with the HUD at the default 0 the
  readouts sat underneath it — the shields count vanished behind the very effect announcing that
  one had been lost. Found by screenshot, not by reading the code; nothing about the two files
  suggests they compete.
- **The HUD follows the template layout contract** — created without coordinates, positioned
  entirely in `layout(width, height)` via `ui/anchors.ts` and `uiScale(width)`, hit area through
  `ensureMinHitArea`. Verified across a live resize chain (1920x889 -> 1920x1080 -> 390x844 ->
  844x390): everything inside the viewport, no overlap between the three readouts, tap target
  57x44 down to 55x44, fonts stepping down at the narrow end.
  - **Testing a resize by calling `layout(w, h)` directly does not work.** The anchor helpers
    read the object's *current* viewport off `obj.scene.scale`, not the arguments — so the only
    honest test is to resize the real parent element and let `bindLayout`'s RESIZE handler run.
    The ScaleManager applies it a frame late, so samples lag one step behind the request.
- **Save is v3**: adds `bestWave` and `themeProgress`. The v2 -> v3 step is the first migration
  in this project that genuinely *derives* something rather than defaulting it — a returning
  player's `bestScore` is carried into `themeProgress['default']`, or their record would read as
  never having played. `themeProgress` is filtered key by key, because its keys come from data
  and one corrupt entry must not poison the record.
  - `migrate.ts` had to switch to `import { ..., type SaveState }`: Node's native TS stripping
    (which `verify:run` loads it through) erases imports without executing them, so a type
    imported as a value becomes a missing export at runtime. Any file a verify script reaches
    needs `type` on its type imports.
- **Verified end to end**: an automated player cleared all five waves, met the boss and killed it
  — timeline `breather#1 wave#1 breather#2 wave#2 breather#3 wave#3 breather#4 wave#4 boss#5
  results#5`, one score submission per cleared wave plus one at the result, final score 17661,
  and the save came back holding `bestScore 17661 / bestWave 5 / themeProgress {default: 17661}`.
  Restart was confirmed through the bound action's keyboard source and through the button's own
  `pointerdown`; **object-level pointer hit-testing on a `uiCamera`-only button could not be
  driven from synthetic mouse events** (`hitTestPointer` finds the button at the click position,
  but the plugin emits nothing), so the button's mouse path is the one thing here confirmed by
  construction rather than by test.

## Theme, Light and Art

`src/road/themes.ts` (pure, `npm run verify:road`), `palette.ts`, `Backdrop.ts` and
`applyTheme.ts`. Everything visible is driven by a palette; nothing here changes geometry,
timing or behaviour, which is what makes adding a theme cheap and makes a bad one impossible to
ship by accident.

- **Distance fog is a second dimension on the palette texture, and costs nothing.** `Mesh2D`
  carries one object-wide tint and no per-vertex tint, so a far quad cannot simply be drawn
  darker. The palette is therefore `4 x FOG_STEPS` (16 rows): **X picks the colour, Y picks how
  far into the fog it is**, and a quad selects both through its own UVs. It is the same texture
  the mesh was already sampling and the same single draw call — **zero extra draw calls, zero
  shader passes**, which is the whole reason it is done this way rather than with a filter.
  - `paletteV` samples the **row centre**, exactly as `paletteU` samples the texel centre, and
    for the same reason: with NEAREST filtering a boundary sample lets a quad pick up the
    neighbouring fog step along its edges, which reads as the far road shimmering between two
    shades. NEAREST is now mandatory in *both* axes.
  - `fogStepFor` is front-loaded (`FOG_CURVE = 0.62`) because perspective compresses the far
    half of `DRAW_DISTANCE` into a few pixels — a linear ramp spends most of its steps where
    nobody can see them. `verify:road` asserts that every one of the 16 rows is actually
    reachable, so none of the texture is dead weight.
- **The far sky layer is the one place real art beat the procedural version.** `public/assets/
  sky/<theme>.png` is a generated plate — a hand-tuned gradient with faint haze bands, which is
  what a diffusion model is good at and a `createLinearGradient` call is not. The two nearer
  layers stay procedural because they need alpha, which the plates do not have; `Backdrop` falls
  back to the old gradient for layer 0 if a plate is missing, so a failed load degrades rather
  than blanks. Provenance in `ART-SOURCES.md`, sources and metadata in `dev-assets/sky/`.
  - **330KB for all six, from 4.77MB of raw renders.** `scripts/build-sky-plates.py` downscales
    to 384x320 and snaps to a 128-colour palette. Both are free here: the plates measure
    near-uniform horizontally (`structX` 0.15–0.4), so horizontal resolution buys nothing, and
    the noise a diffusion model always leaves inside flat areas is most of the file. Checked by
    eye at 2x against the RGB version — no banding, which is the one thing a palette can ruin.
  - **All six load at boot rather than lazily.** The set is 330KB; the lazy per-theme path
    `applyTheme` was built to host would trade a runtime load and a "plate not ready" state for
    280KB of boot. That hook stays the right place if a theme ever grows a real sprite set.
  - **The horizontal wrap is the requirement that shaped the generation.** The game scrolls the
    plate as a `TileSprite`, so a seam would sweep the screen; the plates were rendered with
    circular padding on the x axis only (wrapping y would fold the black sky top onto the bright
    horizon) and measured at 0.29–5.90 of 255 between the left and right edge columns, at or
    below each plate's own interior column-to-column difference.
  - **The vertex-buffer bounds check forks by environment** (`road/meshGuard.ts`, pure and tested
  both ways). Overflow is silent by nature — a quad index past the end writes over the *next*
  segment's vertices, because a JS array grows rather than throwing, and it surfaces as geometry
  flickering at the draw-distance boundary. DEV throws with the quad index and buffer size, since
  the check runs every frame and the first loud failure is what makes the cause findable;
  production drops the write and reports **once per session**, because the same throw would end
  the game over a cosmetic strip of road and a per-frame report would push one signal into a
  rate-limited health API sixty times a second. The DEV branch's message literal is registered in
  `check-bundle.mjs` alongside the dev globals — "we gated it" and "it is gone" are different
  claims, and only the second is checkable.
- **⚠ Three of the first six shipped plates carried a hard horizontal edge at y=0.45, and every
    acceptance number passed them.** The generator's post-processing masked a per-row multiplier
    with `excess[y < 0.45] = 0.0` — a hard cut in a per-row term is a hard edge in the output. It
    read as a treeline, which is exactly what the landscape detector was built to catch, so the
    detector was believed and the plate was not looked at. Measured after the fact as the
    row-to-row jump at that row over the plate's typical jump: **93.7 / 77.8 / 49.3** for `ice`,
    `ember` and `verdant` against 1.3–2.2 for a clean plate. Fixed by re-picking (v4 / v4 / v8,
    from a generator whose mask is now a smoothstep over 0.30–0.55) — and re-measured **on the
    shipped PNG**, downscale and palette included, not on the raw render the generator judged.
    The rule this leaves: **a metric that passes is not evidence until it has been shown to fail
    something.** The same measurement run over the old picks is what made the new numbers mean
    anything.
- **`applyTheme` may only run while nothing is drawing themed textures**, and DEV warns if it
  does. It swaps the pixels behind live keys; a sprite left holding a removed texture throws
  inside Phaser on `frame.realWidth` a few frames later, with a stack that points nowhere near
  the cause. The shipped game is safe because the only caller is the theme picker in `MainMenu`
  and `RailScene` is not running then — but that is a precondition, not a coincidence, so it is
  now stated and checked. `Backdrop` additionally re-points its layers on every `layout()`, so
  the sky half self-heals.
- **Raster sprites eventually landed, and the thing that unblocked them was changing the model,
  not the prompt.** The ship, the four enemies, the boss and eight scenery pieces now ship as
  PNGs (`public/assets/{ship.png,decor/,enemy/}`, ~580KB); the generators remain as the fallback
  behind every key. What changed: **DreamShaper XL 1.0** instead of RealVisXL — a photoreal
  checkpoint cannot draw cartoon game art, which is what two earlier rejected rounds were
  actually measuring. Four findings worth keeping:
  - **Naming a camera angle in a prompt does nothing.** Twelve prompts produced the required
    rear vantage zero times. It landed only when a **shaded, black-outlined procedural rough**
    (rendered from this project's own polygons) was used as the img2img init — and the *shading*
    is the load-bearing part: a flat white rough develops no detail, a smooth-gradient one comes
    back dark and painterly. Front-facing enemies then landed 12/12 by the same method.
  - **Asking for a flat chroma-key background puts the chroma on the subject.** CLIP pools the
    prompt and does not bind "magenta" to "background"; all six probes came back hot pink. The
    working path is a neutral grey plate, a border-connected flood fill, and an unmix against the
    *measured* background colour. `rembg` leaves a 13–35% grey halo and is not usable here.
  - **A shrub species name is not a shrub shape.** "boxwood" and "juniper" both summoned bonsai
    trees with trunks and ground planes; "a dome of overlapping leaves" summoned garden
    pavilions. A noun the model knows as a single object beats any adjective describing one.
  - **The build's own transform can be the defect.** See `scripts/build-sprites.py`: quantising
    RGBA in one pass punched 24,881 semi-transparent holes through a bush's interior, and the
    tell was that the soft-pixel count *rose* through the step.
- **An earlier attempt at raster sprites was tried and rejected.** Eight boss hulls from the same model failed the
  project's own 24px test twice over: the first four had their entire styling clause silently
  truncated by CLIP's 77-token window and came back as grey technical renderings; the rewrite
  fitted the window and produced genuinely flat 2-tone silhouettes — of side-view naval
  warships. The asked-for asymmetry never appeared in any of the eight; a photoreal checkpoint
  symmetrises vehicles regardless of prompt. The procedural polygon passes the test, so it
  stays. See `dev-assets/boss/` and `ART-SOURCES.md`.
  - **A second attempt, img2img from a silhouette rendered out of the game's own polygon, failed
    the same test for a different and more instructive reason.** Outline fidelity was excellent
    (refIoU 0.987–0.991) and the 2-tone constraint held exactly — but no armour panelling
    appeared, so the output was a *raster copy of the polygon the game already draws*, which is
    strictly worse than drawing it. Two compounding causes, both measurable: a flat white
    reference has no structure for img2img to amplify, and at `strength ≤ 0.65` there is not
    enough schedule left to invent any; and the prompt carried `no shading, no gradients` (there
    to protect the 2-tone output) while asking for engraved panel lines, which are exactly the
    tonal variation those terms suppress. **Flatness belongs in post, not in the prompt** — the
    threshold enforces it far more strictly than any wording, and thresholding must happen
    *after* the downscale or resampling puts a ramp of blended colours back along every edge.
    The indicator worth keeping is `rimSharePct`: it is a percentile split, so a panelled hull
    lands near 35% and a flat one reads 81–95%. Untried: `strength` 0.8–0.9 with the flatness
    terms removed. Not worth attempting on the other four silhouettes until the boss shows a rim
    share near 35% — the failure is in the method, not the shape.
- **Colour and contrast belong to the threat. This is a standing rule for all future art.**
  `THREAT_COLOR` (`src/road/themes.ts`) is one warm red, identical in every theme — a warning the
  player has to re-learn per theme is not a warning — and **nothing else is allowed near it**.
  `verify:road` enforces that mechanically, and **the metric is perceptual** (`road/color.ts`,
  OKLab): a colour is rejected only when its **hue** is within `THREAT_MIN_HUE_DEGREES`, its
  **chroma** is at least `THREAT_MIN_CHROMA` (below that a hue angle is numerical noise) and its
  **lightness** is within `THREAT_LIGHTNESS_ESCAPE`. All three, because one number cannot do it:
  hue carries the identity, chroma decides whether the hue is even legible, and the lightness
  escape is what keeps warm *themes* possible — `dusk` and `ember` are made of sunset and fire,
  and banning the red-orange range outright would delete them.
  - **The RGB distance this replaced was wrong in both directions.** It over-reports on dark
    colours (two near-blacks are numerically far apart and visually identical) and under-reports
    on light ones. Concretely: `dusk.sky.band` (`0xa84a4a`) scored **121 against a threshold of
    120 and passed by one unit**, while sitting **one degree** from the threat hue. Switching
    metrics changed four verdicts — `dusk.sky.band`, `dusk.decor.rim`, `dusk.decorTint`,
    `ember.sky.band` — all previously passing, all now repainted; 0 of 78 theme colours are
    flagged today.
  - **The fix is always to repaint the environment, never to move the threat colour.**
    `enemy.rim` and `enemyTint` are the deliberate exemptions: an enemy is allowed to look
    dangerous, and both are applied only to enemies. **The ship is not exempt** — the player's
    own craft carrying the danger hue is what dilutes the signal, so its thrusters ship as amber.
  - **⚠ Checking the declared colours is not enough, and by a wide margin.** A pixel-level pass
    over a rendered frame (`renderer.snapshot`, every pixel through the same OKLab rule, on a
    frame containing no enemies or telegraph at all — a mask by construction rather than by
    rectangle) found **1.13% of the `dusk` frame** inside the reserved zone while every declared
    colour was clean. Three independent sources, none of them visible to a constant-inspecting
    check, and each fixed at its own layer:
    - **Generated art.** Sky plates and decor sprites are PNGs; nothing in the TypeScript ever
      sees their pixels. `scripts/threat_guard.py` now rotates any reserved pixel out of the zone
      at build time, and both build scripts run it. The bramble's red berries were 1,327 pixels.
    - **The fog blends.** The palette texture is `5 x FOG_STEPS` interpolations and not one of
      them is a declared colour: `dusk`'s stripe fading into its fog passed through `0x7c533b` at
      step 10. One texel, but a texel colours a whole band of road across the frame.
    - **The additive glow.** What the player sees is `road + glow * alpha`, a colour in no
      constant anywhere. Both are now swept in `verify:road` — in Node, not the browser, which is
      where a check like this belongs.
  - **Two build-order traps, the same shape as the alpha one.** The threat guard must run
    **after** quantisation (quantising moves each pixel to its nearest palette entry, walking
    corrections straight back in) and must correct the **palette**, not the pixels (correcting
    pixels after quantisation forces an RGB save, +120KB across six plates). And the rotation
    must be **verified**: rotating hue at constant chroma routinely leaves sRGB, and the clamp
    back moves the hue again — the first version left 1,327 "corrected" pixels still illegal.
  - **Residual after all of it, measured on the rendered frame:** night, ice, verdant and signal
    at **0.0000%**; `ember` 0.0117% (199px in a thin band at the horizon); `signal` 0.0087%
    (149px by the ship); `dusk` 0.1270% (2,167px, concentrated in the topmost row of the frame
    where the vignette is darkest). Down from 1.13%. These are edge and single-row artefacts of
    stacked alpha compositing at the darkest, least saturated end of the range — they are not a
    region the eye can pick out, which is what the reservation exists to protect. Recorded as
    numbers rather than waved through: **zero is the standard, and this is how far short of it
    the current palettes fall.**
  - Repainting for this rule must be re-checked against a *different* metric: the rumble stripe's
    job is marking the road edge, which is lightness, not hue. Night's forced crimson-to-blue
    swap actually **raised** the edge contrast, 3.11:1 to 4.15:1 against the dark asphalt, and
    `verify:road` now holds every theme's stripe above 1.6:1 so the next repaint cannot silently
    satisfy one rule by breaking the other.
  - The telegraph used to be yellow, which is what vegetation and the ground glow are made of, so
    the warning was competing with the scenery it had to be seen against.
- **The horizon is a parameter, not an accident.** `HORIZON_Y` (`src/road/constants.ts`) is the
  single source of truth for the vanishing row; `projectInto` offsets y by it and nothing else
  may hold its own copy (`Backdrop` used to carry a hardcoded `0.5` beside the projection's
  implicit one). Raising it to `0.62` gives the ground 38% of the frame instead of 63% — the far
  field is where the whole game happens, and it was the half being squeezed. **Three things move
  with it and none follow automatically**: `SHIP_MIN_Y_FRACTION` (derived from it), the wave
  height range in `waves.ts`, and how much sky `Backdrop` fills.
- **Fliers are laid out above the horizon, and that is readability, not physics.** A height of
  exactly `0.5` (`CAMERA_HEIGHT / ROAD_WIDTH`) puts an enemy on the camera's eye level, i.e. on
  the horizon line itself; below it an enemy is drawn against the ground, competing with scenery
  of the same size, fog and tint, and no telegraph tuning fixes a target the eye has to hunt for.
  `WAVE_MIN_HEIGHT` is therefore comfortably past `0.5`. Turrets stay at `0`; being the one thing
  on the ground is what makes a turret read as a turret.
  - **⚠ The world height alone does not deliver this, and believing it did was the bug.** The
    screen offset a world height buys is `scale * (worldY - cameraY) * h / 2` with
    `scale = CAMERA_DEPTH / distance` — so the clearance **shrinks as 1/distance**: about 36px at
    20 segments and 18px at 40 on a 1080p frame, i.e. back on the horizon exactly where the
    player reads targets. `skyClearance.ts` adds a **screen-space** floor (`MIN_SKY_CLEARANCE`,
    4% of frame height) applied to the projected rectangle in `Enemies.render`.
  - **Safe only because targeting is screen-space.** The raise is applied to the one `rect`
    object *before* the sprite position, the cached shot origin, the hill clip and the lock-on
    target box are all read out of it, so none of them can disagree with what is drawn.
  - **The test that let the bug through checked one distance.** It passed at that sample and said
    nothing about any other. The replacement sweeps 5 distances x 3 kinds x 5 viewports and
    reports how many samples needed correcting — **120 of 225** — so the check cannot go dormant
    unnoticed if the layout ever makes it unnecessary.
  - **The floor is scaled by the enemy's own height, and the heights are per-kind
    (`ENEMY_HEIGHT_BANDS`).** A single shared floor is worse than it looks: past ~50 segments
    every flier clamps to it, so the altitude spread disappears at exactly the distances the
    player reads the frame at and all three kinds draw on one row. `clearanceFor` spreads the
    floor over `0.7..1.3` of `MIN_SKY_CLEARANCE`, which keeps `weaver` above `charger` above
    `drifter` even when all three are pinned (639 / 626 / 614 at 1080p).
    - The bands are separated by gaps **twenty times their own width**, and that ratio is forced
      arithmetic, not taste: the whole clearance spread is 0.024 of frame height (26px at 1080,
      20px at 844), so nearly every available pixel has to go into the gaps for two adjacent
      kinds to be 8px apart on the smallest frame that can hold it.
    - **8px cannot hold on a 390px-tall frame** — the entire spread there is 9.4px for all three
      kinds — so it is asserted on frames 700px and taller and the real worst-case gap (3.9px at
      844x390) is printed rather than the threshold being lowered to whatever passes.
    - **Altitude encodes *kind*, not depth.** A distant drifter is correctly drawn below a nearer
      charger. Depth is carried by draw order and size. Writing the opposite into a test is an
      easy slip and fails on exactly that pair.
  - **Sprites at 60 and 80 segments still overlap by up to 75%, and that is accepted.** Reaching
    the 50% that was asked for needs ~43px between a 20px weaver and a 56px charger, i.e. a
    clearance base near 0.14 and enemies sitting 110–200px above the horizon — the upper half of
    the sky, which trades one readability problem for a worse one. Sweeping the base from 0.04 to
    0.10 moves the worst case not at all. What is guaranteed instead is that the two never share
    a row, that draw order puts the nearer one in front, and that lock-on tests each rectangle
    separately; the fixture is also the worst case by construction, with both enemies at
    `offsetX` 0.
  - **The hill clip is applied to the *raised* sprite, on purpose.** A flier hidden completely by
    a crest at its projected row comes back 63% visible once raised (a 16.9px lift on a 26.9px
    sprite at 60 segments). That is the wanted behaviour: after the clearance the sprite is drawn
    in open sky above the crest, and a hill does not occlude the sky above itself — clipping it
    there would leave a hole where the player can plainly see empty sky. The cost is that a flier
    crests a hill slightly earlier than a ground object at the same distance, which is the right
    order for something in the air and errs toward the player seeing what is about to shoot them.
    Turrets are never raised and so clip exactly as scenery does.
- **The sky is three `TileSprite`s, scrolled by texture offset rather than moved.** A layer that
  has drifted a thousand pixels costs exactly what one that has not costs. They answer to the
  two quantities that genuinely move a horizon — the camera's accumulated lateral drift from the
  track's curvature and its height above the ground — which `RoadMesh` now publishes as
  `horizonDriftX`/`cameraY`. That is the same deliberate leak as `clipY`: the drift is the
  *integral* of the curvature from the camera outwards and only that loop computes it.
- **Two seams, both found by screenshot, both worth knowing.** Sizing the sky layers to the
  horizon (`height * 0.5`) leaves a hard line across the middle wherever the ground does not
  cover it. Fixing that by giving them full height produces a *different* hard line, because a
  `TileSprite` tiles in **both** axes and a 256px-tall texture repeats nearly four times down a
  945px sprite, restarting its gradient at each boundary. The fix is `tileScaleY = height /
  SKY_TEXTURE_HEIGHT` — exactly one vertical repeat, horizontal tiling left alone because that
  repeat is what the parallax scroll rides on.
- **Glow and vignette are drawn layers, never filters** — the glow additive-blended over the
  ground, the vignette a set of nested strokes. Same argument as chunk 8's effects: a filter is
  a shader pass and `Phaser.AUTO` decides per device whether there is a pipeline at all.
  Both are band-stacks rather than gradients because `Graphics` has no gradient and a texture
  would be one more thing to regenerate per theme for an effect that is eight rectangles.
- **Only one theme's textures ever exist.** `applyTheme` removes the previous theme's set before
  generating the new one — *before*, because the generators skip a key that already exists and
  would otherwise silently keep the old pixels. With generated art the "load" is canvas work
  rather than a download, but the memory shape is the one the plan asks for, and when real art
  replaces the generators the per-theme `load.image` goes exactly there and nothing else changes.
  - Enemy and decor colours are read through `enemyColors()`/`getRoadTheme()` **getters, not
    captured constants** — a captured constant bakes the old theme's colours into whatever read
    it before the switch.
  - **⚠ The theme was only ever half of a prop's colour, and the other half did not exist** until
    `biome.decorTint` — see "Biome Colour: Why Every Prop Was Grey". On the default theme, whose
    tint is white, that meant no colour at all.
- **Silhouettes are distinguishable at 24px by aspect alone**, before shape even matters:
  drifter 24x21, weaver 24x10, charger 16x24, turret 24x15. Checked with a generated contact
  sheet showing each texture full size and at 24px — that sheet is the acceptance artefact and
  is cheap to regenerate whenever the art changes.
- **Measured after all the art**, 1920x945, worst case (8 marked, 8 killed, 56 debris chunks in
  the air, sky + fog + glow + vignette all on): whole frame **0.9ms median, 2.7ms p95** against
  a 16ms budget. Chunk 8's same worst case *before* the art was 1.0ms / 4.0ms, so the art is
  free within measurement noise. Bundle unchanged at 1.69MB against the 3MB ceiling — none of
  this art is in it.

## Why The Game Rendered Dark

A screenshot of a live run came back as a road floating in a black void: black sky, black verges,
a clump of ten identical rocks by the roadside and nothing at all beyond a few metres of the
asphalt. Five separate causes, four of them long-standing, and **every one of them was invisible
until a bright palette existed to show it**. That is the pattern worth carrying forward: the game
was authored dark, and darkness hides its own defects.

- **⚠ Distance fog ran backwards for its entire life.** `add.mesh2d(...)` takes a `flipV`
  argument that defaults to **`false`**, which hands the geometry's V straight to GL — and GL
  samples bottom-up. So `paletteV(0)`, the unfogged row drawn at canvas y=0, was read as the row
  at the *bottom* of the palette: **the nearest segments were the most fogged and the horizon was
  clear.** Fixed by passing `flipV: true` in `RoadMesh`.
  - It survived because every palette was a night palette: fog toward `0x0b0d12` over asphalt at
    `0x1d1f26` is a change of a few units in either direction, so both the right answer and its
    exact inverse looked the same. A daylight theme fogging toward near-white made it glaring.
  - **Found by painting `fog` magenta and taking a screenshot**, after four rounds of reasoning
    about overlays, alphas and blend modes had produced nothing. The near road came back pure
    magenta and the question was answered in one frame. When a colour is wrong and the code says
    it should not be, flag the suspect colour and look — it beats reading the pipeline.
  - The same trick, applied one step earlier, ruled the mesh *out*: painting the asphalt pure
    green showed the road drawing pale mint, which is what proved the wash was in the sampling
    rather than in the geometry or an overlay.
- **The ground rule was inverted in intent, not just in sign.** `groundPairForTheme` dimmed every
  biome until it sat below the theme's asphalt, on the reasoning that the road must be the
  brightest surface. Measured: asphalt at 0.014–0.020 luminance and **all 48 biome/theme grounds
  crushed to 0.007–0.008**. The rule was satisfied; satisfying it was the bug. What the road's
  edge needs is contrast, not rank — grass beside a grey road is brighter than the road in life
  and in every cartoon — so the pair is now pushed *away* from the asphalt in whichever direction
  it already leans, to `MIN_GROUND_CONTRAST`, and otherwise left alone. See `biomes.ts`.
  - Writing that revealed a second bug in the new code: a factor above 1 overflowed the channel
    and **carried into the channel above**, returning an unrelated colour at exactly the road's
    brightness. Clamped.
- **Every theme was a night theme, including the one whose own comment called it "the bright
  one"** (`ice`, at 3.5% asphalt luminance). All seven are repainted, and `day` — a real blue sky
  over mid-grey asphalt — is the new `DEFAULT_ROAD_THEME`. `night` stays free at price 0: its id
  is what existing saves were written against, and charging for something a player already had is
  the one change the price table may not make.
- **The vignette was removing a fifth of the brightness from the whole edge of the frame.** Six
  hard-edged bands over 28% of the frame at 0.34 alpha measured `#9797aa` against the `#b7c0d4`
  underneath. It also *banded*: six bands over 264px is a step every 44px, and a horizontal
  luminance scan found jumps at exactly that spacing. Now 18 bands over 24% at 0.14.
- **⚠ The vignette's band count went the wrong way three times, and the third time is the lesson.**
  It was a stack of nested `strokeRect`s standing in for a gradient, and each time it banded the
  count went up — 6, then 18, then 48 — to make the step smaller. Each time the step *did* get
  smaller and the column scan down the frame *did* go quiet. What a column scan cannot see is that
  **every rectangle in a nested stack puts a corner on the same diagonal**, so shrinking the step
  never removed the artefact, it concentrated it into a fan radiating out of each corner of the
  screen — which is where a player then saw it, on the one screenshot nobody had scanned diagonally.
  Measured on the diagonal out of the top-left corner: **152 luminance jumps with the vignette, 6
  without**; after replacing the stack with a generated `createRadialGradient` texture, **8**.
  - A rectangle stack cannot be made smooth in both directions at once, because it has corners and
    a vignette does not. The "a texture is one more thing to regenerate per theme" argument the
    stack was justified by had also stopped being true: the sky layers are already regenerated per
    theme, so the vignette rides the same lifecycle rather than adding one.
  - **The general form: a fix that makes the metric quiet without changing the mechanism has not
    fixed anything, it has moved the symptom somewhere the metric does not look.** Both of the
    previous two rounds passed their own acceptance.
- **⚠ `day` shipped as the default theme with no sky plate**, so the game's default sky was the
  procedural `createLinearGradient` fallback the six generated plates exist to replace. Nothing
  failed and nothing warned: `Backdrop.layerTexture` falls back silently by design, which is right
  for a plate that is still loading and wrong for one that was never made. Reported by a player as
  "you drew the background instead of using the generated one", which was exactly correct. Now
  seven plates; `day_v5` was picked from eight on the one number that matters for a plate seen only
  above `HORIZON_Y` — **59% of its column variation sits above plate y=0.62** against 31–34% for
  its siblings, and the prettiest of the eight put every cloud under the road.
  - **⚠ And then that pick was wrong, because the backdrop cannot draw a cloud undistorted.** The
    sky layer covers the viewport in exactly one vertical repeat while tiling horizontally at 1:1,
    so a 320px plate on a 945px frame is stretched **3x vertically and not at all horizontally**.
    Every other theme's plate is horizontal-only structure — a gradient plus haze bands — which a
    vertical stretch cannot damage; v5's round cloud lobes stretched into a row of tall pale spires
    standing along the horizon, which a player reported as white things in the background. Re-picked
    to **`day_v1`**, `structX` **0.234** against v5's 0.900, i.e. the gradient-plus-haze shape the
    rest of the set has. `NOTES-day.md` had already named v1 for exactly this case and nobody read
    that far.
  - **The rule this leaves: what a plate may contain is a property of how the layer is drawn, not
    of the plate.** Picking on "where is the content relative to `HORIZON_Y`" answered the wrong
    question — the prior one is "can this layer draw content of that shape at all", and for a
    single-repeat full-height `TileSprite` on a 384x320 texture the answer is horizontal features
    only. Fixing it the other way (uniform `tileScaleX`/`tileScaleY`) trades the distortion for
    clouds three times the size and 1.7 repeats across the frame, which is a worse picture.
- **⚠ Every generated sky plate repeated 3.2 times down the screen, on six of seven themes, for as
  long as the plates had existed.** `tileScaleY` was `height / SKY_TEXTURE_HEIGHT`, and that
  constant is the **procedural canvas's** height (1024) — but layer 0 is normally not the
  procedural canvas, it is the theme's plate, which `build-sky-plates.py` delivers at **320px**. A
  320px texture divided by 1024 tiles at 295px on a 945px frame. It is precisely the defect that
  line's own comment says it exists to prevent.
  - Two things hid it. The one theme *without* a plate was the default, so the developer-facing
    case was the correct one; and the constant is named as though it means "the height of the sky
    texture" rather than "the height of one particular sky texture". Now divided by
    `layer.frame.realHeight`, i.e. by whatever texture is actually on the layer, with the constant
    left only as the fallback.
  - **Found by arithmetic in a code review, not by a screenshot** — and then confirmed in the
    running game, where the repeat count went from 3.2 to exactly 1. Worth noting because almost
    every other defect in this section was found the other way round.
- **The sky's stars repeated every 512 pixels**, because the texture is 512 wide and tiled
  horizontally — the same dot four times across a 1920 frame, at the same height. Confirmed by a
  scan finding jumps at 497, 1009 and 1521. The haze bands had the same problem in a different
  form: full-width hard rectangles standing in for soft haze, invisible on black and ruled lines
  on blue. Both are now gated on `STARFIELD_MAX_SKY_LUMINANCE` — a night affordance is only a
  tiling artefact on a daylit sky, and the gate removes it where it fails rather than tuning one
  number until both cases are equally wrong.
- **⚠ Removing the dimming rule exposed two things it had been hiding, and both showed up as
  defects the moment the frame was bright.** This is the shape of the whole section: the old rule
  was doing three jobs and only one of them was its own.
  - **The ground alternated like a zebra.** The pair alternates on the rumble rhythm so a flat
    expanse does not read as motionless — a motion cue, not a pattern — and the **road's own
    asphalt pair is the reference for how strong it should be: 1.092**. The authored pairs were at
    1.30–1.40 and only looked subtle because the dimming had been squeezing them toward one
    colour as a side effect. Re-authored to ~1.10 and asserted against the road's own ratio, so
    the reference cannot drift.
  - **A theme stopped being able to say it was night.** Ground is authored at daylight, and with
    the dimming gone a `night` run showed bright daylight sand under a black sky. `groundLight` is
    now its own per-theme field (0.34 for `night`, 1 for `day`) applied **before** the separation
    rule — dimming after the push would walk the ground straight back into the asphalt it had just
    been separated from, and the road's edge would stop reading on exactly the themes that need it
    most.
  - Adding the visibility floor to the test immediately failed `crystal`, whose authored violet sat
    at almost exactly `day`'s asphalt brightness: the separation rule pushed it *down* and out the
    bottom. Re-authored brighter. **The floor earned its place on the first run** — which is the
    only evidence that a new assertion is worth having.
- **⚠ The whole screen rippled, and there were two independent sources of it — neither of which
  was a new bug.** Both had been in the game from the start and both were invisible on a near-black
  palette, which is the pattern this entire section is about.
  - **The ground's own light/dark alternation.** It exists so a flat expanse does not read as
    motionless, which is a real problem with a real fix — but the ground is by a wide margin the
    largest surface in the frame, and a rhythm laid across it reads as a moiré over the whole
    picture rather than as motion. `GROUND_ALTERNATION` is **0**: the ground is flat. The cue is not
    lost, because it was never the only one — the road's own asphalt alternation, the dashed centre
    line, the rumble stripes and the streaming scenery are four more, every one of them on a
    smaller surface where a rhythm reads as rhythm.
  - **The fog was quantised to 16 steps**, and its own docstring said 16 was "past the point where
    the banding is visible **against this palette**" — a palette that was near-black, where sixteen
    steps between two nearly identical colours are indistinguishable. Fogging toward near-white the
    same sixteen steps are sixteen horizontal bands laid across the ground. Now **48**, and the
    ceiling is set by a test rather than by taste: `verify:road` asserts every row is reachable, and
    at 56 the front-loaded curve steps straight over row 1 and never samples it.
  - Measured after: a 1px column through the ground from the horizon to the bottom of the frame
    offers **36–64 distinct luminance steps over 340 rows**, i.e. a gradient rather than bands.
  - The alternation is a knob at 0 rather than deleted code, and that line is deliberate: removing
    the pair outright means one palette column per biome instead of two, which touches
    `PALETTE_COLUMNS`, `groundPaletteIndex` and the mesh's alternation handling — a wide change to
    reach a look one number already reaches. `verify:road` asserts the shipped ground is flat **and**
    that turning the knob fully on still produces the authored split, because "switched off" and
    "never worked" need different fixes and only the second assertion tells them apart.
- **⚠ The sky texture was authored at a quarter of the size it is drawn, which magnified every
  feature in it by 3.7x.** `SKY_TEXTURE_HEIGHT` was 256 and the layer is drawn at the full viewport
  height via `tileScaleY = height / SKY_TEXTURE_HEIGHT`, so against a 945px frame a haze band
  authored 1–4px tall drew as a hard bar 4–15px tall and a 1px star drew as a 4px vertical streak.
  A screenshot of the `night` sky was a set of ruled lines across the horizon with rain falling
  through them, and neither the lines nor the rain were in the data — they were the stretch.
  - Now 1024, i.e. authored at roughly the size it is drawn. **Softening the bands and thinning the
    stars would have been treating the symptom**; the haze bands are also drawn as vertical
    gradients now rather than `fillRect`s, because haze has no edges and a rectangle gives it two.
  - The vignette needed the same treatment twice over: 18 bands still left **26 detectable jumps of
    3–7 luminance units** in a column scan, all at the 12px spacing the band count implies. 48 puts
    the step under half a luminance unit. "Invisible" is a measurement, not a judgement — and the
    check has to sample away from the HUD, which otherwise contributes jumps of 77 all by itself.
- **The light theme has to reach existing saves, and that needed a migration.** `night` was the
  default *and* free, so every save that never actively chose anything holds `selectedTheme:
  'night'` — not a preference, an initial value. `upgradeV5ToV6` moves exactly that one value to
  the new default and leaves every other saved theme alone. It cannot tell "defaulted to night" from
  "chose night" and nothing can, since a free theme leaves no purchase record; the trade is taken
  knowingly, because night remains one tap away in the shop and the alternative strands everyone on
  a look that was replaced for being unreadable.
  - **Moving the default silently changed two old migrations**, which is the more general lesson.
    `upgradeV2ToV3` and `upgradeV3ToV4` file an archived score under `DEFAULT_THEME_ID`, meaning
    "the theme this score was earned on" — a fact about the past that started answering `'day'` the
    moment the constant moved. Both now read a frozen `LEGACY_DEFAULT_THEME_ID`. **A migration may
    not read a constant that describes the present**, and neither may a test of one: three
    assertions in `verify:run` had the identical bug and were quietly re-pointed by the same edit.
- **⚠ Every prop in the game was 22–40% see-through, and four carried a baked-in render plate.**
  Two separate causes behind one report ("the textures are transparent"), and both were invisible
  on a dark scene for the same reason everything else in this section was.
  - **Scenery fades by alpha, and alpha is not haze.** Haze puts something *between* the viewer and
    the object; alpha takes the object away and shows what is behind it. Measured in a live frame,
    the nearest and largest prop on screen was drawn at **alpha 0.78** and the farthest at 0.60 —
    against a bright ground that reads as ghosts. `MAX_BILLBOARD_FOG` is now 0.30, and the distance
    cue is carried by the ground's own palette fog and by perspective size instead. The correct fix
    is a second pass tinting each sprite toward the fog colour with `TintModes.FILL`; it is written
    down on the constant, along with why it was not done here.
  - **`coa_reef` was half background.** 50.9% of its inked area was a near-white field connected to
    the frame edge — the generator's plate, left behind by its own matte — with `for_mushroom`,
    `rui_column` and `cry_cluster` at 3–12%. Over a bright sky that draws as a translucent box
    around the object, which is how it was reported. `strip_plate` in `build-sprites.py` removes it:
    a border-connected flood over near-white neutral pixels, run **before** the downscale so the new
    soft edge is built from real transparency rather than cut out of blended pixels.
    - **Decor only.** The weapon effects are monochrome white by design, so the same flood would
      find `mz_star` connected to the frame edge and delete the asset.
    - **Three wrong detectors before the right one, and each failure was informative.** Looking for
      faint mid-grey found nothing (the residue is opaque and bright); requiring high alpha found
      nothing (the plate is anti-aliased to near-nothing at the frame edge, so a solid-pixel flood
      cannot get in from the border); averaging a 10x10 corner block "found" a plate that was not
      there (a mean over a block is not evidence about pixels). What settled it was **rendering the
      sprite over magenta and looking at it** — the same discipline as the biome contact sheets, and
      the reason the rule is measure *and* look rather than one or the other.
- **Scenery hugged the road and repeated itself.** `DECOR.MAX_OFFSET` was 4.5 half-widths, so the
  world ended just past the asphalt; it is now 18, with `OFFSET_BIAS` crowding the near verge so
  widening the field does not thin the part the player looks at (41% of placements still land
  inside the old band). The key was drawn independently per placement, so neighbouring segments —
  200 world units apart — repeatedly picked the same prop and drew as a clump of clones;
  `NO_REPEAT_WINDOW` re-rolls against the last few, and the longest same-prop run fell to 2.
  - **Widening the scatter silently broke two things that were only written down in comments.**
    `GROUND_EXTENT` was 14 with a comment saying it sat "comfortably past `DECOR.MAX_OFFSET`
    (4.5)" — at 18 every far prop would have stood on sky. And `DECOR_POOL_SIZE` was 72 against an
    old measured peak of 58; the first re-measurement returned **exactly 72 of 72**, because a
    saturated pool reports its own ceiling rather than the demand. Raise the pool first, sweep,
    then size it: the true peak is 90. Both relationships are now assertions rather than comments,
    because a comment cannot fail a build.

## Front of House: The Loading Screen

`src/ui/brand.ts` builds the backdrop, the emblem and the wordmark for **the loading screen**.
The game is called **SKYLOCK**, and the name lives in `i18n/strings.ts` under `gameTitle` — one
key, read by both the loader and the menu, so renaming it is a dictionary edit. (`index.html`'s
`<title>` and `package.json`'s name still say "Shooting Racer": the first is a browser tab label
and the second is the Playables app id, which must not change casually.)

**⚠ Most of this section describes a screen that no longer exists.** `MainMenu` was rebuilt to
render the game's own world — see "The Menu Is The Game" — so the backdrop illustration, the two
flanking robots and the shield-over-the-vanishing-point lockup are gone from it. `Preloader` still
uses `createBrand`, because a loading screen cannot show the world it is still loading. What
follows is kept because every lesson in it is about generating and setting a wordmark, and that
work is still on screen; treat the menu half of it as history.

- **The wordmark is typography, not generated art, and that is the load-bearing decision here.**
  Every other visible thing in this game is a PNG from the same pipeline, so generating the logo
  was the obvious next step — and diffusion models cannot spell. The generation pipeline carries
  `text, letters, words, logo` in its own standing negative prompt for exactly that reason. Drawn
  as text it costs zero bytes, stays sharp at any viewport, re-flows, and could be localised; what
  is generated is the **plate behind it**, which is a shape, and shapes are what the model is good
  at.
  - **The wordmark's colours are fixed rather than read from `getTheme()`.** The first version took
    the UI theme's `primary`/`accent`, which put neon pink over a pale daylight sky and was
    unreadable. A brand does not change colour with the furniture — and more practically, the UI
    palette is still the template's neon-on-dark while the menu is now a bright outdoor scene, so
    the two are answering different questions. That mismatch is still open for `Settings` and
    `Shop`.
- **The loading screen cannot show art it is itself loading, which is why the branding is split
  across two scenes.** `Preloader` builds its bar in `init()`, before its own `preload()` has
  fetched anything. The backdrop and the emblem are therefore loaded by `Boot` — whose entire
  documented job is "only what the loading screen needs" — and the two robots by `Preloader`, since
  nothing on the loading screen waits for them and every byte kept out of `Boot` is time off the
  first frame. All four are optional; a missing file degrades to the theme's own colours.
- **⚠ Pushing objects into an array in the right order is not the same as creating them in the
  right order.** The backdrop was created before the wash that sits behind it and then pushed after
  it, so the plate was drawn and immediately painted over — which reads exactly like the background
  failing to load, and was diagnosed as that first. In this scene the display list *is* the draw
  order, so creation order is the only order that matters.
- **A crest above the wordmark, not behind it.** Setting the name across the shield is the obvious
  lockup and fails twice: the long word is wider than the shield's flat centre at any size that
  keeps the shield a crest, and light text on brushed silver has no contrast to sit on.
- **`MainMenu.layout` runs the lockup twice, on purpose.** Its height is not known until it has been
  laid out once — the wordmark is measured off the drawn text, not the nominal font size — and where
  its centre may sit depends on that height plus everything stacked under it. A single pass on a
  fixed fraction of the viewport put the shop button **15px below the bottom edge at 844x390**:
  inside the frame at every size that was looked at, outside it at the one that was not. Verified at
  1920x945, 1280x720, 390x844 and 844x390.
  - The robots hide below `FLANKER_MIN_WIDTH`. At 390px the frame holds a logo and a button *or* a
    logo and two robots, and the button is what the player came for.
- **The emblem's rim was 7.868% inside the reserved threat band** — a UI panel wearing the danger
  colour — and the build's own threat guard rotated it out, which is what turned it from red to
  amber. **`rival` is exempt on the same grounds enemies are**: a hostile robot may look hostile,
  and its 0.547% is entirely the eye dome.
- Generation findings worth keeping: **`war robot` was the single wrong noun** — three of three came
  back as military mech concept art despite `thick black outlines` in an untruncated prompt, and
  `chunky robot` plus an emotion word fixed it in one round. A draft prompt measured **90 tokens**,
  i.e. its whole style clause sat past CLIP's cut. And `glyphSuspectPct`, a metric built to catch
  stray lettering, scored 6.9–18.4% with no relation to whether lettering was present: every
  rejection came from looking at the renders on mid grey.

## Fix Round 2: The Frame Before The Menu

`MENU-REDESIGN.md` opens by refusing to start until the battle frame is fixed, and lists what it
expects to have changed. No such document existed and none of it was in the code, so this round is
that list turned into work: the ribbon stops reading as a road, the band enemies fly in becomes a
constant, the ship shrinks and is clamped out of that band, and it gets a shadow.

- **`ENEMY_BAND_TOP` / `ENEMY_BAND_BOTTOM` (0.34 / 0.55 of frame height) are a *reservation*, not
  a description.** The strip fliers occupy used to be an emergent property of three unrelated
  numbers — `HORIZON_Y`, the world heights in `ENEMY_HEIGHT_BANDS`, and `MIN_SKY_CLEARANCE` — so
  nothing outside the projection could ask "where do the targets live?". Everything that draws over
  the frame needs that answer as a constant, and the menu needs it most.
  - **`MIN_SKY_CLEARANCE` is now derived from the band rather than picked**: it solves so that the
    lowest-flying kind lands exactly on `ENEMY_BAND_BOTTOM` (`CLEARANCE_SPREAD.min` is exported
    from `skyClearance.ts` for that one equation). It was a bare `0.04`, which put a drifter's base
    43px over the horizon at 1080p — close enough that it shared a background with the scenery
    again at the ranges the player reads. Measured after: flier bases span **0.402..0.550** of the
    frame, and `verify:enemies` asserts both the band and that the lowest kind actually reaches its
    floor, so the derivation cannot quietly stop being one.
  - The contract is one-directional: a *base* is inside the band, a sprite may overflow its top
    edge, and a charger at five segments does. The band bounds where targets are, not how big they
    get.
- **The ship is sized off the frame's height (13%), not its width.** It was `0.115` of the width
  capped at `0.2` of the height, which on a 1990x1050 window drew a hull **24% of the frame tall** —
  a quarter of the picture spent on the one object that never has anything to say. The vertical
  budget is the scarce one (ground 38%, enemy band 21%), so the ship is sized against it directly.
- **The ceiling is a limit on the ship's *top edge*, not its centre.** `SHIP_MIN_Y_FRACTION` is now
  `ENEMY_BAND_BOTTOM` and the clamp subtracts half the drawn hull — which is why `ShipBounds` grew
  a `halfHeight` field that the pure motion module cannot derive for itself. With the old centre
  clamp the upper half of the hull flew inside the band the player reads targets in. `verify:ship`
  asserts the top edge stops on the band at five viewports **and** that it actually reaches it, so
  the check cannot pass on a ship that never got there.
- **The hit radius follows the hull now.** `ENEMY_SHOT_HIT_RADIUS_FRACTION` (4.5% of viewport
  width) was chosen to match the ship and stopped matching it the moment the ship was resized: at
  1920 it is 86px against a 62px half-width, i.e. a shot landing 24px clear of the craft still
  counted. It is `Ship.hitRadius` — the drawn half-width — because a hit on visibly nothing is the
  same defect as a mark that does not register, read from the other side. **This is the one
  balance-visible consequence of the round**, and it makes the game slightly easier by design.
- **The centre line became a rung.** A dashed line down the middle of a grey surface with white
  paint along both edges is a road, and this game stopped being about driving on one. The marking
  is now a bar *across* the ribbon (`TRACK_RUNG`, geometry in the pure `road/surface.ts`), which is
  also the better speed cue of the two: a longitudinal dash only moves the boundary between paint
  and no-paint down the screen, while a transverse bar sweeps its whole length — and the dead near
  ground is exactly where that difference is largest. Measured: a rung paints **18x** what the old
  centre line did across one screen row.
  - **⚠ The first version was a pedestrian crossing, and it shipped to a screenshot before anyone
    noticed.** Riding the rumble stripes' own `alternate` flag paints a rung on every segment of
    every *on* band — three bars a fraction of a segment apart, then a gap, repeating. `TRACK_RUNG.
    SPACING` is one rung per full rumble cycle (1200 world units, about five a second at
    `RAIL_SPEED`); `verify:road` asserts the spacing, that rungs are never adjacent, and that the
    gap outruns the rung so the pattern cannot close up under perspective compression.
  - `day`'s fifth palette slot was highway yellow (`0xf2c94c`). Every other theme already had a
    neutral there; `day` is the default, so it was the one the game was read on. Now a cool mid
    grey-blue.
- **The ship has a shadow, and it is the only altitude cue it has.** Nothing else in the frame
  changes when the player climbs — the hull is a screen-space object, so it is the same size
  wherever it is. The shadow sits on **one fixed screen row** and shrinks and fades as the gap
  opens; a shadow that tracked the hull down the frame would say nothing. Generated as a
  soft-edged blob texture rather than `fillEllipse`, which tessellates a curve every frame.
- **"The near zone is tight" turned out to be already true, and is now measured rather than
  asserted.** `verify:road` sweeps the projection at three viewports and reports the widest single
  segment as a share of the ground band: **13% at all three**, against a 35% ceiling. The check
  prints the number, so the next person to move `CAMERA_HEIGHT`, the FOV or `HORIZON_Y` sees what
  it did.

## The Menu Is The Game

`MainMenu` renders the world through the same `WorldView` the play scene does, with an interface
laid over the rows a run leaves empty. What it replaced: a static illustration of a highway, two
robots drawn in techniques that appear nowhere in the game, a stock shield over the vanishing
point, and white text on a pale sky measuring well under 3:1.

- **`src/rail/WorldView.ts` is the whole argument.** Ground, scenery, sky, fog and the camera that
  travels through them, with no rules attached: no ship, no enemies, no waves, no run, no HUD.
  Both scenes build one. The alternative — a second copy of the setup in the menu — agrees with the
  play scene on the day it is written and disagrees after the first theme change or horizon move,
  and the point of a menu built out of the game is that the transition needs no fade to hide a seam.
  - `render()` is one call because its order is load-bearing: `RoadSprites` reads the mesh's
    per-segment projections and `clipY` from the pass immediately before it, and `Backdrop` reads
    the camera drift the same loop integrates. It returns what each pass cost so the DEV report can
    still separate road from scenery.
  - The two circuits live in `road/circuits.ts`. The menu's has long easy bends and no S-curve: a
    corner is a lateral shove on everything in the frame, and a hard bend under a title is motion
    the eye tracks instead of the text.
- **⚠ `applyTheme`'s precondition stopped being free the moment the menu drew the world.** It
  removes and rebuilds the pixels behind live texture keys, and its own rule is that nothing may be
  drawing them — which held while the theme picker's only caller was an illustration. Switching a
  theme from the shop now threw inside the renderer on `glTexture` of null, one frame later. The
  world absorbs it instead: `WorldView.refreshTheme` re-points the mesh's palette (the mesh holds a
  `Texture` object, not a key), clears the sprite pools' cached keys (they skip `setTexture` when
  the key is unchanged, which is exactly wrong when the pixels behind the key were replaced) and
  re-lays the backdrop. Found by switching themes in the running menu, not by reading the code.
- **Legibility is measured, not chosen.** `ui/scrim.ts` (pure) solves the smallest plate alpha that
  puts text at 4.5:1 against a measured background, by bisection over the sRGB blend — the contrast
  ratio does not invert nicely. `ui/contrastProbe.ts` does the measuring: one `snapshotArea` of one
  band per frame, on scene entry, on every resize and on a theme change, and nothing per frame
  after that.
  - **The plate is solved against the *worst* sample in the band, not its mean.** A title half over
    bright sky and half over a dark hillside averages to a colour neither half is, and the letters
    on the bright half are the ones nobody can read.
  - **Both candidate text colours are solved for and the cheaper plate wins**, rather than picking
    the colour on the mean and then paying for it: on a sky that is bright *on average* the first
    approach chooses white and then needs an opaque slab to rescue it.
  - The UI camera is hidden for the single frame a band is captured, or the probe measures the text
    it is trying to make legible — and, once a plate exists, its own plate, which converges on
    nothing. It is restored at the top of the *next* update rather than in the snapshot callback:
    a callback that never arrives would otherwise leave the whole interface invisible for good,
    which is what a thrown error inside a stepped frame actually did during testing.
  - Measured on the running menu at 1920x945, every theme, both blocks: title 4.50 (`day`, plate
    0.35) to 19.72 (`signal`, no plate); buttons 4.51 to 6.71, plate 0 to 0.575. All seven themes
    clear 4.5:1 with the plate the probe chose.
- **Nothing in the menu occupies a row that means something in a run** (`ui/menuLayout.ts`, pure).
  Title between the HUD's rows and `ENEMY_BAND_TOP`; buttons on the near ground a run leaves empty;
  the HUD's own rows left blank so the shields, score and multiplier appear *into* empty space when
  the run starts. That is what lets the handover be a fade of the interface and nothing else.
  - **⚠ `uiScale` scales on width, and a landscape phone is wide.** At 844x390 the title kept its
    full 64px against a 55px band and ran from y=70 to y=140 — through the HUD's rows *and* into
    `ENEMY_BAND`. Every element sized in points and placed in a band needs a second pass measuring
    the drawn text; the button stack already had one, the title did not. Re-measured after the fix:
    title 86..125, band 132..214, HUD 0..78.
- **The ship is the real `Ship` on a script** (`steering: 'script'`), so the same spring, the same
  top-edge clamp, the same bank, bob, plume and shadow. A menu ship that moved by its own rules
  would advertise a craft the game does not have. It binds no input at all in that mode: the
  buttons live under the pointer, and SPACE is the menu's own primary action.
- **The enemies that cross are real `Enemy` records with no state machine** (`rail/menuFlyby.ts`,
  pure). They never telegraph, never fire and cannot be killed — a menu is not a difficulty
  setting — and they are rare by design: one every 8–12s, measured at **at most 1 on screen at a
  time** over five minutes. `turret` is excluded because it stands on the ground, which in the menu
  is where the buttons are.
- **The handover has no fade to black.** The interface fades over 180ms, the world accelerates to
  the run's own rail speed over 600ms, and only then does the scene change. Verified by stepping
  the loop frame by frame and screenshotting through it: the world is continuous, the horizon does
  not move, and no frame is blank. What is *not* continuous is the track content — the two circuits
  are different, so the scenery changes at the cut. The horizon, palette, fog and the ship's box do
  not.
- **Tweens are killed explicitly on shutdown.** `Systems.shutdown()` does not stop them and this
  scene is re-entered after every run. Verified: menu → run → menu leaves exactly **1** tween alive
  (the Play button's idle pulse), the same as the first entry.
- **Cost**: the menu renders a full world and is measured like one. At 1920x945, 300 stepped
  frames: **1.6ms median, 4.0ms p95, 6.1ms max** against a 16ms budget; at 1920x889, 1.2 / 2.3 /
  3.2. A phone-size measurement was not obtained — the automation harness could not hold a small
  viewport (see below).
- **Orbitron is not in the bundle**, despite the redesign brief saying it is. The title and the
  primary button both use `getDisplayFontStack()`, which is a system sans until a game calls
  `initDisplayFont()`; one family, differing by size and weight, is the rule that was actually
  asked for. Adding a real display font is a font file plus a provenance row, not a code change.
- **Driving the menu under automation, beyond what is already written down.** The tab is hidden, so
  rAF never fires and the loop must be stepped by hand (`game.loop.step`) — already known. New:
  `renderer.snapshotArea`'s callback needs the browser's task queue to turn, so a *synchronously*
  stepped batch of frames measures at most one band; the probe settles one region per round-trip
  from outside the page. And `game.scale.resize(w, h)` does not hold in `RESIZE` mode — the manager
  re-reads the parent every few frames and reverts — so a viewport sweep gets one reading per
  request, immediately after a real `refresh()`.

## The Combat HUD

**⚠ One readout described below no longer exists: the multiplier's number and its decay ring.** The
multiplier is still paid per volley and is now presented as force — a harder punch on the score and
a bigger flying number, both from `scoreEmphasis`. See "Five Things A Player Can Name". Everything
else in this section is current.

`src/rail/Hud.ts` + `ScorePops.ts` + `WaveBanner.ts` + `hudState.ts` (pure, `npm run verify:hud`).
Three correct readouts that never moved became a HUD that reacts to everything the player does.
**No mechanic changed**: every number here was already being computed, and what was added is when
and how it arrives.

- **Nothing is instantaneous.** The score counts up over 120–600ms scaled by the size of the
  award (`countUpDurationMs` — a drifter counts in 244ms, a boss kill in 600), punches 1.0 -> 1.12
  on every gain, and flashes on every thousand crossed. A number that simply changes reads as a
  fault; a number that arrives reads as a reward.
  - **Milestones are *counted*, not tested for.** Nothing in the game awards round numbers, so
    "the score is a multiple of 1000" fires approximately never — and a boss kill crosses five
    thousands at once. `milestonesCrossed` returns how many, and the scene plays one sound each.
- **⚠ Every timed value goes through `progress01`, and the `0` end of that clamp was earned.** A
  HUD driven by the frame clock has to survive that clock going *backwards*, which it does under
  this project's own stepping harness: a batch of synthetic frames runs ahead of the real clock and
  the next real frame arrives earlier than the last synthetic one. Unclamped, the score's ease
  extrapolated backwards and the readout showed **-1197 while the run had scored 283**.
- **The score box is a fixed width.** A centred `Text` that grows at 999 -> 1000 moves its own
  centre, which moves the top of the frame at the exact moment the player is watching it. Measured:
  the box holds at left 901, width 119 from `999` through `1000000`.
- **The flying number is the missing sentence, not a decoration.** A kill happened over there and
  the score changed up here, and nothing in the frame said they were the same event. `ScorePops`
  starts the number where the thing died and pulls it into the counter as the count-up begins.
  - Pool of 24, never grown: measured flat at 24 objects and 272 scene children across 300 frames
    of eight-kill volleys.
  - **Consecutive pops are fanned apart on a fixed cycle.** Eight arrivals inside 400ms put eight
    identical `+126`s on one pixel, which reads as one smeared number — seen in the first live
    frame of this work.
- **The multiplier has a decay ring**, and it is the reason the readout exists at all: the
  multiplier is the game's whole economic argument and it used to be a small line of text that
  appeared and vanished with no indication of how long it would stay. Three colour steps
  (`multiplierTier`), each reachable by a real stroke, asserted in `verify:hud`.
  - **The ring is a *display* lifetime, not a mechanic.** `run.ts` still awards the multiplier per
    volley and applies it the instant the kills land. A decaying combo would be a new rule; a
    decaying readout is a presentation of an existing one.
  - **⚠ The old readout was `#ffd166` and the brief assumed that was a threat-rule violation. It
    was not** — measured, it sits 63 degrees round the hue circle from `THREAT_COLOR`, against the
    30 the reservation covers. It was repainted anyway on a weaker but real argument (warm yellow
    is what the vegetation and ground glow are made of, so the number competed with the scenery),
    and the measurement is recorded in `verify:hud` so nobody re-derives a violation that never
    existed.
- **⚠ Every colour in this section moved when the interface palette did** — see "The Interface Kit"
  and its "The combat layer on the kit" subsection. What is described here is still what the HUD
  *does*; what it is drawn in now comes from `ui/kitPalette.ts`, and the warning states are amber
  while the hit flash is the reserved red.
- **Shields are drawn pips, because a glyph cannot break.** Losing one shatters it into four
  shards on a fixed trajectory set at construction — a shatter that allocates allocates on the
  frame that is already busiest. The last shield pulses; only the last, because a HUD that is
  always moving is one the eye stops catching.
- **Damage direction is now reported.** `resolveShots` returns where the shot that landed came
  from, and the HUD flashes that edge of the frame. It was thrown away one line before it could
  be used, and it is the one piece of information that would let the player fly differently.
- **The boss bar is segmented by phase, not one line.** A single bar answers "how much is left"
  and hides what the fight is made of: each phase moves the weak point and resets the stroke the
  player had worked out. The segment that empties flashes.
- **The wave announcement and the wave summary are deliberately different animations.** One is a
  warning (chevron snapping open, the number punching in from 1.4x, gone in 1.9s), the other a
  receipt (fades up in place, numbers counting, 2.3s). A screen that announces and concludes with
  the same motion teaches the player nothing about which just happened.
  - **⚠ `uiScale` scales on *width*, and that put the banner inside `ENEMY_BAND` on a landscape
    phone.** At 844x390 it kept its full 40px type against a 55px strip and ran from y=70 to y=140
    — through the HUD's rows *and* into the band. Every element sized in points and placed in a
    band needs a second pass measuring the drawn text; the button stack in the menu already had
    one, this did not. After the fit: 86..125 against a band starting at 133.
  - The summary's "bonus" line is the wave's **own score**, not an invented bonus. There is no
    wave bonus in this game and adding one would be a balance change made by a presentation task.
- **Legibility is measured here too.** The readouts sit in the sky band, and white text on the
  `day` sky measures **2.7:1**. `RailScene` runs the same `ContrastProbe` the menu does over the
  HUD's own strip and hands the result to `Hud.applyContrast`: measured live, background
  `#3f7fb2`, plate 0.24 alpha, **4.50:1**.
- **Measured**: `Hud.update` costs **0.000ms median / 0.005ms p95** batched at 1920x945, against a
  1.5ms budget; the whole frame with HUD, pops and banner is 1.6ms median / 3.6ms p95. An A/B with
  the three stubbed out came back *slower* on the same harness — the HUD's cost is below the noise
  floor of a per-frame measurement, which is why the batched number is the one quoted.

## The Loadout and the Weapon Row

**⚠ This section was called "Heat, the Loadout and the Weapon Row" and the heat half of it is
gone** — `src/rail/heat.ts` is deleted, the bar is off the row and the overheat lock no longer
exists. See "Five Things A Player Can Name" for why. What is below is still accurate about the
loadout, the row and its gestures; every sentence about the bar is history.

`src/rail/heat.ts` + `loadout.ts` + `gesture.ts` + `weaponRowLayout.ts` (pure,
`npm run verify:weapons`) and `WeaponRow.ts`. The seven weapons that already existed became a
choice made *during* a run, at a price.

- **⚠ The brief this was built from describes a game with one weapon. This game has seven**, with a
  shop, save v5 and per-weapon effect art. Adapting rather than replacing was the user's call; the
  numbers in the brief's table are not the numbers here, and the three-weapon row became three
  *slots* filled from what the player owns.
- **⚠ Every weapon carried a `cooldownMs` and nothing read it.** The lock-on used one shared
  `VOLLEY_COOLDOWN_MS` for all seven, so `mortar`'s 900ms and `flechette`'s 200ms — the numbers the
  whole set is balanced around, and the ones `verify:lockon`'s dominance check argues about — were
  decoration. Found while wiring the row's cooldown ring, which had to ask what the wait actually
  was.
- **Heat is charged per mark plus a little per extra projectile, and the first version was wrong.**
  Charging purely per projectile is the obvious reading of "a wide weapon pays for its width" and
  it made `flechette` do **243 damage a minute against a median of 848** — the price of being wide
  was being unusable. Both coefficients were then swept against all seven weapons over a simulated
  minute of flat-out firing; the shipped mix (0.020 per mark, 0.004 per extra shot) lands every
  weapon within half the median, gives the worst case four full strokes before the lock, and leaves
  `mortar` and `pulse` never overheating at all because their own cooldowns hold them under the
  decay rate.
  - The balance table is printed by `verify:weapons` rather than asserted at 15%: seven
    deliberately unequal weapons cannot be within 15% of each other, and the brief's target was
    written for three. What *is* asserted is that nothing is more than twice the median or less
    than half of it. Current spread: **77% of the median**.
  - **Heat lives on the ship, not on the weapon.** Switching to a cool gun is therefore not a way
    out of an overheat — what a switch buys is a different *shape* of volley, which is the decision
    the row exists to offer.
  - The lock is a hard stop with a loud signal, and the bar keeps cooling *through* it, so it ends
    empty. A lock that ended with the bar still full would put the player straight back into it.
- **The row is in the bottom-left corner and passes every drag through.** Locking targets is a drag
  across the whole screen and the centre of the bottom edge is where the finger ends up, so the row
  never marks anything interactive: it listens on the scene exactly as `LockOnView` does and only
  ever *reads* the gesture. Verified live: a drag beginning inside cell 0 took 2 locks and did not
  switch; a tap on cell 1 switched to `mortar` (and its 900ms cooldown) and took no locks; a press
  that drifted 40px switched nothing.
  - The tap decision is `gesture.ts` — radial, measured from the press, not between frames, the
    same trap `ui/scrollList.ts` documents. A 3px-per-frame drag stops counting as a tap after 4
    frames.
  - **⚠ The row cannot stay out of the centre-bottom drag zone on a 390px-wide frame**, and
    `rowClearsDragZone` says so rather than fudging it: three cells at the 44px touch minimum plus
    gaps and margin are 41% of that frame against a zone starting at 35%. The touch minimum is the
    rule that cannot bend; the pass-through is what makes the overlap safe.
- **⚠ A row with one cell in it does not look like a chooser, and for a new player that is the only
  row there is.** `resolveLoadout`'s third rule is explicit — "a player who owns one weapon still
  gets a row with one cell rather than a row of three identical cells" — and it is right about what
  the *loadout* is. What it produced on screen was a single square in the corner from which nothing
  about the mechanic is visible: not that the square is tappable, not that there are two more slots,
  not that the shop is where they come from. The unfilled slots are now drawn as empty sockets.
  - **Dashed, not a faint solid outline**, because the two say different things: a solid outline at
    low alpha reads as a control that is *disabled* — something that exists and is refusing — while a
    broken one reads as an outline waiting to be filled. The player cannot buy from here (the shop is
    a menu away), so "disabled" would be a lie about a thing that is simply not there yet.
  - **They are not cells.** No icon, no hit area, no `readyAt` entry — so every index in `WeaponRow`
    still means "the nth weapon the player owns" and the switching logic is untouched. Tapping an
    empty socket does nothing, which is the honest outcome.
  - **The row now draws the geometry that was already being checked.** `verify:weapons` has always
    measured `rowCells(..., LOADOUT_SIZE)` and `rowClearsDragZone(..., LOADOUT_SIZE)`; the row was
    laying out `this.cells.length` of them. Measured live at 390x844 after the change: three 44px
    slots ending at **41%** of the frame — exactly the number the documented drag-zone trade-off
    predicts, and the first time the drawn row and the measured row were the same object.
  - The heat bar spans all three slots rather than stopping at the last owned one, because heat
    belongs to the ship and not to a weapon (see `heat.ts`) — and a bar that changed length when the
    player bought something would be saying the opposite.
- **The loadout is now chosen rather than defaulted** — see "The Loadout Screen". `resolveLoadout`
  is unchanged and still the repair function; what it repairs is now usually a decision.
- **The loadout is filtered, never trusted.** `resolveLoadout` puts the selected weapon first,
  drops anything unknown or unowned, and refills from what is owned in unlock order — the same rule
  `resolveSelectedWeapon` applies to the single selection it extends. Save is **v7**; `upgradeV6ToV7`
  seeds the row from the weapon the player was already carrying, because defaulting it to `[]`
  would be a silent demotion on upgrade.
- **Switching re-points two pools rather than rebuilding them.** `VolleySprites.setWeapon` and
  `FxSprites.setWeapon` change textures and tints in place: shots already in the air keep their
  slots and finish as the new weapon's head, which is the only option that cannot drop a shot the
  player has already paid for.
  - `FxSprites` now allocates its flash and impact pools **even when the armed weapon has no art**,
    with flags deciding whether they draw. The pools have to exist at construction because that is
    when the scene builds its camera `ignore()` lists — an image created later would be in neither
    and would be drawn twice.
- **Measured**: `WeaponRow.update` costs **0.005ms median / 0.010ms p95** batched at 1920x945,
  against a 0.8ms budget. Whole frame with the row, the HUD and a live wave: 2.1ms median / 4.0ms
  p95.

## Content Expansion

`CONTENT-PLAN.md` is the plan: more weapons, enemies, biomes, themes and shop products, generated
through the same Modal pipeline in the sibling `Remotion` project that produced everything else.
What belongs here is the handful of findings that outlive any one batch.

- **The bundle was never the constraint it was assumed to be.** "The 3MB ceiling" appears exactly
  once in this file and was a working habit, not a rule: the platform allows 200MB per archive and
  30MB per file, `PLAYABLES-SDK.md` sets a project target of **≤15MB**, and `check-bundle.mjs` fails
  at 25MB. The whole planned expansion is about +0.72MB against those numbers. The working ceiling
  is **8MB** — 6MB when this was written, raised once when the per-biome enemy skins earned the room
  — and it is `WORKING_CEILING_BYTES` in `check-bundle.mjs` rather than a number in this file,
  because carried as prose it drifted to 99.3% of itself with nothing able to say so. Currently
  **5.61MB**.
- **⚠ Two of the five structural acceptances in `rail_effect_checks.py` measure nothing, and the
  first round of weapon effects was signed off partly on them.** Found by applying this project's
  own rule — *a metric that has never failed anything is not evidence* — to the checks themselves
  before trusting them on new work:
  - `components` counts connected pieces over raw alpha at the drawn size, where a soft falloff
    breaks into dozens of one-pixel islands. Re-measured independently on the **shipped** PNGs:
    `im_shatter` **9**, `im_burst` **27**, `pr_ring` **11** — and `im_shatter`'s own note in the
    prompt table reads "one connected shape". It cannot be the acceptance for a genuinely
    multi-part slot, which is what it was written for.
  - `radialPeaks` scores **0** on `mz_ripple`, the concentric slot it exists for, while scoring 2 on
    the `pr_ring` variant that was *rejected for filling in*. The cause is not the threshold: the
    ripple's rings are arcs on a 2:1 canvas, so no radial profile centred on the box can ever see
    them.
  - `centerRimRatio`, `angularStd` and `vAsymmetry` were put through the same confirmation and all
    three do reject something. **The confirmation is the point** — a check that has only ever
    printed a number is a check nobody has tested.
- **Weapons: 4 → 7.** `flechette` (4 shots a lock, 0.2 each, 200ms), `mortar` (one 3.2 hit, 900ms)
  and `needle` (1.5, 380ms). Every number here was set against `verify:lockon`'s dominance test
  rather than by feel — `flechette` at any damage from 0.25 up beats `scatter` on all four axes at
  once and makes it unbuyable, which is exactly the failure that check exists to catch and exactly
  how `scatter`'s own damage was set a round earlier.
  - **`MAX_SHOTS_PER_LOCK` is now 4, and two pool ceilings moved with it** — the volley pool and
    `MAX_IMPACTS`, both derived from it rather than written down. That derivation was put there for
    this and it worked: adding a heavier weapon widened both without anyone editing either.
  - The eighth weapon is blocked on art, not on design: `pr_comet` produced no usable head in
    three variants (the best correlates 0.808 against `pr_bolt` at the 12px it is drawn, i.e. it
    *is* the bolt), so it is a retry rather than a rejection. `needle` shares `lance`'s impact in
    the meantime because `im_pulse` failed the same round — recorded in `FX_PICKS` with the fix.
- **Biomes: 6 → 8**, `coast` and `ruins`. Two things moved with them and neither was optional:
  - **`BIOME_RUN_SEGMENTS` 240 → 179.** `verify:road` caught a lap reaching six of eight biomes,
    which is the second time that check has failed for exactly this reason — it is the check that
    exists because "two biomes existed only in theory" once already. The new value is *better*
    justified than the old: 240 sat above the 150-200 band that reads as a place, 179 sits inside
    it, and `1434 / 179 = 8.01`. **It does not scale** — nine biomes would need 159 and ten 143,
    below which a biome is a strip of coloured verge. The next lever is the track's length.
  - A palette-width assertion read `assert.equal(count, 17)` beside the derived check that already
    covered it. Adding two biomes broke it, and it was measuring nothing except how many biomes
    existed when it was written. Replaced with a range: **a test that has to be edited every time
    the data changes teaches whoever edits it to change the number rather than ask why it moved.**
- **`coast` ships with four props and that is deliberate**, as `crystal` and `dunes` ship with five. Two of the
  twelve slots were rejected *after* passing every number in the batch that made them: `coa_drift`
  came back as a cartoon bone and `coa_shell` inside a drawn rectangular frame (17.7% of its own
  outer border opaque, against 12.9% for the worst shipped prop). Both are re-rendering.
- **⚠ The numeric gates cannot see identity, and this is the sharpest form of that lesson yet.**
  In the biome batch a **bone dragon posted the best coast row in the whole table**. `canvasEdge`,
  `threatBandPct`, `footprint`, `solidity24` and `aspectVsTarget` between them also passed a crowned
  Neptune, a wizard, a labyrinth, a totem and a pile of toy blocks. Every render has to be looked
  at, **on mid-grey** — not black, where dark paint and transparency are the same thing, and not
  white, for the mirror reason. Taken together with the `hexer` episode (a working sprite nearly
  deleted by eyeballing a dark contact sheet) the rule is not "measure" or "look", it is: **measure
  what is measurable — alpha, footprint, reserved pixels, confusion — and look for what is not, on
  a background that hides neither end.**
  - The corollary bit twice more in the same batch: five of six failed slots were each caused by
    **one noun** (`limb` → bone dragon, `crown` → a literal crown, `palm` → a hand, `maze like` → a
    maze, `blocks` → toy cubes), and changing the noun fixed each while adjectives never did.
- **`ART-SOURCES.md`'s "no row, no ship" rule had already been broken 54 times before anyone
  looked.** Every biome prop, the four newer enemies and the whole first round of weapon effects
  shipped without a provenance row. The licence position was never in doubt — same model, same
  pipeline, a `.json` sidecar per file — but **the rule is a convention with no mechanical guard
  behind it**, and a convention that depends on remembering is one that eventually will not be
  remembered. Rows are backfilled; the guard that would fail `npm run build` on an unrecorded file
  under `public/assets/` is not built.

## The Interface Kit

`src/ui/kit.ts` + `src/ui/kitPalette.ts` (pure, `npm run verify:ui`) + `src/ui/sliderMath.ts` (pure)
+ `src/audio/volume.ts` (pure). `Settings` gained volume sliders and both overlays were rebuilt out
of Phaser core game objects in the game's own visual language. `MainMenu`'s three buttons moved onto
the same kit, and one `setTheme()` call at boot repoints everything still on `ui/theme.ts`.

- **⚠ The template's `DEFAULT_THEME.primary` was inside the reserved threat band, and the HUD drew
  the player's *shields* in it.** `0xff2975` measures **15.4 degrees** from `THREAT_COLOR` at chroma
  0.243 and a lightness within **0.006** of it — all three terms of this project's own standing rule,
  i.e. the danger colour by every test applied to anything else here. It was also the heat bar, the
  selected weapon cell, the lock-on ring and the result panel, so the one hue reserved for "something
  is about to shoot you" was simultaneously the hue of every readout meaning "this is yours".
  - **It survived because the rule was enforced where it was written and nowhere else.**
    `verify:road` sweeps all 78 road-theme colours, the palette texture's fog blends and the additive
    glow; nothing had ever pointed it at `ui/theme.ts`. The general form: **a reservation enforced on
    one palette is not enforced.** `verify:ui` now holds the interface palette to the identical
    three-term test, and — following the project's other standing rule — proves the check works by
    asserting it still rejects `0xff2975` itself.
  - Fixed by `main.ts` calling `setTheme({ colors: UI_THEME_COLORS })` before `new Phaser.Game(...)`,
    which is what that one-call reskin exists for. Slot *meanings* are preserved rather than merely
    recoloured: `primary` is the "yours" accent (the ship's cyan), `secondary` the neutral rim,
    `accent` the warm currency sand — which is what the score glow and `valueBadge` already used it
    for. No widget retints itself later, so this must happen before the first scene creates one.
- **The palette is fixed, not derived from the active road theme**, and that is the load-bearing
  decision in `kitPalette.ts`. Deriving it is the first instinct and it is wrong: the world's palette
  is what the interface has to stay legible *against*, so a UI that changed colour with it would need
  its contrast re-measured per theme — seven times, over a background that also moves. A fixed
  palette is measured once, in Node: rim **11.89:1**, active **9.31:1**, coin **9.41:1** on the
  plate, with muted and disabled held to 3:1 as secondary information rather than body text.
  - The colours themselves are taken from the world rather than invented — the sky's deep navy, the
    HUD's neutral, the ship's cyan, the coin's sand — and the two accents are **134.3 degrees** apart
    so "yours" and "costs money" cannot be confused. Asserted, because they are drawn side by side.
- **Two depth mistakes in one widget, in opposite directions, both found by screenshot.** The plate's
  inner fill shipped at `0.55` alpha and the paused menu read straight through it: the words `Play`,
  `Shop` and `Settings` were legible *over* the shop's own rows. Raising it to `0.94` then exposed the
  second: the rim was at `depth + 1`, on the reasoning that the outline is the topmost part of the
  panel — it is, of the panel, but the panel is the bottommost part of the *screen*, so a near-opaque
  fill drew over the title, the coin badge and the Close button. `plate()` now places itself *below*
  the depth it is handed, and each overlay's dimming backdrop states its own depth explicitly for the
  same reason: left at the default it draws over the panel and dims the very thing it exists to lift
  off the world. Nothing errors in any of the three cases and each looks plausible.
- **A switch *and* a slider per channel, not one or the other.** They answer different questions and
  the platform only ever asks one: YouTube can mute the game itself, so a player returning from that
  must find their volume where they left it. Collapsing the pair into a single number means the
  number has to remember its own pre-mute value, which is a switch with extra steps. Save is **v8**
  (`soundVolume`, `musicVolume` beside the existing flags); `upgradeV7ToV8` gives a channel that was
  switched off a volume of **0**, because otherwise the first frame a slider existed would show it
  sitting at 70% with the music silent — two controls disagreeing about one thing.
- **The gain curve is squared, and exactly zero at the bottom.** A linear gain sends the top half of
  the travel almost nowhere and crams every audible change into the bottom quarter, which is why a
  linear volume slider feels like it does nothing until it suddenly does everything; at the halfway
  point the squared curve is a quarter of the gain, close to the half-loudness the player expects.
  Exactly zero rather than nearly, because a curve that only *approaches* zero leaves a faint sound
  at the setting the player chose in order to silence something — so **the bottom of the travel
  counts as off**, and `effectiveSound()`/`effectiveMusic()` read it that way alongside the flag.
  - `playSfx`'s own `volume` option is **multiplied** by the slider, never replaced: the lock tone is
    quieter than an impact by design, and a slider that overwrote it would flatten the mix the sound
    design is built on. Music is a single retained instance, so `setMusicVolume` applies to what is
    already playing — a setter that only wrote the save would take effect on the next track, i.e.
    minutes later or never.
- **The slider snaps to 20 steps, and that is what makes the readout honest.** A continuous slider
  beside a percentage shows the player 63%, then 64% for a pixel of travel, and no gesture on a
  touchscreen can deliberately produce either. Twenty steps of 5% is what a finger can aim at.
  - **The usable travel is the track minus one handle**, because the handle's *centre* cannot reach
    the ends without half of it hanging off. Ignoring that is the classic slider bug: the value
    saturates a few pixels early, so the player can see space left to drag into and nothing happens.
    `verify:ui` checks `valueFromX` and `xForValue` against *each other* rather than against
    hand-computed numbers, which is what catches one of them accounting for the handle and the other
    not.
  - **A drag tracks the finger after it leaves the rail.** A slider that stopped responding the
    moment the thumb drifted off an 8px track would be unusable, so past the tap slop the drag owns
    the pointer; inside it, the press is a tap that jumps to that position. Same `ui/gesture.ts` rule
    the shop rows and the weapon row use — **three controls now share it**, which is why it moved out
    of `rail/`.
- **The rail is 8px and its hit zone is 44px**, and both numbers are deliberate: a 44px rail is a
  trough, and nobody hits 8px with a thumb. `sliderHitHeight` is asserted rather than trusted —
  without the floor the zone would be 35px at full scale and 28px at the narrow end, on exactly the
  devices where a touch is the only input. Measured live at 390x844: every hit area in `Settings` is
  at least **44px**, the toggles landing at 45x44 while *drawing* 45x26.
- **`kitToggle` binds no pointer handler of its own**, unlike every other widget in the kit. A switch
  has to be reachable from a key as well as a tap (`S` and `M`), and this project's rule is that the
  scene binds one named action to every source that can trigger it — a widget that also handled its
  own `pointerdown` would fire twice for one tap the moment the scene did the right thing.
- **`Settings` needed a height-fit pass, for the reason three other things in this project have.**
  `uiScale` scales on **width**, and a landscape phone is wide: at 844x390 it returns a full 1, so a
  fixed 346px panel sat in a 390px frame with 22px to spare and one shorter viewport from pushing the
  Close button off the bottom. One factor applied to the whole scale, not a squeezed layout — a
  version that only compressed the gaps would put the switch and the slider in each other's tap
  targets. Verified at 1920x889, 844x390, **844x300** and 390x844: nothing escapes the frame at any
  of them and the smallest tap target stays exactly 44px.
- **What the restyle deliberately did not touch in the shop**: the scrolling, the camera-viewport
  clip, the tap-to-buy rule and the four row states. Each was worked out against a real defect and a
  restyle is not a licence to re-litigate them. Re-verified live at 1920x889: a wheel scroll reaches
  the clamp exactly (137 of 137), a drag inside the window pans back, **a drag beginning on a row
  does not buy** (balance unchanged at 300) while a tap on the same row does (300 -> 0), and the row
  then reads `Select` -> `In use` with the theme switching live behind the panel.
  - `kitRow` gained an `actionLabel` override because `'owned'` means two different things: a
    permanent capability, and a cosmetic the player owns but is not using. The row cannot tell them
    apart — only the scene knows whether there is anything to select — so a caller with no selector
    says `Owned` rather than showing a `Select` that does nothing.
- **The kit's own glyph vocabulary is taken from the game, not invented**: the slider handle and the
  selected-row mark are the shields' diamond, and the slider's ticks are the road's rungs. The player
  has been reading both since the first frame of the first run.
- **`ui/theme.ts` is not deleted and is not deprecated.** It is the template's kit, and after the
  combat pass below it draws only the loading screen and the brand — in the local palette, via that
  one `setTheme` call. Everything the player sees during a run or in a menu is `ui/kit.ts` now. A
  game rebuilding more of its interface should extend the kit rather than reintroduce neon.

### The combat layer on the kit

The HUD, the weapon row, the score pops, the wave banner and the lock-on counter were moved onto the
same palette and the same vocabulary. **No timing, geometry or mechanic changed** — this is entirely
what things are drawn in, plus one layout bug the restyle exposed.

- **⚠ The palette move left every warning state drawn in white, and that was the real damage.**
  Repointing `setTheme` fixed the *rule* violation but not its consequences: the combat layer read
  `colors.secondary` for the low-shield edge pulse, the directional hit flash, the overheat lock arc
  and the heat bar's top step — and `secondary` is now the neutral rim. Four different "something is
  wrong" signals rendering as plain white, each of which had been a colour a moment earlier. **A
  palette swap is not finished when the constants are legal; it is finished when every *meaning* that
  rode on the old slots still has one.**
- **Two kinds of bad news, two colours, and the distinction is the point.** `KIT.warning` (amber) is
  *your own machine*: one shield left, the gun overheating, the heat bar's top step, the lock counter
  at its ceiling. `DAMAGE_COLOR` is *the threat landing*: the HUD's directional edge flash and
  `Effects`' damage frame. They were one colour before, so the game could not tell the player which
  of the two had happened.
  - **`DAMAGE_COLOR` is `THREAT_COLOR` itself, and is the third and last exemption** beside
    `enemy.rim` and `enemyTint`. A shot arriving is as much "the threat" as the enemy that fired it.
    It lives *outside* `KIT` precisely so `verify:ui`'s sweep does not have to special-case it, and it
    is asserted separately — both that it is inside the reserved band (deliberately) and that it is
    not in `KIT` (so the sweep cannot be quietly weakened).
  - It replaces a hardcoded `0xff3355` in `Effects.ts`: an undocumented literal **4.4 degrees** from
    the reserved hue, i.e. the threat colour arrived at by eye rather than by name.
  - **The amber was picked by measurement from six candidates**, not chosen: 46.1 degrees from
    `THREAT_COLOR` (against the 30 reserved), luminance 0.454 (over the HUD's own 0.3 floor), 7.21:1
    on the plate, and the furthest of the six from `coin`. That last one matters because the heat
    bar's warm step *is* `coin` and its hot step is this — adjacent on one bar, 15.4 degrees of hue
    apart. The separation the eye actually uses there is the 0.154 luminance step, which
    `verify:hud` asserts rather than assumes.
- **The heat bar and the multiplier both became three-step ramps that differ in hue**, cyan -> sand ->
  amber, instead of ramps that ended in whatever `secondary` was. The overheat still changes the
  bar's *shape* into blocks, which remains the primary signal — the colour is the confirmation.
- **The armed weapon cell carries the kit's diamond**, the same mark the shop puts on the in-use row
  and the same shape a shield pip is. The lift and the punch say a switch *happened*; the diamond
  says which one it landed on once the motion is over. It sits on the cell's top edge with `0.1` of a
  cell of overhang against the heat bar's `0.34` gap, so it cannot reach the bar even at full lift.
- **`verify:hud`'s palette check used to be three copied hex literals** with a note saying the themed
  steps were `verify:road`'s problem. That was true of the road themes and false of the interface
  palette — and it is exactly the gap the shields fell through. It now reads every colour the HUD
  draws in from `ui/kitPalette.ts` by reference, so a repaint cannot leave the check testing colours
  nothing uses.
- **⚠ The result screen's three pieces were positioned against the viewport while its panel was
  positioned against itself.** Title at `height * 0.38`, body at `0.5`, button bottom-anchored at
  `0.28`, panel `min(height * 0.5, 360)` tall and centred: those agree only where the `min` does not
  bite. At 1920x889 the panel ended at y 625 and the button was anchored at y 640 — **hanging off the
  bottom edge of the panel it belongs to**, for as long as the result screen has existed. Invisible
  while the panel was the template's translucent one; obvious the frame it became the kit's opaque
  plate. Now one `resultPanelRect()` with three offsets inside it, read by both the layout and the
  draw. Verified at 1920x945, 1280x720, 844x390 and 390x844: nothing escapes the panel at any of them.
  - The panel also grew from `0.5` to `0.62` of the frame's height, because laying the button *inside*
    it needs the room the old layout was borrowing from the frame.
- **Measured live** at 1920x945 by forcing the states rather than waiting for them: last shield amber
  with two muted sockets, amber periphery, the reserved red only on the hit band, the heat bar broken
  into amber blocks under an amber lock arc on a cyan-rimmed cell. Suites: 337 -> 339 checks green
  (`verify:hud` 11 -> 12, `verify:ui` 20 -> 21), build unchanged.

## The Loadout Screen

`src/rail/loadoutEdit.ts` (pure, `npm run verify:weapons`) + `src/scenes/Loadout.ts`, with
`src/ui/scrollPanel.ts` extracted from `Shop.ts` so both lists scroll through one tested copy.
`weaponLoadout` has been in the save since v7 and `resolveLoadout` has been filling it from "the
first three you own" ever since — a default standing in for a decision nobody could make. With four
weapons owned the fourth was unreachable, and the only way to change what a run started armed with
was to buy something.

- **⚠ The obvious screen has three verbs and one of them is not implementable.** Add, remove,
  reorder — and **remove cannot stick**: `resolveLoadout`'s third rule fills a short loadout from
  what is owned, so a player who owns four weapons and removed one down to two would find the third
  slot filled again at the start of the next run. The tap would appear to work and undo itself
  somewhere they were not looking.
  - **Caught by an assertion, before the screen shipped.** `verify:weapons` walks a sequence of
    edits and asserts after each one that `resolveLoadout` returns *the same array* — i.e. that the
    screen only ever produces loadouts the resolver agrees with. It failed on the second edit of the
    first version. Without it this would have shipped as "sometimes my loadout resets", which is
    close to undiagnosable from a bug report.
  - The alternative was a save flag distinguishing "curated" from "defaulted", i.e. a schema bump
    for a boolean, to make the resolver stop repairing something it exists to repair.
- **So there is exactly one verb: tap a weapon and it leads.** It moves to slot 1, the rest shift
  down, and the fourth falls off the end — the *last* slot, never the first, because the first is
  what the player is looking at when they tap. It is strictly **more** expressive than
  add-plus-reorder: any arrangement of three is reachable in three taps (tap them in reverse order),
  and there is no mode to hold in your head, which a two-step "select a slot, then fill it" screen
  would have and would stop showing the moment the player looked away.
  - The loadout it produces is always exactly `min(LOADOUT_SIZE, owned)` long *given one that
    already was* — which is what the screen starts from, since it seeds itself with `resolveLoadout`.
    That is the whole reason no save flag is needed.
  - Tapping a **slot** does the same thing to the weapon in it, so the top row is a control and not
    only a picture.
- **The screen writes both save fields on every change, not on Close.** `weaponLoadout` is the row
  and `selectedWeapon` is what the shop shows as "in use" and what the resolver leads with; writing
  only the first would let the resolver move the shop's answer to the front and quietly undo the
  order just set. On every change rather than on Close because a player who backs out with the
  platform's own gesture has still made the choice — `store.mutate` is debounced, so this is one
  write every couple of seconds however many taps land in them.
- **Rows commit on the tap, not the press**, the same `bindAction({ tap: true })` the shop's rows
  use and for the same reason: the rows are the only thing there is to grab, so every scroll gesture
  begins on one. Verified live — a drag beginning on a row left the loadout untouched while a tap on
  the same row rearranged it.
- **`ui/scrollPanel.ts` was extracted when the second list needed it, not before.** The three pieces
  it joins are old — `scrollRegion.ts` for the clip, `scrollMomentum.ts` for the physics,
  `scrollList.ts` for the arithmetic — but the code that *wired* them lived inside the shop, and the
  wiring is what carries the two non-obvious rules: the drag's sign (the content moves opposite to
  the camera) and the pointer's own event clock. A second copy would be a second place for those to
  be subtly wrong, and neither is visible in a screenshot when it is. What stays in each scene is
  the half only it can know: which objects belong to the window and which to the chrome.
  - The shop's scroll was re-verified after the move: a wheel reaches the clamp exactly (89 of 89),
    a drag pans back to 0, and the region camera's `scrollY` tracks both.
- **⚠ The third menu button shipped invisible for one round, and the cause is a shape worth
  recognising.** `MainMenu.playEntry` sets every object in `uiAlphaTargets()` to alpha 0 and then
  fades in an *explicitly named* set — two lists for one fact. Adding `Loadout` to the first and not
  the second produced a button that was correctly positioned, correctly sized, interactive, hit-area
  ≥44px, `visible: true`, and drawn at **alpha 0**: it passed every measurement the layout sweep
  takes and could not be seen. Found by looking at a screenshot after the numbers came back clean.
  - Fixed by a single `secondaryButtons()` accessor that the entry cascade, the exit fade, the
    layout, the scrim and the contrast probe's regions all read. **A reset list and a restore list
    that are written separately will disagree**; the only defence is that there is one list.
- **The secondary row needed a width fit, which it never had.** The height fit has been there since
  the redesign — `uiScale` scales on *width*, so a landscape phone keeps a full-size stack in an 86px
  band. Three buttons introduce the mirror problem: at their nominal size they overflow a 390px
  frame. Both are the same lever, so the smaller factor wins. Measured at 1920x945, 844x390 and
  390x844: all four buttons inside the frame, no overlaps, every hit area at least 44px, and the row
  spanning 15..375 of a 390px frame.
- **The slots and the run's weapon row draw the same two things**, deliberately: a filled slot is the
  kit's cyan-rimmed cell with the diamond on it, an unfilled one is the dashed socket. The player
  reads the same picture in the menu and in the fight.
  - `SLOTS_HEIGHT` is 112 rather than 96 because at 96 the slot numbers sat on the hint's own line —
    a band sized for the picture and not for the label under it.
- **Measured at four viewports** (1920x945, 390x844, 844x390 twice): nothing escapes the frame, slots
  are 70–80px against a 44px floor, and the Close button's hit area is at least 44px. At 844x390 the
  row window collapses to its 60px floor against 238px of rows — one row at a time, scrollable, the
  same trade the shop makes there.
- **Verified end to end**: bought three weapons through the real shop flow, chose `ripple` (leading,
  pushing `pulse` out), promoted `scatter` from slot 3 by tapping its slot, reloaded the page, and
  the screen came back holding `scatter / ripple / lance` — then a run armed `scatter` with three
  filled cells and no empty sockets.

## Weapon Upgrades

**⚠ The fork at step I described below is gone with the heat bar**: every gun is now sold
`cooldown` -> `power` -> `shape`, in that order, and the order is load-bearing. See "Five Things A
Player Can Name". The `shape` fork, the prices, the chain-not-a-count rule and the dominance
acceptance are all unchanged.

`src/rail/upgrades.ts` (pure, `npm run verify:weapons`), `src/shop/weaponPrices.ts`, the shop's tab
strip, and no schema bump at all. Seven weapons were one purchase each and then nothing: the shop
was a list the player empties, and the starting weapon was a dead end — a player who could not yet
afford `scatter` had nowhere to put what they had.

- **An upgrade is an ordinary `'unlock'` purchase, so this whole chunk adds no save field.** The
  level is *derived* from `SaveState.purchases` by `upgradeLevel`, exactly as ownership of a weapon
  or a theme is. Save stays at **v9**. Read as a **chain** rather than a count, for the same reason
  `unlockedCount` reads the cleared list as one: a hand-edited payload holding only `mk3` means the
  player has the last step and neither of the two it is built on.
- **⚠ The first version charged `mortar` for nothing, and the simulation is what said so.** Step I
  was heat for every gun, and the 7x4 table came back with `mortar` and `pulse` doing *identically*
  the same damage a minute with it as without — not nearly, identically. Heat is not a resource for
  a weapon whose own cooldown already holds it under the decay rate, and `heat.ts` documents those
  two never overheating as the shape the set is meant to have. **So a bar that never fills cannot be
  made to fill more slowly, and a heat step for those two was a product that does nothing.**
  - The fix is the design, not the check: `upgradePath` gives a weapon heat cannot reach a raw
    damage step (`'power'`) in that slot instead. **Derived from the weapon's own numbers**
    (`heatBinds`), so a re-tuned cooldown moves a gun onto the right ladder by itself rather than
    leaving it selling a dead step.
  - **`UPGRADE_POWER_SCALE` is derived from what it stands in for, not picked.** A heat step is
    worth a median of **x1.098** of a minute's damage to the five weapons that get one; the stand-in
    is set to give the other two **x1.100**, and `verify:weapons` asserts the two stay within three
    points of each other. A stand-in worth more makes the guns heat cannot reach the ones to buy;
    worth less, and owning one is a tax.
- **The `shape` step forks, and both halves are asserted.** A multi-shot weapon gains a projectile;
  a single-shot one hits harder. "+1 projectile" is not an upgrade for `mortar` — one heavy shot per
  mark *is* the gun — and the widened weapons pay for their width in heat, because `heatCost`
  charges per extra projectile.
- **The pool ceilings move with it.** `MAX_IMPACTS` and the volley pool are sized from
  `MAX_UPGRADED_SHOTS_PER_LOCK`, not from the weapon table's own `MAX_SHOTS_PER_LOCK`: step III
  widens every multi-shot gun, and a pool one short of the real ceiling silently drops exactly the
  shot the player paid for. Measured live: the volley pool is **40** (8 locks x 5), was 32.
- **`UPGRADE_REFERENCE_MARKS` is spelled out rather than imported, and asserted equal to
  `MAX_LOCKS`.** `constants.ts` imports the shot ceiling from `upgrades.ts`, so an import back the
  other way is a cycle whose failure mode is a top-level constant reading `undefined`. Same shape,
  and the same reason, as `DEFAULT_WEAPON_ID` being duplicated in `save/types.ts`.
- **`WEAPON_PRICES` moved to its own file** for the same cycle reason: a step costs a share of the
  gun it improves, so `rail/upgrades.ts` needs the price table that used to live inside the
  catalogue that now imports `rail/upgrades.ts`.
- **Prices are a share of the gun plus a floor**, which is what makes the two ends work: `lance`'s
  first step is **300** against a cheapest weapon of 800, so the player who cannot afford a second
  gun has somewhere to spend — that is the wall this chunk exists to remove — while a `needle` step
  costs double a `lance` one, because it multiplies something already paid thousands for. Every
  upgrade in the game is **19 600 coins** against a 250-a-run cap; that number is printed rather
  than asserted, because the economy has one more chunk to come.
- **Acceptance, from the plan: nothing upgraded makes the next gun on the ladder pointless.** The
  same four-axis dominance test `verify:lockon` runs over the base set, with a fully upgraded gun on
  one side and the *next thing the shop will sell* at level 0 on the other. It passes for every
  adjacent pair.
  - **Further up the ladder domination does happen, and it is allowed only because it was paid
    for.** Five cases (`scatter III > lance` and `> ripple`, `flechette III > lance` and
    `> scatter`, `needle III > pulse`), and the assertion is that the dominating side has always
    cost more coins than the dominated one. They are printed, not hidden.
  - **The check is shown to fail before it is believed**: a deliberately greedy step III (double
    damage *and* a wider volley) is run through the same test and must be rejected.
- **The balance table is the acceptance artefact.** Damage a minute for all 7x4 states, printed by
  `verify:weapons`, with three assertions over it: every step raises the minute for every weapon
  (the check that caught the dead heat step), within one level nothing is past twice the median or
  under half of it, and a fully upgraded gun is worth **x1.3 to x2.5** of itself — a boost, not a
  new game. Current spread: **77% of the median at level 0, 107% at level 3**.
- **The shop grew tabs, and the mechanism is generic.** `ShopItem` gained `category` (an i18n key),
  `requires` (an item that must be owned first), `selectable` (whether an owned row is a *choice*)
  and `titleSuffix`/`detailKey` (the numeral and what the step buys). The shop knows nothing about
  weapons or upgrades; **the tab order is the order `main.ts` registers the catalogue in**, because
  the shop cannot have an opinion about whether weapons matter more than themes.
  - A catalogue with one category renders exactly as it did before tabs existed, chrome height
    included — the strip is only drawn when there is more than one group.
  - **Rows filter, they do not rebuild.** Every row is created once in `create()`; a hidden one is
    `setVisible(false)`, which also takes it out of input, since Phaser hit-tests through
    `willRender`. So the tab filter needs no second guard in the purchase path.
  - **A tab switch jumps the list to the top** (`ScrollPanel.scrollTo`). `setWindow` deliberately
    re-clamps rather than resetting, which is right for a rotation and wrong here: the content has
    been replaced, not reshaped, and clamping drops the player part-way down a list they have never
    seen.
  - **The prerequisite is checked in the purchase path as well as in the row's state.** A state is a
    picture and a purchase is a debit; the two are refreshed at different moments and only one of
    them takes coins.
- **⚠ `create()` reset `this.rows` and not `this.tabs`, and the shop crashed the second time it was
  opened.** `Shop` is `launch()`ed fresh every time, so a list surviving the previous instance left
  `layoutTabs` sizing buttons Phaser had already destroyed — which throws inside the text renderer
  on `glTexture` of null, i.e. **the exact signature `applyTheme`'s documented precondition
  produces**, and nothing to do with themes. Found by opening the shop three times in a row, not by
  reading the code. Any list a scene builds in `create()` needs resetting there beside the others.
- **The row says what a step buys**, because the steps are not the same for every gun: `↑ Lance II ·
  Rate`, `◉ Pulse I · Power`, `∴ Scatter III · Extra shot`. A row showing only a numeral is a
  purchase the player makes blind. `Loadout` shows the level too (`Scatter III`), since it is the
  one screen where the three guns are compared.
- **Verified live** at 1920x945: three tabs (Weapons / Upgrades / Themes) each with a hit area of
  at least 44px and a 333px strip inside a 420px panel; `Lance II` reads `Locked` until `Lance I` is
  bought and refuses the tap while it does; buying the chain flips each row to `Owned` and the next
  to `Buy`; the save comes back holding all six purchased steps; and a run armed **`scatter L3` at
  cd 192 with 3 shots and heatScale 0.85** beside **`lance L3` at cd 240 with 1 shot and damage
  1.40** and an untouched `ripple L0`.
  - **Not measured live: the tab strip on a phone-width frame.** The harness could not hold a small
    viewport — the same limitation already recorded for the menu work. The strip is 333px at scale
    1 and `uiScale` returns 0.8 at 390px, so the arithmetic is comfortable, but it is arithmetic.

## The Fourth Slot

`loadoutSize` in `src/rail/loadout.ts`, `src/shop/slotCatalog.ts`, and one number removed. The row
carried three weapons because `LOADOUT_SIZE` was `3` — a constant, not a rule — and a player who
owned five had no way to spend coins on carrying more of them.

- **`LOADOUT_SIZE` is deleted rather than left beside the new function, and that is the point.**
  Every call site now has to ask `loadoutSize(purchases)`, which the compiler enforces; a constant
  left in place would have kept working at every site that could not see the purchases, and each of
  those is a place that silently keeps sizing itself for three. What replaces it is
  `BASE_LOADOUT_SIZE` (what a run carries having bought nothing) and `MAX_LOADOUT_SIZE` (the
  ceiling, which is what the geometry is checked against — see below).
- **No save field, again.** The slot is an ordinary `'unlock'` purchase, exactly as a weapon, a
  theme and a weapon upgrade are, so this chunk is another one that leaves the schema at **v9**. Its
  id wears neither the `weapon-` nor the `theme-` prefix, and `verify:weapons` asserts that both
  `weaponIdFromItem` and `upgradeFromItem` refuse it — three id spaces share one `purchases` array,
  and an id two of them claim is a purchase that grants two things.
- **⚠ The acceptance was to *re-measure* `rowClearsDragZone`, not to assume it.** The plan predicted
  ~54% of a 390px frame for four cells against a drag zone starting at 35%. Measured: **41% at three
  cells, 54% at four** — the prediction was right, and it is now printed by the check at both counts
  rather than at whichever one the constant used to say. Every geometry assertion in that check now
  sweeps `BASE_LOADOUT_SIZE` **and** `MAX_LOADOUT_SIZE` across five viewports, because a shipped
  configuration that no check ever measures is a configuration nobody knows the state of.
  - The overlap is the same stated trade it always was: 44px cells cannot both clear the middle
    third and stay tappable on a phone, and what makes it safe is that the row never captures a
    pointer. Verified live at four cells — see below.
- **⚠ The number keys stopped at `3`, so the fourth slot shipped reachable by thumb and by wheel and
  not by keyboard.** `WeaponRow` bound `ONE`/`TWO`/`THREE` from a written-out list; it now slices
  `MAX_LOADOUT_SIZE` keys off one. A control that exists for two of its three input sources is the
  kind of gap nobody files a bug about — they just never use the key.
- **The loadout screen sizes its boxes to fit the row, not to a fixed fraction.** Four boxes at the
  three-box size are **94% of the panel**, i.e. they spill past the padding every row inside it
  respects. `SLOT.size` is now a ceiling and the panel's content width is the real constraint, which
  leaves the three-slot case pixel-identical because three at that size already fit. Measured at
  1920x945: four boxes of 74px spanning exactly the 372px content width, each well over the 44px
  minimum.
- **The row draws a position per *slot*, and the scene supplies the count.** `WeaponRow` takes
  `slots` rather than reading a constant, and never lays out fewer positions than it has weapons —
  a row that drew four guns into three boxes would put one of them outside the row it belongs to.
  The unfilled ones stay the dashed sockets that say the mechanic exists.
- **The product sits first in the upgrades tab.** It is not an upgrade to a gun, but it is the same
  kind of thing to the player — coins spent on carrying more rather than on one more toy — and what
  it must not be is row twenty-two of a scrolling list, which is a row nobody discovers. Priced at
  **4000**, above the dearest weapon (3400): a slot multiplies what the player already owns rather
  than adding to it, and a cheap one bought early is an empty socket. **No prerequisite**, because
  the only honest one would name a particular weapon.
- **Verified live** at 1920x945: bought for 4000, the row flips to `Owned` and the save comes back
  holding `loadout-slot-4`; the loadout screen opens with **four** numbered boxes, all filled, and
  `Pulse` reading `Slot 4`; a run builds a four-cell row at 78/158/239/320 with 71px hit areas; keys
  `1`, `3` and `4` arm the right weapon; and **a stroke beginning inside each of the four cells is
  picked up by the lock-on on the press, keeps every one of its eleven pointer samples, and changes
  the armed weapon not at all** — which is the "does not lose locks" half of the acceptance measured
  through the mechanism rather than through luck with an enemy.
  - **Not measured: a stroke that actually marks an enemy while starting in the row.** `lockTargets`
    is refilled every frame, so a synthetic stroke has to coincide with a live target, and across
    several hundred stepped frames it did not. The three-cell version of exactly this was verified
    live when the row shipped, and nothing in this chunk touches `LockOnView`.

## The Art For The Behaviour Kinds And The Second Boss

`jammer`, `splitter`, `warden` and `boss2` ship as PNGs. All four are img2img from **shaded,
black-outlined procedural roughs** (`rail_enemy3_roughs.py` in the sibling Remotion project), which
is the method that landed 12/12 on the biome-round enemies and landed 3/3 on these.

- **The three enemies took one round each and needed no retries.** `canvasEdge 0.0%` on all nine
  variants (no landscape leaked in), `ringNearBg 0.0%` (no matte halo), symmetry 0.96-0.99. The
  method is not new and that is the point: the rough carries the vantage, the proportion and the
  tonal structure, and the model fills in armour.
- **⚠ The delivered aspects moved the sizes, and the table follows the art rather than the brief.**
  Briefed 40/72/104 wide; the renders came back at 0.400, 1.270 and 1.778, so `ENEMY_SIZES` now says
  37/74/121. Same rule the rest of that table already followed, and the reason it exists: a kind
  drawn at one proportion and sized at another is squeezed on every frame.
- **⚠ The second boss took two more rounds, and both failures are worth keeping.** This subject had
  already failed twice before (side-view naval warships from a photoreal checkpoint; a raster copy
  of the polygon from a flat init at low strength).
  - **Round 3 fixed the panelling and broke the subject.** A heavily banded rough at **strength
    0.85** took `rimSharePct` from 81-95% to **35.0%** and refIoU from 0.987-0.991 to 0.68-0.88 —
    i.e. the model finally invented armour instead of tracing the polygon, which is exactly what the
    previous round's write-up predicted would work. It also produced a **humanoid** four times out
    of four: a horned knight with a face, fists and feet.
  - **The cause was the rough's own body plan, not the prompt.** Two shoulder masses standing clear
    of a central crown over two separated legs *is* a torso, a head and limbs; with enough schedule
    left to invent, the model completes the figure it has been handed. `ENEMY_NEGATIVE` already
    carried `human, face` and it did not save it. **The shape wins over the words** — which is the
    same lesson `fun_squat` taught in the biome round, where a squat cap on a short stalk is the
    proportion of a mascot.
  - **Round 4 redrew the rough with no body plan at all** — one continuous edge-to-edge hull, a
    battlement of five ridges instead of a helm, a chamfered skirt instead of legs — and the
    panelling survived the change. `siege_crown_v8` ships.
  - **⚠ And the boss's own negative was 90 tokens against a 77-token window on its first draft**,
    i.e. every term added to stop the humanoid did not exist. Trimmed to the body-plan nouns
    `ENEMY_NEGATIVE` actually lacks. `check_budget()` had never measured it, because it only ever
    listed two of the three negatives the module can hand a renderer; it now lists all of them.
    **A budget check that does not cover every string it can produce is not a budget check.**
- **Verified live** on `ruins`: all three enemies drawn from art and tinted by the theme, the
  jammer's ring and the warden's shield arc landing on the art rather than on a silhouette, the lock
  cap at 4; then the second boss on the rail with its zone drawn a third of the way across it and
  the HUD bar in four segments. Zero errors. Bundle 3.89MB against the 6MB working ceiling.

## Three Enemies That Change The Verb

`jammer`, `splitter` and `warden`, in `src/rail/enemy.ts` (`lockCapFor`, `isJamming`, `isLockable`)
and `src/rail/waves.ts` (`splitOnDeath`). Eight kinds already existed and **all eight attacked the
same way** — telegraph, then a shot at a remembered point. A ninth silhouette firing the same shot
is not a new enemy, so each of these three changes what the player *does* instead.

- **`jammer`: while it is alive and in range, a stroke may take four marks instead of eight.** The
  first thing in the game that touches the verb rather than a number — the volley stops being wide,
  so the stroke has to be spent rather than swept, and the frame acquires a target worth killing
  before the ones actually shooting at you. The multiplier is linear in the stroke's size, so a jam
  roughly halves what a full stroke is worth; that is the pressure, and `run.ts` is deliberately
  **not** told about the cap, because the player being unable to reach x3 while jammed is the point.
  - **The cap comes back on the killing hit, not when the corpse finishes.** `isJamming` returns
    false for a `dying` jammer, so the reward lands on the input that earned it rather than most of
    a second later.
  - **Its range ends behind the camera**, so outrunning one is a real answer beside killing it —
    and the range used is `ENEMY_ATTACK_RANGE_Z` itself, so "the fight has started" and "the jam is
    on" are one moment rather than two the player has to learn separately.
  - **Jammers do not stack.** Two of them cap at the same 4 rather than at 2: a stroke narrowed to
    one mark is a stun, and a stun is not a pressure anybody can play around.
  - `lockCapFor` returns the **cap**, not a reduction, and one value is handed to `updateLocks`, to
    the counter ring's segment count and to `hudState.lockProgress` — so the three cannot disagree
    about what the player is allowed. The ring losing half its segments is how the jam announces
    itself, in the corner of the eye that is already on the ship during a stroke.
  - **Lowering the cap does not release marks already taken.** A lock the player paid a drag for is
    theirs; confiscating it would read as the game undoing their input rather than as a new limit.
- **`splitter`: dies into two swarmers.** It changes the economy of a stroke — a wide sweep across a
  group of them produces more targets than it had marks, which is the first reason the game gives
  the player *not* to spend the whole stroke at once.
  - **Never two splitters, and that is structural rather than a depth counter**: the children are a
    different kind, so the chain is one generation long by construction and there is nothing to
    recurse.
  - **The children inherit the parent's wave membership**, which is what keeps `isWaveCleared`
    honest — without it a wave could report itself finished with two of its own children still
    shooting, and the breather would start under fire. "Gone" still means killed *or* left behind,
    so they cannot stall a run either. A splitter that was not part of the current wave gives its
    children to nobody, so a straggler cannot hold the next wave open.
  - Split in the **removal** pass rather than at the killing hit, so the two appear as the corpse
    finishes coming apart and read as what it came apart into.
- **`warden`: a shield marks do not go through, down for exactly as long as it is winding up.** The
  window in which it can be killed is the window in which it is dangerous; a shield that dropped at
  any other time would be a timer to memorise rather than a fight to read. Its cooldown is short
  (1400ms) because how often it attacks *is* how often it can be shot.
  - **It is drawn and not listed**, never marked-and-ignored. A stroke across a shielded warden
    passes through it exactly as it passes through empty sky, and the arc drawn over it is what says
    why — the same shape as the boss's shut zone, and for the third time the same lesson: **a target
    that silently refuses input reads as the game dropping it.**
  - Measured: the shield is down **28% of the time**, in `TELEGRAPH_MS` windows.
- **The marks are drawn inside `Enemies.render`, not in a view of their own.** Both answer a
  question about *this frame's target list*, and that is the loop which builds it; a separate view
  would need the same projection a second time and the two could then disagree about exactly the
  thing they exist to communicate. Same argument as `bossZoneRect`.
- **HP and points are set by the answer each kind demands, not by how tough it looks.** `jammer` is
  2 HP (it has to die *first*, so a weak weapon must manage it in one stroke) and worth **400
  points** — more than anything but the bulwark, and it is not the tougher one: points have always
  tracked how much of a stroke a kind costs, and the jammer costs the stroke the player wanted to
  make. Pricing it by toughness would make ignoring it optimal.
- **They arrive in tiers 3 and 4**, never earlier: each asks the player to do something *instead of*
  the usual sweep-and-release, and a level that asks that before the player has the sweep is
  teaching two things at once. The `warden` is last, for the reason the `bulwark` is.
- **They shipped on the procedural silhouettes and now ship on art** — see "The Art For The
  Behaviour Kinds And The Second Boss". The silhouettes remain as fallbacks, and each still carries
  the kind's whole identity in an outline (a tall mast, a two-lobed body that is already the two
  things it comes apart into, a wide plate).
- **⚠ And putting silhouettes back on screen exposed a defect nothing could see: on two themes,
  hostile things were drawn in the player's own colour.** `enemy.rim` is what an enemy *shot* is
  drawn in and what a generated silhouette is outlined in — and `dusk` measured **1.6 degrees** and
  `ember` **1.7** from the ship's hull in OKLab hue, against 122–169 for the five that were fine.
  Both repainted (cold pink and violet), and `verify:road` now holds every theme to a 30-degree
  floor and is shown to reject the two originals.
  - **It is the mirror of the threat reservation and nobody had asked it.** That sweep asks how
    close a colour is to danger; this asks how close a *dangerous* thing is to the player. Found by
    looking at a frame, and only because every enemy kind had become raster art, which had quietly
    taken `enemy.rim` off the screen for a whole round.
- **⚠ A check that sampled five waves stopped working when the pool grew.** `every flier is laid out
  above eye level` asserted over a seeded draw, and three more kinds diluted it until no turret
  appeared — failing for a reason with nothing to do with heights. It now asserts **the table**
  (every band in `ENEMY_HEIGHT_BANDS` is above eye level, and the turret has no band at all) and
  keeps the draw as confirmation that the layout consults it. A draw can only ever say "the kinds it
  happened to roll are fine".
- **Verified live**, by injecting each kind into a running scene: a jammer 5000 units ahead takes the
  cap 8 → 4 and the ring is drawn; killing it restores 8 **in the frame the hit lands**, before the
  corpse is removed; a warden is absent from `lockTargets` while idle with its arc drawn, present
  during `telegraph` with the arc gone, and absent again after; a splitter killed and stepped through
  its death leaves live 4 → 5, both children `swarmer`, both in `currentWaveIds`, offsets symmetric
  about the parent. A `crystal` run rolled `splitter` and `warden` from its own pool with zero errors.

## The Ninth Biome

`fungal`, a spore forest, and the ninth level flown on it. The plan's last chunk is "one biome per
level beyond the eighth, as art allows" — which turned out to be two problems: the table could not
take a ninth biome at all, and the model would not draw one.

- **⚠ `BIOME_RUN_SEGMENTS` was a hand-set constant that had already been wrong twice, and is now
  derived.** 420 when six biomes shipped (a lap reached four of them; two existed only in the data)
  and 240 when eight did (six of eight) — both caught by the same check, both fixed by hand, and its
  own docstring admitted "this does not scale, and the next biome is where it stops."
  - It is now `biomeRunSegments(trackLength, biomeCount)`, which is what it always *meant*: the lap
    over the number of biomes. **On the shipped 1434-segment lap with eight biomes it computes 179,
    bit for bit the value that was arrived at by hand** — the best evidence available that this is
    the right derivation rather than a convenient one.
  - **The floor is what binds now, and it is a live constraint rather than a note.**
    `MIN_BIOME_RUN_SEGMENTS` is 150, below which a stretch stops being a place; `verify:road` prints
    *"8 biomes over a 1434-segment lap = 179 each (floor 150; this lap carries at most 9)"* and is
    shown to reject one biome past that. When it does fail, the lever is the **track's** length,
    which is what the old docstring said and what nobody could act on while the number was manual.
  - A side effect worth knowing: the last stretch of a lap that does not divide evenly now wraps
    onto biome 0, which is the biome the lap *starts* with — so the seam is a longer first stretch
    rather than a boundary between two different places.
- **The boss blocks absorb a level past the last block.** `LEVELS.length % BOSS_BLOCK_SIZE === 0`
  would have failed on a ninth level, i.e. content would have been gated on a boss nobody had drawn.
  `bossKindForLevel` already clamped; the check now asserts what actually matters — every level maps
  to a real boss, the mapping never goes backwards, every *whole* block is whole, and both bosses are
  still reached.
- **⚠ Three rounds asked for six fungal *morphologies* and got two usable props out of 39 renders.
  The fourth asked for six *proportions* and got five out of six.** That is the whole finding, and it
  is about the model rather than about the prompts: **DreamShaper XL draws a capped mushroom and
  essentially nothing else in that family.**
  - `shelf`/`bracket`/`tiers`/`stack` gave isometric voxel shelving, a pagoda, a row of parasols and
    a fan machine on masonry — nine renders, and changing the concept to a fallen log did not rescue
    it, because those are all carpentry words and the model reaches for a building whatever they are
    attached to. `puffball` gave four detached balloons twice (a set, not a prop — the failure
    `dune_bone_v1` shipped once) and then a stone observatory dome. `coral fungus` gave a berried
    tree, then an upside-down jellyfish, and then the round's best asset once `branching` was removed
    entirely.
  - **Proportion is a thing this model can hold and morphology is not** — and proportion is what the
    game reads type by anyway ("type reads by aspect before it reads by contour"), since every prop
    is desaturated 50% and multiplied by a tint, so hue is not information either. The shipped five
    run from a 35:100 spire to a 190:100 spread.
  - **`fun_pair` is a failure mode turned into a slot.** Every single-subject prompt in rounds 1-3
    came back as a group at least once; round 4 asked for exactly two of different sizes and spent
    that tendency on something the biome can use instead of negating it and losing the render.
  - **`fun_squat` is pulled, and its failure is the most specific in the set**: "a squat wide
    mushroom, flat broad cap on a very short fat stalk" is the proportion of a **cartoon character**,
    and two of three came back with legs and shoes or a face and arms. So `fungal` ships with five
    props, the way `crystal` does after `cry_shard` was rejected. Full account in
    `dev-assets/sprites/NOTES-fungal.md`.
  - **⚠ And a retry's own negatives broke the CLIP window before they broke anything else.** The
    round-2 tails pushed five of six negatives to 82-87 tokens against a 77-token cut, i.e. the terms
    added to fix the failures did not exist. The biome's base negative was carrying the habitat nouns
    and `pale, washed out` for every slot; it now holds only what every slot needs (the
    reserved-colour trap) and everything else moved per slot. **A negative is not a wish list — it
    has a budget, and `biome_sprite_prompts.py`'s own `check_budget()` is the only thing that knows.**
- **⚠ The ninth level's first circuit was rejected for outrunning the endless run.** Six hard bends
  built a 2292-segment lap against the endless circuit's 1434, and `verify:levels` refused it: a
  level whose lap is longer than the tour is a level the player never gets round, and nothing else
  would have said so. Five bends gives 1662, the same lap `ashen` and `crystal` fly.
- **Verified live**: `fungal` builds a 1662-segment lap under `verdant`, two shields, seven waves,
  zero errors, with all five props standing along both verges and reading as one family at every
  distance. Contact sheet under the biome's own tint on mid-grey — the standing rule, since a numeric
  gate cannot see what a picture is of.

## A Second Boss, And A Run That Does Not End

`BOSS_KINDS` in `src/rail/boss.ts`, `ENDLESS_LEVEL` in `src/game/levels.ts`. One boss served all
eight levels, and the eight-biome circuit the game *was* had nothing to do once levels replaced it.

- **A boss per block of four, derived rather than written into every row.** A boss per level would
  need eight hulls and eight phase tables for a fight seen once; one boss for all eight makes the
  second half's climax the one they already beat. `bossKindForLevel` reads the level's place in the
  chain, and `verify:run` asserts the blocks come out whole and that **both bosses are actually
  reached** — the half a derivation cannot guarantee for itself.
- **What differs is the shape of the fight, not the system.** Phases already advanced on HP and the
  zone already *was* the lock-on target, so the second boss is a different hull, a different number
  of zones and a different way for them to move. `siege-crown` has **four** phases against
  `warden-prime`'s three, its zones **cross** the hull (0.30 → 0.72 → 0.22 → 0.50) instead of
  climbing it, so the player re-aims laterally on every shift rather than raising the same stroke,
  and it sways harder and faster throughout.
- **⚠ A boss now carries its own phase list, and that is the same trap `phaseThreshold` already fell
  into once.** A module-level `BOSS_PHASES.length` silently means *the first boss's* phase count:
  `damageBoss` would have skipped the fourth zone outright and the HUD would have drawn three
  segments full and then emptied two at once. Both now read `boss.phases.length`, and the negative
  control in `verify:run` computes a four-phase boss's thresholds with three and shows the last one
  going negative.
  - `BOSS_PHASES` stays exported as the first boss's list, because a lot of this file and several
    checks name it — but new code reads `boss.phases`.
- **The second hull now ships as art** (`boss2.png`) — see "The Art For The Behaviour Kinds And The
  Second Boss", which is where the two rounds it took are written up. Its silhouette is deliberately
  nothing like the first's broad notched mass, because four levels apart the outline is the only
  thing that says which fight this is. `BossView` switches texture in `render` rather than at construction, and
  clears the crop first — a crop is in the frame's own pixels.
- **The endless run is the game the levels replaced, unlocked once all eight are cleared.** All
  eight biomes cycling along one 1434-segment lap (`{ kind: 'cycle' }` and `buildRunCircuit`),
  against a level's single pinned biome. That is the whole difference between a place and a tour.
  - **It is not a ninth level and is deliberately not in `LEVELS`.** That array is the unlock chain
    and the progress readout; a ninth entry would change what `unlockedCount`, every biome index and
    the whole star record mean. It is a row the picker appends, with its own gate
    (`allLevelsCleared`) and its own label. `levelById` answers it explicitly, or a save holding its
    id would silently fly the forest.
  - **One rule change in the run machine, and it is one branch in `completeWave`**: waves wrap
    instead of giving way to a boss. Scoring, the multiplier, the breather, the wave summary and the
    per-wave score submission are all untouched — an endless mode with its own run machine would be
    a second game to keep working.
  - It is never "cleared" and earns no stars: there is no end to reach, so writing its id into the
    unlock chain would put a non-level in a list every unlock question reads. Its **score** is still
    banked, because that record is the point of the mode.
- **⚠ The speed ramp's ceiling is the sightline floor, and it is derived from the real sweep.** A
  faster rail shortens the window a target is engageable for, and that floor exists because a corner
  once shipped the player could not fight through — an endless mode is not a licence to reintroduce
  it. The run circuit's worst point measures **5.5s at speed 1**, the floor is **5s**, so the cap is
  **x1.10** and nothing may go past it. Measured, not argued: `verify:road` re-runs the whole sweep
  at the cap (**5.03s**, above the floor) and three steps beyond it (**4.77s**, below), so the cap is
  shown to be binding rather than merely low enough.
  - **Past the cap the run keeps getting harder, by wave size.** That is where the demand actually
    lives (see `LevelDifficulty`) and, unlike speed, the track imposes no ceiling on it. Measured
    live: speed 1.00 → 1.10 over five cleared waves and then flat, while the largest wave grows 9 →
    15 by the twelfth.
  - `game/levels.ts` cannot import the renderer, so it spells the two numbers out and `verify:road`
    asserts them against the real sweep — the same shape as `UPGRADE_REFERENCE_MARKS` and
    `DEFAULT_WEAPON_ID`.
- **The banner is passed `0` rather than a wave count in the endless run.** "Wave 12 of 8" is worse
  than no subtitle, and a count that is a lie is a count something else will eventually use.
- **Verified live**: `ruins` builds `siege-crown` at 48 HP with **four** phases, the crown hull, its
  first zone drawn a third of the way across it, and a HUD bar divided into four; the endless run
  builds the 1434-segment circuit with `endless: true`, no boss, and over twelve cleared waves the
  speed rises to the cap and stops while the waves keep growing — zero errors.

## The Sightline: A Corner You Could Not Fight

`src/road/sightline.ts` (pure, `npm run verify:road`) and a re-shaped `buildRunCircuit`. A player
reported a turn where it was impossible to kill anything in time. It was real, it was measurable, and
nothing in the project could see it.

- **The cause was lateral, not depth and not hills.** At the worst point of the lap, **93 of the 200
  segments** a wave is fought across were outside the viewport — the road ahead had swung off the
  side of the frame and taken the wave with it. A target was engageable for **3.6s against a 6.4s
  baseline**, a 44% cut. Isolating the terms: on the centreline (no enemy offset) the window still
  dropped 6.7s → 4.1s, and **zero** segments failed on being too small to see. Purely the bend.
- **⚠ It was not the hard bend. It was the length of the gentle ones.** The circuit's standalone
  `ROAD_CURVE.HARD` corner measured completely clean — 6.4s throughout. The damage came from
  `addSCurve()`, whose arms reach `ROAD_CURVE.MEDIUM` and run **three sections** long: long enough
  that the whole 300-segment view sits inside one bend and the excursion accumulates across the
  entire draw distance. A short sharp corner is fine because the view is never wholly inside it.
  **The rule is bend-length against draw distance, not bend tightness.**
- **The fix keeps the lap exactly as long.** The arms are now `ROAD_CURVE.EASY`, same length, same
  hills — 1434 segments before and after, which is what holds `BIOME_RUN_SEGMENTS * 8 = 1432` and the
  "a lap reaches every biome" check. Two shorter alternatives scored identically on the sightline and
  were rejected for costing 190–240 segments of lap, i.e. a biome.
  - Re-measured: worst **5.5s**, mean 6.4s, and the binding point moves to the hard bend at segment
    276 — which is the shape that was always fine.
- **`verify:road` now asserts a floor of 5s**, prints the number, and **proves the measure can
  fail**: the same sweep run over a `MEDIUM`-curve S with the same arms returns 3.5s and is rejected.
  A floor that has never rejected anything is not a floor — the same discipline the threat-hue and
  palette checks are held to.
  - 5s is four strokes of the slowest weapon (`mortar`, 900ms) or sixteen of the fastest. The floor
    is about the track never taking the fight away, not about how the fight goes.
- **The measurement deliberately ignores hills.** A crest hides a target and then reveals it, which
  is rhythm; a bend carries it off the side and does not bring it back in the same pass, which is
  dead track. It also tests **both ends** of the enemy spread (`offsetX` reaches ±0.85 half-widths),
  so a stretch that keeps only the inside of the bend does not count as visible.
- **The general lesson.** Everything about this corner was correct: the geometry was valid, the road
  drew properly, the enemies projected onto it exactly, and every existing check passed. What no
  check asked was whether the player could *see* the targets long enough to shoot them — a property
  of the track that only exists in relation to the draw distance, the spawn distance, the rail speed
  and the enemy spread, i.e. in relation to four constants that live in three other files. **A
  playfield can be geometrically perfect and still be unplayable, and nothing local to it will say
  so.**

### Where the coins were

The same round answered a second question with the same shape — the player asked where money for a
weapon comes from.

- **A run has always banked `score / 200`, capped at 250, and never said so anywhere.** The result
  screen showed score, best and waves; the menu shows no balance; the shop shows prices against a
  number the player has no idea how they came by. `MAX_COINS_PER_RUN`'s own docstring reasons about
  pacing ("the first paid theme four or five runs away") for an economy the player could not see
  running. A currency nobody is told they earn reads as one that only comes from the rewarded ad.
- The result screen now carries a `🪙 +N coins` line, **shown even at zero**, because "this is where
  coins come from" is what the line is for and a line that appears only on good runs never teaches
  it. (`MAX_COINS_PER_RUN`'s own pacing reasoning quoted below was later measured and found wrong at
  both ends — the cap is now a property of the level. See "The Economy: A Cap That Knows Which Track
  You Are On".)
- **⚠ That fourth line pushed the body into the Again button at 844x300** — everything still inside
  the panel, one block of text drawn over another. The body was placed at a fixed fraction of the
  panel, and a block whose height depends on how many lines it carries cannot be positioned by a
  constant. It is now centred in the gap between the title and the button and shrunk to fit it, the
  same measure-then-fit pass the menu's title and the wave banner already needed. Verified at
  1920x945, 844x390, **844x300** and 390x844: no overlap with either neighbour at any of them.

## Biome Colour: Why Every Prop Was Grey

`biomes.ts`'s `decorTint`, `color.ts`'s `multiplyTint`, and the sweep in `verify:road`. A player
reported that the trees and bushes had white backgrounds. The mattes were clean; the props had no
colour at all, and had never had any.

- **⚠ The build desaturates decor by 50% on purpose, and nothing ever put the colour back.** The
  chain, all four links individually correct:
  1. `build-sprites.py`'s `DESATURATE = 0.5`, with a written reason — "a multiply tint cannot argue
     with the saturation it is handed", so the art is greyed to give the tint authority.
  2. The only tint applied was `theme.decorTint`.
  3. `day.decorTint` is `0xffffff`, commented "full daylight: art-backed scenery keeps its own
     colour, untinted" — true of art that *has* colour.
  4. `day` is the default theme.
  - So on the default theme every prop drew at half saturation with **no tint whatsoever**: a black
    outline over a pale grey fill, on a bright ground. The ground has carried its biome's colour
    since biomes existed; the props never did. `biomes.ts` even described the arrangement — "scenery
    is desaturated and tinted at draw time by the theme, so a prop never needs a per-theme variant"
    — and that sentence is about *themes*, which is the half that was built.
- **The diagnosis had to survive its own first measurement being useless.** A scan of all 54 sprites
  for edge-connected near-neutral plate — the classic leftover-matte failure, and the one
  `strip_plate` was written for — returned **0.00–0.99%**, i.e. nothing. A second scan for bright
  neutral pixels anywhere returned 0–67%, which is not evidence either: a grey monolith is grey. What
  settled it was rendering the set over magenta and looking, which is the project's standing rule and
  the third time it has been the thing that worked.
- **The fix is `biome.decorTint * theme.decorTint`**, so a forest is green on every theme while the
  theme still says whether it is noon or moonlight. No new art, no change to the desaturation.
  - **Per segment, not per frame.** Biomes run along the track, so two are on screen at every
    boundary; a single tint per frame would paint the forest in the dunes' sand for six seconds
    either side of the seam. `biomeIndexForSegment` was split out of `biomeForSegment` so the
    renderer can address its parallel tint array without an `indexOf` scan per drawn sprite, and the
    two lookups share one piece of arithmetic so they cannot disagree.
  - The eight products are recomputed every frame rather than cached, for the same reason the theme
    tint always was: a theme switch replaces the whole object, and a captured value keeps painting
    the light of a theme the player has left.
- **⚠ The sweep rejected a tint on its first run, which is the only reason to trust it.** Every biome
  tint clears the reserved threat band on its own — the closest is `ashen` at 56.8 degrees against
  the 30 reserved — and that proves nothing, because a tint *multiplies* and the theme multiplies
  again. `dusk × crystal` at the first-draft violet `0xc0a8e0` came out `#a36f65`: red, saturated,
  and inside the reservation. Crystal is blue-violet because of it. `verify:road` now sweeps all
  **8 × 7 products** for the reservation *and* for a luminance floor, and asserts that it still
  rejects the tint it was written for.
  - Darkest product today: `night × forest` at **0.110**, against a 0.09 floor. The floor exists
    because two dark factors crush a prop to a silhouette, and the biome tints are authored light
    for that reason.
- **Three sprites were the wrong subject, and a numeric scorer picked all three.** `pick-sprites.py`
  scores variants against the criteria the prompts were briefed with; the generating agents died on
  a session limit before reporting picks, so the scorer chose alone. It selected a **flying saucer**
  for `ash_mound`, a **full-length skeleton** for `ash_scrub`, and a **cartoon banana with a face and
  a spear** for `dune_grass`. All three shipped. `ash_mound` was listed *twice* in the ashen prop
  set, making the saucer that biome's most common object.
  - A correct variant already existed for two of them (`ash_scrub_v1`, `dune_grass_v1`) and for
    `dune_bone`, whose shipped v1 is six loose skulls where v2 is one. Picks corrected, rebuilt.
  - `ash_mound` has **no** usable variant — v1 is a walking mech — so it is pulled from
    `DECOR_PICKS` and from the biome's prop list rather than shipped wrong. Its key keeps the
    procedural silhouette; re-render before putting it back.
  - This is the third recorded instance of the same failure (the bone dragon in the coast batch, the
    identity sweep in `CONTENT-PLAN.md`, now this). **The gates measure alpha, footprint, reserved
    pixels and confusion; none of them can see what the picture is of.**
- **⚠ Verifying the fix on the default theme found that the default theme was unreachable.**
  `buildThemeCatalog` filtered out the free themes — correct while the shop was a list of purchases,
  and wrong from the moment its rows grew a Select / In use state and it became the only place a
  theme can be *chosen*. Buying `dusk` removed `day` and `night` from the game permanently:
  `ownsTheme` said the player could select them and no control existed that could. The catalogue now
  carries every theme, a zero price marks a choice rather than a purchase, and `verify:run`'s
  assertion — which required the free themes to be **absent** — is inverted with the reasoning
  written down.
- **Acceptance**: a contact sheet of all 44 distinct props, each under its own biome's tint, on
  mid-grey — the background that hides neither dark paint nor a pale plate. Live at 1920x945 on
  `dusk` (eight distinct tints computed, every drawn `dune_*` prop carrying `#c5833e`) and on `day`,
  where the products equal the raw biome tints because that theme's own tint is white — which is the
  case that was broken and the case a new player sees.

## Levels: Eight Places Instead Of One Lap

`src/game/levels.ts` (pure, `npm run verify:levels`), `src/scenes/LevelSelect.ts`, save **v9**, and a
`BiomeLayout` in `biomes.ts`. The eight biomes, seven themes and forty-four props were all already
shipped — and all on screen at once, six seconds each, on one endless circuit. Nothing was anywhere.

- **A level is one biome, one light, one lap.** `setBiomeLayout({ kind: 'single', index })` pins the
  biome for a whole track; the endless circuit keeps `{ kind: 'cycle' }` and is untouched.
  - **One switch, because there are exactly three consumers and they must never disagree**: the mesh
    picks the ground colour by biome, the sprite pool the decor tint, the decorator which props may
    stand there. All three already went through `biomeIndexForSegment`, so pinning is one value read
    in one place rather than a level id threaded into three render loops.
  - `BIOME_RUN_SEGMENTS` stops being a constraint. It is 179 because `1434 / 8 = 179`, and its own
    note says it **does not scale** — a ninth biome would need 159 and a tenth 143, below which a
    biome is a strip of coloured verge. A ninth biome is now a ninth level.
- **The theme is the level's, unless the player bought one.** Themes were sold as cosmetics before
  levels existed and the price table forbids taking back what was paid for, so a purchase became an
  *override* rather than being absorbed: `selectedTheme` gains `AUTO_THEME_ID`, which means "no
  override", and `themeOverride()` is the question a scene actually has to ask.
  - `upgradeV8ToV9` moves a save onto `auto` **only if** its selection is the old default — the value
    nobody ever chose. Leaving it would have rendered every level in `day` for everyone who never
    opened the shop, i.e. deleted the identity levels exist for, on upgrade. Same reasoning and the
    same knowing limitation as `upgradeV5ToV6`: a free theme leaves no purchase record, so "defaulted
    to day" and "chose day" cannot be told apart.
  - **⚠ Adding `auto` without a row for it would have been a one-way door**, exactly like the free
    themes were before this round. The catalogue's first row is now "Match level" at price 0.
- **⚠ Two laps in and the first three levels were corridors.** Two bends produce a 384-segment lap —
  12.8s at rail speed, against a 300-segment draw distance, so the seam is nearly in view and a
  two-minute run goes round it a dozen times. `buildLevelCircuit` pads to `MIN_LEVEL_SEGMENTS` (900,
  about 30s) **with straight, not with more corners**: a level's character is its bends, and adding
  them to reach a length makes every early level as busy as the late ones — which is the one axis the
  table ramps along. A long straight at noon in a forest is a good first level.
- **Every level's lap is swept by the sightline check, not just the endless circuit.** Eight new
  tracks are eight new chances at the bend that carried a fight off the side of the frame. Measured:
  5.5–6.4s worst against the 5s floor, on laps of 930–1662 segments.
- **Stars are three independent facts, and they are not a gate.** Cleared; no shield lost; the level's
  score target. Unlocking is the chain and only the chain — a gate made of stars turns "go back if
  you want to" into "go back or stop". Stars only ever go up: a record that can be lost makes a
  replay a risk rather than an attempt.
  - **The third star is a score, not accuracy, and that is a real trade.** Accuracy is the better
    goal and the run only tracks it *per wave*, for the summary — a run total would be new state
    threaded through a run before it could be a criterion. Worth revisiting with the difficulty curve.
  - `cleared` is a list of ids, not a count, and `unlockedCount` reads it as a **chain**: a
    hand-edited save holding only the last id unlocks one level, not eight.
- **⚠ `scene.restart()` would have replayed the wrong level.** It passes no data, so `init` fell back
  to "the furthest level open" — and clearing the level just moved that forward. "Again" would have
  started the *next* level, which is the one thing it does not mean. It now restarts with the id it
  was flying.
- **⚠ And a run was a dead end.** `Again` was the only control on the result screen, so finishing a
  level left no route to the next except reloading the page. The result panel now carries `Again` and
  `Levels`, laid out as a pair measured from their own widths.
- **The picker picks; it does not start.** The menu's handover into a run is a world that keeps moving
  through the scene change with no fade, and that transition belongs to the menu — so `LevelSelect`
  closes itself and hands an id back. A level screen calling `scene.start` itself would have to
  reproduce the acceleration, the interface fade, and the ordering between them.
  - Play opens the list. That costs one tap, and it is the honest shape: a game whose Play button
    always starts the same place does not have levels.
- **Verified live**: a fresh save shows one level open and seven locked; clearing forest with no
  damage over its target writes `cleared: ['forest'], stars: { forest: 3 }, bestScore: 12500`,
  survives a reload, and shows "2 of 8 unlocked" with coast open. Forest renders as green pines under
  `day` on a 996-segment lap; coast as palms and kelp under `ice` on 990 — two levels, two places.
  Layout swept at 1920x945, 844x390 and 390x844: nothing escapes, every tap target clears 44px, and at
  844x390 the row window collapses to 157px against 534px of rows, scrollable, the same trade the shop
  makes there.
- **Harness note.** The menu-to-level transition regenerates every themed texture, and under manual
  stepping that is slow enough for a CDP evaluate to time out — which reads exactly like a hang and is
  not one. The give-away is that the reported state lands anyway: check `data-drive` after a timeout
  before believing the page is frozen.

### The difficulty ramp

`LevelDifficulty` in `game/levels.ts`, `KIND_TIERS` in `waves.ts`, and the table `verify:levels`
prints and asserts. Five knobs move per level — rail speed, wave count, wave size, enemy pool,
shields, boss HP — and **no single one of them is the difficulty**.

| | spd | waves | last wave | window | need HP/s | shields | boss |
|---|---|---|---|---|---|---|---|
| forest | 1.00 | 3 | 4 enemies, 4hp | 6.4s | 0.62 | 3 | 24 |
| coast | 1.00 | 4 | 5 enemies, 10hp | 6.4s | 1.17 | 3 | 30 |
| dunes | 1.05 | 4 | 6 enemies, 9hp | 6.1s | 1.47 | 3 | 36 |
| wetland | 1.05 | 5 | 7 enemies, 13hp | 6.1s | 1.78 | 3 | 42 |
| ruins | 1.10 | 5 | 8 enemies, 10hp | 5.8s | 2.13 | 3 | 48 |
| ridge | 1.05 | 5 | 8 enemies, 21hp | 5.3s | 3.04 | 2 | 54 |
| ashen | 1.15 | 6 | 9 enemies, 22hp | 5.6s | 3.22 | 2 | 60 |
| crystal | 1.10 | 6 | 10 enemies, 18hp | 5.0s | 3.98 | 2 | 66 |

- **⚠ Rail speed cannot ramp, and finding out why is the whole shape of this chunk.** A faster rail
  shortens the window a target is engageable for, and that window has a five-second floor — the one
  `road/sightline.ts` exists to hold after a corner shipped that a player could not fight through.
  The obvious ramp (speed rising monotonically to 1.30) put `ridge` at **4.6s** and `crystal` at
  **4.3s**, i.e. made the last two levels exactly the defect the floor was written for. **A level is
  hard by its track or by its speed, and the two share one budget**: `ridge` and `crystal` carry the
  `ROAD_CURVE.HARD` circuits, so they run *slower* than the levels around them. `verify:levels`
  asserts the floor per level at that level's own speed, so the coupling cannot be forgotten.
- **⚠ The ramp is asserted on expected demand, not on a die roll.** The first version measured the
  last wave's actual HP — and a wave's composition is random within its pool, so `ruins` rolled 10 HP
  where `wetland` rolled 13 and the "ramp" went down. Fixing that by choosing seeds would have been
  *the check tuning the game*. What is asserted is `maxEnemies × mean HP of the pool ÷ window`, which
  depends only on the knobs the table sets; the rolled figure is still printed, because it is what a
  player on that seed actually meets.
- **A tier is a set of behaviours, not a number.** `KIND_TIERS` is cumulative: drifters and weavers,
  then the charger's approach and the turret's ground position, then the swarmer's numbers and the
  hexer, and only at the last tier the `bulwark` — five HP, the one a weak weapon cannot chew through
  in a stroke. A first level able to roll a bulwark is a first level that can be a wall.
- **Every difficulty parameter defaults to what the game already was**, so the endless circuit and
  every existing caller are untouched: `buildWaves(count, seed, shape?)`, `createPlayerShields(n?)`,
  `createBoss(z, now, hp?)`.
- **⚠ Two places assumed the boss's HP was the constant**, and a per-level boss broke both:
  `phaseThreshold` computed its thresholds from `BOSS_MAX_HP`, so a 54-HP boss would have started
  already past its second phase's threshold and skipped to the last zone; and the HUD's segmented bar
  divided `BOSS_MAX_HP` by the phase count, so it would have drawn every segment full and then
  emptied five at once. Both now read the boss's own `maxHp`.
- **Wave seeds are their own field.** Reusing `decorSeed` would tie a level's scenery to its wave
  list, so moving a tree would rearrange the fight — a coupling nobody would look for. `verify:levels`
  asserts no wave seed equals any decor seed.
- **⚠ A crash chased to the wrong place, recorded because the conclusion is the useful part.** Driving
  eight levels back to back threw `Cannot read properties of undefined (reading 'glTexture')` inside
  the `Mesh2D` submitter — the exact signature of `applyTheme`'s documented precondition being
  violated. It was not that: moving `applyTheme` after the world and repairing with `refreshTheme`
  changed nothing, and the crash also occurred on the *first* level, whose theme had not changed. The
  real player paths — menu → picker → level, and `Again` — are clean, `getRecentErrors()` empty. What
  produces it is the harness calling `scene.start` on the same scene repeatedly inside stepped frames,
  which is a re-entry the game never performs. **The reordering was reverted**: it cost a pool reset
  per level start and `WorldView`'s constructor reads the theme, so applying it first means the world
  is never built in the wrong palette at all.
- **Verified in the running game**: `forest` builds at speed 6000, 3 shields, 3 waves of 3/4/4, and
  only drifters and weavers on screen; `crystal` at 6600, 2 shields, 6 waves of 7→10, and all eight
  kinds including the bulwark. `Again` restarts the same level with the phase back to `wave` and no
  errors.

## Scroll Patterns

Two small, independent modules for building a scrollable list/strip (a card grid, a settings list, a
catalog longer than one screen, ...) — neither is wired into any shipped scene today (`Shop`'s own
catalog still just stacks rows to fit, see its own section below), but both exist so a game adding
scrolling later doesn't have to rediscover the same WebGL gotcha or reinvent flick physics from
scratch.

- **RULE: never clip a scrollable region with `GameObject.setMask(geometryMask)` under this
  project's renderer.** `Phaser.AUTO` (`config.ts`) resolves to WebGL first, and `setMask()` with a
  `GeometryMask` is Canvas-renderer-only in this Phaser version — confirmed directly against
  `node_modules/phaser/src/gameobjects/components/Mask.js`'s own `setMask()`, which `console.warn`s
  and returns **without ever assigning `.mask`** under WebGL: a silent no-op, not a subtle
  degradation. The object then renders in full wherever its computed position places it, with zero
  clipping — content scrolled past its intended boundary escapes and renders on top of whatever sits
  above/below the scroll region instead of being cropped. This is a standing fact about the renderer,
  not a one-off bug — it was independently hit and fixed the same way in three separate
  scrollable/maskable UI regions across a real project built on this template (a scrolling catalog, a
  scrolling card grid, and an unrelated masked-shape spike) before being generalized into the helper
  below. `ui/preview.ts`'s own `'cover'`-fit note ("this Phaser build errors on masking an `Image`
  directly under WebGL") is the same underlying limitation showing up in a different widget.
- **`src/ui/scrollRegion.ts`'s `scrollableCameraRegion(scene, bounds)`** is the fix: a dedicated
  `Camera` whose *viewport* IS the clip rectangle. A camera's viewport is a hard, native clip boundary
  — nothing outside it can ever render there, no filter/mask machinery involved — and its own
  `scrollY`/`scrollX` does the panning, so scrolled content is positioned ONCE at its true unscrolled
  coordinates and never re-touched per scroll tick. Same "world/UI two-camera split + mutual
  `.ignore()` lists" shape `Game.ts` already uses for its own field/tray-vs-HUD split (see "Responsive
  Layout"): call `region.camera.ignore(everythingElse)` and `scene.cameras.main.ignore(scrollableObjects)`
  yourself — only the caller knows which of its own objects belong to which half, so the helper doesn't
  guess. Resize the clip rectangle from `layout()` via `setBounds()`. **A scene with its own in-scene
  popup that must render on top of the scrollable region needs a THIRD camera** (added after this one,
  full viewport, holding only the popup's objects) — a later-added camera always composites on top of
  an earlier one's output, so with only two cameras a scrolled-to region would draw over a centered
  popup wherever they overlap.
- **`src/ui/scrollMomentum.ts`** — pure, framework-agnostic (no Phaser import) flick-momentum physics:
  `pushDragSample()`/`computeReleaseVelocity()` (last 3 drag samples, not a single last-delta, which
  overreacts to one noisy final sample) and `stepMomentum()` (frame-rate-independent exponential decay
  + a soft ~100ms edge stop, no bounce/spring). A scene owns one `ScrollMomentumState` per scroll axis,
  feeds `pushDragSample()` from its `pointermove` handler using the pointer event's own real timestamp
  (not a scene/frame clock — see the module's own regression test for why: multiple raw events landing
  within one `update()` tick would otherwise share a single timestamp and corrupt the velocity
  computation in a way that depends on how the render rate lines up with the input rate), assigns
  `computeReleaseVelocity()`'s result to `state.velocity` on release, and calls `stepMomentum()` once
  per `update(time, delta)` tick while `state.velocity !== 0`. Verified via `npm run verify:scroll`
  (`scripts/verify-scroll-momentum.mjs`) — in particular that a 120Hz and a 60Hz tick rate decay the
  same fling to the same final position, not just the same velocity (a plain Euler position step gets
  the decay right but still over-travels at a coarser tick rate; the fix is the exact integral of the
  decaying velocity over each step, not `position + velocity * delta`).

## Localization

`src/i18n/strings.ts` is a plain lookup-table `t(key, params?)` layer, not a library — `{name}`
substitution only, no plurals/ICU/locale-aware number formatting. It ships as a **framework**, not a
finished dictionary: the `en`/`es` objects hold only generic, cross-scene keys (`settings`, `sound`,
`music`, `close`, `back`, `on`, `off` — what `Settings.ts` itself needs). A game adds its own domain
strings by extending these same two objects, in the same commit for both locales — never a second,
parallel `t()` mechanism.

- **Compile-time dictionary parity**: `StringKey = keyof typeof en`, and `es` is typed `Record<StringKey,
  string>` — TypeScript's excess/missing-property checks on that assignment force `es` to have exactly
  `en`'s key set. A key added to one dictionary but not the other is a **build error**, not a blank/wrong
  string discovered later in one language. Keep this property when extending both objects.
- `initLocale()` (awaited in `main.ts`, before `new Phaser.Game(...)`) resolves `getLanguage()`
  (`platform/yt.ts`) through `resolveLocale()`'s generic BCP-47 prefix match (`'es-MX'` -> `'es'`), falling
  back to `DEFAULT_LOCALE` (`'en'`) for anything unsupported. Must resolve before the first scene's
  `create()` — see `main.ts`'s own comment on why (an instant/asset-less `Preloader` can run
  Boot→Preloader→MainMenu synchronously in one tick).
- `getLocale()` reads the currently resolved locale; `t(key, params?)` never actually misses for a real
  `StringKey` (compile-time guarantee) — its `?? key` fallback is purely defensive for a typo'd dynamic
  key. `tOptional(key: string)` is for a dynamically-keyed lookup (a generated/content-driven display-name
  key) — returns `undefined` on a miss instead of the key string itself, so the caller can fall back to
  its own default.
- Adding a locale later is a new dictionary object (typed `Record<StringKey, string>`, so TS immediately
  flags any missing key) plus one entry in `strings.ts`'s `SUPPORTED_LOCALES` — `resolveLocale()`'s
  prefix-matching logic itself is already generic, not hardcoded to `en`/`es`.

## Input Actions

`src/platform/input.ts`'s `bindAction(scene, action, sources, callback)` is the only way scenes wire up
player input. **Rule: gameplay/UI code subscribes to actions, never to raw input events.** No scene calls
`.on('pointerdown', ...)` or `scene.input.keyboard.on('keydown-X', ...)` directly — every interactive
element goes through `bindAction`, which maps one named action (`'primary'`, `'openSettings'`,
`'toggleSound'`, `'toggleMusic'`, `'close'`) to as many input sources as make sense (a pointer target, a
list of keyboard keys, both at once) and fires a single callback regardless of which source triggered it.
Concretely: `MainMenu`'s start text is `'primary'` (pointer + `SPACE`/`ENTER`), its gear button is
`'openSettings'` (pointer + `ESC`); `Game`'s gear button is the same `'openSettings'`; `Settings`' two
toggles are `'toggleSound'`/`'toggleMusic'` (pointer + `S`/`M`) and its Close button is `'close'` (pointer +
`ESC`/`ENTER`). There is no "what kind of device is this" branch anywhere — mouse, touch (Phaser unifies
both into one Pointer API already), and keyboard all work at the same time, unconditionally.

- `sources.pointer` is a game object (or array) that must already be `.setInteractive()`'d — `bindAction`
  only attaches the `pointerdown` listener, it doesn't size the hit area. That's still
  `src/ui/uiScale.ts`'s `ensureMinHitArea()` job (see "Responsive Layout"), called every `layout()`.
  `bindAction` itself is called once, in `create()`, since attaching a listener isn't positioning — it
  doesn't need to re-run on resize the way `layout()` does.
- Every source `bindAction` wires up only fires while `scene.scene.isActive()` (i.e. the scene is
  running, not paused). Pointer sources don't strictly need this — whatever overlay paused the scene
  (e.g. `Settings`' backdrop) already physically blocks the click from reaching anything underneath — but
  keyboard sources do: Phaser does **not** suspend a paused scene's `input.keyboard` listeners, only its
  `update()`/render. Without the guard, pressing `ESC` to close `Settings` would also fire the paused
  opener's own `ESC`-bound `'openSettings'` handler underneath it (both scenes have live listeners on the
  same key at that moment). The guard is applied uniformly to both source kinds for one consistent rule
  rather than "pointer is safe, keyboard needs a special case."
- `MainMenu`'s `'primary'` action is guarded locally (a closure `started` flag inside `MainMenu.create()`)
  to fire at most once — starting the same scene twice mid-transition is unsafe. This is deliberately not
  a feature of `bindAction` itself (no built-in once/many mode); one-shot-vs-repeatable is caller policy,
  not something the generic action-binding layer should encode.

## Save Layer

`src/save/` sits on top of `src/platform/yt.ts`'s `loadData`/`saveData` primitives:

- `types.ts` — the single `SaveState` shape (current version, **v9** — the header below describes
  the v2 era and is kept because the *mechanism* it explains is unchanged; `settings` now also
  carries `soundVolume`/`musicVolume`, see "The Interface Kit": `{ v, bestScore, coins,
  purchases, settings: { sound, music } }` — `coins`/`purchases` back the Shop layer, see "Shop
  Layer"), current `SAVE_SCHEMA_VERSION`, and `DEFAULT_SAVE_STATE`.
- `migrate.ts` — `migrate(raw: unknown): SaveState | null`, a `switch (raw.v)` ladder (`case 1` falls
  through to `case 2`'s `normalizeV2` — the v1 -> v2 bump added `coins`/`purchases`, both of which
  `normalizeV2`'s own `typeof`/`Array.isArray` checks already default when absent, so no separate
  `upgradeV1ToV2()` step was needed; the docstring shows the fallthrough shape for a future bump that
  *does* need one). Returns `null` for anything it doesn't recognize, including individually-corrupt
  fields (e.g. `bestScore` not a number falls back to the default rather than propagating garbage).
- `save.ts` — `load()`/`save(state)`, the only functions that touch `yt.ts`. `load()` never throws: empty
  string (no save yet / signed-out user), corrupt JSON, and unrecognized schema all resolve to
  `DEFAULT_SAVE_STATE` with a `console.warn`. `save()` checks `isWellFormed()` (feature-detected —
  `typeof json.isWellFormed === 'function'` — since this ES2024 runtime method isn't esbuild-polyfillable,
  and a build could get reused on a browser old enough to lack it) and a 3 MiB size guard (warns at 80%)
  before calling `saveData()` — both skip the write rather than throwing. Health signals here are split by
  fault: `loadData()`/`saveData()` rejecting calls `logError()` (an unexpected failure of the platform API
  itself), while the `isWellFormed()`/size-limit guards call `logWarning()` (a problem with data our own
  code produced, not the platform) — the empty-string (signed-out), corrupt-JSON, and unrecognized-schema
  branches call neither, since none of those are errors. Deliberately not deduped like `health.ts`'s
  window-error capture — the SDK's health API already rate-limits itself, and *how often* saves are
  failing is itself a useful signal here, not noise to collapse.
- `store.ts` — the single in-memory `SaveState` instance. Scenes call `store.mutate(s => { ... })` to
  change it (never construct their own `SaveState`); this schedules a save debounced to once per 2s.
  `store.flush()` saves immediately, bypassing the debounce. `bindAutosave(game)` calls it on both the
  platform's `YTEvents.PAUSE` (Playables) and the window's `pagehide` (everywhere else, including dev —
  `YTEvents.PAUSE` only ever fires inside YouTube, so without `pagehide` a tab closed mid-debounce-window
  would silently lose up to 2s of mutations; `pagehide` over `beforeunload` because the latter is
  unreliable on mobile). `store.init()` must run once, before the game/scenes start (done in `main.ts`),
  to populate the store from the persisted save.

`tsconfig.json`'s `target`/`lib` are `ES2024` specifically for `String.prototype.isWellFormed()`.

## Shop Layer

`src/shop/` is a mechanism, not a product — it ships a coin balance, a purchase-tracking
mechanism, and a demo scene; **no game ships with this template already has a catalog**. A game
wires up a real shop in three steps:

1. **Define a catalog** — an array of `ShopItem` (`shop/catalog.ts`: `{ id, priceCoins, titleKey,
   icon, kind: 'consumable' | 'unlock' }`) and register it with `setCatalog(items)` (same
   "register a config object once at boot" shape as `ui/theme.ts`'s `setTheme()`) — call it
   unconditionally, e.g. from `main.ts`, not behind a DEV gate. `id` is permanent once shipped: for
   an `'unlock'` item it's also the exact string stored in `SaveState.purchases`, so renaming it
   orphans anyone who already bought it (they'd fail `hasPurchased()` against the new id and could
   re-buy). `titleKey` is an i18n key (`i18n/strings.ts`'s `tOptional()`) — it does not need a
   dictionary entry; `Shop.ts` falls back to `titleCase(id)` (`ui/format.ts`) for any item with no
   translated title, so a catalog can ship before its strings are translated (never blank/wrong).
2. **Handle purchases**: `kind: 'consumable'` — pass an `onPurchase(item) => void` callback via
   `scene.launch('Shop', { opener: ..., onPurchase })`; `Shop.ts` debits the coins and calls it,
   the *game* decides what a consumable actually does (grant a hint, extend a timer, ...) — the
   shop layer has no opinion. `kind: 'unlock'` needs no callback at all: `Shop.ts` pushes `item.id`
   into `SaveState.purchases` itself and flips that row to an "Owned" state; check
   `shop/coins.ts`'s `hasPurchased(getState().purchases, itemId)` wherever the game needs to know
   whether a permanent unlock is active.
3. **Add a real entry point** — a permanent Shop button (any scene, via `neonButton`/`rowButton`),
   with no `import.meta.env.DEV` gate. `MainMenu`'s own Shop button in this template IS gated
   (`if (import.meta.env.DEV) { ... }`, mirroring the demo catalog seeded right above it in
   `MainMenu.ts`) specifically because the bare template has no real products to sell — so its
   *own* production build shouldn't show a shop at all. Both blocks are dead-code-eliminated out of
   `vite build`/`vite preview`/`npm run bundle` output the same way `import.meta.env.DEV`-gated code
   is eliminated elsewhere in this codebase (see `main.ts`'s dev/debug `window.__game` hooks for the
   same pattern) — a game deleting the `if` around its own copy of this button is enough, no build
   config to touch.

Mechanism pieces:

- `shop/coins.ts` — pure, store-agnostic functions over a plain `coins: number` (never the whole
  `SaveState` or the store singleton): `canAfford(coins, price)` (read-only query), `earnCoins(coins,
  amount)` (floored, never negative), `spendCoins(coins, price)` (returns the new balance, or `null`
  if `coins < price` — **never partially deducts**; there is no state between "declined, balance
  unchanged" and "spent, balance reduced by exactly `price`"), `hasPurchased(purchases, itemId)`.
- **Atomicity**: the actual "spend" a purchase performs is the whole read-check-write sequence
  inside ONE `store.mutate()` call (`Scenes/Shop.ts`'s `purchase()`) — `spendCoins()`'s own
  null-on-insufficient-funds return is what makes that safe to call unconditionally inside the
  mutator without a separate pre-check that could (in a future, more concurrent version of this
  layer) race against another mutation between the check and the deduction. JS itself is
  single-threaded so nothing can interleave *today*, but the one-function-one-mutate shape means
  that stays true even if this logic is ever called from more places.
- `scenes/Shop.ts` — a `scene.launch({ opener, onPurchase? })` overlay, same pause/resume pattern as
  `Settings` (see "Audio Layer" below) — and, like `Settings`, listed in `platform/lifecycle.ts`'s
  `OVERLAY_SCENES` so a real platform pause doesn't freeze its own Close button (see "YouTube Playables
  Wrapper"). Any new overlay scene a game adds needs the same registration. UI is entirely `ui/theme.ts` widgets: a `valueBadge('🪙',
  coins)` balance readout, one `rowButton` per catalog item (`SHOP_ROW_COLUMNS`, same
  fraction-of-row-width convention "UI Kit" describes for any row list), a `neonButton` "top up"
  action, and a `neonButton` Close. Rows dim (`setColor`) and their accent label flips
  (`setAccentText`, added to `RowButton` specifically to support this) between `t('buy')` and
  `t('owned')`/an unaffordable-but-still-visible state — see `refreshAllRows()`, called after both a
  purchase (this item's own state changed) and a top-up (every row's affordability may have
  changed). **Scrolls** — see "The Shop Scrolls" below; it did not until the catalogue outgrew one
  screen, and the helper it is built on (`scrollableCameraRegion()`, see "Scroll Patterns") had sat
  unwired since the template.
- **Rewarded top-up**: the "🎬 +50 coins" button calls `platform/adGate.ts`'s `showRewarded(game,
  'coins-topup')` directly (same "game code calls only `adGate.ts`" rule as everywhere else — see
  "Ad Gate" — `Shop.ts` needs no extra pause/resume handling of its own, `adGate` already owns
  that). `'coins-topup'` is this template's one reserved rewardId string; a game adding its own
  rewarded flows should keep each rewardId a stable, explicit string constant the same way, not a
  computed/dynamic one — the SDK treats each rewardId as an independent ad placement.

## The Attack Animation

`src/rail/fx.ts` (pure, `npm run verify:effects`) and `FxSprites.ts`. Two effects: a flash at the
ship's nose when a shot leaves, and a burst where one lands. The weapons already differed by
projectile head, colour, shots per lock, damage and cooldown; **this is the half that was loaded
and never drawn** — `FX_TEXTURE_KEYS` has been feeding `Preloader` since the weapons landed, and
nothing put a single one of those eleven textures on screen.

- **The two are modelled differently, and that difference is the whole design.** An impact is
  **frozen where it happened**: the shot has arrived and whatever it struck has stopped mattering,
  so a burst that chased its target afterwards would be marking a place nothing occurred. The
  muzzle flash is **attached to the ship and re-read every frame**, because a volley's shots leave
  staggered across up to `MAX_LOCKS * VOLLEY_STAGGER_MS` (440ms) and the player is flying the whole
  time — freezing it, which is exactly what `PlayerShot.fromX/fromY` correctly do for the
  projectile, would leave a flash hanging in empty air behind a ship that has moved on.
- **The flash is triggered by the launch, not by the release of the stroke**, and retriggering
  **resets** rather than extending or queueing. Flashing once on release puts one pop at the front
  of a salvo that goes on firing long after it; queueing lights the nose for the whole salvo (a
  lamp, not a gun); extending makes the flash's brightness a function of how many targets the
  player happened to mark. Restarting gives the salvo its rhythm — measured live at 3 pops exactly
  `VOLLEY_STAGGER_MS` apart for a 3-lock stroke.
  - `launchesBetween` counts **one per lock, not one per projectile**, because `createVolley`
    staggers by lock: three shots from one lock would otherwise be three identical pops in the same
    millisecond, which is one pop drawn three times. It counts transitions rather than collecting
    into a `Set` — this runs every frame for the whole session. `verify:effects` steps a full
    8-lock volley at 60Hz, 30Hz and 120Hz and asserts exactly 8 launches are seen: a missed one is
    a shot that leaves with no flash, a double-counted one is a flash that never restarts, and
    **both look like "the animation is a bit off" rather than like a bug**.
- **The two scale curves run in opposite directions.** An impact grows and eases *out* — energy
  leaving a point, smallest when it happens, most of the expansion spent early so it reads as a
  burst rather than a balloon. The flash *shrinks*: it is widest the instant the shot leaves and
  collapses back into the barrel, and growing it would make the ship look struck rather than
  firing. Same argument the telegraph ring's own easing is chosen by.
- **`FxSprites` is not part of `Effects`, deliberately.** Everything in that class is an untextured
  graphics layer or a camera transform, owing nothing to the armed weapon. These two are *weapon
  art*, chosen and tinted per weapon exactly as the projectile head is, so they belong beside
  `VolleySprites` where that decision already lives. Additive blend, which is a blend mode and not
  a shader pass — `'lighter'` under the Canvas fallback, so the usual `Phaser.AUTO` argument holds.
- **A missing texture draws nothing, and that is the whole fallback.** `VolleySprites` substitutes
  a generic dot for a missing projectile head because a volley the player cannot see is a broken
  game; a flash is decoration, so the honest outcome of art that never generated is the game
  without it — the same path as switching the effect off in `EFFECTS`.
- **A shot the boss ignores draws no burst.** `damageBoss` returning `'ignored'` means the zone shut
  between the mark and the arrival; drawing the same thing a landed shot draws would make the
  crossed-out zone stop being a warning the player can act on. Every other arrival gets one,
  killing or not — a hit the player cannot see reads as the game having dropped their shot.
- **`Ship.muzzle` replaced a hardcoded `state.y - 20`.** That was a fixed pixel count into a hull
  247px tall at 1920 and 100px tall on a phone — i.e. fire leaving from inside the ship at one size
  and from ahead of it at another. It now derives from the drawn height and reads through `bank` and
  `bob`, so the flash stays on the nose when the player is moving hardest. Both the volley's origin
  and the flash use it, so they cannot disagree.
- **Verified in the framebuffer, not by looking at it.** Object properties prove a sprite is
  `visible`; they say nothing about whether it reached the frame. Two deterministic replays of the
  identical run — same seeds, same fixed steps, same stroke coordinates — sampled the same
  rectangle at the same frame, once with `FxSprites.render` live and once stubbed:

  | box | with | without |
  |---|---|---|
  | muzzle, 180x180 at the nose, frame the volley leaves | 5149 weapon-tinted px | 3076 |
  | impact, 140x140 at the burst, frame the shots arrive | 1925 weapon-tinted px | **3** |

  (The muzzle box has a floor because the ship's own hull is cyan; the impact box has none.) The
  DEV single-camera assertion passed with the pool added, so nothing is drawn twice.
- **Cost, 1920x945.** A real 3-lock stroke: whole frame **1.2ms median / 2.7ms p95** with, 1.1 /
  2.5 without. Held at saturation — the 24-slot pool refilled every frame and the flash relit every
  frame, which is more than any real stroke can produce — **1.4ms / 4.5ms** against 1.2 / 2.8. So
  the ceiling for the whole attack animation is about 0.2ms median and 1.7ms p95 of a 16ms budget,
  and the realistic case is inside measurement noise.
  - Both configurations showed a ~430ms outlier. That is the manual-stepping harness being
    descheduled, not the game: it appears identically with the effects stubbed out.
- **Driving this under automation needed one trick beyond the documented ones.** Synthetic DOM
  `PointerEvent`s never reach Phaser's input manager in a hidden tab — `activePointer` stays at
  `0,0` — so the drag is fed to `scene.input.emit('pointerdown'|'pointermove'|'pointerup', {x, y,
  isDown})` instead. That drives the real `LockOnView` handlers; the only thing stubbed is the
  DOM-to-Phaser plumbing, which chunk 7 already verified. Also: step from `game.loop.time`, never
  from a counter carried across a `scene.restart()` — a driver whose clock had fallen behind the
  loop's fed a `now` earlier than the bursts' own `bornAt`, and they read as frozen at 45% scale
  and never expired. That was the harness, not the pool.

## The Shop Scrolls

`src/ui/scrollList.ts` (pure, `npm run verify:scroll`) joined `scrollRegion.ts` and
`scrollMomentum.ts`, and `Shop.ts` is the first scene to use any of the three. The catalogue is
growing past what one screen holds (see `CONTENT-PLAN.md`), and a row the player cannot reach is a
row they cannot buy.

- **The panel is capped, not fitted.** It used to be exactly as tall as its contents, which is
  correct at eight rows and unshippable at seventeen: 17 rows is 1044px of list before any chrome,
  so the panel would run off both edges of a phone and take the Close button with it. It is now
  `min(content, MAX_PANEL_HEIGHT_FRACTION * viewport)` — **so a short catalogue lays out exactly as
  it did before**, and only a long one scrolls.
- **The clip is a camera viewport and never a mask**, which is the standing rule
  `ui/scrollRegion.ts` exists to enforce: `setMask(geometryMask)` warns and returns *without
  assigning `.mask`* under this renderer, so a masked list does not clip at all and the rows render
  over the header and the Close button. **Verified rather than assumed** — scrolling from one end
  to the other changed 8,906 pixels inside the window and **exactly 0 in the strips immediately
  above and below it**. That 0 is the whole measurement: with a mask it would have been large.
- **Rows buy on the tap, not on the press** — `bindAction`'s new `tap: true`. The rows are the only
  thing there is to grab, so *every* scroll gesture begins on one; firing on `pointerdown` means the
  first flick through the catalogue spends the player's coins on whatever was under the finger, and
  that is a real purchase they did not make and cannot undo. Off by default because it is worse
  everywhere else: a button that waits for the release feels slower, and Phaser's
  `GAMEOBJECT_POINTER_UP` only fires when the release lands back on the object, so a tap that drifts
  off the edge is silently lost.
  - **The press position is recorded per binding, not read off the pointer at release.**
    `pointer.downX/downY` belong to the *pointer*, so a press that began on some other row would
    still satisfy a distance test taken on this one, and the row the finger happened to stop over
    would fire.
  - **The threshold is radial and measured from the press**, not per-axis and not between frames: a
    slow drag never moves far in any one frame and would pass a per-frame test the whole way down
    the list. `verify:scroll` walks a 40-frame 3px-per-frame drag and asserts it stops counting as a
    tap after the first few pixels.
  - `TAP_SLOP_PX` lives in `ui/scrollList.ts`, not beside `bindAction`, for a mechanical reason:
    `platform/input.ts` imports `phaser` as a value, and a verify script cannot reach anything in
    that file — the same pure/Phaser split every other module here follows.
- **The drag is not an action, and does not go through `bindAction`.** There is no discrete thing
  the player asked for until they let go, and what a drag produces is a continuous offset rather
  than a callback; the discrete half of the same gesture — the tap that buys — does go through it.
- **Rows are positioned once, in the region camera's own coordinates, and never touched by a scroll
  tick.** The camera pans over them. Their `y` therefore starts at half a row rather than at
  `windowTop`, which is the one thing about this layout that looks wrong until you remember whose
  origin it is in.
- **`layout()` re-clamps the offset rather than resetting it.** A rotation that lengthens the window
  shortens the travel, and an unclamped offset leaves blank space under the last row; a reset would
  instead throw away the player's place in the catalogue on every orientation change.
- **Hit-testing works through the region camera** — checked with `hitTestPointer` at a row inside
  the window: one hit, and it is the row. Worth checking rather than assuming, since these objects
  are excluded from `cameras.main` entirely.
- `windowHeight` is floored at `MIN_WINDOW_HEIGHT` because **a zero-height camera viewport throws in
  Phaser**, and a landscape phone reaches it: at 844x390 the chrome alone is most of the panel.
  Measured there, the window is 105px against 486px of rows — tight, but every row is reachable.

## Sound

`src/audio/synth.ts` + `sfx.ts` (pure, `npm run verify:audio`) sit on top of the audio layer
below. Everything the game plays is **generated at boot**, not shipped.

- **Sounds are rendered to WAV `data:` URIs in `Preloader.preload()`.** Two reasons, both
  concrete: every audio file needs a provenance row in `AUDIO-SOURCES.md` establishing it is CC0
  or self-generated (an unresolved copyright claim on a sound is a common Playables rejection),
  and a tone rendered from arithmetic *is* self-generated — there is no row to keep, nothing to
  license, and nothing in `dist/`. The whole set is 126KB of base64 that never touches the
  network, and it is deterministic, noise included, so "did the audio change?" is answerable by
  comparison.
  - **A `data:` URI, not a decoded `AudioBuffer` pushed into the cache.** The URI goes through
    Phaser's ordinary loader and therefore works on the HTML5 Audio backend too; decoding
    straight to a buffer is shorter and silently produces nothing at all if `Phaser.AUTO`'s
    sound manager is not WebAudio.
- **The lock tone is the readout, and that shapes everything about it.** Each mark of a stroke
  plays the same sample three semitones higher than the last (392Hz up to 1319Hz across eight),
  so the player can count their marks by ear without looking away from the targets — the counter
  by the ship is the fallback, not the display. It is deliberately **not** throttled or
  randomly detuned like the impacts are: skipping one would make the player hear the wrong
  number.
  - One sample plus a `detune` in cents, not eight pre-rendered tones: one decode and one cache
    entry for a sound the player hears as a single rising run.
- **Frequent sounds are thinned and rotated** (`nextRepeat`): a minimum 45ms gap, and
  consecutive plays rotate through ±60 cents. Eight volley shots landing inside 400ms is more
  triggers than the ear resolves as separate events, and identical samples stacked on the same
  frame are a buzz rather than eight impacts. A refused call does **not** advance the rotation,
  or a burst of refusals would leave two consecutive plays identical.
- **The sounds are different shapes, not one blip at different pitches.** The telegraph is the
  only rising two-tone and sits in a band well above the impacts, because it is the one the
  player must recognise with its source off screen; damage is the only noise burst; a death
  falls where a hit rises.
- **`FADE_TEARDOWN_GAP_MS` is a real fix for a silent failure, not padding.** Chromium drops a
  scheduled `AudioParam` change if the node is torn down in the same tick — no exception, no
  console warning, the sound simply cuts where it should have faded. The observable edge is
  ~10ms; `teardownDelayMs` puts the destroy 40ms past the end of the ramp, and `verify:audio`
  holds the constant above 10 so nobody can "tidy" it back to zero without a test going red.
  `fadeOutAndDestroy` also uses `window.setTimeout` rather than `scene.time.delayedCall`,
  because a scene shutting down takes its clock with it and this has to outlive exactly that.
- **What could not be verified under automation, and why.** The automation tab is hidden, so
  Chrome keeps the `AudioContext` `suspended`, Phaser's manager stays `locked`, and
  `context.resume()` never settles at all (the promise neither resolves nor rejects — an earlier
  probe simply never reported). While locked, `soundManager.mute = true` **does not stick**,
  which makes a live platform-pause check meaningless rather than failing. So: the toggles,
  the detune plumbing and the scene-transition leak check are confirmed live; anything that
  needs audible playback — the blind count of marks, the platform-pause mute, whether each of
  20 rapid fades was actually heard — needs a human with speakers and is not claimed here.
  - Confirmed live regardless: all 8 generated sounds decode into Phaser's cache; SFX play only
    with the sound flag on and are unaffected by the music flag; `detune` reaches the manager;
    and 20 rapid `playMusic` -> faded `stopMusic` -> scene restart cycles leave the
    `PAUSE`/`RESUME`/`AUDIO_ENABLED_CHANGE` listener counts flat at 4/3/1.

## Audio Layer

`src/audio/audio.ts` is the only module allowed to touch `game.sound` — scenes call
`playSfx(key, { detune })`/`playMusic(key)`/`stopMusic(fadeMs)`/`setSound(on)`/`setMusic(on)`/`isSoundOn()`/`isMusicOn()`
instead — plus `setSoundVolume`/`setMusicVolume`/`getSoundVolume`/`getMusicVolume`, which the
sliders in `Settings` drive (see "The Interface Kit": audibility is now the platform mute **and**
the flag **and** a non-zero slider). Two independent flags (`SaveState.settings.sound`/`.music`, via `src/save/store.ts`) each combine
with a platform mute (`isAudioEnabled()` at init, kept live via `YTEvents.AUDIO_ENABLED_CHANGE`):
`audible = platformAudioEnabled && userFlag`. The platform side of that is a transient runtime-only
override — the `AUDIO_ENABLED_CHANGE` handler recomputes audibility but never calls `store.mutate()`; only
`setSound()`/`setMusic()` (user-triggered) touch the save.

- SFX are gated at call time: `playSfx()` just doesn't call `soundManager.play()` when inaudible, since
  one-shots have no ongoing state to update later.
- Music is a single retained instance (`currentMusic`), muted/unmuted in place via `.setMute()` whenever
  the platform or user flag changes, so an already-playing track reacts immediately. `playMusic()` and
  `stopMusic()` call `.destroy()`, not `.stop()` — `.stop()` alone leaves a dead-but-not-removed instance
  in the manager's sound list, which leaked one per call on repeated PAUSE/RESUME cycles before this was
  caught in testing.
- `YTEvents.PAUSE` → `soundManager.mute = true` (blanket safety net) + capture `currentMusic.seek` into
  `pausedMusicSeek` + `stopMusic()`. `YTEvents.RESUME` → unmute the manager, then
  `playMusic(currentMusicKey, pausedMusicSeek)` if `effectiveMusic()` — continues the same track from
  where it left off (a fresh instance, since `stopMusic()` destroyed the old one, but seeked back in).
  `playMusic()`'s second argument is `seekSeconds` and defaults to `0`; only the PAUSE/RESUME path passes
  a non-zero value — a plain `playMusic(key)` call still always starts from the top.
- **Phaser 4 typing gap:** `Phaser.Sound.BaseSound`'s `.d.ts` omits `mute`/`setMute()`/`volume`/`loop` even
  though every concrete backend (WebAudio, HTML5, NoAudio) implements them identically (confirmed in
  `node_modules/phaser/src/sound/*`, and documented in the `audio-and-sound` skill) — `audio.ts` works
  around this with a local `MutableSound` interface extension + cast, not a cast to a specific backend class.

`src/scenes/Settings.ts` is a `scene.launch()` overlay (semi-transparent backdrop, Sound/Music toggles,
Close — built from `ui/theme.ts`'s `roundedPanel`/`neonButton`, see "UI Kit") launched with `{ opener:
<scene key> }` by the gear buttons in `MainMenu`/`Game`; opening it pauses
the opener (`scene.pause()`) and closing it resumes exactly that scene by key — this is uniform for both
scenes (not just `Game`) because an unpaused `MainMenu` would still receive the gear-button's own click via
its input plugin and could misfire other handlers underneath the overlay. A `scene.launch()`-ed overlay is
a fully independent scene with its own Input Plugin, so it receives input normally regardless of whether
the scene beneath it is paused (confirmed in testing, not just assumed).

**Two pause sources can overlap** — a user opening Settings (`scene.pause()`) and a platform-level
`YTEvents.PAUSE` (e.g. the YouTube tab backgrounding) firing while it's open. `Settings.close()` checks
`isPlatformPaused()` (see "YouTube Playables Wrapper") before resuming: if a platform pause is still
active, it defers the `scene.resume(opener)` call to a one-time `YTEvents.RESUME` listener instead of
firing it immediately — otherwise closing Settings would resume gameplay/audio the platform still
considers suspended (or, if it silently skipped resuming with no deferred handoff, the scene would stay
paused forever once the platform later resumes, since nothing else ever calls `scene.resume()` on it).

**Vite dev-server gotcha for testing:** a raw `await import('/src/audio/audio.ts')` from outside the app's
own module graph (e.g. a Playwright script) resolves to a *different* module instance than the one
`main.ts` statically imports and calls `init(game)` on — so `audio.playMusic()` etc. silently no-op
(`soundManager` is `null` in that instance) unless the test also calls `audio.init(window.__game)` itself.
`src/save/store.ts` tests don't hit this because they always call `store.init()` explicitly anyway. Also:
WebAudio's `mute`/`volume` are backed by real `AudioParam` automation (`gain.setValueAtTime(...)`) — reading
the value back synchronously in the same tick after setting it can return the stale value in headless
Chromium (no real audio render thread ticking); wait ~100–300ms before asserting on it in tests.

## Build Guards & Asset Policy

Final platform-layer chunk before running the official Playables Test Suite — a rejected
submission is expensive to iterate on, so these are mechanical guards, not just conventions.

- **`scripts/check-bundle.mjs`** runs automatically as the last step of `npm run build`
  (`tsc && vite build && node scripts/check-bundle.mjs`). It inspects `dist/` only —
  no network, no SDK — and always prints a top-10-largest-files table first, so if it does
  fail the culprit is immediately visible instead of requiring a manual `dist/` dig.
  Thresholds: warn (exit 0) past 10 MB total; fail (exit 1) past 25 MB total *or* on any
  single file over 25 MB. The 25 MB per-file number is a deliberate 5 MB margin under the
  platform's actual 30 MB-per-file limit (see PLAYABLES-SDK.md), not the platform limit
  itself — the guard is meant to trip before an actual submission would be rejected, not
  exactly at the boundary.
- The same script also fails on source-authoring file extensions anywhere in `dist/`
  (`.psd`, `.ai`, `.sketch`, `.fig`, `.xcf`, `.blend`, `.aep`). **Deliberately excludes**
  `.wav`/other audio-delivery formats — this project already ships
  `public/assets/audio/blip.wav` as a real runtime asset via `vite`'s `public/` copy, and a
  generic extension check can't distinguish a "WAV master" from a normal delivered sound
  file by extension alone. That distinction is a provenance question, not a mechanical
  one — enforced by the AUDIO-SOURCES.md rule below instead.
- **`vite.config.ts`'s `inlineModuleLoader` plugin** rewrites the entry point during
  `vite build` (`apply: 'build'` — dev serving is completely untouched) from Vite's default
  static `<script type="module" crossorigin src="...">` into a classic inline
  `<script>import("...")</script>`, and strips any `<link rel="modulepreload">` tags.
  **Why**: the Playables Test Suite's "SDK loaded before any game code" MUST check watches
  actual *network load order*, not DOM/script-tag order or JS execution order. A static
  `<script type="module" src="...">` is visible to the browser's *preload scanner*, which
  speculatively fetches it in parallel with — not after — the classic blocking SDK
  `<script>` tag preceding it in the document; a small local bundle can finish downloading
  before the SDK's network-round-trip-bound fetch does, failing the check even with
  perfectly correct tag order. A dynamic `import()` call is invisible to the preload
  scanner (it only scans HTML attributes, not JS source), so the entry chunk's fetch can't
  start until this classic script actually executes — which, positioned after the SDK's own
  classic script, can't happen before the SDK has already finished loading and running.
  Verified directly (not just reasoned about) against a real `vite preview` server with
  Playwright request-timing events: with the fix, the entry chunk's request doesn't even
  *start* until the SDK's request has fully finished; reverting to the old static tag as a
  negative control reproduced the exact bug — entry chunk request starts and finishes while
  the SDK request is still in flight.
- **`scripts/make-bundle.mjs`** (`npm run bundle` = `npm run build` then this) zips `dist/`
  into `build/<app-id>-<version>.zip` (`<app-id>` is `package.json`'s `name`, slugified;
  version is `package.json`'s `version`). Before zipping it re-verifies, on the actual
  built `dist/index.html` (not just the source `index.html`):
  - the file exists at the dist root,
  - **no static `<script type="module" src="...">`** and **no `<link rel="modulepreload">`**
    — both would reintroduce the preload-scanner race the `inlineModuleLoader` plugin above
    exists to prevent, if that plugin were ever removed or broken,
  - the Playables SDK `<script>` tag precedes the inline `<script>import(...)</script>`
    loader — the certification-critical ordering documented in PLAYABLES-SDK.md,
  - **no `src="/..."` or `href="/..."` root-absolute path** (excluding protocol-relative
    `//...`) anywhere in the HTML — Playables does not host games at the domain root, so a
    root-absolute asset path 404s there even though it works fine locally/at `vite preview`.

  All of these are re-checked here because building the ZIP is the last chance to catch a
  regression before submission, and this isn't paranoia — building this script is exactly
  what caught the SDK-script-order bug *and* the absolute-path bug documented in "Known
  Issues Fixed" below (the network-order bug above was instead found by reasoning about the
  Test Suite's actual failure mode, not caught after the fact). In each case the *source*
  files looked correct; `vite build` silently broke them in the shipped output.
  `archive.directory(DIST_DIR, false, filterFn)` puts `dist/`'s contents at the ZIP root
  instead of nesting them under a `dist/` folder (Playables requires `index.html` at the
  archive root) and `filterFn` drops `.gitkeep` files — harmless repo-scaffolding cruft
  (git can't track empty directories) with no purpose in a submission archive. `build/` is
  gitignored, same as `dist/`.
- **Certification testing must target `npm run preview` (or the built `dist/`), never
  `npm run dev`.** In dev mode, Vite manages its own module graph and injects its HMR
  client (`<script type="module" src="/@vite/client">`) ahead of everything else, including
  the SDK script — none of which resembles the shipped artifact's load order in any way,
  and `main.ts` is still served as a plain static `<script type="module" src="/src/main.ts">`
  (the `inlineModuleLoader` plugin's `apply: 'build'` means it never touches dev serving).
  A red "SDK loaded before any game code" (or similar network-order) result from pointing
  the Test Suite at `npm run dev` is **expected and not a real bug** — it says nothing about
  the actual submission artifact. Always run the Test Suite against `npm run preview`'s
  served `dist/` (or the unzipped submission ZIP) instead.
- **Audio provenance**: adding any audio file requires a row in `AUDIO-SOURCES.md` (repo
  root) first — file, source URL, license, date added — and only **CC0** or
  **self-generated** audio is acceptable, since an unresolved copyright claim on a sound is
  one of the most common Playables rejection reasons. This is a process rule, not (yet) a
  mechanical build gate — nothing currently fails `npm run build` for a missing registry
  row. `AUDIO-SOURCES.md` deliberately lives at the repo root, not under `public/assets/`:
  it's an internal process document, not a game asset, so it must never end up inside
  `dist/` or the submission ZIP — `public/` is copied into `dist/` verbatim by Vite, so
  anything under `public/assets/` ships; the repo root does not.
  `public/assets/audio/blip.wav` — the project's one existing audio file, predating this
  rule — has a registry row backfilled by directly inspecting its raw PCM samples (constant
  ~441 Hz tone, exact 20.00% peak amplitude, no external source referenced anywhere in the
  commit that added it): self-generated, not from a template or sample pack.

## Playables Submission

Chunk 12: nothing new in the gameplay, only what certification needs.

- **Dev hooks are gated *and* the gate is verified.** `window.__game`, `__getRecentErrors` and
  `__adGate` sit behind `import.meta.env.DEV` in `main.ts`, and `check-bundle.mjs` greps the
  built output for all seven dev global names. **"We gated it" and "it is gone" are different
  claims**, and only the second is checkable — which is not pedantry: the guard immediately
  caught four `__*Perf` names shipping in production.
  - **Why they shipped, and the fix.** Gating a *call site* removes the call, not the method it
    called: Vite eliminates the dead branch and the class method stays in the bundle,
    unreferenced, string literals and all. Moving the reporter behind a dynamic `import()` in the
    dead branch does not work either — Rollup still emits the chunk. What works is a **static**
    import whose only reference sits inside an `import.meta.env.DEV` branch: the statement is
    dropped, the export becomes unreferenced, and the module is tree-shaken out entirely. That is
    why `perfReport.ts` exists as its own file.
  - The same guard fails on placeholder-looking filenames anywhere in `dist/`. Checked on what is
    *in* the build, never on what the code loads — a guard at the load site protects nothing,
    because an unreferenced asset in `public/` is copied in regardless and ships at full size.
- **Ads: `adPolicy.ts` decides *whether*, `adGate.ts` owns *how*.** Interstitials are capped
  (3 per session, 90s apart, none in the first minute) and `canShowInterstitial` **requires** its
  caller to assert that nothing is in play rather than inferring it — an interstitial mid-wave is
  not a pacing problem but a lost run, and the one place that knows is the one that decides. The
  rewarded continue is offered once per run and only after a failure; a continue sold after a
  cleared run is an ad with nothing attached.
  - The policy lives on `scene.registry`, not on the scene: a restart rebuilds every field, and
    a player who restarts four times must not see four ads.
- **`rewardJoin.ts`: the two signals a rewarded ad produces, joined in either order.** The
  platform sends `RESUME` **before** the show promise settles, so a `.then()`-only restore acts
  on a scene that may already have been restarted; restoring on `RESUME` alone is worse, because
  at that moment nobody knows whether the reward was earned. So it waits for both and applies on
  whichever arrives second, exactly once, with a run token so a reward arriving after a restart
  cannot revive a run that is gone. Tested in both orders and with an arbitrary delay between.
- **Load order, verified on the built artifact.** Served by `vite preview` (never `npm run dev`,
  whose HMR client and static entry tag resemble nothing that ships), the request order is:
  document, `youtube.com/game_api/v1`, the SDK's own `ytgame.js`, then the game bundle. The entry
  chunk's request starts after the SDK's — which is the property the Test Suite's check actually
  watches, and the one this project has failed before.
- **Localization.** Every scene string goes through `t()`; the `es` dictionary is typed
  `Record<StringKey, string>`, so a key added to one dictionary and not the other is a build
  error rather than a blank label. Measured: the Spanish copy is ~18% wider than the English
  (290px vs 245px at its widest) and still fits at 1920x1080, 390x844 and 844x390 — at the
  narrowest the result panel is 312px against a 283px longest line.
  - **There is no locale switcher, by design.** `initLocale()` resolves the platform language
    once before `new Phaser.Game(...)`, which is what the template guarantees and what stops a
    `Text` object from being created under one locale and read under another. HUD strings are
    built at construction, so a mid-session switch would leave them stale — not a defect of a
    game that never offers one, but the reason not to add one casually.
- **What a human still has to do.** The official Playables Test Suite is an external tool driven
  by hand against `npm run preview`; it has not been run here, and chunk 12's first acceptance
  item is therefore open. Everything it is known to have caught on this project before — script
  order, network order, root-absolute paths, dev globals — is checked mechanically by
  `check-bundle.mjs` and `make-bundle.mjs` on every build.

## Pickups: A Reason To Leave The Line Of Fire

**⚠ The set described below is two rounds old: it is five kinds now, and `vent`, `charge` and
`overdrive` are gone with the heat bar the first of them drained.** See "Five Things A Player Can
Name". What is still exactly true here is the *placement* — the side-away-from-the-fire rule, the
deck, the seeds, the magnet, the depth band, the boost ceiling and the breather compensation — which
is most of the section and none of what changed.

`src/rail/pickups.ts` + `pickupShapes.ts` (pure, `npm run verify:pickups`) and `PickupSprites.ts` +
`pickupArt.ts`. Four things lying on the ground: **vent** (half the heat bar, and it breaks an
overheat lock), **boost** (a faster rail for 6s), **charge** (a standing addition to the volley
multiplier) and **repair** (a shield back). The reference this came from gives speed, and speed on
its own is a weak reward in a shooter — these are tied to the systems the player already reads.

- **The placement fights the fire, and that is the whole feature.** `sideAwayFrom` weighs the live
  enemy list by distance and puts the pickup on the side the targets are *not*, so the stroke and
  the flight are different movements and there is a decision to make. A pickup lying among the
  targets costs nothing to collect and the feature would not exist. Measured live: with every enemy
  on the right (`offsetX` 0.44 / 0.10 / 0.37), all five drawn pickups were on the left (—0.88 to
  —0.51).
  - **The side is resolved when the pickup is released, not when the lap is laid out.** Waves are
    spawned ahead of wherever the camera has got to (chunk 9), so at layout time there is nothing to
    be on the other side of. The layout is still fully seeded — kind, spacing and how far out — and
    the seeded sign is what an empty sky falls back to.
- **⚠ Dealt from a shuffled deck, not drawn independently, and the difference showed up on the
  first level.** An i.i.d. draw against the weights is right in the limit and wrong on a lap: the
  first level's 21 pickups came back with **five** of the rarest kind against an expected 1.75,
  three of them consecutive. **The lap is the only sample anybody experiences**, so "often" and
  "rarely" have to be true over one. A deck holding each kind in its proportion, reshuffled from the
  same seeded generator when it runs out, gives 9 / 4 / 6 / 2 on that same lap.
- **⚠ The boost cannot simply be +25%, because the track has a speed limit and it is not a taste
  question.** A faster rail shortens the window a target is engageable for, and `road/sightline.ts`
  holds that window to a five-second floor — the rule that exists because a corner once shipped
  that a player could not fight through. A 6-second boost is longer than the window itself, so a
  boost that broke the floor would take a whole wave away.
  - `boostCeiling` derives the headroom exactly as `ENDLESS_MAX_SPEED_SCALE` does, and `RailScene`
    measures it **per run, from the circuit that was actually built** (one `sweepEngagement` at
    scene create) rather than from a table of nine numbers that could go stale. `forest` comes back
    at **1.28**, so it gets the full boost; a level already at the floor gets none.
  - **Where the ceiling leaves nothing, the kind is not sold at all** (`kindsFor`). A boost that
    cannot make the rail faster is a product that does nothing, which is exactly the failure the
    weapon upgrades caught when a heat step was sold to a gun heat could not bind.
  - **A second boost extends rather than stacking**, for the same reason: the speed is capped, so
    stacking would have to break the cap. Extending gives the same total reward — more enemies per
    second, for longer.
- **⚠ Without a compensation, a boost *thins the fight out* — i.e. punishes the player for taking
  it.** A wave is laid out in distance, so its own density cannot change with speed; the breather
  between waves is a *duration* (deliberately — see `run.ts`), so a faster camera covers more ground
  during it. `breatherSkipMs` skips breather time in proportion to the speed, which leaves the
  breather a duration everywhere else. Measured in `verify:pickups`: **6.00 enemies per 100 segments
  at speed 1, 6.04 boosted (0.7% off), 4.98 with the compensation removed** — so the check is shown
  to fail before it is believed.
- **The four silhouettes are measured, not eyeballed.** `pickupShapes.ts` holds the polygons and
  `verify:pickups` rasterises them at the 24px they are read at, letterboxed so the *aspect* counts
  — which is the half that does most of the work, exactly as it does for the enemy silhouettes. Two
  shapes were rejected by that check before they shipped: a solid arrow shared **66%** of its
  silhouette with the diamond (both tall, both pointed at the top) and became a double chevron at
  0.37; a solid diamond shared **62%** with the cross (both centred and roughly square) and became a
  hollow ring at 0.48. Aspects run 2.00 / 1.00 / 0.73 / 0.61, no two within 15%.
  - **Their colours go through the threat rule too**, because a reservation enforced on one palette
    is not enforced — the lesson the interface palette taught by shipping the danger hue as the
    player's own accent. All four measure 62—164 degrees from `THREAT_COLOR`.
- **Every effect lands on a readout that already exists, except one.** The heat bar drops, the
  multiplier punches (the scene sets `run.lastMultiplier` to `1 + bonus` on collection, which is
  true — the next stroke really is worth at least that, a single mark included), and a shield pip
  grows back in the delayed animation `Hud` already had for a restored shield. **The boost is the
  one that needed a readout of its own**: two chevrons under the score, in the pickup's own green,
  the far one fading with what is left. An effect with nothing in the HUD cannot be told from a bug.
  (⚠ Superseded once there were three timed pickups — it is a row of badges now, see "Three more
  pickups, a depth term, and something to fly into".)
- **Collection is screen-space, against the boxes the sprites were drawn at this frame.** Same rule
  as the lock-on's targets, and for the same reason: a pickup the player can see is one they can
  take, and the game's two hit systems cannot end up disagreeing about what touching means. The
  magnet is the plan's 1.4x, and `verify:pickups` shows the same near-miss is a miss without it.
  **⚠ And that was only half a test — it had no depth term at all, and pickups were taken up to 44
  segments early.** See `PICKUP_REACH_Z`.
- **The charge bonus is capped at +1.0.** The plan asks for a bonus no timer takes away, which over
  a long endless run is an unbounded multiplier if nothing bounds it — and the multiplier is the
  game's whole economic argument, so inflating it past what a full stroke earns would make the
  stroke irrelevant. **Repair is capped at the level's own starting shields** for the mirror reason:
  otherwise collecting undoes the difficulty ramp's two-shield levels. A repair taken at full
  shields is worth nothing, which is honest and is a real reason to leave one.
- **Its own seed per level** (`pickupSeed`), on exactly the argument `waveSeed` makes about
  `decorSeed`: sharing one would mean moving a tree also moved the vents. `verify:levels` asserts
  all three are distinct on every level.
- **A pickup comes back on the next lap.** The field tracks which lap each placement was last
  released on, because the track loops and a lap of empty ground is what a player who plays well
  would otherwise get. Taken ones stay in the list for 220ms so the bloom-and-fade has a frame to
  be drawn on.
- **Measured** at 1920x889 with a boost forced on for the whole run, ship chasing pickups: whole
  frame **2.8ms median / 5.2ms p95**, against **2.9 / 5.6** with the render and the collection
  stubbed out and **3.1 / 5.7** with them put back — i.e. the cost is below this harness's own
  noise floor, the same finding the HUD's own A/B produced. Peak 5 drawn against a pool of 12; 1200
  frames of a full run to results with zero errors.

## Four Hulls, And What Each One Gives Up

**⚠ `ShipStats.cooling` is now `ShipStats.fireRate`** — a factor on the armed weapon's cooldown,
where a *smaller* number is the better hull — because the heat bar it scaled no longer exists. The
balance argument below is unchanged and was re-run against the new stat. See "Five Things A Player
Can Name".

`src/game/ships.ts` (pure, `npm run verify:ships`), `src/scenes/Hangar.ts`, `src/shop/shipCatalog.ts`
and save **v10**. Four hulls: the free **Lancehull**, the fast and fragile **Needle**, the tough and
slow **Bastion**, and the **Hive**, which takes four more marks per stroke.

- **A ship carries passive characteristics; a weapon carries active behaviour.** That split is the
  design and not a convention: nothing in `ships.ts` changes a gun's damage, its shots per lock, its
  cooldown or its spread, so the two systems stay tunable independently. The four numbers a hull
  does move are the four the player already reads on screen — the shield pips, the heat bar, the
  lock counter and how fast the world goes past.
- **⚠ The plan's own Hive was strictly better than the free hull, and the first run of the check said
  so.** It was the base hull plus four locks, with the plan's text calling that "does not stand out
  otherwise" — which is not the same as giving something up.
  - The first fix was the deficit its advantage implies: heat is charged per mark, so a hull that
    takes more marks should struggle to cool. **The simulation then rejected that too**, and the
    reason is worth keeping: a cautious player fires narrow strokes, pays no heat for them, and
    keeps the whole benefit of the wider ceiling. At `cooling 0.85` the Hive came out **38% ahead**
    of the field under the cautious profile. It pays in **speed** instead, which is charged on every
    stroke of every profile.
- **The balance acceptance is a simulation, and it is built on the game's own modules.** Ninety
  seconds, two play profiles, averaged over all seven weapons, using the real `heat.ts` functions
  rather than a second copy of the decay:

  | hull | aggressive | cautious | mean |
  |---|---|---|---|
  | lance-hull | 50034 | 26918 | 38476 |
  | needle | 53015 | 31995 | 42505 |
  | bastion | 46652 | 25122 | 35887 |
  | hive | 45183 | 32329 | 38756 |

  **18.4% between the best and the worst**, against the plan's 20%.
  - **Averaged over the arsenal, not measured on one gun.** Cooling is nearly inert for `lance`
    (`heat.ts` documents the cool weapons never overheating), so a hull's cooling stat would look
    free if the model only ever flew that one.
  - **Per profile the bound is looser (30%) and that looseness is a finding rather than a
    convenience.** Shields are insurance and insurance pays nothing to a player who is never hit, so
    the tankiest and the fastest hull cannot come out level under a profile that rarely dies — that
    gap *is* the stats meaning something. Current spread: 17.3% aggressive, 28.7% cautious.
  - **The model is shown to reject a hull that really is better**: one improved on all four axes
    comes out 38.9% ahead of the base, i.e. the check can fail.
  - It is a model and says so in its own docstring: it projects nothing, draws nothing and resolves
    no frame. It carries the four quantities a hull moves and the scoring rule they feed, which is
    enough to answer "does one dominate" and nothing else.
- **Ownership is not a save field; the *choice* is.** A bought hull is an ordinary `'unlock'` in
  `purchases`, exactly as a weapon, a theme, an upgrade step and the fourth loadout slot are — and
  `verify:ships` asserts that none of the four id spaces can claim another's id. What is genuinely
  new state is `selectedShip`, which is what took the schema to **v10**.
  - `upgradeV9ToV10` writes the same value the normaliser would have defaulted, and exists anyway:
    the ladder is where a reader finds out what changed at each version, and a version that silently
    does nothing cannot be told from a bug. It **grants nothing** — a returning player owns the free
    hull and whatever they actually bought.
  - Covered by a test that loads a real v9 payload and checks both halves: everything else survives,
    and a selection naming an unowned hull is filtered by `resolveShip` rather than handed over.
- **The hangar shows one hull at a time and draws the comparison as an arrow, not only as a bar.**
  Two bars on two different screens cannot be compared — the player sees one hull at a time, so
  "longer than the last one" is a memory test. The arrow says which way each number moved against
  the hull currently equipped, which is the question being asked; the bar still says how much of
  that stat the hull has at all, normalised across the whole set so the longest bar is a real
  maximum.
- **Three states on the buy control, not two** (`Buy` -> `Equip` -> `Equipped`). A Buy/Owned pair
  hides a real bug: the coins go, the label changes, and nothing in the game is different because no
  control equips the thing. Verified live: `Equipped` -> `Buy 400/5000` -> `Equip` (coins 4600,
  `ship-needle` in `purchases`) -> `Equipped` (`selectedShip: needle`), and a fourth tap does
  nothing.
  - The shop sells them too, through the machinery the themes already needed: `selectable` left at
    its default turns an owned row into the same Select / In use control.
- **⚠ The HUD would have drawn three pips for a five-shield hull.** `updateShields` looped the
  `SHIELDS` constant, so two of the Bastion's lives would have been invisible — the player would
  have survived hits the HUD said they could not. The pip array is now allocated for
  `MAX_SHIELD_PIPS`, **derived from the table** so a tougher hull added later cannot reintroduce it,
  and each run draws `shields.max` of them (a new field, because a run's own starting count is what
  the HUD is drawing).
- **A hull's speed multiplies the level's, and does not replace it.** The level's own `speedScale`
  is a difficulty knob held to the five-second sightline floor; a hull that *set* the speed would
  delete that ceiling on every level at once. The same applies to the lock ceiling: `lockCapFor`
  takes the hull's ceiling as an argument and a jammer still caps it with `Math.min`, so the three
  numbers that can limit a stroke keep three separate owners.
  - A pleasant consequence, measured rather than designed: a slower hull leaves *more* sightline
    headroom, so the Bastion's pickup boost ceiling comes out at **1.42** where the base hull's is
    1.28.
- **Cooling reaches the game through `stepHeat`'s new `coolingScale`,** defaulted to 1 so every
  existing caller and every balance figure measured before hulls existed is untouched. Applied there
  rather than by a caller subtracting from `state.value`, because the idle bonus and the decay have
  to compose and a second place doing it is a second place to get it wrong.
- **One texture, four tints.** The hulls differ in colour rather than in art, the same trade the
  decor makes across themes: four PNGs for four shapes is work the game has not earned yet, and the
  hangar preview and the flown ship read the same tint so the ship chosen is the ship seen. Real
  per-hull art is a drop-in replacement for `SHIP_TEXTURE` plus a key per hull.
- **Verified live** at 1920x945: the three states above; the hangar laid out at 1920x945, 390x844
  and 844x390 with nothing escaping the frame and every tap target at 44px; the Bastion flying
  `forest` at base speed 5400 (6000 x 1.00 level x 0.90 hull), five shield pips drawn, cooling 0.80
  reaching the heat model, zero errors.

## A Track Is A Place, Not A Palette

`enemyMix` and `pickupSpacing` in `src/game/levels.ts`, `weightedPool` in `src/rail/waves.ts`,
`RunState.ratedScore`, and `src/game/trackMap.ts` (pure, `npm run verify:levels`). The plan's last
chunk asks for a `TrackDef` entity with five tracks; **this game has had that entity since levels
landed**, so what shipped is the three things a level was still missing.

- **No `src/rail/tracks.ts`, and that is the decision.** A level already *is* the plan's track: one
  circuit, one biome, one light, one enemy pool, one boss, one star record. A second entity beside
  it would give the game two answers to "what am I flying", and every unlock question, the progress
  readout and the whole star record would have to pick one. Same call, and the same reasoning, as
  chunk B's "the brief describes a game with one weapon; this one has seven".
- **⚠ Two levels on the same tier were the same fight in two palettes**, and nothing said so. A tier
  decides which *behaviours* the player has met by now; it was also, silently, the whole composition.
  `enemyMix` reweights the tier's own bag per level — `verify:levels` measures every pair and holds
  the closest to a third of the roster apart. Closest pair today: **wetland / fungal, 38%**.
  - **A kind the mix does not name is worth 0.4, not 1**, and that number is the difference between
    a mix and a nudge: at full weight the tier's long tail dominated and every late level came out
    within **21—28%** of every other, because its headline kind was a fifth of the bag and the other
    four fifths were identical everywhere. A named kind is floored at one entry so "a little of
    this" is never "none of this"; an unnamed one may round away.
  - The check rejected two rows before they shipped: `fungal` was written as a second
    bulwark-and-hexer level (15% from `ashen`) and became what a spore forest should have been all
    along — things that come apart into more things.
- **⚠ The third star was pierceable, and the plan's rule about that is the most useful thing in it.**
  A stroke across eight targets is worth x3 and a charge pickup adds up to +1 on top, so a threshold
  read off the showcase score is a threshold one stroke-heavy lap clears on a level the player
  cannot otherwise survive. `RunState.ratedScore` counts each kill once at its own value, with no
  multiplier and no bonus, and the star is judged on that. Measured in a live run:
  **score 1828 against a rated 800, a ratio of 2.29.**
  - **`score` is untouched.** It stays the showcase: the HUD, the result screen, `sendScore` and the
    coins all still read it. The two answer different questions — what the player did, and what the
    player can do — and only the second is safe to build progression on.
  - **The boss is deliberately not counted in it.** Measured on the shipped table, a boss is worth
    7760 base points on the first level against 1300 for every wave enemy in it put together, so a
    rated score including it would be dominated by "did you kill the boss", which is what the *first*
    star already asks. Counting waves only makes the third star its own question: how much of what
    came at you did you get, rather than how much slipped past.
  - **Every target was re-derived** as 77% of what its own level actually fields, computed from the
    wave table rather than typed in — the old numbers were tuned against a multiplied score and
    would have been either free or unreachable. `verify:levels` prints the table and holds every
    share inside 60—90%.
  - The check that used to assert the targets rise monotonically was **rewritten, not repaired**: a
    share of each level's own content is not a ladder of absolutes, and `ridge` fields fewer, more
    dangerous enemies than `ruins`. What is asserted now is the share, plus that the chain ends up
    asking several times what it started with.
- **The level-select card draws the lap the run will build.** `trackMapPoints` walks
  `buildLevelCircuit(level.circuit)` — the same call `WorldView` makes — so the shop window is a
  function of the goods and cannot drift from them when a circuit is re-tuned. `verify:levels`
  asserts it: nine levels, nine distinct shapes, the same circuit always drawing the same picture and
  two extra bends always drawing a different one.
  - **⚠ The first constant made every lap a scribble.** A plan view integrates curvature into a
    *heading*, which is not what the renderer does with it, so the constant had to be its own — and
    the first guess turned one bend through eleven radians. Measured against the real laps (total
    `|curve|` runs 200 on the first level to 900+ on the winding ones), the shipped value turns a lap
    through 1 radian at the flat end and 4.5 at the winding end, which is the difference the card is
    for.
  - **The path is left open, because this lap is not a closed circuit.** The track wraps in `z` —
    the player passes the seam and carries on — but its bends do not have to bring the road back to
    where it started in plan view, and most of them do not. Closing it drew a chord across the
    picture between two points the road never joins.
  - The maps got a column of their own after the first screenshot: drawn over the row's left edge
    they landed on top of the level names, legible in neither direction.
- **Every locked row now says what to go and do.** It used to read `Locked`, which is a state rather
  than an instruction; the thing standing between the player and that row is one specific level,
  which the row can simply name (`Clear 3. Dunes`). The endless run always did this — this is the
  same courtesy extended to the chain.
- **The unlock gate stays a chain, and the plan's star-sum gate was not adopted.** That is a
  standing decision with a written reason: a gate made of stars turns "go back if you want to" into
  "go back or stop". What the plan is *right* about is that a progression gate must not be
  pierceable by one lucky run, and that rule is what `ratedScore` implements — applied to the place
  this game can actually be pierced.
- **No save migration, and that is checkable rather than lucky.** Stars are already stored and only
  ever go up, so a record earned under the old criterion stays earned; nothing new is persisted.
- **Verified live**: `wetland` flies its own composition (swarmer-heaviest, then jammer, hexer,
  weaver), 22 pickups on its 930-segment lap at the densest spacing in the game (38 segments), the
  level select laid out at 1920x945, 390x844 and 844x390 with nothing escaping the frame and a 46px
  close button, and a full run to results with zero errors.

### Carrying the player forward

Three things reported from play, all of them about a run ending where it should continue.

- **The result screen has a Next button, and it is the primary one.** A cleared level used to offer
  "Again" and "Levels" — repeat this, or go and find the next one in a list — which is a stop at
  the exact moment the game should be carrying the player on. `nextLevelId` answers what follows,
  the scene hides the button when the answer is `null` (the last level, the endless run, or a run
  that *failed*), and `restartButton` stops being primary while it is showing: two buttons drawn as
  the primary one is a screen with no opinion.
  - **⚠ It shipped invisible-by-position first, and `visible` said it was fine.** The result row is
    laid out in `layout()`, which runs on resize and not per frame — and the scene answers "is
    there a next level" one frame *before* the HUD flips into its result state. So the button was
    visible, interactive, hit area 48px, and sitting at **x = 0**. Found by measuring the drawn
    positions of all three buttons, which is the same defence the menu's alpha-0 button needed. The
    fix is one `layout()` call on the frame the results appear.
- **The endless run is open from the first minute** (`isEndlessOpen`). It used to unlock only once
  every level was cleared, on the reasoning that it is the tour you take after the tour — which is
  backwards for what it actually is: the mode with no gate, no boss and no target, the one a player
  reaches for when they want to fly rather than be tested. Gating it behind the whole game hid it
  from everyone who has not finished the game, which is everyone at the start. `allLevelsCleared`
  survives, because "has this player finished" is still a question worth asking.
- **Levels are longer: 6—10 waves rather than 3—7.** Three waves and a boss is under a minute,
  which is where the report came from. Every star target was re-derived at 77% of what its level
  now fields, because the targets are a share of the content and the content changed; `verify:levels`
  asserts the floor of six and prints the row.

## The Matte That Was Not Broken

`scripts/verify-mattes.mjs` (`npm run verify:mattes`, wired into `npm run build`) and two new steps
in `build-sprites.py`. The brief this came from opens by calling the matte a blocker: a light
rectangle around every prop and a light rim along its contour, caused by an uncut white background
at alpha 0.05—0.15. **None of that is true of these assets, and finding out cost less than fixing
it would have.**

- **Measured before anything was touched**, across all 62 shipped sprites: the fully transparent
  pixels are **black, not white** (0 of 62 files have mostly-white transparent RGB, median RGB 0.0),
  and only **3 of 62** have an edge lighter than the body. There is no light rim to remove.
- **⚠ The first version of the check therefore asserted the opposite — and failed 85 of 85 files,
  which looked like a find for about ten minutes.** The median edge measured **0.45** of the body's
  lightness, i.e. the rim was *dark*. What settled it was comparing the shipped files against the
  raw renders they are built from: **28 of the 37 dark-edged sprites are dark in the raw render
  too.** That edge is the black outline the entire art style is drawn with — the same outline the
  generation pipeline's own prompts ask for. A check that cannot tell the style from a defect is not
  a check.
  - Three separate metrics tripped over the same outline before one survived: edge-versus-body
    lightness, distance-to-nearest-opaque-colour, and a fixed-point test on the flood. Each looked
    principled and each was measuring the drawing.
- **What was actually wrong was smaller, real, and in the *build*, not in the generation.** The raw
  renders are correctly matted; `build-sprites.py` was losing two things:
  - **Alpha with no meaning:** a median of **5.6% of every canvas** sat at `0 < alpha < 0.06`, one
    prop at 16.6%. Present in all 62 files. Floored to zero now.
  - **No colour under the transparency:** every transparent pixel carried black, so the LANCZOS
    downscale — and every mipmap level the GPU builds afterwards — mixed black into the silhouette.
    Flooded now, and **after** the quantiser rather than before, because the quantiser maps
    transparent pixels onto its palette too and undoes a flood run ahead of it.
- **⚠ And the honest part: fixing it changed almost nothing visible.** Measured at the size a
  billboard is actually drawn (44px) with the same pipeline either side, the edge lightness moves by
  **0.1—0.9 units**; on the white weapon effects at 24px, by **0—2%**. The reason is the same
  outline: what bleeds in is black, and what it bleeds into is a black outline. The fix is still
  right — it is what protects the next asset that is *not* outlined in black, and it costs 25KB —
  but it is not a rescue, and calling it one would be a lie about a screenshot nobody could tell
  apart.
- **The check that shipped asserts only what is separable from the drawing**: no alpha under the
  floor, and a transparent ring that carries colour. The second is calibrated against files known to
  be flooded and known not to be — a never-flooded raw render scores **0.01—0.02**, a built file
  **0.16—1.24 (median 0.65)**, and the floor sits at 0.10 between the two populations. A synthetic
  pair inside the script proves it still rejects the unflooded case on every run.
  - **Corners are reported, not asserted.** "All four corners transparent" is a proxy for "the
    background was cut", and these sprites are cropped tight, so content on the frame is what a
    tight crop *means*: a turret's base spans the bottom edge and `im_sparks` throws sparks into all
    four. 12 of 85 files do it and every one of them is the object.
- **No regeneration, and no Modal spend.** The brief's step 4 is "regenerate all 49 props and 13
  enemies"; the raw renders were already correct, so the repair is a build step over files that were
  on disk. The 62 assets were rebuilt from them in six seconds.

## The Volley Steps Instead Of Scaling

`src/rail/volleyTier.ts` (pure, `npm run verify:effects`), the shockwave and flash in `Effects.ts`,
two speeds of heat pulse in `WeaponRow.ts`, and a visible parting for the splitter. **No mechanic
changed**: every number here was already being computed, and what was added is how loudly it is
presented.

- **The response used to differ only in *how often*.** Eight marks were eight of everything — eight
  hitstops, eight bursts, eight numbers — which reads as *more frequent*, not as *bigger*, and the
  multiplier is asking the player to go for bigger. Three tiers now, and each adds something the
  tier below does not have at all: 3—5 marks add a shockwave ring, a camera push and a tighter
  stagger; 6+ adds a frame flash and slows time. `verify:effects` asserts that the middle tier does
  *not* slow time and that every tier is reachable with the shipped lock ceiling.
- **A wider stroke fires tighter, not longer.** `createVolley` takes a `staggerScale`, because at a
  flat stagger the widest stroke in the game also has the longest wait for its own salvo — the
  reward arriving as a queue. Defaults to 1, so every measurement taken before the tiers is
  unchanged.
- **⚠ The one global time scale in a game whose hitstop is deliberately per-entity, and the
  distinction is the whole justification.** `hitstop.ts` must never be global: eight freezes in a
  row is a slideshow and it freezes the ship the player is flying. This is a single 180ms event on
  the rarest tier — the opposite case — and it scales only the *world's* delta: the HUD, the
  lock-on and the input keep real time, or the reward for a wide stroke would be a control that has
  gone sluggish.
  - **⚠ 180ms is 60% of `VOLLEY_COOLDOWN_MS` and 90% of the fastest gun's own cooldown**, so a
    player firing full-width strokes would have spent most of the fight in slow motion. The check
    that found it simulates a minute of the most abusive input the game accepts; `STORM_COOLDOWN_MS`
    holds it to **9% of the time**, and the same simulation without the bound is shown to reach 90%.
  - Known limitation, stated rather than hidden: the slowdown scales *motion*, not *deadlines*. A
    telegraph and a shot's arrival still run on the wall clock through it, so a storm slows what
    moves and not what is scheduled. Making it exact would mean a second game clock threaded through
    every deadline in `run.ts`, `enemy.ts` and `boss.ts` — a much larger change than 180ms of
    presentation earns.
- **The splitter's parting is drawn, because it is the one death that has to explain itself.** A
  wide stroke across a group produces more targets than it marked, and with no picture of the
  parting that reads as the game spawning enemies out of nowhere.
  - **⚠ And the first version drew it off screen.** `screenPositionOf` returns where the enemy was
    last *projected*, which for one that has flown past the camera is far above the frame —
    measured at **y = -596** on a 945px frame. It is now drawn only when the position is inside the
    viewport, which is also the honest rule: a parting nobody could see explains nothing.
- **The heat bar warns before it locks.** Two speeds of pulse rather than one (a slow breath from
  the middle step, a hard one from the top), a small tremble on the row at the top step, and a sound
  on each *crossing* — `heatCrossing` returns a step only when it is newly reached, because "the
  gun is hot" stays true for as long as it is hot and a warning played on the condition plays every
  frame. Same rule as the score's milestones.
- **⚠ A hull's extra marks were being thrown away one line after they were computed.**
  `LockOnView.setLockCap` clamped to `MAX_LOCKS` — which is the *weapon's* ceiling — so the Hive's
  four extra marks never reached the stroke and 700 coins bought a hull that behaved exactly like
  the free one. Found while wiring the tiers, which had to ask what the real ceiling was. The clamp
  now derives its ceiling from the ship table, and `verify:ships` walks the whole path from table to
  stroke.
- **Measured** at 1920x945 with 72 enemies alive, a full-width release every 40 frames and three
  simultaneous deaths: **1.9ms median / 4.3ms p95** against a 16ms budget — *faster* than the same
  scene sitting quiet (2.5 / 6.2), i.e. the new layers are below this harness's own noise floor, the
  same finding the HUD and the pickups produced.

## More World Without More Files

`src/road/decorVariation.ts` (pure, `npm run verify:road`), `DECOR_TIERS` in `road/constants.ts`,
and `fromOklab` in `road/color.ts`. Nine biomes hold five or six props each, so a lap shows the same
handful of shapes dozens of times. **The answer is not 150 more files.**

- **Variety comes from instances.** One texture, mirrored, resized 0.75—1.35, tilted and shifted in
  hue, is several visibly different objects. Measured on the real placement over 300 segments: **2.2%
  of pairs read as the same object**, against the 8% the brief asks for and **16.1%** with the
  variation switched off — the check prints both, so it cannot pass by measuring nothing.
  - **Derived from the coordinate, never from the spawn.** `variationFor(segmentIndex, side, propId)`
    is a pure hash, so a prop does not change when the screen rotates, when it lands in a different
    pool slot, or when the player comes round the same lap again. Its own hash rather than
    `createRng`, because a seeded *stream* has to be walked in order to reach the nth value and what
    is wanted here is an answer for one coordinate, computable in any order.
  - **The hue shift goes through OKLab**, which needed `fromOklab` — the inverse the project had
    never written. Round-trips exactly on every colour tested.
  - **⚠ And the shifted tints are swept for the threat reservation**, because a tint the player sees
    is bound by it however it was arrived at. 756 products (9 biomes x 7 themes x the extremes of
    all three colour axes); the closest lands **39.6 degrees** from the threat hue against the 30
    reserved.
- **⚠ Which props lean was a regex over the prop ids' own vocabulary, and it was wrong in both
  directions.** It leaned `cry_cluster` and `dune_spire` — a crystal formation and a rock needle —
  and refused `dune_cactus` and `wet_cattail`. The argument for it was that a new plant would lean
  automatically; what it bought was two wrong answers in the first four looked at. It is a list now,
  and **the default is not to lean**: a plant standing straight looks fine, a boulder at six degrees
  looks broken.
- **Three tiers instead of one row along the verge.** The far tier is large shapes beyond the
  corridor, deep in the fog; the near tier is rare large objects passing close to the frame's edge.
  Both are the same props at a different distance and scale — **not one new file**.
  - **The near tier is the cheapest speed cue in the game**, because what the eye measures speed by
    is angular rate and only something close has any. Its whole value is that it is rare.
  - **⚠ Its rate was set by arithmetic and the arithmetic was wrong.** "One in 40 segments is about
    one every three seconds" ignores that a segment is 200 world units against 6000 a second: it is
    **1.1s**, a fence rather than an event. Measured over 2000 segments instead of estimated, the
    shipped chance gives **one close pass every 3.9s** — and the effective spacing is not `1/chance`,
    which is why it took three measurements rather than one division.
  - `GROUND_EXTENT` went 26 -> 40 with the far tier, which is **the third time that relationship has
    gone stale**: the ground has to reach past the widest tier or every far silhouette stands on
    sky. It is now asserted against `DECOR_TIERS.far.maxOffset` rather than against the verge's band.
  - Two existing checks had to learn about tiers rather than be relaxed: the placement rate and the
    near-verge share are both measured over the **middle tier alone**, which is what
    `DECOR.DENSITY` and `DECOR.OFFSET_BIAS` describe. Counting the far tier against them would report
    the verge as emptying every time the horizon got busier.
- **Weight: zero bytes.** No asset was added, changed or regenerated for any of this. What the brief
  budgets 400KB for is its third part — ground decals, per-biome particles and a simplified
  far-distance enemy silhouette — which is the only part that needs generating at all.

## The Genre Limiter

A corridor, boosters, buying ships and picking tracks are all the furniture of a **racing** game.
The publisher asked for an action game, and this project already made that turn once: it shipped
three chunks as a racer before the pivot, and `src/race/` is still called that. Without a limiter
written down, every expansion drifts back.

**Four rules. A feature that fails one of them does not go in.**

- **Points are scored only for destroying things.** Not a metre of distance, not a second of
  survival. `ENEMY_POINTS`, `BOSS_HIT_POINTS` and `BOSS_KILL_POINTS` are the entire scoring surface
  and there is deliberately nothing else in `run.ts` that adds to `score`.
- **Speed is a tempo modifier, not a goal.** A faster rail means more enemies per second, which is
  what `speedScale` buys per level and what the endless run's ramp spends. It is never the thing the
  player is optimising.
- **No lap time, no race position, no finish line, no rivals.** The lap exists because the track
  loops; it is not a unit of progress. A run ends when the boss dies or the shields do.
- **Acceleration is always bought with risk.** Faster is less time to mark, because the engagement
  window is distance over speed — which is exactly why `road/sightline.ts` holds that window to a
  floor and why the endless mode's speed ramp stops where it does.

**⚠ The corridor's own first draft failed rule four, and it was caught by measurement rather than by
the rule.** It proposed a world-unit ship position to fix an aspect-ratio unfairness that did not
exist: `projectInto`'s x term is `w/2 + scale * X * w / 2`, so a screen *fraction* already is a fixed
world offset, and the shipped `0.12..0.88` box measures **0.543 road half-widths on all five aspect
ratios, identical to three decimals**. The prescribed `LANE_HALF_WIDTH = 1.15` was also
geometrically impossible: the screen edge at the ship's own row is **0.715** half-widths, so the ship
would have flown off both edges of the frame. See "The Corridor" for what the real defect turned out
to be.

## The Corridor

`laneEdgeFraction` + `laneEdgeGlow` + `LANE_PUSHBACK` (pure, `npm run verify:ship`) and
`rail/LaneEdges.ts`. The ship's lateral box stopped being two constants and became a formula over
the drawn hull, the wall it hits went soft, and the boundary is now drawn — on the screen, after a
version that drew it on the road was measured wrong and backed out.

- **The real defect was never the one the plan named.** A screen fraction already is a fixed world
  offset (see "The Genre Limiter"), so there was no aspect-ratio unfairness in *where* the box was.
  What a constant fraction cannot do is keep the **hull** in the picture: the ship is sized off frame
  *height* (`SHIP_HEIGHT_FRACTION`) and the box was a fraction of *width*, so on a portrait frame —
  where the hull is nearly twice as wide relative to the screen — `0.88` put half of it off the edge.
  The edge is now `1 - shipHalfWidth / viewportWidth`, i.e. the screen edge minus half a hull, and
  `verify:ship` prints the leftover at five aspect ratios: **0.0px at every one of them.**
  - It is the plan's own `SCREEN_EDGE_HALFWIDTHS - shipHalfWidthInHalfwidths`, written in the ship's
    coordinates instead of the road's. Both are the same number; stating it in screen fractions keeps
    `shipMotion.ts` free of the projection, which is the split that lets it stay a verify-script
    module.
- **The wall is soft, because a hard stop reads as the input having stuck.** Sideways is where the
  player is constantly pressed against a limit — dodging *is* going to the edge — and the old clamp
  pinned the position and zeroed the velocity, so a held finger produced a ship that stopped
  answering. It is now a second spring at `LANE_PUSHBACK` times the ship's own stiffness, acting over
  the last `LANE_SOFT_BAND` (26px) *inside* the limit. Held against the wall the ship settles
  **19.4px** short of it in the test and **19.7px** in the running game.
  - **Inside the fixed tick, not after the loop**, or the strength of the push would depend on the
    frame rate — the one invariance `shipMotion.ts` exists to hold, and `verify:ship` runs the held
    case at 60Hz and 120Hz to prove it.
  - The band is inside the lane rather than outside it. The first version let the ship be pushed
    that far *past* the edge, which put the hull back off the frame — i.e. it undid the only defect
    this whole change existed to fix.
  - **The target is clamped to the lane as well as the position.** Without it a pointer held far off
    screen out-pulls the wall spring, and the two springs never balance.
  - The vertical walls stay hard, deliberately: the floor and the ceiling are reached rarely and on
    purpose (the ceiling is `ENEMY_BAND_BOTTOM`, which nothing may enter), so a hard stop is honest
    there.
- **⚠ The boundary was first drawn on the road, and a line on the ground cannot mark a screen-space
  limit.** Two stripes were added to the mesh (`QUADS_PER_SEGMENT` 6 -> 8, a `LANE_EDGE` palette slot,
  a sixth colour in all seven themes) and they looked right in a screenshot. They were not: a stripe
  painted at a fixed world offset **converges with distance** while the limit is a *vertical* line on
  the frame, so the two can agree on exactly one row. Measured in the running game with the ship 3%
  of the frame's height above its rest row, the stripe sat **196px** inboard of the wall the ship was
  actually being held at — the player flies visibly outside their own marked lane, which is worse
  than no marking at all.
  - Getting that far took two corrections. The conversion to road half-widths was first done at a
    **guessed** six segments ahead; solving `projectInto` for the ground row the ship rests on gives
    9.8 (`SHIP_LANE_Z`), and the honest lane is **0.98—1.13** half-widths rather than the 0.688 the
    guess produced — i.e. wider than the road itself, and wider than the ±0.85 wave spread.
  - **The whole mesh change was backed out**, palette slot and theme colours included. What survives
    is `SHIP_LANE_Z`/`laneHalfWidths` as an *analysis* helper, used by `verify:enemies` to ask the one
    question it is exact for: is every target inside the lane, i.e. laterally reachable? (It is:
    0.85 against a narrowest lane of 0.983.) That check was written asserting the **opposite** — the
    six-segment guess said waves reached past the wall — and the corrected geometry inverted it.
  - The marker that shipped is `LaneEdges.ts`: a screen-space band on `uiCamera`, brightest at the
    lane's edge and fading out to the frame's, lit only as the ship approaches. Same argument as the
    ship's shadow sitting on one fixed screen row — a cue about a screen-space quantity belongs in
    screen space.
  - **⚠ The marker itself shipped as ten hard rectangles and read as ten stripes** — see "Three
    Things A Player Reported"; it is a generated gradient texture now.
  - `LANE_WARN_BAND` is three soft bands, so the glow is already **67%** by the time the pushback
    engages: the acceptance is that the boundary is *visible before it is reached*, and a marker that
    appeared only once the wall was pushing would be telling the player something they can already
    feel.
- **The aspect-ratio fairness the plan asked for is already exact — on the metric the plan named —
  and the metric it named is not the one that differs.** The stated test is "the fraction of the
  dodge covered within `TELEGRAPH_MS` agrees across the five aspect ratios to 5%". Measured, it
  agrees to **0%**: **106.6% on every one of them**, the same number chunk 6 set `SHIP_STIFFNESS` by.
  It cannot do anything else — the spring is linear, so doubling the distance doubles the force and
  the fraction is scale-free by construction. No change was needed and none was made.

  What *does* differ is the wall-clock time to clear one hull width on a full flick, because the
  hull is sized off frame height and the spring is scale-free in pixels:

  | | 21:9 | 16:9 | 4:3 | 3:4 | 9:16 |
  |---|---|---|---|---|---|
  | dodge distance | 49px | 49px | 49px | 65px | 87px |
  | time | 33ms | 50ms | 50ms | 83ms | 100ms |
  | of `TELEGRAPH_MS` | 6.1% | 9.1% | 9.1% | 15.2% | 18.2% |
  | covered by then | 106.6% | 106.6% | 106.6% | 106.6% | 106.6% |

- **⚠ Equalising *that* column would need `SHIP_STIFFNESS` to become a function of the hull, and it
  is not reachable.** The stiffness required at the narrow end lands at **k — 240—540** against a
  divergence ceiling of **k = 125** at the shipped damping, which `verify:ship` reports. It would
  need the damping re-tuned with it — and `SHIP_STIFFNESS` is the one constant in the file whose
  current value a test argues for, against `TELEGRAPH_MS`. The quantity is also small: the worst
  aspect spends **18.2%** of the telegraph dodging, leaving better than four fifths of the window on
  every screen. So `verify:ship` asserts a *budget* (the slowest dodge stays under half the
  telegraph) and prints the table, rather than a parity that would cost the dodge budget to chase.

## The Weapon You Can Name From One Frame

`src/rail/trail.ts` (pure, `npm run verify:effects`) and the trail layer in `VolleySprites`. Seven
weapons differed in shots per lock, damage, cooldown and fan — **every one of which is a statistic**,
visible over a minute of firing and never in a single frame. What the player saw of a volley was a
coloured dot, and the same dot for all seven.

- **Colour is deliberately not the answer.** Every weapon already carries one and it is doing other
  work (keeping the player's fire out of the reserved threat band, tinting the muzzle and impact
  art). Two guns a player can only tell apart by hue are one gun on a dark frame and one gun to a
  colour-blind eye. What distinguishes them is **shape and rhythm**: how long the trail is, how
  wide, continuous or broken, whether the path bows, and how the head is paced along it.
- **The trail is sampled from the shot's own live curve, never from a stored history.** Two reasons,
  and the second is load-bearing: a history is an allocation per shot per frame on the busiest frame
  in the game, and the curve is rebuilt every frame against a *moving* target — so a history would
  trail along a path the shot is no longer on, a ribbon visibly detached from its own head.
- **Three bands, not a stroke per sample**, and the number is a cost decision: eight locks times five
  projectiles is four hundred `lineStyle` changes a frame for a gradient nobody can see.
- **⚠ `fanScale` was authored on all seven weapons, asserted positive by `verify:lockon`, and read by
  nothing at all.** Every volley in the game opened by exactly `VOLLEY_FAN_SPREAD`, so `scatter`'s
  1.6 and `needle`'s 0.25 — the numbers the weapon table describes as the shape of each gun's spread
  — were decoration. **The second time this project has found a whole authored column doing nothing**
  (`cooldownMs` was the first, found when the weapon row's cooldown ring had to ask what the wait
  actually was). Found the same way: the trails had to ask how wide this gun's volley opens.
  Measured after wiring: `ripple` spreads 55px mid-flight against `needle`'s 6px on a 96px frame.
- **Two knobs reach the flight record, and both are held to being presentation.** `arc` and
  `fanScale` move a Bézier control point only, so every curve still starts at the muzzle and ends
  exactly on the target at `t = 1`; `arriveAt` is untouched. A shell that hung in the air longer
  would be a balance change wearing an art costume — the same argument the telegraph's own timing
  is held to.
  - **⚠ The lob shipped at `arc: 0.42` and did not lob.** Lifting a control point *along* the flight
    line does nothing at all to the drawn curve when the target is straight up the screen — which is
    where most of them are — it only changes the pace along it. The control point has to be pulled
    *past* the target for the curve to rise over it. Caught by the check, which measures the apex
    against the target's own row rather than trusting the constant: at 0.78 the shell peaks **5.0%
    of its flight above the target** and drops onto it.
- **`burstMs` is the one deliberate exception to `createVolley`'s by-lock stagger**, and it is
  clamped rather than trusted: a lock's projectiles must all be gone before the next lock's begin,
  or a four-shot gun stops reading as one salvo per target and becomes the stream that rule exists
  to prevent. What it buys is the one thing four simultaneous projectiles cannot say — that this gun
  fires a *burst*. The muzzle flash retriggers per distinct launch, so `flechette`'s nose pops four
  times, which `verify:effects` asserts alongside "an unbursted weapon still pops once".
- **The eases are asserted monotonic from 0 to 1** for all seven. A pace that did not finish would
  draw a shot landing somewhere its hit did not.
- **Acceptance: no two weapons draw the same frame.** The same silhouette measure the four pickups
  are held to, over a rasterised frame of each gun's own fire with the colour taken away. Worst pair
  **mortar / needle at 0.35**; every other pair is under 0.30. Shown to bite rather than merely to
  pass: a gun against itself scores 1.00, and two guns handed the same spec are rejected.
  - The seven frames are also **printed as an ASCII contact sheet** by the check. The overlap table
    says no two frames are the same picture; it cannot say whether any of them is a picture of
    anything, which is the project's standing measure-*and*-look rule applied to something that is
    not a sprite.

### Upgrades you can see

`upgradedTrail`, `trailPips` and `fxSizeScale`. 21 steps the player could only read in the shop:
every one of them changes a number the frame never showed — heat per mark, a cooldown, a projectile,
a damage figure — so a bought upgrade felt like a receipt rather than like a gun.

- **The trail thickens and lengthens, the flash and the burst grow with it, and the level is
  *countable*.** A thicker trail says "upgraded"; the pips say *how far*, one per step, which is the
  question a player looking at step III actually has. They sit in the near half of the trail, where
  it is still bright.
- **Modest on purpose, and capped.** A step that doubled the trail would make a fully upgraded
  `pulse` a stripe across the frame and hide the enemies the player is aiming at — a readability
  cost paid for a readout. The length is capped below the whole flight for the same reason: a trail
  reaching the muzzle would join a volley into one lit corridor and hide the eight separate arrivals
  it is meant to celebrate.
- **Every step is asserted to change the picture by a visible amount**, not merely to differ:
  rasterised ink per level, with each step adding more than 4% of the level-0 frame. The table is
  printed. `needle` is the smallest mover (76 -> 98 px of ink) because its trail is already at the
  cap; the number is printed rather than hidden.
- Nothing here is a mechanic. `applyUpgrades` is untouched, and `UpgradedWeapon` already *is* a
  `Weapon`, so the level reaches the renderer as a field it may read and nothing else had to learn
  that upgrades exist.
- **Measured** at 1920x945, stroke every 40 frames on a live wave: whole frame **2.1ms median /
  4.1ms p95** with the trails, 2.0 / 3.3 without — i.e. inside this harness's own noise floor,
  against a 16ms budget.

## Marks On The Ground, Air In The Frame, And A Frame That Survives Being Small

`src/road/decals.ts` + `decalArt.ts` + `DecalMesh.ts`, `src/road/particles.ts` + `particleArt.ts` +
`Atmosphere.ts`, and a build step in `scripts/build-sprites.py`. The three things the world plan
lists as *missing entirely* rather than as needing more of. **All three are procedural or derived:
the 400KB the plan budgets for generation is untouched, and the only bytes added are 3.5KB of
build-derived silhouettes.**

- **Ground marks are real quads in the plane of the ribbon, not squashed billboards.** They are
  built from the *same projected segment edges the road itself was drawn from this frame*, so a mark
  bends with the bend, climbs with the hill and cannot drift off the surface it is painted on — the
  same argument `RoadSprites` makes for reading `s1` out of the mesh's pass rather than
  re-projecting. A squashed sprite would stay flat only for as long as the road ran straight.
- **They darken rather than colour, and that is what makes one texture enough for nine biomes and
  seven themes.** A stain is the ground with less light coming off it, so the mesh draws with a
  multiply blend and every mark takes the colour of whatever it lies on. A tinted decal would need a
  per-biome variant and a palette to select it — the road mesh's own trick — for a mark whose whole
  identity is that it is darker.
- **What a `Mesh2D` cannot do is give a quad its own opacity** (one object-wide tint, no per-vertex
  colour — the same constraint that made the road's fog a texture). So the atlas holds every mark at
  six strengths, one row each, and a quad's V selects the row. That buys two things in one
  mechanism and no extra draw call: marks that differ from each other, and marks that fade into the
  fog rather than sitting on it at full strength.
  - **The fade is the ground's own front-loaded fog curve, renormalised over the decal band**, so a
    mark has finished fading before the band ends rather than winking out at its edge. Measured: the
    faintest goes out at segment 67 and the strongest at 92, inside a 110-segment band.
- **Placement is a pure function of the segment index** — no decorate pass, nothing stored on a
  `Segment` — so the same stretch looks the same on the next lap and at every screen size. 19 marks
  per 100 segments; the pool is 32 against a swept peak of **27**, and the check fails both if the
  demand exceeds the pool and if the pool is more than twice the demand. That second half is the
  lesson the decor pool taught by sitting at 72 against a measured peak of exactly 72.
- **Atmosphere is the cheapest thing in the frame that says where you are.** Nine biomes were told
  apart by the ground, the props and the sky — all of them *out there*. Something drifting between
  the camera and the world is the only cue that puts the player inside the place.
  - **Four shapes across nine biomes**, because the shape says what *kind* of thing is in the air —
    a flake falls, a speck hangs, a glint catches light — and there are not nine of those. What
    separates two biomes sharing one is the tint, the size and the fall: the same argument the decor
    makes for one texture under nine biome tints.
  - **One emitter per shape rather than one reconfigured emitter, and the reason is the seam.**
    `setConfig` resets an emitter, so a biome boundary — where two biomes are on screen for seconds
    — would blink the motes out of the air. Four emitters give the crossfade for free: the biome
    being left stops emitting and its motes finish their own lives.
  - **The pool is derived from the table**, not written down: `rate x lifespan` is what is actually
    in the air, so a hand-picked pool is either short (and reports its own ceiling as the demand) or
    unfillable. The first run of that check failed — `dunes` wanted 62 against a pool of 48.
  - **Alpha is bounded by a check, and the bound is readability rather than taste.** Motes drift
    across the whole frame, `ENEMY_BAND` included, and atmosphere that competes with a wind-up ring
    has cost the player a shield. Their tints are swept for the reserved threat band like everything
    else the player sees — nearest is `ashen` at 54 degrees.
  - **⚠ A typing gap, not a preference**: the emit zone's `RandomZoneSource` is declared
    `(point: Vector2Like) => void` while `Phaser.Geom.Rectangle.getRandomPoint` is generic over
    `Vector2`, so the obvious `{ type: 'random', source: rect }` does not typecheck. Same class of
    `.d.ts` gap as `BaseSound`'s missing `mute`, worked around the same way — a local object that
    satisfies the declared contract exactly, which also lets a resize cost nothing.
- **⚠ The far-distance enemy frame was built, rebuilt and then removed entirely.** It shipped first
  as a two-tone silhouette (which deleted the red eye and painted the body near-black), was rebuilt
  as a faithful LANCZOS reduction that a contact sheet could not tell from the near art — and a
  player reported the change *again*. **A swap is an event even when the two frames match**: it
  lands on one frame while everything else on screen is continuous, and no amount of fidelity
  removes the event. Every kind is now drawn from one texture at every distance; what that costs is
  the renderer's own minification at range, and what it buys is that nothing changes appearance
  while the player is tracking it. See "Four Things A Player Reported".
- **Cost**, 1920x945, stroke every 40 frames on a live wave, all three layers measured against each
  other in one run:

  | configuration | median | p95 |
  |---|---|---|
  | all three on | 2.1ms | 4.1ms |
  | without trails | 2.0ms | 3.3ms |
  | without ground marks | 2.0ms | 3.6ms |
  | without motes | 2.0ms | 3.9ms |
  | none of the three | 2.0ms | 3.7ms |

  Against a 16ms budget, and the differences are at the harness's own noise floor — "none of the
  three" measures a higher p95 than "without trails", which is what noise looks like. Read the
  medians, not the ends.
- **Verified live** on `forest` (12 marks drawn of 12 wanted, 34 motes, three drifters drawn from
  `enemy-drifter-far` at 40–55px) and on `ridge` (7 marks, **57 flakes from the flake emitter and
  zero from the other three**, and a mixed frame of `enemy-swarmer` at 61px beside
  `enemy-lancer-far` at 22px — the swap band working in both directions). Zero errors in either.
  - **Harness note, new**: taking a screenshot makes Chrome paint, which fires rAF, which steps the
    real loop by however long the tab has been idle — so a frame set up in one tool call is *not*
    the frame the next call photographs. Pause the scene before screenshotting; a paused scene still
    renders.

## Coming Out From Behind A Crest

Reported as billboards popping out of a hill whole, with two suspected causes in the clipping.
`scripts/verify-sightline.mjs` was written to measure both, and neither is a defect: the clip
emerges crown-first and slides rather than steps.

**⚠ The real cause is below, and it is neither of them — the clip was measuring an object up to
3.51x smaller than the one being drawn.** The first round of this work missed it because its
harness reimplemented the sprite path without its scaling step, and everything below the next two
headings is what the numbers looked like in that world. They are kept because they are still true
of the clip itself.

### What was measured, and what it says

The check reimplements the mesh's own walk under Node — `RoadMesh` imports phaser, so nothing that
runs in a verify script can call it — and sweeps the camera across a `ROAD_HILL.HIGH` crest a
sixteenth of a segment at a time.

- **Crown first: already correct.** Over the sweep there are **601 frames where the prop's top is
  clear of the crest and its base is not, and it is drawn in every one of them**; the first frame it
  appears in shows **10% of its height**. `billboardVisibleFraction` measures from the top and
  `RoadSprites` crops `(0, 0, w, h * fraction)`, which keeps the top — a hill hides a billboard from
  the bottom up, and that is what the code does.
- **The crop slides, it does not step.** Worst **second** difference over the sweep is **6.9% of the
  prop's height**, against **97.1%** for the same samples quantised to one value per segment. The
  clip is recomputed every frame from the live camera position, so it moves continuously inside a
  segment; and crossing a segment boundary only drops the *nearest* segment out of a running
  minimum, which is never the minimum.
  - **⚠ The first version of that check measured the first difference and failed on correct code.**
    A prop 28 screen pixels tall with the horizon sliding a pixel every six world units legitimately
    moves 7% of its own height per twelve units. That is emergence, not a step. What separates a
    ramp from a staircase is the second difference — a straight ramp has none.
- **Height buys visibility.** A 96px prop clears the crest **1.0 segment before** a 24px one beside
  it, which is the property that would be absent if the clip were applied to the ground point rather
  than to the billboard.
- **`src/road/sightline.ts` is not in the render path at all.** It is a pure measurement of how long
  a target stays fightable, used only by `verify:road` to reject a bend that carries the fight off
  the side of the frame, and its own docstring says it **deliberately ignores hills**. Nothing it
  computes reaches a sprite.

### The number that names the defect

**The last emergence, from fully hidden to 95% clear, takes 175 world units — 0.05s at `SPEED_CAP`,
three frames at 60Hz.** A prop that far out is a few dozen pixels tall and the horizon sweeps its
whole height almost at once. Three frames of a geometrically correct crop still read as a pop when
the object arrives at full contrast. The mechanism was never the problem; the contrast was.

### Haze, and why alpha is allowed to be it here

`MAX_DECOR_FOG = 0.85`, separate from `MAX_BILLBOARD_FOG`, which stays at 0.12.

- **The two are split rather than one being a compromise.** `MAX_BILLBOARD_FOG` is what obstacles
  and pickups fade by and `verify:obstacles` measures what a hazard still has at the distance
  `REACTION_MS` is counted from. A prop that is hard to see is atmosphere; a rock that is hard to see
  is an unfair hit.
- **⚠ The standing objection — alpha is not haze — is right and still stands.** Alpha blends a prop
  toward *whatever is behind it* rather than toward the fog, which is why 0.30 was reported as "the
  textures are transparent" once the world got bright. What makes it haze at the far end is that at
  the far end those are the same colour. Measured across all seven themes: the ground's palette
  fades to **precisely `theme.fog`** in its last row — it is the colour the ramp ends on — and the
  sky's own horizon band sits **deltaE 0.04 to 0.18** from it. A distant prop at low alpha is
  therefore blended toward the fog colour by arithmetic, not by luck.
- Near props are untouched by construction: `billboardFog` is 0 at the camera and **shares
  `FOG_CURVE` with the ground**, so a prop is faded by roughly the fraction the ground behind it has
  already been faded by. That shared curve is load-bearing — give scenery its own and a tree
  visibly leads or lags the ground it stands on.
- This does not change the three frames and is not trying to. It changes what arrives in them.

### ⚠ The cause was the drawn size, and the first round of this looked in the wrong place

The clip was not wrong. **`variation.scale * tierScale` was applied inside `place`, after the clip,
the on-screen test and the crop had all been computed from the unscaled rectangle** — so all three
reasoned about an object up to `DECOR_TIERS.far.scale * VARIATION.scale.max` = **3.51x smaller**
than the one that got drawn. The origin is bottom-centre, so a prop grows *upward* from its base:
`billboardVisibleFraction` declared the little rectangle fully hidden while the real crown was most
of the way clear of the ridge, and the sprite then arrived at once.

Measured on a `ROAD_HILL.HIGH` crest, as *how much of the drawn sprite had already cleared when it
was first drawn at all*:

| tier | late by | already out when it appeared |
|---|---|---|
| mid ×1.00 | — | 1% |
| mid ×1.35 | 0.3 seg | 27% |
| near ×1.90 | 1.4 seg | 61% |
| far ×2.60 | 1.5 seg | 62% |
| far ×3.51 | 2.3 seg | **72%** |

The fix is one line of ordering: the two scales are folded into `rect.w`/`rect.h` in `render`,
before anything measures it, and `place` no longer scales at all. After: every tier appears at
**0.1–0.8%** of itself. `verify:sightline` keeps the pre-fix path as a negative control and asserts
it still produces the 72%, and that it fires where a scale-1 prop would — because the old decision
was taken on the unscaled rect, it fired at the *same* camera position whatever the prop's size,
which is the defect stated exactly.

**Why the first round missed it: the harness reimplemented the sprite path without its scaling
step.** Every number that round reported was true of a world where props are drawn at the size they
project to, which is not this one. A reimplementation is only evidence for the code it actually
mirrors, and the part it silently omitted was the part that was broken.

### ⚠ And the haze shipped as a flat maximum, which put the near field back through the floor

`MAX_DECOR_FOG = 0.85` alone is the transparency defect again. `billboardFog` is front-loaded
(`t ^ FOG_CURVE`, and 0.62 is the *ground's* number): it is already at **0.245 one tenth of the way
out**, so at a flat 0.85 a prop thirty segments away is a fifth transparent. Reported immediately,
and correctly, as everything having gone see-through — the same defect that took the billboard
constant from 0.30 to 0.12, at a higher setting.

`DECOR_FOG_GATE = 4` is what makes the large ceiling affordable: `decorFog = MAX_DECOR_FOG *
billboardFog ^ 4`. The ground's curve is **reshaped, not replaced** — a curve of its own would let
a tree lead or lag the ground it stands on, while a power of the same curve stays monotone in the
same direction with the same zero at the camera. Delivered alpha: **0.999** at a twentieth of the
draw distance, **0.973 / 0.848 / 0.584** across the middle, **0.150** at the far edge. The near
field is untouched to within a thousandth, and the haze is spent where the background genuinely is
the fog colour.

### Taking the acceptance on one seed

`RunScene.runSeed` is `Math.random()` per run, and stubbing `Math.random` around `scene.start`
breaks texture generation. What works is to rebuild the world in place on a chosen seed —
`world.destroy()`, `new WorldView(scene, { decorSeed })`, then **`world.layout(w, h)`**, without
which the backdrop keeps its constructor size and draws as a small rectangle in the corner.

### The acceptance, and how it had to be taken

One hill, one seed, before and after. **`RunScene.runSeed` is `Math.random()` per run, so two runs
are two different worlds** — the first attempt at a before/after produced two unrelated frames.
Stubbing `Math.random` around `scene.start` breaks texture generation. What works is to take both
frames from the *same* run: the distance index is recoverable from the sprite's own depth
(`RoadSprites` sets it to `-n`), so the old alpha can be recomputed exactly over the live frame,
photographed, and put back. The two frames drift by one metre, because taking a screenshot forces a
paint and a paint runs a frame.

## The Ground May Not Wear The Colour Of The Air

**The rule: blue and turquoise belong to the sky. A biome's ground may not sit in that hue band,
whatever it is called.** Measured against `day`'s horizon at hue 199, `wetland` sat at **170 degrees
and 55% saturation** and `fungal` at **171 and 55%** — saturated turquoise fields competing with the
air above them — with `crystal` at 238 and 31%.

### ⚠ Stated as an absolute band, not as a distance from each theme's sky

The first version of this rule was a minimum gap from every theme's horizon, and it is both
unsatisfiable and the wrong question. The seven skies run from `ember`'s 40 through `verdant`'s 123
and `day`'s 199 to `dusk`'s 326: requiring 45 degrees from all of them leaves a few narrow windows
and forces two biomes onto the same hue. It also fights the rule the whole system rests on — **a
biome is a place and a theme is a light, and the two are orthogonal.** Under a blue moon the ground
goes blue *and so does everything else*; that is the light, not the ground borrowing from the air.

`GROUND_AIR_HUE_BAND` is **160–235 degrees**, absolute, with the same saturation floor the threat
reservation carries: `ruins` sits at 210 and `ridge` at 217, both inside the band and both **grey**
at 5% and 12%, where a hue angle is numerical noise. Delivered, on `day`:

| biome | hue | sat | |
|---|---|---|---|
| forest | 133 | 50% | clear |
| dunes | 40 | 37% | clear |
| wetland | 108 | 42% | clear (was 170 / 55%) |
| ridge | 217 | 12% | in band, exempt (grey) |
| ashen | 355 | 9% | clear |
| fungal | 292 | 17% | clear (was 171 / 55%) |
| crystal | 272 | 25% | clear (was 238 / 31%) |
| coast | 42 | 24% | clear |
| ruins | 210 | 5% | in band, exempt (grey) |

### ⚠ Repainted by hue at equal RELATIVE LUMINANCE, not at equal HSL lightness

A biome is recognised by its colour and separated from the road by its lightness, and those are two
different jobs — so the repaint moves hue and holds the rest. **Holding HSL's own lightness is not
the same thing and does not work**: a violet at L=29% is far darker than a teal at L=29%, and the
first pass put `fungal` under the ground-visibility floor on `night`. Solved against
`relativeLuminance` instead.

### ⚠ Two rounds were then spent on the fact that HSL saturation is not chroma

`FOG_SATURATION` was written as a *loss* in HSL, and the mid-distance ground came back as a
saturated ribbon across the frame — twice, once with a linear fall and once with a square root.
**The same `s` at a lightness of 0.6 is a far more colourful pixel than at 0.29**, so a fill whose
lightness is being lifted toward the sky gets louder even while its `s` falls.

`fogBlendFill` does the ground's fade in **OKLCh**: hue kept, lightness lerped, and **chroma scaled
directly**, so `FOG_SATURATION` is a statement about how colourful the pixel is rather than about a
coordinate that happens to be called saturation. `fogBlend` stays for anything with a silhouette,
where holding saturation is right and the lightness lift is small — and where it does not apply
anyway, because a billboard fades by alpha.

**The mode split is by what the surface is, and this is a correction to the previous round's rule.**
Holding saturation while lightness rises is correct for a *silhouette* — a distant conifer that
keeps its green reads as a green tree far away. It is wrong for a **solid fill**: the ground is one
unbroken expanse from the verge to the horizon, and a fill that keeps its colour while getting
lighter does not recede, it comes out as a coloured pancake pasted against the sky.

### The surface dissolves into the sky rather than ending on one row

`GROUND_HORIZON_BLEND = 0.25`, cubed. The ground used to end at `theme.fog` while the sky began at
`sky.bottom` — two different colours meeting on one row, which reads as an artefact whatever they
are. Over the last quarter of the ramp the surface blends the rest of the way, and **the last row
is exactly the sky**, asserted per biome per theme.

- The **ease is cubed and not for looks**: a linear ramp holds the surface part-way into the sky for
  several rows, and on `dusk` — whose horizon is a pink already close to the reserved band — those
  middle rows landed inside it.
- The dissolve is in **OKLab**: an sRGB lerp from a sandy ground to a pink horizon detours through a
  saturated red, which put `dunes` and `coast` one row inside the reservation.
- `GROUND_FOG_TOWARD_SKY = 0.7`: the ground's fade **target** is mostly the sky rather than the fog
  colour, because the ground is what runs to the horizon and meets the air there. Fading to the fog
  alone left `dusk`'s verge eleven points of lightness *darker* than the air one row short of the
  horizon — receding into something darker than what it recedes against.

### ⚠ A check was sweeping a blend the renderer had stopped performing

The threat reservation is swept over every fog blend of every ground colour, and that sweep was
written against `blendColor` — an sRGB lerp — while the bake had moved to an HSL fade, then an OKLCh
one, with a saturation term and an OKLab dissolve. It went on rejecting a colour that no longer
reaches the screen and passing ones that do.

`paletteColour.ts`'s `surfaceColour` is now the one place the chain lives, and both the renderer and
every check call it. **A reservation swept over the wrong arithmetic is not a reservation.**

### What is still loud, stated rather than hidden

`crystal` at 25% and `wetland` at 42% are multiplied by `PALETTE_SATURATION.ground = 1.5`, and the
back-loaded `FOG_CURVE` means a biome a hundred segments ahead is at **fog row 0** — no fade at all.
So a distant biome's ground arrives at full strength, and on a crest it fills a lot of frame. That
is the trade the previous round asked for (colour in the near and middle field) meeting this one's
(no field competing with the sky), and where the two disagree is the authored saturation of each
biome. `fungal` needed three passes down — 49% to 30% to 17% — before it stopped reading as a
ribbon.

## The Middle Distance Was Pale, And The Fog Was Why

Colour only — no geometry, no outlines, no silhouettes touched.

### ⚠ An RGB lerp toward the fog does not fade a colour, it desaturates it

`fogBlend` in `road/color.ts`, replacing `blendColor` in the palette bake.

Interpolating a saturated green toward a pale blue-grey drags it through the **desaturated middle
of the RGB cube**: half-fogged, a tree has lost most of its *chroma* as well as its contrast, and it
stops being a green tree at a distance and becomes a grey one. Aerial perspective does not do that
— a distant hillside is lighter and cooler and still a colour.

So the blend is done in HSL: **hue is kept, lightness lerps to the fog's, and saturation is held and
allowed to rise slightly** (`FOG_SATURATION_GAIN = 0.22`), which is what compensates for the
contrast the lightness lift takes away. A grey stays grey — raising the saturation of something with
no hue invents one.

What this concedes, stated rather than hidden: a fully fogged object is no longer exactly the fog
colour, it is the fog's lightness in the object's own hue. That is the point — it is what stops the
far field collapsing into one flat band — and the horizon still reads as haze, because lightness is
what haze actually takes away.

### ⚠ `FOG_CURVE` was front-loaded, and that is what washed the middle of the frame

**0.62 → 3.0.** The old value was chosen on a texture-economy argument: perspective compresses the
far half of `DRAW_DISTANCE` into a few pixels, so a linear ramp spends most of its rows where nobody
can see them. True about the rows, and the wrong thing to optimise. Measured, it is the whole
defect:

| distance | ground was blended toward fog | now |
|---|---|---|
| 10% of draw distance | 23% | **0%** |
| 25% | 43% | **0%** |
| 50% | 66% | **9%** |
| 75% | 83% | 45% |
| 100% | 100% | 100% |

At half the draw distance the ground used to be **two thirds of the way to the fog colour**. That is
the pale middle ground, and everything standing on it inherited the wash. `verify:road`'s assertion
here was inverted — it asserted the ramp *must* be front-loaded — and it is now the opposite claim
with the reason on it.

### One ceiling for all scenery made a far tree and a mid tree the same

`DECOR_FOG_BY_TIER`: **near 0.15, mid 0.45, far 0.85.** The `far` tier exists to be *air* — huge
silhouettes beyond the corridor whose job is to sit in the haze — and wants most of the ramp. `mid`
is the verge, the props the player actually looks at, and fading those by the same 0.85 is what made
a conifer forty segments out paler than the identical conifer at ten. Delivered alpha:

| distance | mid tier | far tier |
|---|---|---|
| 50% | 0.973 | 0.949 |
| 75% | 0.860 | 0.735 |
| 100% | 0.550 | 0.150 |

`DECOR_FOG_GATE` came down 4 → 1.35 in the same pass: the gate existed to hold a large ceiling off
the near field *because the curve was front-loaded*, and the curve does that job in the right place
now. Two exponents would have pushed the whole fade into the last few segments and left the far tier
as crisp as the near one — the opposite failure.

**`MAX_BILLBOARD_FOG` is deliberately not in that table.** It is a combat constant, what obstacles
and pickups fade by, and `verify:obstacles` measures what a hazard still has at the distance
`REACTION_MS` is counted from.

### ⚠ `FOG_STEPS` came down, and the reason is the opposite of the one that raised it

**48 → 12.** It went up from 16 because sixteen steps of an *RGB lerp toward near-white* were sixteen
visible bands. What replaced that lerp moves lightness only, so a step is a change in lightness
alone — and at 48 the difference between adjacent rows is **below what the eye separates**. Near,
middle and far ground all read as one surface with a gradient over it, which is the flattening this
whole round is about. A readable depth cue is a quantised one.

The floor is unchanged and still checked: every row must be reachable, or part of the texture is
dead weight. All twelve are.

### Saturation, by family

`PALETTE_SATURATION` — **road 1.18, rumble 1.32, ground 1.5**, applied in HSL at bake time so hue and
lightness are untouched. Three numbers rather than one because the three surfaces are adjacent in
the frame and were authored to separate: pushing all of them equally makes the picture more colourful
without making it more readable. The verge takes the most (it is what the biome *is*), the road the
least (it is what obstacles are read against, and a saturated road competes with them), the stripe a
middle share so it merges with neither neighbour.

`verify:road` re-runs the threat sweep and the rumble-contrast floor over the boosted colours,
because a saturation lift is exactly the kind of change that walks a colour into the reserved band
or flattens an edge that was reading on chroma. 109 checks, all green.

### ⚠ The sky was never a flat fill, and the plate is why it looked like one

Layer 0's gradient has always run `sky.top` → `sky.bottom`. What was drawn was the theme's authored
**plate**, which overrides it. Two things have changed since the plates were picked: the haze bands
they were chosen for are a cloud layer of their own now, and they were authored against the old
muted palette — so they are the one surface in the frame a saturation pass **cannot reach**, being
pixels rather than colours.

`SKY_PLATE_PREFERRED = false` puts layer 0 back on the generated gradient, with `SKY_TOP_SATURATION
= 1.35` lifting the top stop only. The horizon end is left alone: it is where the ground's fog is
heading, and lifting both would put colour exactly where the fade is trying to take it away. The
plates are still shipped and still loaded — the constant is the one edit that restores them.

## A Dark Patch On The Ground Means Something Is Above It

**The rule, and it is the whole of this section: a soft dark patch on the ground means an object is
hanging over that spot, and nothing else. Surface texture is carried by the colour of the surface,
never by something laid over it.** Anything else is indistinguishable from a shadow, and a height
cue that can be confused with dirt is not a height cue.

### The diagnosis came first, and it changed what got fixed

Reported as stray dark spots on the road. That has two causes with opposite fixes — decals, which
would be turned off; or shadows of objects that have already despawned, which is a pool desync that
turning decals off would not touch at all — and **no screenshot can tell them apart**, because both
are soft dark patches lying on the road.

`src/run/DebugMarks.ts` (DEV only) labels every patch with the renderer that emitted it, in the
same frame: yellow `decal:<kind>`, cyan `shadow of <objectId>`, red `ORPHAN` for a shadow whose
owner is not in the live list. The orphan test is done in `RunScene`, because only the scene knows
what is alive.

Measured on a live frame: **43 decals, 13 shadows, 0 orphans.** So the patches were decals, no pool
was out of step, and the shadow work of the previous round was sound. The two dark streaks either
side of the snail — the ones that read as a misplaced shadow — were labelled `decal:tuft`.

The overlay is a static import inside an `import.meta.env.DEV` branch, which is the shape
`perfReport.ts` established: gating the *call* leaves the module in the bundle. Verified on the
built output — zero occurrences of `DebugMarks` or `__marks` in `dist/`.

**⚠ And it is off unless asked for, which it was not the first time.** It shipped drawing on
every DEV frame, and a diagnostic that rings and labels every mark in the picture is impossible
to look past — it was reported the moment it was seen. `window.__marks.on()` / `.off()` /
`.isOn()`, the same hook shape `__adGate` and `__getRecentErrors` use, with the name registered
in `check-bundle.mjs`'s forbidden-globals list so that "we gated it" and "it is gone" stay
separate claims. Switching it off clears the labels once rather than leaving the last frame's
on screen.

### What was switched off, and what replaced it

- **`DECAL_DENSITY` is 0.** Ownerless marks are gone from the ground — not only from the asphalt.
  The rule above is about the ground, and leaving them on the verge would have kept exactly the
  ambiguity the rule exists to remove.
- **Kept as a knob at 0, not deleted**, the same line `GROUND_ALTERNATION` is on. The placer is
  correct and is what a future *object-owned* mark would be built on — a scuff at the foot of a
  boulder, a scrape where the snail landed. That needs the placer to take an owner, not a different
  density.
- **⚠ The checks that exercise the placer take the density as an argument now.** With the shipped
  value at 0 they would all have collapsed into "nothing is placed", which guards none of the
  machinery. `verify:road` runs them at the density the placer was tuned at and separately asserts
  the shipped constant is 0 and that a lap carries nothing: **0 marks shipped, 756 when exercised.**

### The road surface got the treatment the verge already had

Switching the marks off would have left the asphalt as **two colours alternating on the rumble
beat**, which is a rhythm rather than a texture — and the same argument that removed the decals
says the fix has to be the colour of the surface itself.

- `ROAD_SHADES_PER_THEME = 5`, spread by **`GROUND_SHADE_SPREAD`, the same table the verge uses**,
  so the two surfaces are worn by the same amount and read as one world. No separation push, unlike
  `groundShadesForTheme`: this *is* the road and there is nothing for it to clear, so the spread is
  centred on the theme's pair rather than anchored to one end.
- The palette is now **55 columns**: five road colours, nine biomes at five ground shades, five
  asphalt shades. `roadPaletteIndex` and `createRoadPalette` compute the block offsets from the same
  three constants.
- **⚠ The chroma half of the spread is asked only of a road that has a hue to vary.** A chroma
  offset scales `a` and `b`, so on a grey it has no direction to point in and correctly does
  nothing — `signal` is an almost monochrome theme by design and its asphalt sits at chroma 0.
  Requiring a chroma spread there would be requiring the road to stop being grey. The lightness
  half is asked of every theme, and it is what carries the texture.
- **The rumble stripe now has to clear all five shades, not the authored two**, and does: every
  theme stays above the 1.6:1 the road's edge needs.
- **⚠ `roadShadeFor` reads the noise half a patch out of step with `groundShadeFor`.** Sampling at
  the same coordinate would change both surfaces at every patch boundary — one band across the
  whole width of the frame, which is a stripe with extra steps. Measured over 4000 segments:
  **50 shared boundaries against 55 by chance**, i.e. independent, against **470** if they share a
  coordinate. The check asserts independence rather than zero, because offsetting the sample makes
  the two independent and does not forbid coincidence — asserting zero was simply wrong about what
  the mechanism does, and it failed on correct code.

## Shadows Are A Height Gauge, And Clouds Are Their Own Layer

### The shadows

`src/run/shadows.ts` (pure, `npm run verify:jump`), used by `PlayerView`, `PickupSprites` and
`ObstacleSprites`.

- **⚠ The report was "the spots lie away from their objects", and most of those spots were not
  shadows at all.** Only the snail had one. What is scattered across the road and the verge is
  `decals.ts` — stains, puddles, scatter, dozens of them since the field widened — and a soft dark
  patch on the ground is indistinguishable from a shadow at a glance. **So shape is now reserved:
  a shadow is a hard-edged ellipse and a decal is a soft irregular patch**, and the two are told
  apart before position ever comes into it.
- **Two pickups had no shadow because nothing gave them one**, not because a pool drifted out of
  step. There was no shadow pool. There still is not: the shadow is a **field of the sprite's own
  slot**, so whatever hides the sprite hides its shadow and whatever places one places the other.
  Two pools filled in the same order on every frame is the desync that was suspected, and making it
  unrepresentable is cheaper than checking for it.
- Cast by **everything with `y > 0`**: the snail through its jump, every pickup (they float at
  `PICKUP_HEIGHT`), and `overhead` obstacles. `low` and `blocking` sit on the road and get none — a
  shadow under something already touching the ground is a dark rim nobody can read.
- **Projected, never drawn as a screen-space circle.** Each one goes through `billboardRectInto`
  with the same segment `s1` its owner used, the same `offsetX`, and height zero. So it rides the
  road through a bend and over a crest because it is the road's own arithmetic that placed it.
- **⚠ The colour is a MULTIPLY blend, not a grey fill.** A neutral ellipse on pale sand reads as a
  puddle — a thing lying there rather than an absence of light. Multiplying takes the ground's own
  colour down, so the shadow is sand on sand and flagstone on flagstone with nothing branching on
  the biome, the theme, the fog step or which of the five ground shades that segment carries. The
  compositor does it against the pixels actually on screen, which is stricter than recomputing the
  palette column and cannot drift from it.
- **⚠ Size and alpha now move in OPPOSITE directions, which reverses a documented decision.** The
  old rule shrank the ellipse and held its alpha, because the version before *that* shrank and faded
  together — the two multiplied and the apex shadow was 41px wide at alpha 0.18, i.e. gone at the
  one moment its whole job is to report height. Spreading while fading is the physically right
  answer and is only safe because the terms now pull against each other. Measured on the shipped
  constants: **ground scale 1.00 at alpha 0.420, apex scale 1.75 at alpha 0.160**, total ink
  (`scale² × alpha`) **0.42 → 0.49**. `verify:jump` asserts the apex keeps at least 80% of the
  ground's ink and is shown to reject shrink-and-fade, which scores **0.02**.
- **⚠ `WORLD_LAYER.shadow` moved 0.35 → 0.15.** It sat above `obstacle` while the only shadow
  belonged to the player and the only thing it had to be under was the player. A shadow is a mark
  on the ground: anything standing on that ground at the same distance has to paint over it, or a
  boulder gets a dark ellipse across its foot. Delivered live at 1920x889: shadow width **94 / 114 /
  147** and alpha **0.189 / 0.156 / 0.102** at heights 0 / 120 / 320.

### The clouds

`CLOUD_LAYER` in `road/constants.ts`, `ensureCloudTexture` and `layoutClouds` in `Backdrop.ts`.

- **⚠ Clouds cannot be baked into a sky plate, and that is measured rather than assumed.** A sky
  layer tiles horizontally at 1:1 while being stretched to the full viewport vertically — about 3x
  on a 945px frame against a 320px plate. Horizontal haze bands survive that; round lobes come out
  as spires, which is exactly why `day_v5` was re-picked. A plate may carry horizontal structure
  and nothing else.
- So the band is the **fifth `TileSprite`**, on the mountain range's pattern, at depth
  `SKY_DEPTH + 2.5` — after every haze band and **before the skyline at `+3`, so a ridge occludes a
  cloud.**
- **`tileScaleX` and `tileScaleY` are one number and the band's height comes from the TEXTURE's**,
  which is the whole difference from a sky layer. Verified at the three heights the acceptance
  names: scale **0.2889 / 0.8531 / 1.3000** at 320 / 945 / 1440, identical in both axes, so the
  aspect (7.11) is held exactly and only the size on the frame changes.
- **Parallax is half the range's** (`driftPixels` 0.0006 against 0.0012), because a cloud is further
  away than a ridge, and it is stated in **screen pixels per world unit of drift** — the unit
  `SKYLINE_LAYER` had to be restated in after a bare factor sent the mountains running.
  Curvature only, no camera-height term. Worst bend: **15.6px a second**.
- **Procedural, zero bytes, per theme.** Overlapping soft radial lobes with the colour lifted off
  `theme.sky.bottom` rather than painted white, so a night sky gets dark cloud with nothing
  branching on it. Regenerated and torn down on the same beat as the sun and the vignette.
- **⚠ Every lobe is drawn three times** — at `x`, `x - width` and `x + width` — because the strip
  tiles, and a cloud running off one edge has to arrive at the other or a seam sweeps the sky.
- **⚠ And every lobe is clamped inside the canvas, which the first version was not.** A radial
  gradient reaching the texture's top edge is *cut* there rather than faded, and the tile then drew
  that cut as a hard horizontal rule across the whole frame with pale sky below it and blue above.
  It was visible in the first screenshot taken.
- **No cloud shadows on the ground**, deliberately: they would be more soft dark patches, which is
  the class of mark this round has just finished separating a real shadow from.

## The Ground Has Fibre

`GROUND_SHADES_PER_BIOME`, `GROUND_SHADE_SPREAD`, `groundShadesForTheme` and `groundShadeFor` in
`src/road/biomes.ts`; `PALETTE_COLUMNS`/`groundPaletteIndex` in `road/constants.ts`; the widened
field in `road/decals.ts`. **The largest surface in the frame was one flat colour**, and it had
been since biomes existed — the authored light/dark pair collapses because `GROUND_ALTERNATION` is
0, so a biome was, mechanically, one number.

### Five columns per biome, not two

- **The palette is `PALETTE_COLUMNS x FOG_STEPS` = 50 x 48.** Five road colours, then
  `BIOMES.length * GROUND_SHADES_PER_BIOME` = 9 x 5 ground columns. **The multiplier is the named
  constant in both places that use it** — `PALETTE_COLUMNS` and `createRoadPalette`'s own
  `column - road.length` arithmetic — because a bare `2` left in one of them is a palette whose
  columns no longer mean what the mesh thinks they mean, and nothing about the resulting picture
  says which half is wrong.
- **This is still the only mechanism available.** `Mesh2D` has one object-wide tint, no per-vertex
  tint and no second UV set, so a per-segment ground colour has to be a column. Five costs a wider
  1px-per-texel texture and **nothing else**: no draw call, no pass, no shader.
- **⚠ The five shades move lightness and chroma INDEPENDENTLY, and that is the whole reason
  `GROUND_SHADE_SPREAD` is a table rather than a ramp.** A set spread along one axis collapses
  under the eye's own ordering — five brightnesses is a gradient, five saturations is a gradient.
  Shade 1 is darker *and* duller, shade 3 lighter *and* richer, shade 4 lighter *and* duller: no
  monotone relation between the columns, so no ordering to flatten. Hue is untouched, because five
  hues is five materials and this is one material worn unevenly. Delivered across the 63
  biome/theme pairs, the tightest spread is **0.0971 of OKLab lightness** (`dusk`/`fungal`) and
  **0.0169 of chroma** (`ember`/`ruins`); `verify:road` holds both floors separately and is shown
  to reject a lightness-only table.
- **⚠ The lightness spread is anchored at the pair and runs *away* from the road, never centred on
  it.** Centred is the obvious reading and it walks the far end across the asphalt's own
  brightness: the first version delivered `day`/`forest` at **1.00:1**, the exact arrangement
  `MIN_GROUND_CONTRAST` forbids, on the default theme. Anchoring costs nothing — same range, and
  the anchor shade is the pair itself, already cleared.
- **⚠ And the chroma half moves luminance too, which is enough to matter at the boundary.**
  `groundPairForTheme` pushes to *exactly* the floor and stops, so a biome sitting on it has no
  headroom: `ice`/`crystal` came back at **1.59:1** against 1.60. `clearOfRoad` nudges only the
  shade that falls short, in the set's own direction, so it ends up further from its neighbours
  rather than collapsed onto them. Worst delivered today: **1.60:1** (`day`/`coast`).

### The column a segment picks

- **A noise octave along the track, never the rumble alternation and never a bare hash.** The
  stripes are a rhythm and have to stay one — a regular beat across the ground is the moiré
  `GROUND_ALTERNATION` was switched off over. A per-segment hash is the opposite failure and just
  as wrong: at this projection a one-segment patch is a horizontal band across the verge. **It was
  built that way first and photographed, and the ripple is exactly what the frame showed.**
- `GROUND_PATCH_SEGMENTS` is 14 — the noise's lattice spacing, not a hard run length.
  **The figure it was tuned on is the sliver share, not the mean**: patches run a median of 6 and
  a mean of 8.6 segments, and only **2.1% of the ground sits in a patch shorter than three**. At a
  spacing of 10 that figure is 8.3%, and those one- and two-segment patches *are* the ripple.
- **⚠ An explicit weights table was tried and removed.** Mapping the noise through a cumulative
  `[1,3,4,3,1]` looked like it stated the intent and did not deliver it: value noise interpolated
  between two uniform draws is already concentrated toward the middle, so the two distributions
  compound and shade 0 came out at **1827 of 40000 segments against the 3333 the table claimed**.
  The single octave does the weighting on its own — delivered coverage is **16/24/24/21/14 percent**
  — and `verify:road` asserts the middle three outweigh the two ends, so a uniform replacement
  turning the ground into five equal materials would be caught.
- Deterministic from the index alone, hash-backed rather than an RNG stream, for the reason
  `decorVariation` gives: the same patch on the next lap, at every viewport, in any pool slot.

### The marks reach across the verge

- **`DECAL_MAX_OFFSET` was 2.2 — the road plus the lip of the verge — and from there out to
  `GROUND_EXTENT` the ground carried nothing at all.** That is what "flat" actually was: not a
  missing texture, a marked strip a tenth as wide as the surface it sits on. Now **13**, with
  `GROUND_EXTENT` raised 40 → **56** so nothing is drawn on sky, and that relationship is asserted
  rather than left in a comment — the second time that comment has gone stale.
- **`DECAL_OFFSET_BIAS` = 2.1, for the reason `DECOR.OFFSET_BIAS` exists**: a uniform draw across
  a field six times wider is a field six times emptier where it is looked at. Measured over a lap,
  **44% of marks still land inside the old 2.2 band and 32% past 6 half-widths.**
- `DECAL_DENSITY` rose 0.17 → **0.52** in the same pass and had to: the density is a chance per
  *segment*, so widening the field alone would have emptied the road to fill the verge. 756 marks
  over a 1434-segment lap, **peak demand 58 against a pool of 96**.
- **Seven kinds, and the split is the point.** The original four are *surface* marks — a stain, a
  crack, a skid, some scatter — authored when a decal could not leave the asphalt. The field
  reaches across the verge now, so the vocabulary grew the three things ground has that road does
  not: `stones`, `tuft`, `puddle`. Still procedural, still **zero bytes**.
  - `stones` and `puddle` both draw their highlight with `destination-out` rather than adding one.
    The mesh multiplies, so everything drawn *removes* light and there is no way to put any back;
    taking alpha back out of the upper face is what makes a stone an object on the surface rather
    than a hole in it, and what separates a puddle from the `stain` already in the set.
- **A puddle in the dunes is the same failure a palm tree on a glacier is**, and it became possible
  the moment the field left the asphalt. `Biome.decals` names each stretch's set, in order of
  commonness, the same "listed twice appears twice as often" knob `Biome.props` uses.
  `verify:road` asserts nothing draws outside its biome's set **and** that every biome actually
  uses at least three of the marks it names over a lap — a list that never reaches the ground is a
  list nobody can tell is wrong.

### Cost

Measured with `performance.now()` **around `DecalMesh.render` itself**, batched over 300 stepped
frames — never from a frame rate, because an unfocused tab has its rAF throttled and a hidden one
suspends it outright, so an fps figure taken under automation says nothing about what anything
cost. `WorldRenderCost` carries `decalMs` separately from `decorMs` for the same reason: the two
are sized by different things, and a change to one is invisible inside a total that is mostly the
other.

| | per frame | peak marks drawn |
|---|---|---|
| before (2.2-wide field, 4 kinds) | 0.0417ms | 22 of a pool of 32 |
| after (13-wide field, 7 kinds) | 0.0851ms | 44 of a pool of 96 |

Twice the cost of a number that was already a four-hundredth of a 16ms budget. The five palette
columns cost nothing measurable at all — they are a wider 1px-per-texel texture sampled by the
same UVs the mesh was already writing.

### What this did not fix

**The far verge is still flat colour, and the numbers say why rather than the eye.** Perspective
compresses distance, so a 14-segment patch covers most of the near ground and the along-track
variation lands where it is a few pixels tall; and `DECAL_OFFSET_BIAS` deliberately crowds the
marks into the band the player reads, which leaves the ground out towards `GROUND_EXTENT` carrying
almost nothing. What steps 1-3 bought is a road and a near verge that read as ground; the outer
field is unchanged in kind.

## The Economy: A Cap That Knows Which Track You Are On

`coinCapFor` + `levelContentValue` in `src/game/levels.ts`, `SCORE_PER_COIN` and `coinsForRun` in
`src/rail/run.ts`, `REWARDED_TOPUP_COINS` in `src/shop/coins.ts` (all pure,
`npm run verify:levels` and `npm run verify:run`). **No save migration and no price change**: what
moved is the rate and where the ceiling comes from.

- **⚠ One constant could not be right for two levels that differ by 3.3x in what they field, and it
  was wrong at both ends.** Measured on the shipped tables at the old `MAX_COINS_PER_RUN = 250` and
  `SCORE_PER_COIN = 200`: a **perfect** run on the first level — every enemy killed inside a
  full eight-mark stroke with both charge pickups collected — scored 40,920 and paid **204**, so the
  first level could not reach the cap however well it was flown and the ceiling never applied there
  at all. The last level's same run scored 136,920 and was cut from 684 to 250, throwing away two
  thirds of the payout for finishing the hardest content in the game.
- **So the cap is a property of the track.** `levelContentValue` is every wave enemy the level
  fields plus its boss, at base rate, derived from `buildWaves` with that level's own seed and
  difficulty — the same derivation the third star's own ceiling uses, which is why the two cannot
  drift apart. The cap is what an **honest** run on that content pays.
  - **"Honest" is `HONEST_MARKS = 4`, and the choice is the whole of the tuning.** A four-mark
    stroke multiplies each kill by 1.86; the game's ceiling — eight marks with the charge bonus
    maxed — multiplies by 4. Pricing the cap at the honest figure means a player who kills what the
    level fields, sweeping properly but not perfectly, is paid in full, and going beyond that pays
    in *score and stars* instead. Pricing it at the perfect figure would make money the reward for
    style and leave a competent run underpaid; pricing it at one mark would pay the same for tapping
    targets one at a time, which is the play the multiplier exists to argue against.
  - Shipped caps: forest **317**, coast 423, dunes 508, wetland 532, ridge 697, ruins 731, fungal
    847, ashen 943, crystal **1060**. The check asserts each is reachable by an honest run *and*
    that a perfect one is worth more than 1.5x it (so it is still a cap) *and* that single-mark play
    stays under three quarters of it (so it is not reachable by tapping).
  - **The endless run takes the highest of the eight** rather than one of its own: its waves wrap
    forever, so a ceiling derived from "what it fields" is not a ceiling. Paying the tour more than
    the hardest level would make the campaign a detour; paying it less would make the mode a
    punishment for finishing the campaign.
- **`MAX_COINS_PER_RUN` is deleted rather than left beside the new function**, and that is
  deliberate: a constant left in place keeps working at every call site that cannot see the level,
  and each of those is a site that silently pays the wrong game's rate. Same rule, and the same
  reason, as `LOADOUT_SIZE`. `createRun` takes the cap as a **required** argument for the same
  reason — the compiler asks every caller which track this run is on.
- **`RunState` carries the cap, so the screen and the till cannot disagree.** `coinsForRun(run)`
  takes the whole run rather than a score and a cap: the result screen and the save both ask this
  question, and a screen that says `+666 coins` while the till takes 317 is the kind of
  disagreement nobody files a bug about and everybody notices.
- **The result line says when the cap bit** (`resultCoinsMax`, `+N coins (max)`). A payout that
  silently ignores half of a visibly good run reads as the game having dropped something — the same
  argument the boss's crossed-out zone and the telegraph's tracer are built on.
- **`SCORE_PER_COIN` is 60, set against the catalogue rather than by feel.** Everything the shop
  sells comes to **41,050 coins**; at 200 a point that was **203 capped runs** to own it all, which
  is several hours of perfect play for a game whose runs are two to four minutes. At 60 the same
  catalogue is **61 capped runs**, and everything that is not an upgrade step — all seven weapons,
  four hulls, six themes and the fourth slot — is **32**. `verify:levels` recomputes both from the
  real catalogues and the real wave tables and fails outside a 40–90 band, so a re-priced shop or a
  re-tuned wave list cannot quietly move the horizon by a factor of three again.
  - The 21 upgrade steps are 48% of the catalogue by design, which is what makes them the long tail
    rather than the wall: the check asserts they are at least 40% of the total.
  - **No price moved.** Raising the rate leaves every argument the prices were authored with intact
    — a step costs a share of the gun it improves, a slot costs more than the dearest weapon,
    `totalWeaponSpend` still orders the dominance cases — while re-pricing forty items would have
    re-opened all of them.
- **The rewarded ad had to move with the cap.** It paid 50 against a ceiling of 250 — a fifth of a
  good run, which was the right ratio — and the same 50 against the new caps would be a fiftieth:
  an ad nobody would trade thirty seconds for. `REWARDED_TOPUP_COINS` is **150**, and it moved out
  of `Shop.ts` into the pure `shop/coins.ts` so a check can see it: it is asserted to stay between
  15% and 30% of the average cap (currently 22%).
- **Nothing in the save changed.** Coins already banked keep their value, prices are untouched, and
  the schema stays at v10 — the only thing a returning player sees is that runs pay better.
- **Verified live** on the running game: a 12,000-point forest run paid `+200 coins`; a 40,000-point
  one on the same level paid `+317 coins (max)` and the save banked exactly 317; the identical
  40,000 on `crystal` paid **666** uncapped, which is the whole point of the change in one pair of
  numbers. The endless run built with a cap of 1060, and the shop's rewarded button reads
  `+150 coins`. Zero errors.

## Four Things A Player Reported

All four were shipped by earlier chunks of this project and each was visible in a screenshot. What
they have in common is worth stating: **each was a mechanism that satisfied its own argument and
failed the eye.**

### The far frame turned enemies into black blobs

- **The frame that shipped was a two-tone silhouette**, and flattening the art to a body colour and
  a rim deleted the red eye — the strongest identifying mark any of these have, which
  `build-sprites.py`'s own `ENEMY_LIFT` comment says in as many words — while the body it left
  behind was the *median* colour of a sprite that is mostly shadow, i.e. near black. On screen a
  machine turned into a dark shape at range and popped back into a machine up close.
- **It is now the same picture, filtered properly**: a LANCZOS reduction to 64px, the alpha
  re-thresholded so the contour survives the resample, a light sharpen to put back what the
  reduction softened, then the pipeline's own quantise, alpha floor and closing flood. That is
  strictly better than the renderer's own minification — which is the entire reason to precompute a
  frame — and it is *indistinguishable from the near art at the size it is drawn*, which is what
  makes the swap invisible.
- **The acceptance is a contact sheet, not a number.** Near art and far frame, both at 44px, on mid
  grey: the first version's bottom row was eleven dark blobs beside eleven machines, which is how
  the defect was confirmed in thirty seconds after being reported. The rule this leaves: **a "simplified"
  asset has to be judged against the thing it replaces at the size it replaces it, on a background
  that hides neither end.**
- **⚠ `verify:mattes` failed the build on the new frames** — the soft alpha ramp left a handful of
  pixels at one or two of 255, which is alpha with no meaning and exactly what the floor exists to
  remove. Fixed by running the pipeline's own `floor_alpha` before the closing flood, which is the
  ordering that file already documents. The check earned its place again.
- Cost: 46KB for eleven frames, against 3.5KB for the two-tone version. A tenth of a percent of the
  working ceiling for the difference between "the same enemy" and "a different object".

### The lane edge drew as stripes

- **It was ten `fillRect`s standing in for a gradient**, and the docstring argued the case: a
  vertical band has no corners, so the stack that failed for the vignette should be safe here. **That
  argument is about the wrong half of the vignette's lesson.** The vignette failed for two reasons —
  its corners *and* its steps — and only the corners are peculiar to a rectangle stack. The steps are
  peculiar to *quantising a gradient*, which this did too.
- **And it is worst exactly where the game is played.** The band is half a hull wide, the hull is
  sized off frame *height*, so on a portrait phone the band is at its widest relative to the frame:
  ten bands across sixty pixels is a step every six pixels down the whole side of the screen.
- **Measured, both ways, on the running game.** A one-pixel horizontal scan across the band, with
  the glow at full strength: the old stack shows **eight repeating jumps of up to 15 luminance
  units, spaced 5.5px**; the gradient texture shows **steps of 0–2 units and no repetition at all**,
  with the only real edge being the intended one at the lane's own boundary. Same measurement, same
  frame, one line of code apart.
- The fix is the vignette's: a generated `createLinearGradient` texture, stretched across the band
  as two tinted images. **A fix that makes the step smaller has not fixed anything** — it has moved
  the symptom to where nobody is measuring, which is the third time this project has written that
  sentence down.

### The player's own death was not drawn at all

`src/rail/playerDeath.ts` (pure, `npm run verify:effects`) and `Effects.onPlayerDeath`.

- **The shot that took the last shield called `finishRun` on the same frame.** The result panel
  appeared over a ship that was still flying, still banking, still trailing its plume. Every enemy
  in the game comes apart when it dies — freeze, swell, fade, debris, the splitter's own visible
  parting — and the one death the player actually cares about was the only one the game did not
  draw.
- **The run now waits for the wreck.** `PLAYER_DEATH_MS` (1000) is the window; the hull bursts over
  the first `HULL_BURST_MS` (260) by swelling and fading, which is the same shape `Enemies.place`
  gives a dying enemy — the player's craft dying the way everything else dies is the point, not a
  separate idiom. The plume and the shadow go on the first frame: a wreck with its engine still
  running reads as a graphics fault.
- **Built from the pieces every other death already uses, turned up rather than replaced**: twice
  the debris of an enemy kill, the shockwave ring the widest volley throws, the damage frame the run
  has been flashing all along, and the hardest shake in the game. The ring is drawn in
  `DAMAGE_COLOR` rather than the player's own cyan — this is the threat landing, and it is the one
  moment it lands on the player for good.
- **A second shot inside the window neither restarts the wreck nor ends the run twice.** Two
  enemies firing together is ordinary, and `finishRun` writes the save and offers the rewarded
  continue, so a death that could start twice is a run that ends twice. `startPlayerDeath` reports
  whether it was the call that started it, which is what the scene branches on.
- **⚠ `startedAt` is `-1` for a living player, not `0`**, and the check that caught it starts its
  clock at zero: a scene's first frame can report `now === 0` — this project's own stepping harness
  does exactly that — and a `0` sentinel makes "died on the first frame" indistinguishable from
  "alive", so the wreck would never play and the run would never end. Same value and the same reason
  as `FxSprites.lastLaunchCheck`.
- **⚠ And gating the ship's own update on `isDying` was not enough.** The moment the wreck's window
  closed, `Ship.update` took the hull back — it re-shows and re-positions the object every frame —
  so the wreck was followed by a craft flying itself around underneath the result panel. It gates on
  `hasDied` instead: a dead ship never flies again in this run. Found by reading the hull's
  `visible` flag after the wreck rather than by looking, which is the one thing a screenshot of a
  transparent object cannot tell you.
- **Verified live**: one shield left, a shot aimed at the hull, and the frames come back
  `1/-/wave` → `0/dying/wave` with the hull fading 1.00 → 0.36 while the run stays in its wave
  phase; eighty frames later the phase is `results`, the hull, plume and shadow are all hidden, and
  the panel is up. Zero errors.

### Five props shipped with a painted backdrop

Reported as "textures with an uncut white or dirty background". Confirmed in one contact sheet: a
**framed panel behind `for_pine`**, a **sun disc and clouds behind `dune_spire`**, a **pale slab
behind `rui_column` and `for_birch`**, and a **decorative border of pale strands around
`for_fern`**.

- **`strip_plate` could not have caught any of them, and that is not a bug in it.** It floods from
  the *frame edge* across *near-white neutral* pixels, which is exactly right for the leftover
  render plate it was written for. What these are is a backdrop the generator drew **inside the
  subject's own outline** — bounded by the same black line work the prop is drawn with, touching no
  border, and in two cases not neutral at all (a yellow sun, a green panel).
- **⚠ Two detectors were written for the new case and both measured the drawing.** A border flood
  with a colour tolerance found the **black outline the whole art style is drawn with** — it scored
  `for_birch` at 44%, and `for_birch` had no plate at that point. A largest-flat-region measure
  found **`rid_monolith` at 48%**, which is a stone slab and is *supposed* to be flat, while
  `for_pine` — the prop in the player's screenshot — did not make the top fourteen.
  - **That is the third and fourth time a check in this project has tripped over the art it was
    pointed at**, after the matte round's three wrong detectors. The conclusion is stronger than
    "measure carefully": **a painted backdrop and a legitimately flat prop are the same pixels**, so
    there is nothing to measure. It is found by rendering the set over magenta and looking, and
    fixed by naming the file — which is the standing rule this project already had, now with the
    cost of ignoring it written down twice.
- **Three were re-picks**, the cheapest fix and the one the project already uses: `for_fern` v1 → v2
  (v1 is drawn inside a decorative border), `rui_column` v2 → v1 (v1 stands on rubble with a clean
  matte), `for_birch` v2 → v1 (v2 has a rock drawn in behind the branches, and the biome already
  ships `for_boulder`; the 50% desaturation every prop gets is what keeps v1's autumn orange from
  fighting the forest's green).
- **One is stripped at build time.** `PLATE_SEEDS` names points known to be inside the backdrop and
  the fill grows from them, each step staying within a tolerance of **the pixel it came from rather
  than of the seed** — which follows a painted gradient and stops dead at the line work around it. A
  seed-relative tolerance either stops half way up the sky or has to be opened until it crosses the
  outline. Tuned by looking: at 24 the panel goes and the pine is untouched (37,580 px removed at
  full resolution); at 34 the growth leaks through a pale highlight and eats the tree.
  - Run **before the downscale**, like every other matte operation here, so the edge it leaves is
    built from real transparency rather than cut out of blended pixels.
- **One is pulled.** `dune_spire` has no usable variant — v1 is a whole scene with waterfalls, v2 a
  spire standing in front of a painted sun — and the disc cannot be flooded away: the only tolerance
  that removes it also leaks through the clouds into the spire's own highlights, so what comes back
  is a half-eaten rock. Same call `ash_mound` got, with its key keeping the procedural silhouette
  and `biomes.ts` no longer placing it. **The dunes ship five props**, the way `crystal` and `coast`
  do after their own rejections. Re-render before putting it back.
- **Verified live**: `forest` draws all six of its props with nothing behind any of them, `dunes`
  draws its five, zero errors. The acceptance artefact is the same contact sheet the defect was
  found on — 48 props over magenta, before and after.

## The Second Player Round: Fauna, Trees, And Two Removals

Four reports in one message, and the two that were *repeats* are the interesting ones — both had
already been "fixed" once, and both fixes had solved the wrong half of the problem.

### The far frame is gone, not fixed again

- Reported once as "enemies are dark blobs at range", fixed by rebuilding the frame as a faithful
  reduction, and reported again as "far then suddenly the real graphics". The second report is the
  one that matters: the frames matched in a contact sheet and the *swap* was still visible. **A swap
  lands on one frame while everything else in the picture is continuous**, so it reads as an event
  whatever it swaps to.
- So there is no second frame. One texture per kind at every distance, `*_far.png` deleted from the
  build, the loader and the pool. What it costs is the renderer's own minification at range; what it
  buys is that nothing changes appearance while the player is tracking it. **A feature whose whole
  value was invisible fidelity is a feature that can only ever be noticed when it fails.**

### The lane edge is a glow, not a column

- Also a repeat: ten hard rectangles became a smooth gradient and the player still called it stripes.
  The steps were gone and the **shape** was wrong — a cyan column down the full height of the frame
  at a third opacity reads as interface, not as a warning about where the craft is.
- It is now a bell in both axes at 0.14 alpha, centred on the ship's own row: brightest at the lane's
  edge beside the hull, gone before the top and bottom of the frame, and gone entirely the moment the
  player leaves the wall. Same argument as the ship's shadow living on the ship's own row.
- The falloff is a generated 64x64 texture, not a stack of anything. Measured across the band with
  the glow at full strength: the old rectangle stack showed **eight repeating jumps of up to 15
  luminance units 5.5px apart**; the gradient shows **0–2 and no repetition**.

### Five props had a backdrop, and three needed a new render

Covered in "Four Things A Player Reported" for the detection; what this round added is the repair.

- **The prompt could not fix them and that was measured, not assumed.** The text2img brief already
  carried `one single isolated object floating on a plain flat grey background, nothing else, no
  ground beneath` and negated `landscape, sky, ground, background scenery, border, frame` — both in
  force for every render that came back with a panel, a sun disc or a slab. The failing subjects are
  exactly the ones whose noun **is** a landscape feature: a pine, a birch, a rock spire.
- **An init has no backdrop, so there is nothing to remove.** `rail_prop_roughs.py` draws the three
  as procedural cel-shaded roughs and `gen_prop_repair.py` renders them img2img at strength 0.82.
  Twelve renders, twelve clean subjects on grey — no panel, no sun, no ground oval.
  - `for_pine` v6 of four clean seeds; `dune_spire` v7 of four; `for_birch` v8, where v6 came back
    with a grey blob at the base and v7 with a baked oval cast shadow.
  - **`dune_spire`'s own prompt module had already been rewritten for this exact failure** — "v1 was
    a cliff and waterfall scene, v2 a spire in front of a painted SUN DISC; `pinnacle` is a landscape
    word and the picture it names has a sky in it" — and never re-rendered. The fix was written down
    a round early and sat there.
  - It comes back at **35:100 rather than 94:170**, the proportion its brief calls "the thinnest slot
    in the set". The old art was nearly twice as wide, which is part of why it read as scenery.
- `PLATE_SEEDS` is kept and empty: the seeded flood was a stopgap for `for_pine` and the slot no
  longer needs it, but the failure it answers belongs to the *generator*, so the next landscape noun
  that comes back with a scene behind it is one line rather than a rewrite.

### Every biome has fauna of its own

`src/rail/enemySkins.ts` (pure, `npm run verify:enemies`), and 99 sprites — every one of the eleven
behaviour kinds in every one of the nine biomes — from
`Remotion/src/scripts/{rail_biome_skins_prompts,rail_skin_roughs,gen_biome_skins}.py`.

- **A skin changes what a kind is made of and nothing else.** The game has eleven behaviour kinds and
  every balance table, tier pool, star target and check is keyed on them; `forest`'s drifter is an
  armoured beetle, `ridge`'s is a lump of frost, and both fly the same, take the same shots and are
  worth the same points. Nothing downstream of the draw learns that skins exist — which is the only
  reason a round of this size was affordable at all.
- **All eleven kinds, in two rounds.** The first dressed the four every level fields
  (`drifter`/`weaver` at tier 1, `charger`/`turret` at tier 2) on the argument that a tier-4 kind is
  art most runs never reach. That is true of any one run and **false of the game**: the last four
  levels field the whole roster, so a player who got there was meeting nine dressed enemies and two
  machines standing next to them. The second round covers `swarmer`, `lancer`, `hexer`, `jammer`,
  `splitter`, `warden` and `bulwark`.
  - **One rough per kind with a family branch, not twenty-one hand-written ones.** For these seven
    the silhouette *is* the identity — a ring with a hole, a needle, a mast with a dish, two lobes
    on a waist, a wide slab, a broad mass, a small pod — and it may not move; what changes between
    families is the treatment (limbs and segments, straight facets, a ragged edge lit from inside).
    Keeping that in one function per shape is what stops the shape drifting three ways.
  - **⚠ The `hexer` needed a second flood and nothing else did.** Its whole identity is a hole, and
    `key_cutout` floods from the frame edge — so background *enclosed by the subject* is unreachable
    and survives as an opaque plate. The first probe came back with a white slab where the hole is;
    seeded from the centre of the canvas it comes back open. The machinery already existed
    (`key_cutout_holed`, written for this exact kind a round earlier) and simply had to be used.
- **The height is the kind's and only the width moves.** The sky-clearance bands and the altitude
  spread are built on the height, so a skin keeps it exactly; its width is its own art's aspect times
  that height, the identical rule the base table already follows. `verify:enemies` holds every entry
  inside 30% of its kind's width, because a "weaver" at a charger's proportion would teach the wrong
  thing about what is about to happen.
- **⚠ The first batch came back as the same grey robots, and it cost eight renders to see why.** The
  prompts were creature prompts ("armoured beetle, broad domed shell, folded wing cases") driving the
  *shipped kinds' own roughs* — armoured hulls with a glowing eye — at the family's measured strength
  of 0.7. Nothing about the prompt was wrong. **The shape wins over the words**, for the third time in
  this project: the round-3 boss came back a horned knight because its rough had shoulders and legs,
  `fun_squat` came back a mascot because a wide cap on a short stalk is a mascot's proportion, and a
  beetle prompt over a robot init returns a robot.
- **And the second batch came back as the roughs themselves**, traced: refIoU 0.95–0.99 at strength
  0.7, which is the *other* documented failure — a flat-ish init has no structure to amplify and 0.7
  leaves no schedule to invent any. The pair of failures brackets the answer exactly: **a rough that
  is already the right body plan, driven at 0.85**, which is the number the second boss needed for
  the same reason. At 0.85 the forest set came back as a horned beetle, a moth, a dragonfly, a
  banded hornet and a hive mouth, with refIoU 0.82–0.93.
- Three families (`creature`, `mineral`, `elemental`) rather than nine, because the *shape* of what
  is in the air has three answers, not nine — what separates two biomes inside a family is the tint,
  the material and the noun. Same argument the decor makes for one texture under nine biome tints.
- **The head is replaced, not qualified.** `ENEMY_REF_HEAD` ends with "one menacing enemy war
  machine"; adding "insect" to that asks for a robot that looks like a bug, which is what the player
  already had. Each family names one thing and nothing names a robot.
- **⚠ The width rule took three attempts, and the middle one is the instructive failure.** A
  symmetric 30% allowance failed `charger_ridge` (50%), `charger_ashen` (38%) and `charger_crystal`
  (32%) — all three icicles and shards, i.e. exactly what a charger should be in a mineral biome,
  and all three *more* tall-and-narrow than the machine they replace rather than less. Replacing it
  with a **shape class** (`tall` / `compact` / `wide`, cut at aspect 0.8 and 1.3) then failed ten
  `bulwark` and `splitter` slots — and not because those skins were wrong: those two kinds sit at
  aspects **1.217** and **1.276** against a boundary at 1.3, so any skin at all lands on whichever
  side of the cut its own art falls. **The check was measuring the boundary, not the art.**
  - What ships is `SKIN_WIDTH_BAND`, and it is deliberately **asymmetric** — 60% narrower allowed,
    40% wider. The two directions are not the same risk: a narrower skin still reads as its kind
    (an icicle charger is a charger), while a wider one starts occupying the proportion of the kind
    next to it, which is what the rule exists to prevent. Delivered range across the 99: **-52% to
    +28%**, i.e. the band binds on neither end by accident.
- **The picks are made by eye off a contact sheet over the render grey**, informed by the metrics
  and not decided by them — `ruins`' drifter v7 came back a skull with a face, `fungal`'s weaver v7
  grew legs and a head, `ashen`'s swarmer needed the variant that reads as burning rather than as a
  dark pebble, and one otherwise-good flier was rejected for standing on painted ground. No number
  in any sidecar says any of that. Five numeric gates in this project have now flagged the art style
  and none has ever found a wrong subject.
- **294 renders across the two rounds, 99 shipped, 1.65MB.** The second round is quantised harder
  than the rest of the art (`SKIN_COLORS = 32` against `COLORS = 64`): 99 files of flat cel bands
  are the one place in this project where the palette is the whole cost, and it is **-19% bytes**
  with no visible change at the size they are drawn.
  - **⚠ It went in because the bundle reached 5.96MB against a 6MB ceiling that lived only in
    prose** — 99.3% of a number nothing could enforce. The ceiling is now
    `WORKING_CEILING_BYTES` in `check-bundle.mjs` and fails the build, and it moves once, with a
    reason: **8MB**, still half `PLAYABLES-SDK.md`'s own 15MB target. Currently **5.61MB**. A
    comment cannot fail a build, which this project already knew about `GROUND_EXTENT` and
    `DECOR_POOL_SIZE` and had not applied to its own budget.
- **⚠ Measured limitation: colour does not separate the organic biomes, and the drawing has to.**
  Mean opaque colour in OKLab over all 396 cross-biome pairs within a kind has a median distance of
  **0.168**, but `forest`/`fungal`, `dunes`/`wetland`, `coast`/`dunes` and `crystal`/`ruins` all sit
  **under 0.01** — three amber-organic biomes and a pale-mineral trio. Inside a family that is the
  design (the mineral three are one material with three accents, exactly as the decor is one texture
  under nine tints); across `forest` and `fungal` it is a prompt that asked twice for the same
  palette. Recorded rather than repainted: the silhouettes do differ, and re-rendering two biomes to
  move a hue is a Modal round for something the tint could carry.
- **Verified live**: all **99** skin textures load with none broken; four levels stepped through
  their waves drew **12 distinct kind_biome pairs** and never a key from another biome
  (`forest` amber beetles, `ridge` icicles and frost, `ashen` cinders, `fungal` spore pods);
  zero errors in any of the four runs. The fallback path is still what an unskinned kind or a biome
  with no table entry takes — now exercised by neither, so `verify:enemies` sweeps every
  (biome, kind) pair and prints how many are on base art rather than asserting against one.

### Three more pickups, a depth term, and something to fly into

Three reports in one message, and the two mechanical ones share a shape: **a hit test that was
right about the screen and had never been asked about the world.**

- **⚠ Pickups were collected from a median of 11 segments out and as far as 44 — 8.8km, a second
  and a half before the ship got there.** Reported as picking things up by moving the finger rather
  than by flying through them, and it was exactly that. `reachesPickup` tested the ship's screen box
  against the pickup's, and the ship's box is large (110x122px on a 1920x945 frame), so a pickup
  drawn small and high up was taken the moment its projected position happened to fall inside it.
  Every term in the test was correct; the missing one was depth.
  - `PICKUP_REACH_Z` is the fix: a pickup may be taken only while it is passing the row the ship
    rests on (`SHIP_LANE_Z`, derived from that row rather than picked), and the screen test then
    decides whether the ship was *there*. Re-measured with the ship held in each pickup's column:
    **28 collected, every one of them between 11.2 and 11.8 segments**, against 6.3–44 before.
  - **The test is swept, not sampled.** `Pickup.aheadZ` carries last frame's distance so
    `withinReach` asks whether the pickup crossed the band *at any point* during the frame's
    travel — the camera covers 100 world units in a 60Hz frame and more under a boost, so a band
    tested at instants is a band a slow frame steps over. `verify:pickups` walks it at 50, 100,
    200, 400, 800 and 1600 units a frame, and shows the unswept version missing the same crossing.
- **Seven pickups instead of four**, and the three new ones say a number on the player's own
  machine out loud: `power` (x1.6 damage), `rapid` (x0.6 on the wait between strokes) and `guard`
  (a shield *above* the hull's own maximum). The four that existed move heat, the multiplier, the
  world and a lost pip; these move what a shot is worth, how often a stroke may be thrown, and how
  many hits are left.
  - **A rapid is deliberately not free.** Heat is charged per mark, so firing 1.67x as often heats
    1.67x as fast, and the vent stays the thing that keeps a hot gun going. Asserted, because a
    rate buff that dodged the heat model would quietly replace the pickup the loop is built on.
  - **`power` scales the weapon's damage rather than adding to it**, so it is worth the same on a
    heavy gun as on a light one — a flat `+1` would make `flechette`'s 0.2 a sixth weapon and
    `mortar`'s 3.2 a rounding error. It reaches the **boss** too: a damage buff the boss ignored is
    the dead step the weapon upgrades already shipped once.
  - **`guard` is not `repair`, and the difference is the point.** Repair puts back a pip the run
    has lost and is worth nothing at full health; a guard is worth something precisely *because*
    you are full. It stacks to `MAX_BONUS_SHIELDS` (2) above the hull's maximum, is spent before
    the real ones, and is drawn as a hollow pip in its own colour so a borrowed life cannot be
    mistaken for a permanent one.
  - **Both timed buffs extend rather than stack**, exactly as the boost does: two multipliers at
    once is a number nothing in the frame could explain, and the badge would have to say x2.56 for
    a pickup whose whole promise is x1.6.
  - **The boost's two chevrons became a row of badges.** A bespoke readout was right when the boost
    was the only timed pickup and is a trap at three — a third effect with no readout is an effect
    the player cannot tell from a bug, which is the argument the chevrons were added on. Each badge
    is the pickup's **own glyph**, filled from its polygons rather than its texture (a readout that
    could not draw because a scene had not generated its art yet would fail on exactly the first
    frame), with a bar under it drawn full-width in the dark so the missing part is visible too.
  - Seven shapes still pass the 24px confusion test — worst pair `charge`/`repair` at 0.48, which
    is the pair that already existed — with aspects spread 0.50 / 0.61 / 0.73 / 0.85 / 1.00 / 1.45
    / 2.00. **And the colours are now checked against each other as well as against the threat**,
    which nothing had asked: closest chromatic pair `vent`/`guard` at 31 degrees. `rapid` is the
    set's only near-neutral (chroma 0.02) and that is what makes seven fit — a colour with no
    chroma has no hue to collide with, the same escape the threat rule's own chroma term grants.
- **Flying into an enemy costs a shield, and the enemy.** Until now the only thing in the world
  that could touch the player was a *shot*.
  - **⚠ The screen-space version was built, measured and thrown away.** Every other hit in this
    game resolves against the rectangles the sprites were drawn at, so a collision test against the
    same rectangles looked like the consistent choice. It fires **never**: every flying kind is laid
    out inside `ENEMY_BAND` and the ship's *top edge* is clamped at `ENEMY_BAND_BOTTOM`, so the two
    boxes meet at a line and cannot overlap. Measured on a real run with the ship deliberately
    steered at the nearest target for 60 seconds: **zero collisions, closest approach 232px.**
    `verify:enemies` now asserts the two constants are the same line, so nobody rebuilds it.
  - So it resolves **in the world, by depth and by lane** (`src/rail/ram.ts`). The band the fliers
    are drawn in is a *reading* convention — it exists so targets are legible against the sky — not
    a claim about an altitude the player can dodge in; the ship is a screen-space object by design
    and has no world height at all. What both do have is a position along the rail and a lateral
    offset in road half-widths. `halfWidthsAtLane` converts the hull's column into those units, on
    the one row it is exact on, which is the row the ship rests on.
  - **A band rather than the pickups' swept crossing, and the difference is which way the mistake
    falls.** A pickup missed by a slow frame is a reward the player earned and did not get; a
    collision missed by a slow frame is a shield they keep. `takeHit`'s own window already makes a
    band several frames wide impossible to charge twice — measured at 5.6 frames at the boosted top
    speed, 8.0 at the base one.
  - **The player pays through the same door a shot's damage goes through.** `takeHit` is now the
    one place a hit is subtracted and `onPlayerDamaged` the one place the frame reacts to it, so a
    ram cannot end up with its own invulnerability window, its own ordering against a guard, or its
    own idea of when the wreck starts. Two copies of that block is how the reset list and the
    restore list in `MainMenu` came to disagree.
  - **The enemy dies and scores at the base rate.** Not scoring it would read as the game dropping
    a kill the player watched happen; scoring it with the volley multiplier would make ramming an
    alternative to the verb the game is built on. A **shielded warden survives** while still taking
    the player's shield — a collision that broke the shield would make flying into one the cheapest
    way through the one defence in the game that has a timing answer. The boss is not in the list at
    all: its interaction is its zone, and a second damage source on an object that fills half the
    frame is a wall whose edge nobody can see.
  - **Rate, measured rather than assumed**, on a ship that never fires so every enemy survives to
    reach it: **1 collision a minute on `forest` and 3 on `crystal`**, against 11 and 15 shot hits
    in the same window. `RAM_TIGHTNESS` leaves a window of 0.21 half-widths (`lancer`) to 0.50
    (`warden`) against a wave spread of 1.70.
- **Verified live**: all seven kinds laid down and collected on a `forest` lap with the charge bonus
  reaching its cap; the three timed badges drawn together with their bars; two borrowed pips beside
  three real ones; a drifter dropped into the ship's lane taking a shield and dying in the same
  frame for 100 points at x1; and a full run to results with zero errors.

### Seven Pickups Nobody Could Read

**⚠ Much of the two sections above describes a set of seven. There are five.** Reported by a player
as "too many different icons, no idea what we are picking up or what for", and both halves of that
sentence turned out to be a separate defect.

- **The confusion test measures difference, and difference is not meaning.** `verify:pickups`
  rasterises every shape at 24px and holds the worst pair under 0.6 of a shared silhouette; all
  seven passed, and the set was *selected* against that number — a solid arrow was rejected for
  sharing 66% with the diamond, a solid diamond for sharing 62% with the cross. So the selection
  pressure was always "not like your neighbour" and never once "looks like what you do". Of the
  seven, exactly one — the bolt — had a shape that named its own effect.
  - **This is the same lesson as the five asset gates that only ever flagged the art style**, read
    from the other end: there, a metric found nothing real; here, a metric passed everything and
    the thing it was standing in for was never measured at all. A check cannot be evidence for a
    property it does not test, however carefully it tests the one it does.
- **Two of the seven were a second answer to a question already answered.** `guard` and `repair`
  both handed over a shield; `power` and `rapid` both made the gun put out more per second. Two
  marks for one idea is a set to memorise rather than read, and each of the two pairs was *dead
  exactly where its partner paid* — a repair at full health was worth nothing, a guard below it was
  the strictly better product.
  - `shield` fills before it over-fills: a real pip back if any are missing, capped at what the
    level started with so collecting cannot undo the difficulty ramp's two-shield levels, and only
    then a bonus one up to `MAX_BONUS_SHIELDS`. Both old caps survive untouched, and it is now worth
    nothing only when the player is carrying every shield the run can hold.
  - `overdrive` runs both old buffs off **one deadline**, which is the point rather than a tidy-up:
    a player watching one badge must not have damage and rate expiring at two different moments.
- **⚠ Merged at the old coefficients it would have been a phase change, not a pickup.** x1.6 damage
  and x1.667 rate compose to **x2.67** of the player's output. The shipped pair (x1.35, x0.78) is
  **x1.73** — above the better of the two it replaces, which it has to be or the merge is a nerf
  wearing a simplification's clothes, and `verify:pickups` asserts both ends of that band.
  - The rate half still heats the gun in exact proportion (x1.28 strokes a second, x1.28 heat), so
    the vent stays the thing that keeps a hot gun going.
- **Each of the five now wears the readout it fills.** A gauge with its level down is the heat bar,
  an `X` is the multiplier, a shield is a shield pip, chevrons are speed. **`overdrive` is the one
  exception and it is an informative one**: there is no HUD element meaning "your gun is doing
  more", which is precisely why that pair needed badges of their own when it shipped — so its own
  symbol is all there is to point at, and it keeps the bolt.
  - **⚠ This reverses a decision `guard` was authored under**, which said a pickup must not wear
    the mark of the readout it fills or it "would say this is a shield twice and this is a pickup
    not at all". A player who cannot tell a pickup from a pickup has a smaller problem than one who
    cannot tell what any of them do.
  - The shield keeps its outline rather than taking the kit's diamond, and for a reason the rule
    does not cover: the diamond means "shield" only because this game's HUD says so, while a shield
    outline means it everywhere.
- **⚠ The bolt carried a detached bar to its right for as long as it existed, and it reads as a
  stray dash rather than as part of the symbol.** Left over from when the slot was `power` alone
  and the bar stood for a speed line. Every number in the suite was happy with it; it was found by
  rendering the set to a contact sheet on mid grey and looking, which is the standing rule and the
  fourth time in this project it has been the thing that worked. It is two bolts now — the pickup
  is itself two of the old ones — drawn from one parameterised helper so the pair cannot drift.
- **The label still arrives on collection and that is still the wrong moment**, since the decision
  the whole feature exists for is taken on the approach. Not fixed here: a word under the glyph in
  the world is a separate change, and five self-describing marks is the cheaper half of it.
- **Aspects 2.14 / 1.45 / 1.00 / 0.85 / 0.61**, worst silhouette pair `charge`/`shield` at **0.43**
  against the 0.6 ceiling, closest chromatic pair `vent`/`shield` at **31 degrees**. `PICKUP_KINDS`
  drives every check, the art and the badges, so the set shrank without any of them being told.
- Suites green: `verify:pickups` 24 -> 26 checks (the merge's own bound is new), typecheck clean,
  build unchanged at 5.62MB.
- **Verified live** on `forest` at **375x667** — a portrait phone, i.e. the smallest frame the
  glyphs have to survive. Pickups draw at **29/20/25/28/23px wide at 12 segments**, 19/13/16/18/15
  at 18, and 13/9/11/13/10 at 26; all five are separable at 12 and 18, and at 26 the gauge is the
  first to go to a smudge, which is the right one to lose since 26 segments is "notice it", not
  "identify it". The two timed badges draw together under the score with their own depleting bars.
  Zero errors over the whole session.
  - **The shield merge measured in the running game, in the order the merge exists for**: five
    collections from one shield lost took the run **1 -> 2 -> 3 real** (capped at the level's own
    starting count), then **bonus 1 -> 2**, then refused a sixth. The HUD draws it as three solid
    cyan pips and two hollow ones in the pickup's own colour, so a borrowed life is never mistaken
    for a permanent one.
  - **`PICKUP_REACH_Z` confirmed by accident**: the first attempt photographed rows at 8 and 5
    segments and both were collected mid-shot, because the band is `SHIP_LANE_Z` (9.8 segments)
    +/- 2. Anything closer than ~7.8 segments has already passed the ship, so **12 segments is the
    nearest a pickup can be photographed un-taken** — and the sizes above are therefore the whole
    range a player ever reads one at.

#### Three harness facts, for the next person photographing a frame

- **⚠ `renderer.snapshotArea`'s callback fires on the next *render*, so pausing the scene before
  requesting one is a deadlock.** No render, no callback, and the CDP evaluate times out after 45s
  looking exactly like a frozen renderer. Keep stepping `loop.step` until the callback lands, then
  pause. (The already-documented "check `data-out` after a timeout" rule is what proved it was a
  real hang rather than the usual false alarm: the attribute never landed.)
- **⚠ `ScorePops` labels outlive a pause and land straight across the row being photographed.**
  They run on the scene clock, which a pause/resume cycle does not advance, so a guessed number of
  settle frames does not clear them. Settle on `scorePops.activeCount === 0` instead.
- **The viewport could not be moved off 375x667.** `resize_window` reports success and
  `window.innerWidth` does not change. This is the mirror of the already-recorded "the harness could
  not hold a small viewport" — plan on being handed whatever size the tab already is, and pick the
  measurement that is still meaningful at it.

### On buying roadside props instead of generating them

Asked whether free, publicly usable assets could supply the scenery. Surveyed, argued against, and
then **the argument was tested and came back half wrong** — so what follows is the measurement
rather than the reasoning it replaced. Artefacts and the renderer are in `dev-assets/cc0-3d/`.

- **The catalogue is real and the licences are fine.** [Kenney](https://kenney.nl) is CC0 with no
  attribution at all; [OpenGameArt](https://opengameart.org) is mixed per file (CC0, CC-BY and the
  viral CC-BY-SA sit side by side, so every file needs checking individually);
  [game-icons.net](https://game-icons.net) is CC-BY 3.0 over several thousand monochrome SVGs;
  itch.io has a large CC0 tag. Nothing here is a legal problem for a Playables submission provided
  CC-BY earns a visible credit line.
- **Bought 2D is still declined, and that half held up.** The 2D nature that exists is pixel art or
  top-down tilesets; Kenney's own Nature Kit is 3D and its 2D foliage is a VFX sprite set. A picture
  arrives with a style already in it, and this one's has to survive a 50% desaturate, a biome x
  theme multiply tint, `verify:mattes` and being read at 24-44px.
- **Bought *models*, rendered here, was the route left open — and it works.** A model has no style
  until something renders it, so if the render is ours the prop arrives in this game's language.
  Tested end to end: `kenney_nature-kit.zip` (10.5MB, CC0, 329 models), six of them through a
  software rasteriser written for the job (orthographic, z-buffered, three cel bands, silhouette
  plus facet-break ink — no Blender on this machine and none needed), then through the project's own
  `process()` from `build-sprites.py` **unmodified**, then swapped into `forest` for three of its six
  props and photographed at a fixed `cameraZ` against the originals.

#### What the experiment actually found

- **⚠ The tell was tone, not line style, and that is why the original argument was wrong.** Measured
  over opaque pixels, the first renders came back **1.29x as bright, 2.66x as saturated and carrying
  0.38x the ink** of the game's own forest props (own: luminance 80, saturation 13%, 32% of the shape
  dark enough to read as ink). That is what made them jump forward off the verge. The cause is
  specific and fixable: a low-poly kit ships vivid flat `Kd` values, while the pipeline's 50%
  desaturate is calibrated for diffusion art that is *already* muted. Pre-desaturating `Kd`, dropping
  the value, widening the ink and loosening the facet-break threshold lands **0.86 / 1.07 / 0.85**,
  and at that point the pines are near indistinguishable from the game's own at read distance.
- **⚠ Ink weight has to be derived from the *delivered* size, not the render's.** It was set in
  supersample pixels and then survived two downscales (4x supersample, then 512 -> 176 in the build),
  so a 6px ring arrived as half a pixel and the prop shipped with no visible outline at all.
- **⚠ A pure-black outline hard against the alpha boundary fails `verify:mattes`, correctly.** The
  outermost opaque pixels were black (luminance 0.3-0.8 against 25-63 for the game's own), so the
  pipeline's closing flood copied black into the transparent border and every mipmap level would
  average it back into the silhouette. That is the exact defect the check exists for, and it caught
  it on the first run. Ink at `26,28,26` passes at 0.18-0.19 against the 0.1 floor.
- **What tuning cannot fix is the shape language.** A low-poly bramble is a faceted fan; the
  hand-drawn one is a web of thin branches. So the rule is by subject, not by source: **large simple
  forms — trees, rocks, stumps, mushrooms — come through; anything whose identity is fine structure
  does not.**
- **The three numbers are the acceptance.** Any future prop from this route is matched against the
  biome's own props on luminance, saturation and ink share before it is looked at, and then looked
  at, because the shape-language failure has no numeric signature — the same rule the biome contact
  sheets already run under.
- Nothing was committed: the three props were swapped in, photographed and restored, verified by
  md5. `dev-assets/cc0-3d/` keeps the renderer, the side-by-side and the three-way in-game A/B.

## Five Things A Player Can Name

Reported as one sentence: the pickups were not intuitive, the heat bar and the volley multiplier
were things that had to be explained, and the game wanted more tempo and less machinery. Three
systems were removed outright, one was replaced by force, and the pickup set was rebuilt on meaning.

**No mechanic here was made *deeper*. The whole round is subtraction**, and the acceptance for each
removal is that the thing it was doing is either still done somewhere the player can see, or was not
worth doing.

### Weapon heat is deleted

`src/rail/heat.ts` is gone, with the bar, the three colour steps, the two speeds of pulse, the
overheat lock and its shake and its arc.

- **What it was for, and why that was not enough.** Heat made the *pattern* of strokes matter: a
  stroke across eight targets cost eight times a single mark, so emptying the screen every time
  reached the lock. That is a real decision, and it is also a gauge to read, a lockout to plan
  around and a rule to be taught — in a game whose whole pitch is that the verb is one drag. The
  cost was measured every round it survived (`heat.ts`'s own docstring argued the case at length)
  and it was never paid by the player who picks the game up once.
- **What carries its job now: the weapon's own `cooldownMs`.** That column has been authored per
  weapon since the set shipped, it is drawn on the armed cell as a closing ring, and it was already
  what `verify:lockon`'s dominance test argued about. Re-measured after the removal: **the seven
  weapons spread 38% of the median over a minute of flat-out fire, against 77% with the bar.** The
  bar was not holding the set together; it was widening it.
- **The lock is not replaced.** A hard stop on firing was the one state in the game where the player
  could do nothing at all, and nothing about the removal put it back.
- **Two things moved with it, and neither could stay as it was.** `UpgradedWeapon.heatScale` is gone
  (see below), and `ShipStats.cooling` became `ShipStats.fireRate` — a factor on the armed weapon's
  cooldown, which is the same axis charged where the player can see it.
  - **⚠ `fireRate` counts backwards and one line had to be told.** 0.85 is a *quicker* gun, so the
    hangar's arrow and its bar length would both have advertised the Needle's own advantage as a
    downgrade. `higherIsBetter` is read by `statDeltas`, by `statFraction` and by `verify:ships`'
    dominance sweep, so the three cannot disagree about which way a stat points.
  - Re-simulated at the new stat: **19.1% between the best and worst hull** against a 20% bound
    (18.4% aggressive, 28.7% cautious), and the model still rejects a hull better on all four axes
    at 38.9% ahead of the field.

### The upgrade ladder is the same for every gun

`UPGRADE_PATH` is `['cooldown', 'power', 'shape']`, and `upgradePath(weapon)`/`heatBinds` are gone.

- The fork existed because heat was not a resource for a gun whose own cooldown already held it
  under the decay rate — a real problem, found by simulation, with a real fix. With heat gone there
  is nothing left to fork on.
- **The `shape` fork survives untouched**, because it is about the gun and not about the bar: a
  multi-shot weapon gains a projectile, a single-shot one hits harder.
- **⚠ The *order* is load-bearing, and the dominance check is what said so.** Selling `shape` second
  put `scatter`'s fourth projectile within reach for 1900 coins, which made `ripple` at 2000 a
  purchase nobody would ever make. Selling it last puts it behind the whole ladder's price, which is
  exactly what that check asks: a gun may out-perform the next one up only if the player paid more
  for it. Five dominations remain and every one of them is paid for.
- **`UPGRADE_DAMAGE_SCALE` fell 1.4 -> 1.3, and the check is what set it.** With `power` now sold to
  every gun, a single-shot weapon takes two damage steps — and at the old numbers a fully upgraded
  `lance` out-damaged a fresh `needle` costing twice as much. Fully upgraded guns land at **x1.73 to
  x2.06** of themselves, inside the x1.3..x2.5 band, and the set stays within 35-40% of its own
  median at every level.

### The multiplier is force, not a number

`x2.4` with a decay ring is gone from the HUD; `MULTIPLIER_DISPLAY_MS`, `multiplierTier`,
`multiplierRemaining` and `tierColor` are deleted.

- **The mechanic is completely untouched.** `run.ts` still pays 1..`MULTIPLIER_MAX` per volley and
  it is still the only reason to drag a stroke across several targets. What is gone is the readout:
  a figure with a decimal point and a ring counting its own life down has to be taught before it
  means anything, and until it is taught it is noise in the corner of the frame the player is trying
  to fly in.
- What replaced it is **`scoreEmphasis(multiplier)`** in `hudState.ts` — one curve, `0` for a single
  mark and `1` for a full stroke — read by both views so the two cannot drift apart: the score
  counter punches up to three times as hard, and the flying number arrives up to a quarter bigger.
- `verify:hud` asserts the curve is monotonic across every stroke width the game allows, clamps at
  both ends, and that half a stroke reads in the *middle* — the failure mode of replacing a number
  with an emphasis is a curve so flat it says nothing, and that is not visible from the code.

### The pickups are five things everyone already recognises

`heal`, `shield`, `weapon`, `boost`, `double`. `vent`, `charge` and `overdrive` are gone.

| | the mark | what it does |
|---|---|---|
| `heal` | a medkit | +1 real shield, capped at what the level started with |
| `shield` | a shield outline | +1 pip **above** the maximum, drawn hollow, capped at 2 |
| `weapon` | a muzzle and the shot leaving it | any of the seven guns, for 18s |
| `boost` | a double chevron | the rail runs faster for 6s |
| `double` | a star | every kill is worth twice as much for 12s |

- **This reverses the previous round's own merge, knowingly.** `guard` and `repair` were merged into
  one `shield` on the argument that each was dead exactly where the other paid. True — and what it
  produced is a pickup that does two different things depending on state, which is one more thing to
  know than "green cross heals you". Splitting them costs one icon and buys two products a player
  can predict from the picture. Both caps survive and neither rule changed.
- **The selection rule is what the mark *means*, and the confusion test is the floor rather than the
  criterion.** Every set this file has ever held passed that test, including the one reported as
  unreadable. Each shape is now something the player has seen outside this game. Measured anyway:
  worst pair `boost`/`double` at **0.39** of a shared silhouette (was 0.43), aspects
  2.00 / 1.35 / 1.00 / 0.85 / 0.61, closest colours **43 degrees** apart (was 31), and every one
  73-166 degrees from the reserved threat hue.
  - **⚠ A bare plus was the obvious drawing for `heal` and is the wrong one**: a plus is square and
    so is the star, so the two most centred marks in the set would have been competing on contour
    alone. The box around it carries the aspect away from square and is what the mark looks like
    everywhere else it appears.
- **`weapon` is the one that changes what a long run is.** The endless mode has no shop between
  waves, so a gun found on the ground is the only variety it has. It hands over **any** of the seven
  — owned or not — at the player's own upgrade level, so nothing they paid for is taken away for
  eighteen seconds. Which gun is derived from the pickup's own id, so a seeded lap deals the same
  guns twice.
  - **It takes the armed cell over rather than adding a sixth one.** Four cells already reach 54% of
    a 390px frame against a drag zone starting at 35%; a row that grew when a pickup was taken would
    push itself further into the stroke path at the moment the player is flying hardest. The cell
    wears the pickup's violet rim, its diamond and a closing ring for the loan.
  - **A deliberate tap on the row ends the loan.** The player asking for a specific gun and being
    handed the found one back a moment later is the game overruling an instruction, and the row is
    the one control in a fight that must always do what it says.
  - A **different** gun replaces rather than extending, which is the one place `pickups.ts` breaks
    its own extend-do-not-stack rule and has to: extending would leave the player holding a weapon
    they did not just pick up, and the icon under their thumb would disagree with the thing leaving
    the ship.
- **`double` scales the showcase score and deliberately not `ratedScore`**, exactly as the volley
  multiplier does not — a progression threshold a timed pickup can lift is a threshold one lucky lap
  clears. It reaches the boss too, because a score buff that stopped working during the one fight
  the player is trying hardest in is a pickup that reads as broken.
- **The doubler is *not* in the coin cap's "perfect run" figure.** It runs for twelve seconds of a
  two-minute run, so a ceiling that assumed one was up throughout would price the cap against a run
  nobody can fly.
- **⚠ The deck's clumping bound was asserted on one seed and was true of nothing else.** "The rarest
  kind never lands twice running" happened to hold for the seed that check uses; swept over 200
  laps, a reshuffle boundary produces runs of up to twice a kind's own weight. The assertion is now
  that structural bound, swept, with the measured worst per kind printed (`double` 2, `weapon` 5).

**Verified live** on `forest` at 1568x726: all five laid out side by side and each readable at the
distance it is met; `heal` a no-op at full health, restoring below it and capped at the level's own
three; `shield` 0 -> 1 -> 2 bonus pips then refused, drawn hollow beside three solid ones; a weapon
pickup arming `pulse` for 18s with the violet cell and its loan ring, handing `lance` back when the
loan ran out **and** the moment a row cell was tapped; a kill worth **100 plain and 200 under the
doubler**; three badges with depleting bars under the score; no multiplier readout and no heat bar
anywhere. Zero errors across the session.

**Suites**: 15 green. `verify:weapons` 33 -> 31 (four heat checks out, two ladder checks in),
`verify:pickups` 26 -> 24, `verify:hud` 12 -> 11, everything else unchanged. Build clean, bundle
**5.61MB** — unchanged, since nothing here is an asset.

## Out of Scope and Why

Deliberately not built, so they don't get "discovered missing" and re-litigated later:

- **Save compression/chunking** — `SaveState` (`{ v, bestScore, settings: { sound, music } }`) is a few
  hundred bytes serialized. `save.ts`'s 3 MiB size guard (see "Save Layer") exists for defense-in-depth,
  not because this project is anywhere near it; compressing or chunking a payload this small would add
  real complexity (a decode step on every load, a schema migration concern of its own) to defend against a
  risk that doesn't exist yet. Revisit if `SaveState` ever grows to hold real per-level/per-item data.
- **Telemetry/analytics** — Playables is an offline-only environment; its CSP blocks requests to external
  hosts, so a typical analytics SDK (or a custom event collector phoning home) literally cannot function
  here, not just "isn't needed yet." The only outbound signal is `health.ts`'s `logError()`/`logWarning()`
  pings to the platform's own health metrics (see "Health Monitoring").
- **`onLowMemory` handling** — not part of the `ytgame` SDK surface this project has integrated against
  (see PLAYABLES-SDK.md); there is nothing to hook up. Revisit if a future SDK version adds a memory-
  pressure callback and the game's asset footprint grows enough to make it relevant.

## Known Issues Fixed

Bugs and gotchas hit and fixed while building the platform/save/audio layers — recorded so they don't get
silently reintroduced or re-debugged from scratch. Full detail lives in the section noted; this is the
index.

App bugs:

- The upgrade ladder sold `shape` at step II, which put `scatter`'s fourth projectile within reach
  for 1900 coins and made `ripple` at 2000 unbuyable; and with `power` sold to every gun a fully
  upgraded `lance` out-damaged a fresh `needle` costing twice as much. Both caught by the same
  dominance check, both fixed in the table rather than in the check. — "Five Things A Player Can Name"
- `ShipStats.fireRate` counts backwards (a smaller number is a quicker gun), so the hangar's arrow
  and its bar length would have advertised the Needle's own advantage as a downgrade. — same section
- `verify:pickups`' clumping bound ("the rarest kind never lands twice running") was true of the
  one seed that check uses and of nothing else: swept over 200 laps a reshuffle boundary produces
  runs of up to twice a kind's own weight. — same section

- A pure-black outline sitting hard against the alpha boundary fails `verify:mattes`, and the check
  is right: the closing flood copies black into the transparent border and every mipmap level
  averages it back into the silhouette. The game's own props carry luminance 25-63 at their
  outermost opaque pixels; a hard black ring measures 0.3-0.8. Found while testing whether a bought
  CC0 model could be rendered into this game's style. — "On buying roadside props instead of
  generating them"
- The same experiment's first renders were **2.66x as saturated** as the props they stood beside, so
  they popped forward off the verge — the objection to bought scenery had been argued as a style
  problem and turned out to be a measurable tone problem, fixable in the renderer. — same section
- Pickup collection had no depth term: the ship's screen box is large, so a pickup drawn small and
  high up was taken the moment its projected position fell inside it — measured at a **median of 11
  segments early and as far as 44**. Reported by a player as picking things up with the finger
  rather than by flying through them. — "Three more pickups, a depth term, and something to fly
  into"
- The screen-space version of the collision test could not fire at all — the ship's ceiling and the
  flier band's floor are the same line, so the boxes meet and never overlap. Zero collisions in 60
  seconds of deliberately steering into targets. — same section
- The skin width check was asserted as a **shape class** cut at aspect 1.3, and `bulwark` (1.217) and
  `splitter` (1.276) sit against that boundary — so ten correct skins failed for landing on the wrong
  side of a line, i.e. the check was measuring its own threshold rather than the art. — "Every biome
  has fauna of its own"
- The 6MB bundle working ceiling lived only in CLAUDE.md and reached **5.96MB** with nothing able to
  fail on it. — same section (now `WORKING_CEILING_BYTES` in `check-bundle.mjs`, raised to 8MB with
  the reason written down)

- The far-distance enemy frame was reported twice and removed on the second report: even rebuilt as
  a reduction a contact sheet could not tell from the near art, the *swap* is an event, because it
  lands on one frame while everything else on screen is continuous. — "The Second Player Round"
- The lane-edge marker was reported twice as well: the ten-rectangle stack became a smooth gradient
  and was still a cyan column down the full height of the frame, which reads as interface. It is a
  bell in both axes around the ship now. — same section

- The far-distance enemy frame was a two-tone silhouette: it deleted the red eye that identifies
  every kind in the set and painted the body the median colour of a mostly-shadow sprite, so enemies
  turned into black blobs at range and popped back into machines up close. — "Three Things A Player
  Reported"
- The lane-edge marker was ten `fillRect`s standing in for a gradient and drew as ten stripes down
  the side of the frame — measured at eight repeating jumps of up to 15 luminance units, 5.5px
  apart, worst on the portrait phones where the band is widest. — same section
- The player's own death was never drawn: the shot that took the last shield ended the run on the
  same frame, so the result panel appeared over a ship that was still flying. — same section
- Five decor props shipped with a backdrop the generator drew *inside* the subject's outline — a
  framed panel behind the pine, a sun disc behind the spire, a slab behind the column and the birch,
  a border around the fern. `strip_plate` cannot reach any of them: it floods from the frame edge
  over near-white neutral pixels, and these touch no edge and two are not neutral. — same section

- The coin cap was one constant for every level: the first level's *perfect* run paid 204 against a
  cap of 250 it could never reach, while the last level's was cut from 684 to 250. And the rate put
  owning the shop 203 capped runs away. — "The Economy: A Cap That Knows Which Track You Are On"

- `Weapon.fanScale` was authored on all seven weapons and asserted positive by a check, and nothing
  read it: every volley in the game opened by exactly `VOLLEY_FAN_SPREAD`, so the column describing
  the shape of each gun's spread was decoration. The second whole authored column found doing
  nothing, after `cooldownMs`. — "The Weapon You Can Name From One Frame"
- The mortar's lob shipped at an `arc` that did not arch: lifting a Bézier control point *along* the
  flight line changes the pace and not the path when the target is straight ahead, which is where
  most targets are. — same section
- The mote pool was picked by hand at 48 against a table that asks for 62, i.e. the emitter would
  have silently dropped what the densest biome asked for. Caught by the check on its first run and
  fixed by deriving the pool from the table. — "Marks On The Ground, Air In The Frame"

- `LockOnView.setLockCap` clamped the lock ceiling to `MAX_LOCKS`, the *weapon's* number, so the
  Hive hull's four extra marks were computed, handed over and discarded — 700 coins for a hull
  that behaved like the free one. — "The Volley Steps Instead Of Scaling"

- `build-sprites.py` shipped every sprite with a median 5.6% of its canvas at `0 < alpha < 0.06` and
  with black under all of its transparency, so every downscale and every mipmap level mixed black
  into the silhouette. Real, and worth **0.1—0.9 lightness units** once fixed — the defect the
  brief described (a light rim from an uncut white background) does not exist here at all. — "The
  Matte That Was Not Broken"

- The result screen's Next button was laid out only on resize, so on the frame it appeared it was
  visible, interactive and drawn at x = 0. — "Carrying the player forward"

- Two levels on the same enemy tier were the same fight in two palettes: the tier was silently the
  whole composition, and every late level measured within 21—28% of every other. — "A Track Is A
  Place, Not A Palette"
- The third star was judged on the showcase score, which carries a x3 volley multiplier and a charge
  bonus on top — measured live at 2.29x the player's base-rate performance, i.e. a threshold one
  stroke-heavy lap clears on a level they cannot otherwise survive. — same section

- The HUD looped the `SHIELDS` constant to draw its pips, so the first five-shield hull would have
  given the player two invisible lives. — "Four Hulls, And What Each One Gives Up"
- The plan's own Hive hull was the base hull plus four locks, i.e. strictly better than the free
  one; the deficit that replaced it (cooling) was then rejected by the simulation as well, because a
  cautious player never pays it. — same section

- Pickups were drawn independently against their weights, which is right in the limit and wrong on
  a lap: the first level dealt **five** of the rarest kind out of 21 against an expected 1.75, three
  of them consecutive. — "Pickups: A Reason To Leave The Line Of Fire"
- The boost's +25% would have broken the five-second engagement-window floor on every level whose
  speed is already ramped, i.e. reintroduced the defect `road/sightline.ts` exists to prevent —
  and on a level with no headroom it would have shipped as a pickup that does nothing. — same
  section

- The ship's lateral box was two constants (`0.12..0.88` of the viewport) while the hull is sized off
  frame *height*, so on a portrait frame half the hull hung off the screen edge — and the wall it
  hit zeroed the velocity, which reads as the input having stuck. — "The Corridor"
- The lane's edge was briefly painted on the road, where it converges with distance while the limit
  does not: measured **196px** of disagreement with the wall the ship was actually held at, three
  percent of a frame's height away from the ship's rest row. Backed out for a screen-space marker. —
  same section

- `BIOME_RUN_SEGMENTS` was set by hand and had already been wrong twice — 420 with six biomes, 240
  with eight, each time leaving biomes a lap never reached. Now derived from the lap it divides, and
  the derivation reproduces the hand-tuned 179 exactly. → "The Ninth Biome"
- `LEVELS.length % BOSS_BLOCK_SIZE === 0` would have failed on a ninth level, gating content on a
  boss nobody had drawn. → same section
- A second boss with four phases would have skipped its last zone and drawn its HUD bar wrong:
  `damageBoss` and `Hud` both read a module-level `BOSS_PHASES.length`, which means *the first
  boss's* phase count. The same trap `phaseThreshold` fell into over `BOSS_MAX_HP`, one field
  along. → "A Second Boss, And A Run That Does Not End"
- On `dusk` and `ember`, enemy shots and generated enemy silhouettes were drawn in `enemy.rim`,
  which measured **1.6 and 1.7 degrees** from the ship's own hull in OKLab hue — the things trying
  to kill you wore the player's colour. Invisible to every existing check, because the threat sweep
  asks the opposite question. → "Three Enemies That Change The Verb"
- `verify:enemies`' flier-height check asserted over a seeded five-wave draw, so adding three kinds
  to the pool diluted the turret out of the sample and failed the check for a reason unrelated to
  heights. Now asserts the height table itself. → same section
- `WeaponRow` bound number keys from a written-out `['ONE', 'TWO', 'THREE']`, so the fourth loadout
  slot arrived reachable by thumb and by wheel and not by keyboard. → "The Fourth Slot"
- `Shop.create()` reset its row list and not its new tab list, so the second time the shop was
  opened `layoutTabs` sized buttons Phaser had already destroyed — a `glTexture` of null thrown
  inside the text renderer, i.e. the exact signature of `applyTheme`'s precondition being violated
  and nothing to do with themes. → "Weapon Upgrades"
- Weapon upgrades shipped their first version charging `mortar` and `pulse` for a step that does
  literally nothing: heat is not a resource for a weapon whose own cooldown holds it under the decay
  rate, so a heat upgrade could not move their damage a minute by a single point. Caught by the
  simulation, fixed in the design rather than the check. → "Weapon Upgrades"
- A per-level boss would have broken two things that read `BOSS_MAX_HP` instead of the boss's own
  total: `phaseThreshold` (a tougher boss would start past its second phase's threshold and skip to
  the last zone) and the HUD's segmented bar (every segment full, then five emptying at once). →
  "Levels: The difficulty ramp"
- `scene.restart()` on the result screen would have replayed the *next* level rather than the one
  just flown: it passes no data, so the scene's `init` fell back to "the furthest level open", which
  clearing the level had just moved forward. → "Levels"
- The result screen had only `Again`, so finishing a level left no route to the next short of
  reloading the page. → "Levels"
- Every decor prop drew colourless: the build desaturates them 50% so a multiply tint can recolour
  them, the only tint was the *theme*'s, and the default theme's tint is `0xffffff`. Reported as
  "the trees have a white background"; the mattes measured clean at 0.00–0.99% edge-connected plate
  across all 54 sprites. → "Biome Colour: Why Every Prop Was Grey"
- A numeric variant scorer picked a flying saucer for `ash_mound`, a skeleton for `ash_scrub` and a
  cartoon banana for `dune_grass`, and all three shipped — `ash_mound` twice over, as the ashen
  biome's most common prop. Third recorded instance of the same class of failure. → same section
- Free themes were filtered out of the shop catalogue, so buying any paid theme made `day` and
  `night` permanently unreachable — `ownsTheme` allowed selecting them and no control existed that
  could. Correct while the shop only sold things; wrong once its rows became a Select / In use
  control. → same section
- One stretch of the run circuit was effectively unfightable: `addSCurve()`'s three-section arms at
  `ROAD_CURVE.MEDIUM` swung the road off the side of the frame, leaving **93 of 200** fight segments
  outside the viewport and cutting the engagement window from 6.4s to **3.6s**. Reported by a player;
  invisible to every existing check, because all of them asked whether the road was *correct* and
  none asked whether the fight was *possible*. → "The Sightline"
- A finished run banked coins (`score / 200`, capped) and told the player nothing — no line on the
  result screen, no balance in the menu, so the shop's prices stood against a number of unknown
  origin and the rewarded ad looked like the only source. → "The Sightline: Where the coins were"
- `MainMenu`'s third secondary button shipped invisible: `playEntry` sets every object in
  `uiAlphaTargets()` to alpha 0 and then fades in a separately hand-written list, so a button added
  to the first and not the second was positioned, sized, interactive and drawn at alpha 0 — passing
  every measurement the layout sweep takes. → "The Loadout Screen" (one `secondaryButtons()`
  accessor read by the reset, the restore, the layout, the scrim and the probe)
- Every "something is wrong" signal in the combat layer — the low-shield edge pulse, the directional
  hit flash, the overheat lock arc and the heat bar's top step — drew in `colors.secondary`, which
  after the palette moved was the neutral near-white. Four warnings with no warning colour. →
  "The Interface Kit" / "The combat layer on the kit" (`KIT.warning` for your own machine,
  `DAMAGE_COLOR` for the threat landing)
- `Effects.ts`'s damage frame used a hardcoded `0xff3355`, **4.4 degrees** from the reserved threat
  hue — the threat colour arrived at by eye rather than by name, and invisible to every check. →
  "The combat layer on the kit" (now `DAMAGE_COLOR`, the reserved colour by name)
- The result screen's title, body and Again button were positioned as fractions of the *viewport*
  while the panel behind them was `min(height * 0.5, 360)` and centred — so at 1920x889 the button
  was anchored 15px below the panel's own bottom edge, and had been for as long as the screen
  existed. Hidden by the panel being translucent. → "The combat layer on the kit"
- The interface palette's `primary` (`0xff2975`, the template's own default) sat **15.4 degrees**
  from `THREAT_COLOR` with all three terms of the threat rule satisfied, and the HUD drew the
  player's shields, the heat bar, the selected weapon cell and the lock-on ring in it — the
  reserved danger hue doubling as the "this is yours" hue. Enforced on the road themes since the
  rule was written, never on the UI palette. → "The Interface Kit" (fixed by one `setTheme()` call
  at boot, with `verify:ui` now holding the interface palette to the same three-term test)
- `save.ts`'s `loadData()`/`saveData()` rejections and its `isWellFormed()`/size-limit guard
  rejections only ever reached `console.warn` — no signal reached the platform's own health
  metrics at all, so a spike in save failures in the field would have been invisible outside
  local dev logs. Fixed by adding `logError()` (platform API rejected) / `logWarning()` (our
  own guard rejected the payload) alongside the existing `console.warn` calls — see "Save
  Layer".
- **Certification blocker, found from the actual Playables Test Suite output, not by code
  review**: the Test Suite's "SDK loaded before any game code" MUST check was red even with
  the SDK `<script>` correctly preceding the module entry tag in `dist/index.html`. Root
  cause: the check watches actual network load order, not DOM/tag order — a static
  `<script type="module" src="...">` is visible to the browser's preload scanner, which
  fetches it in parallel with the classic blocking SDK script rather than after it, and a
  small local bundle can finish downloading before the SDK's real network round-trip does.
  Fix: `vite.config.ts`'s `inlineModuleLoader` plugin rewrites the entry into a classic
  inline `<script>import(...)</script>`, invisible to the preload scanner. → "Build Guards &
  Asset Policy"
- **Certification blocker, found by a full manual code review against SDK requirements,
  not caught by any automated chunk**: `vite build`'s default `base` emits root-absolute
  asset paths (`<script src="/assets/index-xxxx.js">`). Works locally (dev server and
  `vite preview` both serve from domain root) but Playables does not host games at the
  domain root — the shipped `dist/index.html` would 404 loading its own JS, i.e. a black
  screen on actual submission. Verified by serving a real build under an arbitrary
  non-root subpath: 404s with the default `base`, loads clean with `base: './'`. Fix:
  `vite.config.ts`'s `base: './'`, plus a `scripts/make-bundle.mjs` regression guard that
  fails on any `src="/"`/`href="/"` in the built `dist/index.html`. → "Build Guards & Asset
  Policy"
- **Certification blocker, same review**: `YTEvents.PAUSE` never actually paused gameplay
  — `audio.ts` muted sound and `store.ts` flushed the save, but nothing called
  `scene.pause()`, so `Game`'s `update()` loop (and input) kept running the entire time the
  platform considered the game "paused." Fix: `src/platform/lifecycle.ts`'s
  `bindGameplayPause()`. → "YouTube Playables Wrapper"
- `bindGameplayPause()` originally paused an explicit whitelist (`['MainMenu', 'Game']`) — correct today,
  but a silent trap for later: any new gameplay scene would need someone to remember to add it to that
  list, or platform pauses would quietly stop freezing it. Inverted to an overlay-*exclusion* list before
  the template freeze (pause everything active except `Settings`) so the safe behavior is the default. →
  "YouTube Playables Wrapper"
- The production `dist/index.html`'s script order was the reverse of the certification
  requirement: the *source* `index.html` had the SDK `<script>` before the `type="module"`
  entry script, both in `<body>` — but `vite build` hoists the entry module script into
  `<head>` (appended right before the closing head tag, regardless of its original
  position in source) while leaving any other `<body>` script where it was, so the built
  output ended up with the module script running *first*. Never manually verified against
  the actual built HTML until `scripts/make-bundle.mjs` (Chunk 6) checked it programmatically.
  → "Build Guards & Asset Policy" (fix: the SDK `<script>` now lives in `<head>` in source
  too, so Vite's append-to-head lands its own tag after it, not before)
- `gameReady()` could fire before `firstFrameReady()` — instant/asset-less `Preloader` runs the whole
  Boot→Preloader→MainMenu chain in one tick, before the first render. → "YouTube Playables Wrapper"
- Build failed on `main.ts`'s top-level `await` — esbuild's default target predates it; needed
  `vite.config.ts`'s `build.target: 'es2022'`.
- SDK `<script>` load could hang the game indefinitely with no fallback. → "YouTube Playables Wrapper"
  (`waitForPlatformReady()`'s timeout race — with a documented residual limit it can't fully close)
- Autosave never fired outside real Playables (`YTEvents.PAUSE` doesn't exist there) — a tab closed
  mid-debounce-window silently lost pending mutations. → "Save Layer" (`pagehide` fallback)
- MainMenu's scene-wide `once('pointerdown')` also fired on gear-button clicks, incorrectly starting
  `Game`. → fixed by attaching the listener to the "start" text object instead of the whole scene.
- Sound instances leaked across every PAUSE/RESUME cycle — `stopMusic()`/`playMusic()` used `.stop()`
  instead of `.destroy()`. → "Audio Layer"
- Music always restarted from `0` on RESUME instead of continuing where it left off. → "Audio Layer"
  (`pausedMusicSeek`, `playMusic()`'s `seekSeconds` param)
- `Settings.close()` could resume a scene out from under an active platform pause (or, if it just skipped
  resuming, leave it paused forever). → "Audio Layer" / "YouTube Playables Wrapper" (`isPlatformPaused()`
  + deferred resume on the next `YTEvents.RESUME`)
- `Settings`'s backdrop was originally created at `(0, 0, 0, 0)` with `setInteractive()` called
  immediately at that zero size — Phaser's `setInteractive()` skips creating `.input` entirely for a 0x0
  object, so the backdrop had no `.input` at all, then never gained one, and never actually swallowed a
  click at any real viewport size. → "Responsive Layout" (gotcha #1: `setInteractive()` deferred to
  `layout()`, after a real size exists)
- `Game`'s gear button rendered at the wrong screen position (near mid-screen instead of the corner)
  whenever the world camera's zoom/pan was non-identity — it was drawn through `cameras.main`, the same
  camera being zoomed/panned onto the fixed logical world. A test that only reads a game object's `x`/`y`
  properties can't catch this (those aren't touched by which camera renders them); it only showed up in an
  actual screenshot. → "Responsive Layout" (two-camera split: UI on a dedicated always-1:1 `uiCamera`,
  excluded from `cameras.main` via `.ignore()`)

Non-obvious platform facts (not bugs, but easy to get wrong again):

- `setInteractive()` on an object whose current `width`/`height` is `0` creates no `.input` at all (not
  an `.input` with a zero-size hit area) — the derivation explicitly guards on both being nonzero.
  → "Responsive Layout" (gotcha #1)
- Calling `setInteractive()` again on an object that already has `.input` only re-enables it — it does
  not recompute the hit area from the object's current size/position. Any object whose size changes after
  its first `setInteractive()` call (i.e. anything under `layout()`) must resize `obj.input.hitArea`
  directly. → "Responsive Layout" (gotcha #2)
- `GameObject.setMask(geometryMask)` silently does nothing under this project's WebGL renderer — no
  error, no exception, `.mask` just never gets assigned. → "Scroll Patterns" (RULE: use
  `scrollableCameraRegion()`'s dedicated-camera-viewport clip instead)
- **`setTintFill(color)` is gone in Phaser 4.** It still exists as a method — which is why a call
  typechecks against `setTintFill(): void` and fails only on the argument — but its whole body is
  a `console.error` telling you to use `setTint(color).setTintMode(Phaser.TintModes.FILL)`. The
  mode is **sticky per object**, so anything that switches to `FILL` for a transient effect must
  put it back to `MULTIPLY` itself; in a pooled renderer a slot that once flashed would otherwise
  draw as a solid block forever after. → `src/rail/Enemies.ts`'s hit flash, which needs FILL for
  art (multiplying a coloured sprite by white is the identity, i.e. no flash at all) and MULTIPLY
  for a generated silhouette.

- `String.prototype.isWellFormed()` (ES2024) isn't universally available at runtime — feature-detected in
  `save.ts`, not called blindly; esbuild transpiles syntax, not missing runtime methods.
- `Phaser.Sound.BaseSound`'s `.d.ts` omits `mute`/`setMute()`/`seek`/`volume`/`loop` even though every
  concrete backend implements them identically. → "Audio Layer" (`MutableSound` interface extension)
- `src/platform/yt.ts` and `adGate.ts` use `import type * as Phaser from 'phaser'`, not a value import —
  both files only ever need `Phaser.Game` as a type annotation, never a runtime `Phaser.*` API call. A
  *value* `import * as Phaser from 'phaser'` executes the whole package at module-load time, and Phaser's
  own init code unconditionally reads `window` — harmless in a browser, but it means any Node-run script
  that transitively imports one of these two files (a future headless test/tooling script, say) would
  crash immediately outside a browser environment. Every other file under `src/ui/`/`src/scenes/` that
  calls real runtime Phaser APIs (`Phaser.Math.Clamp`, `Phaser.Geom.Rectangle`, `Phaser.Input.Events.*`,
  ...) keeps the ordinary value import — this is specific to platform-layer files that take `Phaser.Game`
  purely as a typed parameter.

Testing-only gotchas (not app bugs — see "Audio Layer" for both):

- A raw dynamic `import()` of an app module from an external test script is a *different* module instance
  than the one `main.ts` statically imports; singletons initialized only by `main.ts` (like `audio.ts`'s
  `soundManager`) need `init()` called again on that instance, or they silently no-op.
- WebAudio's `mute`/`volume` are `AudioParam` automation — reading them back synchronously in the same
  tick after setting them can return the stale value in headless Chromium; wait ~100–300ms before
  asserting on it.
