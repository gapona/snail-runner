"""
threat_guard.py  Keeps generated art out of the reserved threat colour.

Shared by `build-sky-plates.py` and `build-sprites.py`, which both turn a raw render into a
shipped asset and both have to obey the same palette rule.

**The rule has to reach the art, not just the palette.** `verify:road` checks every colour a
theme declares, but a sky plate and a decor sprite are PNGs — nothing in the TypeScript ever
sees their pixels. A pixel-level check on a rendered frame found 1.13% of the `dusk` frame
sitting in the reserved zone, all of it from the sky plate, and a scatter of threat-red berries
on the bramble sprite. Neither could have been caught by inspecting constants.

Rotating hue rather than desaturating keeps the asset's lightness and saturation, so a sunset
stays a sunset and a berry stays a berry; only the hue moves, and only for pixels that were
inside the guard band.

Constants are mirrored from `src/road/themes.ts`. Duplicated rather than imported because this
is a Python build step and that is TypeScript — a drift between the two shows up in the
browser-side pixel check as a violation rather than passing silently.
"""

import math

THREAT_COLOR = (0xFF, 0x2F, 0x43)
THREAT_MIN_HUE_DEGREES = 30.0
THREAT_MIN_CHROMA = 0.06
THREAT_LIGHTNESS_ESCAPE = 0.22


def _linear(c):
    c /= 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _unlinear(c):
    c = max(0.0, min(1.0, c))
    return round(255 * (12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055))


def to_oklab(rgb):
    r, g, b = (_linear(v) for v in rgb)
    l = (0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b) ** (1 / 3)
    m = (0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b) ** (1 / 3)
    s_ = (0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b) ** (1 / 3)
    return (
        0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s_,
        1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s_,
        0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s_,
    )


def from_oklab(lab):
    L, a, b = lab
    l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
    m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
    s_ = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3
    return (
        _unlinear(+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s_),
        _unlinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s_),
        _unlinear(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s_),
    )


_THREAT_LAB = to_oklab(THREAT_COLOR)
_THREAT_HUE = math.degrees(math.atan2(_THREAT_LAB[2], _THREAT_LAB[1])) % 360


def _hue_gap(hue):
    gap = abs(hue - _THREAT_HUE) % 360
    return 360 - gap if gap > 180 else gap


def is_reserved(rgb):
    """Whether this colour reads as the threat colour, by the same three-part rule as the game."""
    L, a, b = to_oklab(rgb)
    chroma = math.hypot(a, b)

    if chroma < THREAT_MIN_CHROMA:
        return False
    if abs(L - _THREAT_LAB[0]) >= THREAT_LIGHTNESS_ESCAPE:
        return False

    return _hue_gap(math.degrees(math.atan2(b, a)) % 360) < THREAT_MIN_HUE_DEGREES


def enforce_threat_reservation(image):
    """
    Pixel-wise form, for an RGB image. Delegates to `rotate_if_reserved` so the gamut-clamping
    correction is applied here too. Returns how many pixels moved.
    """
    pixels = image.load()
    width, height = image.size
    moved = 0

    for y in range(height):
        for x in range(width):
            rgb = pixels[x, y][:3]
            fixed = rotate_if_reserved(rgb)

            if fixed != rgb:
                pixels[x, y] = fixed + pixels[x, y][3:]
                moved += 1

    return moved


def rotate_if_reserved(rgb):
    """
    Returns `rgb` moved out of the reserved zone, or unchanged if it was already outside it.

    **The result is verified, not assumed.** Rotating hue at constant chroma routinely leaves the
    sRGB gamut -- the space is far from a cylinder -- and the conversion back clamps each channel
    independently, which moves the hue again and can drop the colour straight back into the zone
    it was rotated out of. That is not hypothetical: the first version of this function left 1,327
    "corrected" pixels on the bramble sprite, all of them clamped oranges like `#a14c00` whose
    blue channel had been driven to zero.

    So the rotation is checked, and chroma is walked down until the round trip actually lands
    outside. The last resort is the colour's own grey, which is legal by definition: below the
    chroma floor a hue angle is noise and cannot read as a signal.
    """
    if not is_reserved(rgb):
        return rgb

    L, a, b = to_oklab(rgb)
    chroma = math.hypot(a, b)
    hue = math.degrees(math.atan2(b, a)) % 360
    signed = ((hue - _THREAT_HUE + 180) % 360) - 180
    target = math.radians(_THREAT_HUE + (THREAT_MIN_HUE_DEGREES + 2.0) * (1 if signed >= 0 else -1))

    scale = 1.0
    for _ in range(12):
        candidate = from_oklab((L, chroma * scale * math.cos(target), chroma * scale * math.sin(target)))

        if not is_reserved(candidate):
            return candidate

        scale *= 0.8

    # Grey at the same lightness: chroma 0 is always under the floor.
    return from_oklab((L, 0.0, 0.0))


def enforce_threat_reservation_palette(image):
    """
    Corrects an indexed image's **palette** rather than its pixels.

    This is the form that composes with quantisation. Correcting pixels and then quantising walks
    them back into the reserved zone (every pixel moves to its nearest palette entry, and the
    nearest entry is usually the one it came from); correcting pixels *after* quantising means
    shipping an RGB image, which cost 120KB across the six sky plates. Fixing the palette itself
    leaves the file indexed and makes every pixel legal by construction, because a pixel can only
    ever be one of these entries.

    Returns how many palette entries were moved.
    """
    palette = image.getpalette()

    if palette is None:
        raise ValueError("enforce_threat_reservation_palette needs an indexed image")

    moved = 0
    corrected = list(palette)

    for i in range(0, len(palette), 3):
        entry = tuple(palette[i : i + 3])
        fixed = rotate_if_reserved(entry)

        if fixed != entry:
            corrected[i : i + 3] = list(fixed)
            moved += 1

    if moved:
        image.putpalette(corrected)

    return moved
