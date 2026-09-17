#!/usr/bin/env node
/**
 * Rest-rate diagnosis for the feeding-circuit graph. Observation only — does not write params.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCircuit } from '../src/brain/csr.ts';
import { isGustatorySeed } from '../src/brain/drive.ts';
import { LifNetwork } from '../src/brain/lif.ts';
import {
  BACKGROUND_RATE_HZ,
  PROTOCOL_SEED,
  REST_WINDOW_MS,
  type RoleTag,
} from '../src/brain/params.ts';
import { PAM_BODY_IDS } from '../src/brain/reward.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'public/data/feeding-circuit');
const meta = JSON.parse(readFileSync(join(dir, 'graph.meta.json'), 'utf8'));
const buf = readFileSync(join(dir, 'graph.bin'));
const circuit = parseCircuit(
  meta,
  buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
);

const ROLES: RoleTag[] = [
  'mn9',
  'dan_pam',
  'dan_ppl1',
  'mbon',
  'kc',
  'dn',
  'mn_other',
  'interneuron',
];
const EXTRA: RoleTag[] = ['gust_drive', 'gust_neutral', 'gust_suppress', 'dan_other'];

let tonicN = 0;
const tonicRoles = new Map<string, number>();
const gustIds: number[] = [];
for (let i = 0; i < circuit.n; i++) {
  if (isGustatorySeed(circuit.role[i])) {
    tonicN += 1;
    gustIds.push(circuit.bodyId[i]);
    tonicRoles.set(circuit.role[i], (tonicRoles.get(circuit.role[i]) ?? 0) + 1);
  }
}

console.log(`BACKGROUND_RATE_HZ = ${BACKGROUND_RATE_HZ}`);
console.log(`tonic recipients (isGustatorySeed) = ${tonicN} of ${circuit.n}`);
console.log('tonic by role:', Object.fromEntries(tonicRoles));
console.log(`unique gustatory bodyIds = ${new Set(gustIds).size}`);

function cellsThatSpiked(net: LifNetwork, role: RoleTag, spike0?: Uint32Array): number {
  let k = 0;
  for (let i = 0; i < circuit.n; i++) {
    if (circuit.role[i] !== role) continue;
    const d = net.spikeCount[i] - (spike0?.[i] ?? 0);
    if (d > 0) k += 1;
  }
  return k;
}

function report(label: string, net: LifNetwork, spike0?: Uint32Array, windowSec?: number): void {
  const t = windowSec ?? net.timeSec;
  console.log(`--- ${label}  window=${(t * 1000).toFixed(0)} ms ---`);
  for (const role of [...ROLES, ...EXTRA]) {
    let n = 0;
    let spikes = 0;
    for (let i = 0; i < circuit.n; i++) {
      if (circuit.role[i] !== role) continue;
      n += 1;
      spikes += net.spikeCount[i] - (spike0?.[i] ?? 0);
    }
    if (n === 0) {
      console.log(`  ${role.padEnd(16)} n=0`);
      continue;
    }
    const hz = t === 0 ? 0 : spikes / n / t;
    const firing = cellsThatSpiked(net, role, spike0);
    console.log(
      `  ${role.padEnd(16)} n=${String(n).padStart(6)}  spikes=${String(spikes).padStart(8)}  ` +
        `Hz=${hz.toFixed(3).padStart(8)}  cells_that_spiked=${firing}`,
    );
  }
}

function pamSplit(net: LifNetwork, windowSec: number, spike0?: Uint32Array): void {
  const verified = new Set<number>(PAM_BODY_IDS);
  let n19 = 0;
  let s19 = 0;
  let nEx = 0;
  let sEx = 0;
  for (let i = 0; i < circuit.n; i++) {
    if (circuit.role[i] !== 'dan_pam') continue;
    const d = net.spikeCount[i] - (spike0?.[i] ?? 0);
    if (verified.has(circuit.bodyId[i])) {
      n19 += 1;
      s19 += d;
    } else {
      nEx += 1;
      sEx += d;
    }
  }
  const hz = (s: number, n: number) => (n === 0 || windowSec === 0 ? 0 : s / n / windowSec);
  console.log(
    `  PAM verified-19: n=${n19} spikes=${s19} Hz=${hz(s19, n19).toFixed(3)}  |  ` +
      `extra PAM-type: n=${nEx} spikes=${sEx} Hz=${hz(sEx, nEx).toFixed(3)}`,
  );
}

const restTonic = new LifNetwork(circuit, PROTOCOL_SEED, { backgroundRateHz: BACKGROUND_RATE_HZ });
restTonic.stepMs(REST_WINDOW_MS);
report(`rest tonic=${BACKGROUND_RATE_HZ} Hz`, restTonic);
pamSplit(restTonic, REST_WINDOW_MS / 1000);

const cold = new LifNetwork(circuit, PROTOCOL_SEED, { backgroundRateHz: 0 });
cold.stepMs(REST_WINDOW_MS);
report('cold start tonic=0', cold);
pamSplit(cold, REST_WINDOW_MS / 1000);

const persist = new LifNetwork(circuit, PROTOCOL_SEED, { backgroundRateHz: 0 });
persist.stimulate(Int32Array.from(gustIds), BACKGROUND_RATE_HZ, 500);
persist.stepMs(500);
const afterPulse = persist.spikeCount.slice();
report(`0-tonic background, ${BACKGROUND_RATE_HZ} Hz pulse on ${gustIds.length} seeds`, persist);
pamSplit(persist, persist.timeSec);

persist.stepMs(REST_WINDOW_MS);
report(
  'after pulse ends, additional 2000 ms with tonic still 0',
  persist,
  afterPulse,
  persist.timeSec - 0.5,
);
pamSplit(persist, persist.timeSec - 0.5, afterPulse);

const lit = new LifNetwork(circuit, PROTOCOL_SEED, { backgroundRateHz: BACKGROUND_RATE_HZ });
lit.stepMs(REST_WINDOW_MS);
const litCounts = lit.spikeCount.slice();
const tonic = (lit as unknown as { tonicRate: Float32Array }).tonicRate;
tonic.fill(0);
lit.stepMs(REST_WINDOW_MS);
report(
  'after 2000 ms of 0.25 Hz rest, tonic cut to 0 for another 2000 ms',
  lit,
  litCounts,
  REST_WINDOW_MS / 1000,
);
pamSplit(lit, REST_WINDOW_MS / 1000, litCounts);
