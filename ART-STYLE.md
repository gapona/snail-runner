# ART-STYLE.md — the interface, in numbers

The button language the game's UI is being brought to. Every number here is
either **measured** off the two reference sheets in `references/` or
**derived** from a delivery constraint that is stated where it appears.

Re-derive the measured half at any time:

```
py -3.11 scripts/measure-ui-refs.py
```

That script asserts nothing — the references are evidence, not a build
artefact. What is held to a threshold is *our own output*, by
`scripts/normalize-ui.py`, which reads its targets from this document's table
(`scripts/ui_style.py` is the machine-readable copy, and it is the one the code
imports; this file is the argument).

---

## The button is five horizontal layers

```
  ink     the dark contour — equal thickness on all four sides, and on the
          seam between face and cheek
  band    a narrow light strip along the top of the face
  face    flat: one colour, no gradient, no gloss, no highlight
  cheek   a deeper tone of the same hue along the bottom.
          This is the whole of the object's volume.
  ink     the contour again
```

Nothing else. No inner recessed panel, no outer glow, no bevel.

**The outer light rim is not in this list and is not in the sprite.** The
references carry one and the engine draws it — see "What the engine draws"
below.

---

## The numbers

Quoted as a fraction of the **button's** height, which is the unit the whole
set shares: a panel and a progress bar are the same material at the same
thickness, so their contour and their lip are the button's in *pixels*, not
re-derived from their own heights. A lip that grew with the object would make a
tall panel look like a slab on a plinth.

| | spec | at native `h = 64` | measured on the references |
|---|---|---|---|
| contour `ink` | **0.031** | 2 px | 0.027 (median 1.25 px on 46 px) |
| top band | **0.094** ≈ 1/10 | 6 px | 0.10 – 0.14 |
| bottom cheek | **0.203** ≈ 1/5 | 13 px | 0.09 – 0.11 |
| corner radius | **0.297** | 19 px | median 0.322, range 0.26 – 0.48 |
| face luma spread | **0** (flat) | 0 | median 18.3 of 255, i.e. a gradient |
| contour on the face/cheek seam | **= `ink`** | 2 px | **0 on 23 of 23** |
| same radius on four corners | **yes** | — | spread median 2.3 px |

Tone, as a ratio to the face's own luma — a ratio rather than a colour,
because that is the form that can be applied to a colour nobody has seen yet
(the primary button takes its accent from the active theme):

| | spec | measured |
|---|---|---|
| band ÷ face | **1.25** | 1.14 – 1.43 |
| cheek ÷ face | **0.60** | 0.44 – 0.67 |
| ink ÷ face | **0.06** | 0.02 – 0.11 |

**The contour is not neutral black — it carries the hue.** Measured on four
reference buttons: `(20,7,0)` under orange, `(0,0,7)` under cyan, `(44,0,60)`
under purple, `(34,70,28)` under green. That also keeps the set inside this
project's standing rule that ink is never pure black (`verify:mattes`'s
border-flood check, and the finding that a hard black outline against the alpha
boundary bleeds black into every mipmap level).

---

## ⚠ Three places the spec departs from the references, and why

The brief states this style as flat, with a 1/10 band, a 1/5 cheek and an even
contour including the face/cheek seam. Measured, the references do not do three
of those. The spec wins in each case, and none of the three is a matter of
taste:

**1. The face is flat here and carries a ~15% gradient there.** This one is
forced by the delivery format. The buttons are drawn as a **nine-slice**, so
the middle band of the sprite is *stretched* to whatever height the layout
asks for. A vertical gradient stretched that way is no longer a gradient — it
is a flat stripe with a hard edge at each slice boundary, and the taller the
button the more obvious. The references are a mockup drawn once at one size and
never stretched; ours have to survive 320 px to 1200 px. A flat face is the
only face that stretches.

**2. The cheek is 1/5 here and ~1/10 there.** Consequence of (1). In the
references the volume is carried by *two* things — the face gradient falling
about 15% from top to bottom, and then the cheek. Take the gradient away and
the cheek is the only thing left carrying it, so it has to be deeper. 1/5 is
that translation.

**3. There is a contour on the face/cheek seam here and none there.** Also a
consequence of (1). Two flat areas of the same hue meeting along a straight
line read as a compression artefact or a seam in the texture; the references
avoid it by arriving at the cheek through a gradient, which we no longer have.
Drawing the contour there says the boundary is deliberate, and it makes the
cheek read as a separate facet of one object rather than as a stripe painted on
it.

