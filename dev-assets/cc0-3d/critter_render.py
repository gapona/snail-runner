"""critter_render.py  The beetle and the bee, built as geometry and rendered like the rest.

  py -3.11 dev-assets/cc0-3d/critter_render.py --sheet out.png    the comparison sheet
  py -3.11 dev-assets/cc0-3d/critter_render.py                    write all four renders

WHY GEOMETRY RATHER THAN A BOUGHT MODEL

Asked directly: could the bugs be kit models adapted the way the other 3D was, rather than drawn?
The route is real and this project has measured it — see CLAUDE.md, "On buying roadside props
instead of generating them": a CC0 model rendered through OUR renderer arrives in this game's
language, and what makes it belong is tone (lightness, saturation, ink share) rather than line
style. Two of the local kits were checked first; neither has an insect.

**But for these two the same finding that rebuilt the barriers applies, and it is decisive:**

  THE ASPECT IS THE COLLISION BOX. `CritterSprites` stretches whatever texture it is handed onto
  the world box the critter occupies, so a render at another proportion is DISTORTED in game --
  which is exactly how the kit-sourced obstacles shipped (`obstacle-low-0` at 4.17:1 against a box
  of 2.96:1, 41% too wide) and why `barrier_render.py` exists. A kit model comes at whatever
  proportion the kit made it. Geometry comes at the proportion asked for.

And these two boxes are unusual, because neither was chosen for how an insect looks:

  beetle   1601 x 343 = 4.67:1   width solved from `CRITTER_ROAD_SHARE`, height from the jump
  bee       726 x 310 = 2.34:1   width from `BEE_ROAD_SHARE`, height from the daylight underneath

A real beetle head-on is about 2:1. Nothing bought is 4.67:1, and stretching one to fit is the
distortion above. Built rather than bought, the legs simply sprawl until the silhouette IS that
wide -- which is also what the drawn version does, and what a big beetle actually does.

WHAT IS TAKEN FROM THE OTHER RENDERS AND WHAT IS NOT

  SAME  `smooth_render.render` -- the Blinn-Phong pass that produced the fruit, the coin and the
        barriers, with its own light direction, ambient and value scale. Nothing here touches those:
        they are the three that decide whether an object belongs to this frame.
  SAME  alpha is triangle coverage, so there is no plate, no halo and no baked cast shadow -- the
        artefact `strip_plate` exists to chase never arises.
  NEW   **the pitch is derived from the game's own camera rather than picked.** `barrier_render`
        uses 9 degrees for a barrier; a critter is met at whatever angle the camera actually sees it
        at, which is `atan((CAMERA_HEIGHT - centre) / PLAYER_Z)` -- 26.7 for a beetle on the road and
        14.1 for a bee flying 431 units above it. Two different objects, two honest angles.
  NEW   **round bodies share their vertices; flat parts duplicate them.** `smooth_render` accumulates
        normals per vertex INDEX, which `barrier_render` documents as the thing that inflates a box
        into a pillow -- and that inflation is exactly what a shell wants. The same mechanism, used
        the other way round.
"""
from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))

from glb_obj import load as load_glb  # noqa: E402
from smooth_render import render  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent.parent
OUT = ROOT / "dev-assets" / "lowpoly"

# The game's own numbers. Kept here rather than imported because this script must run without the
# TypeScript loader; `verify:critters` asserts the shipped canvas aspect against the live constants,
# so a drift shows up there rather than being silently rendered.
#   beetle  CRITTER_ROAD_SHARE 0.6 -> 1601 wide, JUMP_APEX * (1 - 0.45^2) -> 343 tall
#   bee     BEE_ROAD_SHARE 0.35   ->  726 wide, PLAYER_BODY_H            -> 310 tall
WORLD_WIDTH = {"beetle": 1601.0, "ladybird": 686.0, "spider": 915.0, "frog": 799.0, "bee": 707.0, "wasp": 536.0}

TARGETS = {
    "beetle": 1601.0 / 343.0,  # solved from the road and the jump; no model has this proportion
    "ladybird": 2.64,          # every other kind takes its MODEL's aspect and the game picks the height
    "spider": 3.05,
    "frog": 2.33,
    "bee": 2.28,
    "wasp": 0.96,
}

