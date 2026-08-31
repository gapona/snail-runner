"""glb_obj.py  A glTF-binary reader, so a downloaded CC0 model can go through `smooth_render`.

  py -3.11 dev-assets/cc0-3d/glb_obj.py dev-assets/cc0-3d/poly/bee_42djT5zJnx.glb --info

WHY THIS EXISTS

`smooth_render` reads OBJ, which is what Kenney ships — and Kenney has no creatures. Everything else
free and CC0 (Poly Pizza, and the Google Poly archive behind it) ships **GLB**, so without a reader
the whole free-model world is closed to this project and every creature has to be built by hand.

**It is deliberately a converter and not a library.** Fifty lines of glTF is enough to answer the
only question `smooth_render` asks — where are the triangles and what colour is each one — and the
alternative is a dependency on somebody's machine for a dev-time script. It handles exactly what a
static CC0 model uses: indexed or non-indexed triangles, node transforms, and `baseColorFactor` as
a flat Kd. It does NOT do textures, skins or animation, and says so rather than guessing.

WHAT IT DOES NOT SOLVE, WHICH IS THE INTERESTING PART

Reading a model is the easy half. `critter_render.py`'s header carries the hard one: **the drawn box
IS the collision box**, so a model whose own proportion differs from the box it is scaled onto is
distorted in every frame. Measured over the CC0 candidates: bees come in at 1.9-2.1:1 against a bee
box of 2.34:1 — usable — and beetles and spiders at 1.1-1.3:1 against a beetle box of 4.67:1, which
is not a difference any amount of rendering fixes. A model decides which boxes it can fill; it does
not get to decide the box.
"""
from __future__ import annotations

import argparse
import base64
import json
import struct
from pathlib import Path

import numpy as np

# glTF's component types, and how many numbers each element holds.
COMPONENT = {5120: "b", 5121: "B", 5122: "h", 5123: "H", 5125: "I", 5126: "f"}
COUNT = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


def chunks(data: bytes) -> tuple[dict, bytes]:
    """The JSON chunk and the binary chunk of a GLB."""
    if data[:4] != b"glTF":
        raise ValueError("not a GLB")
    _, _, total = struct.unpack("<III", data[:12])
    offset = 12
    gltf: dict | None = None
    binary = b""
    while offset < total:
        length, kind = struct.unpack("<II", data[offset : offset + 8])
        payload = data[offset + 8 : offset + 8 + length]
        if kind == 0x4E4F534A:
            gltf = json.loads(payload.decode("utf-8", "replace"))
        elif kind == 0x004E4942:
            binary = payload
        offset += 8 + length + (-length % 4)
    if gltf is None:
        raise ValueError("no JSON chunk")
    return gltf, binary


def buffer_bytes(gltf: dict, binary: bytes, index: int) -> bytes:
    buffer = gltf["buffers"][index]
    uri = buffer.get("uri")
    if uri is None:
        return binary
    if uri.startswith("data:"):
        return base64.b64decode(uri.split(",", 1)[1])
    raise ValueError("external buffer files are not supported")


def read_accessor(gltf: dict, binary: bytes, index: int) -> np.ndarray:
    accessor = gltf["accessors"][index]
    per = COUNT[accessor["type"]]
    fmt = COMPONENT[accessor["componentType"]]
    size = struct.calcsize("<" + fmt)
    view = gltf["bufferViews"][accessor["bufferView"]]
    raw = buffer_bytes(gltf, binary, view.get("buffer", 0))
    start = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    stride = view.get("byteStride") or per * size
    out = np.empty((accessor["count"], per), dtype=np.float64)
    for i in range(accessor["count"]):
        at = start + i * stride
        out[i] = struct.unpack_from("<" + fmt * per, raw, at)
    return out


def node_matrix(node: dict) -> np.ndarray:
    """One node's local transform, from either a matrix or a TRS triple."""
    if "matrix" in node:
        return np.array(node["matrix"], dtype=np.float64).reshape(4, 4).T
    out = np.eye(4)
    if "scale" in node:
        out = out @ np.diag([*node["scale"], 1.0])
    if "rotation" in node:
        x, y, z, w = node["rotation"]
        rotation = np.array(
            [
                [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 0],
                [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 0],
                [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y), 0],
                [0, 0, 0, 1],
            ]
        )
        out = rotation @ out
    if "translation" in node:
        move = np.eye(4)
        move[:3, 3] = node["translation"]
        out = move @ out
    return out


