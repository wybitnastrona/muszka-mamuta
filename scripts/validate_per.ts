#!/usr/bin/env node
/**
 * Condition 1: whole labellar/peg channel vs calibrated baseline (threshold = measured rise).
 * Condition 2: gust_drive rise vs gust_suppress rise (gap = measured separation).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { idsForRole, parseCircuit, type CircuitGraph } from '../src/brain/csr.ts';
import { channelRiseIsSublinear, meanMn9Hz } from '../src/brain/drive.ts';
import { LifNetwork } from '../src/brain/lif.ts';
import {
  BACKGROUND_RATE_HZ,
  PROTOCOL_DURATION_MS,
  PROTOCOL_SEED,
  PROTOCOL_STIM_HZ,
  REST_WINDOW_MS,
} from '../src/brain/params.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'public/data/feeding-circuit');
const metaPath = join(dir, 'graph.meta.json');
const binPath = join(dir, 'graph.bin');
const drivePath = join(dir, 'drive.json');

type DriveFile = {
  seed: number;
  stimHz: number;
  gust_labellar: Array<{ bodyId: number; deltaMn9Hz: number }>;
  population: {
    labellarRiseHz: number;
    driveMinusSuppressHz: number;
    maxLabellarDeltaHz: number;
  };
};

function line(ok: boolean, name: string, detail: string): boolean {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  console.log(`      ${detail}`);
  return ok;
}

function mn9(net: LifNetwork, circuit: CircuitGraph) {
  return meanMn9Hz(net.spikeCount, circuit.role, net.timeSec);
}

function ratioText(hz: number, baseline: number): string {
  if (baseline <= 0) return 'baseline 0 Hz (ratio undefined)';
  return `${(hz / baseline).toFixed(2)}× baseline`;
}

function riseRatio(driveRise: number, suppressRise: number): string {
  if (suppressRise === 0) return driveRise > 0 ? '∞ (suppress rise 0)' : 'undefined (both 0)';
  return (driveRise / suppressRise).toFixed(3);
}

function run(): number {
  if (!existsSync(metaPath) || !existsSync(binPath) || !existsSync(drivePath)) {
    line(false, 'graph present', 'Need graph.bin, graph.meta.json, and drive.json (npm run measure:drive).');
    return 1;
  }

  const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as unknown;
  const driveFile = JSON.parse(readFileSync(drivePath, 'utf8')) as DriveFile;
  if (!driveFile.population) {
    line(false, 'drive.json population', 'Re-run npm run measure:drive after calibration (needs population block).');
    return 1;
  }
  const buf = readFileSync(binPath);
  const graph = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const circuit = parseCircuit(meta, graph);
  const labellar = Int32Array.from(driveFile.gust_labellar.map((row) => row.bodyId));
  const drive = idsForRole(circuit, 'gust_drive');
  const suppress = idsForRole(circuit, 'gust_suppress');
  console.log(
    `neurons=${circuit.n} labellar/peg=${labellar.length} gust_drive=${drive.length} ` +
      `gust_suppress=${suppress.length} background=${BACKGROUND_RATE_HZ} Hz stim=${PROTOCOL_STIM_HZ} Hz`,
  );

  const baselineNet = new LifNetwork(circuit, PROTOCOL_SEED);
  baselineNet.stepMs(REST_WINDOW_MS);
  const baseline = mn9(baselineNet, circuit);
  console.log(
    `baseline MN9: ${baseline.hz.toFixed(3)} Hz (${baseline.spikes} spikes / ${baseline.n} cells / ${baseline.ms.toFixed(0)} ms)`,
  );

  const labNet = new LifNetwork(circuit, PROTOCOL_SEED);
  labNet.stimulate(labellar, PROTOCOL_STIM_HZ, PROTOCOL_DURATION_MS);
  labNet.stepMs(PROTOCOL_DURATION_MS);
  const lab = mn9(labNet, circuit);
  const labRise = lab.hz - baseline.hz;
  const measuredRise = driveFile.population.labellarRiseHz;
  const maxSingle = Math.max(
    driveFile.population.maxLabellarDeltaHz,
    ...driveFile.gust_labellar.map((row) => row.deltaMn9Hz),
  );

  let inhibitionNote: string;
  if (!(labRise > 0)) {
    inhibitionNote =
      'Whole-channel rise is not positive — recruited inhibition cancelled the population drive. ' +
      'Not lowering the bar.';
  } else if (maxSingle > labRise) {
    inhibitionNote =
      `Whole-channel rise +${labRise.toFixed(3)} Hz is far below max single-seed delta +${maxSingle.toFixed(3)} Hz. ` +
      'Consistent with lateral inhibition / gain normalisation: driving all 223 also recruits ' +
      'GABAergic and glutamatergic interneurons in the extracted circuit.';
  } else {
    inhibitionNote = `Whole-channel rise +${labRise.toFixed(3)} Hz; max single-seed delta +${maxSingle.toFixed(3)} Hz.`;
  }

  const passLab =
    labellar.length > 0 &&
    labRise > 0 &&
    labRise >= measuredRise;
  line(
    passLab,
    `labellar/peg ${PROTOCOL_STIM_HZ} Hz / ${PROTOCOL_DURATION_MS} ms → MN9 rise ≥ measured ${measuredRise.toFixed(3)} Hz`,
    `MN9 ${lab.hz.toFixed(3)} Hz (${lab.spikes} spikes), baseline ${baseline.hz.toFixed(3)} Hz, ` +
      `rise ${labRise.toFixed(3)} Hz (${ratioText(lab.hz, baseline.hz)}). ${inhibitionNote}`,
  );

  if (drive.length === 0 || suppress.length === 0) {
    line(false, 'gust_drive vs gust_suppress', 'Missing measured roles. Run scripts/measure_drive.ts.');
    return 1;
  }

  const driveNet = new LifNetwork(circuit, PROTOCOL_SEED);
  driveNet.stimulate(drive, PROTOCOL_STIM_HZ, PROTOCOL_DURATION_MS);
  driveNet.stepMs(PROTOCOL_DURATION_MS);
  const driven = mn9(driveNet, circuit);

  const supNet = new LifNetwork(circuit, PROTOCOL_SEED);
  supNet.stimulate(suppress, PROTOCOL_STIM_HZ, PROTOCOL_DURATION_MS);
  supNet.stepMs(PROTOCOL_DURATION_MS);
  const suppressed = mn9(supNet, circuit);

  const riseDrive = driven.hz - baseline.hz;
  const riseSup = suppressed.hz - baseline.hz;
  const gap = riseDrive - riseSup;
  const measuredGap = driveFile.population.driveMinusSuppressHz;
  const passGap = riseDrive > riseSup && gap >= measuredGap;
  line(
    passGap,
    `gust_drive rise exceeds gust_suppress rise by ≥ measured ${measuredGap.toFixed(3)} Hz`,
    `drive MN9 ${driven.hz.toFixed(3)} Hz (rise ${riseDrive.toFixed(3)}, ${ratioText(driven.hz, baseline.hz)}); ` +
      `suppress MN9 ${suppressed.hz.toFixed(3)} Hz (rise ${riseSup.toFixed(3)}, ${ratioText(suppressed.hz, baseline.hz)}); ` +
      `gap ${gap.toFixed(3)} Hz; rise ratio drive/suppress ${riseRatio(riseDrive, riseSup)}`,
  );

  const passSub = channelRiseIsSublinear(maxSingle, labRise);
  line(
    passSub,
    'whole-channel labellar rise is sublinear vs strongest single seed',
    `max single Δ ${maxSingle.toFixed(3)} Hz vs whole-channel rise ${labRise.toFixed(3)} Hz`,
  );

  return passLab && passGap && passSub ? 0 : 1;
}

process.exit(run());