# Straight down the road (yaw 0, as the barriers are: the player meets a critter head-on and it is
# running at them), tipped by the angle it is READ at rather than the angle it is hit at.
#
# **⚠ Those are very different numbers and the first pass used the wrong one.** The camera sees a
# beetle at `atan((CAMERA_HEIGHT - centre) / distance)`, which is 26.7 degrees at the moment of
# contact — and at that pitch the creature's own DEPTH dominates its projected height: a beetle 2.6
# deep contributes more screen height than its 1.0 of actual height does, so a 4.67:1 box is simply
# not a shape it can project into. Solved for, it would have to be 0.2 deep against 4.6 wide, which
# is a blade rather than an animal.
#
# A sprite has one pitch and the one that matters is where the DECISION is taken — twenty to forty
# segments out, not at the snail's own row. There it is 6 to 12 degrees for a beetle and 2 to 6 for a
# bee, which is also why `barrier_render` settled on 9 for a barrier read at the same distances.
YAW = 0.0
PITCH = {"beetle": 9.0, "ladybird": 9.0, "spider": 9.0, "frog": 9.0, "bee": 4.0, "wasp": 4.0}

# **The palettes are the ones `artPalette.ts` already states, and the reasons are there.** The beetle
# is the darkest thing on the road and deliberately low-chroma, because colour in this game means
# "come and get it"; the bee is the one hazard allowed to be loud, because it cannot be read from its
# position and its whole warning is its surface.
#
# Kd sits well above the shipped hex, and the first pass proved why it has to. At the palette's own
# values the beetle rendered at **lightness 46 with 95% of it below the ink threshold** -- against a
# barrier family at 34-43% ink -- which is not a dark object, it is a silhouette, and a silhouette on
# pale flagstone is the "reads as a hole in the road" failure `RAMP_HEIGHT`'s own notes record. The
# lit half of a rendered form carries a shadow side for free, so the material has to start where the
# drawing's *highlight* is rather than where its body colour is. `node scripts/measure-art.mjs` is
# what says whether it landed; the numbers to match are in `artPalette.ts`.
#
# **⚠ And the beetle is BRONZE rather than violet because the contact sheet showed it and the spider
# had become the same animal.** Both were sprawled arthropods in the same violet-grey, and at the
# 88-154px they are met at that is one silhouette in two sizes. The suite could not see it: its
# silhouette check reads the fallback DRAWING, not the shipped renders. Hue is what separates two
# things the outline cannot.
#
# **⚠ The spider hit the identical wall a round later, which is what makes it a rule rather than an
# anecdote.** Its model's body is dark and covers most of the silhouette, so the first remap landed
# at **lightness 44 with 94% ink** — the beetle's failure exactly, from a downloaded mesh instead of
# a built one. A model's own darkness is not this game's darkness either.
MTL = """
newmtl chitin_top
Kd 0.62 0.53 0.30
newmtl chitin
Kd 0.42 0.35 0.19
newmtl chitin_dark
Kd 0.24 0.20 0.11
newmtl leg
Kd 0.34 0.29 0.16
newmtl eye
Kd 0.87 0.90 0.92
newmtl bee_band
Kd 0.95 0.69 0.17
newmtl bee_dark
Kd 0.16 0.13 0.10
newmtl wing
Kd 0.84 0.89 0.94
newmtl lady_shell
Kd 0.42 0.62 0.57
newmtl lady_dark
Kd 0.13 0.18 0.17
newmtl spider_body
Kd 0.42 0.36 0.46
newmtl spider_mark
Kd 0.70 0.64 0.74
newmtl frog_green
Kd 0.44 0.53 0.33
newmtl frog_belly
Kd 0.67 0.73 0.54
newmtl frog_dark
Kd 0.15 0.18 0.12
newmtl wasp_band
Kd 0.94 0.82 0.25
newmtl wasp_dark
Kd 0.14 0.12 0.10
"""


