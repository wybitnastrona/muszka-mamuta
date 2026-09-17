# MaleCNS feeding-circuit data pipeline

This document records the **actual filters and inferences** used to build
`public/data/feeding-circuit/`. It does not introduce receptor-gene labels
that MaleCNS does not contain.

## What MaleCNS does not provide

**MaleCNS v1.0 provides no sugar/bitter receptor annotations.** There are no
Gr64f, Gr5a, or Gr66a (or equivalent “sweet” / “bitter”) fields in the bundled
body-annotation table. Sweet vs bitter is **not available** in this dataset and
must not be invented.

We therefore:

1. Drive the model with the **whole proboscis gustatory channel** (labellar
   bristles, taste pegs, and pharyngeal sensilla), not a sugar-GRN subset.
2. Split that channel by a **measured** MN9 effect (`deltaMn9Hz` in
   `drive.json`), not by receptor names and not by a single-path sign.

Twaróg Mamuta is the **vanilla-sweetened** variant (`sweet: 0.75` in
`src/food/foodProfile.ts`) — an authored assumption, not a MaleCNS measurement.
MaleCNS still has no sugar/bitter split, so hunger modulates the **whole**
proboscis gustatory channel. Sweetness only scales hemolymph trehalose yield
(see `docs/METABOLISM.md`). Using the full gustatory set instead of missing
receptor labels is an authored modelling choice on top of measured connectivity.

## Rejected: `path_sign` (keep the negative result)

`path_sign` was the sign of the strongest walk of length ≤ 4 from a gustatory
seed to MN9 (product of unsigned synapse counts for strength, product of NT
signs for the label). **It is not a sweet/bitter label and it is not a net
effect.** Every seed reaches MN9 through thousands of paths at depth 4.

`validate_per.ts` (2026-09-16, seed 1, no tonic background, 100 Hz / 500 ms):

| Stimulus | MN9 rate | vs baseline |
| --- | --- | --- |
| none | 0 Hz (0 spikes / 2 MN9 / 200 ms) | — |
| all `gust_labellar` (223) | **32 Hz** (32 spikes / 500 ms) | guessed 5× “pass” |
| `path_sign = -1` (107) | **52 Hz** (52 spikes / 500 ms) | FAIL: *harder* drive, not weaker |

The −1 subset drove MN9 **harder** than the full labellar set. The field remains
in metadata as `path_sign_deprecated` for audit. Do not use it in the model.

## Rejected: dopamine readout (keep the negative result)

We tried to drive a dopamine HUD from the 19 PAM cells that are already in
the shipped 20k feeding-gate graph (`type` prefix `PAM`, bodyIds listed
below). **That readout is not in the model.** `src/metabolism/dopamine.ts`
and `public/data/feeding-circuit/reward.json` remain in the tree as audit
only.

On the **20k** graph (`2d084d9`, seed 1, 0.25 Hz tonic, 100 Hz / 500 ms):

| Stimulus | PAM rate | vs rest |
| --- | --- | --- |
| rest (2000 ms) | **0.053 Hz** (2 spikes / 19 cells) | — |
| all 271 gustatory | **0 Hz** | **Δ −0.053 Hz** |
| strongest single seed | Δ **+0.789 Hz** | first spike on the short-route seed at **206 ms** |

998 shortest walks exist in this depth-4 carve, but they collapse to one
short route: **PhG4 13491 → SLP234 13537 → PAM10 28434**. PAM is in the
graph and is graph-reachable. It is effectively silent as a sensory-driven
population.

Widening to 30k via the gustatory→PAM intersection (`|I| = 861,609`,
forward depth 5, 10k extras) made PAM *look* responsive (**whole-channel
Δ +132 Hz**) but pulled in **4,064 Kenyon cells** and created a
self-sustaining excitatory loop: after the tonic was cut, PAM went
**78 → 352 Hz** while MN9 fell to 0. Excluding `^KC`, then `^MBON`, from
the extra 10k did not stop it. APL (`type == "APL"`, bodyIds **10540** and
**10977**, GABA) is present in MaleCNS and was forced into the keep set,
but could not hold the sheet (APL→extra KC: **4,633 edges / 196,200
synapses**). Remaining extras still recruited 297 extra PAM-type cells
that rode the same loop; the original 19 PAM barely moved.