Two further reference measurements are simply **noise the spec removes**: the
contour is not the same thickness on all four sides (spread median 2 px on a
46 px button) and the four corners are not the same radius (spread median
2.3 px). Both are what hand-drawing or generating a mockup produces; neither is
a design decision, and the normalizer is what makes them one value.

---

## Native geometry, and where the numbers come from

```
NATIVE_HEIGHT   64      the unit every fraction above is quoted in
INK              2      0.031 · 64
BAND             6      0.094 · 64
CHEEK           13      0.203 · 64
RADIUS          19      0.297 · 64
CHEEK_PRESSED    3      the lip when pressed — see "Two states"
```

**The radius is 19 and not the references' 0.32 × 64 ≈ 21, and the reason is
the touch floor.** A nine-slice's corner patches are never stretched, so the
smallest height a sprite can be drawn at without them overlapping is
`2 × (RADIUS + INK) + 1`. At radius 21 that is 45 px, and the kit's minimum
touch target is **44** (`MIN_TOUCH`) — so the one size the interface is
guaranteed to ask for is the one size the sprite could not be drawn at. At 19
it is 43 px, one under the floor. `normalize-ui.py` asserts this rather than
leaving it to be rediscovered:

```
2 * (RADIUS + INK) < MIN_TOUCH
```

Nine-slice insets are therefore **21 px on all four sides**
(`RADIUS + INK`), which also contains the band (`INK + BAND` = 8) and the
cheek (`CHEEK + INK` = 15). Both have to sit inside a fixed slice or they
would stretch with the middle.

| sprite | native | sliced |
|---|---|---|
| wide button, resting | 192 × 64 | yes, 21 all round |
| wide button, pressed | 192 × 54 | yes, 21 all round |
| dialog panel | 256 × 192 | yes, 21 all round |
| progress frame | 256 × 40 | yes, horizontally |
| progress fill | 256 × 40 | yes, horizontally |
| round icon button | 96 × 96 | **no** — scaled whole |

The round button is not sliced because a circle has no straight middle to
stretch; it is drawn at a uniform scale, which is also why it is authored
larger than it is ever drawn.

---

## Two states, and why the pressed one is a second sprite

`resting` and `pressed`. The brief's rule — that pressed is **rendered**, not
produced by darkening the resting sprite in the engine — is not a stylistic
preference. Three things happen when a flat button of this kind is pressed and
only one of them is a colour:

- the cheek collapses (13 px → 3 px), i.e. the object loses its thickness;
- the whole shape therefore sits **10 px lower**, its bottom edge unmoved;
- and the face loses a little light (× 0.94).

A tint reaches the third and neither of the first two. What the *engine* does
is position it: the pressed sprite is 10 px shorter and is drawn with its
bottom edge where the resting sprite's was, so the button visibly sinks onto
its own lip. That is a position, not a repaint, and the label moves with it.

**The label is centred on the face, not on the sprite.** The face is the top
`h − CHEEK` of a resting button, so a label centred in the whole box sits low
by `CHEEK / 2`. Resting label offset is `−CHEEK/2`; pressed it is
`+CHEEK_PRESSED/2` in the shorter box, i.e. it moves down by exactly the sink.

---

## The palette, and how a colour becomes a button

A button is authored **once per shape as a greyscale master** and coloured by
the engine. Six sprites per colour would be six things to keep in step, and
more to the point it is not possible: the primary button's accent comes from
the **active theme** and must clear `ACCENT_MIN_SKY_CONTRAST` against that
theme's sky — a rule this project already states and which is not repealed
here — so a baked primary would have to be baked seven times and re-baked
whenever a theme is repainted.

So one colour in, four out, using the ratios in the table above:

```
face   = the colour
band   = face lifted to 1.25 × its luma
cheek  = face dropped to 0.60 × its luma
ink    = face dropped to 0.06 × its luma, hue kept
```

Applied in OKLab lightness rather than by scaling RGB, for the reason
`paletteColour.ts` already records: scaling RGB toward black desaturates on the
way and a "deeper tone of the same hue" is exactly what must not happen to the
hue. The baked result is cached per `(shape, state, colour)` — the same
arrangement, and the same one-off cost, as the mascot's five skins.

