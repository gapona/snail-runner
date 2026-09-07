"""barrier_render.py  The three obstacle classes as one family of road barriers.

  py -3.11 dev-assets/cc0-3d/barrier_render.py --sheet out.png    the comparison sheet
  py -3.11 dev-assets/cc0-3d/barrier_render.py                    write all six renders

WHAT THIS REPLACES, AND WHY

Reported: the things on the road are disliked -- stumps, and textures that hang in the air -- and
what is liked is a flatter barrier. The shipped set was six unrelated objects picked out of a CC0
nature kit and one procedural drawing:

  low        a flat pale slab, a cluster of pebbles, a turf lid
  blocking   a TREE STUMP, and a chunk of green cliff
  overhead   a fallen log floating on two stubs, drawn in `obstacleArt.ts`

They are not a family -- a stump, a boulder and a log share no vocabulary, so nothing about meeting
a new one tells the player what it will do, and they are natural objects standing on a made road.
Both classes that remain are now one made object at two heights:

  low        a low barrier block   solid, flat-topped, hop it
  blocking   a tall barrier panel  solid, full height, go round it

**⚠ THE THIRD CLASS IS GONE AND THIS FILE IS PART OF WHY.** `overhead` had to be drawn ENTIRELY
INSIDE its own collision band, which started 362 units up, so whatever went there floated. It was
built here as a banded boom arm and then as a hazard board hung from a rail -- each an object whose
nature is to be suspended -- and it was reported as a thing hanging in the air both times, as the
fallen log before it had been. Legs were never available: the player passes underneath at every
`offsetX`, so a drawn post is one the snail drives through. See `OBSTACLE_BANDS` in
src/run/constants.ts for the whole argument.

WHY GEOMETRY RATHER THAN A KIT OR A RENDER

Same argument as `coin_render.py`, plus one that is specific to this family.

  THE ASPECT IS THE COLLISION BOX. `ObstacleSprites` stretches whatever texture it is handed onto
  the world box the obstacle actually occupies, so a render whose own aspect differs is DISTORTED
  in game -- and the shipped ones are, badly: `obstacle-low-0` is 4.17:1 against a box of 2.96:1
  (41% too wide) and `obstacle-blocking-0` is 1.95:1 against 1.10:1. A kit model comes at whatever
  proportion the kit made it. Geometry comes at the proportion asked for, and `TARGETS` below is
  that number, computed from `OBSTACLE_BANDS` and `OBSTACLE_HALF_WIDTHS`.
  NO ARTEFACT. `smooth_render`'s alpha is triangle coverage: no plate, no halo, no baked shadow.
  FLAT ON PURPOSE. Yaw 0, so a barrier across the road is seen the way the player meets it --
  face-on -- rather than at the kit renders' three-quarter yaw of 28. That is most of what "flatter"
  means here, and it is also the honest view: the road runs into the screen.
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

# Straight down the road, tipped just enough to see the top of a block. The camera in the game rides
# above the surface looking slightly down, so this is the angle the player actually meets a barrier
# at -- and at yaw 0 a flat panel stays a flat panel.
YAW, PITCH = 0.0, 9.0

# The aspect each class must deliver, from the game's own numbers: a box `OBSTACLE_HALF_WIDTHS`
# mid-range wide (0.17 * 2 * ROAD_WIDTH = 680 units) by its band's height.
#   low       680 / (230 - 0)     blocking  680 / (620 - 0)     overhead  680 / (560 - 362)
# **⚠ `blocking` is 802, not 620, and the number is derived**: a barrier that cannot be jumped has
# to be taller than the highest the mascot ever reaches, or the frame at the apex draws the snail
# clear above the thing that just stopped it. `JUMP_APEX + PLAYER_BODY_H * 1.2` = 430 + 372. See
# `OBSTACLE_BANDS` in src/run/constants.ts, which is where that arithmetic lives.
TARGETS = {"low": 680 / 230, "blocking": 680 / 802}

# How deep a barrier is, as a fraction of its own height. Thin, because these are boards.
DEPTH = {"low": 0.55, "blocking": 0.13}

# **Muted, and ordered by value rather than by hue.** `verify:obstacles` holds the three classes at
# least 12 lightness apart because at 9-27px on a moving road the distance haze and the biome tint
# take the hue away first, and it holds the mascot at twice the family's saturation because the one
# object a player must never search for is the snail. So: pale stone, weathered timber, dark banded
# arm -- brightest to darkest in the order the classes are met.
MTL = """
newmtl low_face
Kd 0.84 0.77 0.63
newmtl low_edge
Kd 0.66 0.58 0.46
newmtl block_face
Kd 0.76 0.76 0.73
newmtl block_edge
Kd 0.52 0.52 0.50
"""


class Mesh:
    """Vertices and faces, with a vertex per face corner.

    **Duplicated rather than shared, and that is the whole reason these read as boards.**
    `smooth_render` accumulates normals per vertex INDEX, so a box built from eight shared corners
    comes back inflated -- every corner normal is the average of three faces and the flat panel it
    is meant to be turns into a pillow. A vertex per corner gives each face its own normal, which
    is flat shading, which is what a painted board looks like.
    """

    def __init__(self) -> None:
        self.verts: list[tuple[float, float, float]] = []
        self.faces: list[tuple[list[int], str]] = []

    def quad(self, a, b, c, d, material: str) -> None:
        base = len(self.verts)
        self.verts += [a, b, c, d]
        self.faces.append(([base, base + 1, base + 2, base + 3], material))

    def obj(self) -> str:
        lines = ["v %.6f %.6f %.6f" % v for v in self.verts]
        current = None
        for tri, material in self.faces:
            if material != current:
                lines.append("usemtl " + material)
                current = material
            lines.append("f " + " ".join(str(i + 1) for i in tri))
        return "\n".join(lines)

    def bounds(self):
        xs = [v[0] for v in self.verts]
        ys = [v[1] for v in self.verts]
        zs = [v[2] for v in self.verts]
        return (min(xs), max(xs)), (min(ys), max(ys)), (min(zs), max(zs))


def slab(mesh: Mesh, x0, x1, y0, y1, z0, z1, face: str, edge: str, chamfer: float = 0.03) -> None:
    """One board: a box whose front face is inset, so the edge is a bevel rather than a corner.

    The bevel is the only curved thing about these objects and it does two jobs: it is where the
    specular sits, which is what stops a flat face reading as a paper cut-out, and it is what makes
    a row of them read as separate boards rather than as one painted band.
    """
    c = chamfer
    zf = z1 - c

    # The four sides, full size, from the back to the shoulder.
    mesh.quad((x0, y0, z0), (x1, y0, z0), (x1, y0, zf), (x0, y0, zf), edge)          # bottom
    mesh.quad((x0, y1, zf), (x1, y1, zf), (x1, y1, z0), (x0, y1, z0), face)          # top
    mesh.quad((x0, y0, z0), (x0, y0, zf), (x0, y1, zf), (x0, y1, z0), edge)          # left
    mesh.quad((x1, y1, z0), (x1, y1, zf), (x1, y0, zf), (x1, y0, z0), edge)          # right

    # The bevel ring, shoulder out to the inset front face.
    mesh.quad((x0, y0, zf), (x1, y0, zf), (x1 - c, y0 + c, z1), (x0 + c, y0 + c, z1), edge)
    mesh.quad((x0 + c, y1 - c, z1), (x1 - c, y1 - c, z1), (x1, y1, zf), (x0, y1, zf), face)
    mesh.quad((x0, y0, zf), (x0 + c, y0 + c, z1), (x0 + c, y1 - c, z1), (x0, y1, zf), edge)
    mesh.quad((x1, y1, zf), (x1 - c, y1 - c, z1), (x1 - c, y0 + c, z1), (x1, y0, zf), edge)

    mesh.quad(
        (x0 + c, y0 + c, z1), (x1 - c, y0 + c, z1), (x1 - c, y1 - c, z1), (x0 + c, y1 - c, z1), face
    )


def low_block(variant: int) -> Mesh:
    """A low barrier block: solid, flat-topped, and the same height every time.

    **The height may not vary and the top edge may not break up.** `drawWall` lays these edge to
    edge with a third of a width of overlap to build the one row a jump is required for, and a wall
    is read from its top edge -- a row of blocks at three heights is a fence with gaps in it, which
    is an invitation to try to get through the row rather than over it. So the variants differ in
    the FACE only: a plain block, a two-course block, a block with a raised cap.
    """
    m = Mesh()
    w, d = 1.0, DEPTH["low"]
    if variant == 0:
        slab(m, -w, w, 0.0, 1.0, -d, d, "low_face", "low_edge")
    elif variant == 1:
        # Two courses, the joint a little off centre so the pair does not read as a mirror.
        slab(m, -w, w, 0.0, 0.44, -d, d, "low_face", "low_edge")
        slab(m, -w, w, 0.47, 1.0, -d * 0.92, d * 0.92, "low_face", "low_edge")
    else:
        # A capping stone: the cap overhangs, which is what a kerb or a parapet actually does and
        # what puts a second lit edge across the top of the silhouette.
        slab(m, -w * 0.93, w * 0.93, 0.0, 0.74, -d * 0.88, d * 0.88, "low_face", "low_edge")
        slab(m, -w, w, 0.74, 1.0, -d, d, "low_face", "low_edge")
    return m


def blocking_panel(variant: int) -> Mesh:
    """A tall barrier panel: an upright board you cannot jump, so it must be gone round.

    Solid rather than a frame with a gap in it. The class means "there is no way through this", and
    a panel you can see daylight through says the opposite at exactly the distance the decision is
    taken at.
    """
    m = Mesh()
    w, d = 1.0, DEPTH["blocking"]
    slab(m, -w, w, 0.0, 1.0, -d, d, "block_face", "block_edge")
    if variant == 0:
        # Boarded: five uprights proud of the panel. Vertical division on a nearly square face is
        # what separates this from `low`, whose whole read is horizontal.
        boards = 5
        for i in range(boards):
            x0 = -w + 2 * w * i / boards + 0.03
            x1 = -w + 2 * w * (i + 1) / boards - 0.03
            slab(m, x0, x1, 0.03, 0.97, -d * 1.6, d * 1.6, "block_face", "block_edge", chamfer=0.02)
    else:
        # A frame instead: two uprights, a head rail and a brace across the middle. Same object,
        # different face, and the two never repeat side by side in a row.
        #
        # **⚠ The brace is not decoration.** Without it the framed variant is a rectangle inside a
        # rectangle, which is a DOORWAY -- and this is the class that means there is no way through.
        # A barred opening says the opposite of the mechanic at exactly the distance the player
        # decides at.
        for x0, x1 in ((-w, -w * 0.72), (w * 0.72, w)):
            slab(m, x0, x1, 0.0, 1.0, -d * 1.5, d * 1.5, "block_edge", "block_edge", chamfer=0.02)
        slab(m, -w, w, 0.78, 0.94, -d * 1.5, d * 1.5, "block_edge", "block_edge", chamfer=0.02)
        slab(m, -w, w, 0.36, 0.52, -d * 1.5, d * 1.5, "block_edge", "block_edge", chamfer=0.02)
        slab(m, -w * 0.22, w * 0.22, 0.0, 0.78, -d * 1.4, d * 1.4, "block_edge", "block_edge", chamfer=0.02)
    return m


SHAPES = {
    "obs_low_0": (lambda: low_block(0), "low"),
    "obs_low_1": (lambda: low_block(1), "low"),
    "obs_low_2": (lambda: low_block(2), "low"),
    "obs_block_0": (lambda: blocking_panel(0), "blocking"),
    "obs_block_1": (lambda: blocking_panel(1), "blocking"),
}


def fitted(build, kind: str) -> Image.Image:
    """One render, with the geometry's height solved so the PROJECTED box hits the target aspect.

    At yaw 0 the width is untouched and the height projects to `h*cos(p) + d*sin(p)` -- the top face
    is visible, and it counts. Solving rather than eyeballing is the point: the texture is stretched
    onto the collision box, so an aspect that is nearly right is an object that is visibly squashed.
    """
    mesh = build()
    (x0, x1), (y0, y1), (z0, z1) = mesh.bounds()
    p = math.radians(PITCH)
    width, depth = x1 - x0, z1 - z0
    # width / (height * cos p + depth * sin p) = target
    height = (width / TARGETS[kind] - depth * math.sin(p)) / math.cos(p)
    scale = height / (y1 - y0)

    stretched = Mesh()
    stretched.verts = [(v[0], v[1] * scale, v[2]) for v in mesh.verts]
    stretched.faces = mesh.faces

    return render(stretched.obj(), MTL, yaw_deg=YAW, pitch_deg=PITCH, desat=0.0)


def sheet(path: Path) -> None:
    cell = 300
    grid = Image.new("RGB", (cell * len(SHAPES), cell), (128, 128, 128))
    for i, (slot, (build, kind)) in enumerate(SHAPES.items()):
        im = fitted(build, kind)
        im.thumbnail((cell - 16, cell - 16))
        grid.paste(im, (i * cell + (cell - im.width) // 2, cell - im.height - 8), im)
        print("  %-13s %dx%d  aspect %.2f  target %.2f" % (slot, im.width, im.height, im.width / im.height, TARGETS[kind]))
    grid.save(path)
    print(path)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sheet", default="")
    args = ap.parse_args()

    if args.sheet:
        sheet(Path(args.sheet))
        return

    OUT.mkdir(parents=True, exist_ok=True)
    for slot, (build, kind) in SHAPES.items():
        im = fitted(build, kind)
        dst = OUT / f"{slot}_bar.png"
        im.save(dst)
        print("%s  %dx%d  aspect %.2f (target %.2f)" % (dst.name, im.width, im.height, im.width / im.height, TARGETS[kind]))


if __name__ == "__main__":
    main()