def load(path: Path) -> tuple[str, str, dict]:
    """Returns `(obj_text, mtl_text, info)` for one GLB.

    Materials become one flat `Kd` each, from `baseColorFactor`. **A textured model loses its
    texture and that is stated rather than hidden**: this project's own art is flat-shaded cel work,
    so a base colour is usually what is wanted anyway — but a model whose whole identity is its
    texture will come through as a blank silhouette, and `--info` reports the material count so that
    is visible before anything is rendered.
    """
    gltf, binary = chunks(path.read_bytes())

    materials = []
    for i, material in enumerate(gltf.get("materials", [])):
        pbr = material.get("pbrMetallicRoughness", {})
        colour = pbr.get("baseColorFactor", [0.7, 0.7, 0.7, 1.0])[:3]
        materials.append((material.get("name", f"m{i}") or f"m{i}", colour))
    if not materials:
        materials.append(("default", [0.7, 0.7, 0.7]))

    verts: list[tuple[float, float, float]] = []
    faces: list[tuple[tuple[int, int, int], str]] = []
    textured = 0

    def visit(node_index: int, parent: np.ndarray) -> None:
        nonlocal textured
        node = gltf["nodes"][node_index]
        world = parent @ node_matrix(node)
        if "mesh" in node:
            for primitive in gltf["meshes"][node["mesh"]].get("primitives", []):
                if primitive.get("mode", 4) != 4:
                    continue
                position = primitive.get("attributes", {}).get("POSITION")
                if position is None:
                    continue
                points = read_accessor(gltf, binary, position)
                homogeneous = np.hstack([points, np.ones((len(points), 1))])
                moved = (world @ homogeneous.T).T[:, :3]
                base = len(verts)
                verts.extend(map(tuple, moved))
                index = primitive.get("indices")
                order = (
                    read_accessor(gltf, binary, index).astype(int).ravel()
                    if index is not None
                    else np.arange(len(points))
                )
                slot = primitive.get("material", 0)
                if slot < len(gltf.get("materials", [])):
                    pbr = gltf["materials"][slot].get("pbrMetallicRoughness", {})
                    if "baseColorTexture" in pbr:
                        textured += 1
                name = materials[min(slot, len(materials) - 1)][0]
                for t in range(0, len(order) - 2, 3):
                    faces.append((tuple(base + int(o) for o in order[t : t + 3]), name))
        for child in node.get("children", []):
            visit(child, world)

    scene = gltf.get("scene", 0)
    roots = gltf.get("scenes", [{}])[scene].get("nodes", range(len(gltf.get("nodes", []))))
    for root in roots:
        visit(root, np.eye(4))

    lines = ["v %.6f %.6f %.6f" % v for v in verts]
    current = None
    for tri, name in faces:
        if name != current:
            lines.append("usemtl " + name)
            current = name
        lines.append("f " + " ".join(str(i + 1) for i in tri))

    mtl = "\n".join(f"newmtl {name}\nKd {c[0]:.4f} {c[1]:.4f} {c[2]:.4f}" for name, c in materials)
    array = np.array(verts) if verts else np.zeros((1, 3))
    size = array.max(axis=0) - array.min(axis=0)

    info = {
        "verts": len(verts),
        "faces": len(faces),
        "materials": len(materials),
        "textured": textured,
        "size": tuple(size),
        "aspect": float(size[0] / max(1e-9, size[1])),
        "verts_xyz": verts,
        "faces_named": faces,
    }

    return "\n".join(lines), mtl, info


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("glb")
    ap.add_argument("--info", action="store_true")
    args = ap.parse_args()

    obj, mtl, info = load(Path(args.glb))
    if args.info:
        print(
            "%s  %d verts  %d tris  %d materials  %d textured  %.2f:1 (w %.3f h %.3f d %.3f)"
            % (
                Path(args.glb).name,
                info["verts"],
                info["faces"],
                info["materials"],
                info["textured"],
                info["aspect"],
                *info["size"],
            )
        )
    else:
        print(obj)
        print(mtl)


if __name__ == "__main__":
    main()