**Conclusion:** PAM activity in any subgraph we can carve here is
inseparable from unphysiological recurrence. We do not ship a dopamine
readout. Do not substitute MBON or PPL1 — those rates fail the same test
(see the next section). Extra 10k slots stay at 0. No further extraction
attempts.

## Known limitation: rest-state rates besides MN9

The zero-tonic test on the **shipped 20k** graph shows the same phenomenon
in milder form. After 2000 ms of 0.25 Hz tonic on the 271 gustatory seeds,
cutting the tonic to 0 for another 2000 ms:

| Population | rest Hz | after tonic cut |
| --- | ---: | ---: |
| PPL1 | 30.7 | **113** |
| MBON | 12.0 | **45.5** |
| dan_other (PPL2/PPM) | 27.9 | **112** |
| interneuron | 11.2 | **44.4** |
| PAM (19) | 0.053 | 0 (does not increase) |
| MN9 | 3.75 | **0** |

The carve-out lacks the inhibition that bounds these populations in the
intact brain, so **their rates are not interpretable**. Only MN9 and the
gustatory seeds are used by the model. MN9 does not run away: it falls to
0 without the sensory drive, as expected for a sensory-driven motor
neuron. Cold start at 0 tonic is all 0 Hz (no pacemaker). Do not display
PPL1, MBON, or PAM as a live readout.

The soma-atlas panel still shows the whole `ActivityFrame` (every neuron with
a soma), because that is what the worker computes and the legend says so.
Its pulse (`src/hud/pulse.ts`) and the stronger pulse during POMPUJ are
presentation only: the numbers are unchanged, the normalisation
`rate / RATE_NORM_HZ` is unchanged, and the FSM state reaches the *panel*,
never the worker. See docs/BODY-MODEL.md § Props.

## Findings: non-additivity, inhibition, and rest

Replacement for `path_sign`: `scripts/measure_drive.ts` stimulates **one** seed
at a time (`PROTOCOL_STIM_HZ` = 100 Hz / 500 ms, seed 1) and records
`deltaMn9Hz = MN9_Hz − rest`. Roles are terciles of that delta over all 271
proboscis gustatory seeds.

| Role | Rule |
| --- | --- |
| `gust_drive` | top tercile of `deltaMn9Hz` (rank 1 = strongest MN9 drive) |
| `gust_neutral` | middle tercile |
| `gust_suppress` | bottom tercile, including **negative** deltas |
| `mn9` | bodyId 10331 or 16949 |
| `mn_other` | `superclass == "cb_motor"`, not MN9 |
| `dn` | `superclass == "descending_neuron"` |
| `interneuron` | everything else |

Anatomical subclass (`labellar bristle`, `taste peg`, `pharyngeal sensillum`)
stays on each neuron. It is not the role tag.

### 2 Hz tonic is feeding, not rest

2 Hz Poisson on all 271 gustatory seeds put MN9 at **29 Hz** (500 ms). That is
permanent proboscis extension, not a quiescent motor neuron.

`scripts/calibrate_background.ts` binary-searches `BACKGROUND_RATE_HZ` so mean
MN9 rest is in **2–5 Hz** over `REST_WINDOW_MS` = 2000 ms. Result: **0.25 Hz**
tonic → **3.75 Hz** MN9 (seed 1). A 500 ms window is bistable (0 Hz or ≥9 Hz)
and never lands in 2–5 Hz — MN9 bursts, it does not tick at 3 Hz. Mean rest is
therefore the 2000 ms rate. Do not raise the tonic to make a test pass.

### Individual seeds vs the whole channel

First per-seed run (2 Hz tonic, **200 Hz** / 500 ms, rest 29 Hz):

| Set | n | min Δ | max Δ | median Δ | negative |
| --- | ---: | ---: | ---: | ---: | ---: |
| labellar + peg | 223 | −18 | **99** | 17 | 36 |
| pharyngeal | 48 | −21 | 90 | 22 | 9 |
| all 271 seeds | 271 | −21 | **99** | 18 | **45** |

**45 of 271 seeds had a negative delta** while MN9 was already firing at 29 Hz
— those cells *reduced* an active MN9. That is measured inhibitory input in
the extracted graph (GABA/glutamate edges), not a missing annotation.