class Mesh:
    """Vertices and faces, with a choice about whether a corner is shared.

    **The choice is the whole difference between a board and a body.** `smooth_render` accumulates
    normals per vertex INDEX: duplicate a corner per face and each face gets its own normal, which is
    flat shading and what `barrier_render` needs for a painted panel; share it and the normals
    average into a smooth one, which is what a carapace needs. Both are wanted here, on the same
    object -- a beetle's shell is round and its leg segments are not.
    """

    def __init__(self) -> None:
        self.verts: list[tuple[float, float, float]] = []
        self.faces: list[tuple[list[int], str]] = []
        self._shared: dict[tuple[int, int, int], int] = {}

    def _flat(self, points) -> list[int]:
        base = len(self.verts)
        self.verts += list(points)
        return list(range(base, base + len(points)))

    def _smooth(self, points) -> list[int]:
        out = []
        for p in points:
            # Rounded so two faces meeting at a corner agree it is one corner. 1e-4 of a unit is far
            # below anything built here and far above float noise.
            key = (round(p[0] * 1e4), round(p[1] * 1e4), round(p[2] * 1e4))
            if key not in self._shared:
                self._shared[key] = len(self.verts)
                self.verts.append(p)
            out.append(self._shared[key])
        return out

    def face(self, points, material: str, smooth: bool = False) -> None:
        idx = self._smooth(points) if smooth else self._flat(points)
        self.faces.append((idx, material))

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


def ellipsoid(mesh, centre, radii, material, rings=10, segments=16, band=None, y_cut=None):
    """A smooth-shaded ellipsoid, optionally banded along its long axis.

    `band` is `(material, [(from, to), ...])` in fractions of the Z extent — which is what makes a
    bee striped without a texture: the stripes are geometry's own faces, so they survive every
    downscale exactly as the silhouette does.

    `y_cut` drops everything below a height, which is how a wing becomes a flat blade rather than a
    lens: a wing seen from above is a shape, and its underside is never visible.
    """
    cx, cy, cz = centre
    rx, ry, rz = radii

    def point(i, j):
        theta = math.pi * i / rings
        phi = 2.0 * math.pi * j / segments
        return (
            cx + rx * math.sin(theta) * math.cos(phi),
            cy + ry * math.cos(theta),
            cz + rz * math.sin(theta) * math.sin(phi),
        )

    for i in range(rings):
        for j in range(segments):
            quad = [point(i, j), point(i + 1, j), point(i + 1, j + 1), point(i, j + 1)]
            if y_cut is not None and all(p[1] < y_cut for p in quad):
                continue
            kind = material
            if band is not None:
                band_material, spans = band
                t = (sum(p[2] for p in quad) / 4.0 - (cz - rz)) / (2.0 * rz)
                if any(lo <= t <= hi for lo, hi in spans):
                    kind = band_material
            mesh.face(quad, kind, smooth=True)


def limb(mesh, a, b, r0, r1, material, sides=5):
    """A tapered prism between two points — a leg, an antenna, a sting.

    Flat-shaded on purpose: a leg is a chitin tube with facets, and the facets are what make six of
    them read as six rather than as a smudge at the size these are drawn.
    """
    ax, ay, az = a
    bx, by, bz = b
    axis = (bx - ax, by - ay, bz - az)
    length = math.sqrt(sum(c * c for c in axis)) or 1e-6
    n = tuple(c / length for c in axis)
    # Any vector not parallel to the axis, made perpendicular.
    seed = (0.0, 0.0, 1.0) if abs(n[1]) > 0.9 else (0.0, 1.0, 0.0)
    u = (
        seed[1] * n[2] - seed[2] * n[1],
        seed[2] * n[0] - seed[0] * n[2],
        seed[0] * n[1] - seed[1] * n[0],
    )
    ul = math.sqrt(sum(c * c for c in u)) or 1e-6
    u = tuple(c / ul for c in u)
    w = (n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0])

    def ring(centre, radius, k):
        angle = 2.0 * math.pi * k / sides
        return tuple(
            centre[i] + radius * (math.cos(angle) * u[i] + math.sin(angle) * w[i]) for i in range(3)
        )

    for k in range(sides):
        mesh.face(
            [ring(a, r0, k), ring(b, r1, k), ring(b, r1, k + 1), ring(a, r0, k + 1)],
            material,
        )


