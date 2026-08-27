# ART-SOURCES.md

Provenance for every image file that ships in `dist/`.

Same rule and the same reason as `AUDIO-SOURCES.md`: an unresolved copyright claim on an asset
is one of the commonest Playables rejections, so nothing enters `public/assets/` without a row
here saying where it came from and under what terms. Only **CC0** or **self-generated** is
acceptable.

Like `AUDIO-SOURCES.md`, this file lives at the repo root and never under `public/` — Vite
copies `public/` into `dist/` verbatim, so a process document placed there would ship inside the
submission archive.

---

## Shipped

| File | Source | Variant | Licence | Added |
|---|---|---|---|---|
| `public/assets/sky/day.png` | self-generated, RealVisXL V4.0 on Modal | `day_v1` | self-generated | 2026-08-17 |
| `public/assets/sky/night.png` | self-generated, RealVisXL V4.0 on Modal | `night_v1` | self-generated | 2026-08-15 |
| `public/assets/sky/dusk.png` | self-generated, RealVisXL V4.0 on Modal | `dusk_v2` | self-generated | 2026-08-15 |
| `public/assets/sky/ice.png` | self-generated, RealVisXL V4.0 on Modal | `ice_v4` | self-generated | 2026-08-15 |
| `public/assets/sky/ember.png` | self-generated, RealVisXL V4.0 on Modal | `ember_v4` | self-generated | 2026-08-15 |
| `public/assets/sky/verdant.png` | self-generated, RealVisXL V4.0 on Modal | `verdant_v8` | self-generated | 2026-08-15 |
| `public/assets/sky/signal.png` | self-generated, RealVisXL V4.0 on Modal | `signal_v1` | self-generated | 2026-08-15 |

The three behaviour enemies and the second boss are img2img from **shaded, black-outlined
procedural roughs rendered out of the game's own geometry** (`rail_enemy3_roughs.py` in the
Remotion project), which is the method that landed 12/12 on the four biome-round enemies and
3/3 here. The boss took two rounds and its own entry below.

`boss2.png` is **the third attempt at this subject and the first that shipped.** The two before
it are recorded in the game's CLAUDE.md: side-view naval warships from a photoreal checkpoint,
then a raster copy of the polygon from a flat init at low strength (`rimSharePct` 81-95%,
refIoU 0.987-0.991, no panelling at all). A heavily banded rough at strength 0.85 fixed the
panelling outright — **rimSharePct 35.0%, refIoU 0.68-0.88** — and produced a HUMANOID four
times out of four: a horned knight with a face, fists and feet. The cause was the rough's own
body plan (two shoulders standing clear of a crown over two separated legs is a torso, a head
and limbs), not the prompt — the negative already carried `human, face` and the shape won
anyway. `siege_crown_v8` is from a rough redrawn with no body plan at all: one continuous
hull, a battlement instead of a helm, a chamfered skirt instead of legs.

`fungal` is the ninth biome and ships with **five** props rather than six, the way `crystal` ships
with five and `coast` with four. It also took **four rounds and 57 renders**, and the reason is worth
recording next to the provenance because it is a fact about the model rather than about the prompts:
rounds 1-3 asked for six fungal *morphologies* (bracket shelves, puffballs, coral fungus) and
delivered two usable props, because DreamShaper XL draws a capped mushroom and reaches for
architecture, a set of detached spheres or a berried tree when asked for anything else in that
family. Round 4 asked for six capped mushrooms in six *proportions* and delivered five. The sixth,
`fun_squat`, is pulled: "a squat wide mushroom, flat broad cap on a very short fat stalk" is the
proportion of a **cartoon character**, and two of its three variants came back with legs and shoes or
a face and arms. Full account in `dev-assets/sprites/NOTES-fungal.md`.

