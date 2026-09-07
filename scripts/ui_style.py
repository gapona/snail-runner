"""
ui_style.py  ART-STYLE.md's table, machine-readable.

The document is the argument; this is the copy the build imports. Every number
here appears there with the measurement or the constraint it came from, and
nothing here may be changed without changing it there -- `normalize-ui.py`
prints this table into its own report so the two cannot drift silently.

-- The masters are a VALUE MAP, not artwork ------------------------------

Every sprite ships greyscale and the engine colours it. That is forced rather
than chosen: the primary button's accent comes from the ACTIVE THEME and has to
clear `ACCENT_MIN_BACKDROP_CONTRAST` against the near road it is drawn over
(it was against the *sky* until the buttons were measured and found to sit well
below the horizon -- see `accentFor`), so a baked primary
would have to be baked once per theme and re-baked whenever a theme is
repainted. One master and a runtime recolour is the same arrangement the
mascot's five skins already use, for the same reason.

So a master's grey is a LIGHTNESS RATIO to the face, and the four values below
are ART-STYLE.md's tone table written as pixels:

    FACE_GREY  is 1.00 by definition
    BAND_GREY / FACE_GREY = 1.25      the top strip
    CHEEK_GREY / FACE_GREY = 0.60     the lip
    INK_GREY / FACE_GREY = 0.06       the contour

The engine reads a pixel's grey, divides by FACE_GREY and scales the accent's
OKLab lightness by it. Antialiased pixels fall between the four and interpolate
correctly for free, which a four-entry lookup would not do.
"""

from __future__ import annotations

# -- Geometry, in pixels at the native height ------------------------------
NATIVE_HEIGHT = 64
INK = 2            # 0.031 of height
BAND = 6           # 0.094 of height, the brief's ~1/10
CHEEK = 13         # 0.203 of height, the brief's ~1/5
RADIUS = 19        # 0.297 of height
CHEEK_PRESSED = 3  # the lip when pressed; the shape sinks by CHEEK - this

SINK = CHEEK - CHEEK_PRESSED

# -- The floor the radius is solved against --------------------------------
#
# A nine-slice never stretches its corner patches, so the smallest height a
# sprite can be drawn at is 2*(RADIUS + INK) + 1. The kit's minimum touch
# target is 44, and that is the one size the interface is guaranteed to ask
# for -- so the radius the references measure at (0.32 * 64 = 21) is one the
# sprite could not be drawn at. Asserted in normalize-ui.py rather than left
# in a comment.
MIN_TOUCH = 44

# -- Nine-slice insets ------------------------------------------------------
#
# ONE inset on all four sides, computed rather than eyeballed: it has to
# contain the corner arc (RADIUS + INK), the top band (INK + BAND) and the
# cheek (CHEEK + INK), and the arc is the largest of the three.
SLICE = RADIUS + INK

# -- Tone, as ART-STYLE.md's ratios written as greys ------------------------
FACE_GREY = 190
BAND_GREY = 238    # 1.253 x face
CHEEK_GREY = 114   # 0.600 x face
INK_GREY = 11      # 0.058 x face

# -- Alpha ------------------------------------------------------------------
#
# The same floor `build-sprites.py` and `verify-mattes.mjs` share. Compared as
# a FLOAT against the same constant on both sides: the build once cleared
# `byte < round(0.06*255)` = 15 while the check failed `byte/255 < 0.06`, i.e.
# 15.3, so exactly one alpha value survived the build and failed the check.
ALPHA_FLOOR = 0.06

# -- The set ----------------------------------------------------------------
#
# `slice` names the AXIS that stretches, and it has three values rather than a
# boolean because the set needs all three:
#
#   "xy"    a button or a panel: both middles stretch.
#   "x"     the progress bar. Its height is fixed by the readout it belongs to,
#           and at 40 px it is SHORTER than two 21 px insets -- so a sprite
#           sliced on both axes would have no vertical centre at all. The
#           geometry check caught exactly that on its first run.
#   "none"  the round button: a circle has no straight middle to stretch, so it
#           is drawn at a uniform scale, which is why it is authored larger
#           than it is ever drawn.
#
# `pressed` marks the shapes that take a second state. A panel is not pressed
# and neither half of a bar is -- shipping a pressed state for them would be
# more sprites to keep in step for a state that never arrives.
SHAPES: dict[str, dict] = {
    "btn": {"size": (192, NATIVE_HEIGHT), "kind": "rect", "slice": "xy", "pressed": True},
    "round": {"size": (96, 96), "kind": "circle", "slice": "none", "pressed": True},
    "panel": {"size": (256, 192), "kind": "rect", "slice": "xy", "pressed": False},
    "bar_frame": {"size": (256, 40), "kind": "trough", "slice": "x", "pressed": False},
    "bar_fill": {"size": (256, 40), "kind": "fill", "slice": "x", "pressed": False},
}

# -- Thresholds normalize-ui.py fails on ------------------------------------
#
# These are what the brief asks for in as many words: the build stops if the
# contour thickness or the cheek height varies across the set. They are stated
# in pixels at the native height and they are TIGHT on purpose -- the whole
# value of a normalizer is that afterwards one number means one thing, so
# anything above half a pixel is a set that was not normalised.
MAX_INK_SPREAD = 0.5
MAX_CHEEK_SPREAD = 0.5
MAX_RADIUS_SPREAD = 0.5


def table() -> list[tuple[str, str]]:
    """The spec as rows, for the report normalize-ui.py prints."""
    h = NATIVE_HEIGHT
    return [
        ("native height", f"{h}"),
        ("ink", f"{INK} px  ({INK / h:.3f} of height)"),
        ("band", f"{BAND} px  ({BAND / h:.3f})"),
        ("cheek", f"{CHEEK} px  ({CHEEK / h:.3f})"),
        ("radius", f"{RADIUS} px  ({RADIUS / h:.3f})"),
        ("cheek pressed", f"{CHEEK_PRESSED} px, sink {SINK} px"),
        ("slice inset", f"{SLICE} px all round"),
        ("band / face", f"{BAND_GREY / FACE_GREY:.3f}"),
        ("cheek / face", f"{CHEEK_GREY / FACE_GREY:.3f}"),
        ("ink / face", f"{INK_GREY / FACE_GREY:.3f}"),
    ]