# Where each of the six feet sits, per pose, in the beetle's own units. The alternating tripod: on
# pose 0 the left front and rear swing with the right middle, then the mirror — the same gait the
# drawn version has, and the reason two frames is the whole cycle.
BEETLE_LEGS = [
    {"hip": (0.78, 0.34, 0.62), "out": (2.34, 0.03, 1.05), "in": (1.74, 0.03, 0.76)},
    {"hip": (0.86, 0.32, 0.02), "out": (2.40, 0.03, 0.12), "in": (1.80, 0.03, -0.02)},
    {"hip": (0.78, 0.30, -0.66), "out": (2.28, 0.03, -1.08), "in": (1.72, 0.03, -0.76)},
]


def beetle(pose: int) -> Mesh:
    """A broad low beetle, seen head-on, legs sprawled until the silhouette is 4.67:1.

    **⚠ THE FIRST VERSION READ AS A FLYING SAUCER, and the contact sheet is the only thing that said
    so.** Every number was green — aspect exact, tone in the family, both poses differing, nothing
    off-canvas — and what it drew was a smooth purple dome with a mast sticking straight up out of
    the middle and stubs at the sides. Sixth time this project has recorded a numeric gate passing
    something that is not a picture of the thing.

    The three faults, and each is the opposite of what the models that DO read (`Spider`, `Frog`) do:

      A MAST.       The antennae ran up and back, so at a 9-degree pitch they projected as a vertical
                    spike out of the dome's centre — the single strongest "saucer" cue there is.
                    **⚠ Sweeping them FORWARD did not fix it**: a tipped camera turns reach along Z
                    into reach up the screen too, so a long antenna is a spike whichever way it
                    points. What removes it is reaching SIDEWAYS — 0.98 across against 0.22 forward,
                    where the projection can only make it wider.
      NO HEAD.      The head sat behind the shell's own silhouette and vanished. It is in front of it
                    now, wider than it is deep, with the eyes on its front face.
      ONE DOME.     A single smooth ellipsoid is a saucer. A beetle is TWO wing cases with a seam,
                    and the seam has to be a real gap rather than a painted line: the shell is two
                    half-domes with daylight between them.
    """
    mesh = Mesh()

    for index, leg in enumerate(BEETLE_LEGS):
        left_swings = (index == 1) == (pose == 1)
        for side, swings in ((-1.0, left_swings), (1.0, not left_swings)):
            hip = (side * leg["hip"][0], leg["hip"][1], leg["hip"][2])
            foot_src = leg["out"] if swings else leg["in"]
            foot = (side * foot_src[0], foot_src[1], foot_src[2])
            knee = (
                (hip[0] + foot[0]) * 0.5 * 1.18,
                max(hip[1], foot[1]) * 0.95 + 0.16,
                (hip[2] + foot[2]) * 0.5,
            )
            # Thinner and more jointed than the first pass: the spider model reads because its legs
            # are visibly limbs, and the beetle's were tapered stubs.
            limb(mesh, hip, knee, 0.075, 0.055, "leg")
            limb(mesh, knee, foot, 0.055, 0.032, "leg")

    # **Two wing cases with a real gap, not one dome.** The gap is what says beetle; a painted seam
    # on a single ellipsoid is a line on a saucer.
    for side in (-1.0, 1.0):
        ellipsoid(mesh, (side * 0.50, 0.28, -0.05), (0.50, 0.46, 1.10), "chitin", rings=10, segments=16)
        ellipsoid(mesh, (side * 0.50, 0.32, -0.12), (0.40, 0.40, 0.92), "chitin_top", rings=8, segments=14, y_cut=0.36)
    # The thorax, a smaller plate ahead of the cases, which is what gives the silhouette a waist.
    ellipsoid(mesh, (0.0, 0.26, 0.92), (0.62, 0.34, 0.34), "chitin", rings=8, segments=14)

    # The head, IN FRONT of the shell rather than behind it, with the eyes on its own front face.
    ellipsoid(mesh, (0.0, 0.22, 1.42), (0.44, 0.28, 0.30), "chitin_dark", rings=8, segments=14)
    for side in (-1.0, 1.0):
        ellipsoid(mesh, (side * 0.22, 0.28, 1.62), (0.12, 0.12, 0.10), "eye", rings=6, segments=10)
        # Antennae FORWARD and low. Up and back was the mast.
        limb(mesh, (side * 0.16, 0.20, 1.58), (side * 0.98, 0.17, 1.80), 0.045, 0.032, "chitin_dark")

    return mesh


