"""
smooth_render.py  Render CC0 low-poly models into this game's CURRENT art language.

  py -3.11 dev-assets/cc0-3d/smooth_render.py kenney_nature-kit.zip out/

── WHY THIS IS NOT `cel_render.py` ────────────────────────────────────────────

That renderer exists beside this one and was written for the rail shooter's art: flat facets, three
tonal bands, a black silhouette outline and interior toon edges on every normal break. It was
matched — successfully — to that game's own props at **luminance 80, saturation 13%, ink 32%**.

The art direction inverted. The shipped set now measures **121 / 34% / 25%** and its whole brief is
glossy casual-mobile: soft studio light, creamy speculars, rounded forms, no contour. A cel-shaded
faceted prop dropped into that frame is the "two styles cannot share a frame" problem the project
opens with — and it is the half that tone matching *cannot* fix, because it is shape and shading
language rather than colour.

**So the geometry stays low-poly and the SHADING changes.** Four differences from the cel renderer,
each aimed at one clause of the reference:

  SMOOTH NORMALS       Face normals are accumulated per vertex and interpolated across each
                       triangle. A low-poly model shaded this way is not a faceted object, it is a
                       low-detail SMOOTH one — which is exactly what the reference's own props are.
                       This is the single change that decides whether the route works at all.
  CONTINUOUS LAMBERT   No bands. `BANDS` was there to make a render read as a drawing; here it
                       would be the one thing announcing that these came from somewhere else.
  A SPECULAR TERM      Blinn-Phong. The creamy highlight blob IS the look — the generated set's own
                       style head names it, and without it the props come back matte and read as a
                       different family however well their hue matches.
  NO INK               Neither the silhouette ring nor the interior toon edges. The reference has
                       no contour, and `artPalette.ts` records that dropping it was deliberate: the
                       silhouette is carried by value separation against the ground instead.

── WHAT THIS ROUTE STILL CANNOT DO ────────────────────────────────────────────

Unchanged from the first experiment, because it is a property of the models rather than of the
shading: it handles **large simple forms** — trees, rocks, stumps, mushrooms, columns. It does not
handle anything whose identity is fine structure. A low-poly bramble is a faceted fan; the drawn one
is a web of thin branches, and no shading model closes that gap.

That failure has no numeric signature, so a prop from this route is matched on the three numbers
**and then looked at**, on mid grey — the same rule every contact sheet in this project runs under.
"""
from __future__ import annotations

import sys
import zipfile
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))

from cel_render import load_mtl, load_obj, rotate  # noqa: E402

# Supersample factor. **Dropped from 4 to 2 when OUT_LONG went to 1024**, because the two multiply:
# 1024x4 is a 4096-wide buffer and this rasteriser is a per-triangle Python loop over numpy slices,
# which makes it both slow and memory-hungry. 2048 is still four samples per delivered pixel after
# the build downscales to 384, which is where the antialiasing actually has to hold.
SS = 2

# **1024, not 512, and the reason is what the player sees rather than what the file weighs.**
# A decor billboard in the near tier passes the camera at several hundred pixels tall; delivered at
# 176 it was being magnified on the way past and the facet edges came apart into visible pixels.
# The render has to start above what the build delivers, and the build has to deliver above what
# the frame draws — see `LONG_SIDE` in `scripts/build-sprites.py` for the other half.
OUT_LONG = 1024

# ── The look ────────────────────────────────────────────────────────────────
#
# The target is the shipped set's own measurement, `node scripts/measure-art.mjs public/assets/decor`:
# median lightness 121, saturation 34%, ink share 25% (ink = below lightness 70).
#
# **⚠ 0.55, and the prototype is why it is not 0.** It was 0 on the reasoning that the target is now
# 34% saturation and the kit ships vivid colours, so keeping them is the point. What that ignored is
# that a decor prop is MULTIPLIED by its biome's tint at draw time, and a multiply cannot argue with
# the saturation it is handed: `rock_largeA` ships orange, so the forest boulder arrived orange and
# stayed orange whatever the forest's green tint did to it.
#
# That matters far more here than it did for the generated set, because one kit has to furnish nine
# biomes. A crystal shard and an ashen slab are the same grey rock model; what makes them different
# places is the tint, and the tint only has authority over material that has been pulled toward its
# own grey first. This is the parent project's original argument, arrived at from the other side.
KD_DESAT = 0.55

