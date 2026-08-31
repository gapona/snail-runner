"""coin_render.py  The coin, as geometry, through this game's own renderer.

  py -3.11 dev-assets/cc0-3d/coin_render.py --sheet out.png       the comparison sheet
  py -3.11 dev-assets/cc0-3d/coin_render.py --shape struck --yaw 10 --pitch -12

WHY THIS EXISTS

**The diffusion route has failed this one subject four times and the reason is already written
down.** `CLAUDE.md`'s "This checkpoint draws objects, not symbols": a coin is the one subject whose
defining feature is that something is struck into its face, so the model either strikes a glyph
into it (a "0", a monogram, a pair of eyes) or retreats to the nearest object it does have a prior
for, which is a machine washer. All twelve `pick_coin_v*` renders are one or the other, and the
shipped pick (`v10`) is a STEEL bearing at three-quarters with a grey plug in its bore and a cast
shadow baked into the matte. Measured against its own family it is the least saturated thing in
it: **25% against the fruits' 53-66%.**

A coin is also the easiest object in this game to state as geometry: a surface of revolution with
six numbers in it. So it is one here, rendered by `smooth_render.render` -- the same smooth-normal
Blinn-Phong pass that produced the fruit -- which buys three things the render route could not:

  NO ARTEFACT       The alpha is triangle coverage, so there is no plate, no halo and no baked
                    cast shadow to strip. That is the reported defect, answered by construction
                    rather than by a matte step that might miss it.
  THE FAMILY'S OWN  Same light, same specular, same ambient, same value scale as the fruit and the
  SHADING           low-poly props, so it cannot drift into a second art language.
  A CHOSEN GOLD     `Kd` is a number rather than whatever the sampler felt like, so the saturation
                    is set to sit with the fruit instead of below them.

THE ONE DECISION IN HERE

**Through-hole or struck face.** `pickupArt.ts` states the set's identity rule -- fruit is round
with a leaf, shield is a plate, coin is "the only shape with a hole" -- and that rule is what
survives being 13px on a phone. It is also most of why the shipped render reads as hardware: a
gold ring is still a ring.

Both are built here and rendered side by side at the sizes the game actually draws them, because
this is exactly the class of thing the project's standing rule covers: measure what is measurable,
and then look, on a background that hides neither dark paint nor a pale plate.
"""
from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))

from smooth_render import render  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent.parent
OUT = ROOT / "dev-assets" / "lowpoly"

SEGMENTS = 160

# Gold, as two materials. A single flat `Kd` renders a coin that is the same colour edge to centre,
# which is what makes a disc read as a sticker; the rim being a deeper, redder gold gives the eye a
# second plane to read the thickness off.
MTL = """
newmtl gold_face
Kd 1.00 0.72 0.16
newmtl gold_bezel
Kd 1.00 0.83 0.30
newmtl gold_rim
Kd 0.82 0.44 0.06
"""

# **A coin is shinier than a pear, and this is the one place the family's shading is departed
# from.** `smooth_render`'s constants are matched to fruit and stone; gold is a specular metal and
# at the family's 0.12 it renders as painted wood. What is NOT touched is the light direction, the
# ambient or the value scale -- the three that decide whether an object belongs to this frame. The
# highlight is also broadened (a lower power), because a tight one on a 26px sprite is one pixel.
SPEC = {"strength": 0.42, "power": 30.0}


# The milled edge: how many reeds run round the rim, and how deep. **This is the one feature that
# says "coin" rather than "gold disc" without putting a symbol on the face** -- and a symbol is the
# thing the whole generation round failed on. 24 rather than a real coin's ~120: at 96 segments
# that is four segments a reed, and at the 26px this is read at anything finer is noise.
REEDS, REED_DEPTH = 40, 0.007


def revolve(profile, segments: int = SEGMENTS, reeded: bool = False) -> str:
    """A surface of revolution about Z, as OBJ text.

    `profile` is `(radius, z, material)` walked along the silhouette. A point owns the quad that
    starts at it, so the last point's material is never used. `reeded` mills the rings whose
    material is the rim, and only those -- reeding the face would be a groove across the field.
    """
    lines = []
    rings = len(profile)

    for radius, z, material in profile:
        for i in range(segments):
            a = 2 * math.pi * i / segments
            r = radius
            if reeded and material == "gold_rim":
                r += REED_DEPTH * math.cos(REEDS * a)
            lines.append("v %.6f %.6f %.6f" % (r * math.cos(a), r * math.sin(a), z))

    faces = []
    for r in range(rings - 1):
        faces.append("usemtl " + profile[r][2])
        for i in range(segments):
            j = (i + 1) % segments
            a = r * segments + i + 1
            b = r * segments + j + 1
            c = (r + 1) * segments + j + 1
            d = (r + 1) * segments + i + 1
            faces.append("f %d %d %d %d" % (a, b, c, d))

    return "\n".join(lines + faces)


def rim_arc(centre_r: float, radius: float, material: str, steps: int = 7):
    """The rounded edge, front lip round to back lip.

    A chamfer would give the rim two flat planes and a hard corner between them; an arc gives the
    specular somewhere to sit, which is what "chunky rounded forms" means on an object this simple.
    """
    out = []
    for k in range(steps + 1):
        t = math.pi / 2 - math.pi * k / steps
        out.append((centre_r + radius * math.cos(t), radius * math.sin(t), material))
    return out