# ------------------------------------------------------------------------------------------------
# The downloaded CC0 models, adapted rather than used as-is
# ------------------------------------------------------------------------------------------------

# Six legs for the ladybird, in ITS OWN units — the model is about 3.4 wide and its shell bottoms out
# at y -0.54, so the feet go just under that and the hips sit inside the shell's shadow. Same shape
# as `BEETLE_LEGS`: an alternating tripod, swinging foot out and planted foot tucked in.
LADYBIRD_LEGS = [
    {"hip": (0.55, -0.22, 1.15), "knee": (1.05, -0.44, 1.34), "out": (1.44, -0.62, 1.58), "in": (1.06, -0.62, 1.22)},
    {"hip": (0.62, -0.24, 0.05), "knee": (1.14, -0.46, 0.12), "out": (1.54, -0.62, 0.22), "in": (1.14, -0.62, -0.04)},
    {"hip": (0.55, -0.24, -1.10), "knee": (1.03, -0.46, -1.30), "out": (1.42, -0.62, -1.56), "in": (1.04, -0.62, -1.20)},
]

POLY = Path(__file__).resolve().parent / "poly"

# **⚠ Every model's own materials are remapped, and for the ladybird that is not a preference.**
# Its shell arrives at `Kd 1.00 0.04 0.02` — measured against this game's own rule, **6 degrees from
# `THREAT_COLOR` at full chroma**, i.e. squarely inside the band reserved for "something has landed
# on you". A red hazard would spend the one signal the game keeps for damage. The spider's accent and
# the frog's are red too. So the remap is what makes these models usable at all, not a restyle.
#
# **⚠ And a model arrives facing wherever it was modelled — only five of six happened to face
# front.** The wasp is built in profile with its head along +X, so at yaw 0 it flies ACROSS the road,
# which is the one thing a critter never does. Every entry therefore carries its own yaw, found by
# rendering the four cardinals and looking at them: 270 is the wasp head-on, 90 is its tail.
#
# What each model contributes is its SHAPE and its material SPLIT; the colours are this game's.
MODELS = {
    "bee": (POLY / "bee_42djT5zJnx.glb", 0.0, {
        "Armabee_Main": "bee_dark", "Armabee_Secondary": "bee_band",
        "Eye_White": "eye", "Eye_Black": "chitin_dark", "Wing": "wing", "Wings": "wing",
    }, None),
    # **⚠ Its own legs are cut off and replaced, which is the one piece of surgery in this file.**
    # The model draws them as thin closed WIRE LOOPS — fine from the angle it was made for, and from
    # head-on they read as six squiggles hanging under the shell, which is what a player reported.
    # They are one material (`black.001`, 260 faces, the only geometry below the body), so they can
    # be dropped exactly rather than guessed at by height, and six ordinary limbs put in their place
    # with the same helper the beetle uses. Everything else about the model is untouched.
    "ladybird": (POLY / "beetle_3tCnJC9UYA.glb", 0.0, {
        "red": "lady_shell", "black": "lady_dark", "black.001": "lady_dark",
    }, {"cut": ("black", -0.10), "legs": LADYBIRD_LEGS, "material": "lady_dark", "radius": 0.055}),
    "spider": (POLY / "spider_yRYJiAJyiM.glb", 0.0, {
        "Material": "spider_body", "Material.001": "spider_mark",
    }, None),
    "frog": (POLY / "frog_9Z2V8fpazF.glb", 0.0, {
        "Green": "frog_green", "Yellow": "frog_belly", "Red": "frog_dark", "Black": "frog_dark",
    }, None),
    "wasp": (POLY / "wasp_3aQgc75sUR.glb", 270.0, {
        "Black": "wasp_dark", "Orange": "wasp_band", "Yellow": "wasp_band", "LightBlue": "wing",
    }, None),
}


