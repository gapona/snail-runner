"""
normalize-flyer.py  A supplied insect delivered as a body and one detached wing.

  py -3.11 scripts/normalize-flyer.py --slot bee \
      --material "references/wasp 3.jpg" --reference "references/wasp 1.jpg" --world-height 310

  py -3.11 scripts/normalize-flyer.py --slot hornet \
      --material "references/hornet 2.jpg" --reference "references/hornet 1.jpg" --world-height 310

Everything about the billboard contract is `normalize-critter.py`'s and is imported from it rather
than repeated -- the background key, the halo strip, the contour rebuild at `INK_FRACTION`, the
alpha floor and the closing flood. What this file adds is the two things a flyer needs and a ground
creature does not:

  ONE SCALE ACROSS BODY AND WING   they are two components of ONE drawing, so the shared scale is
                                   free -- but the contour is not: `INK_FRACTION` is a fraction of
                                   a sprite's own geometric mean, and a wing's is much smaller than
                                   a body's, so evaluating it per part would put a thinner line on
                                   the wing of the same animal. It is evaluated once on the body
                                   and applied to both in absolute pixels.

  THE ATTACHMENT POINT, MEASURED   the wing is rotated about its root in the engine, so the engine
                                   needs to know where the root sits on the body and at what angle
                                   the wing rests. Neither is hardcoded: the body is located inside
                                   the ASSEMBLED reference by template match (the two drawings are
                                   the same art, so the match is near exact), the wings are what is
                                   left over, and the root is where they touch.

-- ⚠ Two frames are written for the body and they are the same picture ----------------------------

`CRITTER_FRAMES` is 2 and `CritterSprites` asks for a pose index every frame. For a walking kind
those are an alternating tripod; for a flyer the body does not change at all -- the wing does, and
the wing is a rotation computed in the engine rather than a drawn frame. So both keys get the same
body. A second drawn body would be a second thing to keep in step with a motion nothing draws.

-- ⚠ The wing is NOT part of the collision box ----------------------------------------------------

The world box in `CRITTER_KINDS` is the BODY's. A wing is translucent, it is drawn behind the body,
and its extent changes every frame with the beat -- a hitbox that pulsed with the wingbeat would be
unreadable, which is the same rule the frog's hop is under ("what the creature looks like, never
what it can do"). What the wings do change is the SILHOUETTE, which is what has to read as
"go around" rather than "jump", and that is checked on the assembled span.
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
# How tall a band around the hinge's row is searched for the body's own edge, as a fraction of
# the body's height. One row can fall in a gap between two drawn parts.
HINGE_BAND = 0.03
# How far the wing is set back behind the body's edge, as a fraction of its own span, so the
# proximal arm the material has to draw ends up where the reference keeps it: out of sight.
WING_TUCK = 0.10
MANIFEST = ROOT / "dev-assets" / "critter" / "critter-art.json"

def _nc():
    spec = importlib.util.spec_from_file_location(
        "normalize_critter", ROOT / "scripts" / "normalize-critter.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _sheet_module():
    """`silhouette-sheet.py`'s assembly, imported rather than restated.

    There is exactly one description of where a wing goes, and the confusion sheet, this manifest
    and the engine's own `placeWings` all have to agree with it -- so it is written once and read
    by everything that needs it.
    """
    spec = importlib.util.spec_from_file_location(
        "silhouette_sheet", Path(__file__).resolve().parent / "silhouette-sheet.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def parts_of(nc, path: Path) -> tuple[np.ndarray, np.ndarray, list[np.ndarray]]:
    """The material's alpha and its components, largest first: body, then wing."""
    rgb = np.asarray(Image.open(path).convert("RGB")).astype(int)
    # ⚠ The checker-aware key, not `cut_background`. These are supplied on a transparency checker,
    # whose dark squares that key reads as artwork -- see `background_plate`.
    plate = nc.background_plate(rgb)
    # ...plus the gaps in the drawing the checker shows through, which are background and are
    # enclosed by artwork, so no flood from the frame's edge can reach them. See `checker_holes`.
    alpha = ndimage.binary_erosion(
        ~(plate | nc.checker_holes(rgb, plate)), np.ones((3, 3)), iterations=nc.HALO_PX
    )
    labels, n = ndimage.label(ndimage.binary_closing(alpha, np.ones((9, 9))))
    sizes = ndimage.sum(alpha, labels, range(1, n + 1))
    order = np.argsort(sizes)[::-1]
    # A speck is not a part: the bee's material carries a single stray pixel.
    keep = [labels == (i + 1) for i in order if sizes[i] > 500]
    return rgb, alpha, [k & alpha for k in keep]


