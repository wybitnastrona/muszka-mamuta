# Brain runtime

Live adapter: a leaky integrate-and-fire network on the MaleCNS feeding-circuit
CSR, running in a **TypeScript Web Worker** (`src/brain/lif-worker.ts`). The worker steps only neurons that are not at rest (sparse roster). The
`PERF=1` test requires 20k × 167 steps in < 12 ms; that budget is met for
sparse activity. A fully active 20k-cell sweep would need Option B (WASM).

The worker is the only place that steps the 20k-neuron loop. The main thread
converts each worker frame into the template `ActivityFrame` and never writes
membrane state.

## Authored vs measured

| Measured (MaleCNS v1.0) | Authored |
| --- | --- |
| Signed synapse counts in `graph.bin` | dt, τ_m, V_rest, V_th, V_reset, t_ref, W_syn, τ_syn |
| `deltaMn9Hz` tercile roles in `drive.json` | Poisson pulse protocol, 50 ms rate window, calibrated `BACKGROUND_RATE_HZ` (0.25) |
| Subclass (labellar / peg / pharyngeal) | Hunger as `setGain` on the **whole** gustatory channel (every 250 ms from hemolymph) |

See [METABOLISM.md](METABOLISM.md) for the authored hemolymph ODEs. MaleCNS has
**no** sweet/bitter receptor annotations. Hunger scales all gustatory seeds
(`gust_drive` / `gust_neutral` / `gust_suppress`, i.e. labellar + pharyngeal).
Inhibition is the GABA/glutamate already in the graph.

LIF constants live in `src/brain/params.ts` with Shiu et al. 2024 citations.
MaleCNS has **no** sweet/bitter receptor annotations. Tonic Poisson
(`BACKGROUND_RATE_HZ = 0.25`, calibrated so mean MN9 rest is 3.75 Hz over
2000 ms) runs on every proboscis gustatory seed. 2 Hz produced 29 Hz MN9 —
feeding, not rest. `stimulate` is an overlay; when it expires the tonic returns.

`path_sign` was tested and rejected (see `docs/DATA-PIPELINE.md`). Metadata
keeps `path_sign_deprecated` only.

Equations (Shiu Methods, exponential `g`):

```
dv/dt = (g + I_ext − (v − V_rest)) / τ_m
dg/dt = −g / τ_syn
on spike of j: g_i += w_ji · W_syn · gain_j
```

`w_ji` is the signed synapse count from the feeder graph. After a spike, `v`
returns to V_reset for 2.2 ms. Sensory `stimulate` overlays Poisson spikes on
the named body IDs (skipped while refractory).

Normalization for `ActivityFrame`: mean rate in a 50 ms window, divided by
50 Hz, clamped to `[0, 1]`. Omitted IDs are zero. `source.kind` is `predicted`.

## Message protocol

Worker URL: `src/brain/lif-worker.ts` (Vite module worker).

### Main → worker (`WorkerIn`)

| `type` | Payload | Notes |
| --- | --- | --- |
| `init` | `graph: ArrayBuffer`, `meta: object`, `seed: number` | Transfer `graph`. CSR + `graph.meta.json`. |
| `start` | | Pace ~one 16.7 ms sim frame per wall-clock frame. |
| `stop` | | Freeze state; does not dispose the graph. |
| `reset` | `seed?: number` | Clear V, g, drive, spike window; optional new seed. |
| `setSeed` | `seed: number` | Same as reset with that seed. |
| `stimulate` | `ids: Int32Array`, `rateHz: number`, `durationMs: number` | Poisson on those **body IDs**. |
| `setGain` | `role: RoleTag`, `gain: number` | Scales **outgoing** weights of that role. Hemolymph posts the same `gustGain` to every gustatory role every 250 ms. |
| `setMn9ThresholdShift` | `shiftMv: number` | Authored MN9 `V_th` offset (mV). Negative = hungry (easier spike). |

`RoleTag`: `gust_drive` \| `gust_neutral` \| `gust_suppress` \| `mn9` \| `mn_other` \| `dn` \| `interneuron` (legacy `gust_labellar` / `gust_pharyngeal` still parse).

### Worker → main (`WorkerOut`)

| `type` | Payload |
| --- | --- |
| `ready` | `nNeurons`, `seed` |
| `frame` | `time` (s), `values: [bodyId, 0–1][]`, `summary: PopulationSummary`, `seed` |
| `error` | `message` |

`PopulationSummary` rates are **Hz** in the current 50 ms window:

```
{ mn9Rate, gustDriveRate, gustNeutralRate, gustSuppressRate, mnOtherRate, dnRate }
```

RNG is **xoshiro128\*\*** seeded from the UI integer (SplitMix32 expansion).
The same seed must replay the same spike train (see Vitest).

## Wiring

`BrainRuntime` fetches `public/data/feeding-circuit/graph.bin` and
`graph.meta.json`, then owns the worker. `App.tsx` keeps the JSON **replay**
adapter: loading a replay disposes the live runtime. Live LIF does not go
through `parseReplay` (circuit IDs need not be in the soma-atlas visible set).

## Tests and checks

```sh
npm test                 # replay node:test + Vitest LIF
PERF=1 npm run test:perf # 20k × 167 steps < 12 ms
npm run calibrate:background # BACKGROUND_RATE_HZ so MN9 rest is 2–5 Hz
npm run measure:drive        # per-seed MN9 deltas → drive.json + role terciles
npm run validate:circuit     # labellar vs rest; gust_drive vs gust_suppress; sublinear
```

`validate_per.ts` reads the measured population block in `drive.json`. Condition 1
requires the whole labellar/peg channel to raise MN9 by at least the measured
rise (+24.25 Hz) and prints the lateral-inhibition finding when that rise is
far below the strongest single seed. Condition 2 requires `gust_drive` rise to
exceed `gust_suppress` rise by the measured gap (65 Hz) and reports the ratio.
A third check is that whole-channel rise stays below max single-seed Δ.
Guessed 5× / 3× fold-changes were rejected; see `docs/DATA-PIPELINE.md`.