def from_model(kind: str, pose: int) -> Mesh:
    """One downloaded model, in this game's palette, posed for its second frame.

    **The pose is applied to the geometry rather than to a second model.** A download is a static
    mesh and two downloads would be two different animals; moving what already exists is the same
    trick the drawn version uses and costs nothing.

    Flyers sweep their **wings only** — and ⚠ the first version rotated everything above a hinge
    height, which took part of the thorax with it and made the two poses measure 77 and 104
    lightness: a 27-point swing between consecutive frames, which is a flicker rather than a wingbeat.
    The models name their own materials, so the wing vertices are knowable exactly.

    A ground model has no separable legs, so it **rolls** instead — four degrees about its own base.
    That is honest about what a static mesh can do: it reads as a body shifting its weight, where a
    faked gait would need the legs the model does not label.
    """
    path, _, remap, surgery = MODELS[kind]
    _, _, info = load_glb(path)
    mesh = Mesh()
    mesh.verts = list(info["verts_xyz"])
    # **⚠ The loops are not a material and not the lowest geometry — both guesses were wrong.**
    # `black.001` turned out to be the HEAD (dropping it removed the face and left the loops), and a
    # plain height cut takes the shell's underside first. What isolates them is a cut *within* one
    # material: colour-banding `black` by face height showed the loops light up alone below -0.10,
    # while the shell's spots sit above 0. So the rule is a material and a plane together.
    cut_material, cut_below = (surgery or {}).get("cut", (None, 0.0))
    faces = []
    for tri, name in info["faces_named"]:
        if name == cut_material and sum(mesh.verts[i][1] for i in tri) / 3.0 < cut_below:
            continue
        faces.append((list(tri), remap.get(name, "chitin")))

    if surgery and surgery.get("legs"):
        # Built into the same mesh so they scale, pose and render with the body rather than beside it.
        radius = surgery["radius"]
        for index, leg in enumerate(surgery["legs"]):
            left_swings = (index == 1) == (pose == 1)
            for side, swings in ((-1.0, left_swings), (1.0, not left_swings)):
                hip = (side * leg["hip"][0], leg["hip"][1], leg["hip"][2])
                foot_src = leg["out"] if swings else leg["in"]
                foot = (side * foot_src[0], foot_src[1], foot_src[2])
                # **⚠ A computed mid-point knee drew scaffolding.** Placing it at the average height
                # of hip and foot makes the limb a horizontal arm with a right angle in it — landing
                # gear, not a leg. An insect's leg leaves the body already heading DOWN and out, so
                # the knee is authored below the hip rather than beside it.
                knee = (side * leg["knee"][0], leg["knee"][1], leg["knee"][2])
                before = len(mesh.faces)
                limb(mesh, hip, knee, radius, radius * 0.72, surgery["material"])
                limb(mesh, knee, foot, radius * 0.72, radius * 0.42, surgery["material"])
                faces.extend(mesh.faces[before:])
        mesh.faces = []

    if pose == 1 and not (surgery and surgery.get("legs")):
        wing_verts = {i for tri, material in faces if material == "wing" for i in tri}

        if wing_verts:
            ys = [mesh.verts[i][1] for i in wing_verts]
            xs = [abs(mesh.verts[i][0]) for i in wing_verts]
            hinge_y, inboard = min(ys), min(xs)
            drop = math.radians(-30.0)
            mesh.verts = [
                v
                if i not in wing_verts
                else (
                    v[0],
                    hinge_y + (v[1] - hinge_y) * math.cos(drop) - (abs(v[0]) - inboard) * math.sin(drop),
                    v[2],
                )
                for i, v in enumerate(mesh.verts)
            ]
        else:
            base = min(v[1] for v in mesh.verts)
            roll = math.radians(4.0)
            mesh.verts = [
                (
                    v[0] * math.cos(roll) - (v[1] - base) * math.sin(roll),
                    base + v[0] * math.sin(roll) + (v[1] - base) * math.cos(roll),
                    v[2],
                )
                for v in mesh.verts
            ]

    mesh.faces = faces

    return mesh