The same day, stimulating **all 223** labellar/peg seeds at 100 Hz produced
**33 Hz** MN9 (rise +4 Hz vs 29 Hz rest). Single seeds reached **+99 Hz**.
Whole-channel drive is far below the strongest unit. That is consistent with
**lateral inhibition / gain normalisation**: driving the whole channel also
recruits the GABAergic and glutamatergic interneurons in it.

Calibrated run (0.25 Hz tonic, **100 Hz** / 500 ms, rest **3.75 Hz** / 2000 ms):

| Set | n | min Δ | max Δ | median Δ | negative |
| --- | ---: | ---: | ---: | ---: | ---: |
| labellar + peg | 223 | −3.75 | **137.25** | −3.75 | 120 |
| pharyngeal | 48 | −3.75 | 104.25 | 11.25 | 19 |
| all 271 seeds | 271 | −3.75 | **137.25** | −3.75 | 139 |

| Stimulus | MN9 | vs 3.75 Hz rest |
| --- | --- | --- |
| labellar/peg 100 Hz (223) | 28 Hz | rise **+24.25** Hz (7.47×) |
| `gust_drive` 100 Hz (91) | 87 Hz | rise **+83.25** Hz (23.2×) |
| `gust_suppress` 100 Hz (90) | 22 Hz | rise **+18.25** Hz (5.87×) |
| strongest single labellar | — | Δ **+137.25** Hz |

Whole-channel rise +24.25 Hz is still far below +137.25 Hz from one seed.
`gust_drive` rise exceeds `gust_suppress` rise by **65 Hz** (ratio 4.562).
Many of the 139 calibrated negatives are −3.75 Hz (no MN9 spike in the 500 ms
pulse vs the 2000 ms rest mean). The cleaner inhibition evidence remains the
**45 negatives against a 29 Hz rest** at 200 Hz.

`validate_per.ts` criteria are these measured values, not guessed 5× / 3×
fold-changes: whole-channel rise ≥ **24.25 Hz**; drive−suppress gap ≥ **65 Hz**;
max single-seed Δ > whole-channel rise.

## Inputs (`data/raw/`, Apache Arrow Feather — not CSV)

| File | Role |
| --- | --- |
| `body-annotations-male-cns-v1.0-minconf-0.5.feather` | 211,577 neurons × 36 columns. Seed filters. |
| `body-neurotransmitters-male-cns-v1.0.feather` | Per-body NT predictions (`consensus_nt`, else `predicted_nt`). |
| `connectome-weights-male-cns-v1.0-minconf-0.5.feather` | ~1 GB body-to-body weights. Columns are **`body_pre` / `body_post` / `weight`** (confirmed at runtime; not `bodyId_pre`). |

Read annotations and NT tables with `pandas.read_feather`. The weight table is
opened with **pyarrow** (`memory_map=True`, only the three columns above) so a
1 GB file is not copied into a full pandas DataFrame.

## Seed sets (hard-coded, verified — do not substitute)

These filters were checked against the annotation table. If an assertion
fails, the scripts **stop**. They do not search for Gr64f / Gr5a / Gr66a.

| Set | Filter | Assertion |
| --- | --- | --- |
| `PROBOSCIS_GUSTATORY` | `class == "gustatory"` and `subclass` in `{labellar bristle, taste peg, pharyngeal sensillum}` | `250 ≤ n ≤ 290` (observed 271) |
| `MN9` | `type == "MN9"` | bodyIds **exactly** `{10331, 16949}` |
| `PROBOSCIS_MOTOR` | `superclass == "cb_motor"` | `n == 107`; MN9 is a subset |

Scripts: `scripts/data-prep/inspect_malecns.py` writes `data/derived/seeds.json`
(with SHA-256 of each source file). `extract_feeding_circuit.py` reapplies the
same filters and assertions.

## Graph construction

1. Load the weight table; print and then use the confirmed column names.
2. Sign every extracted edge from the **pre-synaptic** neuron’s NT:
   - acetylcholine → `+1`
   - GABA → `-1`
   - glutamate → `-1` (central fly synapses treated as inhibitory)
   - anything else, including `unclear` / missing → `+1` with `nt_uncertain`