def body_columns(alpha: np.ndarray) -> tuple[int, int, int, int]:
    """The body's box in an assembled reference, from the column-height profile.

    **⚠ No template, and the template version had to go.** Matching the material's body into the
    reference assumed the two drawings carry the same body -- and the mosquito's do not: its
    material has long antennae the reference does not draw, so the match covered 37% and the scale
    it implied was 0.55 of the truth.

    What is true of all three insects is geometric. A wing never crosses the centreline, and a body
    is tall where a wing is thin: measured per column, the alpha's vertical extent is a tall central
    plateau flanked by much shorter wing regions. The plateau IS the body, and reading it needs
    nothing from the other drawing.
    """
    # ⚠ The LONGEST RUN in a column, not its top-to-bottom extent, and the alpha is de-speckled
    # first. The mosquito's reference does not key perfectly -- a few checkerboard squares survive
    # at the top and bottom of the frame -- and an extent measure reads a column with one stray
    # pixel near each edge as full height. It put the "body" in a 14 px sliver at the left margin.
    # A run is immune to that, and dropping components under a thousandth of the canvas removes the
    # speckle outright.
    labels, n = ndimage.label(alpha)
    if n:
        sizes = ndimage.sum(alpha, labels, range(1, n + 1))
        keep = {i + 1 for i, v in enumerate(sizes) if v > alpha.size * 0.001}
        alpha = np.isin(labels, list(keep)) if keep else alpha

    # ⚠ The column's EXTENT, top to bottom, not its longest run -- once the speckle is gone.
    #
    # A run measures how much solid drawing a column carries, and a leg is not solid: it is a
    # hairline crossing the column diagonally, so a run test reads the mosquito's legs as empty and
    # puts the body's edge at the thorax. The delivered body sprite has the legs in it, so the two
    # then disagree by 285 px against 100 -- and a wing attached at 0.995 of the wrong width hangs
    # in space beside the creature, which is exactly how the first assembly drew it.
    #
    # Extent counts a leg, because a column through one runs from the wing down to the leg's tip.
    # It was the first version's measure too and it failed only on speckle, which the de-speckling
    # above now removes.
    top = alpha.argmax(axis=0)
    bottom = alpha.shape[0] - alpha[::-1].argmax(axis=0)
    heights = np.where(alpha.any(axis=0), bottom - top, 0)
    tall = heights > heights.max() * 0.45
    xs = np.nonzero(tall)[0]
    if len(xs) < 4:
        raise SystemExit("no body plateau found in the reference")
    # One run, not a scatter: take the run containing the widest point.
    peak = int(np.argmax(heights))
    x0 = peak
    while x0 > 0 and tall[x0 - 1]:
        x0 -= 1
    x1 = peak
    while x1 + 1 < len(tall) and tall[x1 + 1]:
        x1 += 1
    rows = np.nonzero(alpha[:, x0 : x1 + 1].any(axis=1))[0]
    return x0, int(rows.min()), x1, int(rows.max())


