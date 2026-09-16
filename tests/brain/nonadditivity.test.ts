import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseCircuit } from '../../src/brain/csr.ts';
import { channelRiseIsSublinear, meanMn9Hz } from '../../src/brain/drive.ts';
import { LifNetwork } from '../../src/brain/lif.ts';
import { PROTOCOL_DURATION_MS, PROTOCOL_SEED, PROTOCOL_STIM_HZ, REST_WINDOW_MS } from '../../src/brain/params.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const dir = join(root, 'public/data/feeding-circuit');
const metaPath = join(dir, 'graph.meta.json');
const binPath = join(dir, 'graph.bin');
const drivePath = join(dir, 'drive.json');
const hasCircuit = existsSync(metaPath) && existsSync(binPath) && existsSync(drivePath);

describe.skipIf(!hasCircuit)('labellar channel non-additivity', () => {
  it('whole-channel MN9 rise stays below the strongest single seed after calibration', () => {
    const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as unknown;
    const driveFile = JSON.parse(readFileSync(drivePath, 'utf8')) as {
      gust_labellar: Array<{ bodyId: number; deltaMn9Hz: number }>;
    };
    const buf = readFileSync(binPath);
    const graph = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const circuit = parseCircuit(meta, graph);
    const labellar = Int32Array.from(driveFile.gust_labellar.map((row) => row.bodyId));
    const strongestId = driveFile.gust_labellar[0]?.bodyId;
    expect(labellar.length).toBe(223);
    expect(strongestId).toEqual(expect.any(Number));

    const baselineNet = new LifNetwork(circuit, PROTOCOL_SEED);
    baselineNet.stepMs(REST_WINDOW_MS);
    const baseline = meanMn9Hz(baselineNet.spikeCount, circuit.role, baselineNet.timeSec).hz;

    const single = new LifNetwork(circuit, PROTOCOL_SEED);
    single.stimulate(new Int32Array([strongestId]), PROTOCOL_STIM_HZ, PROTOCOL_DURATION_MS);
    single.stepMs(PROTOCOL_DURATION_MS);
    const singleRise = meanMn9Hz(single.spikeCount, circuit.role, single.timeSec).hz - baseline;

    const all = new LifNetwork(circuit, PROTOCOL_SEED);
    all.stimulate(labellar, PROTOCOL_STIM_HZ, PROTOCOL_DURATION_MS);
    all.stepMs(PROTOCOL_DURATION_MS);
    const wholeRise = meanMn9Hz(all.spikeCount, circuit.role, all.timeSec).hz - baseline;

    expect(channelRiseIsSublinear(singleRise, wholeRise)).toBe(true);
    expect(singleRise).toBeGreaterThan(wholeRise);
  }, 120_000);
});

describe('channelRiseIsSublinear', () => {
  it('is the recorded circuit property: max single delta exceeds whole-channel rise', () => {
    expect(channelRiseIsSublinear(99, 4)).toBe(true);
    expect(channelRiseIsSublinear(4, 4)).toBe(false);
    expect(channelRiseIsSublinear(4, 99)).toBe(false);
  });
});