3. Forward BFS from `PROBOSCIS_GUSTATORY`, max depth **4**.
4. Backward BFS from `MN9 ∪ PROBOSCIS_MOTOR`, max depth **4**.
5. Keep the **intersection**, plus the seed sets themselves (gustatory, motor, and
   the 19 PAM bodyIds that were already in that subgraph).
6. **Gustatory→PAM extra slots (not a PAM-backward union).** A third BFS
   *union* from the 19 PAM cells pulls in ~1.6M afferents. Ranking those by
   degree keeps SEZ hubs: the extra 10k can be strong PAM listeners that
   gustatory cells never reach — the same silence. Instead take
   **I = G ∩ P**:
   - **G:** forward from the 271 gustatory seeds, depth **6**.
   - **P:** backward from the 19 PAM, depth **4**.
   - Report **|I| before capping**. If |I| is empty: **stop** — the
     gustatory-to-PAM route is not in MaleCNS at this confidence; do not pad.
   - If |I| minus the 20k core is under 10k: take all of it.
   - Else rank I by **path strength to PAM** (max product of unsigned synapse
     counts, hop-limited Bellman–Ford from the 19 PAM, depth ≤ 4, restricted
     to I) and keep the top 10k.
   - Do **not** add ≥5-synapse control partners onto this extra set.
   MaleCNS has 316 PAM-type cells; we BFS only from the 19 verified in the
   feeding subgraph.
   Extra 10k is **abandoned** — see **Rejected: dopamine readout** above.
   Shipped graph is the 20k feeding gate from `2d084d9`.
   Depth 6 on 151M edges can make |G| enormous. If **|P| or |I| > 80,000**,
   the extractor uses forward depth **5** instead (the compromise if a depth-6
   intersection would hang ranking). It does **not** run depth 6 and then 5.
7. Add any neuron with **≥ 5 synapses onto the feeding-gate core** (not onto
   the extra 10k). Preserves possible inhibitory control that is not on a
   short sensory–motor path.
8. **Two-stage neuron cap.** Cap the GRN∩MN9 core to **20,000** (original
   feeding-gate carve, never drop a seed). Fill remaining slots from I as
   above, never dropping that core. A single 30k pass on a 1.6M PAM-union
   keeps the dense SEZ and drops every off-core PAM-neighborhood cell
   (verified: 0 of 751,491 retained). Dropped-ID preview:
   `data/derived/feeding-circuit-dropped.json`.
9. **Size cap (20 MiB).** Cloudflare Pages is 25 MB/file;
   `scripts/compress_graph.ts` fails at **20 MiB**. If the compressed CSR is
   over that, drop edges whose unsigned synapse count is **1** (noise), **not
   neurons**. Weight-1 trim **must skip edges on a gustatory→PAM walk**,
   including the measured thin path `13491 PhG4 → 13537 SLP234 → 28434 PAM10`.
   Cutting those edges would undo the extra 10k.

Role tags for gustatory seeds are **measured** (`gust_drive` / `gust_neutral` /
`gust_suppress` from `drive.json`). Older extracts briefly tagged
`gust_labellar` / `gust_pharyngeal` from subclass; `measure_drive.ts` overwrites
those. Motor / DN / interneuron tags still come from annotation fields.

Subclass (labellar bristle, taste peg, pharyngeal sensillum) remains in
`graph.meta.json`. Condition 1 of `validate_per.ts` stimulates the 223
labellar/peg seeds listed in `drive.json` (same cells as those subclasses;
not every neuron whose subclass is `pharyngeal sensillum` — six of those
failed the `class == gustatory` seed filter).

`path_sign` was computed, **tested, and rejected** — see above. Metadata stores
it as `path_sign_deprecated` only.

## Outputs

- `public/data/feeding-circuit/graph.bin` — **MMG1 compressed** CSR for
  Cloudflare Pages (< 25 MB/file): magic `MMG1`, `uint32` n / n_edges,
  `int32` indptr (`n+1`), per-row **sorted** target indices as unsigned
  LEB128 deltas, IEEE **float16** signed weights. The Web Worker decodes
  to int32 / float32 before LIF. Uncompressed writer `write_csr` remains
  in `scripts/data-prep/feeding.py` for audit dumps
  (`data/derived/feeding-circuit-graph.uncompressed.bin`, gitignored).
  Re-encode with `npm run compress:graph`.
