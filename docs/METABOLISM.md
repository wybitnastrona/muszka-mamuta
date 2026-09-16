# Hemolymph / metabolism (authored model)

**This document is not connectome data.** MaleCNS v1.0 supplies the feeding-circuit
graph and synapse signs. Every formula here is an authored ordinary-differential
model used to drive hunger neuromodulation. Constants were chosen so that
(1) 90 minutes without food raise hunger above 0.8, (2) a fed fly is less likely
to bite, and (3) vanilla-sweetened twaróg reaches satiety sooner than unsweetened
curd. They are not fitted to hemolymph assays.

Stepped **once per animation frame** on the main thread
(`src/metabolism/hemolymph.ts`). The 20k-neuron LIF stays in the worker.

## Food (authored assumption)

The wedge is **twaróg Mamuta waniliowy**, not plain curd. Profile in
`src/food/foodProfile.ts`:

| Field | Vanilla (live) | Plain (test fixture) | Role in this model |
| --- | ---: | ---: | --- |
| `sweet` | 0.75 | 0.15 | Trehalose yield (main drive) |
| `aa` | 0.70 | 0.70 | Fat / slower repletion |
| `sour` | 0.25 | 0.40 | Unused by the ODEs |
| `bitter` | 0.03 | 0.05 | Unused by the ODEs |
| `odor` | 0.85 | 0.35 | Vanillin; **olfactory**, at distance, not taste; unused by the ODEs |
| `albedoHex` | `#e1d7ca` | `#e1d7ca` | Display only |

MaleCNS has **no** sweet/bitter receptor annotations (no Gr64f / Gr5a / Gr66a).
`sweet` does not select a sugar-GRN subset. It only scales how much trehalose
each absorbed mass unit adds. Circuit inhibition is the GABA and glutamate
already present in the extracted graph.

Vanilla trehalose yield is **3×** unsweetened curd:

```
yield_tre(profile) = 0.15 + 1.0 × sweet
yield_tre(vanilla) / yield_tre(plain) = 0.90 / 0.30 = 3
yield_fat(profile) = 0.55 × aa
```

**Behaviour.** Fast sugar raises trehalose → insulin → satiety, so a vanilla
bout ends sooner. Baseline metabolism then drains trehalose (AKH returns) while
fat from `aa` moves slowly → **shorter feeding bouts, more of them**.

## State (all clamped to [0, 1])

`trehalose`, `fat`, `cropVolume`, `gutLoad`, `water`, `akh`, `dsk`, `insulin`.

## Mass ledger

Bites add to the crop, capped so `cropVolume ≤ 1`. The conservative identity is

```
ingested = cropVolume + gutLoad + absorbed + defecated
```

Transfer from crop to gut does not change the sum. Absorption moves gut →
`absorbed` (and then into trehalose/fat, which are concentrations, not the same
units). Defecation moves gut → `defecated`.

## Dynamics (Euler, dt in seconds)

Default `dt = FRAME_MS / 1000 ≈ 0.0167 s`. Tests may use a larger dt; rates are
slow (minutes).

### 1. Baseline metabolism

```
d(trehalose)/dt = −K_TREHALOSE_MET     K_TREHALOSE_MET = 8×10⁻⁵ s⁻¹
d(fat)/dt       = −K_FAT_MET           K_FAT_MET       = 2×10⁻⁵ s⁻¹
d(water)/dt     = −K_WATER_LOSS        K_WATER_LOSS    = 1.2×10⁻⁵ s⁻¹
```

Constant trehalose drain: 90 min removes ≈ 0.43 units.

### 2. Crop → gut (fixed rate)

```
transfer = min(crop, CROP_EMPTY_RATE × dt, 1 − gut)
crop ← crop − transfer
gut  ← gut  + transfer
CROP_EMPTY_RATE = 0.12  (volume units / s)
```

A bite is `biteMass` (default 0.08) added to the crop.

### 3. Absorption (gut contents raise trehalose and fat)

```
absorbed = min(gut, gut × ABSORB_RATE × dt)
gut ← gut − absorbed
trehalose ← clamp01(trehalose + absorbed × yield_tre)
fat       ← clamp01(fat       + absorbed × yield_fat)
water     ← clamp01(water     + absorbed × 0.35)
ABSORB_RATE = 0.02 s⁻¹
```

### 4. Hormones (lag toward a sigmoid target)

Logistic `σ(x) = 1 / (1 + e^(−x))`. Each hormone `h` relaxes with time constant τ:

```
h ← h + (h_target − h) × (1 − exp(−dt / τ))
```

| Hormone | Target | τ (s) |
| --- | --- | ---: |
| AKH | `σ((0.45 − trehalose) / 0.12)` | 8 |
| DSK | `σ((gut + 0.15×fat − 0.35) / 0.12)` | 25 |
| insulin | `σ((trehalose − 0.55) / 0.08)` | 18 |

Low trehalose **raises AKH** through that sigmoid. DSK follows gut fill
(stretch). Insulin follows trehalose (sugar satiety).

### 5. Satiety, hunger, eating probability

```
satiety = clamp01(0.50×insulin + 0.25×dsk + 0.25×fat)
hungerDrive = clamp01(akh × (1 − 0.70 × satiety))
eatingProbability = clamp01(
    hungerDrive
    × (1 − 0.50 × cropVolume)
    × (1 − 0.85 × satiety)
)
```

`eatingProbability` is a deterministic rate for a future motor controller. This
module does **not** sample it and does **not** write into `ActivityFrame`.

### 6. Defecation

If `gutLoad ≥ 0.85` after absorption, dump `min(gut, 0.40)` and emit a
`DefecationEvent`. Table spots are **cosmetic, toggleable, default off**. Mass
still leaves the gut when the toggle is off; spots are just not recorded.

Spot `(x, y)` is a deterministic function of event index (golden-ratio hash),
not RNG.

## Neuromodulation (`getModulation`)

```
gustGain           = 0.70 + 0.75 × hungerDrive
mn9ThresholdShift  = 1.20 − 3.00 × hungerDrive     (mV)
```

At `hungerDrive = 0.4`, `gustGain = 1` and `mn9ThresholdShift = 0`, so
calibrated MN9 rest is unchanged.

The main thread posts this to the worker **every 250 ms** via `setGain` on the
**whole gustatory channel** (`gust_drive`, `gust_neutral`, `gust_suppress`, and
legacy `gust_labellar` / `gust_pharyngeal`) plus `setMn9ThresholdShift`.
Hungry: gain > 1, MN9 threshold down (easier spike). Sated: the reverse.

Hunger does **not** pick sweet vs bitter seeds. It scales every proboscis
gustatory neuron in the extracted graph.

## Model boundary

```
Hemolymph  --getModulation-->  LIF worker (setGain / threshold)
LIF worker --ActivityFrame-->  BrainScene / (future) body
Body / bites --bite()------->  Hemolymph
```

The brain never writes hemolymph state. Hemolymph never writes `ActivityFrame`.

## What is measured vs authored

| Measured (MaleCNS) | Authored |
| --- | --- |
| Signed synapses; gustatory seeds by subclass | All rates, sigmoids, yields, bite mass |
| MN9 body IDs 10331 and 16949 | AKH / DSK / insulin (none of these are in the connectome) |
| GABA / glutamate edges (inhibition in-graph) | Vanilla-sweetened chemistry; spots; 250 ms push |