# Lambert is compressed into `[AMBIENT, 1]` rather than run to black. A shadow side that goes to
# zero is what makes a render read as dramatic; the reference's fill light is strong, and this is
# that fill. It is also what holds the ink share down — at AMBIENT 0.18 the darkest band of a
# mid-green sits near lightness 40 and counts as ink, which is where the 25% target comes from.
AMBIENT = 0.34
VALUE_SCALE = 1.06

# Blinn-Phong. `SPEC_POWER` is high and `SPEC_STRENGTH` moderate on purpose: the reference's
# highlight is a small tight blob with a soft edge, not a broad sheen. A low power spreads it over
# the whole lit side and the prop reads as wet plastic — which is the exact failure the obstacle
# round hit from the prompt side.
# **⚠ 0.12, down from 0.30, and a flat-faced model is why.** The reference's creamy highlight
# lives on ROUNDED forms — a shell, a cap, a berry — where a tight specular is a small blob on a
# curve. On a low-poly cube the smoothed normal varies gently across a large flat face, so the same
# term spreads into one soft white patch covering most of the face: the `cliff_blockHalf_stone`
# obstacle came back looking like a lit screen rather than a stone. The kit is full of flat faces,
# so the highlight has to be the seasoning it is on a curve rather than the event it becomes on a
# plane.
SPEC_STRENGTH = 0.12
SPEC_POWER = 40.0

# Key from above-left and slightly toward the viewer, which is the reference's own key. Kept as the
# cel renderer's vector so the two are comparable.
LIGHT = np.array([-0.42, 0.72, 0.55])
LIGHT = LIGHT / np.linalg.norm(LIGHT)
VIEW = np.array([0.0, 0.0, 1.0])
HALF = (LIGHT + VIEW) / np.linalg.norm(LIGHT + VIEW)


def vertex_normals(verts: np.ndarray, faces) -> np.ndarray:
    """Area-weighted vertex normals — the whole reason this file exists.

    Accumulating the *unnormalised* cross product weights each face by twice its area, which is what
    keeps a large flat side from being dragged around by the many small triangles meeting at its
    corner. Normalised once at the end.
    """
    acc = np.zeros_like(verts)
    for tri, _ in faces:
        a, b, c = tri
        n = np.cross(verts[b] - verts[a], verts[c] - verts[a])
        acc[a] += n
        acc[b] += n
        acc[c] += n
    lengths = np.linalg.norm(acc, axis=1, keepdims=True)
    lengths[lengths == 0] = 1.0
    return acc / lengths


