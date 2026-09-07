"""medkit_render.py  The heal pickup, as geometry, through this game's own renderer.

  py -3.11 dev-assets/cc0-3d/medkit_render.py                  write the render
  py -3.11 dev-assets/cc0-3d/medkit_render.py --sheet out.png  the shape/yaw comparison sheet

WHY GEOMETRY

Same three reasons `coin_render.py` gives, and the first one with more force. A medkit's defining
feature is **a cross struck onto a box**, and CLAUDE.md's "this checkpoint draws objects, not
symbols" is the record of what a diffusion model does with a subject like that: three rounds of a
boost arrow came back pointing left, pointing down, and as a phone with a face on it. A cross is a
symbol before it is an object, so it is built here rather than asked for.

It also buys what the coin's own docstring lists: no plate, no halo and no baked cast shadow, since
`smooth_render`'s alpha is triangle coverage; and the family's own light, ambient and value scale,
so this cannot drift into a second art language.

WHY IT IS NOT RED, AND WHAT IT IS INSTEAD

The obvious medkit is a white box with a **warm red** cross, and that colour is the one thing this
game reserves: `THREAT_COLOR` means *something has landed on you*, and `scripts/threat_guard.py`
rotates any reserved pixel out at build time. `build-sprites.py` already records what that does to
a subject whose identity is its colour -- "a rotated strawberry comes back brown, which is not a
strawberry".

The reservation has three escapes and this object takes the **lightness** one: a deep oxblood at
OKLab `L` under 0.43 against the threat's 0.648 is cleared whatever its hue. That is the escape the
HUD's own hearts take as well.

**⚠ Which part is dark was decided by measuring, and the first answer was wrong.** The body was the
oxblood and the cross near-white, on the argument that a dark object separates from this game's pale
flagstone road by value. It does -- and it came back at **lightness 58 with 81% of it reading as
ink** against a pickup family at 75-142 and a median of 31%: not a reward, a hole with a cross on
it, which is the same failure the critters' first palette produced. Inverted, the case is cream and
the *cross* carries the reserved-hue escape, which is also the object as everyone knows it: 130
lightness and 23% ink, inside the family it has to belong to.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))

from smooth_render import render  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent.parent
OUT = ROOT / "dev-assets" / "lowpoly"

# **The body is aimed under `L = 0.428`, where the reservation's lightness escape begins.**
# `smooth_render` shades as `Kd * (AMBIENT + (1 - AMBIENT) * lambert) * VALUE_SCALE + spec`, so a
# lit face comes back about 6% over `Kd` and the specular blob higher still. The aim is therefore
# below the line rather than on it, and `build-sprites.py` prints how many pixels the guard still
# had to move.
#
# **⚠ The case's `Kd` is over 1, and that is the renderer rather than a mistake.** The light comes
# from above and behind (`LIGHT` in `smooth_render`), so the front face -- the one the cross is on --
# gets `n . L` of 0.55, i.e. 70% of full diffuse. A cream case at `Kd` 0.92 therefore delivers a mid
# GREY front, and the read of this object is a *white* case with a red cross. These values are what
# make the delivered front white after that shading; they clip rather than overflowing.
MTL = """
newmtl kit_body
Kd 1.24 1.19 1.12
newmtl kit_lid
Kd 0.60 0.125 0.190
newmtl kit_edge
Kd 1.00 0.94 0.86
newmtl kit_cross
Kd 0.46 0.095 0.145
newmtl kit_grip
Kd 0.52 0.110 0.165
"""

# Proportions, in the coin's own units. **Solved for a SQUARE delivered sprite, not for a real
# medkit.** `PickupSprites` draws every pickup into a square world box, so a 1.3:1 render -- which
# is what a real case looks like -- would be stretched by a third in game, the same distortion
# `barrier_render.py` exists to have fixed. Yaw and pitch fold the depth into both axes, so the box
# is authored slightly taller than wide and comes out square.
W, H, D = 0.72, 0.74, 0.40
YAW, PITCH = 20.0, 11.0

# The cross: its span and bar thickness as fractions of the width, and how far it stands proud.
CROSS_SPAN, CROSS_BAR, CROSS_LIFT = 0.62, 0.22, 0.030

# The lid's share of the height, and the chamfer that catches the light on every front edge.
LID = 0.30
CHAMFER = 0.045

FACES = ("front", "back", "left", "right", "top", "bottom")


def box(cx, cy, cz, w, h, d, material, faces=FACES):
    """One box as OBJ text, **with a vertex per face corner rather than eight shared ones.**

    `smooth_render` accumulates normals per vertex *index*, so a box built from eight corners comes
    back inflated: every corner normal is the average of three faces and the object turns into a
    pillow. `barrier_render.py` records the same finding -- this is that trick applied again.

    `faces` names which of the six to emit, so a bar laid on the front does not bury quads inside
    the case behind it.
    """
    hx, hy, hz = w / 2, h / 2, d / 2
    quads = {
        "front": [(-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz)],
        "back": [(hx, -hy, -hz), (-hx, -hy, -hz), (-hx, hy, -hz), (hx, hy, -hz)],
        "left": [(-hx, -hy, -hz), (-hx, -hy, hz), (-hx, hy, hz), (-hx, hy, -hz)],
        "right": [(hx, -hy, hz), (hx, -hy, -hz), (hx, hy, -hz), (hx, hy, hz)],
        "top": [(-hx, hy, hz), (hx, hy, hz), (hx, hy, -hz), (-hx, hy, -hz)],
        "bottom": [(-hx, -hy, -hz), (hx, -hy, -hz), (hx, -hy, hz), (-hx, -hy, hz)],
    }
    verts, out = [], ["usemtl " + material]

    for name in faces:
        for x, y, z in quads[name]:
            verts.append("v %.6f %.6f %.6f" % (cx + x, cy + y, cz + z))
    for i in range(len(verts) // 4):
        a = i * 4
        out.append("f %d %d %d %d" % (a + 1, a + 2, a + 3, a + 4))

    return verts, out


def renumber(lines, base):
    """Re-points one box's faces onto a running vertex count."""
    fixed = []
    for line in lines:
        if line.startswith("f "):
            fixed.append("f " + " ".join(str(int(n) + base) for n in line[2:].split()))
        else:
            fixed.append(line)
    return fixed


