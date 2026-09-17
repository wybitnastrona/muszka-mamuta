# Body model (authored motion)

**This document is not connectome data.** MaleCNS v1.0 supplies the feeding-circuit
graph, synapse signs, and the two MN9 motor neurons (`bodyId` 10331 and 16949).
Every millimetre of locomotion, every wing pose, every grooming stroke, every
sleep breath and every comedy beat is **authored**. The brain worker still
outputs `ActivityFrame`; the body **reads** MN9 rate (and hemolymph satiety /
crop volume) and **never writes back**.

The only brain-driven decision is the **feeding gate**: gustatory channel
(labellar + pharyngeal, class `gustatory`) → MN9 → `TASTE` wait → `EXTEND`.
When the scene loop is in `EAT_SCOOP`, control is handed to the
existing `SEARCH → … → REST` machine so that pause before the proboscis
extends stays MN9-gated. That pause is the reel shot; the loop does not skip it.

Code: `src/body/sceneDirector.ts`, `sceneLoop.ts`, `flight.ts`, `grooming.ts`,
`gags.ts`, `wings.ts`. Visual apply-only: `src/components/flySceneMount.ts`.

## Phase tempo (authored readability, not measurement)

The HUD phase strip has to be readable on a 1080×1920 reel, so each feeding
phase has an **authored minimum duration** in `src/body/tempo.ts`
(`PHASE_MIN_S`): APPROACH 1.2 s, TASTE 1.0 s, EXTEND 1.1 s, RETRACT 0.8 s.
The floor blocks only *completion* transitions; interrupts still fire on the
next step (bitter contact or satiety > 0.85 out of PUMP, TASTE timeout → SEARCH,
now 3.0 s so the gate has time to open after the longer dwell). REST is
`restDuration = 1.2 + 2.0 · satiety`.

PUMP is **not** slowed: the pharyngeal pump stays at `PUMP_HZ = 6`. POMPUJ is
made longer by pumping more cycles per bout (`pumpCycleCount`: 8–14 cycles
scaling with MN9 drive above threshold, i.e. 1.3–2.3 s), and every cycle is
still one `bite`, so a longer phase sips more scoop powder rather than stretching an
animation. Clip playback (`per`, `retract`) is untouched; non-looping clips
hold their last frame for the rest of the dwell.

The MN9 gate (`MN9_EXTEND_HZ = 8`, `MN9_HOLD_MS = 80`) and `TASTE_MIN_S`
(gate eligibility) are unchanged. None of these seconds are a measurement of
*Drosophila* feeding; the earlier values (PUMP 0.3–0.8 s, REST 0.35–1.8 s)
were just too short to read.

## What Flybody actually has

Group `body` materials: `body`, `black`, `red` (compound eyes), `ocelli`,
`bristle-brown`, `lower`, `brown`, **`membrane`**. There is no `wings`
material. `membrane` is split into `wing_L` / `wing_R` by the X sign of each
connected component’s centroid (+X anatomical left); each wing pivots at the
vertex closest to the thorax.

An `abdomen` bone already exists. Distension is `scale.x = scale.y = 1 + 0.25 * cropVolume`.
The abdomen mesh is not split.

Mid and hind legs have no pivots in Flybody `model.json`. We add four
procedural bones (`midleg_L/R`, `hindleg_L/R`) parented to `root`. Coxae are
the proximal-most vertex of each Z-cluster of `body` vertices with y < −0.02
and |x| > 0.02 (three clusters per side; the anterior pair is the existing
foreleg groups). Skinning uses the same smoothstep falloff as the mouthparts,
with a vertex gate so a sphere around the coxa cannot reach the thorax or
the other legs. Forelegs stay rigid-parented (`front_left` / `front_right`).
In flight the mid/hind bones stay at rest — real *Drosophila* trail those
legs (Card & Dickinson 2008). Landing still rotates the foreleg bones
forward-down over 120 ms.

## Walk (authored M-tripod)

