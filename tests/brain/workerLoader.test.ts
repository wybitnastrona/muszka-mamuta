import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadCircuitFromInitBuffers } from '../../src/brain/csr.ts';
import { isCompressedGraph } from '../../src/brain/graphCodec.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const dir = join(root, 'public/data/feeding-circuit');
const metaPath = join(dir, 'graph.meta.json');
const binPath = join(dir, 'graph.bin');
const hasCircuit = existsSync(metaPath) && existsSync(binPath);

describe.skipIf(!hasCircuit)('worker circuit loader', () => {
  it('loads public graph.bin through loadCircuitFromInitBuffers (lif-worker init path)', () => {
    const metaBuf = readFileSync(metaPath);
    const graphBuf = readFileSync(binPath);
    const metaBytes = metaBuf.buffer.slice(metaBuf.byteOffset, metaBuf.byteOffset + metaBuf.byteLength);
    const graph = graphBuf.buffer.slice(graphBuf.byteOffset, graphBuf.byteOffset + graphBuf.byteLength);
    expect(isCompressedGraph(graph)).toBe(true);

    const offsetView = new Uint8Array(graph.byteLength + 8);
    offsetView.set(new Uint8Array(graph), 8);
    const shifted = offsetView.subarray(8);

    for (const payload of [graph, graphBuf, shifted] as const) {
      const circuit = loadCircuitFromInitBuffers(metaBytes, payload);
      expect(circuit.n).toBeGreaterThanOrEqual(20_000);
      expect(circuit.n).toBeLessThanOrEqual(30_000);
      expect(circuit.indptr.length).toBe(circuit.n + 1);
      expect(circuit.indices.length).toBe(circuit.nEdges);
      expect(circuit.weights.length).toBe(circuit.nEdges);
      expect(circuit.indptr[0]).toBe(0);
      expect(circuit.indptr[circuit.n]).toBe(circuit.nEdges);
    }
  });
});
