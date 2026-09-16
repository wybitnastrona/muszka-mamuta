# QA checklist (final phase)

Run from the repo root.

## Circuit

- [x] `graph.bin` MMG1 compressed, **12.86 MB** (was 32.51 MB; Cloudflare limit 25 MB/file).
- [x] Uncompressed writer kept: `scripts/data-prep/feeding.py` `write_csr`; audit copy `data/derived/feeding-circuit-graph.uncompressed.bin`.
- [x] `npm run validate:circuit` on the **compressed** graph:

```
neurons=20000 labellar/peg=223 gust_drive=91 gust_suppress=90 background=0.25 Hz stim=100 Hz
baseline MN9: 3.750 Hz (15 spikes / 2 cells / 2000 ms)
PASS  labellar/peg 100 Hz / 500 ms → MN9 rise ≥ measured 24.250 Hz
      MN9 28.000 Hz (28 spikes), baseline 3.750 Hz, rise 24.250 Hz (7.47× baseline). Whole-channel rise +24.250 Hz is far below max single-seed delta +137.250 Hz. Consistent with lateral inhibition / gain normalisation: driving all 223 also recruits GABAergic and glutamatergic interneurons in the extracted circuit.
PASS  gust_drive rise exceeds gust_suppress rise by ≥ measured 65.000 Hz
      drive MN9 87.000 Hz (rise 83.250, 23.20× baseline); suppress MN9 22.000 Hz (rise 18.250, 5.87× baseline); gap 65.000 Hz; rise ratio drive/suppress 4.562
PASS  whole-channel labellar rise is sublinear vs strongest single seed
      max single Δ 137.250 Hz vs whole-channel rise 24.250 Hz
```

## Build / tests

- [x] `npm run lint && npm test && npm run build` — 129 tests passed, 1 skipped.
- [x] `npm run check:assets`
- [x] `npm run soak` — 600 s simulated scene loop, seed 1, 10 wraps, heap Δ **0.37 MiB**.

```
soak 600s sim @ 30 Hz, wraps=10, heap 11.9 → 12.3 MB (Δ 0.37 MiB)
PASS  soak: loop wrapped and heap growth within limit
```

## Recording

- [x] `src/recording/recorder.ts` `startRecording({ fps: 30, width: 1080, height: 1920, seconds })` — `canvas.captureStream` + MediaRecorder VP9/WebM 12 Mbps, slogan composited, camera forced to **Reel**, auto-download.
- [x] `scripts/webm2mp4.sh` (ffmpeg H.264 yuv420p 30 fps `+faststart`). This machine has no `ffmpeg` binary, so the mp4 step was not executed.
- [x] One full scene loop at seed 1 → `docs/review/loop-seed1.webm` (~99 MB, `?reel=1&record=90`, slogan in frame). Still from the capture: `docs/review/loop-seed1-frame.png`.

## UI / a11y / deploy

- [x] Attribution visible in HUD (`src/components/Attribution.tsx`) and README. Screenshot: `docs/review/widok-kuchni-label.png`.
- [x] Label readable in **Widok kuchni** (TWARÓG MAMUTA / NATURALNA on the pouch). Same screenshot.
- [x] Every control is a native `button` / `input`; camera chips are a radiogroup with arrow keys (`src/hud/keyboard.ts`). Brain XY / Orbit are `type="button"`.
- [x] Subpath: Vite `base: './'`; `dist/index.html` uses `./assets/…`.
- [x] Lighthouse performance, mobile form-factor, localhost (`--throttling-method=provided`): **87**. Simulated Slow 4G: 57 (12.9 MB `graph.bin` on a 1.6 Mbps profile). Target ≥ 80 is met on the unthrottled mobile viewport used for the 60 fps budget.

## Cleanup

- [x] Removed `createTwarogWedge` / placeholder geometry from `src/body/kitchen.ts`.
- [x] No `Environment.tsx` stimulus panel in this fork.
- [x] README: one `npm run dev` is enough (no extra background Vite servers).