`src/body/gait.ts`. Speed is step **frequency**, not step length (Wosnitza
et al. 2013): swing duration 0.17 s, swing amplitude fixed, stride 0.4 body
lengths, cycle = stride / speed. Two tripods [L1, R2, L3] and [R1, L2, R3];
within a tripod the front leg leads the middle, which leads the hind
(Chun, Biswas & Bhandawat, eLife 2021 — the “modified” part). Stance runs
parallel to the body long axis; swing is a parabola that returns the tarsus
anteriorly. Gait phase is locked to distance travelled so stance feet do not
slide. Steering (Nature 2025, fine-grained descending control): outside
legs lengthen and inside legs shorten by up to 5% of body length, and the
front step direction rotates into the turn, scaled by yaw rate. Feeding
clips still own the mouthparts; gait replaces only the six leg bones.

## Appearance (authored, render-only)

Kitchen: one authored studio. The oak slab, dark grid, plate and
spoon share the director, powder mound, scoop, mill and fly. The spoon is the
`escapeShadow` gag prop. A photographic match-move was tried and abandoned
(`docs/SCENE-COMPOSITE.md`): planar PnP from the A4 sheet landed at 27.3 px
RMS against a 3 px target, so the board floated on the still.

Studio lighting is a 3200 K key, cool fill, rim, ACES exposure 1.1, PCF 2048.
Fog is FogExp2 tinted from the grid floor, density tied to camera–board
distance so the subject never exceeds 25% fog. Compound eyes and the PET film
reflect a blurred equirect of the real kitchen (`env_512.jpg`, intensity 0.5).

Fly materials are `MeshPhysicalMaterial`, tuned to the flat, matte look of
the reel fly rather than lacquer. Cuticle base `#b8722f`, roughness 0.6,
clearcoat 0.12, no sheen, envMap 0.4, with five authored tergite bands and an
abdomen Fresnel that scales with `cropVolume`. Antennae, palps and proboscis
segments (Flybody part `black`) are a dark matte `#2a1a10` with no coat.
Compound eyes (`red`) are one smooth deep-red dome (`#8a1a12`, roughness
0.45, clearcoat 0.2, envMap 0.35) with **no** facet normal map: the eye UV is
spherical about the model origin and spans only 0.067 × 0.204, so a 30-cell
hex map put ~2 × 6 huge cells on each eye, and with clearcoat 1 / roughness
0.15 they read as a mirror ball of red beads (`docs/review/head-before-after.jpg`).
The earlier amber sheen on every part likewise turned the antennae and the
proboscis into polished horns. Wings (`wing_L` / `wing_R`) are transmissive
and iridescent. Bristles use a tip-alpha gradient.
Head counter-rotates 60% against body pitch/roll; antennae keep 2–4° Perlin
and 8° flicks on odor-yaw jumps; standing tarsi sink 0.3 mm with a baked
contact-AO blob. None of this writes `ActivityFrame` or changes contact
sampling.

**Resting proboscis fold (authored).** Flybody ships the mouthparts hanging
as if mid-extension, so PER barely read (the tip moved ~1.2 mm). `restPose()`
now folds rostrum +30° and haustellum +40° (+X folds the chain up/back), every
non-feeding clip inherits it, `per` unfolds from there to the authored
extension and `retract` returns to it. Measured by forward kinematics on the
anchors: rest tip 2.3 mm below / 2.75 mm ahead of the root, extended tip
3.0 mm below / 4.5 mm ahead, so PER now travels ~1.9 mm. A resting fly keeps
the proboscis retracted and extends it on tarsal contact (Dethier 1976, *The
Hungry Fly*); the angles are authored.

Camera presets frame the same studio: **Widok kuchni** (overview), **Z boku**,
**Zbliżenie** (labellum dolly, shallow DOF), **Przegląd**, **Reel** (9:16,
35 mm / 15° low angle, fly and board in the middle third, DOF on the head,
handheld drift). DOF is off on mobile.

