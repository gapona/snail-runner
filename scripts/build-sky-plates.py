"""
build-sky-plates.py  Turn the generated sky plates in dev-assets/ into shippable ones.

Run by hand whenever the source plates change; the output is committed, so a normal
`npm run build` never needs Python:

  py -3.11 scripts/build-sky-plates.py

Reads dev-assets/sky/<theme>_v<n>.png (the picked variant per theme, PICKS below) and writes
public/assets/sky/<theme>.png.

Two transforms, both of which pay for themselves many times over:

  downscale to 384x320   The raw plates are 1344x768 and weigh 370KB-1.5MB each -- 4.8MB for
                         the six, which alone would blow chunk 11's 3MB starting-weight
                         acceptance. They are near-uniform horizontally (the generator measured
                         `structX` at 0.15-0.4), so horizontal resolution buys almost nothing,
                         and the vertical gradient survives 320 rows without visible stepping.

  128-colour palette     SDXL never emits truly flat colour -- there is always low-amplitude
                         noise -- and that noise is most of the file. Snapping to a palette
                         collapses it. 128 was checked by eye against the RGB version at 2x:
                         no banding in the gradient, which is the one thing a palette can ruin.

Together: 4.77MB -> ~330KB, a 14x reduction, with the whole set shipping inside budget.

The horizontal wrap survives both steps. It is a property of the leftmost and rightmost columns
matching (the generator measured 0.29-5.90 out of 255, at or below each plate's own interior
column-to-column difference); a symmetric resize and a palette lookup both treat those two
columns the same way as every other.
"""

from pathlib import Path

from PIL import Image

from threat_guard import enforce_threat_reservation_palette

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "dev-assets" / "sky"
DST = ROOT / "public" / "assets" / "sky"

# The variant chosen per theme, from the generator's own acceptance numbers (mean luma inside
# the theme's band, smallest left/right edge difference, lowest `structX` -- the landscape
# detector). Recorded here rather than in a comment elsewhere so re-running this script cannot
# silently pick a different plate than the one that was reviewed.
#
# ice, ember and verdant moved off their first picks because those three carried a hard
# horizontal edge at y=0.45 -- the boundary of a mask in the generator's own post-processing,
# where a hard cut in a per-row multiplier became a hard edge in the image. Measured as the
# row-to-row jump at that row over the plate's typical jump: 117.9, 324.8 and 206.4 against
# 0.8-4.3 for a clean plate. Numbers alone had passed it; it took looking at the thing.
PICKS = {
    # `day` is the default theme and shipped without a plate at all, so its sky fell back to the
    # procedural gradient the other six exist to replace.
    #
    # **v1, down from v5, and the reason is the one thing this pipeline cannot deliver: a plate
    # with vertical structure in it.** The sky layer is one `TileSprite` covering the whole
    # viewport in exactly one vertical repeat (`Backdrop.layout`), while tiling horizontally at
    # 1:1 -- so a 320px plate on a 945px frame is stretched **3x vertically and not at all
    # horizontally**. Horizontal features (every other theme's haze bands) survive that; round
    # cloud lobes do not. v5's soft cloud banks drew in the running game as a row of tall pale
    # spires standing on the horizon, which is what a player reported, and no amount of picking
    # between v5/v6/v8 fixes it -- they all have clouds.
    #
    # v1 is `dev-assets/sky/NOTES-day.md`'s own second choice, named there for exactly this case
    # ("pick this one if the reviewer decides a cloud is content competing with the gameplay
    # drawn in front of it"). It is a pure gradient plus a low haze band, i.e. horizontal-only
    # structure: `structX` **0.234** against v5's 0.900. It still carries the whole reason the
    # plates exist over the procedural fallback -- the gamma-3 ramp holds blue through the top
    # three quarters, **18.2 levels per channel** of mean difference -- and it has the tightest
    # wrap of the eight (0.282 seam against its own 0.279 interior grain).
    "day": 1,
    "night": 1,
    "dusk": 2,
    "ice": 4,
    "ember": 4,
    "verdant": 8,
    "signal": 1,
}

WIDTH = 384
HEIGHT = 320
COLORS = 128


def main() -> None:
    DST.mkdir(parents=True, exist_ok=True)
    total_in = 0
    total_out = 0

    for theme, variant in PICKS.items():
        source = SRC / f"{theme}_v{variant}.png"

        if not source.exists():
            raise SystemExit(f"missing source plate: {source}")

        image = Image.open(source).convert("RGB").resize((WIDTH, HEIGHT), Image.LANCZOS)
        # **The guard corrects the palette, after quantisation.** Correcting pixels first does
        # not survive the quantiser — every pixel moves to its nearest palette entry, which walks
        # it straight back into the reserved zone (the same trap as quantising alpha in
        # `build-sprites.py`, one step further along the pipeline). Correcting pixels *after*
        # quantising works but forces an RGB save, which cost 120KB across the six. Correcting
        # the 128 palette entries keeps the file indexed and makes every pixel legal by
        # construction, since a pixel can only ever be one of them.
        image = image.convert("P", palette=Image.ADAPTIVE, colors=COLORS)
        moved = enforce_threat_reservation_palette(image)

        target = DST / f"{theme}.png"
        image.save(target, "PNG", optimize=True)

        size_in = source.stat().st_size
        size_out = target.stat().st_size
        total_in += size_in
        total_out += size_out
        print(
            f"{theme:9} v{variant}  {size_in:>9,} -> {size_out:>7,}  ({size_in / size_out:.1f}x)"
            f"   palette entries rotated: {moved:>3}"
        )

    print(f"{'TOTAL':12}  {total_in:>9,} -> {total_out:>7,}  ({total_in / total_out:.1f}x)")


if __name__ == "__main__":
    main()
