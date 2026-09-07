"""
render-hop-clip.py  The frog's hop, as an animated GIF, for judging.

  node --import ./scripts/register-ts-loader.mjs scripts/dump-hop.mjs > dev-assets/critter/qa/hop.json
  py -3.11 scripts/render-hop-clip.py

Four panels in one clip: near and mid distance, each at real time and at a
quarter speed.

-- It composites the game's own pose table, it does not reimplement it -------

`dump-hop.mjs` runs `run/critterJump.ts` under the TS loader and prints the
pose for 120 points of one cycle. This file only places the shipped PNG at
those poses. That split matters: a renderer that re-derived the arc would be
evidence about ITS arc, and this project has the finding already -- the first
sightline harness reimplemented the sprite path without its scaling step and
every number it produced was true of a world the game does not have.

-- What the two distances are, and why the ratio is the honest part ---------

Both axes of a billboard scale by the same projected factor, so a distance is
one number: pixels per world unit. Near is the frog at roughly its closest
approach on a 1080p frame; mid is the distance a player actually DECIDES at.
The arc's height and the deformation are multiplied by that same factor, which
is what makes this a faithful preview of the projection rather than a drawing
of one -- there is no second constant to get wrong.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
QA = ROOT / "dev-assets" / "critter" / "qa"
SPRITE = ROOT / "public" / "assets" / "critter" / "critter-frog-0.png"
AIR_SPRITE = ROOT / "public" / "assets" / "critter" / "critter-frog-air.png"

# Pixels per world unit at each distance. Near is close to 1:1 with the
# delivered sprite; mid is where the player reads the road.
# ⚠ Measured, not guessed. The beetle is 60% of the drivable road and 1601 world units wide, so
# the road is ~2668 units across; at the player's row it spans ~1612 px on a 1920 frame, i.e.
# 0.60 px per world unit at closest approach. Mid is the distance a row is actually read at.
# The first version used 0.86 and drew a frog 572 px wide into a 430 px panel -- the filmstrip
# came back cropped, which is the whole reason the panel is now sized FROM this number.
SCALES = {"near": 0.60, "mid": 0.20}
SLOWDOWN = {"real time": 1, "quarter speed": 4}

# A flagstone road under a warm sky -- the palette a run is actually met on, so
# the contour is judged against what it has to hold up against rather than
# against a neutral card.
ROAD = (196, 178, 152)
SKY = (150, 196, 224)
# Sized from the widest frog the clip draws plus room for the arc above it, so nothing can be
# clipped by a panel that was picked before the content was known.
PANEL_W, PANEL_H = 470, 300
HORIZON = 96
FPS = 30


def panel_background() -> Image.Image:
    img = Image.new("RGB", (PANEL_W, PANEL_H), SKY)
    a = np.asarray(img).astype(float)
    for y in range(HORIZON, PANEL_H):
        t = (y - HORIZON) / (PANEL_H - HORIZON)
        a[y, :] = np.array(ROAD) * (0.82 + 0.18 * t)
    return Image.fromarray(a.astype(np.uint8), "RGB")


def main() -> None:
    table = json.loads((QA / "hop.json").read_text(encoding="utf-8"))
    frames_in = table["frames"]
    cycle_ms = table["cycleMs"]
    sprite = Image.open(SPRITE).convert("RGBA")
    air_sprite = Image.open(AIR_SPRITE).convert("RGBA")
    world_h = table["groundHeight"]
    world_w = table["groundWidth"]
    air = table["air"]

    bg = panel_background()
    ground_y = PANEL_H - 40

    cells = [(d, s) for d in SCALES for s in SLOWDOWN]
    cols, rows = 2, 2
    W, H = PANEL_W * cols, PANEL_H * rows

    # One clip long enough to show the slowest panel's full cycle, so every
    # panel loops cleanly inside it rather than being cut mid-hop.
    longest = cycle_ms * max(SLOWDOWN.values())
    n = int(round(longest / 1000 * FPS))
    out = []
    for i in range(n):
        sheet = Image.new("RGB", (W, H), (18, 20, 26))
        for k, (dist, speed_name) in enumerate(cells):
            cx, cy = (k % cols) * PANEL_W, (k // cols) * PANEL_H
            sheet.paste(bg, (cx, cy))
            ppu = SCALES[dist]
            t_ms = (i / FPS) * 1000 / SLOWDOWN[speed_name]
            f = frames_in[int((t_ms / cycle_ms) * len(frames_in)) % len(frames_in)]

            # The pose, the box and the base all come from the table -- the game's own
            # `hopPose` and `tuckOffset` decided them, this only places the result.
            src = air_sprite if f["tucked"] else sprite
            bw = air["width"] if f["tucked"] else world_w
            bh = air["height"] if f["tucked"] else world_h
            dw = max(1, int(round(bw * ppu * f["sx"])))
            dh = max(1, int(round(bh * ppu * f["sy"])))
            frog = src.resize((dw, dh), Image.LANCZOS)
            x = cx + PANEL_W // 2 - dw // 2
            y = cy + ground_y - dh - int(round(f["base"] * ppu))
            sheet.paste(frog, (x, y), frog)
        out.append(sheet)

    path = QA / "frog-hop.gif"
    out[0].save(
        path,
        save_all=True,
        append_images=out[1:],
        duration=int(1000 / FPS),
        loop=0,
        optimize=True,
    )
    print(f"{len(out)} frames -> {path}")
    print("panels:", ", ".join(f"{d} / {s}" for d, s in cells))
    print(f"frog drawn {int(world_w * SCALES['near'])}x{int(world_h * SCALES['near'])} near, "
          f"{int(world_w * SCALES['mid'])}x{int(world_h * SCALES['mid'])} mid")


if __name__ == "__main__":
    main()
