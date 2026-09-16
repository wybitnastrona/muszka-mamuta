#!/usr/bin/env node
/**
 * Offline check that the feeding-circuit LIF reproduces a Shiu-style
 * proboscis-extension signature: labellar drive raises MN9; inferred
 * path_sign = -1 drive raises it less.
 *
 * This is not a sweet/bitter experiment. MaleCNS has no receptor-gene labels.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { idsForRole, idsWithPathSign, parseCircuit, type CircuitGraph } from '../src/brain/csr.ts';
import { LifNetwork } from '../src/brain/lif.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const metaPath = join(root, 'public/data/feeding-circuit/graph.meta.json');
const binPath = join(root, 'public/data/feeding-circuit/graph.bin');
const SEED = 1;
const BASELINE_MS = 200;
const STIM_MS = 500;
const RATE_HZ = 100;

function line(ok: boolean, name: string, detail: string): boolean {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  console.log(`      ${detail}`);
  return ok;
}

function mn9Spikes(net: LifNetwork, circuit: CircuitGraph): { n: number; spikes: number; hz: number; ms: number } {
  let n = 0;
  let spikes = 0;
  for (let i = 0; i < circuit.n; i++) {
    if (circuit.role[i] !== 'mn9') continue;
    n++;
    spikes += net.spikeCount[i];
  }
  const ms = net.timeSec * 1000;
  return { n, spikes, hz: n === 0 || ms === 0 ? 0 : spikes / n / (ms / 1000), ms };
}

function run(): number {
  if (!existsSync(metaPath) || !existsSync(binPath)) {
    line(
      false,
      'graph present',
      `${binPath} and graph.meta.json are missing. Run scripts/data-prep/extract_feeding_circuit.py.`,
    );
    return 1;
  }

  const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as unknown;
  const buf = readFileSync(binPath);
  const graph = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const circuit = parseCircuit(meta, graph);
  const labellar = idsForRole(circuit, 'gust_labellar');
  const negative = idsWithPathSign(circuit, -1);
  console.log(
    `neurons=${circuit.n} edges=${circuit.nEdges} gust_labellar=${labellar.length} path_sign=-1=${negative.length}`,
  );

  const baselineNet = new LifNetwork(circuit, SEED);
  baselineNet.stepMs(BASELINE_MS);
  const baseline = mn9Spikes(baselineNet, circuit);
  console.log(`baseline MN9: ${baseline.hz.toFixed(3)} Hz (${baseline.spikes} spikes / ${baseline.n} cells / ${baseline.ms.toFixed(0)} ms)`);

  const labNet = new LifNetwork(circuit, SEED);
  labNet.stimulate(labellar, RATE_HZ, STIM_MS);
  labNet.stepMs(STIM_MS);
  const lab = mn9Spikes(labNet, circuit);
  const floor = Math.max(baseline.hz, 0.1);
  const ratio = lab.hz / floor;
  const passLab = labellar.length > 0 && lab.hz > 5 * floor;
  line(
    passLab,
    'gust_labellar 100 Hz / 500 ms → MN9 > 5× baseline',
    `MN9 ${lab.hz.toFixed(3)} Hz (${lab.spikes} spikes) / baseline ${baseline.hz.toFixed(3)} Hz (floor ${floor.toFixed(3)}) = ${ratio.toFixed(2)}×`,
  );

  if (negative.length === 0) {
    line(false, 'path_sign = -1 drive → smaller MN9 rise', 'No neurons with path_sign = -1 in metadata.');
    return 1;
  }

  const negNet = new LifNetwork(circuit, SEED);
  negNet.stimulate(negative, RATE_HZ, STIM_MS);
  negNet.stepMs(STIM_MS);
  const neg = mn9Spikes(negNet, circuit);
  const riseLab = lab.hz - baseline.hz;
  const riseNeg = neg.hz - baseline.hz;
  const passNeg = riseLab > 0 && riseNeg < 0.5 * riseLab;
  line(
    passNeg,
    'path_sign = -1 100 Hz / 500 ms → MN9 rise clearly smaller',
    `MN9 ${neg.hz.toFixed(3)} Hz (${neg.spikes} spikes, rise ${riseNeg.toFixed(3)}) vs labellar rise ${riseLab.toFixed(3)}`,
  );

  return passLab && passNeg ? 0 : 1;
}

process.exit(run());
