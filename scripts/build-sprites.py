"""
build-sprites.py  Turn the generated renders in dev-assets/sprites/ into shippable assets.

Run by hand whenever the picks change; the output is committed, so a normal `npm run build`
never needs Python:

  py -3.11 scripts/build-sprites.py
  py -3.11 scripts/build-sprites.py --only snail,pickups     one family at a time

Reads dev-assets/sprites/<slot>_v<n>.png (the picked variant per slot, PICKS below) and writes:

  public/assets/decor/<slot>.png          the nine biomes' roadside props
  public/assets/obstacle/<key>.png        the three obstacle classes
  public/assets/pickup/<key>.png          the three pickups, on a shared backing disc
  public/assets/snail/snail-<0..5>.png    six glide frames, all from ONE render

Every key above is one the game's own generators already declare, and that is the whole
mechanism: `snailArt.ts`, `obstacleArt.ts`, `pickupArt.ts` and `decorShapes.ts` each check
whether their texture key already exists and draw a placeholder only when it does not. Arriving
first is all a real sprite has to do to take over, and nothing downstream branches on art versus
drawn.

── THE TRANSFORM, AND WHY EACH STEP IS WHERE IT IS ────────────────────────────

Inherited from the rail shooter's own build step, whose ordering was established by measured
defects rather than by taste. Do not reorder these:

  ALPHA IS NOT A COLOUR      Only the RGB channels are quantised; the original alpha is carried
                             through untouched and re-attached afterwards. Quantising RGBA in one
                             pass treats alpha as a fourth colour channel: a bush's uniformly
                             opaque interior came back with 24,881 partially transparent pixels,
                             i.e. holes punched through the fill that composite as static. The
                             tell is that the soft-pixel count RISES through the step.

  COLOUR UNDER TRANSPARENCY  A transparent pixel still has RGB, and every filter that touches the
                             sprite afterwards — the LANCZOS downscale here, and the GPU's own
                             bilinear and mipmap sampling later — mixes it into the pixels around
                             it. The renders carry black under their transparency, so the object's
                             own colour is flooded outward BEFORE the resize and AGAIN at the very
                             end, after the quantiser. Run before the quantiser the second flood is
                             undone by it, because the quantiser maps transparent pixels onto the
                             palette too.

  ALPHA FLOOR AFTER RESIZE   Pixels under 6% alpha carry no information and are exactly what
                             `npm run verify:mattes` fails a build for. Floored after the resample,
                             so what it clears becomes part of what the closing flood fills.

── WHAT THIS BUILD DOES THAT THE PARENT'S DOES NOT ───────────────────────────

  NO DESATURATION ON DECOR. The rail shooter desaturated every prop 50% so a per-theme multiply
  tint had authority over it, and this game inherits that tint chain (`biomes.ts` `decorTint` x
  the theme's). But that project's own art was authored muted to begin with; this round's brief is
  the opposite, and halving the saturation of a deliberately vivid render is throwing away the one
  thing it was rendered for. `DESATURATE` is therefore 0.25 rather than 0.5 — enough that a tint
  still moves the hue, not enough to grey out the picture. See the constant.

  THE SNAIL'S SIX FRAMES COME FROM ONE RENDER. See `build_snail`.

  THE PICKUPS GET THEIR BACKING DISC HERE. See `build_pickups`.
"""

import argparse
import json
import math
import random
import sys
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, str(Path(__file__).resolve().parent))

from threat_guard import enforce_threat_reservation_palette  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
# **Two source directories, and the split is by HOW a render was made rather than by what it is
# of.** `dev-assets/generated/` holds the diffusion renders and their sidecars; `dev-assets/lowpoly/`
# holds the CC0-model renders from `dev-assets/cc0-3d/smooth_render.py`. A pick names a stem and
# this looks in both, so moving a slot from one route to the other is a one-line edit in
# `picks.json` and nothing else — which is the whole reason the two are not merged into one folder.
SOURCES = [
    ROOT / "dev-assets" / "generated",
    ROOT / "dev-assets" / "lowpoly",
]
ASSETS = ROOT / "public" / "assets"

# ── The picks ───────────────────────────────────────────────────────────────
#
# Recorded here rather than in a comment elsewhere so re-running this script cannot silently ship
# a different render than the one that was reviewed.
#
# Every one was chosen from the generator's own measured numbers (delivered aspect against the
# asked-for one, `canvasEdgeOpaquePct`, 24px coverage) AND THEN LOOKED AT on mid grey. That second
# half is not a formality: across the rounds behind this table the numeric gates passed a seamless
# pebble field, a jewellery ring, an arrow pointing the wrong way and a snail standing on a lily
# pad. A metric cannot see what a picture is of.
PICKS: dict[str, str] = {}

