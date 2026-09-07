"""
normalize-ui.py  The interface set, brought to ART-STYLE.md and held there.

  py -3.11 scripts/normalize-ui.py                 build public/assets/ui/
  py -3.11 scripts/normalize-ui.py --audit         measure dev-assets/ui/raw/
  py -3.11 scripts/normalize-ui.py --sheet         write the acceptance sheets

Three jobs, and the third is the one that makes the other two worth doing:

  BUILD    every sprite in the set at one contour thickness, one lip fraction,
           one corner radius, with the nine-slice insets COMPUTED from a single
           inset rule rather than read off by eye.
  AUDIT    measure what the generator returned against the same table.
  CHECK    re-measure what was built, and EXIT NON-ZERO if the contour
           thickness, the lip height or the corner radius varies across the set
           by more than half a pixel.

-- Why the build draws rather than repairs ----------------------------------

The brief's pipeline is generate-then-normalise. The generation route is built
and wired -- `Remotion/src/scripts/snail_ui_prompts.py` and `gen_snail_ui.py`,
on DreamShaper XL, with `--audit` here to measure whatever it returns against
the same table this file builds to.

⚠ WHAT IS NOT CLAIMED: the probe was launched and did not return inside the
session that wrote this, so there is no measurement of what that checkpoint
produces for this style. `--audit` is the way to get one, and it is wired to
fail on exactly the spreads the build asserts.

The argument for drawing rather than repairing does not rest on that
measurement, which is why the file was finished without it. It rests on the
spec being COMPLETE: a flat single-colour face, a band at a stated fraction, a
lip at a stated fraction, an even contour and one radius leaves no pixel
undetermined. The reference sheets' own charm comes from the one thing the
nine-slice forbids -- a gradient down the face, see ART-STYLE.md -- and with
that gone a render can contribute only shape, and the shape is given. A
normalizer strong enough to guarantee the geometry is therefore a normalizer
that has drawn it.

-- The masters are greyscale, and the engine colours them --------------------

See ui_style.py. A pixel's grey is its lightness ratio to the face; the engine
scales the accent's OKLab lightness by it. That is what lets the primary button
take its colour from the ACTIVE THEME, which is a rule this project already
has and which a baked colour would break.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))

import ui_style as ST  # noqa: E402
from ui_metrics import measure  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / "dev-assets" / "ui" / "raw"
OUT_DIR = ROOT / "public" / "assets" / "ui"
QA_DIR = ROOT / "dev-assets" / "ui" / "qa"
TS_CONSTANTS = ROOT / "src" / "ui" / "uiSprites.ts"

SUPERSAMPLE = 4
PRESSED_FACE_SCALE = 0.94  # the face loses a little light; the rest is geometry


def _build_sprites_module():
    """`floor_alpha` and `dilate_colour`, imported rather than re-typed.

    They encode the two rules `verify:mattes` checks and one of them cost a
    round to get right (the float-versus-int alpha boundary that let exactly
    one alpha value survive the build and fail the check). A second copy would
    be a second thing to keep correct.
    """
    path = ROOT / "scripts" / "build-sprites.py"
    spec = importlib.util.spec_from_file_location("build_sprites", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# ---------------------------------------------------------------------------
# Drawing
# ---------------------------------------------------------------------------


def _rounded(w: int, h: int, r: float) -> Image.Image:
    """A rounded-rect mask at supersample scale."""
    s = SUPERSAMPLE
    img = Image.new("L", (w * s, h * s), 0)
    ImageDraw.Draw(img).rounded_rectangle(
        [0, 0, w * s - 1, h * s - 1], radius=max(r * s, 0), fill=255
    )
    return img


def draw_master(shape: str, pressed: bool = False) -> Image.Image:
    """One master: a greyscale value map with the shape in its alpha."""
    spec = ST.SHAPES[shape]
    w, h0 = spec["size"]
    kind = spec["kind"]

    # ⚠ A circle does not shorten when it is pressed. Every other shape loses
    # SINK px of height, which is what makes it visibly sit down on its own lip
    # -- but a circle whose height falls and whose width does not is a STADIUM,
    # and that is what the first contact sheet showed: `ui-round-pressed` came
    # back 96x86 with flat sides. A round button also must not appear to shrink
    # when tapped, so its sink is the engine's y offset instead and both of its
    # states are the same diameter.
    h = h0 - ST.SINK if (pressed and kind != "circle") else h0
    cheek = ST.CHEEK_PRESSED if pressed else ST.CHEEK
    scale = PRESSED_FACE_SCALE if pressed else 1.0

    face = round(ST.FACE_GREY * scale)
    band = round(ST.BAND_GREY * scale)
    lip = round(ST.CHEEK_GREY * scale)
    ink = ST.INK_GREY

    radius = h / 2 if kind == "circle" else ST.RADIUS
    s = SUPERSAMPLE

    outer = _rounded(w, h, radius)
    inner = _rounded(w - 2 * ST.INK, h - 2 * ST.INK, max(radius - ST.INK, 0))

    # The value map starts as ink EVERYWHERE, not as zero. The outer edge then
    # blends ink into ink when it is downsampled and the shape is carried by
    # alpha alone -- a map that was black outside would draw a dark fringe just
    # inside every contour, which at 2 px is most of the contour.
    v = Image.new("L", (w * s, h * s), ink)
    v.paste(face, (ST.INK * s, ST.INK * s), inner)

    if kind == "trough":
        # A trough is a hollow: contour plus a deep channel, no band and no lip.
        # It is the one shape in the set whose interior is meant to read as
        # BELOW the surface rather than as the surface.
        v.paste(lip, (ST.INK * s, ST.INK * s), inner)
    else:
        d = ImageDraw.Draw(v)
        inner_mask = Image.new("L", (w * s, h * s), 0)
        inner_mask.paste(inner, (ST.INK * s, ST.INK * s))

        def band_of(y0: int, y1: int, value: int) -> None:
            if y1 <= y0:
                return
            strip = Image.new("L", (w * s, h * s), value)
            m = inner_mask.copy()
            cut = ImageDraw.Draw(m)
            cut.rectangle([0, 0, w * s - 1, y0 * s - 1], fill=0)
            cut.rectangle([0, y1 * s, w * s - 1, h * s - 1], fill=0)
            v.paste(strip, (0, 0), m)

        band_of(ST.INK, ST.INK + ST.BAND, band)
        # A fill sits INSIDE a trough, so it has no underside to show: a lip on it
        # would be a second object's thickness drawn inside the first.
        if cheek > 0 and kind != "fill":
            lip_top = h - ST.INK - cheek
            # The seam: the same contour thickness as the perimeter, which is
            # the rule the references do not follow and ART-STYLE.md explains.
            band_of(lip_top - ST.INK, lip_top, ink)
            band_of(lip_top, h - ST.INK, lip)
        del d

    # ⚠ The value map and the alpha are resized SEPARATELY and merged after.
    #
    # Downsampling them together as one RGBA image zeroes the colour wherever
    # the alpha reaches zero, so the transparent ring came out pure black even
    # though the map was drawn ink-coloured edge to edge -- and a black ring
    # around a dark contour is precisely what `verify:mattes` fails, because it
    # is what a never-flooded render looks like. It failed 6 of 7 sprites on the
    # first run with the ring at 7-9% of the colour it borders.
    rgb = Image.merge("RGB", (v, v, v)).resize((w, h), Image.LANCZOS)
    alpha = outer.resize((w, h), Image.LANCZOS)
    return Image.merge("RGBA", (*rgb.split(), alpha))


# ---------------------------------------------------------------------------
# Nine-slice preview, used by the acceptance sheets
# ---------------------------------------------------------------------------


def nine_slice(img: Image.Image, width: int, height: int, inset: int, inset_y: int | None = None) -> Image.Image:
    """Stretch only the centre strips. The corners are never scaled.

    Written here as well as in the engine because the acceptance asks for a
    button stretched to 320 and to 1200 px and the corners held -- and an
    acceptance that can only be taken by screenshotting the game is one nobody
    takes. The two implementations agree by construction: both take the inset
    from ui_style.SLICE.
    """
    w, h = img.size
    out = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    l = r = inset
    t = b = inset if inset_y is None else inset_y
    mid_w, mid_h = max(width - l - r, 0), max(height - t - b, 0)
    src_mid_w, src_mid_h = max(w - l - r, 1), max(h - t - b, 1)

    def part(box):
        return img.crop(box)

    def put(im, x, y, sw, sh):
        if sw <= 0 or sh <= 0:
            return
        out.paste(im.resize((sw, sh), Image.NEAREST if sw == im.width else Image.BILINEAR), (x, y))

    put(part((0, 0, l, t)), 0, 0, l, t)
    put(part((w - r, 0, w, t)), width - r, 0, r, t)
    put(part((0, h - b, l, h)), 0, height - b, l, b)
    put(part((w - r, h - b, w, h)), width - r, height - b, r, b)
    put(part((l, 0, w - r, t)), l, 0, mid_w, t)
    put(part((l, h - b, w - r, h)), l, height - b, mid_w, b)
    put(part((0, t, l, h - b)), 0, t, l, mid_h)
    put(part((w - r, t, w, h - b)), width - r, t, r, mid_h)
    put(part((l, t, w - r, h - b)), l, t, mid_w, mid_h)
    return out


# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------


def sprite_name(shape: str, pressed: bool) -> str:
    return f"ui-{shape.replace('_', '-')}{'-pressed' if pressed else ''}"


def build(out_dir: Path) -> list[tuple[str, Image.Image]]:
    bs = _build_sprites_module()
    out_dir.mkdir(parents=True, exist_ok=True)
    made: list[tuple[str, Image.Image]] = []
    manifest = {"spec": dict(ST.table()), "slice": ST.SLICE, "sprites": {}}

    for shape, spec in ST.SHAPES.items():
        states = [False, True] if spec["pressed"] else [False]
        for pressed in states:
            img = draw_master(shape, pressed)
            # The same two rules every sprite in this game ships under: nothing
            # under the alpha floor, and the object's own colour flooded into
            # the transparent ring so no mipmap level averages black into the
            # silhouette.
            img, cleared = bs.floor_alpha(img)
            img = bs.dilate_colour(img)
            name = sprite_name(shape, pressed)
            img.save(out_dir / f"{name}.png")
            made.append((name, img))
            manifest["sprites"][name] = {
                "width": img.width,
                "height": img.height,
                "slice": spec["slice"],
                "insetX": ST.SLICE if "x" in spec["slice"] else 0,
                "insetY": ST.SLICE if "y" in spec["slice"] else 0,
                "pressed": pressed,
                "sink": ST.SINK if pressed else 0,
                "clearedAlpha": cleared,
            }
    # ⚠ Written beside the QA sheets, NOT into public/assets/.
    #
    # Nothing at runtime reads it: the engine spells the same numbers out in
    # `src/ui/uiSprites.ts` and `check_ts_constants` is what holds the two
    # together. Shipping it would put a second source of truth in the bundle
    # that no code consults -- which is the dead-state failure this project has
    # now found four times (`cooldownMs`, `fanScale`, `arcRelaid`,
    # `SFX.MILESTONE`). It is a build report, so it lives with the reports.
    QA_DIR.mkdir(parents=True, exist_ok=True)
    (QA_DIR / "ui-slices.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return made


# ---------------------------------------------------------------------------
# Checks
# ---------------------------------------------------------------------------


def check_geometry() -> list[str]:
    """The constraints the table has to satisfy before anything is drawn."""
    bad = []
    if 2 * (ST.RADIUS + ST.INK) >= ST.MIN_TOUCH:
        bad.append(
            f"radius {ST.RADIUS} + ink {ST.INK} needs {2 * (ST.RADIUS + ST.INK)} px of height "
            f"and the touch floor is {ST.MIN_TOUCH}: the one size the interface is guaranteed "
            f"to ask for is a size the corners cannot be drawn at"
        )
    if ST.SLICE < ST.INK + ST.BAND:
        bad.append(f"slice {ST.SLICE} does not contain the band ({ST.INK + ST.BAND})")
    if ST.SLICE < ST.CHEEK + ST.INK:
        bad.append(f"slice {ST.SLICE} does not contain the cheek ({ST.CHEEK + ST.INK})")
    for shape, spec in ST.SHAPES.items():
        w, h = spec["size"]
        axis = spec["slice"]
        if "x" in axis and w <= 2 * ST.SLICE:
            bad.append(f"{shape} is {w} px wide and has no horizontal centre after two {ST.SLICE} px insets")
        if "y" in axis and h <= 2 * ST.SLICE:
            bad.append(f"{shape} is {h} px tall and has no vertical centre after two {ST.SLICE} px insets")
    return bad


def check_set(made: list[tuple[str, Image.Image]]) -> tuple[list[str], list[tuple]]:
    """Re-measure what was built and hold the set to one number each.

    Measured on the SHIPPED pixels rather than on the table that drew them --
    the same discipline `verify:skins` uses on the mascot. A builder that
    quietly rounded the lip to 12 px would still print 13 from its own
    constants; only the file knows what it is.
    """
    rows, inks, radii = [], [], []
    # ⚠ Cheeks are grouped by STATE. A pressed lip is 3 px by design and a
    # resting one 13, so a single pool reported a 10 px spread and failed a set
    # that was exactly right -- the check comparing the feature against a
    # different state of itself.
    cheeks: dict[bool, list[float]] = {False: [], True: []}
    for name, img in made:
        a = np.asarray(img).astype(int)
        m = measure(a, expect_rim=False)
        rows.append((name, m))
        # The round button has no straight side to read a contour off and no
        # lip fraction that means the same thing, so it is measured for its
        # radius only. Averaging it into the contour spread would be comparing
        # a circle's arc against a rectangle's edge.
        if ST.SHAPES[name_shape(name)]["kind"] != "circle":
            inks.append(m.ink_px)
            if m.cheek_px:
                cheeks[name.endswith("-pressed")].append(m.cheek_px)
            if ST.SHAPES[name_shape(name)]["kind"] != "trough":
                radii.append(m.radius_px)

    bad = []

    def spread(label, vals, limit):
        if len(vals) < 2:
            return
        s = max(vals) - min(vals)
        if s > limit:
            bad.append(
                f"{label} varies by {s:.2f} px across the set (limit {limit}); "
                f"values {', '.join(f'{v:.2f}' for v in vals)}"
            )

    spread("contour thickness", inks, ST.MAX_INK_SPREAD)
    spread("cheek height (resting)", cheeks[False], ST.MAX_CHEEK_SPREAD)
    spread("cheek height (pressed)", cheeks[True], ST.MAX_CHEEK_SPREAD)
    spread("corner radius", radii, ST.MAX_RADIUS_SPREAD)
    return bad, rows


def name_shape(name: str) -> str:
    stem = name[len("ui-") :].replace("-pressed", "")
    return stem.replace("-", "_")


def check_ts_constants() -> list[str]:
    """The engine spells these out; this asserts the two copies agree.

    `src/ui/uiSprites.ts` cannot import a Python module, so the numbers are
    written there by hand -- the same arrangement, and the same reason, as
    `UPGRADE_REFERENCE_MARKS` and `DEFAULT_WEAPON_ID`. What makes it safe is
    that something fails when they drift.
    """
    if not TS_CONSTANTS.exists():
        return [f"{TS_CONSTANTS.relative_to(ROOT)} is missing"]
    src = TS_CONSTANTS.read_text(encoding="utf-8")
    # Ordered so a constant's dependencies are resolved before it: UI_SLICE is
    # written in the engine as `UI_RADIUS + UI_INK`, and evaluating it first
    # would fail on names this loop has not read yet.
    want = {
        "UI_NATIVE_HEIGHT": ST.NATIVE_HEIGHT,
        "UI_INK": ST.INK,
        "UI_BAND": ST.BAND,
        "UI_CHEEK": ST.CHEEK,
        "UI_RADIUS": ST.RADIUS,
        "UI_SINK": ST.SINK,
        "UI_FACE_GREY": ST.FACE_GREY,
        "UI_SLICE": ST.SLICE,
    }
    bad: list[str] = []
    seen: dict[str, int] = {}
    for key, value in want.items():
        m = re.search(rf"\b{key}\s*=\s*(.+)", src)
        if not m:
            bad.append(f"{key} not found in uiSprites.ts")
            continue
        rhs = m.group(1).strip().rstrip(";")
        # The right-hand side may be a literal or a sum of the constants above
        # it: `UI_SLICE = UI_RADIUS + UI_INK` is the inset rule itself, and
        # demanding a bare number there would make the engine repeat a
        # derivation instead of stating it.
        try:
            got = int(eval(rhs, {"__builtins__": {}}, dict(seen)))
        except Exception:
            bad.append(
                f"{key} in uiSprites.ts is {rhs!r}, which is neither a number nor a sum "
                f"of the constants declared above it"
            )
            continue
        seen[key] = got
        if got != value:
            bad.append(f"{key} is {got} in uiSprites.ts and {value} in ui_style.py")
    return bad


# ---------------------------------------------------------------------------
# Audit of the raw renders
# ---------------------------------------------------------------------------


def audit(raw_dir: Path) -> int:
    files = sorted(raw_dir.glob("*.png"))
    if not files:
        print(f"no renders in {raw_dir} -- run gen_snail_ui.py::probe first")
        return 0
    print(f"=== audit: {len(files)} renders against ART-STYLE.md ===")
    print(
        f"{'file':<30} {'w x h':>10} {'ink':>6} {'inkSpr':>7} {'seam':>5} "
        f"{'band/h':>7} {'cheek/h':>8} {'r/h':>6} {'rSpr':>6} {'flat':>6}"
    )
    inks, cheeks, radii = [], [], []
    for f in files:
        a = np.asarray(Image.open(f).convert("RGB")).astype(int)
        m = measure(a)
        if not m.height:
            print(f"{f.name:<30}  (no shape found)")
            continue
        inks.append(m.ink_px)
        cheeks.append(m.cheek_frac)
        radii.append(m.radius_frac)
        print(
            f"{f.name:<30} {m.width:>4}x{m.height:<5} {m.ink_px:>6.2f} {m.ink_spread:>7.2f} "
            f"{m.ink_seam:>5.1f} {m.band_frac:>7.3f} {m.cheek_frac:>8.3f} "
            f"{m.radius_frac:>6.3f} {m.radius_spread:>6.2f} {m.face_spread:>6.1f}"
        )
    if not inks:
        return 1

    print("\n=== what the spec asks for ===")
    for k, v in ST.table():
        print(f"  {k:<16} {v}")

    print("\n=== spread across the renders ===")
    def show(label, vals, want):
        s = max(vals) - min(vals)
        print(f"  {label:<20} {min(vals):7.3f} .. {max(vals):7.3f}   spread {s:7.3f}  (want <= {want})")
        return s

    ink_s = show("contour px", inks, ST.MAX_INK_SPREAD)
    cheek_s = show("cheek / height", cheeks, ST.MAX_CHEEK_SPREAD / ST.NATIVE_HEIGHT)
    rad_s = show("radius / height", radii, ST.MAX_RADIUS_SPREAD / ST.NATIVE_HEIGHT)

    over = []
    if ink_s > ST.MAX_INK_SPREAD:
        over.append("contour thickness")
    if cheek_s > ST.MAX_CHEEK_SPREAD / ST.NATIVE_HEIGHT:
        over.append("cheek height")
    if rad_s > ST.MAX_RADIUS_SPREAD / ST.NATIVE_HEIGHT:
        over.append("corner radius")
    if over:
        print(
            "\nFAIL: " + ", ".join(over) + " vary past the threshold across the set.\n"
            "      These renders cannot be normalised into one language by adjusting them;\n"
            "      see normalize-ui.py's docstring for what the build does instead."
        )
        return 1
    print("\nOK")
    return 0


# ---------------------------------------------------------------------------
# Acceptance sheets
# ---------------------------------------------------------------------------

SHEET_BG = (34, 40, 58)
TINT = (247, 183, 49)  # one accent, so the sheet shows shape rather than palette


def _tinted(img: Image.Image, rgb: tuple[int, int, int]) -> Image.Image:
    """The engine's recolour, in the smallest form that shows the same thing.

    Grey / FACE_GREY is a lightness ratio; here it simply scales the accent's
    RGB, which is close enough for a contact sheet. The engine does it in OKLab
    so the hue survives the dark end -- see ART-STYLE.md.
    """
    a = np.asarray(img).astype(float)
    t = (a[..., 0] / ST.FACE_GREY)[..., None]
    out = np.clip(np.array(rgb, dtype=float)[None, None, :] * t, 0, 255)
    return Image.fromarray(
        np.dstack([out.astype(np.uint8), a[..., 3].astype(np.uint8)]), "RGBA"
    )


def sheets(out_dir: Path, qa_dir: Path) -> None:
    qa_dir.mkdir(parents=True, exist_ok=True)
    names = [p.stem for p in sorted(out_dir.glob("ui-*.png"))]
    imgs = [(n, Image.open(out_dir / f"{n}.png").convert("RGBA")) for n in names]

    # 1. The whole set in one row, so one contour thickness, one lip height and
    #    one radius can be read off by eye against each other.
    pad = 16
    row_h = max(i.height for _, i in imgs) + pad * 2
    row_w = sum(i.width for _, i in imgs) + pad * (len(imgs) + 1)
    sheet = Image.new("RGB", (row_w, row_h), SHEET_BG)
    x = pad
    for _, im in imgs:
        sheet.paste(_tinted(im, TINT), (x, (row_h - im.height) // 2), _tinted(im, TINT))
        x += im.width + pad
    sheet.save(qa_dir / "contact-set.png")

    # 2. Every nine-sliced sprite at 320 and at 1200 px wide, which is the
    #    acceptance for "the rounding does not drift".
    wide = [(n, i) for n, i in imgs if "x" in ST.SHAPES[name_shape(n)]["slice"]]
    widths = (320, 1200)
    gap = 18
    total_h = sum(i.height + gap for _, i in wide) * len(widths) + gap
    sheet2 = Image.new("RGB", (1200 + gap * 2, total_h), SHEET_BG)
    y = gap
    for w in widths:
        for n, im in wide:
            axis = ST.SHAPES[name_shape(n)]["slice"]
            s = nine_slice(im, w, im.height, ST.SLICE, ST.SLICE if "y" in axis else 0)
            sheet2.paste(_tinted(s, TINT), (gap, y), _tinted(s, TINT))
            y += im.height + gap
    sheet2.save(qa_dir / "contact-stretch.png")
    print(f"  sheets -> {qa_dir / 'contact-set.png'}, {qa_dir / 'contact-stretch.png'}")


# ---------------------------------------------------------------------------


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--audit", action="store_true", help="measure the raw renders and stop")
    ap.add_argument("--sheet", action="store_true", help="write the acceptance sheets too")
    ap.add_argument("--raw", default=str(RAW_DIR))
    ap.add_argument("--out", default=str(OUT_DIR))
    args = ap.parse_args()

    if args.audit:
        return audit(Path(args.raw))

    bad = check_geometry()
    if bad:
        for b in bad:
            print(f"FAIL: {b}")
        return 1

    made = build(Path(args.out))
    print(f"=== built {len(made)} masters -> {Path(args.out).relative_to(ROOT)} ===")
    for k, v in ST.table():
        print(f"  {k:<16} {v}")

    problems, rows = check_set(made)
    print("\n=== measured on the shipped pixels ===")
    print(f"{'sprite':<22} {'w x h':>10} {'ink':>6} {'inkSpr':>7} {'seam':>5} {'cheek':>6} {'r':>6} {'flat':>6}")
    for name, m in rows:
        print(
            f"{name:<22} {m.width:>4}x{m.height:<5} {m.ink_px:>6.2f} {m.ink_spread:>7.2f} "
            f"{m.ink_seam:>5.1f} {m.cheek_px:>6.1f} {m.radius_px:>6.2f} {m.face_spread:>6.1f}"
        )

    problems += check_ts_constants()
    if args.sheet:
        sheets(Path(args.out), QA_DIR)

    if problems:
        print()
        for p in problems:
            print(f"FAIL: {p}")
        return 1
    print("\nOK -- one contour, one lip, one radius across the set.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
