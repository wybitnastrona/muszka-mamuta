# Body model (authored motion)

**This document is not connectome data.** MaleCNS v1.0 supplies the feeding-circuit
graph, synapse signs, and the two MN9 motor neurons (`bodyId` 10331 and 16949).
Every millimetre of locomotion, every wing pose, every grooming stroke, every
sleep breath and every comedy beat is **authored**. The brain worker still
outputs `ActivityFrame`; the body **reads** MN9 rate (and hemolymph satiety /
crop volume) and **never writes back**.

The only brain-driven decision is the **feeding gate**: gustatory channel
(labellar + pharyngeal, class `gustatory`) → MN9 → `TASTE` wait → `EXTEND`.
When the scene loop is in `EAT_TOP` / `EAT_SIDE`, control is handed to the
existing `SEARCH → … → REST` machine so that pause before the proboscis
extends stays MN9-gated. That pause is the reel shot; the loop does not skip it.

Code: `src/body/sceneDirector.ts`, `sceneLoop.ts`, `flight.ts`, `grooming.ts`,
`gags.ts`, `wings.ts`. Visual apply-only: `src/components/flySceneMount.ts`.

## What Flybody actually has

Group `body` materials: `body`, `black`, `red` (compound eyes), `ocelli`,
`bristle-brown`, `lower`, `brown`, **`membrane`**. There is no `wings`
material. `membrane` is split into `wing_L` / `wing_R` by the X sign of each
connected component’s centroid (+X anatomical left); each wing pivots at the
vertex closest to the thorax.

An `abdomen` bone already exists. Distension is `scale.x = scale.y = 1 + 0.25 * cropVolume`.
The abdomen mesh is not split.

Mid and hind legs are unrigged parts of the body mesh. They stay in the
standing pose during flight. Real *Drosophila* trail those legs in flight
(Card & Dickinson 2008, takeoff kinematics). Front legs are separate meshes
at coxa pivots (`front_left` / `front_right`); landing rotates those bones
forward-down over 120 ms.

## Appearance (authored, render-only)

Kitchen: dark grid floor plus a light-oak table slab (1 mm bevel, top at y = 0).
A white plate sits under the 250 g block; stray crumbs are an `InstancedMesh`;
a metal spoon handle at the frame edge is also the `escapeShadow` gag prop.
Lighting is a 3200 K key, cool fill, rim, ACES exposure 1.1, PCF-soft 2048
shadows on the table only, fog to black at the grid horizon.

Fly materials are `MeshPhysicalMaterial`. Cuticle base `#b8722f` with five
authored tergite bands and an abdomen Fresnel that scales with `cropVolume`.
Compound eyes (`red`) use a procedural hex normal map. Wings (`wing_L` /
`wing_R`) are transmissive and iridescent. Bristles use a tip-alpha gradient.
Head counter-rotates 60% against body pitch/roll; antennae keep 2–4° Perlin
and 8° flicks on odor-yaw jumps; standing tarsi sink 0.3 mm with a baked
contact-AO blob. None of this writes `ActivityFrame` or changes contact
sampling.

Camera preset **Reel**: 35 mm-equivalent (~38° vfov), 15° above the table,
f/2.8-equivalent DOF tracking the head, 0.1 Hz / 1 mm handheld drift.
DOF is off in **Widok kuchni** and on mobile.

## Flight (authored)

Wingbeat is ~200 Hz. Blades are **not** posed per beat. Airborne look is a
translucent additive blur fan (~140° about the hinge) whose alpha scales with
amplitude, plus a small per-frame flicker on the real blades. The fan fades
out over 120 ms on landing.

Path: **saccades** — straight 150–600 ms, ~90° yaw in 50 ms, 20–30° bank into
the turn, slight pitch-up when decelerating. Altitude wobble 1.5 Hz, 3 mm,
plus low-frequency noise.

**ORBIT:** 2–3 circuits over the food at 60–120 mm radius, descending, a
saccade every 200–500 ms.

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

Table/pouch collision is still XZ (`clampOutsideXzAabb` / `clampOutsideXzObb`).
`TwarogSystem.supportHeightAt(x, z)` returns the world Y of the tallest uneaten
chunk under that XZ, else 0 (table).

| `mode` | XZ push-out | Y |
| --- | --- | --- |
| `ground` | food AABB + pouch OBB, `standoffOnRay` unchanged | standing height |
| `flight` | **disabled** | flight integrator |
| `onFood` | **disabled** | `supportHeightAt` each frame (walks down as chunks vanish). Vertical-face climb: `projectOntoVerticalFace`. Tripod gait unchanged. Contact sampled at the top face. |

## Scene loop

`src/body/sceneLoop.ts` sits **above** the feeding FSM. Soft duration caps;
each state exits on its own completion.

```
ORBIT → LAND_TOP → WALK_TOP → EAT(top) → GROOM_short → TAKEOFF_1 →
ORBIT(1 circuit) → LAND_TABLE → EAT(side, standoffOnRay) → GAG →
EAT(side) → GROOM_full → NAP → WAKE → TAKEOFF_1 → EXIT_FRAME →
reset portion → ORBIT …
```

Exactly one gag per loop from a weighted seeded RNG, or none (weight 2).
`NAP` only if satiety > 0.8 after a sweet bout (Murphy 2016). HUD caption
during NAP: **Trawi**.

## Grooming and sleep

**GROOM_short** (3 s): proboscis wipe + foreleg rub.

**GROOM_full** (8 s): Seeds 2014 hierarchy — eyes → antennae → proboscis →
abdomen → wings. Forelegs for the head; a pose-blend for abdomen and wings;
leg-rub interlude every two parts. Chen & Seeds 2025 maps the later circuit
of that same hierarchy; we use the behavioural order, not those neurons
(MaleCNS feeding subgraph does not include them).

**NAP:** body lowers 1 mm, antennae droop 15°, 0.3 Hz abdominal breathing,
wings relax. Duration `8 s × satiety` (doubled in the `tooFull` gag).

**WAKE:** one antenna twitch, one foreleg rub, then takeoff.

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

Shiu et al. Nature 2024 remains the ground truth for the LIF feeding gate
only (sugar GRN → MN9 in their model; here the whole gustatory channel).
