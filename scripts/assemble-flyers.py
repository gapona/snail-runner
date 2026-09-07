"""
assemble-flyers.py  What a flyer actually looks like once the engine puts its wings on.

  py -3.11 scripts/assemble-flyers.py

A flyer ships as a body and one wing; nothing in `public/assets/critter` is a picture of the thing
the player meets. So every judgement about a flyer -- does the wing sit on the body, is the
silhouette wider than it is tall, has the transparency checker really gone -- has to be taken on an
assembly, and an assembly built from the manifest the ENGINE reads rather than from a second opinion
about where a wing goes. `assemble` is imported from `silhouette-sheet.py` for exactly that reason:
one placement, used by the confusion sheet and by this.

Drawn on mid grey, which is the background this project has settled on for looking at art: it hides
neither dark paint nor a pale plate, and both failures this sheet exists to catch are one or the
other.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
QA = ROOT / "dev-assets" / "critter" / "qa"
MANIFEST = ROOT / "dev-assets" / "critter" / "critter-art.json"
FLYERS = ("bee", "hornet", "mosquito")


def _sheet_module():
    spec = importlib.util.spec_from_file_location(
        "silhouette_sheet", Path(__file__).resolve().parent / "silhouette-sheet.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main() -> int:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    sheet_mod = _sheet_module()

    images = {k: sheet_mod.assemble(k, manifest) for k in FLYERS}

    print(f"{'kind':<10}{'assembled':>14}{'aspect':>9}   reads as")
    for k, im in images.items():
        aspect = im.width / im.height
        print(
            f"{k:<10}{f'{im.width}x{im.height}':>14}{aspect:9.2f}   "
            f"{'go around' if aspect > 1 else 'JUMPABLE -- too tall'}"
        )

    pad = 16
    width = sum(im.width for im in images.values()) + pad * (len(images) + 1)
    height = max(im.height for im in images.values()) + pad * 2
    canvas = Image.new("RGB", (width, height), (128, 128, 128))
    x = pad
    for im in images.values():
        canvas.paste(im, (x, pad + (height - pad * 2 - im.height) // 2), im)
        x += im.width + pad

    QA.mkdir(parents=True, exist_ok=True)
    out = QA / "flyers-assembled.png"
    canvas.save(out)
    print(f"\nsheet -> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
