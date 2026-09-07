"""
ui_metrics.py  What a button in this style IS, measured.

ONE definition of every number in ART-STYLE.md, imported by three callers:
measure-ui-refs.py (what the references actually do), normalize-ui.py (what
the shipped set must do) and the acceptance contact sheet. A second copy
would be a second definition of "outline thickness", and the whole premise of
the normalizer is that one number means one thing across the set.

-- The button is five horizontal layers, and that is the whole model --------

    ink        the dark contour, equal thickness on all four sides AND on the
               seam between face and cheek
    band       a light strip along the top of the face
    face       flat, one colour, no gradient and no gloss
    cheek      a deeper tone of the same hue along the bottom -- the whole of
               the object's volume
    ink        the contour again

The outer light rim visible in the references is deliberately NOT part of this
model: the engine strokes it over the sprite (see ART-STYLE.md), because a
generator cannot hold it even and a stroke is even by construction. When a
reference crop carries one, measure() reports it as rim_px and excludes it
from every other number.

-- How a row is classified, and why by luminance rather than by hue --------

Every layer here is the same hue at a different value -- that is what makes
the style one language across six colours. So the classifier reads value,
relative to the button's own face, and never hue:

    ink     luma < INK_LUMA_MAX          (absolute: ink is ink at any hue)
    rim     luma > RIM_LUMA_MIN and desaturated
    band    luma > face * BAND_RATIO_MIN
    cheek   luma < face * CHEEK_RATIO_MAX
    face    everything else

Reading band and cheek relative to the face is what lets one threshold serve a
pale yellow PLAY and a deep purple SETTINGS with no per-colour table.

-- Text is excluded by taking the MODE, not by masking it ------------------

A reference button carries a centred label, and a label is a minority of the
pixels in any row it crosses (letters are thin). So each row's colour is the
mode over the interior width, quantised into buckets of QUANT and refined to
the mean of the pixels near that mode. Masking near-white instead would eat
the top band on a pale button, which is a layer we have to measure.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, asdict, field

import numpy as np

# -- Classification thresholds ----------------------------------------------
#
# Absolute for ink and rim, relative for band and cheek. See the docstring for
# why the split falls there.
INK_LUMA_MAX = 42.0      # 0-255 perceived luma; the shipped contour sits near 5
RIM_LUMA_MIN = 216.0     # the outer light rim, when a crop carries one
RIM_SAT_MAX = 46.0       # ...and it is near-neutral, unlike a pale top band
BAND_RATIO_MIN = 1.05    # a band is at least 5% lighter than its own face
CHEEK_RATIO_MAX = 0.82   # a cheek is at least 18% deeper than its own face
QUANT = 8                # mode bucket width

# A quarter disc of radius r leaves this fraction of its bounding box empty.
CORNER_EMPTY_FRACTION = 1.0 - np.pi / 4.0


def luma(rgb) -> float:
    """Perceived luma, 0-255. Rec.601 -- the axis this style separates on."""
    return 0.299 * float(rgb[0]) + 0.587 * float(rgb[1]) + 0.114 * float(rgb[2])


def saturation(rgb) -> float:
    return float(max(rgb[:3])) - float(min(rgb[:3]))


@dataclass
class Metrics:
    """Every number ART-STYLE.md states, for one button."""

    width: int = 0
    height: int = 0

    rim_px: float = 0.0          # outer light rim, 0 when absent (as we ship it)
    ink_top: float = 0.0
    ink_bottom: float = 0.0
    ink_left: float = 0.0
    ink_right: float = 0.0
    ink_seam: float = 0.0        # face/cheek boundary -- the one most often absent

    band_px: float = 0.0
    face_px: float = 0.0
    cheek_px: float = 0.0

    radius_px: float = 0.0
    radius_corners: list = field(default_factory=list)  # tl, tr, bl, br

    face_rgb: tuple = (0, 0, 0)
    band_rgb: tuple = (0, 0, 0)
    cheek_rgb: tuple = (0, 0, 0)
    ink_rgb: tuple = (0, 0, 0)

    face_spread: float = 0.0     # luma range inside the face -- 0 is flat
    rows: list = field(default_factory=list)   # per-row class, for debugging

    # -- Derived, and these are the ones the spec is written in --------------
    @property
    def ink_px(self) -> float:
        """The contour thickness the set is held to: the mean of four sides."""
        return (self.ink_top + self.ink_bottom + self.ink_left + self.ink_right) / 4.0

    @property
    def ink_spread(self) -> float:
        sides = [self.ink_top, self.ink_bottom, self.ink_left, self.ink_right]
        return max(sides) - min(sides)

    @property
    def band_frac(self) -> float:
        return self.band_px / self.height if self.height else 0.0

    @property
    def cheek_frac(self) -> float:
        return self.cheek_px / self.height if self.height else 0.0

    @property
    def radius_frac(self) -> float:
        return self.radius_px / self.height if self.height else 0.0

    @property
    def radius_spread(self) -> float:
        if not self.radius_corners:
            return 0.0
        return max(self.radius_corners) - min(self.radius_corners)

    def summary(self) -> dict:
        d = asdict(self)
        d.pop("rows", None)
        d.update(
            ink_px=round(self.ink_px, 2),
            ink_spread=round(self.ink_spread, 2),
            band_frac=round(self.band_frac, 4),
            cheek_frac=round(self.cheek_frac, 4),
            radius_frac=round(self.radius_frac, 4),
            radius_spread=round(self.radius_spread, 2),
        )
        return d


EDGE_SAMPLE_FRACTION = 0.10   # of the button's width, taken from each side


def _row_mode(row: np.ndarray) -> np.ndarray:
    """The colour of one row, sampled where a centred label cannot reach.

    Two earlier versions of this measured the LABEL instead of the face, and
    the second failure is the instructive one:

      the plain mode  -- white letters are genuinely the plurality across the
                         middle rows of a button carrying a wide bold word
                         (CONTINUE, MUSIC ON/OFF): 10 of 23 reference buttons
                         reported the label as their face colour.
      dropping white  -- these labels are white with a DARK STROKE, so removing
                         the white promotes the stroke, and 6 of 23 then
                         reported near-black. The stroke is the same colour as
                         the button's own contour, so no colour test separates
                         them.

    What does separate them is POSITION: a label is centred and padded, so the
    face is always visible just inside the side contour. This samples a slice
    from each end of the row's own span, skipping the contour it starts on, and
    takes the mode of the two together.
    """
    n = len(row)
    lum = 0.299 * row[:, 0] + 0.587 * row[:, 1] + 0.114 * row[:, 2]
    k = max(2, int(round(n * EDGE_SAMPLE_FRACTION)))

    def slice_from(idx):
        i, taken = 0, []
        while i < n and lum[idx[i]] < INK_LUMA_MAX:   # skip the contour
            i += 1
        while i < n and len(taken) < k:
            taken.append(idx[i])
            i += 1
        return taken

    picks = slice_from(list(range(n))) + slice_from(list(range(n - 1, -1, -1)))
    use = row[picks] if len(picks) >= 2 else row

    buckets = [
        (int(c[0]) // QUANT, int(c[1]) // QUANT, int(c[2]) // QUANT) for c in use
    ]
    top = Counter(buckets).most_common(1)[0][0]
    near = np.array([c for c, b in zip(use, buckets) if b == top], dtype=float)
    return near.mean(axis=0)


def _peel(cls: list[str], reverse: bool = False) -> tuple[int, int, int]:
    """Strip the chrome off one end and report it.

    Returns (rim, ink, first_content_index) in the walk's own direction. The
    reference sheets stack the edge as [outer dark] [light rim] [contour]
    [content], so the contour that matters is the INNERMOST ink run, not the
    first one met. Reading the first one instead is what reported band_px = 0
    on every reference button: the walk stopped on the outer dark line and
    never reached the band behind the rim.

    Our own sprites carry no rim at all (the engine strokes it), so the same
    walk returns rim = 0 and lands on the contour immediately.
    """
    n = len(cls)
    idx = range(n - 1, -1, -1) if reverse else range(n)
    order = list(idx)
    i = 0
    while i < n and cls[order[i]] in ("ink", "rim"):
        i += 1
    first_content = i
    ink = 0
    j = first_content - 1
    while j >= 0 and cls[order[j]] == "ink":
        ink += 1
        j -= 1
    rim = 0
    while j >= 0 and cls[order[j]] == "rim":
        rim += 1
        j -= 1
    return rim, ink, first_content


def shape_mask(img: np.ndarray, bg=None, alpha_floor: int = 128) -> np.ndarray:
    """Which pixels are the button.

    RGBA decides on alpha; an RGB crop out of a reference sheet decides by
    distance from the sheet's own background, sampled from the crop's corners
    rather than assumed -- the two sheets use different navies.

    ⚠ The alpha threshold is HALF COVERAGE and not the matte's 6% floor. This
    is a question about where an edge IS, and at 6% every antialiased pixel
    around the arc counts as inside -- which read a 19 px corner as 16.2, a 15%
    undershoot, and would have had the normalizer "correcting" a radius that
    was already right. The matte floor answers a different question (which
    pixels carry information) and belongs to verify:mattes.
    """
    if img.shape[2] == 4:
        return img[:, :, 3] >= alpha_floor
    if bg is None:
        corners = np.array(
            [img[0, 0, :3], img[0, -1, :3], img[-1, 0, :3], img[-1, -1, :3]],
            dtype=float,
        )
        bg = np.median(corners, axis=0)
    d = np.abs(img[:, :, :3].astype(float) - np.asarray(bg, dtype=float)).sum(axis=2)
    return d > 60


def measure(img: np.ndarray, bg=None, expect_rim: bool = True) -> Metrics:
    """Measure one button. img is HxWx3 or HxWx4, cropped to roughly the button.

    `expect_rim` is False for a sprite we authored, and it is not a convenience.
    The rim test is "near-white and near-neutral", which on a COLOURED reference
    button separates a pale outer rim from a saturated top band -- and on our
    own GREYSCALE masters matches the top band exactly, because a value map has
    no saturation to tell them apart. Left on, it peeled the band off as chrome
    and reported the contour above it as 0 px, i.e. a set that measured as
    having no top contour at all.
    """
    m = Metrics()
    mask = shape_mask(img, bg)
    ys, xs = np.nonzero(mask)
    if len(ys) == 0:
        return m
    y0, y1, x0, x1 = int(ys.min()), int(ys.max()), int(xs.min()), int(xs.max())
    m.height = y1 - y0 + 1
    m.width = x1 - x0 + 1

    rgb = img[:, :, :3].astype(float)

    # -- Vertical profile: one colour per row, label voted out ---------------
    #
    # The interior inset skips the side contour and the corner arcs, so a row's
    # mode is a mode over the face and not over the edge.
    # Each row is sampled across ITS OWN span rather than a fixed inset, so the
    # corner arcs -- where the shape is narrower than the button -- are read
    # from where the shape actually is instead of from the empty ground beside
    # it. A fixed inset also has to be wider than the largest corner radius,
    # which on these buttons is 0.4 of the height.
    prof = []
    for y in range(y0, y1 + 1):
        on = np.nonzero(mask[y, x0 : x1 + 1])[0]
        if len(on) < 4:
            seg = rgb[y, x0 : x1 + 1]
        else:
            seg = rgb[y, x0 + int(on.min()) : x0 + int(on.max()) + 1]
        prof.append(_row_mode(seg))
    prof = np.array(prof)
    lum = np.array([luma(c) for c in prof])
    sat = np.array([saturation(c) for c in prof])

    # -- The face, and everything else relative to it ------------------------
    #
    # Taken from the middle of the button, which is face on every arrangement
    # this style admits: the band is at the top and the cheek at the bottom.
    mid0, mid1 = int(len(prof) * 0.40), int(len(prof) * 0.62)
    face_rows = np.arange(mid0, max(mid1, mid0 + 1))
    face_l = float(np.median(lum[face_rows]))
    m.face_rgb = tuple(int(v) for v in np.round(np.median(prof[face_rows], axis=0)))

    cls = []
    for i in range(len(prof)):
        if lum[i] < INK_LUMA_MAX:
            cls.append("ink")
        elif expect_rim and lum[i] > RIM_LUMA_MIN and sat[i] < RIM_SAT_MAX:
            cls.append("rim")
        elif lum[i] > face_l * BAND_RATIO_MIN:
            cls.append("band")
        elif lum[i] < face_l * CHEEK_RATIO_MAX:
            cls.append("cheek")
        else:
            cls.append("face")
    m.rows = cls

    def run_at(start, want, step):
        n, i = 0, start
        while 0 <= i < len(cls) and cls[i] in want:
            n += 1
            i += step
        return n

    rim_t, ink_t, after_top = _peel(cls)
    rim_b, ink_b, from_bottom = _peel(cls, reverse=True)
    m.rim_px = float(max(rim_t, rim_b))
    m.ink_top, m.ink_bottom = float(ink_t), float(ink_b)

    cheek_end = len(cls) - from_bottom          # one past the last content row
    m.band_px = float(run_at(after_top, {"band"}, 1))
    m.cheek_px = float(run_at(cheek_end - 1, {"cheek"}, -1))
    m.face_px = float(cls.count("face"))

    if m.band_px:
        m.band_rgb = tuple(
            int(v)
            for v in np.round(prof[after_top : after_top + int(m.band_px)].mean(axis=0))
        )
    if m.cheek_px:
        seg = prof[cheek_end - int(m.cheek_px) : cheek_end]
        m.cheek_rgb = tuple(int(v) for v in np.round(seg.mean(axis=0)))

    ink_rows = [i for i, c in enumerate(cls) if c == "ink"]
    if ink_rows:
        m.ink_rgb = tuple(int(v) for v in np.round(prof[ink_rows].mean(axis=0)))

    face_idx = [i for i, c in enumerate(cls) if c == "face"]
    if face_idx:
        m.face_spread = float(lum[face_idx].max() - lum[face_idx].min())

    # -- The seam: the contour between face and cheek ------------------------
    #
    # The ink run immediately above the cheek. It is 0 on most of the reference
    # buttons, which is a finding rather than a measurement failure -- see
    # ART-STYLE.md.
    if m.cheek_px:
        m.ink_seam = float(run_at(cheek_end - int(m.cheek_px) - 1, {"ink"}, -1))

    # -- Side contour, on a row that is face at both edges -------------------
    row_y = y0 + int(m.rim_px + m.ink_top + m.band_px + m.face_px * 0.5)
    row_y = min(max(row_y, y0), y1)
    row = rgb[row_y, x0 : x1 + 1]
    rcls = []
    for c in row:
        lv, sv = luma(c), saturation(c)
        if lv < INK_LUMA_MAX:
            rcls.append("ink")
        elif expect_rim and lv > RIM_LUMA_MIN and sv < RIM_SAT_MAX:
            rcls.append("rim")
        else:
            rcls.append("face")
    _, m.ink_left, _ = (lambda t: (t[0], float(t[1]), t[2]))(_peel(rcls))
    _, m.ink_right, _ = (lambda t: (t[0], float(t[1]), t[2]))(_peel(rcls, reverse=True))

    # -- Corner radius, fitted to the arc rather than to the area it removes -
    #
    # Two estimators were tried. The area one -- r = sqrt(missing / (1 - pi/4))
    # over a corner box -- reads 16.7 on a corner measured at 14, an 18%
    # overshoot, because the antialiased fringe outside the arc counts as
    # missing. "The inset of the topmost row" is worse still: that row is the
    # one antialiasing eats, and it read 12 on the same corner.
    #
    # So the fit is over the whole arc: inset(y) = r - sqrt(r^2 - (r-y)^2) for
    # the first r rows, least squares over r. Every row constrains it, so no
    # single antialiased row can carry the answer.
    sub = mask[y0 : y1 + 1, x0 : x1 + 1]
    for flip_y, flip_x in ((0, 0), (0, 1), (1, 0), (1, 1)):
        q = sub[::-1] if flip_y else sub
        q = q[:, ::-1] if flip_x else q
        m.radius_corners.append(round(_fit_radius(q), 2))
    m.radius_px = float(np.mean(m.radius_corners))
    return m


def _fit_radius(q: np.ndarray, r_max: int | None = None) -> float:
    """Least-squares radius of the arc in q's top-left corner."""
    h, w = q.shape
    limit = r_max or int(min(h, w) * 0.5)
    if limit < 2:
        return 0.0
    insets = []
    for y in range(limit):
        on = np.nonzero(q[y])[0]
        insets.append(float(on.min()) if len(on) else float(w))
    ys = np.arange(limit, dtype=float)
    best, best_err = 0.0, float("inf")
    for r10 in range(0, limit * 10 + 1):
        r = r10 / 10.0
        model = np.where(ys < r, r - np.sqrt(np.maximum(r * r - (r - ys) ** 2, 0.0)), 0.0)
        err = float(((model - np.array(insets)) ** 2).sum())
        if err < best_err:
            best, best_err = r, err
    return best
