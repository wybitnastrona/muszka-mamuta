# Faza 4 review

Stop here. Do not start Faza 5 until this list is checked.

Implementation commit: `b99819e` (`feat(body): add authored Flybody feeding rig, clips and state machine`). Close-up framing was then tightened so these screenshots actually look at the head.

## Flybody hierarchy (inspected, not guessed)

`public/data/flybody/model.json` is **not** a single mesh and **not** a skeleton:

| Group | What it is |
| --- | --- |
| `body` | 8 unrigged material parts (cuticle, eyes, ocelli, bristles, wings, …) |
| `front_left` | Separate leg mesh, pivot = coxa `[0.0209, -0.0272, 0.0317]` |
| `front_right` | Mirror, pivot `[-0.0209, -0.0272, 0.0317]` |

Mesh frame: **+Z anterior, +Y dorsal, +X anatomical left**.

There are **no named rostrum / haustellum / antenna nodes**. Those bones are procedural (distance weights to `src/body/anchors.json`). The two front-leg groups are **parented** to `foreleg_L_tarsus` / `foreleg_R_tarsus` at the existing coxa pivots — the bone names say tarsus; the only usable pivot is the coxa.

## Screenshots

Full-page captures; the body panel is bottom-right.

### 1. `?debug=weights` — `docs/review/01-debug-weights.png`

Vertex colour = blended bone influence (legend on the left of the panel).

**Check**

- Solid **green** on the front legs: those vertices are not skinned; the whole `front_left` / `front_right` group is a child of the tarsus bone.
- Magenta / pink on the ventral anterior patch: `labellum_L` / `labellum_R`.
- Orange / yellow near that patch: `rostrum` / `haustellum`. Easy to miss — the green coxae sit in the foreground.
- Blue-grey wash on the thorax/head: `root` / `head` catch-all.

**Doubt.** Distance weights do not follow cuticle folds. Eyes, palps and the true labellum overlap in a few centimetres of mesh; the colour field will bleed. This is a debug view, not an anatomical paint.

### 2. `?debug=extend` + camera **Zbliżenie** — `docs/review/02-extend-closeup.png`

Frozen at mid-PER (`30 ms` anticipation already elapsed). Overlay should read `extend`.

**Check**

- 3/4 of the head: red compound eye, antennae, palps.
- Proboscis should be **further forward / down** than bind pose (authored −X pitch: rostrum −35°, haustellum −60°, labellum ±18°). On this mesh the standing pose already has the mouthparts hanging, so the delta is **subtle**.
- Cheese wedge should sit on the table in front of the head (albedo close to the table — easy to miss).

### 3. `?debug=pump` + **Zbliżenie** — `docs/review/03-pump-closeup.png`

Frozen at half a 6 Hz cycle around the **already extended** pose.

**Check**

- Same camera family as EXTEND.
- Difference vs EXTEND is a few degrees of haustellum / labellum pulse. If the two frames look almost identical, that is expected at this amplitude, not a missing clip.

## State machine (not in the stills)

`SEARCH → ORIENT → APPROACH → TASTE → EXTEND → PUMP → RETRACT → REST`

- **ORIENT** yaws toward the vanillin Gaussian until heading error < 15°. Tests cover several start headings.
- **EXTEND** needs `mn9Rate ≥ 8 Hz` for **80 ms continuous**. MN9 is silent or bursting (≥ 9 Hz); there is no useful intermediate rate.
- **PUMP** runs 2–5 cycles at 6 Hz; each cycle emits `bite` → `Hemolymph.bite()`.
- **RETRACT** early if `satiety > 0.85` or `bitter ≥ 0.12`. Vanilla profile bitter is 0.03, so satiety is the live abort.
- Without **LIF na żywo**, `mn9Rate` is 0: the fly orients/approaches/tastes, then times out of TASTE back to SEARCH. That is the model boundary, not a bug.

## Sliding window

`RATE_WINDOW_MS` is **50** (`src/brain/params.ts`). The EXTEND hold is 80 ms, so the window is shorter than the gate. Regression test: `tests/brain/lif.test.ts`.

## Debug URLs

| Query | What |
| --- | --- |
| `?debug=weights` | Bone-influence colours, mouthparts camera |
| `?debug=motion` | Loops every clip; name on the panel |
| `?debug=extend` | Mid-PER, Zbliżenie |
| `?debug=pump` | Mid-pump, Zbliżenie |

Cameras (exact labels): **Widok kuchni**, **Z boku**, **Zbliżenie**. The last one dollies onto the labellum–food midpoint in the live FSM (not in the frozen debug poses).

## Rig doubts (please push back)

1. **Foreleg “tarsus” is a coxa.** Tarsal taps swing the whole front leg. A second distal bone would need weights on `front_left` and would still be authored.
2. **No abdomen/wing/hind-leg joints in the source file.** Idle “abdominal breathing” is a small extra `abdomen` bone on the unrigged posterior mesh. Mid/hind legs stay glued to `root`.
3. **PER axis is authored.** +X folds the hanging proboscis up/back; clips use **−X** so extension goes toward +Z / the food. If the stills look like retraction, flip `EXTEND_ROSTRUM` / `EXTEND_HAUSTELLUM` in `feedingMotion.ts`.
4. **Skinning is CPU-once, GPU thereafter.** Fine for 48k verts. The 20k LIF stays in the worker.
5. **Zbliżenie vs named-leg clutter.** The contact point sits next to the green coxae. A true labellum-food macro will keep fighting those legs until the tarsus pivot is distal or the camera is a side profile.

## Tests that must stay green

```
npm run lint && npm test && npm run build
```

`tests/body/*`: hierarchy + coxa map, labellum weight, MN9 burst sequence, 80 ms EXTEND gate, ORIENT from several headings, 24 fps / 120 ms fade / 250 ms taps, odor gradient, camera names.

## Out of scope

Faza 5 (kitchen environment replacing the example stimulus, HUD restyle, etc.) was **not** started.