def measure_attachment(nc, reference: Path) -> dict:
    """Where the wings meet the body, and at what angle they rest.

    Both as fractions, never in pixels: the delivered sprites are a different size from the
    reference, and a pixel offset would be a number that is only true of one render.
    """
    rgb = np.asarray(Image.open(reference).convert("RGB")).astype(int)
    alpha = ndimage.binary_erosion(
        nc.cut_background(rgb), np.ones((3, 3)), iterations=nc.HALO_PX
    )
    bx0, by0, bx1, by1 = body_columns(alpha)
    bw, bh = bx1 - bx0 + 1, by1 - by0 + 1

    sides = {}
    for side, cols in (("right", slice(bx1 + 1, None)), ("left", slice(None, bx0))):
        region = np.zeros_like(alpha)
        region[:, cols] = alpha[:, cols]
        labels, n = ndimage.label(ndimage.binary_closing(region, np.ones((7, 7))))
        if n == 0:
            raise SystemExit(f"no wing found on the {side}")
        sizes = ndimage.sum(region, labels, range(1, n + 1))
        m = (labels == (int(np.argmax(sizes)) + 1)) & region
        ys, xs = np.nonzero(m)
        # The root is where the wing meets the body's own edge: the pixels within a few columns of
        # the boundary. Their centroid is the hinge.
        edge = bx1 if side == "right" else bx0
        near = m[:, max(0, edge - 6) : edge + 7] if side == "left" else m[:, edge - 6 : edge + 7]
        nys = np.nonzero(near.any(axis=1))[0]
        root_y = float(nys.mean()) if len(nys) else float(ys.mean())
        root_x = float(edge)
        d = np.hypot(xs - root_x, ys - root_y)
        far = d >= np.percentile(d, 95)
        tx, ty = float(xs[far].mean()), float(ys[far].mean())
        sides[side] = {
            "rootX": root_x,
            "rootY": root_y,
            "tipX": tx,
            "tipY": ty,
            "angle": float(np.degrees(np.arctan2(ty - root_y, tx - root_x))),
            "span": float(np.hypot(tx - root_x, ty - root_y)),
        }

    right, left = sides["right"], sides["left"]
    # Symmetrised: the insect is drawn symmetric, so the honest estimate of the mounting angle is
    # the mean of the two measurements and the honest quality number is how far they disagreed.
    left_mirrored = 180 - left["angle"] if left["angle"] > 0 else -180 - left["angle"]
    angle = float(np.mean([right["angle"], left_mirrored]))

    # ── Everything is expressed against the ASSEMBLED box, and nothing against the body ───────
    #
    # ⚠ Two attempts placed the wings by a fraction of the BODY and both drew them detached, because
    # the material's body and the reference's body are not the same drawing: the mosquito's material
    # has longer antennae and more splayed legs, so the delivered body is 291 px wide against a
    # reference body of 181, while the bee's runs the other way at 207 against 282. A hinge at
    # "0.997 of the body's width" therefore lands in a different place in each, and on the mosquito
    # it hung in clear air beside the creature.
    #
    # The assembled box is the one thing the two drawings share a definition of, and it is also
    # exactly the kind's world box -- so fractions of it transfer without any correspondence between
    # the bodies being needed at all.
    ays, axs = np.nonzero(alpha)
    ax0, ay0 = int(axs.min()), int(ays.min())
    aw, ah = int(axs.max() - ax0 + 1), int(ays.max() - ay0 + 1)

    wing_span = float(np.mean([right["span"], left["span"]]))

    # ⚠ The hinge's HEIGHT is the one thing about it the reference can show, and it is the half that
    # transfers. Both drawings are the same insect seen from the front with its wings at the
    # shoulder, so "how far down the body the wing is mounted" means the same thing in each -- where
    # "how far out" does not, because the two drawings disagree about how wide the creature is.
    hinge_y_in_body = float(np.mean([right["rootY"], left["rootY"]]) - by0) / bh

    return {
        "hingeYInBody": round(hinge_y_in_body, 4),
        "assembled": [aw, ah],
        "assembledAspect": round(aw / ah, 4),
        # ⚠ The TIP, not the hinge, and that is the whole of the placement fix.
        #
        # The hinge is not visible in an assembled drawing -- it is behind the thorax -- and the
        # point where the wing crosses the body's BOUNDING BOX is not it either: at the hinge's own
        # height the body is much narrower than its box, so the crossing sits well outside the
        # creature. Planting the sprite's knob there left a gap of 31 px on the bee and 85 on the
        # mosquito. The tip is unambiguous in both drawings, so the wing is placed by it and the
        # hinge falls where it belongs, inside the body.
        "tipInBox": [
            round(float(np.mean([right["tipX"] - ax0, aw - (left["tipX"] - ax0)])) / aw, 4),
            round(float(np.mean([right["tipY"], left["tipY"]]) - ay0) / ah, 4),
        ],
        # How long a wing is against the box it lives in, so its drawn size needs no body either.
        "wingSpanInBox": round(wing_span / aw, 4),
        "bodyTopInBox": round((by0 - ay0) / ah, 4),
        "bodyHeightInBox": round(bh / ah, 4),
        "bodyBoxInReference": [bw, bh],
        "restAngle": round(angle, 2),
        "symmetryDeltaDeg": round(abs(right["angle"] - left_mirrored), 2),
        "symmetryDeltaX": round(
            abs((right["rootX"] - ax0) / aw - (1 - (left["rootX"] - ax0) / aw)), 4
        ),
    }