# ── Sizes ───────────────────────────────────────────────────────────────────
#
# The biggest any of these is ever drawn. A decor billboard passes the camera at a few hundred
# pixels tall; an obstacle is drawn to its own collision box, widest for `low` at 680 world units,
# which lands around 300px at 1920; the snail is about 102px across at 1920 and 21px on a portrait
# phone; a pickup runs 13px to 29px. Each figure below is comfortably above what its family is
# drawn at and far below the 512px the renders arrive as.
LONG_SIDE = {
    # **⚠ 384, raised from 176 because the pixels were visible.** The old figure was set against the
    # generated set, whose soft diffusion edges hide magnification well; a low-poly render is flat
    # colour meeting flat colour along a hard facet boundary, and magnifying that boundary is
    # exactly where a resample shows its own grid. A near-tier prop passes the camera at several
    # hundred pixels tall, so the delivered sprite has to be in that range rather than under half of
    # it.
    "decor": 384,
    # Raised with  and for the same reason: an obstacle passes the camera closer than any
    # prop does, so it is the family where magnification shows first.
    "obstacle": 384,
    "pickup": 128,
    "snail": 224,
}

# Palette size for the RGB quantiser. 64 is where the parent project's own sweep landed for
# diffusion art: below it the soft gradients that make a glossy render read as glossy start to
# band, above it the file grows with nothing on screen to show for it.
COLORS = 64

# **⚠ ZERO, AND IT WENT 0.5 -> 0.25 -> 0 OVER THREE PASSES.** The rail shooter desaturated every
# prop by half so a per-theme multiply tint would have authority over it — a multiply cannot argue
# with the saturation it is handed. That was right for art authored muted. This round's is authored
# vivid on purpose, and each step of desaturation is throwing away the one thing it was rendered
# for; the set came back reported as washed out.
#
# What makes zero safe is that the tint no longer has to carry biome identity. In the parent, one
# grey prop was tinted nine ways to stand for nine places; here every biome has its own six
# subjects, rendered green for a forest and black-and-amber for a volcanic one. The tint is now
# LIGHT, not identity — and a multiply still darkens and still shifts hue, it just no longer has to
# do it against art that has been flattened first.
DESATURATE = 0.0

# Below this, alpha carries no information and `npm run verify:mattes` fails the build.
ALPHA_FLOOR = 0.06

# How far the object's own colour is pushed out into the transparent ring. Three steps covers the
# reach of a LANCZOS kernel at these scales plus the first mipmap level.
DILATION_STEPS = 3

# What counts as leftover render plate. See `strip_plate` for why this is keyed off the sprite's
# OWN measured plate colour rather than off a fixed brightness.
#
# `PLATE_MAX_SATURATION` is the parent project's, unchanged: it is what separates a neutral field
# from a coloured subject, and that question does not depend on the checkpoint.
#
# `PLATE_SHADOW_DROP` is this round's, and it is how far below the plate a CAST SHADOW is allowed
# to sit and still count as background. Measured on the two worst sprites, the shadow ellipse runs
# 55-75 below the plate's own value; 90 covers both with margin and still stops well above a dark
# prop. It is bounded rather than open precisely so `ash_*`'s glossy black obsidian — the darkest
# subject in the game — cannot qualify.
PLATE_MAX_SATURATION = 22

# **⚠ THE TEST IS AN INTERVAL AROUND THE MEASURED PLATE, AND THE FIRST VERSION HAD NO UPPER BOUND.**
# It read `value >= key_v - drop`, which is every neutral pixel brighter than a threshold — so on
# the `ruins` biome, whose whole brief is CREAM MARBLE, the flood walked straight out of the plate
# and into the subject. `rui_column`, `rui_obelisk` and `rui_statue` all came back eaten.
#
# Bounded both ways, marble at value ~210 against a plate at 162 is +48 and outside the window,
# while the plate's own drift across this set (#838280 to #a3a3ab) is inside it.
PLATE_TOLERANCE = 30

# How far below the plate a CAST SHADOW may sit and still count as background. Measured on the two
# sprites that carried one: `fun_wide`'s ellipse runs to value 54 against a plate at 160, i.e. 106
# below. 115 covers it. The flood is border-connected and comes in from the OUTSIDE, so an
# under-set value does not shrink the shadow evenly — it stops at the first pixel past the
# threshold and leaves the darkest core behind, which is exactly what 90 did.
PLATE_SHADOW_DROP = 115

# Used only when a sprite has no sidecar to read a measured plate colour from. The renders all ask
# for the same grey field, so this is the nominal value rather than a guess.
PLATE_FALLBACK_VALUE = 176


# ── The transform ───────────────────────────────────────────────────────────


