"""
normalize-critter.py  Supplied creature art, brought to the billboard contract.

  py -3.11 scripts/normalize-critter.py --slot frog --world-height 343 \
      --pose "ground=references/frog 1.jpg" --pose "air=references/frog 4.jpg"

  py -3.11 scripts/normalize-critter.py --slot frog --measure \
      --pose "ground=references/frog 1.jpg" --pose "air=references/frog 4.jpg"

What "the billboard contract" means, and every one is a defect if it is not
held:

  ONE CONTOUR THICKNESS       around the whole silhouette AND across every pose
                              of the kind. A contour that is thinner on the face
                              than on the legs, or thinner in the air than on
                              the ground, reads as two different drawings.
  NO LIGHT HALO               at the alpha edge, or `verify:mattes` fails it --
                              for a real reason: a pale fringe is what a
                              supplied render's background leaves behind and it
                              draws as a glow at every mipmap level.
  THE BASE ON THE BOTTOM ROW  for a GROUNDED pose. `billboardRectInto` treats
                              the sprite's y as the point of CONTACT, so an
                              empty band under the feet is planted on the ground
                              and the creature hovers.
  NO UPSCALE                  the delivered size is never larger than the
                              content the source actually carries.

-- The contour is REBUILT, not thinned ------------------------------------

Equalising by eroding the thick parts would leave the thin parts thin. This
takes the artwork inside the contour (`core`), dilates it by the target
thickness, and paints the ring as ink:

    core          = the drawing, with its own contour and the halo removed
    contour       = dilate(core, T) - core
    silhouette    = dilate(core, T)

So the thickness is T everywhere by construction. What it costs is that where
the original contour was thicker than T the silhouette shrinks by the
difference -- which is the point.

⚠ The dilation is a thresholded EUCLIDEAN distance, never `binary_dilation`
with an iteration count. A 4-connected element applied n times grows a DIAMOND
-- n along the axes, n/sqrt(2) on the diagonals -- and the first version
delivered 14 px across the top of the head against 9.4 px on every slope, i.e.
the defect this function exists to remove, reintroduced by the tool used to
remove it.

-- ⚠ A KIND'S POSES ARE NORMALISED TOGETHER, AND THAT IS THE WHOLE POINT ----

Two poses of one creature are not two sprites. They are the same animal, and
two things have to survive between them or the swap in flight is visible:

  THE CREATURE'S SCALE. The supplied poses are NOT drawn at the same size --
  measured on the frog, the tucked pose is at 0.67 of the crouch's scale (eye
  span 288 px against 431). Scaling each to its own long side would deliver a
  frog that changes size the instant it leaves the ground. So one delivery
  scale is derived from a LANDMARK that is rigid on the character -- the eyes
  -- and every pose is scaled to put that landmark at the same size.

  THE CONTOUR, IN ABSOLUTE PIXELS. `INK_FRACTION` is a fraction of a sprite's
  own geometric mean, which is right for setting a KIND's line weight and wrong
  for a pose: a more compact pose has a smaller geometric mean and would get a
  thinner line, on the same animal. So the fraction is evaluated once on the
  reference pose and the resulting pixel count is applied to all of them.

-- The anchor: what the pose swap is aligned on ----------------------------

A grounded pose is placed by its feet, because its feet are on the ground. An
airborne pose has no feet on the ground, so it is placed by an ANCHOR -- and
this file measures two candidates for every pose and writes both, because they
disagree and the disagreement is the interesting part:

  eyes      a rigid landmark on the character. Aligning on it keeps the BODY
            where it was and lets the mass shift, which is what actually
            happens when a frog tucks its legs.
  centroid  the alpha centre of mass. Aligning on it keeps the mass continuous
            and moves the body, because the centroid is not a physical point on
            the creature -- tucking the legs is precisely what moves it.

Which one the engine uses is `critterJump.ts`'s decision; what belongs here is
the measurement of both.

-- ⚠ The delivered pixel size is a RESOLUTION, not worldUnits / SPRITE_SCALE --

That identity is the DECOR contract, where `RoadSprites` derives the world size
FROM the texture. A critter is the other way round: `CritterSprites` takes the
world box from `CRITTER_KINDS` and calls `setDisplaySize(rect.w, rect.h)`, i.e.
it STRETCHES the texture onto that box. So the texture's size only decides how
sharp the creature is, and applying the decor identity here would deliver the
frog at 662/10 x 343/10 = 63x34 px against an on-screen width near 400 px at
closest approach -- a six-fold upscale on the one frame the player is looking
at it.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

sys.path.insert(0, str(Path(__file__).resolve().parent))

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "public" / "assets" / "critter"
QA_DIR = ROOT / "dev-assets" / "critter" / "qa"
MANIFEST = ROOT / "dev-assets" / "critter" / "critter-art.json"

# The long side every shipped critter already uses, applied to the REFERENCE
# pose. See the docstring for why this is not derived from the world box.
TARGET_LONG = 384

# ART-STYLE.md's number: the contour as a fraction of the sprite's own
# sqrt(width * height). Evaluated on the reference pose and then applied to the
# whole kind in absolute pixels -- see the docstring.
INK_FRACTION = 0.0141

INK_LUMA_MAX = 70
BG_MIN_VALUE = 190
BG_MAX_SAT = 26
HALO_PX = 3

# The landmark the poses are scaled against: this character's yellow irises.
# Rigid, unambiguous, and present in every pose of it. A kind whose eyes are not
# a separable colour needs a landmark of its own -- there is no general one, and
# guessing would be worse than being told.
EYE_MIN_R, EYE_MIN_G, EYE_MAX_B = 200, 150, 110


def _build_sprites_module():
    """`floor_alpha`, `trim` and `dilate_colour` -- imported, never re-typed."""
    spec = importlib.util.spec_from_file_location(
        "build_sprites", ROOT / "scripts" / "build-sprites.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# Above this recovered opacity a part is taken to be opaque and left exactly as drawn. Not 1,
# because a JPEG leaves high-frequency noise of its own, so an opaque body scores a little under.
CHECKER_MAX_OPACITY = 0.92
# How far from ink a pixel must be before the checker is read off it. A window is a whole checker
# period wide, so a pixel nearer than this has a vein inside its own local mean.
CHECKER_CLEAR_PX = 8
# Below this many pixels the correlation is noise rather than a measurement.
CHECKER_MIN_SAMPLE = 2000
# How near one of the background's two values a pixel must be to count as that level, and how
# much of an enclosed region must sit at EACH of them before it is read as a gap the checker
# shows through rather than as something painted. See `checker_holes`.
CHECKER_LEVEL_TOLERANCE = 10.0
CHECKER_HOLE_LEVEL_SHARE = 0.2
CHECKER_HOLE_MIN_PX = 200


def luma(a: np.ndarray) -> np.ndarray:
    return 0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]


def cut_background(rgb: np.ndarray) -> np.ndarray:
    """Alpha from a light, near-neutral, border-connected background."""
    sat = rgb.max(2) - rgb.min(2)
    plate = (sat < BG_MAX_SAT) & (rgb.min(2) > BG_MIN_VALUE)
    labels, _ = ndimage.label(plate)
    edge = set(
        np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))
    ) - {0}
    return ~np.isin(labels, list(edge))


def background_plate(rgb: np.ndarray) -> np.ndarray:
    """The border-connected background, when that background is a transparency CHECKER.

    `cut_background`'s two rules are right for a flat plate and both fail on a checker, which is
    what these three insects are supplied on:

    * **The value floor is fixed at `BG_MIN_VALUE`, and a checker has two levels.** Measured in a
      clean corner, the dark square sits at grey 184-196 against a floor of 190 on the *minimum*
      channel -- so the bee kept most of its dark squares, the hornet some, and the mosquito none.
      The floor here is read from the image's own border ring instead, which is background by
      definition whatever it is made of.
    * **`ndimage.label` is 4-connected, and same-parity squares touch only at their corners.** So
      even below the floor the dark squares form islands that reach no border and cannot be flooded
      from one. Eight-connectivity is what makes a checker one region.

    Under those two, the mosquito's "subject" was its drawing plus every dark square in the frame --
    fifteen stray components of 500-900 px each -- and the "background" was a field of light squares
    whose local mean is itself, so the checker's own residual measured 4.7 where the bee's was 20.

    ⚠ This deliberately does NOT replace `cut_background`. That is the billboard contract every
    critter is delivered under and the frog was normalised against it; this is the key for one
    supplied background, used where that background is present.
    """
    grey = rgb.mean(axis=2)
    sat = rgb.max(2) - rgb.min(2)
    ring = np.zeros(grey.shape, bool)
    ring[:3] = ring[-3:] = True
    ring[:, :3] = ring[:, -3:] = True
    neutral = sat < BG_MAX_SAT
    seen = grey[ring & neutral]
    # Below the darkest thing the border actually shows, with room for the JPEG -- but never near
    # ink, or a dark drawing touching the frame would flood the whole subject away.
    floor = (
        max(INK_LUMA_MAX + 40.0, float(np.percentile(seen, 1)) - 10.0)
        if seen.size > 200
        else float(BG_MIN_VALUE)
    )
    labels, _ = ndimage.label(neutral & (grey > floor), structure=np.ones((3, 3)))
    edge = set(
        np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))
    ) - {0}
    return np.isin(labels, list(edge))


def checker_holes(rgb: np.ndarray, plate: np.ndarray) -> np.ndarray:
    """Gaps in the drawing that the checker shows through, and that no border flood can reach.

    **⚠ Found by looking at the delivered hornet.** Between its abdomen and its legs the drawing
    leaves two enclosed openings, and the transparency checker is visible through them -- so they
    are background, and they are surrounded on every side by artwork. `background_plate` floods from
    the frame's edge, which is what makes it safe, and it is exactly what stops it reaching these:
    they shipped as two opaque patches of chequered grey on the insect's own body.

    ⚠ They cannot be found by "enclosed, neutral and bright", because that is also a description of
    the hornet's WHITE ARMOUR PLATES, which are enclosed, neutral, bright and very much part of the
    drawing. What separates them is the one thing a checker does and a plate does not: it has TWO
    levels. A region is a hole when a real share of it sits at each of the background's own two
    values; a painted plate puts everything at one.
    """
    grey = rgb.mean(axis=2)
    sat = rgb.max(2) - rgb.min(2)
    if plate.sum() < 500:
        return np.zeros(grey.shape, bool)

    vals = grey[plate]
    lo, hi = float(np.percentile(vals, 5)), float(np.percentile(vals, 95))
    if hi - lo < 8:
        return np.zeros(grey.shape, bool)

    candidate = (sat < BG_MAX_SAT) & (grey > lo - CHECKER_LEVEL_TOLERANCE) & ~plate
    labels, n = ndimage.label(candidate, structure=np.ones((3, 3)))
    holes = np.zeros(grey.shape, bool)

    for index in range(1, n + 1):
        region = labels == index
        if region.sum() < CHECKER_HOLE_MIN_PX:
            continue
        g = grey[region]
        dark = float(np.mean(np.abs(g - lo) <= CHECKER_LEVEL_TOLERANCE))
        light = float(np.mean(np.abs(g - hi) <= CHECKER_LEVEL_TOLERANCE))
        if min(dark, light) >= CHECKER_HOLE_LEVEL_SHARE:
            holes |= region

    return holes


def contour_thickness(alpha: np.ndarray, core: np.ndarray) -> np.ndarray:
    """Thickness of the outer contour, all the way round the silhouette.

    At a pixel on the silhouette's own edge the distance to the nearest piece of
    artwork IS the contour's thickness there -- the contour is by definition the
    band between the two. Measured this way rather than from the ink mask's
    medial axis, which also picks up every interior line.
    """
    d_core = ndimage.distance_transform_edt(~core)
    edge = alpha & ~ndimage.binary_erosion(alpha, np.ones((3, 3)))
    return d_core[edge]


def eye_mask(rgb: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    return (
        alpha
        & (rgb[..., 0] > EYE_MIN_R)
        & (rgb[..., 1] > EYE_MIN_G)
        & (rgb[..., 2] < EYE_MAX_B)
    )


def read_pose(src: Path) -> dict:
    """Everything measured off one source, before any decision is taken."""
    rgb = np.asarray(Image.open(src).convert("RGB")).astype(int)
    alpha0 = cut_background(rgb)
    alpha = ndimage.binary_erosion(alpha0, np.ones((3, 3)), iterations=HALO_PX)
    ink = alpha & (luma(rgb) < INK_LUMA_MAX)
    core = alpha & ~ink
    eyes = eye_mask(rgb, alpha)
    ys, xs = np.nonzero(alpha)
    ex = np.nonzero(eyes)[1]
    return {
        "src": src,
        "rgb": rgb,
        "alpha": alpha,
        "ink": ink,
        "core": core,
        "eyes": eyes,
        "contour": contour_thickness(alpha, core),
        "content": (int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())),
        "eyeSpan": int(ex.max() - ex.min() + 1) if len(ex) else 0,
    }


def unmix_checker(
    rgb: np.ndarray, plate: np.ndarray, region: np.ndarray, ink: np.ndarray
) -> tuple[np.ndarray, float, dict]:
    """Undo a transparency checkerboard showing through one translucent part of a drawing.

    **⚠ Found by rendering the three flyers assembled and looking at them.** A wing is drawn
    semi-transparent, so the supplied JPEG shows the transparency checker THROUGH it -- and those
    squares are enclosed by the wing's own outline, so a border-connected background key cannot
    reach them. They shipped as opaque pixels of alternating grey.

    Over a square of value `C` the observed pixel is `O = a*W + (1-a)*C`. Recovering the artwork
    therefore needs `a`, and then `W` follows from a local mean taken over a whole period, where the
    checker averages to its own mean and drops out:

        W = (mean(O) - (1 - a) * mean(C)) / a

    Returns the repainted image, the ONE opacity that part is drawn at, and what was measured.

    ── ⚠ `a` is measured by CORRELATION at the checker's own period, and three cheaper tests failed

    Each failure says something about what a checker is, so they are worth keeping:

    * **Reconstructing the grid.** These are JPEGs whose squares are not an integer number of
      pixels, so a fixed grid drifts across the frame; the best phase fitted 0.54 of the background,
      which is a coin toss.
    * **A local high minus a local low, gated on the checker's amplitude.** The window has to span a
      whole period to see both parities -- 47 px here -- and at that size it nearly always also
      contains a vein or the wing's outline. Inside the bee's wing the swing runs 118-212 against a
      checker amplitude of 46, so 80% of the membrane was rejected as "drawing". The extremes of a
      window are a statement about the darkest thing in it.
    * **The spread of the residual after subtracting a period-wide local mean.** Better -- it does
      remove the membrane's own shading -- and still not a test *for a checker*, only for texture.
      The hornet's opaque body scored 0.53 and the mosquito's 0.45, i.e. both would have been
      dissolved into half-transparent ghosts.

    What a checker has that no part of a drawing has is **exact anti-correlation with itself one
    square away**, and correlation at a known lag is a matched filter: unrelated structure -- a
    vein, a stripe, an eye -- lands with a random sign and averages toward zero, while the checker
    lands with the same sign at every pixel. Measured against the bare checker's own power,

        a = 1 - sqrt(power over the part / power over the background)

    because the composite scales the checker's amplitude by `(1 - a)` and power goes as its square.
    A part with no checker through it scores zero or negative and comes back opaque with no special
    case -- which is what lets this be asked of *every* part rather than only of the one somebody
    has already decided is a wing. `normalize-flyer.py` uses exactly that to tell a wing from a
    body, having found the two swapped on the mosquito.

    Three lags are averaged: one square across, one square down (both anti-correlated) and one
    square diagonally (correlated, since the parity returns). Nothing needs the phase, so nothing
    has to survive the drift that defeated the grid fit.

    ── The estimate is taken well clear of ink, and the sample is what limits it ───────────────────

    A vein's own soft edge is not dark enough to be ink, and the local mean is unreliable within a
    window of one, so the estimate runs only over membrane more than `CHECKER_CLEAR_PX` from any
    ink. Measured on the bee's wing, that is the difference between an answer and no answer at all:
    at 0 px clear the power is -117 (no checker detectable), at 8 px it is +60, at 12 px +117.

    Every mean is **masked**, so ink never averages into a membrane: a vein cannot darken the
    colour recovered around it, and the wing's own outline stays exactly as drawn.
    """
    if plate.sum() < 500 or region.sum() < 500:
        return (rgb, 1.0, {"found": False, "reason": "nothing to read"})

    vals = rgb[plate].reshape(-1, 3).mean(axis=1)
    lo, hi = float(np.percentile(vals, 5)), float(np.percentile(vals, 95))
    if hi - lo < 8:
        return (rgb, 1.0, {"found": False, "reason": "background is not a checker"})

    square = checker_square(rgb, plate, lo, hi)
    win = max(5, square * 2 + 1)
    grey = rgb.mean(axis=2)

    def masked_mean(values: np.ndarray, mask: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        m = mask.astype(float)
        cover = ndimage.uniform_filter(m, win)
        return ndimage.uniform_filter(values * m, win) / np.maximum(cover, 1e-6), cover

    def checker_power(mask: np.ndarray, sample: np.ndarray) -> tuple[float, int]:
        """How much of the residual over `sample` is the checker, in units of grey squared."""
        mean, cover = masked_mean(grey, mask)
        residual = (grey - mean) * mask
        ok = sample & (cover > 0.5)
        if ok.sum() < CHECKER_MIN_SAMPLE:
            return 0.0, int(ok.sum())

        h, w = residual.shape

        def at(dy: int, dx: int) -> float:
            a = residual[max(0, -dy) : h - max(0, dy), max(0, -dx) : w - max(0, dx)]
            b = residual[max(0, dy) : h - max(0, -dy), max(0, dx) : w - max(0, -dx)]
            va = ok[max(0, -dy) : h - max(0, dy), max(0, -dx) : w - max(0, dx)]
            vb = ok[max(0, dy) : h - max(0, -dy), max(0, dx) : w - max(0, -dx)]
            both = va & vb
            return float((a[both] * b[both]).mean()) if both.sum() >= CHECKER_MIN_SAMPLE else 0.0

        # One square across and one square down invert the parity; one square diagonally restores
        # it. Averaging the three is what makes a single noisy lag not the whole answer.
        return (-at(0, square) - at(square, 0) + at(square, square)) / 3, int(ok.sum())

    bare, _ = checker_power(plate, plate)
    if bare <= 0:
        return (rgb, 1.0, {"found": False, "reason": "background carries no checker"})

    membrane = region & ~ink
    clear = membrane & (ndimage.distance_transform_edt(~ink) > CHECKER_CLEAR_PX)
    power, sampled = checker_power(membrane, clear)
    if sampled < CHECKER_MIN_SAMPLE:
        return (
            rgb,
            1.0,
            {"found": False, "reason": "too little membrane clear of ink to read", "sampled": sampled},
        )

    alpha = float(np.clip(1.0 - np.sqrt(max(power, 0.0) / bare), 0.0, 1.0))
    info = {
        "square": square,
        "checkerPower": round(bare, 1),
        "partPower": round(power, 1),
        "sampled": sampled,
        "alpha": round(alpha, 3),
    }
    if alpha > CHECKER_MAX_OPACITY:
        return (
            rgb,
            1.0,
            {"found": False, "translucent": False, "reason": "opaque: no checker through this part", **info},
        )

    c_mean = rgb[plate].reshape(-1, 3).mean(axis=0)
    means = np.dstack(
        [masked_mean(rgb[..., ch].astype(float), membrane)[0] for ch in range(3)]
    )
    grey_mean = means.mean(axis=2)

    # ── ⚠ The membrane is DE-CHECKERED and shipped OPAQUE, and the inversion is not attempted ──
    #
    # The un-composite was built, shipped, and reported on sight: *"the bee is semi-transparent --
    # part of the stripes is yellow and part is the background behind them"*. That is exactly what a
    # wing at the opacity it is drawn at looks like over a road, and it is right about the drawing
    # and wrong about the game. A hazard the player can see the scenery through reads as a rendering
    # fault rather than as a wing -- which this project has now been told three times in three
    # places: the props that shipped 22-40% see-through, the pickups' white halo, and this. **A
    # transparency argued from the artwork is judged on the frame.**
    #
    # Removing the checker never needed the inversion anyway: the local mean is what takes the
    # pattern out and it needs no `a` at all. The opacity was only ever used to ask what the membrane
    # would look like over *nothing*, and the answer ships as what it looks like over the supplied
    # grey, which is a colour somebody chose.
    #
    # ⚠ And on two of the three it was never invertible. `O = a*W + (1-a)*C` has no non-negative
    # solution once `O` falls below `(1-a)*C`: the hornet's membrane averages **97 against a
    # transparent term of 111** and the mosquito's 115 against 121, so `W` came out at luma 1 and 11,
    # every pixel of both wings became ink, and the delivered sprites collapsed to **5x4 px**. Only
    # the bee could ever have shipped translucent, which is why only the bee was reported.
    #
    # The measurement is kept and still reported, because it is what tells a wing from a body:
    # `normalize-flyer.py` picks the part the checker shows *through*, and that stays a question
    # about translucency whatever is done with the answer afterwards.
    out = rgb.astype(float).copy()
    for ch in range(3):
        out[..., ch] = np.where(membrane, means[..., ch], out[..., ch])

    return out, 1.0, {"found": True, "translucent": False, **info}


def checker_square(rgb: np.ndarray, plate: np.ndarray, lo: float, hi: float) -> int:
    """The checker's square size, from run lengths across every clean background row.

    ⚠ Read over EVERY clean row, not the first one. Sampling one row put the mosquito's square
    at 703 -- its topmost clean row happens to cross barely two squares, so a median over its
    handful of runs is a number about that row rather than about the checker.
    """
    h, w = plate.shape
    runs: list[int] = []
    for y in range(0, h, 7):
        if plate[y].mean() < 0.9:
            continue
        row = rgb[y].mean(axis=1) > (lo + hi) / 2
        run, prev = 0, bool(row[0])
        for v in row:
            if bool(v) == prev:
                run += 1
            else:
                runs.append(run)
                run, prev = 1, bool(v)
    runs = [r for r in runs if r > 2]
    square = int(round(float(np.median(runs)))) if runs else 24
    # A square larger than a twentieth of the frame is a failed read, not a large checker.
    return min(square, max(8, min(h, w) // 20))


def thicken_thin(core: np.ndarray, rgb: np.ndarray, min_half: float) -> tuple[np.ndarray, np.ndarray, float]:
    """Grow only the parts of a drawing that are too thin to survive a downscale.

    **⚠ What this can and cannot buy is arithmetic, and it is worth stating before the constant.**
    A feature survives a reduction to N px only if it is at least (delivered width / N) px wide. The
    mosquito is delivered ~1000 px across assembled and its legs are ~4 px, so at 32 px they are
    0.13 px and at the ~114 px it is actually READ at they are 0.45 px. Nothing short of making a
    leg as thick as the body puts it above one pixel at 32 px -- so this does not try. What it does
    is put the thin structure over a pixel at the size the creature is decided about.

    Only the thin parts move: a uniform dilation would fatten the abdomen and the eyes too, and the
    creature would stop being the drawing that was supplied. New pixels take the colour of the
    nearest original pixel, so a leg grows in its own grey rather than in a flat fill.
    """
    inside = ndimage.distance_transform_edt(core)
    # ⚠ A pixel near an edge is not a thin STRUCTURE, and reading it as one is what ate the
    # mosquito's outline. `inside < min_half` selects the rim of every shape, however fat -- so on a
    # wing membrane it grew the rim outward across the black contour, repainted those pixels with
    # the membrane's own colour, and the delivered wing came back as a blob with a rim at luma 115
    # against the bee's 20. A limb is thin when nothing NEAR it is thick either.
    reach = max(1, int(round(min_half)))
    thin = core & (ndimage.maximum_filter(inside, size=2 * reach + 1) < min_half)
    if not thin.any():
        return core, rgb, 0.0

    grown = core | (ndimage.distance_transform_edt(~thin) <= min_half)
    added = grown & ~core
    if added.any():
        # Nearest original pixel, so the growth carries the drawing's own colour.
        _, (iy, ix) = ndimage.distance_transform_edt(~core, return_indices=True)
        rgb = rgb.copy()
        rgb[added] = rgb[iy[added], ix[added]]
    return grown, rgb, float(added.sum())


def rebuild(
    pose: dict, source_ink: float, delivery_scale: float, bs, thicken: float = 0.0
) -> tuple[Image.Image, dict]:
    """Repaint the contour at one thickness, trim, deliver."""
    core = pose["core"]
    ink_px = pose["ink"]
    rgb = pose["rgb"]
    thickened = 0.0

    # ⚠ Read BEFORE any thickening. `thicken_thin` repaints what it adds with the nearest artwork
    # colour, so an ink pixel it absorbs stops being ink-coloured -- and this median is taken over
    # the ink MASK, which still lists it. That is the second half of how the mosquito's contour came
    # out at luma 115: not only was the outline eaten, the colour meant to repaint it was the
    # membrane's.
    ink_rgb = np.median(rgb[ink_px], axis=0) if ink_px.any() else np.array([26, 28, 26])
    # Never pure black: a hard black edge against the alpha boundary bleeds black into every mipmap
    # level -- `verify:mattes`'s own rule.
    ink_rgb = np.maximum(np.asarray(ink_rgb, dtype=int), 20)

    if thicken > 0:
        core, rgb, thickened = thicken_thin(core, rgb, thicken / max(delivery_scale, 1e-6))

    # ── ⚠ The silhouette is the DRAWING'S OWN, and the contour is painted INWARD from it ────────
    #
    # This was `grown = distance(~core) <= source_ink` -- the delivered shape defined as *the
    # non-ink artwork, dilated by one contour thickness*. That is a fair description of a creature
    # whose ink is a thin outline, which is what the frog is, and it is catastrophic for one whose
    # ink is a wide filled band. Anything further from a non-ink pixel than the contour is thick
    # simply fell outside the alpha.
    #
    # **Measured on the shipped materials, it was deleting 20% of the bee, 16% of the hornet and 5%
    # of the mosquito** -- the bee's black abdomen bands, which are 45% of its own drawing, came out
    # as transparent holes. Reported as the bee still being see-through after the wings were fixed.
    #
    # ⚠ And the QA sheet could not show it, which is the standing rule paid for again: the holes are
    # exactly where the DARK paint belongs, so on mid grey they read as the stripes they had
    # replaced. On magenta they are unmissable. *A background that hides neither dark paint nor a
    # pale plate* -- and mid grey hides dark paint against dark paint.
    #
    # So nothing is subtractive any more. The shape delivered is the shape that was drawn, and the
    # outermost band of it is repainted ink to one thickness across the set -- which is what
    # `inkRim.ts` already does to the mascot, and for the same reason: the drawn box is load-bearing
    # and a contour rule may not move it.
    depth = ndimage.distance_transform_edt(pose["alpha"] if thicken <= 0 else (core | ink_px))
    grown = depth > 0
    contour = grown & (depth <= source_ink)

    out = rgb.copy()
    out[contour] = ink_rgb
    a = np.where(grown, 255.0, 0.0).astype(np.uint8)
    after = contour_thickness(grown, grown & ~contour)

    ys, xs = np.nonzero(grown)
    y0, y1, x0, x1 = int(ys.min()), int(ys.max()), int(xs.min()), int(xs.max())
    rgba = np.dstack([out.astype(np.uint8), a])[y0 : y1 + 1, x0 : x1 + 1]
    # The eye landmark is optional: it exists to bring two poses of one creature to one scale, and
    # a caller whose parts are already in ONE drawing (`normalize-flyer.py`: a body and its wing on
    # the same canvas) has nothing to align. Absent, the anchor falls back to the alpha centroid,
    # which is what `anchorEyes` would have been used to cross-check rather than to place.
    eyes = pose.get("eyes")
    eyes_crop = (
        eyes[y0 : y1 + 1, x0 : x1 + 1]
        if eyes is not None
        else np.zeros((y1 - y0 + 1, x1 - x0 + 1), dtype=bool)
    )

    img = Image.fromarray(rgba, "RGBA")
    eye_img = Image.fromarray((eyes_crop * 255).astype(np.uint8), "L")

    dw = max(1, int(round(img.width * delivery_scale)))
    dh = max(1, int(round(img.height * delivery_scale)))
    img = img.resize((dw, dh), Image.LANCZOS)
    eye_img = eye_img.resize((dw, dh), Image.NEAREST)

    img, cleared = bs.floor_alpha(img)
    # ⚠ Trim AGAIN after the floor. The first trim runs on a mask that still
    # carries the soft edge the resize produced; flooring clears those rows and
    # leaves genuinely empty rows at the bottom of a canvas already sized to hold
    # them -- and a billboard is bottom-anchored, so the game plants the empty
    # band on the ground and the creature hovers. Nine of 52 decor sprites
    # shipped with exactly that.
    before_trim = img.size
    img = bs.trim(img)
    # The eye mask has to follow the same crop or the anchor it yields is
    # measured against a box the sprite no longer has.
    dx = (before_trim[0] - img.width) // 2
    eye_img = eye_img.crop((0, 0, before_trim[0], before_trim[1]))
    img = bs.dilate_colour(img)

    alpha_out = np.asarray(img)[..., 3] > 16
    cy, cx = ndimage.center_of_mass(alpha_out)
    ea = np.asarray(eye_img)[: img.height, : img.width] > 128
    if ea.any():
        ey, ex = ndimage.center_of_mass(ea)
    else:
        ey, ex = cy, cx

    stats = {
        "size": [img.width, img.height],
        "aspect": round(img.width / img.height, 3),
        "contourSourcePx": {
            "p5": round(float(np.percentile(after, 5)), 1),
            "median": round(float(np.median(after)), 1),
            "p95": round(float(np.percentile(after, 95)), 1),
        },
        "contourDeliveredPx": round(float(np.median(after) * delivery_scale), 2),
        # Both anchors, as fractions of the delivered box. See the docstring for
        # why both are written rather than one being chosen here.
        "anchorEyes": [round(float(ex) / img.width, 4), round(float(ey) / img.height, 4)],
        "anchorCentroid": [round(float(cx) / img.width, 4), round(float(cy) / img.height, 4)],
        "scale": round(delivery_scale, 4),
        "clearedAlpha": cleared,
        "thickenedPx": round(thickened),
        "_dx": dx,
    }
    return img, stats


def normalize_set(slot: str, poses: list[tuple[str, Path]], world_height: float) -> dict:
    bs = _build_sprites_module()
    read = [(name, read_pose(src)) for name, src in poses]
    ref_name, ref = read[0]

    rx0, ry0, rx1, ry1 = ref["content"]
    ref_long = max(rx1 - rx0 + 1, ry1 - ry0 + 1)
    k_ref = min(TARGET_LONG / ref_long, 1.0)

    # The reference pose's delivered geometric mean sets the kind's contour, in
    # absolute pixels, for every pose.
    ref_w = (rx1 - rx0 + 1) * k_ref
    ref_h = (ry1 - ry0 + 1) * k_ref
    target_ink = INK_FRACTION * np.sqrt(ref_w * ref_h)

    report = {
        "slot": slot,
        "license": "Gemini (Google) - service terms, NOT CC0",
        "referencePose": ref_name,
        "inkFraction": INK_FRACTION,
        "targetContourPx": round(float(target_ink), 2),
        "worldHeight": world_height,
        "poses": {},
    }

    for name, pose in read:
        if not pose["eyeSpan"]:
            raise SystemExit(
                f"pose '{name}' has no eye landmark: the poses cannot be brought to one "
                f"creature scale without one, and guessing a ratio would silently resize the animal"
            )
        # One creature scale: the landmark is put at the same size in every pose.
        k = k_ref * (ref["eyeSpan"] / pose["eyeSpan"])
        if k > 1.0:
            raise SystemExit(f"pose '{name}' would be upscaled {k:.2f}x; deliver a larger source")
        source_ink = max(1.0, target_ink / k)

        img, stats = rebuild(pose, source_ink, k, bs)
        stats.pop("_dx", None)
        stats["source"] = str(pose["src"])
        stats["eyeSpanSourcePx"] = pose["eyeSpan"]
        stats["creatureScaleVsReference"] = round(pose["eyeSpan"] / ref["eyeSpan"], 4)
        stats["contourBeforeSourcePx"] = {
            "p5": round(float(np.percentile(pose["contour"], 5)), 1),
            "median": round(float(np.median(pose["contour"])), 1),
            "p95": round(float(np.percentile(pose["contour"], 95)), 1),
        }
        report["poses"][name] = stats

        OUT_DIR.mkdir(parents=True, exist_ok=True)
        if name == "ground":
            # The two gait frames the walk cycle already asks for. One drawing
            # under both keys: the hop is computed, so a second drawn pose would
            # be a second thing to keep in step with a motion nothing draws.
            for i in range(2):
                img.save(OUT_DIR / f"critter-{slot}-{i}.png")
            stats["files"] = [f"critter-{slot}-{i}.png" for i in range(2)]
        else:
            img.save(OUT_DIR / f"critter-{slot}-{name}.png")
            stats["files"] = [f"critter-{slot}-{name}.png"]

    if world_height:
        ref_stats = report["poses"][ref_name]
        report["worldWidth"] = round(world_height * ref_stats["aspect"], 1)
        # Every non-reference pose is drawn at the SAME creature scale, so its
        # world box is its own pixel size against the reference's -- not its own
        # aspect against the reference's height, which would resize the animal.
        rw, rh = ref_stats["size"]
        for name, st in report["poses"].items():
            w, h = st["size"]
            st["worldWidth"] = round(report["worldWidth"] * (w / rw), 1)
            st["worldHeight"] = round(world_height * (h / rh), 1)
    return report


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--slot", required=True)
    ap.add_argument(
        "--pose",
        action="append",
        default=[],
        help='name=path; the FIRST is the reference every other is scaled against',
    )
    ap.add_argument("--measure", action="store_true")
    ap.add_argument("--world-height", type=float, default=0.0)
    args = ap.parse_args()

    poses: list[tuple[str, Path]] = []
    for entry in args.pose:
        name, _, path = entry.partition("=")
        p = Path(path)
        if not p.exists():
            print(f"missing source for '{name}': {p}")
            return 1
        poses.append((name, p))
    if not poses:
        print("no --pose given")
        return 1

    if args.measure:
        for name, src in poses:
            pose = read_pose(src)
            t = pose["contour"]
            x0, y0, x1, y1 = pose["content"]
            print(f"{name:<8} {src}")
            print(f"   content {x1 - x0 + 1}x{y1 - y0 + 1}  eye span {pose['eyeSpan']} px")
            print(
                f"   contour source px  p5 {np.percentile(t, 5):.1f}  "
                f"median {np.median(t):.1f}  p95 {np.percentile(t, 95):.1f}"
            )
        return 0

    report = normalize_set(args.slot, poses, args.world_height)
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    all_reports = json.loads(MANIFEST.read_text(encoding="utf-8")) if MANIFEST.exists() else {}
    all_reports[args.slot] = report
    MANIFEST.write_text(json.dumps(all_reports, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