## Flight (authored)

Wingbeat is ~200 Hz. Blades are **not** posed per beat. Airborne look is a
translucent additive blur fan (~140° about the hinge) whose alpha scales with
amplitude, plus a 9 Hz / 22° blade flicker (below 60 fps Nyquist) so the arc
reads without strobing. The fan fades out over 120 ms on landing. On the
ground the blades rest folded over the abdomen ~8° apart; a seeded 25°
single-wing flick fires every 4–9 s. During GROOM_full’s wing phase the hind
legs sweep the blades and each blade opens 30° to meet them. Courtship song
extends one wing with a 5 Hz envelope on a 200 Hz blur fan (that wing only).

Path: **saccades** — straight 150–600 ms, ~90° yaw in 50 ms, 20–30° bank into
the turn, slight pitch-up when decelerating. Altitude wobble 1.5 Hz, 3 mm,
plus low-frequency noise.

**ORBIT:** 2–3 circuits over the food, descending, a saccade every
200–500 ms. The authored band is 60–120 mm, but the effective minimum is
`orbitRadiusFloor` = block XZ diagonal + body pad + 8 mm clearance (~80 mm
for the 80 × 100 mm block at 6×). The old fixed 60 mm floor sat *inside* the
64 mm diagonal, so a descending orbit was pushed onto a side face every frame
and read as "flying along the edge". `?debug=flight` draws the solids, the
200 ms lookahead and the XZ gap to the food.

**LAND** follows van Breugel & Dickinson 2012: saccade to face the target;
decelerate so distance/velocity (τ) stays roughly constant once the target’s
angular size on a virtual 150° eye grows; extend the forelegs when that size
passes ~60°; 40 ms touchdown squash; wings fold over 200 ms.

**TAKEOFF type 1** (voluntary, Card & Dickinson 2008): wings raise 60 ms,
**then** an 8 mm hop, blur fades in during the hop, stable climb.

**TAKEOFF type 2** (escape): hop first with wings folded, body tumbles two
rotations in 300 ms, then wings open and heading recovers. Used only by the
`escapeShadow` gag.

## Collision and support

Table/pouch collision is 3D (`resolveAabb3` / `resolveObb3` in `src/body/collision.ts`).
The fly's **centre** never enters the twaróg AABB, the pouch OBB or the board
volume, in any mode — including flight. Hits push out along the nearest
non-bottom face and slide the velocity (no zeroing). Near an edge two faces
are almost equidistant, so the face chosen last frame keeps a 25% preference
(`FACE_HYSTERESIS`) — without it the choice flipped every frame and the fly
chattered along the edge. In flight the `FlightController` is the only
resolver; the director no longer resolves the same solids a second time with
a different face choice. Flight also looks 200 ms
ahead and inserts an early saccade if the planned segment would collide
(looming; Collett & Land / Tammero & Dickinson style). Y is clamped between
the support height under her and a 220 mm ceiling. Landing targets are
clamped to `supportHeightAt` and never placed under a solid's top face.

`TwarogSystem.supportHeightAt(x, z)` returns the world Y of the tallest uneaten
chunk under that XZ, else the hull top if the point is still in the uneaten
footprint (and outside the opening-bite crater), else the cutting-board top
(`BOARD_MM.height`) inside the board footprint, else 0 (table). Walking off
the board edge onto the table is a valid transition: Y eases over 200 ms with
a 3 mm hop instead of snapping.

**Opening bite (authored).** Every portion is served already bitten: the
Voronoi cells whose centroid lies in an ellipsoid anchored on the top face at
the +X/−Z corner (`CURD_BITE_MM`: radius 26 mm in XZ, 18 mm deep) start out
`eaten` — 21 cells, ~26 g at seed 1. The lower layers survive, so the crater
floor is ~18 mm above the board and `supportHeightAt` lets her stand in it.
`nextPortion()` re-applies the bite; the far LOD is one geometry built from
the uneaten cells (wet-interior material on the exposed walls), so the notch
is visible from any distance. "ZOSTAŁO %" and grams eaten are normalised to
the portion as served. Eating starts at the crater (`biteFront`).