def strip_plate(image: Image.Image, key_rgb: tuple[int, int, int] | None = None) -> tuple[Image.Image, int]:
    """Remove what the generator's own matte left of the render's background.

    **⚠ THE FIRST VERSION TOOK ONLY THE BRIGHT HALF AND HALF THE DEFECT SURVIVED.** It was ported
    from the parent project as "near-white and near-neutral, connected to the frame edge", which is
    the residue that project measured. Rendered on magenta — the standing rule, and the only thing
    that showed it — this round's set carried TWO residues, and the fixed brightness window caught
    neither reliably:

      a PALE HALO around the base    `ash_spar`, `fun_dome`, `fun_tall`, `rui_column`,
                                     `dune_cactus`. The plate here measures #83-#a3, not the
                                     #196+ the fixed threshold wanted.
      a DARK CAST-SHADOW ELLIPSE     `fun_wide`, `wet_stump`. Far below any bright threshold, and
                                     it is the one that made objects read as FLOATING: the prop
                                     stands on a grey blob, and the blob's own bottom edge is what
                                     the billboard plants on the ground.

    Both are the same thing — plate, and plate darkened by the object's shadow — so both are keyed
    off the plate rather than off a constant. **`key_rgb` is the colour the generator MEASURED from
    that render's own border ring** and wrote into its sidecar; using it means the test is per
    sprite instead of per guess, and the plate drifts (#838280 to #a3a3ab across this set).

    A pixel is background when it is near-neutral AND either close to the key or darker than it —
    the second clause is the shadow, and it is bounded by `PLATE_SHADOW_DROP` so a dark prop does
    not qualify on brightness alone.

    **Border-connected is still the whole safety argument**, and it is what makes the widened test
    safe on the grey-stone props: a marble column's own body does not touch the frame edge, so the
    flood cannot reach it however neutral it is. What the flood needs is a continuous path in from
    the border, which is exactly what a leftover backdrop has and a subject does not.

    **The flood ignores alpha entirely.** The plate is anti-aliased to near-nothing along the very
    edge of the frame, so a flood that required a solid pixel could never get in from the border
    and would report zero plate on a sprite that is half plate — the measurement error that hid
    this defect in the parent project.

    **Decor and obstacles only, never the pickups.** They are composited onto a bright rim over a
    dark disc, and both clauses above describe that rim.
    """
    key = key_rgb or (PLATE_FALLBACK_VALUE,) * 3
    key_v = max(key)

    pixels = image.load()
    width, height = image.size
    stack: list[tuple[int, int]] = []
    seen = [[False] * width for _ in range(height)]

    def is_plate(x: int, y: int) -> bool:
        r, g, b, a = pixels[x, y]
        if a == 0:
            return False
        value = max(r, g, b)
        if value - min(r, g, b) > PLATE_MAX_SATURATION:
            return False
        return key_v - PLATE_SHADOW_DROP <= value <= key_v + PLATE_TOLERANCE

    for x in range(width):
        for y in (0, height - 1):
            if is_plate(x, y):
                stack.append((x, y))
    for y in range(height):
        for x in (0, width - 1):
            if is_plate(x, y):
                stack.append((x, y))

    removed = 0
    while stack:
        x, y = stack.pop()
        if seen[y][x] or not is_plate(x, y):
            continue
        seen[y][x] = True
        pixels[x, y] = (0, 0, 0, 0)
        removed += 1
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < width and 0 <= ny < height and not seen[ny][nx]:
                stack.append((nx, ny))

    return image, removed


