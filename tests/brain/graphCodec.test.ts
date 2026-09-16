import { describe, expect, it } from 'vitest';
import {
  decodeCompressedGraph,
  encodeCompressedGraph,
  float16BitsToFloat32,
  float32ToFloat16Bits,
  isCompressedGraph,
  parseUncompressedGraph,
  readUleb128,
  writeUleb128,
} from '../../src/brain/graphCodec.ts';
import { parseGraphBin } from '../../src/brain/csr.ts';

describe('uleb128', () => {
  it('round-trips 0, 127, 128, 16383, 20000', () => {
    for (const n of [0, 127, 128, 16383, 20000, 0x1fffff]) {
      const out: number[] = [];
      writeUleb128(n, out);
      const got = readUleb128(Uint8Array.from(out), { i: 0 });
      expect(got).toBe(n);
    }
  });
});

describe('float16', () => {
  it('keeps integer synapse counts up to 2048 and rounds 2591', () => {
    for (const w of [-2048, -1, 0, 1, 7, 64, 1878, 2048]) {
      const bits = float32ToFloat16Bits(w);
      expect(float16BitsToFloat32(bits)).toBe(w);
    }
    const rounded = float16BitsToFloat32(float32ToFloat16Bits(-2591));
    expect(Math.abs(rounded + 2592) < 2 || Math.abs(rounded + 2591) < 1).toBe(true);
  });
});

describe('MMG1 graph', () => {
  it('encodes a tiny unsorted CSR and decodes sorted rows', () => {
    const indptr = Int32Array.from([0, 2, 3, 5]);
    const indices = Int32Array.from([2, 1, 2, 0, 1]);
    const weights = Float32Array.from([1.5, -2, 3, 4, -5]);
    const bin = encodeCompressedGraph({ indptr, indices, weights });
    expect(isCompressedGraph(bin)).toBe(true);
    const decoded = decodeCompressedGraph(bin, 3, 5);
    expect(Array.from(decoded.indptr)).toEqual([0, 2, 3, 5]);
    expect(Array.from(decoded.indices)).toEqual([1, 2, 2, 0, 1]);
    expect(decoded.weights[0]).toBe(-2);
    expect(decoded.weights[1]).toBe(1.5);
    const viaParse = parseGraphBin(bin, 3, 5);
    expect(Array.from(viaParse.indices)).toEqual(Array.from(decoded.indices));
  });

  it('still reads the uncompressed audit layout', () => {
    const n = 2;
    const nEdges = 2;
    const buf = new ArrayBuffer((n + 1) * 4 + nEdges * 4 + nEdges * 4);
    const indptr = new Int32Array(buf, 0, n + 1);
    const indices = new Int32Array(buf, (n + 1) * 4, nEdges);
    const weights = new Float32Array(buf, (n + 1) * 4 + nEdges * 4, nEdges);
    indptr[0] = 0; indptr[1] = 1; indptr[2] = 2;
    indices[0] = 1; indices[1] = 0;
    weights[0] = 9; weights[1] = -3;
    const parsed = parseUncompressedGraph(buf, n, nEdges);
    expect(Array.from(parsed.indices)).toEqual([1, 0]);
    expect(parseGraphBin(buf, n, nEdges).weights[0]).toBe(9);
    expect(isCompressedGraph(buf)).toBe(false);
  });
});
