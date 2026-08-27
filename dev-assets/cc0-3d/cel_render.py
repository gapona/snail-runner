"""
Second pass at the CC0-model-to-billboard render, giving the method its best shot.

Two things the first pass got wrong, both found by putting the result beside the game's own props:

* **The silhouette outline was measured in the wrong units.** It was set at supersample resolution
  and then survived two downscales (4x supersample, then 512 -> 176 in the project's own build), so
  a 6px ring arrived as half a pixel and the prop shipped with no visible ink at all. It is now
  derived from the *delivered* size and worked backwards.
* **There was no interior linework**, and that is most of what makes the game's own props read as
  drawings rather than as renders. A flat-shaded low-poly model has facet boundaries; inking the
  ones where the normal turns sharply is the standard toon edge and costs one post-process pass.
"""
from __future__ import annotations

import sys
import zipfile
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

SS = 4
OUT_LONG = 512
DELIVERED_LONG = 176  # what scripts/build-sprites.py downscales decor to

# Ink weights in *delivered* pixels, then converted. This is the fix.
#
# The values below are not taste either — they are matched against the game's own forest props,
# measured over their opaque pixels: mean luminance 80, mean saturation 13%, and 32% of the shape
# dark enough to read as ink. The first render came back 1.29x as bright, 2.66x as saturated and
# carrying 0.38x the ink, which is exactly why it popped forward off the verge instead of sitting
# on it. Brightness and saturation were the bigger half: a low-poly kit ships vivid flat Kd values,
# and the pipeline's own 50% desaturate is calibrated for diffusion art that is already muted.
SILHOUETTE_INK = 2.8
INTERIOR_INK = 1.8

# How far each material's Kd is pulled toward its own grey before shading, on top of the 50% the
# build applies later. Solved from the measurement: 34.7% * (1 - 0.625) lands on the target 13%.
KD_DESAT = 0.625
VALUE_SCALE = 0.82

BANDS = (0.40, 0.72, 1.0)
LIGHT = np.array([-0.42, 0.72, 0.55])
LIGHT = LIGHT / np.linalg.norm(LIGHT)

# How sharply a normal has to turn between neighbouring pixels before the edge is inked. cos(22deg).
# Loosened from cos(35) with the ink target: a low-poly hull has few facet breaks, so a strict
# threshold inks almost nothing and the prop reads as a flat vector shape rather than a drawing.
NORMAL_BREAK = 0.93


def load_mtl(text: str) -> dict[str, tuple[float, float, float]]:
    out: dict[str, tuple[float, float, float]] = {}
    name = None
    for line in text.splitlines():
        parts = line.split()
        if not parts:
            continue
        if parts[0] == "newmtl":
            name = parts[1]
        elif parts[0] == "Kd" and name:
            out[name] = (float(parts[1]), float(parts[2]), float(parts[3]))
    return out


def load_obj(text: str) -> tuple[np.ndarray, list[tuple[list[int], str]]]:
    verts: list[list[float]] = []
    faces: list[tuple[list[int], str]] = []
    material = ""
    for line in text.splitlines():
        parts = line.split()
        if not parts:
            continue
        if parts[0] == "v":
            verts.append([float(parts[1]), float(parts[2]), float(parts[3])])
        elif parts[0] == "usemtl":
            material = parts[1]
        elif parts[0] == "f":
            idx = [int(p.split("/")[0]) - 1 for p in parts[1:]]
            for i in range(1, len(idx) - 1):
                faces.append(([idx[0], idx[i], idx[i + 1]], material))
    return np.asarray(verts, dtype=np.float64), faces


def rotate(v: np.ndarray, yaw: float, pitch: float) -> np.ndarray:
    cy, sy = np.cos(yaw), np.sin(yaw)
    cp, sp = np.cos(pitch), np.sin(pitch)
    ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    rx = np.array([[1, 0, 0], [0, cp, -sp], [0, sp, cp]])
    return v @ ry.T @ rx.T


