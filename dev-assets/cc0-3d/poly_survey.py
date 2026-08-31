"""poly_survey.py  Find CC0 creature models on Poly Pizza, and report enough to pick one by.

  py -3.11 dev-assets/cc0-3d/poly_survey.py beetle bee spider ant

**Reads, does not download.** It lists candidates with the two facts that decide whether one is
usable here — the licence, because this project takes CC0 or self-generated and a CC-BY model would
owe a visible credit line the game has nowhere to put; and the aspect the model would deliver, which
is what `critter_render.py`'s own header is about: the drawn box IS the collision box, so a model at
the wrong proportion is distorted in every frame rather than merely different.

The aspect cannot be known without the geometry, so `--fetch` pulls the GLB for a shortlist and
measures its bounds. Nothing is written into the game by this file.
"""
from __future__ import annotations

import argparse
import json
import re
import struct
import sys
import time
import urllib.request
from pathlib import Path

OUT = Path(__file__).resolve().parent / "poly"
UA = {"User-Agent": "Mozilla/5.0 (snail-runner asset survey)"}

# Polite spacing between requests; the host answers 429 well before it answers slowly.
PAUSE = 0.7


def get(url: str, tries: int = 4) -> bytes:
    """One fetch, backing off on 429.

    **The survey walks a page per model and the host rate-limits**, which on the first run killed the
    sweep half way through the terms — so the failure is retried rather than allowed to truncate the
    sample. A truncated survey is worse than a slow one: it looks like "no models exist for this
    animal" and that is a conclusion, not a timeout.
    """
    for attempt in range(tries):
        try:
            request = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(request, timeout=45) as response:
                time.sleep(PAUSE)
                return response.read()
        except urllib.error.HTTPError as error:
            if error.code != 429 or attempt == tries - 1:
                raise
            time.sleep(4.0 * (attempt + 1))
    raise RuntimeError("unreachable")


def search(term: str, limit: int) -> list[str]:
    html = get(f"https://poly.pizza/search/{term}").decode("utf-8", "replace")
    seen: list[str] = []
    for match in re.finditer(r"/m/([A-Za-z0-9_-]{6,})", html):
        if match.group(1) not in seen:
            seen.append(match.group(1))
        if len(seen) >= limit:
            break
    return seen


def details(model_id: str) -> dict | None:
    """Title, author, licence and GLB url for one model."""
    try:
        html = get(f"https://poly.pizza/m/{model_id}").decode("utf-8", "replace")
    except Exception as error:  # noqa: BLE001 - a dead id is a skip, not a failure
        return {"id": model_id, "error": type(error).__name__}

    glb = re.search(r"https://static\.poly\.pizza/[A-Za-z0-9-]+\.glb", html)
    title = re.search(r"<title>([^<]*)</title>", html)
    # Poly Pizza states one of these three; CC0 is the only one this project can take without
    # owing a credit line.
    licence = "CC0" if re.search(r"\bCC0\b", html) else ("CC-BY" if re.search(r"CC-?BY", html) else "?")

    return {
        "id": model_id,
        "title": (title.group(1) if title else "").split(" - ")[0].strip(),
        "licence": licence,
        "glb": glb.group(0) if glb else "",
    }


def glb_bounds(data: bytes) -> tuple[float, float, float] | None:
    """The model's own extent, straight out of the GLB's accessor min/max.

    **No mesh parsing needed to answer the only question that matters at this stage.** Every glTF
    POSITION accessor is required to carry `min` and `max`, so the bounding box is metadata — which
    is enough to say whether a model can fill a 4.67:1 box before anything is downloaded twice.
    """
    if data[:4] != b"glTF":
        return None
    _, _, length = struct.unpack("<III", data[:12])
    offset = 12
    while offset < length:
        chunk_len, chunk_type = struct.unpack("<II", data[offset : offset + 8])
        if chunk_type == 0x4E4F534A:  # 'JSON'
            gltf = json.loads(data[offset + 8 : offset + 8 + chunk_len].decode("utf-8", "replace"))
            lo = [float("inf")] * 3
            hi = [float("-inf")] * 3
            for mesh in gltf.get("meshes", []):
                for primitive in mesh.get("primitives", []):
                    index = primitive.get("attributes", {}).get("POSITION")
                    if index is None:
                        continue
                    accessor = gltf["accessors"][index]
                    if "min" not in accessor or "max" not in accessor:
                        continue
                    for axis in range(3):
                        lo[axis] = min(lo[axis], accessor["min"][axis])
                        hi[axis] = max(hi[axis], accessor["max"][axis])
            if any(v == float("inf") for v in lo):
                return None
            return (hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2])
        offset += 8 + chunk_len + (-chunk_len % 4)
    return None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("terms", nargs="+")
    ap.add_argument("--limit", type=int, default=10, help="models to inspect per term")
    ap.add_argument("--fetch", action="store_true", help="download the CC0 hits and measure them")
    args = ap.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    for term in args.terms:
        print(f"\n{term}")
        for model_id in search(term, args.limit):
            info = details(model_id)
            if not info or info.get("error"):
                continue
            line = f"  {info['licence']:<6} {info['title'][:38]:<38} {info['id']}"
            if args.fetch and info["licence"] == "CC0" and info["glb"]:
                path = OUT / f"{term}_{info['id']}.glb"
                try:
                    data = get(info["glb"])
                    path.write_bytes(data)
                    size = glb_bounds(data)
                    if size:
                        # Width over height, which is what a collision box is stated in.
                        line += "  %5dKB  %.2f:1 (w %.2f h %.2f d %.2f)" % (
                            len(data) // 1024,
                            size[0] / max(1e-6, size[1]),
                            *size,
                        )
                    else:
                        line += "  %5dKB  (no bounds)" % (len(data) // 1024)
                except Exception as error:  # noqa: BLE001
                    line += f"  download failed: {type(error).__name__}"
            print(line)


if __name__ == "__main__":
    main()
