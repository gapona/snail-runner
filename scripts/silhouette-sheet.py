"""
silhouette-sheet.py  Can the critters be told apart at the size they are met?

  py -3.11 scripts/silhouette-sheet.py

Every kind at 32 px and 30% desaturated -- the size and the state the distance haze leaves a
critter in -- plus the pickups, because a creature that reads as a thing you want to pick up is a
worse failure than two creatures that read as each other.

-- Why the test is the SILHOUETTE and not the colour ---------------------------------------------

Colour is the second cue and it is the one this game spends elsewhere. Everything on the road is
desaturated as it recedes, and the palette's one rule is that saturation means "come and get it" --
the pickups are allowed to be loud and a critter is deliberately not. So if two things are separable
only by hue, they are not separable at the moment the decision is taken.

The measure is the one the pickup set is already held to: two shapes rasterised into the same box,
letterboxed so the ASPECT counts rather than being normalised away, scored on how much of their
combined silhouette they share.

-- ⚠ A flyer is ASSEMBLED before it is measured --------------------------------------------------

Its shipped sprite is a body; what the player sees is a body with two wings, and the wings are most
of its width. Measuring the body alone would compare three narrow ovals and conclude they are
indistinguishable, which is true of a picture the game never draws. The assembly here uses the same
numbers `CritterSprites` places them with, read from `dev-assets/critter/critter-art.json`.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
QA = ROOT / "dev-assets" / "critter" / "qa"
ASSETS = ROOT / "public" / "assets"
MANIFEST = ROOT / "dev-assets" / "critter" / "critter-art.json"

SIZE = 32
DESATURATE = 0.30
# The wing at rest. A beat moves it +/- WING_SWEEP_DEG; rest is the pose it spends most of its time
# nearest and the one a still sheet should show.
CRITTERS = ["frog", "bee", "hornet", "mosquito"]
PICKUPS = [
    "pickup/pickup-coin.png",
    "pickup/pickup-shield.png",
    "pickup/pickup-fruit-grapes.png",
    "pickup/pickup-fruit-banana.png",
]


def assemble(kind: str, manifest: dict, with_body_box: bool = False):
    """One critter as the game draws it: a body, and for a flyer two mirrored wings behind it.

    Placed with the same numbers `CritterSprites` uses, so the sheet is a preview of the game rather
    than a second opinion about it.

    ── ⚠ The wing is hung on the BODY, not laid into a reconstructed box ──────────────────────────

    The previous rule placed the wing's tip at a fraction of the assembled world box, and rebuilt
    that box from the body's height. It cannot be rebuilt: the material and the reference are not
    the same drawing of the same insect, and the mosquito's differ by two to one in how wide a body
    is against its own height. So the box came out with our body across a quarter of it where the
    reference's covers an eighth, and the wings -- placed at absolute fractions of that box -- sat
    in clear air beside the thorax.

    What the wing is actually attached to is the body, so that is what it is placed against: the
    hinge goes on the body's own drawn silhouette at the hinge's height (`hingeInBody`, measured on
    the shipped sprite by `normalize-flyer.py`), and the canvas is whatever the result needs.
    """
    body = Image.open(ASSETS / "critter" / f"critter-{kind}-0.png").convert("RGBA")
    spec = manifest.get(kind, {}).get("wing")
    wing_path = ASSETS / "critter" / f"critter-{kind}-wing.png"
    if not spec or not wing_path.exists() or "hingeInBody" not in spec:
        return (body, (0, 0, body.width, body.height)) if with_body_box else body

    # Size from the MATERIAL -- body and wing are one drawing at one scale, so this is exact and
    # needs nothing from the reference.
    ww = body.width * spec["wingOverBody"]
    wh = ww / spec["wingAspect"]
    wing = Image.open(wing_path).convert("RGBA").resize(
        (max(1, int(round(ww))), max(1, int(round(wh)))), Image.LANCZOS
    )
    px, py = spec["pivot"]
    rest = spec["restRotation"]
    hx_frac, hy_frac = spec["hingeInBody"]

    # Room for a wing on either side, at any angle, before cropping back to what was drawn.
    pad = int(round(ww + wh))
    canvas = Image.new("RGBA", (body.width + pad * 2, body.height + pad * 2), (0, 0, 0, 0))
    bx, by = pad, pad

    for right in (True, False):
        hinge_x = bx + (hx_frac if right else 1 - hx_frac) * body.width
        hinge_y = by + hy_frac * body.height

        w = wing if right else wing.transpose(Image.FLIP_LEFT_RIGHT)
        # Pillow rotates anticlockwise and screen y runs down, so the sign flips.
        rot = w.rotate(-rest if right else rest, resample=Image.BICUBIC, expand=True)
        # Where the pivot ended up inside the expanded, rotated sprite.
        hx = (px if right else 1 - px) * w.width
        hy = py * w.height
        cx, cy = w.width / 2, w.height / 2
        a = np.deg2rad(-rest if right else rest)
        rx = (hx - cx) * np.cos(a) + (hy - cy) * np.sin(a) + rot.width / 2
        ry = -(hx - cx) * np.sin(a) + (hy - cy) * np.cos(a) + rot.height / 2
        canvas.alpha_composite(rot, (int(round(hinge_x - rx)), int(round(hinge_y - ry))))

    canvas.alpha_composite(body, (bx, by))
    box = canvas.getbbox()
    out = canvas.crop(box)
    if with_body_box:
        # Where the body sits inside what was actually drawn. The world box is the ASSEMBLY, so
        # everything the engine needs about the body is a fraction of this rather than of a box
        # rebuilt from the reference -- which is the rebuild that put the wings in clear air.
        return out, (bx - box[0], by - box[1], body.width, body.height)
    return out


def letterboxed(im: Image.Image, size: int = SIZE) -> np.ndarray:
    a = np.asarray(im)[..., 3]
    ys, xs = np.nonzero(a > 16)
    im = im.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))
    scale = size / max(im.width, im.height)
    im = im.resize(
        (max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.LANCZOS
    )
    box = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    box.paste(im, ((size - im.width) // 2, (size - im.height) // 2), im)
    return np.asarray(box)[..., 3] > 96


def overlap(a: np.ndarray, b: np.ndarray) -> float:
    union = (a | b).sum()
    return float((a & b).sum() / union) if union else 0.0


def desaturated(im: Image.Image, amount: float) -> Image.Image:
    a = np.asarray(im).astype(float)
    grey = (0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2])[..., None]
    a[..., :3] = a[..., :3] * (1 - amount) + grey * amount
    return Image.fromarray(a.astype(np.uint8), "RGBA")


def main() -> None:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8")) if MANIFEST.exists() else {}
    images = {k: assemble(k, manifest) for k in CRITTERS}
    for p in PICKUPS:
        images[Path(p).stem.replace("pickup-", "")] = Image.open(ASSETS / p).convert("RGBA")

    masks = {k: letterboxed(v) for k, v in images.items()}
    names = list(images)

    print(f"silhouette overlap at {SIZE}px, {int(DESATURATE * 100)}% desaturated (1.00 = one shape)")
    print("    (a flyer is measured ASSEMBLED -- body plus both wings -- because that is what is drawn)\n")

    flyers = [k for k in CRITTERS if manifest.get(k, {}).get("wing")]
    worst = (0.0, "")
    for i, a in enumerate(names):
        for b in names[i + 1 :]:
            v = overlap(masks[a], masks[b])
            tag = ""
            if a in flyers and b in flyers:
                tag = "   <- both fly, same band"
            if v > worst[0]:
                worst = (v, f"{a} / {b}")
            if v > 0.55 or tag:
                print(f"  {a:<10} vs {b:<14} {v:.3f}{tag}")

    print(f"\nworst pair overall: {worst[1]} at {worst[0]:.3f}")

    # -- Do the thin legs survive? -----------------------------------------
    #
    # The mosquito is drawn with six long hairline legs. At 32px a hairline is a fraction of a pixel
    # wide, and what would be left is a stick -- so this measures how much of the silhouette they
    # still account for rather than trusting that they are there.
    print("\nthin structure at 32px:")
    for k in CRITTERS:
        full = np.asarray(images[k])[..., 3] > 16
        small = masks[k]
        # Ink share against the shape's own bounding box: legs are what makes a silhouette sparse,
        # so a large fall means they have merged or vanished.
        full_fill = full.sum() / full.size
        small_fill = small.sum() / (SIZE * SIZE)
        print(
            f"  {k:<10} fill {full_fill * 100:5.1f}% at full size -> {small_fill * 100:5.1f}% at 32px"
            f"   ({small_fill / full_fill:.2f}x)"
        )

    # -- The sheet ---------------------------------------------------------
    scale, pad = 5, 10
    cell = SIZE * scale
    sheet = Image.new("RGB", (len(names) * (cell + pad) + pad, cell + pad * 2), (128, 128, 128))
    x = pad
    for n in names:
        im = images[n]
        a = np.asarray(im)[..., 3]
        ys, xs = np.nonzero(a > 16)
        c = im.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))
        s = SIZE / max(c.width, c.height)
        c = c.resize((max(1, round(c.width * s)), max(1, round(c.height * s))), Image.LANCZOS)
        box = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
        box.paste(c, ((SIZE - c.width) // 2, (SIZE - c.height) // 2), c)
        box = desaturated(box, DESATURATE).resize((cell, cell), Image.NEAREST)
        sheet.paste(box, (x, pad), box)
        x += cell + pad
    QA.mkdir(parents=True, exist_ok=True)
    sheet.save(QA / "silhouettes-32.png")
    print(f"\nsheet -> {QA / 'silhouettes-32.png'}  ({SIZE}px, shown {scale}x)")


if __name__ == "__main__":
    main()