def render(obj_text: str, mtl_text: str, yaw_deg: float = 28.0, pitch_deg: float = 6.0) -> Image.Image:
    verts, faces = load_obj(obj_text)
    kd = load_mtl(mtl_text)
    v = rotate(verts, np.radians(yaw_deg), np.radians(pitch_deg))

    minx, maxx = v[:, 0].min(), v[:, 0].max()
    miny, maxy = v[:, 1].min(), v[:, 1].max()
    span = max(maxx - minx, maxy - miny)
    pad = 0.08 * span
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
    normals = np.zeros((H, W, 3), dtype=np.float32)
    depth_buf = np.full((H, W), -1e30, dtype=np.float64)
    mask = np.zeros((H, W), dtype=bool)

    for tri, material in faces:
        a, b, c = tri
        p = np.array([[px[a], py[a]], [px[b], py[b]], [px[c], py[c]]])
        n = np.cross(v[b] - v[a], v[c] - v[a])
        ln = np.linalg.norm(n)
        if ln == 0:
            continue
        n = n / ln
        if n[2] < 0:
            n = -n

        lam = float(np.clip(np.dot(n, LIGHT), 0.0, 1.0))
        band = BANDS[0] if lam < 0.33 else (BANDS[1] if lam < 0.72 else BANDS[2])
        base = np.array(kd.get(material, (0.6, 0.6, 0.6)), dtype=np.float32)
        base = base + (float(base.mean()) - base) * KD_DESAT
        shade = base * band * VALUE_SCALE

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
        sub[win] = dep[win]
        colour[y0 : y1 + 1, x0 : x1 + 1][win] = shade
        normals[y0 : y1 + 1, x0 : x1 + 1][win] = n
        mask[y0 : y1 + 1, x0 : x1 + 1][win] = True

    # Interior toon edges: ink where the surface turns sharply or the depth jumps. Both tests are
    # over the shaded surface only, so the silhouette (handled below) is not double-inked.
    dot = np.ones((H, W), dtype=np.float32)
    for dy, dx in ((0, 1), (1, 0), (1, 1), (1, -1)):
        rolled = np.roll(np.roll(normals, dy, 0), dx, 1)
        both = mask & np.roll(np.roll(mask, dy, 0), dx, 1)
        d2 = np.sum(normals * rolled, axis=2)
        dot = np.where(both, np.minimum(dot, d2), dot)
    span_z = float(np.ptp(pz)) or 1.0
    dz = np.zeros((H, W), dtype=np.float64)
    for dy, dx in ((0, 1), (1, 0)):
        both = mask & np.roll(np.roll(mask, dy, 0), dx, 1)
        dz = np.where(both, np.maximum(dz, np.abs(depth_buf - np.roll(np.roll(depth_buf, dy, 0), dx, 1))), dz)
    edges = mask & ((dot < NORMAL_BREAK) | (dz > 0.06 * span_z))

    # Ink weights, converted from delivered pixels back through both downscales.
    to_ss = (OUT_LONG * SS) / DELIVERED_LONG
    sil = max(1, int(round(SILHOUETTE_INK * to_ss / 2)))
    inner = max(1, int(round(INTERIOR_INK * to_ss / 2)))

    grown = ndimage.binary_dilation(mask, iterations=sil)
    inked = ndimage.binary_dilation(edges, iterations=inner) & mask

    # **Not pure black, and that is not taste.** A zero-valued outline sitting hard against the
    # alpha boundary makes the outermost opaque pixel black, so the pipeline's closing flood copies
    # black into the transparent border and every mipmap level averages it back into the silhouette
    # -- which `verify:mattes` rejects, correctly. Measured on the game's own props, their outermost
    # opaque pixels sit at luminance 25-63; a pure-black ring measures 0.3-0.8. INK matches theirs.
    INK = np.array([26, 28, 26], dtype=np.uint8)
    rgba = np.zeros((H, W, 4), dtype=np.uint8)
    rgba[..., :3] = np.clip(colour * 255, 0, 255).astype(np.uint8)
    rgba[grown & ~mask, :3] = INK
    rgba[inked, :3] = np.maximum((rgba[inked, :3] * 0.18).astype(np.uint8), INK)
    rgba[..., 3] = np.where(grown, 255, 0)

    img = Image.fromarray(rgba, "RGBA")
    return img.resize((max(1, W // SS), max(1, H // SS)), Image.LANCZOS)


def main() -> None:
    zip_path, out_dir = Path(sys.argv[1]), Path(sys.argv[2])
    out_dir.mkdir(parents=True, exist_ok=True)
    z = zipfile.ZipFile(zip_path)
    for name in sys.argv[3:]:
        obj = z.read(f"Models/OBJ format/{name}.obj").decode("utf8", "replace")
        mtl = z.read(f"Models/OBJ format/{name}.mtl").decode("utf8", "replace")
        img = render(obj, mtl)
        img.save(out_dir / f"{name}.png")
        print(f"{name:26} {img.width}x{img.height}")


if __name__ == "__main__":
    main()
