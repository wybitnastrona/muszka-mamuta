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

Twaróg is protein-rich and low in sugar. Using the full proboscis gustatory
set (instead of missing sugar labels) is an authored modelling choice on top
of measured connectivity.

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
5. Keep the **intersection**, plus the seed sets themselves.
6. Add any neuron with **≥ 5 synapses onto that set** (preserves possible
   inhibitory control that is not on a short sensory–motor path).
7. Cap at **20,000** neurons: drop the weakest-connected first (incident
   synapse count inside the candidate set). **Never drop a seed.** Dropped
   body IDs are logged to stdout and, if any, `data/derived/feeding-circuit-dropped.json`.

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

- `public/data/feeding-circuit/graph.bin` — CSR, little-endian: `int32` indptr
  (`n+1`), `int32` indices (`n_edges`), `float32` signed weights (`n_edges`).
- `public/data/feeding-circuit/graph.meta.json` — `bodyId`, `type`, `subclass`,
  `role` (measured gust terciles), `gust_channel` (`labellar` / `pharyngeal` on
  the 271 seeds), `path_sign_deprecated`, `nt_uncertain`, provenance.
- `public/data/feeding-circuit/drive.json` — per-seed `deltaMn9Hz` and rank.

## How to run

Python **3.12** (see `.venv`):

```sh
.venv/bin/pip install -r scripts/data-prep/requirements.txt
.venv/bin/python scripts/data-prep/inspect_malecns.py
.venv/bin/python scripts/data-prep/extract_feeding_circuit.py
npm run calibrate:background   # writes BACKGROUND_RATE_HZ so MN9 rest is 2–5 Hz
npm run measure:drive          # per-seed MN9 deltas + role terciles
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