def medkit(cross=True, grip=True):
    """A chamfered case with a lid seam, a cross on the front and a grip on top.

    **The chamfer is the one curved thing on the object and it is what stops the box reading as a
    card.** `coin_render.py` makes the same argument for its rim arc: on a form this simple the
    specular has to have somewhere to sit, and a hard corner gives it nowhere.

    **The lid seam is the only reason this is a *case* rather than a block.** The light comes from
    above in this renderer, so a lid painted one step lighter than the body reads as a separate part
    at every size -- as a change of value rather than as a line, which is what survives to 13px.
    """
    verts, faces = [], []

    def add(chunk):
        v, f = chunk
        faces.extend(renumber(f, len(verts)))
        verts.extend(v)

    body_h = H * (1 - LID)
    lid_h = H * LID

    add(box(0, -H / 2 + body_h / 2, 0, W, body_h, D, "kit_body", ("front", "left", "right", "bottom", "back")))
    add(box(0, H / 2 - lid_h / 2, 0, W, lid_h, D, "kit_lid", ("front", "left", "right", "top", "back")))
    add(box(0, 0, D / 2 + CHAMFER / 2, W - CHAMFER * 2, H - CHAMFER * 2, CHAMFER, "kit_edge",
            ("front", "top", "bottom", "left", "right")))

    if cross:
        z = D / 2 + CHAMFER + CROSS_LIFT / 2
        span, bar = W * CROSS_SPAN, W * CROSS_BAR

        add(box(0, 0, z, span, bar, CROSS_LIFT, "kit_cross"))
        add(box(0, 0, z, bar, span, CROSS_LIFT, "kit_cross"))

    if grip:
        add(box(0, H / 2 + 0.035, 0, W * 0.34, 0.07, D * 0.42, "kit_grip"))

    return "\n".join(verts + faces)


SHAPES = {
    "kit": lambda: medkit(),
    # Kept as controls, the way `coin_render.py` keeps its rejected faces: a case with no cross is
    # a toolbox, and one with no grip is a block.
    "plain": lambda: medkit(cross=False),
    "nogrip": lambda: medkit(grip=False),
}


def sheet(path):
    """Every shape at three yaws, on magenta, for picking by eye rather than by aspect alone."""
    cells = []
    for name, build in SHAPES.items():
        for yaw in (0.0, YAW, 34.0):
            cells.append(("%s@%g" % (name, yaw), render(build(), MTL, yaw_deg=yaw, pitch_deg=PITCH, desat=0.0)))

    cell = 320
    grid = Image.new("RGBA", (cell * 3, cell * len(SHAPES)), (255, 0, 255, 255))
    for i, (name, im) in enumerate(cells):
        im = im.copy()
        im.thumbnail((cell - 16, cell - 16))
        grid.paste(im, ((i % 3) * cell + (cell - im.width) // 2, (i // 3) * cell + (cell - im.height) // 2), im)
        print("  %-12s %dx%d aspect %.3f" % (name, im.width, im.height, im.width / im.height))
    grid.save(path)
    print(path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sheet", default="")
    ap.add_argument("--shape", default="kit")
    ap.add_argument("--yaw", type=float, default=YAW)
    ap.add_argument("--pitch", type=float, default=PITCH)
    args = ap.parse_args()

    if args.sheet:
        sheet(Path(args.sheet))
        return

    OUT.mkdir(parents=True, exist_ok=True)
    im = render(SHAPES[args.shape](), MTL, yaw_deg=args.yaw, pitch_deg=args.pitch, desat=0.0)
    dst = OUT / "pickup_heal_lp.png"
    im.save(dst)
    print("%s  %dx%d  aspect %.3f  yaw %g pitch %g" % (dst.name, im.width, im.height, im.width / im.height,
                                                       args.yaw, args.pitch))


if __name__ == "__main__":
    main()
