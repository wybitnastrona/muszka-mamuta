#!/usr/bin/env node
/**
 * UNUSED audit. Measure gustatory → PAM the same way measure_drive.ts
 * measured MN9. The HUD does not consume this. See docs/DATA-PIPELINE.md
 * § "Rejected: dopamine readout (keep the negative result)".
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { idsForRole, parseCircuit, type CircuitGraph } from '../src/brain/csr.ts';
import { isGustatorySeed, meanRoleHz, sortAndRank } from '../src/brain/drive.ts';
import { LifNetwork } from '../src/brain/lif.ts';
import {
  BACKGROUND_RATE_HZ,
  DT_MS,
  PROTOCOL_DURATION_MS,
  PROTOCOL_SEED,
  PROTOCOL_STIM_HZ,
  REST_WINDOW_MS,
} from '../src/brain/params.ts';
import {
  formatSignedPath,
  countShortestGustatoryToPamWalks,
  shortestGustatoryToPamPath,
} from '../src/brain/reward.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'public/data/feeding-circuit');
const metaPath = join(dir, 'graph.meta.json');
const binPath = join(dir, 'graph.bin');
const outPath = join(dir, 'reward.json');
const EXPECT_SEEDS = 271;

export type RewardRecord = { bodyId: number; deltaPamHz: number; rank: number };

export type RewardPopulation = {
  baselinePamHz: number;
  baselinePpl1Hz: number;
  baselineMbonHz: number;
  restWindowMs: number;
  labellarPamHz: number;
  labellarPamRiseHz: number;
  labellarPpl1Hz: number;
  labellarPpl1RiseHz: number;
  labellarMbonHz: number;
  labellarMbonRiseHz: number;
  gustDrivePamHz: number;
  gustDrivePamRiseHz: number;
  gustDrivePpl1Hz: number;
  gustDrivePpl1RiseHz: number;
  gustDriveMbonHz: number;
  gustDriveMbonRiseHz: number;
  gustSuppressPamHz: number;
  gustSuppressPamRiseHz: number;
  gustSuppressPpl1Hz: number;
  gustSuppressPpl1RiseHz: number;
  gustSuppressMbonHz: number;
  gustSuppressMbonRiseHz: number;
  pharyngealPamHz: number;
  pharyngealPamRiseHz: number;
  pharyngealPpl1Hz: number;
  pharyngealPpl1RiseHz: number;
  pharyngealMbonHz: number;
  pharyngealMbonRiseHz: number;
  allGustPamHz: number;
  allGustPamRiseHz: number;
  allGustPpl1Hz: number;
  allGustPpl1RiseHz: number;
  allGustMbonHz: number;
  allGustMbonRiseHz: number;
  firstPamSpikeLatencyMs: number | null;
  firstPamSpikeLatencyMsPharyngeal: number | null;
  firstPamSpikeLatencyMsAllGust: number | null;
  firstPamSpikeLatencyMsPathSeed: number | null;
  pathSeedBodyId: number | null;
  firstPamSpikeLatencyMsTopSeed: number | null;
  topSeedBodyId: number | null;
};

function loadCircuit(): { circuit: CircuitGraph; meta: Record<string, unknown> } {
  if (!existsSync(metaPath) || !existsSync(binPath)) {
    throw new Error(`Missing ${metaPath} or ${binPath}`);
  }
  const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as Record<string, unknown>;
  const buf = readFileSync(binPath);
  const graph = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return { circuit: parseCircuit(meta, graph), meta };
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

function gustatorySeedIds(circuit: CircuitGraph): Int32Array {
  const ids: number[] = [];
  for (let i = 0; i < circuit.n; i++) {
    if (isGustatorySeed(circuit.role[i])) ids.push(circuit.bodyId[i]);
  }
  return Int32Array.from(ids);
}

function ratesAt(
  net: LifNetwork,
  circuit: CircuitGraph,
): { pam: ReturnType<typeof meanRoleHz>; ppl1: ReturnType<typeof meanRoleHz>; mbon: ReturnType<typeof meanRoleHz> } {
  return {
    pam: meanRoleHz(net.spikeCount, circuit.role, net.timeSec, 'dan_pam'),
    ppl1: meanRoleHz(net.spikeCount, circuit.role, net.timeSec, 'dan_ppl1'),
    mbon: meanRoleHz(net.spikeCount, circuit.role, net.timeSec, 'mbon'),
  };
}

function stimRates(circuit: CircuitGraph, ids: Int32Array): ReturnType<typeof ratesAt> {
  const net = new LifNetwork(circuit, PROTOCOL_SEED);
  net.stimulate(ids, PROTOCOL_STIM_HZ, PROTOCOL_DURATION_MS);
  net.stepMs(PROTOCOL_DURATION_MS);
  return ratesAt(net, circuit);
}

function firstPamLatencyMs(circuit: CircuitGraph, ids: Int32Array): number | null {
  const net = new LifNetwork(circuit, PROTOCOL_SEED);
  const pam = new Uint8Array(circuit.n);
  for (let i = 0; i < circuit.n; i++) if (circuit.role[i] === 'dan_pam') pam[i] = 1;
  net.stimulate(ids, PROTOCOL_STIM_HZ, PROTOCOL_DURATION_MS);
  const steps = Math.round(PROTOCOL_DURATION_MS / DT_MS);
  for (let s = 0; s < steps; s++) {
    net.step(1);
    for (let k = 0; k < net.lastSpikeN; k++) {
      if (pam[net.lastSpikes[k]!]) return net.timeSec * 1000;
    }
  }
  return null;
}

function measureSeeds(
  net: LifNetwork,
  circuit: CircuitGraph,
  ids: Int32Array,
  baselineHz: number,
): RewardRecord[] {
  const rows: Array<{ bodyId: number; deltaPamHz: number }> = [];
  const t0 = Date.now();
  for (let k = 0; k < ids.length; k++) {
    const bodyId = ids[k]!;
    net.reset(PROTOCOL_SEED);
    net.stimulate(new Int32Array([bodyId]), PROTOCOL_STIM_HZ, PROTOCOL_DURATION_MS);
    net.stepMs(PROTOCOL_DURATION_MS);
    const hz = meanRoleHz(net.spikeCount, circuit.role, net.timeSec, 'dan_pam').hz;
    rows.push({ bodyId, deltaPamHz: hz - baselineHz });
    if ((k + 1) % 20 === 0 || k + 1 === ids.length) {
      const s = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`  seeds ${k + 1}/${ids.length} (${s}s)`);
    }
  }
  return sortAndRank(rows.map((r) => ({ bodyId: r.bodyId, deltaMn9Hz: r.deltaPamHz }))).map((r) => ({
    bodyId: r.bodyId,
    deltaPamHz: r.deltaMn9Hz,
    rank: r.rank,
  }));
}

function lineRates(label: string, stim: ReturnType<typeof ratesAt>, base: ReturnType<typeof ratesAt>): void {
  console.log(
    `${label}: PAM ${stim.pam.hz.toFixed(3)} Hz (Δ ${(stim.pam.hz - base.pam.hz).toFixed(3)}) · ` +
      `PPL1 ${stim.ppl1.hz.toFixed(3)} Hz (Δ ${(stim.ppl1.hz - base.ppl1.hz).toFixed(3)}) · ` +
      `MBON ${stim.mbon.hz.toFixed(3)} Hz (Δ ${(stim.mbon.hz - base.mbon.hz).toFixed(3)})`,
  );
}

function main(): void {
  const { circuit, meta } = loadCircuit();
  const pamN = circuit.role.filter((r) => r === 'dan_pam').length;
  if (pamN < 19) {
    throw new Error(`Expected at least 19 dan_pam tags. Run npm run tag:reward first (got ${pamN}).`);
  }
  console.log(`dan_pam tags: ${pamN}`);

  const path = shortestGustatoryToPamPath(circuit);
  console.log('--- path: gustatory seed → PAM ---');
  if (!path) {
    console.log(
      'PAM is NOT reachable from any gustatory seed in the extracted subgraph. ' +
        'MaleCNS feeding-circuit BFS (depth 4, intersection with motor) did not keep a ' +
        'gustatory→PAM walk. We will not invent a dopamine drive. Stop.',
    );
    process.exit(1);
  }
  console.log(formatSignedPath(path));
  console.log(
    `nodes: ${path.nodes.map((n) => `${n.bodyId} (${n.type ?? n.role})`).join(' → ')}`,
  );
  const pathCount = countShortestGustatoryToPamWalks(circuit);
  console.log(
    pathCount
      ? `shortest-path walks at ${pathCount.hops} hops: ${pathCount.walks}`
      : 'shortest-path walks: none',
  );

  const labellar = idsForChannel(circuit, meta, 'labellar');
  const pharyngeal = idsForChannel(circuit, meta, 'pharyngeal');
  const seeds = gustatorySeedIds(circuit);
  if (seeds.length !== EXPECT_SEEDS) {
    throw new Error(`Expected ${EXPECT_SEEDS} gustatory seeds, got ${seeds.length}`);
  }

  const restNet = new LifNetwork(circuit, PROTOCOL_SEED);
  restNet.stepMs(REST_WINDOW_MS);
  const baseline = ratesAt(restNet, circuit);
  console.log(
    `baseline (0.25 Hz tonic, ${REST_WINDOW_MS} ms): ` +
      `PAM ${baseline.pam.hz.toFixed(3)} Hz (${baseline.pam.spikes} spikes / ${baseline.pam.n} cells) · ` +
      `PPL1 ${baseline.ppl1.hz.toFixed(3)} Hz · MBON ${baseline.mbon.hz.toFixed(3)} Hz ` +
      `background=${BACKGROUND_RATE_HZ} Hz stim=${PROTOCOL_STIM_HZ} Hz seed=${PROTOCOL_SEED}`,
  );

  const driveIds = idsForRole(circuit, 'gust_drive');
  const suppressIds = idsForRole(circuit, 'gust_suppress');
  console.log('Population pulses (100 Hz / 500 ms)…');
  const labellarR = stimRates(circuit, labellar);
  const pharyngealR = stimRates(circuit, pharyngeal);
  const allR = stimRates(circuit, seeds);
  const driveR = stimRates(circuit, driveIds);
  const suppressR = stimRates(circuit, suppressIds);
  lineRates('labellar/peg', labellarR, baseline);
  lineRates('pharyngeal', pharyngealR, baseline);
  lineRates('all 271 gustatory', allR, baseline);
  console.log(
    `whole-channel ΔPAM ${(allR.pam.hz - baseline.pam.hz).toFixed(3)} Hz · ` +
      `ΔPPL1 ${(allR.ppl1.hz - baseline.ppl1.hz).toFixed(3)} Hz · ` +
      `ΔMBON ${(allR.mbon.hz - baseline.mbon.hz).toFixed(3)} Hz`,
  );
  lineRates('gust_drive', driveR, baseline);
  lineRates('gust_suppress', suppressR, baseline);

  const latencyLab = firstPamLatencyMs(circuit, labellar);
  const latencyPhar = firstPamLatencyMs(circuit, pharyngeal);
  const latencyAll = firstPamLatencyMs(circuit, seeds);
  const latLine = (label: string, ms: number | null) =>
    console.log(
      ms == null
        ? `first PAM spike after ${label} onset: none in 500 ms`
        : `first PAM spike after ${label} onset: ${ms.toFixed(1)} ms`,
    );
  latLine('labellar/peg', latencyLab);
  latLine('pharyngeal', latencyPhar);
  latLine('all gustatory', latencyAll);

  let perSeed: RewardRecord[];
  if (process.env.SKIP_PER_SEED === '1' && existsSync(outPath)) {
    const prev = JSON.parse(readFileSync(outPath, 'utf8')) as { seeds: RewardRecord[] };
    perSeed = prev.seeds;
    console.log(`reusing ${perSeed.length} per-seed rows from ${outPath}`);
  } else {
    console.log('Per-seed PAM deltas (271 gustatory)…');
    perSeed = measureSeeds(restNet, circuit, seeds, baseline.pam.hz);
  }
  const pathSeedId = path.nodes[0]?.bodyId ?? null;
  const topSeedId = perSeed[0]?.bodyId ?? null;
  const latencyPath = pathSeedId == null ? null : firstPamLatencyMs(circuit, new Int32Array([pathSeedId]));
  const latencyTop = topSeedId == null ? null : firstPamLatencyMs(circuit, new Int32Array([topSeedId]));
  if (pathSeedId != null) latLine(`path seed ${pathSeedId}`, latencyPath);
  if (topSeedId != null) latLine(`top ΔPAM seed ${topSeedId}`, latencyTop);
  const deltas = perSeed.map((r) => r.deltaPamHz).sort((a, b) => a - b);
  const mid = Math.floor(deltas.length / 2);
  const median = deltas.length % 2 ? deltas[mid]! : (deltas[mid - 1]! + deltas[mid]!) / 2;
  console.log(
    `per-seed ΔPAM: n=${deltas.length} min=${deltas[0]!.toFixed(3)} ` +
      `max=${deltas[deltas.length - 1]!.toFixed(3)} median=${median.toFixed(3)} ` +
      `positive=${deltas.filter((d) => d > 0).length} negative=${deltas.filter((d) => d < 0).length}`,
  );

  const population: RewardPopulation = {
    baselinePamHz: baseline.pam.hz,
    baselinePpl1Hz: baseline.ppl1.hz,
    baselineMbonHz: baseline.mbon.hz,
    restWindowMs: REST_WINDOW_MS,
    labellarPamHz: labellarR.pam.hz,
    labellarPamRiseHz: labellarR.pam.hz - baseline.pam.hz,
    labellarPpl1Hz: labellarR.ppl1.hz,
    labellarPpl1RiseHz: labellarR.ppl1.hz - baseline.ppl1.hz,
    labellarMbonHz: labellarR.mbon.hz,
    labellarMbonRiseHz: labellarR.mbon.hz - baseline.mbon.hz,
    gustDrivePamHz: driveR.pam.hz,
    gustDrivePamRiseHz: driveR.pam.hz - baseline.pam.hz,
    gustDrivePpl1Hz: driveR.ppl1.hz,
    gustDrivePpl1RiseHz: driveR.ppl1.hz - baseline.ppl1.hz,
    gustDriveMbonHz: driveR.mbon.hz,
    gustDriveMbonRiseHz: driveR.mbon.hz - baseline.mbon.hz,
    gustSuppressPamHz: suppressR.pam.hz,
    gustSuppressPamRiseHz: suppressR.pam.hz - baseline.pam.hz,
    gustSuppressPpl1Hz: suppressR.ppl1.hz,
    gustSuppressPpl1RiseHz: suppressR.ppl1.hz - baseline.ppl1.hz,
    gustSuppressMbonHz: suppressR.mbon.hz,
    gustSuppressMbonRiseHz: suppressR.mbon.hz - baseline.mbon.hz,
    pharyngealPamHz: pharyngealR.pam.hz,
    pharyngealPamRiseHz: pharyngealR.pam.hz - baseline.pam.hz,
    pharyngealPpl1Hz: pharyngealR.ppl1.hz,
    pharyngealPpl1RiseHz: pharyngealR.ppl1.hz - baseline.ppl1.hz,
    pharyngealMbonHz: pharyngealR.mbon.hz,
    pharyngealMbonRiseHz: pharyngealR.mbon.hz - baseline.mbon.hz,
    allGustPamHz: allR.pam.hz,
    allGustPamRiseHz: allR.pam.hz - baseline.pam.hz,
    allGustPpl1Hz: allR.ppl1.hz,
    allGustPpl1RiseHz: allR.ppl1.hz - baseline.ppl1.hz,
    allGustMbonHz: allR.mbon.hz,
    allGustMbonRiseHz: allR.mbon.hz - baseline.mbon.hz,
    firstPamSpikeLatencyMs: latencyLab,
    firstPamSpikeLatencyMsPharyngeal: latencyPhar,
    firstPamSpikeLatencyMsAllGust: latencyAll,
    firstPamSpikeLatencyMsPathSeed: latencyPath,
    pathSeedBodyId: pathSeedId,
    firstPamSpikeLatencyMsTopSeed: latencyTop,
    topSeedBodyId: topSeedId,
  };

  const payload = {
    seed: PROTOCOL_SEED,
    stimHz: PROTOCOL_STIM_HZ,
    durationMs: PROTOCOL_DURATION_MS,
    restWindowMs: REST_WINDOW_MS,
    backgroundRateHz: BACKGROUND_RATE_HZ,
    limitation:
      "MaleCNS does not assign mushroom-body compartments. These PAM cells are the ones in the extracted subgraph; we do not claim they are PAM-β'2.",
    path: {
      hops: path.hops,
      productSign: path.productSign,
      formatted: formatSignedPath(path),
      nodes: path.nodes,
      walksAtShortestDepth: pathCount?.walks ?? 0,
    },
    population,
    seeds: perSeed,
  };
  writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n');

  const provenance = (meta.provenance ?? {}) as Record<string, unknown>;
  provenance.reward_measurement = {
    file: 'public/data/feeding-circuit/reward.json',
    seed: PROTOCOL_SEED,
    stimHz: PROTOCOL_STIM_HZ,
    durationMs: PROTOCOL_DURATION_MS,
    restWindowMs: REST_WINDOW_MS,
    backgroundRateHz: BACKGROUND_RATE_HZ,
    path: payload.path,
    population,
  };
  meta.provenance = provenance;
  writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n');
  console.log(`wrote ${outPath}`);
}

main();