The body up-axis stays within 35° of the surface normal (world +Y on the table
and board, the face normal on a wall), slerped back over 150 ms, except during
the `escapeShadow` tumble (`takeoff2`).

## Side feeding posture (authored, measured reach)

Feeding from the board at a vertical face (`EAT_SIDE`, `mode === 'ground'`)
used to leave the proboscis in the board: `standoffMm()` was 11.25 mm (half
body + a guessed 25%-of-body PER) and `extendedLabellumReachMm()` was simply
*defined* as equal to it. Forward kinematics on `anchors.json` say otherwise —
the extended labellum is **4.5 mm ahead and 3.0 mm below** the root
(`EXTENDED_TIP_NATIVE`, guarded by a test), because the whole
rostrum→labellum chain is ~1.6 mm at 6×. `contactReachMm()` (≈15 mm) still
found bottom-layer cells, so eating proceeded while nothing touched.

Now (`src/body/wallFeed.ts`):

- `standoffMm()` is the **wall-feeding standoff**: the root distance at which
  the pitched tip sinks `WALL_FEED_BITE_MM` (0.4 mm) into the face — ≈ 5.0 mm
  at 6×. APPROACH therefore stops where feeding can actually touch.
- `TwarogSystem.clampRoot` pads the food by `foodStandPadMm()` (standoff −
  0.5 mm); the generic half-body pad stays for flight, pouch and orbit.
- During TASTE → RETRACT in ground mode the body pitches nose-up
  `WALL_FEED_PITCH_RAD` = 32° (inside the 35° up-cone), the root lifts by
  `hindFootOffset · sin(32°)` ≈ 1.9 mm so the rotation reads as about the
  hind feet, and the forelegs go up onto the food (same overlay as landing).
  Pitch and legs ease in/out over 150 ms. The pitched tip is then ≈ 5.4 mm
  ahead and level with the root; the head front (≈ 4.7 mm after the pitch)
  stays outside the wall.
- `supportHeightAt` counts cell footprints only inside the block's XZ, so
  standing 5 mm from a face no longer "steps up" onto an overhanging cell
  circle.
- The rig-less contact fallback (`kinematicContacts`) uses the measured tip
  rotated by the current pitch, so tests and the worker-only path see the
  same labellum the rig would.

Top feeding is unchanged: pitch 0, proboscis down, surface under the root.
Basis: tarsal contact → proboscis extension toward the food (Dethier 1976);
the 32° and the lift are authored for the reel, not measured. Not addressed
here: repeated PUMP at one spot bores a column to the board (pre-existing).

| `mode` | Solids | Y | Up |
| --- | --- | --- | --- |
| `ground` | tub AABB (`foodStandPadMm`) + mill OBB | standing height | +Y cone |
| `flight` | tub AABB + table (mill is **not** a flight solid so she can land on the belt) + 200 ms saccade lookahead | support…220 mm | +Y cone |
| `onFood` | centre stays out of the interior | `supportHeightAt` each frame | +Y cone |
| `mill` | root locked to belt centre | mill `deckY` + stand offset | +Y cone (biped gag: authored pitch 0.48 rad) |

## Scene loop

`src/body/sceneLoop.ts` sits **above** the feeding FSM. Soft duration caps;
each state exits on its own completion. The default **reel** loop is scoop →
powder → mill. Flight is punctuation onto the mill. `?loop=full` restores the
debug ORBIT / EXIT_FRAME path (flight code is not deleted).

**Reel (default):**

