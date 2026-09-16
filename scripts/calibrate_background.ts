#!/usr/bin/env node
/**
 * Binary-search tonic Poisson rate so resting MN9 lands in 2–5 Hz
 * over REST_WINDOW_MS. A 500 ms window is bistable (0 Hz or ≥9 Hz) and
 * never hits the band — that is a circuit property, not a search failure.
 * Writes BACKGROUND_RATE_HZ into src/brain/params.ts. Does not touch
 * validation thresholds.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCircuit } from '../src/brain/csr.ts';
import { meanMn9Hz } from '../src/brain/drive.ts';
import {
  MN9_REST_TARGET_MAX_HZ,
  MN9_REST_TARGET_MIN_HZ,
  PROTOCOL_SEED,
  REST_WINDOW_MS,
} from '../src/brain/params.ts';
import { LifNetwork } from '../src/brain/lif.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'public/data/feeding-circuit');
const metaPath = join(dir, 'graph.meta.json');
const binPath = join(dir, 'graph.bin');
const paramsPath = join(root, 'src/brain/params.ts');
const WINDOW_MS = REST_WINDOW_MS;
const TARGET_HZ = (MN9_REST_TARGET_MIN_HZ + MN9_REST_TARGET_MAX_HZ) / 2;
const ITERATIONS = 28;

function inBand(hz: number): boolean {
  return hz >= MN9_REST_TARGET_MIN_HZ && hz <= MN9_REST_TARGET_MAX_HZ;
}

function restMn9Hz(circuit: ReturnType<typeof parseCircuit>, rate: number): number {
  const net = new LifNetwork(circuit, PROTOCOL_SEED, { backgroundRateHz: rate });
  net.stepMs(WINDOW_MS);
  return meanMn9Hz(net.spikeCount, circuit.role, net.timeSec).hz;
}

function writeParams(rate: number, restHz: number): void {
  let text = readFileSync(paramsPath, 'utf8');
  if (!/export const BACKGROUND_RATE_HZ = /.test(text)) {
    throw new Error(`BACKGROUND_RATE_HZ not found in ${paramsPath}`);
  }
  if (!/export const CALIBRATED_MN9_REST_HZ = /.test(text)) {
    throw new Error(`CALIBRATED_MN9_REST_HZ not found in ${paramsPath}`);
  }
  text = text.replace(
    /export const BACKGROUND_RATE_HZ = [^\n]+/,
    `export const BACKGROUND_RATE_HZ = ${rate};`,
  );
  text = text.replace(
    /export const CALIBRATED_MN9_REST_HZ = [^\n]+/,
    `export const CALIBRATED_MN9_REST_HZ = ${restHz};`,
  );
  writeFileSync(paramsPath, text);
}

function main(): void {
  if (!existsSync(metaPath) || !existsSync(binPath)) {
    throw new Error(`Missing ${metaPath} or ${binPath}`);
  }
  const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as unknown;
  const buf = readFileSync(binPath);
  const graph = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const circuit = parseCircuit(meta, graph);

  console.log(
    `calibrate MN9 rest in [${MN9_REST_TARGET_MIN_HZ}, ${MN9_REST_TARGET_MAX_HZ}] Hz ` +
      `(target ${TARGET_HZ} Hz, window ${WINDOW_MS} ms, seed ${PROTOCOL_SEED})`,
  );

  const atZero = restMn9Hz(circuit, 0);
  console.log(`  rate=0 → MN9 ${atZero.toFixed(3)} Hz`);

  let lo = 0;
  let hi = 2;
  let hzHi = restMn9Hz(circuit, hi);
  console.log(`  rate=${hi} → MN9 ${hzHi.toFixed(3)} Hz`);
  while (hzHi < MN9_REST_TARGET_MIN_HZ) {
    lo = hi;
    hi = hi === 0 ? 0.25 : hi * 2;
    if (hi > 64) {
      throw new Error(`MN9 rest stayed below ${MN9_REST_TARGET_MIN_HZ} Hz even at background ${hi} Hz`);
    }
    hzHi = restMn9Hz(circuit, hi);
    console.log(`  rate=${hi} → MN9 ${hzHi.toFixed(3)} Hz`);
  }

  let bestRate = hi;
  let bestHz = hzHi;
  let bestErr = Math.abs(hzHi - TARGET_HZ);
  if (!inBand(bestHz)) {
    bestErr = Number.POSITIVE_INFINITY;
  }

  for (let i = 0; i < ITERATIONS; i++) {
    const mid = (lo + hi) / 2;
    const hz = restMn9Hz(circuit, mid);
    const err = Math.abs(hz - TARGET_HZ);
    console.log(`  mid ${mid.toPrecision(6)} → MN9 ${hz.toFixed(3)} Hz`);
    if (inBand(hz) && err < bestErr) {
      bestRate = mid;
      bestHz = hz;
      bestErr = err;
    }
    if (hz > TARGET_HZ) hi = mid;
    else lo = mid;
  }

  const snapped = Number(bestRate.toPrecision(6));
  const snappedHz = restMn9Hz(circuit, snapped);
  console.log(`  snap ${snapped} → MN9 ${snappedHz.toFixed(3)} Hz`);

  let rate = snapped;
  let hz = snappedHz;
  if (!inBand(snappedHz) && inBand(bestHz)) {
    rate = Number(bestRate.toPrecision(8));
    hz = restMn9Hz(circuit, rate);
    console.log(`  finer ${rate} → MN9 ${hz.toFixed(3)} Hz`);
  }

  if (!inBand(hz)) {
    throw new Error(
      `No backgroundRateHz put MN9 in [${MN9_REST_TARGET_MIN_HZ}, ${MN9_REST_TARGET_MAX_HZ}] Hz ` +
        `(best ${rate} → ${hz} Hz). Rest is too quantized; widen the calibration window, do not invent a threshold.`,
    );
  }

  writeParams(rate, hz);
  console.log(`wrote BACKGROUND_RATE_HZ = ${rate}  (MN9 rest ${hz.toFixed(3)} Hz) → ${paramsPath}`);
}

main();