| class | colour |
|---|---|
| primary | the active theme's accent (`themeAccent()`) |
| secondary | `KIT.rim` — the interface neutral |
| confirm | `KIT.confirm` |
| disabled | `KIT.disabled`, and it does not take a pressed state |
| panel | `KIT.plate` |
| progress fill | `KIT.coin` |

---

## What the engine draws, and what it must not

**The outer light rim is a stroke, not pixels.** It is the thinnest feature on
the object, it is the first thing a denoiser smears, and it is the one part of
this language that has to be *perfectly* even to read as intentional. The
engine knows the button's exact box and radius, so it strokes a rounded
rectangle under the sprite and lets the sprite's own contour cover the inner
half. A generated rim would also put a second light edge immediately next to
the top band, which is the one feature the band has to be distinguishable from.

**Every label is set by the engine.** Nothing generated carries a glyph. A
baked label cannot be translated, cannot be re-fitted when the button narrows,
and cannot be removed.

---

## How the set is produced

Generated, then normalised — never hand-finished in an editor, because a hand
correction is one that cannot be re-applied when a sprite is re-rendered.

```
Remotion/src/scripts/snail_ui_prompts.py   the prompts — one template, and the
                                           colour word is the only thing that
                                           moves between them
Remotion/src/scripts/gen_snail_ui.py       renders them to dev-assets/ui/raw/
scripts/normalize-ui.py                    brings the set to the table above,
                                           and fails if it cannot
```

`normalize-ui.py` is where "one number means one thing across the set" is
enforced: it brings the contour to one thickness, the cheek to one fraction,
the radius to one value, computes the nine-slice insets from a single inset
rule rather than by eye, floors the alpha so `verify:mattes` passes, and
**exits non-zero if the spread of contour thickness or cheek height across the
set is past its threshold**.

Provenance for everything generated is recorded in `ART-SOURCES.md`. Output of
an external model is **not** CC0 and is not "no third-party input"; it is
recorded as what it is.

---

# Creatures: the contour every enemy is brought to

The button language above is interface. This section is the **road**, and it
exists because the bestiary is now taking supplied art rather than only
generated art, and supplied art arrives with whatever contour the tool that
made it happened to draw.

```
py -3.11 scripts/normalize-critter.py --slot frog --src "references/frog 1.jpg" --world-height 343
py -3.11 scripts/normalize-critter.py --slot frog --src ... --measure     (report only)
```

## The number

```
INK_FRACTION = 0.0141   of the sprite's own sqrt(width * height)
```

**A fraction of the geometric mean, not of the width**, which is this project's
standing rule for ink weight and was paid for twice: a width-derived outline put
a 5.6 px ring on a 56 px-tall rock (a sixth of its height), and the rail
shooter shipped a prop with *no* visible outline because its ink was set in
supersample pixels and survived two downscales. `sqrt(w * h)` tracks the shape's
actual size, so one fraction serves a 4.7:1 beetle and a 1.9:1 frog.

Delivered on the frog: **3.6 px** on a 391 x 202 sprite. Every creature added
after it is brought to this number rather than to its own — a beetle and a bee
normalised to their own contours would be two drawings that never look like one
bestiary.

| frog pose | contour before, source px | after | spread | **delivered** |
|---|---|---|---|---|
| ground (crouch) | 12.4 – 18.0 (median 15.7) | 13.0 – 14.1 | 5.6 → **1.1** | **3.73 px** |
| air (tuck) | 5.4 – 10.3 (median 8.5) | 8.5 – 9.5 | 4.9 → **1.0** | **3.69 px** |

The two delivered contours differ by **0.04 px**, which is the point: they are one animal.

## ⚠ A kind's poses are normalised in ONE pass, and two things have to survive

**The creature's scale.** The supplied drawings are not at the same size — measured
on the frog, the tucked pose is at **0.67** of the crouch's (eye span 288 px
against 431). Normalised separately, each to its own long side, the frog would
change size the instant it left the ground. So one delivery scale is derived
from a landmark that is rigid on the character — the eyes — and every pose is
scaled to put that landmark at the same size. A kind whose eyes are not a
separable colour needs a landmark of its own; there is no general one and
guessing would silently resize the animal.