```
WALK_SCOOP → PICK_SCOOP → APPROACH_TUB → DIP_SCOOP →
EAT_SCOOP (Feeding FSM TASTE→EXTEND→PUMP→RETRACT; MN9 gates EXTEND;
food = powder in the scoop bowl) → DROP_SCOOP → GROOM_short →
TAKEOFF_MILL → LAND_MILL → WALK_MILL (hexapod in place, belt scrolls) →
WALK_BIPED (authored hind-leg gag) → GROOM_full →
NAP? (satiety > 0.8 after a feeding bout) → WAKE → WALK_SCOOP …
```

Open KFD tub (`src/food/creatineTub.ts`) at `kitchenLayout().tub`: photo label wrap on an authored cylinder. Powder fill lives in the well (`PILE_MM` inside `tubInnerRadiusMm()`). The lid sits beside the tub. Ø/H are reel-scale (not the 500 g jar). The kitchen env map is unchanged (`env_512.jpg`).

`NAP` only if satiety > 0.8 after a feeding bout (Murphy 2016). HUD caption
during NAP: **Trawi**. The biped walk is **not** Drosophila literature — mid/hind
bones are procedural (`src/body/bipedGait.ts`).

**Full (`?loop=full`):**

```
ORBIT → LAND_TOP → WALK_SCOOP → … → WALK_BIPED → GROOM_full →
NAP? → WAKE → TAKEOFF_EXIT → EXIT_FRAME → reset portion → ORBIT …
```

## Mill gait

`src/body/gait.ts` `millGaitAdvance`: on the belt, `gaitDistance += beltSpeed * dt`
even when the root ΔXZ is 0. Default belt speed is `FLY_WALK_MM_S` (14 mm/s).
Feet vs belt, not vs table. Hexapod remains M-tripod; `WALK_BIPED` is a
separate authored gag.

## Grooming and sleep

**GROOM_short** (3 s): proboscis wipe + foreleg rub.

**GROOM_full** (8 s): Seeds 2014 hierarchy — eyes → antennae → proboscis →
abdomen → wings. Forelegs for the head; hind legs sweep the blades in the
wing phase (blades open 30°); a pose-blend for abdomen; leg-rub interlude
every two parts. Chen & Seeds 2025 maps the later circuit
of that same hierarchy; we use the behavioural order, not those neurons
(MaleCNS feeding subgraph does not include them).

**NAP:** body lowers 1 mm, antennae droop 15°, 0.3 Hz abdominal breathing,
wings relax. Duration `8 s × satiety` (doubled in the `tooFull` gag).

**WAKE:** one antenna twitch, one foreleg rub. The reel loop then reseats
her on the food for the next bout; `?loop=full` takes off and exits frame.

## Gags

Self-contained authored sequences. They **never** alter brain state or
metabolism. Captions go through the HUD phase strip.

| Id | Weight | Caption | Entry |
| --- | ---: | --- | --- |
| `courtshipSong` | 3 | Śpiewa do krowy | satiety > 0.5 |
| `foilSlip` | 2 | Śliska folia | — |
| `crumbOnLeg` | 2 | Okruszek | — |
| `tooFull` | 2 | Za dużo zjadła | cropVolume > 0.85 |
| `escapeShadow` | 1 | Cień łyżki | — |
| `readsLabel` | 1 | Czyta skład | — |
| `none` | 2 | — | — |

Cow graphic and nutrition-table rows are hard-coded opaque-rect UVs mapped
through the pouch label (`src/scene/labelLandmarks.ts`), not measured print
geometry.

## Props (authored, render-only)

None of these are anatomy, connectome, or measurement. None of them write
into `ActivityFrame` or the LIF worker.

**Held morsel.** While PUMP consumes a chunk, a small curd morsel sits between
the two foreleg tarsi (`DirectorOutput.heldCrumb`) and shrinks with the
*measured* `TwarogSystem.consumeProgress` of that chunk, so what you see her
eat is the chunk that is actually being removed from the block. The forelegs
do not really hold food — real flies pump liquefied food through the
proboscis — this is a visual aid for the reel.