def holed_coin() -> str:
    """A ring: the silhouette `pickupArt.ts` calls the only shape with a hole."""
    bore, face_z, rim_r = 0.30, 0.15, 0.15
    front = [
        (bore, 0.09, "gold_rim"),
        (bore + 0.06, face_z, "gold_face"),
        (0.52, face_z + 0.004, "gold_face"),
        (0.66, face_z, "gold_face"),
        (0.71, face_z + 0.035, "gold_face"),
        (0.80, face_z + 0.038, "gold_face"),
        (0.85, face_z, "gold_rim"),
    ]
    back = [(r, -z, m) for r, z, m in reversed(front)]
    profile = [(bore, -0.09, "gold_rim")] + front + rim_arc(0.85, rim_r, "gold_rim") + back[1:]
    return revolve(profile)


def struck_coin(face: str = "plain", reeded: bool = False) -> str:
    """A solid disc: a recessed field inside a raised bezel inside a rounded rim.

    The bezel is what a hole does at 13px -- a bright ring round a darker middle -- while at 64px
    the object is a coin rather than a washer, which is the whole reason to try it.

    **⚠ `face="boss"` is kept only as the rejected control.** A domed boss in the middle of the
    field is the obvious way to stop the face reading as a flat sticker, and it renders a SPEAKER
    CONE: a circle, a ring and a dome are the three parts of a loudspeaker and the eye assembles
    them before it gets to "coin". `face="ring"` is what ships -- a shallow groove rather than a
    raised dome, so the relief is a line on the face instead of a second object standing on it.
    """
    field_z, rim_r = 0.100, 0.155
    field = [
        (0.00, field_z + 0.006, "gold_face"),
        (0.30, field_z + 0.004, "gold_face"),
        (0.62, field_z, "gold_face"),
    ]
    if face == "boss":
        field = [
            (0.00, field_z + 0.062, "gold_bezel"),
            (0.16, field_z + 0.056, "gold_bezel"),
            (0.28, field_z + 0.030, "gold_face"),
            (0.34, field_z, "gold_face"),
            (0.50, field_z - 0.004, "gold_face"),
            (0.62, field_z, "gold_face"),
        ]
    elif face == "ring":
        field = [
            (0.00, field_z + 0.010, "gold_face"),
            (0.20, field_z + 0.009, "gold_face"),
            (0.30, field_z - 0.014, "gold_face"),   # the groove, cut into the field
            (0.38, field_z + 0.008, "gold_face"),
            (0.52, field_z + 0.006, "gold_face"),
            (0.62, field_z, "gold_face"),
        ]

    front = field + [
        (0.68, field_z + 0.052, "gold_bezel"),   # up onto the bezel
        (0.79, field_z + 0.058, "gold_bezel"),
        (0.845, field_z + 0.020, "gold_rim"),
    ]
    back = [(r, -z, m) for r, z, m in reversed(front)]
    profile = front + rim_arc(0.845, rim_r, "gold_rim") + back[1:]
    return revolve(profile, reeded=reeded)


def shiny(obj: str, yaw: float, pitch: float) -> Image.Image:
    """One render with the coin's own gloss, and the module put back exactly as it was.

    Set on the module rather than passed, because `render` takes no material parameters -- and
    restored in a `finally`, because a sheet renders eight of these and a leaked constant would
    silently reshade every low-poly prop built in the same session.
    """
    import smooth_render as sr

    keep = (sr.SPEC_STRENGTH, sr.SPEC_POWER)
    sr.SPEC_STRENGTH, sr.SPEC_POWER = SPEC["strength"], SPEC["power"]
    try:
        return render(obj, MTL, yaw_deg=yaw, pitch_deg=pitch, desat=0.0)
    finally:
        sr.SPEC_STRENGTH, sr.SPEC_POWER = keep


# What ships is `plain`. The other three are the rejected controls, kept so the comparison the
# pick was made on can be reproduced rather than taken on trust:
#   holed   a gold ring, and still a ring -- the shape that made the shipped render read as a washer
#   ring    a groove cut in the field, which reads as a target
#   boss    a dome in the field, which reads as a loudspeaker
#   reeded  a milled edge, which at 24 or 40 reeds reads as a bottle cap at every size tried
SHAPES = {
    "plain": lambda: struck_coin("plain"),
    "holed": holed_coin,
    "ring": lambda: struck_coin("ring"),
    "boss": lambda: struck_coin("boss"),
    "reeded": lambda: struck_coin("plain", reeded=True),
}

# Face-on is a flat disc with no thickness at all under an orthographic camera; too much tilt is an
# ellipse, which is how the shipped render came to read as hardware. These are the candidates.
TILTS = [(0, 0), (8, -10), (12, -15), (16, -20)]


def sheet(path: Path) -> None:
    cell = 260
    grid = Image.new("RGB", (cell * len(TILTS), cell * len(SHAPES)), (128, 128, 128))
    for row, (name, build) in enumerate(SHAPES.items()):
        obj = build()
        for col, (yaw, pitch) in enumerate(TILTS):
            im = shiny(obj, yaw, pitch)
            im.thumbnail((cell - 20, cell - 20))
            grid.paste(
                im,
                (col * cell + (cell - im.width) // 2, row * cell + (cell - im.height) // 2),
                im,
            )
    grid.save(path)
    print("%s  rows %s  cols %s" % (path, list(SHAPES), TILTS))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sheet", default="")
    ap.add_argument("--shape", default="struck")
    ap.add_argument("--yaw", type=float, default=0.0)
    ap.add_argument("--pitch", type=float, default=0.0)
    args = ap.parse_args()

    if args.sheet:
        sheet(Path(args.sheet))
        return

    OUT.mkdir(parents=True, exist_ok=True)
    im = shiny(SHAPES[args.shape](), args.yaw, args.pitch)
    dst = OUT / "pickup_coin_lp.png"
    im.save(dst)
    print("%s  %dx%d  %s yaw %g pitch %g" % (dst, im.width, im.height, args.shape, args.yaw, args.pitch))


if __name__ == "__main__":
    main()
