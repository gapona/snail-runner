"""
critter-alpha-sheet.py  Every critter body over MAGENTA, and what its interior alpha measures.

  py -3.11 scripts/critter-alpha-sheet.py

⚠ The background is the whole point. `flyers-assembled.png` draws the set on mid grey, which is
right for judging placement and tone -- and mid grey CANNOT show a hole where dark paint belongs,
because a hole and the paint read the same. The contour rebuild shipped the bee with its black
abdomen bands deleted (20% of the drawing) and every grey sheet of that round looked correct.

Magenta is in no critter's palette, so anything magenta is missing. The numbers beside it say the
same thing without a person: partial alpha anywhere in the INTERIOR is a sprite the road will show
through.
"""

import numpy as np
from pathlib import Path
from PIL import Image
from scipy import ndimage
d = Path("public/assets/critter")
qa = Path("dev-assets/critter/qa")
ims = []
for k in ("bee-0", "hornet-0", "mosquito-0", "frog-0"):
    im = Image.open(d / f"critter-{k}.png").convert("RGBA")
    a = np.asarray(im)[..., 3]
    inner = ndimage.binary_erosion(a > 8, np.ones((3, 3)), iterations=4)
    partial = inner & (a < 250)
    print(f"{k:<12} interior px {inner.sum():6d}  partial-alpha interior {partial.sum():6d} "
          f"({partial.sum()/max(1,inner.sum()):.3f})  min {a[inner].min() if inner.any() else 0:3d}")
    ims.append(im)
W = sum(i.width for i in ims) + 50
H = max(i.height for i in ims) + 20
sheet = Image.new("RGB", (W, H), (200, 0, 200))
x = 10
for i in ims:
    sheet.paste(i, (x, 10), i); x += i.width + 10
sheet.save(qa / "bodies-on-magenta.png")
print("->", qa / "bodies-on-magenta.png")