def render(
    obj_text: str,
    mtl_text: str,
    yaw_deg: float = 28.0,
    pitch_deg: float = 6.0,
    repeat: int = 1,
) -> Image.Image:
    """One model, or `repeat` copies of it in a row.

    **`repeat` exists for the `low` obstacle class and nothing else.** That class is 4.57:1 — a
    barrier four and a half times wider than it is tall — and no single model in a nature kit has
    that proportion; the widest thing here is a fence panel at 3.18. Copying the geometry along X
    before projecting is the honest way to reach it, and it matches what the game does with the
    result anyway: `drawWall` lays these edge to edge with a third of a width of overlap.

    The copies are staggered in Z as well as X so they occlude each other slightly rather than
    reading as one flat repeated stamp — the same reason `drawWall` overlaps them.
    """
    verts, faces = load_obj(obj_text)
    kd = load_mtl(mtl_text)
    v = rotate(verts, np.radians(yaw_deg), np.radians(pitch_deg))

    if repeat > 1:
        base_v, base_f, n_v = v, faces, len(v)
        span = base_v[:, 0].max() - base_v[:, 0].min()
        depth = (base_v[:, 2].max() - base_v[:, 2].min()) * 0.45
        ground = base_v[:, 1].min()

        # **The copies differ in height, and that is what turns a row into a RIDGE.** The first
        # version placed identical copies at even spacing and delivered exactly that: a row of
        # identical rocks, read as several objects rather than one landform. A skyline is read from
        # its top edge, so the top edge has to vary — three peaks of the same height are a fence.
        #
        # Deterministic rather than random: the same model and count must always give the same
        # picture, because these are baked to a PNG and a re-render that changed the shape would
        # make every screenshot before it incomparable.
        heights = (1.0, 0.66, 0.86, 0.74, 0.94, 0.6)
        # 0.58 rather than 0.82 so neighbours OVERLAP into one silhouette instead of standing
        # apart. What makes a distant range read as a range is that its outline is continuous.
        step = span * 0.58

        parts_v, parts_f = [], []
        for i in range(repeat):
            h = heights[i % len(heights)]
            copy = base_v.copy()
            # Scaled about the ground plane, so every peak still stands on it — a copy scaled about
            # its own centre would float or sink.
            copy[:, 1] = ground + (copy[:, 1] - ground) * h
            copy[:, 0] *= 0.82 + 0.18 * h
            copy += np.array([step * (i - (repeat - 1) / 2), 0.0, depth * ((i % 3) - 1)])
            parts_v.append(copy)
            parts_f += [([a + i * n_v for a in tri], m) for tri, m in base_f]
        v, faces = np.concatenate(parts_v), parts_f

    vn = vertex_normals(v, faces)

    minx, maxx = v[:, 0].min(), v[:, 0].max()
    miny, maxy = v[:, 1].min(), v[:, 1].max()
    span = max(maxx - minx, maxy - miny)
    pad = 0.04 * span
    minx, maxx, miny, maxy = minx - pad, maxx + pad, miny - pad, maxy + pad
    w_world, h_world = maxx - minx, maxy - miny

    if w_world >= h_world:
        W = OUT_LONG * SS
        H = max(1, int(round(W * h_world / w_world)))
    else:
        H = OUT_LONG * SS
        W = max(1, int(round(H * w_world / h_world)))

    px = (v[:, 0] - minx) * (W / w_world)
    py = (maxy - v[:, 1]) * (H / h_world)
    pz = v[:, 2]

    colour = np.zeros((H, W, 3), dtype=np.float32)
    depth_buf = np.full((H, W), -1e30, dtype=np.float64)
    mask = np.zeros((H, W), dtype=bool)

    for tri, material in faces:
        a, b, c = tri
        p = np.array([[px[a], py[a]], [px[b], py[b]], [px[c], py[c]]])

        base = np.array(kd.get(material, (0.6, 0.6, 0.6)), dtype=np.float32)
        if KD_DESAT:
            base = base + (float(base.mean()) - base) * KD_DESAT

        x0, x1 = max(0, int(p[:, 0].min())), min(W - 1, int(np.ceil(p[:, 0].max())))
        y0, y1 = max(0, int(p[:, 1].min())), min(H - 1, int(np.ceil(p[:, 1].max())))
        if x1 < x0 or y1 < y0:
            continue

        gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        d = (p[1, 1] - p[2, 1]) * (p[0, 0] - p[2, 0]) + (p[2, 0] - p[1, 0]) * (p[0, 1] - p[2, 1])
        if abs(d) < 1e-12:
            continue
        w0 = ((p[1, 1] - p[2, 1]) * (gx - p[2, 0]) + (p[2, 0] - p[1, 0]) * (gy - p[2, 1])) / d
        w1 = ((p[2, 1] - p[0, 1]) * (gx - p[2, 0]) + (p[0, 0] - p[2, 0]) * (gy - p[2, 1])) / d
        w2 = 1.0 - w0 - w1
        inside = (w0 >= 0) & (w1 >= 0) & (w2 >= 0)
        if not inside.any():
            continue
        dep = w0 * pz[a] + w1 * pz[b] + w2 * pz[c]
        sub = depth_buf[y0 : y1 + 1, x0 : x1 + 1]
        win = inside & (dep > sub)
        if not win.any():
            continue

        # Per-pixel normal, barycentrically interpolated — Phong rather than Gouraud, because the
        # specular is a high power and interpolating the *result* of one would break it into facets
        # again, which is the thing this renderer exists to avoid.
        n = w0[..., None] * vn[a] + w1[..., None] * vn[b] + w2[..., None] * vn[c]
        ln = np.linalg.norm(n, axis=2, keepdims=True)
        ln[ln == 0] = 1.0
        n = n / ln
        if float(np.dot(np.cross(v[b] - v[a], v[c] - v[a]), VIEW)) < 0:
            n = -n

        lam = np.clip(n @ LIGHT, 0.0, 1.0)
        diffuse = AMBIENT + (1.0 - AMBIENT) * lam
        spec = SPEC_STRENGTH * np.clip(n @ HALF, 0.0, 1.0) ** SPEC_POWER

        shade = base[None, None, :] * diffuse[..., None] * VALUE_SCALE + spec[..., None]

        sub[win] = dep[win]
        colour[y0 : y1 + 1, x0 : x1 + 1][win] = shade[win]
        mask[y0 : y1 + 1, x0 : x1 + 1][win] = True

    rgba = np.zeros((H, W, 4), dtype=np.uint8)
    rgba[..., :3] = np.clip(colour * 255, 0, 255).astype(np.uint8)
    rgba[..., 3] = np.where(mask, 255, 0)

    img = Image.fromarray(rgba, "RGBA")
    return img.resize((max(1, W // SS), max(1, H // SS)), Image.LANCZOS)


def main() -> None:
    zip_path, out_dir = Path(sys.argv[1]), Path(sys.argv[2])
    picks = sys.argv[3].split(",") if len(sys.argv) > 3 else [f"{k}={v}" for k, v in MODELS.items()]
    out_dir.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(zip_path) as z:
        names = {n.split("/")[-1][:-4]: n for n in z.namelist() if n.endswith(".obj") and "OBJ format" in n}
        for pick in picks:
            slot, model = pick.split("=") if "=" in pick else (pick, pick)
            rep, yaw = 1, 28.0
            # `slot=model*count@yaw` — the count repeats the geometry (see `render`), the yaw
            # overrides the default three-quarter view. Almost everything wants the default: a
            # three-quarter view is what makes a rock read as a solid rather than as a cut-out.
            # What does not is anything whose job is to SPAN the road — see `obs_over_0`.
            if "@" in model:
                model, angle = model.split("@")
                yaw = float(angle)
            if "*" in model:
                model, count = model.split("*")
                rep = int(count)
            if model not in names:
                print(f"  {slot:16s} MISSING {model}")
                continue
            obj = z.read(names[model]).decode("utf-8", "replace")
            mtl_name = names[model].rsplit("/", 1)[0] + "/" + obj.split("mtllib ")[1].split("\n")[0].strip()
            mtl = z.read(mtl_name).decode("utf-8", "replace") if mtl_name in z.namelist() else ""
            img = render(obj, mtl, yaw_deg=yaw, repeat=rep)
            path = out_dir / f"{slot}.png"
            img.save(path)
            print(f"  {slot:16s} <- {model:24s} x{rep}  {img.width}x{img.height}  aspect {img.width / img.height:.2f}")




# ── The slot map ────────────────────────────────────────────────────────────
#
# Every decor slot in the game against the model that stands in for it. One CC0 kit has to furnish
# nine biomes, and it does that in two ways rather than one:
#
#   BY MODEL   where the kit has the subject — pines, palms, mushrooms, cacti, lilies, logs,
#              stumps, columns, obelisks. Most slots.
#   BY TINT    where it does not. `crystal` has no crystals in a nature kit and `ashen` has nothing
#              burnt, so both are furnished from the same angular rock and stone families and made
#              into different places by `biomes.ts`'s own `decorTint` — which is exactly what that
#              multiply is for, and why `KD_DESAT` above had to come back off zero.
#
# **Where the kit genuinely has no answer the slot is written down as a compromise rather than
# quietly fudged.** `dune_bone` is a cave mouth standing in for a rib arch, `rid_snag` an old stump
# standing in for a dead tree: both keep the slot's SILHOUETTE CLASS (an opening, a bare upright),
# which is what the biome tables separate props by, and neither is the subject the name asks for.
MODELS = {
    # forest — the kit's home ground, every slot is the real subject
    "for_pine": "tree_pineTallA_detailed",
    "for_birch": "tree_thin",
    "for_fern": "grass_leafsLarge",
    # `mushroom_tan*`, never `mushroom_red*`: a red cap is the reserved threat colour, which the
    # build's own guard would rotate out anyway. Cheaper to not ask for it.
    "for_mushroom": "mushroom_tanGroup",
    "for_bramble": "plant_bushDetailed",
    "for_boulder": "rock_largeA",
    # dunes
    "dune_rock": "rock_largeC",
    "dune_grass": "grass_large",
    "dune_cactus": "cactus_tall",
    "dune_bone": "rock_smallTopB",        # compromise: a low mound, not a rib arch
    "dune_shrub": "plant_bushSmall",
    "dune_spire": "rock_tallJ",
    # wetland
    "wet_reeds": "crops_bambooStageB",
    "wet_stump": "stump_roundDetailed",
    "wet_lily": "lily_large",
    "wet_willow": "tree_fat",
    "wet_log": "log_large",
    "wet_cattail": "crops_wheatStageB",
    # ridge — cold stone, the `stone_*` family rather than `rock_*`
    "rid_scree": "rock_smallFlatC",
    "rid_monolith": "stone_tallD",
    "rid_arch": "statue_ring",            # a real hole, where `cliff_cave` read as a doorway
    "rid_cairn": "rock_smallTopB",
    "rid_lichen": "stone_largeB",
    "rid_snag": "stump_oldTall",          # compromise: a bare upright, not a dead tree
    # ashen — nothing in the kit is burnt; the biome's own tint does the work
    "ash_stump": "stump_old",
    "ash_slab": "stone_largeF",
    "ash_spar": "rock_tallD",
    "ash_vent": "campfire_bricks",        # a mouth that is not a doorway
    "ash_scrub": "plant_bushTriangle",
    "ash_mound": "rock_largeE",
    # fungal — six mushrooms in the kit, five slots
    "fun_tall": "mushroom_tanTall",
    "fun_dome": "mushroom_tan",
    "fun_cluster": "mushroom_tanGroup",
    "fun_pair": "mushroom_redGroup",
    "fun_wide": "plant_flatShort",
    # crystal — no crystals either; angular rock plus the biome's blue-violet tint
    "cry_cluster": "stone_tallB",
    "cry_geode": "rock_smallTopA",
    "cry_bloom": "rock_tallH",
    "cry_pillar": "stone_tallJ",
    "cry_slab": "stone_largeD",
    "cry_shard": "rock_tallC",
    # coast — five, because `coa_shell` is deliberately not shipped (it is the mascot's silhouette)
    "coa_stack": "rock_tallA",
    "coa_kelp": "plant_flatTall",
    "coa_palm": "tree_palmDetailedTall",
    "coa_reef": "plant_bushLarge",
    "coa_drift": "log",
    # ruins — the kit's `statue_*` family is this biome almost exactly
    "rui_rubble": "stone_smallFlatA",
    "rui_column": "statue_column",
    "rui_wall": "cliff_blockDiagonal_stone",   # `cliff_block_stone` is a blank cube
    "rui_arch": "cliff_cave_stone",
    "rui_statue": "statue_head",
    "rui_obelisk": "statue_obelisk",
}


if __name__ == "__main__":
    main()


# The three obstacle classes. Separate from `MODELS` because these are sized to a COLLISION BOX
# rather than trimmed to their own alpha: `OBSTACLE_BANDS` fixes each class's proportion, and a
# sprite at the wrong aspect is stretched into a hitbox that lies. Delivered against the targets:
#
#   low       4.57 asked -> 3.84 / 4.27 / 4.17   MEASURED AFTER THE BUILD'S TRIM, not before it.
#             Reading the renderer's own output is what got this wrong first: `fence_simpleLow*2`
#             printed 4.85 there and delivered **6.98** once the trim removed its vertical margin,
#             which is further off the target than the single panel it replaced. One panel prints
#             3.18 and delivers 3.84.
#   blocking  1.58 asked -> 1.96 / 1.82
#   overhead  1.84 asked -> 2.22
#
# Nothing in a nature kit is a crate or a barrel, so the class is furnished from what is: fences,
# a log stack, a half cliff block, a square stump, a fallen log. They still read as MADE things
# among natural ones, which is the separation the class exists for.
OBSTACLE_MODELS = {
    "obs_low_0": "stone_smallFlatA",
    "obs_low_1": "campfire_stones",
    "obs_low_2": "rock_smallFlatA",
    "obs_block_0": "stump_squareDetailed",
    "obs_block_1": "cliff_blockSlope_stone",
    "obs_over_0": "log_large@28",
}

# **Chosen on the aspect MEASURED AFTER THE BUILD TRIMS, which is the only one that reaches the
# game.** Reading the renderer's own printed size picked three wrong models in a row, because the
# trim then crops away however much empty canvas the model left above and below it:
# `crops_dirtDoubleRow` prints 5.04 and delivers 7.39; `bridge_center_wood` prints 2.69 and
# delivers 3.10. Against the targets 4.57 / 1.58 / 1.84 the shipped set measures:
#
#   low       4.17 / 4.22 / 4.17    two flat slabs and a ring of angular stones — three distinct
#                                   silhouettes, which is what `drawWall` needs so that no two
#                                   neighbours in a wall match
#   blocking  1.95 / 1.27           the closest pair the kit has, missing either side by ~20%
#   overhead  2.45                  `log_large` at the default three-quarter view. Two other
#                                   answers were tried and both were worse by eye: at yaw 0 a
#                                   log is seen END ON and delivers a circle, and at yaw 90 it
#                                   is a 3.88 strip stretched into the 2.19 band, which reads
#                                   as a flat brown PLANK rather than as a log. The number was
#                                   closer at 90 and the picture was wrong, which is the whole
#                                   reason this table is looked at as well as measured.

# **⚠ THE FIRST OBSTACLE SET WAS PICKED ON ASPECT ALONE AND THREE OF THE SIX WERE WRONG.** What a
# number cannot see, and what a screenshot showed immediately:
#
#   fence_planksDouble   a panel on two posts. At this yaw it reads as a SIGN STANDING ON LEGS with
#                        daylight under it — reported as "hangs in the air", and correctly.
#   fence_simpleLow      the same defect, smaller.
#   cliff_blockHalf      a featureless cube. With the old specular it came back as a white-lit
#                        screen; even fixed, a blank cube is not an obstacle, it is a placeholder.
#   log_stack            round logs seen end on, which is the bulging lozenge the brief rejects.
#
# The replacements are chosen for FLAT FACES AND A BASE THAT MEETS THE GROUND, which is what the
# brief actually asks for: a flat stone slab, a row of planks lying down, a ring of angular stones,
# a carved block, a sloped block, and a timber beam. None of them stands on anything.
