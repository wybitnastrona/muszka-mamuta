#!/usr/bin/env node
/**
 * Measure each proboscis gustatory seed's causal effect on MN9.
 * One cell at PROTOCOL_STIM_HZ / PROTOCOL_DURATION_MS, minus tonic baseline.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { idsForRole, parseCircuit, type CircuitGraph } from '../src/brain/csr.ts';
import {
  driveDistribution,
  meanMn9Hz,
  sortAndRank,
  tercileRole,
  type DriveRecord,
} from '../src/brain/drive.ts';
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
const outPath = join(dir, 'drive.json');
const EXPECT_LABELLAR = 223;
const EXPECT_PHARYNGEAL = 48;

export type PopulationMeasurement = {
  baselineMn9Hz: number;
  restWindowMs: number;
  labellarMn9Hz: number;
  labellarRiseHz: number;
  gustDriveMn9Hz: number;
  gustDriveRiseHz: number;
  gustSuppressMn9Hz: number;
  gustSuppressRiseHz: number;
  driveMinusSuppressHz: number;
  maxLabellarDeltaHz: number;
};

function loadCircuit(): {
  circuit: CircuitGraph;
  meta: Record<string, unknown>;
  graph: ArrayBuffer;
} {
  if (!existsSync(metaPath) || !existsSync(binPath)) {
    throw new Error(`Missing ${metaPath} or ${binPath}`);
  }
  const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as Record<string, unknown>;
  const buf = readFileSync(binPath);
  const graph = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return { circuit: parseCircuit(meta, graph), meta, graph };
}

function idsForChannel(
  circuit: CircuitGraph,
  meta: Record<string, unknown>,
  channel: 'labellar' | 'pharyngeal',
): Int32Array {
  const stored = meta.gust_channel;
  if (Array.isArray(stored) && stored.length === circuit.n) {
    const ids: number[] = [];
    for (let i = 0; i < circuit.n; i++) {
      if (stored[i] === channel) ids.push(circuit.bodyId[i]);
    }
    return Int32Array.from(ids);
  }
  return idsForRole(circuit, channel === 'labellar' ? 'gust_labellar' : 'gust_pharyngeal');
}

function persistGustChannel(
  meta: Record<string, unknown>,
  circuit: CircuitGraph,
  labellar: Int32Array,
  pharyngeal: Int32Array,
): void {
  if (Array.isArray(meta.gust_channel) && meta.gust_channel.length === circuit.n) return;
  const lab = new Set(labellar);
  const ph = new Set(pharyngeal);
  meta.gust_channel = Array.from({ length: circuit.n }, (_, i) => {
    const id = circuit.bodyId[i];
    if (lab.has(id)) return 'labellar';
    if (ph.has(id)) return 'pharyngeal';
    return null;
  });
}

function measureGroup(
  net: LifNetwork,
  circuit: CircuitGraph,
  ids: Int32Array,
  baselineHz: number,
  label: string,
): DriveRecord[] {
  const rows: Array<{ bodyId: number; deltaMn9Hz: number }> = [];
  const t0 = Date.now();
  for (let k = 0; k < ids.length; k++) {
    const bodyId = ids[k];
    net.reset(PROTOCOL_SEED);
    net.stimulate(new Int32Array([bodyId]), PROTOCOL_STIM_HZ, PROTOCOL_DURATION_MS);
    net.stepMs(PROTOCOL_DURATION_MS);
    const hz = meanMn9Hz(net.spikeCount, circuit.role, net.timeSec).hz;
    rows.push({ bodyId, deltaMn9Hz: hz - baselineHz });
    if ((k + 1) % 20 === 0 || k + 1 === ids.length) {
      const s = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`  ${label} ${k + 1}/${ids.length} (${s}s)`);
    }
  }
  return sortAndRank(rows);
}

function stimMn9(circuit: CircuitGraph, ids: Int32Array): number {
  const net = new LifNetwork(circuit, PROTOCOL_SEED);
  net.stimulate(ids, PROTOCOL_STIM_HZ, PROTOCOL_DURATION_MS);
  net.stepMs(PROTOCOL_DURATION_MS);
  return meanMn9Hz(net.spikeCount, circuit.role, net.timeSec).hz;
}

function printDist(name: string, records: DriveRecord[]): void {
  const stats = driveDistribution(records.map((r) => r.deltaMn9Hz));
  console.log(
    `${name}: n=${stats.n} min=${stats.min.toFixed(3)} max=${stats.max.toFixed(3)} ` +
      `median=${stats.median.toFixed(3)} negative=${stats.negative}`,
  );
}

function main(): void {
  const { circuit, meta, graph } = loadCircuit();
  const labellar = idsForChannel(circuit, meta, 'labellar');
  const pharyngeal = idsForChannel(circuit, meta, 'pharyngeal');
  if (labellar.length !== EXPECT_LABELLAR) {
    throw new Error(`Expected ${EXPECT_LABELLAR} labellar/peg seeds, got ${labellar.length}`);
  }
  if (pharyngeal.length !== EXPECT_PHARYNGEAL) {
    throw new Error(`Expected ${EXPECT_PHARYNGEAL} pharyngeal seeds, got ${pharyngeal.length}`);
  }

  const net = new LifNetwork(circuit, PROTOCOL_SEED);
  net.stepMs(REST_WINDOW_MS);
  const baseline = meanMn9Hz(net.spikeCount, circuit.role, net.timeSec);
  console.log(
    `baseline MN9 ${baseline.hz.toFixed(3)} Hz (${baseline.spikes} spikes / ${baseline.n} cells / ${REST_WINDOW_MS} ms) ` +
      `background=${BACKGROUND_RATE_HZ} Hz stim=${PROTOCOL_STIM_HZ} Hz seed=${PROTOCOL_SEED}`,
  );

  console.log('Measuring gust_labellar (labellar bristle + taste peg)…');
  const labellarDrive = measureGroup(net, circuit, labellar, baseline.hz, 'labellar');
  console.log('Measuring gust_pharyngeal…');
  const pharyngealDrive = measureGroup(net, circuit, pharyngeal, baseline.hz, 'pharyngeal');

  printDist('gust_labellar', labellarDrive);
  printDist('gust_pharyngeal', pharyngealDrive);
  const combined = sortAndRank([...labellarDrive, ...pharyngealDrive]);
  printDist('all proboscis gustatory', combined);

  persistGustChannel(meta, circuit, labellar, pharyngeal);

  const roleById = new Map<number, ReturnType<typeof tercileRole>>();
  for (const row of combined) {
    roleById.set(row.bodyId, tercileRole(row.rank, combined.length));
  }
  const roles = meta.role as string[];
  const bodyIds = meta.bodyId as number[];
  const byRole: Record<string, number> = {};
  for (let i = 0; i < roles.length; i++) {
    const next = roleById.get(bodyIds[i]);
    if (next) roles[i] = next;
    byRole[roles[i]] = (byRole[roles[i]] ?? 0) + 1;
  }

  if (Array.isArray(meta.path_sign) && !Array.isArray(meta.path_sign_deprecated)) {
    meta.path_sign_deprecated = meta.path_sign;
    delete meta.path_sign;
  }

  const tagged = parseCircuit(meta, graph);
  const driveIds = idsForRole(tagged, 'gust_drive');
  const suppressIds = idsForRole(tagged, 'gust_suppress');
  console.log('Measuring population protocols (labellar / gust_drive / gust_suppress)…');
  const labellarHz = stimMn9(tagged, labellar);
  const driveHz = stimMn9(tagged, driveIds);
  const suppressHz = stimMn9(tagged, suppressIds);
  const labellarRise = labellarHz - baseline.hz;
  const driveRise = driveHz - baseline.hz;
  const suppressRise = suppressHz - baseline.hz;
  const maxLabellarDeltaHz = labellarDrive[0]?.deltaMn9Hz ?? 0;
  const population: PopulationMeasurement = {
    baselineMn9Hz: baseline.hz,
    restWindowMs: REST_WINDOW_MS,
    labellarMn9Hz: labellarHz,
    labellarRiseHz: labellarRise,
    gustDriveMn9Hz: driveHz,
    gustDriveRiseHz: driveRise,
    gustSuppressMn9Hz: suppressHz,
    gustSuppressRiseHz: suppressRise,
    driveMinusSuppressHz: driveRise - suppressRise,
    maxLabellarDeltaHz,
  };
  console.log(
    `population: baseline ${baseline.hz.toFixed(3)} Hz; ` +
      `labellar ${labellarHz.toFixed(3)} Hz (rise ${labellarRise.toFixed(3)}); ` +
      `drive ${driveHz.toFixed(3)} Hz (rise ${driveRise.toFixed(3)}); ` +
      `suppress ${suppressHz.toFixed(3)} Hz (rise ${suppressRise.toFixed(3)}); ` +
      `max single labellar Δ ${maxLabellarDeltaHz.toFixed(3)} Hz`,
  );
  if (maxLabellarDeltaHz > labellarRise) {
    console.log(
      'NOTE: whole-channel rise is below the strongest single seed. ' +
        'Consistent with lateral inhibition / gain normalisation in the extracted circuit.',
    );
  }

  const provenance = (meta.provenance ?? {}) as Record<string, unknown>;
  provenance.path_sign_deprecated = {
    ...(typeof provenance.path_sign_deprecated === 'object' && provenance.path_sign_deprecated !== null
      ? (provenance.path_sign_deprecated as object)
      : typeof provenance.path_sign === 'object' && provenance.path_sign !== null
        ? (provenance.path_sign as object)
        : {}),
    status: 'rejected',
    test: 'validate_per.ts (2026-09-16): path_sign=-1 at 100 Hz drove MN9 at 52 Hz vs 32 Hz for all labellar. Product-of-signs on one strongest path is not net effect.',
  };
  delete provenance.path_sign;
  provenance.drive_measurement = {
    file: 'public/data/feeding-circuit/drive.json',
    seed: PROTOCOL_SEED,
    stimHz: PROTOCOL_STIM_HZ,
    durationMs: PROTOCOL_DURATION_MS,
    restWindowMs: REST_WINDOW_MS,
    backgroundRateHz: BACKGROUND_RATE_HZ,
    baselineMn9Hz: baseline.hz,
    role_rule: 'terciles of deltaMn9Hz over all 271 proboscis gustatory seeds (rank 1 = strongest MN9 drive)',
    by_role: {
      gust_drive: byRole.gust_drive ?? 0,
      gust_neutral: byRole.gust_neutral ?? 0,
      gust_suppress: byRole.gust_suppress ?? 0,
    },
    population,
  };
  const counts = (provenance.neuron_counts ?? {}) as Record<string, unknown>;
  counts.by_role = byRole;
  provenance.neuron_counts = counts;
  meta.provenance = provenance;

  const payload = {
    seed: PROTOCOL_SEED,
    stimHz: PROTOCOL_STIM_HZ,
    durationMs: PROTOCOL_DURATION_MS,
    restWindowMs: REST_WINDOW_MS,
    backgroundRateHz: BACKGROUND_RATE_HZ,
    baselineMn9Hz: baseline.hz,
    gust_labellar: labellarDrive,
    gust_pharyngeal: pharyngealDrive,
    terciles_all_seeds: {
      n: combined.length,
      gust_drive: combined.filter((r) => tercileRole(r.rank, combined.length) === 'gust_drive').length,
      gust_neutral: combined.filter((r) => tercileRole(r.rank, combined.length) === 'gust_neutral').length,
      gust_suppress: combined.filter((r) => tercileRole(r.rank, combined.length) === 'gust_suppress').length,
    },
    population,
  };
  writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n');
  writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n');
  console.log(`wrote ${outPath}`);
  console.log(`updated roles in ${metaPath}`);
  console.log(
    `roles: drive=${byRole.gust_drive ?? 0} neutral=${byRole.gust_neutral ?? 0} suppress=${byRole.gust_suppress ?? 0}`,
  );
}

main();
