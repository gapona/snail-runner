"""
measure-ui-refs.py  What the reference sheets actually do, in numbers.

  py -3.11 scripts/measure-ui-refs.py

Reads the two reference sheets in references/, finds every button on them by
scanning the grid rather than by a hand-typed table of boxes (a typed box goes
stale the first time a sheet is re-exported), measures each through
ui_metrics.measure, and prints the distribution ART-STYLE.md is written from.

It asserts nothing. The references are evidence, not a build artefact -- what
is held to a threshold is our own output, in normalize-ui.py. What this script
is for is that every number in ART-STYLE.md can be re-derived rather than
believed, including the two places where the references disagree with the
brief and the brief wins.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ui_metrics import measure, luma  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
REFS = ROOT / "references"

# The two sheets, and the region of each that holds buttons rather than
# creatures, collectibles or a phone mockup. Stated as fractions so a
# re-exported sheet at another size still lands on the same content.
SHEETS = [
    ("ui-buttons-sheet.png", (0.00, 0.05, 0.46, 0.58), "button grid"),
    ("ui-screens-sheet.png", (0.00, 0.63, 0.34, 0.87), "menu stack"),
]

MIN_W, MIN_H = 55, 18
MAX_ASPECT, MIN_ASPECT = 7.0, 1.6
PAD = 6  # room for the contour and the outer rim, which the saturated mask misses


def find_buttons(a: np.ndarray, region) -> list[tuple[int, int, int, int]]:
    """Grid scan: saturated bands down the page, then runs across each band."""
    h, w = a.shape[:2]
    fx0, fy0, fx1, fy1 = region
    X0, Y0 = int(w * fx0), int(h * fy0)
    X1, Y1 = int(w * fx1), int(h * fy1)

    mx, mn = a.max(2), a.min(2)
    hot = (mx > 105) & ((mx - mn) > 45)

    boxes = []
    rows = hot[Y0:Y1, X0:X1].sum(1)
    band, y = None, 0
    while y < len(rows):
        if rows[y] > 10 and band is None:
            band = y
        elif rows[y] <= 10 and band is not None:
            if y - band >= MIN_H:
                boxes += _cut_band(hot, X0, X1, Y0 + band, Y0 + y - 1)
            band = None
        y += 1
    if band is not None and len(rows) - band >= MIN_H:
        boxes += _cut_band(hot, X0, X1, Y0 + band, Y1 - 1)
    return boxes


def _cut_band(hot, X0, X1, y0, y1) -> list[tuple[int, int, int, int]]:
    out = []
    cols = hot[y0 : y1 + 1, X0:X1].sum(0)
    run, x = None, 0
    while x < len(cols):
        if cols[x] > 2 and run is None:
            run = x
        elif cols[x] <= 2 and run is not None:
            out.append((X0 + run, y0, X0 + x - 1, y1))
            run = None
        x += 1
    if run is not None:
        out.append((X0 + run, y0, X1 - 1, y1))
    keep = []
    for bx0, by0, bx1, by1 in out:
        w, h = bx1 - bx0 + 1, by1 - by0 + 1
        if w < MIN_W or h < MIN_H:
            continue
        if not (MIN_ASPECT <= w / h <= MAX_ASPECT):
            continue
        keep.append((bx0, by0, bx1, by1))
    return keep


def main() -> None:
    all_m = []
    for name, region, label in SHEETS:
        path = REFS / name
        if not path.exists():
            print(f"missing {path}")
            continue
        img = Image.open(path).convert("RGB")
        a = np.asarray(img).astype(int)
        boxes = find_buttons(a, region)
        print(f"\n=== {name} -- {label}: {len(boxes)} buttons ===")
        print(
            f"{'#':>3} {'w x h':>9} {'ink':>5} {'spread':>6} {'seam':>5} "
            f"{'band':>5} {'band/h':>7} {'cheek':>5} {'cheek/h':>8} "
            f"{'r':>5} {'r/h':>6} {'rSpr':>5} {'flat':>5} {'rim':>4}  face"
        )
        for i, (x0, y0, x1, y1) in enumerate(boxes):
            crop = a[
                max(y0 - PAD, 0) : y1 + PAD + 1,
                max(x0 - PAD, 0) : x1 + PAD + 1,
            ]
            m = measure(crop)
            if m.height < MIN_H:
                continue
            all_m.append((name, i, m))
            print(
                f"{i:>3} {m.width:>4}x{m.height:<4} {m.ink_px:>5.1f} "
                f"{m.ink_spread:>6.1f} {m.ink_seam:>5.1f} {m.band_px:>5.1f} "
                f"{m.band_frac:>7.3f} {m.cheek_px:>5.1f} {m.cheek_frac:>8.3f} "
                f"{m.radius_px:>5.1f} {m.radius_frac:>6.3f} {m.radius_spread:>5.1f} "
                f"{m.face_spread:>5.1f} {m.rim_px:>4.1f}  {m.face_rgb}"
            )

    if not all_m:
        return

    def col(f):
        return np.array([f(m) for _, _, m in all_m], dtype=float)

    print("\n=== distribution over %d buttons ===" % len(all_m))
    for label, vals in (
        ("ink px", col(lambda m: m.ink_px)),
        ("ink spread px", col(lambda m: m.ink_spread)),
        ("ink seam px", col(lambda m: m.ink_seam)),
        ("band / height", col(lambda m: m.band_frac)),
        ("cheek / height", col(lambda m: m.cheek_frac)),
        ("radius / height", col(lambda m: m.radius_frac)),
        ("radius spread px", col(lambda m: m.radius_spread)),
        ("face luma spread", col(lambda m: m.face_spread)),
        ("outer rim px", col(lambda m: m.rim_px)),
    ):
        print(
            f"  {label:<18} min {vals.min():7.3f}  median {np.median(vals):7.3f}  "
            f"mean {vals.mean():7.3f}  max {vals.max():7.3f}"
        )

    # -- The two ratios the palette is built from ---------------------------
    #
    # Stated as luma ratios rather than as colours, because that is the form a
    # generator or a builder can apply to a colour it has never seen.
    bands, cheeks = [], []
    for _, _, m in all_m:
        fl = luma(m.face_rgb)
        if m.band_px and fl:
            bands.append(luma(m.band_rgb) / fl)
        if m.cheek_px and fl:
            cheeks.append(luma(m.cheek_rgb) / fl)
    if bands:
        b = np.array(bands)
        print(
            f"  {'band luma / face':<18} min {b.min():7.3f}  median {np.median(b):7.3f}"
            f"  mean {b.mean():7.3f}  max {b.max():7.3f}   (n={len(b)})"
        )
    if cheeks:
        c = np.array(cheeks)
        print(
            f"  {'cheek luma / face':<18} min {c.min():7.3f}  median {np.median(c):7.3f}"
            f"  mean {c.mean():7.3f}  max {c.max():7.3f}   (n={len(c)})"
        )


if __name__ == "__main__":
    main()