def dilate_colour(image: Image.Image, steps: int = DILATION_STEPS) -> Image.Image:
    """Push the object's own RGB outward into its transparent ring, leaving alpha alone.

    Not a blur: a blur would move colour *inward* from the transparent side as well, which is the
    contamination this exists to prevent. Each step copies the nearest opaque neighbour's colour
    into a transparent pixel, and only into pixels whose colour nothing else has claimed.
    """
    a = np.asarray(image, dtype=np.uint8).copy()
    rgb, alpha = a[..., :3].astype(np.int16), a[..., 3]
    known = alpha > 0
    for _ in range(steps):
        if known.all():
            break
        # Four-neighbour dilation, done with shifts rather than a convolution so the *source*
        # pixel's colour is what lands rather than an average of a neighbourhood.
        filled = np.zeros_like(known)
        acc = np.zeros_like(rgb, dtype=np.int32)
        cnt = np.zeros(known.shape, dtype=np.int32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            sh_known = np.roll(known, (dy, dx), axis=(0, 1))
            sh_rgb = np.roll(rgb, (dy, dx), axis=(0, 1))
            take = sh_known & ~known
            acc[take] += sh_rgb[take]
            cnt[take] += 1
            filled |= take
        touched = cnt > 0
        rgb[touched] = (acc[touched] // cnt[touched][:, None]).astype(np.int16)
        known |= filled
    a[..., :3] = np.clip(rgb, 0, 255).astype(np.uint8)
    return Image.fromarray(a, "RGBA")


def floor_alpha(image: Image.Image, floor: float = ALPHA_FLOOR) -> tuple[Image.Image, int]:
    """Zero every pixel under `floor` alpha. Returns the image and how many were cleared.

    **⚠ The comparison is done in the same units `verify:mattes` does it in, and the first version
    was not.** That check reads `data[i] / 255 < ALPHA_FLOOR`, i.e. it fails any byte under 15.3;
    this cleared `byte < round(floor * 255)`, i.e. under 15. A single alpha value — exactly 15 —
    therefore survived the build and failed the check, and it did so on six of the sixteen files in
    the first run while the other ten passed, which reads exactly like a defect in the sprites
    rather than an off-by-one in the boundary.

    Compared as floats against the same constant, so the two cannot disagree again.
    """
    a = np.asarray(image, dtype=np.uint8).copy()
    cut = (a[..., 3] > 0) & (a[..., 3].astype(np.float32) / 255.0 < floor)
    a[..., 3][cut] = 0
    return Image.fromarray(a, "RGBA"), int(cut.sum())


def trim(image: Image.Image) -> Image.Image:
    """Crop to the alpha bounding box. The SUBJECT supplies the delivered proportion."""
    box = image.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
    return image.crop(box) if box else image


def count_soft(image: Image.Image) -> int:
    a = np.asarray(image)[..., 3]
    return int(((a > 0) & (a < 255)).sum())


def process(
    image: Image.Image,
    long_side: int,
    desaturate: float = 0.0,
    guard_threat: bool = True,
    colors: int = COLORS,
    strip_background: bool = False,
    key_rgb: tuple[int, int, int] | None = None,
) -> tuple[Image.Image, dict]:
    """The shared chain. See the module docstring for why the order is what it is."""
    image = image.convert("RGBA")

    # **Before the trim and long before the downscale.** The plate fades out along the frame edge,
    # so removing it at full resolution lets the resample build the new soft edge out of real
    # transparency; doing it afterwards would be cutting a shape out of already-blended pixels.
    # Before the trim as well, because the trim crops to the alpha box — and the plate IS opaque,
    # so trimming first would crop to the plate rather than to the subject.
    plate_px = 0
    if strip_background:
        image, plate_px = strip_plate(image, key_rgb)

    image = trim(image)
    image = dilate_colour(image)

    scale = long_side / max(image.size)
    if scale < 1:
        image = image.resize(
            (max(1, round(image.width * scale)), max(1, round(image.height * scale))),
            Image.LANCZOS,
        )

    image, floored = floor_alpha(image)
    # **⚠ TRIMMED AGAIN, AFTER THE FLOOR, AND THIS IS WHY THINGS FLOATED.** The first trim runs on
    # the raw matte, where a soft cast shadow survives at a few percent alpha — so the crop box
    # INCLUDED it. `floor_alpha` then cleared those pixels, leaving a band of genuinely empty rows
    # along the bottom of a canvas already sized to hold them. A billboard is bottom-anchored, so
    # the game planted the empty band on the ground and the prop hovered above it. Measured across
    # the set: 9 of 52 decor sprites carried up to 12 empty rows, i.e. 9.9% of their own height.
    image = trim(image)
    soft_before = count_soft(image)

    alpha = image.getchannel("A")
    rgb = image.convert("RGB")
    if desaturate > 0:
        rgb = Image.blend(rgb, rgb.convert("L").convert("RGB"), desaturate)

    quantised = rgb.quantize(colors=colors, method=Image.MEDIANCUT)
    # Applied to the PALETTE of the already-quantised image, not to its pixels. Correcting pixels
    # before the quantiser does not survive it (every pixel is mapped to its nearest palette entry
    # afterwards, walking the corrections straight back in); correcting them after forces an RGB
    # save and costs the palette. Correcting the palette makes every pixel legal by construction.
    moved = enforce_threat_reservation_palette(quantised) if guard_threat else 0

    out = quantised.convert("RGB")
    out.putalpha(alpha)
    # **Last, after the quantiser.** What ships is then a fixed point of its own flood, which is
    # exactly what `verify:mattes` asserts and what the engine's mipmap chain needs.
    out = dilate_colour(out)

    return out, {
        "size": list(out.size),
        "aspect": round(out.width / out.height, 3),
        "platePx": plate_px,
        "flooredPx": floored,
        "threatMoved": moved,
        "softPx": (soft_before, count_soft(out)),
    }


# ── The four families ───────────────────────────────────────────────────────


def _pick(slot: str) -> Path | None:
    """The picked render for a slot, or None if it has not been chosen yet."""
    variant = PICKS.get(slot)
    if not variant:
        return None
    for src in SOURCES:
        path = src / f"{variant}.png"
        if path.exists():
            return path
    return None


def _key_rgb(src: Path) -> tuple[int, int, int] | None:
    """The plate colour the generator MEASURED off this render's own border ring.

    Written into every sidecar as `keyColor` by `gen_rail_sprites._deliver`. Reading it here is
    what makes `strip_plate` a per-sprite test rather than a global threshold — the field drifts
    from #838280 to #a3a3ab across this set, and a constant that covers both also covers a lot of
    grey stone that is the subject.
    """
    meta = src.with_suffix(".json")
    if not meta.exists():
        return None
    value = json.loads(meta.read_text(encoding="utf-8")).get("keyColor")
    if not isinstance(value, str) or not value.startswith("#") or len(value) != 7:
        return None
    return tuple(int(value[i : i + 2], 16) for i in (1, 3, 5))


def build_decor(slots: list[str], report: list) -> None:
    out_dir = ASSETS / "decor"
    out_dir.mkdir(parents=True, exist_ok=True)
    for slot in slots:
        src = _pick(slot)
        if src is None:
            report.append((slot, "SKIPPED — no pick"))
            continue
        image, meta = process(
            Image.open(src),
            LONG_SIDE["decor"],
            desaturate=DESATURATE,
            strip_background=True,
            key_rgb=_key_rgb(src),
        )
        dst = out_dir / f"{slot}.png"
        image.save(dst, "PNG", optimize=True)
        report.append((slot, f"{dst.stat().st_size // 1024}KB {meta['size'][0]}x{meta['size'][1]} "
                             f"aspect {meta['aspect']} plate {meta['platePx']} "
                             f"threat {meta['threatMoved']}"))


# The obstacle slot in the renders, and the texture key the game declares for it.
# `obstacleTextureKey(kind, seed)` builds `obstacle-<kind>-<variant>`, so these are the six keys
# `OBSTACLE_TEXTURE_KEYS` enumerates and the loader will ask for by exactly this name.
OBSTACLE_KEYS = {
    "obs_low_0": "obstacle-low-0",
    "obs_low_1": "obstacle-low-1",
    "obs_low_2": "obstacle-low-2",
    "obs_block_0": "obstacle-blocking-0",
    "obs_block_1": "obstacle-blocking-1",
    "obs_over_0": "obstacle-overhead-0",
}


def build_obstacles(report: list) -> None:
    out_dir = ASSETS / "obstacle"
    out_dir.mkdir(parents=True, exist_ok=True)
    for slot, key in OBSTACLE_KEYS.items():
        src = _pick(slot)
        if src is None:
            report.append((slot, "SKIPPED — no pick"))
            continue
        # **Not desaturated at all, unlike the decor.** An obstacle is never tinted: `biomes.ts`
        # multiplies scenery by its biome's colour so a forest reads as a forest, and an obstacle
        # that took the same tint would be a rock the same colour as the bush beside it. The whole
        # job of this family is to separate from the scenery instantly.
        image, meta = process(
            Image.open(src),
            LONG_SIDE["obstacle"],
            desaturate=0.0,
            strip_background=True,
            key_rgb=_key_rgb(src),
        )
        dst = out_dir / f"{key}.png"
        image.save(dst, "PNG", optimize=True)
        report.append((key, f"{dst.stat().st_size // 1024}KB {meta['size'][0]}x{meta['size'][1]} "
                            f"aspect {meta['aspect']} plate {meta['platePx']} "
                            f"threat {meta['threatMoved']}"))


PICKUP_KEYS = {
    "pick_boost": "pickup-boost",
    "pick_shield": "pickup-shield",
    "pick_coin": "pickup-coin",
}

# The shared backing disc, as fractions of the delivered canvas. Colour and alpha are the
# procedural `pickupArt.ts` disc's own, so art-backed and drawn pickups sit on the same plate.
DISC_RADIUS = 0.49
# **Tuned by looking at it in the running game, and the first values were wrong by a lot.** At
# alpha 205 over a 0.72 glyph fit, a coin passing the camera read as a dark hole in the road with
# something small inside it: the plate was the object and the glyph was its decoration, which is
# the exact inversion of what the plate is for. A backing disc's whole job is to be the thing you
# do NOT look at.
DISC_FILL = (26, 28, 26, 140)
DISC_RIM = (250, 250, 245, 215)
DISC_RIM_WIDTH = 0.03
# How much of the disc the glyph is allowed to cover. Under 1 by a real margin either way: the
# plate only does its job if a ring of it survives all the way round the glyph at the 13px a
# portrait phone delivers, and the glyph only does its job if it is what the eye lands on.
GLYPH_FIT = 0.86


def build_pickups(report: list) -> None:
    """The three pickups, each composited onto ONE shared dark backing disc.

    **The disc is drawn here rather than rendered, and that is the whole reason it exists.** A
    pickup has to separate from grey road, green grass and pale sand, and the nine biomes make
    every one of those the background at some point; one dark plate does that everywhere. Its job
    is therefore to be IDENTICAL on all three, which three independently rendered discs cannot be —
    the generation round that asked for it in the prompt returned none at all, and would have
    returned three different ones if it had. Drawing it costs nothing and gets it exactly right.
    """
    out_dir = ASSETS / "pickup"
    out_dir.mkdir(parents=True, exist_ok=True)
    size = LONG_SIDE["pickup"]

    for slot, key in PICKUP_KEYS.items():
        src = _pick(slot)
        if src is None:
            report.append((slot, "SKIPPED — no pick"))
            continue

        glyph, meta = process(Image.open(src), round(size * GLYPH_FIT), desaturate=0.0)

        # Supersampled 4x, then reduced: the disc's rim is a circle a couple of pixels wide at
        # 128px, and `ImageDraw.ellipse` has no antialiasing of its own.
        ss = 4
        plate = Image.new("RGBA", (size * ss, size * ss), (0, 0, 0, 0))
        d = ImageDraw.Draw(plate)
        r = DISC_RADIUS * size * ss
        cx = cy = size * ss / 2
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=DISC_FILL,
                  outline=DISC_RIM, width=max(1, round(DISC_RIM_WIDTH * size * ss)))
        plate = plate.resize((size, size), Image.LANCZOS)

        # The glyph is fitted to the disc's inner circle by its own longest side, so a tall shape
        # and a wide one both end up inside the ring rather than one of them overflowing it.
        fit = round(size * GLYPH_FIT)
        scale = fit / max(glyph.size)
        if scale < 1:
            glyph = glyph.resize(
                (max(1, round(glyph.width * scale)), max(1, round(glyph.height * scale))),
                Image.LANCZOS,
            )
        plate.alpha_composite(glyph, ((size - glyph.width) // 2, (size - glyph.height) // 2))

        dst = out_dir / f"{key}.png"
        plate.save(dst, "PNG", optimize=True)
        report.append((key, f"{dst.stat().st_size // 1024}KB {size}x{size} "
                            f"glyph {glyph.width}x{glyph.height} threat {meta['threatMoved']}"))


# ── The mascot: six frames from one render ──────────────────────────────────

SNAIL_FRAMES = 6

# How far the wave displaces the foot, as a fraction of the sprite's height, and how many
# wavelengths run along it. Both are the procedural `snailArt.ts` cycle's own numbers, so the
# art-backed animation is the same motion the game was tuned with rather than a new one.
WAVE_AMPLITUDE = 0.022
WAVE_LENGTHS = 3.0
# The wave acts on the bottom of the sprite and dies out upward. Above this fraction of the
# height nothing moves at all, which is what keeps the shell rigid — a shell that rippled would
# read as jelly, and the shell is the one part of a snail that cannot deform.
WAVE_REACH = 0.42


def _glide_frame(base: Image.Image, phase: float) -> Image.Image:
    """One frame of the glide cycle: a travelling wave along the foot, nothing else.

    **Six frames from ONE render, and that is not a shortcut.** Six independent diffusion renders
    are six different snails — the checkpoint holds no character identity across seeds, and this
    is the one object in the game whose identity is the entire point. Deriving the cycle from a
    single hero makes the art and the animation the same object by construction, which is also the
    rule the rest of this project follows for the drawn footprint and the collision box.

    The deformation is a per-row horizontal shear whose amplitude falls to zero by `WAVE_REACH`,
    i.e. exactly what `snailArt.ts` draws into its own six frames: the silhouette's bottom edge
    ripples and nothing else has to. A snail has no legs and no gait, which is most of why the
    mascot is a snail — this ripple IS the character animation.
    """
    a = np.asarray(base, dtype=np.uint8)
    h, w = a.shape[:2]
    out = np.zeros_like(a)
    amp = WAVE_AMPLITUDE * h

    for y in range(h):
        # 0 at the top of the wave's reach, 1 at the very bottom of the sprite.
        depth = (y / max(1, h - 1) - (1.0 - WAVE_REACH)) / WAVE_REACH
        if depth <= 0:
            out[y] = a[y]
            continue
        # Squared rather than linear, so the foot's own edge carries almost all of the motion and
        # the body above it is only barely disturbed. A linear falloff reads as the whole animal
        # swaying, which is a different and much worse animation.
        shift = int(round(math.sin(depth * math.pi * WAVE_LENGTHS - phase) * amp * depth * depth))
        if shift == 0:
            out[y] = a[y]
        elif shift > 0:
            out[y, shift:] = a[y, : w - shift]
        else:
            out[y, :shift] = a[y, -shift:]

    return Image.fromarray(out, "RGBA")


def build_snail(report: list) -> None:
    src = _pick("snail_hero")
    if src is None:
        report.append(("snail_hero", "SKIPPED — no pick"))
        return

    out_dir = ASSETS / "snail"
    out_dir.mkdir(parents=True, exist_ok=True)

    hero = Image.open(src).convert("RGBA")
    # **Mirrored to face left, matching the game's own procedural mascot.** `snailArt.ts` puts the
    # eye stalks at x 0.19 and 0.30 and runs the foot rightward from x 0.04, i.e. head left. The
    # direction is otherwise arbitrary — the snail runs away from the camera, so a profile faces
    # neither toward nor away — but it is not arbitrary that the art and the fallback agree, since
    # a missing PNG drops the game back to the drawn version mid-session.
    hero = hero.transpose(Image.FLIP_LEFT_RIGHT)

    base, meta = process(hero, LONG_SIDE["snail"], desaturate=0.0)

    for i in range(SNAIL_FRAMES):
        frame = _glide_frame(base, 2 * math.pi * i / SNAIL_FRAMES)
        # The wave shears rows sideways, which can push a pixel past the edge and leave a column
        # of nothing behind it. Re-flooding closes that the same way it closes the matte.
        frame = dilate_colour(frame, 1)
        dst = out_dir / f"snail-{i}.png"
        frame.save(dst, "PNG", optimize=True)

    total = sum((out_dir / f"snail-{i}.png").stat().st_size for i in range(SNAIL_FRAMES))
    report.append(("snail-0..5", f"{total // 1024}KB total  {meta['size'][0]}x{meta['size'][1]} "
                                 f"aspect {meta['aspect']} threat {meta['threatMoved']}"))


# ── Entry point ─────────────────────────────────────────────────────────────

# ── The skyline strip ───────────────────────────────────────────────────────
#
# **⚠ NOT A PROP, AND THREE ROUNDS WERE SPENT LEARNING THAT.** These three ranges shipped first as
# ordinary billboards in the decor pool's far tier, which cannot work: everything standing on the
# ground in this projection eventually arrives at the camera, so a mountain approached, filled half
# the frame and slid off the edge. Moving it further out only made it exit sooner; fading it out
# before it could grow made it dissolve dead ahead, which is worse -- the player is looking right at
# it. What a range needs is to not approach at all, and the object that already does that here is a
# `TileSprite` in `Backdrop`, scrolled by texture offset.
#
# So the three renders are composited ONCE, at build time, into a single strip that wraps
# horizontally, and the game draws that strip above the horizon and scrolls it with the camera's
# lateral drift. Zero per-frame cost beyond one more tiled quad, and no billboard to go wrong.
SKYLINE_SLOTS = ["mtn_peaks", "mtn_hills", "mtn_crags"]

# **Wide, because the only thing that gives a tiled strip away is seeing two copies at once.**
#
# At 2048 the tile came out about 1240 screen px against a 1568px frame -- so the frame held one
# whole copy plus a quarter of the next, and the quarter is the same peaks again. At 3072 the tile
# is ~1860px, wider than the frame, so at most a sliver of the second copy is ever visible. The row
# counts scale with the width so the peaks stay the same size and the horizon the same density.
SKYLINE_SIZE = (3072, 384)

# Three rows, back to front, each hazed towards the sky. **Aerial perspective is the whole reason
# there is more than one row**: a single row of silhouettes is a cardboard cut-out, and what says
# "kilometres" is that the row behind is paler and smaller rather than merely further up.
#  (scale, haze towards white, how far the row's feet sit above the strip's base, count)
SKYLINE_ROWS = [
    (0.62, 0.55, 0.07, 20),
    (0.82, 0.30, 0.03, 15),
    (1.00, 0.10, 0.00, 12),
]

SKYLINE_SEED = 5150

# Transparent rows left along the BOTTOM of the strip.
#
# **A `TileSprite` tiles in both axes, and the layer is exactly one tile tall — so the filter
# samples across the wrap at the top edge and blends the texture's last row into its first.** With
# the range's feet on the last row that put a faint dark line right across the sky, a couple of
# hundred pixels above the horizon. Clearing the bottom rows makes that blend transparent against
# transparent. The feet lose eight pixels of a strip that is buried under the ground anyway.
SKYLINE_FOOT_PAD = 8


def build_skyline(report: list) -> None:
    """Composites the three ranges into one horizontally-wrapping strip."""
    out_dir = ASSETS / "sky"
    out_dir.mkdir(parents=True, exist_ok=True)

    sources = []
    for slot in SKYLINE_SLOTS:
        src = _pick(slot)
        if src is None:
            continue
        image, _ = process(
            Image.open(src),
            LONG_SIDE["decor"],
            desaturate=DESATURATE,
            strip_background=True,
            key_rgb=_key_rgb(src),
        )
        sources.append(image)

    if not sources:
        report.append(("skyline", "SKIPPED — no picks"))
        return

    width, height = SKYLINE_SIZE
    strip = Image.new("RGBA", SKYLINE_SIZE, (0, 0, 0, 0))
    rng = random.Random(SKYLINE_SEED)

    for scale, haze, lift, count in SKYLINE_ROWS:
        # Evenly spaced with a jitter under half the spacing, rather than a free roll: a free roll
        # clumps, and a clump on a horizon is a gap somewhere else -- which is the one thing a strip
        # meant to be continuous may not have.
        spacing = width / count
        for i in range(count):
            art = sources[rng.randrange(len(sources))]
            if rng.random() < 0.5:
                art = art.transpose(Image.FLIP_LEFT_RIGHT)

            size = scale * (0.85 + rng.random() * 0.3)
            peak = Image.new("RGBA", art.size, (0, 0, 0, 0))
            peak.paste(_hazed(art, haze), (0, 0), art)
            peak = peak.resize(
                (max(1, round(art.width * size)), max(1, round(art.height * size))),
                Image.LANCZOS,
            )

            x = round(i * spacing + (rng.random() - 0.5) * spacing * 0.8)
            y = height - SKYLINE_FOOT_PAD - peak.height - round(height * lift)

            # Drawn again a strip-width either side, so anything crossing the seam appears on both
            # edges. That -- not a mirrored half -- is what makes the tile actually wrap.
            for dx in (-width, 0, width):
                strip.alpha_composite(peak, (x + dx, y))

    # **Quantised, for the same reason the sky plates are.** The strip is 2048x384 of flat cel
    # bands, so the palette is nearly all of the file: full RGBA it saves at 391KB, and at 64
    # colours it is a fraction of that with nothing visible lost at the size a horizon is read.
    # The alpha is carried across untouched -- the quantiser must never see it, or it spends
    # palette entries on transparency.
    alpha = strip.getchannel("A")
    flat = strip.convert("RGB").quantize(colors=COLORS, method=Image.MEDIANCUT)
    enforce_threat_reservation_palette(flat)
    strip = flat.convert("RGB")
    strip.putalpha(alpha)
    # Last, so what ships is a fixed point of its own flood -- what `verify:mattes` asserts.
    strip = dilate_colour(strip)
    strip.save(out_dir / "skyline.png", "PNG", optimize=True)
    report.append(("skyline", f"{(out_dir / 'skyline.png').stat().st_size // 1024}KB "
                              f"{width}x{height} from {len(sources)} ranges"))


def _hazed(image: Image.Image, amount: float) -> Image.Image:
    """Mixes a sprite towards the haze colour, for the rows that stand further back."""
    if amount <= 0:
        return image
    veil = Image.new("RGBA", image.size, SKYLINE_HAZE)
    return Image.blend(image.convert("RGBA"), veil, amount)


# A cool near-white rather than plain white: haze is the sky seen through, and every theme's sky is
# blue-ish at the horizon. Pure white would make the back row read as snow.
SKYLINE_HAZE = (206, 216, 228, 255)

BIOME_SLOTS = {
    "forest": ["for_pine", "for_birch", "for_fern", "for_mushroom", "for_bramble", "for_boulder"],
    "dunes": ["dune_rock", "dune_grass", "dune_cactus", "dune_bone", "dune_shrub", "dune_spire"],
    "wetland": ["wet_reeds", "wet_stump", "wet_lily", "wet_willow", "wet_log", "wet_cattail"],
    "ridge": ["rid_scree", "rid_monolith", "rid_arch", "rid_cairn", "rid_lichen", "rid_snag"],
    "ashen": ["ash_stump", "ash_slab", "ash_spar", "ash_vent", "ash_scrub", "ash_mound"],
    "fungal": ["fun_tall", "fun_dome", "fun_cluster", "fun_pair", "fun_wide"],
    "crystal": ["cry_cluster", "cry_geode", "cry_bloom", "cry_pillar", "cry_slab", "cry_shard"],
    "coast": ["coa_stack", "coa_kelp", "coa_palm", "coa_reef", "coa_drift", "coa_shell"],
    "ruins": ["rui_rubble", "rui_column", "rui_wall", "rui_arch", "rui_statue", "rui_obelisk"],
}


def load_picks() -> None:
    """PICKS from `dev-assets/picks.json`, so choosing a variant is a data edit.

    The parent project kept its table inline in this file, which meant every re-pick was a code
    change to the build step. Keeping it beside the renders means the file that records what was
    chosen sits next to the things it chose between.
    """
    path = SOURCES[0].parent / "picks.json"
    if path.exists():
        PICKS.update(json.loads(path.read_text(encoding="utf-8")))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="", help="comma-separated: snail,obstacles,pickups,decor")
    args = ap.parse_args()
    families = [f.strip() for f in args.only.split(",") if f.strip()] or [
        "snail", "obstacles", "pickups", "decor"
    ]

    load_picks()
    if not PICKS:
        print("No picks recorded — write dev-assets/picks.json first.")
        return

    report: list = []
    if "snail" in families:
        build_snail(report)
    if "obstacles" in families:
        build_obstacles(report)
    if "pickups" in families:
        build_pickups(report)
    if "decor" in families:
        for slots in BIOME_SLOTS.values():
            build_decor(slots, report)
        build_skyline(report)

    width = max(len(name) for name, _ in report) if report else 0
    for name, line in report:
        print(f"  {name:{width}s}  {line}")
    skipped = sum(1 for _, line in report if line.startswith("SKIPPED"))
    print(f"\n{len(report) - skipped} written, {skipped} skipped.")


if __name__ == "__main__":
    main()
