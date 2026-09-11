"""
Packs the world sprites into one power-of-two atlas: `public/assets/atlas/world.png` + `world.json`.

**Why an atlas at all.** Phaser 4's quad batch holds 16 textures; the run draws from about forty
distinct ones (fifty decor props, eight critter drawings, five obstacles, seven pickups) interleaved
by depth, so the batch flushed on texture overflow about a dozen times a frame -- each flush a draw
call the phone's GL driver validates. One sheet is one texture unit for the whole world pass. And a
power-of-two sheet is the only thing Phaser 4 will generate mipmaps for (`WebGLTextureWrapper` gates
`generateMipmap` on `IsSizePowerOfTwo`), which every trimmed NPOT sprite here forfeited.

**The sources stay where they are.** `build-sprites.py` writes `public/assets/{decor,obstacle,
critter,pickup}`, and `verify:mattes`, `verify:critters`, `verify:skins` and `verify:palettes` all
read those files; this script reads them too and writes one derived artefact beside them. The
production build drops the source folders from `dist/` (see `vite.config.ts`), so the bundle
carries the sheet once, not the sheet and its sources. `verify:atlas` holds the two in step by
hashing the sources into `meta`, so an edited sprite that was not re-packed fails the build.

**Frame names are the texture keys the game already uses** (`decor-<file>`, `obstacle-low-0`,
`critter-bee-0`, `pickup-coin`, ...), so the runtime seam is one lookup: `src/art/atlas.ts`.

Run by hand after `build-sprites.py`; the output is committed, so `npm run build` needs no Python.
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
from dataclasses import dataclass

from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), '..', 'public', 'assets')
OUT_DIR = os.path.join(ROOT, 'atlas')
# `key prefix -> folder`. The prefix is what the game's own texture keys carry; decor keys are
# `decor-<file>` while the other three are the file stem itself (see Preloader's old load loops).
FOLDERS = {'decor': 'decor-', 'obstacle': '', 'critter': '', 'pickup': ''}
# Transparent pixels between frames. Trimmed sprites end on a mostly-transparent row, so what a
# mipmap averages in from a neighbour at deep levels is transparent black -- premultiplied, that
# is nothing -- and 8px keeps level 3 (8x minification) clean even where it is not.
PADDING = 8
# Power-of-two sheets in order of area. Non-square is fine: the mipmap gate is per side.
SHEETS = [(2048, 2048), (2048, 4096), (4096, 2048), (4096, 4096)]


@dataclass
class Item:
    key: str
    file: str
    image: Image.Image
    sha1: str


def load_items() -> list[Item]:
    items: list[Item] = []
    for folder, prefix in FOLDERS.items():
        directory = os.path.join(ROOT, folder)
        for name in sorted(os.listdir(directory)):
            if not name.endswith('.png'):
                continue
            path = os.path.join(directory, name)
            with open(path, 'rb') as f:
                data = f.read()
            image = Image.open(path).convert('RGBA')
            items.append(Item(prefix + name[:-4], f'{folder}/{name}', image, hashlib.sha1(data).hexdigest()))
    return items


def pack(items: list[Item], width: int, height: int) -> dict[str, tuple[int, int]] | None:
    """Skyline bottom-left. Tallest first, each placed at the lowest gap that fits, leftmost on ties."""
    order = sorted(items, key=lambda it: (-it.image.height, -it.image.width, it.key))
    skyline = [(0, 0, width)]  # (x, y, w) spans, left to right, covering the whole width
    placed: dict[str, tuple[int, int]] = {}

    for item in order:
        w = item.image.width + PADDING
        h = item.image.height + PADDING
        best = None
        for i, (sx, sy, _) in enumerate(skyline):
            if sx + w > width:
                break
            # The rectangle rests on the highest span it covers.
            y = sy
            span_right = sx
            j = i
            while span_right < sx + w:
                y = max(y, skyline[j][1])
                span_right = skyline[j][0] + skyline[j][2]
                j += 1
            if y + h > height:
                continue
            if best is None or (y, sx) < (best[0], best[1]):
                best = (y, sx, i)
        if best is None:
            return None
        y, x, _ = best
        placed[item.key] = (x, y)
        # Rebuild the skyline with the new roof.
        new: list[tuple[int, int, int]] = []
        for sx, sy, sw in skyline:
            right = sx + sw
            if right <= x or sx >= x + w:
                new.append((sx, sy, sw))
                continue
            if sx < x:
                new.append((sx, sy, x - sx))
            if right > x + w:
                new.append((x + w, sy, right - (x + w)))
        new.append((x, y + h, w))
        new.sort()
        # Merge equal-height neighbours.
        merged: list[tuple[int, int, int]] = []
        for span in new:
            if merged and merged[-1][1] == span[1] and merged[-1][0] + merged[-1][2] == span[0]:
                merged[-1] = (merged[-1][0], merged[-1][1], merged[-1][2] + span[2])
            else:
                merged.append(span)
        skyline = merged
    return placed


def main() -> int:
    items = load_items()
    area = sum(it.image.width * it.image.height for it in items)
    for width, height in SHEETS:
        placed = pack(items, width, height)
        if placed:
            break
    else:
        print(f'build-atlas: {len(items)} sprites ({area / 1e6:.2f} Mpx) fit no sheet up to 4096x4096')
        return 1

    sheet = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    frames = {}
    sources = {}
    for item in items:
        x, y = placed[item.key]
        sheet.paste(item.image, (x, y))
        w, h = item.image.size
        frames[item.key] = {
            'frame': {'x': x, 'y': y, 'w': w, 'h': h},
            'rotated': False,
            'trimmed': False,
            'spriteSourceSize': {'x': 0, 'y': 0, 'w': w, 'h': h},
            'sourceSize': {'w': w, 'h': h},
        }
        sources[item.key] = {'file': item.file, 'sha1': item.sha1}

    os.makedirs(OUT_DIR, exist_ok=True)
    png_path = os.path.join(OUT_DIR, 'world.png')
    sheet.save(png_path, optimize=True)
    manifest = {
        'frames': frames,
        'meta': {
            'app': 'scripts/build-atlas.py',
            'image': 'world.png',
            'size': {'w': width, 'h': height},
            'scale': '1',
            'padding': PADDING,
            'sources': sources,
        },
    }
    with open(os.path.join(OUT_DIR, 'world.json'), 'w', encoding='utf8') as f:
        json.dump(manifest, f, indent=1, sort_keys=True)
        f.write('\n')

    used = area / (width * height)
    print(
        f'build-atlas: {len(items)} sprites, {area / 1e6:.2f} Mpx, sheet {width}x{height} '
        f'({used:.0%} filled), {os.path.getsize(png_path) / 1024:.0f}KB'
    )
    return 0


if __name__ == '__main__':
    sys.exit(main())