SHAPES = {
    # The beetle is the only one built rather than downloaded: 4.67:1 is not a proportion any
    # creature has, because it was solved from the road and the jump rather than from an animal.
    "critter_beetle_0": (lambda: beetle(0), "beetle"),
    "critter_beetle_1": (lambda: beetle(1), "beetle"),
    **{
        f"critter_{kind}_{pose}": ((lambda k=kind, p=pose: from_model(k, p)), kind)
        for kind in MODELS
        for pose in (0, 1)
    },
}


def scaled(mesh: Mesh, scale: float) -> str:
    """The mesh with its height multiplied, about its own base."""
    (_, _), (y0, _), (_, _) = mesh.bounds()
    out = Mesh()
    out.verts = [(v[0], y0 + (v[1] - y0) * scale, v[2]) for v in mesh.verts]
    out.faces = mesh.faces

    return out.obj()


def content_box(image: Image.Image) -> tuple[int, int]:
    """What survives delivery: the alpha box at `process()`'s own 6% floor."""
    alpha = image.split()[-1].point(lambda v: 255 if v / 255.0 >= 0.06 else 0)
    box = alpha.getbbox()

    return (image.width, image.height) if box is None else (box[2] - box[0], box[3] - box[1])


def model_yaw(kind: str) -> float:
    """The yaw this kind is rendered at: its model's own, or the family default."""
    return MODELS[kind][1] if kind in MODELS else YAW


def solve_height(build, kind: str) -> tuple[Image.Image, float]:
    """Finds the height scale whose RENDERED CONTENT lands on the target aspect.

    **⚠ Solved by measurement rather than by algebra, because the algebra is only right for a box.**
    `barrier_render` computes `height * cos(pitch) + depth * sin(pitch)` and that is exact for a
    panel; for a creature the tallest point and the deepest point are different points, and the
    closed form left 28% of the beetle's collision box as empty air above it — i.e. the model would
    hit you with a strip of sky. Two or three renders converge instead, and the relationship is
    near-linear so the first correction does nearly all of it.
    """
    mesh = build()
    scale = 1.0
    image = render(scaled(mesh, scale), MTL, yaw_deg=model_yaw(kind), pitch_deg=PITCH[kind], desat=0.0)

    for _ in range(6):
        width, height = content_box(image)
        aspect = width / height

        if abs(aspect / TARGETS[kind] - 1.0) < 0.004:
            break
        # Too wide means the content is too short: grow the height by exactly the shortfall.
        scale *= aspect / TARGETS[kind]
        image = render(scaled(mesh, scale), MTL, yaw_deg=model_yaw(kind), pitch_deg=PITCH[kind], desat=0.0)

    return image, scale