`day` is the seventh plate and was generated two days after the other six: the theme was added as
the new default without one, so the game's default sky was the procedural fallback the plates exist
to replace. It shipped first as `day_v5`, picked from eight on where its clouds sat relative to
`HORIZON_Y`, and was **re-picked to `day_v1` on 2026-08-18 because a plate with clouds cannot be
drawn undistorted by this backdrop at all**: the sky layer covers the viewport in one vertical
repeat while tiling horizontally at 1:1, so a 320px plate on a 945px frame is stretched 3x
vertically and not at all horizontally, and v5's round cloud lobes drew as a row of tall pale
spires along the horizon. v1 is horizontal-only structure (`structX` 0.234 against v5's 0.900) and
was named in `dev-assets/sky/NOTES-day.md` as the pick for exactly this outcome. Same model, same
prompt family, same session — provenance unchanged.

`ice`, `ember` and `verdant` are second-round picks: their first-round variants carried a hard
horizontal edge at y=0.45 from a mask in the generator's own post-processing. Provenance is
unaffected — same model, same project, no third-party input — but the variant column is recorded
here because the shipped file no longer matches the first plate generated for that theme. See
CLAUDE.md "Theme, Light and Art" for the defect and how it was measured.

**Model:** `SG161222/RealVisXL_V4.0`, run on Modal from the sibling `Remotion` project
(`src/scripts/modal_sdxl.py --sky-plates`). No reference image, no img2img, no third-party
input of any kind — each plate is a text-to-image render from a prompt written for this project.

**Provenance trail.** The unmodified renders and their full metadata (prompt, negative prompt,
seed, steps, cfg, and the measured acceptance numbers) are kept in `dev-assets/sky/` — forty
plates across two rounds. `dev-assets/` is deliberately **not** under `public/`, so none of it
ships. `scripts/build-sky-plates.py` is the only thing that turns a source plate into a shipped
one, and it records which variant was picked per theme.

## Shipped sprites

| File | Variant | Source | Licence | Added |
|---|---|---|---|---|
| `public/assets/ship.png` | `ship_v7` | self-generated, DreamShaper XL 1.0 on Modal | self-generated | 2026-08-15 |
| `public/assets/decor/{spire,boulder,ridge,frond}.png` | `spire_v4`, `boulder_v5`, `ridge_v3`, `frond_v1` | as above | self-generated | 2026-08-15 |
| `public/assets/decor/{bramble,boxwood,thistle}.png` | `bramble_v1`, `boxwood_v2`, `thistle_v2` | as above | self-generated | 2026-08-15 |
| `public/assets/decor/deadtree.png` | `deadtree_v5` | as above | self-generated | 2026-08-15 |
| `public/assets/enemy/{drifter,weaver,charger,turret}.png` | `drifter_v1`, `weaver_v2`, `charger_v3`, `turret_v1` | as above | self-generated | 2026-08-15 |
| `public/assets/enemy/boss.png` | `boss_v1` | as above | self-generated | 2026-08-15 |
| `public/assets/decor/{for,dune,wet,rid,ash,cry}_*.png` (35 files) | per-slot, see `DECOR_PICKS` in `scripts/build-sprites.py` | as above | self-generated | 2026-08-16 |
| `public/assets/enemy/{lancer,bulwark,swarmer,hexer}.png` | `lancer_v*`, `bulwark_v9`, `swarmer_v2`, `hexer_v2` | as above, img2img from procedural roughs | self-generated | 2026-08-16 |
| `public/assets/fx/{pr,mz,im}_*.png` (11 files, round 1) | per-slot, see `FX_PICKS` | as above | self-generated | 2026-08-16 |
| `public/assets/fx/{pr_dart,pr_cross,pr_twin,mz_bloom,mz_slash,mz_petal,im_ring,im_splash}.png` | `pr_dart_v2`, `pr_cross_v3`, `pr_twin_v3`, `mz_bloom_v1`, `mz_slash_v1`, `mz_petal_v2`, `im_ring_v1`, `im_splash_v3` | as above | self-generated | 2026-08-16 |
| `public/assets/decor/{coa_stack,coa_kelp,coa_palm,coa_reef}.png` | `coa_stack_v7`, `coa_kelp_v2`, `coa_palm_v7`, `coa_reef_v9` | as above | self-generated | 2026-08-16 |
| `public/assets/decor/rui_*.png` (6 files) | `rui_column_v2`, `rui_arch_v9`, `rui_wall_v3`, `rui_statue_v2`, `rui_rubble_v8`, `rui_obelisk_v2` | as above | self-generated | 2026-08-16 |
| `public/assets/decor/fun_*.png` (5 files) | `fun_tall_v2`, `fun_dome_v1`, `fun_cluster_v3`, `fun_pair_v2`, `fun_wide_v3` | self-generated, DreamShaper XL 1.0 on Modal | self-generated | 2026-08-19 |
| `public/assets/enemy/{jammer,splitter,warden}.png` | `jammer_v1`, `splitter_v3`, `warden_v2` | self-generated, DreamShaper XL 1.0 on Modal, img2img from a procedural rough | self-generated | 2026-08-19 |
| `public/assets/enemy/boss2.png` | `siege_crown_v8` | as above, strength 0.85 | self-generated | 2026-08-19 |
| `public/assets/enemy/{drifter,weaver,charger,turret}_{forest,coast,dunes,wetland,ridge,crystal,ruins,ashen,fungal}.png` (36 files) | per-slot, see `ENEMY_SKIN_PICKS` in `scripts/build-sprites.py` | self-generated, DreamShaper XL 1.0 on Modal, img2img from procedural roughs (`Remotion/src/scripts/rail_skin_roughs.py`) | self-generated | 2026-08-20 |
| `public/assets/enemy/{swarmer,lancer,hexer,jammer,splitter,warden,bulwark}_{forest,coast,dunes,wetland,ridge,crystal,ruins,ashen,fungal}.png` (63 files) | as above | as above, strength 0.85; the `hexer` slots cut with `key_cutout_holed` | self-generated | 2026-08-21 |
| `public/assets/decor/{for_pine,for_birch,dune_spire}.png` | `for_pine_v6`, `for_birch_v8`, `dune_spire_v7` | as above, roughs in `Remotion/src/scripts/rail_prop_roughs.py` | self-generated | 2026-08-20 |
| `public/assets/brand/menu_bg.png` | `sr_menu_bg_v1` | self-generated, DreamShaper XL 1.0 on Modal | self-generated | 2026-08-17 |
| `public/assets/brand/{emblem,mascot,rival}.png` | `sr_emblem_v1`, `sr_mascot_v2`, `sr_rival_v8` | as above | self-generated | 2026-08-17 |

**The wordmark is not in this table because it is not art.** "SHOOTING RACER" is drawn as text by
`src/ui/brand.ts`; there is no file, and therefore no provenance question. Asking a diffusion model
for lettering was never attempted — the generation pipeline carries `text, letters, words, logo` in
its own standing negative prompt for exactly that reason.

**`rival` is the one brand asset exempt from the build's threat guard**, on the same grounds
enemies are: a hostile robot may look hostile. Measured, 0.547% of it sits in the reserved band and
every one of those pixels is its eye dome. The emblem was **7.868%** — its whole outer rim — and was
rotated out at build time rather than shipped, which is what turned that rim from red to amber.

**⚠ The four middle rows are a backfill, and that is a process failure worth naming.** This file's
own rule is that nothing enters `public/assets/` without a row here *first*; 54 files —
every biome prop, the four enemies added with them, and the whole first round of weapon effects —
shipped without one. Provenance is unaffected (same model, same project, same pipeline, no
third-party input, and each file's own `.json` sidecar in `dev-assets/sprites/` carries its prompt
and seed), so nothing here is in doubt. What failed is the check, not the licence: **the rule is a
process convention with no mechanical guard behind it**, and a convention that depends on someone
remembering is one that eventually will not be remembered. A guard that fails `npm run build` on a
file under `public/assets/` with no row is the fix, and it is not built yet.

Per-slot variants are deliberately not repeated here for the bulk rows: `scripts/build-sprites.py`
is the single place that maps a slot to the variant it shipped, and a second copy in this file is a
second thing to keep correct. Its `FX_PICKS` also records the two slots of round 2 that were
briefed and **failed** — `pr_comet` and `im_pulse` — with the reason each.

**Model:** `Lykon/dreamshaper-xl-1-0`, run on Modal from the sibling `Remotion` project. The sky
plates above use RealVisXL; the sprites do not, because a photoreal checkpoint cannot produce
cartoon game art — that finding cost two rejected rounds and is recorded in CLAUDE.md.

**The 99 biome skins are quantised to 32 colours, where every other sprite gets 64.** Recorded here
because it is a *delivery* difference rather than a provenance one: the same render, the same
sidecar, a harder palette (`SKIN_COLORS` in `scripts/build-sprites.py`) chosen because 99 files of
flat cel bands are the one place in this project where the palette is most of the byte cost — -19%,
with no visible change at the size they are drawn.

**No third-party input.** The ship, the four enemies and the boss are img2img from *procedural
roughs generated by this project's own scripts* — shaded polygon renders, not reference images
from anywhere. The scenery is text-to-image. Raws, prompts, seeds and measured acceptance
numbers are in `dev-assets/sprites/` with a `.json` per file; `scripts/build-sprites.py` is the
only thing that turns one into a shipped asset and records which variant was picked.


## The glossy regeneration (2026-08-26)

Everything below replaces the rail shooter's inherited set. All of it is **self-generated** on
**DreamShaper XL 1.0 via Modal**, from `Remotion/src/scripts/snail_prompts.py` +
`gen_snail_art.py`, and delivered by `scripts/build-sprites.py`.

| File | Variant | Method | Licence | Added |
|---|---|---|---|---|
| `public/assets/snail/snail-{0..5}.png` | `snail_hero_v14` | img2img strength 0.85 from the procedural rough in `Remotion/src/scripts/snail_roughs.py`; the six frames are one render sheared per row by `build_snail` | self-generated | 2026-08-26 |
| `public/assets/obstacle/*.png` (6 files) | see `dev-assets/picks.json` | text2img, `rembg` matte | self-generated | 2026-08-26 |
| `public/assets/pickup/*.png` (3 files) | see `dev-assets/picks.json` | text2img; the shared backing disc is composited by `build_pickups`, not rendered | self-generated | 2026-08-26 |
| `public/assets/decor/*.png` (nine biomes) | see `dev-assets/picks.json` | text2img, per-slot matte in `gen_snail_art.MATTE` | self-generated | 2026-08-26 |

**The per-file rows this table does not spell out live in `dev-assets/sprites/<variant>.json`**,
one sidecar per render, carrying the exact prompt, negative, seed, checkpoint id, render size,
steps, cfg, matte and every measured number. That is a stronger provenance record than a row here
could be, and `dev-assets/picks.json` is what maps a shipped file back to one of them.

**The rule this file states — no row, no ship — has a known gap, and it is unchanged by this
round:** nothing fails `npm run build` for an unrecorded file under `public/assets/`. The parent
project shipped 54 files without rows before anyone looked. A guard remains unbuilt.

## Not shipped, and why

`dev-assets/sprites/rejected/` — 37 rejected sprite renders with `REJECTS.json` giving a reason
each. Notable: six tumbleweeds, none usable — an open, see-through silhouette was never
delivered, because "ball" reads to the model as a solid noun before it reads as a shape.

`dev-assets/boss/` — fourteen boss-hull renders from the same model, across two attempts.
**Rejected**, see CLAUDE.md "Theme, Light and Art". The first eight failed the project's own 24px
silhouette test; the second six reproduced the reference outline almost exactly (refIoU
0.987–0.991) and were correctly 2-tone, but developed no interior detail — making them a raster
copy of the polygon the game already draws, which is strictly worse than drawing it. The
procedural polygon passes the test, so it stays. Kept as the record of two trials that were run
and did not work.

`dev-assets/refs/` — five white-on-black silhouettes (boss, drifter, weaver, charger, turret)
rendered from this project's *own* polygon coordinates in `src/rail/enemyArt.ts`, used as img2img
references for the second boss attempt. Self-generated by definition: they are a rendering of
source code in this repository.

## Everything else is drawn at runtime

The ship, the enemies, the boss, the scenery and the road palette are all generated on a
`CanvasTexture` at boot from polygon coordinates in `src/road/decor.ts`, `src/rail/enemyArt.ts`
and `src/road/palette.ts`. No file, no provenance question, and they recolour with the theme —
which is exactly why the sky plates are the only raster art in the game.

## Kenney Food Kit (CC0) — pickups and fruit

Same licence, same pipeline and same camera as the Nature Kit rows above: downloaded to
`dev-assets/cc0-3d/food-kit.zip`, rendered by `dev-assets/cc0-3d/smooth_render.py` at the identical
yaw, pitch and light rig the verge and the obstacles use. That is the only reason the fruit does not
read as a sticker laid over the game.

**⚠ One change to the renderer was unavoidable and is worth knowing.** The Nature Kit paints with
per-material `Kd`; the Food Kit paints with a single texture atlas and every material is literally
`Kd 1 1 1` plus `map_Kd colormap.png`. A loader that reads only `Kd` renders the whole kit **white**,
which is what the first strawberry came back as. `load_obj_uv` keeps the texture coordinates and
samples the sheet once per face at the UV centroid — the atlas is a palette rather than a picture,
so one sample recovers the flat colour exactly, with no per-pixel texturing and no change to the
rasteriser. `FOOD_DESAT` is 0.12 rather than `KD_DESAT`'s 0.55: a verge prop is multiplied by its
biome's tint and must be pulled toward grey first, and nothing tints a pickup.

| file | model | source | licence | added |
|---|---|---|---|---|
| `public/assets/pickup/pickup-fruit-grapes.png` | `grapes` | Kenney Food Kit, https://kenney.nl/assets/food-kit | CC0 | 2026-08-27 |
| `public/assets/pickup/pickup-fruit-banana.png` | `banana` | Kenney Food Kit, https://kenney.nl/assets/food-kit | CC0 | 2026-08-27 |
| `public/assets/pickup/pickup-fruit-melon.png` | `watermelon` | Kenney Food Kit, https://kenney.nl/assets/food-kit | CC0 | 2026-08-27 |
| `public/assets/pickup/pickup-fruit-pear.png` | `pear` | Kenney Food Kit, https://kenney.nl/assets/food-kit | CC0 | 2026-08-27 |