def wing_pivot(mask: np.ndarray) -> tuple[float, float, float, float]:
    """The wing's own hinge, the angle it is DRAWN at, and where its BLADE begins.

    **⚠ Not "the narrower end", which is what the first version used and what got the mosquito
    backwards.** Its wing tapers to a fine point at the tip and carries a knob with two prongs at
    the root, so the tip had FEWER pixels and was chosen as the hinge -- delivering a rest rotation
    of -184 degrees, i.e. the wing mounted back to front.

    What separates them is structure, not thickness: the blade is a solid lobe and the hinge is a
    small cluster on a thin neck, so an opening removes the hinge and leaves the blade. The root is
    then the end where the wing extends beyond its own blade.

    The fourth number is what the first assembly got wrong. **In the assembled reference the hinge
    is HIDDEN BEHIND THE THORAX** -- what is visible is where the blade emerges from the body. Plant
    the sprite's knob at that emergence point and the whole wing is pushed outward by the length of
    the knob and its neck, which is exactly the gap the first render showed: 31 px on the bee, 85 on
    the mosquito. So the distance from hinge to blade is measured here and set back at placement.
    """
    ys, xs = np.nonzero(mask)
    x0, x1 = int(xs.min()), int(xs.max())
    blade = ndimage.binary_opening(mask, np.ones((9, 9)))
    if not blade.any():
        blade = mask
    bxs = np.nonzero(blade)[1]
    at_left = (bxs.min() - x0) > (x1 - bxs.max())

    span = x1 - x0 + 1
    edge = max(3, int(span * 0.06))
    band = mask[:, x0 : x0 + edge] if at_left else mask[:, x1 - edge + 1 : x1 + 1]
    by, bxx = ndimage.center_of_mass(band)
    px = (x0 + bxx) if at_left else (x1 - edge + 1 + bxx)
    py = by

    d = np.hypot(xs - px, ys - py)
    far = d >= np.percentile(d, 95)
    angle = float(np.degrees(np.arctan2(ys[far].mean() - py, xs[far].mean() - px)))

    blade_start = float(bxs.min() if at_left else bxs.max())
    hinge_to_blade = abs(blade_start - px)
    return float(px), float(py), angle, hinge_to_blade


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--slot", required=True)
    ap.add_argument("--material", required=True, help="body + detached wing, one canvas")
    ap.add_argument("--reference", required=True, help="the assembled insect")
    ap.add_argument("--world-height", type=float, default=310.0)
    ap.add_argument(
        "--wing-tuck",
        type=float,
        default=WING_TUCK,
        help="how far the wing sets back behind the body, as a fraction of its own span",
    )
    ap.add_argument(
        "--thicken",
        type=float,
        default=0.0,
        help="grow structures thinner than this many DELIVERED px of half-width; see thicken_thin",
    )
    args = ap.parse_args()

    nc = _nc()
    bs = nc._build_sprites_module()
    material, reference = Path(args.material), Path(args.reference)
    rgb, alpha, parts = parts_of(nc, material)
    if len(parts) < 2:
        print("the material must carry a body and a detached wing")
        return 1

    # -- Which part is the wing, and the checkerboard baked into it ----------
    #
    # ⚠ NOT "the larger part is the body", which is what this did and what put the mosquito's two
    # parts the wrong way round: its body is drawn on the left and its wing on the right, and the
    # wing is the bigger of the two. Every number downstream -- the world box, the attachment, the
    # pivot -- would have been measured off the wrong drawing.
    #
    # What actually distinguishes them is the property the un-composite already has to measure: a
    # wing is TRANSLUCENT, so the transparency checker shows through it and a body's does not. The
    # test is a correlation at the checker's own period, so an opaque part scores zero and comes
    # back at opacity 1 with nothing to interpret. See `unmix_checker`.
    #
    # This runs before anything reads a colour, because `ink`, `core` and the contour's own ink
    # colour are all reads of `rgb` -- and reading them through a checker is reading them through a
    # pattern that is not in the drawing.
    plate = ~alpha
    reads = []
    for mask in parts[:2]:
        ink = mask & (nc.luma(rgb) < nc.INK_LUMA_MAX)
        reads.append(nc.unmix_checker(rgb, plate, mask, ink))

    # Picked on the checker's own POWER rather than on the recovered opacity, because a wing whose
    # inversion is infeasible still ships opaque -- so opacity is not always the thing that differs,
    # and the power is.
    power = [r[2].get("partPower", 0.0) for r in reads]
    wing_i = 0 if power[0] > power[1] else 1
    body_i = 1 - wing_i
    if max(power) <= 0:
        print("neither part carries the checker; falling back to largest-is-body")
        wing_i, body_i = 1, 0

    body_mask, wing_mask = parts[body_i], parts[wing_i]
    # The wing's own un-composited colour is what the rest of the pass measures and delivers.
    rgb = np.round(reads[wing_i][0]).astype(int)
    report_checker = {
        "wingPart": wing_i,
        "wing": reads[wing_i][2],
        "body": reads[body_i][2],
    }

    def crop(m):
        ys, xs = np.nonzero(m)
        return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())

    bx0, by0, bx1, by1 = crop(body_mask)
    bw, bh = bx1 - bx0 + 1, by1 - by0 + 1

    # One delivery scale, from the BODY, and the wing rides it. TARGET_LONG applies to the body so
    # a flyer is delivered at the same resolution as every other critter.
    scale = min(nc.TARGET_LONG / max(bw, bh), 1.0)
    out_w, out_h = round(bw * scale), round(bh * scale)
    target_ink = nc.INK_FRACTION * np.sqrt(out_w * out_h)
    source_ink = max(1.0, target_ink / scale)

    report = {
        "slot": args.slot,
        "license": "Gemini (Google) - service terms, NOT CC0",
        "material": str(material),
        "reference": str(reference),
        "inkFraction": nc.INK_FRACTION,
        "targetContourPx": round(float(target_ink), 2),
        "scale": round(scale, 4),
        "worldHeight": args.world_height,
        "checker": report_checker,
        "parts": {},
    }

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    delivered = {}
    for name, mask in (("body", body_mask), ("wing", wing_mask)):
        ink = mask & (nc.luma(rgb) < nc.INK_LUMA_MAX)
        core = mask & ~ink
        pose = {"rgb": rgb, "alpha": mask, "ink": ink, "core": core, "src": material}
        before = nc.contour_thickness(mask, core)
        img, stats = nc.rebuild(pose, source_ink, scale, bs, args.thicken)
        stats.pop("_dx", None)
        stats["contourBeforeSourcePx"] = {
            "p5": round(float(np.percentile(before, 5)), 1),
            "median": round(float(np.median(before)), 1),
            "p95": round(float(np.percentile(before, 95)), 1),
        }
        delivered[name] = img
        report["parts"][name] = stats

    body_img, wing_img = delivered["body"], delivered["wing"]
    for i in range(2):
        body_img.save(OUT_DIR / f"critter-{args.slot}-{i}.png")
    wing_img.save(OUT_DIR / f"critter-{args.slot}-wing.png")
    report["parts"]["body"]["files"] = [f"critter-{args.slot}-{i}.png" for i in range(2)]
    report["parts"]["wing"]["files"] = [f"critter-{args.slot}-wing.png"]

    # -- Where the wing goes -------------------------------------------------
    attach = measure_attachment(nc, reference)

    # ⚠ "Drawn at all", not "opaque". This read `> 128` and a translucent membrane is not: once the
    # bee's wing shipped at the opacity it is actually drawn at (0.34), the shape this measures
    # collapsed to the outline alone and the pivot came out at the wrong end -- rest rotation -187
    # degrees against the -6 the same drawing gave when it was opaque. What the geometry is about is
    # where the wing IS, which is a question about coverage.
    wa = np.asarray(wing_img)[..., 3] > 16
    px, py, drawn_angle, hinge_to_blade = wing_pivot(wa)
    # How far the tip is from the hinge, as a fraction of the sprite's own width. The reference
    # gives the span in world terms; this converts it into a size for the whole sprite, which
    # carries a little knob behind the hinge that the span does not.
    wys, wxs = np.nonzero(wa)
    wd = np.hypot(wxs - px, wys - py)
    tip_far = wd >= np.percentile(wd, 95)
    attach["pivotToTipOverWidth"] = round(float(wd[tip_far].mean()) / wing_img.width, 4)
    attach["pivot"] = [round(px / wing_img.width, 4), round(py / wing_img.height, 4)]
    attach["drawnAngle"] = round(drawn_angle, 2)
    # What the engine rotates by at rest: the mounted angle minus the angle the sprite is drawn at.
    attach["restRotation"] = round(attach["restAngle"] - drawn_angle, 2)
    attach["wingAspect"] = round(wing_img.width / wing_img.height, 4)
    # How far the hinge sits behind the blade, as a fraction of the wing sprite's width. Setting the
    # wing back by this puts the blade's start on the body's edge and the knob behind it.
    attach["hingeToBladeOverWidth"] = round(hinge_to_blade / wing_img.width, 4)
    # The wing's size against the body's, straight from the material -- both parts are ONE drawing
    # at one scale, so this is exact and needs nothing from the reference.
    attach["wingOverBody"] = round(wing_img.width / body_img.width, 4)
    attach["bodyAspect"] = round(body_img.width / body_img.height, 4)

    # ── ⚠ Where the hinge sits ACROSS the body is measured on the delivered body, not transferred
    #
    # Placing the wing by its tip inside the assembled box was the previous rule, and it rests on
    # being able to rebuild that box from the body -- `box_h = body height / bodyHeightInBox`. The
    # two drawings do not allow it. The mosquito's material body is 292x378 against a reference body
    # of 181x461: 0.77:1 where the reference is 0.39:1, so the rebuilt box put our body across a
    # quarter of its width where the reference's covers an eighth, and wings placed at absolute box
    # fractions landed in clear air beside the thorax.
    #
    # A fraction of the body's WIDTH is no better and is why the tip rule exists -- it is the same
    # disagreement wearing a different denominator. What is neither transferred nor a bounding box
    # is the body's OWN DRAWN SILHOUETTE at the hinge's height, measured on the sprite that ships.
    # Planting the hinge there attaches the wing by construction, whatever proportion the body was
    # drawn at, and the sprite's little knob -- which sits inboard of the pivot -- goes behind the
    # thorax where the reference hides it too.
    ba = np.asarray(body_img)[..., 3] > 16
    row = int(np.clip(round(attach["hingeYInBody"] * body_img.height), 0, body_img.height - 1))
    # A band rather than one row: a single row can fall between two drawn parts.
    band = max(1, round(body_img.height * HINGE_BAND))
    covered = ba[max(0, row - band) : row + band + 1].any(axis=0)

    # ⚠ The THORAX's edge, walked out from the centreline -- not the widest drawn column in the
    # band. At the mosquito's shoulder its antennae are the outermost thing in the frame and they
    # are not attached to anything the wing hangs on; taking the maximum put the hinge on an antenna
    # tip and the wings a body's width out in clear air. Stopping at the first gap keeps to the mass
    # the wing is actually mounted on.
    centre = body_img.width // 2
    edge = centre
    while edge + 1 < body_img.width and covered[edge + 1]:
        edge += 1

    # ── ⚠ And then the wing is TUCKED behind it, which is a composition number, not a measurement
    #
    # In an assembled drawing the wing emerges from behind the thorax: its proximal arm and hinge
    # knuckle are simply not visible. The material draws them, because it has to -- the wing is
    # detached there and has to be a whole object. So a hinge planted exactly on the body's edge is
    # correct about the JOINT and wrong about the PICTURE, and it drew all three insects holding
    # their wings out on little arms.
    #
    # How far to tuck cannot be read off the reference, which is precisely the drawing in which that
    # part of the wing is hidden; and it is not the same fraction of the sprite for all three, whose
    # hinge structures are drawn at quite different sizes (the first column reaching half the wing's
    # own depth is at 0.29 of the width on the bee and the hornet and 0.07 on the mosquito, whose
    # knuckle is as deep as part of its blade). So it is one authored fraction of the wing's SPAN,
    # stated as such, and it is what the assembly sheet was looked at to set.
    tuck = args.wing_tuck * attach["pivotToTipOverWidth"] * attach["wingOverBody"] * body_img.width
    attach["hingeInBody"] = [
        round(float(edge + 1 - tuck) / body_img.width, 4),
        round(row / body_img.height, 4),
    ]
    attach["thoraxEdgeInBody"] = round(float(edge + 1) / body_img.width, 4)
    attach["wingTuck"] = args.wing_tuck
    report["wing"] = attach

    body_aspect = body_img.width / body_img.height
    report["worldWidth"] = round(args.world_height * body_aspect, 1)
    report["bodyAspect"] = round(body_aspect, 3)

    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    all_reports = json.loads(MANIFEST.read_text(encoding="utf-8")) if MANIFEST.exists() else {}
    all_reports[args.slot] = report
    MANIFEST.write_text(json.dumps(all_reports, indent=2), encoding="utf-8")

    # ── ⚠ The world box is OUR assembly, not the reference's ──────────────────────────────────
    #
    # `CritterSprites` stretches a texture onto the world box, so the box's aspect has to be the
    # aspect of the thing actually drawn -- the failure `obstacle-low-0` shipped at 41% too wide. The
    # reference's own assembled aspect is not it: the wings are placed against our body now, and our
    # body is not the reference's, so the two assemblies differ (the mosquito's by 1.88 against
    # 1.84 and the hornet's by 2.30 against 2.22). Measured on the composite the sheet draws, which
    # is the same function the engine's placement mirrors.
    assembled, body_box = _sheet_module().assemble(args.slot, all_reports, with_body_box=True)
    bx, by, bw, bh = body_box
    report["assembly"] = {
        "size": [assembled.width, assembled.height],
        "aspect": round(assembled.width / assembled.height, 4),
        "bodyTop": round(by / assembled.height, 4),
        "bodyHeight": round(bh / assembled.height, 4),
        "bodyLeft": round(bx / assembled.width, 4),
    }
    all_reports[args.slot] = report
    MANIFEST.write_text(json.dumps(all_reports, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