def fitted(build, kind: str) -> tuple[Image.Image, float]:
    """Renders one critter, trims to what it actually drew, and pads it to the target aspect.

    **⚠ The canvas aspect is not the aspect that ships, and believing it was cost a round.**
    `smooth_render` returns a canvas with margin around the subject; `build-sprites.py` floors the
    alpha and then trims to the alpha box, so what reaches the game is the *content* bounds. Measured
    on the first pass: canvas 4.68:1 against content 5.18:1.

    So the content is trimmed here, on the pipeline's own alpha floor, and padded to the target
    rather than stretched to it. **Padding preserves the creature and stretching does not** — and the
    residual is returned so it can be printed: it is the honest measure of how well the geometry fits
    its box after `solved` has done the arithmetic, and if it grows large the geometry is wrong
    rather than the number.
    """
    image, _ = solve_height(build, kind)

    # The same floor `process()` applies, so this trims to exactly what survives delivery.
    alpha = image.split()[-1].point(lambda v: 255 if v / 255.0 >= 0.06 else 0)
    box = alpha.getbbox()
    if box:
        image = image.crop(box)

    target = TARGETS[kind]
    natural = image.width / image.height
    padded = 0.0

    if natural > target:
        # Too wide: the box is taller than the creature. The pad goes on TOP, so a beetle's feet stay
        # on the bottom edge — a billboard is positioned by the point where its own band begins.
        height = max(1, round(image.width / target))
        padded = height / image.height - 1.0
        canvas = Image.new("RGBA", (image.width, height), (0, 0, 0, 0))
        canvas.paste(image, (0, height - image.height))
        image = canvas
    elif natural < target:
        width = max(1, round(image.height * target))
        padded = width / image.width - 1.0
        canvas = Image.new("RGBA", (width, image.height), (0, 0, 0, 0))
        canvas.paste(image, ((width - image.width) // 2, 0))
        image = canvas

    return image, padded


def report(kind: str, slot: str, image: Image.Image, padded: float) -> None:
    print(
        "  %-17s %4dx%-4d aspect %.3f  target %.3f  geometry needed %+.1f%% of padding"
        % (slot, image.width, image.height, image.width / image.height, TARGETS[kind], padded * 100)
    )


# What one world unit is worth in screen pixels at the row a critter is met, per frame width.
# The mascot is 500 units wide and draws 244px on a 1920 frame and 48px on a 375 one, and everything
# on this road scales by the frame's WIDTH — so these two numbers are the whole conversion.
CONTACT_PX = {"1920": 244.0 / 500.0, "375": 48.0 / 500.0}


def sheet(path: Path) -> None:
    """The acceptance artefact: every kind, both poses, large and at the size it is actually drawn.

    **On mid grey, because that is the one background that hides neither dark paint nor a pale
    plate** — this project's standing rule, and the thing that has caught a bone dragon, a flying
    saucer, a banana with a spear and a cobweb sold as a spider.

    **And at the delivered size, because that is the only size that matters.** A creature that reads
    beautifully at 340px and turns to mush at the 66px a phone gives it has not been checked; the two
    right-hand columns are the same sprite at the width it occupies when it reaches the player, on a
    desktop and on a phone.
    """
    cell = 300
    label = 26
    columns = 4
    rows = list(SHAPES.items())[::2]  # one row per kind; both poses drawn in the first two columns
    grid = Image.new("RGB", (cell * columns, (cell + label) * len(rows)), (128, 128, 128))
    draw = ImageDraw.Draw(grid)

    for r, (slot, (_, kind)) in enumerate(rows):
        top = r * (cell + label)
        poses = [fitted(SHAPES[f"critter_{kind}_{p}"][0], kind)[0] for p in (0, 1)]
        width_units = poses[0].width / poses[0].height * (
            TARGETS[kind] and (poses[0].height / poses[0].height)
        )
        # The kind's own world width, recovered from its target aspect and the height the game gives
        # it — printed rather than assumed, so the label says what the player will see.
        world_w = WORLD_WIDTH[kind]

        for c, image in enumerate(poses):
            thumb = image.copy()
            thumb.thumbnail((cell - 20, cell - 20))
            grid.paste(thumb, (c * cell + (cell - thumb.width) // 2, top + (cell - thumb.height) // 2), thumb)

        for c, (frame, per_unit) in enumerate(CONTACT_PX.items()):
            # **⚠ Clamped to the cell, which the first sheet was not**: a beetle is 781px wide when
            # it reaches the player on a desktop, and pasted at that width it ran straight across the
            # next two columns and over its neighbours. A contact sheet whose cells overlap is a
            # contact sheet that hides exactly what it exists to show.
            drawn = max(4, min(cell - 20, round(world_w * per_unit)))
            shrunk = poses[0].copy()
            shrunk.thumbnail((drawn, cell - 20), Image.LANCZOS)
            x = (2 + c) * cell + (cell - shrunk.width) // 2
            grid.paste(shrunk, (x, top + (cell - shrunk.height) // 2), shrunk)
            real = round(world_w * per_unit)
            note = f"{frame}px frame -> {real}px" + ("  (shown smaller)" if real > cell - 20 else "")
            draw.text(((2 + c) * cell + 6, top + cell + 4), note, fill=(30, 30, 30))

        draw.text((6, top + cell + 4), f"{kind}  {world_w:.0f}x{world_w / TARGETS[kind]:.0f} units", fill=(20, 20, 20))
        draw.text((cell + 6, top + cell + 4), "pose 1", fill=(20, 20, 20))
        print("  %-9s world %4.0f units wide -> %3dpx on 1920, %3dpx on 375"
              % (kind, world_w, round(world_w * CONTACT_PX["1920"]), round(world_w * CONTACT_PX["375"])))

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
        image, padded = fitted(build, kind)
        image.save(OUT / f"{slot}_geo.png")
        report(kind, slot, image, padded)


if __name__ == "__main__":
    main()