- `public/data/feeding-circuit/graph.meta.json` — `bodyId`, `type`, `subclass`,
  `role` (measured gust terciles), `gust_channel` (`labellar` / `pharyngeal` on
  the 271 seeds), `path_sign_deprecated`, `nt_uncertain`, provenance.
- `public/data/feeding-circuit/drive.json` — per-seed `deltaMn9Hz` and rank.
- `public/data/feeding-circuit/reward.json` — unused audit of PAM path / rates (see Rejected: dopamine readout).

## Reward-cell identity (audit only, unused)

Role tags `dan_pam` / `dan_ppl1` / `dan_other` / `mbon` / `kc` are derived
**only** from the MaleCNS `type` field (`npm run tag:reward`). They replace
`interneuron` for those cells; gustatory terciles, MN9, other MN, and DNs are
untouched. Counts in the extracted circuit (identity only — **not a HUD
readout**; see Rejected: dopamine readout):

| Group | n | Types present |
| --- | --- | --- |
| PAM (`dan_pam`) | 19 | PAM04, PAM05, PAM10 (15), PAM11 |
| PPL1 (`dan_ppl1`) | 16 | PPL101–PPL108 |
| PPL2 / PPM (`dan_other`) | 17 | PPL201–203, PPM1201–1205 |
| MBON | 66 | MBON01–MBON35 (types actually present; not every index) |
| KC | 8 | KCg-d, KCg-s1, KCg-s2, KCa'b'-ap2 |

PAM bodyIds (from `type` prefix `PAM`, then asserted against this list):
28434, 29565, 32865, 36624, 37845, 48113, 60930, 66934, 125080, 143120,
170450, 178945, 200973, 520403, 520616, 525787, 544257, 544359, 547260.

**Limitation:** MaleCNS does **not** assign mushroom-body compartments. We
do **not** claim these cells are PAM-β'2 (Musso, Lehnert et al. 2021;
Huetteroth et al. 2015 are interpretation only, not parameters). We measure
the PAM population that is actually in this subgraph.

`npm run measure:reward` is an **audit** script (same protocol as
`measure_drive.ts`). It is not wired to the HUD. Full numbers and the
rejected 30k extract live in **Rejected: dopamine readout** above.

Compressed `graph.bin` is 12.26 MB (under the 20 MiB `compress_graph.ts`
target).

## How to run


Python **3.12** (see `.venv`):

```sh
.venv/bin/pip install -r scripts/data-prep/requirements.txt
.venv/bin/python scripts/data-prep/inspect_malecns.py
.venv/bin/python scripts/data-prep/extract_feeding_circuit.py
npm run calibrate:background   # writes BACKGROUND_RATE_HZ so MN9 rest is 2–5 Hz
npm run measure:drive          # per-seed MN9 deltas + role terciles
npm run tag:reward             # PAM / PPL1 / PPL2-PPM / MBON / KC from type
npm run measure:reward         # gustatory → PAM path, rates, per-seed deltaPamHz
.venv/bin/pytest tests/data-prep -q
npm run validate:circuit
```

Pinned packages: pandas, pyarrow, numpy, scipy, pytest (see
`scripts/data-prep/requirements.txt`).

The weight table contains **151,856,684** edges and on the order of **10^7–10^8**
distinct `body_pre`/`body_post` values — far more than the 211,577 classified
annotation rows. Unannotated endpoints are treated as ordinary graph nodes
during BFS (so a ≤4-hop path may traverse them) and may be dropped by the
20k cap. In the run that produced `graph.bin`, every retained neuron was
present in the annotation table.

The extractor reports **peak RSS** while reading the ~1 GB weight file.

## Attribution (MaleCNS — CC BY 4.0)

MaleCNS data remains **CC BY 4.0**, credited to **FlyEM / HHMI Janelia**,
**University of Cambridge**, **MRC Laboratory of Molecular Biology**, and
**Google Research**. See `THIRD_PARTY_NOTICES.md`. The web template itself
is separate (attribution-required source-available license; keep the
fly-connectome-template credit in the UI and README).