**Headstage and tether cable** (`src/body/headstage.ts`). A cap with a post
and an LED is parented to the `head` bone, so it rides gaze stabilisation and
grooming; a cable runs from its socket to an off-screen anchor ~340 mm above
the table that follows her in XZ with a 0.7 s lag, so the tether sways behind
her on the block and in flight. It is a deliberate joke about tethered /
head-fixed *Drosophila* electrophysiology rigs. The rope is a position-based
chain (14 points, 5% slack, ends pinned, 10 relaxation passes) and the tube
mesh is updated in place. It is never used as a physical constraint on the
body.

**Soma pulse** (`src/hud/pulse.ts`, `BrainScene`). Active somata in the atlas
pulse white in the shader (`uTime` plus a per-soma phase). Displayed activity
eases toward each 10 Hz `ActivityFrame` sample (τ = 80 ms) so the pulse does
not step. During POMPUJ the pulse gain rises to 2.2 (τ = 200 ms). The gain is
driven by the FSM state, i.e. body → *panel*, not body → brain; it amplifies a
real correlate (pharyngeal seeds are stimulated only while pumping) rather
than painting activity that is not there. `prefers-reduced-motion` disables
the pulse.

## Dopamine tone (rejected — unused)

A PAM-rate integrator and authored pump/NAP/courtship couplings were tried
and **removed**. PAM in this subgraph is silent; widening the graph produced
an unphysiological loop. See `docs/DATA-PIPELINE.md` § Rejected: dopamine
readout. `src/metabolism/dopamine.ts` and `reward.json` stay as audit only.

## Literature (parameters we actually used)

- **van Breugel F, Dickinson MH (2012)** *The visual control of landing and
  obstacle avoidance in the fruit fly Drosophila melanogaster.* J Exp Biol.
  Landing: expansion / τ deceleration, ~150° eye, foreleg extension near 60°
  angular size.
- **Card G, Dickinson MH (2008)** *Performance trade-offs in the flight
  initiation of Drosophila.* J Exp Biol. Type 1 (voluntary) vs type 2 (escape)
  takeoff; trailed mid/hind legs.
- **Seeds AM et al. (2014)** *A suppression hierarchy among competing motor
  programs drives sequential grooming in Drosophila.* eLife. Grooming order
  and the foreleg/head vs body split.
- **Murphy KR, Deshpande SA, … (2016)** *Postprandial sleep mechanics in
  Drosophila.* eLife. Sleep after a sweet meal; we gate NAP on satiety > 0.8.
- **Chen E, Seeds AM (2025)** grooming-circuit follow-up. Cited for the
  continued hierarchy, **not** as neurons in this build.
- **Wosnitza A, Bockemühl T, Dübbert M, Scholz H, Büschges A (2013)**
  Inter-leg coordination in the control of walking speed in Drosophila.
  Speed via step frequency; swing duration ~0.17 s held roughly constant.
- **Chun C, Biswas T, Bhandawat V (2021)** *Drosophila uses a tripod gait
  across all walking speeds, and the activity of the two tripod groups is
  delayed relative to each other.* eLife. M-tripod: front leads middle
  leads hind within a tripod.
- **Nature (2025)** Fine-grained descending control of steering: outside
  vs inside stride (±5% body length) and front-leg step direction into the
  turn, scaled by yaw rate.

- **Musso P-Y, Lehnert BP, … (2021)** *Dietary sugar inhibits satiation by
  decreasing the central processing of sweet taste.* PAM DANs innervating β'2
  respond to sweet taste and control feeding rate / satiation. Cited for
  interpretation only; MaleCNS does not label which PAM is β'2. We measure the
  PAM population actually in this subgraph.
- **Huetteroth W, … (2015)** Sweet-taste reinforcement reaches PAM β'2am / γ4.
  Same limitation: compartment identity is not in MaleCNS.

Shiu et al. Nature 2024 remains the ground truth for the LIF feeding gate
only (sugar GRN → MN9 in their model; here the whole gustatory channel).