**The contour, in absolute pixels.** `INK_FRACTION` is a fraction of a sprite's
own geometric mean, which is right for setting a *kind's* line weight and wrong
for a *pose*: a more compact pose has a smaller geometric mean and would get a
thinner line on the same animal. So the fraction is evaluated once on the
reference pose and the resulting pixel count is applied to every pose.

## The anchor a pose swap is aligned on

A grounded pose is placed by its feet. An airborne pose has none on the ground,
so it is placed by an **anchor**, and the normalizer measures two candidates:

| | ground | air | base offset |
|---|---|---|---|
| centroid (centre of mass) | 0.4328 of height | 0.5300 | **78.1 units** |
| eyes (rigid landmark) | 0.8226 | 0.8623 | 86.5 units |

**They disagree by 8.4 units — 2.4% of the creature's height**, i.e. 5 px at the
closest a frog is ever drawn and 1.7 px at the distance one is read. Below the
size at which the choice is visible. The centroid is used.

**⚠ The offset is also WHEN the swap happens, and that is the whole design.**
Place the two poses so their anchors coincide and the tucked sprite's base ends
up 78 units lower, because the tucked frog's feet hang below its body while the
crouched frog's are flat on the ground. Swapping the instant flight begins would
draw the feet 78 units *under the road* for the first fifth of the hop. So the
swap waits until the hop has lifted the creature by exactly that offset: at that
moment the air pose's base is at ground level and its anchor is already where
the ground pose's anchor was.

Measured, at the exact crossing: the swap moves the anchor **0.000 world units**,
the base never goes below 0, and the tuck covers **29% of the hop cycle — 49% of
the flight**, i.e. the top of the arc. `verify:critters` asserts all three.

## How it is equalised, and why it is rebuilt rather than corrected

Eroding the thick parts would leave the thin parts thin. So the artwork inside
the contour is taken as the subject, dilated by the target thickness, and the
resulting ring is repainted as ink:

```
core       = the drawing, with its own contour and the source's halo removed
contour    = dilate(core, T) - core
silhouette = dilate(core, T)
```

The thickness is then T everywhere by construction. Two consequences, both
wanted: the halo cannot survive, because the outer band is repainted rather
than kept; and where the original contour was thicker than T the silhouette
shrinks by the difference, which is exactly the inconsistency being removed.

**⚠ The dilation is a thresholded Euclidean distance, never `binary_dilation`
with an iteration count.** A 4-connected structuring element applied *n* times
grows a **diamond** — *n* along the axes and *n*/√2 on the diagonals — so the
first attempt delivered 14 px across the top of the head and 9.4 px on every
slope. That is the defect this function exists to remove, reintroduced by the
tool used to remove it.

## The three delivery rules a billboard imposes

- **The base is on the bottom row.** `billboardRectInto` treats the sprite's y
  as the point of *contact*, so an empty band under the feet is planted on the
  ground and the creature hovers. Nine of 52 decor sprites shipped with exactly
  that, and the cause was an ordering: the trim ran before the alpha floor, so
  the crop box included rows the floor then cleared. `normalize-critter.py`
  trims **again** after the floor.
- **No upscale.** The scale is `min(TARGET_LONG / content, 1)`.
- **⚠ The world box takes the art's aspect, not the other way round.**
  `CritterSprites` calls `setDisplaySize(rect.w, rect.h)`, i.e. it *stretches*
  the texture onto the box `CRITTER_KINDS` gives it. A sprite whose proportion
  differs from its box is therefore distorted in every frame — the failure
  `obstacle-low-0` shipped at 41% too wide. `fromModel(aspect, height, flying)`
  is the tool: the game picks the height from the rule the kind lives under and
  the art's own aspect decides the width.

**⚠ And the delivered pixel size is a RESOLUTION, not `worldUnits /
SPRITE_SCALE`.** That identity is the *decor* contract, where `RoadSprites`
derives the world size **from** the texture. A critter is the other way round,
so the texture's size only decides how sharp it is. Applying the decor identity
here would deliver the frog at `662/10 x 343/10` = **63 x 34 px** against an
on-screen width near 400 px at closest approach — a six-fold upscale on the one
frame the player is looking at it. The set's own delivery size is **384 px on
the long side**, which is what the six shipped critters already use and what
lands near 1:1 at closest approach on a 1080p frame.
